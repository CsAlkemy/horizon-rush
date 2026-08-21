// World construction: sky, lighting, terrain, ocean, road + trackside props.
// Everything is generated (canvas textures, procedural terrain) — no assets.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ROAD_HALF, SHOULDER, ROAD_Y } from '../shared/track.js';

const UP = new THREE.Vector3(0, 1, 0);

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------- value noise
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return (((n ^ (n >> 16)) >>> 0) / 4294967295);
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z) {
  return (vnoise(x, z) + 0.5 * vnoise(x * 2.1 + 5, z * 2.1 + 3) + 0.25 * vnoise(x * 4.3 + 9, z * 4.3 + 1)) / 1.75;
}

// ------------------------------------------------------------- canvas textures
function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function asphaltTexture() {
  // One 8 m stretch of two-lane road: center dashes + solid edge lines.
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, w, h);
    // speckle
    for (let i = 0; i < 2600; i++) {
      const v = 44 + Math.random() * 42;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.16 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2.2, 2.2);
    }
    // subtle tire-polished lanes
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.28, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // edge lines
    g.fillStyle = 'rgba(238,240,242,0.92)';
    g.fillRect(10, 0, 9, h);
    g.fillRect(w - 19, 0, 9, h);
    // center dash: 3 m paint / 5 m gap of the 8 m tile
    g.fillRect(w / 2 - 5, 0, 10, h * 0.375);
  });
}

function curbTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#d81f3d'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f2f3f5'; g.fillRect(0, h / 2, w, h / 2);
  });
}

function checkerTexture() {
  return canvasTexture(256, 64, (g, w, h) => {
    const s = 16;
    for (let y = 0; y < h / s; y++) {
      for (let x = 0; x < w / s; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        g.fillRect(x * s, y * s, s, s);
      }
    }
  });
}

function chevronTexture(dir) {
  // dir: -1 arrows point left, +1 right
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#e8b400';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#101010';
    g.lineWidth = 30;
    g.lineJoin = 'miter';
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.25 + i * 0.25);
      g.beginPath();
      g.moveTo(cx - 40 * dir, 40);
      g.lineTo(cx + 40 * dir, h / 2);
      g.lineTo(cx - 40 * dir, h - 40);
      g.stroke();
    }
    g.strokeStyle = '#101010'; g.lineWidth = 12;
    g.strokeRect(6, 6, w - 12, h - 12);
  });
}

// Ad artwork for billboard faces. The height parameter tracks the aspect of
// whatever surface shows it — 640 suits the 13:8 procedural panel, taller for
// the squarer screens of the billboard model pack.
function billboardTexture(h = 640) {
  return canvasTexture(1024, h, (g, w) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1477e8');
    grad.addColorStop(1, '#0b4fc0');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.55, 0); g.lineTo(w * 0.8, 0); g.lineTo(w * 0.25, h); g.fill();
    g.fillStyle = '#fff';
    g.font = `italic 900 ${Math.round(h * 0.6)}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', w / 2, h / 2 - h * 0.03);
    g.font = `italic 800 ${Math.round(h * 0.1)}px "Segoe UI", Arial, sans-serif`;
    g.fillText('NOXRUSH', w / 2, h - h * 0.11);
  });
}

function bannerTexture() {
  return canvasTexture(2048, 320, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#12b8e8');
    grad.addColorStop(0.5, '#1477e8');
    grad.addColorStop(1, '#ff2d78');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = 'italic 900 190px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('NOXRUSH', w / 2, h / 2 + 8);
  });
}

// Radial stripes for a tent canopy. A cone's UVs wrap once around its
// circumference, so vertical stripes in the texture become radial panels.
function tentStripeTexture(hexA, hexB) {
  const a = '#' + hexA.toString(16).padStart(6, '0');
  const b = '#' + hexB.toString(16).padStart(6, '0');
  return canvasTexture(256, 64, (g, w, h) => {
    const panels = 8;
    for (let i = 0; i < panels; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect((i / panels) * w, 0, w / panels + 1, h);
    }
    // A touch of shading down the fabric so the canopy is not a flat colour.
    const sh = g.createLinearGradient(0, 0, 0, h);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)');
    sh.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
  });
}

// Bunting: alternating pennants hanging off a cord, on a transparent strip.
function buntingTexture() {
  const cols = ['#ff2d78', '#ffb400', '#35e0e6', '#f4f5f7', '#7a3cf0', '#12b8a8'];
  return canvasTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2b2f38'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(w, 10); g.stroke();
    const n = 12, step = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      const x = i * step;
      g.beginPath();
      g.moveTo(x + 3, 10); g.lineTo(x + step - 3, 10); g.lineTo(x + step / 2, h - 14);
      g.closePath(); g.fill();
    }
  }, [1, 1]);
}

// A packed crowd, as coloured dots in rows. Cheap enough to put on a plane and
// far more convincing than an empty grandstand.
function crowdTexture() {
  const skin = ['#e8b48c', '#c98a5e', '#8c5a3c', '#f0cfae', '#6b4530'];
  // Mostly muted, a few bright. A full rainbow palette reads as confetti; real
  // crowds are largely neutral with the odd flash of colour.
  const shirt = ['#5c6470', '#7b838f', '#3d4450', '#9aa2ae', '#4a5666', '#6b7280',
    '#8b8177', '#5a6472', '#2f3640', '#a8b0bb',
    '#d7263d', '#2364d2', '#ffd23d', '#f4f5f7', '#1f9d55'];
  return canvasTexture(512, 256, (g, w, h) => {
    // Seat colour, not black. A near-black ground with sparse dots on it reads
    // as a dark slab with confetti rather than as a stand full of people.
    g.fillStyle = '#525b6b';
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 9; r++) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(0, h - ((r + 1) / 9) * h, w, 3);
    }
    // Sized so that, at the repeat set where this is used, one "person" comes
    // out around half a metre wide. Untiled on a 30 m stand each spectator was
    // three and a half metres tall and the whole thing read as confetti.
    const rows = 9, cols = 30;
    for (let r = 0; r < rows; r++) {
      // Seats fill from the front; the back rows thin out, as they do in life.
      const fill = 0.94 - r * 0.045;
      for (let c = 0; c < cols; c++) {
        if (Math.random() > fill) continue;
        const x = ((c + (r % 2) * 0.5) / cols) * w + w / cols * 0.5;
        const y = h - ((r + 0.62) / rows) * h;
        const rad = w / cols * 0.34;
        g.fillStyle = shirt[(Math.random() * shirt.length) | 0];
        g.beginPath(); g.arc(x, y + rad * 0.9, rad * 1.05, 0, Math.PI * 2); g.fill();
        g.fillStyle = skin[(Math.random() * skin.length) | 0];
        g.beginPath(); g.arc(x, y - rad * 0.5, rad * 0.68, 0, Math.PI * 2); g.fill();
      }
    }
    // Knock the crowd back a little so it reads as a mass under the roof
    // rather than saturated dots competing with the cars.
    g.fillStyle = 'rgba(22,26,34,0.16)';
    g.fillRect(0, 0, w, h);
    // 1.5 repeats, not 2: the seating plane is ~28.5 m x 9.2 m and this canvas
    // is 2:1, so 2 repeats squash each spectator into a vertical dash.
  }, [1.5, 1]);
}

function cloudTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const blob = (x, y, r) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(128, 150, 90); blob(80, 140, 60); blob(180, 135, 65); blob(128, 110, 55);
  });
}

// ------------------------------------------------------- tree impostors
// Real tree geometry is far too heavy to instance across a landscape, however
// light the model — hundreds of copies multiply everything. So each tree is
// rendered once into a texture at startup and drawn on crossed quads: the
// trees still look like the model, at 4 triangles each.
//
// A tree *pack* (several trees laid out side by side in one file) becomes one
// impostor per tree, picked per instance, so the forest gets real variety
// instead of one silhouette stamped 400 times. Meshes with "tree" in the name
// are the variants; anything else in the pack (rocks, ground tiles) is
// skipped — those props are sized and tinted like trees here, which reads
// wrong. A single-mesh model bakes as one variant, same as before.
function splitTreeVariants(treeScene) {
  treeScene.updateMatrixWorld(true);
  const meshes = [];
  treeScene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const named = meshes.filter((m) => /tree/i.test(m.name));
  const picked = named.length ? named : meshes;
  if (picked.length <= 1) return [treeScene];
  return picked.map((mesh) => {
    // Clone (sharing geometry/material) with the world transform baked in, so
    // the variant carries its own scale but not its slot in the pack line-up.
    const solo = mesh.clone(false);
    solo.matrixAutoUpdate = false;
    solo.matrix.copy(mesh.matrixWorld);
    const group = new THREE.Group();
    group.add(solo);
    return group;
  });
}

function bakeTreeImpostor(renderer, treeScene, width = 768) {
  const box = new THREE.Box3().setFromObject(treeScene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, size.z), h = size.y;
  if (!(w > 0 && h > 0)) return null;

  const height = Math.min(2048, Math.max(64, Math.round(width * (h / w))));
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });

  // Far plane tracks the camera distance — tied to width alone it clips tall
  // thin trees (h > ~2.7w) out of their own bake.
  const dist = Math.max(w, h) * 3;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, dist + w);
  cam.position.set(center.x, center.y, center.z + dist);
  cam.lookAt(center);

  const bakeScene = new THREE.Scene();
  bakeScene.add(treeScene);
  bakeScene.add(new THREE.HemisphereLight(0xdff0ff, 0x4a5a3a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.0);
  sun.position.set(w, h * 1.5, w);
  bakeScene.add(sun);

  // Bake without tone mapping, or the texture gets tone mapped twice.
  const prevTone = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();
  const prevAlpha = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(bakeScene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.setClearAlpha(prevAlpha);

  const tex = rt.texture;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // The source model has done its job — free the triangles it was holding.
  treeScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m && m.dispose();
    }
  });
  bakeScene.clear();

  return { texture: tex, aspect: w / h };
}

// Two quads crossed at 90°, unit height, base sitting on y = 0. Reads as a tree
// from any angle without needing a billboard shader.
function crossedQuads(aspect) {
  const w = aspect * 0.5;
  const pos = [
    -w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0,
    0, 0, -w, 0, 0, w, 0, 1, w, 0, 1, -w,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Strip geometry along the closed track loop; fnA/fnB give the two edges.
function loopStrip(track, fnA, fnB, vPeriod) {
  const N = track.N;
  const rows = N + 1;
  const pos = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const idx = [];
  const vScale = Math.max(1, Math.round(track.L / vPeriod)) / track.L;
  for (let i = 0; i <= N; i++) {
    const s = track.samples[i % N];
    const a = fnA(s, i % N), b = fnB(s, i % N);
    pos.set(a, i * 6);
    pos.set(b, i * 6 + 3);
    const v = (i / N) * track.L * vScale;
    uv.set([0, v], i * 4);
    uv.set([1, v], i * 4 + 2);
    if (i < N) {
      // Wind counter-clockwise seen from above so normals point +Y; the
      // opposite order makes the strip face down and get backface-culled.
      const r = i * 2;
      idx.push(r, r + 2, r + 1, r + 1, r + 2, r + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Strip over a sub-range of sample indices (for curbs, checker line).
function rangeStrip(track, i0, i1, fnA, fnB, vPeriod = 2) {
  const pos = [], uv = [], idx = [];
  const N = track.N;
  const count = ((i1 - i0 + N) % N) + 1;
  for (let k = 0; k <= count; k++) {
    const i = (i0 + k) % N;
    const s = track.samples[i];
    const a = fnA(s, i), b = fnB(s, i);
    pos.push(...a, ...b);
    const v = (k * track.ds) / vPeriod;
    uv.push(0, v, 1, v);
    if (k < count) {
      const r = k * 2;
      idx.push(r, r + 2, r + 1, r + 1, r + 2, r + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Shared across world rebuilds (map switches). The environment map is identical
// for every map, and the tree impostors can only be baked once — baking frees
// the source model's geometry.
let _envTexture = null;
let _treeImpostors = null;

// ------------------------------------------------------------- main builder
export function buildWorld(scene, renderer, track, quality, treeModel = null, billboardModel = null) {
  const T = track.def.theme;
  // Every object the world creates hangs off one root, so switching maps is
  // "remove the root" rather than bookkeeping each mesh individually.
  const root = new THREE.Group();
  scene.add(root);
  const world = { checkpoints: [], quality, root };

  world.dispose = () => {
    scene.remove(root);
    root.traverse((o) => {
      if (o.isLight) { o.dispose(); return; }   // frees the shadow map target
      if (o.isInstancedMesh) o.dispose();       // frees instance attribute buffers
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && !m.userData.sharedMap) m.map.dispose();
        m.dispose();
      }
    });
  };

  // --- distance-to-track helper (coarse, fine enough for scenery/terrain)
  const S = track.samples;
  function trackDist(x, z) {
    let best = Infinity;
    for (let i = 0; i < track.N; i += 8) {
      const dx = S[i].x - x, dz = S[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function heightAt(x, z) {
    const e = fbm(x * 0.006 + 13.1, z * 0.006 + 7.7);
    let h = (e - 0.34) * T.heightAmp;
    const inland = smoothstep(-150, 460, x * 0.8 + z * 0.45);
    h *= 0.5 + inland * 1.25;
    if (T.ocean != null) {
      // Coast drops away west of the circuit (track min x is about -390).
      const coast = smoothstep(-440, -700, x);
      h = h * (1 - coast) - 9 * coast;
    }
    const d = trackDist(x, z);
    // Depress terrain slightly below the road plane near the track so the thin
    // road ribbon never z-fights or pokes through terrain triangles.
    const m = smoothstep(18, 95, d);
    h = h * m - (1 - m) * 0.45;
    return Math.max(T.ocean != null ? -9 : -2, h);
  }
  world.heightAt = heightAt;

  // --- environment / sky ---------------------------------------------------
  if (!_envTexture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    _envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  scene.environment = _envTexture;
  scene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);

  const skyGeo = new THREE.SphereGeometry(4200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(T.sky[0]) },
      mid: { value: new THREE.Color(T.sky[1]) },
      bot: { value: new THREE.Color(T.sky[2]) },
    },
    vertexShader: `
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){
        float y = normalize(vP).y;
        vec3 c = y > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, y)) : mix(bot, mid, smoothstep(-0.05, 0.12, y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  root.add(new THREE.Mesh(skyGeo, skyMat));

  // clouds
  const cloudTex = cloudTexture();
  const clouds = new THREE.Group();
  for (let i = 0; i < T.clouds; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m);
    const a = Math.random() * Math.PI * 2, r = 500 + Math.random() * 1500;
    sp.position.set(Math.cos(a) * r, 150 + Math.random() * 160, Math.sin(a) * r);
    const sc = 220 + Math.random() * 320;
    sp.scale.set(sc, sc * 0.45, 1);
    clouds.add(sp);
  }
  root.add(clouds);
  world.clouds = clouds;

  // --- lights ----------------------------------------------------------------
  root.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
  const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1]);
  sun.castShadow = quality !== 'low';
  const shadowRes = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 700;
  // Tight enough that a 2048 map gives ~4 cm texels — wide extents blur the
  // car's contact shadow into nothing.
  const ext = 48;
  sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
  sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
  sun.shadow.bias = -0.0002;
  // Small: a large normalBias offsets the shadow lookup so far that contact
  // shadows vanish and cars look pasted onto the road.
  sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);
  world.sun = sun;

  // --- terrain -----------------------------------------------------------------
  const TG = 240;
  const terrGeo = new THREE.PlaneGeometry(4200, 4200, TG, TG);
  terrGeo.rotateX(-Math.PI / 2);
  const tp = terrGeo.attributes.position;
  const colors = new Float32Array(tp.count * 3);
  const cGrass = new THREE.Color(T.ground[0]), cGrass2 = new THREE.Color(T.ground[1]);
  const cSand = new THREE.Color(T.sand), cRock = new THREE.Color(T.rock);
  const col = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const h = heightAt(x, z);
    tp.setY(i, h);
    const n = fbm(x * 0.02, z * 0.02);
    col.copy(cGrass).lerp(cGrass2, n);
    // Sand only on the western beach strip and underwater — ground elsewhere,
    // including the flattened corridor around the road.
    const beach = T.ocean != null ? smoothstep(-430, -560, x) : 0;
    const sandMix = Math.max(beach, smoothstep(-0.3, -2.5, h));
    col.lerp(cSand, sandMix);
    if (h > T.rockLine) col.lerp(cRock, smoothstep(T.rockLine, T.rockLine * 2, h));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  terrain.receiveShadow = true;
  root.add(terrain);

  // ocean
  if (T.ocean != null) {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshStandardMaterial({ color: T.ocean, roughness: 0.16, metalness: 0.08, envMapIntensity: 1.1 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -2.4;
    root.add(ocean);
  }

  // --- road -----------------------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0 });
  roadMat.map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const road = new THREE.Mesh(loopStrip(track,
    (s) => [s.x - s.nx * ROAD_HALF, ROAD_Y, s.z - s.nz * ROAD_HALF],
    (s) => [s.x + s.nx * ROAD_HALF, ROAD_Y, s.z + s.nz * ROAD_HALF],
    8), roadMat);
  road.receiveShadow = true;
  root.add(road);

  // sand shoulders
  const sandMat = new THREE.MeshStandardMaterial({ color: T.shoulder, roughness: 1 });
  const shW = SHOULDER + 0.6;
  for (const side of [-1, 1]) {
    // Pass edges in ascending signed-offset order so the winding (and hence the
    // +Y normal) comes out right on both sides of the road.
    const inner = side * ROAD_HALF, outer = side * (ROAD_HALF + shW);
    const [oA, yA, oB, yB] = side > 0
      ? [inner, ROAD_Y - 0.02, outer, -0.2]
      : [outer, -0.2, inner, ROAD_Y - 0.02];
    const sh = new THREE.Mesh(loopStrip(track,
      (s) => [s.x + s.nx * oA, yA, s.z + s.nz * oA],
      (s) => [s.x + s.nx * oB, yB, s.z + s.nz * oB],
      8), sandMat);
    sh.receiveShadow = true;
    root.add(sh);
  }

  // --- corner detection (curbs + chevrons) -----------------------------------
  const CURB_T = 0.013;
  const ranges = [];
  let run = null;
  for (let i = 0; i < track.N; i++) {
    const c = S[i].curvSm;
    if (Math.abs(c) > CURB_T) {
      if (!run) run = { i0: i, sign: Math.sign(c), maxC: 0 };
      run.maxC = Math.max(run.maxC, Math.abs(c));
      run.i1 = i;
    } else if (run) {
      if (run.i1 - run.i0 > 14) ranges.push(run);
      run = null;
    }
  }
  if (run && run.i1 - run.i0 > 14) ranges.push(run);

  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.7 });
  for (const r of ranges) {
    // Curb on the inside of the corner: curv > 0 is a left turn, and +n is left.
    const side = r.sign > 0 ? 1 : -1;
    const oIn = side * (ROAD_HALF - 1.15), oOut = side * (ROAD_HALF + 0.1);
    const [oA, yA, oB, yB] = side > 0
      ? [oIn, ROAD_Y + 0.05, oOut, ROAD_Y + 0.01]
      : [oOut, ROAD_Y + 0.01, oIn, ROAD_Y + 0.05];
    const geo = rangeStrip(track, r.i0, r.i1,
      (s) => [s.x + s.nx * oA, yA, s.z + s.nz * oA],
      (s) => [s.x + s.nx * oB, yB, s.z + s.nz * oB],
      2.2);
    const curb = new THREE.Mesh(geo, curbMat);
    curb.receiveShadow = true;
    root.add(curb);
  }

  // --- guardrails -------------------------------------------------------------
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide });
  const railOff = ROAD_HALF + SHOULDER + 0.25;
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(loopStrip(track,
      (s) => [s.x + s.nx * side * railOff, 0.42, s.z + s.nz * side * railOff],
      (s) => [s.x + s.nx * side * railOff, 0.78, s.z + s.nz * side * railOff],
      4), railMat);
    root.add(band);
  }
  // rail posts (instanced)
  const postGeo = new THREE.BoxGeometry(0.09, 0.8, 0.14);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7c828a, metalness: 0.7, roughness: 0.5 });
  // ceil, not floor: the fill loop below visits ceil(N/postEvery) samples, and
  // an InstancedMesh whose count exceeds its allocation makes every draw fail
  // with GL_INVALID_OPERATION (posts simply vanish on strict drivers).
  const postEvery = Math.max(1, Math.round(4 / track.ds));
  const postCount = Math.ceil(track.N / postEvery) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  let pi = 0;
  for (let i = 0; i < track.N; i += postEvery) {
    const s = S[i];
    for (const side of [-1, 1]) {
      q.setFromAxisAngle(UP, s.h);
      m4.compose(new THREE.Vector3(s.x + s.nx * side * railOff, 0.4, s.z + s.nz * side * railOff), q, sc);
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.count = pi;
  root.add(posts);

  // --- start gantry + checker line ---------------------------------------------
  const s0 = S[0];
  const gantry = new THREE.Group();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), towerMat);
    t.position.set(s0.x + s0.nx * side * (ROAD_HALF + 1.6), 4, s0.z + s0.nz * side * (ROAD_HALF + 1.6));
    t.castShadow = true;
    gantry.add(t);
  }
  const beamLen = (ROAD_HALF + 1.6) * 2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.6, 0.7), towerMat);
  beam.position.set(s0.x, 7.7, s0.z);
  beam.rotation.y = Math.atan2(s0.nx, s0.nz);
  gantry.add(beam);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(beamLen - 1, 2.1),
    new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.6 })
  );
  banner.position.set(s0.x, 6.2, s0.z);
  banner.rotation.y = Math.atan2(s0.tx, s0.tz) + Math.PI;
  gantry.add(banner);
  root.add(gantry);

  const checker = new THREE.Mesh(
    rangeStrip(track, track.N - 2, 2,
      (s) => [s.x - s.nx * ROAD_HALF, ROAD_Y + 0.02, s.z - s.nz * ROAD_HALF],
      (s) => [s.x + s.nx * ROAD_HALF, ROAD_Y + 0.02, s.z + s.nz * ROAD_HALF], 4),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 })
  );
  root.add(checker);

  // --- chevron signs on sharp corners -------------------------------------------
  const chevL = chevronTexture(-1), chevR = chevronTexture(1);
  for (const r of ranges) {
    if (r.maxC < 0.02) continue;
    const entry = (r.i0 - 18 + track.N) % track.N;
    const s = S[entry];
    const outer = r.sign > 0 ? -1 : 1;
    const tex = r.sign > 0 ? chevR : chevL;
    const sign = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.7),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.55 })
    );
    panel.position.y = 1.7;
    sign.add(panel);
    const legG = new THREE.BoxGeometry(0.09, 1, 0.09);
    for (const lx of [-1.4, 1.4]) {
      const leg = new THREE.Mesh(legG, postMat);
      leg.position.set(lx, 0.45, 0);
      sign.add(leg);
    }
    sign.position.set(s.x + s.nx * outer * (railOff + 1.6), 0, s.z + s.nz * outer * (railOff + 1.6));
    sign.rotation.y = Math.atan2(-s.tx, -s.tz);
    sign.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(sign);
  }

  // --- billboards -----------------------------------------------------------------
  // Real billboard models when the pack is loaded (models/low-poly_billboard_
  // pack.glb — prepped into billboard_N units, base at y=0, screens facing +z,
  // see models/README.md); the procedural panel-on-legs is the fallback.
  // Either way the ad face shows the game's own generated artwork.
  const bbUnits = billboardModel
    ? billboardModel.children.filter((n) => n.name.startsWith('billboard_'))
    : [];
  let adMat = null;
  if (bbUnits.length) {
    // Ad texture aspect matched to the pack's (tilted) screen quad.
    let screen = null;
    bbUnits[0].traverse((o) => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      if (!screen && mats.some((m) => m && m.name.startsWith('ad_screen'))) screen = o;
    });
    // Prepped units stand with their ad face square to +z, so the screen's
    // own width/height is the aspect the artwork has to be drawn at.
    const ss = new THREE.Box3().setFromObject(screen).getSize(new THREE.Vector3());
    const aspect = ss.x / ss.y;
    // glTF UVs start at the top-left, three.js canvas textures at the bottom —
    // left flipped, the artwork lands mirrored on an imported screen.
    const adTex = billboardTexture(Math.round(1024 / aspect));
    adTex.flipY = false;
    adMat = new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.6 });
    // Pack textures survive world.dispose() across map switches.
    for (const unit of bbUnits) unit.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) m.userData.sharedMap = true;
      }
    });
  }
  const bbTex = bbUnits.length ? null : billboardTexture();
  let bbIdx = 0;
  for (const fs of [0.06, 0.27, 0.5, 0.72, 0.9]) {
    const s = fs * track.L;
    const p = track.point(s);
    // Stand them on the inland side (larger x) so they never end up in the sea.
    const side = p.nx >= 0 ? 1 : -1;
    const bx = p.x + p.nx * side * (railOff + 9);
    const bz = p.z + p.nz * side * (railOff + 9);
    const by = heightAt(bx, bz);
    let bb;
    if (bbUnits.length) {
      const unit = bbUnits[bbIdx++ % bbUnits.length];
      bb = unit.clone(true);
      const height = new THREE.Box3().setFromObject(unit).getSize(new THREE.Vector3()).y;
      bb.scale.setScalar(11 / height);
      bb.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some((m) => m && m.name.startsWith('ad_screen'))) o.material = adMat;
      });
    } else {
      bb = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(13, 8.1),
        new THREE.MeshStandardMaterial({ map: bbTex, side: THREE.DoubleSide, roughness: 0.6 }));
      panel.position.y = 7.2;
      bb.add(panel);
      for (const lx of [-5, 0, 5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.6, 0.45), towerMat);
        leg.position.set(lx, 1.6, 0);
        bb.add(leg);
      }
    }
    // Aim at traffic still approaching rather than square at the road beside
    // it: a board turned broadside is only ever seen edge-on from a cockpit.
    const aim = track.point((s - 55 + track.L) % track.L);
    bb.position.set(bx, by, bz);
    bb.rotation.y = Math.atan2(aim.x - bx, aim.z - bz);
    bb.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(bb);
  }

  // --- telephone poles + wires -----------------------------------------------------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b5843, roughness: 0.9 });
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 8.4, 8);
  const armGeo = new THREE.BoxGeometry(2.0, 0.12, 0.12);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1c1f24 });
  const poleEvery = 78; // meters
  const polePts = [];
  for (let d = 0; d < track.L - 30; d += poleEvery) {
    const p = track.point(d);
    const px = p.x + p.nx * (railOff + 3.4);
    const pz = p.z + p.nz * (railOff + 3.4);
    const py = heightAt(px, pz);
    const pole = new THREE.Group();
    const post = new THREE.Mesh(poleGeo, poleMat);
    post.position.y = 4.2;
    post.castShadow = true;
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.y = 7.6;
    arm.rotation.y = p.h;
    pole.add(post, arm);
    pole.position.set(px, py, pz);
    root.add(pole);
    polePts.push(new THREE.Vector3(px, py + 7.55, pz));
  }
  for (let i = 0; i < polePts.length; i++) {
    const a = polePts[i], b = polePts[(i + 1) % polePts.length];
    if (a.distanceTo(b) > poleEvery * 2.2) continue;
    const mid = a.clone().lerp(b, 0.5); mid.y -= 1.3;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(10)), wireMat);
    root.add(wire);
  }

  // --- trees --------------------------------------------------------------------------
  // Impostor trees cost 4 triangles each, so the landscape can be properly
  // wooded. Most random candidates get rejected by the terrain/track tests,
  // hence the generous attempt budget.
  const treeSpots = [];
  let attempts = 0;
  while (treeSpots.length < T.trees && attempts < 26000) {
    attempts++;
    const x = (Math.random() * 2 - 1) * 1500;
    const z = (Math.random() * 2 - 1) * 1500;
    const h = heightAt(x, z);
    if (h < -0.05 || h > T.treeMax) continue;
    if (T.ocean != null && x < -430) continue; // keep the beach clear
    const d = trackDist(x, z);
    if (d < 17 || d > 620) continue;
    treeSpots.push([x, h, z, 0.75 + Math.random() * 1.1, Math.random() * Math.PI * 2]);
  }

  if (treeModel && !_treeImpostors) {
    const variants = splitTreeVariants(treeModel);
    // A multi-tree pack bakes many small textures instead of one big one.
    const width = variants.length > 1 ? 512 : 768;
    _treeImpostors = variants.map((v) => bakeTreeImpostor(renderer, v, width)).filter(Boolean);
    if (!_treeImpostors.length) _treeImpostors = null;
  }
  const impostors = _treeImpostors;
  if (impostors) {
    // Deal the spots across the variants, then draw each variant as one
    // instanced mesh — a dozen draw calls for the whole forest.
    const buckets = impostors.map(() => []);
    for (const spot of treeSpots) buckets[(Math.random() * impostors.length) | 0].push(spot);
    const tint = new THREE.Color();
    world.trees = [];
    impostors.forEach((impostor, vi) => {
      const spots = buckets[vi];
      if (!spots.length) return;
      // alphaTest rather than blending, so foliage sorts correctly against
      // itself. Textures are shared across map rebuilds — dispose() must
      // leave them alone.
      const mat = new THREE.MeshBasicMaterial({
        map: impostor.texture,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        fog: true,
      });
      mat.userData.sharedMap = true;
      const geo = crossedQuads(impostor.aspect);
      const trees = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach(([x, y, z, s, rot], i) => {
        const hgt = 8.5 + s * 4.5;
        q.setFromAxisAngle(UP, rot);
        m4.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(hgt, hgt, hgt));
        trees.setMatrixAt(i, m4);
        // Slight per-tree shade variation so the variants don't read as
        // identical stamps even when two stand side by side.
        tint.setHSL(T.treeHue, T.treeSat, 0.86 + Math.random() * 0.14);
        trees.setColorAt(i, tint);
      });
      trees.instanceMatrix.needsUpdate = true;
      if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
      root.add(trees);
      world.trees.push(trees);
    });
  } else {
    // Fallback: cheap procedural trunk + leaf blobs.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 7);
    trunkGeo.translate(0, 1.3, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1.5, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const blobs = new THREE.InstancedMesh(blobGeo, leafMat, treeSpots.length * 2);
    const leafCol = new THREE.Color();
    treeSpots.forEach((t, i) => {
      const [x, y, z, s, rot] = t;
      q.setFromAxisAngle(UP, rot);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, y + 3.1 * s, z), q, new THREE.Vector3(s * 1.15, s * 1.25, s * 1.15));
      blobs.setMatrixAt(i * 2, m4);
      m4.compose(new THREE.Vector3(x + 0.8 * s, y + 2.3 * s, z + 0.3 * s), q, new THREE.Vector3(s * 0.8, s * 0.8, s * 0.8));
      blobs.setMatrixAt(i * 2 + 1, m4);
      leafCol.setHSL(T.treeHue + 0.01 + Math.random() * 0.06, 0.5, 0.28 + Math.random() * 0.12);
      blobs.setColorAt(i * 2, leafCol);
      blobs.setColorAt(i * 2 + 1, leafCol);
    });
    trunks.castShadow = blobs.castShadow = quality === 'high';
    root.add(trunks, blobs);
  }

  // --- rocks on the high ground ----------------------------------------------------------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: T.rock, roughness: 0.95, flatShading: true });
  const rockSpots = [];
  attempts = 0;
  while (rockSpots.length < T.rocks && attempts < 8000) {
    attempts++;
    const x = (Math.random() * 2 - 1) * 1300;
    const z = (Math.random() * 2 - 1) * 1300;
    const h = heightAt(x, z);
    if (h < T.rockLine - 1) continue;
    if (trackDist(x, z) < 20) continue;
    rockSpots.push([x, h - 0.6, z]);
  }
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rockSpots.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 3, Math.random()));
    const s = 1.6 + Math.random() * 4.4;
    m4.compose(new THREE.Vector3(r[0], r[1], r[2]), q, new THREE.Vector3(s, s * 0.8, s));
    rocks.setMatrixAt(i, m4);
  });
  root.add(rocks);

  // --- festival paddock: tents, bunting, grandstands ---------------------------------------
  // These used to be six solid-colour six-sided cones floating at head height,
  // which read as untextured placeholder geometry — the loudest "programmer
  // art" tell in the scene, and directly at odds with the near-photoreal player
  // car parked in front of them. A tent is now a striped canopy on a proper
  // frame: valance, walls, centre pole and a pennant, with bunting strung
  // between neighbours. Still cheap (a canopy is a 10-segment cone) but it
  // reads as a built object rather than a primitive.
  const tentPairs = [
    [0xff2d78, 0xf4f5f7], [0x1477e8, 0xf4f5f7], [0xffb400, 0x23262b],
    [0x12b8a8, 0xf4f5f7], [0x7a3cf0, 0xf4f5f7], [0xff6a13, 0x23262b],
  ];
  const tentMats = tentPairs.map(([a, b]) => new THREE.MeshStandardMaterial({
    map: tentStripeTexture(a, b), roughness: 0.85, side: THREE.DoubleSide,
  }));
  const tentFrameMat = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.5, metalness: 0.3 });
  const tentWallMat = new THREE.MeshStandardMaterial({ color: 0xeceff3, roughness: 0.9, side: THREE.DoubleSide });
  const canopyGeo = new THREE.ConeGeometry(3.4, 1.9, 10, 1, true);
  const valanceGeo = new THREE.CylinderGeometry(3.4, 3.4, 0.45, 10, 1, true);
  const wallGeo = new THREE.CylinderGeometry(2.5, 2.5, 2.3, 10, 1, true);
  const tentPoleGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6);
  const pennantGeo = new THREE.PlaneGeometry(1.1, 0.5);

  const tentAt = [];
  for (let i = 0; i < 6; i++) {
    const p = track.point(track.L - 44 - i * 16);
    const side = p.nx >= 0 ? 1 : -1;
    const off = railOff + 9 + (i % 2) * 6;
    const tx = p.x + p.nx * side * off;
    const tz = p.z + p.nz * side * off;
    const gy = heightAt(tx, tz);
    const g = new THREE.Group();
    g.position.set(tx, gy, tz);
    g.rotation.y = Math.random() * Math.PI;

    const walls = new THREE.Mesh(wallGeo, tentWallMat);
    walls.position.y = 1.15;
    const valance = new THREE.Mesh(valanceGeo, tentMats[i % tentMats.length]);
    valance.position.y = 2.5;
    const canopy = new THREE.Mesh(canopyGeo, tentMats[i % tentMats.length]);
    canopy.position.y = 3.6;
    const pole = new THREE.Mesh(tentPoleGeo, tentFrameMat);
    pole.position.y = 2.2;
    const pennant = new THREE.Mesh(pennantGeo, tentMats[(i + 1) % tentMats.length]);
    pennant.position.set(0.55, 4.45, 0);
    for (const m of [walls, valance, canopy, pole, pennant]) { m.castShadow = true; g.add(m); }
    root.add(g);
    tentAt.push([tx, gy, tz]);
  }

  // Bunting strung tent-to-tent. One double-sided strip per span, sagging in
  // the middle — the sag is what stops it reading as a floating rectangle.
  if (tentAt.length > 1) {
    const buntMat = new THREE.MeshBasicMaterial({
      map: buntingTexture(), transparent: true, side: THREE.DoubleSide,
      depthWrite: false, alphaTest: 0.35, fog: true,
    });
    for (let i = 0; i < tentAt.length - 1; i++) {
      const [ax, ay, az] = tentAt[i], [bx, by, bz] = tentAt[i + 1];
      const span = Math.hypot(bx - ax, bz - az);
      if (span > 34) continue;   // neighbours on opposite sides of the paddock
      const SEG = 8;
      const pos = [], uv = [], idx = [];
      const topY = 3.9, sag = 0.9, drop = 1.0;
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const yBase = (ay + (by - ay) * t) + topY - Math.sin(t * Math.PI) * sag;
        pos.push(x, yBase, z, x, yBase - drop, z);
        uv.push(t * (span / 8), 1, t * (span / 8), 0);
      }
      for (let k = 0; k < SEG; k++) {
        const o = k * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      bg.setIndex(idx);
      bg.computeVertexNormals();
      const strip = new THREE.Mesh(bg, buntMat);
      strip.material.map.wrapS = THREE.RepeatWrapping;
      root.add(strip);
    }
  }

  // --- grandstands at start/finish ---------------------------------------------------------
  // The horizon around the line was empty, which is what made a 12-car race
  // look like a private test day. A raked stand of spectators on each side
  // gives the start something to be the start OF.
  {
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.95 });
    const standMat = new THREE.MeshStandardMaterial({ color: 0x3a4049, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    // Set back well behind the rail: at trackside they flanked the start like a
    // canyon and filled the countdown camera instead of framing it.
    const W = 30, D = 8, H = 5.6;
    for (const side of [-1, 1]) {
      const p = track.point(track.L - 12);
      const off = railOff + 22;
      const cx = p.x + p.nx * side * off;
      const cz = p.z + p.nz * side * off;
      const gy = heightAt(cx, cz);
      const g = new THREE.Group();
      g.position.set(cx, gy, cz);
      // Face the track: +Z of the group points at the road.
      g.rotation.y = Math.atan2(-p.nx * side, -p.nz * side);

      const base = new THREE.Mesh(new THREE.BoxGeometry(W, 1.1, D), standMat);
      base.position.set(0, 0.55, -D / 2);
      base.castShadow = base.receiveShadow = true;
      g.add(base);

      // Raked seating: one crowd plane leaning back over stepped risers.
      const rake = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.5, Math.hypot(D, H - 1.1)), crowdMat);
      rake.position.set(0, (H + 1.1) / 2, -D / 2);
      rake.rotation.x = -Math.atan2(D, H - 1.1);
      g.add(rake);

      for (const [i, sideX] of [[0, -1], [1, 1]]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, H, D), standMat);
        wall.position.set(sideX * (W / 2 - 0.25), H / 2, -D / 2);
        wall.castShadow = true;
        g.add(wall);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D * 0.85), roofMat);
      roof.position.set(0, H + 0.9, -D * 0.62);
      roof.castShadow = true;
      g.add(roof);
      for (const sx of [-1, -0.33, 0.33, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, H + 0.9, 6), roofMat);
        col.position.set(sx * (W / 2 - 1.2), (H + 0.9) / 2, -D * 0.98);
        col.castShadow = true;
        g.add(col);
      }
      root.add(g);
    }
  }

  // --- checkpoint gates ---------------------------------------------------------------------
  const cpMat = new THREE.MeshStandardMaterial({ color: 0x35e0e6, emissive: 0x1899a0, emissiveIntensity: 1.1 });
  const cpGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.8, 8);
  const NCP = 8;
  for (let k = 0; k < NCP; k++) {
    const scp = (k / NCP) * track.L;
    const p = track.point(scp);
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(cpGeo, cpMat);
      pole.position.set(p.x + p.nx * side * (ROAD_HALF + 0.6), 1.4, p.z + p.nz * side * (ROAD_HALF + 0.6));
      root.add(pole);
    }
    world.checkpoints.push({ s: scp, x: p.x, z: p.z });
  }

  // --- per-frame update -----------------------------------------------------------------------
  world.update = (dt, playerPos) => {
    // ~30 degrees elevation. A high sun tucks the shadow directly under the car
    // where the bodywork hides it, which makes cars look pasted onto the road;
    // a lower sun throws the shadow out to the side where you can see it.
    sun.position.set(playerPos.x + 175, 118, playerPos.z + 105);
    sun.target.position.copy(playerPos);
    for (const c of clouds.children) {
      c.position.x += dt * 2.2;
      if (c.position.x > 2300) c.position.x = -2300;
    }
  };

  return world;
}
