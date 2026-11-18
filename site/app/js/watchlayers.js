// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: five live "watch" layers (v2.25), after the live layers of God's Eye View.
//   • Lightning: where lightning struck in the last 15 minutes (NOAA nowCOAST), wrapped on a shell above the ground.
//   • Hurricane forecasts: each active Atlantic and eastern or central Pacific storm with its forecast track, its
//     forecast points out to five days and the cone of uncertainty (US National Hurricane Center, NHC).
//   • Wildfire outlines: the mapped edge of every current US wildfire (NIFC WFIGS interagency perimeters).
//   • Restricted airspace: US prohibited and restricted areas (FAA Special Use Airspace).
//   • GPS interference: where aircraft report poor position integrity, per 1° cell (adsb.lol, gpsjam.org's formula).
// Each layer reads the service straight from the browser first and falls back to the copy the live-data job
// (tools/fetch-live.mjs) saves every few minutes; GPS interference only comes from that copy, so the browser never
// sends hundreds of requests to a community service. The parsing lives in watchfeeds.js, shared with that job.
import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed, getSnapshot, liveDataBase } from './feeds.js';
import { isOffline } from './lastknown.js';
import { fmtLat, fmtLng } from './astro.js';
import { GLYPHS } from './icons.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-watch]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/watch.css', import.meta.url).href; l.dataset.watch = '1'; document.head.appendChild(l); }
import {
  lightningUrl, LIGHTNING_SCALE, NHC_STATUS, NHC_QUERIES, assembleStorms, STORM_CLASS, category, wfigsUrl, slimFires, FIRE_TYPE,
  suaUrl, slimZones, gnssLevel,
} from './watchfeeds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const ago = (ms) => { const m = Math.round(ms / 60_000); return m < 90 ? `${Math.max(0, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const utc = (t) => (Number.isFinite(t) ? new Date(t).toUTCString().replace(':00 GMT', ' UTC') : '—');
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const kmh = (kt) => Math.round(kt * 1.852);
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
/** The middle of a geometry's bounding box: where its pin goes. */
function middle(g) {
  let a = 90; let b = 180; let c = -90; let d = -180;
  const walk = (x) => { if (typeof x[0] === 'number') { b = Math.min(b, x[0]); d = Math.max(d, x[0]); a = Math.min(a, x[1]); c = Math.max(c, x[1]); } else x.forEach(walk); };
  if (g?.coordinates) walk(g.coordinates);
  return [(a + c) / 2, (b + d) / 2];
}
/** Paths ([lat, lng, alt] lists) from a LineString or MultiLineString. */
const lines = (g, alt) => (!g ? [] : (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).map((l) => l.map(([x, y]) => [y, x, alt])));

GLYPHS.cone ??= [['M12 2c3.6 0 6 2.6 6 6 0 4.7-6 13.6-6 13.6S6 12.7 6 8c0-3.4 2.4-6 6-6z', 'c'], ['M12 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z', 'd']];
GLYPHS.nofly ??= [['M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z', 'c'], ['M6 6l12 12', 'd'], ['M12.6 6.5l1.6 4.2 3.6 1.3-3.6 1.3-1.6 4.2h-1.2l.6-4.2-3.4.6-.9 1.4H6.9l.5-2.7-.5-2.7h.8l.9 1.4 3.4.6-.6-4.2z', 'd']];

// ------------------------------------------------------------------ lightning
let shell = null; const SHELL = { get obj() { return shell; } };
function texture(url, ms = 25_000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('the lightning image took too long')), ms);
    new THREE.TextureLoader().load(url, (tex) => { clearTimeout(t); tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace; res(tex); }, undefined, () => { clearTimeout(t); rej(new Error('the lightning image did not load')); });
  });
}
export function lightningLayer() {
  return {
    id: 'lightning', group: 'live', label: 'Lightning (last 15 minutes)', swatch: '#ffd23f', on: false, refresh: 10 * 60_000, pin: 'bolt',
    sources: ['nowcoast', 'livedata'],
    legend: LIGHTNING_SCALE.map(([c, l]) => ['bolt', l || ' ', c]),
    options: [{ id: 'opacity', label: 'Opacity', choices: [['0.9', '90 %'], ['1', 'Solid'], ['0.6', '60 %']], value: '0.9' }],
    async load(o) {
      // The live-data copy first: it is refreshed every few minutes, it always sends CORS headers, and the service worker
      // keeps the newest one for offline use. nowCOAST itself when the copy is missing or over half an hour old.
      let tex; let src = 'snapshot'; let time = null; let at = Date.now();
      try {
        const meta = await getSnapshot('nowcoast', 'lightning.json', { ttl: 4 * 60_000 }); // waits for the configuration, so the base below is known
        at = Date.parse(meta.generatedAt ?? '') || at; time = meta.time ?? null;
        if (!isOffline() && Date.now() - at > 30 * 60_000) throw new Error('the live-data copy is old');
        tex = await texture(`${liveDataBase()}lightning.png?t=${encodeURIComponent(meta.generatedAt ?? '')}`);
      } catch (err) {
        if (isOffline()) throw Object.assign(new Error('No lightning image is saved on this device yet.'), { help: 'Offline, and this device has not saved a lightning image yet. It fills in when the internet is back.' });
        tex = await texture(lightningUrl()); src = 'live'; time = null; at = Date.now();
      }
      const when = time ? `strikes in the 15 minutes to ${new Date(time).toISOString().slice(11, 16)} UTC` : 'the latest 15 minutes';
      return { tex, src, time, at, opacity: Number(o.opacity ?? 0.9), statusNote: `${when}${src === 'snapshot' ? ` · from the live-data copy, ${ago(Date.now() - at)}` : ''}` };
    },
    channels(d) {
      if (!shell) {
        shell = new THREE.Mesh(new THREE.SphereGeometry(100 * 1.002, 160, 80), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        shell.rotation.y = -Math.PI / 2; // three-globe's texture alignment, as for the NASA overlay and radar
        shell.renderOrder = 3; shell.raycast = () => {};
      }
      shell.material.map = d.tex; shell.material.opacity = d.opacity; shell.material.needsUpdate = true;
      return { custom: [SHELL] };
    },
    count: () => '15-min density',
    describeLayer: (d) => ({ rows: [['Showing', d.time ? `15 minutes to ${utc(Date.parse(d.time))}` : 'the latest 15 minutes'], ['Covers', 'the Americas and the Pacific: 110° E across the date line to 0°, 25° S to 80° N'], ['Source', 'NOAA/NWS nowCOAST, derived from Vaisala NLDN and GLD360']] }),
    learn: {
      what: 'Where lightning struck in the last 15 minutes across the Americas and the Pacific, as a density: purple and blue for a few strikes, yellow to red where storms are firing many strikes a minute. Bright patches are active thunderstorms; a line of them is often a cold front.',
      how: 'Ground networks of radio sensors (Vaisala’s National Lightning Detection Network and its long-range GLD360) hear the radio burst of each strike and place it by its arrival time at several sensors. NOAA’s nowCOAST turns those strikes into a density on an 8 km grid every few minutes and publishes it as a map image, which the atlas wraps around the globe. The strikes themselves are Vaisala’s and are not public, only this density. It is not a safety service: if you hear thunder you are close enough to be struck.',
      try: 'On a summer afternoon, look over Florida, the Gulf of Mexico and the Andes; turn on Weather radar too and see the lightning sit inside the heaviest rain.',
      refs: ['nowcoast', 'nldn'],
    },
  };
}

// ------------------------------------------------------------------ hurricane forecasts
/** Saffir–Simpson colours (the usual track-map palette), by category; 0 is a tropical storm, -1 a depression. */
const CAT_COLOUR = { '-1': '#5ebaff', 0: '#00faf4', 1: '#ffffcc', 2: '#ffe775', 3: '#ffc140', 4: '#ff8f20', 5: '#ff6060' };
const stormCat = (kt) => (kt != null && kt < 34 ? -1 : category(kt));
const catText = (kt) => { const c = stormCat(kt); return c > 0 ? `Category ${c}` : c === 0 ? 'tropical storm strength' : 'depression strength'; };
export function cyclonesLayer(api) {
  let all = [];
  return {
    id: 'cyclones', group: 'live', label: 'Hurricane forecasts (NHC)', swatch: '#ffc140', on: false, refresh: 10 * 60_000, pin: 'storm',
    sources: ['nhc', 'livedata', 'saffir'],
    legend: [['storm', 'Depression', CAT_COLOUR[-1]], ['storm', 'Tropical storm', CAT_COLOUR[0]], ['storm', 'Category 1–2', CAT_COLOUR[2]], ['storm', 'Category 3–5', CAT_COLOUR[4]], ['cone', 'Cone of uncertainty', '#ffffff']],
    async load() {
      let storms; let src = 'live'; let at = Date.now();
      let partial = null;
      try {
        const status = await getFeed('nhc', NHC_STATUS, { ttl: 5 * 60_000, timeout: 15_000 });
        const gis = await Promise.all(NHC_QUERIES.map((u) => getFeed('nhc', u, { ttl: 5 * 60_000, timeout: 20_000 }).catch(() => null)));
        storms = assembleStorms(status, gis);
        // storms but no forecast maps at all: the live-data copy may have them
        if (storms.length && gis.every((g) => !g)) { partial = storms; throw new Error('the NHC map service did not answer'); }
      } catch (err) {
        try {
          const s = await getSnapshot('nhc', 'nhc.json', { ttl: 4 * 60_000 });
          storms = s.storms ?? []; src = 'snapshot'; at = Date.parse(s.generatedAt ?? '') || at;
        } catch (e) { if (!partial) throw e; storms = partial; }
      }
      all = storms;
      const n = storms.length;
      return { storms, src, at, statusNote: n ? `${n} active storm${n === 1 ? '' : 's'}${src === 'snapshot' ? ` · from the live-data copy, ${ago(Date.now() - at)}` : ''}` : 'No active storms in the Atlantic or the eastern and central Pacific right now (the Alerts layer shows typhoons and cyclones elsewhere)' };
    },
    channels(d) {
      const out = { polygons: [], paths: [], points: [], rings: [], labels: [] };
      for (const s of d.storms ?? []) {
        const c = CAT_COLOUR[stormCat(s.windKt)]; const ref = { layer: 'cyclones', d: s };
        if (s.cone) out.polygons.push({ geometry: s.cone, cap: 'rgba(255,255,255,0.16)', side: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.75)', alt: 0.003, tip: tip(`${s.name}: cone of uncertainty`, 'where the centre will probably be over five days'), ref });
        for (const pts of lines(s.track, 0.0045)) out.paths.push({ pts, color: c, stroke: 0.55, dash: [0.04, 0.02], tip: tip(`${s.name}: forecast track`), ref });
        for (const p of s.points) if (p.tau > 0) out.points.push({ lat: p.lat, lng: p.lng, alt: 0.005, r: 0.22, color: CAT_COLOUR[stormCat(p.windKt)], tip: tip(`${s.name} in ${p.tau} h`, `${p.windKt ?? '—'} kt, ${catText(p.windKt)}`), ref });
        out.points.push({ lat: s.lat, lng: s.lng, alt: 0.012, r: 0.45, color: c, label: s.name, tip: tip(`${STORM_CLASS[s.cls] ?? 'Storm'} ${s.name}`, `${s.windKt ?? '—'} kt · ${catText(s.windKt)}`), ref });
        if (stormCat(s.windKt) >= 1) out.rings.push({ lat: s.lat, lng: s.lng, color: c, maxR: 2.5, speed: 1.5, period: 1400 });
      }
      return out;
    },
    count: (d) => `${d.storms?.length ?? 0} storms`,
    describe(s) {
      const c = CAT_COLOUR[stormCat(s.windKt)]; const issued = Date.parse(s.issued ?? '') || Date.parse(s.at ?? '');
      const rows = s.points.map((p) => `<tr><td>${p.tau === 0 ? 'now' : `+${p.tau} h`}</td><td>${Number.isFinite(issued) ? esc(new Date(issued + p.tau * 3_600_000).toUTCString().slice(0, 22)) : ''}</td><td>${p.windKt ?? '—'} kt (${p.windKt != null ? kmh(p.windKt) : '—'} km/h)</td><td><i class="sw" style="--c:${CAT_COLOUR[stormCat(p.windKt)]}"></i>${esc(catText(p.windKt))}</td></tr>`).join('');
      return {
        title: `${STORM_CLASS[s.cls] ?? 'Storm'} ${s.name}`, sub: [s.basin, s.adv ? `advisory ${s.adv}` : '', catText(s.windKt)].filter(Boolean).join(' · '),
        rows: [
          ['Wind', s.windKt != null ? `${s.windKt} kt (${kmh(s.windKt)} km/h), sustained for one minute` : '—'],
          ['Pressure', s.pressure ? `${s.pressure} hPa` : '—'],
          ['Moving', s.moveDir != null && s.moveKt != null ? `${compass(s.moveDir)} at ${s.moveKt} kt (${kmh(s.moveKt)} km/h)` : '—'],
          ['Position', `${fmtLat(s.lat)}, ${fmtLng(s.lng)}`],
          ['Updated', s.at ? `${utc(Date.parse(s.at))} (${ago(Date.now() - Date.parse(s.at))})` : '—'],
        ],
        html: `<div class="wl" style="--c:${c}">${s.points.length ? `<h4>Forecast</h4><table class="wl-fc">${rows}</table>` : '<p class="muted">The forecast track and cone for this advisory are not in the map service yet.</p>'}
          <p class="muted">The cone holds where the <b>centre</b> is likely to be: in about two of three past storms the centre stayed inside it. Wind, rain and storm surge reach far outside it.${s.gisAdv && s.adv && s.gisAdv !== s.adv ? ` The track is from advisory ${esc(s.gisAdv)}; the status above is from advisory ${esc(s.adv)}.` : ''}</p></div>`,
        links: [...(s.url ? [{ label: 'NHC advisory', url: s.url }] : []), { label: 'National Hurricane Center', url: 'https://www.nhc.noaa.gov/' }],
        probe: [s.lat, s.lng],
      };
    },
    byId: (id) => all.find((s) => s.id === id),
    learn: {
      what: 'Every active storm the US National Hurricane Center (NHC) and its Central Pacific centre are tracking in the Atlantic and the eastern and central Pacific, in the colours of the Saffir–Simpson scale: where it is, its forecast track and points out to five days, and the white cone of uncertainty. Click a storm for its wind, pressure, motion and the forecast hour by hour.',
      how: 'Forecasters issue an advisory every six hours (more often near land) from aircraft, satellite and buoy data and many computer models. The cone is drawn from the forecast points, widening by how far off NHC’s own forecasts have been over the last five years, so the true centre stays inside it about two times in three. It says nothing about the storm’s size. Typhoons and cyclones in other oceans come from other agencies: the Alerts layer shows them.',
      try: 'In September, turn this on with Weather radar and Lightning and follow a hurricane towards the coast; open it to see when its forecast wind peaks.',
      refs: ['nhc', 'saffir'],
    },
  };
}

// ------------------------------------------------------------------ wildfire outlines
const FIRE_C = '#ff5a28';
const acresText = (a) => (a == null ? '—' : `${Math.round(a).toLocaleString()} acres (${(a * 0.0040469).toLocaleString(undefined, { maximumFractionDigits: a > 2500 ? 0 : 1 })} km²)`);
export function perimetersLayer(api) {
  let all = [];
  return {
    id: 'perimeters', group: 'live', label: 'Wildfire outlines (US)', swatch: FIRE_C, on: false, refresh: 15 * 60_000, pin: 'flame',
    sources: ['wfigs', 'livedata'],
    legend: [['flame', 'Burning', FIRE_C], ['flame', 'Mostly contained', '#ffb347'], ['flame', 'Contained', '#9aa5b1']],
    options: [{ id: 'which', label: 'Show', choices: [['wf', 'Wildfires'], ['all', 'Wildfires and prescribed burns']], value: 'wf' }],
    async load(o = {}) {
      const j = await getFeed('wfigs', wfigsUrl(), { ttl: 10 * 60_000, timeout: 30_000, snapshot: 'perimeters.json' });
      const fires = slimFires(j);
      const want = o.which ?? 'wf';
      all = fires.filter((f) => f.geometry && (want === 'all' || f.type !== 'RX')).sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0));
      const acres = all.reduce((s, f) => s + (f.acres ?? 0), 0);
      return { fires: all, statusNote: `${all.length.toLocaleString()} fires, ${Math.round(acres).toLocaleString()} acres in all${j.__via === 'snapshot' ? ' · from the live-data copy' : ''}` };
    },
    channels(d) {
      const list = d.fires ?? [];
      const colour = (f) => (f.contained >= 100 ? '#9aa5b1' : f.contained >= 60 ? '#ffb347' : FIRE_C);
      return {
        polygons: [...list].reverse().map((f) => ({ geometry: f.geometry, cap: rgba(colour(f), 0.42), side: rgba(colour(f), 0.2), stroke: colour(f), alt: 0.0035, tip: tip(f.name, `${acresText(f.acres)} · ${f.contained ?? '?'} % contained`), ref: { layer: 'perimeters', d: f } })),
        // a pin for each of the biggest fires, so they can be found from the whole-globe view
        points: list.slice(0, 120).map((f) => { const [lat, lng] = middle(f.geometry); return { lat, lng, alt: 0.01, r: 0.3, color: colour(f), tip: tip(f.name, acresText(f.acres)), ref: { layer: 'perimeters', d: f } }; }),
      };
    },
    count: (d) => `${d.fires?.length ?? 0} fires`,
    describe(f) {
      const days = f.found ? Math.max(0, Math.floor((Date.now() - f.found) / 86_400_000)) : null;
      const [lat, lng] = middle(f.geometry);
      return {
        title: f.name, sub: [FIRE_TYPE[f.type] ?? 'Fire', [f.county, f.state?.replace(/^US-/, '')].filter(Boolean).join(', '), f.contained != null ? `${f.contained} % contained` : ''].filter(Boolean).join(' · '),
        rows: [
          ['Area burned', acresText(f.acres)],
          ['Contained', f.contained != null ? `${f.contained} % of its edge` : '—'],
          ['Found', f.found ? `${utc(f.found)}${days != null ? ` (${days} day${days === 1 ? '' : 's'} ago)` : ''}` : '—'],
          ['Outline mapped', f.mapped ? `${utc(f.mapped)} (${ago(Date.now() - f.mapped)})` : '—'],
          ['Cause', f.cause ?? '—'], ['Fire behaviour', f.behaviour ?? '—'],
          ['People assigned', f.crew != null ? f.crew.toLocaleString() : '—'], ['Cost so far', f.cost ? `US$${Math.round(f.cost).toLocaleString()}` : '—'],
          ...(f.complex ? [['Part of', f.complex]] : []), ...(f.level ? [['Incident type', f.level]] : []),
        ],
        body: 'The outline is the fire’s edge as last mapped by the crews or by infrared flights, often once a day, so a fast fire can be well past it. “Contained” means a control line holds that share of the edge, not that the fire is out.',
        links: [{ label: 'InciWeb incidents', url: 'https://inciweb.wildfire.gov/' }, { label: 'NIFC open data', url: 'https://data-nifc.opendata.arcgis.com/' }],
        probe: [lat, lng],
      };
    },
    byId: (id) => all.find((f) => f.id === id),
    learn: {
      what: 'The mapped edge of every current wildfire in the United States, coloured by how much of it is contained: orange-red still burning, amber mostly held, grey contained. Click one for its size in acres and square kilometres, how long it has burned, its cause, the people on it and the cost so far.',
      how: 'Fire crews and infrared mapping flights draw each fire’s perimeter, usually once a day for big fires, and the National Interagency Fire Center (NIFC) publishes all of them as the Wildland Fire Interagency Geospatial Services (WFIGS) current perimeters. The atlas simplifies each outline to about 100 m. The Fire hotspots layer shows what satellites saw burning in the last day, worldwide, which often runs ahead of these outlines.',
      try: 'In August, turn this on with Fire hotspots and Wind: see the hotspots spill past a perimeter on its downwind side.',
      refs: ['wfigs', 'firms'],
    },
  };
}

// ------------------------------------------------------------------ restricted airspace
const AIR_C = { P: '#ff3b30', R: '#ffb020' };
export function airspaceLayer(api) {
  let all = [];
  return {
    id: 'airspace', group: 'live', label: 'Restricted airspace (US)', swatch: AIR_C.R, on: false, refresh: 6 * 3_600_000, pin: 'nofly',
    sources: ['faasua', 'livedata'],
    legend: [['nofly', 'Prohibited', AIR_C.P], ['nofly', 'Restricted', AIR_C.R]],
    options: [{ id: 'which', label: 'Show', choices: [['PR', 'Prohibited and restricted'], ['P', 'Prohibited only']], value: 'PR' }],
    async load(o = {}) {
      const j = await getFeed('faasua', suaUrl(), { ttl: 3 * 3_600_000, timeout: 30_000, snapshot: 'airspace.json' });
      const zones = slimZones(j);
      all = zones.filter((z) => z.geometry && ((o.which ?? 'PR') === 'PR' || z.type === 'P'));
      const p = all.filter((z) => z.type === 'P').length;
      return { zones: all, statusNote: `${p} prohibited and ${all.length - p} restricted areas` };
    },
    channels(d) {
      return {
        polygons: (d.zones ?? []).map((z) => ({
          geometry: z.geometry, cap: rgba(AIR_C[z.type], z.type === 'P' ? 0.32 : 0.2), side: rgba(AIR_C[z.type], 0.25), stroke: AIR_C[z.type],
          // a little taller for the higher ones, so the stack reads from an angle (not to scale: 18,000 ft would be 0.09 % of the radius)
          alt: 0.003 + Math.min(1, (z.topFt ?? 18000) / 60000) * 0.006 + (z.type === 'P' ? 0.001 : 0),
          tip: tip(z.name, `${z.type === 'P' ? 'Prohibited' : 'Restricted'} · up to ${z.top}`), ref: { layer: 'airspace', d: z },
        })),
      };
    },
    count: (d) => `${d.zones?.length ?? 0} areas`,
    describe(z) {
      const [lat, lng] = middle(z.geometry);
      return {
        title: z.name, sub: `${z.type === 'P' ? 'Prohibited area' : 'Restricted area'}${z.state ? ` · ${z.city ? `${z.city}, ` : ''}${z.state}` : ''}`,
        rows: [['From', z.bottom], ['Up to', z.top], ['In use', z.times ?? '—'], ['Controlled by', z.agency ?? '—']],
        body: z.type === 'P'
          ? 'A prohibited area is closed to all aircraft, drones included, at all times, for national security or welfare: the White House, the Capitol, some nuclear sites and presidential homes.'
          : 'A restricted area holds hazards to aircraft, such as artillery firing, missile tests or military flying. When it is active (the hours above, or by notice to pilots) aircraft need the controlling agency’s permission to enter. Temporary restrictions such as stadiums and wildfires are separate and not shown.',
        links: [{ label: 'FAA Special Use Airspace', url: 'https://sua.faa.gov/' }, { label: 'Drone rules (FAA)', url: 'https://www.faa.gov/uas' }],
        probe: [lat, lng],
      };
    },
    byId: (id) => all.find((z) => z.id === id),
    learn: {
      what: 'Airspace in the United States where aircraft and drones may not fly (red, prohibited) or need permission while it is in use (amber, restricted), from the US Federal Aviation Administration (FAA). Click an area for its floor and ceiling, when it is active and who controls it.',
      how: 'The FAA publishes its Special Use Airspace as open data. The atlas keeps only the prohibited (P) and restricted (R) areas, simplified to about 100 m. Military operations areas, alert and warning areas and temporary flight restrictions are left out, so this is not a flight-planning tool: pilots and drone flyers must check official charts and notices.',
      try: 'Fly to Washington, D.C. and find P-56 over the National Mall, then to the deserts of Nevada and New Mexico to see how much sky the test ranges hold.',
      refs: ['faasua'],
    },
  };
}

// ------------------------------------------------------------------ GPS interference
const GNSS_C = { high: '#ff3b30', medium: '#ffcc00', low: '#34c759' };
export function gnssLayer(api) {
  return {
    id: 'gnss', group: 'live', label: 'GPS interference (from aircraft)', swatch: GNSS_C.high, on: false, refresh: 10 * 60_000, pin: 'sat',
    sources: ['adsblol', 'livedata', 'gpsjam', 'cfr91227'],
    legend: [['sat', 'High (over 10 %)', GNSS_C.high], ['sat', 'Medium (2–10 %)', GNSS_C.medium], ['sat', 'Low (under 2 %)', GNSS_C.low]],
    options: [{ id: 'which', label: 'Show', choices: [['all', 'Every cell with aircraft'], ['bad', 'Medium and high only']], value: 'all' }],
    async load(o = {}) {
      const s = await getSnapshot('adsblol', 'gnss.json', { ttl: 4 * 60_000 });
      const cells = (s.cells ?? []).map(([south, west, n, k]) => ({ south, west, n, k, deg: s.deg ?? 1, ...gnssLevel(n, k) })).filter((c) => (o.which ?? 'all') === 'all' || c.level !== 'low');
      const at = Date.parse(s.generatedAt ?? '') || Date.now();
      const hot = cells.filter((c) => c.level !== 'low').length;
      return { cells, at, aircraft: s.aircraft ?? null, regions: s.regions ?? null, statusNote: `${hot} cell${hot === 1 ? '' : 's'} with poor GPS integrity, of ${cells.length} with 3 or more aircraft · ${ago(Date.now() - at)}` };
    },
    channels(d) {
      return {
        polygons: d.cells.map((c) => {
          const e = c.west + c.deg; const n = c.south + c.deg;
          return { geometry: { type: 'Polygon', coordinates: [[[c.west, c.south], [e, c.south], [e, n], [c.west, n], [c.west, c.south]]] }, cap: rgba(GNSS_C[c.level], c.level === 'low' ? 0.13 : 0.42), side: 'rgba(0,0,0,0)', stroke: c.level === 'low' ? 'rgba(0,0,0,0)' : GNSS_C[c.level], alt: 0.0025 + (c.level === 'high' ? 0.0015 : c.level === 'medium' ? 0.0008 : 0), tip: tip(`${c.k} of ${c.n} aircraft with poor GPS`, `${c.level} · ${fmtLat(c.south + c.deg / 2)}, ${fmtLng(c.west + c.deg / 2)}`), ref: { layer: 'gnss', d: c } };
        }),
      };
    },
    count: (d) => `${d.cells.filter((c) => c.level !== 'low').length} hot cells`,
    describe(c) {
      return {
        title: c.level === 'low' ? 'GPS looks normal here' : `Poor GPS integrity: ${c.level}`,
        sub: `${fmtLat(c.south)} to ${fmtLat(c.south + c.deg)}, ${fmtLng(c.west)} to ${fmtLng(c.west + c.deg)}`,
        rows: [['Aircraft seen', String(c.n)], ['Reporting poor GPS', String(c.k)], ['Share (first one discounted)', `${c.pct.toFixed(1)} %`], ['Level', c.level]],
        body: 'Each aircraft broadcasts how much it trusts its own position (in ADS-B: the integrity number NIC and the accuracy number NACp). Many aircraft in one area all reporting poor values at once usually means the satellite signals there are being jammed or spoofed, but a faulty or old transponder reports the same way, so treat a single cell as a hint, not proof. The count is a snapshot of the last few minutes, not gpsjam.org’s 24-hour map.',
        links: [{ label: 'gpsjam.org (daily map)', url: 'https://gpsjam.org/' }, { label: 'adsb.lol', url: 'https://adsb.lol/' }],
        probe: [c.south + c.deg / 2, c.west + c.deg / 2],
      };
    },
    learn: {
      what: 'Where aircraft are reporting that they cannot trust their GPS position, in 1° squares (about 110 km): red where more than one in ten aircraft does, yellow between one in fifty and one in ten, faint green where GPS looks normal. Clusters around the Baltic, the eastern Mediterranean, the Black Sea and the Middle East are usually jamming or spoofing.',
      how: 'Modern airliners broadcast their position by ADS-B along with two quality numbers: NIC (how sure the position is within a given radius) and NACp (how accurate it is). Every few minutes the live-data job asks the community network adsb.lol for the aircraft around about thirty busy or affected areas and counts, per square, the aircraft whose numbers fall below the US minimums for ADS-B (NACp under 8 or NIC under 7, God’s Eye View’s rule) or who lost GPS. The squares then use gpsjam.org’s published formula: the first bad aircraft is discounted, then under 2 % is low, 2–10 % medium and over 10 % high. Areas outside those regions are not counted.',
      try: 'Look between Kaliningrad, Poland and the Baltic states, then over Cyprus and Lebanon. Compare with gpsjam.org’s map for the day before.',
      refs: ['adsblol', 'gpsjam', 'cfr91227', 'godseye'],
    },
  };
}
