// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — the public webcams curated by Osiris (simplifaisoul, MIT licence) for the
// "Public webcams worldwide" layer: SkylineWebcams across Asia, Africa, Latin America and Europe (mainland China,
// Japan, South Korea, Southeast Asia …) and the operator-run webcams of Osiris's public-webcam directory.
// The list is tools/data/osiris-webcams.json, rebuilt with tools/build-osiris-webcams.mjs from an Osiris checkout.
// Every camera is shown from its publisher: Skyline and YouTube cameras as a link to the publisher's page, a few
// owner-run HLS streams in place. tools/fetch-worldcams.mjs calls mergeIntoWorldcams() after its WorldCam pass.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'osiris-webcams.json');
// Publisher kinds as in fetch-worldcams.mjs KIND: 2 = tourism, weather or aviation webcam network.
const KIND_NETWORK = 2;
const NEAR_M = 150;

let cache = null;
/** The Osiris cameras: [{ id, name, lat, lng, city, country, img, stream, page, publisher, type }]. */
export function osirisWebcams(file = FILE) {
  if (file === FILE && cache) return cache;
  const list = JSON.parse(readFileSync(file, 'utf8')).cameras ?? [];
  if (file === FILE) cache = list;
  return list;
}

const IP = /^(\d+\.){3}\d+$|^\[?[0-9a-f:]+\]?$/i;
const safe = (u) => { if (!u) return ''; try { const x = new URL(u); return x.protocol === 'https:' && !IP.test(x.hostname) && !x.username && !x.password && !/\/api\/cctv\//.test(x.pathname) ? u : ''; } catch { return ''; } };
/** Names compared without case, accents, punctuation or a trailing " - Country". */
export const normName = (s, country = '') => {
  let t = String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (country) t = t.replace(new RegExp(`\\s*-\\s*${country.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  return t.replace(/[^a-z0-9]+/g, '');
};
const metres = (a, b, c, d) => { const r = Math.PI / 180; const x = (d - b) * r * Math.cos(((a + c) / 2) * r); const y = (c - a) * r; return Math.hypot(x, y) * 6_371_000; };
const bucket = (lat, lng) => `${Math.floor(lat * 100)}_${Math.floor(lng * 100)}`; // ~1 km squares

/**
 * Adds the Osiris cameras to the worldcams cells being built by fetch-worldcams.mjs, in place.
 * state: the fetcher's own variables — { cells, pubs, pubIx, pubCount, density, uniq, types }, where rows are
 *   [id, name, lat, lng, img, stream, publisherIndex, typeIndex, country, city, page] (URLs not yet prefix-packed).
 * A camera is skipped when a row already there has the same page address, or the same name within ~150 m.
 * Returns { added, skipped: { reason: count } }; the caller adds `added` to its total.
 */
export function mergeIntoWorldcams(state, cams = osirisWebcams()) {
  const { cells, pubs, pubIx, pubCount, density, uniq, types } = state;
  const pages = new Set(); const near = new Map();
  const remember = (r) => {
    if (r[10]) pages.add(r[10]);
    const k = bucket(r[2], r[3]); let b = near.get(k); if (!b) near.set(k, (b = [])); b.push(r);
  };
  for (const rows of Object.values(cells)) for (const r of rows) remember(r);
  const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let added = 0;
  for (const c of cams) {
    const img = safe(c.img); const stream = safe(c.stream); const page = safe(c.page);
    if (!img && !stream && !page) { skip('no HTTPS address from the publisher'); continue; }
    if (page && pages.has(page)) { skip('same page as a WorldCam camera'); continue; }
    const n = normName(c.name, c.country); let dup = false;
    for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) {
      for (const r of near.get(`${Math.floor(c.lat * 100) + i}_${Math.floor(c.lng * 100) + j}`) ?? []) {
        if (normName(r[1], r[8]) === n && metres(c.lat, c.lng, r[2], r[3]) <= NEAR_M) { dup = true; break; }
      }
    }
    if (dup) { skip('same name within 150 m of a WorldCam camera'); continue; }
    let pi = pubIx.get(c.publisher);
    if (pi === undefined) { pi = pubs.length; pubIx.set(c.publisher, pi); pubs.push([c.publisher, KIND_NETWORK]); pubCount.push(0); }
    pubCount[pi]++;
    const ti = types.indexOf(c.type); const ty = ti < 0 ? types.length - 1 : ti;
    const row = [uniq(c.id), c.name, c.lat, c.lng, img, stream, pi, ty, c.country, c.city, page];
    (cells[`${Math.floor(c.lat / 10) * 10}_${Math.floor(c.lng / 10) * 10}`] ??= []).push(row);
    if (page) pages.add(page); // Osiris cameras are checked against each other by page only: distinct pages are distinct cameras
    if (density) { const dk = `${Math.floor(c.lat)}_${Math.floor(c.lng)}`; density[dk] = (density[dk] ?? 0) + 1; }
    added++;
  }
  return { added, skipped };
}
