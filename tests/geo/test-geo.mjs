// SPDX-License-Identifier: AGPL-3.0-only
// v2.28 conflict zones, watch regions and military bases in depth (geodetail.js): the geometry and grouping behind
// each page, run in Node on the atlas's own data and country outlines (no network).
//   node tests/geo/test-geo.mjs   → "SUMMARY n / n"
import { readFileSync } from 'node:fs';
import * as m from '../../site/app/js/geodetail.js';
const res = [];
const check = (name, ok, info = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rd = (p) => JSON.parse(readFileSync(new URL(`../../site/app/data/${p}`, import.meta.url)));
const wm = rd('worldmonitor-static.json'); const geo = rd('countries.geojson'); const feats = geo.features.filter((f) => f.geometry);
const cities = rd('cities.json').rows.map(([name, lat, lng, pop]) => ({ name, lat, lng, pop }));
const airports = rd('airports.json').rows.map(([iata, icao, name, lat, lng, , city, , large]) => ({ iata, icao, name, lat, lng, city, large: !!large }));
const idx = feats.map((f) => { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; let x0 = 180, x1 = -180, y0 = 90, y1 = -90; for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { f, polys, bb: [x0, x1, y0, y1] }; });
const countryAt = (lat, lng) => { for (const c of idx) { const [x0, x1, y0, y1] = c.bb; if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue; for (const p of c.polys) if (m.inRing(lat, lng, p[0]) && !p.slice(1).some((r) => m.inRing(lat, lng, r))) return c.f; } return null; };
const zone = (id) => wm.conflicts.find((z) => z.id === id);

// geometry
const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
check('a 1° square on the equator is about 12,364 km²', near(m.ringAreaKm2(sq), 12364, 30), m.ringAreaKm2(sq));
check('area does not depend on the ring’s direction', near(m.ringAreaKm2([...sq].reverse()), m.ringAreaKm2(sq), 1e-6));
const fr = feats.find((f) => f.properties.name === 'France'); const de = feats.find((f) => f.properties.name === 'Germany');
check('Germany from the atlas’s outlines is within 3 % of 357,000 km²', de && near(m.geomAreaKm2(de.geometry), 357000, 357000 * 0.03), de && m.geomAreaKm2(de.geometry));
check('France (with its overseas parts) is bigger than Germany', fr && m.geomAreaKm2(fr.geometry) > m.geomAreaKm2(de.geometry));
check('inside, outside and the distance to the edge', m.inRing(0.5, 0.5, sq) && !m.inRing(1.5, 0.5, sq) && m.ringDistKm(0.5, 0.5, sq) === 0 && near(m.ringDistKm(2, 0.5, sq), 111.2, 1));
const c = m.circleRegion(0, 0, 500);
check('a 500 km circle covers about 785,000 km²', near(c.areaKm2, Math.PI * 500 * 500, 5000), c.areaKm2);
const g = m.gridIn(m.polyRegion(sq), 0.25);
check('a 1° square holds 16 grid points at 0.25°', g.length === 16, g.length);

// the conflict zones
check('every conflict zone has a closed ring and a sensible area (500 to 3 million km²)', wm.conflicts.every((z) => { const a = m.ringAreaKm2(z.coords); return a > 500 && a < 3e6; }), wm.conflicts.map((z) => [z.id, Math.round(m.ringAreaKm2(z.coords))]));
const sd = m.polyRegion(zone('sudan').coords); const like = m.sizeLike(sd.areaKm2, feats);
check('Sudan’s theatre is compared with a real country and gets size words', like?.name && /about .*size of/.test(m.sizeWords(sd.areaKm2, like)), [sd.areaKm2, like?.name]);
check('size words: equal areas read “about the size of”, double reads “2 times”', m.sizeWords(100, { name: 'X', a: 100 }) === 'about the size of X' && m.sizeWords(200, { name: 'X', a: 100 }) === 'about 2 times the size of X');
const sdc = m.countryShares(sd, countryAt);
check('Sudan’s theatre is mostly in Sudan', sdc.rows[0]?.name === 'Sudan' && sdc.rows[0].share > 60, sdc.rows.slice(0, 3));
const ua = m.countryShares(m.polyRegion(zone('ukraine').coords), countryAt);
check('the Ukraine theatre covers Ukraine and Russia', ua.rows.some((r) => r.name === 'Ukraine') && ua.rows.some((r) => /Russia/.test(r.name)), ua.rows.slice(0, 4));
const shares = sdc.rows.reduce((s, r) => s + r.share, 0);
check('land shares add up to 100 %', near(shares, 100, 0.01), shares);
const rs = m.countryShares(m.polyRegion(zone('strait_hormuz').coords), countryAt);
check('the Hormuz crisis zone is partly sea', rs.seaShare > 20, rs.seaShare);
const st = m.stakes(sd, { wm, data: {}, cities, airports }, 100);
check('people inside Sudan’s theatre include Khartoum (a lower bound in the millions)', st.towns.some((t) => /Khartoum/.test(t.name)) && st.pop > 1e6, [st.towns.slice(0, 3), st.pop]);
const ir = m.stakes(m.polyRegion(zone('iran').coords), { wm, data: {}, cities, airports }, 100);
check('the Iran theatre: Bushehr nuclear plant, bases of more than one power, big airports', ir.nuclear.some((n) => /Bushehr/i.test(n.name)) && m.byPower(ir.bases).length >= 2 && ir.airports.length > 0, [ir.nuclear.map((n) => n.name), m.byPower(ir.bases).map((p) => p.name), ir.airports.length]);
const hz = m.stakes(m.polyRegion(zone('strait_hormuz').coords), { wm, data: {}, cities, airports }, 100);
check('the Hormuz crisis zone takes in the Strait of Hormuz chokepoint', hz.chokes.some((w) => /hormuz/i.test(w.name)), hz.chokes.map((w) => w.name));
const dmz = m.polyRegion(zone('korean_dmz').coords);
check('Seoul is not inside the drawn DMZ but is within 100 km of it', !dmz.has(37.57, 126.98) && dmz.dist(37.57, 126.98) <= 100, dmz.dist(37.57, 126.98));

// bases and powers
check('every base type has a power name and colour', wm.bases.every((b) => m.POWERS[b.type]), [...new Set(wm.bases.map((b) => b.type))].filter((t) => !m.POWERS[t]));
const dj = wm.bases.find((b) => b.id === 'camp_lemonnier');
const rivals = wm.bases.filter((b) => b.type !== dj.type && b.status !== 'closed').map((b) => ({ b, km: Math.hypot(b.lat - dj.lat, b.lon - dj.lon) * 111 })).filter((x) => x.km <= 1000);
const gp = m.byPower(rivals);
check('around Camp Lemonnier: China, France, Japan and Italy all have bases', ['China', 'France', 'Japan', 'Italy'].every((n) => gp.some((p) => p.name === n)), gp.map((p) => p.name));
check('the nearest Chinese base to Camp Lemonnier is within 20 km', gp.find((p) => p.name === 'China').near.km < 20, gp.find((p) => p.name === 'China').near);
check('host spellings are tidied', m.hostName('United Kingdoms') === 'United Kingdom' && m.hostName('Japan') === 'Japan');
const spot = wm.hotspots[0]; const sr = m.circleRegion(spot.lat, spot.lon, m.WATCH_KM);
check('a watch region’s 500 km circle finds cities and countries', m.stakes(sr, { wm, data: {}, cities, airports }, 0).towns.length > 0 && m.countryShares(sr, countryAt, 0.5).rows.length >= 2);

const ok = res.filter(Boolean).length;
console.log(`SUMMARY ${ok} / ${res.length}`);
process.exit(ok === res.length ? 0 : 1);
