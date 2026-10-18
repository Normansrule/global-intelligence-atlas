#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — download every licence-plate reader mapped in OpenStreetMap (surveillance:type=ALPR,
// much of it contributed through deflock.me) and split it into 10°×10° cells under site/app/data/alpr/.
// Data © OpenStreetMap contributors, ODbL 1.0.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const DIR = 'site/app/data/alpr';
const query = '[out:json][timeout:600];node["surveillance:type"="ALPR"];out;';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let j = null;
for (const url of MIRRORS) {
  try {
    const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'GlobalIntelligenceAtlas/1.1 (educational map)' }, signal: AbortSignal.timeout(700_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json(); console.log(`${url}: ${j.elements.length} nodes`); break;
  } catch (e) { console.warn(`${url}: ${e.message}`); }
}
if (!j) { console.error('All Overpass mirrors failed; keeping the existing snapshot.'); process.exit(0); }
const cells = {};
for (const n of j.elements) {
  const t = n.tags ?? {};
  const k = `${Math.floor(n.lat / 10) * 10}_${Math.floor(n.lon / 10) * 10}`;
  (cells[k] ??= []).push([n.id, Math.round(n.lat * 1e6) / 1e6, Math.round(n.lon * 1e6) / 1e6, t.manufacturer || t.brand || '', t.operator || '', t.direction || t['camera:direction'] || '', t['camera:mount'] || '', t.note || '']);
}
// 1° density grid for zoomed-out views (so the whole world never has to be downloaded at once).
const density = {};
for (const n of j.elements) { const k = `${Math.floor(n.lat)}_${Math.floor(n.lon)}`; density[k] = (density[k] ?? 0) + 1; }
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/density.json`, JSON.stringify({ rows: Object.entries(density).map(([k, c]) => { const [a, b] = k.split('_').map(Number); return [a + 0.5, b + 0.5, c]; }) }));
for (const [k, rows] of Object.entries(cells)) writeFileSync(`${DIR}/${k}.json`, JSON.stringify({ rows }));
writeFileSync(`${DIR}/index.json`, JSON.stringify({ generatedAt: new Date().toISOString(), total: j.elements.length, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.length])), attribution: '© OpenStreetMap contributors, ODbL 1.0' }));
console.log(`wrote ${Object.keys(cells).length} cells, ${j.elements.length} readers`);
