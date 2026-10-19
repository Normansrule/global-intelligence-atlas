// SPDX-License-Identifier: AGPL-3.0-only
// Checks tools/fetch-economy.mjs on small stand-in files shaped like the real ones (tests/economy/fixtures/): the
// FHFA House Price Index master file, Census Gazetteer and American Community Survey answers, the UK House Price
// Index, Price Paid Data, OS Code-Point Open, Eurostat JSON-stat, OECD SDMX-CSV, a CEPII BACI archive and Climate
// TRACE assets (API JSON and CSV); then runs the whole job offline and loads the layers of site/app/js/economy.js.
//   node tests/economy/test-economy.mjs        (needs the zip and unzip commands)
import { mkdtempSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import * as E from '../../tools/fetch-economy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..'); const FX = join(HERE, 'fixtures');
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info).slice(0, 700)); };
const lines = (f) => createInterface({ input: createReadStream(join(FX, f)), crlfDelay: Infinity });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dir = mkdtempSync(join(tmpdir(), 'economy-test-'));

// ---- positions
const [la, lo] = E.bngToWgs84(651409.903, 313177.27);
check('British National Grid → WGS84: Ordnance Survey worked example (Caister water tower)', near(la, 52.6576, 0.002) && near(lo, 1.7179, 0.003), [la, lo]);
const [pl, pg] = E.bngToWgs84(529090, 179645);
check('British National Grid → WGS84: Buckingham Palace', near(pl, 51.501, 0.002) && near(pg, -0.1416, 0.003), [pl, pg]);
check('outward codes of postcodes', E.outcode('SW1A 1AA') === 'SW1A' && E.outcode('cf101aa') === 'CF10' && E.outcode('M1 1AE') === 'M1' && E.outcode('nonsense') === null && E.outcode('') === null);
async function* cpLines() { for (const f of ['sw.csv', 'cf.csv']) yield* lines(`codepoint/Data/CSV/${f}`); }
const cp = await E.readCodePoint(cpLines());
const sw = cp.districts.get('SW1A'); const wm = cp.authorities.get('E09000033');
check('Code-Point Open: postcode districts and local authorities averaged, postcodes without a position skipped', cp.postcodes === 5 && sw.postcodes === 3 && near(sw.lat, 51.5013, 0.003) && near(sw.lng, -0.133, 0.006) && wm.postcodes === 3 && cp.districts.has('CF10') && !cp.districts.has('SW1X'), { sw, wm, n: cp.postcodes });
const pts = E.countryPoints(JSON.parse(readFileSync(join(ROOT, 'site/app/data/countries.geojson'), 'utf8')));
const de = pts.get('DEU'); const jp = pts.get('JP');
check('country label points from countries.geojson, by alpha-2 and alpha-3', de && near(de.lat, 51.1, 1.5) && near(de.lng, 10.4, 1.5) && jp && near(jp.lat, 36.5, 3) && pts.get('DE') === de, { de, jp });

// ---- FHFA
const gazCbsa = E.readGazetteer(readFileSync(join(FX, 'gaz_cbsa.txt'), 'utf8'));
const fh = await E.readFhfa(lines('fhfa_master.csv'));
const ca = fh.find((s) => s.id === 'CA');
check('FHFA: only traditional all-transactions quarterly state and metro series', fh.length === 3 && ca.value === 811.2 && ca.period === '2026-Q2' && ca.ch1 === 4 && ca.ch5 === 35.2, fh);
const fr = E.fhfaRows(fh, gazCbsa);
check('FHFA rows: states at their centre, metros at the Gazetteer centre, metropolitan divisions counted as unplaced', fr.rows.length === 2 && fr.unplaced === 1 && fr.rows.find((r) => r[7] === '40140')[2] === -2 && fr.rows.find((r) => r[7] === '40140')[0] === 34.5532 && fr.rows[0][6] === 'state', fr);

// ---- ACS
const acsNow = E.readAcs(JSON.parse(readFileSync(join(FX, 'acs_now.json'), 'utf8'))); const acsPrev = E.readAcs(JSON.parse(readFileSync(join(FX, 'acs_prev.json'), 'utf8')));
const ar = E.acsRows(acsNow, acsPrev, E.readGazetteer(readFileSync(join(FX, 'gaz_counties.txt'), 'utf8')));
const laC = ar.rows.find((r) => r[7] === '06037'); const adair = ar.rows.find((r) => r[7] === '19001');
check('ACS: median value and rent with the 5-year change; "no estimate" codes become empty; counties without either dropped', ar.rows.length === 2 && ar.unplaced === 1 && laC[2] === 821000 && laC[3] === 40 && laC[4] === 1900 && laC[8] === 30.1 && adair[4] === null && adair[8] === null && laC[6] === 'CA', ar);

// ---- UK HPI
const uk = await E.readUkHpi(lines('ukhpi.csv'));
const wmH = uk.find((a) => a.code === 'E09000033'); const cdf = uk.find((a) => a.code === 'W06000015');
check('UK HPI: local authorities only, latest month, published 12-month change preferred, 5-year change computed', uk.length === 4 && !uk.some((a) => a.code === 'E12000007') && wmH.period === '2026-06' && wmH.price === 969000 && wmH.ch1 === 2 && wmH.ch5 === 7.7 && cdf.ch1 === 3 && cdf.ch5 === null && JSON.stringify(wmH.types) === '[3200000,1870000,1570000,730000]', uk);
check('UK HPI: sales volume summed over the 12 months to the latest month that has one', wmH.sales12 === 290 && wmH.salesTo === '2026-05' && cdf.sales12 === 450, { wmH, cdf });
const ur = E.ukHpiRows(uk, cp.authorities);
check('UK HPI rows: placed by Code-Point local authority centres, Northern Ireland councils from the table, abolished codes unplaced', ur.rows.length === 3 && ur.unplaced === 1 && ur.rows.some((r) => r[7] === 'N09000003' && r[0] === 54.6) && ur.rows.find((r) => r[7] === 'E09000033')[9].sales12 === 290, ur);

// ---- Price Paid
const acc = new Map(); await E.addPricePaid(lines('pp-2026.csv'), acc); await E.addPricePaid(lines('pp-2025.csv'), acc);
const sr = E.salesRows(acc, cp.districts);
const s1 = sr.rows.find((r) => r[4] === 'SW1A'); const c1 = sr.rows.find((r) => r[4] === 'CF10');
check('Price Paid: last 12 months only, category A only, deletions skipped, median from five or more sales', sr.to === '2026-06-20' && sr.from === '2025-06-20' && s1[2] === 6 && s1[3] === 1300000 && s1[5] === 1 && JSON.stringify(s1[6]) === '[1,0,1,4,0]' && s1[7] === 4 && s1[8] === 'London' && s1[9] === 'City Of Westminster', s1);
check('Price Paid: fewer than five sales → count but no median; unknown districts unplaced', c1[2] === 2 && c1[3] === null && c1[5] === 1 && sr.unplaced === 1 && sr.sales === 8, { c1, sr: { unplaced: sr.unplaced, sales: sr.sales } });
check('Price Paid: nothing that identifies a home is kept', !JSON.stringify(sr.rows).match(/MALL|DOWNING|PARLIAMENT|QUEEN|\{A|FLAT 1|1AA/), sr.rows);

// ---- Eurostat and OECD
const eu = E.eurostatCountries(JSON.parse(readFileSync(join(FX, 'eurostat.json'), 'utf8')));
const deE = eu.find((c) => c.geo === 'DE'); const el = eu.find((c) => c.geo === 'EL');
check('Eurostat JSON-stat: countries only, published annual rate preferred, Greece mapped to GR', eu.length === 2 && deE.value === 166.4 && deE.ch1 === 4.1 && deE.ch5 === 10.9 && deE.period === '2026-Q2' && el.iso2 === 'GR' && el.ch1 === 8 && el.ch5 === 20 && el.name === 'Greece', eu);
const oe = E.oecdCountries(readFileSync(join(FX, 'oecd.csv'), 'utf8'));
const jpn = oe.find((c) => c.iso3 === 'JPN');
check('OECD SDMX-CSV: quarterly nominal index, real change alongside; aggregates, growth rates, annual and other measures dropped', oe.length === 1 && jpn.value === 130 && jpn.ch1 === 4 && jpn.ch5 === 18.2 && jpn.real1y === 1 && jpn.name === 'Japan' && jpn.nominal, oe);

// ---- BACI
const bz = join(dir, 'baci.zip');
execFileSync('zip', ['-q', '-j', bz, ...['BACI_HS92_Y2022_V202501.csv', 'BACI_HS92_Y2023_V202501.csv', 'country_codes_V202501.csv', 'product_codes_HS92_V202501.csv'].map((f) => join(FX, 'baci', f))]);
const b = await E.readBaci(bz);
const xr = E.exportRows(b, pts);
const sa = xr.rows.find((r) => r[3] === 'SAU');
check('BACI: newest year, values in U.S. dollars, products padded to six digits and named, chapters named', b.year === 2023 && b.flows === 6 && sa[2] === 200001000500 && sa[5][0][0] === '270900' && /crude/.test(sa[5][0][1]) && sa[5][1][0] === '010110' && sa[6][0][1] === 'Mineral fuels and oils' && sa[7] === 2023 && xr.unplaced === 1 && xr.rows[0][3] === 'SAU', xr);
check('BACI version from the download page', E.baciVersion('<a href="../../DATA_DOWNLOAD/baci/data/BACI_HS92_V202401b.zip">x</a> <a href="BACI_HS92_V202501.zip">') === '202501' && E.baciVersion('nothing') === null && E.hs2Name('01') === 'Live animals' && E.hs2Name('84') === 'Machinery and computers');

// ---- Climate TRACE
const ta = E.traceApiAssets(JSON.parse(readFileSync(join(FX, 'trace_api.json'), 'utf8')));
const tr = E.traceRows(ta);
check('Climate TRACE API: positions from Centroid.Geometry (longitude first), CO2e (100-year) chosen, power and duplicates dropped', tr.length === 2 && tr[0][3] === 'Shougang Jingtang steel plant' && tr[0][0] === 39.2 && tr[0][2] === 21500000 && tr[0][6] === 'Shougang Group' && tr[1][4] === 'cement' && tr[1][5] === 'MEX', tr);
const tacc = await E.traceCsvAssets(lines('trace_sources.csv'));
const tc = E.traceRows([...tacc.values()].map((a) => { const y = Math.max(...a.byYear.keys()); return { ...a, t: a.byYear.get(y), year: y }; }));
check('Climate TRACE CSV: months of the latest year summed, other gases ignored, iron-and-steel read as steel, textiles left out', tc.length === 2 && tc.find((r) => r[8] === '9001')[2] === 500000 && tc.find((r) => r[8] === '9001')[9] === 2024 && tc.find((r) => r[8] === '9001')[4] === 'steel' && tc.find((r) => r[8] === '9001')[7] === '5 Mt' && tc[0][4] === 'oil-and-gas-refining', tc);

const live = { assets: [{ Id: 1566956, Name: 'POSCO Gwangyang steel plant', Country: 'KOR', Sector: 'iron-and-steel', AssetType: 'BF/BOF', EmissionsSummary: [{ Gas: 'co2e_100yr', EmissionsQuantity: 38336150.6 }], Owners: [{ CompanyId: 'E1', CompanyName: 'POSCO Holdings Inc' }], Centroid: { Geometry: [127.73, 34.92], SRID: 4326 } }] };
const lv = E.traceRows(E.traceApiAssets(live)); const lq = E.traceRows(E.traceApiAssets(live, 'steel'));
check('Climate TRACE API as it answers live (October 2026): Sector carries the subsector, AssetType is the process', lv.length === 1 && lv[0][4] === 'steel' && lv[0][6] === 'POSCO Holdings Inc' && lv[0][2] === 38336151 && lq.length === 1, { lv, lq });

// ---- the whole job, offline
const czip = join(dir, 'codepoint.zip'); execFileSync('zip', ['-q', '-r', czip, 'Data'], { cwd: join(FX, 'codepoint') });
const out = join(dir, 'economy');
const env = { ...process.env, FHFA_FILE: join(FX, 'fhfa_master.csv'), CBSA_GAZ_FILE: join(FX, 'gaz_cbsa.txt'), COUNTY_GAZ_FILE: join(FX, 'gaz_counties.txt'), ACS_FILE: join(FX, 'acs_now.json'), ACS_PREV_FILE: join(FX, 'acs_prev.json'), ACS_YEAR: '2024', UKHPI_FILE: join(FX, 'ukhpi.csv'), CODEPOINT_ZIP: czip, PPD_FILES: `${join(FX, 'pp-2026.csv')},${join(FX, 'pp-2025.csv')}`, EUROSTAT_FILE: join(FX, 'eurostat.json'), OECD_FILE: join(FX, 'oecd.csv'), BACI_ZIP: bz, TRACE_FILE: join(FX, 'trace_api.json') };
const run = (only, extra = {}) => execFileSync('node', [join(ROOT, 'tools/fetch-economy.mjs'), out, only], { env: { ...env, ...extra }, encoding: 'utf8' });
const log1 = run(E.ALL.join(','), { ECONOMY_MIN_ROWS: '1' });
const st = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
const files = ['houseprices/fhfa.json', 'houseprices/ukhpi.json', 'houseprices/eurostat.json', 'houseprices/oecd.json', 'acs/counties.json', 'sales/districts.json', 'exports/countries.json', 'industry/assets.json'];
check('job: all eight sources run offline and write their files, status and README', E.ALL.every((k) => st.feeds[k]?.ok) && files.every((f) => existsSync(join(out, f))) && existsSync(join(out, 'README.md')), { st, log1 });
const j = (f) => JSON.parse(readFileSync(join(out, f), 'utf8'));
check('job: files carry fields, rows and sources', j('houseprices/ukhpi.json').unit === 'GBP' && j('houseprices/ukhpi.json').rows.length === 3 && j('sales/districts.json').minSalesForMedian === 5 && j('exports/countries.json').rows.length === 2 && j('industry/assets.json').rows.length === 2 && j('acs/counties.json').year === 2024 && j('houseprices/fhfa.json').fields.length === 10);
const keep = readFileSync(join(out, 'houseprices', 'eurostat.json'), 'utf8');
run('eurostat'); // normal size guard: 2 countries is too few, so the previous file must stay
const st2 = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
check('job: a source that fails keeps its previous file and says why; the others keep their status', readFileSync(join(out, 'houseprices', 'eurostat.json'), 'utf8') === keep && st2.feeds.eurostat.ok === false && /previous file kept/.test(st2.feeds.eurostat.note) && st2.feeds.eurostat.at && st2.feeds.baci.ok === true, st2);

// ---- the layers
const { economyLayers, changeColour, shortProduct, bigUsd, osmWorksRow } = await import('../../site/app/js/economy.js');
const ls = economyLayers({ state: { data: {} } });
check('layers: six, all in the econ group, valid ids, every one explains itself and lists sources', ls.length === 6 && ls.every((l) => l.group === 'econ' && /^[a-z][a-z0-9]{1,31}$/.test(l.id) && l.learn?.what && l.learn.refs.length && l.sources.length && typeof l.load === 'function' && typeof l.channels === 'function' && /^#[0-9a-f]{6}$/i.test(l.swatch)), ls.map((l) => l.id));
const meta = JSON.parse(readFileSync(join(ROOT, 'tools/economy.meta.json'), 'utf8')).sources.map((s) => s.key);
const known = new Set([...meta, 'censusgaz', 'osm', 'overpass']);
check('layers: every source and reference key is in tools/economy.meta.json or already in sources.js', ls.every((l) => [...l.sources, ...l.learn.refs].every((k) => known.has(k))), ls.flatMap((l) => [...l.sources, ...l.learn.refs]).filter((k) => !known.has(k)));
const view = { lat: 51.5, lng: -0.13, altitude: 0.5, radiusKm: 2000 };
const sales = ls.find((l) => l.id === 'propsales');
const sd = { rows: E.salesRows(acc, cp.districts).rows, colour: 'sales' };
const ch = sales.channels(sd, { view }); const card = sales.describe(sd.rows[0]);
check('sales layer: one symbol and one pick per district, card without addresses', ch.points.length === 2 && ch.pick.length === 2 && /SW1A: 6 homes sold/.test(card.title) && card.rows[0][1] === '£1,300,000' && card.links.length, card);
const hp = ls.find((l) => l.id === 'houseprices');
const hd = { rows: ur.rows.map((r) => ({ r, k: 'ukhpi', unit: 'GBP', valueLabel: 'Average price' })), files: {}, span: '1', ch: (x) => x.r[2] };
const hc = hp.channels(hd, { view }); const hcard = hp.describe(hd.rows.find((x) => x.r[7] === 'E09000033'));
check('house price layer: coloured by change, card with price, change and type prices', hc.points.length === 3 && hcard.rows[0][1].startsWith('£') && hcard.rows.some(([k]) => /Detached/.test(k)) && changeColour(-6) !== changeColour(10) && changeColour(null) === '#8a96a3', hcard);
check('helpers: short product names, big dollar amounts, OpenStreetMap works rows', shortProduct('Petroleum oils and oils obtained from bituminous minerals: crude') === 'Petroleum oils and oils obtained from bituminous minerals' && bigUsd(4.2e9) === '$4.2 billion' && JSON.stringify(osmWorksRow({ type: 'way', id: 5, center: { lat: 1, lon: 2 }, tags: { name: 'Brewery', product: 'beer' } })) === '[1,2,"Brewery","beer","","way",5]' && osmWorksRow({ type: 'node', id: 1, tags: {} }) === null);

// the browser test (tests/e2e/test_economy.py) serves this offline output as the economy-data branch
if (process.env.ECONOMY_TEST_OUT) cpSync(out, process.env.ECONOMY_TEST_OUT, { recursive: true });
// Census data API refusals are HTML pages: say what is wrong instead of a JSON parse error, without the key itself
{
  const page = '<html style="font-family: sans-serif"><head><title>Invalid Key</title></head><body><p>A valid <em>key</em> must be included with each data API request. You included a key with this request, however, it is not valid.</p></body></html>';
  const k = 'a'.repeat(40);
  const m = E.censusRefusal(200, page, k);
  check('Census: an invalid or unactivated key is named as such', /refused CENSUS_API_KEY as invalid/.test(m) && /activation link/.test(m) && /has the shape/.test(m) && !m.includes(k), m);
  check('Census: a secret that is not a key is pointed out', /does not have the shape/.test(E.censusRefusal(200, page, 'my key here')));
  check('Census: an unpublished year is not blamed on the key', /not published yet/.test(E.censusRefusal(404, '<html>error: unknown/unsupported geography hierarchy</html>', k)));
}
console.log(`SUMMARY ${pass} / ${n}`);
if (pass !== n) process.exitCode = 1;
