#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — sample current 10 m wind, 2 m temperature, cloud cover, precipitation and the World
// Meteorological Organization (WMO) weather code on a 6° global grid from Open-Meteo (CC BY 4.0) and write
// site/app/data/weather.json (wind.js draws the wind; skyfx.js the clouds, rain, snow and lightning). Runs inside the Pages deploy every 6 hours, so the
// data is served with the site without ever being committed. 1,740 points × 4 runs a day stays well
// inside Open-Meteo's free daily allowance.
import { writeFileSync } from 'node:fs';
const STEP = 6; const LAT0 = -84; const LON0 = -180; const NLAT = 29; const NLON = 60;
const pts = [];
for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) pts.push([LAT0 + i * STEP, LON0 + j * STEP]);
const u = new Array(pts.length).fill(0); const v = new Array(pts.length).fill(0); const t = new Array(pts.length).fill(null);
// Sky: total, low and high cloud cover (%), precipitation (mm over the model's preceding interval, an hour for most
// models, so read as mm/h) and the WMO weather code (95–99 thunderstorm, 71–77/85–86 snow). Same requests, more fields.
const cc = new Array(pts.length).fill(0); const cl = new Array(pts.length).fill(0); const ch = new Array(pts.length).fill(0);
const pr = new Array(pts.length).fill(0); const wc = new Array(pts.length).fill(0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
for (let k = 0; k < pts.length; k += 100) {
  const chunk = pts.slice(k, k + 100);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${chunk.map((p) => p[0]).join(',')}&longitude=${chunk.map((p) => p[1]).join(',')}&current=wind_speed_10m,wind_direction_10m,temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_high,precipitation,weather_code&wind_speed_unit=ms`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'GlobalIntelligenceAtlas/1.7 (educational map)' }, signal: AbortSignal.timeout(60_000) });
      if (r.status === 429) { await sleep(20_000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
      arr.forEach((o, n) => {
        const c = o.current ?? {}; const ws = c.wind_speed_10m ?? 0; const dir = ((c.wind_direction_10m ?? 0) * Math.PI) / 180;
        u[k + n] = Math.round(-ws * Math.sin(dir) * 10) / 10; v[k + n] = Math.round(-ws * Math.cos(dir) * 10) / 10; // direction is where the wind comes FROM
        t[k + n] = c.temperature_2m ?? null;
        cc[k + n] = Math.round(c.cloud_cover ?? 0); cl[k + n] = Math.round(c.cloud_cover_low ?? 0); ch[k + n] = Math.round(c.cloud_cover_high ?? 0);
        pr[k + n] = Math.round((c.precipitation ?? 0) * 10) / 10; wc[k + n] = c.weather_code ?? 0; ok += 1;
      });
      break;
    } catch (e) { console.warn(`chunk ${k}: ${e.message}`); await sleep(5000); }
  }
  await sleep(1500);
}
if (ok < pts.length * 0.8) { console.error(`Only ${ok}/${pts.length} points fetched; not writing weather.json`); process.exit(0); }
writeFileSync('site/app/data/weather.json', JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Open-Meteo (CC BY 4.0)', step: STEP, lat0: LAT0, lon0: LON0, nlat: NLAT, nlon: NLON, u, v, t, cc, cl, ch, pr, wc }));
console.log(`weather.json: ${ok} points`);
