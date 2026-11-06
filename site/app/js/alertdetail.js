// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one disaster alert in depth.
// Click a Global Disaster Alert and Coordination System (GDACS) alert and its card becomes an alert page:
//   the alert     its level on the green, orange and red scale with what that level means, the hazard's own
//                 measure, and how long it has been going;
//   what counts   what GDACS weighs for this kind of hazard to set the level;
//   people        the people living within the distances that matter for this hazard, drawn as Isotype figures,
//                 with the towns named;
//   the same event on the other layers: the earthquake's own page, or the storm, volcano, fire or flood from
//                 NASA's Earth Observatory Natural Event Tracker (EONET);
//   the weather there now, and the other alerts within 1,000 km.
// On the globe: the distance rings, in the alert's colour, in one draw call. People come from the cities on the
// map; the countryside adds more.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, smallCircle } from './astro.js';
import { personUnit } from './countrydetail.js';
import { weatherWords, cities } from './citydetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const KM_PER_DEG = 111.195;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Each hazard: its name, glyph, the distances people are counted within (km), what GDACS weighs, and the matching EONET category. */
export const HAZARD = {
  EQ: { word: 'Earthquake', g: 'quake', rings: [50, 100], weighs: 'the magnitude and depth, and how many people live where the shaking is strong enough to damage buildings', eonet: null },
  TC: { word: 'Tropical cyclone', g: 'storm', rings: [100, 300], weighs: 'the strongest winds, the storm surge and the rain, against the people living in their path', eonet: 'severeStorms' },
  FL: { word: 'Flood', g: 'water', rings: [50, 100], weighs: 'how long the water stays, how large an area it covers and how many people live there', eonet: 'floods' },
  VO: { word: 'Volcano', g: 'volcano', rings: [10, 30, 100], weighs: 'the size of the eruption and the people living on and around the volcano', eonet: 'volcanoes' },
  WF: { word: 'Wildfire', g: 'flame', rings: [25, 50], weighs: 'the area burned and the people living close to the fire', eonet: 'wildfires' },
  DR: { word: 'Drought', g: 'drought', rings: [300, 500], weighs: 'how dry it is, for how long, over how large an area, and how many people farm or live there', eonet: 'drought' },
};
/** The three levels and what each means, in GDACS's own terms: whether the country is likely to need help from abroad. */
export const LEVELS = [['Green', '#3fb68b', 'No international help expected'], ['Orange', '#ff9f43', 'International help may be needed'], ['Red', '#ff3b30', 'International help likely needed']];
export const levelOf = (l) => Math.max(0, LEVELS.findIndex(([n]) => n === l));
/** GDACS dates come without a time zone; they are UTC. */
export const gdacsTime = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : NaN);
/** How long an alert has run, in words. */
export function spanWords(from, to, now = Date.now()) {
  const a = gdacsTime(from); const b = Math.min(gdacsTime(to) || now, now); if (!Number.isFinite(a)) return '';
  const h = Math.max(0, (b - a) / 3600_000);
  if (h < 1) return 'a single moment';
  if (h < 48) return `${fmt(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  const d = h / 24; return d < 60 ? `${fmt(d)} days` : `${fmt(d / 30.44)} months`;
}
/** The same event on another layer: the earthquake within 100 km and a day, or the EONET event of the same kind nearby. */
export function sameEvent(a, data) {
  const t = gdacsTime(a.from);
  if (a.type === 'EQ') {
    const q = (data.quakes ?? []).map((x) => [x, haversineKm(a.lat, a.lng, x.geometry.coordinates[1], x.geometry.coordinates[0])])
      .filter(([x, d]) => d <= 100 && (!Number.isFinite(t) || Math.abs((x.properties?.time ?? t) - t) <= 86400_000)).sort((p, q2) => p[1] - q2[1])[0];
    return q ? { layer: 'quakes', id: q[0].id, km: q[1], what: `M${fmt(q[0].properties?.mag ?? 0, 1)} ${q[0].properties?.place ?? 'earthquake'}` } : null;
  }
  const cat = HAZARD[a.type]?.eonet; if (!cat) return null;
  const reach = a.type === 'TC' ? 800 : a.type === 'DR' ? 1000 : 200;
  const e = (data.events ?? []).filter((x) => x.categories?.[0]?.id === cat).map((x) => {
    const pts = (x.geometry ?? []).filter((g) => g.type === 'Point'); const last = pts.at(-1)?.coordinates; if (!last) return null;
    const nameHit = a.name && x.title && a.name.split(/[\s-]+/).some((w) => w.length > 3 && /[A-Z]{4,}/.test(w) && x.title.toUpperCase().includes(w));
    return [x, haversineKm(a.lat, a.lng, last[1], last[0]), nameHit];
  }).filter((r) => r && (r[2] || r[1] <= reach)).sort((p, q2) => (q2[2] - p[2]) || p[1] - q2[1])[0];
  return e ? { layer: 'events', id: e[0].id, km: e[1], what: e[0].title } : null;
}

export const al = { key: null, a: null, fat: null };
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto`;
const set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };

export function alertHtml(a) {
  const hz = HAZARD[a.type] ?? { word: a.type, g: 'alert', weighs: '' }; const lv = levelOf(a.level); const span = spanWords(a.from, a.to);
  const head = `<div class="ev-head dz-lv${lv}"><span class="ev-g">${unitSvg(hz.g, 34)}</span><div><b class="ev-big">${esc(a.level)} alert</b><span>${[esc(hz.word), a.sev ? esc(a.sev) : null, span && span !== 'a single moment' ? `for ${span}` : null].filter(Boolean).join(' · ')}</span></div></div>`;
  const scale = `<div class="dz-scale" role="img" aria-label="${esc(a.level)} on the green, orange and red scale">${LEVELS.map(([n, c, w], i) => `<div class="dz-step${i === lv ? ' on' : ''}" style="--c:${c}"><b>${n}</b><small>${w}</small></div>`).join('')}</div>
    ${hz.weighs ? `<p class="cd-key">For ${esc(hz.word.toLowerCase())}s GDACS weighs ${esc(hz.weighs)}. A small hazard where many people live can outrank a large one where few do.</p>` : ''}`;
  return `<div class="dz" data-alert="${esc(a.id)}"><div id="dz-head">${head}${scale}</div><div id="dz-same"></div><div id="dz-people"></div><div id="dz-wx"></div>
    <details class="qd-sec"><summary><span>Other alerts within 1,000 km</span><small id="dz-near-sum"></small></summary><div id="dz-near"></div></details></div>`;
}

export async function alertFill(a, { stillOpen, data, refresh }) {
  Object.assign(al, { key: a.id, a, fat: null }); refresh();
  const [list, w] = await Promise.all([cities().catch(() => []), getFeed('openmeteo', wxUrl(a.lat, a.lng), { ttl: 15 * 60_000 }).catch(() => null)]);
  if (!stillOpen()) return;
  const hz = HAZARD[a.type] ?? { rings: [100] };
  // the same event elsewhere on the map
  const same = sameEvent(a, data);
  set('dz-same', same ? `<p class="dz-same">${same.layer === 'quakes' ? 'The earthquake itself' : 'The same event, tracked by NASA'}: <button class="linkish" data-cd-layer="${same.layer}" ${same.layer === 'quakes' ? `data-cd-quake="${esc(same.id)}"` : `data-cd-event="${esc(same.id)}"`}>${esc(same.what)}</button>${same.km >= 5 ? ` <small>${fmt(same.km)} km away</small>` : ''}</p>` : '');
  // people within the distances that matter for this hazard
  const near = list.map((c) => [c, haversineKm(a.lat, a.lng, c.lat, c.lng)]).filter(([, d]) => d <= hz.rings.at(-1)).sort((p, q) => p[1] - q[1]);
  const rows = hz.rings.map((r) => { const inR = near.filter(([, d]) => d <= r); return { r, n: inR.reduce((s, [c]) => s + (c.pop || 0), 0), names: inR.slice(0, 3).map(([c]) => c.name) }; });
  const top = rows.at(-1).n;
  if (top > 0) {
    const per = personUnit(top, 12);
    const figs = (x) => { const k = x / per; const whole = Math.floor(k); const part = k - whole; return Array.from({ length: whole + (part >= 0.1 ? 1 : 0) }, (_, i) => `<i class="cd-p tone-blue${i === whole ? ' part' : ''}" style="--i:${i}${i === whole ? `;--p:${Math.round(part * 100)}%` : ''}">${unitSvg('person', 16)}</i>`).join(''); };
    set('dz-people', `<details class="qd-sec" open><summary><span>People near it</span><small>${fmt(top)} within ${fmt(hz.rings.at(-1))} km</small></summary>
      ${rows.map((x) => `<div class="ev-ring"><span class="ev-rl">within <b>${fmt(x.r)} km</b></span><span class="cd-people crow-u" role="img" aria-label="${fmt(x.n)} people">${figs(x.n)}</span><small>${x.n ? `${fmt(x.n)}${x.names.length ? ` (${esc(x.names.join(', '))})` : ''}` : 'no city on the map'}</small></div>`).join('')}
      <p class="cd-key">One figure = ${per >= 1e6 ? `${fmt(per / 1e6)} million` : fmt(per)} people, counting the cities on the map.</p></details>`);
  } else set('dz-people', `<p class="cd-key">No city on the map within ${fmt(hz.rings.at(-1))} km${a.type === 'TC' ? ': the storm is still over open sea' : ''}.</p>`);
  // the weather there now
  const cur = w?.current;
  set('dz-wx', cur ? `<div class="cy-wx ev-wx"><div><b class="cy-temp">${fmt(cur.temperature_2m)}°C</b><span>${esc(weatherWords(cur.weather_code))} there now</span></div>
      <dl class="cy-wx-dl"><dt>Wind</dt><dd>${fmt(cur.wind_speed_10m)} km/h from the ${dirWord(cur.wind_direction_10m ?? 0)}${cur.wind_gusts_10m ? `, gusts ${fmt(cur.wind_gusts_10m)}` : ''}</dd><dt>Rain</dt><dd>${fmt(cur.precipitation ?? 0, 1)} mm in the last hour</dd></dl></div>` : '');
  // the other alerts nearby
  const others = (data.alerts ?? []).filter((x) => x !== a && x.id !== a.id).map((x) => [x, haversineKm(a.lat, a.lng, x.lat, x.lng)]).filter(([, d]) => d <= 1000).sort((p, q) => p[1] - q[1]);
  set('dz-near', others.length ? `<div class="lm-near">${others.slice(0, 12).map(([x, d]) => `<button class="chip dz-chip dz-lv${levelOf(x.level)}" data-cd-layer="alerts" data-cd-alert="${esc(x.id)}">${unitSvg(HAZARD[x.type]?.g ?? 'alert', 14)} ${esc(x.name)} <span>${fmt(d)} km</span></button>`).join('')}</div>` : '<p class="cd-key">None at the moment.</p>');
  const s = document.getElementById('dz-near-sum'); if (s) s.textContent = others.length ? `${others.length}` : 'none';
  al.fat?.obj?.geometry?.dispose?.(); al.fat = null; refresh();
}

/** On the globe: the hazard's distance rings in the alert's colour, in one draw call. */
export function alertOverlay(ctx, sel) {
  if (!al.a || sel?.d !== al.a) return { custom: [] };
  if (!al.fat) {
    const a = al.a; const rings = HAZARD[a.type]?.rings ?? [100]; const color = LEVELS[levelOf(a.level)][1];
    al.fat = ctx.fatLines(rings.map((r, i) => ({ pts: smallCircle(a.lat, a.lng, r / KM_PER_DEG, 120), color, width: i === 0 ? 2 : 1.3, alt: 0.004 })), { opacity: 0.9 });
  }
  return { custom: [al.fat] };
}
export function alertClose() { al.fat?.obj?.geometry?.dispose?.(); Object.assign(al, { key: null, a: null, fat: null }); }
