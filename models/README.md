# Car models

The game ships with a procedurally built car. Drop a `.glb` here plus a
`manifest.json` to use a real model instead; delete `manifest.json` to go back.

## Currently installed

`car.glb` — Audi R8 LMS 2016, from Sketchfab (Free Standard licence), converted
by Sketchfab from FBX. 18.2 MB, 397 nodes, 159 meshes, 46 materials, 245,337
triangles. Loads in ~120 ms off localhost.

Scaled to 4.58 m it lands a **2.70 m wheelbase** against the real car's 2.65 m,
and 2.00 m wide against 2.05 m — so the proportions are right.

## manifest.json

```json
{
  "file": "car.glb",
  "faces": "+z",
  "lengthMeters": 4.58,
  "paintMaterials": ["material_1", "EXT_Car_Paint"],
  "wheelNodes": ["WHEEL_LR", "WHEEL_LF", "WHEEL_RF", "WHEEL_RR"],
  "applyTo": "humans"
}
```

| Field | Meaning |
| --- | --- |
| `faces` | Which way the nose points in the model's own space (`+z`, `-z`, `+x`, `-x`) |
| `lengthMeters` | Model is uniformly scaled to this bumper-to-bumper length |
| `paintMaterials` | Material names (substring match) tinted with each player's colour |
| `wheelNodes` | Node names that spin with road speed |
| `applyTo` | `all` \| `humans` (default) \| `player` — see performance below |
| `excludeMaterials` | Optional: drop meshes whose material matches, to save triangles |
| `driverEye` | Optional `[side, up, forward]` eye point for the `C` driver view |

### Setting `driverEye`

Without it the eye point is guessed from the car's bounding box, which is only a
rough fit. For this model the measured values are `[0.28, 0.95, 0.30]`.

Getting `up` right matters most, and the trap is that it is easy to end up
*above* the roof, which silently turns the driver view into a floating hood cam.
On this car the roof spans 1.06–1.17 m with the model scaled to 4.58 m, so 0.95
sits the driver just under it. To measure your own, find the cabin node's
vertical range and subtract roughly 0.2 m from the top.

### Two gotchas this model demonstrates

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
node scripts/inspect-model.mjs models/car.glb
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
