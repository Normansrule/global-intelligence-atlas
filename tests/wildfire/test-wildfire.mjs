// SPDX-License-Identifier: AGPL-3.0-only
// v2.39 wildfire tracker: hot spots grouped into fires, spread direction and speed, playback, a place to stand.
import assert from 'node:assert/strict';
import { clusterFires, summarise, spread, hull, polyArea, passes, asOf, viewpoint, fireSvg, topFires, packSpread, unpackSpread, thin, mergeFires, maybeIndustrial, ageBand, ageColor, AGES, toKm, PIXEL_KM2, spreadWords } from '../../site/app/js/wildfire.js';

let ok = 0; const t = (name, fn) => { fn(); ok++; console.log('ok', name); };
const NOW = Date.UTC(2026, 7, 20, 12, 0); const MIN = 60000;
// A fire in California that moves east 2 km a day for three days: two passes a day (01:30 and 13:30 local-ish).
const lat0 = 39.7; const lng0 = -121.6; const kmLng = 111.32 * Math.cos(lat0 * Math.PI / 180);
const fire = [];
for (let p = 0; p < 6; p++) {
  const tm = (NOW - (60 - p * 12) * 36e5) / MIN; const cx = p; // km east: one km per 12-hour pass
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) fire.push([+(lat0 + (j - 1) * 0.375 / 110.574).toFixed(4), +(lng0 + (cx + i * 0.2) / kmLng).toFixed(4), 20 + i, 1, tm + i, p % 2]);
}
// A gas flare in Iraq: one pixel, four days, every pass.
const flare = []; for (let d = 0; d < 8; d++) flare.push([35.0, 44.0, 40, 2, (NOW - d * 12 * 36e5) / MIN, d % 2]);
// Scattered single hot spots far apart.
const lone = [[-10, 25, 3, 1, (NOW - 36e5) / MIN, 1], [-10.5, 25.5, 4, 1, (NOW - 2 * 36e5) / MIN, 1]];

t('hot spots join into fires, biggest heat first, far-apart ones stay apart', () => {
  const fs = clusterFires([...lone, ...flare, ...fire]);
  assert.equal(fs.length, 4); assert.equal(fs[0].n, fire.length); assert.ok(Math.abs(fs[0].lat - lat0) < 0.01);
});
t('the fire’s area counts each 375 m pixel once', () => { const f = summarise(fire); assert.ok(f.areaKm2 > 20 * PIXEL_KM2 && f.areaKm2 <= fire.length * PIXEL_KM2, f.areaKm2); });
t('it is spreading east at about 2 km a day', () => {
  const sp = spread(summarise(fire), NOW); assert.ok(sp.move); assert.ok(Math.abs(sp.move.bearing - 90) < 10, sp.move.bearing); assert.ok(sp.move.kmPerDay > 1.5 && sp.move.kmPerDay < 2.5, sp.move.kmPerDay);
  assert.match(spreadWords(summarise(fire), sp), /spreading east/);
});
t('six satellite passes', () => { assert.equal(passes(fire).length, 6); });
t('playback: the fire as it was after its first pass', () => { const f = summarise(fire); assert.equal(asOf(f, f.first + 30 * MIN).length, 15); assert.equal(asOf(f, f.last).length, fire.length); });
t('convex hull of a square', () => { const h = hull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]); assert.equal(h.length, 4); assert.equal(polyArea(h), 1); });
t('a place to stand: south of the fire, outside it, facing north', () => {
  const f = summarise(fire); const v = viewpoint(f, 180, 1.5); assert.equal(v.facing, 0); assert.ok(v.lat < Math.min(...fire.map((r) => r[0])));
  const [, y] = toKm(f.lat, f.lng, v.lat, v.lng); assert.ok(y < -1.5, y);
});
t('a gas flare looks industrial, the wildfire does not', () => { assert.equal(maybeIndustrial(summarise(flare)), true); assert.equal(maybeIndustrial(summarise(fire)), false); });
t('the top list leaves out the flare and fires quiet for 36 hours', () => {
  const old = fire.map((r) => [r[0] + 5, r[1], r[2], r[3], r[4] - 72 * 60, r[5]]);
  const top = topFires(clusterFires([...flare, ...fire, ...old]), 10, NOW); assert.equal(top.length, 1); assert.ok(Math.abs(top[0].lat - lat0) < 0.01);
});
t('age bands and colours', () => { assert.equal(ageBand(1), 0); assert.equal(ageBand(30), 3); assert.equal(ageBand(1000), AGES.length - 1); assert.equal(ageColor(5), AGES[1].color); });
t('the map: one square per detection shown, an outline, a scale', () => {
  const f = summarise(fire); const svg = fireSvg(f, f.first + 30 * MIN); assert.equal((svg.match(/<rect x=/g) || []).length, 15); assert.match(svg, /class="wf-edge"/); assert.match(svg, /km<\/text>/);
});
t('packing for the bot keeps positions to about 100 m', () => {
  const f = summarise(fire); const back = unpackSpread({ fires: packSpread([f]) })[0]; assert.equal(back.n, f.n); assert.ok(Math.abs(back.lat - f.lat) < 0.001);
});
t('thinning keeps the newest day', () => { const f = summarise(fire); const th = thin(f, 40); assert.equal(th.n, 40); assert.equal(th.last, f.last); });
t('7-day spread merges with the live day without counting the last day twice', () => {
  const f = summarise(fire); const live = fire.filter((r) => r[4] * MIN > NOW - 24 * 36e5);
  const merged = mergeFires([f], live); assert.equal(merged[0].n, fire.length);
});
t('100,000 hot spots group in well under two seconds', () => {
  const many = []; for (let i = 0; i < 100000; i++) many.push([Math.random() * 120 - 60, Math.random() * 360 - 180, 5, 1, NOW / MIN, 1]);
  const t0 = Date.now(); clusterFires(many); assert.ok(Date.now() - t0 < 2000, Date.now() - t0);
});
console.log(`SUMMARY ${ok} / 15`);
