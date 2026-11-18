// SPDX-License-Identifier: AGPL-3.0-only
// v2.27 spaceports and mines in depth (sitedetail.js): the arithmetic behind each page, run in Node on the atlas's
// own data and country outlines (no network).
//   node tests/sites/test-sites.mjs   → "SUMMARY n / n"
import { readFileSync } from 'node:fs';
import * as m from '../../site/app/js/sitedetail.js';
const res = [];
const check = (name, ok, info = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const wm = JSON.parse(readFileSync(new URL('../../site/app/data/worldmonitor-static.json', import.meta.url)));
const geo = JSON.parse(readFileSync(new URL('../../site/app/data/countries.geojson', import.meta.url)));
// the same ray-casting country lookup as main.js countryAt
const idx = geo.features.filter((f) => f.geometry).map((f) => { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; let x0 = 180, x1 = -180, y0 = 90, y1 = -90; for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { f, polys, bb: [x0, x1, y0, y1] }; });
const countryAt = (lat, lng) => { const inRing = (r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; }; for (const c of idx) { const [x0, x1, y0, y1] = c.bb; if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue; for (const p of c.polys) if (inRing(p[0]) && !p.slice(1).some(inRing)) return c.f; } return null; };
const sp = (id) => wm.spaceports.find((s) => s.id === id);

// Earth's spin and orbits
check('the equator lends 465 m/s; Cape Canaveral (28.5°) about 409 m/s', near(m.spinBoost(0), 465.1, 0.01) && near(m.spinBoost(28.5), 408.7, 0.5));
check('due east from 28.5° gives a 28.5° orbit; due north a polar one', near(m.inclinationOf(28.5, 90), 28.5, 1e-9) && near(m.inclinationOf(28.5, 0), 90, 1e-9));
check('the ISS tilt (51.6°) from Baikonur (45.9° N) needs a bearing of about 64°', near(m.inclinationOf(45.9, 64.0), 51.6, 0.4), m.inclinationOf(45.9, 64));
check('westward launches are retrograde (over 90°): Sun-synchronous from Vandenberg is near a bearing of 189.5°', m.inclinationOf(34.7, 200) > 90 && near(m.inclinationOf(34.7, 189.5), 97.8, 0.3), m.inclinationOf(34.7, 189.5));
check('plane change at geostationary height: 28.5° costs about 1.51 km/s, 5.2° about 0.28 km/s', near(m.geoPlaneDv(28.5), 1.514, 0.01) && near(m.geoPlaneDv(5.2), 0.279, 0.005));
const [la, lo] = m.destination(0, 0, 90, 111.195);
check('a point 111 km due east of 0°,0° is at 1° east', near(la, 0, 1e-6) && near(lo, 1, 0.001), [la, lo]);
const [la2] = m.destination(10, 20, 0, 1111.95);
check('1,112 km due north adds 10° of latitude', near(la2, 20, 0.01), la2);

// the sea-safe fan on real coasts
const ksc = sp('ksc'); const fk = m.seaFan(ksc.lat, ksc.lon, countryAt); const runK = m.safeRuns(fk);
check('the fan has a direction every 5° (72)', fk.length === 72);
check('Kennedy: due east over the Atlantic is safe, due west over Florida is not', fk.find((f) => f.az === 90).safe && !fk.find((f) => f.az === 270).safe, runK);
const vb = sp('vandenberg'); const fv = m.seaFan(vb.lat, vb.lon, countryAt);
check('Vandenberg: due south and south-west are safe, due east over California is not', fv.find((f) => f.az === 180).safe && fv.find((f) => f.az === 225).safe && !fv.find((f) => f.az === 90).safe);
const rv = m.reachOf(vb.lat, fv); const rk = m.reachOf(ksc.lat, fk);
check('Vandenberg reaches polar and Sun-synchronous orbits straight up', rv.find((r) => r.name === 'Polar').how === 'direct' && rv.find((r) => r.name === 'Sun-synchronous').how === 'direct', rv);
check('Kennedy reaches the ISS straight up; geostationary transfer goes due east from it', rk.find((r) => r.name === 'Space station').how === 'direct' && rk.find((r) => r.name === 'Geostationary transfer').how === 'direct', rk);
const kz = m.reachOf(46, m.seaFan(46, 63.3, countryAt));
check('Baikonur, deep inland, has no sea-safe direction at all', kz.every((r) => r.how !== 'direct'));
check('runs wrap through north', JSON.stringify(m.safeRuns([{ az: 0, safe: true }, { az: 5, safe: false }, { az: 10, safe: true }, { az: 15, safe: true }])) === '[[10,0]]', m.safeRuns([{ az: 0, safe: true }, { az: 5, safe: false }, { az: 10, safe: true }, { az: 15, safe: true }]));
check('a site with sea all round has one run of every direction', JSON.stringify(m.safeRuns([{ az: 0, safe: true }, { az: 180, safe: true }])) === '[[0,360]]');
check('every spaceport on the map gets a full fan', wm.spaceports.every((s) => m.seaFan(s.lat, s.lon, countryAt).length === 72));

// minerals and outputs
const minerals = [...new Set([...wm.minerals, ...wm.mining].map((x) => x.mineral))];
check('every mineral on the map has its notes', minerals.every((x) => m.MINERALS[m.mineralKey(x)]), minerals.filter((x) => !m.mineralKey(x)));
check('names in either form find their mineral', m.mineralKey('rare earth elements') === 'Rare Earths' && m.mineralKey('LITHIUM') === 'Lithium' && m.mineralKey('Iron') === 'Iron Ore' && m.mineralKey('cheese') === null);
check('shares of the top producer are percentages', Object.values(m.MINERALS).every((x) => x.top[1] > 0 && x.top[1] < 100 && x.world > 0));
check('ounces: 2.8 Moz is about 87 t', near(m.parseOutput('2.8 Moz/yr').t, 87.09, 0.05) && near(m.parseOutput('800 Koz/yr').t, 24.88, 0.05));
check('tonnes: 1.2 Mt Cu, 430 kt Cu and 700 t of gold', m.parseOutput('1.2Mt Cu/yr').t === 1.2e6 && m.parseOutput('~430kt Cu/yr').t === 430e3 && m.parseOutput('~700t gold/yr').t === 700);
check('lithium carbonate equivalent counts as 18.8 % lithium; hydroxide and percentages are not read', near(m.parseOutput('~200kt LCE/yr').t, 37600, 1) && m.parseOutput('24kt LiOH/yr') === null && m.parseOutput('~70% of global REE separation') === null);
check('a depth in km is not an output', m.parseOutput("World's deepest gold mine (4km).") === null);
const esc = wm.mining.find((x) => x.id === 'escondida'); const sh = m.worldShare(esc);
check('Escondida: 1.2 Mt of copper is about 5.5 % of the world’s', sh && near(sh.share, 5.45, 0.1), sh);
const mur = m.worldShare(wm.mining.find((x) => x.id === 'muruntau'));
check('Muruntau: 2.8 Moz of gold is about 2.9 % of the world’s', mur && near(mur.share, 2.9, 0.1), mur);
const shares = wm.mining.map((x) => m.worldShare(x)).filter(Boolean);
check('at least 25 sites on the map have a share of world output, none over 100 %', shares.length >= 25 && shares.every((s) => s.share > 0 && s.share < 100), shares.length);
const lme = wm.commodities.find((c) => c.id === 'lme');
check('exchanges name the minerals they price (London Metal Exchange: copper and nickel)', lme.commodities.map(m.mineralKey).includes('Copper') && lme.commodities.map(m.mineralKey).includes('Nickel'));

const ok = res.filter(Boolean).length;
console.log(`SUMMARY ${ok} / ${res.length}`);
process.exit(ok === res.length ? 0 : 1);
