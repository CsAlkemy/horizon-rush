// Driver progression, kept in the player store: lifetime XP + level, per-track
// personal bests and medals, and the paint-unlock rules. Pure data/logic — no
// DOM, no three.js — so the game and the lobby UI both lean on it.

// The `hr_` prefix predates the rename to NoxRush and is deliberately kept:
// these keys are the only copy of a player's level, XP, personal bests and
// medals, so renaming them to `rb_` would silently wipe every existing player's
// progression. Same reasoning for the other hr_* keys (name, paint, map, mode,
// cam, quality, ghost, daily, music). Change them only with a migration step.
import * as store from './store.js';

const KEY = 'hr_progress';

function load() {
  try {
    const p = JSON.parse(store.getItem(KEY));
    if (p && typeof p === 'object') return { xp: Math.max(0, p.xp | 0), pbs: p.pbs || {} };
  } catch {}
  return { xp: 0, pbs: {} };   // pbs[trackId] = { lap: ms, race: ms, medal: 'gold'|'silver'|'bronze' }
}
let state = load();
// On a portal build the authoritative save lives with the platform and arrives
// after this module has already evaluated, so re-read when it lands. Without
// this a returning player would see level 1 until their next reload.
store.onRefresh(() => { state = load(); });
function save() {
  try { store.setItem(KEY, JSON.stringify(state)); } catch {}
}

// Level curve: quadratic, so the first level-up lands in a race or two and
// the grind stretches. L1 at 0, L2 at 900, L3 at 3,600, L4 at 8,100 …
export function levelForXP(xp) { return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 900)); }
export function xpForLevel(level) { return 900 * (level - 1) * (level - 1); }

export function getProgress() {
  return { xp: state.xp, level: levelForXP(state.xp), pbs: state.pbs };
}

export function addXP(amount) {
  const before = levelForXP(state.xp);
  state.xp += Math.max(0, Math.round(amount));
  save();
  const level = levelForXP(state.xp);
  return { xp: state.xp, level, leveled: level > before };
}

const MEDAL_XP = { bronze: 250, silver: 500, gold: 1000 };
const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };

export function medalFor(lapMs, medals) {
  if (!medals || !lapMs || lapMs < 5000) return null;
  if (lapMs <= medals.gold) return 'gold';
  if (lapMs <= medals.silver) return 'silver';
  if (lapMs <= medals.bronze) return 'bronze';
  return null;
}

// Record a finished race. Returns what changed so the results screen can brag:
// { lapPB, racePB, medal, newMedal, medalXP }
export function recordRace(trackId, lapMs, raceMs, medals) {
  const pb = state.pbs[trackId] || (state.pbs[trackId] = {});
  const out = { lapPB: false, racePB: false, medal: null, newMedal: false, medalXP: 0 };
  if (lapMs && lapMs > 5000 && (!pb.lap || lapMs < pb.lap)) { pb.lap = Math.round(lapMs); out.lapPB = true; }
  if (raceMs && raceMs > 5000 && (!pb.race || raceMs < pb.race)) { pb.race = Math.round(raceMs); out.racePB = true; }
  const m = medalFor(lapMs, medals);
  out.medal = m;
  if (m && MEDAL_RANK[m] > (MEDAL_RANK[pb.medal] || 0)) {
    // Award the DIFFERENCE up the tiers, so gold is worth the same total
    // whether you climbed through silver first or jumped straight to it.
    out.medalXP = MEDAL_XP[m] - (MEDAL_XP[pb.medal] || 0);
    pb.medal = m;
    out.newMedal = true;
  }
  save();
  return out;
}

export function pbFor(trackId) { return state.pbs[trackId] || null; }

// Paints: the first four are free; each one after unlocks a level.
// index 4 -> level 2, index 5 -> level 3, … index 9 -> level 7.
export function paintLockLevel(index) { return index < 4 ? 1 : index - 2; }
export function paintUnlocked(index, level = levelForXP(state.xp)) {
  return level >= paintLockLevel(index);
}
