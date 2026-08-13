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
- [ ] Decide: ship the synth stand-ins, or source CC0/Pixabay replacements for
      `impact.wav` and `ignition.wav` (the only two that beat their synth
      version) and delete the other five outright
      PROVENANCE (checked 2026-08-12): each file's only embedded metadata is a
      RIFF `INFO/INAM` + id3 `TIT2` title of the form
      `AV_STARTUP_ClassicSupercar_01.assets` — the `.assets` suffix is Unity's
      serialized-asset container, i.e. these were ripped out of a Unity build
      with AssetStudio/AssetRipper, not downloaded from a library. No artist,
      copyright, vendor or library field is present in any of the seven, and
      the `AV_*` names match no public library. Treat as unlicensed: there is
      no clearance to document and no rights-holder to ask
- [x] `CREDITS.md` matches the shipped asset set — the stale
      `generic_passenger_car_pack.glb` block was removed (2026-08-12). Shipped
      models are `kestrel_gt.glb`, `low_poly_trees.glb` and
      `low-poly_billboard_pack.glb`, all CC-BY 4.0 and attributed
- [x] Engine loops cleared: source is "Roaring sports car" by **spinopel**
      (https://pixabay.com/sound-effects/roaring-sports-car-381841/, 7 s,
      Pixabay Content License — commercial use OK, no attribution required).
      Ship the derived loops, not the source mp3
- [ ] Confirm every remaining asset is CC0/CC-BY-cleared for commercial use

## 2 · Static build (`dist/` from a build script)

- [ ] Write `scripts/build-web.js` producing a self-contained `dist/` with
      `index.html` at the root
- [ ] Vendor the three.js files the import map needs (currently served from
      `node_modules` by `server.js` at `/vendor/three/`)
- [ ] Convert all absolute paths to relative — portals host games in
      iframes/subpaths. Known sites: `index.html` (`/css/style.css`,
      `/js/main.js`, both import-map entries), `/shared/*.js` imports in
      `main.js`/`car.js`/`ai`-side files, `/models/` + `/models/manifest.json`
      in the model loader, `/audio/` in `audio.js`
- [ ] Build `dist/` from `public/` + `models/*.glb` + `manifest.json` only —
      dev-only files (`models/README.md`, `public/audio/README.md`) stay in the
      repo and out of the ZIP
- [ ] Verify the game boots from `dist/` with a dumb static server
      (`npx serve dist`) and no requests to any external host
- [ ] ZIP budget: initial download ≤ 50 MB, total ≤ 250 MB, ≤ 1,500 files —
      current assets are ~18 MB across 33 files, so both are clear
- [ ] Stretch: first playable ≤ 20 MB for mobile-homepage eligibility. Whole
      build already fits, but `kestrel_gt.glb` alone is 11 MB — Draco or
      meshopt compression on it buys the most headroom

## 3 · Portal mode (no-server UI)

- [ ] Add a portal/static flag (build-time or "no server reachable" detection)
- [ ] Hide FRIENDS mode, party codes, "FRIENDS JOIN AT" box, firewall hints
- [ ] Remove "LAN" branding — `index.html:6` title "HORIZON RUSH — LAN Racing",
      `index.html:91` tagline "LAN FESTIVAL RACING", `index.html:49` chip
      "LAN ●", plus the "OPEN LAN" / "needs the LAN server" strings in
      `main.js` (278, 407, 426, 684)
- [ ] Make the `/info` fetch (`main.js:373`, LAN-IP lookup) a no-op in portal
      mode so it doesn't 404 on a static host
- [ ] Land players in gameplay fast — make the ⚡ QUICK RACE path the default
      entry (Full Launch QA checks this)
- [ ] Verify touch controls + gamepad still work in an iframe
- [ ] Verify localStorage progression works inside the portal iframe

## 4 · Content & QA pass

- [ ] PEGI-12 check (should already pass — no violence/gambling/adult content)
- [ ] Playtest all modes that ship: BOTS, TIME TRIAL, CHAMPIONSHIP, DAILY
- [ ] Test on a low-end machine at Medium/Low graphics
- [ ] Test mobile Safari + Chrome (touch UI, performance, audio unlock)
- [ ] No external links, no links to other game sites, no donation buttons

## 5 · Submission (Basic Launch)

- [ ] Register at https://developer.crazygames.com/
- [ ] Upload the `dist/` ZIP
- [ ] Write game description + controls text (reuse README tables)
- [ ] Create cover images/thumbnails per their spec
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
