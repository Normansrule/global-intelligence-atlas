#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: independently sourced open data for the infrastructure layers that started out with
// World Monitor's curated lists (HANDOFF.md section 9, item 9). Writes one JSON file per layer, in the same shape the
// layer already draws, for the orphan branch `open-data` (monthly, .github/workflows/open-data.yml):
//   nuclear.json     nuclear power plants        Wikidata (CC0)
//   spaceports.json  spaceports                  Wikidata (CC0)
//   economic.json    stock exchanges, central banks  Wikidata (CC0)
//   minerals.json    mines of critical minerals  Wikidata (CC0)
//   ports.json       ports                       NGA World Port Index, Pub. 150 (U.S. public domain)
//   cables.json      submarine cables            TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0)
// The chokepoints need no job: site/app/data/open/waterways.json is written by hand from the U.S. Energy Information
// Administration's list. Each source is independent; one that fails keeps its previous file, and status.json says why.
//
// Usage: node tools/fetch-open-data.mjs <outDir> [nuclear,spaceports,economic,minerals,ports,cables]
// Local files for tests or manual runs: WIKIDATA_DIR (holds <name>.json SPARQL results), WPI_FILE (CSV or JSON),
// CABLE_GEO_FILE, LANDING_GEO_FILE and CABLE_DETAIL_DIR (<id>.json). Overrides: WIKIDATA_SPARQL, WPI_URL, CABLE_BASE,
// CABLE_DETAILS=0 (skip the per-cable details: no owners, years or landings).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'open-data';
const ALL = ['nuclear', 'spaceports', 'economic', 'minerals', 'ports', 'cables'];
const ONLY = new Set((process.argv[3] ?? ALL.join(',')).split(','));
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.9 (+https://github.com/Normansrule/global-intelligence-atlas; educational globe)' };
const log = (...a) => console.log('[open-data]', ...a);
const r3 = (x) => Math.round(x * 1000) / 1000;
const write = (name, obj) => { mkdirSync(OUT, { recursive: true }); const s = JSON.stringify(obj); writeFileSync(join(OUT, name), s); return Math.round(s.length / 1024); };
const getJson = async (url, timeout = 120_000, init = {}) => {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
};

// ------------------------------------------------------------------ Wikidata
const SPARQL = process.env.WIKIDATA_SPARQL ?? 'https://query.wikidata.org/sparql';
const LABELS = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }';
/** SPARQL queries, one per layer. Each row is one item (or one item × one optional value; rows are merged by item). */
export const QUERIES = {
  nuclear: `SELECT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?start ?end ?watts WHERE {
  ?item wdt:P31/wdt:P279* wd:Q134447; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P137 ?operator }
  OPTIONAL { ?item wdt:P729 ?start } OPTIONAL { ?item wdt:P730 ?end }
  OPTIONAL { ?item p:P2109/psn:P2109/wikibase:quantityAmount ?watts }
  ${LABELS} }`,
  spaceports: `SELECT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?end ?dissolved WHERE {
  ?item wdt:P31/wdt:P279* wd:Q194188; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P137 ?operator }
  OPTIONAL { ?item wdt:P730 ?end } OPTIONAL { ?item wdt:P576 ?dissolved }
  ${LABELS} }`,
  economic: `SELECT ?item ?itemLabel ?itemDescription ?coord ?countryLabel ?kind WHERE {
  VALUES (?class ?kind) { (wd:Q11691 "exchange") (wd:Q66344 "central bank") }
  ?item wdt:P31/wdt:P279* ?class.
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  OPTIONAL { ?item wdt:P625 ?c1 } OPTIONAL { ?item wdt:P159/wdt:P625 ?c2 }
  BIND(COALESCE(?c1, ?c2) AS ?coord) FILTER(BOUND(?coord))
  OPTIONAL { ?item wdt:P17 ?country }
  ${LABELS} }`,
  minerals: `SELECT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?product ?closed WHERE {
  ?item wdt:P31/wdt:P279* wd:Q820477; wdt:P625 ?coord; wdt:P1056 ?prod.
  ?prod rdfs:label ?product. FILTER(LANG(?product) = "en")
  FILTER(REGEX(?product, "lithium|cobalt|nickel|rare.earth|graphite|copper|uranium|tungsten|^tin$|tin ore|manganese|platinum|palladium|gallium|germanium|vanadium|antimony|niobium|tantalum|bauxite|zinc", "i"))
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P137 ?operator }
  OPTIONAL { ?item wdt:P576 ?closed }
  ${LABELS} }`,
};
const val = (b, k) => b[k]?.value ?? null;
const qid = (uri) => String(uri ?? '').split('/').pop();
/** [lat, lon] from a WKT point such as "Point(52.23 23.97)" (longitude first). */
export function wktPoint(s) {
  const m = /Point\(\s*(-?[\d.]+(?:e-?\d+)?)\s+(-?[\d.]+(?:e-?\d+)?)\s*\)/i.exec(s ?? '');
  if (!m) return null; const lon = Number(m[1]); const lat = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}
/** Merges SPARQL rows by item: the first value of each field wins, multi-valued fields are collected in sets. */
export function byItem(bindings, many = []) {
  const m = new Map();
  for (const b of bindings) {
    const id = qid(val(b, 'item')); if (!id) continue;
    const label = val(b, 'itemLabel');
    if (!label || label === id) continue; // no English name
    let x = m.get(id);
    if (!x) { const p = wktPoint(val(b, 'coord')); if (!p) continue; x = { id, name: label, lat: r3(p[0]), lon: r3(p[1]) }; for (const k of many) x[k] = new Set(); m.set(id, x); }
    for (const [k, v] of Object.entries(b)) {
      const key = k.replace(/Label$|Description$/, (s) => (s === 'Description' ? 'Description' : ''));
      if (['item', 'itemLabel', 'coord'].includes(k)) continue;
      if (many.includes(key)) x[key].add(v.value); else x[key] ??= v.value;
    }
  }
  return [...m.values()].map((x) => { for (const k of many) x[k] = [...x[k]]; return x; });
}
const year = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);
const wd = (id) => `https://www.wikidata.org/wiki/${id}`;
export function nuclearRows(bindings, now = new Date()) {
  return byItem(bindings, ['operator']).map((x) => {
    const start = year(x.start); const end = year(x.end);
    const status = end && end <= now.getUTCFullYear() ? 'closed' : start && start <= now.getUTCFullYear() ? 'active' : 'planned';
    const mw = x.watts ? Math.round(Number(x.watts) / 1e6) : null;
    return { id: `wd-${x.id}`, name: x.name, lat: x.lat, lon: x.lon, type: 'plant', status, operator: x.operator.join(', ') || x.country || null, country: x.country ?? null, capacityMW: mw || null, opened: start, closed: end, wikidata: wd(x.id) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function spaceportRows(bindings) {
  return byItem(bindings, ['operator']).map((x) => ({ id: `wd-${x.id}`, name: x.name, lat: x.lat, lon: x.lon, country: x.country ?? '—', operator: x.operator.join(', ') || '—', status: x.end || x.dissolved ? 'inactive' : 'active', launches: '—', wikidata: wd(x.id) }));
}
export function economicRows(bindings) {
  return byItem(bindings, ['kind']).map((x) => ({ id: `wd-${x.id}`, name: x.name, type: x.kind.includes('central bank') ? 'central bank' : 'exchange', lat: x.lat, lon: x.lon, country: x.country ?? '—', description: x.itemDescription ? x.itemDescription[0].toUpperCase() + x.itemDescription.slice(1) : '', wikidata: wd(x.id) }));
}
export function mineralRows(bindings) {
  return byItem(bindings, ['operator', 'product']).map((x) => {
    const mins = [...new Set(x.product.map((p) => p.replace(/\s+ore$/i, '').replace(/^\w/, (c) => c.toUpperCase())))].sort();
    return { id: `wd-${x.id}`, name: x.name, lat: x.lat, lon: x.lon, mineral: mins.join(', '), country: x.country ?? '—', operator: x.operator.join(', ') || '—', status: x.closed ? 'closed' : 'producing or not known to be closed', significance: '', wikidata: wd(x.id) };
  });
}
async function sparql(name) {
  if (process.env.WIKIDATA_DIR) return JSON.parse(readFileSync(join(process.env.WIKIDATA_DIR, `${name}.json`), 'utf8')).results.bindings;
  const j = await getJson(SPARQL, 180_000, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' }, body: `query=${encodeURIComponent(QUERIES[name])}` });
  return j.results.bindings;
}
const WD_SRC = 'Wikidata (CC0 1.0), query.wikidata.org';
const fromWikidata = (name, rowsOf, min) => async () => {
  const rows = rowsOf(await sparql(name));
  if (rows.length < min) throw new Error(`only ${rows.length} items with coordinates (expected at least ${min}); previous file kept`);
  const kb = write(`${name}.json`, { generatedAt: new Date().toISOString(), src: WD_SRC, rows });
  return `${rows.length.toLocaleString('en')} items, ${kb} KB`;
};

// ------------------------------------------------------------------ NGA World Port Index (Pub. 150)
const WPI_URL = process.env.WPI_URL ?? 'https://msi.nga.mil/api/publications/world-port-index?output=json';
const WPI_CSV = 'https://msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv';
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
/** One port from a World Port Index record (JSON API or CSV row, as an object of column → value). */
const WPI_KEYS = {
  num: ['portNumber', 'World Port Index Number', 'indexNo'], name: ['portName', 'Main Port Name'], alt: ['alternateName', 'Alternate Port Name'],
  country: ['countryName', 'Country Code', 'country'], locode: ['unloCode', 'UN/LOCODE'], lat: ['ycoord', 'Latitude', 'latitude'], lon: ['xcoord', 'Longitude', 'longitude'],
  size: ['harborSize', 'Harbor Size'], type: ['harborType', 'Harbor Type'], use: ['harborUse', 'Harbor Use'], channel: ['chDepth', 'channelDepth', 'Channel Depth (m)'],
  cargo: ['cargoPierDepth', 'Cargo Pier Depth (m)'], oil: ['oilTerminalDepth', 'Oil Terminal Depth (m)'], lng: ['lngTerminalDepth', 'Liquified Natural Gas Terminal Depth (m)'], maxLen: ['maxVesselLength', 'Maximum Vessel Length (m)'],
  region: ['regionName', 'Region Name'], water: ['dodWaterBody', 'World Water Body'],
};
const SIZES = { L: 'Large', M: 'Medium', S: 'Small', V: 'Very small', LARGE: 'Large', MEDIUM: 'Medium', SMALL: 'Small', 'VERY SMALL': 'Very small' };
const HTYPES = { CN: 'Coastal natural', CB: 'Coastal breakwater', CT: 'Coastal tide gate', RN: 'River natural', RB: 'River basin', RT: 'River tide gate', LC: 'Lake or canal', OR: 'Open roadstead', TH: 'Typhoon harbour' };
export function wpiPort(rec) {
  const n = {}; for (const [k, v] of Object.entries(rec)) n[norm(k)] = v;
  const g = (key) => { for (const a of WPI_KEYS[key]) { const v = n[norm(a)]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return null; };
  const lat = Number(g('lat')); const lon = Number(g('lon')); const name = g('name');
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const size = SIZES[String(g('size') ?? '').toUpperCase()] ?? g('size'); const t = g('type'); const m = (k) => { const v = Number(g(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const title = name.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (s, a, b) => a + b.toUpperCase());
  return { id: `wpi-${g('num') ?? title}`, name: title, lat: r3(lat), lon: r3(lon), country: g('country') ?? '—', type: size ? `${size.toLowerCase()} harbour` : 'harbour', size: size ?? null,
    harbourType: HTYPES[String(t ?? '').toUpperCase()] ?? t, locode: g('locode'), channelDepthM: m('channel'), cargoPierDepthM: m('cargo'), oilTerminalDepthM: m('oil'), lngTerminalDepthM: m('lng'), maxVesselLengthM: m('maxLen'), water: g('water'), wpi: g('num') };
}
/** Splits one CSV line (quotes allowed). */
export function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
export function wpiRecords(text) {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('{') || t.startsWith('[')) { const j = JSON.parse(t); return Array.isArray(j) ? j : j.ports ?? j.data ?? []; }
  const lines = t.split(/\r?\n/); const h = splitCsv(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((l) => { const f = splitCsv(l); return Object.fromEntries(h.map((k, i) => [k, f[i]])); });
}
const SIZE_ORDER = { Large: 0, Medium: 1, Small: 2, 'Very small': 3 };
export function portRows(records) {
  return records.map(wpiPort).filter(Boolean).filter((p) => p.size !== 'Very small').sort((a, b) => (SIZE_ORDER[a.size] ?? 4) - (SIZE_ORDER[b.size] ?? 4) || a.name.localeCompare(b.name));
}
async function ports() {
  let text;
  if (process.env.WPI_FILE) text = readFileSync(process.env.WPI_FILE, 'utf8');
  else {
    const errs = [];
    for (const u of [WPI_URL, WPI_CSV]) {
      try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(180_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); text = await r.text(); if (portRows(wpiRecords(text)).length) break; throw new Error('no ports with positions'); }
      catch (e) { errs.push(`${new URL(u).pathname}: ${e.message}`); text = null; }
    }
    if (!text) throw new Error(errs.join('; '));
  }
  const rows = portRows(wpiRecords(text));
  if (rows.length < 100) throw new Error(`only ${rows.length} ports read; previous file kept`);
  const kb = write('ports.json', { generatedAt: new Date().toISOString(), src: 'NGA World Port Index (Pub. 150), U.S. public domain', rows });
  return `${rows.length.toLocaleString('en')} ports (${rows.filter((p) => p.size === 'Large').length} large), ${kb} KB`;
}

// ------------------------------------------------------------------ TeleGeography Submarine Cable Map
const CABLE_BASE = process.env.CABLE_BASE ?? 'https://www.submarinecablemap.com/api/v3';
const readOr = async (env, url) => (process.env[env] ? JSON.parse(readFileSync(process.env[env], 'utf8')) : getJson(url));
/** Cables in the layer's shape: { id, name, parts: [[[lon, lat], …], …], points (longest part), major, rfsYear, owners, landingPoints }. */
export function cableRows(geo, landingGeo, details = new Map()) {
  const lp = new Map((landingGeo?.features ?? []).map((f) => [f.properties?.id, { name: f.properties?.name, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }]));
  const byId = new Map();
  for (const f of geo?.features ?? []) {
    const p = f.properties ?? {}; const id = p.id ?? p.feature_id; if (!id) continue;
    const g = f.geometry ?? {}; const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const parts = lines.map((l) => l.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])).filter((l) => l.length > 1);
    if (!parts.length) continue;
    const c = byId.get(id) ?? { id, name: p.name ?? id, parts: [], color: p.color ?? null }; c.parts.push(...parts); byId.set(id, c);
  }
  return [...byId.values()].map((c) => {
    const d = details.get(c.id) ?? {}; const lenKm = Number(String(d.length ?? '').replace(/[^\d.]/g, '')) || null;
    const landings = (d.landing_points ?? []).map((l) => { const g = lp.get(l.id) ?? {}; const nm = l.name ?? g.name ?? ''; return { city: nm.split(',').slice(0, -1).join(',').trim() || nm, countryName: l.country ?? nm.split(',').pop()?.trim() ?? '', lat: g.lat ?? null, lon: g.lon ?? null }; });
    return { id: c.id, name: d.name ?? c.name, parts: c.parts, points: c.parts.reduce((a, b) => (b.length > a.length ? b : a)), major: lenKm ? lenKm >= 8000 : c.parts.length > 3, rfsYear: d.rfs_year ?? year(d.rfs) ?? null, planned: d.is_planned ?? null, lengthKm: lenKm, owners: d.owners ? String(d.owners).split(/,\s*/).filter(Boolean) : [], landingPoints: landings, url: d.url ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
async function cables() {
  const geo = await readOr('CABLE_GEO_FILE', `${CABLE_BASE}/cable/cable-geo.json`);
  const landing = await readOr('LANDING_GEO_FILE', `${CABLE_BASE}/landing-point/landing-point-geo.json`).catch(() => null);
  const details = new Map(); let failed = 0;
  if (process.env.CABLE_DETAILS !== '0') {
    const ids = [...new Set((geo.features ?? []).map((f) => f.properties?.id).filter(Boolean))];
    const one = async (id) => {
      try { details.set(id, process.env.CABLE_DETAIL_DIR ? JSON.parse(readFileSync(join(process.env.CABLE_DETAIL_DIR, `${id}.json`), 'utf8')) : await getJson(`${CABLE_BASE}/cable/${encodeURIComponent(id)}.json`, 30_000)); }
      catch { failed++; }
    };
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(one));
  }
  const rows = cableRows(geo, landing, details);
  if (rows.length < 50) throw new Error(`only ${rows.length} cables read; previous file kept`);
  const kb = write('cables.json', { generatedAt: new Date().toISOString(), src: 'TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0)', rows });
  return `${rows.length.toLocaleString('en')} cables, ${details.size} with details${failed ? ` (${failed} detail pages failed)` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ run
const JOBS = {
  nuclear: fromWikidata('nuclear', nuclearRows, 100), spaceports: fromWikidata('spaceports', spaceportRows, 10),
  economic: fromWikidata('economic', economicRows, 30), minerals: fromWikidata('minerals', mineralRows, 10), ports, cables,
};
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const statusFile = join(OUT, 'status.json');
  const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : { feeds: {} };
  status.generatedAt = new Date().toISOString(); status.run = process.env.GITHUB_RUN_ID ?? null;
  let failed = 0;
  for (const id of ALL) {
    if (!ONLY.has(id)) continue;
    const prev = status.feeds[id] ?? {};
    try { const note = await JOBS[id](); status.feeds[id] = { ok: true, note, at: new Date().toISOString() }; log(id, note); }
    catch (e) { failed++; status.feeds[id] = { ...prev, ok: false, note: e.message, failedAt: new Date().toISOString() }; log(id, 'FAILED (previous file kept):', e.message); }
  }
  writeFileSync(statusFile, JSON.stringify(status));
  writeFileSync(join(OUT, 'README.md'), '# Global Intelligence Atlas open data\n\nIndependently sourced replacements for the infrastructure lists that came from World Monitor, written monthly by `.github/workflows/open-data.yml` on main (`tools/fetch-open-data.mjs`); each run replaces the branch.\n\n- `nuclear.json`, `spaceports.json`, `economic.json`, `minerals.json`: Wikidata (CC0 1.0).\n- `ports.json`: NGA World Port Index, Pub. 150 (U.S. public domain).\n- `cables.json`: TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0: attribution, non-commercial, share alike).\n\nSee docs/REFERENCES.md on main for citations and terms.\n');
  if (failed && failed === [...ONLY].length && !ALL.some((id) => existsSync(join(OUT, `${id}.json`)))) process.exitCode = 1;
}
