// Render the game's branding art — portal covers, a wide banner and a wordmark —
// from the real car model, so the art can never drift from what ships.
//
// Needs the dev server running (npm start) and Chrome installed.
//
//   node scripts/make-branding.mjs
//   node scripts/make-branding.mjs --name "Some Other Name" --port 4300
//   node scripts/make-branding.mjs --car Vulpine      # a bot car instead of the player's
//
// Output lands in branding/. Cover sizes and rules come from
// https://docs.crazygames.com/requirements/game-covers/ — three covers are
// mandatory (landscape 1920x1080, portrait 800x1200, square 800x800), and they
// must carry the game title and NOTHING else: no tagline, no borders, no store
// icons. The wide banner and wordmark are for our own README/store pages, where
// a tagline is fine.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'branding');
const TMP_PAGE = join(ROOT, 'public', '_branding.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const argv = process.argv.slice(2);
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
// The first word takes the cyan, the rest the accent pink — the same split the
// lobby logo uses. A "|" marks the colour break without inserting a space, for
// joined wordmarks like NOX|RUSH; otherwise the break is the first space.
const NAME = arg('--name', 'NOX|RUSH').toUpperCase();
const TAGLINE = arg('--tagline', 'ARCADE FESTIVAL RACING').toUpperCase();
const PORT = arg('--port', '4300');
const CAR = arg('--car', 'player');   // 'player' = the Kestrel, else a pack car name
const BASE = `http://127.0.0.1:${PORT}`;

const SHOTS = [
  // CrazyGames mandatory covers — title only, no tagline, no border.
  { file: 'cover-landscape-1920x1080.png', w: 1920, h: 1080, layout: 'landscape', tagline: false },
  { file: 'cover-portrait-800x1200.png', w: 800, h: 1200, layout: 'portrait', tagline: false },
  { file: 'cover-square-800x800.png', w: 800, h: 800, layout: 'square', tagline: false },
  // Ours to use freely.
  { file: 'banner-wide-2560x800.png', w: 2560, h: 800, layout: 'banner', tagline: true },
  { file: 'logo-wordmark-1600x500.png', w: 1600, h: 500, layout: 'wordmark', tagline: true, alpha: true },
];

// ---------------------------------------------------------------- the page
const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>branding</title>
<script type="importmap">
{ "imports": { "three": "/vendor/three/build/three.module.js", "three/addons/": "/vendor/three/examples/jsm/" } }
</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { background: transparent; }
  /* Painted ground for everything except the transparent wordmark. */
  #bg { position: fixed; inset: 0; background:
      radial-gradient(120% 90% at 78% 18%, #1d4f7a 0%, #12203a 46%, #080c16 100%); }
  /* Two diagonal light sweeps in the brand colours, like the in-game banner. */
  #bg::after { content: ''; position: absolute; inset: 0;
    background:
      linear-gradient(104deg, transparent 38%, rgba(53,224,230,.22) 46%, transparent 54%),
      linear-gradient(104deg, transparent 56%, rgba(255,45,120,.26) 64%, transparent 72%); }
  /* Horizon glow so the car has something to sit against. */
  #glow { position: fixed; left: -10%; right: -10%; height: 42%; bottom: 8%;
    background: radial-gradient(60% 100% at 50% 100%, rgba(53,224,230,.30), transparent 70%); }
  #stage { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; }
  #brand { position: fixed; color: #fff; font-style: italic; font-weight: 900;
    font-family: 'Helvetica Neue', 'Arial Black', Impact, Arial, sans-serif;
    letter-spacing: -.005em; line-height: .92; text-align: left;
    text-shadow: 0 6px 30px rgba(0,0,0,.55); }
  #brand .w1 { color: #35e0e6; }
  #brand .w2 { color: #ff2d78; }
  #tag { display: block; color: #dfe8f5; font-style: normal; font-weight: 700;
    opacity: .85; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
  body.wordmark #bg, body.wordmark #glow, body.wordmark #stage { display: none; }
  /* On transparency a drop shadow composites as grey mud, and the near-white
     tagline vanishes on light backgrounds — so drop the shadow and use a mid
     slate that holds up on both light and dark. */
  body.wordmark #brand { text-shadow: none; }
  body.wordmark #tag { color: #74869c; opacity: 1; text-shadow: none; }
</style></head>
<body>
<div id="bg"></div><div id="glow"></div><div id="stage"></div>
<div id="brand"></div>
<script type="module">
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCarTemplate, loadCarPack, instantiateTemplate } from '/js/carModels.js';
import { setCarTemplate, setCarPack, createCar, animateCar } from '/js/car.js';

const q = new URLSearchParams(location.search);
const LAYOUT = q.get('layout') || 'landscape';
const NAME = (q.get('name') || 'REDLINE BAY');
const TAGLINE = q.get('tagline') || '';
const CAR = q.get('car') || 'player';
window.__ready = false;

// Per-layout framing. Title/tagline sizes are in viewport-width units so a size
// change rescales the whole composition instead of clipping it.
// The canvas is always full-bleed; the car is placed by moving it in the scene
// (carX/carZ) rather than by insetting the canvas, so the framing is predictable
// at any output size. "look" is the camera target.
const L = {
  landscape: { cam: [6.0, 1.55, 6.4], look: [1.15, .45, 0], fov: 30, carX: 1.5, carZ: 0,
               title: 7.0, tag: 1.2, pos: { left: '5%', top: '11%' }, stage: true },
  // Tall/square frames need the camera further out or the bumper and rear wing
  // clip at the edges. Aiming at roughly the car's own centre height (~0.7 m)
  // puts it mid-frame rather than crowding the top with dead space beneath.
  // 2:3 is the awkward one: its horizontal field is only ~4 m at a sensible
  // distance, narrower than the 4.8 m car, so a side-on 3/4 always clips. Swing
  // the camera round towards the nose instead — a front-biased 3/4 is a much
  // narrower silhouette, and more aggressive besides.
  portrait:  { cam: [3.3, 1.95, 8.6], look: [0, .70, 0], fov: 31, carX: 0, carZ: 0,
               title: 12.5, tag: 2.3, pos: { left: '7%', top: '6%' }, stage: true },
  square:    { cam: [7.0, 2.05, 7.5], look: [0, .70, 0], fov: 32, carX: 0, carZ: 0,
               title: 11.5, tag: 2.1, pos: { left: '6.5%', top: '7%' }, stage: true },
  banner:    { cam: [6.2, 1.5, 6.2], look: [1.9, .45, 0], fov: 27, carX: 2.5, carZ: 0,
               title: 5.4, tag: 1.0, pos: { left: '4%', top: '25%' }, stage: true },
  wordmark:  { cam: [6.0, 1.55, 6.4], look: [0, .45, 0], fov: 30, carX: 0, carZ: 0,
               title: 11.0, tag: 2.0, pos: { left: '6%', top: '24%' }, stage: false },
}[LAYOUT];

// Title: first word cyan, rest accent pink. A "|" splits without a space so a
// joined wordmark (NOXRUSH) still gets two colours.
let w1, w2, gap;
const bar = NAME.indexOf('|');
if (bar >= 0) {
  w1 = NAME.slice(0, bar); w2 = NAME.slice(bar + 1); gap = '';
} else {
  const parts = NAME.trim().split(/\\s+/);
  w1 = parts.shift() || ''; w2 = parts.join(' '); gap = ' ';
}
const brand = document.getElementById('brand');
brand.innerHTML = \`<span class="w1">\${w1}</span>\${w2 ? gap + '<span class="w2">' + w2 + '</span>' : ''}\` +
  (TAGLINE ? \`<span id="tag">\${TAGLINE}</span>\` : '');
brand.style.fontSize = L.title + 'vw';
Object.assign(brand.style, L.pos);
const tag = document.getElementById('tag');
if (tag) {
  tag.style.fontSize = (L.tag / L.title) + 'em';
  tag.style.letterSpacing = '.34em';
  tag.style.marginTop = '.5em';
}
if (LAYOUT === 'wordmark') document.body.classList.add('wordmark');

try {
  if (L.stage) {
    const stage = document.getElementById('stage');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Room environment gives the clearcoat something to reflect; without it the
    // paint reads flat and plasticky.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.HemisphereLight(0xdfefff, 0x223044, .9));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(5, 8, 7);
    // A cast shadow is what stops the car reading as floating in space.
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6; key.shadow.camera.right = 6;
    key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 30;
    key.shadow.bias = -0.0008;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x35e0e6, 2.4); rim.position.set(-6, 3, -5);
    scene.add(rim);
    const warm = new THREE.DirectionalLight(0xff2d78, 1.6); warm.position.set(-3, 1.4, 6);
    scene.add(warm);

    // Shadow-only floor. A lit floor plane would be a grey studio backdrop with a
    // hard horizon across the image; ShadowMaterial draws nothing but the shadow,
    // so the CSS gradient stays visible and the car still sits on something.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 64), new THREE.ShadowMaterial({ opacity: .55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    setCarTemplate(await loadCarTemplate());
    const pack = await loadCarPack();
    setCarPack(pack);

    // Warm orange separates hard from the cyan/blue backdrop; a cool paint
    // disappears into it.
    const PAINT = 0xff6a13;
    let car;
    if (CAR === 'player') {
      car = createCar(PAINT, { kind: 'player', spoiler: true });
    } else {
      const tpl = pack.find(t => t.name.toLowerCase().startsWith(CAR.toLowerCase()));
      if (!tpl) throw new Error('no pack car named ' + CAR);
      const inst = instantiateTemplate(tpl, PAINT);
      car = { group: new THREE.Group(), body: inst.group, rigs: inst.rigs, tailMats: inst.tailMats };
      car.group.add(inst.group);
    }
    // A little steering + roll so it reads as moving, not parked.
    animateCar(car, 24, 0.55, 0, 1 / 60);
    car.group.rotation.y = -0.10;
    car.group.position.set(L.carX, 0, L.carZ);
    car.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(car.group);

    const cam = new THREE.PerspectiveCamera(L.fov, stage.clientWidth / stage.clientHeight, .1, 200);
    cam.position.set(L.cam[0] + L.carX, L.cam[1], L.cam[2]);
    cam.lookAt(...L.look);
    renderer.render(scene, cam);
  }
  window.__ready = true;
} catch (e) {
  document.title = 'ERR ' + e.message;
  console.log('BRANDING ERROR ' + e.message + ' | ' + (e.stack || ''));
  window.__ready = true;
}
</script></body></html>`;

// ---------------------------------------------------------------- driver
async function main() {
  const probe = await fetch(BASE + '/').catch(() => null);
  if (!probe || !probe.ok) {
    console.error(`No server on ${BASE} — start it with \`npm start\` first.`);
    process.exit(1);
  }
  if (!existsSync(CHROME)) { console.error('Google Chrome not found at ' + CHROME); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(TMP_PAGE, page);
  const profile = mkdtempSync(join(tmpdir(), 'brand-'));
  const port = 9500 + (process.pid % 300);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let ws;
  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl || null;
      } catch {}
    }
    if (!wsUrl) throw new Error('Chrome devtools never came up');

    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') {
        const t = m.params.args.map(a => a.value ?? '').join(' ');
        if (t.startsWith('BRANDING ERROR')) logs.push(t);
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');

    for (const s of SHOTS) {
      const url = `${BASE}/_branding.html?layout=${s.layout}` +
        `&name=${encodeURIComponent(NAME)}` +
        `&tagline=${encodeURIComponent(s.tagline ? TAGLINE : '')}` +
        `&car=${encodeURIComponent(CAR)}`;
      await send('Emulation.setDeviceMetricsOverride',
        { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setDefaultBackgroundColorOverride',
        s.alpha ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      await send('Page.navigate', { url });

      let ok = false;
      for (let i = 0; i < 80; i++) {
        await sleep(250);
        const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true });
        if (r?.result?.value) { ok = true; break; }
      }
      await sleep(500);
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      if (!shot?.data) { console.log(`  FAILED ${s.file} (no data)`); continue; }
      writeFileSync(join(OUT, s.file), Buffer.from(shot.data, 'base64'));
      console.log(`  ${s.file.padEnd(34)} ${s.w}x${s.h}${ok ? '' : '  (timed out waiting for render)'}`);
    }
    if (logs.length) console.log('\nPage errors:\n' + logs.join('\n'));
  } finally {
    if (ws) ws.close();
    chrome.kill('SIGKILL');
    rmSync(TMP_PAGE, { force: true });
    rmSync(profile, { recursive: true, force: true });
  }
  console.log(`\nwrote ${SHOTS.length} files to branding/`);
}

main().then(() => process.exit(0));
