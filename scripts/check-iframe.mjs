// Prove the portal build still works when a portal actually embeds it: in a
// cross-origin iframe, on a subpath, on a touch device.
//
//   node scripts/build-web.js && node scripts/check-iframe.mjs
//
// check-dist.mjs proves the bundle is self-contained. This proves the things
// that only break once someone else's page is wrapping it:
//
//   1. localStorage works at all inside a third-party iframe. Chrome partitions
//      storage by top-level site, so the game gets its own bucket rather than
//      the one it would get standalone — fine, as long as it is writable.
//   2. That bucket SURVIVES a reload. This is the one that silently destroys
//      player progression: every hr_* key (level, XP, PBs, medals) lives in
//      localStorage, and a partition that resets per-load wipes all of it.
//   3. Keyboard events reach the iframe's window. An embedded game that never
//      receives focus is unplayable on desktop.
//   4. The touch UI binds and responds. bindTouchUI() bails unless the device
//      looks coarse, and it runs at load — so touch emulation has to be applied
//      BEFORE the iframe's main.js executes, which is why the target is
//      attached paused and only then resumed.
//
// NOT covered: gamepad. The Gamepad API has no CDP emulation, so a physical
// pad in a real embed is still a manual check.
//
// Two origins are needed for "cross-origin", and 127.0.0.1 vs localhost are
// different sites to Chrome — no DNS or certificates required.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUBPATH = '/games/noxrush/';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no dist/index.html — run node scripts/build-web.js first');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------- servers
const gameServer = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (!rel.startsWith(SUBPATH)) { res.writeHead(404).end('nope'); return; }
  rel = rel.slice(SUBPATH.length) || 'index.html';
  const file = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('nope'); return; }
  const type = MIME[extname(file)] || 'application/octet-stream';
  if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': type }).end(); return; }
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((r) => gameServer.listen(0, '127.0.0.1', r));
const GAME_ORIGIN = `http://127.0.0.1:${gameServer.address().port}`;
const GAME_URL = GAME_ORIGIN + SUBPATH;

// The iframe fills the viewport at 0,0, so page coordinates and iframe
// coordinates are the same number — input can be aimed by element rect.
const parentServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>portal harness</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#111}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
<iframe id="game" src="${GAME_URL}" allow="autoplay; gamepad; fullscreen"></iframe>`);
});
await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
// Deliberately "localhost" while the game is "127.0.0.1": same machine, and to
// Chrome a different site — so this is a genuine third-party embed.
const PARENT_URL = `http://localhost:${parentServer.address().port}/`;

// ---------------------------------------------------------------- chrome
const profile = mkdtempSync(join(tmpdir(), 'checkiframe-'));
const dbg = 9400 + (process.pid % 250);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  // Force the cross-origin iframe into its own process, so this exercises the
  // same out-of-process path a real portal embed uses.
  '--site-per-process',
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const notes = [];
let ws;

try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
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
  const listeners = new Set();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); return; }
    for (const fn of listeners) fn(m);
  });
  // `sessionId` is how a flattened auto-attach routes a command to the iframe's
  // own target instead of the top-level page.
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const waitFor = (predicate, ms = 20000) => new Promise((res, rej) => {
    const timer = setTimeout(() => { listeners.delete(fn); rej(new Error('timed out waiting for CDP event')); }, ms);
    const fn = (m) => { if (predicate(m)) { clearTimeout(timer); listeners.delete(fn); res(m); } };
    listeners.add(fn);
  });

  // Attach to the iframe PAUSED, so touch emulation lands before its scripts run.
  const attached = waitFor((m) => m.method === 'Target.attachedToTarget'
    && m.params.targetInfo.type === 'iframe');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: PARENT_URL });

  const ev = await attached;
  const sid = ev.params.sessionId;

  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  // Make the embedded document look like a phone before any of it executes.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }, sid);
  await send('Runtime.runIfWaitingForDebugger', {}, sid);

  const evalIn = async (expression) => {
    const r = await send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r?.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    }
    return r?.result?.value;
  };

  // ------------------------------------------------------------ boot
  let booted = false;
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    if (await evalIn(`!!document.querySelector('#lobby .lobby-card')`) === true) { booted = true; break; }
  }
  await sleep(1200);

  // Read the origin from inside the frame: targetInfo.url is still empty while
  // the target is paused, so it cannot be trusted at attach time.
  const frameOrigin = await evalIn(`location.origin`);
  const parentOrigin = new URL(PARENT_URL).origin;
  results.push(['iframe is genuinely cross-origin', frameOrigin !== parentOrigin,
    `parent ${parentOrigin} / frame ${frameOrigin}`]);
  results.push(['game boots inside the iframe', booted, 'lobby card never appeared']);

  // ------------------------------------------------------------ storage
  // Write through the game's own module, not a bare setItem, so this exercises
  // the real progression path including its try/catch.
  const wrote = await evalIn(`(async () => {
    const p = await import('./js/progress.js');
    const before = p.getProgress().xp;
    p.addXP(4242);
    const after = p.getProgress().xp;
    return JSON.stringify({ before, after, raw: localStorage.getItem('hr_progress') });
  })()`);
  const w = typeof wrote === 'string' ? JSON.parse(wrote) : { __error: wrote?.__error };
  results.push(['localStorage is writable inside the iframe',
    !!w.raw && w.after > w.before, w.__error || `xp ${w.before} -> ${w.after}, raw=${w.raw}`]);

  // ------------------------------------------------------------ persistence
  // The check that matters: reload the iframe and see whether that XP is still
  // there. A partition that resets per-load wipes every player's progression.
  await send('Page.reload', {}, sid);
  let rebooted = false;
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    if (await evalIn(`!!document.querySelector('#lobby .lobby-card')`) === true) { rebooted = true; break; }
  }
  const after = await evalIn(`(async () => {
    const p = await import('./js/progress.js');
    return JSON.stringify({ xp: p.getProgress().xp, raw: localStorage.getItem('hr_progress') });
  })()`);
  const a = typeof after === 'string' ? JSON.parse(after) : { __error: after?.__error };
  results.push(['progression survives an iframe reload (not partitioned away)',
    rebooted && a.xp >= 4242, a.__error || `xp after reload = ${a.xp}`]);

  // ------------------------------------------------------------ keyboard
  // Focus the frame by clicking it, then check a real key event arrives at the
  // iframe's window — where the game's own keydown listener lives.
  await evalIn(`window.__probe = []; window.addEventListener('keydown', (e) => window.__probe.push(e.code));`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 700, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 700, button: 'left', clickCount: 1 });
  await sleep(200);
  for (const [type, key] of [['keyDown', 'ArrowUp'], ['keyUp', 'ArrowUp']]) {
    await send('Input.dispatchKeyEvent', {
      type, code: 'ArrowUp', key, windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38,
    });
  }
  await sleep(300);
  const seen = await evalIn(`JSON.stringify(window.__probe || [])`);
  const keysSeen = typeof seen === 'string' ? JSON.parse(seen) : [];
  results.push(['keyboard events reach the iframe window', keysSeen.includes('ArrowUp'),
    `frame saw: ${JSON.stringify(keysSeen)}`]);

  // ------------------------------------------------------------ touch
  const touchBound = await evalIn(
    `JSON.stringify({ coarse: matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
                      hidden: document.getElementById('touchUI')?.classList.contains('hidden') })`);
  const tb = typeof touchBound === 'string' ? JSON.parse(touchBound) : {};
  results.push(['touch device detected, touch UI un-hidden', tb.coarse === true && tb.hidden === false,
    JSON.stringify(tb)]);

  // The buttons live inside #hud, which only matters while driving — so start a
  // race, then press GAS where it actually renders and read the input state.
  await evalIn(`document.getElementById('quickBtn')?.click()`);
  let racing = false;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const r = await evalIn(`(() => { const b = document.getElementById('tGas')?.getBoundingClientRect();
      return b && b.width > 0 ? JSON.stringify({x: b.x + b.width/2, y: b.y + b.height/2}) : null; })()`);
    if (typeof r === 'string') { racing = JSON.parse(r); break; }
  }
  let pressed = null;
  if (racing) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: Math.round(racing.x), y: Math.round(racing.y) }],
    });
    await sleep(250);
    pressed = await evalIn(`(async () => {
      const i = await import('./js/input.js');
      return JSON.stringify({ throttle: i.touchState.throttle,
                              lit: document.getElementById('tGas')?.classList.contains('on') });
    })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const p = typeof pressed === 'string' ? JSON.parse(pressed) : {};
  results.push(['touch press on GAS registers in the game', p.throttle === true && p.lit === true,
    racing ? JSON.stringify(p) : 'GAS button never became visible (race did not start)']);

  notes.push('gamepad in an embed is NOT covered here — the Gamepad API has no CDP '
    + 'emulation, so it stays a manual check on a real device');

  // ------------------------------------------------------------ report
  console.log(`\nparent  ${PARENT_URL}`);
  console.log(`game    ${GAME_URL}   (cross-origin iframe, own process)\n`);
  let bad = 0;
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok && detail) { bad++; console.log(`        ${detail}`); }
    else if (!ok) bad++;
  }
  for (const n of notes) console.log(`\n  note: ${n}`);
  console.log(bad ? `\n${bad} check(s) failed\n` : `\nAll checks passed — the build survives a third-party embed\n`);
  process.exitCode = bad ? 1 : 0;
} finally {
  if (ws) ws.close();
  chrome.kill('SIGKILL');
  gameServer.close();
  parentServer.close();
  rmSync(profile, { recursive: true, force: true });
}
