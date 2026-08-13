// Build-time switches.
//
// The static build (scripts/build-web.js) writes a small classic script that
// sets `window.__BUILD__` before the module graph evaluates. The LAN build ships
// no such script, so everything here falls back to the full-featured defaults
// and `npm start` behaves exactly as it always has.
//
// Both flags also have a query-string override so a portal build can be
// exercised against the dev server without rebuilding:
//   ?portal=1   pretend this is a portal build (hides FRIENDS/LAN, no server)
//   ?offline=1  skip the socket only (predates this file, still honoured)
const B = (typeof window !== 'undefined' && window.__BUILD__) || {};
const q = typeof location !== 'undefined'
  ? new URLSearchParams(location.search) : new URLSearchParams();

// A portal build is hosted statically inside an iframe: there is no server to
// talk to, so FRIENDS, party codes, server records and the LAN address hints are
// all dead weight and must be hidden rather than shown broken.
export const PORTAL = B.portal === true || q.has('portal');

// False when the build deliberately ships without the recorded foley one-shots.
// audio.js then skips fetching them, so a portal build makes no requests for
// files that were left out — every cue has a synth stand-in regardless.
export const HAS_FOLEY = B.foley !== false;
