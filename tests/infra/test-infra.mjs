// SPDX-License-Identifier: AGPL-3.0-only
// v2.26 chokepoints, pipelines, trade routes and AI data centres in depth (infradetail.js): the arithmetic behind each
// page, run in Node on the atlas's own data (no network).
//   node tests/infra/test-infra.mjs   → "SUMMARY n / n"
import { readFileSync } from 'node:fs';
import * as m from '../../site/app/js/infradetail.js';
const res = [];
const check = (name, ok, info = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const wm = JSON.parse(readFileSync(new URL('../../site/app/data/worldmonitor-static.json', import.meta.url)));
const eia = JSON.parse(readFileSync(new URL('../../site/app/data/open/waterways.json', import.meta.url))).rows;

// capacities and volumes in every form the data uses
const caps = wm.pipelines.map((p) => [p.capacity, m.parseCapacity(p.capacity)]);
check('every pipeline capacity on the map is understood', caps.every(([, c]) => c), caps.filter(([, c]) => !c).map(([s]) => s));
check('barrels a day, million barrels a day', m.parseCapacity('590,000 bpd').bpd === 590000 && m.parseCapacity('1.2 million bpd').bpd === 1.2e6);
check('gas: mcm/day and bcf/day become bcm a year', near(m.parseCapacity('33 mcm/day').bcmY, 12.045, 1e-9) && near(m.parseCapacity('3.2 bcf/day').bcmY, 33.07, 0.01) && m.parseCapacity('100+ bcm/year').plus);
check('1 million barrels a day is about 1.84 m³ a second', near(m.m3PerS({ kind: 'oil', bpd: 1e6 }), 1.840, 0.001));
check('31.5 bcm a year of gas is about 1,000 m³ a second', near(m.m3PerS({ kind: 'gas', bcmY: 31.5 }), 998.9, 0.5));
const vols = wm.tradeRoutes.map((r) => [r.volumeDesc, m.parseVolume(r.volumeDesc)]);
check('every trade route volume is understood', vols.every(([, v]) => v), vols.filter(([, v]) => !v).map(([s]) => s));
check('days at sea: 16 knots covers 711 km a day', near(m.daysAt(711.168, 16), 1, 1e-6));

// lines
const sumed = wm.pipelines.find((p) => p.id === 'sumed'); const pts = m.latLng(sumed.points);
check('lengths along a line add up (SUMED drawn about 300 km)', m.lineKm(pts) > 250 && m.lineKm(pts) < 400, m.lineKm(pts));
const smp = m.sampleLine([[0, 0], [0, 1]], 25);
check('a line is sampled every ~25 km, ends included', smp.length === 6 && smp[0][1] === 0 && smp.at(-1)[1] === 1, smp);
check('distance to a line: a point 1° north of the equator line is 111 km away', near(m.distToLine(1, 0.5, [[0, 0], [0, 1]]), 111.2, 0.5));

// chokepoints from both lists
const all = [...wm.waterways, ...eia];
check('every chokepoint in both lists has its record', all.every((w) => m.CHOKES[m.chokeKey(w)]), all.filter((w) => !m.CHOKES[m.chokeKey(w)]).map((w) => w.id));
check('the two lists agree on Hormuz, Malacca, the Bosporus and the Cape', ['hormuz_strait', 'malacca_strait', 'bosphorus', 'cape_of_good_hope'].map((id) => m.chokeKey({ id })).join() === 'hormuz,malacca,turkish_straits,good_hope');
check('stop names on the trade routes find their chokepoint', m.chokeKey('Bosporus Strait') === 'turkish_straits' && m.chokeKey('Bab el-Mandeb') === 'bab_el_mandeb' && m.chokeKey('Port of Rotterdam') === null);
const byp = wm.pipelines.filter((p) => m.bypassOf(p)).map((p) => [p.name, m.bypassOf(p)]);
check('pipelines that avoid a chokepoint: SUMED avoids Suez, Petroline Hormuz, BTC the Bosporus', byp.some(([n, k]) => /SUMED/.test(n) && k === 'suez') && byp.some(([n, k]) => /Petroline/.test(n) && k === 'hormuz') && byp.some(([n, k]) => /Baku/.test(n) && k === 'turkish_straits'), byp);
// ships through Hormuz: one each way, one crossing, one at anchor, one outside the circle
const ships = [
  { mmsi: 1, lat: 26.5, lng: 56.3, sog: 12, cog: 295, nav: 0, meta: { name: 'IN', shipType: 80 } },
  { mmsi: 2, lat: 26.6, lng: 56.2, sog: 11, cog: 125, nav: 0, meta: { name: 'OUT', shipType: 70 } },
  { mmsi: 3, lat: 26.7, lng: 56.1, sog: 9, cog: 30, nav: 0, meta: { name: 'ACROSS', shipType: 60 } },
  { mmsi: 4, lat: 26.4, lng: 56.4, sog: 0, cog: 0, nav: 1, meta: { name: 'ANCHOR', shipType: 80 } },
  { mmsi: 5, lat: 28.5, lng: 51, sog: 12, cog: 300, nav: 0, meta: { name: 'FAR', shipType: 80 } },
];
const t = m.shipsThrough(eia.find((w) => w.id === 'hormuz'), ships);
check('ships in Hormuz: split by heading, crossing and stopped, the far one left out', t.ways[0].map((x) => x.name).join() === 'IN' && t.ways[1].map((x) => x.name).join() === 'OUT' && t.across.length === 1 && t.still.length === 1 && t.kinds.tanker === 2, t);
check('with Live ships off there is nothing to count', m.shipsThrough(eia[0], undefined) === null);
check('widths in words', m.widthWords(33.8) === 'about as wide as the Strait of Dover' && m.widthWords(2.7) === '12 times narrower than the Strait of Dover' && m.widthWords(0.7).startsWith('700 m'));

// data centres
check('kW per accelerator by chip family; unknown chips taken as H100-class', m.kwPerChip('NVIDIA H100 SXM5 80GB') === 1.3 && m.kwPerChip('NVIDIA GB200') === 1.8 && m.kwPerChip('NVIDIA A100 SXM4 80 GB') === 0.8 && m.kwPerChip('Unknown') === 1.3 && m.kwPerChip('Google TPU v4') === 0.35);
const mw = m.sitePowerMW({ chipCount: 100000, chipType: 'NVIDIA H100 SXM5 80GB' });
check('100,000 H100s: 130 MW of IT power, 156–203 MW for the site', near(mw[0], 156, 1e-9) && near(mw[1], 202.8, 1e-9), mw);
check('156 MW all year is the electricity of about 126,600 US homes', near(m.homesFor(156), 126638, 5), m.homesFor(156));
check('no chip count, no estimate', m.sitePowerMW({ chipCount: null }) === null);
check('owners are split on commas', m.ownersOf({ owner: 'OpenAI,Microsoft' }).join('|') === 'OpenAI|Microsoft');
const dcs = wm.datacenters.filter((d) => d.chipCount > 0).map((d) => m.sitePowerMW(d)[0]);
check('every data centre with a chip count gets a positive estimate', dcs.length > 250 && dcs.every((x) => x > 0), dcs.length);

console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
