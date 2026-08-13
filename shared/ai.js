// Rival AI: roster, state factory, and the per-tick driving brain.
// Shared by the LAN server (online races) and the browser (offline races), so
// the same field drives identically wherever the race is simulated.
import { wrapAngle } from './track.js';

export const AI_ROSTER = [
  { name: 'RaptorSeven', color: 0xd7263d },
  { name: 'NightFoxx', color: 0x23262b },
  { name: 'SilvaGT', color: 0x2364d2 },
  { name: 'TanakaRS', color: 0xf4f5f7 },
  { name: 'BlueShift', color: 0x12b8a8 },
  { name: 'CostaV12', color: 0xffb400 },
  { name: 'DriftKing99', color: 0x7a3cf0 },
  { name: 'SableStorm', color: 0x1f9d55 },
  { name: 'TurboTuna', color: 0xff6a13 },
  { name: 'FischerW', color: 0x8b93a1 },
  { name: 'VeraLumen', color: 0xe8447c },
];

export function makeAI(count) {
  return AI_ROSTER.slice(0, count).map((a, i) => ({
    id: 'a' + (i + 1),
    name: a.name,
    color: a.color,
    // Slower AI placed at the back of the AI pack, right in front of the humans.
    skill: 0.95 - i * 0.055,
    car: { x: 0, z: 0, h: 0, vx: 0, vz: 0, s: 0 },
    lap: 0, // grid sits behind the line; first crossing starts lap 1
    prevS: 0,
    avoid: 0, slow: 1,   // eased traffic-avoidance state (see aiThink)
    finished: false,
    finishTime: 0,
    // stab: rivals drive on pure grip — their pace model assumes no
    // power-drift, and a full-lock avoidance jink must not slide them.
    input: { steer: 0, throttle: 0, brake: 0, hand: false, stab: true },
  }));
}

// humanProgress (optional): the leading human's race progress in meters
// (lap * L + s). Enables gentle rubber-banding — rivals far ahead of the
// player back off a touch and stragglers pick up a touch, so finishes stay
// contested without ever making the field unbeatable (±6% of top speed, and
// corner speeds are untouched).
export function aiThink(a, allCars, track, humanProgress = null) {
  const car = a.car;
  const sp = Math.hypot(car.vx, car.vz);
  const look = 9 + sp * 0.55;
  const p = track.point(car.s + look);
  const offset = track.lineOffset(car.s + look);
  const tx = p.x + p.nx * offset;
  const tz = p.z + p.nz * offset;
  const want = Math.atan2(tx - car.x, tz - car.z);
  // steer > 0 means right, and a right turn is a DECREASE in heading, so the
  // heading error is negated (see the sign notes in shared/physics.js).
  let steer = Math.max(-1, Math.min(1, -wrapAngle(want - car.h) * 2.4));

  // Pace is tuned so a competent human starting from the back of the grid can
  // work through the field over three laps — the player's car tops out well
  // above the quickest rival.
  const latA = 9 + a.skill * 5.5;
  const brakeDist = 12 + sp * sp / 42;
  const cAhead = track.curvAheadMax(car.s, brakeDist);
  const vCorner = Math.sqrt(latA / Math.max(1e-4, cAhead));
  let vTop = 39 + a.skill * 13;
  if (humanProgress != null) {
    const gap = (a.lap * track.L + car.s) - humanProgress;   // >0 = ahead of the human
    vTop *= 1 - Math.max(-1, Math.min(1, gap / 400)) * 0.06;
  }
  const target = Math.min(vTop, vCorner);

  let throttle = 0, brake = 0;
  if (sp < target - 1.5) throttle = 1;
  else if (sp > target + 2.5) brake = Math.min(1, (sp - target) * 0.18);
  else throttle = 0.5;

  // Simple avoidance of the car directly ahead. The reaction is EASED rather
  // than applied as a hard step: toggling ±0.25 steer per 30 Hz tick made an
  // AI visibly vibrate exactly when a player drew alongside to overtake.
  const [fx, fz] = [Math.sin(car.h), Math.cos(car.h)];
  let avoidWant = 0, slowWant = 1;
  for (const o of allCars) {
    if (o.id === a.id) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const ahead = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    if (ahead > 0 && ahead < 11 && Math.abs(side) < 2.4) {
      slowWant = 0.35;
      // side > 0 puts the obstacle to our left, so ease right around it.
      avoidWant = side > 0 ? 0.25 : -0.25;
    }
  }
  a.avoid += (avoidWant - a.avoid) * 0.22;   // ~130 ms ease at 30 Hz
  a.slow += (slowWant - a.slow) * 0.3;
  a.input.steer = steer + a.avoid;
  a.input.throttle = throttle * a.slow;
  a.input.brake = brake;
}
