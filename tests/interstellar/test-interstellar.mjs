// SPDX-License-Identifier: AGPL-3.0-only
// v2.37 Visitors from other stars (site/app/js/interstellar.js): open (hyperbolic) paths checked against the published
// close passes and speeds of 1I/ʻOumuamua, 2I/Borisov and 3I/ATLAS.
import * as AE from '../../site/app/vendor/astronomy.min.mjs';
import { VISITORS, VISITOR, pathOf, visitorPos, visitorNow, visitorPath, visitorSections } from '../../site/app/js/interstellar.js';
const A = AE.default ?? AE;
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const len = (v) => Math.hypot(...v);
for (const v of VISITORS) check(`${v.name} is at its perihelion distance at perihelion`, Math.abs(len(visitorPos(v, v.tp)) - v.q) < 1e-9, len(visitorPos(v, v.tp)));
const sp = Object.fromEntries(VISITORS.map((v) => [v.id, pathOf(v).vInf]));
check('speeds in interstellar space: ʻOumuamua 26.3, Borisov 32.3, 3I/ATLAS 58 km/s (published, within 0.5)', Math.abs(sp.oumuamua - 26.3) < 0.5 && Math.abs(sp.borisov - 32.3) < 0.5 && Math.abs(sp.atlas3i - 58) < 0.5, sp);
const near = (id) => visitorNow(A, VISITOR[id], new Date(Date.UTC(2026, 10, 23))).near;
const o = near('oumuamua'); const b = near('borisov'); const t = near('atlas3i');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
check('closest to the Earth: ʻOumuamua 14 October 2017 at 0.16 AU', day(o.ms) === '2017-10-14' && Math.abs(o.au - 0.162) < 0.005, o);
check('Borisov 28 December 2019 at 1.94 AU', day(b.ms) === '2019-12-28' && Math.abs(b.au - 1.94) < 0.01, b);
check('3I/ATLAS 19 December 2025 at about 1.8 AU', day(t.ms) === '2025-12-19' && Math.abs(t.au - 1.8) < 0.02, t);
let m = [9, 0];
for (let ms = Date.UTC(2025, 8, 20); ms < Date.UTC(2025, 9, 15); ms += 3600e3) { const p = visitorPos(VISITOR.atlas3i, ms); const mv = A.HelioVector(A.Body.Mars, A.MakeTime(new Date(ms))); const d = Math.hypot(p[0] - mv.x, p[1] - mv.y, p[2] - mv.z); if (d < m[0]) m = [d, ms]; }
check('3I/ATLAS passed Mars on 3 October 2025 at about 0.19 AU (29 million km)', day(m[1]) === '2025-10-03' && Math.abs(m[0] - 0.19) < 0.01, m);
const now = visitorNow(null, VISITOR.atlas3i, new Date(Date.UTC(2026, 10, 23)));
check('on 23 November 2026 3I/ATLAS is leaving, past Jupiter’s orbit, faster than its interstellar speed', now.outbound && now.r > 10 && now.r < 17 && now.speed > now.vInf, now.r);
const path = visitorPath(VISITOR.borisov, 10, 60, 100);
check('a drawn path runs from far in to far out, through perihelion', path.length === 101 && len(path[0]) > 30 && len(path[100]) > 150 && Math.min(...path.map(len)) < 2.2);
const h = visitorSections(A, VISITOR.oumuamua, new Date(Date.UTC(2026, 10, 23)));
check('ʻOumuamua’s page: where it is, its path, when it was found, an open path that never comes back', h.includes('Where it is now') && h.includes('never comes back') && h.includes('19 October 2017') && h.includes('14 October 2017'));
console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
