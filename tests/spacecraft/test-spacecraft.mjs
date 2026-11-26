// SPDX-License-Identifier: AGPL-3.0-only
// v2.36 Spacecraft at work (site/app/js/spacecraft.js): Parker Solar Probe's orbit, distances from the Earth, the cards.
import { CRAFT, PLACES, PARKER, parkerNow, fromEarthKm, craftRows, craftSections, lagrangeSvg } from '../../site/app/js/spacecraft.js';
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const peri = parkerNow(PARKER.tp);
check('Parker at its 24 December 2024 close pass: 6.9 million km from the Sun’s centre (6.1 above the surface), about 190 km/s', Math.abs(peri.rKm / 1e6 - 6.87) < 0.05 && Math.abs(peri.v - 191) < 3, peri);
const half = parkerNow(PARKER.tp + 44 * 864e5);
check('half an orbit later it is at its farthest, about 0.73 AU, near Venus’s orbit (0.72), at about 12 km/s', Math.abs(half.r - 0.728) < 0.005 && half.v < 15, half);
const n = parkerNow(Date.UTC(2026, 10, 22, 12));
check('on 22 November 2026: falling in, next close pass 28 November 2026 (88-day steps from December 2024)', n.inbound && new Date(n.nextMs).toISOString().slice(0, 10) === '2026-11-28', n);
check('L1 and L2 are about 1.5 million km from the Earth; the Mars fleet is as far as Mars; cruise has no place', fromEarthKm(CRAFT.find((c) => c.id === 'jwst'), {}) === 1.51e6 && Math.abs(fromEarthKm(CRAFT.find((c) => c.id === 'mro'), { marsAU: 2 }) - 2 * 149597870.7) < 1 && fromEarthKm(CRAFT.find((c) => c.id === 'clipper'), {}) === null);
const rows = craftRows({ ms: Date.UTC(2026, 10, 22), marsAU: 2.1 });
check('the table: every spacecraft, a radio time of about 5 seconds to L2 and about 17 minutes to Mars at 2.1 AU', rows.length === CRAFT.length && rows.find((r) => r.c.id === 'jwst').sig === '5 seconds' && rows.find((r) => r.c.id === 'mro').sig === '17.5 minutes', rows.slice(0, 2));
check('every spacecraft has a known place, a launch year, a reference and its own text', CRAFT.every((c) => PLACES[c.place] && c.launched > 1990 && c.ref && c.does && c.fact) && new Set(CRAFT.map((c) => c.id)).size === CRAFT.length);
const h = craftSections(CRAFT.find((c) => c.id === 'jwst'), { ms: Date.UTC(2026, 10, 22), marsAU: 2 });
check('Webb’s card: L2, the sketch, the others there (Euclid) as buttons', h.includes('Sun–Earth L2') && h.includes('lg-svg') && h.includes('data-space-craft="euclid"') && !h.includes('data-space-craft="jwst"'));
const p = craftSections(CRAFT.find((c) => c.id === 'parker'), { ms: Date.UTC(2026, 10, 22, 12) });
check('Parker’s card: its distance from the Sun now and its next close pass, with an English ordinal', p.includes('million km') && p.includes('28 November 2026') && /its \d+(st|nd|rd|th)\)/.test(p), p.slice(0, 300));
check('the sketch marks the right point', lagrangeSvg('l1').includes('<g class="on"><circle cx="205"') && lagrangeSvg('l2').includes('<g class="on"><circle cx="285"'));
console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
