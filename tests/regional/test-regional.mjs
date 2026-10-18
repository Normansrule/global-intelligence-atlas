// SPDX-License-Identifier: AGPL-3.0-only
// Checks tools/fetch-regional.mjs on small stand-in files shaped like the real ones (a PUR archive, EPest county
// estimates, the Census Gazetteer, a TRI basic data file, CalEnviroScreen, ECHO and Water Quality Portal results), and the PLSS section maths.
//   node tests/regional/test-regional.mjs        (needs the zip and unzip commands)
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sectionCentre, sectionCell, parseKey } from '../../site/app/js/plss.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : info); };

// PLSS: section 1 is the north-east corner, 6 the north-west, 7 below 6, 36 the south-east
check('sections snake from the north-east corner', JSON.stringify([sectionCell(1), sectionCell(6), sectionCell(7), sectionCell(36)]) === JSON.stringify([{ col: 5, row: 0 }, { col: 0, row: 0 }, { col: 0, row: 1 }, { col: 5, row: 5 }]));
const a = sectionCentre('M', 1, 'N', 1, 'E', 36); const b = sectionCentre('M', 1, 'S', 1, 'W', 1);
check('T1N R1E section 36 and T1S R1W section 1 touch the Mount Diablo initial point', Math.abs(a.lat - 37.8817) < 0.01 && Math.abs(b.lat - 37.8817) < 0.01 && a.lng > -121.9131 && b.lng < -121.9131, [a, b]);
const sac = sectionCentre('M', 8, 'N', 4, 'E', 12);
check('Sacramento is in Mount Diablo T8N R4E', Math.abs(sac.lat - 38.57) < 0.06 && Math.abs(sac.lng + 121.49) < 0.08, sac);
check('invalid sections are refused', sectionCentre('X', 1, 'N', 1, 'E', 1) === null && sectionCentre('M', 1, 'N', 1, 'E', 37) === null && parseKey('M08N04E12').section === 12);

const dir = mkdtempSync(join(tmpdir(), 'regional-test-')); const out = join(dir, 'out');
const H = 'use_no,prodno,chem_code,prodchem_pct,lbs_chm_used,lbs_prd_used,amt_prd_used,unit_of_meas,acre_planted,unit_planted,acre_treated,unit_treated,applic_cnt,applic_dt,applic_time,county_cd,base_ln_mer,township,tship_dir,range,range_dir,section,site_loc_id,grower_id,license_no,planting_seq,aer_gnd_ind,site_code,qualify_cd,batch_no,document_no,summary_cd,record_id,comtrs,error_flag';
const row = (chem, lbs, date, county, mer, t, td, r, rd, s, method, site, rec = '1') => `1,1,${chem},50,${lbs},1,1,LB,10,A,10,A,1,${date},,${county},${mer},${t},${td},${r},${rd},${s},,,,,${method},${site},,,,,${rec},,`;
writeFileSync(join(dir, 'udc22_10.txt'), [H, row(573, 1000, '03/04/2022', '10', 'M', '14', 'S', '20', 'E', '05', 'A', 3001), row(573, 500, '03/09/2022', '10', 'M', '14', 'S', '20', 'E', '05', 'G', 3001), row(1601, 200, '07/01/2022', '10', 'M', '14', 'S', '20', 'E', '05', 'G', 28035), row(1601, 50, '07/02/2022', '10', 'M', '15', 'S', '20', 'E', '30', 'G', 28035), row(1601, 9, '07/02/2022', '10', '', '', '', '', '', '', '', 40, 'C')].join('\n'));
writeFileSync(join(dir, 'udc22_15.txt'), [H, row(136, 4000, '10/20/2022', '15', 'M', '29', 'S', '28', 'E', '18', 'A', 29143), row(573, 0, '10/20/2022', '15', 'M', '29', 'S', '28', 'E', '18', 'A', 29143)].join('\n'));
writeFileSync(join(dir, 'chemical.txt'), 'chem_code,chemname,chemalpha_cd\n573,"1,3-DICHLOROPROPENE",x\n1601,GLYPHOSATE,y\n136,SULFUR,z\n');
writeFileSync(join(dir, 'site.txt'), 'site_code,site_name\n3001,ALMOND\n28035,GRAPE\n29143,STRAWBERRY\n');
writeFileSync(join(dir, 'county.txt'), 'county_cd,couty_name\n10,FRESNO\n15,KERN\n');
execFileSync('zip', ['-q', '-j', join(dir, 'pur2022.zip'), ...['udc22_10.txt', 'udc22_15.txt', 'chemical.txt', 'site.txt', 'county.txt'].map((f) => join(dir, f))]);
writeFileSync(join(dir, 'epest.txt'), 'COMPOUND\tYEAR\tSTATE_FIPS_CODE\tCOUNTY_FIPS_CODE\tEPEST_LOW_KG\tEPEST_HIGH_KG\nGLYPHOSATE\t2019\t6\t19\t300000\t350000\nGLYPHOSATE\t2019\t19\t1\t1000\t2000\nATRAZINE\t2019\t19\t1\t5000\t5200\nATRAZINE\t2019\t99\t999\t1\t1\n');
writeFileSync(join(dir, 'gaz.txt'), 'USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               \nCA\t06019\t00277274\tFresno County\t1\t1\t5958\t1\t36.761006\t-119.655019\nIA\t19001\t00465190\tAdair County\t1\t1\t569\t1\t41.330756\t-94.470590\n');
writeFileSync(join(dir, 'tri.csv'), '"1. YEAR","2. TRIFD","3. FRS ID","4. FACILITY NAME","5. STREET ADDRESS","6. CITY","7. COUNTY","8. ST","9. ZIP","12. LATITUDE","13. LONGITUDE","20. INDUSTRY SECTOR","34. CHEMICAL","41. CARCINOGEN","47. UNIT OF MEASURE","107. TOTAL RELEASES"\n2023,77001ACMEX1,1,"ACME, INC.",1 Main,HOUSTON,HARRIS,TX,77001,29.76,-95.36,Chemicals,BENZENE,YES,Pounds,1200\n2023,77001ACMEX1,1,"ACME, INC.",1 Main,HOUSTON,HARRIS,TX,77001,29.76,-95.36,Chemicals,"DIOXIN AND DIOXIN-LIKE COMPOUNDS",YES,Grams,453.592\n2023,10001SMALL1,2,SMALL CO,2 Main,NEW YORK,NY,NY,10001,40.75,-73.99,Other,TOLUENE,NO,Pounds,10\n');
// CalEnviroScreen: a minimal spreadsheet (shared strings, a number cell and an inline string), zipped like the download
const hdr = ['Census Tract', 'Total Population', 'California County', 'ZIP', 'Approximate Location', 'Longitude', 'Latitude', 'CES 4.0 Score', ' CES 4.0 Percentile', 'Pesticides', 'Pesticides Pctl', 'PM2.5', 'PM2.5 Pctl', 'Drinking Water', 'Drinking Water Pctl', 'Poverty', 'Poverty Pctl'];
const strs = [...hdr, 'Fresno', 'Fresno & Clovis', 'Kern'];
const cell = (ref, v) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${strs.indexOf(v)}</v></c>`);
const L = 'ABCDEFGHIJKLMNOPQ';
const sheetRow = (i, vals) => `<row r="${i}">${vals.map((v, j) => (v === null ? '' : cell(`${L[j]}${i}`, v))).join('')}</row>`;
mkdirSync(join(dir, 'xl', 'worksheets'), { recursive: true });
writeFileSync(join(dir, 'xl', 'sharedStrings.xml'), `<?xml version="1.0"?><sst>${strs.map((x) => `<si><t>${x.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`);
writeFileSync(join(dir, 'xl', 'worksheets', 'sheet1.xml'), `<?xml version="1.0"?><worksheet><sheetData>${sheetRow(1, hdr)}${sheetRow(2, [6019001000, 3000, 'Fresno', 93706, 'Fresno & Clovis', -119.79, 36.72, 72.5, 99.9, 1200.5, 97.2, 14.1, 98, 900, 95, 60, 96])}${sheetRow(3, [6029000100, 2500, 'Kern', 93301, null, -119.02, 35.37, 40.1, 70, null, null, 12.2, 80, 500, 60, 30, 55])}<row r="4"><c r="A4" t="inlineStr"><is><t>6029000200</t></is></c></row></sheetData></worksheet>`);
execFileSync('zip', ['-q', '-r', join(dir, 'ces.xlsx'), 'xl'], { cwd: dir });
execFileSync('zip', ['-q', '-j', join(dir, 'ces-download.zip'), join(dir, 'ces.xlsx')]);
// ECHO Exporter: one facility in significant non-compliance, one with a penalty, one clean (left out)
writeFileSync(join(dir, 'ECHO_EXPORTER.csv'), 'REGISTRY_ID,FAC_NAME,FAC_CITY,FAC_STATE,FAC_LAT,FAC_LONG,FAC_INSPECTION_COUNT,FAC_DATE_LAST_INSPECTION,FAC_FORMAL_ACTION_COUNT,FAC_PENALTY_COUNT,FAC_TOTAL_PENALTIES,FAC_QTRS_WITH_NC,FAC_SNC_FLG,FAC_COMPLIANCE_STATUS,FAC_PROGRAMS_IN_SNC,AIR_FLAG,NPDES_FLAG,RCRA_FLAG,SDWIS_FLAG,TRI_FLAG\n110000001,"BIG PLANT, LLC",FRESNO,CA,36.7,-119.8,12,03/04/2025,2,1,"$45,000",8,Y,Significant Violation,CAA,Y,N,Y,N,Y\n110000002,SMALL SHOP,BAKERSFIELD,CA,35.4,-119.0,3,01/02/2024,0,1,1500,0,N,No Violation Identified,,N,Y,N,N,N\n110000003,CLEAN CO,RENO,NV,39.5,-119.8,1,01/02/2024,0,0,0,0,N,No Violation Identified,,Y,N,N,N,N\n');
execFileSync('zip', ['-q', '-j', join(dir, 'echo.zip'), join(dir, 'ECHO_EXPORTER.csv')]);
// Water Quality Portal: a WQX 3.0 result file (positions included) and the older layout with a station file
writeFileSync(join(dir, 'wqx3.csv'), 'Org_FormalName,Location_Identifier,Location_Name,Location_Type,Location_Latitude,Location_Longitude,Activity_Media,Activity_StartDate,Result_Characteristic,Result_ResultDetectionCondition,Result_Measure,Result_MeasureUnit\n' + [
  ['USGS Iowa Water Science Center', 'USGS-05465500', 'Iowa River at Wapello, IA', 'Stream', 41.1781, -91.1821, 'Water', '2025-06-03', 'Atrazine', '', '4.2', 'ug/L'],
  ['USGS Iowa Water Science Center', 'USGS-05465500', 'Iowa River at Wapello, IA', 'Stream', 41.1781, -91.1821, 'Water', '2025-01-10', 'Atrazine', 'Not Detected', '', 'ug/L'],
  ['USGS Iowa Water Science Center', 'USGS-05465500', 'Iowa River at Wapello, IA', 'Stream', 41.1781, -91.1821, 'Water', '2025-06-03', 'Glyphosate', '', '0.4', 'ug/L'],
  ['USGS Iowa Water Science Center', 'USGS-05465500', 'Iowa River at Wapello, IA', 'Stream', 41.1781, -91.1821, 'Bed Sediment', '2025-06-03', 'Atrazine', '', '99', 'ug/kg'],
  ['USGS Iowa Water Science Center', 'USGS-05465500', 'Iowa River at Wapello, IA', 'Stream', 41.1781, -91.1821, 'Water', '2025-06-03', 'Nitrate', '', '9', 'mg/L'],
  ['Iowa DNR, Water', 'IADNR-1', 'Farm well 1', 'Well', 42.0, -93.5, 'Water', '2024-08-01', 'Imidacloprid', '', '35', 'ng/L'],
  ['Iowa DNR, Water', 'IADNR-2', 'Clear Lake', 'Lake, Reservoir, Impoundment', 43.13, -93.38, 'Water', '2024-08-01', 'Metolachlor', 'Not Detected', '0.02', 'ug/L'],
].map((r) => r.map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(',')).join('\n') + '\n');
writeFileSync(join(dir, 'legacy.csv'), 'OrganizationFormalName,MonitoringLocationIdentifier,ActivityMediaName,ActivityStartDate,CharacteristicName,ResultDetectionConditionText,ResultMeasureValue,ResultMeasure/MeasureUnitCode\nCA Water Board,CAWB-9,Water,2024-04-02,Simazine,,0.002,mg/l\nCA Water Board,CAWB-9,Water,2024-05-02,Diuron,Detected Not Quantified,,ug/l\nCA Water Board,CAWB-NOPOS,Water,2024-05-02,Diuron,,1,ug/l\n');
writeFileSync(join(dir, 'stations.csv'), 'OrganizationFormalName,MonitoringLocationIdentifier,MonitoringLocationName,MonitoringLocationTypeName,LatitudeMeasure,LongitudeMeasure\nCA Water Board,CAWB-9,Well 9 near Fresno,Well,36.7,-119.8\n');
execFileSync('node', [join(ROOT, 'tools', 'fetch-regional.mjs'), out], { env: { ...process.env, PUR_ZIP: join(dir, 'pur2022.zip'), EPEST_FILE: join(dir, 'epest.txt'), GAZETTEER_FILE: join(dir, 'gaz.txt'), TRI_FILE: join(dir, 'tri.csv'), CES_FILE: join(dir, 'ces-download.zip'), ECHO_FILE: join(dir, 'echo.zip'), WQP_FILE: join(dir, 'wqx3.csv') }, stdio: 'pipe' });
const J = (p) => JSON.parse(readFileSync(join(out, p), 'utf8'));
const pi = J('pur/index.json'); const ps = J('pur/sections.json');
check('PUR: year, records and totals', pi.year === 2022 && pi.records === 7 && pi.lbs === 5759 && pi.aerialLbs === 5000, pi);
check('PUR: chemical names and the biggest first', pi.chems[0].name === 'SULFUR' && pi.chems[1].name === '1,3-DICHLOROPROPENE' && pi.chems[1].aer === 1000 && pi.chems[1].months[2] === 1500, pi.chems.slice(0, 2));
check('PUR: three sections, non-farm summaries left out of the map', ps.rows.length === 3 && pi.nonAgRecords === 1, ps.rows.length);
const fres = ps.rows.find((r) => r[11] === 'M14S20E05');
check('PUR: a section keeps total, aerial pounds, top chemical, crop and county', fres && fres[2] === 1700 && fres[3] === 1000 && pi.chems[fres[5]].name === '1,3-DICHLOROPROPENE' && pi.sites[fres[9]].name === 'ALMOND' && fres[10] === '10' && pi.counties['10'] === 'FRESNO', fres);
check('PUR: section placed near Fresno', Math.abs(fres[0] - 36.6) < 0.2 && Math.abs(fres[1] + 119.8) < 0.2, fres.slice(0, 2));
const gly = J(pi.chems.find((c) => c.name === 'GLYPHOSATE').file.replace(/^/, 'pur/'));
check('PUR: one file per chemical with its sections', gly.rows.length === 2 && gly.rows[0][2] === 200, gly);
const ui = J('usgs/index.json'); const uc = J('usgs/counties.json');
check('USGS: compounds ranked, counties without a centre dropped', ui.compounds[0].name === 'GLYPHOSATE' && ui.compounds[0].kgHigh === 352000 && ui.compounds[1].counties === 1 && uc.rows.length === 2, ui.compounds);
const adair = uc.rows.find((r) => r[0] === '19001');
check('USGS: county top compound and centre', adair && adair[7] === 'ATRAZINE' && adair[3] === 41.3308 && adair[1] === 'Adair County', adair);
const tri = J('tri/facilities.json');
check('TRI: facilities with totals, carcinogens and grams converted', tri.rows.length === 2 && tri.rows[0][4] === 'ACME, INC.' && tri.rows[0][2] === 1201 && tri.rows[0][3] === 1201 && tri.year === 2023 && tri.rows[0][9][0][0] === 'BENZENE', tri.rows[0]);
const st = J('status.json');
check('status records every source', st.feeds.pur.ok && st.feeds.usgs.ok && st.feeds.tri.ok && st.feeds.ces.ok && st.feeds.echo.ok && st.feeds.wqp.ok, st);
const ces = J('ces/tracts.json'); const t1 = ces.rows.find((r) => r[0] === '6019001000'); const ki = (k) => ces.indicators.findIndex((x) => x.key === k);
check('CalEnviroScreen: tracts from the spreadsheet inside the zip, with place names', ces.rows.length === 2 && t1 && t1[4] === 'Fresno' && t1[6] === 'Fresno & Clovis' && t1[1] === 36.72, ces.rows);
check('CalEnviroScreen: values and percentiles by indicator (header spaces ignored)', t1[8][ki('score')] === 99.9 && t1[7][ki('pesticides')] === 1200.5 && t1[8][ki('pesticides')] === 97.2 && ces.rows[1][8][ki('pesticides')] === null && t1[8][ki('water')] === 95, t1);
check('CalEnviroScreen: missing indicators are reported, not fatal', /not found: .*ozone/.test(J('status.json').feeds.ces.note), J('status.json').feeds.ces.note);
const echo = J('echo/facilities.json');
check('ECHO: only facilities with violations, actions or penalties; significant ones first', echo.rows.length === 2 && echo.total === 3 && echo.rows[0][8] === 'BIG PLANT, LLC' && echo.rows[0][2] === 1 && echo.rows[0][5] === 45000 && echo.rows[1][5] === 1500, echo.rows);
check('ECHO: programs and registry ID kept', echo.rows[0][12] === 'Clean Air Act, hazardous waste (RCRA), TRI' && echo.rows[0][11] === '110000001' && echo.rows[1][12] === 'Clean Water Act', echo.rows[0]);
const wq = J('wqp/sites.json'); const iowa = wq.rows.find((r) => r[4] === 'USGS-05465500');
check('WQP: water results only, other characteristics and media left out', wq.rows.length === 3 && iowa && iowa[6] === 3 && iowa[7] === 2 && iowa[10].length === 2, wq.rows);
check('WQP: atrazine above the EPA limit at a stream, ratio to the limit kept', iowa[2] === 'stream' && iowa[10][0][0] === 'Atrazine' && iowa[10][0][1] === 4.2 && iowa[10][0][2] === 1 && iowa[10][0][3] === 2 && iowa[9] === 1.4 && iowa[10][0][4] === '2025-06-03', iowa);
const well = wq.rows.find((r) => r[4] === 'IADNR-1'); const lake = wq.rows.find((r) => r[4] === 'IADNR-2');
check('WQP: ng/L converted, wells and lakes recognised, quoted organisations', well[2] === 'well' && well[10][0][1] === 0.035 && lake[2] === 'lake' && lake[7] === 0 && well[5] === 'Iowa DNR, Water', [well, lake]);
const atr = wq.chems.find((c) => c.name === 'Atrazine');
check('WQP: chemical summary with limits', atr.mcl === 3 && atr.sites === 1 && atr.detectedAt === 1 && atr.samples === 2 && wq.chems.find((c) => c.name === 'Metolachlor').detectedAt === 0, wq.chems.slice(0, 3));
execFileSync('node', [join(ROOT, 'tools', 'fetch-regional.mjs'), out, 'wqp'], { env: { ...process.env, WQP_FILE: join(dir, 'legacy.csv'), WQP_STATION_FILE: join(dir, 'stations.csv') }, stdio: 'pipe' });
const wl = J('wqp/sites.json');
check('WQP: older layout with a station file; mg/L converted, detected-not-quantified counted, sites without a position dropped', wl.rows.length === 1 && wl.rows[0][3] === 'Well 9 near Fresno' && wl.rows[0][2] === 'well' && wl.rows[0][7] === 2 && wl.rows[0][10].find((c) => c[0] === 'Simazine')[1] === 2 && J('status.json').feeds.wqp.ok, wl.rows);
// a failing source keeps the previous files
execFileSync('node', [join(ROOT, 'tools', 'fetch-regional.mjs'), out, 'tri'], { env: { ...process.env, TRI_FILE: join(dir, 'missing.csv') }, stdio: 'pipe' });
check('a failing source keeps its previous files', existsSync(join(out, 'tri/facilities.json')) && J('status.json').feeds.tri.ok === false && J('status.json').feeds.pur.ok, J('status.json').feeds.tri);
console.log(`SUMMARY ${pass} / ${n}`);
process.exitCode = pass === n ? 0 : 1;
