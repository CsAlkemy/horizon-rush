// Optional glTF/GLB car models.
//
// Drop a .glb into horizon-rush/models/ and describe it in models/manifest.json
// to replace the built-in procedural car. With no manifest present the game
// silently uses the procedural body, so this is entirely opt-in.
//
// manifest.json:
// {
//   "file": "car.glb",
//   "faces": "+z",          // which way the model's nose points: +z | -z | +x | -x
//   "lengthMeters": 4.4,    // model is uniformly scaled to this bumper-to-bumper length
//   "paintMaterials": ["Body", "Paint"],   // material names to tint per player (optional)
//   "wheelNodes": ["Wheel", "Tyre"]        // node-name substrings that should spin (optional)
// }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_ROT = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };

// Scenery model (e.g. models/tree.glb). Returns the loaded scene or null.
export async function loadSceneryModel(file) {
  try {
    const head = await fetch('/models/' + file, { method: 'HEAD' });
    if (!head.ok) return null;
  } catch {
    return null;
  }
  try {
    const gltf = await new GLTFLoader().loadAsync('/models/' + file);
    return gltf.scene;
  } catch (e) {
    console.warn(`[horizon-rush] ${file} failed to load:`, e.message);
    return null;
  }
}

// ---------------------------------------------------------------- livery recolor
// A model whose body colour lives in a baked livery texture (teal panels, black
// stripes, logos) cannot be tinted with material.color — multiplying a player
// colour into the texture just muddies it (teal × red = near-black). Instead the
// texture itself is recoloured per car: pixels near the livery's dominant hue
// are replaced with the player colour scaled by the pixel's original luminance,
// so the baked shading survives, the result reads as solid paint, and black
// stripes / white logos / greys are left untouched.
function buildLiveryCache(tex) {
  const img = tex.image;
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h);
  const px = src.data;

  // Dominant hue among saturated pixels — the livery colour. Weighted by
  // chroma so grey/dark pixels don't vote.
  const hist = new Float32Array(360);
  const hueOf = (r, g, b, mx, c) => {
    let hue;
    if (mx === r) hue = ((g - b) / c) % 6;
    else if (mx === g) hue = (b - r) / c + 2;
    else hue = (r - g) / c + 4;
    return ((hue * 60) + 360) % 360;
  };
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
    if (mx < 0.1 || c / mx < 0.3) continue;
    hist[hueOf(r, g, b, mx, c) | 0] += c;
  }
  let hue = 0, best = -1;
  for (let hh = 0; hh < 360; hh++) {
    let s = 0;
    for (let d = -12; d <= 12; d++) s += hist[(hh + d + 360) % 360];
    if (s > best) { best = s; hue = hh; }
  }

  // Mask: 0 = leave alone, 1..255 = recolour, value encodes the pixel's
  // original luminance so shading can be reapplied under the new colour.
  const mask = new Uint8Array(w * h);
  let lumSum = 0, lumN = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
    if (mx < 0.06 || c / mx < 0.22) continue;
    let dh = Math.abs(hueOf(r, g, b, mx, c) - hue);
    if (dh > 180) dh = 360 - dh;
    if (dh > 45) continue;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    mask[p] = Math.max(1, Math.min(255, Math.round(lum * 255)));
    lumSum += lum; lumN++;
  }
  const lumBase = lumN ? lumSum / lumN : 0.5;
  console.info(`[horizon-rush] livery: hue ${hue}°, ${lumN} px of ${w}x${h} recolourable`);
  return { w, h, src, mask, lumBase };
}

// One canvas texture per car, redrawn in place on repaint (menu colour picker).
function makeLiveryTexture(cache, srcTex) {
  const cv = document.createElement('canvas');
  cv.width = cache.w; cv.height = cache.h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(cache.w, cache.h);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = srcTex.flipY;
  tex.wrapS = srcTex.wrapS; tex.wrapT = srcTex.wrapT;
  tex.colorSpace = srcTex.colorSpace;
  if (srcTex.channel !== undefined) tex.channel = srcTex.channel;
  tex.repeat.copy(srcTex.repeat); tex.offset.copy(srcTex.offset);
  tex.rotation = srcTex.rotation;

  const repaint = (colorHex) => {
    const cr = (colorHex >> 16) & 255, cg = (colorHex >> 8) & 255, cb = colorHex & 255;
    const s = cache.src.data, d = out.data, mask = cache.mask, base = cache.lumBase * 255;
    d.set(s);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      const m = mask[p];
      if (!m) continue;
      const k = m / base;
      d[i] = Math.min(255, cr * k);
      d[i + 1] = Math.min(255, cg * k);
      d[i + 2] = Math.min(255, cb * k);
    }
    ctx.putImageData(out, 0, 0);
    tex.needsUpdate = true;
  };
  return { tex, repaint };
}

// Timeout so a stalled request can never hold up game boot. Returns null when
// there is no manifest at all, which is the "use procedural cars" signal.
async function readManifest() {
  try {
    const res = await fetch('/models/manifest.json', {
      cache: 'no-cache',
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Returns { scene, cfg } ready to clone, or null when no model is configured.
export async function loadCarTemplate() {
  const cfg = await readManifest();
  if (!cfg || !cfg.file) return null;

  try {
    const gltf = await new GLTFLoader().loadAsync('/models/' + cfg.file);
    const root = gltf.scene;

    // Orient so the nose points +Z, then scale to the requested length and
    // seat the wheels on y=0.
    const yaw = DEFAULT_ROT[cfg.faces] ?? 0;
    root.rotation.y = yaw;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const targetLen = cfg.lengthMeters || 4.4;
    const scale = size.z > 0.001 ? targetLen / size.z : 1;

    const wrapper = new THREE.Group();
    wrapper.add(root);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(root);
    const c = box2.getCenter(new THREE.Vector3());
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= box2.min.y;   // wheels touch the ground plane

    wrapper.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    if (cfg.steeringWheel) extractSteeringWheel(wrapper, cfg.steeringWheel);
    console.info(`[horizon-rush] loaded car model ${cfg.file} (scale ${scale.toFixed(3)})`);
    return { scene: wrapper, cfg };
  } catch (e) {
    console.warn('[horizon-rush] car model failed to load, using procedural body:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------- car packs
// A pack .glb holds several complete cars parked side by side under one
// container node (Sketchfab exports them as children of "RootNode"). Each is
// pulled out into its own standalone template so the bot grid can field a
// different car per driver, and every car is scaled to the same length so the
// shared collision box still fits.
//
// manifest.json "bots":
// {
//   "file": "pack.glb",
//   "container": "RootNode",     // node whose children are the cars
//   "faces": "-z",
//   "lengthMeters": 4.8,
//   "paintNodes": ["Paint"],     // node-name prefixes to tint per driver
//   "splitWheelNodes": ["Tires", "Rims"],   // merged 4-wheel meshes to cut apart
//   "skip": ["Bus"]              // container children that are not cars
// }
export async function loadCarPack() {
  const root = await readManifest();
  const cfg = root && root.bots;
  if (!cfg || !cfg.file) return [];

  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync('/models/' + cfg.file);
  } catch (e) {
    console.warn('[horizon-rush] bot car pack failed to load:', e.message);
    return [];
  }

  const container = cfg.container
    ? gltf.scene.getObjectByName(cfg.container)
    : gltf.scene;
  if (!container || !container.children.length) {
    console.warn(`[horizon-rush] bot pack container "${cfg.container}" not found`);
    return [];
  }
  gltf.scene.updateMatrixWorld(true);

  // Packs habitually ship each car twice ("Zenvo" and "Zenvo.001"). GLTFLoader
  // strips the dot when it sanitizes names, so the duplicate suffix to fold
  // away is bare trailing digits, not ".001".
  const skip = (cfg.skip || []).map(s => s.toLowerCase());
  const seen = new Set();
  const picks = container.children.filter((c) => {
    const base = (c.name || '').replace(/\d+$/, '');
    if (!base || seen.has(base)) return false;
    if (skip.some(s => base.toLowerCase().includes(s))) return false;
    seen.add(base);
    return true;
  });

  const yaw = DEFAULT_ROT[cfg.faces] ?? 0;
  const targetLen = cfg.lengthMeters || 4.4;
  const templates = [];

  for (const car of picks) {
    // The car sits under the pack's container (Sketchfab adds a -90deg X root,
    // and FBX imports often carry a large scale), so cloning the node alone
    // would drop all of that. Bake its world matrix into the clone instead.
    const inner = car.clone(true);
    inner.matrix.copy(car.matrixWorld);
    inner.matrix.decompose(inner.position, inner.quaternion, inner.scale);

    // `fit` carries the orientation/scale/centring so the baked TRS on `inner`
    // survives untouched.
    const wrapper = new THREE.Group();
    const fit = new THREE.Group();
    fit.rotation.y = yaw;
    fit.add(inner);
    wrapper.add(fit);

    wrapper.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
    fit.scale.setScalar(size.z > 0.001 ? targetLen / size.z : 1);

    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    fit.position.x -= c.x;
    fit.position.z -= c.z;
    fit.position.y -= box.min.y;      // wheels touch the ground plane

    const cut = splitMergedWheels(wrapper, cfg.splitWheelNodes || []);
    wrapper.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

    templates.push({
      scene: wrapper,
      name: car.name,
      // Wheel rigs come from the corner groups the split just made; if nothing
      // was split, fall back to whatever the manifest named.
      cfg: { ...cfg, wheelNodes: cut ? [WHEEL_PREFIX] : (cfg.wheelNodes || []) },
    });
  }

  console.info(`[horizon-rush] bot car pack ${cfg.file}: ` +
    `${templates.length} cars (${templates.map(t => t.name).join(', ')})`);
  return templates;
}

const WHEEL_PREFIX = 'hrwheel_';

// Packs merge all four wheels into one mesh, so spinning that node swings the
// whole set around the car's centre. Cut such a mesh into its four corners by
// triangle position and wrap each in a group seated on that corner's axle — the
// normal rig code in instantiateTemplate then treats them as ordinary wheels.
// Index surgery only: the corners share the source's vertex buffers.
function splitMergedWheels(wrapper, nodeNames) {
  if (!nodeNames.length) return 0;
  const want = nodeNames.map(s => s.toLowerCase());
  wrapper.updateMatrixWorld(true);

  const targets = [];
  wrapper.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) {
      const n = (p.name || '').toLowerCase();
      if (want.some(s => n.startsWith(s))) { targets.push(o); return; }
    }
  });

  let made = 0;
  const v = new THREE.Vector3();
  const cen = new THREE.Vector3();
  for (const mesh of targets) {
    const geo = mesh.geometry;
    const pa = geo.attributes.position;
    if (!pa) continue;
    const idx = geo.index ? geo.index.array : null;
    const triCount = Math.floor((idx ? idx.length : pa.count) / 3);

    // Quadrant per triangle, from its centroid in car space (nose +Z, so
    // z > 0 is the front axle and x > 0 the right-hand side). Both a world-space
    // box (to place the hub) and a geometry-space box (to bound the corner) are
    // accumulated as we go.
    const groups = new Map();
    const raw = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const tri = [0, 0, 0];
      for (let k = 0; k < 3; k++) tri[k] = idx ? idx[t * 3 + k] : t * 3 + k;
      cen.set(0, 0, 0);
      for (const vi of tri) cen.add(v.fromBufferAttribute(pa, vi).applyMatrix4(mesh.matrixWorld));
      cen.divideScalar(3);
      const key = (cen.z >= 0 ? 'F' : 'B') + (cen.x >= 0 ? 'R' : 'L');
      let g = groups.get(key);
      if (!g) groups.set(key, g = { index: [], box: new THREE.Box3(), local: new THREE.Box3() });
      g.index.push(tri[0], tri[1], tri[2]);
      for (const vi of tri) {
        raw.fromBufferAttribute(pa, vi);
        g.local.expandByPoint(raw);
        g.box.expandByPoint(v.copy(raw).applyMatrix4(mesh.matrixWorld));
      }
    }
    // One quadrant means this was a single wheel (or not a wheel at all) — leave it.
    if (groups.size < 2) continue;

    const parent = mesh.parent;
    for (const [key, g] of groups) {
      // Seat the group on the corner's axle centre. The wheel's bounding-box
      // centre IS the axle, and rotating about anything else makes it orbit.
      const worldC = g.box.getCenter(new THREE.Vector3());
      const localC = parent.worldToLocal(worldC.clone());

      const hub = new THREE.Group();
      hub.name = WHEEL_PREFIX + key;
      hub.position.copy(localC);

      const cornerGeo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) cornerGeo.setAttribute(name, attr);
      cornerGeo.setIndex(g.index);
      // The corners share the source's vertex buffers, so computeBounding*()
      // would measure all four wheels — it ignores the index. Set the bounds
      // from this corner's own vertices instead, or culling and the wheel-radius
      // estimate in instantiateTemplate both see a wheel the size of the axle set.
      cornerGeo.boundingBox = g.local.clone();
      cornerGeo.boundingSphere = g.local.getBoundingSphere(new THREE.Sphere());

      const m = new THREE.Mesh(cornerGeo, mesh.material);
      // Keep the source's own local transform, minus the hub offset, so the
      // corner renders exactly where it did before the cut.
      m.position.copy(mesh.position).sub(localC);
      m.quaternion.copy(mesh.quaternion);
      m.scale.copy(mesh.scale);
      hub.add(m);
      parent.add(hub);
      made++;
    }
    mesh.removeFromParent();
  }
  return made;
}

// ---------------------------------------------------------------- steering wheel
// Many exports merge the steering wheel into one big interior mesh, so there is
// no node to rotate. Manifest "steeringWheel" names a small marker mesh that
// sits on the wheel face (a badge / stitching decal): its vertices give the
// wheel's centre and, via the plane of least spread, the column axis. Every
// triangle of every mesh that falls inside a shallow cylinder around that
// centre is then carved out into a pivot group the animator can turn. Index
// surgery only — the carved mesh shares the source's vertex buffers.
//   "steeringWheel": { "marker": "<node>", "axis": [x,y,z], "center": [x,y,z],
//                      "radius": m, "depth": m, "maxTurn": rad }
function extractSteeringWheel(wrapper, sw) {
  const marker = wrapper.getObjectByName(sw.marker);
  if (!marker || !marker.isMesh) {
    console.warn(`[horizon-rush] steeringWheel marker "${sw.marker}" not found`);
    return;
  }
  wrapper.updateMatrixWorld(true);

  // Wheel centre from the marker's vertex centroid. The column axis comes from
  // the manifest ("axis", car space, nose +Z) — deriving it from the marker's
  // shape is tempting but fails when the decal geometry isn't a flat disc, and
  // a wrong axis makes the wheel swing like a door.
  const pos = marker.geometry.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) c.add(v.fromBufferAttribute(pos, i).applyMatrix4(marker.matrixWorld));
  c.divideScalar(pos.count);
  // Decal outliers (stitching that runs onto the dash) can drag the centroid
  // off the hub, and a centre that is off along the column swallows console
  // trim into the carve — "center" pins it exactly (car space, metres).
  if (sw.center) c.fromArray(sw.center);
  const axis = new THREE.Vector3().fromArray(sw.axis || [0, 0.38, -0.92]).normalize();
  // Point it at the driver (up and rearward) so the turn direction is stable.
  if (axis.dot(new THREE.Vector3(0, 0.4, -0.9)) < 0) axis.negate();

  const pivot = new THREE.Group();
  pivot.name = '__steerWheel';
  pivot.position.copy(c);
  pivot.userData.axis = [axis.x, axis.y, axis.z];
  pivot.userData.maxTurn = sw.maxTurn ?? 2.2;
  wrapper.add(pivot);
  wrapper.updateMatrixWorld(true);

  const radius = sw.radius ?? 0.34, depth = sw.depth ?? 0.1;
  const d = new THREE.Vector3();
  const inside = (p) => {
    d.copy(p).sub(c);
    const a = d.dot(axis);
    if (Math.abs(a) > depth) return false;
    return d.addScaledVector(axis, -a).lengthSq() <= radius * radius;
  };

  const meshes = [];
  wrapper.traverse((o) => { if (o.isMesh) meshes.push(o); });
  let carved = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pa = geo.attributes.position;
    const idx = geo.index ? geo.index.array : null;
    const triCount = (idx ? idx.length : pa.count) / 3;
    // Memoized per-vertex test: 0 unknown, 1 inside, 2 outside.
    const state = new Uint8Array(pa.count);
    const axial = new Float32Array(pa.count);
    const cand = [];        // candidate triangle ids
    for (let t = 0; t < triCount; t++) {
      let allIn = true;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx[t * 3 + k] : t * 3 + k;
        let s = state[vi];
        if (!s) {
          v.fromBufferAttribute(pa, vi).applyMatrix4(mesh.matrixWorld);
          s = inside(v) ? 1 : 2;
          state[vi] = s;
          axial[vi] = d.copy(v).sub(c).dot(axis);
        }
        if (s === 2) allIn = false;
      }
      if (allIn) cand.push(t);
    }
    if (!cand.length) continue;

    // Not everything inside the cylinder is wheel: an instrument-cluster hood,
    // a column stalk or a console knob can dip into the same volume, and
    // carving those makes interior fragments orbit the wheel. So candidate
    // triangles are grouped into vertex-connected components and a component is
    // only carved if it looks like part of the wheel:
    //   - it must not protrude far in front of the wheel plane (rim, spokes
    //     and pad all hug the plane or dish toward the driver), AND
    //   - it must either reach the hub (spokes, pad, badge) or sweep a wide
    //     arc around the axis (the rim ring). A stalk or knob does neither.
    const comp = new Map();   // vertex id -> component root
    const find = (a) => { let r = a; while (comp.get(r) !== r) r = comp.get(r); comp.set(a, r); return r; };
    for (const t of cand) {
      let root = null;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx[t * 3 + k] : t * 3 + k;
        if (!comp.has(vi)) comp.set(vi, vi);
        const r = find(vi);
        if (root === null) root = r;
        else if (r !== root) comp.set(r, root);
      }
    }
    // Per-component stats: forward protrusion, closest approach to the hub,
    // and azimuth coverage around the axis (36 buckets of 10°).
    const u = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u);
    const stats = new Map();
    for (const [vi] of comp) {
      const r = find(vi);
      let s = stats.get(r);
      if (!s) stats.set(r, s = { minAxial: Infinity, minRadial: Infinity, buckets: new Set() });
      s.minAxial = Math.min(s.minAxial, axial[vi]);
      v.fromBufferAttribute(pa, vi).applyMatrix4(mesh.matrixWorld);
      d.copy(v).sub(c).addScaledVector(axis, -axial[vi]);
      s.minRadial = Math.min(s.minRadial, d.length());
      s.buckets.add((Math.floor((Math.atan2(d.dot(w), d.dot(u)) + Math.PI) / (Math.PI / 18)) + 36) % 36);
    }
    // A component is wheel when it hugs the plane AND either comes near the
    // hub (pad, spokes, buttons — all within ~0.2 of the axis) or sweeps a
    // wide ring arc (rim and its trim). The measured junk — gear knob, stalk
    // tips, cluster-hood lips — orbits at rim radius over a narrow arc, or
    // protrudes forward, and fails both.
    const isWheel = (root) => {
      const s = stats.get(root);
      return s.minAxial >= -0.07 && (s.minRadial <= 0.21 || s.buckets.size >= 9);
    };
    const keep = [], take = [];
    let next = 0;
    for (let t = 0; t < triCount; t++) {
      const vi0 = idx ? idx[t * 3] : t * 3;
      const isTake = t === cand[next] && isWheel(find(vi0));
      if (t === cand[next]) next++;
      const dst = isTake ? take : keep;
      for (let k = 0; k < 3; k++) dst.push(idx ? idx[t * 3 + k] : t * 3 + k);
    }
    if (!take.length) continue;
    geo.setIndex(keep);
    geo.computeBoundingSphere();
    const carvedGeo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) carvedGeo.setAttribute(name, attr);
    carvedGeo.setIndex(take);
    carvedGeo.computeBoundingSphere();
    const m2 = new THREE.Mesh(carvedGeo, mesh.material);
    m2.castShadow = mesh.castShadow;
    m2.position.copy(mesh.position); m2.quaternion.copy(mesh.quaternion); m2.scale.copy(mesh.scale);
    mesh.parent.add(m2);
    pivot.attach(m2);
    carved += take.length / 3;
  }
  // The marker centroid that seeded the carve is only approximately the hub,
  // and rotating about an off-centre point makes the wheel orbit instead of
  // spin. The carved rim itself gives the exact centre: take the outermost
  // ring of carved vertices and re-seat the pivot on their centroid (children
  // are shifted the opposite way, so nothing moves visually).
  wrapper.updateMatrixWorld(true);
  const pts = [];
  for (const m2 of pivot.children) {
    const pa = m2.geometry.attributes.position;
    for (const vi of m2.geometry.index.array) pts.push(v.fromBufferAttribute(pa, vi).applyMatrix4(m2.matrixWorld).clone());
  }
  if (pts.length) {
    // The rim is the outermost geometry in every in-plane direction, so the
    // midpoint of the carved points' in-plane extents IS the hub — immune to
    // the dense spoke tessellation that skews any centroid-based estimate.
    const u = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u);
    let minU = Infinity, maxU = -Infinity, minW = Infinity, maxW = -Infinity;
    for (const p of pts) {
      d.copy(p).sub(c);
      const pu = d.dot(u), pw = d.dot(w);
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
      minW = Math.min(minW, pw); maxW = Math.max(maxW, pw);
    }
    const c2 = c.clone()
      .addScaledVector(u, (minU + maxU) / 2)
      .addScaledVector(w, (minW + maxW) / 2);
    const delta = c2.clone().sub(pivot.position);
    pivot.position.copy(c2);
    for (const ch of pivot.children) ch.position.sub(delta);
  }
  console.info(`[horizon-rush] steering wheel: carved ${carved} tris, hub at ` +
    `${pivot.position.toArray().map(n => n.toFixed(3))}`);
}

// Clone the template for one car, tint its paint, and collect spinnable wheels.
export function instantiateTemplate(template, colorHex) {
  const cfg = template.cfg;
  const group = template.scene.clone(true);
  const paintNames = (cfg.paintMaterials || []).map(s => s.toLowerCase());
  // Packs often reuse one material across body, trim and tyres (this one paints
  // all three with a single black), so material names cannot say what is
  // paintwork. "paintNodes" selects by node instead: any mesh under a node whose
  // name starts with one of these is bodywork and takes the driver's colour.
  const paintNodeNames = (cfg.paintNodes || []).map(s => s.toLowerCase());
  // Same problem for lamps: a pack's light materials are called "Material.003",
  // so "lampNodes" names the light nodes instead. Front/rear is still decided by
  // where the mesh sits, not by which name matched.
  const lampNodeNames = (cfg.lampNodes || []).map(s => s.toLowerCase());
  const underNode = (o, names) => {
    if (!names.length) return false;
    for (let p = o; p; p = p.parent) {
      const n = (p.name || '').toLowerCase();
      if (names.some(s => n.startsWith(s))) return true;
    }
    return false;
  };
  const wheelNames = (cfg.wheelNodes || ['wheel', 'tyre', 'tire', 'rim']).map(s => s.toLowerCase());

  const wheels = [];
  const headMats = [], tailMats = [];
  // Front and rear lamps often share one material name (this model calls both
  // "EXT_Lights"), so which end a lamp is on has to come from geometry, not the
  // name. The model is oriented nose-to-+Z by now, so z < 0 is the tail.
  // "tail" must be a whole word: plenty of models have "Details" materials, and
  // matching the substring turns random body trim into brake lights.
  const lampRe = /light|lamp|(^|[_\-\s])(tail|stop)/i;
  // The regex can still be fooled — this model names whole body-panel materials
  // "lightsbase…", which would put brake-light glow on the fenders. A manifest
  // can list "lampMaterials" substrings to replace the regex outright.
  const lampNames = (cfg.lampMaterials || []).map(s => s.toLowerCase());
  const isLamp = (mn) => lampNames.length ? lampNames.some(n => mn.includes(n)) : lampRe.test(mn);
  const lampBox = new THREE.Box3();
  // Every material named in paintMaterials is collected, not just the last one
  // found: some models paint the shell across several of them, and recolouring
  // only one leaves half the car in the old colour.
  const paintMats = [];
  // Some models (this one) share their paint material with the cockpit trim, so
  // a full-strength tint turns the whole dashboard the player's colour. The
  // manifest can darken the applied tint: exterior accents stay identifiable
  // while the interior reads as colour-matched trim rather than a paint bomb.
  const paintShade = cfg.paintShade ?? 1;
  const applyPaint = (m) => {
    m.color.set(colorHex);
    if (paintShade < 1) m.color.multiplyScalar(paintShade);
  };
  const liveryMats = [];
  let biggest = null, biggestVol = 0;
  const dropMats = (cfg.excludeMaterials || []).map(s => s.toLowerCase());
  const dropped = [];

  group.traverse((o) => {
    const nameL = (o.name || '').toLowerCase();
    if (o.isMesh) {
      const isPaintNode = underNode(o, paintNodeNames);
      const isLampNode = underNode(o, lampNodeNames);
      // Optionally cull whole material groups (e.g. a full interior that is
      // never visible from the chase camera) to save triangles.
      if (dropMats.length) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const mn = mats.map(m => (m?.name || '').toLowerCase());
        if (mn.some(n => n && dropMats.some(d => n.includes(d)))) { dropped.push(o); return; }
      }
      // Clone materials so per-car tinting does not leak between cars.
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const mn = (m.name || '').toLowerCase();
        // Collect lamp materials so headlights and brake lights can be driven,
        // splitting them front/rear by where the mesh actually sits.
        if (isLampNode || isLamp(mn)) {
          m.emissive = m.emissive || new THREE.Color(0x000000);
          lampBox.setFromObject(o);
          const atRear = isFinite(lampBox.max.z) && lampBox.getCenter(new THREE.Vector3()).z < 0;
          (atRear ? tailMats : headMats).push(m);
        }
        if (isPaintNode || (paintNames.length && paintNames.some(p => mn.includes(p)))) {
          // Textured paint (a baked livery) is recoloured in texture space
          // below; only plain materials take a direct colour tint.
          if (m.map) {
            liveryMats.push(m);
          } else {
            applyPaint(m);
            if (!paintMats.includes(m)) paintMats.push(m);
          }
          if (m.isMeshPhysicalMaterial) { m.clearcoat = 1; m.clearcoatRoughness = 0.08; }
        }
      }
      // Never recompute a box that already exists. GLTFLoader sets one from the
      // accessor min/max, and geometry carved by index surgery (split wheels, the
      // steering wheel) sets its own — computeBoundingBox() ignores the index and
      // would measure the whole shared vertex buffer, so recomputing turns a
      // single wheel back into the full axle set.
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
      const vol = s.x * s.y * s.z;
      if (vol > biggestVol) { biggestVol = vol; biggest = o; }
    }
    if (wheelNames.some(w => nameL.includes(w))) wheels.push(o);
  });

  for (const m of dropped) m.removeFromParent();

  // Keep only the outermost matching node per wheel. Rig names nest (WHEEL_LR
  // contains WHEEL_LR_EXT_Tyre_0), and spinning both parent and child would
  // double the rotation and tumble the child on its own axis.
  const topWheels = wheels.filter((w) => {
    for (let p = w.parent; p; p = p.parent) if (wheels.includes(p)) return false;
    return true;
  });

  // Wheel rigs: wrap every wheel node in steer -> spin groups so the wheels
  // visibly steer with input and roll with speed. Rotating the source nodes
  // directly doesn't work in general — exporters nest the model under
  // re-orientation nodes (Sketchfab adds a -90° X root), so a node's local X
  // is not the axle. Instead the car-space axle (+X) and steering axis (+Y)
  // are transformed into each wheel's own frame once, here, and animateCar
  // sets plain axis-angle quaternions on the identity wrapper groups.
  group.updateMatrixWorld(true);
  const rigs = [];
  const invM = new THREE.Matrix4();
  for (const w of topWheels) {
    const parent = w.parent;
    const pivot = new THREE.Group();     // takes over the node's local TRS
    const steer = new THREE.Group();     // identity; yawed by animateCar (front only)
    const spin = new THREE.Group();      // identity; rolled by animateCar
    pivot.position.copy(w.position);
    pivot.quaternion.copy(w.quaternion);
    pivot.scale.copy(w.scale);
    w.position.set(0, 0, 0);
    w.quaternion.identity();
    w.scale.set(1, 1, 1);
    parent.add(pivot);
    pivot.add(steer);
    steer.add(spin);
    spin.add(w);

    group.updateMatrixWorld(true);
    invM.copy(pivot.matrixWorld).invert();
    const axle = new THREE.Vector3(1, 0, 0).transformDirection(invM);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(invM);
    const pos = new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld);
    const box = new THREE.Box3().setFromObject(w);
    const radius = Math.max(0.12, (box.max.y - box.min.y) / 2 || 0.34);
    rigs.push({
      spinObj: spin,
      steerObj: pos.z > 0 ? steer : null,   // nose is +Z, so z > 0 = front axle
      axle, up, radius,
    });
  }

  // Baked-livery paint: one recoloured texture per car, shared by every mesh
  // that wears the livery. retint() redraws it in place for menu repaints.
  let retint = null;
  if (liveryMats.length) {
    template.liveryCache ??= buildLiveryCache(liveryMats[0].map);
    const { tex, repaint } = makeLiveryTexture(template.liveryCache, liveryMats[0].map);
    for (const m of liveryMats) { m.map = tex; m.needsUpdate = true; }
    repaint(colorHex);
    retint = repaint;
  }

  // No named paint material: tint the largest mesh so cars are still telling apart.
  if (!paintMats.length && !retint && biggest) {
    const m = Array.isArray(biggest.material) ? biggest.material[0] : biggest.material;
    applyPaint(m);
    paintMats.push(m);
  }
  if (!paintMats.length && !retint) paintMats.push(new THREE.MeshStandardMaterial({ color: colorHex }));

  const swObj = group.getObjectByName('__steerWheel');
  const steerWheel = swObj ? {
    obj: swObj,
    axis: new THREE.Vector3().fromArray(swObj.userData.axis),
    maxTurn: swObj.userData.maxTurn,
  } : null;

  return { group, rigs, paint: paintMats[0] || null, paintMats, headMats, tailMats, paintShade, retint, steerWheel };
}
