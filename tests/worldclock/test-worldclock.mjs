// SPDX-License-Identifier: AGPL-3.0-only
// v2.38 world clock: local times, offsets, the Sun's height and shared working hours, checked against fixed dates.
import assert from 'node:assert/strict';
import { CITIES, CITY, localParts, offsetMin, offsetLabel, sunAlt, daylight, clockRow, sharedHours, runs, clockHtml } from '../../site/app/js/worldclock.js';

let ok = 0; const t = (name, fn) => { fn(); ok++; console.log('ok', name); };
const winter = Date.UTC(2026, 0, 15, 12, 0); const summer = Date.UTC(2026, 6, 15, 12, 0);

t('sixteen cities with unique ids and valid zones', () => { assert.equal(CITIES.length, 16); assert.equal(new Set(CITIES.map((c) => c.id)).size, 16); for (const c of CITIES) localParts(winter, c.tz); });
t('London follows summer time', () => { assert.equal(offsetMin(winter, CITY.london.tz), 0); assert.equal(offsetMin(summer, CITY.london.tz), 60); });
t('New York is 5 hours behind in January, 4 in July', () => { assert.equal(offsetMin(winter, CITY.newyork.tz), -300); assert.equal(offsetMin(summer, CITY.newyork.tz), -240); });
t('India is 5:30 ahead all year', () => { assert.equal(offsetMin(winter, 'Asia/Kolkata'), 330); assert.equal(offsetLabel(330), 'UTC+5:30'); assert.equal(offsetLabel(-240), 'UTC−4'); assert.equal(offsetLabel(0), 'UTC'); });
t('Sydney is on summer time in January', () => { assert.equal(offsetMin(winter, CITY.sydney.tz), 660); assert.equal(offsetMin(summer, CITY.sydney.tz), 600); });
t('wall clock in Tokyo', () => { const p = localParts(winter, 'Asia/Tokyo'); assert.deepEqual([p.h, p.m, p.d], [21, 0, 15]); });
t('the Sun is high at noon on the equator at an equinox, below the horizon at midnight', () => {
  const eq = Date.UTC(2026, 2, 20, 12, 0); assert.ok(sunAlt(eq, 0, 0) > 85); assert.ok(sunAlt(eq + 12 * 36e5, 0, 0) < -85);
});
t('midsummer noon in London is about 62°', () => { const a = sunAlt(Date.UTC(2026, 5, 21, 12, 2), 51.51, -0.13); assert.ok(Math.abs(a - 62) < 1, a); });
t('daylight bands', () => { assert.equal(daylight(10), 'day'); assert.equal(daylight(-3), 'twilight'); assert.equal(daylight(-20), 'night'); });
t('a row compares with the viewer’s zone and marks tomorrow', () => {
  const r = clockRow(CITY.tokyo, winter, 'Europe/London'); assert.equal(r.time, '21:00'); assert.equal(r.diff, 540); assert.equal(r.dayShift, 0); assert.equal(r.working, false);
  const late = clockRow(CITY.tokyo, Date.UTC(2026, 0, 15, 20, 0), 'Europe/London'); assert.equal(late.dayShift, 1);
});
t('London and New York share 13:00–18:00 London time in January', () => {
  const hrs = sharedHours(Date.UTC(2026, 0, 15, 0, 0), [CITY.london.tz, CITY.newyork.tz]);
  assert.deepEqual(runs(hrs).map(([a, b]) => [new Date(a).getUTCHours(), new Date(b).getUTCHours()]), [[13, 18]]);
});
t('London, New York and Tokyo never share working hours', () => { assert.equal(sharedHours(winter, [CITY.london.tz, CITY.newyork.tz, CITY.tokyo.tz]).length, 0); });
t('the panel escapes and lists every city', () => {
  const h = clockHtml(winter, ['london', 'newyork'], 'Europe/London'); assert.equal((h.match(/class="wc-row/g) || []).length, 16); assert.ok(h.includes('13:00–18:00')); assert.ok(!h.includes('<script'));
});
console.log(`SUMMARY ${ok} / 13`);
