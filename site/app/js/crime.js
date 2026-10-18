// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — reported crime from official open-data portals. Each city publishes incident reports
// (locations generalised to the block for privacy). Reports are not the same as crime rates: they depend on
// what gets reported and recorded, and busy downtowns always show more because more people are there.
import { getFeed } from './feeds.js';
import { haversineKm, fmtLat, fmtLng } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soda = (host, id, sel, order, limit = 5000) => `https://${host}/resource/${id}.json?$select=${encodeURIComponent(sel)}&$order=${encodeURIComponent(`${order} DESC`)}&$limit=${limit}`;

export const CITIES = [
  { id: 'chicago', name: 'Chicago', src: 'Chicago Police Department via the City of Chicago Data Portal', lat: 41.84, lng: -87.68, r: 45,
    url: soda('data.cityofchicago.org', 'ijzp-q8t2', 'date,primary_type,description,block,location_description,arrest,latitude,longitude', 'date'),
    map: (r) => ({ t: r.date, cat: r.primary_type, desc: r.description, where: [r.block, r.location_description].filter(Boolean).join(' · '), lat: +r.latitude, lng: +r.longitude, extra: r.arrest === true || r.arrest === 'true' ? 'Arrest made' : '' }),
    lag: 'about a week behind' },
  { id: 'sf', name: 'San Francisco', src: 'San Francisco Police Department via DataSF', lat: 37.76, lng: -122.44, r: 15,
    url: soda('data.sfgov.org', 'wg3w-h783', 'incident_datetime,incident_category,incident_description,analysis_neighborhood,resolution,latitude,longitude', 'incident_datetime'),
    map: (r) => ({ t: r.incident_datetime, cat: r.incident_category, desc: r.incident_description, where: r.analysis_neighborhood, lat: +r.latitude, lng: +r.longitude, extra: r.resolution }),
    lag: 'updated daily' },
  { id: 'nyc', name: 'New York City', src: 'NYPD complaint data (current year) via NYC Open Data', lat: 40.71, lng: -73.95, r: 35,
    url: soda('data.cityofnewyork.us', '5uac-w243', 'cmplnt_fr_dt,ofns_desc,pd_desc,law_cat_cd,boro_nm,latitude,longitude', 'cmplnt_fr_dt'),
    map: (r) => ({ t: r.cmplnt_fr_dt, cat: r.ofns_desc, desc: r.pd_desc, where: r.boro_nm, lat: +r.latitude, lng: +r.longitude, extra: r.law_cat_cd }),
    lag: 'updated quarterly' },
  { id: 'la', name: 'Los Angeles', src: 'LAPD via the City of Los Angeles open data portal', lat: 34.05, lng: -118.35, r: 45,
    url: soda('data.lacity.org', '2nrs-mtv8', 'date_occ,crm_cd_desc,area_name,premis_desc,lat,lon', 'date_occ'),
    map: (r) => ({ t: r.date_occ, cat: r.crm_cd_desc, desc: r.premis_desc, where: r.area_name, lat: +r.lat, lng: +r.lon, extra: '' }),
    lag: 'LAPD changed records systems in 2024, so this feed may end early — check the dates' },
];
const UK = { id: 'uk', name: 'England, Wales and Northern Ireland', src: 'data.police.uk (Home Office)', lag: 'monthly, about two months behind' };
const inUK = (lat, lng) => lat > 49.8 && lat < 60.9 && lng > -8.3 && lng < 1.9;

/** Which symbol a report gets: a car for vehicle crime, a house for burglary, a bag for theft, and so on. */
export function crimeGlyph(cat = '') {
  const c = String(cat).toLowerCase();
  if (/vehicle|motor|auto|car\b|carjack/.test(c)) return 'car';
  if (/burglar|break.?in|trespass/.test(c)) return 'house';
  if (/theft|larceny|shoplift|stolen|pickpocket|purse|bike|bicycle/.test(c)) return 'bag';
  if (/narcotic|drug|liquor|possession/.test(c)) return 'pill';
  if (/vandal|damage|mischief|graffiti|arson/.test(c)) return 'spray';
  if (/homicide|murder|assault|battery|robbery|weapon|shoot|kidnap|violen|rape|sex/.test(c)) return 'siren';
  return 'badge';
}
export function crimeGroup(cat = '') {
  const c = cat.toLowerCase();
  if (/homicide|murder|assault|battery|robbery|weapon|shoot|rape|sex|kidnap|violen|arson|intimidat/.test(c)) return ['Violent', '#f07a63'];
  if (/theft|larceny|burglar|vehicle|stolen|shoplift|vandal|damage|criminal mischief|bike|fraud|forgery/.test(c)) return ['Property', '#ffd37a'];
  if (/narcotic|drug|dangerous drugs|liquor|possession/.test(c)) return ['Drugs', '#b7a3ff'];
  return ['Other', '#9fc3e6'];
}

export const crimeLayer = {
  id: 'crime', group: 'civic', label: 'Reported crime', swatch: '#f07a63', on: false, viewDependent: true, reloadOnView: true, pin: (r) => crimeGlyph(r.cat),
  legend: [['siren', 'Violent (assault, robbery…)'], ['bag', 'Theft'], ['house', 'Burglary'], ['car', 'Vehicle crime'], ['pill', 'Drugs'], ['spray', 'Vandalism and damage'], ['badge', 'Other']],
  sources: ['chicago', 'datasf', 'nycopen', 'lacity', 'policeuk'],
  async load(_o, ctx) {
    const v = ctx.view;
    const city = CITIES.find((c) => haversineKm(v.lat, v.lng, c.lat, c.lng) < c.r + 30);
    if (v.altitude > 0.12 || (!city && !inUK(v.lat, v.lng))) return { rows: [], city: null, hint: true };
    if (city) {
      const raw = await getFeed(`crime:${city.id}`, city.url, { ttl: 30 * 60_000, timeout: 30_000 });
      const rows = raw.map(city.map).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.lat !== 0);
      return { rows, city };
    }
    const raw = await getFeed('crime:uk', `https://data.police.uk/api/crimes-street/all-crime?lat=${v.lat.toFixed(4)}&lng=${v.lng.toFixed(4)}`, { ttl: 60 * 60_000 });
    return { city: UK, rows: raw.map((r) => ({ t: r.month, cat: r.category.replace(/-/g, ' '), desc: r.outcome_status?.category ?? 'No outcome recorded yet', where: r.location?.street?.name, lat: +r.location.latitude, lng: +r.location.longitude, extra: r.context })) };
  },
  channels(d, ctx) {
    if (d.hint) {
      return { points: CITIES.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.02, r: 0.5, color: '#f07a63', label: `${c.name} crime map`, tip: `<div class="tip"><b>${c.name}</b><span>Click to open the crime map</span></div>`, ref: { layer: 'crime', d: { goto: c } } })) };
    }
    const v = ctx.view;
    const shown = d.rows.filter((r) => Math.abs(r.lat - v.lat) * 111 < v.radiusKm * 1.1 && haversineKm(v.lat, v.lng, r.lat, r.lng) < v.radiusKm * 1.1);
    return {
      hexes: shown.map((r) => ({ lat: r.lat, lng: r.lng, w: 1, color: crimeGroup(r.cat)[1] })),
      points: shown.slice(0, 800).map((r) => { const [g, color] = crimeGroup(r.cat); return { lat: r.lat, lng: r.lng, alt: 0.003, r: 0.05, color, label: titleCase(r.cat), tip: `<div class="tip"><b>${esc(titleCase(r.cat))}</b><span>${esc(g)} · ${esc(fmtDate(r.t))}</span></div>`, ref: { layer: 'crime', d: { ...r, city: d.city } } }; }),
    };
  },
  describeLayer: (d) => {
    if (d.hint) return { rows: [['Coverage', 'Chicago, San Francisco, New York City, Los Angeles, and all of England, Wales and Northern Ireland'], ['To load reports', 'zoom in closer than about 750 km over one of those places']] };
    const ts = d.rows.map((r) => new Date(r.t)).filter((x) => !isNaN(x)).sort((a, b) => a - b);
    const groups = {}; for (const r of d.rows) { const g = crimeGroup(r.cat)[0]; groups[g] = (groups[g] ?? 0) + 1; }
    return { rows: [['Area', d.city.name], ['Reports loaded', d.rows.length.toLocaleString()], ['Dates', ts.length ? `${fmtDate(ts[0])} – ${fmtDate(ts.at(-1))}` : '—'], ['Freshness', d.city.lag], ...Object.entries(groups).map(([g, n]) => [g, n.toLocaleString()]), ['Source', d.city.src]] };
  },
  describe(r) {
    if (r.goto) return { title: `${r.goto.name} crime map`, sub: r.goto.src, body: `Loads the most recent ${r.goto.name} incident reports (${r.goto.lag}).`, actions: [['crime-goto', `Fly to ${r.goto.name}`]], gotoCity: r.goto };
    const [g] = crimeGroup(r.cat);
    return {
      title: titleCase(r.cat), sub: `${g} · reported ${fmtDate(r.t)}`,
      rows: [['Details', r.desc ? titleCase(r.desc) : '—'], ['Where', r.where || '—'], ...(r.extra ? [['Status', titleCase(String(r.extra))]] : []), ['Position (generalised)', `${fmtLat(r.lat)}, ${fmtLng(r.lng)}`], ['Source', r.city?.src ?? '—']],
      body: 'Positions are moved to the nearest block or street segment to protect victims. One report is one incident as recorded by police — not a conviction, and not a measure of how safe a place is.',
      probe: [r.lat, r.lng],
    };
  },
  learn: {
    what: 'Recent incident reports published by police open-data portals: Chicago, San Francisco, New York City, Los Angeles, and street-level data for England, Wales and Northern Ireland. Coloured hexagon columns show where reports cluster; zoom in for individual pins. Red violent, yellow property, violet drugs, blue other.',
    how: 'Each city publishes its records through an open API; Global Intelligence Atlas reads the latest few thousand reports for the city you are looking at, straight from your browser. UK data comes from data.police.uk for about a mile around the centre of the view.',
    try: 'Compare a downtown with a residential area and think about why counts differ: population, visitors, reporting habits and policing all shape the numbers. Then read the portal’s own notes on data quality.',
    refs: ['chicago', 'datasf', 'nycopen', 'lacity', 'policeuk'],
  },
};
const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtDate = (t) => { const d = new Date(t); return isNaN(d) ? String(t ?? '—') : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
