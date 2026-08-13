// Boot: lobby UI -> net -> game loop.
import { Game } from './game.js';
import { Net } from './net.js';
import { LocalRace } from './offline.js';
import { initAudio, sfx, setMusicOn, musicStatus } from './audio.js';
import { toast } from './hud.js';
import { loadCarTemplate, loadCarPack, loadSceneryModel } from './carModels.js';
import { setCarTemplate, setCarPack } from './car.js';
import { bindTouchUI } from './input.js';
import { TRACKS } from '/shared/track.js';
import { getProgress, xpForLevel, paintUnlocked, paintLockLevel, pbFor, addXP } from './progress.js';

// Opt-in glTF models. Absent -> procedural car / trees / billboards.
const [carTpl, botCars, treeModel, billboardModel] = await Promise.all([
  loadCarTemplate(),
  loadCarPack(),
  loadSceneryModel('low_poly_trees.glb'),
  loadSceneryModel('low-poly_billboard_pack.glb'),
]);
setCarTemplate(carTpl);
setCarPack(botCars);

const $ = (id) => document.getElementById(id);

const PAINTS = [0xcfd2d6, 0xd7263d, 0x2364d2, 0xffb400, 0x1f9d55, 0x23262b, 0xf4f5f7, 0xff6a13, 0x7a3cf0, 0x12b8a8];
let paint = Number(localStorage.getItem('hr_paint') || PAINTS[0]);
if (!PAINTS.includes(paint)) paint = PAINTS[0];
// A paint above the driver's level (e.g. progress was reset) falls back to stock.
if (!paintUnlocked(PAINTS.indexOf(paint))) paint = PAINTS[0];

// bot/friends are server modes; trial (solo vs the clock + your ghost) and
// champ (three-race series) always run on the in-browser race engine.
const MODES = ['bot', 'friends', 'trial', 'champ'];
let mode = localStorage.getItem('hr_mode') || 'bot';
if (!MODES.includes(mode)) mode = 'bot';
// What the server should treat us as — it only knows bot/friends.
const serverMode = () => (mode === 'friends' ? 'friends' : 'bot');

// Track selection = base circuit + direction; `map` is the full id the game
// and server use ('coastal' / 'coastal-r').
const MAP_IDS = TRACKS.map(t => t.id);
let map = localStorage.getItem('hr_map') || MAP_IDS[0];
if (!MAP_IDS.includes(map)) map = MAP_IDS[0];
let baseMap = map.endsWith('-r') ? map.slice(0, -2) : map;
let dir = map.endsWith('-r') ? 'rev' : 'fwd';

const quality = localStorage.getItem('hr_quality') || 'high';
$('quality').value = quality;
$('quality').addEventListener('change', () => {
  localStorage.setItem('hr_quality', $('quality').value);
  location.reload();
});

$('musicSel').value = localStorage.getItem('hr_music') === 'off' ? 'off' : 'on';
$('musicSel').addEventListener('change', () => {
  setMusicOn($('musicSel').value === 'on');
  sfx.click();
});

$('nameInput').value = localStorage.getItem('hr_name') || '';

// game + net + offline fallback (BOTS races run in-browser with no server)
const game = new Game($('gl'), quality, treeModel, map, billboardModel);
const net = new Net();
const offline = new LocalRace(net);
net.local = offline;
game.attachNet(net);

let joined = false;
let armed = false;      // this driver has pressed READY and is waiting
let party = null;       // FRIENDS party code, null = open LAN group
let lastLobby = null;   // most recent server lobby state

function currentName() {
  return ($('nameInput').value.trim() || 'Player').slice(0, 14);
}

// The car is on the track from the first frame, so paint choices are visible
// while you make them rather than only once the race starts.
game.setIdentity(currentName(), paint);

// paint swatches — locked ones show the level that opens them
function buildSwatches() {
  $('swatches').innerHTML = '';
  PAINTS.forEach((c, i) => {
    const d = document.createElement('div');
    const unlocked = paintUnlocked(i);
    d.className = 'swatch' + (c === paint ? ' sel' : '') + (unlocked ? '' : ' locked');
    d.style.background = '#' + c.toString(16).padStart(6, '0');
    if (!unlocked) d.innerHTML = `<span class="swatch-lock">${paintLockLevel(i)}</span>`;
    d.addEventListener('click', () => {
      if (!unlocked) {
        toast(`🔒 Unlocks at level ${paintLockLevel(i)} — bank skill chains to level up`);
        return;
      }
      paint = c;
      localStorage.setItem('hr_paint', String(c));
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
      d.classList.add('sel');
      game.setIdentity(currentName(), paint);
      if (joined) net.send({ t: 'name', name: currentName(), color: paint });
      sfx.click();
    });
    $('swatches').appendChild(d);
  });
}
buildSwatches();

// driver level chip (step 1)
function renderDriver() {
  const p = getProgress();
  const cur = xpForLevel(p.level), next = xpForLevel(p.level + 1);
  const frac = Math.min(1, (p.xp - cur) / Math.max(1, next - cur));
  $('levelChip').innerHTML = `
    <span class="lvl-num">LEVEL ${p.level}</span>
    <span class="lvl-xp">${p.xp.toLocaleString()} XP</span>
    <div class="lvl-bar"><div style="width:${(frac * 100).toFixed(0)}%"></div></div>
    <span class="lvl-next">next: ${next.toLocaleString()}</span>`;
}
renderDriver();

$('nameInput').addEventListener('input', () => {
  game.setIdentity(currentName(), paint);
  if (joined) net.send({ t: 'name', name: currentName(), color: paint });
});

// ---------------------------------------------------------------- track picker
// Each circuit is drawn as a little map card: its real centerline over the
// theme's sky/ground colours, so the choice reads at a glance.
function trackThumb(t, w = 168, h = 84) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  c.className = 'mc-thumb';
  const g = c.getContext('2d');
  g.scale(2, 2);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const th = t.theme;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hex(th.sky[1]));
  grad.addColorStop(0.45, hex(th.sky[2]));
  grad.addColorStop(0.46, hex(th.ground[0]));
  grad.addColorStop(1, hex(th.ground[1]));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  if (th.ocean != null) {
    g.fillStyle = hex(th.ocean);
    g.globalAlpha = 0.85;
    g.fillRect(0, h * 0.6, w * 0.26, h * 0.4);
    g.globalAlpha = 1;
  }
  // normalized, north-up centerline
  const xs = t.points.map(p => p[0]), zs = t.points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = 11;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2, oz = (h - (maxZ - minZ) * sc) / 2;
  const pp = t.points.map(p => [ox + (p[0] - minX) * sc, h - (oz + (p[1] - minZ) * sc)]);
  const n = pp.length;
  g.beginPath();
  g.moveTo((pp[0][0] + pp[1][0]) / 2, (pp[0][1] + pp[1][1]) / 2);
  for (let i = 1; i <= n; i++) {
    const cur = pp[i % n], nxt = pp[(i + 1) % n];
    g.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2);
  }
  g.closePath();
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 6.5; g.stroke();
  g.strokeStyle = '#f2f4f7'; g.lineWidth = 4.2; g.stroke();
  g.strokeStyle = '#3a3d42'; g.lineWidth = 2.1; g.stroke();
  const s0 = pp[0];
  g.fillStyle = '#ff2d78';
  g.beginPath(); g.arc(s0[0], s0[1], 3, 0, Math.PI * 2); g.fill();
  return c;
}

// One card per base circuit; a FORWARD/REVERSED toggle below picks direction.
const MEDAL_ICO = { gold: '🥇', silver: '🥈', bronze: '🥉' };
function applyMap({ send = true } = {}) {
  map = baseMap + (dir === 'rev' ? '-r' : '');
  localStorage.setItem('hr_map', map);
  for (const x of document.querySelectorAll('#mapSeg [data-map]')) {
    x.classList.toggle('sel', x.dataset.map === baseMap);
  }
  for (const d of document.querySelectorAll('#dirSeg [data-dir]')) {
    d.classList.toggle('sel', d.dataset.dir === dir);
  }
  game.setTrack(map);   // the lobby turntable moves to the chosen circuit
  if (send && joined) net.send({ t: 'map', map });
  renderTrackBadges();
  requestRecords();
}

// PB + medal badge per card, for the currently selected direction.
function renderTrackBadges() {
  for (const card of document.querySelectorAll('#mapSeg [data-map]')) {
    const id = card.dataset.map + (dir === 'rev' ? '-r' : '');
    const pb = pbFor(id);
    const badge = card.querySelector('.mc-badge');
    if (!badge) continue;
    if (pb && pb.lap) {
      badge.textContent = `${pb.medal ? MEDAL_ICO[pb.medal] + ' ' : ''}${fmtLap(pb.lap)}`;
      badge.classList.remove('empty');
    } else {
      badge.textContent = 'NO LAP SET';
      badge.classList.add('empty');
    }
  }
}
function fmtLap(ms) {
  const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

for (const t of TRACKS.filter(x => !x.reversed)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-card' + (t.id === baseMap ? ' sel' : '');
  b.dataset.map = t.id;
  b.appendChild(trackThumb(t));
  const meta = document.createElement('span');
  meta.className = 'mc-meta';
  meta.innerHTML = `<span class="mc-title">${t.name.toUpperCase()}</span><span class="mc-sub">${t.tagline}</span><span class="mc-badge empty">NO LAP SET</span>`;
  b.appendChild(meta);
  b.addEventListener('click', () => {
    if (baseMap === t.id) return;
    baseMap = t.id;
    applyMap();
    sfx.click();
  });
  $('mapSeg').appendChild(b);
}
for (const d of document.querySelectorAll('#dirSeg [data-dir]')) {
  d.addEventListener('click', () => {
    if (dir === d.dataset.dir) return;
    dir = d.dataset.dir;
    applyMap();
    sfx.click();
  });
}
applyMap({ send: false });

// Lobby refresh after a race banks XP: level chip, unlocks, PBs.
game.onProgress = () => { renderDriver(); buildSwatches(); renderTrackBadges(); };

// ---------------------------------------------------------------- opponents
function paintModeSeg() {
  for (const b of document.querySelectorAll('#modeSeg [data-mode]')) {
    b.classList.toggle('sel', b.dataset.mode === mode);
  }
  $('partyBox').classList.toggle('hidden', mode !== 'friends');
}
for (const b of document.querySelectorAll('#modeSeg [data-mode]')) {
  b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    localStorage.setItem('hr_mode', mode);
    paintModeSeg();
    sfx.click();
    // Switching opponents un-arms you, so you always confirm the mode you race.
    if (armed) { armed = false; disarmButton(); }
    if (joined) net.send({ t: 'mode', mode: serverMode() });
    renderStatus();
  });
}
paintModeSeg();

// ---------------------------------------------------------------- step wizard
// The lobby is a four-step flow: DRIVER -> TRACK -> RIVALS -> RACE. Everything
// stays on one card; steps just focus one decision at a time. Returning
// players (saved name) land straight on RACE and can hop back via the dots.
let step = 1;
function renderSummary() {
  const esc = (s) => String(s).replace(/[<>&]/g, '');
  const t = TRACKS.find(x => x.id === map) || TRACKS[0];
  const rivals =
    mode === 'bot' ? '🤖 BOTS' :
    mode === 'trial' ? '⏱ TIME TRIAL' :
    mode === 'champ' ? '🏆 CHAMPIONSHIP' :
    party ? `👥 PARTY ${party}` : '👥 OPEN LAN';
  $('summaryChips').innerHTML = `
    <button type="button" class="chip" data-step="1"><span class="chip-dot" style="background:#${paint.toString(16).padStart(6, '0')}"></span>${esc(currentName())}</button>
    <button type="button" class="chip" data-step="2">${esc(t.name.toUpperCase())}${t.reversed ? ' ⟲' : ''}</button>
    <button type="button" class="chip" data-step="3">${rivals}</button>`;
  for (const c of $('summaryChips').querySelectorAll('.chip')) {
    c.addEventListener('click', () => { showStep(+c.dataset.step); sfx.click(); });
  }
}
function showStep(n) {
  step = Math.max(1, Math.min(4, n));
  for (let i = 1; i <= 4; i++) $('step' + i).classList.toggle('hidden', i !== step);
  for (const d of document.querySelectorAll('.step-dot')) {
    const sn = +d.dataset.step;
    d.classList.toggle('sel', sn === step);
    d.classList.toggle('done', sn < step);
  }
  $('stepBack').classList.toggle('hidden', step === 1);
  $('stepNext').classList.toggle('hidden', step === 4);
  $('quickBtn').classList.toggle('hidden', step === 4);
  if (step === 4) renderSummary();
}
$('stepNext').addEventListener('click', () => { showStep(step + 1); sfx.click(); });
$('stepBack').addEventListener('click', () => { showStep(step - 1); sfx.click(); });
for (const d of document.querySelectorAll('.step-dot')) {
  d.addEventListener('click', () => { showStep(+d.dataset.step); sfx.click(); });
}
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') showStep(2); });
showStep(localStorage.getItem('hr_name') ? 4 : 1);

// ---------------------------------------------------------------- party codes
function renderPartyBox() {
  $('partyBox').classList.toggle('hidden', mode !== 'friends');
  $('partyNone').classList.toggle('hidden', !!party);
  $('partyYes').classList.toggle('hidden', !party);
  if (party) $('partyCode').textContent = party;
}

$('partyCreate').addEventListener('click', () => {
  if (!joined) { toast('Not connected to the server yet…'); return; }
  net.send({ t: 'party', action: 'create' });
  sfx.click();
});

function joinParty() {
  const code = $('partyInput').value.trim().toUpperCase();
  if (code.length !== 4) { toast('Party codes are 4 characters — ask your friend for theirs.'); return; }
  if (!joined) { toast('Not connected to the server yet…'); return; }
  net.send({ t: 'party', action: 'join', code });
  sfx.click();
}
$('partyJoinBtn').addEventListener('click', joinParty);
$('partyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinParty(); });
$('partyInput').addEventListener('input', () => {
  $('partyInput').value = $('partyInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('partyLeave').addEventListener('click', () => {
  net.send({ t: 'party', action: 'leave' });
  sfx.click();
});

$('partyCopy').addEventListener('click', () => {
  copyText(party).then(() => toast(`Party code ${party} copied — send it to your friends`));
  sfx.click();
});

net.on('party', (m) => {
  party = m.code || null;
  // The server un-readies on any party change; mirror that locally.
  if (armed) { armed = false; disarmButton(); }
  $('partyInput').value = '';
  renderPartyBox();
  renderStatus();
  if (step === 4) renderSummary();
  if (party) toast(`Party ${party} — friends enter this code under FRIENDS (step 3)`, 4200);
});
net.on('partyErr', (m) => toast(m.msg, 4500));

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // http:// on a LAN IP is not a secure context, so clipboard API is missing.
  return new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy') ? res() : rej(new Error('copy failed')); }
    catch (e) { rej(e); }
    finally { ta.remove(); }
  });
}

// ---------------------------------------------------------------- LAN address
fetch('/info').then(r => r.json()).then(info => {
  const urls = (info.ips.length ? info.ips : ['<this-machine-ip>']).map(ip => `http://${ip}:${info.port}`);
  $('lanUrls').innerHTML = urls.map(u =>
    `<div class="lan-url" data-url="${u}"><span>${u}</span><span class="lan-copy">COPY</span></div>`).join('');
  for (const el of document.querySelectorAll('.lan-url')) {
    el.addEventListener('click', () => {
      copyText(el.dataset.url)
        .then(() => toast('Address copied — send it to your friend'))
        .catch(() => toast('Copy failed — select the address by hand'));
    });
  }
}).catch(() => {});

// ---------------------------------------------------------------- lobby UI
function disarmButton() {
  $('readyBtn').disabled = false;
  $('readyBtn').classList.remove('armed');
  $('readyBtn').textContent = 'READY — START ENGINE';
  $('startNowBtn').classList.add('hidden');
}

function armButton() {
  $('readyBtn').disabled = true;
  $('readyBtn').classList.add('armed');
  $('readyBtn').textContent = mode === 'friends'
    ? 'READY — WAITING FOR DRIVERS…'
    : 'STARTING…';
}

// One place decides what the panel says, from the server's lobby state.
function renderStatus() {
  const el = $('lobbyStatus');
  const solo = mode !== 'friends';   // bot / trial / champ never wait for anyone
  if (!net.connected && !solo) {
    el.textContent = 'FRIENDS needs the LAN server (npm start) — it reconnects automatically. Solo modes work offline.';
    $('startNowBtn').classList.add('hidden');
    return;
  }

  if (solo) {
    const blurb = {
      bot: 'You against a full grid of drivatars. Starts the moment you hit READY.',
      trial: 'Empty track, just you and the clock — your best lap replays as a ghost to chase.',
      champ: `Three rounds${dir === 'rev' ? ' (reversed)' : ''} — Coastal, Alpine, Sunset — points for positions. Beat the drivatars over a series.`,
    };
    el.textContent = armed ? 'Rolling out…' : blurb[mode];
    $('startNowBtn').classList.add('hidden');
    return;
  }

  // My FRIENDS group: my party's entry in the server's group map ('' = open LAN).
  const st = lastLobby;
  const grp = (st && st.groups && st.groups[party || '']) || { ready: armed ? 1 : 0, total: 1, waiting: [] };
  const who = party ? `Party ${party}` : 'Open LAN group';

  if (!armed) {
    el.textContent = grp.total > 1
      ? `${who}: ${grp.ready} of ${grp.total} drivers ready. Hit READY to join them.`
      : party
        ? `Party ${party} is just you so far — send friends the code and the address below.`
        : 'Send your friend the address below (or create a party code), then both hit READY.';
    $('startNowBtn').classList.add('hidden');
    return;
  }

  if (grp.total < 2) {
    el.textContent = party
      ? `Ready. Waiting for a friend to join party ${party}…`
      : 'Waiting for another driver to connect — or switch to BOTS to race the drivatars now.';
    $('startNowBtn').classList.add('hidden');
    return;
  }
  if (grp.waiting.length) {
    el.textContent = `Waiting for ${grp.waiting.join(', ')} to hit READY.`;
    // Never let a forgotten browser tab strand the drivers who are ready.
    $('startNowBtn').classList.toggle('hidden', grp.ready < 2);
    return;
  }
  el.textContent = `${grp.ready} drivers ready — rolling out…`;
  $('startNowBtn').classList.add('hidden');
}

const MODE_LABEL = { bot: 'BOTS', friends: 'FRIENDS' };
const STATUS_LABEL = { racing: 'RACING', results: 'RESULTS', ready: 'READY', waiting: 'WAITING' };
const MAP_SHORT = Object.fromEntries(
  TRACKS.map(t => [t.id, t.name.split(' ')[0].toUpperCase() + (t.reversed ? ' ·R' : '')]));

net.on('lobby', (m) => {
  lastLobby = m;
  $('lobbyList').innerHTML = m.list.map(p => `
    <div class="lp-row">
      <span class="lp-dot" style="background:#${(p.color >>> 0).toString(16).padStart(6, '0')}"></span>
      <span>${String(p.name).replace(/[<>&]/g, '')}</span>
      ${p.party ? `<span class="lp-party">${String(p.party).replace(/[<>&]/g, '')}</span>` : ''}
      <span class="lp-mode">${MODE_LABEL[p.mode] || ''}${MAP_SHORT[p.map] ? ' · ' + MAP_SHORT[p.map] : ''}</span>
      <span class="lp-ready ${p.status}">${STATUS_LABEL[p.status] || ''}</span>
    </div>`).join('');
  renderStatus();
});

// Join the lobby the moment the socket opens: you are visible to your friends
// (and they to you) before anyone commits to READY. Pressing READY used to be
// the join, which made two people at two screens each look alone.
net.on('open', () => {
  joined = true;
  net.send({ t: 'join', name: currentName(), color: paint, mode: serverMode(), map });
  requestRecords();
  renderStatus();
});
net.on('close', () => {
  // Net keeps retrying in the background; BOTS races still work offline.
  joined = false;
  armed = false;
  party = null;
  renderPartyBox();
  disarmButton();
  renderStatus();
});

function showLobby() {
  $('lobby').classList.remove('hidden');
  armed = false;
  disarmButton();
  renderStatus();
}
function hideLobby() { $('lobby').classList.add('hidden'); }

net.on('grid', () => { armed = false; hideLobby(); });

// ---------------------------------------------------------------- championship
// A three-race series (one per circuit, in the chosen direction) vs the
// drivatars, F1-style points, run entirely on the in-browser race engine.
const CHAMP_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 3, 2, 1, 0];
let champ = null;   // { round, races: [ids], points: Map(id -> pts), names: Map }

function startChampionship() {
  champ = {
    round: 0,
    races: ['coastal', 'alpine', 'dunes'].map(b => b + (dir === 'rev' ? '-r' : '')),
    points: new Map(),
    names: new Map(),
  };
  startChampRound();
}
function startChampRound() {
  offline.start(champ.races[champ.round], currentName(), paint, 'bot');
}
function champStandings() {
  return [...champ.points.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, pts]) => ({ id, pts, name: champ.names.get(id) || id }));
}
function renderChampBox(final) {
  const box = $('champBox');
  const rows = champStandings();
  const myRank = rows.findIndex(r => r.id === 'you') + 1;
  box.innerHTML = `
    <div class="cb-title">🏆 CHAMPIONSHIP — ${final ? 'FINAL STANDINGS' : `ROUND ${champ.round + 1}/3`}</div>
    ${rows.slice(0, 6).map((r, i) => `
      <div class="cb-row ${r.id === 'you' ? 'me' : ''}">
        <span class="cb-pos">${i + 1}</span><span>${String(r.name).replace(/[<>&]/g, '')}</span>
        <span class="cb-pts">${r.pts} pts</span>
      </div>`).join('')}
    ${final && myRank ? `<div class="cb-final">${myRank === 1 ? '👑 CHAMPION!' : `You finished P${myRank} overall`}</div>` : ''}`;
  box.classList.remove('hidden');
}

// ---------------------------------------------------------------- daily challenge
// A date-seeded track+direction time trial — same combo for everyone today.
// First finish of the day pays bonus XP; your daily best shows on the banner.
function dailyInfo() {
  const d = new Date();
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = TRACKS[h % TRACKS.length];
  return { key, id: t.id, label: t.name.toUpperCase() + (t.reversed ? ' ⟲' : '') };
}
let dailyRun = null;   // set to today's key while a daily attempt is in flight
function dailyState() {
  try {
    const s = JSON.parse(localStorage.getItem('hr_daily'));
    if (s && s.key === dailyInfo().key) return s;
  } catch {}
  return { key: dailyInfo().key, lap: 0, awarded: false };
}
function renderDaily() {
  const info = dailyInfo();
  const st = dailyState();
  $('dailyLabel').innerHTML = `📅 DAILY CHALLENGE · <b>${info.label}</b> · TIME TRIAL`;
  $('dailyBest').textContent = st.lap ? `best today ${fmtLap(st.lap)}` : '+500 XP for your first run';
}
$('dailyGo').addEventListener('click', () => {
  const info = dailyInfo();
  baseMap = info.id.endsWith('-r') ? info.id.slice(0, -2) : info.id;
  dir = info.id.endsWith('-r') ? 'rev' : 'fwd';
  mode = 'trial';
  localStorage.setItem('hr_mode', mode);
  paintModeSeg();
  applyMap();
  dailyRun = info.key;
  if (sendReady()) { showStep(4); armButton(); renderStatus(); }
  sfx.click();
});

// ---------------------------------------------------------------- lap records
// The server keeps a persistent top-10 per track; show the top 5 for the
// selected circuit. Hidden while offline (there's no server to remember).
function requestRecords() {
  if (net.connected && joined) net.send({ t: 'records', map });
  $('recordsBox').classList.toggle('hidden', !net.connected);
}
net.on('records', (m) => {
  if (m.map !== map) return;
  $('recTrack').textContent = MAP_SHORT[map] || map;
  $('recordsList').innerHTML = m.rows.length
    ? m.rows.map((r, i) => `
        <div class="lp-row rec-row">
          <span class="rec-pos">${i + 1}</span>
          <span>${String(r.name).replace(/[<>&]/g, '')}</span>
          <span class="rec-lap">${fmtLap(r.lap)}</span>
        </div>`).join('')
    : '<div class="rec-empty">No laps on the board yet — set one.</div>';
});
net.on('record', (m) => {
  if (m.map === map) requestRecords();
  toast(`📋 ${m.name} set a server record lap — ${fmtLap(m.lap)}`, 3500);
});

net.on('results', (m) => {
  $('againBtn').disabled = false;
  $('backBtn').disabled = false;

  // Championship bookkeeping rides on the normal results message.
  if (champ && mode === 'champ') {
    const rows = m.rows || [];
    for (const r of rows) {
      champ.names.set(r.id, r.name);
      champ.points.set(r.id, (champ.points.get(r.id) || 0) + (CHAMP_PTS[r.pos - 1] || 0));
    }
    const final = champ.round >= champ.races.length - 1;
    renderChampBox(final);
    if (final) {
      const rank = champStandings().findIndex(r => r.id === 'you') + 1;
      const bonus = rank === 1 ? 2000 : rank === 2 ? 1200 : rank === 3 ? 800 : 400;
      addXP(bonus);
      toast(`🏆 Championship ${rank === 1 ? 'won! ' : `finished P${rank} — `}+${bonus.toLocaleString()} XP`, 5000);
      if (game.onProgress) game.onProgress();
      renderDriver();
      $('againBtn').textContent = 'NEW CHAMPIONSHIP';
    } else {
      $('againBtn').textContent = `NEXT ROUND (${champ.round + 2}/3) →`;
    }
  } else {
    $('champBox').classList.add('hidden');
    $('againBtn').textContent = 'RACE AGAIN';
  }

  // Daily challenge: record today's best and pay the first-run bonus.
  if (dailyRun && dailyRun === dailyInfo().key && mode === 'trial' && game.bestLap > 5000) {
    const st = dailyState();
    if (!st.lap || game.bestLap < st.lap) st.lap = Math.round(game.bestLap);
    if (!st.awarded) {
      st.awarded = true;
      addXP(500);
      toast('📅 Daily challenge complete — +500 XP', 4000);
      if (game.onProgress) game.onProgress();
      renderDriver();
    }
    try { localStorage.setItem('hr_daily', JSON.stringify(st)); } catch {}
    renderDaily();
  }
  dailyRun = null;

  requestRecords();   // a finished race may have changed the boards
});

// ---------------------------------------------------------------- buttons
function sendReady() {
  initAudio();
  const name = currentName();
  localStorage.setItem('hr_name', name);

  // Solo modes that always run on the in-browser engine, server or not.
  if (mode === 'trial' || mode === 'champ') {
    sfx.ignition();
    armed = true;   // before start(): its synchronous 'grid' un-arms us
    if (mode === 'champ') startChampionship();
    else offline.start(map, name, paint, 'trial');
    return true;
  }

  if (net.connected && joined) {
    // Joining happened on connect; just make sure the server has the latest picks.
    net.send({ t: 'name', name, color: paint });
    net.send({ t: 'mode', mode: serverMode() });
    net.send({ t: 'map', map });
    sfx.ignition();   // the button says START ENGINE, so start the engine
    net.send({ t: 'ready', ready: true });
    armed = true;
    return true;
  }

  // No server reachable: BOTS races run right here in the browser — the
  // offline engine speaks the same protocol, so the race code path is shared.
  if (mode === 'bot') {
    sfx.ignition();
    armed = true;
    offline.start(map, name, paint);
    return true;
  }
  toast('FRIENDS needs the LAN server (npm start) — solo modes work offline.');
  return false;
}

$('readyBtn').addEventListener('click', () => {
  if (!sendReady()) return;
  armButton();
  renderStatus();
});

// ⚡ QUICK RACE — one tap from any step straight onto the grid vs drivatars.
$('quickBtn').addEventListener('click', () => {
  mode = 'bot';
  localStorage.setItem('hr_mode', mode);
  paintModeSeg();
  if (joined) net.send({ t: 'mode', mode: serverMode() });
  if (!sendReady()) return;
  showStep(4);
  armButton();
  renderStatus();
  sfx.click();
});

$('startNowBtn').addEventListener('click', () => {
  net.send({ t: 'forceStart' });
  sfx.click();
});

$('againBtn').addEventListener('click', () => {
  // Championship: AGAIN means "next round" (or a fresh series after the last).
  if (champ && mode === 'champ') {
    if (champ.round < champ.races.length - 1) {
      champ.round++;
      startChampRound();
    } else {
      startChampionship();
    }
    sfx.click();
    return;
  }
  // A bot race starts instantly, so the results card can stay up until the grid
  // replaces it. A friends race may have to wait for the other driver, and that
  // waiting state — including START NOW — only exists on the lobby panel.
  if (mode === 'friends') {
    game.toLobby();
    showLobby();
    if (sendReady()) { armButton(); renderStatus(); }
    return;
  }
  $('againBtn').disabled = true;
  $('backBtn').disabled = true;
  $('againBtn').textContent = 'STARTING…';
  if (!sendReady()) return;
});

// Back to the menu so opponents, paint and name can be changed between races.
$('backBtn').addEventListener('click', () => {
  if (champ) { champ = null; toast('Championship closed'); }
  $('champBox').classList.add('hidden');
  net.send({ t: 'lobby' });
  game.toLobby();
  showLobby();
  renderDaily();
  sfx.click();
});

bindTouchUI();
renderDaily();
net.connect();
game.start();
window.__game = game;         // debug hooks
window.__music = musicStatus;
