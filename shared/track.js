// Track definition + spline sampling. Shared by the Node server (AI) and the
// browser client (geometry + local physics). Pure math, no three.js.

export const ROAD_HALF = 6.2;      // half road width, meters
export const SHOULDER = 1.7;       // sand strip between road edge and guardrail
export const ROAD_Y = 0.12;        // asphalt surface height; cars ride on this
export const TOTAL_LAPS = 3;
export const GRID_SLOTS = 12;

// Closed counter-clockwise coastal circuit, meters. x = east, z = north.
export const CONTROL_POINTS = [
  [-380, -180],
  [-390, 40],
  [-375, 230],
  [-290, 360],
  [-150, 420],
  [-20, 400],
  [70, 320],
  [180, 330],
  [290, 290],
  [360, 180],
  [370, 30],
  [330, -120],
  [220, -200],
  [80, -170],
  [-40, -210],
  [-160, -290],
  [-300, -300],
];

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function buildTrack(N = 2048) {
  const cp = CONTROL_POINTS;
  const n = cp.length;

  // Oversample the closed catmull-rom loop, then resample to uniform arclength.
  const M = n * 60;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
    for (let j = 0; j < 60; j++) {
      const t = j / 60;
      raw.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  const cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) {
    const a = raw[i], b = raw[(i + 1) % M];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const L = cum[M];

  const samples = new Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * L;
    while (seg < M - 1 && cum[seg + 1] < target) seg++;
    const t = (target - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    const a = raw[seg], b = raw[(seg + 1) % M];
    samples[i] = { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t };
  }

  // Tangents, right normals, heading, curvature.
  for (let i = 0; i < N; i++) {
    const p = samples[(i - 1 + N) % N], q = samples[(i + 1) % N];
    let tx = q.x - p.x, tz = q.z - p.z;
    const m = Math.hypot(tx, tz) || 1;
    tx /= m; tz /= m;
    const s = samples[i];
    s.tx = tx; s.tz = tz;
    // Lateral normal. With fwd = (sin h, cos h) this points to the driver's
    // LEFT on screen (+X is screen-left when facing +Z). Signed offsets along
    // it are therefore "positive = left".
    s.nx = tz; s.nz = -tx;
    s.h = Math.atan2(tx, tz);       // heading: fwd = (sin h, cos h)
    s.s = (i / N) * L;
  }
  const ds = L / N;
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 1 + N) % N], b = samples[(i + 1) % N];
    // >0 = heading increasing = LEFT turn (matches the normal's sign above, so
    // offsetting by curvature * n hugs the inside of the corner).
    samples[i].curv = wrapAngle(b.h - a.h) / (2 * ds);
  }
  // Smooth curvature (window average) for AI + decoration placement.
  const cs = new Float64Array(N);
  const W = 10;
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -W; k <= W; k++) acc += samples[(i + k + N) % N].curv;
    cs[i] = acc / (2 * W + 1);
  }
  for (let i = 0; i < N; i++) samples[i].curvSm = cs[i];

  // AI racing line: lateral offset toward the inside of upcoming corners.
  const rawOff = new Float64Array(N);
  const maxOff = ROAD_HALF - 2.4;
  for (let i = 0; i < N; i++) {
    rawOff[i] = Math.max(-maxOff, Math.min(maxOff, cs[i] * 320));
  }
  const off = new Float64Array(N);
  const W2 = 46;
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -W2; k <= W2; k++) acc += rawOff[(i + k + N) % N];
    off[i] = acc / (2 * W2 + 1);
  }

  function idxOf(s) {
    let i = Math.floor(((s % L) + L) % L / ds);
    return Math.min(N - 1, Math.max(0, i));
  }

  function point(s) {
    const sm = ((s % L) + L) % L;
    const f = sm / ds;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const a = samples[i], b = samples[j];
    return {
      s: sm,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: a.tx + (b.tx - a.tx) * t,
      tz: a.tz + (b.tz - a.tz) * t,
      nx: a.nx + (b.nx - a.nx) * t,
      nz: a.nz + (b.nz - a.nz) * t,
      h: a.h + wrapAngle(b.h - a.h) * t,
      curv: a.curvSm,
    };
  }

  // Closest point on the centerline. sHint (meters) narrows the search window.
  function closestS(x, z, sHint) {
    let best = -1, bestD = Infinity;
    if (sHint === undefined || sHint === null || Number.isNaN(sHint)) {
      for (let i = 0; i < N; i += 4) {
        const p = samples[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; best = i; }
      }
      for (let k = -4; k <= 4; k++) {
        const i = (best + k + N) % N;
        const p = samples[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      const c = idxOf(sHint);
      for (let k = -70; k <= 70; k++) {
        const i = (c + k + N) % N;
        const p = samples[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const p = samples[best];
    return { s: p.s, x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz, h: p.h, curv: p.curvSm };
  }

  function lineOffset(s) { return off[idxOf(s)]; }

  // Largest |curvature| over the next `dist` meters — AI braking-point input.
  function curvAheadMax(s, dist) {
    const steps = Math.max(1, Math.min(N, Math.round(dist / ds)));
    const c0 = idxOf(s);
    let m = 0;
    for (let k = 0; k < steps; k += 2) {
      const c = Math.abs(samples[(c0 + k) % N].curvSm);
      if (c > m) m = c;
    }
    return m;
  }

  // Starting grid: 2 columns, staggered rows, behind the start line (s=0).
  function gridSlot(i) {
    const row = Math.floor(i / 2), col = i % 2;
    const s = L - 16 - row * 9 - col * 4.5;
    const p = point(s);
    const lat = col ? 2.6 : -2.6;
    return { x: p.x + p.nx * lat, z: p.z + p.nz * lat, h: p.h, s: p.s };
  }

  return { N, L, ds, samples, point, closestS, lineOffset, curvAheadMax, gridSlot, idxOf };
}
