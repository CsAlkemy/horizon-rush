#!/usr/bin/env node
// Build the CrazyGames cover set from branding/noxrush.png (the illustrated
// banner) instead of from the game meshes.
//
// The source is 1280x720 with a strip of feature captions across the bottom.
// Covers may only carry the game title, and two of the three mandatory sizes
// are not 16:9, so three things happen here:
//
//   1. The caption strip is painted out with ground cloned from below it. The
//      foreground is heavy motion blur, so a vertically stretched copy of the
//      dirt at y=662..720 covers y=588..720 without leaving a seam.
//   2. Landscape is a straight 1.5x lanczos upscale of that clean plate.
//   3. Square and portrait need more height than 16:9 has. The extra comes from
//      cloning ground downward (invisible - it is blurred dirt) and extending
//      the sky upward from a real cloud patch lifted out of the top-right of
//      the frame, melted into a gradient sampled from the plate's own sky.
//
// Nothing is upscaled past 1.5x, and no cover is stretched non-uniformly.
//
//   node scripts/make-covers-from-art.mjs
//
// Requires ffmpeg on PATH.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'branding', 'noxrush.png')
const OUT = join(ROOT, 'branding')
const TMP = mkdtempSync(join(tmpdir(), 'noxrush-covers-'))

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
const t = (name) => join(TMP, name)

// --- source geometry, measured off the artwork ------------------------------
const SRC_W = 1280
const SRC_H = 720
const CAPTION_TOP = 588      // first row the caption strip may touch
const CLEAN_DIRT = { y: 662, h: 58 }  // clean ground below the captions
// The car plus its splitter spans x=285..1090; the title spans x=310..905.
// A crop of x=275 w=825 keeps both with a ~10px margin on each side.
const SUBJECT = { x: 275, w: 825 }
// Sky borrowed for vertical extension: right of the title, above the gate.
const SKY_PATCH = { x: 920, y: 0, w: 360, h: 170 }

// --- 1. clean plate: paint out the caption strip ----------------------------
const clean = t('clean.png')
ff(['-i', SRC, '-filter_complex',
  `[0:v]format=rgba,split[base][s];` +
  `[s]crop=${SRC_W}:${CLEAN_DIRT.h}:0:${CLEAN_DIRT.y},` +
  `scale=${SRC_W}:${SRC_H - CAPTION_TOP}:flags=lanczos,format=rgba,` +
  // 18px alpha ramp so the clone melts into the real ground above it
  `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gte(Y,18),255,Y*255/18)'[patch];` +
  `[base][patch]overlay=0:${CAPTION_TOP},format=rgb24[out]`,
  '-map', '[out]', clean])

// --- helpers ----------------------------------------------------------------
/** Average colour of a band of an image, as {r,g,b}. */
function sampleColor(file, crop) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1:1:flags=area`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return { r: raw[0], g: raw[1], b: raw[2] }
}

const hex = ({ r, g, b }) => '0x' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Compose a cover taller than its 16:9 crop allows.
 *
 * The cropped artwork is scaled to the full output width and pinned so that
 * `groundPx` of cloned ground sits below it; whatever height is left above it
 * is filled with extended sky.
 */
function cover({ name, outW, outH, crop, groundPx }) {
  const contentH = Math.round(crop.h * (outW / crop.w))
  const skyPx = outH - contentH - groundPx
  if (skyPx < 0) throw new Error(`${name}: crop is taller than the canvas`)

  // content — the artwork itself, uniformly scaled
  const content = t(`${name}-content.png`)
  ff(['-i', clean, '-vf',
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${outW}:${contentH}:flags=lanczos`,
    content])

  // The artwork's own sky has only ~42 rows above the title, so that is all the
  // room there is to cross-fade the invented sky into the real one.
  const blend = skyPx > 0 ? Math.min(32, skyPx) : 0

  const uses = ['c_main']
  if (skyPx > 0) uses.unshift('c_top')
  if (groundPx > 0) uses.push('c_low')
  const layers = [uses.length > 1
    ? `[1:v]split=${uses.length}${uses.map((u) => `[${u}]`).join('')}`
    : `[1:v]null[c_main]`]
  const overlays = []     // {label, x, y}, painted back to front

  if (skyPx > 0) {
    const skyH = skyPx + blend      // sky layers run under the artwork's fade-in
    const horizon = sampleColor(content, { x: 0, y: 0, w: outW, h: 8 })

    // Backdrop: the artwork's own top rows stretched upward. It carries no
    // detail, but it matches the sky it meets column by column, so the join
    // cannot show a colour step even where that sky shades cool-left to
    // bright-right. Blurred wide *before* the stretch — per-pixel detail
    // dragged up the frame streaks, and only the broad shading has to match.
    layers.push(
      `[c_top]crop=${outW}:8:0:0,gblur=sigma=28:sigmaV=1,` +
      `scale=${outW}:${skyH}:flags=bicubic,noise=alls=3:allf=t+u,format=rgba[l0]`)
    overlays.push({ label: 'l0', x: 0, y: 0 })

    // A real sky deepens toward the zenith; without this the backdrop reads as
    // a flat wash of the horizon colour.
    const zenith = { r: horizon.r * 0.46, g: horizon.g * 0.62, b: horizon.b * 0.92 }
    layers.push(
      `color=c=${hex(zenith)}:s=${outW}x${skyH}:d=1,format=rgba,trim=end_frame=1,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*0.62*pow(1-Y/${skyH},1.15)'[l1]`)
    overlays.push({ label: 'l1', x: 0, y: 0 })

    // Real cloud texture, lifted from the top-right of the plate and matched to
    // the exposure of the sky it butts up against.
    const patchMean = sampleColor(clean, SKY_PATCH)
    const gain = {
      r: clamp(horizon.r / Math.max(1, patchMean.r), 0.7, 1.4),
      g: clamp(horizon.g / Math.max(1, patchMean.g), 0.7, 1.4),
      b: clamp(horizon.b / Math.max(1, patchMean.b), 0.7, 1.4),
    }
    const fadeIn = Math.round(skyH * 0.55)
    layers.push(
      `[0:v]crop=${SKY_PATCH.w}:${SKY_PATCH.h}:${SKY_PATCH.x}:${SKY_PATCH.y},` +
      `scale=${outW}:${skyH}:flags=lanczos,` +
      `lutrgb=r='clip(val*${gain.r.toFixed(3)},0,255)':` +
      `g='clip(val*${gain.g.toFixed(3)},0,255)':` +
      `b='clip(val*${gain.b.toFixed(3)},0,255)',` +
      // grain and a touch of sharpening so the enlarged clouds do not read as
      // a soft upscale against the crisp artwork below
      `noise=alls=6:allf=t+u,unsharp=3:3:0.6,format=rgba,` +
      // clear at the zenith, full cloud where it meets the artwork
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*if(gte(Y,${fadeIn}),1,Y/${fadeIn})'[l2]`)
    overlays.push({ label: 'l2', x: 0, y: 0 })
  }

  // The artwork, fading in over its own strip of sky so the borrowed sky and
  // the real one meet inside a gradient rather than at an edge.
  const main = `l${overlays.length}`
  layers.push(blend > 0
    ? `[c_main]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
      `a='if(gte(Y,${blend}),255,Y*255/${blend})'[${main}]`
    : `[c_main]format=rgba[${main}]`)
  overlays.push({ label: main, x: 0, y: skyPx })

  if (groundPx > 0) {
    // Blurred dirt, cloned from the bottom of the artwork and stretched down.
    const lap = 30
    const band = Math.round(contentH * 0.09)
    const ground = `l${overlays.length}`
    layers.push(
      `[c_low]crop=${outW}:${band}:0:${contentH - band},` +
      `scale=${outW}:${groundPx + lap}:flags=lanczos,format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gte(Y,${lap}),255,Y*255/${lap})'[${ground}]`)
    overlays.push({ label: ground, x: 0, y: skyPx + contentH - lap })
  }

  // stack every layer onto a base canvas
  let chain = `color=s=${outW}x${outH}:c=black:d=1,format=rgba,trim=end_frame=1[bg]`
  let prev = 'bg'
  overlays.forEach((o, i) => {
    const next = i === overlays.length - 1 ? 'stacked' : `st${i}`
    chain += `;[${prev}][${o.label}]overlay=${o.x}:${o.y}[${next}]`
    prev = next
  })

  const out = join(OUT, `${name}.png`)
  ff(['-i', clean, '-i', content, '-filter_complex',
    `${layers.join(';')};${chain};[stacked]format=rgb24[out]`,
    '-map', '[out]', '-frames:v', '1', out])

  const parts = [`${contentH}px art`]
  if (skyPx) parts.push(`${skyPx}px sky`)
  if (groundPx) parts.push(`${groundPx}px ground`)
  console.log(`  ${name}.png  ${outW}x${outH}  (${parts.join(' + ')})`)
  return out
}

// --- 2. the covers ----------------------------------------------------------
mkdirSync(OUT, { recursive: true })
console.log('building covers from branding/noxrush.png')

// Kept as an asset in its own right: it is the source of all three covers, and
// it is the version to use anywhere public, since the captions on the original
// advertise a FRIENDS mode the portal build does not ship.
ff(['-i', clean, join(OUT, 'noxrush-nocaptions-1280x720.png')])
console.log('  noxrush-nocaptions-1280x720.png  1280x720  (caption strip painted out)')

// Landscape is already 16:9 — a straight 1.5x upscale, nothing invented.
ff(['-i', clean, '-vf', `scale=1920:1080:flags=lanczos`, join(OUT, 'cover-landscape-1920x1080.png')])
console.log('  cover-landscape-1920x1080.png  1920x1080  (1.5x upscale, no fill)')

// Square: 825x720 of artwork scales to 800x698, leaving 102px to invent.
cover({
  name: 'cover-square-800x800',
  outW: 800, outH: 800,
  crop: { x: SUBJECT.x, y: 0, w: SUBJECT.w, h: SRC_H },
  groundPx: 64,
})

// Portrait: 2:3 needs far more height than 16:9 has. Dropping the bottom 60
// rows of artwork keeps the car off the floor of the frame once ground is
// cloned back in underneath it.
cover({
  name: 'cover-portrait-800x1200',
  outW: 800, outH: 1200,
  crop: { x: SUBJECT.x, y: 0, w: SUBJECT.w, h: 660 },
  groundPx: 104,
})

// CrazyGames wants the static cover as frame one of each preview video. The
// landscape video is 1920x1080, so the landscape cover already serves. The
// portrait video is 1080x1620 — same 2:3 as the 800x1200 cover but larger, so
// it is composed again at video size rather than upscaled from the cover.
cover({
  name: 'preview-frame-portrait-1080x1620',
  outW: 1080, outH: 1620,
  crop: { x: SUBJECT.x, y: 0, w: SUBJECT.w, h: 660 },
  groundPx: 140,
})

rmSync(TMP, { recursive: true, force: true })
console.log('done')
