// Car mesh factory — smooth rounded shapes + clearcoat paint so cars read
// glossy under the environment map, showroom-style. Nose faces +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { instantiateTemplate } from './carModels.js';
import { CAR } from '/shared/physics.js';

// Set once at boot by main.js when models/manifest.json is present.
let template = null;
export function setCarTemplate(t) { template = t; }
export function carTemplateConfig() { return template ? template.cfg : null; }

// Bot cars come from a separate multi-car pack (manifest "bots"), so an AI grid
// shows a field of different cars instead of twelve copies of the player's.
let botPack = [];
let botTurn = 0;
export function setCarPack(list) { botPack = list || []; botTurn = 0; }
export function botPackSize() { return botPack.length; }

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c1118, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4,
});
const blackMat = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.4, roughness: 0.55 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec8, metalness: 0.95, roughness: 0.25 });
const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 26);
tireGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.28, 18);
rimGeo.rotateZ(Math.PI / 2);
const headGeo = new THREE.BoxGeometry(0.34, 0.1, 0.06);
const tailGeo = new THREE.BoxGeometry(0.42, 0.09, 0.06);

// Soft dark patch sitting just above the road under every car. The sun's shadow
// map alone leaves cars looking pasted on at chase-cam distance; an explicit
// contact patch guarantees they read as touching the ground.
let contactTex = null;
function contactShadowTexture() {
  if (contactTex) return contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  contactTex = new THREE.CanvasTexture(c);
  return contactTex;
}

function makeContactShadow(length = 4.4, width = 2.0) {
  // Wider than the car so it is visible past the bodywork from behind.
  const geo = new THREE.PlaneGeometry(width * 1.7, length * 1.3);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.02;         // group already sits at road height
  m.renderOrder = -1;
  return m;
}

// kind: 'player' (you) | 'human' (a friend on the LAN) | 'ai'
// manifest "applyTo": 'all' | 'humans' (default) | 'player' — a detailed model
// costs far more than the procedural body, so limiting it to the handful of
// human cars keeps the frame rate up with a full twelve-car grid.
// Which template a car of this kind should use, or null for the procedural body.
// Bots prefer the pack; `variant` pins a specific car (so a rejoining racer keeps
// the one they had), otherwise the pack is dealt round-robin for an even spread.
function templateFor(kind, variant) {
  if (kind === 'ghost') return null;    // ghosts use the light procedural body
  if (kind === 'ai' && botPack.length) {
    const i = Number.isInteger(variant) ? variant : botTurn++;
    return botPack[((i % botPack.length) + botPack.length) % botPack.length];
  }
  if (!template) return null;
  switch (template.cfg.applyTo || 'humans') {
    case 'all': return template;
    case 'player': return kind === 'player' ? template : null;
    default: return (kind === 'player' || kind === 'human') ? template : null;
  }
}

export function createCar(colorHex, { spoiler = Math.random() < 0.5, kind = 'ai', variant } = {}) {
  // A loaded glTF model replaces the procedural body when one is configured.
  const tpl = templateFor(kind, variant);
  if (tpl) {
    const inst = instantiateTemplate(tpl, colorHex);
    const g = new THREE.Group();
    g.add(inst.group);
    const box = new THREE.Box3().setFromObject(inst.group);
    const sz = box.getSize(new THREE.Vector3());
    g.add(makeContactShadow(sz.z || 4.4, sz.x || 2.0));
    return {
      group: g,
      body: inst.group,
      rigs: inst.rigs,
      paint: inst.paint,
      paintMats: inst.paintMats,
      lightMatR: inst.tailMats[0] || null,
      headMats: inst.headMats,
      tailMats: inst.tailMats,
      paintShade: inst.paintShade,
      retint: inst.retint,
      steerWheel: inst.steerWheel,
      cabin: null,
    };
  }

  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: colorHex, metalness: 0.55, roughness: 0.26,
    clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1,
  });

  const body = new THREE.Group();
  group.add(body);

  // Main hull
  const hull = new THREE.Mesh(new RoundedBoxGeometry(1.78, 0.62, 4.3, 4, 0.18), paint);
  hull.position.y = 0.52;
  hull.scale.z = 1;
  body.add(hull);

  // Nose taper (front is +Z)
  const nose = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.42, 1.2, 4, 0.16), paint);
  nose.position.set(0, 0.44, 1.85);
  body.add(nose);

  // Cabin / greenhouse
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.52, 2.0, 4, 0.22), glassMat);
  cabin.position.set(0, 0.94, -0.25);
  cabin.scale.set(1, 0.85, 1);
  body.add(cabin);

  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.1, 1.15, 3, 0.05), paint);
  roof.position.set(0, 1.19, -0.35);
  body.add(roof);

  // Skirts + bumpers detail
  const skirt = new THREE.Mesh(new RoundedBoxGeometry(1.94, 0.22, 4.0, 2, 0.08), blackMat);
  skirt.position.y = 0.26;
  body.add(skirt);

  // Spoiler for some cars
  if (spoiler) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.06, 0.4, 2, 0.03), blackMat);
    wing.position.set(0, 1.02, -2.1);
    body.add(wing);
    const strutG = new THREE.BoxGeometry(0.07, 0.28, 0.12);
    for (const sx of [-0.6, 0.6]) {
      const st = new THREE.Mesh(strutG, blackMat);
      st.position.set(sx, 0.86, -2.08);
      body.add(st);
    }
  }

  // Lights. Cloned per car so toggling one car's headlights does not affect all.
  const lightMatF = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe6ff, emissiveIntensity: 1.6 });
  const lightMatR = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.2 });
  for (const sx of [-0.62, 0.62]) {
    const hf = new THREE.Mesh(headGeo, lightMatF);
    hf.position.set(sx, 0.52, 2.42);
    body.add(hf);
    const tr = new THREE.Mesh(tailGeo, lightMatR);
    tr.position.set(sx, 0.62, -2.16);
    body.add(tr);
  }

  // Wheels: FL, FR, RL, RR — front pair steers, all spin. Same rig structure
  // as the glTF path (steer group -> spin group), just with identity axes.
  const rigs = [];
  // Slightly wider than the hull so the wheels read outside the bodywork.
  const wheelPos = [
    [-0.94, 1.38, true], [0.94, 1.38, true],
    [-0.94, -1.45, false], [0.94, -1.45, false],
  ];
  for (const [wx, wz, front] of wheelPos) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.34, wz);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, blackMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spin.add(tire, rim);
    pivot.add(spin);
    group.add(pivot);
    rigs.push({
      spinObj: spin,
      steerObj: front ? pivot : null,
      axle: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      radius: 0.34,
    });
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  group.add(makeContactShadow(CAR.length, CAR.width));

  return {
    group, body, rigs, paint, paintMats: [paint], lightMatR,
    headMats: [lightMatF], tailMats: [lightMatR],
    cabin,   // hidden in cockpit view so you can see out of the procedural car
  };
}

// Repaint a car. Drives every paint material, so a model that splits its shell
// across several of them recolours completely.
export function setPaint(car, colorHex) {
  if (car.retint) car.retint(colorHex);   // baked-livery models repaint their texture
  for (const m of car.paintMats || [car.paint]) {
    if (!m || !m.color) continue;
    m.color.set(colorHex);
    // Keep the manifest's tint strength on repaint (see paintShade in carModels).
    if (car.paintShade !== undefined && car.paintShade < 1) m.color.multiplyScalar(car.paintShade);
  }
}

// Headlights on/off. Works for both the procedural body and glTF models.
export function setLights(car, on) {
  for (const m of car.headMats || []) {
    if (!m) continue;
    m.emissiveIntensity = on ? 4.5 : 1.6;
    if (m.emissive) m.emissive.setHex(on ? 0xffffff : 0xcfe6ff);
  }
}

// Visual update: wheel spin, steer angle, body roll, brake dive, brake lights.
const TWO_PI = Math.PI * 2;
export function animateCar(car, speed, steer, brake, dt) {
  // Distance-based roll angle, wrapped so the float never loses precision over
  // a long race. Per-rig radius keeps a model's wheels rolling at true rate.
  car.dist = ((car.dist || 0) + speed * dt) % 1000;
  // Ease the VISIBLE steering angle so the front wheels sweep like a real rack
  // instead of snapping between key states.
  if (car.steerVis === undefined) car.steerVis = 0;
  car.steerVis += (steer - car.steerVis) * Math.min(1, dt * 10);
  for (const r of car.rigs || []) {
    r.spinObj.quaternion.setFromAxisAngle(r.axle, (car.dist / r.radius) % TWO_PI);
    // steer > 0 is right; clockwise from above is a negative rotation about up.
    if (r.steerObj) r.steerObj.quaternion.setFromAxisAngle(r.up, -car.steerVis * 0.42);
  }
  // Steering wheel (glTF models with a carved wheel — see carModels.js). The
  // axis points at the driver, so steering right is a negative turn about it.
  if (car.steerWheel) {
    car.steerWheel.obj.quaternion.setFromAxisAngle(car.steerWheel.axis, -car.steerVis * car.steerWheel.maxTurn);
  }
  const targetRoll = -car.steerVis * Math.min(speed / 40, 1) * 0.05;
  car.body.rotation.z += (targetRoll - car.body.rotation.z) * Math.min(1, dt * 8);
  // Nose dive scales with how hard the brake is applied.
  const targetPitch = speed > 6 ? Math.min(1, brake) * 0.028 : 0;
  car.body.rotation.x += (targetPitch - car.body.rotation.x) * Math.min(1, dt * 6);
  setBrakeLights(car, brake > 0.12);
}

// Rear lamps glow red under braking. Every tail material is driven, since a car
// usually has several (lens, inner cluster, third light).
export function setBrakeLights(car, on) {
  if (car.brakeLit === on) return;   // materials only change on transition
  car.brakeLit = on;
  for (const m of car.tailMats || []) {
    if (!m) continue;
    if (m.emissive) m.emissive.setHex(on ? 0xff1408 : 0x2a0300);
    m.emissiveIntensity = on ? 5.0 : 0.9;
  }
}
