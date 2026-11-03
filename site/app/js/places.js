// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — place names and airports, so the globe reads like a map.
import { getLocal } from './feeds.js';
import { routesFrom } from './flightdb.js';
import { haversineKm, greatCirclePoints, fmtLat, fmtLng, localSolarTime } from './astro.js';

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

// The open airport card draws every scheduled nonstop route out of it: one batched line set, lifted into arcs.
const aptRoutes = { icao: null, legs: null, fat: null };
function routesHtml(a, legs) {
  if (!legs?.length) return '<p class="muted">No scheduled airline routes are listed from here.</p>';
  const countries = new Set(legs.map((l) => l.to.cc)); const airlines = new Map();
  for (const l of legs) for (const x of l.airlines) airlines.set(x.code, (airlines.get(x.code) ?? 0) + l.flights);
  const far = legs.map((l) => [l, haversineKm(a.lat, a.lng, l.to.lat, l.to.lng)]).sort((x, y) => y[1] - x[1])[0];
  const top = [...airlines].sort((x, y) => y[1] - x[1]).slice(0, 6);
  const name = (code) => legs.flatMap((l) => l.airlines).find((x) => x.code === code);
  return `<div class="apt-sum"><div><b>${legs.length.toLocaleString()}</b><small>nonstop destinations</small></div><div><b>${countries.size}</b><small>countries</small></div><div><b>${airlines.size}</b><small>airlines</small></div></div>
    <h4>Busiest routes</h4><ul class="apt-list">${legs.slice(0, 8).map((l) => `<li><button class="chip" data-fly="${l.to.lat},${l.to.lng},0.6">${esc(l.to.iata || l.to.icao)}</button> ${esc(l.to.city || l.to.name)}<small>${esc(l.to.country)} · ${Math.round(haversineKm(a.lat, a.lng, l.to.lat, l.to.lng)).toLocaleString()} km · ${[...new Set(l.airlines.map((x) => x.iata || x.code))].join(', ')}</small></li>`).join('')}</ul>
    <h4>Main airlines here</h4><p>${top.map(([c]) => esc(name(c)?.name ?? c)).join(' · ')}</p>
    ${far ? `<p class="muted">Longest nonstop: ${esc(far[0].to.city || far[0].to.name)} (${esc(far[0].to.iata || far[0].to.icao)}), ${Math.round(far[1]).toLocaleString()} km. Routes are the scheduled flight numbers in Virtual Radar Server’s public-domain data, drawn on the globe in gold.</p>` : ''}`;
}

export const airportsLayer = {
  id: 'airports', group: 'places', label: 'Airports', swatch: '#b7c8d6', on: false, viewDependent: true, pin: 'plane',
  sources: ['ourairports', 'vrsstanding'],
  async load() {
    const d = await getLocal('data/airports.json');
    return d.rows.map(([iata, icao, name, lat, lng, elev, city, cc, large]) => ({ iata, icao, name, lat, lng, elev, city, cc, large: !!large }));
  },
  channels(as, ctx) {
    const v = ctx.view;
    const list = as.filter((a) => (a.large || v.altitude < 0.5) && Math.abs(a.lat - v.lat) * 111 < v.radiusKm * 1.05 && haversineKm(v.lat, v.lng, a.lat, a.lng) < v.radiusKm * 1.05);
    const out = { points: list.map((a) => ({ lat: a.lat, lng: a.lng, alt: 0.006, r: a.large ? 0.14 : 0.08, color: '#b7c8d6', tip: tip(`${a.iata} · ${a.name}`, a.city), ref: { layer: 'airports', d: a }, label: a.iata })) };
    const sel = window.gia?.state?.selected; const open = sel?.layer === 'airports' && sel.d?.icao === aptRoutes.icao;
    if (open && aptRoutes.legs?.length) {
      const a = sel.d;
      aptRoutes.fat ??= ctx.fatLines(aptRoutes.legs.map((l) => {
        const km = haversineKm(a.lat, a.lng, l.to.lat, l.to.lng); const h = Math.min(0.12, 0.004 + km / 90000); const n = Math.max(8, Math.ceil(km / 250));
        return { pts: greatCirclePoints(a.lat, a.lng, l.to.lat, l.to.lng, n).map(([la, lo], i, all) => [la, lo, 0.003 + h * Math.sin((Math.PI * i) / (all.length - 1))]), color: l.flights > 20 ? '#f2c66d' : '#c99a45', width: l.flights > 20 ? 1.6 : 1 };
      }), { opacity: 0.75 });
      out.custom = [aptRoutes.fat];
      out.labels = aptRoutes.legs.slice(0, 12).map((l) => ({ lat: l.to.lat, lng: l.to.lng, text: l.to.iata || l.to.icao, size: 0.7, color: '#f2c66d', dot: 0.3 }));
    }
    return out;
  },
  describe(a) {
    return {
      title: a.name, sub: `${a.iata}${a.icao && a.icao !== a.iata ? ` / ${a.icao}` : ''} · ${[a.city, a.cc].filter(Boolean).join(', ')}`,
      rows: [['Elevation', `${a.elev.toLocaleString()} ft (${Math.round(a.elev / 3.281).toLocaleString()} m)`], ['Size', a.large ? 'Large airport' : 'Medium airport with scheduled flights'], ['Position', `${fmtLat(a.lat)}, ${fmtLng(a.lng)}`]],
      wiki: a.name, probe: [a.lat, a.lng], actions: [['airport-board', 'Arrivals and departures now'], ['near-flights', 'Zoom in on the traffic here']],
      html: '<div id="apt-routes" class="apt-routes"><p class="muted">Finding the scheduled routes from here…</p></div>',
      /** Called once the card is open: the routes out of here, listed and drawn. */
      async fill(stillOpen) {
        const legs = a.icao ? await routesFrom(a.icao).catch(() => null) : null;
        if (!stillOpen()) return;
        const el = document.getElementById('apt-routes'); if (el) el.innerHTML = routesHtml(a, legs);
        if (aptRoutes.icao !== a.icao) { aptRoutes.fat?.obj?.geometry?.dispose(); Object.assign(aptRoutes, { icao: a.icao, legs, fat: null }); }
        window.gia?.refreshLayer?.('airports', { soft: true });
      },
      links: [{ label: 'Live traffic on adsb.lol', url: `https://globe.adsb.lol/?lat=${a.lat}&lon=${a.lng}&zoom=10` }, { label: 'OurAirports', url: `https://ourairports.com/airports/${a.icao}/` }],
    };
  },
  learn: {
    what: 'About 1,200 large airports everywhere, plus 2,000 medium airports with scheduled flights once you zoom in. The pin label is the IATA code you see on bag tags.',
    how: 'OurAirports, a public-domain database kept up by pilots and aviation enthusiasts. Click an airport for every scheduled nonstop route out of it, drawn on the globe, with its busiest routes, main airlines and longest flight, from Virtual Radar Server’s public-domain route data.',
    try: 'Click a hub, choose “Show flights around here”, and watch the arrival and departure streams. Compare the gold route maps of Dubai, Atlanta and Singapore: one serves the world, one mostly its own country.',
    refs: ['ourairports', 'vrsstanding'],
  },
};
