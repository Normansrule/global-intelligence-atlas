// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the air people are breathing, everywhere, in depth.
//
// The globe: about 400 places (every capital, then the biggest cities at least 160 km apart) coloured by the US Air
// Quality Index (AQI) now. One batched request to the Open-Meteo air-quality API (Copernicus Atmosphere Monitoring
// Service, CAMS, models) fills them all; when the browser cannot reach it, the live-data snapshot (air.json, written by
// tools/fetch-live.mjs every hour) is used instead.
// The page for a place: the index now in words, who should act and what to do, the main pollutant, each pollutant
// against the World Health Organization (WHO) guideline, the fine-particle dose as cigarettes, the next five days hour
// by hour with the cleanest hours to be outside, ultraviolet (UV) and desert dust, pollen in Europe, and fires nearby
// that can add smoke. Any spot on the ground gets the same short answer in "Here now" (airProbe).
import { getFeed, getLocal, getSnapshot } from './feeds.js';
import { haversineKm } from './astro.js';
import { GLYPHS } from './icons.js';
import { US_BANDS, usBand, euBand, POLLUTANTS, SUB_INDEX, POLLEN, pollenLevel, cigarettes, mainPollutant, uvWords, airSites, CURRENT, AQ_BASE, batchUrl, batchRows } from './aqi.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const HOUR = 3_600_000;
const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
let regionNames = null;
const country = (cc) => { if (!cc) return ''; try { regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(cc) ?? cc; } catch { return cc; } };

if (typeof document !== 'undefined' && !document.querySelector('link[data-sense]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/sense.css', import.meta.url).href; l.dataset.sense = '1'; document.head.appendChild(l); }

// A round badge with three breeze lines for air quality (added here so icons.js stays untouched).
GLYPHS.air ??= [
  ['M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6z', 'c'],
  ['M5.6 9.2h8.6a2 2 0 1 0-2-2h-1.6a3.6 3.6 0 1 1 3.6 3.6H5.6zM5.6 12.2h11.6a2.3 2.3 0 1 1-2.3 2.3h1.6a.7.7 0 1 0 .7-.7H5.6zM5.6 15.4h5.8v1.6H5.6z', 'd'],
];

// ------------------------------------------------------------------ the detailed record for one place
const HOURLY = ['us_aqi', 'european_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'dust', 'uv_index', ...Object.values(SUB_INDEX), ...POLLEN.map((p) => p[0])];
export const detailUrl = (lat, lng) => `${AQ_BASE}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=${[...CURRENT, ...Object.values(SUB_INDEX), ...POLLEN.map((p) => p[0])].join(',')}&hourly=${HOURLY.join(',')}&forecast_days=5&past_days=1&timezone=auto`;

/** The hour index of "now" in an hourly block, the hours of the next five days and the cleanest daylight hours. */
export function outlook(rec, now = Date.now()) {
  const h = rec?.hourly; if (!h?.time?.length) return null;
  const off = (rec.utc_offset_seconds ?? 0) * 1000;
  const t = h.time.map((s) => Date.parse(`${s}:00Z`) - off); // local wall-clock strings → real instants
  let i0 = t.findIndex((x) => x > now) - 1; if (i0 < 0) i0 = 0;
  const hours = []; for (let i = i0; i < t.length; i += 1) hours.push({ t: t[i], local: h.time[i], aqi: h.us_aqi?.[i] ?? null, pm25: h.pm2_5?.[i] ?? null, uv: h.uv_index?.[i] ?? null });
  // the cleanest hours between 7:00 and 21:00 local today and tomorrow
  const day = (s) => s.slice(0, 10); const today = day(h.time[i0]);
  const awake = hours.filter((x) => { const hr = +x.local.slice(11, 13); return hr >= 7 && hr <= 21 && x.aqi != null; });
  const bestOf = (d) => { const xs = awake.filter((x) => day(x.local) === d); return xs.length ? xs.reduce((a, b) => (b.aqi < a.aqi ? b : a)) : null; };
  const tomorrow = hours.find((x) => day(x.local) !== today)?.local.slice(0, 10);
  // yesterday at the same hour, for "better or worse than this time yesterday"
  const yi = i0 - 24; const yesterday = yi >= 0 ? h.us_aqi?.[yi] ?? null : null;
  const peak = hours.slice(0, 24).reduce((a, b) => (b.aqi != null && (a == null || b.aqi > a.aqi) ? b : a), null);
  return { hours, best: { today: bestOf(today), tomorrow: tomorrow ? bestOf(tomorrow) : null }, yesterday, peak, i0 };
}

/** An SVG strip: one bar per hour for five days, coloured by the US AQI band, with day labels. */
export function stripSvg(hours, { w = 300, h = 64 } = {}) {
  const xs = hours.slice(0, 120); if (!xs.length) return '';
  const max = Math.max(100, ...xs.map((x) => x.aqi ?? 0)); const bw = w / xs.length;
  const bars = xs.map((x, i) => { if (x.aqi == null) return ''; const bh = Math.max(1.5, (x.aqi / max) * (h - 16)); return `<rect x="${(i * bw).toFixed(2)}" y="${(h - 14 - bh).toFixed(2)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${bh.toFixed(2)}" fill="${usBand(x.aqi)[2]}"><title>${esc(x.local.replace('T', ' '))} · AQI ${Math.round(x.aqi)}</title></rect>`; }).join('');
  const days = xs.map((x, i) => [x, i]).filter(([x], i) => i === 0 || x.local.slice(11, 13) === '00').map(([x, i]) => `<line x1="${(i * bw).toFixed(1)}" x2="${(i * bw).toFixed(1)}" y1="0" y2="${h - 12}" class="aq-day"/><text x="${(i * bw + 2).toFixed(1)}" y="${h - 2}">${i === 0 ? 'Now' : esc(new Date(`${x.local}:00Z`).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }))}</text>`).join('');
  // the guide lines at 50 and 100 (good / moderate)
  const g = (v) => (v <= max ? `<line x1="0" x2="${w}" y1="${(h - 14 - (v / max) * (h - 16)).toFixed(1)}" y2="${(h - 14 - (v / max) * (h - 16)).toFixed(1)}" class="aq-guide"/>` : '');
  return `<svg class="aq-strip" viewBox="0 0 ${w} ${h}" role="img" aria-label="US Air Quality Index for the next five days, hour by hour">${g(50)}${g(100)}${bars}${days}</svg>`;
}

/** The gauge: a half ring with the band colours and a needle at the index. */
export function gaugeSvg(aqi) {
  const R = 52; const cx = 64; const cy = 62; const max = 300;
  const pt = (v, r = R) => { const a = Math.PI * (1 - Math.min(v, max) / max); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  let from = 0;
  const arcs = US_BANDS.map(([to, , c]) => { const a = pt(from); const b = pt(Math.min(to, max)); from = Math.min(to, max); return `<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)} A${R} ${R} 0 0 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}" stroke="${c}"/>`; }).join('');
  const n = pt(aqi ?? 0, R - 12); const b = usBand(aqi);
  return `<svg class="aq-gauge" viewBox="0 0 128 72" aria-hidden="true"><g class="aq-arcs">${arcs}</g>${aqi != null ? `<line class="aq-needle" x1="${cx}" y1="${cy}" x2="${n[0].toFixed(1)}" y2="${n[1].toFixed(1)}" style="--c:${b[2]};--from:${(-180 * Math.min(aqi, max) / max).toFixed(0)}deg"/><circle cx="${cx}" cy="${cy}" r="4" fill="${b[2]}"/>` : ''}</svg>`;
}

const barHtml = ([k, short, long, guide, what], v) => {
  if (v == null) return '';
  const x = v / guide; const pct = Math.min(100, (x / 3) * 100); const cls = x <= 1 ? 'ok' : x <= 2 ? 'warn' : 'bad';
  const shown = k === 'carbon_monoxide' ? `${fmt(v / 1000, 2)} mg/m³` : `${fmt(v, 1)} µg/m³`;
  return `<div class="aq-bar ${cls}" title="${esc(what)}"><span><b>${esc(short)}</b> ${esc(long)}</span><i style="--w:${pct.toFixed(1)}%"></i><small>${shown} · ${x < 0.1 ? 'well under' : `${fmt(x, 1)}×`} the WHO guideline</small></div>`;
};

/** Plain words for why the main pollutant is high here and now. */
function whyLine(main, c, fires) {
  if (!main) return '';
  const k = main[0];
  if (k === 'ozone') return 'Ozone is the main pollutant: sunlight cooks traffic and industrial fumes into it, so it is usually worst on sunny afternoons and lowest at dawn.';
  if ((k === 'pm10' || k === 'pm2_5') && c.dust > 50) return `Desert dust (${fmt(c.dust)} µg/m³) is carried here on the wind, which is why the particle level is high.`;
  if (k === 'pm2_5' && fires >= 10) return `Fine particles are the main pollutant, and ${fires} fire hotspots within 300 km are likely adding smoke.`;
  if (k === 'pm2_5') return 'Fine particles are the main pollutant: smoke and exhaust from traffic, heating, industry and burning, often trapped near the ground on still, cold mornings.';
  if (k === 'nitrogen_dioxide') return 'Nitrogen dioxide is the main pollutant: road traffic is the biggest source, so it peaks in rush hours.';
  if (k === 'sulphur_dioxide') return 'Sulphur dioxide is the main pollutant: coal or oil burning, smelters, shipping or a volcano upwind.';
  return `${main[2]} is the main pollutant here now.`;
}

/** The fires layer's hotspots within `km` (only when that layer has loaded). */
const firesNear = (lat, lng, data, km = 300) => { const fs = data?.fires?.rows ?? []; let n = 0; if (Array.isArray(fs)) for (const f of fs) { const a = f.lat ?? f[0]; const b = f.lng ?? f.lon ?? f[1]; if (a == null || Math.abs(a - lat) > 3) continue; if (haversineKm(lat, lng, a, b) < km) n += 1; } return n; };

/** The whole page body for one place, from a detailed record. */
export function airHtml(rec, { fires = 0, name = '' } = {}) {
  const c = rec?.current ?? {}; const b = usBand(c.us_aqi); const eu = euBand(c.european_aqi); const main = mainPollutant(c);
  const o = outlook(rec); const cig = cigarettes(c.pm2_5);
  const trend = o?.yesterday != null && c.us_aqi != null ? (c.us_aqi - o.yesterday > 8 ? `worse than this time yesterday (${Math.round(o.yesterday)})` : o.yesterday - c.us_aqi > 8 ? `better than this time yesterday (${Math.round(o.yesterday)})` : 'about the same as this time yesterday') : '';
  const best = (x, when) => (x ? `<li><b>${when} ${esc(x.local.slice(11, 16))}</b> · AQI ${Math.round(x.aqi)} ${esc(usBand(x.aqi)[1].toLowerCase())}</li>` : '');
  const pollen = POLLEN.map(([k, label]) => [label, c[k]]).filter(([, v]) => v != null && v >= 1);
  return `<div class="aq-head" style="--c:${b ? b[2] : '#888'}">${gaugeSvg(c.us_aqi)}<div><b class="aq-num">${c.us_aqi != null ? Math.round(c.us_aqi) : '—'}</b><span class="aq-word">${esc(b ? b[1] : 'No reading')}</span><small>US Air Quality Index${eu ? ` · European ${Math.round(c.european_aqi)} ${esc(eu[1].toLowerCase())}` : ''}</small></div></div>
    ${b ? `<p class="aq-advice"><b>${esc(b[3])}</b> · ${esc(b[4])}</p>` : ''}
    <div class="aq-figs">
      ${cig != null ? `<div class="aq-fig" title="Muller and Muller (2015): breathing 22 µg/m³ of fine particles for a day is roughly like smoking one cigarette"><b>${cig < 0.1 ? '<0.1' : fmt(cig, 1)}</b><small>cigarettes a day, in fine particles</small></div>` : ''}
      ${main ? `<div class="aq-fig"><b>${esc(main[1])}</b><small>main pollutant</small></div>` : ''}
      ${c.uv_index != null ? `<div class="aq-fig"><b>${fmt(c.uv_index, 1)}</b><small>UV index, ${esc(uvWords(c.uv_index))}${o?.peak?.uv != null ? '' : ''}</small></div>` : ''}
      ${c.dust != null && c.dust >= 5 ? `<div class="aq-fig"><b>${fmt(c.dust)}</b><small>µg/m³ desert dust</small></div>` : ''}
    </div>
    ${trend ? `<p class="aq-trend">Now ${esc(trend)}.</p>` : ''}
    ${o ? `<h4>Next five days</h4>${stripSvg(o.hours)}<ul class="aq-best">${best(o.best.today, 'Cleanest today')}${best(o.best.tomorrow, 'Cleanest tomorrow')}${o.peak?.aqi != null ? `<li><b>Worst in 24 h ${esc(o.peak.local.slice(11, 16))}</b> · AQI ${Math.round(o.peak.aqi)}</li>` : ''}</ul>` : ''}
    <p class="aq-why">${esc(whyLine(main, c, fires))}</p>
    <details class="aq-more"><summary>Every pollutant against the WHO guideline${pollen.length ? ', and pollen' : ''}</summary>
      <div class="aq-bars">${POLLUTANTS.map((p) => barHtml(p, c[p[0]])).join('')}</div>
      ${pollen.length ? `<h4>Pollen now</h4><div class="aq-pollen">${pollen.map(([label, v]) => `<span class="chip">${esc(label)} <b>${esc(pollenLevel(v))}</b> <small>${fmt(v)} grains/m³</small></span>`).join('')}</div>` : ''}
      <p class="muted">Model values for the ${esc(name || 'area')} at about 10 to 40 km resolution, not a street-level sensor. Guidelines: WHO (2021), 24-hour levels (8-hour for ozone). Index: US EPA (2024). Data: Open-Meteo, from the Copernicus Atmosphere Monitoring Service (CAMS).</p>
    </details>`;
}

/** "Here now" for any spot on the ground: one line and a button to the full page. */
export async function airProbe(lat, lng, el, stillHere) {
  if (!el) return;
  try {
    const r = await getFeed('openmeteoaq', `${AQ_BASE}?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&current=us_aqi,pm2_5,european_aqi`, { ttl: HOUR / 2 });
    if (!stillHere()) return;
    const b = usBand(r.current?.us_aqi); if (!b) { el.textContent = ''; return; }
    el.innerHTML = `<p class="aq-probe" style="--c:${b[2]}"><i></i>Air: <b>${Math.round(r.current.us_aqi)} ${esc(b[1].toLowerCase())}</b> on the US index · ${fmt(r.current.pm2_5, 1)} µg/m³ fine particles <button class="btn ghost" data-air="${lat.toFixed(3)},${lng.toFixed(3)}">The air here in depth</button></p>`;
  } catch { if (stillHere()) el.textContent = ''; }
}

export function airLayer(api) {
  let sites = [];
  // "The air here in depth" in Here now opens a page for that spot
  if (typeof document !== 'undefined' && api.select) document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-air]'); if (!b) return; const [lat, lng] = b.dataset.air.split(',').map(Number); api.select({ layer: 'air', d: { name: 'this spot', lat, lng, cc: '', v: null, here: true } }); });
  const fillPage = async (d, stillOpen) => {
    const box = api.$('#aq-body'); if (!box) return;
    try {
      const rec = await getFeed('openmeteoaq', detailUrl(d.lat, d.lng), { ttl: HOUR / 2 });
      if (!stillOpen()) return;
      box.innerHTML = airHtml(rec, { fires: firesNear(d.lat, d.lng, api.state?.data), name: d.name });
    } catch {
      if (!stillOpen()) return;
      // the snapshot row still gives the index now
      box.innerHTML = d.v ? airHtml({ current: Object.fromEntries(CURRENT.map((k, i) => [k, d.v[i]])) }, { name: d.name }) + '<p class="muted">The hour-by-hour forecast needs the Open-Meteo air-quality service, which is not answering right now.</p>' : '<p class="err">The Open-Meteo air-quality service is not answering right now.</p>';
    }
  };
  return {
    id: 'air', group: 'science', label: 'Air quality', swatch: '#5fc77a', refresh: HOUR,
    sources: ['openmeteoaq', 'cams', 'epaaqi2024', 'who2021aq', 'muller2015'],
    pin: 'air',
    legend: US_BANDS.map(([, label, c]) => ['air', label, c]),
    async load() {
      if (!sites.length) sites = airSites((await getLocal('data/cities.json')).rows);
      const rows = new Array(sites.length).fill(null);
      try {
        const chunks = []; for (let i = 0; i < sites.length; i += 100) chunks.push(i);
        await Promise.all(chunks.map(async (i) => { const part = batchRows(await getFeed('openmeteoaq', batchUrl(sites.slice(i, i + 100)), { ttl: HOUR / 2, timeout: 25_000 })); part.forEach((r, j) => { rows[i + j] = r; }); }));
      } catch {
        // the hourly snapshot: rows keyed by position
        const s = await getSnapshot('openmeteoaq', 'air.json', { ttl: HOUR / 2 });
        const by = new Map((s.rows ?? []).map((r) => [`${r[0]},${r[1]}`, r.slice(2)]));
        sites.forEach((x, i) => { rows[i] = rows[i] ?? by.get(`${x.lat},${x.lng}`) ?? null; });
      }
      return sites.map((x, i) => ({ ...x, v: rows[i] })).filter((x) => x.v && x.v[0] != null);
    },
    channels(list) {
      return {
        points: list.map((d) => { const b = usBand(d.v[0]); return { lat: d.lat, lng: d.lng, alt: 0.006 + Math.min(d.v[0], 300) / 300 * 0.03, r: 0.18 + Math.min(d.v[0], 300) / 300 * 0.22, color: b[2], tip: tip(`${d.name} · AQI ${Math.round(d.v[0])}`, `${b[1]} · PM2.5 ${fmt(d.v[2], 1)} µg/m³`), ref: { layer: 'air', d } }; }),
        rings: list.filter((d) => d.v[0] > 150).map((d) => ({ lat: d.lat, lng: d.lng, color: usBand(d.v[0])[2], maxR: 1.6, speed: 0.6, period: 2400 })),
      };
    },
    describe(d) {
      const b = usBand(d.v?.[0]);
      return {
        title: d.here ? 'The air here' : `Air in ${d.name}`, sub: [b ? `${b[1]} now` : '', country(d.cc)].filter(Boolean).join(' · '),
        probe: [d.lat, d.lng],
        html: '<div id="aq-body" class="aq"><div class="aq-head skel"></div><div class="aq-figs"><div class="aq-fig skel"></div><div class="aq-fig skel"></div><div class="aq-fig skel"></div></div></div>',
        links: [{ label: 'Open-Meteo', url: `https://open-meteo.com/en/docs/air-quality-api#latitude=${d.lat}&longitude=${d.lng}` }, { label: 'CAMS', url: 'https://atmosphere.copernicus.eu/charts/packages/cams/' }],
        fill: (stillOpen) => fillPage(d, stillOpen),
      };
    },
    learn: {
      what: 'The air people are breathing right now in about 400 places: every capital and the biggest cities, coloured by the US Air Quality Index (green good, yellow moderate, orange unhealthy for sensitive groups, red unhealthy, purple very unhealthy, maroon hazardous). Taller dots are worse air; red and worse ones pulse. Click one for its page: who should act and what to do, the main pollutant and why, each pollutant against the World Health Organization (WHO) guideline, the fine-particle dose as cigarettes, the next five days hour by hour with the cleanest hours to go out, ultraviolet (UV) light, desert dust and, in Europe, pollen.',
      how: 'The values come from the Copernicus Atmosphere Monitoring Service (CAMS) global and European air-quality models, served by Open-Meteo: a forecast model with satellite and ground data folded in, at about 40 km worldwide and 10 km in Europe, so treat it as the air over the area, not one street. The US index is worked out from each pollutant with the US Environmental Protection Agency (EPA) breakpoints and the worst one wins. Cigarettes follow Muller and Muller (2015): 22 µg/m³ of fine particles for a day is about one cigarette.',
      try: 'Turn it on with Fires and look at the smoke around big fires; find a city where ozone is the main pollutant and watch its five-day strip rise every afternoon; click any spot on the ground and open "The air here in depth".',
      refs: ['openmeteoaq', 'cams', 'epaaqi2024', 'who2021aq', 'muller2015'],
    },
  };
}
