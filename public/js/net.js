// WebSocket client + snapshot interpolation buffers for remote cars.
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.handlers = {};
    this.buffers = new Map(); // carId -> [{t, x, z, h, sp, lap, s}]
    this.connected = false;
  }

  on(type, fn) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => { this.connected = true; this.emit('open'); };
    this.ws.onclose = () => { this.connected = false; this.emit('close'); };
    this.ws.onerror = () => {};
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      if (m.t === 'snap') this.ingestSnap(m);
      this.emit(m.t, m);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  ingestSnap(m) {
    const now = performance.now();
    for (const c of m.cars) {
      if (c.id === this.id) continue;
      let buf = this.buffers.get(c.id);
      if (!buf) { buf = []; this.buffers.set(c.id, buf); }
      buf.push({ t: now, ...c });
      if (buf.length > 30) buf.shift();
    }
  }

  // Interpolated state for a remote car, rendered ~120 ms in the past.
  sample(id) {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return null;
    const t = performance.now() - 120;
    if (buf.length === 1 || t <= buf[0].t) return buf[0];
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1].t <= t) {
        const a = buf[i - 1], b = Math.min(i, buf.length - 1) === i ? buf[i] : buf[i];
        const span = Math.max(1, b.t - a.t);
        const k = Math.min(1.5, (t - a.t) / span); // slight extrapolation allowed
        let dh = b.h - a.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        return {
          id, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
          h: a.h + dh * k, sp: a.sp + (b.sp - a.sp) * Math.min(1, k),
          lap: b.lap, s: b.s, fin: b.fin,
        };
      }
    }
    return buf[buf.length - 1];
  }

  resetBuffers() { this.buffers.clear(); }
}
