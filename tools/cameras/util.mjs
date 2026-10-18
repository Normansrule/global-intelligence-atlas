// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas (GIA) — shared helpers for the camera source modules in tools/cameras/.
// Each module exports `sources`: [{ key, name, run }] where run() resolves to camera rows
//   [id, name, lat, lng, imageUrl, streamUrl, 0, area]
// (fetch-cameras.mjs replaces the 0 with the source's position). Requests identify the atlas honestly: no spoofed
// browser fingerprints or forwarded-for addresses, and a source that refuses us is reported, not worked around.
export const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.11 (+https://github.com/Normansrule/global-intelligence-atlas; educational map)' };
export async function get(url, type = 'json', init = {}) {
  const headers = { ...UA, Accept: type === 'json' ? 'application/json' : type === 'text' ? 'application/xml, text/xml, text/html, */*' : '*/*', ...(init.headers ?? {}) };
  const r = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(init.timeout ?? 60_000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}: ${body.slice(0, 160)}`);
  if (type !== 'json') return body;
  try { return JSON.parse(body); } catch { throw new Error(`${url} → not JSON: ${body.slice(0, 160)}`); }
}
export const round = (x) => Math.round(x * 1e5) / 1e5;
export const ok = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
/** Only HTTPS media on a named host: an https page cannot show http images, and bare IP addresses are never kept. */
export const https = (u) => { if (!u) return ''; const s = String(u).trim().replace(/^http:\/\//i, 'https://'); try { const h = new URL(s).hostname; return /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') ? '' : s; } catch { return ''; } };
export const row = (id, name, lat, lng, img, stream = '', area = '') => [String(id), String(name || 'Camera').trim().slice(0, 140), round(+lat), round(+lng), https(img), https(stream), 0, area];
/** Run tasks with at most n at once. */
export async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
