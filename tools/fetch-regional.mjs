#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the "regional-data" branch. Detailed public records that are too big for a web page to
// read directly, boiled down for the map. Runs monthly (.github/workflows/regional.yml); each source is independent,
// and a source that fails keeps its previous files.
//
//   pur/   California Department of Pesticide Regulation (CDPR), Pesticide Use Reporting (PUR): every agricultural
//          pesticide application reported in California, by one-mile Public Land Survey System (PLSS) section,
//          chemical, crop and method (aerial, which includes crop dusting, or ground).
//   usgs/  U.S. Geological Survey (USGS) Pesticide National Synthesis Project: estimated agricultural use of each
//          pesticide compound in every county of the conterminous United States (EPest low and high estimates).
//   tri/   U.S. Environmental Protection Agency (EPA) Toxics Release Inventory (TRI): what each industrial facility
//          reported releasing, by chemical.
//   ces/   CalEnviroScreen 4.0 (California Office of Environmental Health Hazard Assessment, OEHHA): pollution, pesticide
//          and health burden of every California census tract, as scores and percentiles.
//   echo/  EPA Enforcement and Compliance History Online (ECHO): inspections, violations and penalties of regulated
//          facilities (only those with a violation, an enforcement action or a penalty in the last five years).
//   wqp/   Water Quality Portal (U.S. Geological Survey, EPA and state agencies): pesticides measured in streams, lakes
//          and wells over the last few years, by sampling site: how often each was found and the highest amount.
//
// Usage: node tools/fetch-regional.mjs <outDir> [pur,usgs,tri,ces,echo,wqp]
// Local files instead of downloads (tests, or a manual run): PUR_ZIP, EPEST_FILE, GAZETTEER_FILE, TRI_FILE, CES_FILE (.xlsx or a .zip holding it), ECHO_FILE (.csv or .zip),
// WQP_FILE (a result CSV; WQP_STATION_FILE adds site positions for the older result format).
// Overrides: PUR_URL (a URL with {year}), EPEST_URL ({year}), GAZETTEER_URL, TRI_URL ({year}), CES_URL, ECHO_URL, WQP_BASE.
// Water Quality Portal: WQP_STATES (default every state), WQP_YEARS (default 3).
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sectionCentre, makeKey } from '../site/app/js/plss.js';

const OUT = process.argv[2] ?? 'regional';
const ONLY = new Set((process.argv[3] ?? 'pur,usgs,tri,ces,echo,wqp').split(','));
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.6 (+https://github.com/Normansrule/global-intelligence-atlas; educational globe)' };
const log = (...a) => console.log('[regional]', ...a);
const YEAR = new Date().getUTCFullYear();
const TMP = join(tmpdir(), `gia-regional-${process.pid}`); mkdirSync(TMP, { recursive: true });
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r1 = (x) => Math.round(x * 10) / 10;
const write = (dir, name, obj) => { const p = join(OUT, dir, name); mkdirSync(dirname(p), { recursive: true }); const s = JSON.stringify(obj); writeFileSync(p, s); return s.length; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function download(url, file, timeout = 20 * 60_000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  return file;
}
/** First URL in the list that downloads; returns [file, url, year]. */
async function firstAvailable(candidates, name) {
  const errs = [];
  for (const [url, year] of candidates) {
    try { return [await download(url, join(TMP, name)), url, year]; } catch (e) { errs.push(`${url}: ${e.message}`); }
  }
  throw new Error(`none of ${candidates.length} addresses worked (${errs.slice(-2).join('; ')})`);
}
const years = (back, from = YEAR - 1) => Array.from({ length: back }, (_, i) => from - i);

/** Lines of a text file inside a zip, streamed through the system unzip. */
async function* zipLines(zip, entry) {
  const p = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: p.stdout, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}
const zipEntries = (zip) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);

/** Splits one CSV line (quotes allowed). */
export function splitCsv(line, sep = ',') {
  if (sep !== ',' || !line.includes('"')) return line.split(sep);
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
/** Column index by any of several names (case and spacing ignored; a leading "12. " numbering is dropped). */
export function columns(header, sep = ',') {
  const names = splitCsv(header.replace(/^﻿/, ''), sep).map((h) => h.trim().replace(/^\d+\.\s*/, '').toLowerCase().replace(/\s+/g, ' '));
  return (...alts) => { for (const a of alts) { const i = names.indexOf(a.toLowerCase()); if (i >= 0) return i; } return -1; };
}

// ------------------------------------------------------------------ California pesticide use (CDPR PUR)
const PUR_URL = process.env.PUR_URL ?? 'https://files.cdpr.ca.gov/pub/outgoing/pur_archives/pur{year}.zip';
const METHOD = { A: 'aerial', G: 'ground', O: 'other' };

/** Reads a PUR archive into section and chemical totals. Exported for tests. */
export async function readPur(zip) {
  const entries = zipEntries(zip);
  const udc = entries.filter((e) => /(^|\/)udc\d{2}_\d{2}\.txt$/i.test(e));
  if (!udc.length) throw new Error('no udcYY_CC.txt files in the archive');
  const lookup = async (re, codeCols, nameCols) => {
    const e = entries.find((x) => re.test(x)); const m = new Map(); if (!e) return m;
    let col = null;
    for await (const line of zipLines(zip, e)) {
      if (!col) { const c = columns(line); col = [c(...codeCols), c(...nameCols)]; if (col[0] < 0 || col[1] < 0) return m; continue; }
      const f = splitCsv(line); const code = f[col[0]]?.trim(); if (code) m.set(code, f[col[1]]?.trim());
    }
    return m;
  };
  const chemNames = await lookup(/(^|\/)chemical\.txt$/i, ['chem_code'], ['chemname', 'chemical_name']);
  const siteNames = await lookup(/(^|\/)site\.txt$/i, ['site_code'], ['site_name']);
  const countyNames = await lookup(/(^|\/)county\.txt$/i, ['county_cd'], ['couty_name', 'county_name']);
  const sections = new Map(); const chems = new Map();
  let records = 0; let placed = 0; let unplaced = 0; let nonAg = 0; let lbsAll = 0;
  for (const e of udc) {
    let c = null;
    for await (const line of zipLines(zip, e)) {
      if (!c) {
        const k = columns(line);
        c = { chem: k('chem_code'), lbs: k('lbs_chm_used'), county: k('county_cd'), mer: k('base_ln_mer'), twp: k('township'), td: k('tship_dir'), rng: k('range'), rd: k('range_dir'), sec: k('section'), method: k('aer_gnd_ind'), site: k('site_code'), date: k('applic_dt'), rec: k('record_id') };
        if (c.chem < 0 || c.lbs < 0) throw new Error(`${e}: unexpected header`);
        continue;
      }
      if (line.startsWith('use_no') || !line.trim()) continue; // repeated header or blank line
      const f = splitCsv(line); records++;
      const lbs = Number(f[c.lbs]); if (!(lbs > 0)) continue;
      const chem = f[c.chem]?.trim(); lbsAll += lbs;
      const ch = chems.get(chem) ?? { lbs: 0, aer: 0, apps: 0, months: Array(12).fill(0), sections: 0 };
      ch.lbs += lbs; ch.apps++;
      const method = f[c.method]?.trim().toUpperCase();
      if (method === 'A') ch.aer += lbs;
      const mo = Number(/^(\d{1,2})\//.exec(f[c.date] ?? '')?.[1] ?? /^\d{4}-(\d{2})/.exec(f[c.date] ?? '')?.[1]);
      if (mo >= 1 && mo <= 12) ch.months[mo - 1] += lbs;
      chems.set(chem, ch);
      const rec = f[c.rec]?.trim().toUpperCase();
      if (rec === 'C' || !f[c.sec]?.trim()) { nonAg++; continue; } // monthly non-farm summaries have no section
      const parts = [f[c.mer], f[c.twp], f[c.td], f[c.rng], f[c.rd], f[c.sec]].map((x) => x?.trim());
      const pos = sectionCentre(...parts); if (!pos) { unplaced++; continue; }
      const key = makeKey(...parts); placed++;
      let s = sections.get(key);
      if (!s) { s = { key, lat: pos.lat, lng: pos.lng, lbs: 0, aer: 0, apps: 0, chem: new Map(), site: new Map(), county: f[c.county]?.trim() }; sections.set(key, s); }
      s.lbs += lbs; s.apps++; if (method === 'A') s.aer += lbs;
      const sc = s.chem.get(chem) ?? [0, 0, 0]; sc[0] += lbs; if (method === 'A') sc[1] += lbs; sc[2]++; s.chem.set(chem, sc);
      const site = f[c.site]?.trim(); if (site) s.site.set(site, (s.site.get(site) ?? 0) + lbs);
    }
  }
  for (const s of sections.values()) for (const k of s.chem.keys()) chems.get(k).sections++;
  return { sections, chems, chemNames, siteNames, countyNames, records, placed, unplaced, nonAg, lbsAll, files: udc.length };
}

export function purOutputs(p, year, src) {
  const top = [...p.chems.entries()].sort((a, b) => b[1].lbs - a[1].lbs);
  const chemIdx = new Map(top.map(([k], i) => [k, i]));
  const siteList = []; const siteIdx = new Map();
  const site = (code) => { if (!siteIdx.has(code)) { siteIdx.set(code, siteList.length); siteList.push({ code, name: p.siteNames.get(code) ?? `Site ${code}` }); } return siteIdx.get(code); };
  const rows = [...p.sections.values()].sort((a, b) => b.lbs - a.lbs).map((s) => {
    const cs = [...s.chem.entries()].sort((a, b) => b[1][0] - a[1][0]);
    const topSite = [...s.site.entries()].sort((a, b) => b[1] - a[1])[0];
    return [r4(s.lat), r4(s.lng), r1(s.lbs), r1(s.aer), s.apps, cs[0] ? chemIdx.get(cs[0][0]) : null, cs[0] ? r1(cs[0][1][0]) : null, cs[1] ? chemIdx.get(cs[1][0]) : null, cs[2] ? chemIdx.get(cs[2][0]) : null, topSite ? site(topSite[0]) : null, s.county ?? null, s.key];
  });
  const N_CHEM = Number(process.env.PUR_CHEM_FILES ?? 120);
  const chemList = top.slice(0, 400).map(([code, c], i) => ({ code, name: p.chemNames.get(code) ?? `Chemical ${code}`, lbs: Math.round(c.lbs), aer: Math.round(c.aer), apps: c.apps, sections: c.sections, months: c.months.map(Math.round), file: i < N_CHEM ? `chem/${slug(code)}.json` : null }));
  const files = {};
  for (const ch of chemList.filter((x) => x.file)) {
    files[ch.file] = { code: ch.code, name: ch.name, fields: ['lat', 'lng', 'lbs', 'aerialLbs', 'apps'], rows: [...p.sections.values()].filter((s) => s.chem.has(ch.code)).map((s) => { const v = s.chem.get(ch.code); return [r4(s.lat), r4(s.lng), r1(v[0]), r1(v[1]), v[2]]; }).sort((a, b) => b[2] - a[2]) };
  }
  const index = {
    generatedAt: new Date().toISOString(), year, src,
    records: p.records, sectionsWithUse: p.sections.size, placed: p.placed, unplaced: p.unplaced, nonAgRecords: p.nonAg,
    lbs: Math.round(p.lbsAll), aerialLbs: Math.round([...p.chems.values()].reduce((a, c) => a + c.aer, 0)),
    chems: chemList, sites: siteList, counties: Object.fromEntries(p.countyNames),
  };
  const sectionsFile = { generatedAt: index.generatedAt, year, fields: ['lat', 'lng', 'lbs', 'aerialLbs', 'apps', 'chem1', 'chem1Lbs', 'chem2', 'chem3', 'site', 'county', 'plss'], rows };
  return { index, sectionsFile, files };
}

async function pur() {
  let zip; let url; let year;
  if (process.env.PUR_ZIP) { zip = process.env.PUR_ZIP; url = 'local file'; year = Number(process.env.PUR_YEAR ?? 0) || null; }
  else [zip, url, year] = await firstAvailable(years(6).map((y) => [PUR_URL.replace('{year}', y), y]), 'pur.zip');
  log('PUR archive', url, year);
  const p = await readPur(zip);
  if (!year) year = Number(/udc(\d{2})_/i.exec(zipEntries(zip).find((e) => /udc\d{2}_/i.test(e)) ?? '')?.[1]) + 2000 || null;
  const o = purOutputs(p, year, 'California Department of Pesticide Regulation, Pesticide Use Reporting');
  rmSync(join(OUT, 'pur'), { recursive: true, force: true });
  const kb = Math.round((write('pur', 'index.json', o.index) + write('pur', 'sections.json', o.sectionsFile) + Object.entries(o.files).reduce((a, [f, j]) => a + write('pur', f, j), 0)) / 1024);
  return `${p.records.toLocaleString('en')} records from ${p.files} county files (${year}), ${p.sections.size.toLocaleString('en')} sections, ${Object.keys(o.files).length} chemical files, ${kb} KB${p.unplaced ? `; ${p.unplaced} records had no valid section` : ''}`;
}

// ------------------------------------------------------------------ U.S. county pesticide estimates (USGS)
const EPEST_URL = process.env.EPEST_URL ?? 'https://water.usgs.gov/nawqa/pnsp/usage/maps/county-level/PesticideUseEstimates/EPest.county.estimates.{year}.txt';
const GAZ_URL = process.env.GAZETTEER_URL ?? `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR - 2}_Gazetteer/${YEAR - 2}_Gaz_counties_national.zip`;

/** County centres from the Census Gazetteer (tab-separated): GEOID → { name, state, lat, lng, sqmi }. */
export function readGazetteer(text) {
  const lines = text.split(/\r?\n/); const c = columns(lines[0], '\t'); const m = new Map();
  const [g, n, s, la, lo, ar] = [c('geoid'), c('name'), c('usps'), c('intptlat'), c('intptlong'), c('aland_sqmi')];
  for (const line of lines.slice(1)) {
    const f = line.split('\t'); if (!f[g]) continue;
    m.set(f[g].trim(), { name: f[n]?.trim(), state: f[s]?.trim(), lat: Number(f[la]), lng: Number(f[lo]), sqmi: Number(f[ar]) || null });
  }
  return m;
}
/** EPest county estimates (tab-separated): COMPOUND, YEAR, STATE_FIPS_CODE, COUNTY_FIPS_CODE, EPEST_LOW_KG, EPEST_HIGH_KG. */
export function readEpest(text) {
  const lines = text.split(/\r?\n/); const sep = lines[0].includes('\t') ? '\t' : ',';
  const c = columns(lines[0], sep);
  const [cp, yr, st, co, lo, hi] = [c('compound'), c('year'), c('state_fips_code'), c('county_fips_code'), c('epest_low_kg'), c('epest_high_kg')];
  if (cp < 0 || st < 0 || co < 0 || hi < 0) throw new Error('unexpected EPest header');
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = splitCsv(line, sep); if (!f[cp]) continue;
    rows.push({ compound: f[cp].trim().replace(/^"|"$/g, ''), year: Number(f[yr]), geoid: f[st].trim().padStart(2, '0') + f[co].trim().padStart(3, '0'), low: Number(f[lo]) || 0, high: Number(f[hi]) || 0 });
  }
  return rows;
}
export function usgsOutputs(rows, gaz, year) {
  const byCompound = new Map(); const byCounty = new Map();
  for (const r of rows) {
    const g = gaz.get(r.geoid); if (!g) continue;
    const kg = r.high || r.low;
    const c = byCompound.get(r.compound) ?? { low: 0, high: 0, counties: 0, rows: [] };
    c.low += r.low; c.high += r.high; c.counties++; c.rows.push([r4(g.lat), r4(g.lng), Math.round(r.low), Math.round(r.high), r.geoid]); byCompound.set(r.compound, c);
    const k = byCounty.get(r.geoid) ?? { kg: 0, top: [] }; k.kg += kg; k.top.push([r.compound, kg]); byCounty.set(r.geoid, k);
  }
  const compounds = [...byCompound.entries()].sort((a, b) => b[1].high - a[1].high);
  const N = Number(process.env.EPEST_FILES ?? 150);
  const list = compounds.map(([name, c], i) => ({ name, kgLow: Math.round(c.low), kgHigh: Math.round(c.high), counties: c.counties, file: i < N ? `compound/${slug(name)}.json` : null }));
  const files = {};
  for (const [i, [name, c]] of compounds.entries()) if (i < N) files[list[i].file] = { name, year, fields: ['lat', 'lng', 'kgLow', 'kgHigh', 'geoid'], rows: c.rows.sort((a, b) => b[3] - a[3]) };
  const counties = [...byCounty.entries()].map(([geoid, k]) => { const g = gaz.get(geoid); const t = k.top.sort((a, b) => b[1] - a[1]); return [geoid, g.name, g.state, r4(g.lat), r4(g.lng), g.sqmi, Math.round(k.kg), t[0]?.[0] ?? null, Math.round(t[0]?.[1] ?? 0), t[1]?.[0] ?? null, t[2]?.[0] ?? null]; });
  return {
    index: { generatedAt: new Date().toISOString(), year, src: 'U.S. Geological Survey, Pesticide National Synthesis Project (EPest county estimates)', compounds: list.slice(0, 500), counties: counties.length },
    countiesFile: { year, fields: ['geoid', 'name', 'state', 'lat', 'lng', 'sqmi', 'kgHigh', 'top1', 'top1Kg', 'top2', 'top3'], rows: counties },
    files,
  };
}
async function usgs() {
  let gazText;
  if (process.env.GAZETTEER_FILE) gazText = readFileSync(process.env.GAZETTEER_FILE, 'utf8');
  else {
    const [zip] = await firstAvailable([[GAZ_URL], [GAZ_URL.replaceAll(String(YEAR - 2), String(YEAR - 3))], [GAZ_URL.replaceAll(String(YEAR - 2), String(YEAR - 4))]], 'gaz.zip');
    gazText = execFileSync('unzip', ['-p', zip], { encoding: 'utf8', maxBuffer: 256 << 20 });
  }
  const gaz = readGazetteer(gazText);
  let text; let year;
  if (process.env.EPEST_FILE) { text = readFileSync(process.env.EPEST_FILE, 'utf8'); year = Number(process.env.EPEST_YEAR ?? 0) || null; }
  else { const [file, , y] = await firstAvailable(years(10).map((yy) => [EPEST_URL.replace('{year}', yy), yy]), 'epest.txt'); text = readFileSync(file, 'utf8'); year = y; }
  const rows = readEpest(text); year ??= rows[0]?.year ?? null;
  const o = usgsOutputs(rows, gaz, year);
  rmSync(join(OUT, 'usgs'), { recursive: true, force: true });
  const kb = Math.round((write('usgs', 'index.json', o.index) + write('usgs', 'counties.json', o.countiesFile) + Object.entries(o.files).reduce((a, [f, j]) => a + write('usgs', f, j), 0)) / 1024);
  return `${rows.length.toLocaleString('en')} county estimates (${year}), ${o.index.compounds.length} compounds, ${o.countiesFile.rows.length} counties, ${kb} KB`;
}

// ------------------------------------------------------------------ industrial releases (EPA TRI)
const TRI_URL = process.env.TRI_URL ?? 'https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/{year}_US/csv';
/** Facilities from a TRI basic data file (CSV with numbered column names). Exported for tests. */
export function readTri(text) {
  const lines = text.split(/\r?\n/); const c = columns(lines[0]);
  const k = { id: c('trifd', 'trifid'), name: c('facility name'), city: c('city'), st: c('st', 'state'), lat: c('latitude'), lng: c('longitude'), sector: c('industry sector'), chem: c('chemical'), carc: c('carcinogen'), unit: c('unit of measure'), total: c('total releases'), air: c('on-site release total'), year: c('year') };
  if (k.lat < 0 || k.chem < 0 || k.total < 0) throw new Error('unexpected TRI header');
  const fac = new Map(); let year = null;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = splitCsv(line); const lat = Number(f[k.lat]); const lng = Number(f[k.lng]);
    if (!lat || !lng) continue;
    year ??= Number(f[k.year]) || null;
    const grams = /gram/i.test(f[k.unit] ?? ''); const lbs = (Number(f[k.total]) || 0) / (grams ? 453.592 : 1);
    const id = f[k.id] || `${f[k.name]}|${lat}|${lng}`;
    const x = fac.get(id) ?? { id, name: f[k.name], city: f[k.city], st: f[k.st], lat, lng, sector: f[k.sector], lbs: 0, carc: 0, chems: [] };
    x.lbs += lbs; if (/^y/i.test(f[k.carc] ?? '')) x.carc += lbs; x.chems.push([f[k.chem], lbs]);
    fac.set(id, x);
  }
  return { facilities: [...fac.values()], year };
}
export function triOutputs({ facilities, year }) {
  const rows = facilities.sort((a, b) => b.lbs - a.lbs).map((x) => {
    const t = x.chems.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, l]) => [n, r1(l)]);
    return [r4(x.lat), r4(x.lng), r1(x.lbs), r1(x.carc), x.name, x.city, x.st, x.sector, x.id, t];
  });
  return { generatedAt: new Date().toISOString(), year, src: 'U.S. Environmental Protection Agency, Toxics Release Inventory (basic data files)', fields: ['lat', 'lng', 'lbs', 'carcinogenLbs', 'name', 'city', 'state', 'sector', 'trifid', 'top'], rows };
}
async function tri() {
  let text;
  if (process.env.TRI_FILE) text = readFileSync(process.env.TRI_FILE, 'utf8');
  else { const [file] = await firstAvailable(years(4).map((y) => [TRI_URL.replace('{year}', y), y]), 'tri.csv'); text = readFileSync(file, 'utf8'); }
  const t = readTri(text); const o = triOutputs(t);
  rmSync(join(OUT, 'tri'), { recursive: true, force: true });
  const kb = Math.round(write('tri', 'facilities.json', o) / 1024);
  return `${o.rows.length.toLocaleString('en')} facilities (${t.year}), ${kb} KB`;
}

// ------------------------------------------------------------------ spreadsheets (.xlsx) without a library
const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
/** Rows (arrays of strings) of the first worksheet of an .xlsx file. Exported for tests. */
export function readXlsx(file, sheet = null) {
  const entries = zipEntries(file);
  const sheetPath = sheet ?? entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1]))[0];
  if (!sheetPath) throw new Error('no worksheet in the spreadsheet');
  const unz = (e) => execFileSync('unzip', ['-p', file, e], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const shared = entries.includes('xl/sharedStrings.xml') ? [...unz('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ''))) : [];
  const rows = [];
  for (const rm of unz(sheetPath).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const body = cm[2] ?? ''; const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]; const t = /\bt="(\w+)"/.exec(attrs)?.[1];
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      if (t === 's') v = shared[Number(v)] ?? ''; else if (t === 'inlineStr') v = xmlText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? ''); else v = xmlText(v);
      row[ref ? colIndex(ref) : row.length] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ------------------------------------------------------------------ CalEnviroScreen 4.0 (OEHHA)
const CES_URLS = (process.env.CES_URL ? [process.env.CES_URL] : [
  'https://oehha.ca.gov/media/downloads/calenviroscreen/document/calenviroscreen40resultsdatadictionaryf2021.zip',
  'https://oehha.ca.gov/media/downloads/calenviroscreen/document/calenviroscreen40resultsdatadictionary_f_2021.xlsx',
]).map((u) => [u]);
/** Indicators kept for the map: key, label, column names (value, percentile). */
export const CES_INDICATORS = [
  ['score', 'Overall CalEnviroScreen score', ['ces 4.0 score'], ['ces 4.0 percentile']],
  ['pesticides', 'Pesticide use nearby', ['pesticides'], ['pesticides pctl']],
  ['pm25', 'Fine particles (PM2.5)', ['pm2.5'], ['pm2.5 pctl']],
  ['ozone', 'Ozone', ['ozone'], ['ozone pctl']],
  ['diesel', 'Diesel particulate matter', ['diesel pm'], ['diesel pm pctl']],
  ['water', 'Drinking water contaminants', ['drinking water'], ['drinking water pctl']],
  ['lead', 'Lead risk from housing', ['lead'], ['lead pctl']],
  ['tox', 'Toxic releases from facilities', ['tox. release', 'tox release'], ['tox. release pctl', 'tox release pctl']],
  ['traffic', 'Traffic', ['traffic'], ['traffic pctl']],
  ['cleanup', 'Cleanup sites', ['cleanup sites'], ['cleanup sites pctl']],
  ['groundwater', 'Groundwater threats', ['groundwater threats'], ['groundwater threats pctl']],
  ['hazwaste', 'Hazardous waste', ['haz. waste', 'haz waste'], ['haz. waste pctl', 'haz waste pctl']],
  ['impwater', 'Impaired waters', ['imp. water bodies', 'imp water bodies'], ['imp. water bodies pctl', 'imp water bodies pctl']],
  ['solidwaste', 'Solid waste sites', ['solid waste'], ['solid waste pctl']],
  ['asthma', 'Asthma (emergency visits)', ['asthma'], ['asthma pctl']],
  ['lbw', 'Low birth weight', ['low birth weight'], ['low birth weight pctl']],
  ['cardio', 'Cardiovascular disease', ['cardiovascular disease'], ['cardiovascular disease pctl']],
  ['poverty', 'Poverty', ['poverty'], ['poverty pctl']],
  ['unemployment', 'Unemployment', ['unemployment'], ['unemployment pctl']],
  ['housing', 'Housing burden', ['housing burden'], ['housing burden pctl']],
];
/** Tracts from the CalEnviroScreen results sheet. Exported for tests. */
export function readCes(rows) {
  const hi = rows.findIndex((r) => r.some((x) => /census tract/i.test(x)) && r.some((x) => /^latitude$/i.test(String(x).trim())));
  if (hi < 0) throw new Error('no header row with Census Tract and Latitude');
  const c = columns(rows[hi].map((x) => (/[",]/.test(x) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(','));
  const [tr, la, lo, pop, cty, zip, loc] = [c('census tract'), c('latitude'), c('longitude'), c('total population'), c('california county'), c('zip'), c('approximate location')];
  const ind = CES_INDICATORS.map(([key, label, v, p]) => ({ key, label, v: c(...v), p: c(...p) }));
  const missing = ind.filter((x) => x.p < 0).map((x) => x.key);
  if (la < 0 || lo < 0 || ind[0].p < 0) throw new Error('unexpected CalEnviroScreen columns');
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const lat = Number(r[la]); const lng = Number(r[lo]); if (!lat || !lng || !r[tr]) continue;
    const val = (i) => { const n = Number(r[i]); return i < 0 || r[i] === '' || !Number.isFinite(n) ? null : Math.round(n * 100) / 100; };
    out.push({ tract: String(r[tr]).replace(/\.0$/, ''), lat, lng, pop: val(pop), county: r[cty] ?? null, zip: r[zip] ?? null, place: r[loc] ?? null, v: ind.map((x) => val(x.v)), p: ind.map((x) => val(x.p)) });
  }
  return { tracts: out, indicators: ind.map(({ key, label }) => ({ key, label })), missing };
}
async function ces() {
  let file = process.env.CES_FILE;
  if (!file) [file] = await firstAvailable(CES_URLS, 'ces.download');
  // the download is either the spreadsheet itself or a zip holding it
  const entries = zipEntries(file);
  let xlsx = file;
  if (!entries.some((e) => e.startsWith('xl/'))) {
    const inner = entries.find((e) => /\.xlsx$/i.test(e) && !e.startsWith('__MACOSX'));
    if (!inner) throw new Error('no .xlsx in the CalEnviroScreen download');
    xlsx = join(TMP, 'ces.xlsx'); writeFileSync(xlsx, execFileSync('unzip', ['-p', file, inner], { maxBuffer: 1 << 30 }));
  }
  const { tracts, indicators, missing } = readCes(readXlsx(xlsx));
  rmSync(join(OUT, 'ces'), { recursive: true, force: true });
  const kb = Math.round(write('ces', 'tracts.json', { generatedAt: new Date().toISOString(), version: '4.0', src: 'OEHHA CalEnviroScreen 4.0', indicators, fields: ['tract', 'lat', 'lng', 'population', 'county', 'zip', 'place', 'values', 'percentiles'], rows: tracts.map((t) => [t.tract, r4(t.lat), r4(t.lng), t.pop, t.county, t.zip, t.place, t.v, t.p]) }) / 1024);
  return `${tracts.length.toLocaleString('en')} census tracts, ${indicators.length - missing.length} indicators${missing.length ? ` (not found: ${missing.join(', ')})` : ''}, ${kb} KB`;
}

// ------------------------------------------------------------------ EPA ECHO (enforcement and compliance)
const ECHO_URL = process.env.ECHO_URL ?? 'https://echo.epa.gov/files/echodownloads/echo_exporter.zip';
/** Facilities with a violation, enforcement action or penalty, from ECHO Exporter rows. Exported for tests. */
export async function readEcho(lines) {
  let c = null; const out = []; let total = 0;
  for await (const line of lines) {
    if (!c) {
      const k = columns(line);
      c = { id: k('registry_id'), name: k('fac_name'), city: k('fac_city'), st: k('fac_state'), lat: k('fac_lat'), lng: k('fac_long'), insp: k('fac_inspection_count'), last: k('fac_date_last_inspection'), formal: k('fac_formal_action_count'), pen: k('fac_total_penalties'), penN: k('fac_penalty_count'), qnc: k('fac_qtrs_with_nc'), snc: k('fac_snc_flg'), status: k('fac_compliance_status'), sncProg: k('fac_programs_in_snc'), air: k('air_flag'), npdes: k('npdes_flag'), rcra: k('rcra_flag'), sdwa: k('sdwis_flag'), tri: k('tri_flag'), naics: k('fac_naics_codes') };
      if (c.lat < 0 || c.id < 0 || c.qnc < 0) throw new Error('unexpected ECHO Exporter header');
      continue;
    }
    total++;
    const f = splitCsv(line); const lat = Number(f[c.lat]); const lng = Number(f[c.lng]);
    if (!lat || !lng) continue;
    const qnc = Number(f[c.qnc]) || 0; const formal = Number(f[c.formal]) || 0; const pen = Number(String(f[c.pen] ?? '').replace(/[$,]/g, '')) || 0; const snc = /^y/i.test(f[c.snc] ?? '');
    if (!qnc && !formal && !pen && !snc) continue;
    const progs = [['air', 'Clean Air Act'], ['npdes', 'Clean Water Act'], ['rcra', 'hazardous waste (RCRA)'], ['sdwa', 'Safe Drinking Water Act'], ['tri', 'TRI']].filter(([k]) => /^y/i.test(f[c[k]] ?? '')).map(([, n]) => n);
    out.push([r4(lat), r4(lng), snc ? 1 : 0, qnc, formal, Math.round(pen), Number(f[c.insp]) || 0, f[c.last] || null, f[c.name], f[c.city], f[c.st], f[c.id], progs.join(', '), f[c.status] || null, f[c.sncProg] || null]);
  }
  out.sort((a, b) => b[2] - a[2] || b[5] - a[5] || b[3] - a[3]);
  return { rows: out, total };
}
async function echo() {
  let file = process.env.ECHO_FILE;
  if (!file) [file] = await firstAvailable([[ECHO_URL]], 'echo.zip');
  let lines;
  if (zipEntriesSafe(file)) {
    const e = zipEntries(file).find((x) => /echo_exporter\.csv$/i.test(x)) ?? zipEntries(file).find((x) => /\.csv$/i.test(x));
    if (!e) throw new Error('no CSV in the ECHO download');
    lines = zipLines(file, e);
  } else lines = createInterface({ input: (await import('node:fs')).createReadStream(file), crlfDelay: Infinity });
  const { rows, total } = await readEcho(lines);
  rmSync(join(OUT, 'echo'), { recursive: true, force: true });
  const kb = Math.round(write('echo', 'facilities.json', { generatedAt: new Date().toISOString(), src: 'EPA ECHO Exporter', total, fields: ['lat', 'lng', 'snc', 'qtrsNonCompliance', 'formalActions', 'penaltiesUsd', 'inspections', 'lastInspection', 'name', 'city', 'state', 'registryId', 'programs', 'status', 'programsInSnc'], rows }) / 1024);
  return `${rows.length.toLocaleString('en')} facilities with violations, actions or penalties out of ${total.toLocaleString('en')}, ${kb} KB`;
}
const zipEntriesSafe = (f) => { try { zipEntries(f); return true; } catch { return false; } };

// ------------------------------------------------------------------ Water Quality Portal: measured pesticides
const WQP_BASE = process.env.WQP_BASE ?? 'https://www.waterqualitydata.us';
/** Pesticides to look for, with the EPA drinking-water limit (maximum contaminant level, µg/L) where there is one. */
export const WQP_CHEMS = [['Atrazine', 3], ['Simazine', 4], ['Metolachlor', null], ['Glyphosate', 700], ['2,4-D', 70], ['Chlorpyrifos', null], ['Imidacloprid', null], ['Diuron', null], ['Bifenthrin', null], ['Metribuzin', null], ['Acetochlor', null], ['Diazinon', null], ['Fipronil', null], ['Carbaryl', null], ['Alachlor', 2]];
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');
const FIPS = { AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56', PR: '72' };
/** µg/L from a value and its unit, or null when the unit is not a concentration in water. */
export function toUgL(v, unit) {
  const u = String(unit ?? '').trim().toLowerCase().replace('µ', 'u');
  if (!Number.isFinite(v)) return null;
  if (/^(ug\/l|ppb)/.test(u)) return v; if (/^ng\/l|^ppt/.test(u)) return v / 1000; if (/^mg\/l|^ppm/.test(u)) return v * 1000;
  return null;
}
export const siteKind = (t) => (/well|spring|subsurface|ground/i.test(t ?? '') ? 'well' : /stream|river|canal|ditch|channel|estuary/i.test(t ?? '') ? 'stream' : /lake|reservoir|pond|impoundment/i.test(t ?? '') ? 'lake' : 'other');
/** Adds result rows (an async iterable of CSV lines, either the WQX 3.0 or the older layout) to `sites`. Exported for tests. */
export async function addWqpResults(lines, sites, stations = new Map()) {
  let c = null; let n = 0;
  for await (const line of lines) {
    if (!c) {
      const k = columns(line);
      c = { id: k('location_identifier', 'monitoringlocationidentifier'), lat: k('location_latitude', 'latitudemeasure', 'activitylocation/latitudemeasure'), lng: k('location_longitude', 'longitudemeasure', 'activitylocation/longitudemeasure'), type: k('location_type', 'monitoringlocationtypename'), name: k('location_name', 'monitoringlocationname'), org: k('org_formalname', 'organizationformalname', 'org_identifier', 'organizationidentifier'), date: k('activity_startdate', 'activitystartdate'), media: k('activity_media', 'activitymedianame'), chem: k('result_characteristic', 'characteristicname'), val: k('result_measure', 'resultmeasurevalue'), unit: k('result_measureunit', 'resultmeasure/measureunitcode'), det: k('result_resultdetectioncondition', 'resultdetectionconditiontext') };
      if (c.id < 0 || c.chem < 0 || c.val < 0) throw new Error('unexpected Water Quality Portal header');
      continue;
    }
    if (!line.trim()) continue;
    const f = splitCsv(line); const id = f[c.id]; if (!id) continue;
    if (c.media >= 0 && f[c.media] && !/^water/i.test(f[c.media])) continue;
    const chem = WQP_CHEMS.find(([k]) => k.toLowerCase() === String(f[c.chem]).trim().toLowerCase())?.[0]; if (!chem) continue;
    let s = sites.get(id);
    if (!s) {
      const st = stations.get(id) ?? {}; const lat = Number(c.lat >= 0 ? f[c.lat] : st.lat) || Number(st.lat); const lng = Number(c.lng >= 0 ? f[c.lng] : st.lng) || Number(st.lng);
      if (!lat || !lng) continue;
      s = { id, lat, lng, kind: siteKind(c.type >= 0 ? f[c.type] : st.type), name: (c.name >= 0 ? f[c.name] : st.name) || id, org: (c.org >= 0 ? f[c.org] : st.org) || '', chems: new Map() };
      sites.set(id, s);
    }
    const ug = toUgL(Number(f[c.val]), f[c.unit]);
    const cond = f[c.det] ?? '';
    const detected = /detected not quantified|present above/i.test(cond) || (ug != null && ug > 0 && !/not detected|below|absent|non-detect/i.test(cond));
    const x = s.chems.get(chem) ?? { samples: 0, det: 0, max: 0, last: '' }; x.samples++; n++;
    if (detected) { x.det++; if (ug > x.max && !/below|not detected/i.test(cond)) x.max = ug; }
    const d = String(f[c.date] ?? ''); if (d > x.last) x.last = d;
    s.chems.set(chem, x);
  }
  return n;
}
/** Site positions from a station CSV (older layout). */
export async function readWqpStations(lines) {
  let c = null; const m = new Map();
  for await (const line of lines) {
    if (!c) { const k = columns(line); c = { id: k('monitoringlocationidentifier', 'location_identifier'), lat: k('latitudemeasure', 'location_latitude'), lng: k('longitudemeasure', 'location_longitude'), type: k('monitoringlocationtypename', 'location_type'), name: k('monitoringlocationname', 'location_name'), org: k('organizationformalname', 'org_formalname') }; continue; }
    const f = splitCsv(line); if (f[c.id]) m.set(f[c.id], { lat: f[c.lat], lng: f[c.lng], type: f[c.type], name: f[c.name], org: f[c.org] });
  }
  return m;
}
export function wqpOutputs(sites, years) {
  const lim = Object.fromEntries(WQP_CHEMS);
  const rows = [...sites.values()].map((s) => {
    const cs = [...s.chems.entries()].sort((a, b) => b[1].det - a[1].det || b[1].max - a[1].max);
    const samples = cs.reduce((a, [, x]) => a + x.samples, 0); const det = cs.reduce((a, [, x]) => a + x.det, 0);
    const ratio = Math.max(0, ...cs.map(([k, x]) => (lim[k] ? x.max / lim[k] : 0)));
    return [r4(s.lat), r4(s.lng), s.kind, s.name, s.id, s.org, samples, det, cs.filter(([, x]) => x.det).length, Math.round(ratio * 1000) / 1000, cs.map(([k, x]) => [k, Math.round(x.max * 10000) / 10000, x.det, x.samples, x.last])];
  }).sort((a, b) => b[7] - a[7]);
  const chems = WQP_CHEMS.map(([name, mcl]) => { let sitesN = 0; let detSites = 0; let samples = 0; let det = 0; for (const s of sites.values()) { const x = s.chems.get(name); if (!x) continue; sitesN++; samples += x.samples; det += x.det; if (x.det) detSites++; } return { name, mcl, sites: sitesN, detectedAt: detSites, samples, detections: det }; });
  return { generatedAt: new Date().toISOString(), years, src: 'Water Quality Portal (National Water Quality Monitoring Council: USGS, EPA and state agencies)', chems, fields: ['lat', 'lng', 'kind', 'name', 'siteId', 'organization', 'samples', 'detections', 'chemsDetected', 'maxRatioToLimit', 'chems'], chemFields: ['name', 'maxUgL', 'detections', 'samples', 'lastDate'], rows };
}
async function* httpLines(url, timeout = 15 * 60_000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  yield* createInterface({ input: Readable.fromWeb(r.body), crlfDelay: Infinity });
}
async function wqp() {
  const years = Number(process.env.WQP_YEARS ?? 3); const sites = new Map(); let n = 0; const errs = [];
  if (process.env.WQP_FILE) {
    const fs = await import('node:fs');
    const lines = (f) => createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    const stations = process.env.WQP_STATION_FILE ? await readWqpStations(lines(process.env.WQP_STATION_FILE)) : new Map();
    n = await addWqpResults(lines(process.env.WQP_FILE), sites, stations);
  } else {
    const from = new Date(Date.now() - years * 365.25 * 86_400_000); const lo = `${String(from.getUTCMonth() + 1).padStart(2, '0')}-${String(from.getUTCDate()).padStart(2, '0')}-${from.getUTCFullYear()}`;
    const chemQ = WQP_CHEMS.map(([k]) => `characteristicName=${encodeURIComponent(k)}`).join('&');
    for (const st of (process.env.WQP_STATES ?? STATES.join(',')).split(',')) {
      const q = `statecode=US%3A${FIPS[st]}&${chemQ}&startDateLo=${lo}&mimeType=csv`;
      try { n += await addWqpResults(httpLines(`${WQP_BASE}/wqx3/Result/search?${q}&dataProfile=basicPhysChem`), sites); }
      catch (e3) {
        try { const stations = await readWqpStations(httpLines(`${WQP_BASE}/data/Station/search?${q}&zip=no`)); n += await addWqpResults(httpLines(`${WQP_BASE}/data/Result/search?${q}&zip=no`), sites, stations); }
        catch (e) { errs.push(`${st}: ${e3.message} / ${e.message}`); }
      }
    }
    if (!sites.size) throw new Error(`no results (${errs.slice(0, 2).join('; ')})`);
  }
  const o = wqpOutputs(sites, years);
  rmSync(join(OUT, 'wqp'), { recursive: true, force: true });
  const kb = Math.round(write('wqp', 'sites.json', o) / 1024);
  return `${n.toLocaleString('en')} results at ${o.rows.length.toLocaleString('en')} sites, ${o.rows.filter((r) => r[7]).length.toLocaleString('en')} with a detection, ${kb} KB${errs.length ? `; states that failed: ${errs.map((e) => e.split(':')[0]).join(' ')}` : ''}`;
}

// ------------------------------------------------------------------ run
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const statusFile = join(OUT, 'status.json');
  const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : { feeds: {} };
  status.generatedAt = new Date().toISOString(); status.run = process.env.GITHUB_RUN_ID ?? null;
  let failed = 0;
  for (const [id, fn] of [['pur', pur], ['usgs', usgs], ['tri', tri], ['ces', ces], ['echo', echo], ['wqp', wqp]]) {
    if (!ONLY.has(id)) continue;
    const prev = status.feeds[id] ?? {};
    try { const note = await fn(); status.feeds[id] = { ok: true, note, at: new Date().toISOString() }; log(id, note); }
    catch (e) { failed++; status.feeds[id] = { ...prev, ok: false, note: e.message, failedAt: new Date().toISOString() }; log(id, 'FAILED (previous files kept):', e.message); }
  }
  writeFileSync(statusFile, JSON.stringify(status));
  writeFileSync(join(OUT, 'README.md'), '# Global Intelligence Atlas regional data\n\nDetailed public records boiled down for the map, written monthly by `.github/workflows/regional.yml` on main (`tools/fetch-regional.mjs`); each run replaces the branch.\n\n- `pur/`: California Department of Pesticide Regulation, Pesticide Use Reporting, by one-mile section, chemical, crop and method.\n- `usgs/`: U.S. Geological Survey Pesticide National Synthesis Project county estimates.\n- `tri/`: U.S. EPA Toxics Release Inventory facilities.\n- `ces/`: CalEnviroScreen 4.0 census tracts (OEHHA).\n- `echo/`: EPA ECHO facilities with violations, enforcement actions or penalties.\n- `wqp/`: Water Quality Portal sites with pesticide results.\n\nSee docs/REFERENCES.md on main for citations and terms.\n');
  rmSync(TMP, { recursive: true, force: true });
  if (failed && failed === [...ONLY].length && !readdirSync(OUT).some((d) => ['pur', 'usgs', 'tri', 'ces', 'echo', 'wqp'].includes(d))) process.exitCode = 1;
}
