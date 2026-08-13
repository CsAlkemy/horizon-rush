// Audio: synthesized engine/wind/skid beds plus recorded car foley one-shots
// from public/audio (see public/audio/README.md for the file mapping), and a
// background-music channel (synthesized lofi, or a user-supplied music.mp3).
import { HAS_FOLEY } from './build.js';
import * as store from './store.js';

let ctx = null, master = null, muted = false;
let engine = null, wind = null, skid = null;
let noiseBuf = null;   // shared white noise (wind/skid/drums/vinyl)

// ---------------------------------------------------------------- sample bank
// Engine loops always ship (Pixabay Content License). The foley one-shots are
// split out because a build can legitimately leave them behind — every cue that
// uses them has a synth stand-in, so `HAS_FOLEY: false` costs nothing but the
// recordings, and skipping the fetches keeps a static build from requesting
// files that were never copied.
const ENGINE_SAMPLES = {
  engineLow:  'engine-low.wav',
  engineHigh: 'engine-high.wav',
};
const FOLEY_SAMPLES = {
  ignition:   'ignition.wav',
  impact:     'impact.wav',
  scrape:     'scrape.wav',
  click:      'click.wav',
  gridUp:     'grid-up.wav',
  panel:      'panel.wav',
  reset:      'reset.wav',
};
const SAMPLES = HAS_FOLEY
  ? { ...FOLEY_SAMPLES, ...ENGINE_SAMPLES }
  : { ...ENGINE_SAMPLES };

// Measured fundamentals of the two engine loops (see public/audio/README.md).
// Playback rate is derived from these, so they must match the shipped files.
const F0_LOW = 70.3;
const F0_HIGH = 88.7;
let sampleEngine = null;
const encoded = {};   // name -> ArrayBuffer, fetched before any AudioContext exists
const decoded = {};   // name -> AudioBuffer, once a context is available

// Fetching needs no AudioContext, so start immediately at page load; decoding
// happens as soon as the first user gesture lets us create the context.
for (const [name, file] of Object.entries(SAMPLES)) {
  fetch('audio/' + file)
    .then(r => (r.ok ? r.arrayBuffer() : null))
    .then(a => { if (a) { encoded[name] = a; if (ctx) decodeOne(name); } })
    .catch(() => {});
}

function decodeOne(name) {
  const a = encoded[name];
  if (!a || decoded[name] || !ctx) return;
  // decodeAudioData detaches the buffer, so hand it a copy.
  ctx.decodeAudioData(a.slice(0), (b) => {
    decoded[name] = b;
    if (name === 'engineLow' || name === 'engineHigh') buildSampleEngine();
  }, () => {});
}

// Recorded engine: two looping layers (low and high rev) crossfaded by revs,
// each pitched with playbackRate. Two layers keep the stretch per layer under
// ~1.7x — a single loop stretched across the whole range sounds thin up top.
function buildSampleEngine() {
  if (sampleEngine || !ctx || !decoded.engineLow || !decoded.engineHigh) return;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 0.5;
  const out = ctx.createGain();
  out.gain.value = 0;
  lp.connect(out); out.connect(master);

  const layer = (buffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g); g.connect(lp);
    src.start();
    return { src, g };
  };

  sampleEngine = { low: layer(decoded.engineLow), high: layer(decoded.engineHigh), lp, out };
  if (engine) engine.gain.gain.value = 0;   // retire the oscillator bed
}

export function playSample(name, { gain = 1, rate = 1, offset = 0, duration } = {}) {
  const b = decoded[name];
  // Muting is handled by the master gain, so a muted context still counts as a
  // success here — otherwise callers would fall back to their synth stand-ins.
  if (!ctx || !b) return false;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(master);
  const off = Math.min(offset, Math.max(0, b.duration - 0.05));
  if (duration != null) src.start(ctx.currentTime, off, duration);
  else src.start(ctx.currentTime, off);
  return true;
}

// Arm audio on the first gesture anywhere, so the ignition sample is already
// decoded by the time the player presses READY.
const arm = () => {
  initAudio();
  window.removeEventListener('pointerdown', arm);
  window.removeEventListener('keydown', arm);
};
window.addEventListener('pointerdown', arm);
window.addEventListener('keydown', arm);

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // Engine: two detuned saws + sub sine through a lowpass.
  const eg = ctx.createGain(); eg.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.2;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 61.5;
  const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 30;
  const g3 = ctx.createGain(); g3.gain.value = 0.6;
  o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp);
  lp.connect(eg); eg.connect(master);
  o1.start(); o2.start(); o3.start();
  engine = { o1, o2, o3, gain: eg, lp };

  // Noise buffer shared by wind + skid (and the music's drums/vinyl).
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;

  const wsrc = ctx.createBufferSource(); wsrc.buffer = buf; wsrc.loop = true;
  const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 420;
  const wg = ctx.createGain(); wg.gain.value = 0;
  wsrc.connect(wlp); wlp.connect(wg); wg.connect(master); wsrc.start();
  wind = { gain: wg, lp: wlp };

  const ssrc = ctx.createBufferSource(); ssrc.buffer = buf; ssrc.loop = true; ssrc.playbackRate.value = 0.7;
  const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 900; sbp.Q.value = 1.6;
  const sg = ctx.createGain(); sg.gain.value = 0;
  ssrc.connect(sbp); sbp.connect(sg); sg.connect(master); ssrc.start();
  skid = { gain: sg };

  window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggleMute(); });

  // Decode anything that finished downloading before the context existed.
  for (const name of Object.keys(encoded)) decodeOne(name);

  startMusic();
}

// ---------------------------------------------------------------- music
// Background radio. If /audio/music.mp3 exists it plays that (drop in your own
// properly licensed track); otherwise an endless lofi loop is synthesized in
// code — nothing shipped, nothing to license. Routed through `master`, so the
// M key mutes it along with everything else.
const MUSIC_VOL = { lobby: 0.30, race: 0.16 };
let music = null;
let musicOn = true;
try { musicOn = store.getItem('hr_music') !== 'off'; } catch {}
// Same reason as progress.js: a portal build's saved preference arrives after
// this module evaluates.
store.onRefresh(() => { try { musicOn = store.getItem('hr_music') !== 'off'; } catch {} });
let musicScene = 'lobby';
const musicTarget = () => (musicOn ? MUSIC_VOL[musicScene] : 0);

export function setMusicScene(scene) {
  musicScene = scene === 'race' ? 'race' : 'lobby';
  if (music && ctx) music.gain.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 0.9);
}

export function setMusicOn(on) {
  musicOn = !!on;
  try { store.setItem('hr_music', musicOn ? 'on' : 'off'); } catch {}
  if (music && ctx) music.gain.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 0.4);
  else if (musicOn) startMusic();
}

export function musicStatus() {
  return { on: musicOn, mode: music ? music.mode : 'none', scene: musicScene, bars: music ? music.bars || 0 : 0 };
}

async function startMusic() {
  if (music || !ctx || !musicOn) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  // Radio tone: roll the top off for warmth, keep the low end tidy.
  const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 4200; warm.Q.value = 0.4;
  const tidy = ctx.createBiquadFilter(); tidy.type = 'highpass'; tidy.frequency.value = 46;
  gain.connect(warm); warm.connect(tidy); tidy.connect(master);
  music = { gain, mode: 'lofi', bars: 0 };

  try {
    const head = await fetch('audio/music.mp3', { method: 'HEAD' });
    if (head.ok) {
      const el = new Audio('audio/music.mp3');
      el.loop = true;
      ctx.createMediaElementSource(el).connect(gain);
      await el.play().catch(() => {});
      music.mode = 'file';
      music.el = el;
      gain.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 1.2);
      return;
    }
  } catch {}

  startLofi(gain);
  gain.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 1.2);
}

// Synthesized lofi: swung boom-bap drums, a soft electric piano comping ninth
// chords, a round sub bass, and a vinyl-crackle bed. Events are scheduled a
// bar ahead on a timer, so the loop is endless and sample-accurate.
function startLofi(out) {
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const BEAT = 60 / 76;         // 76 BPM
  const SWING = 0.62;           // off-8ths land late — the lofi lean
  const CHORDS = [              // ii–V–I–vi in C, soft ninth voicings
    { keys: [65, 69, 72, 76], bass: 38 },   // Dm9
    { keys: [65, 69, 71, 74], bass: 43 },   // G13
    { keys: [64, 67, 71, 74], bass: 36 },   // Cmaj9
    { keys: [64, 67, 72, 76], bass: 33 },   // Am9
  ];

  const ep = (note, t, vel) => {
    const f = midi(note);
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.004;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;   // faint bell double
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.7);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
    o1.start(t); o2.start(t); o1.stop(t + 1.8); o2.stop(t + 1.8);
  };
  const bass = (note, t, vel) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.95);
  };
  const kick = (t, vel) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.25);
  };
  const noiseHit = (t, dur, type, freq, vel, q = 1) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  };
  const snare = (t, vel) => {
    noiseHit(t, 0.16, 'bandpass', 1750, vel * 0.24, 0.8);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 185;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.1);
  };
  const hat = (t, vel) => noiseHit(t, 0.045, 'highpass', 6800, vel * 0.11);

  // vinyl bed: constant hiss + the occasional pop
  const hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true; hiss.playbackRate.value = 0.42;
  const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 3400; hf.Q.value = 0.5;
  const hg = ctx.createGain(); hg.gain.value = 0.012;
  hiss.connect(hf); hf.connect(hg); hg.connect(out); hiss.start();

  let bar = 0;
  let nextBar = ctx.currentTime + 0.15;
  const human = () => (Math.random() - 0.5) * 0.016;
  const tick = () => {
    if (!music || music.mode !== 'lofi' || !musicOn) { nextBar = Math.max(nextBar, ctx.currentTime + 0.1); return; }
    while (nextBar < ctx.currentTime + 1.0) {
      const t0 = nextBar;
      const ch = CHORDS[bar % 4];
      // drums: boom-bap — kick 1 (+ pickup), snare on 2 and 4, swung hats
      kick(t0 + human(), 0.95);
      if (bar % 2 === 0) kick(t0 + BEAT * 1.75 + human(), 0.5);
      kick(t0 + BEAT * 2.5 + human(), 0.72);
      snare(t0 + BEAT + human(), 0.8);
      snare(t0 + BEAT * 3 + human(), 0.88);
      for (let e = 0; e < 8; e++) {
        const tb = t0 + Math.floor(e / 2) * BEAT + (e % 2 ? BEAT * SWING : 0);
        hat(tb + human(), e % 2 ? 0.32 : 0.6);
      }
      // EP comp: rolled chord on 1; a softer push on the '&' of 2 every other bar
      ch.keys.forEach((k, i) => ep(k, t0 + human() + i * 0.014, 0.5));
      if (bar % 2 === 1) ch.keys.forEach((k, i) => ep(k, t0 + BEAT * (1 + SWING) + human() + i * 0.014, 0.3));
      // bass: root on 1, a walk note into the next bar
      bass(ch.bass, t0 + human(), 0.9);
      bass(ch.bass + (bar % 4 === 3 ? 5 : 7), t0 + BEAT * 2.5 + human(), 0.45);
      // a vinyl pop somewhere in the bar, sometimes
      if (Math.random() < 0.6) noiseHit(t0 + Math.random() * BEAT * 4, 0.02, 'highpass', 2800, 0.045);
      bar++;
      music.bars = bar;
      nextBar += BEAT * 4;
    }
  };
  music.timer = setInterval(tick, 200);
  tick();
}

// Diagnostics: reports whether the recorded engine loops are driving the sound
// or the game fell back to the synthesised bed (e.g. missing audio files).
export function engineStatus() {
  if (!ctx) return { context: 'none', mode: 'idle' };
  if (!sampleEngine) return { context: ctx.state, mode: 'synth' };
  return {
    context: ctx.state,
    mode: 'recorded',
    rateLow: +sampleEngine.low.src.playbackRate.value.toFixed(3),
    rateHigh: +sampleEngine.high.src.playbackRate.value.toFixed(3),
    mixLow: +sampleEngine.low.g.gain.value.toFixed(3),
    mixHigh: +sampleEngine.high.g.gain.value.toFixed(3),
    volume: +sampleEngine.out.gain.value.toFixed(3),
    cutoffHz: Math.round(sampleEngine.lp.frequency.value),
  };
}

export function toggleMute() {
  return setMuted(!muted);
}

// Explicit mute, for callers that know which way they want it — the portal SDK
// silences the game while an interstitial plays or the tab is backgrounded, and
// a toggle would invert the state instead of restoring it.
export function setMuted(on) {
  muted = !!on;
  if (master) master.gain.value = muted ? 0 : 0.55;
  return muted;
}

// rpm 0..1 within gear, speed m/s, throttle 0..1, slip rad
export function updateEngine(rpm, speed, throttle, slip, dt) {
  if (!ctx || ctx.state === 'suspended') return;
  const t = ctx.currentTime;

  if (sampleEngine) {
    // Fundamental we want to hear: idles near 48 Hz, tops out near 150 Hz.
    const f = 48 + rpm * 80 + Math.min(speed, 85) * 0.28;
    // Hand over from the low loop to the high loop across 80..100 Hz so each
    // layer stays close to its recorded pitch.
    const w = Math.max(0, Math.min(1, (f - 80) / 20));
    const rateLow = Math.max(0.6, Math.min(1.5, f / F0_LOW));
    const rateHigh = Math.max(0.8, Math.min(1.9, f / F0_HIGH));
    sampleEngine.low.src.playbackRate.setTargetAtTime(rateLow, t, 0.04);
    sampleEngine.high.src.playbackRate.setTargetAtTime(rateHigh, t, 0.04);
    sampleEngine.low.g.gain.setTargetAtTime(1 - w, t, 0.05);
    sampleEngine.high.g.gain.setTargetAtTime(w, t, 0.05);
    const vol = 0.12 + throttle * 0.16 + Math.min(speed / 90, 1) * 0.08;
    sampleEngine.out.gain.setTargetAtTime(vol, t, 0.06);
    // Opens up under load, so lifting off audibly closes the engine down.
    sampleEngine.lp.frequency.setTargetAtTime(900 + throttle * 2600 + rpm * 1200, t, 0.06);
  } else {
    const base = 58 + rpm * 165 + speed * 0.55;
    engine.o1.frequency.setTargetAtTime(base, t, 0.03);
    engine.o2.frequency.setTargetAtTime(base * 1.013, t, 0.03);
    engine.o3.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    const vol = 0.05 + throttle * 0.13 + Math.min(speed / 90, 1) * 0.06;
    engine.gain.gain.setTargetAtTime(vol, t, 0.05);
    engine.lp.frequency.setTargetAtTime(600 + rpm * 1900 + throttle * 700, t, 0.06);
  }

  wind.gain.gain.setTargetAtTime(Math.min(speed / 85, 1) ** 2 * 0.30, t, 0.1);
  wind.lp.frequency.setTargetAtTime(300 + speed * 14, t, 0.1);

  const sk = Math.min(1, Math.max(0, (Math.abs(slip) - 0.18) * 2.2)) * Math.min(speed / 22, 1);
  skid.gain.gain.setTargetAtTime(sk * 0.22, t, 0.05);
}

function blip(freq, dur = 0.09, type = 'sine', vol = 0.35, when = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
  o.connect(g); g.connect(master);
  o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.02);
}

// Synthesized noise burst — fallback for impacts if the sample is unavailable.
function crashNoise(strength = 1) {
  if (!ctx) return;
  const len = ctx.sampleRate * 0.25;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  const g = ctx.createGain(); g.gain.value = 0.5 * strength;
  s.connect(f); f.connect(g); g.connect(master); s.start();
}

// Synthesized motor whirr — stand-in for the recorded window/trunk/roof
// mechanisms. A sawtooth "armature" tone sweeping between two pitches with a
// band of noise riding along on the same sweep, so it reads as a small electric
// motor spinning up rather than as a musical note.
function motorWhirr({ dur = 0.5, from = 180, to = 220, vol = 0.16, cutoff = 1400 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.8;
  g.connect(lp); lp.connect(master);

  // Spin-up and spin-down are short but not instant — a motor has inertia.
  const hold = Math.max(0.05, dur - 0.06);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.04, hold));
  g.gain.setValueAtTime(vol, t + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(from, t);
  o.frequency.linearRampToValueAtTime(to, t + dur);
  const og = ctx.createGain(); og.gain.value = 0.5;
  o.connect(og); og.connect(g);
  o.start(t); o.stop(t + dur + 0.02);

  // Noise band tracks the pitch six octaves-ish up and supplies the gear
  // rattle a bare oscillator has no room for.
  if (noiseBuf) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true; n.playbackRate.value = 1.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(from * 6, t);
    bp.frequency.linearRampToValueAtTime(to * 6, t + dur);
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    n.connect(bp); bp.connect(ng); ng.connect(g);
    n.start(t); n.stop(t + dur + 0.02);
  }
}

// Synthesized engine crank — fallback for the ignition sample. Starter motor
// whirr, three compression chugs while it turns over, then it catches; the
// recorded/synth engine bed takes over from there.
function crankNoise() {
  if (!ctx) return;
  motorWhirr({ dur: 0.72, from: 240, to: 300, vol: 0.12, cutoff: 2400 });
  for (let i = 0; i < 3; i++) blip(68 + i * 7, 0.11, 'sawtooth', 0.26, 0.14 + i * 0.18);
  blip(96, 0.3, 'sawtooth', 0.3, 0.7);   // the catch
}

// Synthesized metal-on-metal scrape — fallback for the scrape sample. A narrow
// bandpass on the shared noise bed rings like sheet metal; sweeping it up gives
// the sense of sliding along a barrier.
function scrapeNoise() {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime, dur = 0.5;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf; n.loop = true; n.playbackRate.value = 1.8;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 3.2;
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.linearRampToValueAtTime(3400, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp); bp.connect(g); g.connect(master);
  n.start(t); n.stop(t + dur + 0.02);
}

let lastScrapeAt = 0;

// Two-tone horn: a real car horn is two detuned reeds a minor third apart, with
// enough harmonics to cut through. Held down for as long as the key is.
let horn = null;
function hornNodes() {
  if (horn || !ctx) return horn;
  const g = ctx.createGain();
  g.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3200;
  g.connect(lp); lp.connect(master);
  const oscs = [];
  for (const f of [440, 523.25, 880, 1046.5]) {
    const o = ctx.createOscillator();
    o.type = f < 800 ? 'sawtooth' : 'square';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = f < 800 ? 0.5 : 0.12;   // upper pair adds bite only
    o.connect(og); og.connect(g);
    o.start();
    oscs.push(o);
  }
  horn = { gain: g, oscs };
  return horn;
}

// Called every frame with whether the horn key is held.
export function setHorn(on) {
  const h = hornNodes();
  if (!h || !ctx) return;
  h.gain.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, on ? 0.008 : 0.03);
}

// Nitro burn: a filtered noise whoosh that opens up while the boost is held,
// built once like the horn and driven per-frame by setNitro.
let nitroSnd = null;
function nitroNodes() {
  if (nitroSnd || !ctx || !noiseBuf) return nitroSnd;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 1.5;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start();
  nitroSnd = { gain: g, bp };
  return nitroSnd;
}

// Called every frame with whether nitro is burning.
export function setNitro(on) {
  const n = nitroNodes();
  if (!n || !ctx) return;
  const t = ctx.currentTime;
  n.gain.gain.setTargetAtTime(on ? 0.24 : 0, t, on ? 0.03 : 0.09);
  n.bp.frequency.setTargetAtTime(on ? 2500 : 800, t, 0.14);
}

export const sfx = {
  count: () => blip(440, 0.14, 'square', 0.25),
  go: () => blip(880, 0.5, 'square', 0.3),
  checkpoint: () => { blip(700, 0.08, 'sine', 0.3); blip(1050, 0.12, 'sine', 0.3, 0.07); },
  skill: () => blip(1250, 0.1, 'triangle', 0.22),
  nitro: () => { blip(920, 0.09, 'triangle', 0.3); blip(1380, 0.14, 'triangle', 0.3, 0.07); },
  bank: () => { blip(880, 0.1, 'triangle', 0.3); blip(1174, 0.1, 'triangle', 0.3, 0.08); blip(1568, 0.16, 'triangle', 0.3, 0.16); },
  lost: () => blip(190, 0.3, 'sawtooth', 0.25),
  finish: () => { blip(659, 0.12, 'triangle', 0.3); blip(784, 0.12, 'triangle', 0.3, 0.1); blip(988, 0.12, 'triangle', 0.3, 0.2); blip(1319, 0.3, 'triangle', 0.35, 0.3); },

  // --- recorded car foley ---------------------------------------------------
  // Every entry here prefers its recording but falls back to a synth
  // stand-in, so the whole `public/audio/*.wav` foley set can be deleted (for
  // licensing or download size) without any cue going silent.

  // Engine crank when the player fires up on the READY button.
  ignition: () => { if (!playSample('ignition', { gain: 0.95 })) crankNoise(); },

  // Body thud on contact. Harder hits are louder and pitched down.
  impact: (strength = 0.5) => {
    const s = Math.max(0.12, Math.min(1, strength));
    const ok = playSample('impact', {
      gain: 0.35 + s * 0.8,
      rate: 1.2 - s * 0.35 + (Math.random() - 0.5) * 0.08,
    });
    if (!ok) crashNoise(s);
  },

  // Metal-on-metal while sliding along the guardrail; rate-limited so it does
  // not retrigger every frame of a long scrape.
  scrape: () => {
    if (!ctx) return;
    if (ctx.currentTime - lastScrapeAt < 0.5) return;
    lastScrapeAt = ctx.currentTime;
    // Rate jitter only — scripts/install-foley.mjs ships this pre-trimmed, so
    // there is no quiet run-in to skip past with an offset.
    const ok = playSample('scrape', { gain: 0.3, rate: 1.0 + Math.random() * 0.3 });
    if (!ok) scrapeNoise();
  },

  // A remote player's horn — a short toot, since we only get the event.
  remoteHorn: () => {
    const h = hornNodes();
    if (!h || !ctx) return;
    const t = ctx.currentTime;
    h.gain.gain.setTargetAtTime(0.13, t, 0.01);
    h.gain.gain.setTargetAtTime(0, t + 0.45, 0.04);
  },

  click: () => {
    if (!playSample('click', { gain: 0.4, rate: 1.2 })) blip(1200, 0.035, 'square', 0.16);
  },

  // Lobby closes and the grid forms — a mechanism closing, so the whirr rises.
  gridUp: () => {
    if (!playSample('gridUp', { gain: 0.5, rate: 1.1 })) {
      motorWhirr({ dur: 0.6, from: 150, to: 260, vol: 0.15 });
    }
  },

  // Results panel appears — same mechanism running the other way, so the
  // whirr falls; it reads as settling rather than starting.
  panel: () => {
    if (!playSample('panel', { gain: 0.45 })) {
      motorWhirr({ dur: 0.5, from: 240, to: 160, vol: 0.13 });
    }
  },

  // Pressing R to drop back onto the track.
  reset: () => {
    const ok = playSample('reset', { gain: 0.6, rate: 1.1 });
    if (!ok) motorWhirr({ dur: 0.7, from: 200, to: 285, vol: 0.15, cutoff: 1800 });
  },
};
