// Install Pixabay foley one-shots into public/audio/.
//
// Pixabay is behind Cloudflare, so the downloads themselves can't be scripted —
// you fetch the mp3s in a browser, then this converts them to the exact wav
// format and length the game wants.
//
//   node scripts/install-foley.mjs --list           # what to download, and from where
//   node scripts/install-foley.mjs ~/Downloads      # convert + install whatever is there
//   node scripts/install-foley.mjs ~/Downloads --purge   # ...and delete any cue you didn't replace
//
// Matching is by Pixabay id in the filename (downloads arrive as
// `car-crash-sound-376882.mp3`), or by cue name if you renamed the file
// (`impact.mp3`). Anything missing is simply skipped — audio.js falls back to a
// synth stand-in for every cue, so a partial set is fine.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'public', 'audio');

// Verified 2026-08-12. Every entry is Pixabay Content License: commercial use
// allowed, no attribution required (we credit anyway in CREDITS.md).
// `keep` is the trimmed length in seconds — these replace long library
// recordings, so audio.js no longer needs playback offsets to find the good part.
const CUES = [
  { cue: 'ignition', out: 'ignition.wav', id: '521106', keep: 2.2,
    slug: 'car-engine-start-sound-effect',
    title: 'Car engine start - sound effect', author: 'PWLPL', dur: '0:05',
    note: 'tagged "AI modified or generated" on Pixabay; swap for id 372477 ' +
          '("Car Engine" by DRAGON-STUDIO, 0:03) if you want a plain recording' },
  { cue: 'impact', out: 'impact.wav', id: '376882', keep: 0.40,
    slug: 'car-crash-sound',
    title: 'Car Crash Sound', author: 'DRAGON-STUDIO', dur: '0:01' },
  { cue: 'scrape', out: 'scrape.wav', id: '103668', keep: 0.60,
    slug: 'metal-scrape',
    title: 'Metal Scrape', author: 'dslrguide (via Freesound)', dur: '0:01' },
  { cue: 'click', out: 'click.wav', id: '515078', keep: 0.12,
    slug: 'ui-button-click-mechanical',
    title: 'UI Button Click Mechanical', author: 'SoundShelfStudio', dur: '0:01' },
  { cue: 'gridUp', out: 'grid-up.wav', id: '410877', keep: 0.70,
    slug: 'whoosh-07',
    title: 'Whoosh 07', author: 'DRAGON-STUDIO', dur: '0:02' },
  { cue: 'panel', out: 'panel.wav', id: '410876', keep: 0.55,
    slug: 'whoosh-09',
    title: 'Whoosh 09', author: 'DRAGON-STUDIO', dur: '0:02' },
  { cue: 'reset', out: 'reset.wav', id: '410874', keep: 0.75,
    slug: 'whoosh-06',
    title: 'Whoosh 06', author: 'DRAGON-STUDIO', dur: '0:02' },
];

// The slug matters — Pixabay 404s on a bare id.
const url = (c) => `https://pixabay.com/sound-effects/${c.slug}-${c.id}/`;

function list() {
  console.log('\nDownload each of these (the "Free Download" button, mp3 is fine),');
  console.log('then run:  node scripts/install-foley.mjs ~/Downloads\n');
  for (const c of CUES) {
    console.log(`  ${c.cue.padEnd(9)} ${url(c)}`);
    console.log(`  ${''.padEnd(9)} "${c.title}" by ${c.author} (${c.dur})`);
    if (c.note) console.log(`  ${''.padEnd(9)} NOTE: ${c.note}`);
    console.log('');
  }
  console.log('All Pixabay Content License — commercial use OK, no attribution required.');
}

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Peak-normalize to -1.5 dBFS. ffmpeg has no single-pass peak normalize, so
// measure first, then apply the gain on the real conversion.
function peakGainDb(file) {
  // volumedetect reports on stderr and ffmpeg exits 0, so this needs spawnSync —
  // execFileSync only surfaces stderr when the process fails.
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect',
    '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(`${r.stderr || ''}${r.stdout || ''}`);
  if (!m) {
    console.warn(`  ! could not measure level of ${basename(file)} — leaving gain alone`);
    return 0;
  }
  return -1.5 - parseFloat(m[1]);
}

function findSource(dir, c) {
  const files = readdirSync(dir).filter(f =>
    ['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(extname(f).toLowerCase()));
  // Prefer an exact rename (impact.mp3), else match the Pixabay id.
  const byName = files.find(f => basename(f, extname(f)).toLowerCase() === c.cue.toLowerCase());
  return byName ? join(dir, byName)
    : (files.find(f => f.includes(c.id)) ? join(dir, files.find(f => f.includes(c.id))) : null);
}

function install(dir, purge) {
  if (!existsSync(dir)) { console.error(`No such directory: ${dir}`); process.exit(1); }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { console.error('ffmpeg not found — brew install ffmpeg'); process.exit(1); }

  const tmp = mkdtempSync(join(tmpdir(), 'foley-'));
  let done = 0, missing = [];
  try {
    for (const c of CUES) {
      const src = findSource(dir, c);
      if (!src) { missing.push(c); continue; }

      // Two passes. Trim first — drop leading silence so the transient lands
      // immediately, cap the length, and fade the tail 15 ms so the hard cut
      // does not click. Only then measure the peak: normalizing off the
      // untrimmed file aims at a transient that may have just been cut away.
      const fadeStart = Math.max(0, c.keep - 0.015).toFixed(3);
      const trimmed = join(tmp, c.out);
      ffmpeg(['-i', src, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-af', [
        'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB',
        `atrim=0:${c.keep}`,
        `afade=t=out:st=${fadeStart}:d=0.015`,
      ].join(','), trimmed]);

      const gain = peakGainDb(trimmed);
      const dest = join(OUT, c.out);
      ffmpeg(['-i', trimmed, '-c:a', 'pcm_s16le',
        '-af', `volume=${gain.toFixed(2)}dB`, dest]);
      console.log(`  ${c.out.padEnd(14)} <- ${basename(src)}  ` +
        `(${c.keep}s, ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB)`);
      done++;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  console.log(`\n${done}/${CUES.length} installed.`);
  if (missing.length) {
    console.log(`Not found: ${missing.map(m => m.cue).join(', ')}`);
    for (const c of missing) {
      const stale = join(OUT, c.out);
      if (!existsSync(stale)) { console.log(`  ${c.cue}: no file — synth fallback covers it`); continue; }
      if (purge) { unlinkSync(stale); console.log(`  ${c.cue}: deleted stale ${c.out} (synth fallback covers it)`); }
      else console.log(`  ${c.cue}: STALE ${c.out} still present — rerun with --purge to remove it`);
    }
  }
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--list') || args.includes('-l')) list();
else install(args[0], args.includes('--purge'));
