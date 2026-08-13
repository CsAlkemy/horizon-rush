# Credits & asset licences

## 3D models

### "Kestrel GT" (`models/kestrel_gt.glb`) — ACTIVE
"Volvo Polestar One K.S edition" (https://skfb.ly/puJwo) by **3D Cars Studio**
is licensed under **CC Attribution 4.0**
(http://creativecommons.org/licenses/by/4.0/). Modified: file renamed (the car
appears in-game as the fictional "Kestrel GT"), rescaled, re-oriented; at load
time the game adds wheel rigs, carves the steering wheel into a rotatable rig,
and recolours the livery texture per player. De-badged and altered in-mesh
(2026-08-12): the Polestar star emblems on the nose and trunk, the "Polestar 1"
decal quads and their logo texture, and the rear show-lattice were removed, and
the taillight elements were reshaped (vertically compressed) so the light
signature no longer matches the donor car.

> All brand emblems, logos and model-name decals have been removed and detail
> geometry altered; no trademarked name or mark appears in-game. The overall
> silhouette still derives from the donor car, so a residual trade-dress
> resemblance remains — judged acceptable for a stylized arcade game, but the
> procedural car stays the zero-risk fallback (delete `manifest.json`).

### Trees (`models/low_poly_trees.glb`)
"Low poly trees"
(https://sketchfab.com/3d-models/low-poly-trees-51cae4a194344e8bbfbd0a4cff205f76)
by **Aditya Graphical** (https://sketchfab.com/Adityakm) is licensed under
**CC Attribution 4.0** (http://creativecommons.org/licenses/by/4.0/).
Modified: each of the pack's 12 trees is baked into an impostor billboard at
load time and tinted per instance; the pack's rock is unused. Cleared for
commercial use with this attribution.

### Billboards (`models/low-poly_billboard_pack.glb`) — ACTIVE
"Low-poly Billboard Pack" (https://skfb.ly/ouGyw) by **staticcc** is licensed
under **Creative Commons Attribution**
(http://creativecommons.org/licenses/by/4.0/).
Modified: repacked into three self-contained billboard units (world transform
baked, each recentred with its screen facing +z); the pack's spare empty frame
and placeholder screen images were dropped — the game draws its own ad artwork
on the screens at load time. Cleared for commercial use with this attribution.

## Audio

### Engine loops (`engine-low.wav`, `engine-high.wav`) — cleared
Derived from "Roaring sports car" by **spinopel**
(https://pixabay.com/sound-effects/roaring-sports-car-381841/) under the
**Pixabay Content License** — commercial use permitted, no attribution
required (credited here anyway). Modified: two pitch-stable slices cut out,
looped on whole engine cycles with crossfaded seams, then crossfaded by revs
and pitched at runtime. The source mp3 is not redistributed.

### Foley one-shots — **NOT CLEARED, do not publish as-is**
The seven files `ignition/impact/scrape/click/grid-up/panel/reset.wav` carry
`AV_*_*.assets` titles, i.e. they were extracted from a Unity build rather than
licensed. No rights-holder is identifiable. See `public/audio/README.md` for the
full finding. Replace with `node scripts/install-foley.mjs`, or delete them and
let the synth fallbacks in `audio.js` cover the cues.

Once installed, the replacements are all **Pixabay Content License**
(commercial use OK, no attribution required — credited here as courtesy):

| Cue | Sound | Author |
| --- | --- | --- |
| `ignition` | [Car engine start - sound effect](https://pixabay.com/sound-effects/car-engine-start-sound-effect-521106/) | PWLPL |
| `impact` | [Car Crash Sound](https://pixabay.com/sound-effects/car-crash-sound-376882/) | DRAGON-STUDIO |
| `scrape` | [Metal Scrape](https://pixabay.com/sound-effects/metal-scrape-103668/) | dslrguide (via Freesound) |
| `click` | [UI Button Click Mechanical](https://pixabay.com/sound-effects/ui-button-click-mechanical-515078/) | SoundShelfStudio |
| `grid-up` | [Whoosh 07](https://pixabay.com/sound-effects/whoosh-07-410877/) | DRAGON-STUDIO |
| `panel` | [Whoosh 09](https://pixabay.com/sound-effects/whoosh-09-410876/) | DRAGON-STUDIO |
| `reset` | [Whoosh 06](https://pixabay.com/sound-effects/whoosh-06-410874/) | DRAGON-STUDIO |

### Synthesized in code — no licence needed
UI blips, wind, skids, horn, nitro, the lofi radio, and the fallback stand-ins
for every cue above (`crashNoise`, `crankNoise`, `scrapeNoise`, `motorWhirr`).

## Everything else
Code, tracks, world, HUD: original to this project.
