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

### Generic Passenger Car Pack (`models/generic_passenger_car_pack.glb`) — in repo, not currently wired
"Generic passenger car pack" (https://skfb.ly/6sUFy) by **Comrade1280** is
licensed under **CC Attribution 4.0**
(http://creativecommons.org/licenses/by/4.0/).
Cleared for commercial use with this attribution — the publishable car set.

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
- Engine loops derived from a Pixabay recording (see `public/audio/README.md`)
  — Pixabay Content License.
- `AV_*` foley one-shots: likely from a commercial SFX library — **replace
  before publishing** (see `public/audio/README.md`).
- Everything else (UI blips, wind, skids, horn, nitro, the lofi radio) is
  synthesized in code — no licence needed.

## Everything else
Code, tracks, world, HUD: original to this project.
