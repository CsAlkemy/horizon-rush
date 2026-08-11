# Car models

The game ships with a procedurally built car. Drop a `.glb` here plus a
`manifest.json` to use a real model instead; delete `manifest.json` to go back.

## Currently installed

`kestrel_gt.glb` (in-game: "Kestrel GT") — a widebody Polestar 1 drift build
("Volvo Polestar One K.S edition" by 3D Cars Studio, CC-BY 4.0 — see
`CREDITS.md`). 11.8 MB, 217 nodes, 70 meshes, 32 materials, 213,164 triangles,
full interior.

The bounding box includes the rear wing's overhang, so `lengthMeters` is set to
4.8 to land the body itself at ≈4.5 m (wheelbase ≈2.6 m against the real car's
2.74 m).

The player colour lives in the baked livery texture (`roofpart_1`): its teal
panels are recoloured in texture space per car (dominant-hue match, luminance
preserved — see `buildLiveryCache` in `carModels.js`), so the paint reads
solid while the black stripes, black shell (`movsteer_0_5_0`, which doubles as
the cockpit trim) and logos stay untouched. Multiplying a colour into the
texture instead just muddies it — teal × red is near-black.

The steering wheel is merged into the interior meshes in this export, so the
`steeringWheel` manifest entry carves it out at load time and the animator
turns it with the front wheels (see below).

## manifest.json

```json
{
  "file": "kestrel_gt.glb",
  "faces": "+z",
  "lengthMeters": 4.8,
  "paintMaterials": ["roofpart_1"],
  "wheelNodes": ["volvo_Wheel_Ft_L", "volvo_Wheel_Ft_R", "volvo_Wheel_Bk_L", "volvo_Wheel_Bk_R"],
  "lampMaterials": ["front_light", "rear_light"],
  "steeringWheel": {
    "marker": "Object_114", "axis": [0, 0.38, -0.92],
    "center": [0.35, 0.83, 0.3], "radius": 0.26, "depth": 0.12, "maxTurn": 2.2
  },
  "applyTo": "humans",
  "driverEye": [0.33, 0.97, -0.18]
}
```

| Field | Meaning |
| --- | --- |
| `faces` | Which way the nose points in the model's own space (`+z`, `-z`, `+x`, `-x`) |
| `lengthMeters` | Model is uniformly scaled to this bumper-to-bumper length |
| `paintMaterials` | Material names (substring match) recoloured with each player's colour. Untextured materials get a plain tint; textured ones (baked liveries) are recoloured in texture space so the result stays solid |
| `wheelNodes` | Node names that spin with road speed |
| `applyTo` | `all` \| `humans` (default) \| `player` — see performance below |
| `excludeMaterials` | Optional: drop meshes whose material matches, to save triangles |
| `lampMaterials` | Optional: material substrings treated as head/tail lamps, replacing the built-in name heuristic (front/rear is still decided by geometry) |
| `paintShade` | Optional 0–1: darkens a plain (untextured) paint tint — for models whose paint material bleeds into the cockpit trim |
| `steeringWheel` | Optional: carve a rotatable steering wheel out of merged interior meshes — `marker` names a mesh on the wheel face, `axis`/`center` the steering column (car space), `radius`/`depth` the carve cylinder, `maxTurn` the visual lock in radians |
| `driverEye` | Optional `[side, up, forward]` eye point for the `C` driver view |

### Setting `driverEye`

Without it the eye point is guessed from the car's bounding box, which is only a
rough fit. For this model the measured values are `[0.33, 0.97, -0.18]` —
left-hand drive, seated square behind the wheel (the carved wheel's hub sits at
x ≈ 0.35 with the model scaled to 4.8 m).

Getting `up` right matters most, and the trap is that it is easy to end up
*above* the roof, which silently turns the driver view into a floating hood cam.
On this car the roof tops out around 1.28 m, so 0.96 sits the driver just under
the headliner. To measure your own, find the cabin node's vertical range and
subtract roughly 0.2 m from the top.

### Two gotchas (learned on a previous model, still apply)

**The paint material is not the one you'd guess.** The main body panel — 16,052
triangles, node `GEO_chassis_SUB0_EXT_Car_Paint1_0` — uses a material named
`material_1`, because Sketchfab's FBX conversion renamed it. Tinting only
`EXT_Car_Paint*` left the body stubbornly white. Always check the real material
names with the inspector below.

**Wheel names nest.** `WHEEL_LR` is a substring of `WHEEL_LR_EXT_Tyre_0`, so a
naive substring match grabs 20 nodes instead of 4 and spins parents and children
together, double-rotating and tumbling the child on its own axis. The loader now
keeps only the outermost matching node per wheel, so listing the four parents is
enough.

## Trees (`tree.glb`)

Dropped in automatically if `models/tree.glb` exists — no manifest entry needed.

The supplied tree is **551,864 triangles** (332,928 of that in the bark alone).
That cannot be instanced across a landscape: 260 of them would be 143 million
triangles a frame, where the entire rest of the world is 223,000.

So the model is **baked into an impostor** at startup instead. It is rendered
once into a transparent texture with an orthographic camera, and that image is
drawn on two quads crossed at 90°, one instanced draw call for the lot. The trees
still look like this model, at **4 triangles each** instead of 551,864 — 420 of
them cost 1,680 triangles. The source geometry is disposed right after the bake,
so the 551k triangles are not kept in memory.

Variety comes from per-instance height, a random Y rotation of the cross, and a
slight per-tree shade tint, so one baked image does not read as the same tree
stamped 420 times.

Crossed quads rather than a billboard shader is a deliberate choice: they need no
custom shader, they get fog and sorting for free, and they stay correctly
grounded when the camera looks down — a fully camera-facing billboard visibly
tilts. Swap in any tree `.glb` and it is re-baked on the next load.

## Brake lights

Front and rear lamps frequently share one material name — on this car both are
`EXT_Lights` — so which end a lamp is on is decided by **geometry**, not the
name: the model faces +Z by this point, so a lamp mesh centred at z < 0 is a tail
light. On the R8 that resolves to 6 headlamp materials and 4 taillamp materials.

Watch out for one trap if you edit the matching: the word "tail" appears inside
"Details". Matching it as a bare substring turns `EXT_Details1` and
`INT_DETAILS_TEXT` into brake lights, so body trim glows red under braking. The
pattern requires a word boundary for exactly this reason.

## Inspecting a model

```bash
node scripts/inspect-model.mjs models/kestrel_gt.glb
```

Prints node names, material names, triangle count, orientation and a suggested
manifest. Run this first — the manifest depends on names you cannot guess.

## Performance

Measured on this machine with a full twelve-car grid (counts include the shadow
pass, which renders the geometry a second time):

| `applyTo` | Draw calls | Triangles | Result |
| --- | --- | --- | --- |
| `all` (interior stripped) | 2,353 | 3.35 M | **36 fps — too slow** |
| `humans` (default) | ~600 | ~1.4 M | smooth |
| `player` | ~430–730 | ~0.9 M | smooth |

`humans` gives you and your friend the R8 while the ten AI keep the light
procedural bodies. That is the right trade: you spend nearly all your time
looking at your own car and whoever you are racing.

If it stutters, either add `"excludeMaterials": ["INT_"]` — the cockpit is
108,365 triangles, 44% of the model, and barely visible through the glass from
the chase camera — or drop to `"player"`.

## Only use models you have the right to use

Good sources: **Kenney** (CC0), **Quaternius** (CC0), **Poly Pizza** (CC0/CC-BY),
**Sketchfab** filtered to Downloadable + CC0/CC-BY.

Two things to keep in mind about the model installed here. Real car brands carry
trademark rights independent of the mesh licence, so an Audi-branded car is fine
for private play on your own LAN but not for anything you publish. And the `AC -`
prefix in its title suggests it originated as an Assetto Corsa mod — when a
model's chain of custody is unclear, an uploader marking it "free" does not
necessarily mean they held the rights to license it. Avoid repositories with no
licence file at all: no licence means all rights reserved.
