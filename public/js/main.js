// Boot: lobby UI -> net -> game loop.
import { Game } from './game.js';
import { Net } from './net.js';
import { initAudio, sfx, setMusicOn, musicStatus } from './audio.js';
import { toast } from './hud.js';
import { loadCarTemplate, loadSceneryModel } from './carModels.js';
import { setCarTemplate } from './car.js';
import { TRACKS } from '/shared/track.js';

// Opt-in glTF models. Absent -> procedural car / procedural trees.
const [carTpl, treeModel] = await Promise.all([
  loadCarTemplate(),
  loadSceneryModel('tree.glb'),
]);
setCarTemplate(carTpl);

const $ = (id) => document.getElementById(id);

const PAINTS = [0xcfd2d6, 0xd7263d, 0x2364d2, 0xffb400, 0x1f9d55, 0x23262b, 0xf4f5f7, 0xff6a13, 0x7a3cf0, 0x12b8a8];
let paint = Number(localStorage.getItem('hr_paint') || PAINTS[0]);
if (!PAINTS.includes(paint)) paint = PAINTS[0];

const MODES = ['bot', 'friends'];
let mode = localStorage.getItem('hr_mode') || 'bot';
if (!MODES.includes(mode)) mode = 'bot';

const MAP_IDS = TRACKS.map(t => t.id);
let map = localStorage.getItem('hr_map') || MAP_IDS[0];
if (!MAP_IDS.includes(map)) map = MAP_IDS[0];

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

// game + net
const game = new Game($('gl'), quality, treeModel, map);
const net = new Net();
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

// paint swatches
for (const c of PAINTS) {
  const d = document.createElement('div');
  d.className = 'swatch' + (c === paint ? ' sel' : '');
  d.style.background = '#' + c.toString(16).padStart(6, '0');
  d.addEventListener('click', () => {
    paint = c;
    localStorage.setItem('hr_paint', String(c));
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
    d.classList.add('sel');
    game.setIdentity(currentName(), paint);
    if (joined) net.send({ t: 'name', name: currentName(), color: paint });
    sfx.click();
  });
  $('swatches').appendChild(d);
}

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

for (const t of TRACKS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-card' + (t.id === map ? ' sel' : '');
  b.dataset.map = t.id;
  b.appendChild(trackThumb(t));
  const meta = document.createElement('span');
  meta.className = 'mc-meta';
  meta.innerHTML = `<span class="mc-title">${t.name.toUpperCase()}</span><span class="mc-sub">${t.tagline}</span>`;
  b.appendChild(meta);
  b.addEventListener('click', () => {
    if (map === t.id) return;
    map = t.id;
    localStorage.setItem('hr_map', map);
    for (const x of document.querySelectorAll('#mapSeg [data-map]')) {
      x.classList.toggle('sel', x.dataset.map === map);
    }
    game.setTrack(map);   // the lobby turntable moves to the chosen circuit
    if (joined) net.send({ t: 'map', map });
    sfx.click();
  });
  $('mapSeg').appendChild(b);
}

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
    if (joined) net.send({ t: 'mode', mode });
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
  const rivals = mode === 'bot' ? '🤖 BOTS' : party ? `👥 PARTY ${party}` : '👥 OPEN LAN';
  $('summaryChips').innerHTML = `
    <button type="button" class="chip" data-step="1"><span class="chip-dot" style="background:#${paint.toString(16).padStart(6, '0')}"></span>${esc(currentName())}</button>
    <button type="button" class="chip" data-step="2">${esc(t.name.toUpperCase())}</button>
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
  $('readyBtn').textContent = mode === 'bot'
    ? 'STARTING…'
    : 'READY — WAITING FOR DRIVERS…';
}

// One place decides what the panel says, from the server's lobby state.
function renderStatus() {
  const el = $('lobbyStatus');
  if (!net.connected) { el.textContent = 'Disconnected — is the server running? (npm start)'; return; }

  if (mode === 'bot') {
    el.textContent = armed
      ? 'Rolling out…'
      : 'You against a full grid of drivatars. Starts the moment you hit READY — no waiting for anyone.';
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
const MAP_SHORT = Object.fromEntries(TRACKS.map(t => [t.id, t.name.split(' ')[0].toUpperCase()]));

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
  net.send({ t: 'join', name: currentName(), color: paint, mode, map });
  renderStatus();
});
net.on('close', () => {
  $('lobbyStatus').textContent = 'Disconnected — is the server running? (npm start)';
  $('readyBtn').disabled = false;
  $('readyBtn').textContent = 'RECONNECT';
  $('readyBtn').onclickMode = 'reconnect';
  $('startNowBtn').classList.add('hidden');
  joined = false;
  armed = false;
  party = null;
  renderPartyBox();
});

function showLobby() {
  $('lobby').classList.remove('hidden');
  armed = false;
  disarmButton();
  renderStatus();
}
function hideLobby() { $('lobby').classList.add('hidden'); }

net.on('grid', () => { armed = false; hideLobby(); });

net.on('results', () => {
  $('againBtn').disabled = false;
  $('againBtn').textContent = 'RACE AGAIN';
  $('backBtn').disabled = false;
});

// ---------------------------------------------------------------- buttons
function sendReady() {
  initAudio();
  const name = currentName();
  localStorage.setItem('hr_name', name);
  if (!net.connected || !joined) { toast('Not connected to the server yet…'); return false; }
  // Joining happened on connect; just make sure the server has the latest picks.
  net.send({ t: 'name', name, color: paint });
  net.send({ t: 'mode', mode });
  net.send({ t: 'map', map });
  sfx.ignition();   // the button says START ENGINE, so start the engine
  net.send({ t: 'ready', ready: true });
  armed = true;
  return true;
}

$('readyBtn').addEventListener('click', () => {
  if ($('readyBtn').onclickMode === 'reconnect') {
    location.reload();
    return;
  }
  if (!sendReady()) return;
  armButton();
  renderStatus();
});

$('startNowBtn').addEventListener('click', () => {
  net.send({ t: 'forceStart' });
  sfx.click();
});

$('againBtn').addEventListener('click', () => {
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
  net.send({ t: 'lobby' });
  game.toLobby();
  showLobby();
  sfx.click();
});

net.connect();
game.start();
window.__game = game;         // debug hooks
window.__music = musicStatus;
