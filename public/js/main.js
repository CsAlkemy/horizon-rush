// Boot: lobby UI -> net -> game loop.
import { Game } from './game.js';
import { Net } from './net.js';
import { initAudio, sfx } from './audio.js';
import { toast } from './hud.js';
import { loadCarTemplate, loadSceneryModel } from './carModels.js';
import { setCarTemplate } from './car.js';

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

const quality = localStorage.getItem('hr_quality') || 'high';
$('quality').value = quality;
$('quality').addEventListener('change', () => {
  localStorage.setItem('hr_quality', $('quality').value);
  location.reload();
});

$('nameInput').value = localStorage.getItem('hr_name') || '';

// game + net
const game = new Game($('gl'), quality, treeModel);
const net = new Net();
game.attachNet(net);

let joined = false;
let armed = false;      // this driver has pressed READY and is waiting
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

// ---------------------------------------------------------------- opponents
function paintModeSeg() {
  for (const b of document.querySelectorAll('.seg-btn')) {
    b.classList.toggle('sel', b.dataset.mode === mode);
  }
}
for (const b of document.querySelectorAll('.seg-btn')) {
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

// ---------------------------------------------------------------- LAN address
fetch('/info').then(r => r.json()).then(info => {
  const ip = info.ips[0];
  $('lanUrl').textContent = ip ? `http://${ip}:${info.port}` : `http://<this-machine-ip>:${info.port}`;
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

  const st = lastLobby;
  const ready = st ? st.friendsReady : (armed ? 1 : 0);
  const total = st ? st.friendsTotal : 1;
  const waiting = st ? st.friendsWaiting : [];

  if (!armed) {
    el.textContent = total > 1
      ? `${ready} of ${total} drivers ready. Hit READY to join them.`
      : 'Send your friend the address below, then both hit READY.';
    $('startNowBtn').classList.add('hidden');
    return;
  }

  if (total < 2) {
    el.textContent = 'Waiting for another driver to connect — or switch to BOTS to race the drivatars now.';
    $('startNowBtn').classList.add('hidden');
    return;
  }
  if (waiting.length) {
    el.textContent = `Waiting for ${waiting.join(', ')} to hit READY.`;
    // Never let a forgotten browser tab strand the drivers who are ready.
    $('startNowBtn').classList.toggle('hidden', ready < 2);
    return;
  }
  el.textContent = `${ready} drivers ready — rolling out…`;
  $('startNowBtn').classList.add('hidden');
}

const MODE_LABEL = { bot: 'BOTS', friends: 'FRIENDS' };
const STATUS_LABEL = { racing: 'RACING', results: 'RESULTS', ready: 'READY', waiting: 'WAITING' };

net.on('lobby', (m) => {
  lastLobby = m;
  $('lobbyList').innerHTML = m.list.map(p => `
    <div class="lp-row">
      <span class="lp-dot" style="background:#${(p.color >>> 0).toString(16).padStart(6, '0')}"></span>
      <span>${String(p.name).replace(/[<>&]/g, '')}</span>
      <span class="lp-mode">${MODE_LABEL[p.mode] || ''}</span>
      <span class="lp-ready ${p.status}">${STATUS_LABEL[p.status] || ''}</span>
    </div>`).join('');
  renderStatus();
});

net.on('open', () => { renderStatus(); });
net.on('close', () => {
  $('lobbyStatus').textContent = 'Disconnected — is the server running? (npm start)';
  $('readyBtn').disabled = false;
  $('readyBtn').textContent = 'RECONNECT';
  $('readyBtn').onclickMode = 'reconnect';
  $('startNowBtn').classList.add('hidden');
  joined = false;
  armed = false;
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
  if (!net.connected) { toast('Not connected to the server yet…'); return false; }
  if (!joined) {
    joined = true;
    net.send({ t: 'join', name, color: paint, mode });
    game.setIdentity(name, paint);
  } else {
    net.send({ t: 'name', name, color: paint });
    net.send({ t: 'mode', mode });
  }
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
window.__game = game; // debug hook
