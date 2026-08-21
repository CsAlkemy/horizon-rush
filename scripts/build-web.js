// Build a self-contained static bundle in dist/ — the thing you upload to a
// portal. No server, no node_modules, no absolute URLs.
//
//   node scripts/build-web.js
//   node scripts/build-web.js --with-foley     # include the recorded one-shots
//   node scripts/build-web.js --lan            # server-flavoured build (keeps FRIENDS)
//
// Verify the result with `node scripts/check-dist.mjs`, which boots dist/ in a
// real browser and fails if anything requests an off-origin URL.
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORTAL = !argv.includes('--lan');

// Portal SDK target. Each portal gets its OWN bundle and its own directory,
// because they cannot share bytes: the Playgama build loads their bridge from
// bridge.playgama.com, and CrazyGames will not pay revenue share on a game that
// carries another portal's branding. dist/ therefore stays the SDK-free bundle
// that CrazyGames QA passed, and nothing here can quietly change that.
const SDK = argv.includes('--playgama') ? 'playgama' : 'none';
const PLAYGAMA_BRIDGE = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
const OUT_NAME = SDK === 'none' ? 'dist' : `dist-${SDK}`;
const DIST = join(ROOT, OUT_NAME);

// The foley one-shots are excluded by default: they were extracted from a Unity
// build and carry no licence, so they must not go into a published ZIP. Every
// cue that used them has a synth stand-in in audio.js, so the build is complete
// without them. `--with-foley` is for a private LAN bundle only.
const WITH_FOLEY = argv.includes('--with-foley');
const UNLICENSED_AUDIO = [
  'click.wav', 'grid-up.wav', 'ignition.wav',
  'impact.wav', 'panel.wav', 'reset.wav', 'scrape.wav',
];

// Dev-only docs never ship.
const SKIP_NAMES = new Set(['README.md', '.DS_Store']);

const log = (...a) => console.log(' ', ...a);

// ---------------------------------------------------------------- copy helpers
function copyTree(from, to, { skipFiles = [] } = {}) {
  let n = 0, bytes = 0;
  const skip = new Set(skipFiles);
  const walk = (src, dst) => {
    for (const name of readdirSync(src)) {
      if (SKIP_NAMES.has(name) || skip.has(name)) continue;
      const s = join(src, name), d = join(dst, name);
      const st = statSync(s);
      if (st.isDirectory()) { mkdirSync(d, { recursive: true }); walk(s, d); }
      else { cpSync(s, d); n++; bytes += st.size; }
    }
  };
  mkdirSync(to, { recursive: true });
  walk(from, to);
  return { n, bytes };
}

// ---------------------------------------------------------------- three.js
// Copying node_modules/three/examples/jsm wholesale is 368 files and 13 MB. The
// game imports three addons, and following their relative imports pulls in one
// more — so resolve the graph and copy only what is reachable (~150 KB).
function vendorThree(entryAddons) {
  const srcCore = join(ROOT, 'node_modules/three/build/three.module.js');
  const jsmRoot = join(ROOT, 'node_modules/three/examples/jsm');
  if (!existsSync(srcCore)) {
    console.error('three not installed — run npm install first');
    process.exit(1);
  }
  const outCore = join(DIST, 'vendor/three/build/three.module.js');
  mkdirSync(dirname(outCore), { recursive: true });
  cpSync(srcCore, outCore);

  const seen = new Set();
  const queue = [...entryAddons];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = join(jsmRoot, rel);
    if (!existsSync(src)) {
      console.error(`addon not found: examples/jsm/${rel}`);
      process.exit(1);
    }
    const code = readFileSync(src, 'utf8');
    const out = join(DIST, 'vendor/three/examples/jsm', rel);
    mkdirSync(dirname(out), { recursive: true });
    cpSync(src, out);
    // Follow relative imports only; bare "three" is served by the import map.
    for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
      queue.push(relative(jsmRoot, resolve(dirname(src), m[1])));
    }
  }
  const bytes = [...seen].reduce((a, r) =>
    a + statSync(join(jsmRoot, r)).size, statSync(srcCore).size);
  return { files: seen, bytes };
}

// Which addons does the shipped code actually import?
function findAddonImports() {
  const found = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith('.js')) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/['"]three\/addons\/([^'"]+)['"]/g)) {
        found.add(m[1]);
      }
    }
  };
  walk(join(ROOT, 'public/js'));
  walk(join(ROOT, 'shared'));
  return [...found];
}

// ---------------------------------------------------------------- build
console.log(`\nbuilding ${OUT_NAME}/ (${PORTAL ? 'portal' : 'lan'}${WITH_FOLEY ? ', with foley' : ''}${SDK !== 'none' ? ', ' + SDK + ' sdk' : ''})\n`);
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// public/ becomes the bundle root, so index.html lands at dist/index.html.
const skipAudio = WITH_FOLEY ? [] : UNLICENSED_AUDIO;
const pub = copyTree(join(ROOT, 'public'), DIST, { skipFiles: skipAudio });
log(`public/  -> dist/            ${pub.n} files, ${(pub.bytes / 1048576).toFixed(2)} MB`);
if (!WITH_FOLEY) log(`  (excluded ${UNLICENSED_AUDIO.length} unlicensed foley files — synth fallbacks cover them)`);

// shared/ sits beside js/ so "../shared/x.js" resolves the same as on the server.
const sh = copyTree(join(ROOT, 'shared'), join(DIST, 'shared'));
log(`shared/  -> dist/shared/     ${sh.n} files, ${(sh.bytes / 1024).toFixed(0)} KB`);

// models: the .glb set plus the manifest. No READMEs.
mkdirSync(join(DIST, 'models'), { recursive: true });
let mn = 0, mbytes = 0;
for (const name of readdirSync(join(ROOT, 'models'))) {
  if (!/\.(glb|json)$/.test(name)) continue;
  const s = join(ROOT, 'models', name);
  cpSync(s, join(DIST, 'models', name));
  mn++; mbytes += statSync(s).size;
}
log(`models/  -> dist/models/     ${mn} files, ${(mbytes / 1048576).toFixed(2)} MB`);

const addons = findAddonImports();
const three = vendorThree(addons);
log(`three    -> dist/vendor/     core + ${three.files.size} addons, ${(three.bytes / 1048576).toFixed(2)} MB`);
for (const f of three.files) log(`             · ${f}`);

// Build switches, as a classic script so it runs before the module graph.
writeFileSync(join(DIST, 'js/build-config.js'),
  `// generated by scripts/build-web.js — do not edit\n` +
  `window.__BUILD__ = ${JSON.stringify({ portal: PORTAL, foley: WITH_FOLEY, sdk: SDK })};\n`);
const idxPath = join(DIST, 'index.html');
let idx = readFileSync(idxPath, 'utf8');
if (!idx.includes('build-config.js')) {
  idx = idx.replace('<link rel="stylesheet" href="css/style.css">',
    '<script src="js/build-config.js"></script>\n<link rel="stylesheet" href="css/style.css">');
}
// The bridge must be a plain classic script and must be parsed before the
// module graph, since sdk.js reads window.bridge during boot.
if (SDK === 'playgama' && !idx.includes(PLAYGAMA_BRIDGE)) {
  idx = idx.replace('<script src="js/build-config.js"></script>',
    `<script src="${PLAYGAMA_BRIDGE}"></script>\n<script src="js/build-config.js"></script>`);
}
writeFileSync(idxPath, idx);
log(`config   -> ${OUT_NAME}/js/build-config.js   portal=${PORTAL} foley=${WITH_FOLEY} sdk=${SDK}`);
if (SDK === 'playgama') {
  log(`bridge   -> injected ${PLAYGAMA_BRIDGE}`);
  // The bridge fetches ./playgama-bridge-config.json from the bundle root on
  // boot. Without it the request 404s — harmless-looking, but it is where the
  // per-platform game IDs and the interstitial frequency cap live, so a missing
  // file means the ad settings silently do not apply.
  const cfgSrc = join(ROOT, 'playgama-bridge-config.json');
  if (existsSync(cfgSrc)) {
    cpSync(cfgSrc, join(DIST, 'playgama-bridge-config.json'));
    log(`config   -> playgama-bridge-config.json copied to bundle root`);
  } else {
    console.error('\nFAIL  playgama-bridge-config.json missing from the repo root');
    console.error('      the bridge fetches it on boot; add it before building --playgama');
    process.exit(1);
  }
}

// Nothing outside store.js may touch localStorage. Playgama requires progress to
// go through their Storage API, because on some partner platforms localStorage
// is unavailable or wiped between sessions — a direct call there silently loses
// the player's save. This is cheap to enforce and impossible to notice by hand.
const rawStorage = [];
for (const f of readdirSync(join(DIST, 'js'))) {
  if (!f.endsWith('.js') || f === 'store.js') continue;
  const body = readFileSync(join(DIST, 'js', f), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  if (body.includes('localStorage')) rawStorage.push(f);
}
if (rawStorage.length) {
  console.error(`\nFAIL  direct localStorage outside store.js: ${rawStorage.join(', ')}`);
  console.error('      route it through public/js/store.js — see the note at the top of that file');
  process.exit(1);
}
log(`storage  -> all reads/writes go through js/store.js`);

// A build with no SDK ships a stub in place of sdk.js. CrazyGames will not pay
// revenue share on a game carrying another portal's branding, and the simplest
// way to never argue about whether a code comment counts is to not ship it.
if (SDK === 'none') {
  writeFileSync(join(DIST, 'js/sdk.js'),
    `// generated by scripts/build-web.js — this build ships no portal SDK.\n` +
    `// The real implementation is public/js/sdk.js, shipped only in dist-<sdk>/.\n` +
    `import * as store from './store.js';\n` +
    `export const SDK = 'none';\n` +
    `export async function initSdk() { await store.preload(); }\n` +
    `export function onPlatform() {}\n` +
    `export function platformLanguage() { return null; }\n` +
    `export function gameReady() {}\n` +
    `export async function showInterstitial() {}\n`);
  log(`sdk      -> js/sdk.js stubbed out (no portal SDK in this build)`);
}

// The bundle root should hold index.html and nothing else. A stray file in
// public/ (a screenshot, a scratch export) is otherwise invisible until it is
// already inside the ZIP — this build caught a 2 MB one exactly that way.
const strays = readdirSync(DIST)
  .filter(n => statSync(join(DIST, n)).isFile() && n !== 'index.html');
if (strays.length) {
  console.log(`\n  WARNING  unexpected files at the bundle root — should these ship?`);
  for (const n of strays) {
    console.log(`           ${n}  (${(statSync(join(DIST, n)).size / 1024).toFixed(0)} KB)`);
  }
}

// ---------------------------------------------------------------- report
let files = 0, bytes = 0;
(function tally(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) tally(p); else { files++; bytes += st.size; }
  }
})(DIST);

const mb = bytes / 1048576;
const LIMIT_MB = 50, LIMIT_FILES = 1500, STRETCH_MB = 20;
console.log(`\n${OUT_NAME}/: ${files} files, ${mb.toFixed(2)} MB`);
console.log(`  ${mb <= LIMIT_MB ? 'PASS' : 'FAIL'}  initial download ${mb.toFixed(2)} / ${LIMIT_MB} MB`);
console.log(`  ${files <= LIMIT_FILES ? 'PASS' : 'FAIL'}  file count ${files} / ${LIMIT_FILES}`);
console.log(`  ${mb <= STRETCH_MB ? 'PASS' : 'over '}  mobile stretch ${mb.toFixed(2)} / ${STRETCH_MB} MB` +
  (mb > STRETCH_MB ? '  (Draco on kestrel_gt.glb is the lever)' : ''));
console.log(`\nnext: node scripts/check-dist.mjs${SDK !== 'none' ? ' --dir ' + OUT_NAME : ''}\n`);
