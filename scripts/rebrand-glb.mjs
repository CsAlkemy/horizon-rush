// Strip brand names out of a .glb's node names, in place.
//
//   node scripts/rebrand-glb.mjs models/ultimate_low-poly_car_pack.glb --check
//   node scripts/rebrand-glb.mjs models/ultimate_low-poly_car_pack.glb
//
// Why this exists: the bot car pack's own node names are the marques and model
// names of the real cars it copies (`Ferrari`, `Mercedes`, `Sterrato`, ...), and
// those strings ship inside the file. The CC-BY licence covers copyright in the
// meshes; it grants nothing on trade dress or trademarks. Renaming does not make
// the shapes unrecognisable — it just stops the asset from asserting a brand.
// See CREDITS.md and RELEASE_CHECKLIST.md.
//
// Only names change. Mesh/accessor data is untouched, and the part names the
// game matches on (Paint, Trim, Body, Window, Front, Rear, Tires, Rims) are
// generic and deliberately left alone.
//
// What is deliberately NOT stripped: `asset.extras`, which carries the CC-BY
// author/licence/title/source. That block names the donor car, but it is the
// attribution the licence obliges us to keep and CREDITS.md already states it
// publicly. Removing it would trade a trade-dress worry for a licence breach.
import fs from 'node:fs';

// Fictional single-word names, in the spirit of the player car's "Kestrel GT".
// No spaces: GLTFLoader rewrites spaces to underscores, so avoiding them keeps
// the in-file name and the loaded name identical.
const RENAMES = {
  'Zenvo': 'Vantor',        // angular hypercar
  'Sterrato': 'Dunecross',  // lifted rally supercar
  'Artura': 'Aerix',        // mid-engine coupe
  'Mercedes': 'Bastion',    // boxy 4x4
  'Ford': 'Halcyon',        // hot hatch
  'Ferrari': 'Vulpine',     // low hypercar
  'Land Rover': 'Warden',   // luxury SUV
  'volvo': 'kestrel',       // player car body + the four wheel nodes
};

// Material names, renamed separately: the player car's are the only ones that
// carry a marque, and they are matched by nothing in the game — the manifest
// sets "lampMaterials", which replaces the /light|lamp/ regex outright, so the
// misleading "lightsbase…" prefix on what are actually body panels is already
// inert. Renaming it off the brand also retires that footgun.
// NOTE: keep `models/manifest.json` in step with any node rename — it pins the
// four wheel nodes by name, and a mismatch silently stops the wheels spinning.
const MATERIAL_RENAMES = {
  'lightsbasekspolestarngr': 'bodypanel',
};

// Marques to scan for after renaming, so the script cannot report "clean" while
// a brand survives somewhere it does not rewrite.
const BRAND_WORDS = ['volvo', 'polestar', 'ferrari', 'mercedes', 'zenvo', 'artura', 'sterrato', 'land rover'];

const path = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!path) {
  console.error('usage: node scripts/rebrand-glb.mjs <file.glb> [--check]');
  process.exit(1);
}

const buf = fs.readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error('not a GLB file (bad magic)');
  process.exit(1);
}

// GLB: 12-byte header, then chunks of [uint32 length][uint32 type][padded data].
const chunks = [];
let off = 12;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const jsonChunk = chunks.find(c => c.type === 0x4e4f534a);
if (!jsonChunk) { console.error('no JSON chunk'); process.exit(1); }
const json = JSON.parse(jsonChunk.data.toString('utf8'));

// Rename one name-bearing table against one map. Longest key first, so
// "Land Rover" is not half-matched by a shorter key.
function renameTable(items, map) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const hits = [];
  for (const item of items || []) {
    const name = item.name;
    if (!name) continue;
    const key = keys.find(k => name === k || name.startsWith(k + '.') || name.startsWith(k + '_'));
    if (!key) continue;
    const renamed = map[key] + name.slice(key.length);   // keep any ".001" suffix
    hits.push({ from: name, to: renamed });
    if (!checkOnly) item.name = renamed;
  }
  return hits;
}

const nodeHits = renameTable(json.nodes, RENAMES);
const matHits = renameTable(json.materials, MATERIAL_RENAMES);
const hits = [...nodeHits, ...matHits];

// Anything still naming a brand anywhere? Scan every name-bearing table against
// the full marque list, so a rename never reports "clean" while a brand hides
// in a table this script does not rewrite. asset.extras is exempt on purpose —
// see the header note: that is the CC-BY attribution and it has to stay.
const leftovers = [];
const hasBrand = (s) => BRAND_WORDS.some(w => (s || '').toLowerCase().includes(w));
for (const table of ['nodes', 'meshes', 'materials', 'images', 'textures', 'animations', 'skins']) {
  for (const item of json[table] || []) {
    if (hasBrand(item.name)) leftovers.push(`${table}: ${item.name}`);
  }
}
if (hasBrand(json.asset?.generator)) leftovers.push(`asset.generator: ${json.asset.generator}`);

for (const h of nodeHits) console.log(`  node      ${h.from.padEnd(28)} -> ${h.to}`);
for (const h of matHits) console.log(`  material  ${h.from.padEnd(28)} -> ${h.to}`);
console.log(`${nodeHits.length} node + ${matHits.length} material name(s) ${checkOnly ? 'would be' : ''} renamed`);
if (leftovers.length) {
  console.log(`\nBrand strings ${checkOnly ? 'present' : 'REMAIN'} outside the rename maps — handle these too:`);
  for (const l of leftovers) console.log('  ' + l);
} else {
  console.log('No brand strings left in any name table.');
}

if (checkOnly || !hits.length) process.exit(0);

// Re-emit. The JSON chunk must be padded with spaces and the BIN chunk with
// zeroes, each to a 4-byte boundary, and the header's total length rewritten.
const pad = (b, filler) => {
  const extra = (4 - (b.length % 4)) % 4;
  return extra ? Buffer.concat([b, Buffer.alloc(extra, filler)]) : b;
};
const out = [];
for (const c of chunks) {
  const data = c.type === 0x4e4f534a
    ? pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
    : pad(Buffer.from(c.data), 0x00);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(c.type, 4);
  out.push(head, data);
}
const body = Buffer.concat(out);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + body.length, 8);

fs.writeFileSync(path, Buffer.concat([header, body]));
console.log(`\nwrote ${path} (${(12 + body.length).toLocaleString()} bytes)`);
