# Sound effects

A recorded engine plus recorded car foley. Wind and tyre-scrub are still
synthesised in `public/js/audio.js`.

## Engine (`engine-low.wav`, `engine-high.wav`)

Derived from `spinopel-roaring-sports-car-381841.mp3` (7.44 s). That recording is
a performance — idle, then a rev sweep, then decel and fade — so it can't be
looped directly: a loop whose pitch rises sounds like a repeating "wow".

Two pitch-stable slices were cut out of it instead:

| Loop | From | Length | Fundamental | Pitch jitter | Loop seam |
| --- | --- | --- | --- | --- | --- |
| `engine-low.wav` | 1.650 s | 0.399 s (28 cycles) | 70.3 Hz | 3.5% | 0.024 |
| `engine-high.wav` | 3.300 s | 0.349 s (31 cycles) | 88.7 Hz | 1.2% | 0.015 |

Each is an exact whole number of engine cycles, with the last two cycles
crossfaded into the first two, so the seam is inaudible.

At runtime both loop continuously and are **crossfaded by revs**, each pitched
with `playbackRate`. Two layers keep the pitch stretch under 1.7x — stretching a
single loop across the whole rev range is what makes engines sound thin and
synthetic at the top end. The handover runs across 80–100 Hz so each layer plays
near its recorded pitch. The lowpass opens with throttle (roughly 900 Hz closed
to 4600 Hz under load), so lifting off audibly closes the engine down.

`F0_LOW` and `F0_HIGH` in `audio.js` are these measured fundamentals. **If you
replace these files, update those two constants** or the pitch mapping will be
wrong.

Call `engineStatus()` from `audio.js` to check which engine is running — it
reports `mode: 'recorded'`, or `'synth'` if the files failed to load and the game
fell back to the oscillator bed.

## One-shot foley

The mapping is the `SAMPLES` table at the top of `public/js/audio.js`, and each
is fired from a named entry in the `sfx` object at the bottom of the same file.

| File | Used for | Currently |
| --- | --- | --- |
| `ignition.wav` | Engine crank on **READY — START ENGINE** (and RACE AGAIN) | `AV_STARTUP_ClassicSupercar_01` — **unlicensed, replace** |
| `impact.wav` | Body hits — guardrail and car-to-car. Louder and pitched down with impact speed | `AV_TRUNKDOWN_ModernSportsCar_01` — **unlicensed, replace** |
| `scrape.wav` | Metal-on-metal while sliding along the barrier (rate-limited to 2/sec) | `AV_TRUNKUP_ModernSportsCar_01` — **unlicensed, replace** |
| `click.wav` | Paint-swatch / UI click | `AV_TRUNKOPEN_ModernSportsCar_01` — **unlicensed, replace** |
| `grid-up.wav` | Lobby closes and the grid forms | `AV_WINDOWSUP_ModernSportsCar_01` — **unlicensed, replace** |
| `panel.wav` | Results panel appears | `AV_WINDOWSDOWN_ModernSportsCar_01` — **unlicensed, replace** |
| `reset.wav` | Pressing **R** to reset onto the track | `AV_TOPRETURN_ModernSportsCar_01` — **unlicensed, replace** |

## Replacing them

`node scripts/install-foley.mjs --list` prints a verified Pixabay pick for each
cue with its URL. Pixabay sits behind Cloudflare so the downloads cannot be
scripted — grab the seven mp3s in a browser, then:

    node scripts/install-foley.mjs ~/Downloads --purge

That converts each to mono 44.1 kHz 16-bit PCM, trims the leading silence, caps
it to the length the cue wants, fades the tail 15 ms and peak-normalizes to
-1.5 dBFS. `--purge` deletes any cue you did not replace, so the folder can
never be left holding an unlicensed file. Partial sets are fine.

Because the installer ships everything pre-trimmed, the `sfx` entries no longer
pass `offset`/`duration` to `playSample` — those existed only to skip the quiet
run-in on the long library recordings, and on a short file an offset past the end
plays near-silence.

## Every one-shot has a synth fallback

`playSample` returns `false` when a sample is missing or undecoded, and every
foley entry checks it:

| Cue | Fallback |
| --- | --- |
| `impact` | `crashNoise()` — filtered noise burst, scaled by strength |
| `ignition` | `crankNoise()` — starter whirr, 3 compression chugs, then the catch |
| `scrape` | `scrapeNoise()` — narrow bandpass on the noise bed, swept up |
| `gridUp` / `panel` / `reset` | `motorWhirr()` — sawtooth armature + noise band, swept up for `gridUp`/`reset` and down for `panel` |
| `click` | a short square `blip()` |

So **every one of these files can be deleted without any cue going silent** —
the game degrades to fully synthesized audio. Only `engine-low/high.wav` change
character noticeably (they fall back to the oscillator bed; `engineStatus()`
reports which is live).

## Licensing

**The engine loops are cleared.** Source is "Roaring sports car" by **spinopel**
(https://pixabay.com/sound-effects/roaring-sports-car-381841/, 7 s) under the
Pixabay Content License — commercial use permitted, no attribution required.
Ship the derived loops, not the source mp3, since the licence does not cover
redistributing the original file as a standalone asset.

**The 7 foley one-shots are not cleared, and should be treated as unlicensed.**
Checked 2026-08-12: the only metadata in each file is a RIFF `INFO/INAM` plus an
id3 `TIT2` title of the form `AV_STARTUP_ClassicSupercar_01.assets`. The
`.assets` suffix is Unity's serialized-asset container — that filename is what
AssetStudio/AssetRipper writes when extracting audio from a Unity build, so
these were ripped from a game, not downloaded from a library. There is no
artist, copyright, vendor or library field in any of the seven, and the `AV_*`
names match no public SFX library (searched Soundsnap, A Sound Effect, Sonniss's
royalty-free GDC bundles, Pixabay, Unity Asset Store).

There is therefore no clearance to document and no rights-holder to ask. Do not
ship them to a portal — run the installer above, or delete them and let the
synth fallbacks cover it.
