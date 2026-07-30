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
  steerFade: 0.013,    // steering tightens down with speed
  latAccel: 18.5,      // m/s^2 cornering limit — caps yaw rate so fast steering
  latAccelDrift: 32,   // stays smooth instead of snapping the car sideways
  yawEase: 9,          // how fast yaw rate reaches its target (~110 ms)
  wheelbase: 2.72,
  width: 1.9,
  length: 4.4,
};

export function forwardOf(h) { return [Math.sin(h), Math.cos(h)]; }

// Advance one car by dt. car: {x,z,h,vx,vz,s}  input: {steer,throttle,brake,hand,draft}
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
  let wantYaw = 0;
  if (Math.abs(vYaw) > 0.15) {
    wantYaw = (vYaw / CAR.wheelbase) * Math.tan(steer);
    // Cap yaw by the tyres' cornering limit (a_lat = v * yawRate). Without this
    // the bicycle model asks for double-digit g at speed and the car snaps
    // round instead of turning.
    const maxLat = inp.hand ? CAR.latAccelDrift : CAR.latAccel;
    const maxYaw = maxLat / Math.max(4, speed);
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
  let a = 0;
  const top = CAR.topSpeed * draftMul;
  if (inp.throttle > 0 && vf < top) {
    a += inp.throttle * CAR.engine * draftMul * Math.max(0.12, 1 - Math.max(0, vf) / top);
  }
  if (inp.brake > 0) {
    if (vf > 0.5) a -= inp.brake * CAR.brake;
    else a -= inp.brake * CAR.engine * 0.55;  // reverse
  }
  a -= CAR.roll * Math.sign(vf) + CAR.drag * vf * Math.abs(vf);
  vf += a * dt;
  if (vf < CAR.reverseMax) vf = CAR.reverseMax;

  // Lateral grip (drift when handbraking). Grip rises progressively with slip
  // so a long curve bites back instead of washing gradually wide.
  const slipMag = Math.abs(Math.atan2(vl, Math.abs(vf) + 0.5));
  const gripBoost = 1 + Math.min(slipMag / 0.35, 1) * 0.6;
  const g = inp.hand ? CAR.handGrip : CAR.grip * gripBoost;
  vl *= Math.exp(-g * dt);
  if (inp.hand && vf > 1) vf *= Math.exp(-0.3 * dt);

  // Recompose velocity in the (possibly rotated) frame.
  const [fx2, fz2] = forwardOf(car.h);
  car.vx = fx2 * vf + fz2 * vl;
  car.vz = fz2 * vf - fx2 * vl;
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
