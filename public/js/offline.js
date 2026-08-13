// Offline race engine: a single-player BOTS race simulated entirely in the
// browser, used whenever the LAN server isn't reachable (or the page is
// hosted statically, e.g. on a web game portal). It speaks the exact same
// message protocol as the server — it receives the client's normal `send()`
// traffic and delivers `grid`/`count`/`go`/`snap`/`results` back through the
// Net event bus — so the Game class cannot tell the difference.
import { buildTrack, TOTAL_LAPS, GRID_SLOTS } from '../shared/track.js';
import { stepCar } from '../shared/physics.js';
import { AI_ROSTER, makeAI, aiThink } from '../shared/ai.js';

const AI_DT = 1 / 30;
const PLAYER_ID = 'you';

export class LocalRace {
  constructor(net) {
    this.net = net;
    this.active = false;
    this.timer = null;
    this.countTimer = null;
  }

  // kind: 'bot' (full drivatar grid) or 'trial' (solo time trial, empty track).
  start(mapId, name, color, kind = 'bot') {
    this.stop();
    this.active = true;
    this.kind = kind;
    this.track = buildTrack(mapId);
    this.mapId = this.track.id;
    this.laps = TOTAL_LAPS;
    this.phase = 'countdown';
    this.ai = kind === 'trial' ? [] : makeAI(Math.min(AI_ROSTER.length, GRID_SLOTS - 1));
    this.player = { name: name || 'Player', color, state: null, finished: false, finishTime: 0, bestLap: 0 };
    this.startAt = 0;

    const roster = [
      ...this.ai.map(a => ({ id: a.id, name: a.name, color: a.color, human: false })),
      { id: PLAYER_ID, name: this.player.name, color, human: true },
    ];
    const slots = [];
    [...this.ai.map(a => a.id), PLAYER_ID].forEach((id, i) => {
      const g = this.track.gridSlot(i);
      slots.push({ id, x: g.x, z: g.z, h: g.h, s: g.s });
      const a = this.ai.find(v => v.id === id);
      if (a) {
        a.car = { x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, s: g.s };
        a.prevS = g.s;
      } else {
        this.player.state = { x: g.x, z: g.z, h: g.h, sp: 0, s: g.s, lap: 0 };
      }
    });

    this.net.deliver({ t: 'welcome', id: PLAYER_ID, laps: this.laps });
    this.net.deliver({ t: 'grid', slots, laps: this.laps, kind, roster, map: this.mapId });
    let n = 3;
    this.net.deliver({ t: 'count', n });
    this.countTimer = setInterval(() => {
      n--;
      if (n > 0) {
        this.net.deliver({ t: 'count', n });
      } else {
        clearInterval(this.countTimer);
        this.countTimer = null;
        this.phase = 'race';
        this.startAt = Date.now();
        this.net.deliver({ t: 'go' });
      }
    }, 1000);

    this.timer = setInterval(() => this.tick(), 1000 * AI_DT);
  }

  // The client's outbound traffic, routed here by Net while we're active.
  handle(m) {
    switch (m.t) {
      case 'state':
        if (this.phase === 'results') break;
        this.player.state = {
          x: +m.x || 0, z: +m.z || 0, h: +m.h || 0,
          sp: +m.sp || 0, s: +m.s || 0, lap: m.lap | 0,
          lg: m.lg ? 1 : 0, bk: m.bk ? 1 : 0, nt: m.nt ? 1 : 0,
        };
        break;
      case 'finish':
        if (this.phase === 'race' && !this.player.finished) {
          this.player.finished = true;
          this.player.finishTime = Date.now() - this.startAt;
          this.player.bestLap = +m.bestLap || 0;
          this.endRace();
        }
        break;
      case 'ready':
        // RACE AGAIN from the results screen restarts with the same setup.
        if (m.ready !== false && this.phase === 'results') {
          this.start(this.mapId, this.player.name, this.player.color, this.kind);
        }
        break;
      case 'lobby':
        this.stop();
        break;
      // name/mode/map/party/horn are lobby concerns — nothing to do offline.
    }
  }

  progressOf(e) {
    const s = e.car ? e.car.s : (this.player.state ? this.player.state.s : 0);
    const lap = e.car ? e.lap : (this.player.state ? this.player.state.lap : 0);
    return lap * this.track.L + s;
  }

  standings() {
    const all = [...this.ai, this.player];
    all.sort((A, B) => {
      if (A.finished && B.finished) return A.finishTime - B.finishTime;
      if (A.finished) return -1;
      if (B.finished) return 1;
      return this.progressOf(B) - this.progressOf(A);
    });
    return all.map(e => e === this.player ? PLAYER_ID : e.id);
  }

  tick() {
    if (this.phase !== 'race' && this.phase !== 'countdown') return;

    if (this.phase === 'race') {
      const allCars = [
        ...this.ai.map(a => ({ id: a.id, x: a.car.x, z: a.car.z })),
      ];
      let humanProgress = null;
      if (this.player.state) {
        allCars.push({ id: PLAYER_ID, x: this.player.state.x, z: this.player.state.z });
        humanProgress = (this.player.state.lap | 0) * this.track.L + (this.player.state.s || 0);
      }
      for (const a of this.ai) {
        aiThink(a, allCars, this.track, humanProgress);
        stepCar(a.car, a.input, AI_DT, this.track);
        if (a.prevS > this.track.L * 0.9 && a.car.s < this.track.L * 0.1) {
          a.lap++;
          if (!a.finished && a.lap > this.laps) {
            a.finished = true;
            a.finishTime = Date.now() - this.startAt;
          }
        }
        a.prevS = a.car.s;
      }
    }

    const cars = this.ai.map(a => ({
      id: a.id, x: +a.car.x.toFixed(2), z: +a.car.z.toFixed(2),
      h: +a.car.h.toFixed(3), sp: +Math.hypot(a.car.vx, a.car.vz).toFixed(1),
      lap: a.lap, s: +a.car.s.toFixed(1), fin: a.finished,
      bk: a.input.brake > 0.12 ? 1 : 0,
    }));
    if (this.player.state) {
      const p = this.player.state;
      cars.push({ id: PLAYER_ID, x: p.x, z: p.z, h: p.h, sp: p.sp, lap: p.lap, s: p.s, fin: this.player.finished, lg: p.lg, bk: p.bk, nt: p.nt });
    }
    this.net.deliver({
      t: 'snap',
      cars,
      order: this.standings(),
      rt: this.phase === 'race' ? Date.now() - this.startAt : 0,
    });
  }

  endRace() {
    this.phase = 'results';
    const rows = this.standings().map((id, i) => {
      const e = id === PLAYER_ID ? this.player : this.ai.find(a => a.id === id);
      return {
        pos: i + 1,
        id,
        name: id === PLAYER_ID ? this.player.name : e.name,
        time: e.finished ? e.finishTime : 0,
        bestLap: e.bestLap || 0,
        dnf: !e.finished,
      };
    });
    this.net.deliver({ t: 'results', rows });
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.countTimer) { clearInterval(this.countTimer); this.countTimer = null; }
    this.active = false;
    this.phase = 'idle';
  }
}
