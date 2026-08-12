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
- [ ] Replace or drop the `AV_*` foley one-shots in `public/audio/`
      (likely from a commercial SFX library — see `public/audio/README.md`)
- [ ] Update `CREDITS.md` to match the final shipped asset set
- [ ] Confirm every remaining asset is CC0/CC-BY-cleared for commercial use

## 2 · Static build (`dist/` from a build script)

- [ ] Write `scripts/build-web.js` producing a self-contained `dist/` with
      `index.html` at the root
- [ ] Vendor the three.js files the import map needs (currently served from
      `node_modules` by `server.js` at `/vendor/three/`)
- [ ] Convert all absolute paths (`/css/…`, `/js/…`, `/vendor/…`) to relative —
      portals host games in iframes/subpaths
- [ ] Verify the game boots from `dist/` with a dumb static server
      (`npx serve dist`) and no requests to any external host
- [ ] ZIP budget: initial download ≤ 50 MB, total ≤ 250 MB, ≤ 1,500 files
- [ ] Stretch: first playable ≤ 20 MB for mobile-homepage eligibility

## 3 · Portal mode (no-server UI)

- [ ] Add a portal/static flag (build-time or "no server reachable" detection)
- [ ] Hide FRIENDS mode, party codes, "FRIENDS JOIN AT" box, firewall hints
- [ ] Remove "LAN" branding (title tag says "LAN Racing", tagline says
      "LAN FESTIVAL RACING", player chip shows "LAN ●")
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
