// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: conflict zones, watch regions and military bases in depth (v2.28).
// Three geopolitical layers become pages of their own, worked out from data the atlas already ships, so they open
// offline too:
//   conflict zone  how big the drawn theatre is against a country you know, the countries it covers and their share,
//                  the people in the cities and towns inside it, the military bases in and near it by the power that
//                  runs them, and what is at stake there: nuclear plants, ports, big airports, pipelines, cables and
//                  chokepoints;
//   watch region   the same, for everything within 500 km of its point, plus how far it is from the nearest conflict;
//   military base  the network it belongs to (its power's bases worldwide and nearest), the other powers' bases near
//                  it, and what it overlooks: the nearest chokepoint, conflict zone and watch region.
// Numbers that are estimates say so on the page; docs/ASSUMPTIONS.md (v2.28) lists every figure and its source.
import { unitSvg } from './icons.js';
import { haversineKm } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const sig = (n) => fmt(n, n < 10 ? 1 : 0);
const D2R = Math.PI / 180;
const R_KM = 6371.0088;

// ---------------------------------------------------------------- geometry on [lng, lat] rings
/** Area of a ring of [lng, lat] points on a sphere, km² (the spherical-excess formula used by d3-geo and Turf). */
export function ringAreaKm2(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [l1, p1] = ring[i]; const [l2, p2] = ring[(i + 1) % n];
    let dl = l2 - l1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    s += dl * D2R * (2 + Math.sin(p1 * D2R) + Math.sin(p2 * D2R));
  }
  return Math.abs((s * R_KM * R_KM) / 2);
}
/** Area of a GeoJSON Polygon or MultiPolygon, km² (outer rings less holes). */
export function geomAreaKm2(g) {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.reduce((a, p) => a + ringAreaKm2(p[0]) - p.slice(1).reduce((h, r) => h + ringAreaKm2(r), 0), 0);
}
/** Whether (lat, lng) is inside a ring of [lng, lat] points (ray casting). */
export function inRing(lat, lng, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
/** Distance in km from (lat, lng) to a ring's edge, 0 inside. Edges are sampled every ~10 km. */
export function ringDistKm(lat, lng, ring) {
  if (inRing(lat, lng, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i]; const [l2, p2] = ring[i + 1]; const n = Math.max(1, Math.ceil(haversineKm(p1, l1, p2, l2) / 10));
    for (let k = 0; k <= n; k++) best = Math.min(best, haversineKm(lat, lng, p1 + ((p2 - p1) * k) / n, l1 + ((l2 - l1) * k) / n));
  }
  return best;
}
/** A grid of points inside a region, about every step degrees of latitude (closer in longitude away from the equator). */
export function gridIn(region, step = 0.5) {
  const [s, w, n, e] = region.bbox; const out = [];
  for (let lat = s + step / 2; lat < n; lat += step) {
    const k = step / Math.max(0.2, Math.cos(lat * D2R));
    for (let lng = w + k / 2; lng < e; lng += k) if (region.has(lat, lng)) out.push([lat, lng]);
  }
  return out;
}
/** A region the pages can ask questions of: a drawn theatre (polygon ring) or a circle of km around a point. */
export function polyRegion(ring) {
  let s = 90, w = 180, n = -90, e = -180; for (const [x, y] of ring) { s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }
  return { kind: 'poly', ring, bbox: [s, w, n, e], areaKm2: ringAreaKm2(ring), has: (a, b) => inRing(a, b, ring), dist: (a, b) => ringDistKm(a, b, ring) };
}
export function circleRegion(lat, lng, km) {
  const dLat = km / 111.195; const dLng = dLat / Math.max(0.1, Math.cos(lat * D2R));
  return { kind: 'circle', lat, lng, km, bbox: [lat - dLat, lng - dLng, lat + dLat, lng + dLng], areaKm2: 2 * Math.PI * R_KM * R_KM * (1 - Math.cos(km / R_KM)), has: (a, b) => haversineKm(lat, lng, a, b) <= km, dist: (a, b) => Math.max(0, haversineKm(lat, lng, a, b) - km) };
}
const cname = (f) => f?.properties?.name ?? f?.properties?.ADMIN ?? null;
/** The countries a region covers and the share of its land in each, from a grid against countryAt (null at sea). */
export function countryShares(region, countryAt, step) {
  const pts = gridIn(region, step ?? Math.max(0.1, Math.min(1, Math.sqrt(region.areaKm2) / 1500)));
  const n = {}; let sea = 0;
  for (const [a, b] of pts) { const c = cname(countryAt(a, b)); if (c) n[c] = (n[c] ?? 0) + 1; else sea++; }
  const land = pts.length - sea;
  return { rows: Object.entries(n).map(([name, k]) => ({ name, share: (k / Math.max(1, land)) * 100 })).sort((x, y) => y.share - x.share), seaShare: pts.length ? (sea / pts.length) * 100 : 0, samples: pts.length };
}
let AREAS = null;
/** The country closest in area to km², from the atlas's own outlines (areas worked out once). */
export function sizeLike(km2, features) {
  AREAS ??= (features ?? []).filter((f) => f.geometry).map((f) => ({ name: cname(f), a: geomAreaKm2(f.geometry) })).filter((x) => x.name && x.a > 0);
  let best = null; for (const c of AREAS) if (!best || Math.abs(Math.log(c.a / km2)) < Math.abs(Math.log(best.a / km2))) best = c;
  return best;
}
/** What size words to use: "about the size of Germany" or "about 1.4 times the size of Germany". */
export function sizeWords(km2, c) {
  if (!c) return '';
  const r = km2 / c.a; return r > 0.85 && r < 1.18 ? `about the size of ${c.name}` : `about ${sig(r)} times the size of ${c.name}`;
}

// ---------------------------------------------------------------- military powers
export const POWERS = {
  'us-nato': ['United States and NATO', '#6fb8ff'], china: ['China', '#ff5f6d'], russia: ['Russia', '#e0a05a'],
  uk: ['United Kingdom', '#9fc3e6'], france: ['France', '#b7a3ff'], india: ['India', '#ffb35c'],
  italy: ['Italy', '#7ed6a0'], uae: ['United Arab Emirates', '#e3c45b'], japan: ['Japan', '#f5f5f5'],
};
export const powerOf = (b) => POWERS[b?.type] ?? [b?.type ?? 'Unknown', '#d98c6a'];
const live = (b) => b.status !== 'closed';
/** Host-country spellings in World Monitor's list, tidied for display ("United Kingdoms" → "United Kingdom"). */
export const hostName = (c) => ({ 'United Kingdoms': 'United Kingdom' }[c] ?? c);
/** Bases grouped by the power that runs them, biggest group first: [{type, name, color, n, near}]. */
export function byPower(rows) {
  const g = {}; for (const x of rows) { const t = x.b.type ?? '?'; (g[t] ??= []).push(x); }
  return Object.entries(g).map(([t, xs]) => ({ type: t, name: powerOf({ type: t })[0], color: powerOf({ type: t })[1], n: xs.length, near: xs.sort((a, b) => a.km - b.km)[0] })).sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- shared page bits
export const gx = { kind: null, d: null, fat: null, lines: null };
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const sum = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const sec = (id, title, open = true) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small id="${id}-sum"></small></summary><div id="${id}"></div></details>`;
const head = (glyph, big, line, tone = 'blue') => `<div class="ev-head tone-${tone}"><span class="ev-g">${unitSvg(glyph, 34)}</span><div><b class="ev-big">${big}</b><span>${line}</span></div></div>`;
const openBtn = (layer, d, label, extra = '') => `<button class="chip" data-ix-layer="${layer}" data-ix-id="${esc(d.id ?? d.name)}">${label}${extra ? ` <span>${extra}</span>` : ''}</button>`;
const dot = (c) => `<span class="gx-dot" style="--c:${c}"></span>`;
const near = (rows, lat, lon, km, latKey = 'lat', lonKey = 'lon') => (rows ?? []).filter((o) => Number.isFinite(o[latKey])).map((o) => ({ o, km: haversineKm(lat, lon, o[latKey], o[lonKey]) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);
const lineInside = (pts, region) => (pts ?? []).some(([lng, lat]) => region.has(lat, lng));
const people = (n) => (n >= 1e6 ? `${sig(n / 1e6)} million` : fmt(n));

/** Everything the atlas knows in and near a region (pad km around it). */
export function stakes(region, { wm, data, cities = [], airports = [] }, pad = 100) {
  const within = (lat, lng) => region.has(lat, lng) || region.dist(lat, lng) <= pad;
  const pick = (rows, latK = 'lat', lonK = 'lon') => (rows ?? []).filter((o) => Number.isFinite(o[latK]) && within(o[latK], o[lonK]));
  const towns = cities.filter((c) => region.has(c.lat, c.lng)).sort((a, b) => b.pop - a.pop);
  return {
    towns, pop: towns.reduce((s, c) => s + (c.pop ?? 0), 0),
    bases: (wm?.bases ?? []).filter(live).filter((b) => within(b.lat, b.lon)).map((b) => ({ b, km: region.dist(b.lat, b.lon) })),
    nuclear: pick(data?.nuclear ?? wm?.nuclear).filter((n) => (n.type ?? 'plant') === 'plant'),
    ports: pick(data?.ports?.length ? data.ports : wm?.ports),
    airports: airports.filter((a) => a.large && region.has(a.lat, a.lng)),
    pipelines: (wm?.pipelines ?? []).filter((p) => lineInside(p.points, region)),
    cables: (wm?.cables ?? []).filter((c) => (c.landingPoints ?? []).some((l) => within(l.lat, l.lon))),
    chokes: pick(data?.waterways ?? wm?.waterways),
  };
}
function stakeHtml(s, pad) {
  const list = (rows, layer, label, n = 6) => (rows.length ? `<div class="lm-near"><small>${label}:</small>${rows.slice(0, n).map((o) => openBtn(layer, o, esc(o.name))).join('')}${rows.length > n ? `<small>and ${rows.length - n} more</small>` : ''}</div>` : '');
  const out = [list(s.nuclear, 'nuclear', 'Nuclear plants'), list(s.chokes, 'waterways', 'Chokepoints'), list(s.pipelines, 'pipelines', 'Pipelines through it'), list(s.ports, 'ports', 'Ports'), list(s.cables, 'cables', 'Undersea cables landing'),
    s.airports.length ? `<div class="lm-near"><small>Big airports:</small>${s.airports.slice(0, 6).map((a) => `<span class="ld-chip tone-unk">${esc(a.iata || a.icao)} ${esc(a.city || a.name)}</span>`).join('')}${s.airports.length > 6 ? `<small>and ${s.airports.length - 6} more</small>` : ''}</div>` : ''].join('');
  return out ? `${out}<p class="cd-key">Inside it or within ${fmt(pad)} km, from the atlas’s own layers.</p>` : `<p class="cd-key">No nuclear plant, chokepoint, pipeline, port, cable landing or big airport in the atlas within ${fmt(pad)} km.</p>`;
}
const stakeCount = (s) => s.nuclear.length + s.chokes.length + s.pipelines.length + s.ports.length + s.cables.length + s.airports.length;
function forcesHtml(s, pad, region) {
  const g = byPower(s.bases); if (!g.length) return `<p class="cd-key">No military base in the atlas’s list inside it or within ${fmt(pad)} km.</p>`;
  const inside = s.bases.filter((x) => x.km === 0).length;
  return `<ul class="ix-alts">${g.map((p) => `<li><span class="gx-pow">${dot(p.color)}<b>${esc(p.name)}</b> · ${p.n} base${p.n === 1 ? '' : 's'}</span><small>nearest ${openBtn('bases', p.near.b, esc(p.near.b.name), p.near.km ? `${fmt(p.near.km)} km out` : 'inside')}</small></li>`).join('')}</ul>
    <p class="cd-key">${inside} inside ${region.kind === 'poly' ? 'the drawn area' : 'the circle'}, ${s.bases.length - inside} within ${fmt(pad)} km of it. From World Monitor’s list of overseas and key home bases, so smaller and secret sites are missing.</p>`;
}
function peopleHtml(s, region) {
  if (!s.towns.length) return '<p class="cd-key">None of the 2,500 cities and towns in the atlas is inside it.</p>';
  return `<p class="cd-key">At least <b>${people(s.pop)} people</b> live in the ${fmt(s.towns.length)} cities and towns the atlas lists inside ${region.kind === 'poly' ? 'it' : 'the circle'}: a lower bound, because villages and the countryside are not counted.</p>
    <div class="lm-near">${s.towns.slice(0, 8).map((c) => `<button class="chip" data-zoomto="${c.lat},${c.lng},area">${esc(c.name)} <span>${people(c.pop)}</span></button>`).join('')}</div>`;
}
function countriesHtml(cs) {
  if (!cs.rows.length) return '<p class="cd-key">It is all sea.</p>';
  return `<ul class="gx-bars">${cs.rows.slice(0, 8).map((r) => `<li><span>${esc(r.name)}</span><span class="gx-bar"><i style="--w:${r.share.toFixed(1)}%"></i></span><small>${r.share >= 1 ? fmt(r.share) : '<1'} %</small></li>`).join('')}</ul>
    <p class="cd-key">Share of its land in each country${cs.seaShare >= 1 ? `; ${fmt(cs.seaShare)} % of it is sea` : ''}. From ${fmt(cs.samples)} points spread over it against the atlas’s country outlines.</p>`;
}

// ---------------------------------------------------------------- the conflict-zone page
export function zoneHtml() {
  return `<div class="ix gx" data-ix="zone"><div id="gx-head"></div>${sec('gx-land', 'Countries it covers')}${sec('gx-people', 'People inside')}${sec('gx-forces', 'Military bases in and near it')}${sec('gx-stakes', 'What is at stake there')}</div>`;
}
const TONE = { high: 'red', medium: 'warn', low: 'ok' };
export function zoneFill(z, { data, wm, countryAt, features, cities, airports, refresh }) {
  const ring = z.coords; const region = polyRegion(ring); const like = sizeLike(region.areaKm2, features);
  set('gx-head', head('swords', `${fmt(region.areaKm2 / 1000)} thousand km²`, `${sizeWords(region.areaKm2, like)}`, TONE[z.intensity] ?? 'ochre')
    + `<div class="pt-chips"><span class="ld-chip tone-${TONE[z.intensity] ?? 'unk'}">Intensity: ${esc(z.intensity ?? 'unknown')}</span>${(z.parties ?? []).map((p) => `<span class="ld-chip tone-unk">${esc(p)}</span>`).join('')}</div>`
    + `<p class="cd-key">The area as World Monitor draws it, by hand: a rough outline of where the fighting and its effects are, not a front line.</p>`);
  const cs = countriesHtml(countryAt ? countryShares(region, countryAt) : { rows: [], seaShare: 0, samples: 0 });
  set('gx-land', countryAt ? cs : '<p class="cd-key">Switch on Countries to see which countries it covers.</p>');
  const s = stakes(region, { wm, data, cities, airports }, 100);
  set('gx-people', peopleHtml(s, region)); sum('gx-people-sum', s.towns.length ? `${people(s.pop)}+` : '');
  set('gx-forces', forcesHtml(s, 100, region)); sum('gx-forces-sum', s.bases.length ? `${s.bases.length} bases` : 'none');
  set('gx-stakes', stakeHtml(s, 100)); sum('gx-stakes-sum', `${stakeCount(s)} sites`);
  Object.assign(gx, { kind: 'zone', d: z, fat: null, lines: null });
  refresh?.();
}

// ---------------------------------------------------------------- the watch-region page
export const WATCH_KM = 500;
export function spotHtml() {
  return `<div class="ix gx" data-ix="spot"><div id="gx-head"></div>${sec('gx-land', 'Countries within 500 km')}${sec('gx-people', 'People within 500 km')}${sec('gx-forces', 'Military bases near it')}${sec('gx-stakes', 'What is at stake there')}${sec('gx-near', 'Nearest conflict', false)}</div>`;
}
export function spotFill(h, { data, wm, countryAt, cities, airports, refresh }) {
  const region = circleRegion(h.lat, h.lon, WATCH_KM);
  set('gx-head', head('eye', esc(h.subtext ?? h.name), esc(h.location ?? ''), 'ochre') + `<p class="cd-key">${esc(h.description ?? '')}</p><p class="cd-key">This page looks at everything within ${fmt(WATCH_KM)} km of the region’s point, drawn as a ring on the globe.</p>`);
  set('gx-land', countryAt ? countriesHtml(countryShares(region, countryAt, 0.5)) : '<p class="cd-key">Switch on Countries to see which countries are within reach.</p>');
  const s = stakes(region, { wm, data, cities, airports }, 0);
  set('gx-people', peopleHtml(s, region)); sum('gx-people-sum', s.towns.length ? `${people(s.pop)}+` : '');
  set('gx-forces', forcesHtml(s, 0, region).replace(' within 0 km of it', '')); sum('gx-forces-sum', s.bases.length ? `${s.bases.length} bases` : 'none');
  set('gx-stakes', stakeHtml(s, 0).replace('Inside it or within 0 km, ', 'Within 500 km, ')); sum('gx-stakes-sum', `${stakeCount(s)} sites`);
  const zs = (wm?.conflicts ?? []).map((z) => ({ z, km: ringDistKm(h.lat, h.lon, z.coords) })).sort((a, b) => a.km - b.km);
  set('gx-near', zs.length ? `<div class="lm-near">${zs.slice(0, 3).map((x) => openBtn('conflicts', x.z, esc(x.z.name), x.km ? `${fmt(x.km)} km` : 'here')).join('')}</div><p class="cd-key">Distance to the edge of each drawn conflict zone.</p>` : '');
  sum('gx-near-sum', zs.length ? (zs[0].km ? `${fmt(zs[0].km)} km` : 'inside one') : '');
  Object.assign(gx, { kind: 'spot', d: h, fat: null, lines: null });
  refresh?.();
}

// ---------------------------------------------------------------- the military-base page
export const RIVAL_KM = 1000;
export function baseHtml() {
  return `<div class="ix gx" data-ix="base"><div id="gx-head"></div>${sec('gx-net', 'Its network')}${sec('gx-rivals', 'Other powers within 1,000 km')}${sec('gx-watch', 'What it overlooks')}</div>`;
}
export function baseFill(b, { data, wm, refresh }) {
  const [pname, pcol] = powerOf(b); const all = (wm?.bases ?? []).filter(live);
  const mine = all.filter((o) => o.type === b.type && o !== b && o.id !== b.id);
  const abroad = mine.filter((o) => o.country && o.country !== b.country);
  set('gx-head', head('badge', esc(pname), `${b.country ? `in ${esc(b.country)}` : 'at home'}${b.arm ? ` · ${esc(b.arm)}` : ''}${b.status && b.status !== 'active' ? ` · ${esc(b.status)}` : ''}`, 'blue')
    + `${b.description ? `<p class="cd-key">${esc(b.description)}</p>` : ''}`);
  const hosts = {}; for (const o of [b, ...mine]) if (o.country) hosts[hostName(o.country)] = (hosts[hostName(o.country)] ?? 0) + 1;
  const sameHost = b.country ? mine.filter((o) => o.country === b.country).length : 0;
  const nm = near(mine, b.lat, b.lon, 20000).slice(0, 6);
  set('gx-net', `<p class="cd-key">${dot(pcol)} <b>${fmt(mine.length + 1)}</b> ${esc(pname)} bases on the map in ${fmt(Object.keys(hosts).length)} countries${b.country ? `, ${sameHost + 1} of them in ${esc(b.country)}` : ''}${abroad.length ? `; ${fmt(abroad.length)} outside this host` : ''}.</p>
    ${nm.length ? `<div class="lm-near"><small>Nearest:</small>${nm.map((x) => openBtn('bases', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : ''}
    <div class="pt-chips">${Object.entries(hosts).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c, n]) => `<span class="ld-chip tone-unk">${esc(c)} ${n}</span>`).join('')}</div>`);
  sum('gx-net-sum', `${fmt(mine.length + 1)} bases`);
  const rivals = all.filter((o) => o.type !== b.type).map((o) => ({ b: o, km: haversineKm(b.lat, b.lon, o.lat, o.lon) })).filter((x) => x.km <= RIVAL_KM);
  const g = byPower(rivals);
  set('gx-rivals', g.length ? `<ul class="ix-alts">${g.map((p) => `<li><span class="gx-pow">${dot(p.color)}<b>${esc(p.name)}</b> · ${p.n}</span><small>nearest ${openBtn('bases', p.near.b, esc(p.near.b.name), `${fmt(p.near.km)} km`)}</small></li>`).join('')}</ul><p class="cd-key">Lines on the globe join it to the nearest base of each other power.</p>` : `<p class="cd-key">No base of another power within ${fmt(RIVAL_KM)} km in the atlas’s list.</p>`);
  sum('gx-rivals-sum', g.length ? `${rivals.length} bases, ${g.length} powers` : 'none');
  const ch = near(data?.waterways ?? wm?.waterways, b.lat, b.lon, 20000)[0];
  const zs = (wm?.conflicts ?? []).map((z) => ({ z, km: ringDistKm(b.lat, b.lon, z.coords) })).sort((x, y) => x.km - y.km)[0];
  const hs = near(wm?.hotspots, b.lat, b.lon, 20000)[0];
  set('gx-watch', `<ul class="ix-alts">${ch ? `<li>${openBtn('waterways', ch.o, esc(ch.o.name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())), `${fmt(ch.km)} km`)}<small>the nearest chokepoint, about ${sig(ch.km / (15 * 1.852 * 24))} days’ sailing at 15 knots if the base is on the coast</small></li>` : ''}
    ${zs ? `<li>${openBtn('conflicts', zs.z, esc(zs.z.name), zs.km ? `${fmt(zs.km)} km` : 'inside')}<small>${zs.km ? 'the nearest drawn conflict zone, to its edge' : 'the base is inside this drawn conflict zone'}</small></li>` : ''}
    ${hs ? `<li>${openBtn('hotspots', hs.o, esc(hs.o.name), `${fmt(hs.km)} km`)}<small>the nearest watch region</small></li>` : ''}</ul><p class="cd-key">Straight-line distances.</p>`);
  sum('gx-watch-sum', ch ? `chokepoint ${fmt(ch.km)} km` : '');
  Object.assign(gx, { kind: 'base', d: b, fat: null, lines: g.map((p) => ({ to: p.near.b, color: p.color })) });
  refresh?.();
}

// ---------------------------------------------------------------- on the globe
const destination = (lat, lng, az, km) => { const d = km / R_KM; const p1 = lat * D2R; const t = az * D2R; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t)); const l2 = lng * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [p2 / D2R, ((l2 / D2R + 540) % 360) - 180]; };
const ring = (lat, lng, km, n = 72) => Array.from({ length: n + 1 }, (_, i) => destination(lat, lng, (i / n) * 360, km));
const arc = (a, b, n = 32) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
/** The open page's marks: a 500 km ring for a watch region; a 1,000 km ring and lines to other powers for a base. */
export function geoOverlay(ctx, layer, sel) {
  const want = { hotspots: 'spot', bases: 'base' }[layer];
  if (!want || !gx.d || gx.kind !== want || sel?.d !== gx.d) return { custom: [] };
  if (!gx.fat) {
    const d = gx.d; const lines = [];
    if (want === 'spot') lines.push({ pts: ring(d.lat, d.lon, WATCH_KM), color: '#f07a63', width: 2, alt: 0.004 });
    if (want === 'base') { lines.push({ pts: ring(d.lat, d.lon, RIVAL_KM), color: 'rgba(217,140,106,0.6)', width: 1.4, alt: 0.004 }); for (const l of gx.lines ?? []) lines.push({ pts: arc([d.lat, d.lon], [l.to.lat, l.to.lon]), color: l.color, width: 2, alt: 0.005 }); }
    gx.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.95 }) : null;
  }
  return { custom: gx.fat ? [gx.fat] : [] };
}
export function geoClose() { gx.fat?.obj?.geometry?.dispose?.(); Object.assign(gx, { kind: null, d: null, fat: null, lines: null }); }
