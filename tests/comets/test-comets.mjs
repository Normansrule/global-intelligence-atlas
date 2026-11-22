// SPDX-License-Identifier: AGPL-3.0-only
// v2.32 the famous comets (site/app/js/comets.js) on a fixed date, checked against the distances JPL's ephemerides
// give for 18 November 2026 (read through Wolfram|Alpha): a Kepler orbit should land within a few per cent.
import * as A from '../../site/app/vendor/astronomy.min.mjs';
import { COMETS, COMET, orbitOf, cometPos, cometNow, orbitPoints, whereAU, tailAU, orbitSvg, cometSections, cometRows } from '../../site/app/js/comets.js';
import { SHOWERS } from '../../site/app/js/skydetail.js';
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const D = new Date('2026-11-18T12:00:00Z');
const near = (x, want, pct) => Math.abs(x - want) / want <= pct / 100;
const n = Object.fromEntries(COMETS.map((c) => [c.id, cometNow(A, c, D)]));
check('six famous comets', COMETS.length === 6 && ['halley', 'encke', 'swifttuttle', 'tempeltuttle', 'cg67p', 'halebopp'].every((k) => COMET[k]));
// JPL via Wolfram|Alpha, 18 November 2026: [from the Sun, from the Earth] in AU
const JPL = { halley: [35.163, 34.83], encke: [1.6011, 0.9396], swifttuttle: [43.042, 43.17], tempeltuttle: [11.97, 12.93], cg67p: [4.62537, 5.457], halebopp: [51.108, 51.43] };
for (const [k, [r, d]] of Object.entries(JPL)) check(`${COMET[k].name}: ${r} AU from the Sun and ${d} from the Earth, within 3 %`, near(n[k].r, r, 3) && near(n[k].delta, d, 3), [n[k].r, n[k].delta]);
check('periods: Halley 75.9 years, Encke 3.31, Swift–Tuttle 133.3, Hale–Bopp about 2,360', near(n.halley.years, 75.92, 0.2) && near(n.encke.years, 3.307, 0.3) && near(n.swifttuttle.years, 133.28, 0.2) && near(n.halebopp.years, 2363, 1), [n.halley.years, n.encke.years, n.swifttuttle.years, n.halebopp.years]);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
check('next closest passes as JPL’s two-body figures: Encke 10 February 2027, Tempel–Tuttle May 2031, 67P July 2028', Math.abs(n.encke.nextMs - Date.parse('2027-02-10')) < 3 * 864e5 && day(n.tempeltuttle.nextMs).startsWith('2031-05') && day(n.cg67p.nextMs).startsWith('2028-0'), [day(n.encke.nextMs), day(n.tempeltuttle.nextMs), day(n.cg67p.nextMs)]);
check('Halley passed its farthest point in 2023, so it is falling back in; Swift–Tuttle is still climbing out', n.halley.inbound && !n.swifttuttle.inbound);
const pq = cometPos(COMET.halley, orbitOf(COMET.halley).tpJd); check('at perihelion Halley is its perihelion distance from the Sun (0.575 AU)', near(Math.hypot(...pq), 0.5751575, 0.01), Math.hypot(...pq));
check('vis-viva: Halley races at about 55 km/s at perihelion and crawls under 1 km/s at aphelion', near(n.halley.vPeri, 54.5, 3) && n.halley.vAph < 1, [n.halley.vPeri, n.halley.vAph]);
const pts = orbitPoints(COMET.encke, 120); const rs = pts.map((p) => Math.hypot(...p));
check('the drawn orbit runs from perihelion (0.34 AU) to aphelion (4.1 AU) and closes', near(Math.min(...rs), 0.336, 1) && near(Math.max(...rs), 4.10, 1) && Math.hypot(pts[0][0] - pts[120][0], pts[0][1] - pts[120][1], pts[0][2] - pts[120][2]) < 1e-6, [Math.min(...rs), Math.max(...rs)]);
check('where: 1.6 AU is between Mars and Jupiter; 35 AU beyond Neptune', whereAU(1.6) === 'between the orbits of Mars and Jupiter' && whereAU(35).startsWith('beyond Neptune'), [whereAU(1.6), whereAU(35)]);
check('tails only inside about 3 AU, longer nearer the Sun', tailAU(3.5) === 0 && tailAU(1.6) > 0 && tailAU(0.5) > tailAU(1.6) && n.encke.active && !n.halley.active);
const svg = orbitSvg(COMET.halley, n.halley); check('the orbit drawing has the planets out to Neptune and the comet', (svg.match(/class="ce-pl"/g) || []).length === 7 && svg.includes('ce-earth') && svg.includes('ce-now'));
const enc = cometSections(A, COMET.encke, D, SHOWERS);
check('Encke’s page: where it is (Pegasus), its tail growing, the Taurids and the lost CONTOUR probe', enc.includes('Pegasus') && enc.includes('growing') && enc.includes('Taurids') && enc.includes('CONTOUR'));
const hal = cometSections(A, COMET.halley, D, SHOWERS);
check('Halley’s page: the Orionids and Eta Aquariids with their next peaks, 28 July 2061 and Giotto', hal.includes('Orionids') && hal.includes('Eta Aquariids') && hal.includes('6 May 2027') && hal.includes('28 July 2061') && hal.includes('Giotto'));
check('a comet that goes round backwards says so', hal.includes('goes round backwards') && !enc.includes('goes round backwards'));
check('67P has Rosetta and Philae; Swift–Tuttle has no visits yet', cometSections(A, COMET.cg67p, D, SHOWERS).includes('Philae') && cometSections(A, COMET.swifttuttle, D, SHOWERS).includes('No spacecraft has visited it yet'));
const rows = cometRows(A, D); check('the solar system table: Halley’s next pass as JPL’s full prediction, the others from their orbits', rows[0].next === '28 July 2061' && rows[1].next === 'February 2027', rows.map((r) => r.next));
check('names are escaped', !cometSections(A, { ...COMET.encke, name: '<b>x</b>', nucleus: '<img>' }, D, SHOWERS).includes('<img>'));
console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
if (res.some((x) => !x)) process.exit(1);
