// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: economy, property and industry. Openly licensed statistics boiled down monthly by
// tools/fetch-economy.mjs onto the `economy-data` branch:
//  • House prices by area: U.S. Federal Housing Finance Agency (FHFA) House Price Index by state and metropolitan
//    area, HM Land Registry UK House Price Index by local authority, Eurostat and Organisation for Economic
//    Co-operation and Development (OECD) house price indices by country. Coloured by the 1-year (or 5-year) change.
//  • Home values, U.S. counties: median value and rent from the American Community Survey (ACS).
//  • Property sales, England and Wales: how many homes sold in each postcode district in the last 12 months, and the
//    median price (HM Land Registry Price Paid Data; no addresses).
//  • What each country sells: top exports by product (CEPII BACI).
//  • Heavy industry: steelworks, cement and aluminium plants, chemical works, paper mills and refineries with their
//    estimated emissions (Climate TRACE).
//  • Factories mapped in OpenStreetMap (man_made=works), loaded from Overpass for the area in view.
// Big layers draw as particle clouds (one draw call per colour) with clickable symbols near the centre of the view;
// every row stays clickable at any zoom through the pick index.
import { getSnapshot, getFeed } from './feeds.js';
import { fmtLat, fmtLng, haversineKm } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const BRANCH = { branch: 'economy-data', ttl: 6 * 3600_000 };
const inView = (v, lat, lng) => Math.abs(lat - v.lat) * 111 < v.radiusKm && haversineKm(v.lat, v.lng, lat, lng) < v.radiusKm;
const num = (x, d = 0) => (x == null ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d }));
const signed = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x, 1)} %`);
const money = (x, cur) => (x == null ? '—' : `${cur === 'GBP' ? '£' : '$'}${num(x)}`);
/** 4,200,000,000 → "$4.2 billion". */
export const bigUsd = (x) => (x == null ? '—' : x >= 1e12 ? `$${num(x / 1e12, 2)} trillion` : x >= 1e9 ? `$${num(x / 1e9, 1)} billion` : x >= 1e6 ? `$${num(x / 1e6, 1)} million` : `$${num(x)}`);
const tonnes = (t) => (t == null ? '—' : t >= 1e6 ? `${num(t / 1e6, 2)} million t` : `${num(t)} t`);
const sentence = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '');
const COUNTRY_NAMES = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/** Colour for a yearly price change in per cent: blue falling, grey flat, yellow to red rising. */
export function changeColour(p) {
  if (p == null) return '#8a96a3';
  if (p <= -5) return '#3d7bd9'; if (p <= -1) return '#7fb0f0'; if (p < 1) return '#c7d0d9';
  if (p < 4) return '#f2d16b'; if (p < 8) return '#ff9b4c'; return '#ff4e6a';
}
export const CHANGE_LEGEND = [['#3d7bd9', 'Falling 5 % or more'], ['#7fb0f0', 'Falling 1–5 %'], ['#c7d0d9', 'About flat'], ['#f2d16b', 'Rising 1–4 %'], ['#ff9b4c', 'Rising 4–8 %'], ['#ff4e6a', 'Rising 8 % or more']];
/** Particle clouds by value bands: [colour, size, lower bound]; rows are [lat, lng, …]. */
function bands(rows, val, defs) {
  return defs.map(([color, size, lo], i) => ({ color, size, pts: rows.filter((r) => { const v = val(r); return v != null && v >= lo && (i === defs.length - 1 || v < defs[i + 1][2]); }).map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013 })) })).filter((g) => g.pts.length);
}
const nearRows = (rows, v, val, n) => (v.altitude >= 1.2 ? [] : rows.filter((r) => inView(v, r[0], r[1])).sort((a, b) => (val(b) ?? 0) - (val(a) ?? 0)).slice(0, n));
const pickAll = (d, layer, wrap = (r) => r) => (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013, ref: { layer, d: wrap(r) } })));

// ================================================================== house prices by area
const HP_FILES = [['fhfa', 'houseprices/fhfa.json', 'fhfahpi'], ['ukhpi', 'houseprices/ukhpi.json', 'ukhpi'], ['eurostat', 'houseprices/eurostat.json', 'eurostathpi'], ['oecd', 'houseprices/oecd.json', 'oecdhpi']];
const HP_LINKS = {
  fhfa: { label: 'FHFA House Price Index', url: 'https://www.fhfa.gov/data/hpi' },
  ukhpi: { label: 'UK House Price Index', url: 'https://landregistry.data.gov.uk/app/ukhpi' },
  eurostat: { label: 'Eurostat house price index (prc_hpi_q)', url: 'https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table' },
  oecd: { label: 'OECD house prices', url: 'https://www.oecd.org/en/data/indicators/housing-prices.html' },
};
const HP_SIZE = { country: 0.55, state: 0.38, metro: 0.18, 'local authority': 0.16 };
export function housePricesLayer() {
  return {
    id: 'houseprices', group: 'econ', label: 'House prices: yearly change by area', swatch: '#ff9b4c', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'house',
    legend: CHANGE_LEGEND.map(([c, l]) => ['house', l, c]),
    sources: ['fhfahpi', 'censusgaz', 'ukhpi', 'codepointopen', 'eurostathpi', 'oecdhpi', 'economydata'],
    options: [{ id: 'span', label: 'Change over', choices: [['1', 'One year'], ['5', 'Five years']], value: '1' }, { id: 'scale', label: 'Areas', multi: true, choices: [['country', 'Countries'], ['state', 'U.S. states'], ['metro', 'U.S. metropolitan areas'], ['local authority', 'UK local authorities']], value: ['country', 'state', 'metro', 'local authority'] }],
    async load(o) {
      const got = await Promise.allSettled(HP_FILES.map(([, f, src]) => getSnapshot(src, f, BRANCH)));
      const files = {}; HP_FILES.forEach(([k], i) => { if (got[i].status === 'fulfilled') files[k] = got[i].value; });
      if (!Object.keys(files).length) throw got[0].reason ?? new Error('no house price files on the economy-data branch yet');
      const eu = new Set((files.eurostat?.rows ?? []).map((r) => r[7]));
      const rows = [];
      for (const [k, j] of Object.entries(files)) {
        for (const r of j.rows) {
          if (!o.scale.includes(r[6])) continue;
          if (k === 'oecd' && eu.has(COUNTRY_ISO2[r[7]])) continue; // Eurostat wins for European countries
          rows.push({ r, k, unit: j.unit, valueLabel: j.valueLabel });
        }
      }
      const ch = (x) => (o.span === '5' ? x.r[4] : x.r[2]);
      return { rows, files, span: o.span, ch, statusNote: `${rows.length.toLocaleString()} areas · ${Object.entries(files).map(([k, j]) => `${k} ${j.period}`).join(' · ')}` };
    },
    channels(d, ctx) {
      const v = ctx.view; const fine = v.altitude < 1.3;
      const list = d.rows.filter((x) => fine || x.r[6] === 'country' || x.r[6] === 'state');
      return {
        points: list.map((x) => ({ lat: x.r[0], lng: x.r[1], alt: 0.004, r: HP_SIZE[x.r[6]] ?? 0.2, color: changeColour(d.span === '5' ? (x.r[4] == null ? null : x.r[4] / 3) : x.r[2]), label: x.r[6] === 'country' || v.altitude < 0.6 ? x.r[5] : '', tip: tip(x.r[5], `${signed(d.ch(x))} in ${d.span === '5' ? 'five years' : 'a year'} · ${x.unit === 'GBP' ? `average ${money(x.r[3], 'GBP')}` : `index ${num(x.r[3], 1)}`}`), ref: { layer: 'houseprices', d: x } })),
        pick: (d._pick ??= d.rows.map((x) => ({ lat: x.r[0], lng: x.r[1], alt: 0.004, ref: { layer: 'houseprices', d: x } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(x) {
      const [lat, lng, ch1, value, ch5, name, level, code, period, extra] = x.r;
      const rows = [[x.unit === 'GBP' ? 'Average price' : x.valueLabel, x.unit === 'GBP' ? money(value, 'GBP') : num(value, 1)], ['Change in one year', signed(ch1)], ['Change in five years', signed(ch5)], ['Latest period', period]];
      if (extra?.types) ['Detached', 'Semi-detached', 'Terraced', 'Flat or maisonette'].forEach((t, i) => { if (extra.types[i]) rows.push([`${t} (average)`, money(extra.types[i], 'GBP')]); });
      if (extra?.sales12) rows.push([`Sales in the 12 months to ${extra.salesTo}`, num(extra.sales12)]);
      if (extra?.real1y != null) rows.push(['Change after inflation (real)', signed(extra.real1y)]);
      rows.push(['Code', code], ['Where (centre of the area)', `${fmtLat(lat)}, ${fmtLng(lng)}`]);
      return {
        title: name, sub: `${sentence(level)} · ${{ fhfa: 'FHFA House Price Index', ukhpi: 'UK House Price Index', eurostat: 'Eurostat', oecd: 'OECD' }[x.k]}`,
        rows,
        body: x.unit === 'GBP'
          ? 'The UK House Price Index estimates the average price of a home in each local authority from every sale registered with HM Land Registry (and Registers of Scotland and Land and Property Services in Northern Ireland), adjusted for the mix of homes sold. The latest months are revised as late sales are registered.'
          : 'A house price index follows the price of comparable homes over time; its level only means something compared with the same place in another period (the base period is 100). The yearly change is the percentage rise or fall over the last four quarters, before inflation unless the card says otherwise.',
        links: [HP_LINKS[x.k]], probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: Object.entries(d.files).map(([k, j]) => [HP_LINKS[k].label, `${num(j.rows.length)} areas · ${j.period}`]) }),
    learn: {
      what: 'How fast home prices are rising or falling: U.S. states and metropolitan areas (Federal Housing Finance Agency), local authorities across the United Kingdom (HM Land Registry), European countries (Eurostat) and other countries the Organisation for Economic Co-operation and Development (OECD) follows. Blue is falling, grey about flat, yellow to red rising. Click an area for the price or index level and the one- and five-year change.',
      how: 'Each statistics office builds its index from registered sales (or, for the FHFA, mortgage records including appraisals) and compares like with like: the same homes sold twice, or sales weighted by type and location. A monthly job downloads the newest release of each and keeps the latest period with its change over one and five years. U.S. metropolitan areas sit at their Census centre, British local authorities at the average position of their postcodes, countries at the middle of their land.',
      try: 'Switch “Change over” to five years and compare the U.S. Mountain West with the Midwest, then London boroughs with the north of England.',
      refs: ['fhfahpi', 'ukhpi', 'eurostathpi', 'oecdhpi', 'codepointopen', 'economydata'],
    },
  };
}
/** ISO 3166 alpha-3 → alpha-2 for the OECD countries that Eurostat may also cover (to avoid two dots in one place). */
const COUNTRY_ISO2 = { AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR', DEU: 'DE', GRC: 'GR', HUN: 'HU', ISL: 'IS', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL', NOR: 'NO', POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE', CHE: 'CH', TUR: 'TR', GBR: 'GB' };

// ================================================================== U.S. county home values (ACS)
const VAL_BANDS = [['#7fb0f0', 1.5, 0], ['#9fe0c0', 1.7, 150_000], ['#f2d16b', 1.9, 250_000], ['#ff9b4c', 2.2, 400_000], ['#ff4e6a', 2.6, 700_000]];
const valColour = (v) => { for (let i = VAL_BANDS.length - 1; i >= 0; i--) if ((v ?? 0) >= VAL_BANDS[i][2]) return VAL_BANDS[i][0]; return VAL_BANDS[0][0]; };
export function homeValuesLayer(api) {
  return {
    id: 'homevalues', group: 'econ', label: 'Home values and rents, U.S. counties', swatch: '#f2d16b', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'house',
    legend: [['house', 'Under $150,000', VAL_BANDS[0][0]], ['house', '$150,000–250,000', VAL_BANDS[1][0]], ['house', '$250,000–400,000', VAL_BANDS[2][0]], ['house', '$400,000–700,000', VAL_BANDS[3][0]], ['house', '$700,000 or more', VAL_BANDS[4][0]]],
    sources: ['censusacs', 'censusgaz', 'economydata'],
    async load() {
      const j = await getSnapshot('censusacs', 'acs/counties.json', BRANCH);
      return { ...j, statusNote: `${j.year} 5-year estimates: ${j.rows.length.toLocaleString()} counties` };
    },
    channels(d, ctx) {
      d._particles ??= bands(d.rows, (r) => r[2], VAL_BANDS);
      return {
        particles: d._particles,
        points: nearRows(d.rows, ctx.view, (r) => r[2], 600).map((r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.09, color: valColour(r[2]), tip: tip(r[5], `median home ${money(r[2])} · rent ${money(r[4])} a month`), ref: { layer: 'homevalues', d: r }, label: '' })),
        pick: pickAll(d, 'homevalues'),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const d0 = api?.state?.data?.homevalues; const [lat, lng, value, vch, rent, name, , geoid, rch] = r;
      return {
        title: name, sub: 'U.S. county · American Community Survey 5-year estimate',
        rows: [['Median value of owner-occupied homes', money(value)], ['Change since the earlier 5-year estimate', signed(vch)], ['Median gross rent (a month)', money(rent)], ['Rent change', signed(rch)], ['County code (FIPS)', geoid], ['Where (county centre)', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: `The American Community Survey asks about 3.5 million households a year what their home is worth and what they pay in rent. Five years of answers are pooled so that every county has an estimate; the change compares with the five years before${d0?.compareYear ? ` (ending ${d0.compareYear})` : ''}, which do not overlap. Owners’ own valuations run a little above sale prices, and the survey has a margin of error, larger in small counties.`,
        links: [{ label: 'Census data: this county', url: `https://data.census.gov/profile?g=050XX00US${geoid}` }, { label: 'American Community Survey', url: 'https://www.census.gov/programs-surveys/acs' }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Survey years', d.year ? `${d.year - 4}–${d.year}` : '—'], ['Counties', num(d.rows.length)]] }),
    learn: {
      what: 'What homes are worth and what rent costs in every U.S. county, from the Census Bureau’s American Community Survey (ACS): the median value of owner-occupied homes, coloured from blue (under $150,000) to red ($700,000 or more), and the median monthly rent. Click a county for both and how they changed.',
      how: 'Households answer the survey every month; the Census Bureau pools five years of answers (tables B25077 and B25064) so that even small counties have an estimate. A monthly job reads the newest five-year release from the Census data service, compares it with the release five years earlier and places each county at its Census Gazetteer centre.',
      try: 'Compare the coastal counties of California and the north-east with the Great Plains, then turn on House prices to see where values are still rising fastest.',
      refs: ['censusacs', 'censusgaz', 'economydata'],
    },
  };
}

// ================================================================== property sales by postcode district (Price Paid)
const SALE_BANDS = [['#7fb0f0', 1.6, 0], ['#9fe0c0', 1.9, 100], ['#f2d16b', 2.2, 300], ['#ff9b4c', 2.6, 700], ['#ff4e6a', 3.0, 1500]];
const TYPES = ['Detached', 'Semi-detached', 'Terraced', 'Flats and maisonettes', 'Other'];
export function propertySalesLayer() {
  return {
    id: 'propsales', group: 'econ', label: 'Homes sold, England and Wales', swatch: '#9fe0c0', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'house',
    legend: [['house', 'Under 100 sales', SALE_BANDS[0][0]], ['house', '100–300', SALE_BANDS[1][0]], ['house', '300–700', SALE_BANDS[2][0]], ['house', '700–1,500', SALE_BANDS[3][0]], ['house', '1,500 or more', SALE_BANDS[4][0]]],
    sources: ['landregpp', 'codepointopen', 'economydata'],
    options: [{ id: 'colour', label: 'Colour by', choices: [['sales', 'Number of sales'], ['price', 'Median price']], value: 'sales' }],
    async load(o) {
      const j = await getSnapshot('landregpp', 'sales/districts.json', BRANCH);
      return { ...j, colour: o.colour, statusNote: `${j.from} to ${j.to}: ${num(j.rows.reduce((a, r) => a + r[2], 0))} sales in ${j.rows.length.toLocaleString()} postcode districts` };
    },
    channels(d, ctx) {
      const colour = (r) => (d.colour === 'price' ? (r[3] == null ? '#8a96a3' : r[3] >= 700_000 ? '#ff4e6a' : r[3] >= 450_000 ? '#ff9b4c' : r[3] >= 300_000 ? '#f2d16b' : r[3] >= 200_000 ? '#9fe0c0' : '#7fb0f0') : SALE_BANDS.reduce((c, b) => (r[2] >= b[2] ? b[0] : c), SALE_BANDS[0][0]));
      const v = ctx.view;
      return {
        points: d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: v.altitude > 1 ? 0.07 : 0.05 + Math.min(0.12, Math.sqrt(r[2]) / 400), color: colour(r), label: v.altitude < 0.15 ? r[4] : '', tip: tip(`${r[4]}: ${num(r[2])} homes sold`, r[3] != null ? `median £${num(r[3])} · ${r[8] ?? ''}` : r[8] ?? ''), ref: { layer: 'propsales', d: r } })),
        pick: pickAll(d, 'propsales'),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, n, med, oc, nb, types, lease, town, la] = r;
      return {
        title: `${oc}: ${num(n)} homes sold`, sub: `Postcode district${town ? ` · ${town}` : ''}${la && la !== town ? `, ${la}` : ''}`,
        rows: [['Median price', med != null ? `£${num(med)}` : 'not shown (fewer than five sales)'], ['New builds', num(nb)], ['Leasehold', num(lease)], ...TYPES.map((t, i) => [t, num(types?.[i])]).filter(([, x]) => x !== '0'), ['Where (centre of the district)', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: 'Every residential sale in England and Wales is registered with HM Land Registry and published as Price Paid Data. Here they are added up by postcode district (the first half of a postcode) over the last twelve months: no address, house number or full postcode is kept. Only standard sales at full market value are counted, not repossessions, buy-to-let portfolios or transfers to companies.',
        links: [{ label: 'HM Land Registry Price Paid Data', url: 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads' }, { label: 'UK House Price Index', url: 'https://landregistry.data.gov.uk/app/ukhpi' }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['From', d.from], ['To', d.to], ['Postcode districts', num(d.rows.length)], ['Sales counted', num(d.rows.reduce((a, r) => a + r[2], 0))]] }),
    learn: {
      what: 'Where homes are being bought and sold in England and Wales: how many sales were registered in each postcode district over the last twelve months, the median price (where there were at least five sales), how many were new builds, and the mix of detached, semi-detached, terraced homes and flats. Switch “Colour by” to see prices instead of the number of sales.',
      how: 'HM Land Registry publishes every registered sale as Price Paid Data under the Open Government Licence, about a month after registration. A monthly job reads this year’s and last year’s files, keeps only standard sales, drops every address and adds the sales up by postcode district. Each district sits at the average position of its postcodes from Ordnance Survey Code-Point Open.',
      try: 'Look for new-build hot spots on the edges of growing towns such as Milton Keynes, Northampton and Cambridge, then compare the flats of central London with the detached houses of rural Wales.',
      refs: ['landregpp', 'codepointopen', 'economydata'],
    },
  };
}

// ================================================================== what each country sells (BACI)
export function exportsLayer() {
  return {
    id: 'exports', group: 'econ', label: 'What each country sells (top exports)', swatch: '#7ed6c4', on: false, refresh: 24 * 3600_000, pin: 'ship',
    sources: ['baci', 'economydata'],
    async load() {
      const j = await getSnapshot('baci', 'exports/countries.json', BRANCH);
      return { ...j, statusNote: `${j.year}: ${j.rows.length} countries, ${bigUsd(j.rows.reduce((a, r) => a + r[2], 0))} of goods exported` };
    },
    channels(d, ctx) {
      const max = d.rows[0]?.[2] ?? 1;
      return {
        points: d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.004 + 0.1 * Math.sqrt(r[2] / max), r: 0.25 + 0.9 * Math.sqrt(r[2] / max), color: '#7ed6c4', label: ctx.view.altitude < 2.2 || r[2] > max / 8 ? `${r[4]}: ${r[5][0] ? shortProduct(r[5][0][1]) : ''}` : '', tip: tip(r[4], `${bigUsd(r[2])} exported · mostly ${r[6].slice(0, 2).map((c) => c[1].toLowerCase()).join(' and ')}`), ref: { layer: 'exports', d: r } })),
        pick: pickAll(d, 'exports'),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, total, iso3, name, products, chapters, year] = r;
      const share = (v) => `${num((v / total) * 100, 1)} %`;
      return {
        title: `${name} sells…`, sub: `Goods exported in ${year}: ${bigUsd(total)}`,
        rows: [...chapters.map(([, n, v]) => [n, `${bigUsd(v)} (${share(v)})`]), ...products.slice(0, 6).map(([k, desc, v]) => [`Top product ${k}`, `${shortProduct(desc)}: ${bigUsd(v)}`])],
        body: 'Exports of goods by product group (chapters of the Harmonized System, the customs nomenclature) and the biggest single products. Values are what the importing countries reported paying, reconciled with what the exporter declared, so they are comparable between countries. Services such as tourism, finance and software are not included.',
        links: [{ label: 'CEPII BACI', url: 'https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37' }, { label: `${name} on the Atlas of Economic Complexity`, url: `https://atlas.hks.harvard.edu/explore/treemap?exporter=country-${iso3}` }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Year', d.year], ['Countries', num(d.rows.length)], ['Version', d.version ?? '—']] }),
    learn: {
      what: 'What each country sells to the rest of the world: the total value of its exported goods, its biggest product groups and the top individual products, from crude oil and iron ore to cars, computer chips and medicines. Bigger circles export more.',
      how: 'Customs offices record every shipment by product code. The United Nations collects the yearly totals (UN Comtrade); CEPII, a French research centre, reconciles what exporters and importers each reported into one consistent table, BACI, published under an open licence. A monthly job checks for a new release and adds up each country’s exports by product.',
      try: 'Compare Saudi Arabia, Chile and Australia (raw materials) with Germany, Japan and South Korea (machines and vehicles), then click Bangladesh and Vietnam.',
      refs: ['baci', 'economydata'],
    },
  };
}
/** Customs product descriptions are long; keep the first clause. */
export const shortProduct = (s) => { const t = String(s ?? '').split(/[;:]/)[0].replace(/\s*\(.*?\)\s*/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 57)}…` : t; };

// ================================================================== heavy industry (Climate TRACE)
export const INDUSTRY = { steel: ['Iron and steel', '#ff6b5a'], cement: ['Cement', '#c9b79c'], aluminum: ['Aluminium', '#9fc3e6'], chemicals: ['Chemicals', '#c8a2ff'], 'petrochemical-steam-cracking': ['Petrochemicals', '#e07ad6'], 'pulp-and-paper': ['Pulp and paper', '#7ed6a0'], glass: ['Glass', '#7ed6c4'], lime: ['Lime', '#e9f2f7'], 'oil-and-gas-refining': ['Oil refining', '#ffb347'] };
export function industryLayer() {
  return {
    id: 'industry', group: 'econ', label: 'Heavy industry: steel, cement, chemicals, refineries', swatch: '#ff6b5a', on: false, refresh: 24 * 3600_000, viewDependent: true, pin: 'factory',
    legend: Object.values(INDUSTRY).map(([l, c]) => ['factory', l, c]),
    sources: ['climatetrace', 'economydata'],
    options: [{ id: 'kinds', label: 'Industries', multi: true, choices: Object.entries(INDUSTRY).map(([k, [l]]) => [k, l]), value: Object.keys(INDUSTRY) }],
    async load(o) {
      const j = await getSnapshot('climatetrace', 'industry/assets.json', BRANCH);
      const rows = j.rows.filter((r) => o.kinds.includes(r[4]));
      return { ...j, rows, statusNote: `${rows.length.toLocaleString()} sites, ${tonnes(rows.reduce((a, r) => a + (r[2] ?? 0), 0))} of carbon dioxide equivalent a year` };
    },
    channels(d, ctx) {
      d._particles ??= Object.entries(INDUSTRY).map(([k, [, color]]) => ({ color, size: 1.6, pts: d.rows.filter((r) => r[4] === k).map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013 })) })).filter((g) => g.pts.length);
      const v = ctx.view;
      const big = v.altitude >= 1.2 ? d.rows.slice(0, 300) : nearRows(d.rows, v, (r) => r[2], 900);
      return {
        particles: d._particles,
        points: big.map((r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.06 + Math.min(0.3, Math.log10(1 + (r[2] ?? 0)) / 30), color: INDUSTRY[r[4]]?.[1] ?? '#ccc', label: v.altitude < 0.4 ? r[3] : '', tip: tip(r[3], `${INDUSTRY[r[4]]?.[0] ?? r[4]} · ${tonnes(r[2])} CO₂e a year`), ref: { layer: 'industry', d: r } })),
        pick: pickAll(d, 'industry'),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, t, name, sub, iso3, owner, cap, id, year] = r;
      const country = (() => { try { return iso3 && COUNTRY_NAMES ? COUNTRY_NAMES.of(ISO3_TO_2[iso3] ?? iso3) : iso3; } catch { return iso3; } })();
      return {
        title: name, sub: `${INDUSTRY[sub]?.[0] ?? sub} · ${country ?? ''}`, wiki: name,
        rows: [[`Estimated emissions${year ? ` (${year})` : ''}`, `${tonnes(t)} of carbon dioxide equivalent (CO₂e)`], ['Owner', owner ?? '—'], ['Capacity', cap ?? '—'], ['Where', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: 'Climate TRACE estimates each plant’s greenhouse gas emissions from satellite images, production capacity and the typical emissions of its process. Big numbers mean big output: a steelworks with blast furnaces or a cement kiln releases millions of tonnes a year. These are model estimates, not the plant’s own reports.',
        links: [{ label: 'Climate TRACE map', url: `https://climatetrace.org/explore#asset=${encodeURIComponent(id)}` }, { label: 'OpenStreetMap here', url: `https://www.openstreetmap.org/#map=15/${lat}/${lng}` }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Sites', num(d.rows.length)], ...Object.entries(INDUSTRY).map(([k, [l]]) => [l, num(d.rows.filter((r) => r[4] === k).length)])] }),
    learn: {
      what: 'The world’s big factories: steelworks, cement and lime kilns, aluminium smelters, chemical and petrochemical plants, pulp and paper mills, glassworks and oil refineries, each with its estimated yearly greenhouse gas emissions. Pick industries under the layer; zoomed out you see the biggest 300, zoomed in every site near the centre.',
      how: 'Climate TRACE, a coalition of universities, non-profits and companies, maps industrial plants from public registries, company reports and satellite imagery, and estimates their emissions with models checked against reported data. A monthly job copies its asset list (published under CC BY 4.0). Power plants are in the Power plants layer and U.S. chemical releases in Toxic chemical releases, so they are not repeated here.',
      try: 'Choose Iron and steel only and look at Hebei province around Tangshan in China, then the Ruhr in Germany and the Pittsburgh area. Then switch to Oil refining and follow the Gulf Coast.',
      refs: ['climatetrace', 'economydata'],
    },
  };
}
const ISO3_TO_2 = { CHN: 'CN', IND: 'IN', USA: 'US', RUS: 'RU', JPN: 'JP', DEU: 'DE', KOR: 'KR', BRA: 'BR', IRN: 'IR', TUR: 'TR', IDN: 'ID', VNM: 'VN', SAU: 'SA', MEX: 'MX', ITA: 'IT', FRA: 'FR', GBR: 'GB', CAN: 'CA', ESP: 'ES', POL: 'PL', UKR: 'UA', EGY: 'EG', PAK: 'PK', THA: 'TH', ZAF: 'ZA', AUS: 'AU', ARE: 'AE', MYS: 'MY', NLD: 'NL', BEL: 'BE', SWE: 'SE', AUT: 'AT', KAZ: 'KZ', TWN: 'TW', ARG: 'AR', DZA: 'DZ', NGA: 'NG', PHL: 'PH', BGD: 'BD', IRQ: 'IQ', KWT: 'KW', QAT: 'QA', OMN: 'OM', CZE: 'CZ', ROU: 'RO', FIN: 'FI', NOR: 'NO', CHL: 'CL', PER: 'PE', COL: 'CO', VEN: 'VE', MAR: 'MA', BHR: 'BH', SGP: 'SG' };

// ================================================================== factories mapped in OpenStreetMap (Overpass, on demand)
export function osmWorksRow(e) {
  const t = e.tags ?? {}; const lat = e.lat ?? e.center?.lat; const lng = e.lon ?? e.center?.lon;
  return lat == null ? null : [lat, lng, t.name || t['name:en'] || '', t.product || t.industrial || t.craft || '', t.operator || t.brand || '', e.type, e.id];
}
export function osmWorksLayer() {
  const live = new Map(); let lastKey = ''; let last = null;
  return {
    id: 'osmworks', group: 'econ', label: 'Factories mapped in OpenStreetMap (zoom in)', swatch: '#e3b55b', on: false, viewDependent: true, reloadOnView: true, pin: 'factory',
    sources: ['osm', 'overpass'],
    async load(_o, ctx) {
      const v = ctx.view;
      if (v.altitude < 0.25) {
        const d = Math.min(1.2, v.radiusKm / 111);
        const box = `${(v.lat - d).toFixed(3)},${(v.lng - d * 1.4).toFixed(3)},${(v.lat + d).toFixed(3)},${(v.lng + d * 1.4).toFixed(3)}`;
        const q = `[out:json][timeout:25];nwr["man_made"="works"](${box});out center tags 1500;`;
        const j = await getFeed('overpass', `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { ttl: 600_000, timeout: 30_000 });
        for (const e of j.elements ?? []) { const r = osmWorksRow(e); if (r) live.set(`${e.type}/${e.id}`, r); }
      }
      const key = String(live.size); if (last && key === lastKey) return last;
      lastKey = key; last = { rows: [...live.values()], zoomed: v.altitude < 0.25, statusNote: live.size ? `${live.size.toLocaleString()} works loaded so far` : 'zoom in to a city to load mapped factories' };
      return last;
    },
    channels(d, ctx) {
      const v = ctx.view;
      return {
        particles: (d._particles ??= [{ color: '#e3b55b', size: 1.4, pts: d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0013 })) }]),
        points: v.altitude < 0.9 ? d.rows.filter((r) => inView(v, r[0], r[1])).slice(0, 1500).map((r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.05, color: '#e3b55b', label: v.altitude < 0.08 ? r[2] : '', tip: tip(r[2] || 'Factory', r[3] ? `makes ${r[3]}` : 'mapped in OpenStreetMap'), ref: { layer: 'osmworks', d: r } })) : [],
        pick: pickAll(d, 'osmworks'),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      const [lat, lng, name, product, operator, type, id] = r;
      return {
        title: name || 'Factory', sub: operator ? `Operated by ${operator}` : 'Mapped in OpenStreetMap',
        rows: [['Makes', product || 'not recorded'], ['Where', `${fmtLat(lat)}, ${fmtLng(lng)}`]],
        body: 'Volunteers map factories and industrial works in OpenStreetMap, often with what they produce and who runs them. Coverage is uneven: a gap on the map may just be unmapped.',
        links: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${type}/${id}` }],
        probe: [lat, lng],
      };
    },
    describeLayer: (d) => ({ rows: [['Works loaded', num(d.rows.length)]] }),
    learn: {
      what: 'Factories and industrial works of every size — breweries, bakeries, car plants, sawmills, print works — as mapped by OpenStreetMap volunteers. Zoom in to a city to load the ones in view; click one for what it makes and who runs it.',
      how: 'Mappers tag a factory as man_made=works, often with product and operator. When you are zoomed in, the layer asks OpenStreetMap’s Overpass service for every such feature in view and keeps what it has loaded while you move around.',
      try: 'Zoom in on Wolfsburg, Toyota City or Detroit, then on the Pearl River Delta between Shenzhen and Guangzhou.',
      refs: ['osm', 'overpass'],
    },
  };
}

/** Every layer this module adds, in the order they appear. */
export function economyLayers(api) {
  return [housePricesLayer(api), homeValuesLayer(api), propertySalesLayer(api), exportsLayer(api), industryLayer(api), osmWorksLayer(api)];
}
