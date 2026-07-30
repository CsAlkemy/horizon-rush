// World construction: sky, lighting, terrain, ocean, road + trackside props.
// Everything is generated (canvas textures, procedural terrain) — no assets.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ROAD_HALF, SHOULDER, ROAD_Y } from '/shared/track.js';

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

function billboardTexture() {
  return canvasTexture(1024, 640, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1477e8');
    grad.addColorStop(1, '#0b4fc0');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.55, 0); g.lineTo(w * 0.8, 0); g.lineTo(w * 0.25, h); g.fill();
    g.fillStyle = '#fff';
    g.font = 'italic 900 380px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('R', w / 2, h / 2 - 20);
    g.font = 'italic 800 64px "Segoe UI", Arial, sans-serif';
    g.fillText('HORIZON RUSH', w / 2, h - 70);
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
    g.fillText('HORIZON RUSH', w / 2, h / 2 + 8);
  });
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
// A detailed tree model is far too heavy to instance across a landscape (the
// supplied one is 551k triangles — 260 of those would be 143M triangles a
// frame). So render the real model once into a texture at startup and draw it on
// crossed quads: the trees still look like the model, at 4 triangles each.
function bakeTreeImpostor(renderer, treeScene, width = 768) {
  const box = new THREE.Box3().setFromObject(treeScene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, size.z), h = size.y;
  if (!(w > 0 && h > 0)) return null;

  const height = Math.max(64, Math.round(width * (h / w)));
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });

  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, w * 8);
  cam.position.set(center.x, center.y, center.z + Math.max(w, h) * 3);
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

  // The source model has done its job — free the 551k triangles it was holding.
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

// ------------------------------------------------------------- main builder
export function buildWorld(scene, renderer, track, quality, treeModel = null) {
  const world = { checkpoints: [], quality };

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
    let h = (e - 0.34) * 46;
    const inland = smoothstep(-150, 460, x * 0.8 + z * 0.45);
    h *= 0.5 + inland * 1.25;
    // Coast drops away west of the circuit (track min x is about -390).
    const coast = smoothstep(-440, -700, x);
    h = h * (1 - coast) - 9 * coast;
    const d = trackDist(x, z);
    // Depress terrain slightly below the road plane near the track so the thin
    // road ribbon never z-fights or pokes through terrain triangles.
    const m = smoothstep(18, 95, d);
    h = h * m - (1 - m) * 0.45;
    return Math.max(-9, h);
  }
  world.heightAt = heightAt;

  // --- environment / sky ---------------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.fog = new THREE.Fog(0xcfe0f0, 320, 2700);

  const skyGeo = new THREE.SphereGeometry(4200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d7fd6) },
      mid: { value: new THREE.Color(0x8fb8e8) },
      bot: { value: new THREE.Color(0xd8e6f2) },
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
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // clouds
  const cloudTex = cloudTexture();
  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m);
    const a = Math.random() * Math.PI * 2, r = 500 + Math.random() * 1500;
    sp.position.set(Math.cos(a) * r, 150 + Math.random() * 160, Math.sin(a) * r);
    const sc = 220 + Math.random() * 320;
    sp.scale.set(sc, sc * 0.45, 1);
    clouds.add(sp);
  }
  scene.add(clouds);
  world.clouds = clouds;

  // --- lights ----------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xbdd8f2, 0x5a6a52, 0.85));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
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
  scene.add(sun, sun.target);
  world.sun = sun;

  // --- terrain -----------------------------------------------------------------
  const TG = 240;
  const terrGeo = new THREE.PlaneGeometry(4200, 4200, TG, TG);
  terrGeo.rotateX(-Math.PI / 2);
  const tp = terrGeo.attributes.position;
  const colors = new Float32Array(tp.count * 3);
  const cGrass = new THREE.Color(0x4b6b2f), cGrass2 = new THREE.Color(0x3c5a26);
  const cSand = new THREE.Color(0xcbb27a), cRock = new THREE.Color(0x6f6a62);
  const col = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const h = heightAt(x, z);
    tp.setY(i, h);
    const n = fbm(x * 0.02, z * 0.02);
    col.copy(cGrass).lerp(cGrass2, n);
    // Sand only on the western beach strip and underwater — grass elsewhere,
    // including the flattened corridor around the road.
    const beach = smoothstep(-430, -560, x);
    const sandMix = Math.max(beach, smoothstep(-0.3, -2.5, h));
    col.lerp(cSand, sandMix);
    if (h > 11) col.lerp(cRock, smoothstep(11, 22, h));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ocean
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ color: 0x1a6fa8, roughness: 0.16, metalness: 0.08, envMapIntensity: 1.1 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -2.4;
  scene.add(ocean);

  // --- road -----------------------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0 });
  roadMat.map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const road = new THREE.Mesh(loopStrip(track,
    (s) => [s.x - s.nx * ROAD_HALF, ROAD_Y, s.z - s.nz * ROAD_HALF],
    (s) => [s.x + s.nx * ROAD_HALF, ROAD_Y, s.z + s.nz * ROAD_HALF],
    8), roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // sand shoulders
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xc9b078, roughness: 1 });
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
    scene.add(sh);
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
    scene.add(curb);
  }

  // --- guardrails -------------------------------------------------------------
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide });
  const railOff = ROAD_HALF + SHOULDER + 0.25;
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(loopStrip(track,
      (s) => [s.x + s.nx * side * railOff, 0.42, s.z + s.nz * side * railOff],
      (s) => [s.x + s.nx * side * railOff, 0.78, s.z + s.nz * side * railOff],
      4), railMat);
    scene.add(band);
  }
  // rail posts (instanced)
  const postGeo = new THREE.BoxGeometry(0.09, 0.8, 0.14);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7c828a, metalness: 0.7, roughness: 0.5 });
  const postEvery = Math.max(1, Math.round(4 / track.ds));
  const postCount = Math.floor(track.N / postEvery) * 2;
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
  scene.add(posts);

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
  scene.add(gantry);

  const checker = new THREE.Mesh(
    rangeStrip(track, track.N - 2, 2,
      (s) => [s.x - s.nx * ROAD_HALF, ROAD_Y + 0.02, s.z - s.nz * ROAD_HALF],
      (s) => [s.x + s.nx * ROAD_HALF, ROAD_Y + 0.02, s.z + s.nz * ROAD_HALF], 4),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 })
  );
  scene.add(checker);

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
    scene.add(sign);
  }

  // --- billboards -----------------------------------------------------------------
  const bbTex = billboardTexture();
  for (const fs of [0.06, 0.27, 0.5, 0.72, 0.9]) {
    const p = track.point(fs * track.L);
    // Stand them on the inland side (larger x) so they never end up in the sea.
    const side = p.nx >= 0 ? 1 : -1;
    const bx = p.x + p.nx * side * (railOff + 9);
    const bz = p.z + p.nz * side * (railOff + 9);
    const by = heightAt(bx, bz);
    const bb = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(13, 8.1),
      new THREE.MeshStandardMaterial({ map: bbTex, side: THREE.DoubleSide, roughness: 0.6 }));
    panel.position.y = 7.2;
    bb.add(panel);
    for (const lx of [-5, 0, 5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.6, 0.45), towerMat);
      leg.position.set(lx, 1.6, 0);
      bb.add(leg);
    }
    bb.position.set(bx, by, bz);
    bb.rotation.y = Math.atan2(p.x - bx, p.z - bz);
    bb.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(bb);
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
    scene.add(pole);
    polePts.push(new THREE.Vector3(px, py + 7.55, pz));
  }
  for (let i = 0; i < polePts.length; i++) {
    const a = polePts[i], b = polePts[(i + 1) % polePts.length];
    if (a.distanceTo(b) > poleEvery * 2.2) continue;
    const mid = a.clone().lerp(b, 0.5); mid.y -= 1.3;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(10)), wireMat);
    scene.add(wire);
  }

  // --- trees --------------------------------------------------------------------------
  // Impostor trees cost 4 triangles each, so the landscape can be properly
  // wooded. Most random candidates get rejected by the terrain/track tests,
  // hence the generous attempt budget.
  const treeSpots = [];
  let attempts = 0;
  while (treeSpots.length < 420 && attempts < 26000) {
    attempts++;
    const x = (Math.random() * 2 - 1) * 1500;
    const z = (Math.random() * 2 - 1) * 1500;
    const h = heightAt(x, z);
    if (h < -0.05 || h > 21) continue;
    if (x < -430) continue; // keep the beach clear
    const d = trackDist(x, z);
    if (d < 17 || d > 620) continue;
    treeSpots.push([x, h, z, 0.75 + Math.random() * 1.1, Math.random() * Math.PI * 2]);
  }

  const impostor = treeModel ? bakeTreeImpostor(renderer, treeModel) : null;
  if (impostor) {
    // alphaTest rather than blending, so foliage sorts correctly against itself.
    const mat = new THREE.MeshBasicMaterial({
      map: impostor.texture,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      fog: true,
    });
    const geo = crossedQuads(impostor.aspect);
    const trees = new THREE.InstancedMesh(geo, mat, treeSpots.length);
    const tint = new THREE.Color();
    treeSpots.forEach(([x, y, z, s, rot], i) => {
      const hgt = 8.5 + s * 4.5;
      q.setFromAxisAngle(UP, rot);
      m4.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(hgt, hgt, hgt));
      trees.setMatrixAt(i, m4);
      // Slight per-tree shade variation so a single baked image does not read
      // as one tree stamped 300 times.
      tint.setHSL(0.28, 0.06, 0.86 + Math.random() * 0.14);
      trees.setColorAt(i, tint);
    });
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    scene.add(trees);
    world.trees = trees;
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
      leafCol.setHSL(0.29 + Math.random() * 0.06, 0.5, 0.28 + Math.random() * 0.12);
      blobs.setColorAt(i * 2, leafCol);
      blobs.setColorAt(i * 2 + 1, leafCol);
    });
    trunks.castShadow = blobs.castShadow = quality === 'high';
    scene.add(trunks, blobs);
  }

  // --- rocks on the high ground ----------------------------------------------------------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95, flatShading: true });
  const rockSpots = [];
  attempts = 0;
  while (rockSpots.length < 46 && attempts < 3000) {
    attempts++;
    const x = (Math.random() * 2 - 1) * 1300;
    const z = (Math.random() * 2 - 1) * 1300;
    const h = heightAt(x, z);
    if (h < 10) continue;
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
  scene.add(rocks);

  // --- festival tents near start ----------------------------------------------------------
  const tentCols = [0xff2d78, 0x1477e8, 0xffb400, 0x12b8a8, 0x7a3cf0, 0xff6a13];
  for (let i = 0; i < 6; i++) {
    const p = track.point(track.L - 40 - i * 14);
    const side = p.nx >= 0 ? 1 : -1;
    const off = railOff + 7 + (i % 2) * 5;
    const tx = p.x + p.nx * side * off;
    const tz = p.z + p.nz * side * off;
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: tentCols[i % tentCols.length], roughness: 0.8 })
    );
    tent.position.set(tx, heightAt(tx, tz) + 1.2, tz);
    tent.castShadow = true;
    scene.add(tent);
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
      scene.add(pole);
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
