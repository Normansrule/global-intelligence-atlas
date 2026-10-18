// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: chemicals and environment. Detailed public records, boiled down monthly by
// tools/fetch-regional.mjs onto the `regional-data` branch:
//  • Pesticide use, California: the California Department of Pesticide Regulation's Pesticide Use Reporting (PUR),
//    every reported farm application by one-mile section, chemical, crop and method (aerial, i.e. crop dusting, or
//    ground). Pick one chemical or all of them, and aerial applications only.
//  • Pesticide use estimates, U.S. counties: the U.S. Geological Survey's county estimates for each compound.
//  • Toxic chemical releases: the U.S. Environmental Protection Agency's Toxics Release Inventory, by facility.
//  • CalEnviroScreen tracts, EPA ECHO violations, and pesticides measured in rivers, lakes and wells (Water Quality Portal).
// Each layer draws its markers as a few particle clouds (one draw call per colour) and adds clickable symbols for
// the biggest values near the centre of the view, like the fire layer.
import { getSnapshot } from './feeds.js';
import { fmtLat, fmtLng, haversineKm } from './astro.js';
import { parseKey, sectionLabel } from './plss.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const BRANCH = { branch: 'regional-data', ttl: 6 * 3600_000 };
const inView = (v, lat, lng) => Math.abs(lat - v.lat) * 111 < v.radiusKm && haversineKm(v.lat, v.lng, lat, lng) < v.radiusKm;
const num = (x, d = 0) => (x == null ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d }));
const lbsKg = (lbs) => `${num(lbs)} lb (${num(lbs * 0.4536)} kg)`;
const title = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const MONTHS = 'JFMAMJJASOND';

/** Particle clouds by value bands: [colour, size, lower bound]. */
function bands(rows, val, defs) {
  return defs.map(([color, size, lo], i) => ({ color, size, pts: rows.filter((r) => { const v = val(r); return v >= lo && (i === defs.length - 1 || v < defs[i + 1][2]); }).map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013 })) })).filter((g) => g.pts.length);
}
function nearPoints(d, v, val, make, n = 600) {
  if (v.altitude >= 1.2) return [];
  return d.rows.filter((r) => inView(v, r[0], r[1])).sort((a, b) => val(b) - val(a)).slice(0, n).map(make);
}
const monthBars = (months) => {
  const max = Math.max(1, ...months);
  return `<div class="mbars" aria-label="Pounds by month">${months.map((m, i) => `<span title="${'January February March April May June July August September October November December'.split(' ')[i]}: ${num(m)} lb"><i style="height:${Math.max(2, Math.round((m / max) * 100))}%"></i><b>${MONTHS[i]}</b></span>`).join('')}</div>`;
};

// ================================================================== California pesticide use (CDPR PUR)
const PUR_BANDS = [['#7ed6a0', 1.2, 0], ['#e3c45b', 1.5, 100], ['#ff8a4c', 1.9, 1000], ['#ff4e6a', 2.4, 10_000]];
const purColour = (lbs) => (lbs >= 10_000 ? '#ff4e6a' : lbs >= 1000 ? '#ff8a4c' : lbs >= 100 ? '#e3c45b' : '#7ed6a0');

export function pesticideUseLayer(api) {
  const rs = { chem: 'all', aerial: false };
  const val = (r) => (rs.aerial ? r[3] : r[2]);
  if (typeof document !== 'undefined') {
    document.addEventListener('change', (e) => {
      if (e.target.id === 'pur-chem') { rs.chem = e.target.value; api.refreshLayer('pur'); }
      if (e.target.id === 'pur-aerial') { rs.aerial = e.target.checked; api.refreshLayer('pur'); }
    });
  }
  return {
    id: 'pur', group: 'chem', label: 'Pesticide use, California (each square mile)', swatch: '#ff8a4c', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'spray',
    sources: ['cdprpur', 'plss', 'regionaldata'],
    async load() {
      const index = await getSnapshot('cdprpur', 'pur/index.json', BRANCH);
      const chem = rs.chem === 'all' ? null : index.chems.find((c) => c.code === rs.chem && c.file);
      if (!chem) rs.chem = 'all';
      const j = await getSnapshot('cdprpur', chem ? `pur/${chem.file}` : 'pur/sections.json', BRANCH);
      const rows = rs.aerial ? j.rows.filter((r) => r[3] > 0) : j.rows;
      const lbs = rows.reduce((a, r) => a + val(r), 0);
      return { index, chem, rows, lbs, statusNote: `${index.year}: ${rows.length.toLocaleString()} square-mile sections, ${num(lbs)} lb of ${chem ? title(chem.name) : 'all chemicals'}${rs.aerial ? ' applied from the air' : ''}` };
    },
    channels(d, ctx) {
      d._particles ??= bands(d.rows, val, PUR_BANDS);
      const name = (i) => title(d.index.chems[i]?.name);
      return {
        particles: d._particles,
        points: nearPoints(d, ctx.view, val, (r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.05 + Math.min(0.22, Math.log10(1 + val(r)) / 25), color: purColour(val(r)), tip: tip(`${num(val(r))} lb ${d.chem ? title(d.chem.name) : 'of pesticides'}${rs.aerial ? ' from the air' : ''}`, d.chem ? 'in this square mile' : `mostly ${name(r[5])}`), ref: { layer: 'pur', d: { r, chem: d.chem } }, label: '' })),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013, ref: { layer: 'pur', d: { r, chem: d.chem } } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    panel(d) {
      if (!d) return '';
      const opts = [['all', 'All chemicals'], ...d.index.chems.filter((c) => c.file).map((c) => [c.code, `${title(c.name)} · ${num(c.lbs / 1000)}k lb`])];
      const months = d.chem ? d.index.chems.find((c) => c.code === d.chem.code)?.months : d.index.chems.reduce((a, c) => a.map((x, i) => x + c.months[i]), Array(12).fill(0));
      return `<div class="chemctl"><select id="pur-chem" aria-label="Chemical">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === rs.chem ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="pur-aerial" ${rs.aerial ? 'checked' : ''}/> Aerial applications only (crop dusting)</label>
        ${months ? monthBars(months) : ''}<small>${esc(d.index.year)} · ${num(d.lbs)} lb in ${d.rows.length.toLocaleString()} sections · pounds of active ingredient</small></div>`;
    },
    describe({ r, chem }) {
      const key = chem ? null : parseKey(r[11]); const idx = api.state.data.pur?.index;
      const rows = [['Pounds', lbsKg(r[2])], ['From the air', `${lbsKg(r[3])}${r[2] ? ` (${Math.round((r[3] / r[2]) * 100)} %)` : ''}`], ['Applications reported', num(r[4])]];
      if (!chem && idx) {
        rows.push(['Most used', `${title(idx.chems[r[5]]?.name)} (${num(r[6])} lb)`]);
        if (r[7] != null) rows.push(['Also', [r[7], r[8]].filter((x) => x != null).map((i) => title(idx.chems[i]?.name)).join(', ')]);
        if (r[9] != null) rows.push(['Main crop or site', title(idx.sites[r[9]]?.name)]);
        if (r[10]) rows.push(['County', title(idx.counties?.[r[10]] ?? r[10])]);
      }
      if (key) rows.push(['Survey section', sectionLabel(key.meridian, key.township, key.tdir, key.range, key.rdir, key.section)]);
      rows.push(['Where (approximate)', `${fmtLat(r[0])}, ${fmtLng(r[1])}`]);
      return {
        title: chem ? `${title(chem.name)}: ${num(r[2])} lb` : `${num(r[2])} lb of pesticides`, sub: `One square mile in California, ${idx?.year ?? ''}`,
        rows,
        body: 'Every farm pesticide application in California must be reported: what product, how much, on which crop, in which one-mile survey section, and whether it was sprayed from an aircraft (crop dusting) or from the ground. Amounts are pounds of active ingredient. A large number means much use, not necessarily harm: the risk depends on the chemical, the dose, drift, weather and who is nearby. The section position is computed from the survey grid and can be off by a kilometre or two.',
        links: [{ label: 'CDPR Pesticide Use Reporting', url: 'https://www.cdpr.ca.gov/docs/pur/purmain.htm' }, { label: 'CalPIP: search the records', url: 'https://calpip.cdpr.ca.gov/main.cfm' }],
        probe: [r[0], r[1]],
      };
    },
    describeLayer: (d) => ({ rows: [['Year', d.index.year], ['Records', num(d.index.records)], ['Sections with use', num(d.index.sectionsWithUse)], ['All pounds reported', lbsKg(d.index.lbs)], ['From the air', lbsKg(d.index.aerialLbs)], ['Chemicals', num(d.index.chems.length)]] }),
    learn: {
      what: 'How much pesticide was used on farms in each square mile of California in the latest published year, from every application growers and applicators reported to the state. Pick one chemical (for example 1,3-dichloropropene, glyphosate or sulfur) or all of them, and tick “Aerial applications only” to see crop dusting by aircraft. Green is under 100 lb, yellow up to 1,000, orange up to 10,000 and red more.',
      how: 'Since 1990 California has required full reporting of agricultural pesticide use: each application lists the product, pounds, crop, acres, date, method and the Public Land Survey System section (a one-mile square). The California Department of Pesticide Regulation publishes the records about two years later. A monthly job downloads the yearly archive, adds up pounds of active ingredient by section and chemical, and places each section from its meridian, township, range and number. Non-farm uses (structural pest control, landscaping) are reported as county totals and are counted in the statewide totals but not on the map.',
      try: 'Choose 1,3-dichloropropene, a soil fumigant, and look at the San Joaquin Valley and the strawberry fields around Oxnard and Watsonville. Then switch to All chemicals with Aerial only and compare the rice fields of the Sacramento Valley.',
      refs: ['cdprpur', 'plss', 'regionaldata'],
    },
  };
}

// ================================================================== U.S. county pesticide estimates (USGS)
const US_BANDS = [['#7ed6a0', 1.6, 0], ['#e3c45b', 2.0, 1000], ['#ff8a4c', 2.5, 10_000], ['#ff4e6a', 3.0, 100_000]];
export function pesticideEstimatesLayer(api) {
  const rs = { compound: null };
  if (typeof document !== 'undefined') document.addEventListener('change', (e) => { if (e.target.id === 'usgs-compound') { rs.compound = e.target.value; api.refreshLayer('pestus'); } });
  return {
    id: 'pestus', group: 'chem', label: 'Pesticide estimates, U.S. counties (USGS)', swatch: '#e3c45b', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'spray',
    sources: ['usgsepest', 'bakerstone', 'censusgaz', 'regionaldata'],
    async load() {
      const [index, counties] = await Promise.all([getSnapshot('usgsepest', 'usgs/index.json', BRANCH), getSnapshot('usgsepest', 'usgs/counties.json', BRANCH)]);
      const c = index.compounds.find((x) => x.name === rs.compound && x.file) ?? index.compounds.find((x) => x.file);
      rs.compound = c.name;
      const j = await getSnapshot('usgsepest', `usgs/${c.file}`, BRANCH);
      const byId = (counties._byId ??= new Map(counties.rows.map((r) => [r[0], r])));
      return { index, compound: c, rows: j.rows, byId, statusNote: `${index.year}: ${title(c.name)} in ${j.rows.length.toLocaleString()} counties, ${num(c.kgHigh)} kg (high estimate)` };
    },
    channels(d, ctx) {
      d._particles ??= bands(d.rows, (r) => r[3], US_BANDS);
      return {
        particles: d._particles,
        points: nearPoints(d, ctx.view, (r) => r[3], (r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.08 + Math.min(0.3, Math.log10(1 + r[3]) / 18), color: purColour(r[3] / 4), tip: tip(`${num(r[3])} kg of ${title(d.compound.name)}`, d.byId.get(r[4])?.[1] ?? ''), ref: { layer: 'pestus', d: { r, compound: d.compound.name } }, label: '' }), 400),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013, ref: { layer: 'pestus', d: { r, compound: d.compound.name } } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    panel: (d) => (d ? `<div class="chemctl"><select id="usgs-compound" aria-label="Compound">${d.index.compounds.filter((c) => c.file).map((c) => `<option value="${esc(c.name)}" ${c.name === rs.compound ? 'selected' : ''}>${esc(title(c.name))} · ${num(c.kgHigh / 1000)} t</option>`).join('')}</select><small>${esc(d.index.year)} · kilograms of active ingredient on farms (high estimate)</small></div>` : ''),
    describe({ r, compound }) {
      const d = api.state.data.pestus; const c = d?.byId.get(r[4]);
      const rows = [['Estimate', `${num(r[2])}–${num(r[3])} kg`]];
      if (c?.[5]) rows.push(['Per square mile of land', `${num(r[3] / c[5], 1)} kg`]);
      if (c) rows.push(['All compounds', `${num(c[6])} kg`], ['Most used', `${title(c[7])} (${num(c[8])} kg)`], ['Also', [c[9], c[10]].filter(Boolean).map(title).join(', ')]);
      return {
        title: `${title(compound)}: ${num(r[3])} kg`, sub: c ? `${c[1]}, ${c[2]} · ${d?.index.year ?? ''}` : '',
        rows,
        body: 'The U.S. Geological Survey estimates how much of each pesticide farmers used in every county from surveys of farm operators and the crops grown there. The low and high estimates differ in how gaps in the surveys are filled. These are estimates for agriculture only, not measurements.',
        links: [{ label: 'USGS Pesticide National Synthesis Project', url: 'https://water.usgs.gov/nawqa/pnsp/usage/maps/' }],
        probe: [r[0], r[1]],
      };
    },
    describeLayer: (d) => ({ rows: [['Year', d.index.year], ['Compound', title(d.compound.name)], ['Counties', num(d.rows.length)], ['Total (high estimate)', `${num(d.compound.kgHigh)} kg`]] }),
    learn: {
      what: 'Estimated farm use of one pesticide in every county of the lower 48 states, at the county’s centre. Choose the compound under the layer; the biggest are herbicides such as glyphosate and atrazine. Green is under a tonne, yellow up to 10 t, orange up to 100 t and red more.',
      how: 'The USGS Pesticide National Synthesis Project combines proprietary surveys of farm pesticide use (by crop and crop-reporting district) with the harvested acres of each crop in each county from the Census of Agriculture. The result is two estimates per compound and county: EPest-low treats unsurveyed areas as no use, EPest-high fills them from neighbouring districts.',
      try: 'Pick atrazine and look at the Corn Belt from Iowa to Indiana, then compare with California’s Pesticide use layer, which shows real reported use by square mile.',
      refs: ['usgsepest', 'bakerstone', 'censusgaz', 'regionaldata'],
    },
  };
}

// ================================================================== industrial releases (EPA TRI)
const TRI_BANDS = [['#9fd4ff', 1.3, 0], ['#c8a2ff', 1.7, 10_000], ['#ff8a4c', 2.2, 100_000], ['#ff4e6a', 2.8, 1_000_000]];
const triColour = (lbs) => (lbs >= 1e6 ? '#ff4e6a' : lbs >= 1e5 ? '#ff8a4c' : lbs >= 1e4 ? '#c8a2ff' : '#9fd4ff');
export function toxicReleasesLayer() {
  return {
    id: 'tri', group: 'chem', label: 'Toxic chemical releases (EPA TRI)', swatch: '#c8a2ff', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'factory',
    sources: ['epatri', 'regionaldata'],
    async load() {
      const j = await getSnapshot('epatri', 'tri/facilities.json', BRANCH);
      return { ...j, statusNote: `${j.year}: ${j.rows.length.toLocaleString()} facilities, ${num(j.rows.reduce((a, r) => a + r[2], 0))} lb released` };
    },
    channels(d, ctx) {
      d._particles ??= bands(d.rows, (r) => r[2], TRI_BANDS);
      return {
        particles: d._particles,
        points: nearPoints(d, ctx.view, (r) => r[2], (r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.05 + Math.min(0.25, Math.log10(1 + r[2]) / 25), color: triColour(r[2]), tip: tip(r[4], `${num(r[2])} lb released · ${r[5]}, ${r[6]}`), ref: { layer: 'tri', d: r }, label: '' })),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013, ref: { layer: 'tri', d: r } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, lbs, carc, name, city, st, sector, , top] = r;
      return {
        title: name, sub: `${city}, ${st} · ${sector ?? ''}`,
        rows: [['Released in the year', lbsKg(lbs)], ['Of which known or suspected carcinogens', lbsKg(carc)], ...top.map(([c, l]) => [title(c), `${num(l, 1)} lb`]), ['Where', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: 'Facilities in listed industries report each year how much of about 800 toxic chemicals they released to air, water and land or sent for disposal. Releases are not the same as exposure: what matters is the chemical, where it goes and who lives nearby.',
        links: [{ label: 'EPA TRI Toxics Tracker', url: 'https://edap.epa.gov/public/extensions/TRIToxicsTracker/TRIToxicsTracker.html' }, { label: 'About the Toxics Release Inventory', url: 'https://www.epa.gov/toxics-release-inventory-tri-program' }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Year', d.year], ['Facilities', num(d.rows.length)], ['Released', lbsKg(d.rows.reduce((a, r) => a + r[2], 0))]] }),
    learn: {
      what: 'Every U.S. industrial facility that reported to the Toxics Release Inventory in the latest year, coloured by the pounds of listed toxic chemicals it released: blue under 10,000 lb, purple up to 100,000, orange up to a million and red more. Click one for its top chemicals and how much were known or suspected carcinogens.',
      how: 'Under the Emergency Planning and Community Right-to-Know Act of 1986, facilities in listed industries with ten or more employees that make, process or use a listed chemical above a threshold must report their releases every July. The EPA publishes the forms as yearly data files; a monthly job reads the newest one and adds up each facility’s chemicals.',
      try: 'Look along the Gulf Coast between Houston and New Orleans, then at the mines of Nevada and Alaska, which report very large land releases of waste rock metals.',
      refs: ['epatri', 'regionaldata'],
    },
  };
}

// ================================================================== CalEnviroScreen 4.0 (OEHHA), California census tracts
const CES_BANDS = [['#7ed6a0', 1.6, 0], ['#e3c45b', 1.8, 25], ['#ff8a4c', 2.1, 50], ['#ff4e6a', 2.4, 75], ['#d0207a', 2.8, 90]];
const pctColour = (p) => (p >= 90 ? '#d0207a' : p >= 75 ? '#ff4e6a' : p >= 50 ? '#ff8a4c' : p >= 25 ? '#e3c45b' : '#7ed6a0');
const ordinal = (x) => { const n = Math.min(99, Math.floor(x)); return `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`; };
export function calEnviroScreenLayer(api) {
  const rs = { ind: 'score' };
  if (typeof document !== 'undefined') document.addEventListener('change', (e) => { if (e.target.id === 'ces-ind') { rs.ind = e.target.value; api.refreshLayer('ces', { soft: true }); } });
  const sel = (d) => Math.max(0, d.indicators.findIndex((x) => x.key === rs.ind));
  return {
    id: 'ces', group: 'chem', label: 'Pollution burden, California tracts (CalEnviroScreen)', swatch: '#ff4e6a', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'alert',
    sources: ['calenviroscreen', 'regionaldata'],
    async load() {
      const j = await getSnapshot('calenviroscreen', 'ces/tracts.json', BRANCH);
      return { ...j, statusNote: `CalEnviroScreen ${j.version}: ${j.rows.length.toLocaleString()} census tracts` };
    },
    channels(d, ctx) {
      const i = sel(d); const pc = (r) => r[8][i];
      if (d._for !== i) { d._for = i; const rows = d.rows.filter((r) => pc(r) != null); d._xy = { rows: rows.map((r) => [r[1], r[2], r]) }; d._particles = bands(d._xy.rows, (x) => pc(x[2]), CES_BANDS); d._pick = rows.map((r) => ({ lat: r[1], lng: r[2], alt: 0.0013, ref: { layer: 'ces', d: r } })); }
      const label = d.indicators[i].label;
      return {
        particles: d._particles,
        points: nearPoints(d._xy, ctx.view, (x) => pc(x[2]), ([lat, lng, r]) => ({ lat, lng, alt: 0.003, r: 0.06 + pc(r) / 900, color: pctColour(pc(r)), tip: tip(`${label}: ${ordinal(pc(r))} percentile`, `${r[6] ?? r[4] ?? ''} · tract ${r[0]}`), ref: { layer: 'ces', d: r }, label: '' }), 500),
        pick: d._pick,
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    panel: (d) => (d ? `<div class="chemctl"><select id="ces-ind" aria-label="Indicator">${d.indicators.map((x) => `<option value="${esc(x.key)}" ${x.key === rs.ind ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select><small>Percentile among California’s ${d.rows.length.toLocaleString()} census tracts: red is the most burdened tenth</small></div>` : ''),
    describe(r) {
      const d = api.state.data.ces; const ind = d?.indicators ?? [];
      const rows = [['Census tract', r[0]], ['Population', num(r[3])], ['County', r[4] ?? '—']];
      ind.forEach((x, i) => { if (r[8][i] != null) rows.push([x.label, `${ordinal(r[8][i])} percentile${r[7][i] != null && x.key !== 'score' ? ` (${num(r[7][i], 2)})` : ''}`]); });
      return {
        title: `${r[6] ?? r[4] ?? 'California'}: ${ordinal(r[8][0] ?? 0)} percentile overall`, sub: `Census tract ${r[0]} · CalEnviroScreen ${d?.version ?? ''}`,
        rows,
        body: 'CalEnviroScreen ranks every California census tract by its pollution burden (air, water, pesticides, toxic sites) and by how vulnerable its people are (health and income). A percentile of 90 means the tract is more burdened than 90 % of tracts in the state. The pesticide indicator is the pounds of selected hazardous, drift-prone pesticides applied nearby, from the same state use reports as the Pesticide use layer.',
        links: [{ label: 'CalEnviroScreen 4.0 (OEHHA)', url: 'https://oehha.ca.gov/calenviroscreen/report/calenviroscreen-40' }],
        probe: [r[1], r[2]],
      };
    },
    describeLayer: (d) => ({ rows: [['Version', d.version], ['Census tracts', num(d.rows.length)], ['Indicators', num(d.indicators.length)]] }),
    learn: {
      what: 'Every California census tract (a neighbourhood of about 4,000 people) coloured by its percentile on the chosen CalEnviroScreen indicator: the overall score, pesticide use nearby, fine particles, diesel, drinking water, traffic, cleanup sites, asthma, poverty and more. Red and magenta are the most burdened quarter and tenth of the state.',
      how: 'The California Office of Environmental Health Hazard Assessment (OEHHA) combines 21 indicators from state and federal data. Pollution burden (exposures and environmental effects) is multiplied by population characteristics (sensitive groups and socioeconomic factors), and every tract is ranked against the others. The state uses the result to direct clean-up and investment to the most affected communities.',
      try: 'Pick Pesticide use nearby and compare it with the Pesticide use layer around the San Joaquin Valley, then pick Diesel particulate matter and follow the freeways and ports of Los Angeles and Oakland.',
      refs: ['calenviroscreen', 'regionaldata'],
    },
  };
}

// ================================================================== EPA ECHO: inspections, violations and penalties
const echoColour = (r) => (r[2] ? '#ff4e6a' : r[5] >= 100_000 ? '#ff8a4c' : r[4] ? '#e3c45b' : '#9fd4ff');
const usd = (n) => `$${num(n)}`;
export function enforcementLayer() {
  return {
    id: 'echo', group: 'chem', label: 'Environmental violations (EPA ECHO)', swatch: '#ff4e6a', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'badge',
    sources: ['epaecho', 'regionaldata'],
    async load() {
      const j = await getSnapshot('epaecho', 'echo/facilities.json', BRANCH);
      const snc = j.rows.filter((r) => r[2]).length;
      return { ...j, snc, statusNote: `${j.rows.length.toLocaleString()} facilities with a violation, enforcement action or penalty; ${snc.toLocaleString()} in significant non-compliance` };
    },
    channels(d, ctx) {
      d._particles ??= [['#9fd4ff', 1.2, (r) => !r[2] && !r[4] && r[5] < 100_000], ['#e3c45b', 1.5, (r) => !r[2] && r[4] && r[5] < 100_000], ['#ff8a4c', 1.9, (r) => !r[2] && r[5] >= 100_000], ['#ff4e6a', 2.2, (r) => r[2]]]
        .map(([color, size, test]) => ({ color, size, pts: d.rows.filter(test).map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013 })) })).filter((g) => g.pts.length);
      const score = (r) => r[2] * 1e9 + r[5] + r[3] * 1000;
      return {
        particles: d._particles,
        points: nearPoints(d, ctx.view, score, (r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.05 + (r[2] ? 0.12 : 0) + Math.min(0.12, Math.log10(1 + r[5]) / 60), color: echoColour(r), tip: tip(r[8], `${r[2] ? 'significant non-compliance · ' : ''}${r[3]} quarters in violation${r[5] ? ` · ${usd(r[5])} penalties` : ''}`), ref: { layer: 'echo', d: r }, label: '' })),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013, ref: { layer: 'echo', d: r } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, snc, qnc, formal, pen, insp, last, name, city, st, id, progs, status, sncProg] = r;
      return {
        title: name, sub: `${city ?? ''}, ${st ?? ''}${progs ? ` · ${progs}` : ''}`,
        rows: [['Status', `${status ?? '—'}${snc ? ' (significant non-compliance)' : ''}`], ...(sncProg ? [['Programs in significant non-compliance', sncProg]] : []), ['Quarters in violation (last 3 years)', num(qnc)], ['Formal enforcement actions (5 years)', num(formal)], ['Penalties (5 years)', usd(pen)], ['Inspections (5 years)', num(insp)], ['Last inspection', last ?? '—'], ['Where', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: 'The EPA and the states inspect facilities that hold permits under the Clean Air Act, the Clean Water Act, the hazardous waste law (RCRA) and the Safe Drinking Water Act. ECHO, the Enforcement and Compliance History Online, publishes what they found. Significant non-compliance is the most serious class of violation; a violation is a finding about permits and reporting as well as emissions, and an open case may still be disputed.',
        links: [{ label: 'ECHO detailed facility report', url: `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(id)}` }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Facilities shown', num(d.rows.length)], ['Significant non-compliance', num(d.snc)], ['All regulated facilities read', num(d.total)], ['Penalties shown', usd(d.rows.reduce((a, r) => a + r[5], 0))]] }),
    learn: {
      what: 'U.S. facilities that the EPA or a state found in violation of an environmental permit in the last three years, took formal enforcement action against or fined in the last five. Red is significant non-compliance, orange penalties of $100,000 or more, yellow other formal actions and blue other violations. Click one for its inspections, penalties and a link to the full EPA report.',
      how: 'ECHO (Enforcement and Compliance History Online) joins the EPA’s permit and enforcement databases for about 1.5 million regulated places into one weekly file, ECHO Exporter. A monthly job reads it and keeps only facilities with a violation, an action or a penalty, which leaves the ones worth looking at.',
      try: 'Turn on Toxic chemical releases as well and look for places that both release a lot and are in significant non-compliance, then compare the drinking-water systems of small towns with those of cities.',
      refs: ['epaecho', 'regionaldata'],
    },
  };
}

// ================================================================== Water Quality Portal: pesticides measured in water
const WQP_COLOURS = ['#8a96a8', '#e3c45b', '#ff8a4c', '#ff4e6a'];
const WQP_SIZES = [1.0, 1.4, 1.8, 2.3];
const KINDS = { well: 'Well or spring', stream: 'River or stream', lake: 'Lake or reservoir', other: 'Other water' };
const ug = (x) => (x == null ? '—' : x >= 1 ? `${num(x, 2)} µg/L` : `${num(x * 1000, 1)} ng/L`);
export function waterQualityLayer(api) {
  const rs = { chem: '', kind: '', det: false };
  if (typeof document !== 'undefined') document.addEventListener('change', (e) => {
    const k = { 'wqp-chem': 'chem', 'wqp-kind': 'kind', 'wqp-det': 'det' }[e.target.id]; if (!k) return;
    rs[k] = k === 'det' ? e.target.checked : e.target.value; api.refreshLayer('wqp', { soft: true });
  });
  /** What a site shows for the current choice: [samples, detections, max µg/L, ratio to the EPA limit]. */
  const view = (d, r) => {
    if (!rs.chem) return [r[6], r[7], Math.max(0, ...r[10].map((c) => c[1])), r[9]];
    const c = r[10].find((x) => x[0] === rs.chem); if (!c) return null;
    const mcl = d.mcl[rs.chem]; return [c[3], c[2], c[1], mcl ? c[1] / mcl : 0];
  };
  const level = ([, det, max, ratio]) => (ratio >= 1 ? 3 : max >= 1 ? 2 : det ? 1 : 0);
  return {
    id: 'wqp', group: 'chem', label: 'Pesticides in rivers and wells (Water Quality Portal)', swatch: '#4fb3d9', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'water',
    sources: ['wqp', 'epamcl', 'regionaldata'],
    async load() {
      const j = await getSnapshot('wqp', 'wqp/sites.json', BRANCH);
      const mcl = Object.fromEntries(j.chems.map((c) => [c.name, c.mcl]));
      const over = j.rows.filter((r) => r[9] >= 1).length;
      return { ...j, mcl, over, statusNote: `${j.rows.length.toLocaleString()} sampling sites, ${j.rows.filter((r) => r[7]).length.toLocaleString()} with a pesticide detected, ${over.toLocaleString()} above an EPA drinking-water limit (last ${j.years} years)` };
    },
    channels(d, ctx) {
      const key = `${rs.chem}|${rs.kind}|${rs.det}`;
      if (d._for !== key) {
        d._for = key;
        const rows = []; for (const r of d.rows) { if (rs.kind && r[2] !== rs.kind) continue; const v = view(d, r); if (!v || (rs.det && !v[1])) continue; rows.push({ r, v, lv: level(v) }); }
        d._xy = { rows: rows.map((x) => [x.r[0], x.r[1], x]) };
        d._particles = WQP_COLOURS.map((color, i) => ({ color, size: WQP_SIZES[i], pts: rows.filter((x) => x.lv === i).map((x) => ({ lat: x.r[0], lng: x.r[1], alt: 0.0013 })) })).filter((g) => g.pts.length);
        d._pick = rows.map((x) => ({ lat: x.r[0], lng: x.r[1], alt: 0.0013, ref: { layer: 'wqp', d: x.r } }));
        d._shown = rows.length;
      }
      const score = (x) => x[2].lv * 1e6 + x[2].v[3] * 1e3 + x[2].v[1];
      return {
        particles: d._particles,
        points: nearPoints(d._xy, ctx.view, score, ([lat, lng, x]) => ({ lat, lng, alt: 0.003, r: 0.05 + x.lv * 0.04, color: WQP_COLOURS[x.lv], tip: tip(x.r[3], `${KINDS[x.r[2]]} · ${x.v[1] ? `detected in ${num(x.v[1])} of ${num(x.v[0])} samples, up to ${ug(x.v[2])}` : `not detected in ${num(x.v[0])} samples`}${x.v[3] >= 1 ? ' · above the EPA limit' : ''}`), ref: { layer: 'wqp', d: x.r }, label: '' })),
        pick: d._pick,
      };
    },
    count: (d) => (d._shown ?? d.rows.length).toLocaleString(),
    panel: (d) => (d ? `<div class="chemctl"><select id="wqp-chem" aria-label="Pesticide"><option value="">All pesticides</option>${d.chems.filter((c) => c.sites).map((c) => `<option value="${esc(c.name)}" ${c.name === rs.chem ? 'selected' : ''}>${esc(c.name)} (found at ${num(c.detectedAt)} of ${num(c.sites)} sites)</option>`).join('')}</select>`
      + `<select id="wqp-kind" aria-label="Kind of water"><option value="">All water</option>${['well', 'stream', 'lake'].map((k) => `<option value="${k}" ${k === rs.kind ? 'selected' : ''}>${KINDS[k]}s</option>`).join('')}</select>`
      + `<label class="chk"><input type="checkbox" id="wqp-det" ${rs.det ? 'checked' : ''}> Detections only</label><small>Grey: sampled, not found · yellow: found · orange: 1 µg/L or more · red: above an EPA drinking-water limit</small></div>` : ''),
    describe(r) {
      const d = api.state.data.wqp; const mcl = d?.mcl ?? {};
      const [lat, lng, kind, name, id, org, samples, det, nDet, ratio, chems] = r;
      const table = `<table class="wqp-t"><thead><tr><th>Pesticide</th><th>Highest</th><th>Found in</th><th>Last sampled</th><th>EPA limit</th></tr></thead><tbody>${chems.map(([c, max, dn, sn, last]) => `<tr${mcl[c] && max >= mcl[c] ? ' class="over"' : ''}><td>${esc(c)}</td><td>${dn ? ug(max) : 'not found'}</td><td>${num(dn)} of ${num(sn)}</td><td>${esc(last || '—')}</td><td>${mcl[c] ? `${num(mcl[c])} µg/L${dn ? ` (${num((max / mcl[c]) * 100)} %)` : ''}` : 'none'}</td></tr>`).join('')}</tbody></table>`;
      return {
        title: name, sub: `${KINDS[kind]} · ${org || 'Water Quality Portal'}`,
        rows: [['Site', id], [`Samples (last ${d?.years ?? 3} years)`, num(samples)], ['Detections', `${num(det)}, ${num(nDet)} pesticide${nDet === 1 ? '' : 's'}`], ['Highest share of an EPA limit', ratio ? `${num(ratio * 100)} %` : '—'], ['Where', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        html: table,
        body: 'Measured concentrations from water samples taken by the U.S. Geological Survey, the EPA, states and tribes. A detection in a river or a monitoring well is not the same as what comes out of a tap: drinking water is treated and the EPA limits (maximum contaminant levels) apply to the water a public system delivers, averaged over a year. Many pesticides have no federal limit at all.',
        links: [{ label: 'Download every result for this site (Water Quality Portal)', url: `https://www.waterqualitydata.us/data/Result/search?siteid=${encodeURIComponent(id)}&mimeType=csv&zip=no` }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Sites', num(d.rows.length)], ['Sites with a detection', num(d.rows.filter((r) => r[7]).length)], ['Sites above an EPA limit', num(d.over)], ['Years', num(d.years)], ['Pesticides looked for', num(d.chems.length)]] }),
    learn: {
      what: 'Rivers, lakes and wells across the United States where pesticides were measured in the water in the last three years: atrazine, simazine, metolachlor, glyphosate, 2,4-D, chlorpyrifos, imidacloprid and others. Grey sites were sampled without a detection, yellow found a pesticide, orange found 1 µg/L (one part per billion) or more, red was above an EPA drinking-water limit. Click a site for every chemical, its highest value, how often it was found and a link to the raw results.',
      how: 'The Water Quality Portal, run by the U.S. Geological Survey, the EPA and the National Water Quality Monitoring Council, gathers sample results from more than 400 agencies in one format (WQX). A monthly job asks it for each state, keeps results measured in water, converts every value to micrograms per litre and records, for each site and pesticide, the samples, the detections and the highest value. EPA limits are the maximum contaminant levels of the Safe Drinking Water Act.',
      try: 'Pick Atrazine in late spring around the Corn Belt and follow the streams that drain Iowa, Illinois and Indiana, then pick Wells only in California’s Central Valley and compare with the Pesticide use layer.',
      refs: ['wqp', 'epamcl', 'regionaldata'],
    },
  };
}
