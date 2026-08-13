# Branding art

Generated, not hand-drawn. `scripts/make-branding.mjs` renders these from the
**real car model and the real brand colours**, so the art cannot drift from what
the game actually looks like.

    npm start                          # in one terminal
    node scripts/make-branding.mjs     # in another

| File | Size | Purpose |
| --- | --- | --- |
| `cover-landscape-1920x1080.png` | 1920×1080 | CrazyGames landscape cover (mandatory) |
| `cover-portrait-800x1200.png` | 800×1200 | CrazyGames portrait cover (mandatory) |
| `cover-square-800x800.png` | 800×800 | CrazyGames square cover (mandatory) |
| `banner-wide-2560x800.png` | 2560×800 | README / itch.io / social header |
| `logo-wordmark-1600x500.png` | 1600×500 | Transparent wordmark |

## Cover rules these follow

From https://docs.crazygames.com/requirements/game-covers/ — the three covers
carry **the game title and nothing else**:

- no tagline or extra text ("New", "Play Now", …)
- no borders
- no store or platform icons
- nothing blurry or upscaled

The wide banner and the wordmark are ours to use freely, so they do carry the
tagline. Don't submit those as covers.

## Options

    node scripts/make-branding.mjs --name "Some Other Name"
    node scripts/make-branding.mjs --tagline "NIGHT CIRCUIT RACING"
    node scripts/make-branding.mjs --car Vulpine      # a bot car instead of the Kestrel
    node scripts/make-branding.mjs --port 4300

`--name` colours word one with the cyan (`--cyan #35e0e6`) and the rest with the
accent pink (`--accent #ff2d78`), matching the lobby logo. The break is the first
space, or a `|` if you want the two halves to touch — which is how the joined
`NOX|RUSH` wordmark is produced. A rename therefore costs one command, not a
redraw.

## Notes on the composition

- The floor is a `ShadowMaterial`, i.e. it draws *only* the car's shadow. A lit
  floor plane put a grey studio horizon across the frame and flattened the neon
  background; this way the gradient stays and the car still sits on something.
- Paint is orange (`0xff6a13`) because the background is cyan/blue — a cool paint
  disappears into it.
- Portrait is framed from nearer the nose. At 2:3 the horizontal field is about
  4 m at a workable distance, less than the car's 4.8 m length, so a side-on
  three-quarter view always clipped the bumper and the wing.
