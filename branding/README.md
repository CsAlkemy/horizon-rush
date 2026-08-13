# Branding art

## `noxrush.png` — the hero banner

1280×720. Used as the repo README header, and the right image for a store page,
itch.io header or social post — anywhere the art is presented as marketing.

## It cannot serve as the CrazyGames covers

Three separate reasons, all from
https://docs.crazygames.com/requirements/game-covers/:

1. **Text beyond the game title is not allowed.** The banner carries five feature
   captions, and one of them is literally "PLAY NOW" — the exact example their
   rules give of a disallowed caption. Covers must show the title and nothing else.
2. **Resolution is under spec.** The required landscape cover is 1920×1080; this
   is 1280×720. Scaling it up 1.5× runs straight into their "no blurry or
   pixelated visuals" rule.
3. **Two of the three required aspect ratios are not 16:9.** Portrait is 800×1200
   (2:3) and square is 800×800 (1:1). The tallest 2:3 crop available from a
   1280×720 source is 480×720, which then needs a 1.67× upscale — and cropping
   that narrow throws away most of the composition anyway.

There is also a content problem independent of the rules: the banner advertises
**"MULTIPLAYER — PLAY WITH FRIENDS"**, and the portal build has FRIENDS mode
removed because there is no server behind it. Shipping that claim on a
single-player submission is a QA rejection waiting to happen, and misleading to
players besides.

## Producing covers that pass

Either:

**A — re-export the artwork.** If it can be regenerated, ask for 1920×1080 or
larger with **no captions**, plus a taller composition that survives a 2:3 crop.
That gives the best-looking compliant set, since the art is stronger than
anything rendered from the game meshes.

**B — generate them from the game.** One command, already compliant:

    npm start                          # in one terminal
    node scripts/make-branding.mjs     # in another

That writes the three mandatory sizes (1920×1080, 800×1200, 800×800) plus a wide
banner and a transparent wordmark, rendered from the real car model and the real
brand tokens (`--cyan #35e0e6`, `--accent #ff2d78`). Title only, no captions, no
borders. `--name` re-letters everything in one pass if the game is ever renamed;
`--car Vulpine` swaps the hero car.

Notes worth keeping from that renderer: the floor is a `ShadowMaterial` so it
draws only the car's shadow and the background gradient survives; the paint is
orange because a cool colour disappears into the cyan/blue backdrop; and portrait
is framed from nearer the nose, because at 2:3 the horizontal field is about 4 m
at a workable distance — narrower than the 4.8 m car, so a side-on
three-quarter view always clipped.
