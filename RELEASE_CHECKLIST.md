# CrazyGames Release Checklist

Target: Basic Launch first (no SDK), then Full Launch if invited.
Requirements source: https://docs.crazygames.com/requirements/intro/

## The release command

```bash
npm run build          # -> dist/, enforces the 50 MB / 1,500 file budgets
npm run check          # self-contained? on-origin, no 404s, portal UI stripped
npm run check:iframe   # survives a real cross-origin embed? storage, input
npm run zip            # -> noxrush-v1.0.0.zip, index.html at archive root
```

All four must pass before uploading. As of 2026-08-13 they do:
**14.75 MB / 32 files unpacked, 9.39 MB zipped, 9/9 and 7/7 checks green.**

What is left is not engineering — it is the portal account, the gameplay video,
and hands-on playtesting. Those are marked **yours** below.

## 1 · Asset licensing (blocker — do first)

- [x] De-badge `models/kestrel_gt.glb`: star emblems (nose + trunk),
      "Polestar 1" decals + logo texture, and rear show-lattice removed;
      taillights reshaped. NOTE: silhouette still derives from the donor car —
      residual trade-dress resemblance accepted; procedural car (delete
      `models/manifest.json`) is the zero-risk fallback if challenged
- [x] Brand strings removed from inside `kestrel_gt.glb` (2026-08-13). The
      de-badging above only removed what a player could see; the file still
      named the marque in 5 node names (`volvo_*`) and 3 material names
      (`lightsbasekspolestarngr_*`). Renamed to `kestrel_*` / `bodypanel_*` via
      `scripts/rebrand-glb.mjs`, which now rewrites materials as well as nodes.
      `models/manifest.json` pins the wheel nodes by name and was updated in
      lockstep — verified all manifest references still resolve.
      `asset.extras` KEEPS the donor name on purpose: it is the CC-BY
      attribution, already public in CREDITS.md, and removing it would trade a
      trade-dress worry for a licence breach
- [x] Billboard pack cleared (2026-08-13): a raw string scan appeared to show
      "Bmw" three times, but all three are IEEE-754 float bytes in the vertex
      buffer (`BmwB` = `0x42 6D 77 42`), not text. Its `asset.extras` is clean
      and the three ad-screen textures are structural maps (albedo / ID mask /
      normal), not third-party advertisements
- [x] "Drivatar" removed (2026-08-13). It is a registered **Microsoft**
      trademark for exactly this feature in Forza, and despite the rename entry
      below claiming competitor references were cleared, 12 occurrences were
      still shipping in `dist/` — including 5 player-facing UI strings in the
      lobby mode cards and mode descriptions. All now read "rival(s)".
      Re-verified: zero occurrences anywhere in `dist/`
- [x] ~~Delete `models/tree.glb`~~ Replaced with `low_poly_trees.glb`
      ("Low poly trees" by Aditya Graphical, CC-BY 4.0 — cleared for
      commercial use, attribution in CREDITS.md; 3 MB, 12 tree variants)
- [x] Synth stand-ins wired for all 7 foley cues (2026-08-12) — `motorWhirr()`,
      `crankNoise()` and `scrapeNoise()` in `audio.js` join the existing
      `crashNoise()`, and every entry in the `sfx` foley block now falls back
      when `playSample` returns false. Verified both ways: with no `.wav`
      present all 7 cues still generate audio; with the `.wav`s present each
      plays the recording only, no double-trigger. **Deleting
      `public/audio/{click,grid-up,ignition,impact,panel,reset,scrape}.wav` is
      now a safe one-liner** — it drops ~1.3 MB and clears the licensing
      blocker below at the cost of the two recordings worth keeping
      (`impact`, `ignition`)
- [x] Unlicensed foley excluded from the build (2026-08-13). The 7 files stay in
      the repo for LAN play but `scripts/build-web.js` leaves them out of `dist/`
      by default, and `audio.js` skips fetching them when the build says
      `foley: false`, so a published ZIP contains no unlicensed audio and makes no
      requests for it. Every cue runs on its synth stand-in. `--with-foley`
      re-includes them for a private bundle only.
      PROVENANCE (checked 2026-08-12): each file's only embedded metadata is a
      RIFF `INFO/INAM` + id3 `TIT2` title of the form
      `AV_STARTUP_ClassicSupercar_01.assets` — the `.assets` suffix is Unity's
      serialized-asset container, i.e. these were ripped out of a Unity build
      with AssetStudio/AssetRipper, not downloaded from a library. No artist,
      copyright, vendor or library field is present in any of the seven, and
      the `AV_*` names match no public library. Treat as unlicensed: there is
      no clearance to document and no rights-holder to ask
- [ ] Optional: replace `impact.wav` and `ignition.wav` with Pixabay equivalents
      (`node scripts/install-foley.mjs --list`) — the only two whose recording
      clearly beats its synth version. Then they could ship again
- [x] `CREDITS.md` matches the shipped asset set — the stale
      `generic_passenger_car_pack.glb` block was removed (2026-08-12). Shipped
      models are `kestrel_gt.glb`, `low_poly_trees.glb` and
      `low-poly_billboard_pack.glb`, all CC-BY 4.0 and attributed
- [x] Engine loops cleared: source is "Roaring sports car" by **spinopel**
      (https://pixabay.com/sound-effects/roaring-sports-car-381841/, 7 s,
      Pixabay Content License — commercial use OK, no attribution required).
      Ship the derived loops, not the source mp3
- [x] Bot car pack de-branded (2026-08-13, `scripts/rebrand-glb.mjs`): all 14
      car nodes renamed off the real marques to Vantor / Dunecross / Aerix /
      Bastion / Halcyon / Vulpine / Warden. Verified no brand string remains
      anywhere in the .glb, and mesh/material/texture names were clean already.
      Licence was never the issue — CC-BY 4.0, ProbablyNotG, attributed
- [x] Residual trade-dress call on the bot cars: **accepted** (2026-08-13),
      consistent with the judgement already made for the player's car. Licence
      is clean (CC-BY 4.0, ProbablyNotG, attributed) and all 14 node names are
      fictional; only the silhouettes are donor-derived. Fallback if ever
      challenged is unchanged: delete the `bots` block from
      `models/manifest.json` and bots revert to the procedural body
- [x] Renamed the game to **NoxRush** (2026-08-13) — "Horizon" is Microsoft's
      Forza Horizon and "Rush" is Atari's San Francisco Rush, so both words went.
      Title, logo, in-world signage/banner textures, server banner, package name
      and console prefix all updated; competitor references removed from the
      shipped source and the public description. `hr_*` localStorage keys are
      deliberately unchanged — they hold every player's level, XP, PBs and
      medals, and renaming them would wipe all of it (see `progress.js`).
      CORRECTION (2026-08-13): "competitor references removed" was NOT true —
      "drivatar" survived in 12 places including 5 player-facing strings. Fixed
      in the entry above. Re-audited the whole bundle afterwards: the only other
      competitor-sounding hits are "horizon" inside vendored three.js (generic
      graphics term) and "horizontally" in a CSS comment — both fine
- [ ] Rename the repo directory from `horizon-rush` if you want it to match —
      nothing in the code depends on the folder name any more (the README's
      `--prefix horizon-rush` calls are gone)
- [ ] Confirm every remaining asset is CC0/CC-BY-cleared for commercial use

## 2 · Static build (`npm run build` -> `dist/`)

- [x] `scripts/build-web.js` produces a self-contained `dist/` with `index.html`
      at the root (`npm run build`). Copies `public/` as the bundle root, plus
      `shared/`, `models/*.glb` and the manifest; dev READMEs and `.DS_Store`
      never ship. Warns about stray files at the bundle root — which is how a
      2 MB screenshot left in `public/` was caught before it shipped
- [x] three.js vendored by resolving the import graph, not by bulk copy: core
      plus the 4 addons actually reachable (`GLTFLoader`, `RoundedBoxGeometry`,
      `RoomEnvironment`, `BufferGeometryUtils`) = **1.40 MB / 5 files**. Copying
      all of `examples/jsm` would have been 13 MB / 368 files
- [x] All 20 absolute asset paths made relative, fixed in source so one code path
      serves both builds. Note the split that matters: `import` specifiers resolve
      against the *module* URL (`../shared/x.js`), but `fetch()` and the glTF
      loader resolve against the *document* URL, so those are document-relative
      (`models/x.glb`) — a `../` there would climb out of a portal's subpath
- [x] Verified with `npm run check` (`scripts/check-dist.mjs`): serves `dist/`
      **on a subpath** in headless Chrome and asserts 9 things — every request
      stays on-origin, no 404s or failed loads, no page exceptions, lobby renders,
      player car + bot pack + both scenery models fetched, portal flag active, and
      the server-only UI is not visible. All 9 pass
- [x] Size budgets pass: **14.75 MB / 32 files** against 50 MB and 1,500
- [x] Stretch: first playable <= 20 MB for mobile-homepage eligibility —
      **cleared 2026-08-13, 14.75 MB**. Measured before choosing a lever:
      `kestrel_gt.glb` was 11.11 MB split 7.48 MB geometry / 3.56 MB textures,
      so mesh compression was the lever and texture recompression would have
      been nearly useless. Compared both options — quantize-only (8.54 MB, no
      decoder) and meshopt (5.50 MB, ~25 KB decoder) — and took meshopt for the
      extra headroom. `carModels.js` now routes all three `GLTFLoader` call
      sites through one `gltfLoader()` factory that attaches `MeshoptDecoder`;
      the build vendors the decoder automatically by following the
      `three/addons/` import. Verified visually, not just by "loaded": the car
      was re-rendered through `make-branding.mjs` and inspected — bodywork,
      wheels, splitter and lights all intact
- [x] Submission ZIP: `npm run zip` (`scripts/make-zip.mjs`) → **9.39 MB**. It
      builds the archive from *inside* `dist/` so `index.html` lands at the
      archive root, excludes `.DS_Store` / `__MACOSX`, deletes any stale ZIP
      first (zip appends by default), then re-opens the archive and asserts the
      layout rather than trusting it

## 3 · Portal mode (no-server UI)

- [x] Portal flag: the build writes `js/build-config.js` setting
      `window.__BUILD__`, read by `public/js/build.js`. The LAN build ships no
      such file, so it keeps every feature. `?portal=1` forces portal behaviour
      against the dev server for testing; the older `?offline=1` still skips just
      the socket
- [x] FRIENDS mode, party codes, the "FRIENDS JOIN AT" box, firewall hints, the
      `LAN ●` chip and the server-records panel are all suppressed in portal
      builds. Done with `body.portal` + `display: none !important` in `style.css`,
      deliberately **not** by removing the nodes: the lobby attaches listeners to
      the party buttons at load, so deleting them threw. `!important` also means
      the lobby's own `.hidden` toggles cannot bring them back
- [x] `mode` is forced off `friends` in portal builds, which also makes the
      "FRIENDS needs the LAN server" status line unreachable (it is guarded by
      `!solo`)
- [x] The `/info` LAN-address lookup is skipped entirely in portal builds
- [x] Title and tagline de-LANned: "NOXRUSH — Arcade Racing" / "ARCADE FESTIVAL
      RACING"
- [ ] Land players in gameplay fast — QUICK RACE exists on every step but is not
      the default entry (Full Launch QA checks time-to-gameplay)
- [x] Verified in a real cross-origin iframe — `npm run check:iframe`
      (`scripts/check-iframe.mjs`), 7/7 passing. It serves the game on
      `127.0.0.1` and the wrapping page on `localhost` (different sites to
      Chrome, so a genuine third-party embed), forces `--site-per-process` so
      the frame runs out-of-process like a real portal, and attaches to the
      iframe target **paused** so touch emulation lands before `main.js` runs —
      `bindTouchUI()` bails on anything that does not look coarse, so without
      that the touch test would silently pass by never binding. Asserts: frame
      really is cross-origin, game boots, keyboard events reach the frame
      window, touch UI un-hides, and a touch press on GAS sets both
      `touchState.throttle` and the button's `.on` class
- [x] Verify localStorage progression survives inside the portal iframe — covered
      by the same script, and it is the assertion that matters most. Writes XP
      through the game's own `progress.js`, **reloads the frame**, and reads it
      back: Chrome partitions storage by top-level site, so a bucket that reset
      per-load would wipe every player's level, XP, PBs and medals. It persists
- [ ] Gamepad inside an embed is still MANUAL — the Gamepad API has no CDP
      emulation, so it cannot be automated. Plug a pad into a real embed once

## 4 · Content & QA pass

- [x] PEGI-12 assessed — no violence, blood, gambling or adult content; no chat,
      no accounts, no external links; collisions are cosmetic. Reasoning written
      up in `SUBMISSION.md` for the rating form. Expected to clear comfortably
- [ ] Playtest all modes that ship: BOTS, TIME TRIAL, CHAMPIONSHIP, DAILY
- [ ] Test on a low-end machine at Medium/Low graphics. Watch draw calls now
      that bots use real models: splitting each pack car's merged wheels turns
      8 meshes into ~17, so a full 11-bot grid is ~190 draw calls of bot car
      alone. Triangles are cheap (~3,400/car vs the Kestrel's ~207,500) and the
      geometry is shared across instances, so draw-call count is the thing to
      measure, not memory
- [ ] Test mobile Safari + Chrome (touch UI, performance, audio unlock)
- [x] No external links, no links to other game sites, no donation buttons —
      verified 2026-08-13: `dist/` contains no `<a href>` at all. A raw URL scan
      does hit many `http(s)://` strings, but every one is a source-comment
      reference inside vendored three.js, not a navigable link. `npm run check`
      independently enforces the stronger property that no request leaves the
      origin at runtime

## 5 · Submission (Basic Launch)

- [ ] Register at https://developer.crazygames.com/  ← **yours, blocks upload**
- [ ] Upload `noxrush-v1.0.0.zip` (`npm run build && npm run zip`)
- [x] Game description + controls text written — `SUBMISSION.md`, paste-ready.
      Deliberately describes the portal build only: no multiplayer claim
      anywhere, since FRIENDS is absent from the uploaded build
- [x] Covers exist and are compliant NOW, and they are the **illustrated** ones:
      `node scripts/make-covers-from-art.mjs` rebuilds all three mandatory sizes
      (1920x1080, 800x1200, 800x800) from `branding/noxrush.png` — title-only,
      no captions, no borders, nothing scaled past 1.5x or stretched
      non-uniformly. No image generator needed. Landscape is a plain 1.5x
      upscale; square and portrait get their non-16:9 height from cloned ground
      and an extended sky, both built out of the plate itself. How, and why each
      choice, is in `branding/README.md`
- [ ] Optional upgrade: re-export the illustration at 2560x1440 and re-cut with
      `scripts/make-covers.mjs`, which crops without inventing any pixels and
      refuses to upscale. Strictly better than reconstruction, but it needs an
      image generator, so it is yours to run. **Source must be >= 2133x1200 —
      ask for 2560x1440.** 1920x1080 looks sufficient but is not: the widest 2:3
      crop from 16:9 is only `height x 0.667`, so a 1080-tall source yields a
      720-wide portrait crop being stretched to 800
- [x] The banner's "MULTIPLAYER — PLAY WITH FRIENDS" claim is fixed at the
      source, not just contained: `branding/noxrush-nocaptions-1280x720.png` is
      the same art with the whole caption strip painted out. Use it for the
      README header, store pages and social. The captioned `noxrush.png` is now
      an archive original — do not publish it. `SUBMISSION.md` makes no
      multiplayer claim, and no cover carries any caption
- [ ] Record a short gameplay video
- [ ] Respond to QA feedback (typically 1–2 days)

## 6 · Full Launch (only if invited)

- [ ] Integrate CrazyGames SDK: init, `gameplayStart` / `gameplayStop`,
      loading events
- [ ] Ad breaks through the SDK (between races is the natural slot);
      must work with AdBlock
- [ ] Optional: rewarded ad (e.g. bonus XP or nitro refill)
- [ ] Optional: tie progression to CrazyGames accounts via SDK data module
      instead of bare localStorage
- [ ] Decide on multiplayer: ship single-player only, or host a public
      `wss://` backend and implement their room/invite-link requirements

## Later / other portals

- [ ] Same `dist/` build works for Poki (their SDK differs), itch.io
      (no SDK needed), GameDistribution
