#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: weekly source probe (.github/workflows/health.yml).
// Asks every public service the app and the data jobs depend on for a small answer, checks that it looks right
// (status, type, a minimum size or a field), and also checks the machine-written branches (live-data status,
// aircraft-db) and the camera collector's per-source counts. Writes a Markdown report to probe-report.md and
// prints it; exits 1 when something is broken so the workflow can open or update a GitHub issue.
//
// Usage: node tools/probe-sources.mjs [owner/repo]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REPO = process.argv[2] ?? process.env.GITHUB_REPOSITORY ?? 'Normansrule/global-intelligence-atlas';
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas-probe/2.1 (+https://github.com/Normansrule/global-intelligence-atlas)' };
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const json = (min = 0, test = () => true) => ({ kind: 'json', min, test });
const text = (min = 0, re = null) => ({ kind: 'text', min, re });
// [name, url, check, note]. Keep in step with site/app/js/sources.js.
const PROBES = [
  ['USGS earthquakes', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', json(0, (j) => Array.isArray(j.features))],
  ['NASA EONET natural events', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=5', json(0, (j) => Array.isArray(j.events))],
  ['GDACS disaster alerts', 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC&alertlevel=Orange;Red', json(0, (j) => Array.isArray(j.features))],
  ['NOAA SWPC aurora', 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', json(1000)],
  ['CelesTrak orbits', 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', text(500, /\n1 /)],
  ['The Space Devs launches', 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1', json(0, (j) => Array.isArray(j.results))],
  ['OpenSky Network', 'https://opensky-network.org/api/states/all?lamin=45&lomin=5&lamax=47&lomax=7', json(0, (j) => 'states' in j)],
  ['airplanes.live', 'https://api.airplanes.live/v2/point/51.5/-0.4/50', json(0, (j) => Array.isArray(j.ac))],
  ['adsb.lol', 'https://api.adsb.lol/v2/lat/51.5/lon/-0.4/dist/50', json(0, (j) => Array.isArray(j.ac))],
  ['GDELT GEO 2.0', 'https://api.gdeltproject.org/api/v2/geo/geo?query=earthquake&mode=PointData&format=GeoJSON&timespan=24H&maxpoints=5', json(0, (j) => Array.isArray(j.features)), 'often down; the live-data job falls back to the event export'],
  ['GDELT 2.0 event export', 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt', text(50, /export\.CSV\.zip/)],
  ['NASA FIRMS fires', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv', text(10_000, /^latitude,longitude/)],
  ['RainViewer radar', 'https://api.rainviewer.com/public/weather-maps.json', json(0, (j) => j.radar?.past?.length > 0)],
  ['Open-Meteo weather', 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=0&current=temperature_2m', json(0, (j) => j.current)],
  ['NASA GIBS imagery', 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities', text(10_000)],
  ['Fintraffic ships (AIS)', 'https://meri.digitraffic.fi/api/ais/v1/locations', json(0, (j) => Array.isArray(j.features))],
  ['Wikipedia summaries', 'https://en.wikipedia.org/api/rest_v1/page/summary/Earth', json(0, (j) => j.title)],
  ['OpenSky aircraft database listing', 'https://s3.opensky-network.org/data-samples?list-type=2&prefix=metadata/', text(100, /aircraft/i)],
];

async function probe([name, url, c, note]) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { ...UA, ...(c.kind === 'json' ? { Accept: 'application/json' } : {}) }, signal: AbortSignal.timeout(45_000) });
    const body = await r.text(); const ms = Date.now() - t0;
    if (!r.ok) return { name, ok: false, ms, err: `HTTP ${r.status}`, note };
    if (body.length < c.min) return { name, ok: false, ms, err: `answer too small (${body.length} bytes)`, note };
    if (c.kind === 'json') { let j; try { j = JSON.parse(body); } catch { return { name, ok: false, ms, err: 'not JSON', note }; } if (!c.test(j)) return { name, ok: false, ms, err: 'JSON without the expected fields', note }; }
    if (c.kind === 'text' && c.re && !c.re.test(body)) return { name, ok: false, ms, err: 'unexpected content', note };
    return { name, ok: true, ms, note };
  } catch (e) { return { name, ok: false, ms: Date.now() - t0, err: e.name === 'TimeoutError' ? 'timed out' : e.message, note }; }
}

const results = [];
for (let i = 0; i < PROBES.length; i += 4) results.push(...(await Promise.all(PROBES.slice(i, i + 4).map(probe))));

// Machine-written branches and the camera collector
const branch = [];
try {
  const s = await (await fetch(`${RAW}/live-data/status.json`, { headers: UA })).json();
  const age = (Date.now() - Date.parse(s.generatedAt)) / 60_000;
  branch.push({ name: 'live-data job', ok: age < 60, err: age < 60 ? '' : `last publish ${Math.round(age)} min ago` });
  for (const [k, f] of Object.entries(s.feeds ?? {})) branch.push({ name: `live-data: ${k}`, ok: !!f.ok, err: f.ok ? '' : f.note });
} catch (e) { branch.push({ name: 'live-data job', ok: false, err: `status.json unreadable: ${e.message}` }); }
try {
  const m = await (await fetch(`${RAW}/aircraft-db/meta.json`, { headers: UA })).json();
  const days = (Date.now() - Date.parse(m.generatedAt)) / 86_400_000;
  branch.push({ name: 'aircraft-db table', ok: days < 10, err: days < 10 ? '' : `built ${Math.round(days)} days ago` });
} catch (e) { branch.push({ name: 'aircraft-db table', ok: false, err: 'meta.json unreadable (run the Aircraft types workflow)' }); }
const camFile = 'site/app/data/cameras.json';
if (existsSync(camFile)) {
  const d = JSON.parse(readFileSync(camFile, 'utf8'));
  for (const s of d.sources) branch.push({ name: `cameras: ${s.name}`, ok: s.state ? s.state === 'ok' : s.count > 0, err: s.state === 'ok' ? '' : `${s.count} cameras (${s.state ?? 'no state'})${s.error ? `: ${s.error}` : ''}`, soft: /needs a free developer key/.test(s.error ?? '') });
}

const bad = [...results, ...branch].filter((r) => !r.ok && !r.soft);
const line = (r) => `| ${r.ok ? '✅' : r.soft ? '⚪' : '❌'} | ${r.name} | ${r.ms != null ? `${r.ms} ms` : ''} | ${(r.err ?? '').replace(/\|/g, '/')}${r.note ? ` (${r.note})` : ''} |`;
const md = `## Data health probe, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC

${bad.length ? `**${bad.length} problem${bad.length === 1 ? '' : 's'}.**` : '**Everything answered.**'}

### Public services

| | Source | Time | Problem |
|---|---|---:|---|
${results.map(line).join('\n')}

### Data jobs

| | Check | | Problem |
|---|---|---|---|
${branch.map(line).join('\n')}

⚪ = optional source that needs a key you have not added.
`;
writeFileSync('probe-report.md', md);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
console.log(md);
process.exitCode = bad.length ? 1 : 0;
