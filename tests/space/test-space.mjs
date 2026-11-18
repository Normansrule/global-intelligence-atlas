// SPDX-License-Identifier: AGPL-3.0-only
// v2.30 body pages in depth (site/app/js/spacedetail.js): weight, transfers, launch windows, the sky, sections.
// Dates are fixed, so nothing here depends on the day it runs.
import * as A from '../../site/app/vendor/astronomy.min.mjs';
import { BODIES, BODY } from '../../site/app/js/bodies.js';
import { PHYS, MISSIONS, standing, hohmann, nextWindow, skyFrom, spaceSections, scaleSvg, compass } from '../../site/app/js/spacedetail.js';
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const T0 = new Date('2026-11-17T22:00:00Z');
const day = (d) => d?.toISOString().slice(0, 10);

check('every body the atlas draws has figures', BODIES.every((b) => PHYS[b.id]), BODIES.filter((b) => !PHYS[b.id]).map((b) => b.id));
check('every body but the Earth has at least one mission', BODIES.filter((b) => b.id !== 'earth').every((b) => MISSIONS[b.id]?.length), BODIES.filter((b) => b.id !== 'earth' && !MISSIONS[b.id]).map((b) => b.id));
const moon = standing('moon', 1737.4);
check('on the Moon 70 kg weighs like 11.6 kg', Math.abs(moon.weightKg - 11.56) < 0.1, moon);
check('on the Moon a 50 cm jump goes about 3 m', Math.abs(moon.jumpM - 3.03) < 0.05, moon);
const mars = standing('mars', 3389.5);
check('on Mars the Sun is 66 % as wide and gives 43 % of the light', Math.abs(mars.sunWidth - 0.656) < 0.01 && Math.abs(mars.sunlight - 0.43) < 0.01, mars);
check('a Martian year is about 669 Martian days', Math.abs(mars.daysInYear - 668.6) < 1.5, mars);
const hm = hohmann(1.524, 687);
check('Earth to Mars: about 259 days', hm.tDays > 255 && hm.tDays < 262, hm);
check('Earth to Mars: about 3.6 km/s from low orbit', hm.dv > 3.5 && hm.dv < 3.7, hm);
check('Mars lines up every 780 days', Math.abs(hm.synodic - 780) < 3, hm);
check('Mars must lead the Earth by 44° at departure', Math.abs(hm.lead - 44.3) < 1, hm);
const hj = hohmann(5.203, 4331);
check('Earth to Jupiter: about 2.7 years and 6.3 km/s', Math.abs(hj.tDays / 365.25 - 2.73) < 0.05 && hj.dv > 6.1 && hj.dv < 6.5, hj);
const hv = hohmann(0.723, 224.7);
check('Earth to Venus: about 146 days, Venus behind by 54°', Math.abs(hv.tDays - 146) < 3 && Math.abs(hv.lead + 54) < 2, hv);
const wm = nextWindow(A, 'mars', hm.lead, T0);
check('the next Mars window from 17 November 2026 falls in December 2026', day(wm) >= '2026-11-25' && day(wm) <= '2027-01-10', day(wm));
const wm2 = nextWindow(A, 'mars', hm.lead, new Date('2027-03-01T00:00:00Z'));
check('the one after is about 26 months later (early 2029)', day(wm2) >= '2028-12-01' && day(wm2) <= '2029-03-31', day(wm2));
const wv = nextWindow(A, 'venus', hv.lead, T0);
check('a Venus window comes within one synodic period (584 days)', wv && (wv - T0) / 864e5 <= 590, day(wv));
const london = { lat: 51.5, lng: -0.13 };
const j = skyFrom(A, 'jupiter', london, T0);
check('Jupiter from London: next rises within a day, before midnight', j.rise && (j.rise - T0) < 864e5 && day(j.rise) === '2026-11-17', j);
check('Jupiter: the next opposition is in early 2027', day(j.best?.date) >= '2027-01-01' && day(j.best?.date) <= '2027-03-31', j.best);
const m = skyFrom(A, 'moon', london, T0);
check('the Moon: the next full Moon is 24 November 2026', day(m.best?.date) === '2026-11-24', m.best);
const v = skyFrom(A, 'venus', london, T0);
check('Venus: greatest elongation is in the morning sky in January 2027', v.best?.kind.includes('morning') && day(v.best.date).startsWith('2027-01'), v.best);
check('the Sun has no best time', skyFrom(A, 'sun', london, T0).best === null);
check('compass words', compass(0) === 'north' && compass(100) === 'east' && compass(350) === 'north' && compass(225) === 'south-west');
const obs = { lat: 51.5, lng: -0.13, place: 'London' };
let bad = [];
for (const b of BODIES) {
  const h = spaceSections(b.id, { A, date: T0, obs, def: b, hostName: 'Host' });
  if (!h || /NaN|undefined|Infinity|null/.test(h.replace(/<[^>]+>/g, ''))) bad.push(b.id);
}
check('every body gets a page with no NaN, undefined or Infinity', !bad.length, bad);
const bennu = spaceSections('bennu', { A, date: T0, obs, def: BODY.bennu });
check('Bennu: a 50 cm jump would leave it for good', bennu.includes('leave it for good'), bennu.slice(0, 600));
const titan = spaceSections('titan', { A, date: T0, obs, def: BODY.titan, hostName: 'Saturn' });
check('Titan: thick nitrogen air, Saturn’s sky times, Huygens', titan.includes('Nitrogen') && titan.includes('Saturn’s times') && titan.includes('Huygens'), titan.slice(0, 400));
const earth = spaceSections('earth', { A, date: T0, obs, def: BODY.earth });
check('Earth: no getting there and no sky section', !earth.includes('Getting there') && !earth.includes('In our sky'));
const venus = spaceSections('venus', { A, date: T0, obs, def: BODY.venus });
check('Venus: 92 bar is like being about 900 m under the sea', /like being 8\d\d m under the sea/.test(venus), venus.match(/Pressure[^<]*<\/dt><dd>[^<]*/)?.[0]);
const hostile = spaceSections('mars', { A, date: T0, obs: { lat: 0, lng: 0, place: '<img src=x>' }, def: { ...BODY.mars, name: '<b>x</b>' } });
check('names and places are escaped', !hostile.includes('<img') && !hostile.includes('<b>x'));
const svg = scaleSvg('Bennu', 0.245, '#888');
check('a tiny world is still drawn next to the Earth and the Moon', (svg.match(/<circle/g) || []).length === 3, svg);
const ok = res.filter(Boolean).length;
console.log(`SUMMARY ${ok} / ${res.length}`);
process.exit(ok === res.length ? 0 : 1);
