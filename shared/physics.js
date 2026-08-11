// Arcade car physics. Shared by the browser (local player) and server (AI).
//
// Sign conventions — get these wrong and the car steers backwards:
//   forward(h) = (sin h, cos h), so h = 0 points along +Z.
//   Increasing h rotates the nose toward +X, which is counter-clockwise seen
//   from above, i.e. a LEFT turn on screen.
//   `steer` is driver-facing: steer > 0 means "turn right". Yaw therefore
//   SUBTRACTS steer from h.
import { ROAD_HALF, SHOULDER } from './track.js';

export const CAR = {
  topSpeed: 80,        // m/s  (~179 mph)
  engine: 26,          // base accel, m/s^2
  brake: 42,
  reverseMax: -9,
  drag: 0.0028,        // quadratic drag
  roll: 0.4,           // rolling resistance
  grip: 8.5,           // lateral velocity decay
  handGrip: 1.7,       // grip while handbraking (drift)
  steerMax: 0.6,       // rad at standstill
  steerFade: 0.0095,   // steering tightens down with speed
  // Cornering limit (caps yaw rate so fast steering stays smooth instead of
  // snapping the car sideways). 26 m/s^2 ≈ 2.6 g of arcade grip: enough to
  // hold Sunset Speedway's 207 m sweepers near top speed — at the old 18.5 the
  // car understeered off every fast corner and steering at pace felt dead.
  latAccel: 26,
  latAccelDrift: 36,
  yawEase: 11,         // how fast yaw rate reaches its target (~90 ms)
  // Power drift (no handbrake): holding near-full lock at speed fades the rear
  // toward this grip and opens the yaw cap, so a committed big turn becomes a
  // progressive tail-out slide instead of riding the grip limit on rails.
  driftGrip: 2.0,      // grip while power-drifting (handbrake is looser still)
  driftYawBoost: 0.5,  // extra yaw allowed at full drift, fraction of the cap
  wheelbase: 2.72,
  width: 1.9,
  length: 4.4,
  // Nitro: raises the speed ceiling and adds a throttle-independent shove, so
  // a burn mid-corner still kicks even while feathering. Fed by track pickups.
  nitroTop: 1.22,      // top-speed multiplier while burning
  nitroShove: 17,      // extra accel, m/s^2, fading toward the raised ceiling
};

export function forwardOf(h) { return [Math.sin(h), Math.cos(h)]; }

// Advance one car by dt. car: {x,z,h,vx,vz,s}  input: {steer,throttle,brake,hand,draft,nitro}
// Returns events for sound/FX: {impact, scrape, offroad, slip, speed}
export function stepCar(car, inp, dt, track) {
  const [fx, fz] = forwardOf(car.h);
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * fz - car.vz * fx;   // dot with right normal (fz, -fx)
  const speed = Math.hypot(car.vx, car.vz);

  // Steering — speed-sensitive bicycle model. Below walking pace we feed the
  // yaw a minimum effective speed while the driver is on the throttle or brake,
  // so a car nosed into a guardrail can always pivot and back out instead of
  // grinding there forever.
  const steer = (inp.steer || 0) * CAR.steerMax / (1 + speed * CAR.steerFade);
  let vYaw = vf;
  if (Math.abs(vf) < 0.9) {
    const drive = (inp.throttle || 0) - (inp.brake || 0);
    if (drive !== 0) vYaw = Math.sign(drive) * 0.9;
  }
  // Power-drift intent: committing to a big turn — near-full lock at real
  // speed — eases the car into a slide. Ramped over ~170 ms so a quick flick
  // stays grip driving and the slide both builds and catches smoothly.
  // `inp.stab` opts out (the AI drive on pure grip; their pace model assumes it).
  let driftWant = 0;
  if (!inp.hand && !inp.stab && speed > 16) {
    driftWant = Math.min(1, Math.max(0, (Math.abs(inp.steer || 0) - 0.72) / 0.26))
      * Math.min(1, (speed - 16) / 14);
  }
  if (car.drift === undefined) car.drift = 0;
  car.drift += (driftWant - car.drift) * (1 - Math.exp(-6 * dt));

  let wantYaw = 0;
  if (Math.abs(vYaw) > 0.15) {
    wantYaw = (vYaw / CAR.wheelbase) * Math.tan(steer);
    // Cap yaw by the tyres' cornering limit (a_lat = v * yawRate). Without this
    // the bicycle model asks for double-digit g at speed and the car snaps
    // round instead of turning.
    const maxLat = inp.hand ? CAR.latAccelDrift : CAR.latAccel;
    // Drifting rotates the nose past what pure grip would allow — that extra
    // yaw is what walks the tail out (the lateral grip fades to match below).
    const maxYaw = (maxLat / Math.max(4, speed)) * (1 + car.drift * CAR.driftYawBoost);
    wantYaw = Math.max(-maxYaw, Math.min(maxYaw, wantYaw));
  }
  // Ease the yaw RATE rather than snapping to it. Rate-of-turn is what the
  // player feels through a curve, so a short lag here reads as a car with
  // weight instead of one that pivots instantly.
  if (car.yawRate === undefined) car.yawRate = 0;
  car.yawRate += (wantYaw - car.yawRate) * (1 - Math.exp(-CAR.yawEase * dt));
  car.h -= car.yawRate * dt;   // steer > 0 is a right turn; right = decreasing h

  // Longitudinal forces.
  const draftMul = inp.draft ? 1.10 : 1;
  const boostMul = inp.nitro ? CAR.nitroTop : 1;
  let a = 0;
  const top = CAR.topSpeed * draftMul * boostMul;
  if (inp.throttle > 0 && vf < top) {
    a += inp.throttle * CAR.engine * draftMul * Math.max(0.12, 1 - Math.max(0, vf) / top);
  }
  if (inp.nitro && vf < top) {
    a += CAR.nitroShove * Math.max(0.2, 1 - Math.max(0, vf) / top);
  }
  if (inp.brake > 0) {
    if (vf > 0.5) a -= inp.brake * CAR.brake;
    else a -= inp.brake * CAR.engine * 0.55;  // reverse
  }
  a -= CAR.roll * Math.sign(vf) + CAR.drag * vf * Math.abs(vf);
  vf += a * dt;
  if (vf < CAR.reverseMax) vf = CAR.reverseMax;

  // Lateral grip (drift when handbraking or power-drifting). Grip rises
  // progressively with slip so a long curve bites back instead of washing
  // gradually wide — that boost is also what catches a power drift the moment
  // the steering unwinds.
  const slipMag = Math.abs(Math.atan2(vl, Math.abs(vf) + 0.5));
  const gripBoost = 1 + Math.min(slipMag / 0.35, 1) * 0.6;
  const gripBase = CAR.grip + (CAR.driftGrip - CAR.grip) * car.drift;
  const g = inp.hand ? CAR.handGrip : gripBase * gripBoost;
  vl *= Math.exp(-g * dt);
  // Handbrake is a HARD anchor: locked rears shed real speed (just under the
  // foot brake's 42 m/s^2 at pace) while the grip loss above kicks the tail.
  if (inp.hand && vf > 0.5) vf = Math.max(0, vf - (24 + 0.12 * vf) * dt);
  // A power drift scrubs a little speed, gentler than the handbrake.
  else if (car.drift > 0.05 && vf > 1) vf *= Math.exp(-0.22 * car.drift * dt);

  // Recompose velocity in the SAME frame it was measured in. Recomposing in
  // the rotated frame (the old bug) glued velocity to heading, so a slip angle
  // could never open and all the grip/drift handling above was dead code — the
  // car cornered on rails. With the frame fixed, each step of rotation angles
  // the heading away from the velocity, the next step's decomposition sees
  // that as lateral velocity, and the grip decay closes it: cornering has
  // bite, the handbrake truly slides, and power drifts hold a visible angle.
  car.vx = fx * vf + fz * vl;
  car.vz = fz * vf - fx * vl;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  const ev = { impact: 0, scrape: false, offroad: false, slip: Math.atan2(vl, Math.abs(vf) + 0.5), speed: Math.abs(vf) };

  // Track containment: sand shoulder drag, then guardrail clamp + slide.
  const c = track.closestS(car.x, car.z, car.s);
  car.s = c.s;
  let d = (car.x - c.x) * c.nx + (car.z - c.z) * c.nz;
  // Sand drag starts past the asphalt edge, not just inside it — running wide
  // to take a line around someone should not cost speed while still on track.
  if (Math.abs(d) > ROAD_HALF) {
    ev.offroad = true;
    const k = Math.exp(-1.1 * dt);
    car.vx *= k; car.vz *= k;
  }
  const lim = ROAD_HALF + SHOULDER - 0.9;
  if (Math.abs(d) > lim) {
    const sd = Math.sign(d);
    // Seat the car a few cm off the rail rather than exactly on it, so it is
    // never left grinding against the clamp plane.
    car.x = c.x + c.nx * sd * (lim - 0.06);
    car.z = c.z + c.nz * sd * (lim - 0.06);
    const vn = car.vx * c.nx + car.vz * c.nz;
    if (sd * vn > 0) {
      car.vx -= c.nx * vn;
      car.vz -= c.nz * vn;
      ev.impact = Math.abs(vn);
      ev.scrape = true;
      if (Math.abs(vn) > 6) {
        const f = Math.max(0.5, 1 - Math.abs(vn) * 0.025);
        car.vx *= f; car.vz *= f;
      }
    }
  }
  return ev;
}
