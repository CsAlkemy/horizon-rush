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

| File in this folder | Original | Used for |
| --- | --- | --- |
| `ignition.wav` | `AV_STARTUP_ClassicSupercar_01` | Engine crank when you press **READY — START ENGINE** (and RACE AGAIN) |
| `impact.wav` | `AV_TRUNKDOWN_ModernSportsCar_01` | Body hits — guardrail and car-to-car. Louder and pitched down with impact speed |
| `scrape.wav` | `AV_TRUNKUP_ModernSportsCar_01` | Metal-on-metal while sliding along the barrier (rate-limited to 2/sec) |
| `click.wav` | `AV_TRUNKOPEN_ModernSportsCar_01` | Paint-swatch / UI click |
| `grid-up.wav` | `AV_WINDOWSUP_ModernSportsCar_01` | Lobby closes and the grid forms |
| `panel.wav` | `AV_WINDOWSDOWN_ModernSportsCar_01` | Results panel appears |
| `reset.wav` | `AV_TOPRETURN_ModernSportsCar_01` | Pressing **R** to reset onto the track |

## Why these placements

`impact.wav` is the one obvious win: it's 0.2 s with its peak 40 ms in and a
much lower zero-crossing rate than the others (9.3k vs ~46k), i.e. a short dull
percussive thud — exactly what a car body hitting a barrier sounds like. It
replaced a synthesised noise burst.

`ignition.wav` is a 1 s crank-and-catch, so it goes where an engine starts.

The rest are trunk, window and convertible-roof mechanisms — sustained bright
motor whirrs of 1.5–5.2 s. A race never opens a trunk or rolls a window, so
these have no literal home in the game. They're placed as UI and mechanism
sounds where a motor whirr reads plausibly. Moving them is easy: the mapping is
the `SAMPLES` table at the top of `public/js/audio.js`, and each is fired from a
named entry in the `sfx` object at the bottom of the same file.

Longer files are played from an offset so you hear the meaty part rather than
the quiet run-in — see the `offset`/`duration` options on `playSample`.

## Licensing

The engine came from a Pixabay-style download (`author-title-id.mp3`); the
Pixabay Content License permits use without attribution but not redistributing
the raw file as a standalone asset. The foley files use an `AV_` library naming
convention, so they likely came from a commercial SFX pack.

Keep both licences with the project and check the terms before committing this
folder to a public repo — many commercial libraries allow use inside a project
but not redistribution of the source recordings. Your own LAN is fine either way.
