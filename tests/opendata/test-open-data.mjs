// SPDX-License-Identifier: AGPL-3.0-only
// Checks tools/fetch-open-data.mjs on small stand-in files shaped like the real ones: Wikidata SPARQL results, the
// NGA World Port Index (JSON and CSV) and TeleGeography's cable and landing-point GeoJSON with per-cable details.
//   node tests/opendata/test-open-data.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wktPoint, nuclearRows, wpiPort, wpiRecords, portRows, cableRows } from '../../tools/fetch-open-data.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info).slice(0, 600)); };

const uri = (q) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` });
const lit = (v) => ({ type: 'literal', value: String(v) });
const pt = (lon, lat) => lit(`Point(${lon} ${lat})`);
const res = (bindings) => JSON.stringify({ head: { vars: [] }, results: { bindings } });
check('WKT points are longitude first', JSON.stringify(wktPoint('Point(52.23 23.97)')) === '[23.97,52.23]' && wktPoint('Point(200 10)') === null && wktPoint('nonsense') === null);
const nuc = [
  { item: uri('Q1'), itemLabel: lit('Barakah nuclear power plant'), coord: pt(52.23, 23.97), countryLabel: lit('United Arab Emirates'), operatorLabel: lit('Nawah'), start: lit('2020-08-01T00:00:00Z'), watts: lit('5600000000') },
  { item: uri('Q1'), itemLabel: lit('Barakah nuclear power plant'), coord: pt(52.23, 23.97), countryLabel: lit('United Arab Emirates'), operatorLabel: lit('ENEC'), start: lit('2020-08-01T00:00:00Z') },
  { item: uri('Q2'), itemLabel: lit('Zwentendorf'), coord: pt(15.88, 48.35), countryLabel: lit('Austria'), start: lit('1978-01-01T00:00:00Z'), end: lit('1985-01-01T00:00:00Z') },
  { item: uri('Q3'), itemLabel: lit('El Dabaa'), coord: pt(28.48, 31.04), countryLabel: lit('Egypt') },
  { item: uri('Q4'), itemLabel: lit('Q4'), coord: pt(1, 1) },
  { item: uri('Q5'), itemLabel: lit('No position') },
];
const nr = nuclearRows(nuc, new Date('2026-10-18'));
const bar = nr.find((x) => x.name.startsWith('Barakah'));
check('Wikidata nuclear: rows merged by item, operators collected, capacity in MW', nr.length === 3 && bar.operator === 'Nawah, ENEC' && bar.capacityMW === 5600 && bar.status === 'active' && bar.lat === 23.97 && bar.wikidata.endsWith('/Q1'), nr);
check('Wikidata nuclear: closed and planned plants; items without an English name or position dropped', nr.find((x) => x.name === 'Zwentendorf').status === 'closed' && nr.find((x) => x.name === 'El Dabaa').status === 'planned', nr);

const wpiJson = JSON.stringify({ ports: [
  { portNumber: 57010, portName: 'SHANGHAI', countryName: 'China', ycoord: 31.233, xcoord: 121.483, harborSize: 'L', harborType: 'RN', unloCode: 'CN SHA', chDepth: 12.5, maxVesselLength: 400 },
  { portNumber: 1, portName: 'TINY COVE', countryName: 'Nowhere', ycoord: 10, xcoord: 10, harborSize: 'V' },
  { portNumber: 2, portName: 'NULL ISLAND', countryName: 'Nowhere', ycoord: 0, xcoord: 0, harborSize: 'L' },
] });
const wpiCsv = '"World Port Index Number","Region Name","Main Port Name","Country Code","Harbor Size","Harbor Type","Channel Depth (m)","Latitude","Longitude"\n"31580","Rotterdam","ROTTERDAM","Netherlands","Large","River natural","24.4","51.9","4.483333"\n"9999","x","SMALL, PORT","Spain","Small","Coastal breakwater","","40.1","-1.2"\n';
const pj = portRows(wpiRecords(wpiJson)); const pc = portRows(wpiRecords(wpiCsv));
check('World Port Index JSON: codes expanded, very small harbours and 0,0 left out', pj.length === 1 && pj[0].name === 'Shanghai' && pj[0].size === 'Large' && pj[0].harbourType === 'River natural' && pj[0].channelDepthM === 12.5 && pj[0].locode === 'CN SHA' && pj[0].id === 'wpi-57010', pj);
check('World Port Index CSV: same records from the download, quoted commas kept, large first', pc.length === 2 && pc[0].name === 'Rotterdam' && pc[0].lon === 4.483 && pc[0].type === 'large harbour' && pc[1].name === 'Small, Port' && pc[1].channelDepthM === null, pc);
check('a port record without a name or position is refused', wpiPort({ portName: '', ycoord: 1, xcoord: 1 }) === null && wpiPort({ portName: 'X', ycoord: 'n/a', xcoord: 1 }) === null);

const geo = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { id: 'marea', name: 'MAREA', color: '#939597' }, geometry: { type: 'MultiLineString', coordinates: [[[-76.06, 36.85], [-50.123, 37.9], [-2.95, 43.27]], [[-10, 45], [-9, 44]]] } },
  { type: 'Feature', properties: { id: 'short-one', name: 'Short One' }, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } },
  { type: 'Feature', properties: { id: 'broken' }, geometry: { type: 'Point', coordinates: [0, 0] } },
] };
const landing = { features: [{ properties: { id: 'bilbao-spain', name: 'Bilbao, Spain' }, geometry: { coordinates: [-2.95, 43.27] } }, { properties: { id: 'virginia-beach-va-united-states', name: 'Virginia Beach, VA, United States' }, geometry: { coordinates: [-75.98, 36.85] } }] };
const details = new Map([['marea', { id: 'marea', name: 'MAREA', length: '6,605 km', rfs: '2018 February', rfs_year: 2018, owners: 'Meta, Microsoft, Telxius', is_planned: false, landing_points: [{ id: 'bilbao-spain', name: 'Bilbao, Spain', country: 'Spain' }, { id: 'virginia-beach-va-united-states', name: 'Virginia Beach, VA, United States', country: 'United States' }] }]]);
const cr = cableRows(geo, landing, details); const ma = cr.find((c) => c.id === 'marea');
check('TeleGeography: parts kept, longest part as points, coordinates rounded', cr.length === 2 && ma.parts.length === 2 && ma.points.length === 3 && ma.points[1][0] === -50.12, cr);
check('TeleGeography: details give year, length, owners and landings with positions', ma.rfsYear === 2018 && ma.lengthKm === 6605 && ma.major === false && ma.owners.join('|') === 'Meta|Microsoft|Telxius' && ma.landingPoints[1].city === 'Virginia Beach, VA' && ma.landingPoints[1].countryName === 'United States' && ma.landingPoints[0].lat === 43.27, ma);
check('TeleGeography: a cable without details still draws', cr.find((c) => c.id === 'short-one').owners.length === 0 && cr.find((c) => c.id === 'short-one').rfsYear === null);

// the whole job on files
const dir = mkdtempSync(join(tmpdir(), 'open-data-test-')); const out = join(dir, 'out'); const wd = join(dir, 'wd'); const cd = join(dir, 'cd');
mkdirSync(wd); mkdirSync(cd);
const many = (k, f) => Array.from({ length: k }, (_, i) => f(i));
writeFileSync(join(wd, 'nuclear.json'), res(many(120, (i) => ({ item: uri(`Q${100 + i}`), itemLabel: lit(`Plant ${i}`), coord: pt(i % 180, (i % 60) - 30), start: lit('1990-01-01T00:00:00Z') }))));
writeFileSync(join(wd, 'spaceports.json'), res(many(12, (i) => ({ item: uri(`Q${300 + i}`), itemLabel: lit(`Spaceport ${i}`), coord: pt(-80 + i, 28), operatorLabel: lit('Agency') }))));
writeFileSync(join(wd, 'economic.json'), res([...many(30, (i) => ({ item: uri(`Q${400 + i}`), itemLabel: lit(`Exchange ${i}`), itemDescription: lit('stock exchange in somewhere'), coord: pt(i, 40), kind: lit('exchange') })), { item: uri('Q500'), itemLabel: lit('Bank of Somewhere'), coord: pt(5, 50), kind: lit('central bank') }]));
writeFileSync(join(wd, 'minerals.json'), res([...many(10, (i) => ({ item: uri(`Q${600 + i}`), itemLabel: lit(`Mine ${i}`), coord: pt(116, -33 + i), product: lit('lithium') })), { item: uri('Q600'), itemLabel: lit('Mine 0'), coord: pt(116, -33), product: lit('tantalum ore') }]));
writeFileSync(join(dir, 'wpi.json'), JSON.stringify({ ports: many(150, (i) => ({ portNumber: i + 10, portName: `PORT ${i}`, countryName: 'Testland', ycoord: 10 + i / 10, xcoord: 20, harborSize: 'M' })) }));
writeFileSync(join(dir, 'cable-geo.json'), JSON.stringify({ features: many(60, (i) => ({ properties: { id: `c${i}`, name: `Cable ${i}` }, geometry: { type: 'LineString', coordinates: [[i, 0], [i, 10]] } })) }));
writeFileSync(join(dir, 'landing-geo.json'), JSON.stringify(landing));
writeFileSync(join(cd, 'c0.json'), JSON.stringify({ id: 'c0', name: 'Cable 0', length: '12,000 km', rfs_year: 2001, owners: 'A, B' }));
execFileSync('node', [join(ROOT, 'tools', 'fetch-open-data.mjs'), out], { env: { ...process.env, WIKIDATA_DIR: wd, WPI_FILE: join(dir, 'wpi.json'), CABLE_GEO_FILE: join(dir, 'cable-geo.json'), LANDING_GEO_FILE: join(dir, 'landing-geo.json'), CABLE_DETAIL_DIR: cd }, stdio: 'pipe' });
const J = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'));
const st = J('status.json');
check('every source writes its file and its status', ['nuclear', 'spaceports', 'economic', 'minerals', 'ports', 'cables'].every((k) => st.feeds[k]?.ok), st);
const eco = J('economic.json').rows; const mi = J('minerals.json').rows; const ca = J('cables.json').rows;
check('exchanges and central banks typed, descriptions capitalised', eco.length === 31 && eco.find((e) => e.name === 'Bank of Somewhere').type === 'central bank' && eco[0].description.startsWith('Stock exchange'), eco.slice(0, 2));
check('mines list every mineral once, ore names shortened', mi.length === 10 && mi.find((m) => m.name === 'Mine 0').mineral === 'Lithium, Tantalum', mi[0]);
check('cables: details read where present (missing detail pages do not fail the job)', ca.length === 60 && ca.find((c) => c.id === 'c0').major === true && ca.find((c) => c.id === 'c0').rfsYear === 2001 && /59 detail pages failed/.test(st.feeds.cables.note), st.feeds.cables.note);
check('the shipped chokepoints are the EIA eight', JSON.parse(readFileSync(join(ROOT, 'site/app/data/open/waterways.json'), 'utf8')).rows.length === 8);
// too few results keeps the previous file
writeFileSync(join(wd, 'nuclear.json'), res(many(5, (i) => ({ item: uri(`Q${i + 1}`), itemLabel: lit(`P${i}`), coord: pt(1, 1) }))));
execFileSync('node', [join(ROOT, 'tools', 'fetch-open-data.mjs'), out, 'nuclear'], { env: { ...process.env, WIKIDATA_DIR: wd }, stdio: 'pipe' });
check('a short answer keeps the previous file', J('nuclear.json').rows.length === 120 && J('status.json').feeds.nuclear.ok === false && J('status.json').feeds.ports.ok, J('status.json').feeds.nuclear);
console.log(`SUMMARY ${pass} / ${n}`);
process.exitCode = pass === n ? 0 : 1;
