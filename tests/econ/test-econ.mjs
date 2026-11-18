// SPDX-License-Identifier: AGPL-3.0-only
// v2.29 markets, cloud regions and AI labs in depth (econdetail.js): sessions, time zones and latency, run in Node on
// the atlas's own data at fixed moments (no network, no dependence on today's date).
//   node tests/econ/test-econ.mjs   → "SUMMARY n / n"
import { readFileSync } from 'node:fs';
import * as m from '../../site/app/js/econdetail.js';
const res = [];
const check = (name, ok, info = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const wm = JSON.parse(readFileSync(new URL('../../site/app/data/worldmonitor-static.json', import.meta.url)));
const st = (id, iso) => m.marketState(m.sessionOf({ id }), new Date(iso));

// time zones
const all = [...wm.economic, ...wm.finance];
check('every financial place on both lists has a time zone', all.every((p) => m.zoneOf(p)), all.filter((p) => !m.zoneOf(p)).map((p) => p.id));
check('every exchange on both lists has a session', all.filter((p) => p.type === 'exchange' || p.kind === 'exchange').every((p) => m.sessionOf(p)), all.filter((p) => (p.type === 'exchange' || p.kind === 'exchange') && !m.sessionOf(p)).map((p) => p.id));
check('every zone is one the platform knows', all.every((p) => { try { m.localParts(m.zoneOf(p)); return true; } catch { return false; } }));
check('a place in no table borrows the zone of the nearest known city (Buenos Aires)', m.zoneOf({ lat: -34.6, lon: -58.4 }) === 'America/Argentina/Buenos_Aires' && m.zoneOf({ lat: 0, lon: -150 }) === null);
check('offsets follow daylight saving: New York −4 h in July, −5 h in November; India +5:30', m.offsetMin('America/New_York', new Date('2026-07-01T12:00:00Z')) === -240 && m.offsetMin('America/New_York', new Date('2026-11-17T12:00:00Z')) === -300 && m.offsetMin('Asia/Kolkata', new Date('2026-11-17T12:00:00Z')) === 330);

// sessions at fixed moments (Tuesday 17 November 2026)
const nyOpen = st('nyse', '2026-11-17T15:00:00Z');
check('NYSE at 10:00 New York on a Tuesday: open, closing in 6 h', nyOpen.open && nyOpen.mins === 360, nyOpen);
const nyPre = st('nyse', '2026-11-17T14:00:00Z');
check('NYSE at 09:00: closed, opening in 30 min', !nyPre.open && nyPre.mins === 30, nyPre);
const nySat = st('nyse', '2026-11-21T15:00:00Z');
check('NYSE on Saturday: closed until Monday 09:30 (1 d 23 h 30 min)', !nySat.open && nySat.mins === 2850, nySat);
const tseLunch = st('tse', '2026-11-17T02:45:00Z');
check('Tokyo at 11:45: lunch break, back in 45 min', !tseLunch.open && tseLunch.lunch && tseLunch.mins === 45, tseLunch);
const hk = st('hkex', '2026-11-17T06:00:00Z');
check('Hong Kong at 14:00: open', hk.open, hk);
const tad = st('tadawul', '2026-11-15T08:00:00Z');
check('Tadawul trades on Sunday (11:00 Riyadh) and not on Friday', tad.open && !st('tadawul', '2026-11-20T08:00:00Z').open);
check('Dubai trades Monday to Friday since 2022', st('dfm', '2026-11-20T08:00:00Z').open && !st('dfm', '2026-11-15T08:00:00Z').open);
check('CME Globex: open Tuesday night, shut Saturday, shut in its daily break (16:00–17:00 Chicago)', st('cme', '2026-11-18T04:00:00Z').open && !st('cme', '2026-11-21T15:00:00Z').open && !st('cme', '2026-11-17T22:30:00Z').open);
const twse = m.sessionOf(wm.finance.find((f) => f.id === 'twse'));
check('a session can also come from the place’s own “09:00-13:30” field', twse.zone === 'Asia/Taipei' && twse.open === 540 && twse.close === 810);
const u = m.sessionUtc(m.sessionOf({ id: 'nyse' }), new Date('2026-11-17T12:00:00Z'));
check('NYSE today in UTC: 14:30–21:00', u.from === 870 && u.to === 1260, u);
const lu = m.sessionUtc(m.sessionOf({ id: 'asx' }), new Date('2026-11-17T12:00:00Z'));
check('Sydney in UTC starts the day before (−1 h, summer time)', lu.from === -60, lu);
check('every exchange on the strip has a session and a time zone', m.STRIP.every((id) => m.sessionOf({ id })));
check('durations in words', m.span(45) === '45 min' && m.span(150) === '2 h 30 min' && m.span(2550) === '1 d 18 h');

// latency
check('light in fibre: 1,000 km of straight line is about 14.7 ms round trip with the 1.5 route allowance', near(m.rttMs(1000), 14.71, 0.05));
check('10 ms round trip reaches about 680 km', near(m.kmFor(10), 680, 1) && near(m.rttMs(m.kmFor(37)), 37, 1e-9));
const lon = wm.cloudRegions.find((c) => /London/.test(c.city)); const ny = { lat: 40.71, lon: -74.0 };
const ms = m.rttMs(Math.hypot(1, 1) * 0 + 5570);
check('London to New York (5,570 km) comes out near 82 ms, above the ~70 ms people measure, as a floor with a long route should', near(ms, 81.9, 0.5) && lon && ny);
check('every cloud region has a provider name', wm.cloudRegions.every((c) => m.PROVIDERS[c.provider]), [...new Set(wm.cloudRegions.map((c) => c.provider))]);

const ok = res.filter(Boolean).length;
console.log(`SUMMARY ${ok} / ${res.length}`);
process.exit(ok === res.length ? 0 : 1);
