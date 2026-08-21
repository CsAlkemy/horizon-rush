// Portal SDK layer. One door, so the game never names a portal.
//
// Only the Playgama build loads a bridge (scripts/build-web.js --playgama
// injects their script tag). Every other build — LAN, and the CrazyGames portal
// bundle — gets the no-op path below and stays completely self-contained, which
// is what `npm run check` enforces and what CrazyGames QA passed on.
//
// Keeping this in one file matters commercially, not just tidily: CrazyGames
// will not pay revenue share on a game carrying another portal's branding, so
// the two bundles can never be the same bytes.
//
// https://wiki.playgama.com/playgama/bridge-sdk/api

import * as store from './store.js';

const B = (typeof window !== 'undefined' && window.__BUILD__) || {};
export const SDK = B.sdk || 'none';

const bridge = () => (typeof window !== 'undefined' ? window.bridge : undefined);

let started = false;     // game_ready already sent
let adInFlight = false;

/**
 * Bring the SDK up and prime the player store. Awaited once, before the lobby
 * renders. Never rejects — a portal SDK that fails to load must not cost the
 * player their game, so every path falls through to local storage.
 */
export async function initSdk() {
  if (SDK !== 'playgama') {
    await store.preload();
    return;
  }

  const b = bridge();
  if (!b) {                        // script blocked, offline, adblock
    console.warn('[sdk] playgama bridge missing — running on local storage');
    await store.preload();
    return;
  }

  try {
    await b.initialize();
    // Their storage is async and keyed one value at a time; store.preload()
    // wants the whole set up front, so the adapter is shaped to match.
    store.setBackend({
      get: (keys) => b.storage.get(keys),
      set: (key, value) => b.storage.set(key, value),
    });
  } catch (e) {
    console.warn('[sdk] playgama initialize failed — running on local storage', e);
  }

  await store.preload();
  bindPlatformEvents(b);
}

/**
 * The platform pauses the game for its own reasons — an ad opening, the player
 * switching tabs. Both must silence audio, or an interstitial plays over a
 * running engine loop.
 */
function bindPlatformEvents(b) {
  try {
    b.platform.on('pause', (paused) => emit('pause', !!paused));
    b.platform.on('audio', (state) => emit('audio', state !== 'off' && state !== false));
  } catch (e) {
    console.warn('[sdk] platform events unavailable', e);
  }
}

const listeners = { pause: [], audio: [] };
function emit(name, value) { for (const fn of listeners[name] || []) { try { fn(value); } catch {} } }

/** Subscribe to platform pause/audio. No-op on builds without an SDK. */
export function onPlatform(name, fn) {
  if (listeners[name]) listeners[name].push(fn);
}

/** The platform's UI language, e.g. 'en'. Null when there is no SDK. */
export function platformLanguage() {
  try { return bridge()?.platform?.language ?? null; } catch { return null; }
}

/**
 * Tell the platform the first playable frame is up. Until this lands the
 * platform may keep showing its own loader over the game. Idempotent.
 */
export function gameReady() {
  if (started || SDK !== 'playgama') { started = true; return; }
  started = true;
  try { bridge()?.platform?.sendMessage('game_ready'); } catch (e) { console.warn('[sdk] game_ready failed', e); }
}

/**
 * Interstitial at a natural break — the results screen, never mid-race.
 * Required for revenue share: platforms expect breakpoint interstitials, and
 * without them the game may not qualify at all.
 *
 * Resolves when the ad is done (or immediately when there is nothing to show)
 * so the caller can resume audio afterwards.
 */
export async function showInterstitial() {
  if (SDK !== 'playgama' || adInFlight) return;
  const b = bridge();
  if (!b?.advertisement?.showInterstitial) return;
  adInFlight = true;
  try {
    await b.advertisement.showInterstitial();
  } catch (e) {
    console.warn('[sdk] interstitial failed', e);
  } finally {
    adInFlight = false;
  }
}
