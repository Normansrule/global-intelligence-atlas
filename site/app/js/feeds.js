// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: a small fetch layer. Every live feed goes through here, so the UI can show which
// sources are healthy and failures turn into a clear message.
//
// Each request tries these routes in order, and remembers for the session which routes don't work:
//   1. Desktop app: a native request made by the Rust side. It ignores browser CORS rules, so every
//      feed works live.
//   2. Direct browser fetch. It works for sources that send CORS headers (USGS, NASA, CelesTrak and more).
//   3. Optional proxy (config.json "proxy"): a tiny Cloudflare Worker in proxy/ that adds CORS headers.
//   4. The live-data snapshot, a branch rebuilt every ~10 minutes by GitHub Actions
//      (tools/fetch-live.mjs) and served by raw.githubusercontent.com.

const cache = new Map();
const inflight = new Map();
const listeners = new Set();
export const status = {}; // sourceId -> { state: 'loading'|'ok'|'error', at, note, via }

export function onStatus(fn) { listeners.add(fn); }
function setStatus(id, state, note = '', via = '') {
  status[id] = { state, at: new Date(), note, via };
  for (const fn of listeners) fn(id, status[id]);
}

// ------------------------------------------------------------------ environment
export const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
let config = { proxy: '', liveData: 'auto' };
const configReady = fetch(new URL('../config.json', import.meta.url)).then((r) => (r.ok ? r.json() : {})).then((c) => { config = { ...config, ...c }; }).catch(() => {});

export const feedsReady = configReady;
export const liveProxy = () => config.proxy;
/** The settings in config.json (after feedsReady). */
export const appConfig = () => config;

/** Where the live-data branch is served from: config.json, or worked out from a *.github.io address. */
export function liveDataBase() {
  if (config.liveData && config.liveData !== 'auto') return config.liveData.replace(/\/?$/, '/');
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0]; const repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    const fb = config.liveDataFallback ?? '';
    // Pages hostnames are lower-case; prefer the configured URL (with the owner's real capitalisation) when it is the same repo.
    if (fb.toLowerCase().includes(`/${owner}/${repo}/`.toLowerCase())) return fb.replace(/\/?$/, '/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/live-data/`;
  }
  return config.liveDataFallback ? config.liveDataFallback.replace(/\/?$/, '/') : '';
}

/** The same repository's other machine-written branch (e.g. 'aircraft-db'), next to the live-data one. */
export function branchBase(branch) {
  const b = liveDataBase();
  return b ? b.replace(/\/live-data\/$/, `/${branch}/`) : '';
}

// Hosts that failed in this session, with the time they failed. They are retried after 10 minutes.
const blocked = new Map();
const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
const isBlocked = (u) => { const t = blocked.get(hostOf(u)); return t && Date.now() - t < 10 * 60_000; };

async function timed(promise, ms, ctl) {
  let timer; const to = new Promise((_, rej) => { timer = setTimeout(() => { ctl?.abort(); rej(Object.assign(new Error('timed out'), { name: 'AbortError' })); }, ms); });
  try { return await Promise.race([promise, to]); } finally { clearTimeout(timer); }
}
async function viaBrowser(url, type, timeout) {
  const ctl = new AbortController();
  const res = await timed(fetch(url, { signal: ctl.signal }), timeout, ctl);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { http: res.status });
  return type === 'text' ? res.text() : res.json();
}
async function viaDesktop(url, type, timeout) {
  const txt = await timed(window.__TAURI_INTERNALS__.invoke('fetch_text', { url, timeoutMs: timeout }), timeout + 2000);
  return type === 'text' ? txt : JSON.parse(txt);
}

/**
 * Fetch a feed with a timeout, a short-lived memory cache and the fallback routes above.
 * @param {string} id       source id (for the status chips)
 * @param {string} url
 * @param {{type?: 'json'|'text', ttl?: number, timeout?: number, snapshot?: string, proxy?: boolean}} opts
 *   snapshot: a file name in the live-data branch holding the same content
 *   proxy:    false to never send this URL through the proxy
 */
export async function getFeed(id, url, { type = 'json', ttl = 5 * 60_000, timeout = 15_000, snapshot = '', proxy = true } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    await configReady;
    setStatus(id, 'loading');
    const routes = [];
    if (isDesktop) routes.push(['desktop', () => viaDesktop(url, type, timeout)]);
    routes.push(['direct', () => viaBrowser(url, type, timeout)]);
    if (config.proxy && proxy && !isDesktop) routes.push(['proxy', () => viaBrowser(`${config.proxy}${config.proxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`, type, timeout)]);
    const base = liveDataBase();
    if (snapshot && base) routes.push(['snapshot', () => viaBrowser(base + snapshot, type, 20_000)]);
    let lastErr = null;
    for (const [via, run] of routes) {
      const key = via === 'proxy' ? config.proxy : via === 'snapshot' ? base : via === 'desktop' ? `https://desktop.invalid/${hostOf(url)}` : url;
      if (via !== 'snapshot' && isBlocked(key) && routes.length > 1) continue;
      try {
        const v = await run();
        cache.set(url, { t: Date.now(), v, via });
        setStatus(id, 'ok', via === 'snapshot' ? 'from the live-data snapshot (refreshed every few minutes)' : via === 'proxy' ? 'through your proxy' : '', via);
        if (v && typeof v === 'object') try { Object.defineProperty(v, '__via', { value: via, enumerable: false, configurable: true }); } catch { /* frozen */ }
        return v;
      } catch (err) {
        lastErr = err;
        // A TypeError from fetch means the browser refused (CORS) or the network failed. Rate limits (429)
        // and server errors also mean "skip this host for a while".
        if (err.name === 'TypeError' || err.http === 429 || err.http >= 500 || err.http === 403) blocked.set(hostOf(key), Date.now());
      }
    }
    const note = !lastErr ? 'no route available' : lastErr.name === 'AbortError' ? 'timed out' : lastErr.name === 'TypeError' ? 'blocked by the browser (no CORS) or offline' : lastErr.message;
    setStatus(id, 'error', note);
    throw new Error(`${id}: ${note}`);
  })();
  inflight.set(url, job);
  try { return await job; } finally { inflight.delete(url); }
}

/** How the last successful request for this URL was made ('desktop' | 'direct' | 'proxy' | 'snapshot'). */
export const viaOf = (url) => cache.get(url)?.via ?? '';

/** Read a file from the live-data branch (no live equivalent), or from another bot branch with `branch`. */
export async function getSnapshot(id, name, { type = 'json', ttl = 60_000, branch = '' } = {}) {
  await configReady;
  const base = branch ? branchBase(branch) : liveDataBase();
  if (!base) throw new Error('no live-data snapshot is configured for this address');
  const url = base + name;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    try {
      // Desktop: fetch natively too (raw.githubusercontent.com is on the allowlist) so nothing depends on the webview cache.
      const v = isDesktop ? await viaDesktop(url, type, 25_000) : await viaBrowser(url, type, 25_000) /* the CDN caches 5 minutes and sends ETags, so the browser revalidates cheaply instead of re-downloading */;
      cache.set(url, { t: Date.now(), v, via: 'snapshot' });
      setStatus(id, 'ok', 'from the live-data snapshot (refreshed every few minutes)', 'snapshot');
      return v;
    } catch (err) {
      const note = err.http === 404 ? (branch ? `${name} is not on the ${branch} branch yet (run its workflow once)` : `${name} is not in the live-data branch yet (run the “Live data snapshot” workflow once)`) : err.message;
      setStatus(id, 'error', note);
      throw Object.assign(new Error(note), { http: err.http });
    }
  })();
  inflight.set(url, job);
  try { return await job; } finally { inflight.delete(url); }
}

/** Load a file that ships with the site (relative to app/). */
export async function getLocal(path, type = 'json') {
  if (cache.has(path)) return cache.get(path).v;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const v = type === 'text' ? await res.text() : await res.json();
  cache.set(path, { t: Date.now(), v });
  return v;
}
