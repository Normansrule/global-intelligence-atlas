// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one undersea cable in depth.
// Click a cable and its card becomes a cable page:
//   the cable      its length against journeys you know, how long light takes from one end to the other (and
//                  against a satellite hop), its age or the year it is due, and who owns it;
//   landings       every landing station, grouped by country (each country a button, each town flies there);
//   if it were cut how many cables land in each of its countries: the ones with three or fewer have little
//                  to fall back on, drawn as a row of cable marks per country;
//   over it now    ships stopped or at anchor within 2 km of its route, away from ports (dragged anchors are the
//                  most common way cables are cut), from the Live ships layer;
//   shares landings with the other cables that come ashore at the same towns.
// On the globe: light flows along the cable from end to end, and each landing station is ringed.
// Data from TeleGeography's Submarine Cable Map (open data) or World Monitor's list; ships from the Live ships layer.
import { unitSvg } from './icons.js';
import { haversineKm } from './astro.js';
import { shipKind } from './shipdb.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
// Light in silica fibre: c / group index ≈ 1.468, about 204,000 km/s (Agrawal, 2010).
export const FIBRE_KM_S = 299_792.458 / 1.468;
const GEO_RTT_MS = 2 * 2 * 35_786 / 299_792.458 * 1000; // up to a geostationary satellite and down, there and back
export const OVER_KM = 2; // "over it" means within this distance of its route
const PORT_KM = 12; // ships this close to a landing station are in harbour, not over the cable

/** The route as parts of [lat, lng] (open data splits a cable into parts; World Monitor gives one line of [lng, lat]). */
export function routeParts(c) { return (c.parts ?? [c.points ?? []]).map((pts) => pts.map(([lng, lat]) => [lat, lng])); }
/** The length of the drawn route in km (when the cable's own length is not given). */
export function routeKm(c) { return routeParts(c).reduce((s, pts) => s + pts.reduce((a, p, i) => (i ? a + haversineKm(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0), 0), 0); }
/** One-way time for light through the whole length, in milliseconds. */
export const lightMs = (km) => (km / FIBRE_KM_S) * 1000;
/** A length against distances people know. */
export function lengthWords(km) {
  if (!(km > 0)) return '';
  if (km >= 40_075 * 0.9) return `${fmt(km / 40_075, 2)} times round the Earth at the equator`;
  if (km >= 17_000 * 0.6) return `${fmt(km / 17_000, 1)} times London to Sydney as the crow flies`;
  if (km >= 5_570 * 0.5) return `${fmt(km / 5_570, 1)} times London to New York`;
  if (km >= 344 * 0.5) return `${fmt(km / 344, 1)} times London to Paris`;
  return `${fmt(km / 33.3, 1)} times across the Strait of Dover`;
}
/** Landing stations grouped by country, in the order they are listed: [[countryName, [landing…]]…]. */
export function landingsByCountry(c) {
  const m = new Map(); for (const l of c.landingPoints ?? []) { const k = l.countryName ?? l.country ?? '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return [...m.entries()];
}
/** How many cables land in each country, across every cable on the map. */
export function cablesPerCountry(all) {
  const m = new Map(); for (const c of all ?? []) for (const k of new Set((c.landingPoints ?? []).map((l) => l.countryName ?? l.country))) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
/** Other cables that come ashore within 5 km of one of this cable's landing stations. */
export function sharedLandings(c, all) {
  const mine = (c.landingPoints ?? []).filter((l) => l.lat != null); const out = [];
  for (const o of all ?? []) {
    if (o === c || o.id === c.id) continue;
    const hit = (o.landingPoints ?? []).find((l) => l.lat != null && mine.some((x) => Math.abs(x.lat - l.lat) < 0.06 && haversineKm(x.lat, x.lon, l.lat, l.lon) <= 5));
    if (hit) out.push({ c: o, at: hit.city });
  }
  return out;
}
/** Distance in km from a point to the route (nearest segment, flat-Earth within a segment: fine at these scales). */
function distToRoute(lat, lng, parts) {
  let best = Infinity; const k = Math.cos((lat * Math.PI) / 180);
  for (const pts of parts) for (let i = 1; i < pts.length; i++) {
    const [aLat, aLng] = pts[i - 1]; const [bLat, bLng] = pts[i];
    if (Math.abs(aLng - bLng) > 180) continue; // a part crossing the date line: skip that one segment
    const ax = aLng * k; const bx = bLng * k; const px = lng * k; const dx = bx - ax; const dy = bLat - aLat;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (lat - aLat) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (ax + t * dx), lat - (aLat + t * dy)) * 111.195; if (d < best) best = d;
  }
  return best;
}
/** Ships stopped or at anchor within OVER_KM of the route and away from its landing stations. */
export function shipsOver(c, ships, metaOf = (s) => s.meta ?? {}) {
  if (!ships) return null;
  const parts = routeParts(c); const pts = parts.flat(); if (!pts.length) return [];
  const pad = OVER_KM / 111 + 0.02; let s = 90; let n = -90; let w = 180; let e = -180;
  for (const [a, b] of pts) { s = Math.min(s, a); n = Math.max(n, a); w = Math.min(w, b); e = Math.max(e, b); }
  const lands = (c.landingPoints ?? []).filter((l) => l.lat != null);
  const out = [];
  for (const x of ships) {
    if (x.lat < s - pad || x.lat > n + pad || (e - w < 300 && (x.lng < w - pad || x.lng > e + pad))) continue;
    const still = x.nav === 1 || (x.sog ?? 0) < 0.5; if (!still || x.nav === 5) continue; // moored ships are in port
    const d = distToRoute(x.lat, x.lng, parts); if (d > OVER_KM) continue;
    if (lands.some((l) => Math.abs(l.lat - x.lat) < 0.2 && haversineKm(l.lat, l.lon, x.lat, x.lng) < PORT_KM)) continue;
    const m = metaOf(x) ?? {}; out.push({ s: x, km: d, name: m.name ?? x.meta?.name ?? `MMSI ${x.mmsi}`, kind: shipKind(m.shipType ?? x.meta?.shipType) ?? 'other', anchored: x.nav === 1 });
  }
  return out.sort((a, b) => a.km - b.km);
}

// ---------------------------------------------------------------- the open cable (shared with the globe)
export const cb = { key: null, c: null, fat: null, flow: null };

export function cableHtml(c) {
  return `<div class="cb" data-cable="${esc(c.id ?? c.name)}">
    <div id="cb-head"></div>
    <details class="qd-sec" open><summary><span>Where it lands</span><small id="cb-land-sum"></small></summary><div id="cb-land"></div></details>
    <details class="qd-sec" open><summary><span>If it were cut</span><small id="cb-cut-sum"></small></summary><div id="cb-cut"></div></details>
    <details class="qd-sec" open><summary><span>Ships over it now</span><small id="cb-over-sum"></small></summary><div id="cb-over"></div></details>
    <details class="qd-sec"><summary><span>Shares landings with</span><small id="cb-share-sum"></small></summary><div id="cb-share"></div></details>
  </div>`;
}
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const sum = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

/** Fill the cable page (everything is in the data already, so it is immediate). */
export function cableFill(c, { data, countryAt, refresh, shipMeta, byName }) {
  Object.assign(cb, { key: c.id ?? c.name, c, fat: null, flow: null });
  const all = data.cables ?? []; const km = Number(c.lengthKm) || routeKm(c); const given = !!Number(c.lengthKm);
  const year = Number(c.rfsYear) || null; const now = new Date().getUTCFullYear(); const planned = c.planned || (year && year > now);
  const owners = Array.isArray(c.owners) ? c.owners : [];
  const ms = lightMs(km);
  set('cb-head', `<div class="ev-head tone-blue"><span class="ev-g">${unitSvg('ix', 34)}</span><div><b class="ev-big">${fmt(km)} km</b><span>${given ? '' : 'about, along the drawn route: '}${esc(lengthWords(km))}</span></div></div>
    <div class="cb-light"><span class="cb-beam" style="--ms:${Math.max(600, Math.min(6000, ms * 40)).toFixed(0)}ms"></span></div>
    <p class="cd-key">Light takes <b>${fmt(ms, ms < 10 ? 1 : 0)} ms</b> from one end to the other (${fmt(2 * ms, 0)} ms there and back), against about ${fmt(GEO_RTT_MS)} ms for a round trip through a geostationary satellite. ${planned ? `<b>Due ${year ?? 'soon'}</b>.` : year ? `In service since <b>${year}</b>, ${now - year <= 0 ? 'this year' : `${now - year} year${now - year === 1 ? '' : 's'}`}${now - year >= 20 ? ': near the 25 years cables are built to last' : ''}.` : ''}</p>
    ${owners.length ? `<div class="pt-chips">${owners.map((o) => `<span class="ld-chip tone-unk">${esc(o)}</span>`).join('')}</div><p class="cd-key">${owners.length === 1 ? 'One owner.' : `Shared by ${owners.length} companies, who each own fibre pairs or capacity in it.`}</p>` : ''}`);
  // where it lands
  const groups = landingsByCountry(c);
  // the country as a button: the borders under any of its stations, else the country of that name (stations sit on the shore line)
  const ccOf = (ls, name) => { for (const l of ls) { if (l.lat == null) continue; const f = countryAt(l.lat, l.lon); const cc = f?.properties?.['ISO3166-1-Alpha-2']; if (cc && cc !== '-99') return cc; } return byName?.(name) ?? null; };
  set('cb-land', groups.length ? `<ul class="cb-lands">${groups.map(([name, ls], i) => { const cc = ccOf(ls, name); return `<li style="--i:${i}">${cc ? `<button class="linkish" data-country-cc="${esc(cc)}">${esc(name)}</button>` : `<span class="cb-cn">${esc(name)}</span>`}<span>${ls.map((l) => (l.lat != null ? `<button class="chip" data-fly="${l.lat},${l.lon},0.08">${esc(String(l.city).split(',')[0])}</button>` : `<span class="chip">${esc(l.city)}</span>`)).join('')}</span></li>`; }).join('')}</ul>` : '<p class="cd-key">No landing stations listed.</p>');
  sum('cb-land-sum', groups.length ? `${(c.landingPoints ?? []).length} stations in ${groups.length} ${groups.length === 1 ? 'country' : 'countries'}` : '');
  // if it were cut
  const per = cablesPerCountry(all); const rows = groups.map(([name]) => [name, per.get(name) ?? 1]).sort((a, b) => a[1] - b[1]);
  const fragile = rows.filter(([, n]) => n <= 3);
  const shown = rows.slice(0, fragile.length + 8); const rest = rows.slice(shown.length);
  set('cb-cut', rows.length ? `<ul class="cb-cut">${shown.map(([name, n]) => `<li class="${n <= 3 ? 'fragile' : ''}"><span>${esc(name)}</span><span class="cb-marks" role="img" aria-label="${n} cables">${Array.from({ length: Math.min(n, 40) }, (_, i) => `<i style="--i:${i}"></i>`).join('')}${n > 40 ? `<small>+${n - 40}</small>` : ''}</span><b>${n}</b></li>`).join('')}</ul>${rest.length ? `<p class="cd-key">${rest.length} more ${rest.length === 1 ? 'country has' : 'countries have'} ${rest[0][1] === rest.at(-1)[1] ? rest[0][1] : `${rest[0][1]} to ${rest.at(-1)[1]}`} cables each.</p>` : ''}
    <p class="cd-key">Cables landing in each country, of the ${fmt(all.length)} on the map. ${fragile.length ? `<b>${fragile.map(([x]) => esc(x)).join(', ')}</b> ${fragile.length === 1 ? 'has' : 'have'} three or fewer, so losing this one would cut a large share of ${fragile.length === 1 ? 'its' : 'their'} links abroad.` : 'Every country it reaches has more than three, so traffic could reroute.'} Satellites and land links are not counted.</p>` : '');
  sum('cb-cut-sum', fragile.length ? `${fragile.length} ${fragile.length === 1 ? 'country' : 'countries'} with 3 or fewer` : rows.length ? 'well connected' : '');
  // ships over it now
  fillOver(c, data, shipMeta);
  // shares landings
  const shared = sharedLandings(c, all);
  set('cb-share', shared.length ? `<div class="lm-near">${shared.slice(0, 24).map((x) => `<button class="chip" data-cable-id="${esc(x.c.id ?? x.c.name)}">${esc(x.c.name)} <span>${esc(String(x.at).split(',')[0])}</span></button>`).join('')}${shared.length > 24 ? `<small>and ${shared.length - 24} more</small>` : ''}</div>` : '<p class="cd-key">No other cable on the map lands at the same towns.</p>');
  sum('cb-share-sum', shared.length ? `${shared.length} cable${shared.length === 1 ? '' : 's'}` : 'none');
  refresh();
}
export function fillOver(c, data, shipMeta) {
  const over = shipsOver(c, data.ships, shipMeta);
  if (!over) { set('cb-over', `<button class="crow fact tone-blue" data-cd-layer="ships"><span class="crow-l">Switch on Live ships to see vessels stopped over its route</span><b>·</b><span class="crow-u">${unitSvg('anchor', 18)}</span><small>show them</small></button>`); sum('cb-over-sum', 'Live ships off'); return; }
  set('cb-over', over.length ? `<ul class="pt-big">${over.slice(0, 8).map((x) => `<li><button class="chip" data-mmsi="${x.s.mmsi}">${unitSvg(x.anchored ? 'anchor' : 'ship', 16)}${esc(x.name)}</button><small>${x.anchored ? 'at anchor' : 'stopped'} · ${fmt(x.km * 1000)} m from the route</small></li>`).join('')}</ul>
    <p class="cd-key">A ship anchoring or drifting over a cable is the most common way cables are damaged. Positions are the ships' own reports; the route on the map is approximate, so this is a pointer, not proof.</p>`
    : `<p class="cd-key">No ship heard stopped or at anchor within ${OVER_KM} km of its route, away from port.</p>`);
  sum('cb-over-sum', over.length ? `${over.length} stopped within ${OVER_KM} km` : 'none');
}

/** On the globe: light flowing along the cable and a ring round each landing station. */
export function cableOverlay(ctx, sel) {
  if (!cb.c || sel?.d !== cb.c) return { custom: [], paths: [] };
  if (!cb.fat) {
    const lines = []; for (const l of cb.c.landingPoints ?? []) if (l.lat != null) {
      const r = 0.25; const ring = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * 2 * Math.PI; ring.push([l.lat + r * Math.sin(a), l.lon + (r * Math.cos(a)) / Math.max(0.2, Math.cos((l.lat * Math.PI) / 180))]); }
      lines.push({ pts: ring, color: '#f2c66d', width: 1.6, alt: 0.004 });
    }
    cb.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.95 }) : null;
    cb.flow = routeParts(cb.c).filter((p) => p.length > 1).map((pts) => ({ pts: pts.map(([a, b]) => [a, b, 0.004]), color: ['rgba(159,240,255,0.15)', '#bff6ff'], stroke: 2.2, dash: [0.06, 0.03], animMs: 2600, passive: true }));
  }
  return { custom: cb.fat ? [cb.fat] : [], paths: cb.flow ?? [] };
}
export function cableClose() { cb.fat?.obj?.geometry?.dispose?.(); Object.assign(cb, { key: null, c: null, fat: null, flow: null }); }
