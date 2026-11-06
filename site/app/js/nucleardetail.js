// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one nuclear site in depth.
// Click a nuclear plant and its card becomes a plant page:
//   the plant      its power, what it would make in a year running 90% of the time (as nuclear plants typically
//                  do) against the people it could supply at the world's average use, and its years in service;
//   the zones      the people living within 16 km (the United States plume exposure planning zone), 30 km (the
//                  Chernobyl and Fukushima exclusion distances) and 80 km (the ingestion planning zone), drawn as
//                  Isotype figures, with the towns named;
//   the wind now   which way the air would carry anything released, from the wind at the site now, and how far
//                  it would travel in three hours;
//   neighbours     the other nuclear plants within 300 km.
// On the globe: the three rings and the wind arrow, in one draw call. Weather from Open-Meteo; people from the
// cities on the map (the countryside adds more). These are planning distances, not a risk estimate.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, bearingDeg, smallCircle, destination } from './astro.js';
import { personUnit } from './countrydetail.js';
import { cities } from './citydetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const KM_PER_DEG = 111.195;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
/** The planning distances, km: U.S. Nuclear Regulatory Commission (NRC) 10- and 50-mile zones and the 30 km exclusion zones. */
export const ZONES = [[16, 'emergency planning zone (10 miles)'], [30, 'Chernobyl and Fukushima exclusion distance'], [80, 'ingestion planning zone (50 miles)']];
// World electricity use per person, kWh a year: about 30,000 TWh made in 2023 (Ember, 2024) for 8.0 billion people.
export const KWH_PER_PERSON = 3_700;
/** A year's output in TWh at a capacity factor, and the people it could supply at the world's average use. */
export function yearOutput(mw, factor = 0.9) { const twh = (mw * 8766 * factor) / 1e6; return { twh, people: (twh * 1e9) / KWH_PER_PERSON }; }

export const nk = { key: null, n: null, fat: null, drift: null };
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=wind_speed_10m,wind_direction_10m,temperature_2m&timezone=auto`;

export function nuclearHtml(n) {
  return `<div class="nk" data-plant="${esc(n.id ?? n.name)}"><div id="nk-head"></div><div id="nk-zones"></div><div id="nk-wind"></div>
    <details class="qd-sec"><summary><span>Other plants within 300 km</span><small id="nk-near-sum"></small></summary><div id="nk-near"></div></details></div>`;
}
const set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };

export async function nuclearFill(n, { stillOpen, data, refresh }) {
  Object.assign(nk, { key: n.id ?? n.name, n, fat: null, drift: null }); refresh();
  const [list, w] = await Promise.all([cities().catch(() => []), getFeed('openmeteo', wxUrl(n.lat, n.lon), { ttl: 15 * 60_000 }).catch(() => null)]);
  if (!stillOpen()) return;
  const now = new Date().getUTCFullYear(); const mw = Number(n.capacityMW) || null;
  const yo = mw ? yearOutput(mw) : null; const big = (x) => (x >= 1e6 ? `${fmt(x / 1e6, 1)} million` : fmt(x));
  const life = n.opened ? `${n.closed && n.closed <= now ? `ran ${n.opened} to ${n.closed}` : `in service since ${n.opened}, ${now - n.opened} years`}${n.closed && n.closed > now ? `; due to close in ${n.closed}` : ''}` : '';
  set('nk-head', `<div class="ev-head tone-green"><span class="ev-g">${unitSvg('nuclear', 34)}</span><div><b class="ev-big">${mw ? `${fmt(mw)} MW` : esc(n.status ?? 'Nuclear site')}</b><span>${[n.status ? `${esc(n.status)}` : null, n.type && n.type !== 'plant' ? esc(n.type) : null, life].filter(Boolean).join(' · ')}</span></div></div>
    ${yo ? `<p class="cd-key">Running 90% of the time, as nuclear plants typically do, it makes about <b>${fmt(yo.twh, 1)} TWh</b> a year: the electricity of about <b>${big(yo.people)} people</b> at the world's average use.</p>` : ''}`);
  // people in the zones
  const near = list.map((c) => [c, haversineKm(n.lat, n.lon, c.lat, c.lng)]).filter(([, d]) => d <= 80).sort((a, b) => a[1] - b[1]);
  const rows = ZONES.map(([r, what]) => { const inR = near.filter(([, d]) => d <= r); return { r, what, n: inR.reduce((s, [c]) => s + (c.pop || 0), 0), names: inR.slice(0, 3).map(([c]) => c.name) }; });
  const top = rows.at(-1).n;
  if (top > 0) {
    const per = personUnit(top, 12);
    const figs = (x) => { const k = x / per; const whole = Math.floor(k); const part = k - whole; return Array.from({ length: whole + (part >= 0.1 ? 1 : 0) }, (_, i) => `<i class="cd-p tone-blue${i === whole ? ' part' : ''}" style="--i:${i}${i === whole ? `;--p:${Math.round(part * 100)}%` : ''}">${unitSvg('person', 16)}</i>`).join(''); };
    set('nk-zones', `<details class="qd-sec" open><summary><span>People in its planning zones</span><small>${fmt(top)} within 80 km</small></summary>
      ${rows.map((x) => `<div class="ev-ring"><span class="ev-rl">within <b>${x.r} km</b></span><span class="cd-people crow-u" role="img" aria-label="${fmt(x.n)} people">${figs(x.n)}</span><small>${x.n ? `${fmt(x.n)}${x.names.length ? ` (${esc(x.names.join(', '))})` : ''}` : 'no city on the map'} · ${esc(x.what)}</small></div>`).join('')}
      <p class="cd-key">One figure = ${per >= 1e6 ? `${fmt(per / 1e6)} million` : fmt(per)} people, counting the cities on the map. Planning distances, not a measure of risk.</p></details>`);
  } else set('nk-zones', '<p class="cd-key">No city on the map within 80 km.</p>');
  // the wind
  const cw = w?.current;
  if (cw?.wind_direction_10m != null && cw?.wind_speed_10m != null) {
    const to = (cw.wind_direction_10m + 180) % 360; const km3 = cw.wind_speed_10m * 3;
    nk.drift = { deg: to, km: Math.max(10, Math.min(250, km3)) };
    const down = list.map((c) => [c, haversineKm(n.lat, n.lon, c.lat, c.lng), bearingDeg(n.lat, n.lon, c.lat, c.lng)]).filter(([, d, b]) => d <= Math.max(30, km3) && Math.abs(((b - to + 540) % 360) - 180) <= 22.5).sort((a, b) => a[1] - b[1]);
    set('nk-wind', `<p class="ev-drift"><b>The air is moving ${dirWord(to)}</b> at ${fmt(cw.wind_speed_10m)} km/h: anything released now would travel about ${fmt(km3)} km in three hours${down.length ? `, toward <b>${esc(down[0][0].name)}</b> (${fmt(down[0][1])} km)` : ''}. The arrow on the globe shows it.</p>`);
  } else set('nk-wind', '');
  // neighbours
  const others = (data.nuclear ?? []).filter((x) => x !== n).map((x) => [x, haversineKm(n.lat, n.lon, x.lat, x.lon)]).filter(([, d]) => d <= 300).sort((a, b) => a[1] - b[1]);
  set('nk-near', others.length ? `<div class="lm-near">${others.slice(0, 12).map(([x, d]) => `<button class="chip" data-fly="${x.lat},${x.lon},0.3">${esc(x.name.replace(/ Nuclear Power (Plant|Station)$/i, ''))} <span>${fmt(d)} km</span></button>`).join('')}</div>` : '<p class="cd-key">None on the map.</p>');
  const s = document.getElementById('nk-near-sum'); if (s) s.textContent = others.length ? `${others.length}` : 'none';
  nk.fat?.obj?.geometry?.dispose?.(); nk.fat = null; refresh();
}

/** On the globe: the three planning rings and the wind arrow, in one draw call. */
export function nuclearOverlay(ctx, sel) {
  if (!nk.n || sel?.d !== nk.n) return { custom: [] };
  if (!nk.fat) {
    const { lat, lon } = nk.n; const lines = ZONES.map(([r], i) => ({ pts: smallCircle(lat, lon, r / KM_PER_DEG, 120), color: ['#ff8270', '#f2b84b', '#9ff0c9'][i], width: i === 0 ? 1.8 : 1.2, alt: 0.004 }));
    const d = nk.drift;
    if (d) { const end = destination(lat, lon, d.deg, d.km / KM_PER_DEG); const head = (d.km * 0.2) / KM_PER_DEG; lines.push({ pts: [[lat, lon], end], color: '#9fe3ff', width: 2.6, alt: 0.006 }); for (const t of [150, -150]) lines.push({ pts: [end, destination(end[0], end[1], d.deg + t, head)], color: '#9fe3ff', width: 2.6, alt: 0.006 }); }
    nk.fat = ctx.fatLines(lines, { opacity: 0.92 });
  }
  return { custom: [nk.fat] };
}
export function nuclearClose() { nk.fat?.obj?.geometry?.dispose?.(); Object.assign(nk, { key: null, n: null, fat: null, drift: null }); }
