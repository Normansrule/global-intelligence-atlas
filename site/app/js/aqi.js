// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: air-quality arithmetic shared by the Air quality layer (airquality.js) and the live-data
// snapshot (tools/fetch-live.mjs). No imports and no browser objects, so Node can load it too.
//
// - US Air Quality Index (AQI) bands and advice: United States Environmental Protection Agency (EPA), 2024.
// - European Air Quality Index (EAQI) bands: European Environment Agency (EEA), as served by Open-Meteo / CAMS.
// - Guideline levels: World Health Organization (WHO) global air quality guidelines, 2021 (24-hour levels, 8-hour for ozone).
// - Cigarettes: Muller & Muller (2015), 22 µg/m³ of fine particles (PM2.5) for a day is about one cigarette.

/** US AQI bands: [upper bound, label, colour, who should act, what to do]. */
export const US_BANDS = [
  [50, 'Good', '#3fbf5f', 'Everyone', 'A good day to be outside.'],
  [100, 'Moderate', '#e6d43a', 'Unusually sensitive people', 'Think about shorter or lighter time outdoors.'],
  [150, 'Unhealthy for sensitive groups', '#f08a2c', 'People with heart or lung disease, older adults, children, teenagers and outdoor workers', 'Take more breaks and do less intense activity outside.'],
  [200, 'Unhealthy', '#e5413a', 'Everyone', 'Cut down on long or hard effort outdoors; sensitive groups should avoid it.'],
  [300, 'Very unhealthy', '#9b4bb4', 'Everyone', 'Avoid long or hard effort outdoors; sensitive groups should stay indoors.'],
  [Infinity, 'Hazardous', '#8a1f3c', 'Everyone', 'Stay indoors with windows shut and avoid all effort outside.'],
];
/** European AQI bands: [upper bound, label, colour]. */
export const EU_BANDS = [[20, 'Good', '#50f0e6'], [40, 'Fair', '#50ccaa'], [60, 'Moderate', '#f0e641'], [80, 'Poor', '#ff5050'], [100, 'Very poor', '#960032'], [Infinity, 'Extremely poor', '#7d2181']];

export const usBand = (aqi) => (aqi == null || Number.isNaN(+aqi) ? null : US_BANDS.find((b) => +aqi <= b[0]));
export const euBand = (aqi) => (aqi == null || Number.isNaN(+aqi) ? null : EU_BANDS.find((b) => +aqi <= b[0]));

/**
 * The pollutants the card shows: Open-Meteo variable, short name, long name, WHO guideline (µg/m³), what it is.
 * Carbon monoxide comes in µg/m³ too; its WHO 24-hour guideline is 4 mg/m³.
 */
export const POLLUTANTS = [
  ['pm2_5', 'PM2.5', 'Fine particles (2.5 µm and smaller)', 15, 'Smoke, exhaust and soot small enough to reach the blood. The pollutant most linked to early deaths.'],
  ['pm10', 'PM10', 'Coarse particles (10 µm and smaller)', 45, 'Dust, pollen, sea salt and road and building dust.'],
  ['ozone', 'O₃', 'Ozone at ground level', 100, 'Made by sunlight acting on traffic and industrial fumes, so it peaks on sunny afternoons.'],
  ['nitrogen_dioxide', 'NO₂', 'Nitrogen dioxide', 25, 'Mostly from road traffic and power stations; highest near busy roads.'],
  ['sulphur_dioxide', 'SO₂', 'Sulphur dioxide', 40, 'From burning coal and oil, ships, smelters and volcanoes.'],
  ['carbon_monoxide', 'CO', 'Carbon monoxide', 4000, 'From incomplete burning: traffic, stoves and fires.'],
];
/** Which pollutant drives the US AQI: the sub-index fields Open-Meteo sends. */
export const SUB_INDEX = { pm2_5: 'us_aqi_pm2_5', pm10: 'us_aqi_pm10', ozone: 'us_aqi_ozone', nitrogen_dioxide: 'us_aqi_nitrogen_dioxide', sulphur_dioxide: 'us_aqi_sulphur_dioxide', carbon_monoxide: 'us_aqi_carbon_monoxide' };

/** Pollen kinds (Europe only, grains per m³) with the level names used by the European pollen services. */
export const POLLEN = [['grass_pollen', 'Grass'], ['birch_pollen', 'Birch'], ['alder_pollen', 'Alder'], ['olive_pollen', 'Olive'], ['mugwort_pollen', 'Mugwort'], ['ragweed_pollen', 'Ragweed']];
export function pollenLevel(n) { if (n == null) return null; if (n < 1) return 'none'; if (n < 20) return 'low'; if (n < 50) return 'moderate'; if (n < 200) return 'high'; return 'very high'; }

/** Cigarettes a day with the same fine-particle dose (Muller & Muller, 2015). */
export const cigarettes = (pm25) => (pm25 == null ? null : Math.max(0, pm25) / 22);

/** The main pollutant from the sub-indices in one Open-Meteo record ({ us_aqi_pm2_5: …, … }), or null. */
export function mainPollutant(rec) {
  let best = null;
  for (const [k, f] of Object.entries(SUB_INDEX)) { const v = rec?.[f]; if (v != null && (!best || v > best[1])) best = [k, v]; }
  return best ? POLLUTANTS.find((p) => p[0] === best[0]) : null;
}

/** UV index words (WHO). */
export function uvWords(uv) { if (uv == null) return null; if (uv < 3) return 'low'; if (uv < 6) return 'moderate'; if (uv < 8) return 'high'; if (uv < 11) return 'very high'; return 'extreme'; }

/**
 * The places the layer samples: every capital and the biggest cities, at least `minKm` apart, at most `max`.
 * `rows` are cities.json rows [name, lat, lon, pop, capital, cc, region].
 */
export function airSites(rows, { max = 420, minKm = 160 } = {}) {
  const R = 6371; const rad = Math.PI / 180;
  const km = (a, b) => { const dLat = (b[1] - a[1]) * rad; const dLng = (b[2] - a[2]) * rad; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  const order = [...rows].sort((a, b) => (b[4] - a[4]) || (b[3] - a[3]));
  const out = [];
  for (const r of order) {
    if (out.length >= max) break;
    const near = out.find((o) => km(o, r) < (r[4] && o[4] ? 40 : minKm));
    // a much bigger city right next to a small capital (Delhi beside New Delhi) lends the dot its better-known name
    if (near) { if (!near[7] && r[3] > near[3] * 4 && km(near, r) < 40) { near[0] = r[0]; near[7] = 1; } continue; }
    out.push([...r]);
  }
  return out.map(([name, lat, lng, pop, capital, cc]) => ({ name, lat: +lat.toFixed(2), lng: +lng.toFixed(2), pop, capital: !!capital, cc }));
}

/** The "current" variables the layer asks for, in the order the snapshot stores them. */
export const CURRENT = ['us_aqi', 'european_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'dust', 'uv_index'];
export const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
/** One batched request for many sites (Open-Meteo takes comma-separated coordinates and answers with a list). */
export const batchUrl = (sites) => `${AQ_BASE}?latitude=${sites.map((s) => s.lat).join(',')}&longitude=${sites.map((s) => s.lng).join(',')}&current=${CURRENT.join(',')}&timezone=GMT`;
/** Turn one batch answer into rows of numbers in CURRENT order (null where missing). */
export function batchRows(answer) {
  const list = Array.isArray(answer) ? answer : [answer];
  return list.map((r) => CURRENT.map((k) => (r?.current?.[k] == null ? null : Math.round(r.current[k] * 10) / 10)));
}
