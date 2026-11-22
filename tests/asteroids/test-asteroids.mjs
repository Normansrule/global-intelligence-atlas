// SPDX-License-Identifier: AGPL-3.0-only
// v2.34 asteroids (site/app/js/asteroids.js) on a fixed date, checked against the distances JPL's ephemerides give
// for 19 November 2026 22:24 UTC (read through Wolfram|Alpha): a Kepler orbit should land within a few per cent.
import * as A from '../../site/app/vendor/astronomy.min.mjs';
import { ASTEROIDS, ASTEROID, closePasses, nextPass, howFar, asteroidSections, asteroidRows } from '../../site/app/js/asteroids.js';
import { cometNow, orbitOf } from '../../site/app/js/comets.js';
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const D = new Date('2026-11-19T22:24:00Z');
const near = (x, want, pct) => Math.abs(x - want) / want <= pct / 100;
check('six asteroids', ASTEROIDS.length === 6 && ['apophis', 'didymos', 'eros', 'psyche', 'ryugu', 'itokawa'].every((k) => ASTEROID[k]));
const JPL = { apophis: [0.74628, 1.243], didymos: [1.12702, 1.301], eros: [1.7611, 2.522], psyche: [3.1142, 3.231], ryugu: [1.4176, 2.189], itokawa: [1.383, 1.225] };
for (const [k, [r, d]] of Object.entries(JPL)) { const n = cometNow(A, ASTEROID[k], D); check(`${ASTEROID[k].name}: ${r} AU from the Sun and ${d} from the Earth, within 2 %`, near(n.r, r, 2) && near(n.delta, d, 2), [n.r, n.delta]); }
const P = { apophis: 323.57, ryugu: 474.76, itokawa: 556.54, eros: 1.7609 * 365.25, didymos: 2.1053 * 365.25, psyche: 4.9961 * 365.25 };
check('periods as JPL’s within 0.3 %', Object.entries(P).every(([k, p]) => near(orbitOf(ASTEROID[k]).periodD, p, 0.3)), Object.fromEntries(Object.keys(P).map((k) => [k, orbitOf(ASTEROID[k]).periodD])));
const ap = closePasses(A, ASTEROID.apophis, D, 5, 0.05);
check('the search finds Apophis’s pass within a day of 13 April 2029, very close', ap.length === 1 && Math.abs(ap[0].ms - Date.UTC(2029, 3, 13, 21)) < 1.5 * 864e5 && ap[0].au < 0.03, ap.map((p) => [new Date(p.ms).toISOString(), p.au]));
const np = nextPass(A, ASTEROID.apophis, D);
check('… and the page gives JPL’s figure for it: 32,000 km above the ground', np.jpl && np.text.includes('32,000 km') && np.text.startsWith('13 April 2029'), np.text);
check('Psyche never comes near the Earth', closePasses(A, ASTEROID.psyche, D, 30, 0.2).length === 0);
check('howFar in km and Moon distances', howFar(0.001).includes('of the way to the Moon') && howFar(0.02).includes('times as far as the Moon') && howFar(1.3).includes('AU'), [howFar(0.001), howFar(0.02), howFar(1.3)]);
const h = asteroidSections(A, ASTEROID.apophis, D).replace(/<[^>]+>/g, ' ');
check('Apophis’s page: where it is, the 2029 pass, no later passes on the old orbit, OSIRIS-APEX', h.includes('From the Earth') && h.includes('13 April 2029') && !h.includes('Later passes') && h.includes('OSIRIS-APEX') && h.includes('crosses the Earth’s orbit'));
const dd = asteroidSections(A, ASTEROID.didymos, D).replace(/<[^>]+>/g, ' ');
check('Didymos’s page: DART shortened Dimorphos’s orbit by 33 minutes; Hera on the way', dd.includes('33 minutes') && dd.includes('Hera'));
const rows = asteroidRows(A, D);
check('the solar system table: six rows, Apophis on 13 April 2029', rows.length === 6 && rows[0].next === '13 April 2029', rows.map((r) => r.next));
console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
