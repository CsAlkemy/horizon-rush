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

// Returns { scene, cfg } ready to clone, or null when no model is configured.
export async function loadCarTemplate() {
  let cfg;
  try {
    // Timeout so a stalled request can never hold up game boot.
    const res = await fetch('/models/manifest.json', {
      cache: 'no-cache',
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    cfg = await res.json();
  } catch {
    return null; // no manifest -> procedural cars
  }
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
    console.info(`[horizon-rush] loaded car model ${cfg.file} (scale ${scale.toFixed(3)})`);
    return { scene: wrapper, cfg };
  } catch (e) {
    console.warn('[horizon-rush] car model failed to load, using procedural body:', e.message);
    return null;
  }
}

// Clone the template for one car, tint its paint, and collect spinnable wheels.
export function instantiateTemplate(template, colorHex) {
  const cfg = template.cfg;
  const group = template.scene.clone(true);
  const paintNames = (cfg.paintMaterials || []).map(s => s.toLowerCase());
  const wheelNames = (cfg.wheelNodes || ['wheel', 'tyre', 'tire', 'rim']).map(s => s.toLowerCase());

  const wheels = [];
  const headMats = [], tailMats = [];
  // Front and rear lamps often share one material name (this model calls both
  // "EXT_Lights"), so which end a lamp is on has to come from geometry, not the
  // name. The model is oriented nose-to-+Z by now, so z < 0 is the tail.
  // "tail" must be a whole word: plenty of models have "Details" materials, and
  // matching the substring turns random body trim into brake lights.
  const lampRe = /light|lamp|(^|[_\-\s])(tail|stop)/i;
  const lampBox = new THREE.Box3();
  // Every material named in paintMaterials is collected, not just the last one
  // found: this model paints the shell with "material_1" AND "EXT_Car_Paint", so
  // recolouring only one leaves half the car in the old colour.
  const paintMats = [];
  let biggest = null, biggestVol = 0;
  const dropMats = (cfg.excludeMaterials || []).map(s => s.toLowerCase());
  const dropped = [];

  group.traverse((o) => {
    const nameL = (o.name || '').toLowerCase();
    if (o.isMesh) {
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
        if (lampRe.test(mn)) {
          m.emissive = m.emissive || new THREE.Color(0x000000);
          lampBox.setFromObject(o);
          const atRear = isFinite(lampBox.max.z) && lampBox.getCenter(new THREE.Vector3()).z < 0;
          (atRear ? tailMats : headMats).push(m);
        }
        if (paintNames.length && paintNames.some(p => mn.includes(p))) {
          m.color.set(colorHex);
          if (m.isMeshPhysicalMaterial) { m.clearcoat = 1; m.clearcoatRoughness = 0.08; }
          if (!paintMats.includes(m)) paintMats.push(m);
        }
      }
      o.geometry.computeBoundingBox();
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

  // No named paint material: tint the largest mesh so cars are still telling apart.
  if (!paintMats.length && biggest) {
    const m = Array.isArray(biggest.material) ? biggest.material[0] : biggest.material;
    m.color.set(colorHex);
    paintMats.push(m);
  }
  if (!paintMats.length) paintMats.push(new THREE.MeshStandardMaterial({ color: colorHex }));

  return { group, wheels: topWheels, paint: paintMats[0], paintMats, headMats, tailMats };
}
