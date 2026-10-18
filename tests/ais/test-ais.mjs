// Offline checks for the AISStream reader (site/app/js/ais.js) and the live-data job's ship collector.
//   npm install --no-save --prefix tests/ais ws@8.18.3 && node tests/ais/test-ais.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAisStore, viewBoxes, aisSubscription, parseFrame } from '../../site/app/js/ais.js';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => console.log(`ok ${++n} ${name}`));
const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '000 +0000 UTC');

await ok('position and static reports become one vessel, AIS padding removed', () => {
  const s = createAisStore(); const t = utc(Date.now());
  s.add({ MessageType: 'PositionReport', MetaData: { MMSI: 211000001, ShipName: 'NORDIC  STAR@@@ ', time_utc: t }, Message: { PositionReport: { UserID: 211000001, Latitude: 54.123456, Longitude: 10.5, Sog: 102.3, Cog: 360, TrueHeading: 511, NavigationalStatus: 5 } } });
  s.add({ MessageType: 'ShipStaticData', MetaData: { MMSI: 211000001, time_utc: t }, Message: { ShipStaticData: { UserID: 211000001, Name: 'NORDIC STAR@@', Type: 82, CallSign: 'DABC@', ImoNumber: 9123456, Destination: 'KIEL@@@@', MaximumStaticDraught: 8.2, Dimension: { A: 120, B: 30, C: 10, D: 12 } } } });
  const [r] = s.rows();
  assert.deepEqual(r.slice(0, 7), [211000001, 54.1235, 10.5, null, null, null, 5], '"not available" speed, course and heading become null');
  assert.equal(r[8], 'NORDIC STAR'); assert.equal(r[9], 82);
  const st = s.staticOf(211000001); assert.equal(st.call, 'DABC'); assert.equal(st.dest, 'KIEL'); assert.equal(st.len, 150); assert.equal(st.beam, 22);
});
await ok('class B reports and static data report parts', () => {
  const s = createAisStore(); const t = utc(Date.now());
  s.add({ MessageType: 'StandardClassBPositionReport', MetaData: { MMSI: 244000002, time_utc: t }, Message: { StandardClassBPositionReport: { UserID: 244000002, Latitude: 52.37, Longitude: 4.9, Sog: 4.1, Cog: 80, TrueHeading: 79 } } });
  s.add({ MessageType: 'StaticDataReport', MetaData: { MMSI: 244000002, time_utc: t }, Message: { StaticDataReport: { UserID: 244000002, ReportA: { Valid: true, Name: 'ZEILBOOT' }, ReportB: { Valid: true, ShipType: 36, CallSign: 'PB1', Dimension: { A: 8, B: 4, C: 2, D: 2 } } } } });
  assert.deepEqual(s.rows()[0].slice(8), ['ZEILBOOT', 36]);
});
await ok('impossible positions and junk are ignored', () => {
  const s = createAisStore();
  for (const m of [null, {}, { MessageType: 'PositionReport', Message: {} }, { MessageType: 'PositionReport', MetaData: { MMSI: 3 }, Message: { PositionReport: { Latitude: 91, Longitude: 181 } } }, { MessageType: 'PositionReport', MetaData: { MMSI: 4 }, Message: { PositionReport: { Latitude: 0, Longitude: 0 } } }]) s.add(m);
  assert.equal(s.size, 0);
  assert.equal(parseFrame('not json'), null);
  assert.equal(parseFrame(new TextEncoder().encode('{"a":1}')).a, 1);
});
await ok('merging keeps the newer report and pruning drops old vessels', () => {
  const s = createAisStore(); const now = Math.round(Date.now() / 60_000);
  s.load([[1, 10, 10, 1, 1, null, 0, now - 5, 'A', 70], [2, 20, 20, 1, 1, null, 0, now - 40, 'B', 70]]);
  s.load([[1, 11, 11, 1, 1, null, 0, now - 1, 'A', 70], [1, 9, 9, 1, 1, null, 0, now - 9, 'A', 70]]);
  s.prune(30);
  assert.deepEqual(s.rows().map((r) => [r[0], r[1]]), [[1, 11]]);
});
await ok('view boxes split at the 180° meridian', () => {
  assert.equal(viewBoxes({ lat: 0, lng: 0, radiusKm: 1000 }).length, 1);
  const two = viewBoxes({ lat: 10, lng: 179, radiusKm: 1000 });
  assert.equal(two.length, 2); assert.ok(two.every(([[s, w], [nn, e]]) => s < nn && w < e && w >= -180 && e <= 180));
  assert.deepEqual(JSON.parse(aisSubscription('k', two)).BoundingBoxes, two);
});

let WS = null; try { WS = await import('ws'); } catch { /* optional */ }
if (!WS) console.log('# skipped the collector check: install ws (see the header)');
else await ok('the live-data job collects ships from a stand-in AISStream', async () => {
  const port = 18790 + Math.floor(Math.random() * 500);
  const mock = spawn(process.execPath, [join(HERE, 'mock-aisstream.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => mock.stdout.once('data', r));
  try {
    const out = mkdtempSync(join(tmpdir(), 'gia-ais-'));
    const env = { ...process.env, AISSTREAM_KEY: 'test-key', AIS_SECONDS: '2', AIS_URL: `ws://localhost:${port}`, LIVE_ONLY: 'ships' };
    execFileSync(process.execPath, [join(ROOT, 'tools', 'fetch-live.mjs'), out], { env, stdio: 'pipe' });
    const ships = JSON.parse(readFileSync(join(out, 'ships.json'), 'utf8')); const st = JSON.parse(readFileSync(join(out, 'ships-static.json'), 'utf8'));
    const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8')).feeds.ships;
    assert.equal(ships.rows.length, 400); assert.equal(st.rows.length, 200); assert.equal(status.ok, true); assert.equal(status.count, 400);
    assert.equal(ships.rows[0][8], 'TEST VESSEL 0');
    execFileSync(process.execPath, [join(ROOT, 'tools', 'fetch-live.mjs'), out], { env: { ...env, AISSTREAM_KEY: 'wrong' }, stdio: 'pipe' });
    const bad = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8')).feeds.ships;
    assert.equal(bad.ok, false); assert.match(bad.note, /Api Key Is Not Valid/); assert.equal(bad.count, 400, 'a failed round keeps the last good count');
    assert.equal(JSON.parse(readFileSync(join(out, 'ships.json'), 'utf8')).rows.length, 400, 'and the last good file');
  } finally { mock.kill(); }
});
console.log(`SUMMARY ${n} / ${WS ? 6 : 5}`);
