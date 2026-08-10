// Drift effects: tire smoke and rubber marks laid on the road.
// One Points pool drives all smoke (a custom shader gives per-particle size,
// alpha and tint — grey on asphalt, sandy dust offroad). Skid marks are a ring
// buffer of quads in a single geometry whose per-vertex alpha decays over
// time, so old rubber fades away instead of accumulating forever.
import * as THREE from 'three';

const SMOKE_N = 160;
const MARK_N = 720;          // quad segments across all trails
const MARK_W = 0.26;         // rubber stripe width, meters
const MARK_Y = 0.145;        // just above the asphalt (ROAD_Y = 0.12)

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DriftFX {
  constructor(scene) {
    // ---- smoke ----
    this.parts = Array.from({ length: SMOKE_N }, () => ({
      life: 0, ttl: 1, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, s0: 1,
    }));
    this.pHead = 0;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(SMOKE_N * 3).fill(-1000);
    this.pMisc = new Float32Array(SMOKE_N * 2);          // size px @1m, alpha
    this.pCol = new Float32Array(SMOKE_N * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('misc', new THREE.BufferAttribute(this.pMisc, 2));
    pg.setAttribute('tint', new THREE.BufferAttribute(this.pCol, 3));
    const pm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: smokeTexture() } },
      vertexShader: `
        attribute vec2 misc;
        attribute vec3 tint;
        varying float vA;
        varying vec3 vC;
        void main() {
          vC = tint;
          vA = misc.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = misc.x * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying float vA;
        varying vec3 vC;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    this.smoke = new THREE.Points(pg, pm);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 5;
    scene.add(this.smoke);

    // ---- skid marks ----
    this.mHead = 0;
    this.mPos = new Float32Array(MARK_N * 4 * 3);
    this.mAlpha = new Float32Array(MARK_N * 4);
    const idx = new Uint16Array(MARK_N * 6);
    for (let i = 0; i < MARK_N; i++) {
      const v = i * 4, k = i * 6;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], k);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3));
    mg.setAttribute('alpha', new THREE.BufferAttribute(this.mAlpha, 1));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    const mm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      vertexShader: `
        attribute float alpha;
        varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(0.05, 0.05, 0.06, vA); }`,
    });
    this.marks = new THREE.Mesh(mg, mm);
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    this.trails = new Map();   // wheelKey -> {x, z} last laid point
  }

  // One smoke puff. sandy=true tints it like kicked-up dust.
  emitSmoke(x, y, z, vx, vy, vz, intensity = 1, sandy = false) {
    const p = this.parts[this.pHead];
    this.pHead = (this.pHead + 1) % SMOKE_N;
    p.life = 0;
    p.ttl = 0.7 + Math.random() * 0.55;
    p.x = x + (Math.random() - 0.5) * 0.35;
    p.y = y;
    p.z = z + (Math.random() - 0.5) * 0.35;
    p.vx = vx + (Math.random() - 0.5) * 1.6;
    p.vy = vy + 0.8 + Math.random() * 1.2;
    p.vz = vz + (Math.random() - 0.5) * 1.6;
    p.s0 = (0.55 + Math.random() * 0.5) * intensity;
    const i = this.parts.indexOf(p) * 3;
    if (sandy) {
      this.pCol[i] = 0.78; this.pCol[i + 1] = 0.68; this.pCol[i + 2] = 0.5;
    } else {
      const v = 0.78 + Math.random() * 0.14;
      this.pCol[i] = v; this.pCol[i + 1] = v; this.pCol[i + 2] = v + 0.02;
    }
  }

  // Extend (or break) the rubber trail for one wheel. Call every frame; when
  // `on` is false the trail restarts on the next contact.
  skid(key, x, z, on, strength = 0.55) {
    if (!on) { this.trails.delete(key); return; }
    const last = this.trails.get(key);
    if (!last) { this.trails.set(key, { x, z }); return; }
    const dx = x - last.x, dz = z - last.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.16) return;            // wait until there's a segment worth laying
    if (d > 4) { this.trails.set(key, { x, z }); return; }   // teleport — break
    const nx = -dz / d, nz = dx / d; // stripe's sideways normal
    const w = MARK_W / 2;
    const v = this.mHead * 12, a = this.mHead * 4;
    this.mHead = (this.mHead + 1) % MARK_N;
    this.mPos.set([
      last.x + nx * w, MARK_Y, last.z + nz * w,
      last.x - nx * w, MARK_Y, last.z - nz * w,
      x + nx * w, MARK_Y, z + nz * w,
      x - nx * w, MARK_Y, z - nz * w,
    ], v);
    this.mAlpha.fill(strength, a, a + 4);
    this.trails.set(key, { x, z });
    this._marksDirty = true;
  }

  clearMarks() {
    this.mAlpha.fill(0);
    this.trails.clear();
    this._marksDirty = true;
  }

  update(dt) {
    // smoke: integrate, expand, fade
    for (let i = 0; i < SMOKE_N; i++) {
      const p = this.parts[i];
      if (p.life >= p.ttl) { this.pMisc[i * 2 + 1] = 0; continue; }
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 1.6;
      p.vz *= 1 - dt * 1.6;
      const t = p.life / p.ttl;
      this.pPos[i * 3] = p.x;
      this.pPos[i * 3 + 1] = p.y;
      this.pPos[i * 3 + 2] = p.z;
      this.pMisc[i * 2] = p.s0 * (0.5 + t * 1.7);       // grows as it disperses
      this.pMisc[i * 2 + 1] = 0.34 * (1 - t) * (1 - t); // fades out
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.misc.needsUpdate = true;
    this.smoke.geometry.attributes.tint.needsUpdate = true;

    // marks: slow fade so the racing line's rubber lingers, then vanishes
    const decay = dt * 0.028;
    let dirty = this._marksDirty;
    for (let i = 0; i < this.mAlpha.length; i++) {
      if (this.mAlpha[i] > 0) { this.mAlpha[i] = Math.max(0, this.mAlpha[i] - decay); dirty = true; }
    }
    if (dirty) {
      this.marks.geometry.attributes.position.needsUpdate = true;
      this.marks.geometry.attributes.alpha.needsUpdate = true;
      this._marksDirty = false;
    }
  }
}
