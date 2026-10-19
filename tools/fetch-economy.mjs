#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the "economy-data" branch. House prices, property sales, what each country sells and
// major industrial sites, from openly licensed published statistics, boiled down for the map. Runs monthly
// (.github/workflows/economy.yml); each source is independent, and a source that fails keeps its previous file.
//
//   houseprices/fhfa.json      U.S. Federal Housing Finance Agency (FHFA) House Price Index (HPI), all-transactions,
//                              quarterly, by state and metropolitan area (public domain).
//   houseprices/ukhpi.json     HM Land Registry UK House Price Index (UK HPI), average price by local authority
//                              (Open Government Licence v3.0).
//   houseprices/eurostat.json  Eurostat house price index by country, quarterly (prc_hpi_q, CC BY 4.0).
//   houseprices/oecd.json      Organisation for Economic Co-operation and Development (OECD) analytical house price
//                              indicators by country (CC BY 4.0).
//   acs/counties.json          U.S. Census Bureau American Community Survey (ACS) 5-year estimates: median home value
//                              and median rent by county (public domain).
//   sales/districts.json       HM Land Registry Price Paid Data, England and Wales: sales in the last 12 months
//                              aggregated to postcode district (count, median price, property types). Addresses,
//                              house numbers, full postcodes and transaction ids are dropped while reading.
//   exports/countries.json     CEPII BACI (Base pour l'Analyse du Commerce International): each country's exports by
//                              product, from UN Comtrade reconciled by CEPII (Etalab Open Licence 2.0).
//   industry/assets.json       Climate TRACE asset-level emissions for heavy industry: steel, cement, aluminium,
//                              chemicals, petrochemicals, pulp and paper, glass, lime and oil refining (CC BY 4.0).
// Positions: Census Gazetteer files (counties, metropolitan areas), Ordnance Survey (OS) Code-Point Open (postcode
// districts and British local authorities, OGL v3.0) and site/app/data/countries.geojson (country label points).
//
// ECONOMY_MIN_ROWS=1 lowers the size guards (each source refuses to replace its file with suspiciously few rows).
// Usage: node tools/fetch-economy.mjs <outDir> [fhfa,acs,ukhpi,ppd,eurostat,oecd,baci,trace]
// Local files instead of downloads (tests, or a manual run): FHFA_FILE, CBSA_GAZ_FILE, COUNTY_GAZ_FILE,
// ACS_FILE + ACS_PREV_FILE (Census API JSON), UKHPI_FILE, CODEPOINT_ZIP, PPD_FILES (comma-separated CSVs),
// EUROSTAT_FILE (JSON-stat), OECD_FILE (SDMX-CSV), BACI_ZIP, TRACE_FILE (API JSON, or a CSV or zip of CSVs),
// COUNTRIES_FILE. Overrides: FHFA_URL, UKHPI_URL ({ym}), PPD_URL ({year}), CODEPOINT_URL, EUROSTAT_URL, OECD_URL,
// BACI_URL, TRACE_API, TRACE_ZIP_URL, CENSUS_API_KEY (free; the Census data API refuses requests without one, so the county home values need it).
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
const OUT = MAIN ? (process.argv[2] ?? 'economy') : 'economy';
export const ALL = ['fhfa', 'acs', 'ukhpi', 'ppd', 'eurostat', 'oecd', 'baci', 'trace'];
const ONLY = new Set(((MAIN && process.argv[3]) || ALL.join(',')).split(','));
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.10 (+https://github.com/Normansrule/global-intelligence-atlas; educational globe)' };
const log = (...a) => console.log('[economy]', ...a);
const YEAR = new Date().getUTCFullYear();
let TMP = null;
const tmp = () => { if (!TMP) { TMP = join(tmpdir(), `gia-economy-${process.pid}`); mkdirSync(TMP, { recursive: true }); } return TMP; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (now, then) => (now > 0 && then > 0 ? Math.round((now / then - 1) * 1000) / 10 : null);
const write = (dir, name, obj) => { const p = join(OUT, dir, name); mkdirSync(dirname(p), { recursive: true }); const s = JSON.stringify(obj); writeFileSync(p, s); return Math.round(s.length / 1024); };
/** Size guards: a source with fewer rows than this keeps its previous file. ECONOMY_MIN_ROWS lowers them (tests). */
const minRows = (n) => (process.env.ECONOMY_MIN_ROWS ? Number(process.env.ECONOMY_MIN_ROWS) : n);
const local = (env) => (process.env[env] ? process.env[env] : null);

async function download(url, file, timeout = 30 * 60_000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  return file;
}
/** First URL in the list that downloads; returns [file, url, tag]. */
async function firstAvailable(candidates, name) {
  const errs = [];
  for (const [url, tag] of candidates) {
    try { return [await download(url, join(tmp(), name)), url, tag]; } catch (e) { errs.push(`${url}: ${e.message}`); }
  }
  throw new Error(`none of ${candidates.length} addresses worked (${errs.slice(-2).join('; ')})`);
}
const getText = async (url, timeout = 180_000) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) }); if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`); return r.text(); };
const getJson = async (url, timeout = 180_000) => JSON.parse(await getText(url, timeout));
async function* zipLines(zip, entry) {
  const p = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  yield* createInterface({ input: p.stdout, crlfDelay: Infinity });
}
const zipEntries = (zip) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
const isZip = (f) => { try { const b = readFileSync(f).subarray(0, 4); return b[0] === 0x50 && b[1] === 0x4b; } catch { return false; } };
const fileLines = (f) => createInterface({ input: createReadStream(f), crlfDelay: Infinity });
async function* httpLines(url, timeout = 30 * 60_000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  yield* createInterface({ input: Readable.fromWeb(r.body), crlfDelay: Infinity });
}

/** Splits one CSV line (quotes allowed). */
export function splitCsv(line, sep = ',') {
  if (!line.includes('"')) return line.split(sep);
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
/** Column index by any of several names (case, spacing and a byte-order mark ignored). */
export function columns(header, sep = ',') {
  const names = splitCsv(header.replace(/^﻿/, ''), sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  return (...alts) => { for (const a of alts) { const i = names.indexOf(a.toLowerCase()); if (i >= 0) return i; } return -1; };
}
const median = (xs) => { if (!xs.length) return null; const s = Float64Array.from(xs).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ------------------------------------------------------------------ positions
/** Census Gazetteer file (tab-separated) → Map GEOID → { name, state, lat, lng }. Works for counties and CBSAs. */
export function readGazetteer(text) {
  const lines = text.split(/\r?\n/); const c = columns(lines[0], '\t'); const m = new Map();
  const [g, n, s, la, lo] = [c('geoid'), c('name'), c('usps'), c('intptlat'), c('intptlong')];
  if (g < 0 || la < 0 || lo < 0) throw new Error('unexpected Gazetteer header');
  for (const line of lines.slice(1)) {
    const f = line.split('\t'); if (!f[g]?.trim()) continue;
    m.set(f[g].trim(), { name: f[n]?.trim(), state: s >= 0 ? f[s]?.trim() : null, lat: Number(f[la]), lng: Number(f[lo]) });
  }
  return m;
}
async function gazetteer(kind, env) {
  if (local(env)) return readGazetteer(readFileSync(local(env), 'utf8'));
  const urls = [2, 3, 4].map((b) => [`https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR - b}_Gazetteer/${YEAR - b}_Gaz_${kind}_national.zip`]);
  const [zip] = await firstAvailable(urls, `gaz-${kind}.zip`);
  return readGazetteer(execFileSync('unzip', ['-p', zip], { encoding: 'utf8', maxBuffer: 256 << 20 }));
}

/** Label point of each country in countries.geojson (centre of its largest ring's bounding box, weighted by area). */
export function countryPoints(geo) {
  const m = new Map();
  for (const f of geo.features ?? []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let best = null; let bestA = -1;
    for (const p of polys) {
      const ring = p[0]; let a = 0; let cx = 0; let cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const k = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += k; cx += (ring[j][0] + ring[i][0]) * k; cy += (ring[j][1] + ring[i][1]) * k; }
      if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [cy / (3 * a), cx / (3 * a)]; }
    }
    if (!best) continue;
    const pr = f.properties ?? {}; const v = { name: pr.name, lat: r4(best[0]), lng: r4(best[1]), iso2: pr['ISO3166-1-Alpha-2'], iso3: pr['ISO3166-1-Alpha-3'] };
    if (v.iso2 && v.iso2 !== '-99') m.set(v.iso2, v);
    if (v.iso3 && v.iso3 !== '-99') m.set(v.iso3, v);
  }
  return m;
}
let COUNTRIES = null;
const countries = () => (COUNTRIES ??= countryPoints(JSON.parse(readFileSync(local('COUNTRIES_FILE') ?? join(HERE, '..', 'site', 'app', 'data', 'countries.geojson'), 'utf8'))));
/** Eurostat and BACI use a few codes of their own. */
const ISO_FIX = { EL: 'GR', UK: 'GB', XK: 'XK' };

/** Approximate geographic centres of the U.S. states, District of Columbia and Puerto Rico (for FHFA state rows). */
export const STATE_CENTRES = {
  AL: [32.8, -86.8], AK: [64.7, -152.0], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.03], FL: [28.6, -82.4],
  GA: [32.7, -83.4], HI: [20.3, -156.4], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6], PR: [18.2, -66.5],
};

/** British National Grid easting and northing (OSGB36) → WGS84 latitude and longitude, to a few metres. */
export function bngToWgs84(E, N) {
  const a = 6377563.396; const b = 6356256.909; const F0 = 0.9996012717; const lat0 = (49 * Math.PI) / 180; const lon0 = (-2 * Math.PI) / 180; const N0 = -100000; const E0 = 400000;
  const e2 = 1 - (b * b) / (a * a); const n = (a - b) / (a + b);
  let lat = lat0; let M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const dl = lat - lat0; const sl = lat + lat0;
    M = b * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dl - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dl) * Math.cos(sl) + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dl) * Math.cos(2 * sl) - (35 / 24) * n ** 3 * Math.sin(3 * dl) * Math.cos(3 * sl));
  } while (N - N0 - M >= 0.00001);
  const sin = Math.sin(lat); const cos = Math.cos(lat); const tan = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin); const rho = (a * F0 * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5; const eta2 = nu / rho - 1;
  const VII = tan / (2 * rho * nu); const VIII = (tan / (24 * rho * nu ** 3)) * (5 + 3 * tan * tan + eta2 - 9 * tan * tan * eta2); const IX = (tan / (720 * rho * nu ** 5)) * (61 + 90 * tan * tan + 45 * tan ** 4);
  const X = 1 / (cos * nu); const XI = (1 / (cos * 6 * nu ** 3)) * (nu / rho + 2 * tan * tan); const XII = (1 / (cos * 120 * nu ** 5)) * (5 + 28 * tan * tan + 24 * tan ** 4); const XIIA = (1 / (cos * 5040 * nu ** 7)) * (61 + 662 * tan * tan + 1320 * tan ** 4 + 720 * tan ** 6);
  const dE = E - E0;
  const phi = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6; const lam = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  // OSGB36 → WGS84 (Helmert transformation)
  const sp = Math.sin(phi); const nu2 = a / Math.sqrt(1 - e2 * sp * sp);
  const x1 = nu2 * Math.cos(phi) * Math.cos(lam); const y1 = nu2 * Math.cos(phi) * Math.sin(lam); const z1 = (1 - e2) * nu2 * sp;
  const s = 20.4894e-6; const rx = (0.1502 / 3600) * (Math.PI / 180); const ry = (0.247 / 3600) * (Math.PI / 180); const rz = (0.8421 / 3600) * (Math.PI / 180);
  const x2 = 446.448 + (1 + s) * x1 - rz * y1 + ry * z1; const y2 = -125.157 + rz * x1 + (1 + s) * y1 - rx * z1; const z2 = 542.06 - ry * x1 + rx * y1 + (1 + s) * z1;
  const aW = 6378137; const bW = 6356752.3141; const e2W = 1 - (bW * bW) / (aW * aW); const p = Math.hypot(x2, y2);
  let la = Math.atan2(z2, p * (1 - e2W));
  for (let i = 0; i < 6; i++) { const nuW = aW / Math.sqrt(1 - e2W * Math.sin(la) ** 2); la = Math.atan2(z2 + e2W * nuW * Math.sin(la), p); }
  return [(la * 180) / Math.PI, (Math.atan2(y2, x2) * 180) / Math.PI];
}
/** Outward code ("district") of a postcode: "SW1A 1AA" → "SW1A". */
export const outcode = (pc) => { const s = String(pc ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length >= 5 && s.length <= 7 ? s.slice(0, -3) : null; };
/** Code-Point Open lines (no header: postcode, quality, eastings, northings, country, NHS region, NHS area, county, district, ward)
 *  → centres of postcode districts and of local authority districts (by GSS code). Exported for tests. */
export async function readCodePoint(lines) {
  const pcd = new Map(); const la = new Map(); let n = 0;
  const add = (m, k, e, nn) => { const x = m.get(k) ?? [0, 0, 0]; x[0] += e; x[1] += nn; x[2]++; m.set(k, x); };
  for await (const line of lines) {
    if (!line.trim() || /^"?postcode"?,/i.test(line)) continue;
    const f = splitCsv(line).map((x) => x.trim());
    const e = Number(f[2]); const nn = Number(f[3]); if (!(e > 0) || !(nn > 0)) continue;
    const oc = outcode(f[0]); if (oc) add(pcd, oc, e, nn);
    if (f[8]) add(la, f[8], e, nn); n++;
  }
  const done = (m) => new Map([...m].map(([k, [e, nn, c]]) => { const [lat, lng] = bngToWgs84(e / c, nn / c); return [k, { lat: r4(lat), lng: r4(lng), postcodes: c }]; }));
  return { districts: done(pcd), authorities: done(la), postcodes: n };
}
const CODEPOINT_URL = process.env.CODEPOINT_URL ?? 'https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect';
let CP = null;
const codePoint = () => (CP ??= (async () => {
  const zip = local('CODEPOINT_ZIP') ?? (await firstAvailable([[CODEPOINT_URL]], 'codepoint.zip'))[0];
  const entries = zipEntries(zip).filter((e) => /(^|\/)Data\/CSV\/[a-z]{1,2}\.csv$/i.test(e) || /^[a-z]{1,2}\.csv$/i.test(e));
  if (!entries.length) throw new Error('no postcode area CSV files in the Code-Point Open download');
  async function* all() { for (const e of entries) yield* zipLines(zip, e); }
  return readCodePoint(all());
})());

// ------------------------------------------------------------------ U.S. house prices (FHFA HPI master file)
const FHFA_URLS = process.env.FHFA_URL ? [[process.env.FHFA_URL]] : [['https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv'], ['https://www.fhfa.gov/HPI_master.csv'], ['https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_master.csv']];
/** Latest all-transactions quarterly index for each state and metropolitan area, with its 1- and 5-year change. */
export async function readFhfa(lines) {
  let c = null; const series = new Map();
  for await (const line of lines) {
    if (!c) {
      const k = columns(line);
      c = { type: k('hpi_type'), flavor: k('hpi_flavor'), freq: k('frequency'), level: k('level'), name: k('place_name'), id: k('place_id'), yr: k('yr'), per: k('period'), nsa: k('index_nsa') };
      if (c.level < 0 || c.id < 0 || c.yr < 0 || c.nsa < 0) throw new Error('unexpected FHFA master file header');
      continue;
    }
    if (!line.trim()) continue;
    const f = splitCsv(line);
    if (c.type >= 0 && !/^traditional$/i.test(f[c.type]?.trim())) continue;
    if (c.flavor >= 0 && !/^all-transactions$/i.test(f[c.flavor]?.trim())) continue;
    if (c.freq >= 0 && !/^quarterly$/i.test(f[c.freq]?.trim())) continue;
    const level = f[c.level]?.trim(); if (!/^(state|msa)$/i.test(level)) continue;
    const v = Number(f[c.nsa]); if (!(v > 0)) continue;
    const key = `${level.toUpperCase()}|${f[c.id].trim()}`;
    const s = series.get(key) ?? { level: /msa/i.test(level) ? 'metro' : 'state', id: f[c.id].trim(), name: f[c.name]?.trim(), q: new Map() };
    s.q.set(Number(f[c.yr]) * 4 + (Number(f[c.per]) - 1), v); series.set(key, s);
  }
  return [...series.values()].map((s) => {
    const last = Math.max(...s.q.keys()); const v = s.q.get(last);
    return { ...s, value: v, ch1: pct(v, s.q.get(last - 4)), ch5: pct(v, s.q.get(last - 20)), period: `${Math.floor(last / 4)}-Q${(last % 4) + 1}`, q: undefined };
  });
}
export function fhfaRows(series, cbsa) {
  let unplaced = 0; const rows = [];
  for (const s of series) {
    const pos = s.level === 'state' ? (STATE_CENTRES[s.id] ? { lat: STATE_CENTRES[s.id][0], lng: STATE_CENTRES[s.id][1] } : null) : cbsa.get(s.id);
    if (!pos) { unplaced++; continue; }
    rows.push([r4(pos.lat), r4(pos.lng), s.ch1, r1(s.value), s.ch5, s.name, s.level, s.id, s.period, null]);
  }
  return { rows: rows.sort((a, b) => (b[2] ?? -99) - (a[2] ?? -99)), unplaced };
}
async function fhfa() {
  const cbsa = await gazetteer('cbsa', 'CBSA_GAZ_FILE');
  let lines;
  if (local('FHFA_FILE')) lines = fileLines(local('FHFA_FILE'));
  else { const [file] = await firstAvailable(FHFA_URLS, 'fhfa.csv'); lines = fileLines(file); }
  const { rows, unplaced } = fhfaRows(await readFhfa(lines), cbsa);
  if (rows.length < minRows(40)) throw new Error(`only ${rows.length} places read; previous file kept`);
  const period = rows.map((r) => r[8]).sort().pop();
  const kb = write('houseprices', 'fhfa.json', { generatedAt: new Date().toISOString(), src: 'U.S. Federal Housing Finance Agency, House Price Index (all-transactions, quarterly, not seasonally adjusted)', source: 'fhfahpi', unit: 'index', valueLabel: 'House Price Index (all-transactions)', period, fields: FIELDS_HP, rows });
  return `${rows.length} states and metropolitan areas (${period})${unplaced ? `, ${unplaced} without a position (metropolitan divisions)` : ''}, ${kb} KB`;
}
const FIELDS_HP = ['lat', 'lng', 'change1yPct', 'value', 'change5yPct', 'name', 'level', 'code', 'period', 'extra'];

// ------------------------------------------------------------------ U.S. county home values (Census ACS 5-year)
/** Census API rows ([["NAME","B25077_001E","B25064_001E","state","county"], …]) → Map GEOID → { name, value, rent }. */
export function readAcs(json) {
  const [h, ...rows] = json; const i = (k) => h.indexOf(k);
  const [n, v, r, s, c] = [i('NAME'), i('B25077_001E'), i('B25064_001E'), i('state'), i('county')];
  if (v < 0 || s < 0 || c < 0) throw new Error('unexpected Census API columns');
  const num = (x) => { const y = Number(x); return Number.isFinite(y) && y > 0 ? y : null; }; // negative values are "no estimate" codes
  return new Map(rows.map((x) => [`${x[s]}${x[c]}`, { name: x[n], value: num(x[v]), rent: r >= 0 ? num(x[r]) : null }]));
}
export function acsRows(now, prev, gaz) {
  const rows = []; let unplaced = 0;
  for (const [geoid, x] of now) {
    if (x.value == null && x.rent == null) continue;
    const g = gaz.get(geoid); if (!g) { unplaced++; continue; }
    const p = prev?.get(geoid);
    rows.push([r4(g.lat), r4(g.lng), x.value, pct(x.value, p?.value), x.rent, x.name, g.state, geoid, pct(x.rent, p?.rent)]);
  }
  return { rows: rows.sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0)), unplaced };
}
/** What a Census data API answer that is not JSON means. It answers an HTML page, not an error code, for key problems. */
export function censusRefusal(status, text, rawKey = '') {
  const t = String(text);
  const key = String(rawKey); const trimmed = key.trim();
  const shape = /^[0-9a-f]{40}$/i.test(trimmed) ? 'it has the shape of a Census key (40 letters and digits)' : 'it does not have the shape of a Census key (40 letters and digits), so the secret probably holds something else';
  if (/Invalid Key|key with this request, however, it is not valid/i.test(t)) return `the Census data API refused CENSUS_API_KEY as invalid; ${shape}. A new key works only after its activation link (in the email from the Census Bureau) is opened, so open that link or request a new key at https://api.census.gov/data/key_signup.html and save it as the secret`;
  if (/Missing Key/i.test(t)) return 'the Census data API says no key was sent';
  if (status === 404 || /unknown\/unsupported|error: unknown/i.test(t)) return `that year is not published yet (HTTP ${status})`;
  const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  return `HTTP ${status}, a web page instead of data${title ? ` ("${title.slice(0, 80)}")` : ''}`;
}
async function acsVintage(year) {
  const key = `&key=${encodeURIComponent(String(process.env.CENSUS_API_KEY).trim())}`;
  const r = await fetch(`https://api.census.gov/data/${year}/acs/acs5?get=NAME,B25077_001E,B25064_001E&for=county:*${key}`, { headers: UA, signal: AbortSignal.timeout(180_000) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(censusRefusal(r.status, text, process.env.CENSUS_API_KEY)); }
  if (!r.ok) throw new Error(`HTTP ${r.status} from api.census.gov`);
  return readAcs(j);
}
async function acs() {
  const gaz = await gazetteer('counties', 'COUNTY_GAZ_FILE');
  let now; let prev; let year;
  if (local('ACS_FILE')) { now = readAcs(JSON.parse(readFileSync(local('ACS_FILE'), 'utf8'))); prev = local('ACS_PREV_FILE') ? readAcs(JSON.parse(readFileSync(local('ACS_PREV_FILE'), 'utf8'))) : null; year = Number(process.env.ACS_YEAR ?? 0) || null; }
  else {
    if (!process.env.CENSUS_API_KEY) throw new Error('the Census data API answers "Missing Key" without one: add the free CENSUS_API_KEY repository secret');
    const errs = [];
    for (const y of [YEAR - 1, YEAR - 2, YEAR - 3]) {
      try { now = await acsVintage(y); year = y; break; } catch (e) {
        if (/refused CENSUS_API_KEY/.test(e.message)) throw e; // a key problem fails every year the same way
        errs.push(`${y}: ${e.message}`);
      }
    }
    if (!now) throw new Error(errs.join('; '));
    if (process.env.CENSUS_API_KEY !== process.env.CENSUS_API_KEY.trim()) log('note: CENSUS_API_KEY had spaces or a line break around it; they are trimmed');
    prev = await acsVintage(year - 5).catch(() => null); // non-overlapping 5-year periods, as the Census Bureau advises
  }
  const { rows, unplaced } = acsRows(now, prev, gaz);
  if (rows.length < minRows(100)) throw new Error(`only ${rows.length} counties; previous file kept`);
  const kb = write('acs', 'counties.json', { generatedAt: new Date().toISOString(), year, compareYear: year ? year - 5 : null, src: 'U.S. Census Bureau, American Community Survey 5-year estimates, tables B25077 (median value, owner-occupied homes) and B25064 (median gross rent)', fields: ['lat', 'lng', 'medianValueUsd', 'valueChangePct', 'medianRentUsd', 'name', 'state', 'geoid', 'rentChangePct'], rows });
  return `${rows.length.toLocaleString('en')} counties (${year ?? 'local file'} 5-year estimates${prev && year ? `, compared with ${year - 5}` : ''})${unplaced ? `, ${unplaced} without a position` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ UK House Price Index (HM Land Registry)
const UKHPI_URL = process.env.UKHPI_URL ?? 'https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-{ym}.csv';
const ymBack = (k) => { const d = new Date(Date.UTC(YEAR, new Date().getUTCMonth() - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
/** Local authority codes: English unitary, non-metropolitan, metropolitan and London boroughs, Welsh, Scottish and Northern Irish councils. */
const LA_CODE = /^(E0[6-9]|W06|S12|N09)\d{6}$/;
const isoDate = (s) => { const t = String(s ?? '').trim(); const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t); return m ? `${m[3]}-${m[2]}-${m[1]}` : t.slice(0, 10); };
/** UK HPI full file → latest month of each local authority with average prices, 12-month and 5-year change, sales. */
export async function readUkHpi(lines) {
  let c = null; const areas = new Map();
  for await (const line of lines) {
    if (!c) {
      const k = columns(line);
      c = { date: k('date'), name: k('regionname', 'region name'), code: k('areacode', 'area code'), price: k('averageprice', 'average price'), ch12: k('12m%change', '12m% change'), sales: k('salesvolume', 'sales volume'), D: k('detachedprice'), S: k('semidetachedprice'), T: k('terracedprice'), F: k('flatprice') };
      if (c.date < 0 || c.code < 0 || c.price < 0) throw new Error('unexpected UK HPI header');
      continue;
    }
    if (!line.trim()) continue;
    const f = splitCsv(line); const code = f[c.code]?.trim(); if (!LA_CODE.test(code ?? '')) continue;
    const date = isoDate(f[c.date]); const price = Number(f[c.price]); if (!(price > 0)) continue;
    const a = areas.get(code) ?? { code, name: f[c.name]?.trim(), byDate: new Map(), sales: new Map() };
    const n = (i) => (i >= 0 && f[i] !== '' && Number.isFinite(Number(f[i])) ? Number(f[i]) : null);
    a.byDate.set(date, { price, ch12: n(c.ch12), types: ['D', 'S', 'T', 'F'].map((t) => n(c[t])) });
    const sv = n(c.sales); if (sv) a.sales.set(date, sv);
    areas.set(code, a);
  }
  return [...areas.values()].map((a) => {
    const dates = [...a.byDate.keys()].sort(); const last = dates.at(-1); const x = a.byDate.get(last);
    const back = (yrs) => a.byDate.get(`${Number(last.slice(0, 4)) - yrs}${last.slice(4)}`)?.price;
    const salesDate = [...a.sales.keys()].sort().at(-1);
    const sales12 = salesDate ? [...a.sales].filter(([d]) => d > `${Number(salesDate.slice(0, 4)) - 1}${salesDate.slice(4)}` && d <= salesDate).reduce((s, [, v]) => s + v, 0) : null;
    return { code: a.code, name: a.name, period: last.slice(0, 7), price: Math.round(x.price), ch1: x.ch12 != null ? r1(x.ch12) : pct(x.price, back(1)), ch5: pct(x.price, back(5)), types: x.types.map((v) => (v ? Math.round(v) : null)), sales12, salesTo: salesDate?.slice(0, 7) ?? null };
  });
}
/** Northern Ireland's eleven councils are not in Code-Point Open (Great Britain only); their approximate centres. */
const NI_COUNCILS = { N09000001: [54.75, -6.25], N09000002: [54.35, -6.6], N09000003: [54.6, -5.93], N09000004: [55.0, -6.6], N09000005: [54.95, -7.3], N09000006: [54.35, -7.6], N09000007: [54.5, -6.1], N09000008: [54.83, -5.95], N09000009: [54.5, -6.9], N09000010: [54.25, -6.05], N09000011: [54.6, -5.65] };
export function ukHpiRows(areas, authorities) {
  const rows = []; let unplaced = 0;
  for (const a of areas) {
    const p = authorities.get(a.code) ?? (NI_COUNCILS[a.code] ? { lat: NI_COUNCILS[a.code][0], lng: NI_COUNCILS[a.code][1] } : null);
    if (!p) { unplaced++; continue; }
    rows.push([p.lat, p.lng, a.ch1, a.price, a.ch5, a.name, 'local authority', a.code, a.period, { types: a.types, sales12: a.sales12, salesTo: a.salesTo }]);
  }
  return { rows: rows.sort((x, y) => (y[2] ?? -99) - (x[2] ?? -99)), unplaced };
}
async function ukhpi() {
  const cp = await codePoint();
  let lines;
  if (local('UKHPI_FILE')) lines = fileLines(local('UKHPI_FILE'));
  else { const [file] = await firstAvailable([1, 2, 3, 4, 5].map((k) => [UKHPI_URL.replace('{ym}', ymBack(k))]), 'ukhpi.csv'); lines = fileLines(file); }
  const { rows, unplaced } = ukHpiRows(await readUkHpi(lines), cp.authorities);
  if (rows.length < minRows(50)) throw new Error(`only ${rows.length} local authorities placed; previous file kept`);
  const period = rows.map((r) => r[8]).sort().pop();
  const kb = write('houseprices', 'ukhpi.json', { generatedAt: new Date().toISOString(), src: 'HM Land Registry, UK House Price Index (Open Government Licence v3.0); positions from OS Code-Point Open', source: 'ukhpi', unit: 'GBP', valueLabel: 'Average price', period, fields: FIELDS_HP, extraFields: { types: ['detached', 'semiDetached', 'terraced', 'flat'], sales12: 'sales in the 12 months to salesTo' }, rows });
  return `${rows.length} local authorities (${period})${unplaced ? `, ${unplaced} without a position (codes changed by local government reorganisation?)` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ Price Paid Data: sales by postcode district
const PPD_URLS = (year) => (process.env.PPD_URL ? [process.env.PPD_URL.replace('{year}', year)] : [`http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-${year}.csv`, `https://price-paid-data.publicdata.landregistry.gov.uk/pp-${year}.csv`]);
const PTYPES = ['D', 'S', 'T', 'F', 'O'];
/** Minimum sales before a district's median price is published (a median of one or two sales is one home's price). */
export const MIN_SALES_FOR_MEDIAN = 5;
/** Reads Price Paid lines (no header: id, price, date, postcode, type, new, tenure, PAON, SAON, street, locality, town,
 *  district, county, category, status) into postcode district aggregates. Only the price, date, postcode district,
 *  type, new-build flag, tenure, town and district are looked at; nothing identifying a home is kept. */
export async function addPricePaid(lines, acc) {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const f = splitCsv(line);
    if (f.length < 15) continue;
    const status = (f[15] ?? 'A').trim().toUpperCase(); if (status === 'D') continue; // deletions in the monthly update format
    if ((f[14] ?? '').trim().toUpperCase() !== 'A') continue; // category A: standard sales at full market value
    const price = Number(f[1]); const date = String(f[2]).slice(0, 10); const oc = outcode(f[3]);
    if (!(price > 0) || !oc || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let d = acc.get(oc);
    if (!d) { d = { prices: [], dates: [], meta: [], towns: new Map(), las: new Map() }; acc.set(oc, d); }
    // meta: property type (0–4) + 8 for a new build + 16 for a leasehold
    const t = PTYPES.indexOf((f[4] ?? '').trim().toUpperCase());
    d.prices.push(price); d.dates.push(date);
    d.meta.push((t >= 0 ? t : 4) + ((f[5] ?? '').trim().toUpperCase() === 'Y' ? 8 : 0) + ((f[6] ?? '').trim().toUpperCase() === 'L' ? 16 : 0));
    const town = (f[11] ?? '').trim(); if (town) d.towns.set(town, (d.towns.get(town) ?? 0) + 1);
    const la = (f[12] ?? '').trim(); if (la) d.las.set(la, (d.las.get(la) ?? 0) + 1);
  }
  return acc;
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const titleCase = (s) => (s ? String(s).toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
export function salesRows(acc, districts) {
  const latest = [...acc.values()].reduce((m, d) => d.dates.reduce((x, y) => (y > x ? y : x), m), '');
  if (!latest) return { rows: [], from: null, to: null, unplaced: 0, sales: 0 };
  const from = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
  const rows = []; let unplaced = 0; let sales = 0;
  for (const [oc, d] of acc) {
    const keep = d.dates.map((x, i) => (x > from ? i : -1)).filter((i) => i >= 0); if (!keep.length) continue;
    const p = districts.get(oc); if (!p) { unplaced += keep.length; continue; }
    sales += keep.length;
    const types = [0, 0, 0, 0, 0]; let nb = 0; let lease = 0;
    for (const i of keep) { const m = d.meta[i]; types[m & 7]++; if (m & 8) nb++; if (m & 16) lease++; }
    const med = keep.length >= MIN_SALES_FOR_MEDIAN ? Math.round(median(keep.map((i) => d.prices[i]))) : null;
    rows.push([p.lat, p.lng, keep.length, med, oc, nb, types, lease, titleCase(top(d.towns)), titleCase(top(d.las))]);
  }
  return { rows: rows.sort((a, b) => b[2] - a[2]), from, to: latest, unplaced, sales };
}
async function ppd() {
  const cp = await codePoint();
  const acc = new Map();
  if (local('PPD_FILES')) for (const f of local('PPD_FILES').split(',')) await addPricePaid(fileLines(f), acc);
  else {
    let got = 0; const errs = [];
    for (const y of [YEAR, YEAR - 1]) {
      for (const u of PPD_URLS(y)) { try { await addPricePaid(httpLines(u), acc); got++; break; } catch (e) { errs.push(`${y}: ${e.message}`); } }
    }
    if (!got) throw new Error(errs.join('; '));
  }
  const o = salesRows(acc, cp.districts);
  if (o.rows.length < minRows(100)) throw new Error(`only ${o.rows.length} postcode districts; previous file kept`);
  const kb = write('sales', 'districts.json', { generatedAt: new Date().toISOString(), from: o.from, to: o.to, minSalesForMedian: MIN_SALES_FOR_MEDIAN, src: 'HM Land Registry, Price Paid Data (Open Government Licence v3.0), category A sales, aggregated to postcode district; positions from OS Code-Point Open', fields: ['lat', 'lng', 'sales', 'medianPriceGbp', 'district', 'newBuild', 'types', 'leasehold', 'mainTown', 'localAuthority'], typeFields: ['detached', 'semiDetached', 'terraced', 'flat', 'other'], rows: o.rows });
  return `${o.sales.toLocaleString('en')} sales from ${o.from} to ${o.to} in ${o.rows.length.toLocaleString('en')} postcode districts${o.unplaced ? `, ${o.unplaced} sales in districts without a position` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ Eurostat house price index (prc_hpi_q)
const EUROSTAT_URL = process.env.EUROSTAT_URL ?? `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q?format=JSON&lang=EN&purchase=TOTAL&sinceTimePeriod=${YEAR - 6}-Q1`;
/** JSON-stat 2.0 dataset → array of { dims: {id: code}, value }. */
export function jsonStat(j) {
  const ids = j.id; const size = j.size; const cats = ids.map((id) => { const idx = j.dimension[id].category.index; return Array.isArray(idx) ? idx : Object.entries(idx).sort((a, b) => a[1] - b[1]).map(([k]) => k); });
  const out = []; const vals = j.value ?? {};
  for (const [flat, value] of Array.isArray(vals) ? vals.map((v, i) => [i, v]) : Object.entries(vals)) {
    if (value == null) continue;
    let k = Number(flat); const dims = {};
    for (let d = ids.length - 1; d >= 0; d--) { dims[ids[d]] = cats[d][k % size[d]]; k = Math.floor(k / size[d]); }
    out.push({ dims, value });
  }
  return { obs: out, labels: Object.fromEntries(ids.map((id) => [id, j.dimension[id].category.label ?? {}])) };
}
const qIndex = (t) => { const m = /^(\d{4})-?Q([1-4])$/.exec(t); return m ? Number(m[1]) * 4 + Number(m[2]) - 1 : null; };
const qLabel = (i) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
/** Country series from the Eurostat house price index: index level, 1-year and 5-year change. */
export function eurostatCountries(j) {
  const { obs, labels } = jsonStat(j);
  const units = [...new Set(obs.map((o) => o.dims.unit))];
  const idxUnit = units.filter((u) => /^I\d{2}_Q$/.test(u)).sort().shift() ?? units.find((u) => /^I/.test(u));
  if (!idxUnit) throw new Error('no index unit in the Eurostat answer');
  const by = new Map();
  for (const o of obs) {
    const geo = o.dims.geo; if (!/^[A-Z]{2}$/.test(geo)) continue; // countries only, not EU27_2020 or EA20
    const t = qIndex(o.dims.time); if (t == null) continue;
    const s = by.get(geo) ?? { idx: new Map(), rch: new Map() }; by.set(geo, s);
    if (o.dims.unit === idxUnit) s.idx.set(t, o.value); else if (o.dims.unit === 'RCH_A') s.rch.set(t, o.value);
  }
  return [...by].filter(([, s]) => s.idx.size).map(([geo, s]) => {
    const last = Math.max(...s.idx.keys()); const v = s.idx.get(last);
    return { geo, iso2: ISO_FIX[geo] ?? geo, name: labels.geo?.[geo] ?? geo, value: r1(v), ch1: s.rch.has(last) ? r1(s.rch.get(last)) : pct(v, s.idx.get(last - 4)), ch5: pct(v, s.idx.get(last - 20)), period: qLabel(last), base: idxUnit };
  });
}
const countryRows = (list, unitNote) => {
  const pts = countries(); const rows = []; let unplaced = 0;
  for (const c of list) { const p = pts.get(c.iso2 ?? c.iso3); if (!p) { unplaced++; continue; } rows.push([p.lat, p.lng, c.ch1, c.value, c.ch5, c.name ?? p.name, 'country', c.iso2 ?? c.iso3, c.period, unitNote(c)]); }
  return { rows: rows.sort((a, b) => (b[2] ?? -99) - (a[2] ?? -99)), unplaced };
};
async function eurostat() {
  const j = local('EUROSTAT_FILE') ? JSON.parse(readFileSync(local('EUROSTAT_FILE'), 'utf8')) : await getJson(EUROSTAT_URL);
  const list = eurostatCountries(j);
  const { rows, unplaced } = countryRows(list, (c) => ({ base: c.base }));
  if (rows.length < minRows(10)) throw new Error(`only ${rows.length} countries; previous file kept`);
  const period = rows.map((r) => r[8]).sort().pop();
  const kb = write('houseprices', 'eurostat.json', { generatedAt: new Date().toISOString(), src: 'Eurostat, House price index, quarterly (prc_hpi_q), all dwellings (CC BY 4.0)', source: 'eurostathpi', unit: 'index', valueLabel: `House price index (${list[0]?.base === 'I15_Q' ? '2015 = 100' : list[0]?.base})`, period, fields: FIELDS_HP, rows });
  return `${rows.length} countries (${period})${unplaced ? `, ${unplaced} without a position` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ OECD analytical house price indicators
const OECD_URL = process.env.OECD_URL ?? `https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/all?startPeriod=${YEAR - 6}-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels`;
/** SDMX-CSV (with or without labels) → countries with nominal and real house price indices. */
export function oecdCountries(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/); const c = columns(lines[0]);
  const k = { area: c('ref_area'), areaName: c('reference area'), freq: c('freq'), measure: c('measure'), measureName: c('measure'), unit: c('unit_measure'), time: c('time_period'), val: c('obs_value') };
  // with labels the label column follows its code column
  const head = splitCsv(lines[0].replace(/^﻿/, '')).map((h) => h.trim());
  const labelAfter = (i) => (i >= 0 && i + 1 < head.length && !/^[A-Z_]+$/.test(head[i + 1]) ? i + 1 : -1);
  const mLabel = labelAfter(k.measure); const aLabel = k.areaName >= 0 ? k.areaName : labelAfter(k.area);
  if (k.area < 0 || k.measure < 0 || k.time < 0 || k.val < 0) throw new Error('unexpected OECD SDMX-CSV header');
  const kind = (code, label) => (/^RHP$/i.test(code) || /real house price/i.test(label ?? '') ? 'real' : /^(HPI|NHP|NHPI)$/i.test(code) || /nominal house price/i.test(label ?? '') ? 'nominal' : null);
  const by = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = splitCsv(line); if (k.freq >= 0 && f[k.freq] && f[k.freq] !== 'Q') continue;
    if (k.unit >= 0 && /^(PA|GR|PC)/i.test(f[k.unit] ?? '')) continue; // growth rates: we compute our own
    const kd = kind(f[k.measure], mLabel >= 0 ? f[mLabel] : ''); if (!kd) continue;
    const t = qIndex(f[k.time]); const v = Number(f[k.val]); if (t == null || !(v > 0)) continue;
    const iso3 = f[k.area]; if (!/^[A-Z]{3}$/.test(iso3)) continue; // countries only, not OECD or EA aggregates
    const s = by.get(iso3) ?? { name: aLabel >= 0 ? f[aLabel] : null, nominal: new Map(), real: new Map() }; s[kd].set(t, v); by.set(iso3, s);
  }
  return [...by].filter(([, s]) => s.nominal.size || s.real.size).map(([iso3, s]) => {
    const m = s.nominal.size ? s.nominal : s.real; const last = Math.max(...m.keys()); const v = m.get(last);
    const rl = s.real.size ? Math.max(...s.real.keys()) : null;
    return { iso3, name: s.name, value: r1(v), ch1: pct(v, m.get(last - 4)), ch5: pct(v, m.get(last - 20)), period: qLabel(last), nominal: !!s.nominal.size, real1y: rl != null ? pct(s.real.get(rl), s.real.get(rl - 4)) : null };
  });
}
async function oecd() {
  const text = local('OECD_FILE') ? readFileSync(local('OECD_FILE'), 'utf8') : await getText(OECD_URL);
  const list = oecdCountries(text);
  const { rows, unplaced } = countryRows(list.map((c) => ({ ...c, iso2: null })), (c) => ({ real1y: c.real1y, nominal: c.nominal }));
  if (rows.length < minRows(10)) throw new Error(`only ${rows.length} countries; previous file kept`);
  const period = rows.map((r) => r[8]).sort().pop();
  const kb = write('houseprices', 'oecd.json', { generatedAt: new Date().toISOString(), src: 'OECD, Analytical house price indicators (CC BY 4.0)', source: 'oecdhpi', unit: 'index', valueLabel: 'Nominal house price index (OECD, 2015 = 100)', period, fields: FIELDS_HP, rows });
  return `${rows.length} countries (${period})${unplaced ? `, ${unplaced} without a position` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ what each country sells (CEPII BACI)
const BACI_PAGE = 'https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37';
const BACI_BASE = 'https://www.cepii.fr/DATA_DOWNLOAD/baci/data/';
/** Short names of the Harmonized System (HS) chapters. */
export const HS2 = {
  '01': 'Live animals', '02': 'Meat', '03': 'Fish and seafood', '04': 'Dairy, eggs, honey', '05': 'Other animal products', '06': 'Plants and flowers', '07': 'Vegetables', '08': 'Fruit and nuts', '09': 'Coffee, tea, spices', '10': 'Cereals',
  11: 'Milling products', 12: 'Oil seeds', 13: 'Gums and resins', 14: 'Plaiting materials', 15: 'Animal and vegetable fats and oils', 16: 'Prepared meat and fish', 17: 'Sugar', 18: 'Cocoa', 19: 'Cereal preparations', 20: 'Prepared vegetables and fruit',
  21: 'Miscellaneous food', 22: 'Beverages', 23: 'Food waste and animal feed', 24: 'Tobacco', 25: 'Salt, stone, cement', 26: 'Ores', 27: 'Mineral fuels and oils', 28: 'Inorganic chemicals', 29: 'Organic chemicals', 30: 'Pharmaceuticals',
  31: 'Fertilisers', 32: 'Dyes and paints', 33: 'Perfumes and cosmetics', 34: 'Soaps and waxes', 35: 'Proteins and glues', 36: 'Explosives', 37: 'Photographic goods', 38: 'Other chemical products', 39: 'Plastics', 40: 'Rubber',
  41: 'Hides and leather', 42: 'Leather goods', 43: 'Furs', 44: 'Wood', 45: 'Cork', 46: 'Basketwork', 47: 'Pulp', 48: 'Paper', 49: 'Printed matter', 50: 'Silk',
  51: 'Wool', 52: 'Cotton', 53: 'Other plant fibres', 54: 'Synthetic filaments', 55: 'Synthetic staple fibres', 56: 'Wadding and rope', 57: 'Carpets', 58: 'Special fabrics', 59: 'Coated fabrics', 60: 'Knitted fabrics',
  61: 'Knitted clothing', 62: 'Woven clothing', 63: 'Other textile articles', 64: 'Footwear', 65: 'Headgear', 66: 'Umbrellas', 67: 'Feathers and wigs', 68: 'Stone articles', 69: 'Ceramics', 70: 'Glass',
  71: 'Gold, gems and jewellery', 72: 'Iron and steel', 73: 'Iron and steel articles', 74: 'Copper', 75: 'Nickel', 76: 'Aluminium', 78: 'Lead', 79: 'Zinc', 80: 'Tin', 81: 'Other base metals',
  82: 'Tools', 83: 'Metal articles', 84: 'Machinery and computers', 85: 'Electrical equipment and electronics', 86: 'Railway equipment', 87: 'Vehicles', 88: 'Aircraft and spacecraft', 89: 'Ships and boats', 90: 'Optical and medical instruments', 91: 'Clocks and watches',
  92: 'Musical instruments', 93: 'Arms and ammunition', 94: 'Furniture and lighting', 95: 'Toys and sports goods', 96: 'Miscellaneous manufactures', 97: 'Art and antiques', 99: 'Other',
};
export const hs2Name = (k) => HS2[k] ?? HS2[String(Number(k))] ?? `Chapter ${k}`;
/** Newest BACI version on the CEPII download page (e.g. "202501"), or null. */
export const baciVersion = (html) => [...String(html).matchAll(/BACI_HS92_V(\d{6}[a-z]?)\.zip/g)].map((m) => m[1]).sort().pop() ?? null;
/** Reads a BACI archive: the newest yearly file, country codes and product names → each exporter's totals. */
export async function readBaci(zip) {
  const entries = zipEntries(zip);
  const yearly = entries.map((e) => [e, /BACI_HS\d\d_Y(\d{4})_V\w+\.csv$/i.exec(e)?.[1]]).filter(([, y]) => y).sort((a, b) => a[1] - b[1]);
  if (!yearly.length) throw new Error('no BACI_HSxx_Yyyyy_V… yearly file in the archive');
  const [entry, year] = yearly.at(-1);
  const readSmall = async (re) => { const e = entries.find((x) => re.test(x)); const out = []; if (!e) return out; for await (const l of zipLines(zip, e)) out.push(l); return out; };
  const cc = await readSmall(/country_codes_V\w+\.csv$/i); const pc = await readSmall(/product_codes_HS\d\d_V\w+\.csv$/i);
  const countriesBy = new Map();
  if (cc.length) {
    const c = columns(cc[0]); const [code, name, iso3] = [c('country_code'), c('country_name', 'country_name_abbreviation'), c('country_iso3', 'iso_3digit_alpha')];
    for (const l of cc.slice(1)) { const f = splitCsv(l); if (f[code]) countriesBy.set(f[code].trim(), { name: f[name]?.trim(), iso3: f[iso3]?.trim() }); }
  }
  const products = new Map();
  if (pc.length) { const c = columns(pc[0]); const [code, desc] = [c('code'), c('description')]; for (const l of pc.slice(1)) { const f = splitCsv(l); if (f[code]) products.set(f[code].trim().padStart(6, '0'), f[desc]?.trim()); } }
  const ex = new Map(); let c = null; let n = 0;
  for await (const line of zipLines(zip, entry)) {
    if (!c) { const k = columns(line); c = { i: k('i'), k: k('k'), v: k('v') }; if (c.i < 0 || c.k < 0 || c.v < 0) throw new Error('unexpected BACI header'); continue; }
    const f = line.split(','); const v = Number(f[c.v]); if (!(v > 0)) continue;
    const i = f[c.i].trim(); const k = f[c.k].trim().replace(/"/g, '').padStart(6, '0'); n++;
    let x = ex.get(i); if (!x) { x = { total: 0, hs6: new Map(), hs2: new Map() }; ex.set(i, x); }
    x.total += v; x.hs6.set(k, (x.hs6.get(k) ?? 0) + v); const ch = k.slice(0, 2); x.hs2.set(ch, (x.hs2.get(ch) ?? 0) + v);
  }
  return { year: Number(year), exporters: ex, countries: countriesBy, products, flows: n };
}
export function exportRows(b, pts) {
  const rows = []; let unplaced = 0;
  for (const [code, x] of b.exporters) {
    const c = b.countries.get(code); const iso3 = c?.iso3; const p = iso3 ? pts.get(iso3) : null;
    if (!p) { unplaced++; continue; }
    const usd = (v) => Math.round(v * 1000); // BACI values are thousands of U.S. dollars
    const top6 = [...x.hs6].sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([k, v]) => [k, b.products.get(k) ?? `Product ${k}`, usd(v)]);
    const top2 = [...x.hs2].sort((a, b2) => b2[1] - a[1]).slice(0, 6).map(([k, v]) => [k, hs2Name(k), usd(v)]);
    rows.push([p.lat, p.lng, usd(x.total), iso3, p.name ?? c.name, top6, top2, b.year]);
  }
  return { rows: rows.sort((a, b2) => b2[2] - a[2]), unplaced };
}
async function baci(prev) {
  let zip; let version = null;
  if (local('BACI_ZIP')) zip = local('BACI_ZIP');
  else {
    if (process.env.BACI_URL) [zip] = await firstAvailable([[process.env.BACI_URL]], 'baci.zip');
    else {
      version = baciVersion(await getText(BACI_PAGE).catch(() => ''));
      if (version && prev?.version === version && existsSync(join(OUT, 'exports', 'countries.json'))) return { note: `BACI version ${version} unchanged; file kept`, version };
      const guesses = version ? [version] : [`${YEAR}01`, `${YEAR - 1}01b`, `${YEAR - 1}01`];
      [zip, , version] = await firstAvailable(guesses.map((v) => [`${BACI_BASE}BACI_HS92_V${v}.zip`, v]), 'baci.zip');
    }
  }
  const b = await readBaci(zip); const { rows, unplaced } = exportRows(b, countries());
  if (rows.length < minRows(100)) throw new Error(`only ${rows.length} exporting countries; previous file kept`);
  const kb = write('exports', 'countries.json', { generatedAt: new Date().toISOString(), year: b.year, version, src: 'CEPII BACI, HS 1992 nomenclature (Etalab Open Licence 2.0), built from UN Comtrade', fields: ['lat', 'lng', 'exportsUsd', 'iso3', 'name', 'topProducts', 'topChapters', 'year'], productFields: ['hs6', 'description', 'usd'], chapterFields: ['hs2', 'name', 'usd'], rows });
  return { note: `${rows.length} exporting countries (${b.year}, ${b.flows.toLocaleString('en')} trade flows${version ? `, version ${version}` : ''})${unplaced ? `, ${unplaced} without a position` : ''}, ${kb} KB`, version };
}

// ------------------------------------------------------------------ heavy industry (Climate TRACE assets)
/** Climate TRACE subsectors kept (power plants are already in the atlas from the World Resources Institute). */
/** Our subsector key → the Climate TRACE API's subsector name, where they differ. */
const TRACE_QUERY = { steel: 'iron-and-steel' };
export const TRACE_SUBSECTORS = { steel: 'Iron and steel', cement: 'Cement', aluminum: 'Aluminium', chemicals: 'Chemicals', 'petrochemical-steam-cracking': 'Petrochemicals (steam cracking)', 'pulp-and-paper': 'Pulp and paper', glass: 'Glass', lime: 'Lime', 'oil-and-gas-refining': 'Oil refining' };
const TRACE_API = process.env.TRACE_API ?? 'https://api.climatetrace.org/v6';
const TRACE_ZIPS = process.env.TRACE_ZIP_URL ? [process.env.TRACE_ZIP_URL] : ['https://downloads.climatetrace.org/latest/sector_packages/manufacturing.zip', 'https://downloads.climatetrace.org/latest/sector_packages/fossil_fuel_operations.zip'];
const pick = (o, ...ks) => { for (const k of ks) { for (const kk of [k, k.toLowerCase(), k[0].toUpperCase() + k.slice(1)]) if (o?.[kk] != null) return o[kk]; } return null; };
const normSub = (s) => String(s ?? '').toLowerCase().replace(/[\s_]+/g, '-').replace('iron-and-steel', 'steel').replace('aluminium', 'aluminum');
/** Assets from the Climate TRACE API ({ assets: [...] } or an array). */
export function traceApiAssets(j, subsector = null) {
  const list = Array.isArray(j) ? j : j.assets ?? j.Assets ?? j.data ?? [];
  const out = [];
  for (const a of list) {
    const g = pick(a, 'Centroid')?.Geometry ?? pick(a, 'Centroid')?.geometry ?? pick(a, 'Geometry')?.coordinates;
    const lat = Number(g ? g[1] : pick(a, 'Lat', 'latitude')); const lng = Number(g ? g[0] : pick(a, 'Lon', 'lng', 'longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const em = pick(a, 'EmissionsSummary') ?? [];
    const co2e = Array.isArray(em) ? (em.find((e) => /co2e_100yr/i.test(pick(e, 'Gas') ?? '')) ?? em.find((e) => /co2e/i.test(pick(e, 'Gas') ?? ''))) : null;
    const t = co2e ? Number(pick(co2e, 'EmissionsQuantity', 'quantity')) : Number(pick(a, 'Emissions', 'emissions_quantity'));
    const owners = pick(a, 'Owners'); const owner = Array.isArray(owners) ? owners.map((o) => (typeof o === 'string' ? o : pick(o, 'Name', 'CompanyName'))).filter(Boolean).slice(0, 3).join(', ') : pick(a, 'Owner', 'ReportingEntityName');
    out.push({ id: String(pick(a, 'Id', 'AssetId', 'source_id')), name: pick(a, 'Name', 'source_name') ?? 'Industrial site', lat, lng, sub: normSub(subsector ?? pick(a, 'Subsector') ?? (TRACE_SUBSECTORS[normSub(pick(a, 'Sector'))] ? pick(a, 'Sector') : pick(a, 'AssetType'))), iso3: pick(a, 'Country', 'iso3_country'), t: Number.isFinite(t) ? t : null, owner: owner || null, year: Number(pick(a, 'Year')) || null });
  }
  return out;
}
/** Assets from Climate TRACE emissions-sources CSV lines (one row per source, gas and month or year). */
export async function traceCsvAssets(lines, acc = new Map()) {
  let c = null;
  for await (const line of lines) {
    if (!c) { const k = columns(line); c = { id: k('source_id'), name: k('source_name'), sub: k('subsector', 'original_inventory_sector'), iso3: k('iso3_country'), start: k('start_time'), lat: k('lat'), lng: k('lon'), gas: k('gas'), q: k('emissions_quantity'), cap: k('capacity'), capU: k('capacity_units'), owner: k('owner_name', 'parent_name') }; if (c.id < 0 || c.lat < 0 || c.q < 0) throw new Error('unexpected Climate TRACE CSV header'); continue; }
    if (!line.trim()) continue;
    const f = splitCsv(line); if (c.gas >= 0 && !/^co2e_100yr$/i.test(f[c.gas]?.trim())) continue;
    const lat = Number(f[c.lat]); const lng = Number(f[c.lng]); if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) continue;
    const year = Number(String(f[c.start] ?? '').slice(0, 4)) || 0; const id = f[c.id].trim();
    let a = acc.get(id);
    if (!a) { a = { id, name: f[c.name]?.trim() || 'Industrial site', lat, lng, sub: normSub(f[c.sub]), iso3: f[c.iso3]?.trim(), byYear: new Map(), owner: c.owner >= 0 ? f[c.owner]?.trim() || null : null, cap: c.cap >= 0 && Number(f[c.cap]) > 0 ? `${Math.round(Number(f[c.cap]))} ${f[c.capU] ?? ''}`.trim() : null }; acc.set(id, a); }
    a.byYear.set(year, (a.byYear.get(year) ?? 0) + (Number(f[c.q]) || 0));
  }
  return acc;
}
const traceFromCsv = (acc) => [...acc.values()].map((a) => { const y = Math.max(...a.byYear.keys()); return { ...a, t: a.byYear.get(y), year: y || null, byYear: undefined }; });
export function traceRows(assets) {
  const seen = new Set(); const rows = [];
  for (const a of assets) {
    if (!TRACE_SUBSECTORS[a.sub] || seen.has(a.id)) continue; seen.add(a.id);
    rows.push([r4(a.lat), r4(a.lng), a.t != null ? Math.round(a.t) : null, a.name, a.sub, a.iso3 ?? null, a.owner ?? null, a.cap ?? null, a.id, a.year ?? null]);
  }
  return rows.sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0));
}
async function traceFromApi() {
  const out = []; const errs = [];
  for (const sub of Object.keys(TRACE_SUBSECTORS)) {
    // only the subsectors filter: the API ignores sectors= and returns every kind of asset
    try {
      for (let off = 0; off < 20000; off += 1000) {
        const page = traceApiAssets(await getJson(`${TRACE_API}/assets?subsectors=${encodeURIComponent(TRACE_QUERY[sub] ?? sub)}&limit=1000&offset=${off}`, 120_000), sub);
        out.push(...page); if (page.length < 1000) break;
      }
    } catch (e) { errs.push(`${sub}: ${e.message}`); }
  }
  if (!out.length) throw new Error(errs.slice(0, 2).join('; ') || 'no assets');
  return out;
}
async function traceFromZips(files) {
  const acc = new Map();
  for (const z of files) {
    if (isZip(z)) { for (const e of zipEntries(z).filter((x) => /emissions[-_]sources\.csv$/i.test(x) && !/ownership|confidence/i.test(x))) await traceCsvAssets(zipLines(z, e), acc); }
    else await traceCsvAssets(fileLines(z), acc);
  }
  return traceFromCsv(acc);
}
async function trace() {
  let assets; let via;
  if (local('TRACE_FILE')) {
    const f = local('TRACE_FILE');
    if (/\.json$/i.test(f)) { assets = traceApiAssets(JSON.parse(readFileSync(f, 'utf8'))); via = 'local API file'; } else { assets = await traceFromZips([f]); via = 'local CSV'; }
  } else {
    try { assets = await traceFromApi(); via = 'API'; }
    catch (e) {
      log('Climate TRACE API failed, trying the sector packages:', e.message);
      const files = []; for (const [i, u] of TRACE_ZIPS.entries()) { try { files.push(await download(u, join(tmp(), `trace-${i}.zip`))); } catch { /* next */ } }
      if (!files.length) throw new Error(`API: ${e.message}; no sector package downloaded`);
      assets = await traceFromZips(files); via = 'sector packages';
    }
  }
  const rows = traceRows(assets);
  if (rows.length < minRows(200)) throw new Error(`only ${rows.length} industrial sites (via ${via}); previous file kept`);
  const kb = write('industry', 'assets.json', { generatedAt: new Date().toISOString(), src: `Climate TRACE asset-level emissions (CC BY 4.0), via ${via}`, subsectors: TRACE_SUBSECTORS, fields: ['lat', 'lng', 'tCO2e', 'name', 'subsector', 'iso3', 'owner', 'capacity', 'id', 'year'], rows });
  const per = Object.keys(TRACE_SUBSECTORS).map((s) => `${s} ${rows.filter((r) => r[4] === s).length}`).join(', ');
  return `${rows.length.toLocaleString('en')} sites via ${via} (${per}), ${kb} KB`;
}

// ------------------------------------------------------------------ run
const JOBS = { fhfa, acs, ukhpi, ppd, eurostat, oecd, baci, trace };
const DIRS = ['houseprices', 'acs', 'sales', 'exports', 'industry'];
export const README = '# Global Intelligence Atlas economy data\n\nHouse prices, property sales, exports and heavy industry from openly licensed statistics, boiled down for the map, written monthly by `.github/workflows/economy.yml` on main (`tools/fetch-economy.mjs`); each run replaces the branch, and a source that fails keeps its previous file (see `status.json`).\n\n- `houseprices/fhfa.json`: U.S. Federal Housing Finance Agency (FHFA) House Price Index by state and metropolitan area (public domain).\n- `houseprices/ukhpi.json`: HM Land Registry UK House Price Index by local authority (Open Government Licence v3.0).\n- `houseprices/eurostat.json`: Eurostat house price index by country (CC BY 4.0).\n- `houseprices/oecd.json`: Organisation for Economic Co-operation and Development (OECD) house price indicators by country (CC BY 4.0).\n- `acs/counties.json`: U.S. Census Bureau American Community Survey (ACS) median home value and rent by county (public domain).\n- `sales/districts.json`: HM Land Registry Price Paid Data, sales in the last 12 months by postcode district (Open Government Licence v3.0; contains HM Land Registry data © Crown copyright and database right; no addresses are kept). Positions from Ordnance Survey Code-Point Open (contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; National Statistics data © Crown copyright and database right).\n- `exports/countries.json`: CEPII BACI exports by country and product (Etalab Open Licence 2.0).\n- `industry/assets.json`: Climate TRACE heavy-industry assets and emissions (CC BY 4.0).\n\nSee docs/REFERENCES.md on main for citations and terms.\n';
if (MAIN) {
  mkdirSync(OUT, { recursive: true });
  const statusFile = join(OUT, 'status.json');
  const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : { feeds: {} };
  status.generatedAt = new Date().toISOString(); status.run = process.env.GITHUB_RUN_ID ?? null;
  let failed = 0;
  for (const id of ALL) {
    if (!ONLY.has(id)) continue;
    const prev = status.feeds[id] ?? {};
    try {
      const res = await JOBS[id](prev); const note = typeof res === 'string' ? res : res.note;
      status.feeds[id] = { ok: true, note, at: new Date().toISOString(), ...(res?.version ? { version: res.version } : {}) }; log(id, note);
    } catch (e) { failed++; status.feeds[id] = { ...prev, ok: false, note: e.message, failedAt: new Date().toISOString() }; log(id, 'FAILED (previous file kept):', e.message); }
  }
  writeFileSync(statusFile, JSON.stringify(status));
  writeFileSync(join(OUT, 'README.md'), README);
  if (TMP) rmSync(TMP, { recursive: true, force: true });
  if (failed && failed === [...ONLY].filter((x) => JOBS[x]).length && !readdirSync(OUT).some((d) => DIRS.includes(d))) process.exitCode = 1;
}
