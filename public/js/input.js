// Keyboard + gamepad input.
//
// Every axis is ramped rather than switched. A keyboard only gives on/off, so
// steering, throttle and brake are all eased toward their target — that is what
// makes keys feel like a wheel and pedals instead of a switch. Steering eases
// more slowly the faster you are going, so fast curves stay planted while
// low-speed manoeuvring stays sharp.
const keys = new Set();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let steerState = 0;
let throttleState = 0;
let brakeState = 0;

// Press-once latches, so holding a key does not retrigger the action.
const latch = { KeyR: false, KeyC: false, KeyL: false };
function pressed(code) {
  if (keys.has(code)) {
    if (!latch[code]) { latch[code] = true; return true; }
    return false;
  }
  latch[code] = false;
  return false;
}

function approach(current, target, rate, dt) {
  const step = rate * dt;
  const d = target - current;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

export function readInput(dt, speed = 0) {
  let steerTarget = 0, throttleTarget = 0, brakeTarget = 0, hand = false;

  if (keys.has('KeyW') || keys.has('ArrowUp')) throttleTarget = 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) brakeTarget = 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steerTarget -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steerTarget += 1;
  if (keys.has('Space')) hand = true;

  // Gamepad: analog values win outright — no ramping needed on a real stick.
  let analogSteer = null, analogThrottle = null, analogBrake = null;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.08) {
      // Squared response gives fine control near centre, full lock at the edge.
      analogSteer = Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.6;
    } else if (Math.abs(ax) <= 0.08) {
      analogSteer = analogSteer ?? 0;
    }
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    if (rt > 0.03) analogThrottle = rt;
    if (lt > 0.03) analogBrake = lt;
    if (gp.buttons[0] && gp.buttons[0].pressed) hand = true;
    break;
  }
  if (analogSteer !== null && Math.abs(analogSteer) > Math.abs(steerTarget)) steerTarget = analogSteer;
  if (analogThrottle !== null) throttleTarget = Math.max(throttleTarget, analogThrottle);
  if (analogBrake !== null) brakeTarget = Math.max(brakeTarget, analogBrake);

  steerTarget = Math.max(-1, Math.min(1, steerTarget));

  // Steering: slower ease at speed (stability), quicker when slow (agility).
  // Crossing the centre counts as a release so flicking left-to-right is crisp.
  // The fade at speed is deliberately mild — the tyres' lateral-accel cap in
  // the physics is what keeps the car planted, so the input can stay alive;
  // fading it hard as well is what made fast direction changes feel stuck.
  const fast = Math.min(speed / 75, 1);
  const centring = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(steerState);
  const steerRate = centring ? 13 - fast * 2 : 9 - fast * 2.6;
  steerState = approach(steerState, steerTarget, steerRate, dt);
  if (steerTarget === 0 && Math.abs(steerState) < 0.015) steerState = 0;

  // Pedals: quick but not instant, and lifting off is faster than squeezing on.
  throttleState = approach(throttleState, throttleTarget, throttleTarget > throttleState ? 5.0 : 8.5, dt);
  brakeState = approach(brakeState, brakeTarget, brakeTarget > brakeState ? 6.5 : 10, dt);

  return {
    steer: steerState,
    throttle: throttleState,
    brake: brakeState,
    hand,
    reset: pressed('KeyR'),
    camCycle: pressed('KeyC'),
    lightsToggle: pressed('KeyL'),
    horn: keys.has('KeyH'),
  };
}

// Reset the ramps — used when a race restarts so no input carries over.
export function clearInput() {
  steerState = throttleState = brakeState = 0;
  keys.clear();
}

// ---------------------------------------------------------------- haptics
// Gamepad rumble. Layers, strongest first: impact thump, brake judder that
// builds with pedal pressure and speed, sand/offroad rumble, drift buzz.
// dual-rumble effects replace each other, so one refresh ~every 90 ms is both
// the throttle (the API dislikes per-frame calls) and the mixer.
let hapticHold = 0;
export function updateHaptics(dt, { brake = 0, speed = 0, impact = 0, offroad = false, slip = 0 } = {}) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let act = null;
  for (const gp of pads) {
    if (gp && gp.vibrationActuator) { act = gp.vibrationActuator; break; }
  }
  if (!act) return;

  hapticHold -= dt;
  if (impact > 3) {
    // A hit always lands immediately and holds off the continuous layers.
    try {
      act.playEffect('dual-rumble', {
        duration: 130,
        strongMagnitude: Math.min(1, impact / 14),
        weakMagnitude: Math.min(1, 0.3 + impact / 20),
      });
    } catch {}
    hapticHold = 0.13;
    return;
  }
  if (hapticHold > 0) return;

  const braking = brake > 0.1 && speed > 5 ? Math.min(1, brake * (0.3 + speed / 55)) : 0;
  const sand = offroad && speed > 4 ? 0.4 : 0;
  const drifting = Math.abs(slip) > 0.25 && speed > 10 ? 0.25 : 0;
  const strong = Math.min(1, braking * 0.85 + sand);
  const weak = Math.min(1, braking * 0.45 + sand * 0.6 + drifting);
  if (strong < 0.03 && weak < 0.03) return;
  try {
    act.playEffect('dual-rumble', { duration: 110, strongMagnitude: strong, weakMagnitude: weak });
  } catch {}
  hapticHold = 0.09;
}
