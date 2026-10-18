#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — extract the curated static datasets that ship inside World Monitor
// (https://github.com/koala73/worldmonitor, (C) 2024-2026 Elie Habib, AGPL-3.0-only)
// into one JSON file the static GitHub Pages app can load.
//
// Usage (from the root of this repository, with World Monitor checked out next to it):
//   git clone --depth 1 https://github.com/koala73/worldmonitor.git ../worldmonitor
//   npm i --no-save esbuild
//   node tools/extract-upstream-data.mjs ../worldmonitor
//
// Re-run after pulling World Monitor to pick up new data.

import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '../worldmonitor');
const outDir = resolve('site/app/data');
const tmp = resolve('.atlas-extract.tmp.mjs');

const entry = `
export { UNDERSEA_CABLES, NUCLEAR_FACILITIES, ECONOMIC_CENTERS, SPACEPORTS, CRITICAL_MINERALS } from '${join(root, 'src/config/geo-map')}';
export { CONFLICT_ZONES, INTEL_HOTSPOTS, STRATEGIC_WATERWAYS } from '${join(root, 'shared/geo-data')}';
export { PIPELINES } from '${join(root, 'shared/pipelines-data')}';
export { PORTS } from '${join(root, 'shared/ports-data')}';
export { AI_DATA_CENTERS } from '${join(root, 'src/config/ai-datacenters')}';
export { TRADE_ROUTES } from '${join(root, 'src/config/trade-routes')}';
export { CHOKEPOINT_REGISTRY } from '${join(root, 'src/config/chokepoint-registry')}';
`;

await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: tmp, logLevel: 'error',
  alias: { '@': join(root, 'src') },
});
const m = await import(pathToFileURL(tmp).href);
rmSync(tmp);

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// Chokepoint coordinates, used to draw trade routes port -> chokepoints -> port.
const choke = {};
for (const c of m.CHOKEPOINT_REGISTRY) choke[c.id] = [c.lat, c.lon, c.displayName];
for (const w of m.STRATEGIC_WATERWAYS) if (w.chokepointId && !choke[w.chokepointId]) choke[w.chokepointId] = [w.lat, w.lon, w.name];
const ports = Object.fromEntries(m.PORTS.map((p) => [p.id, p]));

const tradeRoutes = m.TRADE_ROUTES.map((r) => {
  const stops = [];
  const a = ports[r.from]; const b = ports[r.to];
  if (a) stops.push([a.lat, a.lon, a.name]);
  for (const w of r.waypoints ?? []) if (choke[w]) stops.push(choke[w]);
  if (b) stops.push([b.lat, b.lon, b.name]);
  return { ...pick(r, ['id', 'name', 'category', 'status', 'volumeDesc']), stops };
}).filter((r) => r.stops.length >= 2);

const out = {
  generatedAt: new Date().toISOString(),
  source: 'World Monitor (github.com/koala73/worldmonitor) — curated static config, AGPL-3.0-only',
  cables: m.UNDERSEA_CABLES.map((c) => pick(c, ['id', 'name', 'points', 'major', 'rfsYear', 'owners', 'landingPoints'])),
  pipelines: m.PIPELINES.map((p) => pick(p, ['id', 'name', 'type', 'status', 'points', 'capacity', 'length', 'operator', 'countries'])),
  ports: m.PORTS.map((p) => pick(p, ['id', 'name', 'lat', 'lon', 'country', 'type', 'rank', 'note'])),
  waterways: m.STRATEGIC_WATERWAYS.map((w) => pick(w, ['id', 'name', 'lat', 'lon', 'description'])),
  tradeRoutes,
  datacenters: m.AI_DATA_CENTERS.map((d) => pick(d, ['id', 'name', 'owner', 'country', 'lat', 'lon', 'status', 'chipType', 'chipCount'])),
  spaceports: m.SPACEPORTS.map((s) => pick(s, ['id', 'name', 'lat', 'lon', 'country', 'operator', 'status', 'launches'])),
  nuclear: m.NUCLEAR_FACILITIES.map((n) => pick(n, ['id', 'name', 'lat', 'lon', 'type', 'status', 'operator'])),
  economic: m.ECONOMIC_CENTERS.map((e) => pick(e, ['id', 'name', 'type', 'lat', 'lon', 'country', 'description'])),
  minerals: m.CRITICAL_MINERALS.map((c) => pick(c, ['id', 'name', 'lat', 'lon', 'mineral', 'country', 'operator', 'status', 'significance'])),
  conflicts: m.CONFLICT_ZONES.map((z) => pick(z, ['id', 'name', 'coords', 'center', 'intensity', 'parties', 'description'])),
  hotspots: m.INTEL_HOTSPOTS.map((h) => pick(h, ['id', 'name', 'subtext', 'lat', 'lon', 'location', 'description'])),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'worldmonitor-static.json'), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) console.log(`${k.padEnd(12)} ${v.length}`);
console.log(`wrote ${join(outDir, 'worldmonitor-static.json')}`);
