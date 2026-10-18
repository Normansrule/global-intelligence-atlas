// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — place names and airports, so the globe reads like a map.
import { getLocal } from './feeds.js';
import { haversineKm, fmtLat, fmtLng, localSolarTime } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;

export const citiesLayer = {
  id: 'cities', group: 'places', label: 'City names', swatch: '#eef3f6', on: true, viewDependent: true,
  sources: ['natearth'],
  async load() {
    const d = await getLocal('data/cities.json');
    return d.rows.map(([name, lat, lng, pop, capital, cc, region]) => ({ name, lat, lng, pop, capital: !!capital, cc, region }));
  },
  channels(cs, ctx) {
    const v = ctx.view; const a = v.altitude;
    // How many names to show depends on zoom, like a web map: capitals and megacities first.
    const max = a > 1.6 ? 45 : a > 0.8 ? 80 : a > 0.3 ? 110 : 140;
    const shown = cs.filter((c) => Math.abs(c.lat - v.lat) * 111 < v.radiusKm * 1.05 && haversineKm(v.lat, v.lng, c.lat, c.lng) < v.radiusKm * 1.05).slice(0, max);
    const base = Math.max(0.012, Math.min(1.3, a * 0.34));
    return {
      labels: shown.map((c) => ({
        lat: c.lat, lng: c.lng, alt: 0.006, text: c.name,
        size: (c.pop > 5e6 ? 15 : c.pop > 1e6 ? 13 : 11.5) + (c.capital ? 1 : 0), px: true,
        color: c.capital ? 'rgba(255,230,170,0.95)' : 'rgba(238,243,246,0.88)', dot: base * 0.22, fixed: true, ref: { layer: 'cities', d: c },
      })),
    };
  },
  describe(c) {
    return {
      title: c.name, sub: [c.region, c.cc].filter(Boolean).join(' · ') + (c.capital ? ' · national capital' : ''),
      rows: [['Population (metro, Natural Earth)', c.pop ? c.pop.toLocaleString() : '—'], ['Position', `${fmtLat(c.lat)}, ${fmtLng(c.lng)}`], ['Local solar time', localSolarTime(c.lng)]],
      wiki: c.name, probe: [c.lat, c.lng],
      links: [{ label: 'Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat},${c.lng}` }, { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/#map=12/${c.lat}/${c.lng}` }],
    };
  },
  learn: {
    what: '2,500 cities and every national capital, shown more densely as you zoom in — the way a web map reveals smaller places at closer zoom. Gold names are capitals.',
    how: 'From Natural Earth’s populated places, a public-domain dataset made for cartography; population is the metro-area estimate it records.',
    try: 'Zoom slowly into a region and watch smaller cities appear. Click a name for its encyclopaedia summary, weather and a street-level view.',
    refs: ['natearth'],
  },
};

export const airportsLayer = {
  id: 'airports', group: 'places', label: 'Airports', swatch: '#b7c8d6', on: false, viewDependent: true, pin: 'plane',
  sources: ['ourairports'],
  async load() {
    const d = await getLocal('data/airports.json');
    return d.rows.map(([iata, icao, name, lat, lng, elev, city, cc, large]) => ({ iata, icao, name, lat, lng, elev, city, cc, large: !!large }));
  },
  channels(as, ctx) {
    const v = ctx.view;
    const list = as.filter((a) => (a.large || v.altitude < 0.5) && Math.abs(a.lat - v.lat) * 111 < v.radiusKm * 1.05 && haversineKm(v.lat, v.lng, a.lat, a.lng) < v.radiusKm * 1.05);
    return { points: list.map((a) => ({ lat: a.lat, lng: a.lng, alt: 0.006, r: a.large ? 0.14 : 0.08, color: '#b7c8d6', tip: tip(`${a.iata} · ${a.name}`, a.city), ref: { layer: 'airports', d: a }, label: a.iata })) };
  },
  describe(a) {
    return {
      title: a.name, sub: `${a.iata}${a.icao && a.icao !== a.iata ? ` / ${a.icao}` : ''} · ${[a.city, a.cc].filter(Boolean).join(', ')}`,
      rows: [['Elevation', `${a.elev.toLocaleString()} ft (${Math.round(a.elev / 3.281).toLocaleString()} m)`], ['Size', a.large ? 'Large airport' : 'Medium airport with scheduled flights'], ['Position', `${fmtLat(a.lat)}, ${fmtLng(a.lng)}`]],
      wiki: a.name, probe: [a.lat, a.lng], actions: [['airport-board', 'Arrivals and departures now'], ['near-flights', 'Zoom in on the traffic here']],
      links: [{ label: 'Live traffic on adsb.lol', url: `https://globe.adsb.lol/?lat=${a.lat}&lon=${a.lng}&zoom=10` }, { label: 'OurAirports', url: `https://ourairports.com/airports/${a.icao}/` }],
    };
  },
  learn: {
    what: 'About 1,200 large airports everywhere, plus 2,000 medium airports with scheduled flights once you zoom in. The pin label is the IATA code you see on bag tags.',
    how: 'OurAirports, a public-domain database kept up by pilots and aviation enthusiasts.',
    try: 'Click a hub, choose “Show flights around here”, and watch the arrival and departure streams.',
    refs: ['ourairports'],
  },
};
