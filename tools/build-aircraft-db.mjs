#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the aircraft type table (ICAO 24-bit address → type, registration, class).
//
// Live flight feeds from OpenSky carry no aircraft type, so the app used to guess the plane's shape from its
// speed and height. This job downloads the OpenSky Network aircraft database once a week and writes it as 256
// small files, one per first two hex digits of the address, so a client only loads the slice it needs:
//   <out>/types/a3.json  →  { "a3b2c1": ["B738", "N12345", "L2J"], … }
//   <out>/meta.json      →  { generatedAt, source, count }
// .github/workflows/aircraft-db.yml force-pushes <out> to the orphan branch `aircraft-db`. The live-data job
// (tools/fetch-live.mjs) fills in the type of every aircraft in the snapshot from it, and the app looks up
// planes it sees live (desktop app, proxy) from the same files.
//
// Usage: node tools/build-aircraft-db.mjs [outDir]       (default ./adb)
//        AIRCRAFT_DB_CSV=path/to/file.csv node tools/build-aircraft-db.mjs   (use a file you already have)
import { mkdirSync, writeFileSync, createReadStream, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const OUT = process.argv[2] ?? 'adb';
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.1 (+https://github.com/Normansrule/global-intelligence-atlas; educational globe)' };
const BUCKET = 'https://s3.opensky-network.org/data-samples';

/** The newest "aircraft-database-complete-YYYY-MM.csv" in OpenSky's public bucket, else the older fixed name. */
async function latestUrl() {
  try {
    const r = await fetch(`${BUCKET}?list-type=2&prefix=metadata/`, { headers: UA, signal: AbortSignal.timeout(30_000) });
    const xml = await r.text();
    const keys = [...xml.matchAll(/<Key>(metadata\/aircraft-database-complete-\d{4}-\d{2}\.csv)<\/Key>/g)].map((m) => m[1]).sort();
    if (keys.length) return `${BUCKET}/${keys.at(-1)}`;
  } catch (e) { console.warn('bucket listing failed:', e.message); }
  return `${BUCKET}/metadata/aircraftDatabase.csv`;
}

/** Split one CSV line; OpenSky quotes fields with ' in the newer files and " in the older one. */
function splitCsv(line) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) { if (line[i + 1] === q) { cur += c; i++; } else q = null; } else cur += c; }
    else if ((c === '"' || c === "'") && cur === '') q = c;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

async function lines() {
  if (process.env.AIRCRAFT_DB_CSV) return { src: process.env.AIRCRAFT_DB_CSV, rl: createInterface({ input: createReadStream(process.env.AIRCRAFT_DB_CSV), crlfDelay: Infinity }) };
  const url = await latestUrl();
  console.log('downloading', url);
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return { src: url, rl: createInterface({ input: Readable.fromWeb(r.body), crlfDelay: Infinity }) };
}

const { src, rl } = await lines();
const shards = new Map(); let header = null; let col = {}; let count = 0; let rows = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  const f = splitCsv(line);
  if (!header) { header = f.map((h) => h.trim().toLowerCase()); col = Object.fromEntries(header.map((h, i) => [h, i])); continue; }
  rows += 1;
  const icao = (f[col.icao24] ?? '').trim().toLowerCase();
  const type = (f[col.typecode] ?? '').trim().toUpperCase();
  if (!/^[0-9a-f]{6}$/.test(icao) || !/^[A-Z0-9]{2,4}$/.test(type)) continue;
  const reg = (f[col.registration] ?? '').trim().slice(0, 12);
  const cls = (f[col.icaoaircraftclass] ?? f[col.icaoaircrafttype] ?? '').trim().toUpperCase().slice(0, 3);
  const k = icao.slice(0, 2);
  let s = shards.get(k); if (!s) { s = {}; shards.set(k, s); }
  s[icao] = cls ? [type, reg, cls] : [type, reg];
  count += 1;
}
if (count < 10_000) { console.error(`only ${count} aircraft with a type in ${rows} rows: refusing to publish`); process.exit(1); }
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'types'), { recursive: true });
for (let i = 0; i < 256; i++) { const k = i.toString(16).padStart(2, '0'); writeFileSync(join(OUT, 'types', `${k}.json`), JSON.stringify(shards.get(k) ?? {})); }
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: src, count, rows }));
writeFileSync(join(OUT, 'README.md'), `# Global Intelligence Atlas aircraft types\n\nMachine-written by \`tools/build-aircraft-db.mjs\` (weekly, \`.github/workflows/aircraft-db.yml\`). ${count.toLocaleString('en')} aircraft with an ICAO type code, from the OpenSky Network aircraft database (${src}). Files: \`types/<first two hex digits>.json\` mapping ICAO 24-bit address → [type, registration, ICAO aircraft class].\n`);
console.log(`${count} aircraft with a type (of ${rows} rows) → ${OUT}/types/*.json`);
