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
export { MILITARY_BASES } from '${join(root, 'src/config/military-bases')}';
export { GAMMA_IRRADIATORS } from '${join(root, 'src/config/irradiators')}';
export { STARTUP_HUBS, ACCELERATORS, TECH_HQS, CLOUD_REGIONS } from '${join(root, 'src/config/tech-geo')}';
export { AI_RESEARCH_LABS } from '${join(root, 'src/config/ai-research-labs')}';
export { STARTUP_ECOSYSTEMS } from '${join(root, 'src/config/startup-ecosystems')}';
export { STOCK_EXCHANGES, FINANCIAL_CENTERS, CENTRAL_BANKS, COMMODITY_HUBS } from '${join(root, 'src/config/finance-geo')}';
export { MINING_SITES, PROCESSING_PLANTS, COMMODITY_PORTS } from '${join(root, 'src/config/commodity-geo')}';
export { GULF_INVESTMENTS } from '${join(root, 'src/config/gulf-fdi')}';
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

// ---- More of World Monitor's static map datasets (v2.10): bases, irradiators, tech, finance, commodities, Gulf FDI.
// Each becomes one layer in site/app/js/wmbaseline.js. Where a World Monitor list overlaps one GIA already draws
// (economic centres, critical minerals) or another list here (startup hubs vs ecosystems), only the new items are kept.
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const econ = m.ECONOMIC_CENTERS;
const inEcon = (x, type, radius) => econ.some((e) => e.type === type && (norm(e.name) === norm(x.name) || norm(e.name) === norm(x.shortName) || (radius && km(e, x) < radius)));
const finance = [
  ...m.FINANCIAL_CENTERS.filter((f) => !inEcon(f, 'financial-hub', 15)).map((f) => ({ kind: 'centre', ...pick(f, ['id', 'name', 'city', 'country', 'lat', 'lon', 'type', 'gfciRank', 'specialties', 'description']) })),
  ...m.STOCK_EXCHANGES.filter((x) => !inEcon(x, 'exchange', 8)).map((x) => ({ kind: 'exchange', ...pick(x, ['id', 'name', 'shortName', 'city', 'country', 'lat', 'lon', 'tier', 'marketCap', 'tradingHours', 'timezone', 'description']) })),
  ...m.CENTRAL_BANKS.filter((x) => !inEcon(x, 'central-bank', 0)).map((x) => ({ kind: 'bank', ...pick(x, ['id', 'name', 'shortName', 'city', 'country', 'lat', 'lon', 'type', 'currency', 'description']) })),
];
const commodities = [
  ...m.COMMODITY_HUBS.filter((x) => !econ.some((e) => e.type === 'exchange' && norm(x.name).startsWith(norm(e.name)))).map((x) => ({ kind: x.type, ...pick(x, ['id', 'name', 'city', 'country', 'lat', 'lon', 'commodities', 'description']) })),
  ...m.COMMODITY_PORTS.map((x) => ({ kind: 'export-port', ...pick(x, ['id', 'name', 'city', 'country', 'lat', 'lon', 'commodities', 'annualThroughput', 'annualVolumeMt', 'significance']) })),
];
const mining = [
  ...m.MINING_SITES.filter((x) => !m.CRITICAL_MINERALS.some((c) => km(c, x) < 10)).map((x) => ({ kind: 'mine', ...pick(x, ['id', 'name', 'lat', 'lon', 'mineral', 'country', 'operator', 'status', 'significance', 'productionRank', 'productionCapacity', 'annualOutput', 'openPitOrUnderground']) })),
  ...m.PROCESSING_PLANTS.map((x) => ({ kind: 'plant', ...pick(x, ['id', 'name', 'lat', 'lon', 'type', 'mineral', 'country', 'operator', 'materials', 'status', 'significance', 'outputCapacity', 'capacityTpa']) })),
];
// Startup hubs (tech-geo) and startup ecosystems describe the same cities: a hub within 25 km of an ecosystem is
// folded into it (its name and tier kept as hub/hubTier); the rest stay as their own entries. Accelerators follow.
const ecos = m.STARTUP_ECOSYSTEMS.map((e) => ({ kind: 'ecosystem', ...pick(e, ['id', 'name', 'city', 'country', 'lat', 'lon', 'ecosystemTier', 'totalFunding2024', 'activeStartups', 'unicorns', 'topSectors', 'majorVCs', 'notableStartups', 'avgSeedRound', 'avgSeriesA', 'description']) }));
const loneHubs = [];
for (const h of m.STARTUP_HUBS) {
  const e = ecos.filter((x) => km(x, h) < 25).sort((a, b) => km(a, h) - km(b, h))[0];
  if (e) { e.hub = h.name; e.hubTier = h.tier; if (e.unicorns == null && h.unicorns != null) e.unicorns = h.unicorns; if (!e.description && h.description) e.description = h.description; }
  else loneHubs.push({ kind: 'hub', ...pick(h, ['id', 'name', 'city', 'country', 'lat', 'lon', 'unicorns', 'description']), hubTier: h.tier });
}
const startups = [...ecos, ...loneHubs, ...m.ACCELERATORS.map((a) => ({ kind: 'accelerator', ...pick(a, ['id', 'name', 'city', 'country', 'lat', 'lon', 'type', 'founded', 'notable']) }))];

Object.assign(out, {
  bases: m.MILITARY_BASES.map((b) => pick(b, ['id', 'name', 'lat', 'lon', 'type', 'country', 'arm', 'status', 'description'])),
  irradiators: m.GAMMA_IRRADIATORS.map((g) => pick(g, ['id', 'city', 'country', 'lat', 'lon', 'organization'])),
  techHqs: m.TECH_HQS.map((t) => pick(t, ['id', 'company', 'city', 'country', 'lat', 'lon', 'type', 'employees', 'marketCap'])),
  cloudRegions: m.CLOUD_REGIONS.map((c) => pick(c, ['id', 'provider', 'name', 'city', 'country', 'lat', 'lon', 'zones'])),
  aiLabs: m.AI_RESEARCH_LABS.map((l) => pick(l, ['id', 'name', 'type', 'parent', 'city', 'country', 'lat', 'lon', 'foundedYear', 'focusAreas', 'notableWork', 'publications', 'faculty', 'description'])),
  startups,
  finance,
  commodities,
  mining,
  gulfInvestments: m.GULF_INVESTMENTS.map((g) => pick(g, ['id', 'investingEntity', 'investingCountry', 'targetCountry', 'targetCountryIso', 'sector', 'assetType', 'assetName', 'lat', 'lon', 'investmentUSD', 'stakePercent', 'status', 'yearAnnounced', 'yearOperational', 'description', 'sourceUrl', 'tags'])),
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'worldmonitor-static.json'), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) console.log(`${k.padEnd(12)} ${v.length}`);
console.log(`wrote ${join(outDir, 'worldmonitor-static.json')}`);
