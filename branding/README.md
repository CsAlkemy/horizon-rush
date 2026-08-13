# Branding art

## What is here now

| file | size | role |
|---|---|---|
| `cover-landscape-1920x1080.png` | 1920×1080 | CrazyGames cover — **mandatory** |
| `cover-portrait-800x1200.png` | 800×1200 | CrazyGames cover — **mandatory** |
| `cover-square-800x800.png` | 800×800 | CrazyGames cover — **mandatory** |
| `banner-wide-2560x800.png` | 2560×800 | wide banner for store pages / social |
| `logo-wordmark-1600x500.png` | 1600×500 | transparent wordmark |
| `noxrush.png` | 1280×720 | illustrated hero banner — original, has captions |
| `noxrush-nocaptions-1280x720.png` | 1280×720 | same art, caption strip removed — **use this publicly** |

The three covers are now **cut from the illustration**
(`make-covers-from-art.mjs`, see below). `banner-wide-2560x800.png` and
`logo-wordmark-1600x500.png` are still **rendered from the game**
(`make-branding.mjs`), using the real car model and the real brand tokens
(`--cyan #35e0e6`, `--accent #ff2d78`).

⚠️ `make-branding.mjs` writes the same three `cover-*.png` filenames. Running it
overwrites the illustrated covers with rendered ones.

## Building the covers from `noxrush.png`

    node scripts/make-covers-from-art.mjs

No arguments, no new art needed. It solves the three things that stand between
that 1280×720 banner and a compliant cover set, and it is worth knowing how,
because the same constraints apply to any replacement artwork.

**The captions.** The strip across the bottom breaks
https://docs.crazygames.com/requirements/game-covers/ outright — text beyond the
game title is not allowed, and one caption is literally "PLAY NOW", the exact
example their rules give. It is painted out with ground cloned from *below* it:
the dirt at y=662..720 is clean, and stretched vertically it covers y=588..720.
The foreground is heavy motion blur, so there is no detail for a seam to
disagree with. The car's splitter bottoms out at y≈590, which is the only reason
the strip can be covered without touching the car.

This also settles the content problem: the captions advertise **"MULTIPLAYER —
PLAY WITH FRIENDS"**, and the portal build has FRIENDS mode removed because
there is no server behind it. That claim is false for the version being
submitted, and QA rejects false claims. `noxrush-nocaptions-1280x720.png` is the
plate with that strip gone — use it anywhere public, including the README header.

**The upscale.** 1280→1920 is 1.5×, which lanczos handles without tripping "no
blurry or pixelated visuals". Nothing in the set is scaled past that, and
nothing is stretched non-uniformly — a vertically squashed car is obvious even
to someone not looking for it.

**The missing height.** Square and portrait are not 16:9, so 102px and 560px of
frame respectively do not exist in the source. It comes from two places:

- *Ground, cloned downward.* Free — it is blurred dirt, the same trick as the
  caption fix.
- *Sky, extended upward.* Three layers. A backdrop of the artwork's own top rows
  stretched up, blurred wide **before** the stretch so it cannot streak, which
  makes the join match column by column even though the sky shades cool-left to
  bright-right. A darkening gradient over it, because a real sky deepens toward
  the zenith. Then real cloud texture lifted from the top-right of the plate —
  the only large patch of sky the title and the gate leave clear —
  exposure-matched to the sky it meets, grained so it does not read as an
  upscale, and faded out toward the zenith.

The artwork then fades in over its own top ~32 rows, so the borrowed sky and the
real one meet inside a gradient instead of at an edge. 32 rows is the entire
budget: the title starts at row 43.

| cover | composition |
|---|---|
| `cover-landscape-1920x1080.png` | straight 1.5× upscale, nothing invented |
| `cover-square-800x800.png` | 698px art + 38px sky + 64px ground |
| `cover-portrait-800x1200.png` | 640px art + 456px sky + 104px ground |

**The wide banner cannot come from this art.** At 3.2:1 the frame is 44% as tall
as it is wide, but the title and car together span 76% of the source height, so
no crop holds both. Filling the difference sideways would mean inventing city on
the left and gate on the right, which is nothing like as forgiving as sky and
dirt. It stays rendered.

## Re-exporting the illustration is still the better path

Everything above is reconstruction. If the artwork can be regenerated at size,
`make-covers.mjs` cuts all three covers as pure downscales — no invented pixels
at all — and that is strictly better. Use it the moment larger art exists.

Generate ONE source image, then let `make-covers.mjs` cut all three crops:

    node scripts/make-covers.mjs branding/source-art.png
    node scripts/make-covers.mjs branding/source-art.png --focus-x 0.62 --focus-y 0.45

### Size the source correctly

**Minimum 2133×1200. Ask for 2560×1440.**

This trips people up. 1920×1080 sounds sufficient because it matches the
landscape cover exactly — but the portrait is 2:3, and the widest 2:3 crop out
of a 16:9 image is only `height × 0.667` across. At 1080 tall that is a 720-wide
crop being stretched to 800, which is upscaling, which is a rejection. The
script refuses to do it silently and tells you so.

At 2560×1440 every crop is a downscale:

| cover | crop taken from a 2560×1440 source | result |
|---|---|---|
| 1920×1080 | 2560×1440 (whole image) | downscale |
| 800×1200 | 960×1440 | downscale |
| 800×800 | 1440×1440 | downscale |

### What the art must and must not contain

- **The title "NOXRUSH" and nothing else.** No feature captions, no "PLAY NOW",
  no platform badges, no borders or frames.
- **No multiplayer claim** — the submitted build is single-player.
- **A subject that survives a 2:3 crop.** The portrait keeps only the middle
  ~37% of the width. Put the car centred and reasonably upright in frame; a
  wide side-on composition loses its nose and tail in the portrait crop.
- **Title placed away from the edges**, since each crop trims a different
  amount. Check all three outputs by eye — the script cannot tell you the
  title got clipped.

Use `--focus-x` / `--focus-y` (0..1 of the source) to aim the crop at the car
rather than the geometric centre. Offsets are clamped to stay inside the image,
so the crop can never pick up black padding.

## Regenerating the rendered set instead

    npm start                                  # in one terminal
    node scripts/make-branding.mjs             # in another

Writes all five files above. `--name` re-letters everything in one pass if the
game is renamed; `--car Vulpine` swaps the hero car.

Notes worth keeping from that renderer: the floor is a `ShadowMaterial` so it
draws only the car's shadow and the background gradient survives; the paint is
orange because a cool colour disappears into the cyan/blue backdrop; and
portrait is framed from nearer the nose, because at 2:3 the horizontal field is
about 4 m at a workable distance — narrower than the 4.8 m car, so a side-on
three-quarter view always clipped.
