// Playability gates. `check-dist.mjs` proves the bundle is self-contained;
// this proves the GAME is playable, which is the thing a portal actually
// rejected the build over.
//
//   node scripts/build-web.js && node scripts/check-quality.mjs
//
// Four assertions, each tied to a specific way the build previously failed:
//
//   1. The button that starts a race is visible and fully inside the viewport,
//      at desktop and at both phone orientations. The lobby card once ran
//      848 px of content into a 279 px scroll box on a landscape phone and put
//      every start control below the fold.
//   2. A cold load reaches a car the player can steer, with no text entry on
//      the path. The old front door was step 1 of 4 of a wizard whose primary
//      control was a "driver name" field.
//   3. No two HUD zones overlap and none hangs off-screen, at any of the three
//      sizes. The nitro meter used to land on the position readout.
//   4. A rival is on screen for most of a driven race. Gridding the player
//      last meant the field vanished and the whole race was run alone.
//
// Gate 5 — "someone who has never seen it plays it" — cannot be automated and
// is reported here as a reminder, not a pass.
//
// NOTE ON SPEED: this renders with SwiftShader (no GPU in CI), which runs at a
// few frames a second. That is deliberately kept honest — the driving gate
// measures the game, and the frame-rate floor it exercises is exactly the
// low-end case a portal tests. Expect a few minutes.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, extname, normalize, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirArg = process.argv.indexOf('--dir');
const DIST = join(ROOT, dirArg >= 0 && process.argv[dirArg + 1] ? process.argv[dirArg + 1] : 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUBPATH = '/games/noxrush/';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no ${relative(ROOT, DIST)}/index.html — run node scripts/build-web.js first`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!rel.startsWith(SUBPATH)) { res.writeHead(404).end('nope'); return; }
  rel = rel.slice(SUBPATH.length) || 'index.html';
  const file = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('nope'); return; }
  const type = MIME[extname(file)] || 'application/octet-stream';
  if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': type }); res.end(); return; }
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${SUBPATH}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One headless page, torn down after `run` returns.
async function page({ w, h, mobile = false, url = BASE }, run) {
  const profile = mkdtempSync(join(tmpdir(), 'quality-'));
  const dbg = 9300 + (process.pid % 200) + (mobile ? 1 : 0) + Math.floor(Math.random() * 40);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio', `--window-size=${w},${h}`, 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let wsUrl = null;
    for (let i = 0; i < 80 && !wsUrl; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
      } catch {}
    }
    if (!wsUrl) throw new Error('Chrome devtools never came up');
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const myId = ++id; pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
      return r?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    if (mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const t0 = Date.now();
    await send('Page.navigate', { url });
    return await run({ ev, t0, errors });
  } finally {
    if (ws) ws.close();
    chrome.kill('SIGKILL');
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  }
}

// Every HUD zone must be disjoint from every other and inside the viewport.
const OVERLAP = `(() => {
  const sel = ['.hud-topleft','.hud-topright','.hud-bottomleft','.hud-bottomright',
               '#checkpoint','.chain:not(.hidden)','#coach:not(.hidden)'];
  const rects = sel.map(s => [s, document.querySelector(s)])
    .filter(([, e]) => e && e.offsetParent !== null)
    .map(([s, e]) => [s, e.getBoundingClientRect()]);
  const hits = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i][1], b = rects[j][1];
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) hits.push(rects[i][0] + ' x ' + rects[j][0]);
  }
  const off = rects.filter(([, r]) =>
    r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2).map(([s]) => s);
  return JSON.stringify({ hits, off, zones: rects.length });
})()`;

const VIEWS = [
  { name: 'desktop 1280x720', w: 1280, h: 720, mobile: false },
  { name: 'phone landscape 844x390', w: 844, h: 390, mobile: true },
  { name: 'phone portrait 390x844', w: 390, h: 844, mobile: true },
];

const checks = [];
const note = (name, ok, detail = '') => checks.push([name, ok, detail]);

// ---------------------------------------------------------------- gate 1 + 3
for (const v of VIEWS) {
  // Gate 1 needs the menu, which is no longer the front door.
  const start = await page({ w: v.w, h: v.h, mobile: v.mobile, url: BASE + '?menu=1' }, async ({ ev }) => {
    for (let i = 0; i < 200; i++) {
      await sleep(150);
      if (await ev(`!!document.querySelector('#lobby .lobby-card')`)) break;
    }
    await sleep(1800);
    return JSON.parse(await ev(`(() => {
      const b = document.getElementById('quickBtn');
      if (!b) return JSON.stringify({ missing: true });
      const r = b.getBoundingClientRect();
      const card = document.querySelector('.lobby-card');
      return JSON.stringify({
        visible: getComputedStyle(b).display !== 'none' && b.offsetParent !== null,
        inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        cardScrolls: card.scrollHeight > card.clientHeight + 4,
        label: b.textContent.trim(),
      });
    })()`));
  });
  note(`[1] start button reachable — ${v.name}`,
    !!start.visible && !!start.inViewport && !start.cardScrolls,
    JSON.stringify(start));

  const hud = await page({ w: v.w, h: v.h, mobile: v.mobile }, async ({ ev }) => {
    for (let i = 0; i < 250; i++) {
      await sleep(150);
      if (await ev(`window.__game && window.__game.phase !== 'lobby'`)) break;
    }
    await sleep(6500);   // through the countdown and into the race
    return JSON.parse(await ev(OVERLAP));
  });
  note(`[3] HUD zones disjoint & on-screen — ${v.name}`,
    hud.hits.length === 0 && hud.off.length === 0 && hud.zones >= 4,
    JSON.stringify(hud));
}

// ---------------------------------------------------------------- gate 2 + 4
const race = await page({ w: 1280, h: 720 }, async ({ ev, t0, errors }) => {
  let ready = 0;
  for (let i = 0; i < 250; i++) {
    await sleep(120);
    if (await ev(`window.__game && window.__game.phase !== 'lobby'`)) { ready = Date.now() - t0; break; }
  }
  // Nothing on the path to a race may demand typing.
  const typed = await ev(`(() => {
    const a = document.activeElement;
    const lobbyUp = !document.getElementById('lobby').classList.contains('hidden');
    return JSON.stringify({ lobbyUp, focusTag: a ? a.tagName : null });
  })()`);

  await ev(`window.__k = (c, d) =>
    window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c, bubbles: true })); 'ok'`);
  // Drive the racing line at a pace a competent player would hold, so the
  // rival-visibility figure reflects the game and not a bad driver.
  await ev(`
    window.__auto = true;
    (function pilot() {
      const g = window.__game;
      if (window.__auto && g && g.phase === 'race' && !g.finished) {
        const c = g.car, t = g.track, sp = Math.hypot(c.vx, c.vz);
        const look = 11 + sp * 0.6;
        const p = t.point(c.s + look), off = t.lineOffset(c.s + look);
        let d = Math.atan2(p.x + p.nx * off - c.x, p.z + p.nz * off - c.z) - c.h;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const steer = Math.max(-1, Math.min(1, -d * 2.0));
        const cAhead = t.curvAheadMax(c.s, 14 + sp * sp / 42);
        const target = Math.min(46, Math.sqrt(15 / Math.max(1e-4, cAhead)));
        window.__k('KeyA', steer < -0.30); window.__k('KeyD', steer > 0.30);
        window.__k('KeyW', sp < target);   window.__k('KeyS', sp > target + 4);
      }
      requestAnimationFrame(pilot);
    })(); 'ok'`);
  await sleep(3400);

  const samples = [];
  for (let i = 0; i < 24; i++) {
    await sleep(850);
    samples.push(JSON.parse(await ev(`(() => {
      let onScreen = 0;
      for (const el of document.querySelectorAll('.plate')) if (el.style.display !== 'none') onScreen++;
      const g = window.__game, c = g.car;
      let nearest = 9999;
      for (const [, v] of g.visuals) if (v.shown) nearest = Math.min(nearest, Math.hypot(v.x - c.x, v.z - c.z));
      return JSON.stringify({ onScreen, nearest: Math.round(nearest) });
    })()`)));
  }
  await ev(`window.__auto = false;`);
  return { ready, typed: JSON.parse(typed), samples, errors };
});

note('[2] cold load reaches a race under 10 s', race.ready > 0 && race.ready < 10000, `${race.ready} ms`);
note('[2] no menu or text entry on the way in',
  race.typed.lobbyUp === false && race.typed.focusTag !== 'INPUT',
  JSON.stringify(race.typed));
const withRival = race.samples.filter((s) => s.onScreen > 0).length;
const pct = Math.round((withRival / race.samples.length) * 100);
note('[4] a rival is on screen for most of the race', pct >= 50,
  `${withRival}/${race.samples.length} samples (${pct}%)`);
note('[4] no page exceptions while racing', race.errors.length === 0, race.errors.slice(0, 3).join(' | '));

// ---------------------------------------------------------------- report
console.log(`\nplayability gates — ${relative(ROOT, DIST)}/ served at ${BASE}\n`);
let bad = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail && !ok) console.log(`        ${detail}`);
}
bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n  rival on screen: ${pct}% of samples; ` +
  `nearest rival ranged ${Math.min(...race.samples.map(s => s.nearest))}–` +
  `${Math.max(...race.samples.map(s => s.nearest))} m`);
console.log('\n  [5] MANUAL — hand the build to someone who has never seen it, say nothing, and watch.');
console.log(bad ? `\n${bad} gate(s) failed\n` : '\nAll playability gates passed\n');
server.close();
process.exitCode = bad ? 1 : 0;
