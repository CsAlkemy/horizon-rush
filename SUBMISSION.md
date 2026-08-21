# Portal submission copy

Paste-ready text for https://developer.crazygames.com/. Everything here
describes the **portal build** (`npm run build`), which is single-player: it has
no server, so FRIENDS mode, party codes and LAN records are all absent.

Nothing in this file may promise multiplayer. That is the single easiest way to
fail QA, and it would be untrue of the uploaded build.

---

## Title

    NoxRush

## Short description (~150 chars)

    Arcade festival racing: three circuits, forward or reversed, a full grid of
    AI rivals, nitro pickups and power-drifts. Chase medals and beat your ghost.

## Long description

    NoxRush is an arcade racer built for the browser — smooth 3D, no downloads,
    no account.

    Race three circuits, each drivable in both directions for six layouts in
    all: Coastal Circuit runs seaside sweepers, Alpine Ridge is tight misty
    esses, and Sunset Speedway is flat-out desert.

    Pick your fight:
    • BOTS — you against a full grid of AI rivals
    • TIME TRIAL — just you and the translucent ghost of your best lap
    • CHAMPIONSHIP — a three-race series with F1-style points
    • DAILY CHALLENGE — a date-seeded track combo, the same for everyone that
      day, with bonus XP on your first run

    Two ways to slide. The handbrake is a hard anchor that sheds speed and kicks
    the tail out for hairpins; holding full steering at speed power-drifts the
    big corners in a progressive slide that catches itself when you unwind. Both
    pour smoke off the rears and lay rubber that fades over the next minute.

    Grab the glowing nitro canisters floating over the road, then burn the meter
    for a hard shove and a higher top speed.

    Every race banks XP. XP levels you up, levels unlock new paint, and each
    track direction keeps its own best lap and medal — bronze, silver, gold —
    against target times. Your progress is saved in your browser.

    The AI rubber-band gently — a few percent of top speed, never their
    cornering — so the pack stays contested without ever being unbeatable.

## Controls (portal "Controls" field)

    Keyboard
      Throttle / brake ....... W / S  or  Up / Down
      Steer .................. A / D  or  Left / Right
      Handbrake (drift) ...... Space
      Nitro boost ............ Shift (hold)
      Camera (chase/driver/hood)  C
      Horn ................... H (hold)
      Headlights ............. L
      Reset to track ......... R
      Mute ................... M

    Gamepad
      Left stick steers, triggers are throttle and brake,
      A is the handbrake, X is nitro. Braking, sand and impacts rumble the pad.

    Touch
      On-screen controls appear automatically on phones and tablets:
      steer on the left, GAS / BRAKE / DRIFT / NITRO on the right.

## Genre / tags

    Racing, Arcade, Driving, 3D, Singleplayer, Car, Time Trial

## Age rating notes (PEGI)

    No violence, no blood, no gambling, no adult content, no chat, no user
    accounts, no external links. Vehicle collisions are cosmetic — cars bump and
    scrape, nothing is destroyed or harmed. Expected to clear PEGI 3-7 and
    comfortably clear PEGI 12.

## Technical notes for QA

    • Fully self-contained: no CDN, no external requests, no analytics. Verified
      by `npm run check` — every request must stay on-origin or the build fails.
    • Works on a subpath and inside a cross-origin iframe. Verified by
      `npm run check:iframe`, which also confirms localStorage progression
      survives a reload inside a partitioned third-party storage bundle.
    • 14.75 MB unpacked / 9.39 MB zipped, 32 files.
    • No SDK integration (Basic Launch).
