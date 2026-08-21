// Prove dist/ is actually self-contained: serve it with a dumb static server,
// load it in a real browser, and fail if anything goes wrong.
//
//   node scripts/build-web.js && node scripts/check-dist.mjs
//
// Four assertions, because "it looked fine" is not a check:
//   1. every request stays on this origin      (no node_modules, no CDN, no absolute /)
//   2. no request 404s                          (a relative path that climbed too high)
//   3. no page errors or failed module loads
//   4. the game actually reaches a working state (car model loaded, lobby present)
//
// It also loads the page from a SUBPATH, because that is how a portal hosts a
// game — an absolute "/models/x.glb" works at the origin root and breaks in an
// iframe on /games/noxrush/, which is exactly the bug this catches.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, extname, normalize, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Which bundle to check. dist/ is the SDK-free CrazyGames build; a portal SDK
// build lives in dist-<sdk>/ and is allowed exactly one off-origin host.
const dirArg = process.argv.indexOf('--dir');
const DIST = join(ROOT, dirArg >= 0 && process.argv[dirArg + 1] ? process.argv[dirArg + 1] : 'dist');
// Read back what the build actually declared rather than trusting the flag.
let BUILD_SDK = 'none';
try {
  BUILD_SDK = (readFileSync(join(DIST, 'js/build-config.js'), 'utf8')
    .match(/"sdk"\s*:\s*"([^"]+)"/) || [, 'none'])[1];
} catch {}
// Only the declared SDK's own host may be contacted. Everything else, on every
// build, is still a failure — that invariant is what keeps the bundle portable.
const ALLOWED_HOSTS = BUILD_SDK === 'playgama' ? ['https://bridge.playgama.com'] : [];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUBPATH = '/games/noxrush/';       // stand-in for a portal's mount point

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no dist/index.html — run node scripts/build-web.js first');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const missing = [];
const urlOf = new Map();
const optionalMisses = [];
const ok200 = new Set();
const headAborts = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  // Everything is mounted under SUBPATH, mimicking a portal.
  if (!rel.startsWith(SUBPATH)) { missing.push(rel); res.writeHead(404).end('nope'); return; }
  rel = rel.slice(SUBPATH.length) || 'index.html';
  const file = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(file) || !statSync(file).isFile()) {
    missing.push(rel);
    res.writeHead(404).end('nope');
    return;
  }
  const type = MIME[extname(file)] || 'application/octet-stream';
  // HEAD must not carry a body — loadSceneryModel probes with HEAD, and sending
  // one makes Chrome abort the request.
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'content-type': type });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;
// ?menu=1 opens the lobby instead of booting straight onto the grid. The
// portal-UI assertions below test that FRIENDS / party / LAN are *suppressed*,
// and they read `offsetParent`, so against the normal boot-into-race path they
// would pass trivially by virtue of the whole lobby being hidden. Forcing the
// menu open keeps those four assertions meaningful.
const pageUrl = ORIGIN + SUBPATH + '?menu=1';

const profile = mkdtempSync(join(tmpdir(), 'checkdist-'));
const dbg = 9700 + (process.pid % 250);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const offOrigin = [];
const failures = [];
const errors = [];
const logs = [];
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
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
    switch (m.method) {
      case 'Network.requestWillBeSent': {
        const u = m.params.request.url;
        urlOf.set(m.params.requestId, `${m.params.request.method} ${u}`);
        if (u.startsWith('data:') || u.startsWith('blob:')) break;
        if (!u.startsWith(ORIGIN) && !ALLOWED_HOSTS.some((h) => u.startsWith(h))) offOrigin.push(u);
        break;
      }
      case 'Network.responseReceived':
        if (m.params.response.status >= 400) {
          failures.push(`${m.params.response.status} ${m.params.response.url}`);
        } else {
          ok200.add(m.params.response.url.replace(ORIGIN + SUBPATH, ''));
        }
        break;
      case 'Network.loadingFailed': {
        // Not every failed request is a fault, but the exceptions have to be
        // narrow or this check stops meaning anything:
        //   · music.mp3 is an optional asset the game probes for on purpose.
        //   · a HEAD probe (loadSceneryModel) gets cancelled by Chrome once the
        //     GET for the same URL starts. Forgiven ONLY if that GET then
        //     succeeded — otherwise the asset really is missing and it fails.
        const tagged = urlOf.get(m.params.requestId) || 'GET (unknown url)';
        const [method, u = ''] = [tagged.slice(0, tagged.indexOf(' ')), tagged.slice(tagged.indexOf(' ') + 1)];
        const path = u.replace(ORIGIN + SUBPATH, '').replace(ORIGIN, '');
        if (/music\.mp3$/.test(u)) { optionalMisses.push(path); break; }
        if (method === 'HEAD') { headAborts.push(path); break; }
        failures.push(`load failed ${m.params.errorText} ${path}`);
        break;
      }
      case 'Runtime.exceptionThrown':
        errors.push(m.params.exceptionDetails?.exception?.description
          || m.params.exceptionDetails?.text || 'unknown exception');
        break;
      case 'Runtime.consoleAPICalled':
        logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        break;
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: pageUrl });

  // The lobby renders as soon as models finish; give it room, then settle.
  let booted = false;
  for (let i = 0; i < 100; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('#lobby .lobby-card')`, returnByValue: true,
    });
    if (r?.result?.value) { booted = true; break; }
  }
  await sleep(1500);

  // Portal build must have stripped the server-only UI.
  const ui = await send('Runtime.evaluate', {
    expression: `(() => {
      const shown = (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      };
      return JSON.stringify({
        friends: shown('.mode-card[data-mode="friends"]'),
        party: shown('#partyBox'),
        lanBox: shown('#lanBox'),
        chip: shown('#chipLink'),
        portal: !!(window.__BUILD__ && window.__BUILD__.portal)
      });
    })()`, returnByValue: true,
  });
  const state = JSON.parse(ui?.result?.value || '{}');

  const modelLoaded = logs.some((l) => l.includes('loaded car model'));
  const scenery = ['models/low_poly_trees.glb', 'models/low-poly_billboard_pack.glb']
    .filter((f) => ok200.has(f));
  const packLoaded = logs.some((l) => l.includes('bot car pack'));

  // Promote any HEAD abort whose GET never succeeded into a real failure.
  for (const p of new Set(headAborts)) {
    if (!ok200.has(p)) failures.push(`HEAD probe failed and no successful GET: ${p}`);
  }

  const checks = [
    ['every request stays on this origin', offOrigin.length === 0,
      offOrigin.slice(0, 6).join('\n      ')],
    ['no 404s or failed loads', failures.length === 0,
      failures.slice(0, 8).join('\n      ')],
    ['no page exceptions', errors.length === 0, errors.slice(0, 4).join('\n      ')],
    ['lobby rendered', booted, ''],
    ['player car model loaded', modelLoaded, ''],
    ['bot car pack loaded', packLoaded, ''],
    ['scenery models fetched (trees, billboards)', scenery.length === 2,
      `only got: ${scenery.join(', ') || 'none'}`],
    ['portal flag active', state.portal === true, ''],
    ['FRIENDS / party / LAN UI suppressed',
      !state.friends && !state.party && !state.lanBox && !state.chip,
      JSON.stringify(state)],
  ];

  console.log(`\nserved ${relative(ROOT, DIST)}/ at ${pageUrl}  (deliberately on a subpath)${BUILD_SDK !== 'none' ? `  sdk=${BUILD_SDK}` : ''}\n`);
  let bad = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { bad++; if (detail) console.log(`      ${detail}`); }
  }
  const forgiven = [...new Set(headAborts)].filter((p) => ok200.has(p));
  if (forgiven.length) {
    console.log(`\n  note: ${forgiven.length} HEAD probe(s) cancelled by Chrome once the GET began ` +
      `— each URL then fetched successfully, so this is expected`);
  }
  if (optionalMisses.length) {
    console.log(`\n  note: ${optionalMisses.length} optional asset absent by design ` +
      `(${[...new Set(optionalMisses)].join(', ')})`);
  }
  if (missing.length) {
    console.log(`\n  server saw ${missing.length} miss(es): ${[...new Set(missing)].slice(0, 8).join(', ')}`);
  }
  console.log(bad ? `\n${bad} check(s) failed\n`
    : `\nAll checks passed — ${relative(ROOT, DIST)}/ is self-contained`
      + `${BUILD_SDK !== 'none' ? ` apart from the ${BUILD_SDK} bridge, which is expected` : ''}\n`);
  process.exitCode = bad ? 1 : 0;
} finally {
  if (ws) ws.close();
  chrome.kill('SIGKILL');
  server.close();
  // Chrome writes to its profile for a moment after SIGKILL, so a plain rmSync
  // races it and throws ENOTEMPTY — which would fail a run whose checks all
  // passed. Retry briefly, and never let cleanup decide the exit code.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch { /* temp dir, the OS will reap it */ }
}
