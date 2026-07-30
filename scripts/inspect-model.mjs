// Report what is inside a .glb so models/manifest.json can be filled in
// correctly: node names (for wheel spin), material names (for paint tinting),
// triangle count (for performance), and the model's orientation.
//
//   node scripts/inspect-model.mjs models/car.glb
//
// Parses the GLB container directly — no dependencies, no three.js needed.
import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/inspect-model.mjs <file.glb>');
  process.exit(1);
}

const buf = fs.readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error('not a GLB file (bad magic). A .gltf file is JSON — open it directly.');
  process.exit(1);
}

// GLB: 12-byte header, then chunks of [length, type, data].
let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) { console.error('no JSON chunk found'); process.exit(1); }

const g = json;
const nodes = g.nodes || [];
const meshes = g.meshes || [];
const materials = g.materials || [];
const accessors = g.accessors || [];

// Triangles: sum indexed primitive counts across all mesh instances.
let tris = 0, prims = 0;
const meshTris = meshes.map((m) => {
  let t = 0;
  for (const p of m.primitives || []) {
    prims++;
    const mode = p.mode ?? 4;                       // 4 = TRIANGLES
    const acc = p.indices != null ? accessors[p.indices] : accessors[p.attributes?.POSITION];
    if (acc && mode === 4) t += Math.floor(acc.count / 3);
  }
  return t;
});
// Count each mesh once per node that references it.
const meshUse = new Array(meshes.length).fill(0);
for (const n of nodes) if (n.mesh != null) meshUse[n.mesh]++;
meshes.forEach((_, i) => { tris += meshTris[i] * Math.max(1, meshUse[i]); });

// Overall bounding box from POSITION accessor min/max.
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const m of meshes) {
  for (const p of m.primitives || []) {
    const acc = accessors[p.attributes?.POSITION];
    if (!acc?.min || !acc?.max) continue;
    for (let i = 0; i < 3; i++) {
      bb.min[i] = Math.min(bb.min[i], acc.min[i]);
      bb.max[i] = Math.max(bb.max[i], acc.max[i]);
    }
  }
}
const size = bb.max.map((v, i) => +(v - bb.min[i]).toFixed(3));

console.log(`\n=== ${path} (${(buf.length / 1048576).toFixed(1)} MB) ===`);
console.log(`generator : ${g.asset?.generator || '?'}`);
console.log(`nodes ${nodes.length} · meshes ${meshes.length} · primitives ${prims} · materials ${materials.length} · images ${(g.images || []).length}`);
console.log(`triangles : ${tris.toLocaleString()}  ${tris > 120000 ? '<-- heavy; see note below' : ''}`);
console.log(`bbox size : x=${size[0]} y=${size[1]} z=${size[2]} (model units)`);

// Longest horizontal axis is the car's length, which tells us which way it faces.
const faces = size[0] > size[2] ? '+x' : '+z';
console.log(`faces     : likely "${faces}" (longest horizontal axis)`);
if (size[1] > Math.max(size[0], size[2])) {
  console.log('            ...but Y is longest, so this model may be Z-up rather than Y-up.');
}

const wheelRe = /wheel|tyre|tire|rim|hub/i;
const paintRe = /body|paint|carpaint|shell|exterior|livery/i;

const wheelNodes = nodes.map(n => n.name).filter(n => n && wheelRe.test(n));
const paintMats = materials.map(m => m.name).filter(n => n && paintRe.test(n));

console.log('\n-- material names --');
materials.forEach((m, i) => console.log(`  [${i}] ${m.name || '(unnamed)'}${paintRe.test(m.name || '') ? '   <-- paint candidate' : ''}`));

console.log('\n-- node names (first 40) --');
nodes.slice(0, 40).forEach((n, i) => console.log(`  [${i}] ${n.name || '(unnamed)'}${wheelRe.test(n.name || '') ? '   <-- wheel candidate' : ''}`));
if (nodes.length > 40) console.log(`  ... ${nodes.length - 40} more`);

console.log('\n-- suggested models/manifest.json --');
console.log(JSON.stringify({
  file: path.split('/').pop(),
  faces,
  lengthMeters: 4.4,
  paintMaterials: paintMats.length ? paintMats : ['<pick from the material list above>'],
  wheelNodes: wheelNodes.length ? [...new Set(wheelNodes.map(n => n.replace(/[_\-\s]?(fl|fr|rl|rr|lf|rf|lr|rr|\d+)$/i, '')))] : ['Wheel'],
  applyTo: tris > 120000 ? 'player' : 'all',
}, null, 2));

if (tris > 120000) {
  console.log(`\nNote: ${tris.toLocaleString()} triangles per car x 12 cars would be ~${(tris * 12 / 1e6).toFixed(1)}M`);
  console.log('triangles a frame. "applyTo": "player" uses the model for your own car only');
  console.log('and keeps the light procedural bodies for the AI. Change to "all" if it runs fine.');
}
console.log();
