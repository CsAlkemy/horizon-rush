// WebSocket client + snapshot interpolation buffers for remote cars, with an
// offline fallback: when `local` (a LocalRace) is active, outbound traffic is
// routed to it instead of the socket, and it delivers server-style messages
// back through `deliver()` — the rest of the game can't tell the difference.
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.handlers = {};
    this.buffers = new Map(); // carId -> [{t, x, z, h, sp, lap, s}]
    this.connected = false;
    this.local = null;        // offline race engine, set by main.js
    this._retry = null;
  }

  on(type, fn) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  }
  emit(type, msg) {
    // Isolate handlers: an exception in one must not starve the others — and
    // because messages can be emitted from inside the render loop (the offline
    // engine responds synchronously to send()), an uncaught throw here would
    // otherwise kill the requestAnimationFrame chain and freeze the game.
    for (const fn of this.handlers[type] || []) {
      try { fn(msg); } catch (e) { console.error(`[net] '${type}' handler failed:`, e); }
    }
  }

  // Single entry point for inbound messages — the socket and the offline
  // engine both come through here, so welcome/snap bookkeeping stays in sync.
  deliver(m) {
    if (m.t === 'welcome') this.id = m.id;
    if (m.t === 'snap') this.ingestSnap(m);
    this.emit(m.t, m);
  }

  connect() {
    // `?offline=1` runs fully serverless (portal/static builds and testing).
    if (new URLSearchParams(location.search).get('offline')) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { this.ws = new WebSocket(`${proto}://${location.host}`); } catch { this.scheduleRetry(); return; }
    this.ws.onopen = () => { this.connected = true; this.emit('open'); };
    this.ws.onclose = () => {
      this.connected = false;
      this.emit('close');
      this.scheduleRetry();
    };
    this.ws.onerror = () => {};
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.deliver(m);
    };
  }

  // Quietly keep trying to reach the server — but never yank the identity out
  // from under an offline race in progress (a mid-race 'welcome' would change
  // myId and orphan the local player's car).
  scheduleRetry() {
    clearTimeout(this._retry);
    this._retry = setTimeout(() => {
      if (this.local && this.local.active) { this.scheduleRetry(); return; }
      this.connect();
    }, 4000);
  }

  send(obj) {
    if (this.local && this.local.active) { this.local.handle(obj); return; }
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
          lap: b.lap, s: b.s, fin: b.fin, lg: b.lg, bk: b.bk, nt: b.nt,
        };
      }
    }
    return buf[buf.length - 1];
  }

  resetBuffers() { this.buffers.clear(); }
}
