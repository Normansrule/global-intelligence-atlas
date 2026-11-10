// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the public camera registry of Open Eagle Eye (stuchapin909, MIT licence), added to the
// "Public webcams worldwide" layer after the WorldCam and Osiris passes in tools/fetch-worldcams.mjs.
//
// Open Eagle Eye lists about 31,000 still-image cameras, each checked by its maintainers (verified: true, auth: false).
// Most are road cameras the atlas already shows; the merge adds the ones it does not have yet, such as Utah, Virginia,
// Wyoming and Wisconsin road cameras, São Paulo traffic (CET), BC Ferries terminals, GeoNet volcano cameras and
// aurora all-sky cameras at research institutes. Every address must pass the same host policy as WorldCam (the caller's
// `accept`), so no camera is added from a host that has not been reviewed. Only metadata is stored; images load from
// the publisher.
export const EAGLE_EYE_URL = 'https://raw.githubusercontent.com/stuchapin909/Open-Eagle-Eye/master/cameras.json';
const NEAR_M = 60; // a camera this close to one already listed is taken to be the same camera

/** Open Eagle Eye category → worldcams type. */
export const EAGLE_TYPE = {
  highway: 'traffic', traffic: 'traffic', construction: 'traffic', city: 'traffic', beach: 'beach', port: 'port', ferry: 'port',
  airport: 'airport', volcano: 'volcano', aurora: 'science', wildlife: 'wildlife', nature: 'nature', dam: 'water', stadium: 'landmark',
};

const IP = /^(\d+\.){3}\d+$|^\[?[0-9a-f:]+\]?$/i;
const SECRET = /[?&](pass(word)?|pwd|passwd|token|auth|sig|signature|key)=/i;
const metres = (a, b, c, d) => { const r = Math.PI / 180; const x = (d - b) * r * Math.cos(((a + c) / 2) * r); const y = (c - a) * r; return Math.hypot(x, y) * 6_371_000; };
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return `e-${(h >>> 0).toString(36)}`; };

/** Why a registry record cannot be used, or '' when it can. */
export function rejectReason(c) {
  const lat = +c?.coordinates?.lat; const lng = +c?.coordinates?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return 'no position';
  if (c.auth) return 'needs a sign-in';
  if (c.verified === false) return 'not verified by Open Eagle Eye';
  let u; try { u = new URL(c.url); } catch { return 'unreadable address'; }
  if (u.protocol !== 'https:') return 'not HTTPS';
  if (IP.test(u.hostname)) return 'bare IP address';
  if (u.username || u.password || SECRET.test(u.search)) return 'address carries credentials';
  return '';
}

/**
 * Adds Open Eagle Eye cameras to the worldcams cells being built by fetch-worldcams.mjs, in place.
 * state: { cells, pubs, pubIx, pubCount, density, uniq, types } exactly as mergeIntoWorldcams (osiris-webcams.mjs) takes it.
 * accept(url) → [publisher, kind] for a reviewed host, or null; the caller passes its own host policy.
 * also: rows of the agency camera layer (cameras.json: [id, name, lat, lng, img, …]) so cameras it already shows are skipped.
 * A camera is skipped when the same image address is already listed, or when any camera is listed within 60 m.
 * Returns { added, skipped: { reason: count } }.
 */
export function mergeEagleEye(state, list, accept, also = []) {
  const { cells, pubs, pubIx, pubCount, density, uniq, types } = state;
  const urls = new Set(); const near = new Map();
  const key = (lat, lng) => `${Math.floor(lat * 200)}_${Math.floor(lng * 200)}`; // ~500 m squares
  const remember = (lat, lng) => { const k = key(lat, lng); let b = near.get(k); if (!b) near.set(k, (b = [])); b.push([lat, lng]); };
  for (const rows of Object.values(cells)) for (const r of rows) { if (r[4]) urls.add(r[4]); if (r[5]) urls.add(r[5]); remember(r[2], r[3]); }
  for (const r of also) { if (r?.[4]) urls.add(r[4]); if (Number.isFinite(r?.[2]) && Number.isFinite(r?.[3])) remember(r[2], r[3]); }
  const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let added = 0;
  for (const c of Array.isArray(list) ? list : []) {
    const why = rejectReason(c); if (why) { skip(why); continue; }
    const pub = accept(c.url); if (!pub) { skip('host not on the reviewed publisher list'); continue; }
    if (urls.has(c.url)) { skip('same image address as a camera already listed'); continue; }
    const lat = Math.round(+c.coordinates.lat * 1e5) / 1e5; const lng = Math.round(+c.coordinates.lng * 1e5) / 1e5;
    const gx = Math.floor(lat * 200); const gy = Math.floor(lng * 200); let dup = false;
    for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) {
      for (const p of near.get(`${gx + i}_${gy + j}`) ?? []) if (metres(lat, lng, p[0], p[1]) <= NEAR_M) { dup = true; break; }
    }
    if (dup) { skip('a camera is already listed within 60 m'); continue; }
    let pi = pubIx.get(pub[0]);
    if (pi === undefined) { pi = pubs.length; pubIx.set(pub[0], pi); pubs.push(pub); pubCount.push(0); }
    pubCount[pi]++;
    const ti = types.indexOf(EAGLE_TYPE[c.category] ?? 'other'); const ty = ti < 0 ? types.length - 1 : ti;
    const name = String(c.name || c.location || c.city || 'Camera').slice(0, 120);
    (cells[`${Math.floor(lat / 10) * 10}_${Math.floor(lng / 10) * 10}`] ??= []).push([uniq(fnv(String(c.id ?? c.url))), name, lat, lng, c.url, '', pi, ty, String(c.country ?? ''), String(c.city ?? '').slice(0, 60), '']);
    urls.add(c.url); remember(lat, lng);
    if (density) { const dk = `${Math.floor(lat)}_${Math.floor(lng)}`; density[dk] = (density[dk] ?? 0) + 1; }
    added++;
  }
  return { added, skipped };
}
