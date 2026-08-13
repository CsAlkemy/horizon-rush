# CrazyGames Release Checklist

Target: Basic Launch first (no SDK), then Full Launch if invited.
Requirements source: https://docs.crazygames.com/requirements/intro/

## 1 · Asset licensing (blocker — do first)

- [x] De-badge `models/kestrel_gt.glb`: star emblems (nose + trunk),
      "Polestar 1" decals + logo texture, and rear show-lattice removed;
      taillights reshaped. NOTE: silhouette still derives from the donor car —
      residual trade-dress resemblance accepted; procedural car (delete
      `models/manifest.json`) is the zero-risk fallback if challenged
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
- [ ] Residual trade-dress call on the bot cars: the shapes are still
      recognisable real-world designs, and unlike `kestrel_gt.glb` they have not
      been reshaped in-mesh. Either accept it (same judgement already made for
      the player's car), reshape them, or drop the pack — deleting the `bots`
      block from `models/manifest.json` reverts bots to the procedural body and
      the code falls back cleanly
- [x] Renamed the game to **NoxRush** (2026-08-13) — "Horizon" is Microsoft's
      Forza Horizon and "Rush" is Atari's San Francisco Rush, so both words went.
      Title, logo, in-world signage/banner textures, server banner, package name
      and console prefix all updated; competitor references removed from the
      shipped source and the public description. `hr_*` localStorage keys are
      deliberately unchanged — they hold every player's level, XP, PBs and
      medals, and renaming them would wipe all of it (see `progress.js`)
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
- [x] Size budgets pass: **20.59 MB / 31 files** against 50 MB and 1,500
- [ ] Stretch: first playable <= 20 MB for mobile-homepage eligibility. Currently
      0.59 MB over. `kestrel_gt.glb` is 11.1 MB of the 20.59, so Draco or meshopt
      on that one file is the only lever with real headroom

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
- [ ] Verify touch controls + gamepad still work in a real cross-origin iframe
- [ ] Verify localStorage progression survives inside the portal iframe (some
      embedding contexts partition storage)

## 4 · Content & QA pass

- [ ] PEGI-12 check (should already pass — no violence/gambling/adult content)
- [ ] Playtest all modes that ship: BOTS, TIME TRIAL, CHAMPIONSHIP, DAILY
- [ ] Test on a low-end machine at Medium/Low graphics. Watch draw calls now
      that bots use real models: splitting each pack car's merged wheels turns
      8 meshes into ~17, so a full 11-bot grid is ~190 draw calls of bot car
      alone. Triangles are cheap (~3,400/car vs the Kestrel's ~207,500) and the
      geometry is shared across instances, so draw-call count is the thing to
      measure, not memory
- [ ] Test mobile Safari + Chrome (touch UI, performance, audio unlock)
- [ ] No external links, no links to other game sites, no donation buttons

## 5 · Submission (Basic Launch)

- [ ] Register at https://developer.crazygames.com/
- [ ] Upload the `dist/` ZIP
- [ ] Write game description + controls text (reuse README tables)
- [x] Cover images done (2026-08-13) — all three mandatory sizes in `branding/`,
      generated by `scripts/make-branding.mjs` from the real car model. Title
      only, no tagline/border/icons, per their cover rules. Re-run with
      `--name` if the game is ever renamed again
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
