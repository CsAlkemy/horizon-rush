// Player data — the single door to persistent storage.
//
// Nothing else in the game may touch `localStorage` directly. Portal SDKs
// require progress to go through their own storage API, because on some of the
// platforms they syndicate to the game runs where localStorage is unavailable,
// wiped, or partitioned per session — progress written there is silently lost.
// `scripts/build-web.js` fails the build if a direct call reappears outside
// this file.
//
// The awkward part is that an SDK's storage is asynchronous while every call
// site here reads synchronously, mid-frame, in the middle of a race. Rewriting
// ~20 of those to async would touch the game loop for no gain. So this keeps an
// in-memory cache as the source of truth for reads:
//
//   boot   preload() pulls every known key out of the backend, once, before the
//          lobby renders — the only await in the whole system
//   read   getItem() answers from the cache, synchronously, forever after
//   write  setItem() updates the cache and fires the persist off in the
//          background; nothing waits on it
//
// localStorage stays as a mirror even when an SDK backend is active. It costs
// nothing, and it means a failed or slow SDK write still leaves the player's
// progress on their own machine.

import { TRACKS } from '../shared/track.js';

// Every key the game persists. preload() needs the full list up front, since an
// async backend cannot be consulted lazily from a synchronous getItem().
// The `hr_` prefix predates the rename to NoxRush — see progress.js, these keys
// are the only copy of a player's progression and renaming them wipes it.
export const KEYS = [
  'hr_progress',   // lifetime XP + per-track bests and medals
  'hr_name',
  'hr_paint',
  'hr_map',
  'hr_mode',
  'hr_quality',
  'hr_music',
  'hr_cam',
  'hr_daily',
  ...TRACKS.map((t) => 'hr_ghost_' + t.id),   // best-lap ghost, per direction
];

const cache = new Map();
let backend = null;      // { get(keys) -> Promise<(string|null)[]>, set(key, value) }
let ready = false;
const rereads = [];      // modules that read at import time and must be told to re-read

/** Read straight from localStorage, tolerating private-mode and quota errors. */
function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota or private mode */ }
}

// Seed synchronously at import time. ES modules evaluate their whole graph
// before the entry module's first `await`, so progress.js and audio.js read
// their state before any SDK could possibly have connected. Priming from
// localStorage here means those reads see exactly what they saw before this
// file existed; the SDK then overlays its values in preload() and anyone who
// read early is told to look again via onRefresh().
for (const k of KEYS) cache.set(k, localGet(k));

/**
 * Install an async backend (a portal SDK's storage). Must be called before
 * preload(). Builds without an SDK never call this and run on localStorage.
 */
export function setBackend(b) { backend = b; }

/**
 * Register a callback for "the authoritative values just arrived, re-read".
 * Only fires when a backend actually changed something under a module's feet.
 */
export function onRefresh(fn) { rereads.push(fn); }

/**
 * Fill the cache before the game reads anything. Safe to call twice.
 * Never rejects: a backend that is missing, slow or broken falls back to
 * localStorage rather than blocking the player out of their own save.
 */
export async function preload() {
  if (ready) return;
  ready = true;
  if (!backend) return;            // already seeded from localStorage at import

  let changed = false;
  try {
    const values = await backend.get(KEYS);
    KEYS.forEach((k, i) => {
      const v = values?.[i];
      // An empty slot on the platform means a new player there — keep whatever
      // is on this machine so a returning player does not lose their progress.
      if (v === undefined || v === null) return;
      if (cache.get(k) !== String(v)) changed = true;
      cache.set(k, String(v));
    });
  } catch {
    return;                        // the localStorage seed stands
  }

  if (changed) for (const fn of rereads) { try { fn(); } catch {} }
}

/** Synchronous read. Mirrors the localStorage signature: string or null. */
export function getItem(key) {
  if (cache.has(key)) return cache.get(key);
  const v = localGet(key);         // a key added after KEYS was written
  cache.set(key, v);
  return v;
}

/** Synchronous write. Persists in the background; callers never await. */
export function setItem(key, value) {
  const v = String(value);
  cache.set(key, v);
  localSet(key, v);
  if (backend) {
    try { Promise.resolve(backend.set(key, v)).catch(() => {}); } catch { /* ignore */ }
  }
}

export function isReady() { return ready; }
