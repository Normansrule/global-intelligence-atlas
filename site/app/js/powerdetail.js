// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one power station in depth.
// Click a power plant and its card becomes a plant page:
//   the plant     its power, owner and age;
//   how hard it runs   what it actually made in a year against what it could make flat out (its capacity factor),
//                 beside what plants of its kind typically manage, and the people that output could supply;
//   right now     for wind and solar, how hard it is likely running at this moment, from the wind at hub height
//                 or the sunshine there now (an estimate from the weather, not a meter reading);
//   carbon        its yearly greenhouse gas over the whole life cycle, against every other kind of power, and in cars;
//   its country   the country's plants by fuel as one bar, and where this plant ranks;
//   neighbours    the other power plants within 50 km.
// On the globe: a 50 km ring and a line to each neighbour in its fuel's colour, in one draw call.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, smallCircle } from './astro.js';
import { KWH_PER_PERSON } from './nucleardetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const KM_PER_DEG = 111.195;
export const NEAR_KM = 50;
/** Typical capacity factors, % (U.S. Energy Information Administration, Electric Power Monthly, 2023 averages, rounded). */
export const TYPICAL_CF = { Nuclear: 93, Coal: 42, Gas: 57, Oil: 13, Hydro: 36, Wind: 33, Solar: 23, Geothermal: 70, Biomass: 58, Waste: 63 };
/** Life-cycle greenhouse gas, grams of carbon dioxide equivalent per kWh, medians (Schlömer et al., 2014, IPCC). */
export const LIFE_CO2 = { Coal: 820, Gas: 490, Biomass: 230, Solar: 48, Geothermal: 38, Hydro: 24, Nuclear: 12, Wind: 11 };
/** A typical passenger car, tonnes of carbon dioxide a year (U.S. Environmental Protection Agency, 2023). */
export const CAR_T = 4.6;
const HOURS = 8766;

/** Capacity factor: what a plant made in a year as a share of running flat out all year. */
export const capacityFactor = (mw, gwh) => (mw > 0 && gwh > 0 ? Math.min(1, (gwh * 1000) / (mw * HOURS)) : null);
/** A year's greenhouse gas, tonnes of carbon dioxide equivalent: GWh × g/kWh gives tonnes. */
export const yearCo2 = (gwh, fuel) => (LIFE_CO2[fuel] != null && gwh > 0 ? gwh * LIFE_CO2[fuel] : null);
/** A typical modern wind turbine's share of its rated power at a hub-height wind speed in m/s: nothing below 3 m/s,
 *  rising with the cube of the wind to full power at 12 m/s, shut down above 25 m/s to protect it. */
export function windShare(ms) { if (!(ms >= 3) || ms > 25) return 0; if (ms >= 12) return 1; return (ms ** 3 - 27) / (12 ** 3 - 27); }
/** A solar farm's share of its rated power from the sunshine on flat ground, W/m² (panels are rated at 1,000 W/m²). */
export const solarShare = (wm2) => Math.max(0, Math.min(1, (wm2 ?? 0) / 1000));

export const pw = { key: null, p: null, fat: null, near: [] };
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=wind_speed_100m,shortwave_radiation,cloud_cover,is_day&wind_speed_unit=ms&timezone=auto`;
const set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
const big = (x) => (x >= 1e6 ? `${fmt(x / 1e6, 1)} million` : x >= 10_000 ? fmt(Math.round(x / 1000) * 1000) : fmt(x));
/** Pale fuel colours (wind, solar, nuclear) are deepened toward the ink so they show on a light panel. */
export function inkable(hex) { const n = parseInt(String(hex).slice(1), 16); const l = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; return l > 0.7 ? `color-mix(in srgb, ${hex} 55%, var(--ink))` : hex; }
const meter = (share, color, label) => `<span class="pw-meter" role="img" aria-label="${esc(label)}"><i style="width:${Math.round(share * 100)}%;background:${color}"></i></span>`;

export function powerHtml(p) {
  return `<div class="pw" data-plant="${esc(p.name)}"><div id="pw-head"></div><div id="pw-run"></div><div id="pw-now"></div><div id="pw-co2"></div><div id="pw-mix"></div>
    <details class="qd-sec"><summary><span>Other plants within ${NEAR_KM} km</span><small id="pw-near-sum"></small></summary><div id="pw-near"></div></details></div>`;
}

export async function powerFill(p, { stillOpen, data, refresh, FUEL, FUEL_GLYPH }) {
  Object.assign(pw, { key: `${p.name}@${p.lat},${p.lng}`, p, fat: null, near: [] });
  const live = p.fuel === 'Wind' || p.fuel === 'Solar';
  const w = live ? await getFeed('openmeteo', wxUrl(p.lat, p.lng), { ttl: 15 * 60_000 }).catch(() => null) : null;
  if (!stillOpen()) return;
  const color = inkable(FUEL[p.fuel] ?? '#ccc'); const now = new Date().getUTCFullYear(); const year = Number(p.year) || null;
  set('pw-head', `<div class="ev-head" style="--tone:${color}"><span class="ev-g">${unitSvg(FUEL_GLYPH[p.fuel] ?? 'bolt', 34)}</span><div><b class="ev-big">${fmt(p.mw)} MW</b><span>${[`${esc(p.fuel)} power station`, p.owner ? esc(p.owner) : null, year ? `since ${year}, ${now - year} years` : null].filter(Boolean).join(' · ')}</span></div></div>`);
  // how hard it runs
  const cf = capacityFactor(p.mw, p.gwh); const typ = TYPICAL_CF[p.fuel];
  const gwh = p.gwh || (typ ? (p.mw * HOURS * typ) / 100 / 1000 : null);
  set('pw-run', `<div class="pw-run">
    ${cf != null ? `<div class="pw-row"><span>This plant</span>${meter(cf, color, `${fmt(cf * 100)}%`)}<b>${fmt(cf * 100)}%</b></div>` : ''}
    ${typ ? `<div class="pw-row typ"><span>Typical ${esc(p.fuel.toLowerCase())}</span>${meter(typ / 100, 'var(--ink-3, #999)', `${typ}%`)}<b>${typ}%</b></div>` : ''}
    <p class="cd-key">${cf != null ? `It made <b>${fmt(p.gwh)} GWh</b> in its latest reported year, running as if flat out ${fmt(cf * 100)}% of the time` : `No output reported${typ ? `; a typical ${esc(p.fuel.toLowerCase())} plant this size makes about ${fmt(gwh)} GWh a year` : ''}`}${gwh ? `: the electricity of about <b>${big((gwh * 1e6) / KWH_PER_PERSON)} people</b> at the world's average use` : ''}.</p></div>`);
  // right now, for wind and solar
  const cur = w?.current;
  if (p.fuel === 'Wind' && cur?.wind_speed_100m != null) {
    const s = windShare(cur.wind_speed_100m);
    set('pw-now', `<div class="pw-now"><b>Right now</b> ${meter(s, color, `${fmt(s * 100)}%`)}<p class="cd-key">The wind at turbine height is ${fmt(cur.wind_speed_100m, 1)} m/s, so it is likely making about <b>${fmt(s * p.mw)} MW</b> (${fmt(s * 100)}% of its power)${cur.wind_speed_100m > 25 ? ': too strong, the turbines will have shut down to protect themselves' : cur.wind_speed_100m < 3 ? ': too calm to turn the blades' : ''}. An estimate from the weather.</p></div>`);
  } else if (p.fuel === 'Solar' && cur) {
    const s = solarShare(cur.shortwave_radiation);
    set('pw-now', `<div class="pw-now"><b>Right now</b> ${meter(s, color, `${fmt(s * 100)}%`)}<p class="cd-key">${cur.is_day ? `The sun gives ${fmt(cur.shortwave_radiation)} W/m² there${cur.cloud_cover != null ? ` under ${fmt(cur.cloud_cover)}% cloud` : ''}, so it is likely making about <b>${fmt(s * p.mw)} MW</b>` : 'It is night there, so it is making nothing'}. An estimate from the weather.</p></div>`);
  } else set('pw-now', '');
  // carbon over the whole life cycle
  const t = yearCo2(gwh, p.fuel); const maxG = Math.max(...Object.values(LIFE_CO2));
  set('pw-co2', LIFE_CO2[p.fuel] != null ? `<details class="qd-sec" open><summary><span>Carbon</span><small>${t != null ? `${big(t)} tonnes a year` : ''}</small></summary>
    <div class="pw-bars">${Object.entries(LIFE_CO2).map(([f, g]) => `<div class="pw-row${f === p.fuel ? ' me' : ''}"><span>${esc(f)}</span>${meter(g / maxG, f === p.fuel ? color : 'color-mix(in srgb, var(--ink-2) 35%, transparent)', `${g} grams per kWh`)}<b>${g}</b></div>`).join('')}</div>
    <p class="cd-key">Grams of carbon dioxide equivalent per kWh over the whole life cycle: building, fuel, running and taking down.${t != null ? ` A year of this plant is about <b>${big(t)} tonnes</b>, as much as <b>${big(t / CAR_T)} cars</b> driven for a year.` : ''}</p></details>` : '');
  // its country
  const all = data.power ?? []; const mine = all.filter((x) => x.country === p.country);
  if (mine.length > 1) {
    const by = {}; for (const x of mine) by[x.fuel] = (by[x.fuel] ?? 0) + x.mw;
    const tot = Object.values(by).reduce((s, v) => s + v, 0); const parts = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const rank = mine.filter((x) => x.mw > p.mw).length + 1; const sameFuel = mine.filter((x) => x.fuel === p.fuel);
    set('pw-mix', `<details class="qd-sec" open><summary><span>${esc(p.country)}'s plants</span><small>${fmt(tot / 1000, 1)} GW in ${fmt(mine.length)}</small></summary>
      <div class="pw-mix" role="img" aria-label="${esc(parts.map(([f, v]) => `${f} ${Math.round((v / tot) * 100)}%`).join(', '))}">${parts.map(([f, v]) => `<i style="flex:${v};background:${FUEL[f] ?? '#ccc'}${f === p.fuel ? ';outline:2px solid var(--ink);outline-offset:-2px' : ''}" title="${esc(f)} ${fmt((v / tot) * 100)}%"></i>`).join('')}</div>
      <div class="pw-key">${parts.slice(0, 6).map(([f, v]) => `<span><i style="background:${FUEL[f] ?? '#ccc'}"></i>${esc(f)} ${fmt((v / tot) * 100)}%</span>`).join('')}</div>
      <p class="cd-key">This plant is number <b>${fmt(rank)}</b> of ${fmt(mine.length)} by power in ${esc(p.country)}, and ${sameFuel.length > 1 ? `number ${fmt(sameFuel.filter((x) => x.mw > p.mw).length + 1)} of ${fmt(sameFuel.length)} ${esc(p.fuel.toLowerCase())} plants` : `its only ${esc(p.fuel.toLowerCase())} plant on the map`}. Plants of 50 MW and more, for the fuels shown.</p></details>`);
  } else set('pw-mix', '');
  // neighbours
  const near = all.filter((x) => x !== p).map((x) => [x, haversineKm(p.lat, p.lng, x.lat, x.lng)]).filter(([, d]) => d <= NEAR_KM).sort((a, b) => a[1] - b[1]);
  pw.near = near.slice(0, 12).map(([x]) => x);
  set('pw-near', near.length ? `<div class="lm-near">${near.slice(0, 12).map(([x, d]) => `<button class="chip pw-chip" style="--c:${FUEL[x.fuel] ?? '#ccc'}" data-cd-layer="power" data-cd-power="${x.lat},${x.lng}">${unitSvg(FUEL_GLYPH[x.fuel] ?? 'bolt', 14)} ${esc(x.name)} <span>${fmt(x.mw)} MW · ${fmt(d)} km</span></button>`).join('')}</div>` : '<p class="cd-key">None on the map.</p>');
  const s = document.getElementById('pw-near-sum'); if (s) s.textContent = near.length ? `${near.length}` : 'none';
  pw.fat?.obj?.geometry?.dispose?.(); pw.fat = null; pw.FUEL = FUEL; refresh();
}

/** On the globe: the 50 km ring and a line to each neighbour in its fuel's colour, in one draw call. */
export function powerOverlay(ctx, sel) {
  if (!pw.p || sel?.d !== pw.p || !pw.FUEL) return { custom: [] };
  if (!pw.fat) {
    const { lat, lng } = pw.p; const lines = [{ pts: smallCircle(lat, lng, NEAR_KM / KM_PER_DEG, 120), color: pw.FUEL[pw.p.fuel] ?? '#ffe066', width: 1.4, alt: 0.004 }];
    for (const x of pw.near) lines.push({ pts: [[lat, lng], [x.lat, x.lng]], color: pw.FUEL[x.fuel] ?? '#ccc', width: 1.6, alt: 0.005 });
    pw.fat = ctx.fatLines(lines, { opacity: 0.85 });
  }
  return { custom: [pw.fat] };
}
export function powerClose() { pw.fat?.obj?.geometry?.dispose?.(); Object.assign(pw, { key: null, p: null, fat: null, near: [] }); }
