// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one natural event in depth.
// Click a storm, volcano, wildfire, iceberg or flood from NASA's Earth Observatory Natural Event Tracker (EONET)
// and its card becomes an event page. Every page says where it is (the country as a button, the nearest city),
// how long it has been going and when it was last reported, the weather there now, and the people living near
// it as Isotype figures. Then each kind adds its own:
//   storms     the category on the Saffir-Simpson scale, the wind over its life, how fast and which way it is
//              moving, how far it has come; the track on the globe coloured by strength;
//   volcanoes  the people within 10, 30 and 100 km (the distances volcanologists count), and which way the ash
//              would drift with the wind 5.5 km up; the rings and an arrow on the globe;
//   wildfires  its size, the fire weather (wind, humidity, rain chance), which way it would spread, and the
//              satellite hotspots burning near it now;
//   ice        an iceberg's size against places you know.
// Weather from Open-Meteo; everything else from the event and data already in the site.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, bearingDeg, smallCircle, destination } from './astro.js';
import { personUnit } from './countrydetail.js';
import { weatherWords, cities } from './citydetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const KM_PER_DEG = 111.195;
const ago = (ms) => { const h = ms / 3600_000; const m = Math.max(1, Math.round(h * 60)); return h < 1 ? `${m} minute${m === 1 ? '' : 's'} ago` : h < 48 ? `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`; };
const dayMonth = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

// ---------------------------------------------------------------- what kind of event
export const kindOf = (e) => e?.categories?.[0]?.id ?? 'manmade';
const KIND_WORD = { wildfires: 'Wildfire', severeStorms: 'Storm', volcanoes: 'Volcano', seaLakeIce: 'Ice', floods: 'Flood', drought: 'Drought', dustHaze: 'Dust and haze', landslides: 'Landslide', snow: 'Snow', tempExtremes: 'Temperature extreme', manmade: 'Human-made event', waterColor: 'Water colour' };
/** How far out "near it" reaches for each kind, in km (volcanoes use the three distances volcanologists count people within). */
export const RINGS = { volcanoes: [10, 30, 100], wildfires: [25, 50], severeStorms: [300], seaLakeIce: [], default: [100] };
const ringsFor = (k) => RINGS[k] ?? RINGS.default;

/** The fixes of an event that are points, oldest first: { lat, lng, t, v (magnitude), unit }. */
export function fixesOf(e) {
  return (e?.geometry ?? []).filter((g) => g.type === 'Point').map((g) => ({ lat: g.coordinates[1], lng: g.coordinates[0], t: Date.parse(g.date), v: g.magnitudeValue ?? null, unit: g.magnitudeUnit ?? null })).sort((a, b) => a.t - b.t);
}
const lastOf = (e) => { const f = fixesOf(e).at(-1); if (f) return f; const p = (e?.geometry ?? []).find((g) => g.type === 'Polygon'); return p ? { lat: p.coordinates[0][0][1], lng: p.coordinates[0][0][0], t: Date.parse(p.date), v: p.magnitudeValue ?? null, unit: p.magnitudeUnit ?? null } : null; };

// ---------------------------------------------------------------- storms
// Saffir-Simpson Hurricane Wind Scale (Schott et al., 2019), on one-minute sustained wind in knots, with the
// two steps below it the forecasters use. Colours are the ones storm maps use for each step.
export const SSHWS = [
  { min: 0, short: 'TD', name: 'Tropical depression', color: '#5ebaff' },
  { min: 34, short: 'TS', name: 'Tropical storm', color: '#00d5cf' },
  { min: 64, short: '1', name: 'Category 1', color: '#ffe36e' },
  { min: 83, short: '2', name: 'Category 2', color: '#ffc140' },
  { min: 96, short: '3', name: 'Category 3', color: '#ff8f20' },
  { min: 113, short: '4', name: 'Category 4', color: '#ff6060' },
  { min: 137, short: '5', name: 'Category 5', color: '#c464d9' },
];
/** The step of the scale a sustained wind in knots falls on (index into SSHWS). */
export const stormStep = (kt) => { let i = 0; for (let k = 0; k < SSHWS.length; k++) if (kt >= SSHWS[k].min) i = k; return i; };
/** What a strong tropical storm is called where it is: hurricane, typhoon or cyclone. */
export function basinWord(lat, lng) {
  if (lat >= 0 && lng >= 100 && lng <= 180) return 'typhoon';
  if (lat >= 0 && (lng < -20 || lng > 180)) return 'hurricane';
  return 'cyclone';
}
const ktToKmh = (kt) => kt * 1.852;

/** Speed (km/h) and heading (degrees) between the last two fixes, if they are apart in time. */
export function motion(fixes) {
  if (fixes.length < 2) return null;
  const a = fixes.at(-2); const b = fixes.at(-1); const h = (b.t - a.t) / 3600_000; if (!(h > 0)) return null;
  return { kmh: haversineKm(a.lat, a.lng, b.lat, b.lng) / h, deg: bearingDeg(a.lat, a.lng, b.lat, b.lng) };
}
const pathKm = (fixes) => fixes.reduce((s, f, i) => (i ? s + haversineKm(fixes[i - 1].lat, fixes[i - 1].lng, f.lat, f.lng) : 0), 0);

/** The wind over the storm's life as a line over the coloured steps of the scale. */
function windChart(fixes, W = 300, H = 110) {
  const pts = fixes.filter((f) => f.v != null); if (pts.length < 2) return '';
  const t0 = pts[0].t; const t1 = pts.at(-1).t; const top = Math.max(80, ...pts.map((p) => p.v)) * 1.1;
  const sx = (t) => 4 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 8); const sy = (v) => 6 + (1 - v / top) * (H - 22);
  const bands = SSHWS.map((s, i) => { const lo = s.min; const hi = SSHWS[i + 1]?.min ?? top; if (lo >= top) return ''; const y1 = sy(Math.min(hi, top)); const y2 = sy(lo); return `<rect x="4" y="${y1.toFixed(1)}" width="${W - 8}" height="${(y2 - y1).toFixed(1)}" fill="${s.color}" opacity="0.22"/>${y2 - y1 >= 9 ? `<text x="${W - 6}" y="${(y2 - 2).toFixed(1)}" text-anchor="end" class="ev-band">${s.short}</text>` : ''}`; }).join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)} ${sy(p.v).toFixed(1)}`).join('');
  const peak = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]);
  const dots = pts.map((p) => `<circle cx="${sx(p.t).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.4" fill="${SSHWS[stormStep(p.v)].color}" class="ev-dot"/>`).join('');
  return `<svg class="ev-wind" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wind from ${fmt(pts[0].v)} to ${fmt(pts.at(-1).v)} knots, peak ${fmt(peak.v)} on ${dayMonth(peak.t)}">${bands}<path d="${line}" class="ev-line"/>${dots}
    <text x="4" y="${H - 2}" class="ev-tick">${esc(dayMonth(t0))}</text><text x="${W - 4}" y="${H - 2}" text-anchor="end" class="ev-tick">${esc(dayMonth(t1))}</text></svg>`;
}
/** The scale as a strip of seven steps with the storm's step marked. */
function scaleStrip(step) {
  return `<div class="ev-scale" role="img" aria-label="${esc(SSHWS[step].name)} on the Saffir-Simpson scale">${SSHWS.map((s, i) => `<span class="${i === step ? 'on' : ''}" style="--c:${s.color}">${s.short}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- sizes
/** An area in km² against something you can picture. */
export function areaWords(km2) {
  if (!(km2 > 0)) return '';
  if (km2 < 2) return `about ${fmt(km2 / 0.00714)} football pitches`;
  if (km2 < 59 * 1.5) return `${fmt(km2 / 59, 1)} times the size of Manhattan`;
  if (km2 < 1572 * 1.5) return `${fmt(km2 / 1572, 1)} times the size of Greater London`;
  return `${fmt(km2 / 30_689, 2)} times the size of Belgium`;
}
/** An EONET magnitude as an area in km², when it is one (acres for fires, square nautical miles for ice). */
export function areaKm2(v, unit) {
  if (v == null) return null; const u = String(unit ?? '').toLowerCase();
  if (u.startsWith('acre')) return v * 0.004047; if (u === 'nm^2' || u === 'nm2') return v * 3.4299; if (u === 'km^2' || u === 'km2') return v; if (u === 'ha' || u.startsWith('hectare')) return v / 100;
  return null;
}

// ---------------------------------------------------------------- the open event (shared with the globe)
export const ev = { key: null, e: null, fat: null, drift: null };
const owUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=precipitation_probability,wind_speed_500hPa,wind_direction_500hPa&forecast_hours=24&timezone=auto`;

export function eventHtml(e) {
  const k = kindOf(e);
  return `<div class="ev" data-event="${esc(e.id)}" data-kind="${esc(k)}">
    <p class="cd-line" id="ev-line"></p>
    <div id="ev-main"></div>
    <div class="cy-now-box" id="ev-weather"><div class="lm-fact skel"></div></div>
    <div id="ev-people"></div>
    <details class="qd-sec"><summary><span>Reports</span><small id="ev-rep-sum"></small></summary><div id="ev-reports"></div></details>
  </div>`;
}

/** Fill the event page. */
export async function eventFill(e, { stillOpen, data, countryAt, refresh }) {
  const k = kindOf(e); const fixes = fixesOf(e); const last = lastOf(e); if (!last) return;
  Object.assign(ev, { key: e.id, e, fat: null, drift: null });
  const [list, w] = await Promise.all([cities().catch(() => []), getFeed('openmeteo', owUrl(last.lat, last.lng), { ttl: 15 * 60_000 }).catch(() => null)]);
  if (!stillOpen()) return;
  const cur = w?.current;
  // where, and how long
  const country = countryAt(last.lat, last.lng); const cname = country?.properties?.name; const cc = country?.properties?.['ISO3166-1-Alpha-2'];
  const near = list.map((c) => [c, haversineKm(last.lat, last.lng, c.lat, c.lng)]).sort((a, b) => a[1] - b[1]);
  const first = fixes[0]?.t ?? last.t; const days = Math.max(0, Math.floor((Date.now() - first) / 86400_000));
  const nc = near[0]; const ncTxt = nc ? (nc[1] < 15 ? `at ${esc(nc[0].name)}` : `${fmt(nc[1])} km ${dirWord(bearingDeg(nc[0].lat, nc[0].lng, last.lat, last.lng))} of ${esc(nc[0].name)}`) : '';
  const line = document.getElementById('ev-line');
  if (line) line.innerHTML = `${esc(KIND_WORD[k] ?? 'Event')} ${cname ? `in <button class="linkish" data-country-cc="${esc(cc)}">${esc(cname)}</button>` : 'over open water'}${ncTxt ? `, ${ncTxt}` : ''} · ${days ? `going for <b>${days} day${days === 1 ? '' : 's'}</b>` : 'reported <b>today</b>'}${Number.isFinite(last.t) ? ` · last report ${ago(Date.now() - last.t)}` : ''}`;
  // the kind's own section
  const main = document.getElementById('ev-main');
  let drift = null; // { deg (toward), kmh, km, what, color }
  if (main && k === 'severeStorms') {
    const v = last.v != null && /kt/i.test(last.unit ?? 'kts') ? last.v : null; const step = v != null ? stormStep(v) : null;
    const word = basinWord(last.lat, last.lng); const m = motion(fixes); const peak = fixes.filter((f) => f.v != null).reduce((a, f) => (!a || f.v > a.v ? f : a), null);
    const name = step == null ? 'Storm' : step >= 2 ? `${SSHWS[step].name} ${word}` : SSHWS[step].name;
    main.innerHTML = `<div class="ev-head tone-blue"><span class="ev-g">${unitSvg('storm', 34)}</span><div><b class="ev-big">${v != null ? `${fmt(v)} knots` : '—'}</b><span>${esc(name)}${v != null ? ` · ${fmt(ktToKmh(v))} km/h sustained wind` : ''}</span></div></div>
      ${step != null ? scaleStrip(step) : ''}
      ${windChart(fixes)}
      <p class="cd-key">${m ? `Moving <b>${dirWord(m.deg)}</b> at ${fmt(m.kmh)} km/h. ` : ''}${fixes.length > 1 ? `It has come ${fmt(pathKm(fixes))} km since ${esc(dayMonth(first))}. ` : ''}${peak && fixes.length > 1 ? `Strongest so far: ${fmt(peak.v)} knots (${esc(SSHWS[stormStep(peak.v)].name)}) on ${esc(dayMonth(peak.t))}.` : ''}</p>`;
    ev.drift = null;
  } else if (main && k === 'volcanoes') {
    const i = 0; const ws = w?.hourly?.wind_speed_500hPa?.[i]; const wd = w?.hourly?.wind_direction_500hPa?.[i];
    if (ws != null && wd != null) drift = { deg: (wd + 180) % 360, kmh: ws, km: Math.max(20, Math.min(300, ws * 3)), color: '#d6a243' };
    main.innerHTML = `<div class="ev-head tone-red"><span class="ev-g">${unitSvg('volcano', 34)}</span><div><b class="ev-big">${w?.elevation != null ? `${fmt(w.elevation)} m` : '—'}</b><span>ground height at the reported spot</span></div></div>
      ${drift ? `<p class="ev-drift"><b>Ash would drift ${dirWord(drift.deg)}</b>, carried at ${fmt(drift.kmh)} km/h by the wind 5.5 km up (the 500 hectopascal level). The arrow on the globe shows where it would reach in 3 hours.</p>` : ''}`;
  } else if (main && k === 'wildfires') {
    const km2 = areaKm2(last.v, last.unit); const fires = data.fires?.rows ?? null;
    const hot = fires ? fires.filter((r) => Math.abs(r[0] - last.lat) < 0.5 && haversineKm(last.lat, last.lng, r[0], r[1]) <= 25) : null;
    if (cur?.wind_direction_10m != null && cur?.wind_speed_10m != null) drift = { deg: (cur.wind_direction_10m + 180) % 360, kmh: cur.wind_speed_10m, km: Math.max(10, Math.min(150, cur.wind_speed_10m * 3)), color: '#e2563b' };
    const rain = Math.max(0, ...(w?.hourly?.precipitation_probability ?? [0]));
    const dry = cur ? (cur.relative_humidity_2m < 30 && cur.wind_speed_10m >= 20 ? 'Dangerous fire weather: dry air and strong wind.' : cur.relative_humidity_2m < 30 ? 'Dry air helps it burn.' : cur.wind_speed_10m >= 30 ? 'Strong wind can carry it fast.' : 'Calm, damp weather slows it.') : '';
    main.innerHTML = `<div class="ev-head tone-red"><span class="ev-g">${unitSvg('flame', 34)}</span><div><b class="ev-big">${km2 ? `${fmt(km2, km2 < 10 ? 1 : 0)} km²` : 'Burning'}</b><span>${km2 ? `${fmt(last.v)} ${esc(last.unit)} burned, ${esc(areaWords(km2))}` : 'size not reported yet'}</span></div></div>
      ${cur ? `<p class="ev-drift">${esc(dry)} ${drift ? `<b>Smoke and flames would spread ${dirWord(drift.deg)}</b> on a ${fmt(drift.kmh)} km/h wind; humidity ${fmt(cur.relative_humidity_2m)}%, rain chance in the next 24 hours up to ${fmt(rain)}%.` : ''}</p>` : ''}
      ${hot ? `<button class="crow fact tone-red" data-cd-layer="fires"><span class="crow-l">satellite fire hotspots within 25 km, last 24 hours</span><b>${fmt(hot.length)}</b><span class="crow-u">${Array.from({ length: Math.min(40, Math.max(1, hot.length)) }, (_, i) => `<i style="--i:${i}">${unitSvg('flame', 16)}</i>`).join('')}</span><small>${hot.length ? 'show them' : 'none'}</small></button>` : '<button class="crow fact tone-red" data-cd-layer="fires"><span class="crow-l">Switch on fire hotspots to count the satellite detections near it</span><b>·</b><span class="crow-u">' + unitSvg('flame', 18) + '</span><small>show them</small></button>'}`;
  } else if (main) {
    const km2 = areaKm2(last.v, last.unit);
    main.innerHTML = km2 ? `<div class="ev-head tone-blue"><span class="ev-g">${unitSvg(k === 'seaLakeIce' ? 'ice' : 'water', 34)}</span><div><b class="ev-big">${fmt(km2, km2 < 10 ? 1 : 0)} km²</b><span>${esc(areaWords(km2))}</span></div></div>` : '';
  }
  ev.drift = drift;
  // the weather there
  const wEl = document.getElementById('ev-weather');
  if (wEl) wEl.innerHTML = cur ? `<div class="cy-wx ev-wx"><div><b class="cy-temp">${fmt(cur.temperature_2m)}°C</b><span>${esc(weatherWords(cur.weather_code))} there now</span></div>
      <dl class="cy-wx-dl"><dt>Wind</dt><dd>${fmt(cur.wind_speed_10m)} km/h from the ${dirWord(cur.wind_direction_10m ?? 0)}${cur.wind_gusts_10m ? `, gusts ${fmt(cur.wind_gusts_10m)}` : ''}</dd><dt>Humidity</dt><dd>${fmt(cur.relative_humidity_2m)}%</dd></dl></div>` : '<p class="muted">Open-Meteo did not answer, so there is no weather for now.</p>';
  // people near it
  const pEl = document.getElementById('ev-people'); const rings = ringsFor(k);
  if (pEl && rings.length) {
    const rows = rings.map((r) => { const inR = near.filter(([, d]) => d <= r); return { r, n: inR.reduce((s, [c]) => s + (c.pop || 0), 0), towns: inR.length, names: inR.slice(0, 3).map(([c]) => c.name) }; });
    const top = rows.at(-1).n;
    if (top > 0) {
      const per = personUnit(top, 12);
      const figs = (n) => { const x = n / per; const whole = Math.floor(x); const part = x - whole; return Array.from({ length: whole + (part >= 0.1 ? 1 : 0) }, (_, i) => `<i class="cd-p tone-blue${i === whole ? ' part' : ''}" style="--i:${i}${i === whole ? `;--p:${Math.round(part * 100)}%` : ''}">${unitSvg('person', 16)}</i>`).join(''); };
      pEl.innerHTML = `<details class="qd-sec" open><summary><span>People near it</span><small>${fmt(top)} within ${fmt(rows.at(-1).r)} km</small></summary>
        ${rows.map((x) => `<div class="ev-ring"><span class="ev-rl">within <b>${fmt(x.r)} km</b></span><span class="cd-people crow-u" role="img" aria-label="${fmt(x.n)} people">${figs(x.n)}</span><small>${x.n ? `${fmt(x.n)} in ${fmt(x.towns)} ${x.towns === 1 ? 'city' : 'cities'}${x.names.length ? ` (${esc(x.names.join(', '))})` : ''}` : 'no city on the map'}</small></div>`).join('')}
        <p class="cd-key">One figure = ${per >= 1e6 ? `${fmt(per / 1e6)} million` : fmt(per)} people, counting the cities on the map; the countryside adds more. The rings are drawn on the globe.</p></details>`;
    } else pEl.innerHTML = `<details class="qd-sec" open><summary><span>People near it</span><small>none on the map</small></summary><p class="cd-key">No city on the map within ${fmt(rings.at(-1))} km${nc ? `; the nearest is ${esc(nc[0].name)}, ${fmt(nc[1])} km away` : ''}.</p></details>`;
  }
  // the reports
  const rEl = document.getElementById('ev-reports');
  if (rEl) {
    const n = (e.geometry ?? []).length;
    rEl.innerHTML = `<p class="cd-key">${fmt(n)} report${n === 1 ? '' : 's'} from satellites and agencies${Number.isFinite(first) ? `, the first on ${esc(dayMonth(first))}` : ''}. ${(e.sources ?? []).length ? `Reported by ${(e.sources ?? []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.id)}</a>`).join(', ')}.` : ''}</p>${e.description ? `<p>${esc(e.description)}</p>` : ''}`;
    const s = document.getElementById('ev-rep-sum'); if (s) s.textContent = `${fmt(n)}`;
  }
  ev.fat?.obj?.geometry?.dispose?.(); ev.fat = null; // rebuilt with the drift arrow now that the wind is known
  refresh();
}

/** On the globe: the rings people are counted within, a storm's track coloured by strength and the drift arrow, in one draw call. */
export function eventOverlay(ctx, sel) {
  if (!ev.e || sel?.d !== ev.e) return { custom: [] };
  if (!ev.fat) {
    const e = ev.e; const k = kindOf(e); const last = lastOf(e); const lines = [];
    for (const r of ringsFor(k)) lines.push({ pts: smallCircle(last.lat, last.lng, r / KM_PER_DEG, 120), color: '#f2c66d', width: r === ringsFor(k).at(-1) ? 1.6 : 1.1, alt: 0.004 });
    if (k === 'severeStorms') {
      const f = fixesOf(e);
      for (let i = 1; i < f.length; i++) lines.push({ pts: [[f[i - 1].lat, f[i - 1].lng], [f[i].lat, f[i].lng]], color: SSHWS[stormStep(f[i].v ?? 0)].color, width: 3.2, alt: 0.006 });
    }
    const d = ev.drift;
    if (d) {
      const end = destination(last.lat, last.lng, d.deg, d.km / KM_PER_DEG); const head = (d.km * 0.22) / KM_PER_DEG;
      lines.push({ pts: [[last.lat, last.lng], end], color: d.color, width: 2.6, alt: 0.006 });
      for (const s of [150, -150]) lines.push({ pts: [end, destination(end[0], end[1], d.deg + s, head)], color: d.color, width: 2.6, alt: 0.006 });
    }
    ev.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.92 }) : null;
  }
  return { custom: ev.fat ? [ev.fat] : [] };
}
export function eventClose() { ev.fat?.obj?.geometry?.dispose?.(); Object.assign(ev, { key: null, e: null, fat: null, drift: null }); }
