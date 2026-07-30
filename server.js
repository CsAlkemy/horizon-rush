// HORIZON RUSH — LAN server.
// Serves the game, relays player state over WebSocket, simulates AI opponents,
// and runs the race state machine (lobby -> countdown -> race -> results).
//
// Races are independent sessions rather than one global race, because the two
// opponent modes want different start rules: a BOTS race belongs to one driver
// and starts the moment they are ready, while a FRIENDS race is shared and waits
// for the group. Several can run at once — one person can be lapping the
// drivatars while two others run a head-to-head.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildTrack, TOTAL_LAPS, GRID_SLOTS, wrapAngle } from './shared/track.js';
import { stepCar } from './shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4300);
const LAPS = Number(process.env.LAPS || TOTAL_LAPS);

const track = buildTrack();

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const ROOTS = [
  { prefix: '/vendor/three/', dir: path.join(__dirname, 'node_modules/three/') },
  { prefix: '/shared/', dir: path.join(__dirname, 'shared/') },
  { prefix: '/models/', dir: path.join(__dirname, 'models/') },
  { prefix: '/', dir: path.join(__dirname, 'public/') },
];

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ips: lanIPs(), port: PORT }));
    return;
  }
  for (const root of ROOTS) {
    if (!p.startsWith(root.prefix)) continue;
    const rel = p.slice(root.prefix.length);
    const file = path.normalize(path.join(root.dir, rel));
    if (!file.startsWith(root.dir)) break; // path escape attempt
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

// ---------------------------------------------------------------- game state
const AI_ROSTER = [
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

const MODES = ['bot', 'friends'];

let nextId = 1;
let nextRaceId = 1;
// id -> {id,name,color,ready,mode,ws,raceId,state,finished,finishTime,bestLap}
const players = new Map();
// raceId -> {id,kind,phase,members:Set,ai:[],laps,startAt,firstFinishAt,countTimer}
const races = new Map();

function makeAI(count) {
  return AI_ROSTER.slice(0, count).map((a, i) => ({
    id: 'a' + (i + 1),
    name: a.name,
    color: a.color,
    // Slower AI placed at the back of the AI pack, right in front of the humans.
    skill: 0.95 - i * 0.055,
    car: { x: 0, z: 0, h: 0, vx: 0, vz: 0, s: 0 },
    lap: 0, // grid sits behind the line; first crossing starts lap 1
    prevS: 0,
    finished: false,
    finishTime: 0,
    input: { steer: 0, throttle: 0, brake: 0, hand: false },
  }));
}

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(s);
  }
}

function sendTo(race, msg) {
  const s = JSON.stringify(msg);
  for (const pid of race.members) {
    const p = players.get(pid);
    if (p && p.ws.readyState === 1) p.ws.send(s);
  }
}

function raceOf(p) { return p && p.raceId ? races.get(p.raceId) || null : null; }

// "On track" — a race still counting down or running. A driver sitting on the
// results screen is finished with theirs and must not hold anyone else up.
function isRacing(p) {
  const r = raceOf(p);
  return !!r && r.phase !== 'results';
}

// Drivers picking FRIENDS who are back at the menu — the group a shared race
// waits for. Anyone already in a race (including its results screen) is out of
// this set, so they can never block the next one from starting.
function friendsInLobby() {
  return [...players.values()].filter(p => p.mode === 'friends' && !p.raceId);
}

function statusOf(p) {
  if (isRacing(p)) return 'racing';
  if (raceOf(p)) return 'results';
  return p.ready ? 'ready' : 'waiting';
}

// One message drives the whole lobby panel, so the client never has to infer
// who is being waited on.
function lobbyState() {
  const grp = friendsInLobby();
  const waiting = grp.filter(p => !p.ready);
  return {
    t: 'lobby',
    list: [...players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, mode: p.mode, status: statusOf(p),
    })),
    friendsReady: grp.length - waiting.length,
    friendsTotal: grp.length,
    friendsWaiting: waiting.map(p => p.name),
    racesLive: [...races.values()].filter(r => r.phase !== 'results').length,
  };
}

function pushLobby() { broadcast(lobbyState()); }

function rosterOf(race) {
  const out = race.ai.map(a => ({ id: a.id, name: a.name, color: a.color, human: false }));
  for (const pid of race.members) {
    const p = players.get(pid);
    if (p) out.push({ id: p.id, name: p.name, color: p.color, human: true });
  }
  return out;
}

function placeGrid(race) {
  // AI up front, humans at the back of the grid (authentic Horizon start).
  const ids = [...race.ai.map(a => a.id), ...race.members];
  const slots = [];
  ids.forEach((id, i) => {
    const g = track.gridSlot(i);
    slots.push({ id, x: g.x, z: g.z, h: g.h, s: g.s });
    const a = race.ai.find(v => v.id === id);
    if (a) {
      a.car = { x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, s: g.s };
      a.lap = 0; a.prevS = g.s; a.finished = false; a.finishTime = 0;
    } else {
      const p = players.get(id);
      if (p) {
        p.state = { x: g.x, z: g.z, h: g.h, sp: 0, s: g.s, lap: 0 };
        p.finished = false; p.finishTime = 0; p.bestLap = 0;
      }
    }
  });
  return slots;
}

function destroyRace(race) {
  if (race.countTimer) { clearInterval(race.countTimer); race.countTimer = null; }
  races.delete(race.id);
}

// Take a driver out of whatever race they were in. Called when they head back to
// the lobby or re-arm for another race, and on disconnect.
function leaveRace(p) {
  const race = raceOf(p);
  p.raceId = null;
  if (!race) return;
  race.members.delete(p.id);
  if (race.members.size === 0) destroyRace(race);
  else sendTo(race, { t: 'roster', roster: rosterOf(race) });
}

function beginRace(kind, memberIds) {
  const aiCount = kind === 'bot'
    ? Math.min(AI_ROSTER.length, Math.max(0, GRID_SLOTS - memberIds.length))
    : 0;
  const race = {
    id: 'r' + nextRaceId++,
    kind,
    phase: 'countdown',
    members: new Set(memberIds),
    ai: makeAI(aiCount),
    laps: LAPS,
    startAt: 0,
    firstFinishAt: 0,
    countTimer: null,
  };
  races.set(race.id, race);
  for (const pid of memberIds) {
    const p = players.get(pid);
    if (p) { p.raceId = race.id; p.ready = false; }
  }

  const slots = placeGrid(race);
  sendTo(race, { t: 'grid', slots, laps: race.laps, kind, roster: rosterOf(race) });
  let n = 3;
  sendTo(race, { t: 'count', n });
  race.countTimer = setInterval(() => {
    n--;
    if (n > 0) {
      sendTo(race, { t: 'count', n });
    } else {
      clearInterval(race.countTimer);
      race.countTimer = null;
      race.phase = 'race';
      race.startAt = Date.now();
      sendTo(race, { t: 'go' });
    }
  }, 1000);

  const names = memberIds.map(i => (players.get(i) || {}).name).join(', ');
  console.log(`[race ${race.id}] ${kind} — ${names} + ${aiCount} AI`);
  return race;
}

// A shared race launches when every FRIENDS driver back at the menu is ready.
// `force` is the START NOW escape hatch, so a forgotten browser tab can never
// strand the drivers who are actually waiting to go.
function tryStartFriends(force = false) {
  const grp = friendsInLobby();
  const ready = grp.filter(p => p.ready);
  if (ready.length < 2) return false;
  if (!force && ready.length !== grp.length) return false;
  beginRace('friends', ready.map(p => p.id));
  return true;
}

function onReady(p) {
  if (isRacing(p)) return;   // already on track — ignore
  leaveRace(p);              // clear a finished race so a new one can be built
  p.ready = true;
  if (p.mode === 'bot') beginRace('bot', [p.id]);
  else tryStartFriends();
  pushLobby();
}

function endRace(race) {
  race.phase = 'results';
  if (race.countTimer) { clearInterval(race.countTimer); race.countTimer = null; }
  const rows = standings(race).map((id, i) => {
    const e = entityIn(race, id);
    return {
      pos: i + 1,
      id,
      name: e.name,
      time: e.finished ? e.finishTime : 0,
      bestLap: e.bestLap || 0,
      dnf: !e.finished,
    };
  });
  sendTo(race, { t: 'results', rows });
  for (const pid of race.members) {
    const p = players.get(pid);
    if (p) p.ready = false;
  }
  // Drivers who armed FRIENDS while this one was running can go now.
  tryStartFriends();
  pushLobby();
}

function entityIn(race, id) {
  return race.ai.find(v => v.id === id) || players.get(id);
}

function progressOf(e) {
  const s = e.car ? e.car.s : (e.state ? e.state.s : 0);
  const lap = e.car ? e.lap : (e.state ? e.state.lap : 1);
  return lap * track.L + s;
}

function standings(race) {
  const all = [...race.ai];
  for (const pid of race.members) {
    const p = players.get(pid);
    if (p) all.push(p);
  }
  all.sort((A, B) => {
    if (A.finished && B.finished) return A.finishTime - B.finishTime;
    if (A.finished) return -1;
    if (B.finished) return 1;
    return progressOf(B) - progressOf(A);
  });
  return all.map(e => e.id);
}

// ---------------------------------------------------------------- AI driving
function aiThink(a, allCars) {
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
  // above the quickest drivatar.
  const latA = 9 + a.skill * 5.5;
  const brakeDist = 12 + sp * sp / 42;
  const cAhead = track.curvAheadMax(car.s, brakeDist);
  const vCorner = Math.sqrt(latA / Math.max(1e-4, cAhead));
  const vTop = 39 + a.skill * 13;
  const target = Math.min(vTop, vCorner);

  let throttle = 0, brake = 0;
  if (sp < target - 1.5) throttle = 1;
  else if (sp > target + 2.5) brake = Math.min(1, (sp - target) * 0.18);
  else throttle = 0.5;

  // Simple avoidance of the car directly ahead.
  const [fx, fz] = [Math.sin(car.h), Math.cos(car.h)];
  for (const o of allCars) {
    if (o.id === a.id) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const ahead = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    if (ahead > 0 && ahead < 11 && Math.abs(side) < 2.4) {
      throttle *= 0.35;
      // side > 0 puts the obstacle to our left, so ease right around it.
      steer += side > 0 ? 0.25 : -0.25;
    }
  }
  a.input.steer = steer;
  a.input.throttle = throttle;
  a.input.brake = brake;
}

const AI_DT = 1 / 30;
setInterval(() => {
  for (const race of races.values()) {
    if (race.phase !== 'race') continue;
    const allCars = [...race.ai.map(a => ({ id: a.id, x: a.car.x, z: a.car.z }))];
    for (const pid of race.members) {
      const p = players.get(pid);
      if (p && p.state) allCars.push({ id: p.id, x: p.state.x, z: p.state.z });
    }
    for (const a of race.ai) {
      aiThink(a, allCars);
      stepCar(a.car, a.input, AI_DT, track);
      // Lap counting on start/finish crossing.
      if (a.prevS > track.L * 0.9 && a.car.s < track.L * 0.1) {
        a.lap++;
        if (!a.finished && a.lap > race.laps) {
          a.finished = true;
          a.finishTime = Date.now() - race.startAt;
        }
      }
      a.prevS = a.car.s;
    }
  }
}, 1000 / 30);

// ---------------------------------------------------------------- snapshots
setInterval(() => {
  for (const race of [...races.values()]) {
    if (race.phase !== 'race' && race.phase !== 'countdown') continue;
    const cars = race.ai.map(a => ({
      id: a.id, x: +a.car.x.toFixed(2), z: +a.car.z.toFixed(2),
      h: +a.car.h.toFixed(3), sp: +Math.hypot(a.car.vx, a.car.vz).toFixed(1),
      lap: a.lap, s: +a.car.s.toFixed(1), fin: a.finished,
      bk: a.input.brake > 0.12 ? 1 : 0,   // so you see the pack braking ahead
    }));
    for (const pid of race.members) {
      const p = players.get(pid);
      if (!p || !p.state) continue;
      cars.push({
        id: p.id, x: p.state.x, z: p.state.z, h: p.state.h,
        sp: p.state.sp, lap: p.state.lap, s: p.state.s, fin: p.finished,
        lg: p.state.lg, bk: p.state.bk,
      });
    }
    sendTo(race, {
      t: 'snap',
      cars,
      order: standings(race),
      rt: race.phase === 'race' ? Date.now() - race.startAt : 0,
    });

    // Race end: every human finished, or 90s grace after the first finisher.
    if (race.phase === 'race') {
      const ps = [...race.members].map(id => players.get(id)).filter(Boolean);
      const done = ps.length > 0 && ps.every(p => p.finished);
      const graceOver = race.firstFinishAt && Date.now() - race.firstFinishAt > 90000;
      if (ps.length === 0) destroyRace(race);
      else if (done || graceOver) endRace(race);
    }
  }
}, 50);

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const id = 'p' + nextId++;
  let joined = false;

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }

    if (m.t === 'join' && !joined) {
      joined = true;
      const name = String(m.name || 'Player').slice(0, 14).replace(/[<>&]/g, '') || 'Player';
      const p = {
        id, name, color: (m.color >>> 0) || 0xcfd2d6, ready: false, ws,
        mode: MODES.includes(m.mode) ? m.mode : 'bot', raceId: null,
        state: null, finished: false, finishTime: 0, bestLap: 0,
      };
      players.set(id, p);
      // A new connection always lands in the lobby: nobody is ever dropped into
      // a race already in progress, which is what used to leave the second
      // driver with no lobby, no HUD and no controls.
      ws.send(JSON.stringify({ t: 'welcome', id, laps: LAPS }));
      pushLobby();
      console.log(`[join] ${name} (${id}) — ${players.size} player(s) online`);
      return;
    }

    const p = players.get(id);
    if (!p) return;
    const race = raceOf(p);

    switch (m.t) {
      case 'name':
        if (isRacing(p)) break;
        p.name = String(m.name || p.name).slice(0, 14).replace(/[<>&]/g, '') || p.name;
        p.color = (m.color >>> 0) || p.color;
        pushLobby();
        break;
      case 'mode':
        if (isRacing(p) || !MODES.includes(m.mode)) break;
        p.mode = m.mode;
        p.ready = false;   // arming is per-mode; re-confirm after switching
        pushLobby();
        break;
      case 'ready':
        if (m.ready === false) { p.ready = false; pushLobby(); break; }
        onReady(p);
        break;
      case 'forceStart':
        if (p.mode === 'friends' && !p.raceId && p.ready) {
          if (tryStartFriends(true)) pushLobby();
        }
        break;
      case 'lobby':   // back to the menu from the results screen
        if (isRacing(p)) break;
        leaveRace(p);
        p.ready = false;
        pushLobby();
        break;
      case 'state':
        if (!race || race.phase === 'results') break;
        p.state = {
          x: +m.x || 0, z: +m.z || 0, h: +m.h || 0,
          sp: +m.sp || 0, s: +m.s || 0, lap: m.lap | 0,
          lg: m.lg ? 1 : 0, bk: m.bk ? 1 : 0,
        };
        break;
      case 'horn':
        if (race) sendTo(race, { t: 'horn', id });
        break;
      case 'finish':
        if (race && race.phase === 'race' && !p.finished) {
          p.finished = true;
          p.finishTime = Date.now() - race.startAt;
          p.bestLap = +m.bestLap || 0;
          if (!race.firstFinishAt) race.firstFinishAt = Date.now();
          sendTo(race, { t: 'finished', id, name: p.name, time: p.finishTime });
        }
        break;
    }
  });

  ws.on('close', () => {
    const p = players.get(id);
    if (!p) return;
    leaveRace(p);
    players.delete(id);
    console.log(`[left] ${id} — ${players.size} player(s) online`);
    tryStartFriends();   // the remaining FRIENDS drivers may now all be ready
    pushLobby();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  HORIZON RUSH — LAN racing server');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  Friend:  http://${ip}:${PORT}`);
  console.log(`  Laps: ${LAPS}  ·  Ctrl+C to stop\n`);
});
