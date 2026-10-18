#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas (GIA) — how many cameras each country has, from site/app/data/cameras.json (traffic
// cameras) and site/app/data/worldcams/ (public webcams). Prints a Markdown table; the camera-check workflow adds it
// to its job summary. Usage: node tools/camera-coverage.mjs [--min N]
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const D = 'site/app/data';
const geo = JSON.parse(readFileSync(`${D}/countries.geojson`, 'utf8')).features.filter((f) => f.geometry).map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of polys) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return { name: f.properties.name, polys, box: [w, s, e, n] };
});
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const countryAt = (lat, lng) => geo.find((g) => lng >= g.box[0] && lng <= g.box[2] && lat >= g.box[1] && lat <= g.box[3] && g.polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h))))?.name ?? 'At sea or unmatched';

const count = {}; const add = (k, c) => { count[k] ??= { traffic: 0, webcams: 0 }; count[k][c]++; };
if (existsSync(`${D}/cameras.json`)) for (const c of JSON.parse(readFileSync(`${D}/cameras.json`, 'utf8')).cams) add(countryAt(c[2], c[3]), 'traffic');
if (existsSync(`${D}/worldcams/index.json`)) for (const f of readdirSync(`${D}/worldcams`)) {
  if (!/^-?\d+_-?\d+\.json$/.test(f)) continue;
  for (const r of JSON.parse(readFileSync(`${D}/worldcams/${f}`, 'utf8')).rows) add(r[8] || countryAt(r[2], r[3]), 'webcams');
}
const min = Number(process.argv[process.argv.indexOf('--min') + 1]) || 0;
const rows = Object.entries(count).map(([k, v]) => [k, v.traffic, v.webcams, v.traffic + v.webcams]).filter((r) => r[3] >= min).sort((a, b) => b[3] - a[3]);
const tot = rows.reduce((t, r) => [t[0] + r[1], t[1] + r[2]], [0, 0]);
console.log(`### Camera coverage\n\n${rows.length} countries and territories · ${tot[0].toLocaleString('en')} traffic cameras · ${tot[1].toLocaleString('en')} public webcams\n`);
console.log('| Country | Traffic cameras | Public webcams | Total |\n|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`);
