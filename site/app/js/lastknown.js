// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: offline mode, part 1. The last good copy of every feed, kept on this device, and a
// watch on whether the internet can be reached at all.
//
// feeds.js hands every successful answer here (as the raw text it arrived in, so storing it costs no extra
// work). When every route for a feed fails, or the device is offline, feeds.js asks for the saved copy and the
// layer draws from it, marked with its age. Copies live in IndexedDB, so they survive closing the browser or
// the desktop app, and they are only ever read back as JSON or plain text, never as HTML.
//
// "Offline" means more than navigator.onLine: a laptop on a working Wi-Fi network whose internet has gone
// (or a world whose internet has gone) still says it is online. So: three network failures in a row, on at
// least two different hosts, with no success in between, also count as offline. While offline a tiny probe
// checks every 30 seconds, and the first answer from anywhere switches the app back.

const DB = 'gia-offline'; const STORE = 'feeds';
const MAX_ENTRY = 8 * 1024 * 1024; // characters (about bytes for JSON)
const BUDGET = 120 * 1024 * 1024; // all saved copies together; the oldest go first
const MIN_GAP = 3 * 60_000; // save a given feed at most every 3 minutes (flights refresh every few seconds)

// How old a saved copy may be and still be shown. Things that move fast are misleading when old: planes
// 20 minutes on are elsewhere, so their copy is not drawn at all after that. Everything else carries its own
// time stamps (an earthquake's time, a launch's date) and stays useful for weeks.
const FRESH_FOR = [
  [/^(opensky|adsb(?!db)|airplanes|adsbfi)|\/flights\.json$/i, 20 * 60_000],
  [/\/ships\.json$|ais\/v1\/locations/i, 60 * 60_000],
  [/^celestrak|FORMAT=tle|\/tle-[\w-]+\.txt$/i, 14 * 86_400_000], // orbits drift too far after two weeks; the bundled snapshot takes over
  [/^rainviewer/i, 0], // radar frames point at remote image tiles, which are not there offline
];
const DEFAULT_FRESH = 45 * 86_400_000;
export function maxAge(key, id = '') {
  for (const [re, ms] of FRESH_FOR) if (re.test(id) || re.test(key)) return ms;
  return DEFAULT_FRESH;
}

// ------------------------------------------------------------------ IndexedDB
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: 'k' }); s.createIndex('t', 't'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); } // private windows and locked-down browsers: offline copies are simply off
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => (d ? new Promise((resolve) => {
    try {
      const t = d.transaction(STORE, mode); const s = t.objectStore(STORE); let out;
      const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out); t.onerror = () => resolve(undefined); t.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  }) : undefined));
}

const lastSaved = new Map();
let pruneTimer = 0;
/** Keep the raw text of a good answer. Fire and forget; never throws. */
export function remember(key, id, raw, type = 'json') {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_ENTRY || maxAge(key, id) === 0) return;
  const now = Date.now();
  if (now - (lastSaved.get(key) ?? 0) < MIN_GAP) return;
  lastSaved.set(key, now);
  tx('readwrite', (s) => s.put({ k: key, id, type, raw, t: now, n: raw.length }));
  clearTimeout(pruneTimer); pruneTimer = setTimeout(prune, 20_000);
}

/** The saved copy, parsed, or null when there is none young enough. { v, t, id } */
export async function recall(key, id = '') {
  const e = await tx('readonly', (s) => s.get(key));
  if (!e) return null;
  if (Date.now() - e.t > maxAge(key, id || e.id)) return null;
  try { return { v: e.type === 'text' ? e.raw : JSON.parse(e.raw), t: e.t, id: e.id }; } catch { return null; }
}

/** Every saved copy without its contents: [{ k, id, t, n }], newest first. */
export async function listSaved() {
  const all = await tx('readonly', (s) => s.getAll()) ?? [];
  return all.map(({ k, id, t, n }) => ({ k, id, t, n })).sort((a, b) => b.t - a.t);
}
export async function clearSaved() { lastSaved.clear(); await tx('readwrite', (s) => s.clear()); }

async function prune() {
  const all = await listSaved(); let total = all.reduce((s, e) => s + e.n, 0);
  const drop = [];
  for (let i = all.length - 1; i >= 0 && total > BUDGET; i--) { drop.push(all[i].k); total -= all[i].n; }
  // and anything too old to ever be shown again
  for (const e of all) if (Date.now() - e.t > maxAge(e.k, e.id) && !drop.includes(e.k)) drop.push(e.k);
  if (drop.length) await tx('readwrite', (s) => { for (const k of drop) s.delete(k); });
}

// ------------------------------------------------------------------ is the internet there?
const net = { down: typeof navigator !== 'undefined' && navigator.onLine === false, fails: [], probeUrl: '', timer: 0, servedAt: 0, oldest: 0 };
const watchers = new Set();
export const onNet = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
export const isOffline = () => net.down;
function setDown(down) {
  if (net.down === down) return;
  net.down = down; net.fails = [];
  clearInterval(net.timer); net.timer = down ? setInterval(probe, 30_000) : 0;
  for (const fn of watchers) try { fn(down); } catch { /* a listener's problem stays its own */ }
}
/** feeds.js reports each network-level failure (refused, timed out, DNS) with the host it was for. */
export function noteFailure(host) {
  if (net.down) return;
  net.fails.push(host); if (net.fails.length > 6) net.fails.shift();
  const recent = net.fails.slice(-3);
  if (recent.length === 3 && new Set(recent).size >= 2) setDown(true);
}
/** ... and every success: one answer from anywhere means the internet is there. */
export function noteSuccess() { net.fails = []; if (net.down && navigator.onLine !== false) setDown(false); }
/** Where the probe knocks (the live-data branch, set by feeds.js once config.json is read). */
export function setProbe(url) { net.probeUrl = url; }
export async function probe() {
  if (navigator.onLine === false) return false;
  const url = net.probeUrl || 'https://raw.githubusercontent.com/';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    // no-cors: the answer is opaque and thrown away (nothing is read or stored); it only proves the host answered.
    await fetch(`${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    clearTimeout(t); setDown(false); return true;
  } catch { return false; }
}
/** Saved copies served since the app started (or since `since`): the oldest one's time, for the layer notes. */
export function noteServed(t) { net.servedAt = Date.now(); net.oldest = net.oldest ? Math.min(net.oldest, t) : t; }
export const servedSince = (since) => (net.servedAt >= since ? net.oldest : 0);
export const resetServed = () => { net.oldest = 0; net.servedAt = 0; };

if (typeof window !== 'undefined') {
  addEventListener('offline', () => setDown(true));
  addEventListener('online', () => { probe(); });
  if (net.down) net.timer = setInterval(probe, 30_000);
}

export function ago(t) {
  const m = (Date.now() - t) / 60_000;
  return m < 1.5 ? 'just now' : m < 90 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
