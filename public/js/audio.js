// Audio: synthesized engine/wind/skid beds plus recorded car foley one-shots
// from public/audio (see public/audio/README.md for the file mapping).
let ctx = null, master = null, muted = false;
let engine = null, wind = null, skid = null;

// ---------------------------------------------------------------- sample bank
const SAMPLES = {
  ignition:   'ignition.wav',
  impact:     'impact.wav',
  scrape:     'scrape.wav',
  click:      'click.wav',
  gridUp:     'grid-up.wav',
  panel:      'panel.wav',
  reset:      'reset.wav',
  engineLow:  'engine-low.wav',
  engineHigh: 'engine-high.wav',
};

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
  fetch('/audio/' + file)
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

  // Noise buffer shared by wind + skid.
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

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
  muted = !muted;
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

export const sfx = {
  count: () => blip(440, 0.14, 'square', 0.25),
  go: () => blip(880, 0.5, 'square', 0.3),
  checkpoint: () => { blip(700, 0.08, 'sine', 0.3); blip(1050, 0.12, 'sine', 0.3, 0.07); },
  skill: () => blip(1250, 0.1, 'triangle', 0.22),
  bank: () => { blip(880, 0.1, 'triangle', 0.3); blip(1174, 0.1, 'triangle', 0.3, 0.08); blip(1568, 0.16, 'triangle', 0.3, 0.16); },
  lost: () => blip(190, 0.3, 'sawtooth', 0.25),
  finish: () => { blip(659, 0.12, 'triangle', 0.3); blip(784, 0.12, 'triangle', 0.3, 0.1); blip(988, 0.12, 'triangle', 0.3, 0.2); blip(1319, 0.3, 'triangle', 0.35, 0.3); },

  // --- recorded car foley ---------------------------------------------------
  // Engine crank when the player fires up on the READY button.
  ignition: () => playSample('ignition', { gain: 0.95 }),

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
    playSample('scrape', { gain: 0.3, rate: 1.35 + Math.random() * 0.25, offset: 0.55, duration: 0.75 });
  },

  // A remote player's horn — a short toot, since we only get the event.
  remoteHorn: () => {
    const h = hornNodes();
    if (!h || !ctx) return;
    const t = ctx.currentTime;
    h.gain.gain.setTargetAtTime(0.13, t, 0.01);
    h.gain.gain.setTargetAtTime(0, t + 0.45, 0.04);
  },

  click: () => playSample('click', { gain: 0.4, rate: 1.2 }),
  gridUp: () => playSample('gridUp', { gain: 0.5, rate: 1.1 }),
  panel: () => playSample('panel', { gain: 0.45, offset: 0.15 }),
  // Mechanism whirr for a track reset — the meaty middle of a long recording.
  reset: () => playSample('reset', { gain: 0.6, rate: 1.5, offset: 2.3, duration: 1.3 }),
};
