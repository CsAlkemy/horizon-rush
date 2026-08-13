// Package dist/ as the ZIP that gets uploaded to a portal.
//
//   npm run build && npm run zip
//
// CrazyGames expects index.html at the ROOT of the archive, not inside a
// dist/ folder — so the archive is built from inside dist/ with relative
// paths, and this script verifies that afterwards rather than trusting it.
// https://docs.crazygames.com/requirements/intro/
//
// macOS junk is excluded explicitly: .DS_Store files and the __MACOSX
// resource-fork directory that Archive Utility adds. `zip -X` drops the extra
// attributes that would otherwise create the latter.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const OUT_NAME = `${pkg.name}-v${pkg.version}.zip`;
const OUT = join(ROOT, OUT_NAME);

if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing — the build did not complete');
  process.exit(1);
}

// A stale ZIP left beside a fresh build is the classic way to upload last
// week's game, so the old one is always removed rather than updated in place
// (`zip` appends to an existing archive by default).
if (existsSync(OUT)) rmSync(OUT);

console.log(`\npackaging dist/ -> ${OUT_NAME}\n`);

execFileSync('zip', ['-r', '-X', '-q', OUT, '.', '-x', '.DS_Store', '*/.DS_Store', '__MACOSX/*'],
  { cwd: DIST, stdio: 'inherit' });

// Verify what actually landed in the archive: index.html at the root, and no
// macOS junk. `unzip -Z1` lists entries one per line, paths relative to root.
const entries = execFileSync('unzip', ['-Z1', OUT], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

const hasRootIndex = entries.includes('index.html');
const junk = entries.filter(e => e.includes('.DS_Store') || e.startsWith('__MACOSX'));

const mb = statSync(OUT).size / 1048576;
const LIMIT_MB = 50;

console.log(`  ${hasRootIndex ? 'PASS' : 'FAIL'}  index.html at archive root`);
console.log(`  ${junk.length === 0 ? 'PASS' : 'FAIL'}  no .DS_Store / __MACOSX entries${junk.length ? ` (${junk.length} found)` : ''}`);
console.log(`  ${mb <= LIMIT_MB ? 'PASS' : 'FAIL'}  archive size ${mb.toFixed(2)} / ${LIMIT_MB} MB`);
console.log(`\n${OUT_NAME}: ${entries.length} entries, ${mb.toFixed(2)} MB`);

if (!hasRootIndex || junk.length) {
  console.error('\narchive layout is wrong — do not upload this');
  process.exit(1);
}
console.log('\nready to upload to https://developer.crazygames.com/');
