// Cut the three mandatory CrazyGames covers out of one piece of source art.
//
//   node scripts/make-covers.mjs branding/source-art.png
//   node scripts/make-covers.mjs branding/source-art.png --focus-x 0.62 --focus-y 0.45
//
// Use this when the covers come from an illustration. If they should be
// rendered from the game meshes instead, that is make-branding.mjs and it
// already emits compliant sizes — this script is only for cropping artwork.
//
// Required (https://docs.crazygames.com/requirements/game-covers/):
//   landscape 1920x1080, portrait 800x1200, square 800x800
//   title only — no feature captions, no "PLAY NOW", no borders
//   nothing blurry or pixelated, which is why upscaling is refused below
//
// The portrait is the demanding one: 2:3 out of a 16:9 source keeps only the
// middle ~37% of the width, so the art has to be composed with a subject that
// survives that crop. --focus-x / --focus-y (0..1 of the source) aim the crop
// at the subject instead of the geometric centre.
//
// sips note: --cropOffset is measured from the CENTRE, negative being up/left,
// and it PADS WITH BLACK rather than clamping when the window falls outside the
// image — so every offset here is clamped to keep the crop fully inside.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'branding');
const TMP = join(OUT, '.covers-tmp');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
// Positional args are whatever is left once each --flag and its value are
// skipped, so "--focus-x 0.6" is never mistaken for the source path.
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  positional.push(argv[i]);
}
const SRC = positional[0] || join(OUT, 'source-art.png');
const focusX = parseFloat(arg('--focus-x', '0.5'));
const focusY = parseFloat(arg('--focus-y', '0.5'));

if (!existsSync(SRC)) {
  console.error(`no source art at ${SRC}\n`);
  console.error('Pass the path to the re-exported illustration, e.g.');
  console.error('  node scripts/make-covers.mjs branding/source-art.png\n');
  console.error('It must be >= 1920x1080, carry NO caption text (title only), and be');
  console.error('composed so the subject survives a 2:3 crop. See branding/README.md.');
  process.exit(1);
}

const dim = (f) => {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f], { encoding: 'utf8' });
  return {
    w: +out.match(/pixelWidth:\s*(\d+)/)[1],
    h: +out.match(/pixelHeight:\s*(\d+)/)[1],
  };
};

const COVERS = [
  { file: 'cover-landscape-1920x1080.png', w: 1920, h: 1080 },
  { file: 'cover-portrait-800x1200.png', w: 800, h: 1200 },
  { file: 'cover-square-800x800.png', w: 800, h: 800 },
];

const src = dim(SRC);
console.log(`\nsource  ${basename(SRC)}  ${src.w}x${src.h}`);
console.log(`focus   x=${focusX} y=${focusY}\n`);

if (src.w < 1920 || src.h < 1080) {
  console.error(`source is ${src.w}x${src.h} — below the required 1920x1080.`);
  console.error('Re-export larger; upscaling trips the "no blurry or pixelated visuals" rule.');
  process.exit(1);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let warned = 0;
try {
  for (const c of COVERS) {
    // Largest rectangle of the target aspect that fits inside the source.
    const aspect = c.w / c.h;
    let cw, ch;
    if (src.w / src.h > aspect) { ch = src.h; cw = Math.round(src.h * aspect); }
    else { cw = src.w; ch = Math.round(src.w / aspect); }

    // Aim at the focal point, then clamp so the window stays inside the image
    // (sips would otherwise pad the overflow with black).
    const maxOffX = (src.w - cw) / 2;
    const maxOffY = (src.h - ch) / 2;
    const wantOffX = focusX * src.w - src.w / 2;
    const wantOffY = focusY * src.h - src.h / 2;
    const offX = Math.round(Math.max(-maxOffX, Math.min(maxOffX, wantOffX)));
    const offY = Math.round(Math.max(-maxOffY, Math.min(maxOffY, wantOffY)));

    const tmp = join(TMP, c.file);
    const out = join(OUT, c.file);
    execFileSync('sips', ['-c', String(ch), String(cw), '--cropOffset', String(offY), String(offX),
      SRC, '--out', tmp], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(c.h), String(c.w), tmp, '--out', out], { stdio: 'ignore' });

    const got = dim(out);
    const exact = got.w === c.w && got.h === c.h;
    // Downscaling is what we want. Coming from a smaller crop means the pixels
    // were invented, which is the rule this cannot break.
    const upscaled = cw < c.w || ch < c.h;
    if (upscaled) warned++;
    console.log(`  ${exact && !upscaled ? 'OK  ' : 'WARN'}  ${c.file.padEnd(34)} crop ${cw}x${ch} @ ${offX >= 0 ? '+' : ''}${offX},${offY >= 0 ? '+' : ''}${offY} -> ${got.w}x${got.h}`);
    if (upscaled) {
      console.log(`        crop is smaller than the target — these pixels are upscaled and will look soft`);
    }
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\nwrote ${COVERS.length} covers to branding/`);
if (warned) {
  console.log(`\n${warned} cover(s) required upscaling. Re-export the art larger, or `
    + `re-frame with --focus-x / --focus-y so a bigger crop fits.`);
  process.exitCode = 1;
} else {
  console.log('\nCheck each one by eye before uploading: the title must be fully inside');
  console.log('the frame in ALL THREE crops, and no caption text may have survived.');
}
