// NOXRUSH — LAN server.
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
import { buildTrack, TRACKS, TOTAL_LAPS, GRID_SLOTS } from './shared/track.js';
import { stepCar } from './shared/physics.js';
import { CAR } from './shared/physics.js';
import { AI_ROSTER, makeAI, aiThink } from './shared/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4300);
const LAPS = Number(process.env.LAPS || TOTAL_LAPS);

// Every registered circuit, built once. Races reference one each.
const tracks = {};
for (const def of TRACKS) tracks[def.id] = buildTrack(def.id);
const DEFAULT_MAP = TRACKS[0].id;
const validMap = (id) => Object.hasOwn(tracks, id);

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
  // Real home/office LAN ranges first. A VPN or virtual adapter often sits
  // earlier in the interface list, and showing that address first sends
  // friends to an IP they can never reach — the classic "can't join" report.
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0 :
    ip.startsWith('10.') ? 1 :
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return out.sort((a, b) => rank(a) - rank(b));
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

// ---------------------------------------------------------------- lap records
// Best lap per player name per track, persisted to data/records.json so a LAN
// server keeps its all-time boards across restarts. Loose name-based identity
// is right for a LAN party; a public deployment would swap in real accounts.
const DATA_DIR = path.join(__dirname, 'data');
const REC_FILE = path.join(DATA_DIR, 'records.json');
let records = {};
try { records = JSON.parse(fs.readFileSync(REC_FILE, 'utf8')) || {}; } catch {}
let recSaveTimer = null;
function saveRecords() {
  clearTimeout(recSaveTimer);
  recSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(REC_FILE, JSON.stringify(records));
    } catch (e) { console.warn('[records] save failed:', e.message); }
  }, 500);
}
function recordLap(map, name, lapMs) {
  lapMs = Math.round(lapMs);
  if (!validMap(map)) return false;
  // Physical floor: no lap can beat track length over max possible speed.
  const minLap = Math.max(20000, tracks[map].L / (CAR.topSpeed * (CAR.nitroTop || 1)) * 1000);
  if (!(lapMs > minLap) || lapMs > 600000) return false;
  const list = records[map] || (records[map] = []);
  const mine = list.find(r => r.name === name);
  if (mine) {
    if (lapMs >= mine.lap) return false;
    mine.lap = lapMs; mine.date = Date.now();
  } else {
    list.push({ name, lap: lapMs, date: Date.now() });
  }
  list.sort((a, b) => a.lap - b.lap);
  if (list.length > 10) list.length = 10;
  saveRecords();
  return true;
}

// ---------------------------------------------------------------- game state
const MODES = ['bot', 'friends'];

let nextId = 1;
let nextRaceId = 1;
// id -> {id,name,color,ready,readyAt,mode,map,party,ws,raceId,state,finished,finishTime,bestLap}
const players = new Map();
// raceId -> {id,kind,phase,trackId,track,members:Set,ai:[],laps,startAt,firstFinishAt,countTimer}
const races = new Map();

// Party codes carve the FRIENDS pool into explicit groups, so two people can
// pair up by sharing four letters instead of hoping nobody else on the network
// is also sitting in FRIENDS mode. No code (key '') = the open LAN group.
// Ambiguous glyphs (0/O, 1/I/L) are left out of the alphabet.
const PARTY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newPartyCode() {
  for (let tries = 0; tries < 60; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += PARTY_ALPHABET[Math.floor(Math.random() * PARTY_ALPHABET.length)];
    if (![...players.values()].some(p => p.party === c)) return c;
  }
  return 'X' + String(nextId % 900 + 100); // 31^4 codes exhausted — not on a LAN
}
function partyKey(p) { return p.party || ''; }

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

// Drivers picking FRIENDS who are back at the menu and in the given party —
// the group a shared race waits for. Anyone already in a race (including its
// results screen) is out of this set, so they can never block the next one.
function friendsInLobby(key = '') {
  return [...players.values()].filter(p => p.mode === 'friends' && !p.raceId && partyKey(p) === key);
}

function statusOf(p) {
  if (isRacing(p)) return 'racing';
  if (raceOf(p)) return 'results';
  return p.ready ? 'ready' : 'waiting';
}

// One message drives the whole lobby panel, so the client never has to infer
// who is being waited on. `groups` is keyed by party code ('' = open group);
// each client reads its own entry.
function lobbyState() {
  const groups = {};
  for (const p of players.values()) {
    if (p.mode !== 'friends' || p.raceId) continue;
    const k = partyKey(p);
    if (!groups[k]) groups[k] = { ready: 0, total: 0, waiting: [] };
    groups[k].total++;
    if (p.ready) groups[k].ready++;
    else groups[k].waiting.push(p.name);
  }
  return {
    t: 'lobby',
    list: [...players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, mode: p.mode, status: statusOf(p),
      party: p.party || null, map: p.map,
    })),
    groups,
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
  // AI up front, humans at the back of the grid (a proper comeback drive).
  const ids = [...race.ai.map(a => a.id), ...race.members];
  const slots = [];
  ids.forEach((id, i) => {
    const g = race.track.gridSlot(i);
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
  // The driver who armed first picks the circuit — deterministic and easy to
  // reason about from the lobby ("first READY chooses the track").
  const picker = memberIds
    .map(id => players.get(id)).filter(Boolean)
    .sort((a, b) => (a.readyAt || 0) - (b.readyAt || 0))[0];
  const trackId = picker && validMap(picker.map) ? picker.map : DEFAULT_MAP;
  const race = {
    id: 'r' + nextRaceId++,
    kind,
    phase: 'countdown',
    trackId,
    track: tracks[trackId],
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
  sendTo(race, { t: 'grid', slots, laps: race.laps, kind, roster: rosterOf(race), map: trackId });
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
  console.log(`[race ${race.id}] ${kind} on ${trackId} — ${names} + ${aiCount} AI`);
  return race;
}

// A shared race launches when every FRIENDS driver of one party group back at
// the menu is ready. `force` is the START NOW escape hatch, so a forgotten
// browser tab can never strand the drivers who are actually waiting to go.
function tryStartFriends(key = '', force = false) {
  const grp = friendsInLobby(key);
  const ready = grp.filter(p => p.ready);
  if (ready.length < 2) return false;
  if (!force && ready.length !== grp.length) return false;
  beginRace('friends', ready.map(p => p.id));
  return true;
}

// After a race ends or someone leaves, any party group may suddenly be all-ready.
function tryStartAllFriends() {
  const keys = new Set(
    [...players.values()].filter(p => p.mode === 'friends' && !p.raceId).map(partyKey)
  );
  for (const k of keys) tryStartFriends(k);
}

function onReady(p) {
  if (isRacing(p)) return;   // already on track — ignore
  leaveRace(p);              // clear a finished race so a new one can be built
  p.ready = true;
  p.readyAt = Date.now();    // first-armed driver picks the circuit
  if (p.mode === 'bot') beginRace('bot', [p.id]);
  else tryStartFriends(partyKey(p));
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
  tryStartAllFriends();
  pushLobby();
}

function entityIn(race, id) {
  return race.ai.find(v => v.id === id) || players.get(id);
}

function progressOf(e, track) {
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
    return progressOf(B, race.track) - progressOf(A, race.track);
  });
  return all.map(e => e.id);
}

// ---------------------------------------------------------------- AI driving
// The drivatar brain lives in shared/ai.js so offline (in-browser) races use
// the exact same field.
const AI_DT = 1 / 30;
setInterval(() => {
  for (const race of races.values()) {
    if (race.phase !== 'race') continue;
    const allCars = [...race.ai.map(a => ({ id: a.id, x: a.car.x, z: a.car.z }))];
    // Leading human's progress feeds the drivatars' rubber-banding.
    let humanProgress = null;
    for (const pid of race.members) {
      const p = players.get(pid);
      if (p && p.state) {
        allCars.push({ id: p.id, x: p.state.x, z: p.state.z });
        const prog = (p.state.lap | 0) * race.track.L + (p.state.s || 0);
        if (humanProgress === null || prog > humanProgress) humanProgress = prog;
      }
    }
    for (const a of race.ai) {
      aiThink(a, allCars, race.track, humanProgress);
      stepCar(a.car, a.input, AI_DT, race.track);
      // Lap counting on start/finish crossing.
      if (a.prevS > race.track.L * 0.9 && a.car.s < race.track.L * 0.1) {
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
// 30 Hz, matching the AI physics tick 1:1. Sampling a 30 Hz sim at the old
// 20 Hz aliased the AI cars' motion — up close (overtaking) they visibly
// juddered. LAN bandwidth cost of the extra rate is negligible.
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
        lg: p.state.lg, bk: p.state.bk, nt: p.state.nt,
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
}, 1000 / 30);

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
        id, name, color: (m.color >>> 0) || 0xcfd2d6, ready: false, readyAt: 0, ws,
        mode: MODES.includes(m.mode) ? m.mode : 'bot', raceId: null,
        map: validMap(m.map) ? m.map : DEFAULT_MAP, party: null,
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
      case 'map':
        if (isRacing(p) || !validMap(m.map)) break;
        p.map = m.map;
        pushLobby();
        break;
      case 'party':
        // Create / join / leave a FRIENDS party. Any change un-readies the
        // driver: arming is a confirmation of the group you will race with.
        if (isRacing(p)) break;
        if (m.action === 'create') {
          p.party = newPartyCode();
          p.ready = false;
          ws.send(JSON.stringify({ t: 'party', code: p.party }));
        } else if (m.action === 'join') {
          const code = String(m.code || '').toUpperCase().trim();
          const exists = [...players.values()].some(q => q.id !== p.id && q.party === code);
          if (!/^[A-Z0-9]{4}$/.test(code) || !exists) {
            ws.send(JSON.stringify({ t: 'partyErr', msg: `No party "${code}" here — ask your friend for the code on their screen.` }));
            break;
          }
          p.party = code;
          p.ready = false;
          ws.send(JSON.stringify({ t: 'party', code }));
        } else if (m.action === 'leave') {
          p.party = null;
          p.ready = false;
          ws.send(JSON.stringify({ t: 'party', code: null }));
        }
        pushLobby();
        break;
      case 'ready':
        if (m.ready === false) { p.ready = false; pushLobby(); break; }
        onReady(p);
        break;
      case 'forceStart':
        if (p.mode === 'friends' && !p.raceId && p.ready) {
          if (tryStartFriends(partyKey(p), true)) pushLobby();
        }
        break;
      case 'lobby':   // back to the menu — from results, or after finishing early
        // A driver who has taken the flag may leave while stragglers race on;
        // only an UNFINISHED mid-race driver is held in.
        if (isRacing(p) && !p.finished) break;
        leaveRace(p);
        p.ready = false;
        pushLobby();
        break;
      case 'state':
        if (!race || race.phase === 'results') break;
        p.state = {
          x: +m.x || 0, z: +m.z || 0, h: +m.h || 0,
          sp: +m.sp || 0, s: +m.s || 0, lap: m.lap | 0,
          lg: m.lg ? 1 : 0, bk: m.bk ? 1 : 0, nt: m.nt ? 1 : 0,
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
          if (p.bestLap && recordLap(race.trackId, p.name, p.bestLap)) {
            sendTo(race, { t: 'record', map: race.trackId, name: p.name, lap: Math.round(p.bestLap) });
          }
          sendTo(race, { t: 'finished', id, name: p.name, time: p.finishTime });
        }
        break;
      case 'records':
        if (validMap(m.map)) {
          ws.send(JSON.stringify({ t: 'records', map: m.map, rows: (records[m.map] || []).slice(0, 5) }));
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
    tryStartAllFriends();   // the remaining FRIENDS drivers may now all be ready
    pushLobby();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  NOXRUSH — LAN racing server');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  Friend:  http://${ip}:${PORT}`);
  console.log(`  Maps: ${TRACKS.map(t => t.name).join(', ')}`);
  console.log(`  Laps: ${LAPS}  ·  Ctrl+C to stop`);
  console.log('  Friends must be on the same network. Page not loading for them?');
  console.log('  Allow node through your firewall, and avoid guest Wi-Fi (it isolates devices).\n');
});
