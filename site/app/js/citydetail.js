// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one city in depth.
// Click a city name and its card becomes a city page: the weather now and through the next 24 hours, a ribbon
// of today's daylight with sunrise, sunset and the longest and shortest days of its year, its people as
// Isotype figures with its rank in its country and the world, the nearest airports and where you can fly
// nonstop, what the layers you have on show around it, and what lies on the exact opposite side of the Earth.
// On the globe the 100 km circle it counts within is drawn round it. Weather from Open-Meteo; everything
// else from data already in the site (Natural Earth, OurAirports, Virtual Radar Server routes).
import { getFeed, getLocal } from './feeds.js';
import { unitSvg, glyphSvg } from './icons.js';
import { haversineKm, bearingDeg, smallCircle } from './astro.js';
import { routesFrom } from './flightdb.js';
import { personUnit } from './countrydetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
const D2R = Math.PI / 180;
const RADIUS_KM = 100; // "around it" means within this distance
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ---------------------------------------------------------------- weather
// World Meteorological Organization (WMO) weather interpretation codes, as Open-Meteo returns them.
export function weatherWords(code) {
  const c = +code;
  if (c === 0) return 'Clear sky'; if (c === 1) return 'Mainly clear'; if (c === 2) return 'Partly cloudy'; if (c === 3) return 'Overcast';
  if (c === 45 || c === 48) return 'Fog'; if (c >= 51 && c <= 55) return 'Drizzle'; if (c === 56 || c === 57) return 'Freezing drizzle';
  if (c >= 61 && c <= 65) return c === 65 ? 'Heavy rain' : c === 61 ? 'Light rain' : 'Rain'; if (c === 66 || c === 67) return 'Freezing rain';
  if (c >= 71 && c <= 75) return c === 75 ? 'Heavy snow' : 'Snow'; if (c === 77) return 'Snow grains';
  if (c >= 80 && c <= 82) return 'Rain showers'; if (c === 85 || c === 86) return 'Snow showers'; if (c === 95) return 'Thunderstorm'; if (c === 96 || c === 99) return 'Thunderstorm with hail';
  return '—';
}
const weatherGlyph = (code) => { const c = +code; return c >= 95 ? 'storm' : c >= 71 && c <= 86 && !(c >= 80 && c <= 82) ? 'snow' : c >= 51 ? 'water' : c >= 45 && c <= 48 ? 'dust' : c >= 2 ? 'dust' : 'sun'; };
const owUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover,is_day&hourly=temperature_2m,precipitation_probability&daily=sunrise,sunset,uv_index_max,temperature_2m_max,temperature_2m_min&forecast_days=2&forecast_hours=24&timezone=auto`;

// ---------------------------------------------------------------- daylight
/** Hours of daylight at a latitude on a day when the Sun's declination is `dec` degrees (sunrise to sunset, with refraction). */
export function dayLength(lat, dec) {
  const c = (Math.sin(-0.833 * D2R) - Math.sin(lat * D2R) * Math.sin(dec * D2R)) / (Math.cos(lat * D2R) * Math.cos(dec * D2R));
  if (c <= -1) return 24; if (c >= 1) return 0;
  return (2 * Math.acos(c)) / D2R / 15;
}
const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
const hourOf = (iso) => { const m = /T(\d\d):(\d\d)/.exec(iso ?? ''); return m ? +m[1] + +m[2] / 60 : null; };
const clock = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
/** A 24-hour ribbon from local midnight: night dark, day light, with sunrise, sunset and now marked. */
export function dayRibbon(rise, set, now) {
  const pc = (h) => `${((h / 24) * 100).toFixed(2)}%`;
  const day = rise != null && set != null ? `<span class="cy-day" style="left:${pc(rise)};width:${pc(Math.max(0, set - rise))}"></span>` : '';
  return `<div class="cy-ribbon" role="img" aria-label="Daylight from ${rise != null ? clock(rise) : '—'} to ${set != null ? clock(set) : '—'}, local time now ${clock(now)}">
    ${day}<i class="cy-now" style="left:${pc(now)}"></i>
    </div><div class="cy-hours" aria-hidden="true">${[0, 6, 12, 18].map((h) => `<b style="left:${pc(h)}">${String(h).padStart(2, '0')}</b>`).join('')}</div>`;
}

/** The hourly temperature for the next day as a small line, with the rain chance as bars underneath. */
function hourly(h, W = 300, H = 64) {
  const t = h?.temperature_2m ?? []; if (t.length < 2) return '';
  const p = h.precipitation_probability ?? []; const lo = Math.min(...t); const hi = Math.max(...t);
  const sx = (i) => 6 + (i / (t.length - 1)) * (W - 12); const sy = (v) => 10 + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - 30);
  const line = t.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join('');
  const bars = p.map((v, i) => (v >= 20 ? `<rect x="${(sx(i) - 3).toFixed(1)}" y="${(H - 4 - (v / 100) * 16).toFixed(1)}" width="6" height="${((v / 100) * 16).toFixed(1)}" class="cy-rain"/>` : '')).join('');
  const iMax = t.indexOf(hi); const iMin = t.indexOf(lo);
  const lbl = (i, v, up) => `<text x="${sx(i).toFixed(1)}" y="${(sy(v) + (up ? -4 : 12)).toFixed(1)}" text-anchor="middle" class="cy-t">${fmt(v)}°</text>`;
  const hours = (h.time ?? []).map((s) => hourOf(s));
  const ticks = hours.map((x, i) => (x != null && x % 6 === 0 ? `<text x="${sx(i).toFixed(1)}" y="${H}" text-anchor="middle" class="cy-tick">${String(x).padStart(2, '0')}</text>` : '')).join('');
  return `<svg class="cy-hourly" viewBox="0 0 ${W} ${H + 2}" role="img" aria-label="Next 24 hours: ${fmt(lo)}° to ${fmt(hi)}°, rain chance up to ${fmt(Math.max(0, ...p))}%">${bars}<path d="${line}" class="cy-line"/>${lbl(iMax, hi, true)}${iMin !== iMax ? lbl(iMin, lo, false) : ''}${ticks}</svg>`;
}

// ---------------------------------------------------------------- the open city (shared with the globe)
export const cy = { key: null, c: null, ring: null };
let CITIES = null; let AIRPORTS = null;
async function cities() { CITIES ??= getLocal('data/cities.json').then((d) => d.rows.map(([name, lat, lng, pop, capital, cc]) => ({ name, lat, lng, pop, capital: !!capital, cc }))); return CITIES; }
async function airports() { AIRPORTS ??= getLocal('data/airports.json').then((d) => d.rows.map(([iata, icao, name, lat, lng, elev, city, cc, large]) => ({ iata, icao, name, lat, lng, city, cc, large: !!large }))); return AIRPORTS; }

export function cityHtml(c) {
  return `<div class="cy" data-city="${esc(c.name)}">
    <p class="cd-line" id="cy-line"></p>
    <div class="cy-now-box" id="cy-weather"><div class="lm-fact skel"></div></div>
    <div id="cy-sun"></div>
    <div id="cy-people"></div>
    <details class="qd-sec" open><summary><span>Getting there</span><small id="cy-fly-sum"></small></summary><div id="cy-fly"><p class="muted">Finding the nearest airports…</p></div></details>
    <details class="qd-sec" open><summary><span>Within ${RADIUS_KM} km</span><small id="cy-around-sum"></small></summary><div id="cy-around"></div></details>
    <details class="qd-sec"><summary><span>The other side of the Earth</span><small id="cy-anti-sum"></small></summary><div id="cy-anti"></div></details>
  </div>`;
}

/** Fill the city page. */
export async function cityFill(c, { stillOpen, data, countryAt, refresh }) {
  Object.assign(cy, { key: `${c.name}|${c.lat}|${c.lng}`, c, ring: null }); refresh();
  const [list, aps, w] = await Promise.all([cities().catch(() => []), airports().catch(() => []), getFeed('openmeteo', owUrl(c.lat, c.lng), { ttl: 15 * 60_000 }).catch(() => null)]);
  if (!stillOpen()) return;
  const country = countryAt(c.lat, c.lng); const cname = country?.properties?.name; const cc = country?.properties?.['ISO3166-1-Alpha-2'] ?? c.cc;
  const off = w?.utc_offset_seconds; const localNow = off != null ? new Date(Date.now() + off * 1000) : null; const nowH = localNow ? localNow.getUTCHours() + localNow.getUTCMinutes() / 60 : null;
  const line = document.getElementById('cy-line');
  if (line) line.innerHTML = `${c.capital ? 'Capital of ' : ''}${cname ? `<button class="linkish" data-country-cc="${esc(cc)}">${esc(cname)}</button>` : esc(c.cc ?? '')}${nowH != null ? ` · <b>${clock(nowH)}</b> there now${w?.timezone_abbreviation ? ` (${esc(w.timezone_abbreviation)})` : ''}` : ''}`;
  // weather now
  const wEl = document.getElementById('cy-weather');
  if (wEl) {
    const cur = w?.current; const d = w?.daily;
    wEl.innerHTML = cur ? `<div class="cy-wx"><span class="cy-wx-g tone-${cur.is_day ? 'ochre' : 'blue'}">${unitSvg(weatherGlyph(cur.weather_code), 34)}</span>
        <div><b class="cy-temp">${fmt(cur.temperature_2m)}°C</b><span>${esc(weatherWords(cur.weather_code))}${cur.apparent_temperature != null && Math.abs(cur.apparent_temperature - cur.temperature_2m) >= 2 ? `, feels like ${fmt(cur.apparent_temperature)}°` : ''}</span></div>
        <dl class="cy-wx-dl"><dt>Today</dt><dd>${d ? `${fmt(d.temperature_2m_min?.[0])}° to ${fmt(d.temperature_2m_max?.[0])}°` : '—'}</dd><dt>Wind</dt><dd>${fmt(cur.wind_speed_10m)} km/h${cur.wind_gusts_10m ? `, gusts ${fmt(cur.wind_gusts_10m)}` : ''}</dd><dt>Humidity</dt><dd>${fmt(cur.relative_humidity_2m)}%</dd>${d?.uv_index_max?.[0] != null ? `<dt>UV index</dt><dd>${fmt(d.uv_index_max[0], 1)}</dd>` : ''}</dl></div>
      ${hourly(w.hourly)}` : '<p class="muted">Open-Meteo did not answer, so there is no weather for now.</p>';
  }
  // daylight
  const sEl = document.getElementById('cy-sun');
  if (sEl) {
    const rise = hourOf(w?.daily?.sunrise?.[0]); const set = hourOf(w?.daily?.sunset?.[0]);
    const today = rise != null && set != null ? set - rise : null; const tomorrow = hourOf(w?.daily?.sunset?.[1]) - hourOf(w?.daily?.sunrise?.[1]);
    const jun = dayLength(c.lat, 23.44); const dec = dayLength(c.lat, -23.44); const longest = Math.max(jun, dec); const shortest = Math.min(jun, dec);
    const delta = Number.isFinite(tomorrow) && today != null ? Math.round((tomorrow - today) * 60) : null;
    sEl.innerHTML = `<details class="qd-sec" open><summary><span>Daylight</span><small>${today != null ? hm(today) : '—'} today</small></summary>
      ${nowH != null ? dayRibbon(rise, set, nowH) : ''}
      <p>${rise != null ? `Sunrise <b>${clock(rise)}</b>, sunset <b>${clock(set)}</b>${delta ? `; tomorrow is ${Math.abs(delta)} minute${Math.abs(delta) === 1 ? '' : 's'} ${delta > 0 ? 'longer' : 'shorter'}` : ''}. ` : ''}Its longest day has ${longest >= 24 ? 'no sunset at all' : hm(longest)} of daylight and its shortest ${shortest <= 0 ? 'no sunrise at all' : hm(shortest)}.</p></details>`;
  }
  // people and rank
  const pEl = document.getElementById('cy-people');
  if (pEl && c.pop) {
    const byPop = [...list].sort((a, b) => b.pop - a.pop); const world = 1 + byPop.findIndex((x) => x.name === c.name && x.lat === c.lat);
    const inCc = byPop.filter((x) => x.cc === c.cc); const local = 1 + inCc.findIndex((x) => x.name === c.name && x.lat === c.lat);
    const per = personUnit(c.pop, 12); const n = c.pop / per; const whole = Math.floor(n); const part = n - whole;
    const figs = Array.from({ length: whole + (part >= 0.1 ? 1 : 0) }, (_, i) => `<i class="cd-p tone-blue${i === whole ? ' part' : ''}" style="--i:${i}${i === whole ? `;--p:${Math.round(part * 100)}%` : ''}">${unitSvg('person', 20)}</i>`).join('');
    const unit = per >= 1e6 ? `${fmt(per / 1e6)} million` : fmt(per);
    pEl.innerHTML = `<details class="qd-sec" open><summary><span>People</span><small>${fmt(c.pop)}</small></summary>
      <div class="cd-people crow-u" role="img" aria-label="${fmt(c.pop)} people">${figs}</div>
      <p class="cd-key">One figure = ${unit} people · the whole metropolitan area${world > 0 ? ` · ${ordinal(world)} of the ${fmt(list.length)} cities on the map` : ''}${local > 0 && inCc.length > 1 ? `, ${ordinal(local)} in its country` : ''}</p></details>`;
  }
  // airports
  const near = aps.map((a) => ({ ...a, km: haversineKm(c.lat, c.lng, a.lat, a.lng) })).filter((a) => a.km < 250).sort((a, b) => (b.large - a.large) || a.km - b.km).slice(0, 3).sort((a, b) => a.km - b.km);
  const main = near.find((a) => a.large) ?? near[0];
  const legs = main?.icao ? await routesFrom(main.icao).catch(() => null) : null; if (!stillOpen()) return;
  const fEl = document.getElementById('cy-fly');
  if (fEl) {
    fEl.innerHTML = near.length ? `<ul class="cy-aps">${near.map((a) => `<li><button class="chip" data-fly="${a.lat},${a.lng},0.25">${esc(a.iata || a.icao)}</button><span><b>${esc(a.name)}</b><small>${fmt(a.km)} km ${esc(dirWord(bearingDeg(c.lat, c.lng, a.lat, a.lng)))}${a === main && legs?.length ? ` · ${fmt(legs.length)} nonstop destinations in ${fmt(new Set(legs.map((l) => l.to.cc)).size)} countries` : ''}</small></span></li>`).join('')}</ul>
      ${legs?.length ? `<p class="cd-key">Farthest nonstop from ${esc(main.iata || main.icao)}: ${esc((() => { const f = legs.map((l) => [l, haversineKm(main.lat, main.lng, l.to.lat, l.to.lng)]).sort((x, y) => y[1] - x[1])[0]; return `${f[0].to.city || f[0].to.name}, ${fmt(f[1])} km`; })())}. Switch on Airports and click it to see every route.</p>` : ''}`
      : '<p class="cd-key">No airport with scheduled flights within 250 km.</p>';
    const s = document.getElementById('cy-fly-sum'); if (s) s.textContent = main ? `${main.iata || main.icao}, ${fmt(main.km)} km` : 'none near';
  }
  // around it
  fillAround(c, data);
  // the antipode
  const aLat = -c.lat; const aLng = c.lng > 0 ? c.lng - 180 : c.lng + 180; const land = countryAt(aLat, aLng);
  const closest = list.map((x) => [x, haversineKm(aLat, aLng, x.lat, x.lng)]).sort((a, b) => a[1] - b[1])[0];
  const aEl = document.getElementById('cy-anti');
  if (aEl) {
    aEl.innerHTML = `<p>Dig straight down through the centre of the Earth, 12,742 km, and you come out at ${Math.abs(aLat).toFixed(2)}° ${aLat >= 0 ? 'N' : 'S'}, ${Math.abs(aLng).toFixed(2)}° ${aLng >= 0 ? 'E' : 'W'}: ${land ? `on land, in <b>${esc(land.properties.name)}</b>` : '<b>open ocean</b>'}. ${closest ? `The nearest city there is ${esc(closest[0].name)}, ${fmt(closest[1])} km away.` : ''} Only about 4% of the land has land on its other side.</p>
      <button class="btn ghost" data-fly="${aLat.toFixed(3)},${aLng.toFixed(3)},1.6">Fly to the other side</button>`;
    const s = document.getElementById('cy-anti-sum'); if (s) s.textContent = land ? land.properties.name : 'ocean';
  }
}

/** What the layers you have on show within RADIUS_KM of the city. */
export function aroundCounts(c, data, now = Date.now()) {
  const near = (lat, lng) => lat != null && Math.abs(lat - c.lat) < RADIUS_KM / 100 && haversineKm(c.lat, c.lng, lat, lng) <= RADIUS_KM;
  const out = [];
  if (data.quakes) { const q = data.quakes.filter((f) => now - f.properties.time < 7 * 86400_000 && haversineKm(c.lat, c.lng, f.geometry.coordinates[1], f.geometry.coordinates[0]) <= 300); out.push({ glyph: 'quake', tone: 'red', n: q.length, label: q.length === 1 ? 'earthquake within 300 km this week' : 'earthquakes within 300 km this week', layer: 'quakes' }); }
  const ac = data.aircraft?.ac; if (ac) { const n = ac.reduce((k, a) => k + (!a.ground && near(a.lat, a.lng) ? 1 : 0), 0); out.push({ glyph: 'plane', tone: 'blue', n, label: n === 1 ? 'plane overhead now' : 'planes overhead now', layer: 'aircraft' }); }
  const cams = data.cameras?.cams; if (cams) { const n = cams.reduce((k, x) => k + (near(x.lat, x.lng) ? 1 : 0), 0); out.push({ glyph: 'camera', tone: 'ink', n, label: n === 1 ? 'live camera' : 'live cameras', layer: 'cameras' }); }
  const lms = (data.landmarks ?? []).filter((l) => near(l.lat, l.lng)).map((l) => [l, haversineKm(c.lat, c.lng, l.lat, l.lng)]).sort((a, b) => a[1] - b[1]);
  return { counts: out, landmarks: lms };
}
function fillAround(c, data) {
  const el = document.getElementById('cy-around'); if (!el) return;
  const { counts, landmarks } = aroundCounts(c, data);
  const rows = counts.map((x) => `<button class="crow fact tone-${x.tone}" data-cd-layer="${x.layer}"><span class="crow-l">${esc(x.label)}</span><b>${fmt(x.n)}</b><span class="crow-u">${unitSvg(x.glyph, 18)}</span><small>${x.n ? 'show them' : 'none right now'}</small></button>`).join('');
  const lm = landmarks.slice(0, 8).map(([l, km]) => `<button class="chip" data-landmark="${esc(l.title)}">${glyphSvg('pin', '#d6a243', 16)}${esc(l.title)} <span>${km < 10 ? km.toFixed(1) : fmt(km)} km</span></button>`).join('');
  el.innerHTML = `${rows ? `<div class="facts">${rows}</div>` : '<p class="cd-key">Switch on Earthquakes, Live flights or Cameras to count them here.</p>'}${lm ? `<div class="lm-near"><small>Landmarks</small>${lm}</div>` : ''}`;
  const s = document.getElementById('cy-around-sum'); if (s) s.textContent = [landmarks.length ? `${landmarks.length} landmark${landmarks.length === 1 ? '' : 's'}` : null, ...counts.filter((x) => x.n).map((x) => `${fmt(x.n)} ${x.label.split(' ')[0]}`)].filter(Boolean).join(', ');
}

/** On the globe: the circle the page counts within, in one draw call. */
export function cityOverlay(ctx, sel) {
  if (!cy.c || sel?.d !== cy.c) return { custom: [] };
  cy.ring ??= ctx.fatLines([{ pts: smallCircle(cy.c.lat, cy.c.lng, RADIUS_KM / 111.195, 120).map(([a, b]) => [a, b]), color: '#f2c66d', width: 1.6, alt: 0.004 }], { opacity: 0.85 });
  return { custom: [cy.ring] };
}
export function cityClose() { cy.ring?.obj?.geometry?.dispose?.(); Object.assign(cy, { key: null, c: null, ring: null }); }
