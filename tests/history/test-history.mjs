// SPDX-License-Identifier: AGPL-3.0-only
// Checks tools/build-history.mjs: one frame from live-data files, then the CLI's pruning and index.
//   node tests/history/test-history.mjs
import { makeFrame } from '../../tools/build-history.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : info); };
const now = Date.now();
const flights = { generatedAt: new Date(now - 5 * 60_000).toISOString(), src: 'test', fields: ['id', 'call', 'lat', 'lng', 'altFt', 'ground', 'kt', 'trk'], ac: [['a1', 'X1', 51.4775, -0.4614, 36000, 0, 450, 271.6], ['a2', 'X2', 40.6, -73.8, 1200, 1, 10, 90], ['a3', 'X3', null, 5, 1000, 0, 0, 0]] };
const ships = { rows: [[1, 1.2549, 103.8, 10, 0, null, 0, 0, 'A', 70]] };
const gdacs = { features: [{ geometry: { coordinates: [130.234, 21.456] }, properties: { eventtype: 'TC', alertlevel: 'Red', name: 'Cyclone', country: 'Philippines' } }] };
const fires = { rows: [[0, 0, 5, 2], [0, 0, 5, 1]] };
const f = makeFrame({ flights, ships, gdacs, fires });
check('aircraft rounded to hundredths with flight level', JSON.stringify(f.flights.rows[0]) === JSON.stringify([5148, -46, 360, 272]), f.flights.rows[0]);
check('aircraft on the ground are level 0; missing positions skipped', f.flights.rows.length === 2 && f.flights.rows[1][2] === 0, f.flights.rows);
check('ships, alerts and fire counts kept', f.ships.rows[0][0] === 125 && f.alerts[0].lat === 21.46 && f.alerts[0].level === 'Red' && f.fires.count === 2 && f.fires.high === 1, f);
check('frame time is the snapshot time', f.t === Date.parse(flights.generatedAt));
const live = mkdtempSync(join(tmpdir(), 'live-')); const hist = mkdtempSync(join(tmpdir(), 'hist-'));
writeFileSync(join(live, 'flights.json'), JSON.stringify(flights)); writeFileSync(join(live, 'gdacs.json'), JSON.stringify(gdacs));
mkdirSync(join(hist, 'frames'));
const old = new Date(now - 20 * 86_400_000).toISOString().slice(0, 13).replace(/[-T]/g, '');
writeFileSync(join(hist, 'frames', `${old}.json`), JSON.stringify(f));
execFileSync('node', [join(ROOT, 'tools', 'build-history.mjs'), live, hist], { env: { ...process.env, HISTORY_DAYS: '14' }, stdio: 'pipe' });
const idx = JSON.parse(readFileSync(join(hist, 'index.json'), 'utf8'));
check('CLI writes this hour and drops frames older than 14 days', idx.frames.length === 1 && !existsSync(join(hist, 'frames', `${old}.json`)) && idx.frames[0].flights === 2 && idx.frames[0].alerts === 1, idx);
console.log(`SUMMARY ${pass} / ${n}`);
process.exitCode = pass === n ? 0 : 1;
