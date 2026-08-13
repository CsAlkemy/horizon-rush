#!/usr/bin/env node
// Turn raw screen recordings into CrazyGames-compliant preview videos.
//
//   node scripts/make-preview-videos.mjs --landscape raw-16x9.mov --portrait raw-2x3.mov
//   node scripts/make-preview-videos.mjs --landscape raw.mov --start 12 --duration 18
//
// Requirements (https://docs.crazygames.com/requirements/game-covers/):
//   landscape 1080p 16:9   -> 1920x1080
//   portrait  1080p 2:3    -> 1080x1620      NOT 9:16
//   15-20 seconds, longer is cut to 20
//   <= 50 MB, NO SOUND, no black bars, no cursor, no promo text
//   open on the static cover
//
// The cover frame is prepended here rather than in an editor, because it has to
// be pixel-identical to the uploaded cover or the thumbnail flickers on load.
//
// RECORD IN THE TARGET SHAPE. A 16:9 recording cropped to 2:3 keeps only 37.5%
// of the width and throws away the HUD corners — minimap bottom-left, speedo and
// nitro bottom-right. The game lays out natively at 1080x1620; record it there.
//
// Requires ffmpeg on PATH.

import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'branding')

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const MAX_SECONDS = 20
const MIN_SECONDS = 15
const MAX_MB = 50
const COVER_HOLD = parseFloat(arg('--cover-hold', '0.6'))
const START = parseFloat(arg('--start', '0'))
const DURATION = Math.min(parseFloat(arg('--duration', String(MAX_SECONDS))), MAX_SECONDS)

const TARGETS = [
  {
    flag: '--landscape',
    name: 'preview-landscape-1920x1080.mp4',
    w: 1920, h: 1080,
    cover: join(OUT, 'cover-landscape-1920x1080.png'),
  },
  {
    flag: '--portrait',
    name: 'preview-portrait-1080x1620.mp4',
    w: 1080, h: 1620,
    cover: join(OUT, 'preview-frame-portrait-1080x1620.png'),
  },
]

const ffprobe = (file, entries) => execFileSync('ffprobe', ['-v', 'error',
  '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', file],
  { encoding: 'utf8' }).trim()

let built = 0
let warned = 0

for (const t of TARGETS) {
  const src = arg(t.flag, null)
  if (!src) continue
  if (!existsSync(src)) {
    console.error(`\n${t.flag}: no such file — ${src}`)
    process.exitCode = 1
    continue
  }
  if (!existsSync(t.cover)) {
    console.error(`\nmissing opening frame ${t.cover}\nrun: node scripts/make-covers-from-art.mjs`)
    process.exit(1)
  }

  const [sw, sh] = ffprobe(src, 'stream=width,height').split(',').map(Number)
  const srcDur = parseFloat(ffprobe(src, 'format=duration') || '0')
  const want = t.w / t.h
  const got = sw / sh

  console.log(`\n${t.name}`)
  console.log(`  source  ${sw}x${sh}  ${srcDur.toFixed(1)}s  (${got.toFixed(3)} vs target ${want.toFixed(3)})`)

  // An explicit crop is the way to cut a title bar or menu bar off a windowed
  // screen recording. Measure it once from a still: take a screenshot of the
  // recording, note where the game viewport starts, pass w:h:x:y.
  const manual = arg('--crop', null)
  let crop = ''
  if (manual) {
    const [cw, ch] = manual.split(':').map(Number)
    crop = `crop=${manual},`
    console.log(`  crop    ${manual}  (${(cw / ch).toFixed(3)} vs target ${want.toFixed(3)})`)
    if (Math.abs(cw / ch - want) > 0.01) {
      console.log(`  WARN  cropped region is not ${t.w}:${t.h} — it will be squeezed to fit`)
      warned++
    }
  } else if (Math.abs(got - want) > 0.01) {
    // Off-aspect sources are centre-cropped rather than padded: black bars are
    // explicitly disallowed, so losing edge pixels is the only legal option.
    const cw = got > want ? Math.round(sh * want) : sw
    const ch = got > want ? sh : Math.round(sw / want)
    crop = `crop=${cw}:${ch}:${Math.round((sw - cw) / 2)}:${Math.round((sh - ch) / 2)},`
    const lostPct = Math.round((1 - (cw * ch) / (sw * sh)) * 100)
    console.log(`  WARN  aspect mismatch — centre-cropping to ${cw}x${ch}, losing ${lostPct}% of frame`)
    if (lostPct > 20) console.log(`        that is a lot. Re-record at ${t.w}x${t.h} instead.`)
    warned++
  }

  const clipLen = Math.max(0, Math.min(DURATION, srcDur - START))
  const total = clipLen + COVER_HOLD
  if (total < MIN_SECONDS) {
    console.log(`  WARN  final video is ${total.toFixed(1)}s — under their ${MIN_SECONDS}s guidance`)
    warned++
  }

  const out = join(OUT, t.name)
  // The cover is looped into a short clip, then concatenated with the gameplay.
  // Both legs are normalised to the same size, fps and pixel format first, or
  // concat refuses them.
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-loop', '1', '-t', String(COVER_HOLD), '-i', t.cover,
    '-ss', String(START), '-t', String(clipLen), '-i', src,
    '-filter_complex',
    `[0:v]scale=${t.w}:${t.h}:flags=lanczos,fps=30,format=yuv420p,setsar=1[a];` +
    `[1:v]${crop}scale=${t.w}:${t.h}:flags=lanczos,fps=30,format=yuv420p,setsar=1[b];` +
    `[a][b]concat=n=2:v=1:a=0[v]`,
    '-map', '[v]',
    '-an',                                   // no sound, per the requirements
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out], { stdio: 'inherit' })

  const mb = statSync(out).size / 1048576
  const dur = parseFloat(ffprobe(out, 'format=duration'))
  const [ow, oh] = ffprobe(out, 'stream=width,height').split(',').map(Number)

  const okSize = ow === t.w && oh === t.h
  const okDur = dur <= MAX_SECONDS + 0.2
  const okMb = mb <= MAX_MB
  console.log(`  ${okSize ? 'PASS' : 'FAIL'}  ${ow}x${oh} (need ${t.w}x${t.h})`)
  console.log(`  ${okDur ? 'PASS' : 'FAIL'}  ${dur.toFixed(1)}s / ${MAX_SECONDS}s max`)
  console.log(`  ${okMb ? 'PASS' : 'FAIL'}  ${mb.toFixed(1)} / ${MAX_MB} MB`)
  console.log(`  PASS  audio stripped, opens on the static cover`)
  if (!okSize || !okDur || !okMb) process.exitCode = 1
  built++
}

if (!built) {
  console.log(`\nnothing to do — pass at least one source:\n`)
  console.log(`  node scripts/make-preview-videos.mjs --landscape raw-16x9.mov --portrait raw-2x3.mov\n`)
  console.log(`Record landscape at 1920x1080 and portrait at 1080x1620 (2:3, NOT 9:16).`)
  process.exitCode = 1
} else {
  console.log(`\nbuilt ${built} video(s) in branding/`)
  if (warned) console.log(`${warned} warning(s) above — check before uploading`)
  console.log(`\nWatch both back before submitting: no mouse cursor, no black frames,`)
  console.log(`no UI overlays from the recorder, and gameplay from the first moment.`)
}
