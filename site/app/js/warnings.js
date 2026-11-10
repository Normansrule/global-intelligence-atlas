// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: United States weather warnings, watches and advisories from the National Weather Service
// (NWS), drawn as the exact areas they cover, in the NWS map colours.
//
// api.weather.gov/alerts/active gives every live alert as GeoJSON. Storm-based warnings (tornado, severe thunderstorm,
// flash flood, special marine) carry their own polygon. Others (winter storms, heat, wind, fire weather, floods by
// county) name forecast zones instead; the layer fetches those zones' outlines (each cached for a day, at most 160
// per load) so they are drawn too. When the browser cannot reach the service, the live-data snapshot (nws.json, made by
// tools/fetch-live.mjs every few minutes with the zone outlines already filled in) is used.
// The page for an alert: what it is in plain words, how serious, how sure and how soon (the Common Alerting Protocol,
// CAP, fields explained), the time left, which cities and how many people are inside it, what to do, the full text,
// and other alerts touching the same area.
import { getFeed, getSnapshot, getLocal } from './feeds.js';
import { GLYPHS } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
export const NWS_ACTIVE = 'https://api.weather.gov/alerts/active?status=actual';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sense]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/sense.css', import.meta.url).href; l.dataset.sense = '1'; document.head.appendChild(l); }

GLYPHS.warn ??= [
  ['M12 2.4c.6 0 1.1.3 1.4.8l9 16.4c.6 1.1-.2 2.4-1.4 2.4H3c-1.2 0-2-1.3-1.4-2.4l9-16.4c.3-.5.8-.8 1.4-.8z', 'c'],
  ['M7 16.2c1.6-1.4 3.4-1.4 5 0s3.4 1.4 5 0v1.8c-1.6 1.4-3.4 1.4-5 0s-3.4-1.4-5 0zM12.9 6.6l-3.2 5h2.4l-1 3.6 3.4-5.2h-2.4z', 'd'],
];

/** The NWS hazard map colours (weather.gov/help-map) for the common alerts; others fall back to their severity. */
export const NWS_COLOURS = {
  'Tornado Warning': '#FF0000', 'Tornado Watch': '#FFFF00', 'Severe Thunderstorm Warning': '#FFA500', 'Severe Thunderstorm Watch': '#DB7093',
  'Flash Flood Warning': '#8B0000', 'Flash Flood Watch': '#2E8B57', 'Flood Warning': '#00FF00', 'Flood Watch': '#2E8B57', 'Flood Advisory': '#00FF7F',
  'Coastal Flood Warning': '#228B22', 'Coastal Flood Advisory': '#7CFC00', 'Hurricane Warning': '#DC143C', 'Hurricane Watch': '#FF00FF',
  'Tropical Storm Warning': '#B22222', 'Tropical Storm Watch': '#F08080', 'Storm Surge Warning': '#B524F7', 'Extreme Wind Warning': '#FF8C00',
  'Blizzard Warning': '#FF4500', 'Winter Storm Warning': '#FF69B4', 'Winter Storm Watch': '#4682B4', 'Ice Storm Warning': '#8B008B',
  'Winter Weather Advisory': '#7B68EE', 'Lake Effect Snow Warning': '#008B8B', 'Extreme Cold Warning': '#0000FF', 'Cold Weather Advisory': '#AFEEEE',
  'Wind Chill Warning': '#B0C4DE', 'Wind Chill Advisory': '#AFEEEE', 'Freeze Warning': '#483D8B', 'Frost Advisory': '#6495ED',
  'Extreme Heat Warning': '#C71585', 'Excessive Heat Warning': '#C71585', 'Heat Advisory': '#FF7F50', 'Extreme Heat Watch': '#800000',
  'Red Flag Warning': '#FF1493', 'Fire Weather Watch': '#FFDEAD', 'High Wind Warning': '#DAA520', 'High Wind Watch': '#B8860B', 'Wind Advisory': '#D2B48C',
  'Dense Fog Advisory': '#708090', 'Dust Storm Warning': '#FFE4C4', 'Air Quality Alert': '#808080', 'Special Weather Statement': '#FFE4B5',
  'Gale Warning': '#DDA0DD', 'Storm Warning': '#9400D3', 'Small Craft Advisory': '#D8BFD8', 'Special Marine Warning': '#FFA500',
  'Hazardous Seas Warning': '#D8BFD8', 'Rip Current Statement': '#40E0D0', 'Beach Hazards Statement': '#40E0D0', 'Tsunami Warning': '#FD6347', 'Tsunami Advisory': '#D2691E',
};
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const BY_SEVERITY = { Extreme: '#d0233a', Severe: '#f07a2c', Moderate: '#e6c93a', Minor: '#7fb2e5', Unknown: '#9aa5b1' };
export const alertColour = (p) => NWS_COLOURS[p?.event] ?? BY_SEVERITY[p?.severity] ?? BY_SEVERITY.Unknown;

/** Kinds for the legend and the filter: [id, label, colour, test]. */
export const KINDS = [
  ['tornado', 'Tornado', '#FF0000', (e) => /tornado/i.test(e)],
  ['storm', 'Thunderstorm', '#FFA500', (e) => /thunderstorm|special marine/i.test(e)],
  ['flood', 'Flood', '#00C850', (e) => /flood/i.test(e)],
  ['tropical', 'Hurricane or tropical storm', '#DC143C', (e) => /hurricane|tropical|surge|typhoon/i.test(e)],
  ['winter', 'Snow, ice and cold', '#FF69B4', (e) => /winter|blizzard|ice|snow|cold|chill|freeze|frost/i.test(e)],
  ['heat', 'Heat', '#FF7F50', (e) => /heat/i.test(e)],
  ['fire', 'Fire weather', '#FF1493', (e) => /red flag|fire/i.test(e)],
  ['wind', 'Wind, dust and fog', '#DAA520', (e) => /wind|dust|fog|smoke/i.test(e)],
  ['marine', 'Sea and coast', '#40E0D0', (e) => /gale|craft|seas|rip|beach|marine|tsunami|storm warning/i.test(e)],
  ['other', 'Other', '#9aa5b1', () => true],
];
export const kindOf = (event) => KINDS.find((k) => k[3](event ?? ''));

/** What the three Common Alerting Protocol (CAP) words mean, in plain English. */
export const CAP = {
  severity: { Extreme: 'extraordinary threat to life or property', Severe: 'significant threat to life or property', Moderate: 'possible threat to life or property', Minor: 'minimal to no known threat', Unknown: 'not stated' },
  urgency: { Immediate: 'act now', Expected: 'act within the next hour', Future: 'act in the near future', Past: 'no longer needed', Unknown: 'not stated' },
  certainty: { Observed: 'happening now, seen or measured', Likely: 'more likely than not (over 50 %)', Possible: 'possible but not likely', Unlikely: 'not expected', Unknown: 'not stated' },
};

/** "2 h 40 min left" / "ended" / "starts in 3 h" for an alert's onset and end. */
export function timeLeft(p, now = Date.now()) {
  const end = Date.parse(p.ends ?? p.expires ?? ''); const start = Date.parse(p.onset ?? p.effective ?? '');
  const span = (ms) => { const m = Math.round(ms / 60_000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(h / 24)} days`; };
  if (Number.isFinite(start) && start > now) return { text: `starts in ${span(start - now)}`, state: 'future' };
  if (Number.isFinite(end)) return end > now ? { text: `${span(end - now)} left`, state: 'now', frac: Number.isFinite(start) ? (now - start) / Math.max(1, end - start) : null } : { text: 'ended', state: 'past' };
  return { text: 'until further notice', state: 'now' };
}

/** Ray-casting point-in-polygon on one GeoJSON Polygon or MultiPolygon ([lng, lat] rings). */
export function inGeometry(g, lat, lng) {
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const rings of polys) {
    let inside = false;
    rings.forEach((ring, ri) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; }
      if (ri === 0) inside = c; else if (c) inside = false; // holes
    });
    if (inside) return true;
  }
  return false;
}
/** The bounding box [minLat, minLng, maxLat, maxLng] of a geometry. */
export function bbox(g) {
  let a = 90; let b = 180; let c = -90; let d = -180;
  const walk = (x) => { if (typeof x[0] === 'number') { b = Math.min(b, x[0]); d = Math.max(d, x[0]); a = Math.min(a, x[1]); c = Math.max(c, x[1]); } else x.forEach(walk); };
  if (g?.coordinates) walk(g.coordinates);
  return [a, b, c, d];
}
/** Cities (cities.json rows) inside an alert's area, biggest first, and how many people they hold. */
export function citiesInside(g, rows) {
  const [a, b, c, d] = bbox(g); const out = [];
  for (const r of rows ?? []) { if (r[1] < a || r[1] > c || r[2] < b || r[2] > d) continue; if (inGeometry(g, r[1], r[2])) out.push(r); }
  out.sort((x, y) => y[3] - x[3]);
  return { list: out, people: out.reduce((s, r) => s + (r[3] || 0), 0) };
}

/** One alert in the compact form the layer and the snapshot both use. */
export const slim = (f) => {
  const p = f.properties ?? {};
  return { id: p.id ?? f.id, event: p.event, headline: p.headline, nwsHeadline: p.parameters?.NWSheadline?.[0] ?? '', area: p.areaDesc, severity: p.severity, urgency: p.urgency, certainty: p.certainty, sent: p.sent, effective: p.effective, onset: p.onset, expires: p.expires, ends: p.ends, sender: p.senderName, description: p.description, instruction: p.instruction, response: p.response, zones: p.affectedZones ?? [], geometry: f.geometry ?? null, messageType: p.messageType };
};

/** Fill in missing outlines from the alerts' forecast zones (at most `max` zone requests). */
export async function fillZones(alerts, fetchZone, { max = 160 } = {}) {
  const need = new Map();
  for (const a of alerts) if (!a.geometry) for (const z of a.zones) if (!need.has(z) && need.size < max) need.set(z, null);
  const urls = [...need.keys()];
  for (let i = 0; i < urls.length; i += 8) await Promise.all(urls.slice(i, i + 8).map(async (u) => { try { need.set(u, (await fetchZone(u))?.geometry ?? null); } catch { /* zone missing */ } }));
  for (const a of alerts) {
    if (a.geometry) continue;
    const polys = [];
    for (const z of a.zones) { const g = need.get(z); if (g?.type === 'Polygon') polys.push(g.coordinates); else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates); }
    if (polys.length) { a.geometry = { type: 'MultiPolygon', coordinates: polys }; a.fromZones = true; }
  }
  return alerts;
}

/** The order alerts are drawn and listed: the most serious and most urgent first. */
const RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
export const byRank = (x, y) => (RANK[y.severity] ?? 0) - (RANK[x.severity] ?? 0) || (/warning/i.test(y.event) - /warning/i.test(x.event));

export function warningsLayer(api) {
  let all = []; let cities = null;
  // "Also here" chips open the other alert's page
  if (typeof document !== 'undefined' && api.select) document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-warning]'); if (!b) return; const d = all.find((a) => a.id === b.dataset.warning); if (d) api.select({ layer: 'warnings', d }); });
  return {
    id: 'warnings', group: 'live', label: 'US weather warnings', swatch: '#ff4d4d', refresh: 5 * 60_000, pin: 'warn',
    sources: ['nwsapi', 'livedata', 'cap12'],
    legend: KINDS.slice(0, -1).map(([, label, c]) => ['warn', label, c]),
    options: [{ id: 'which', label: 'Show', choices: [['warn', 'Warnings only'], ['warnwatch', 'Warnings and watches'], ['all', 'Every alert, advisories too']], value: 'warnwatch' }],
    async load(o = {}) {
      let alerts; let src = 'live';
      try {
        const j = await getFeed('nwsapi', NWS_ACTIVE, { ttl: 4 * 60_000, timeout: 25_000 });
        alerts = (j.features ?? []).map(slim);
        await fillZones(alerts, (u) => getFeed('nwsapi', u, { ttl: 86_400_000, timeout: 15_000 }));
      } catch {
        const s = await getSnapshot('nwsapi', 'nws.json', { ttl: 4 * 60_000 });
        alerts = s.alerts ?? []; src = 'snapshot';
      }
      const now = Date.now();
      const want = o.which ?? 'warnwatch';
      all = alerts.filter((a) => a.geometry && timeLeft(a, now).state !== 'past' && (want === 'all' || /warning/i.test(a.event) || (want === 'warnwatch' && /watch/i.test(a.event)))).sort(byRank);
      const n = all.length; const total = alerts.length;
      return { alerts: all, src, total, statusNote: `${n.toLocaleString()} drawn of ${total.toLocaleString()} active alerts${src === 'snapshot' ? ' · from the live-data snapshot' : ''}` };
    },
    channels(d) {
      const list = d.alerts ?? [];
      return {
        // the least serious first, so the worst ones sit on top
        polygons: [...list].reverse().map((a, i) => {
          const c = alertColour(a); const strong = /warning/i.test(a.event);
          return { geometry: a.geometry, cap: rgba(c, strong ? 0.34 : 0.19), side: rgba(c, 0.14), stroke: c, alt: 0.004 + (list.length - i) * 0.00002 + (strong ? 0.002 : 0), tip: tip(a.event, a.area?.split(';').slice(0, 3).join(', ')), ref: { layer: 'warnings', d: a } };
        }),
      };
    },
    describe(a) {
      const c = alertColour(a); const t = timeLeft(a); const k = kindOf(a.event);
      const [la, lo, hi, ln] = bbox(a.geometry);
      const near = all.filter((o) => o !== a && o.zones.some((z) => a.zones.includes(z))).slice(0, 6);
      const capRow = (key, label) => (a[key] ? `<div class="wn-cap"><small>${label}</small><b>${esc(a[key])}</b><span>${esc(CAP[key][a[key]] ?? '')}</span></div>` : '');
      const areas = String(a.area ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      return {
        title: a.event, sub: [t.text, a.sender].filter(Boolean).join(' · '),
        probe: [(la + hi) / 2, (lo + ln) / 2],
        html: `<div class="wn" style="--c:${c}">
          <div class="wn-band"><span class="wn-kind">${esc(k[1])}</span><span class="wn-left ${t.state}">${esc(t.text)}</span>${t.frac != null ? `<i class="wn-prog" style="--p:${Math.min(100, Math.max(0, t.frac * 100)).toFixed(0)}%"></i>` : ''}</div>
          ${a.nwsHeadline || a.headline ? `<p class="wn-head">${esc(a.nwsHeadline || a.headline)}</p>` : ''}
          <div class="wn-caps">${capRow('severity', 'How serious')}${capRow('urgency', 'How soon')}${capRow('certainty', 'How sure')}</div>
          <div id="wn-people" class="wn-people muted">Counting the cities inside…</div>
          ${a.instruction ? `<div class="wn-do"><h4>What to do</h4><p>${esc(a.instruction).replace(/\n\n/g, '</p><p>').replace(/\n/g, ' ')}</p></div>` : ''}
          ${near.length ? `<div class="wn-near"><small>Also here</small>${near.map((o) => `<button class="chip" data-warning="${esc(o.id)}" style="--c:${alertColour(o)}"><i></i>${esc(o.event)}</button>`).join('')}</div>` : ''}
          <details class="wn-more"><summary>The full text, ${areas.length} area${areas.length === 1 ? '' : 's'}${a.fromZones ? ' (outlined by forecast zone)' : ''}</summary>
            <p class="wn-text">${esc(a.description ?? '').replace(/\n\n/g, '</p><p class="wn-text">').replace(/\n/g, ' ')}</p>
            <p class="muted">${esc(areas.join(' · '))}</p>
            <p class="muted">Issued ${a.sent ? esc(new Date(a.sent).toUTCString().replace(':00 GMT', ' UTC')) : '—'}${a.expires ? ` · message expires ${esc(new Date(a.expires).toUTCString().replace(':00 GMT', ' UTC'))}` : ''}. Source: US National Weather Service. Always follow local officials.</p>
          </details></div>`,
        links: [{ label: 'NWS alert', url: String(a.id).startsWith('https://api.weather.gov/') ? a.id : `https://api.weather.gov/alerts/${encodeURIComponent(a.id)}` }, { label: 'weather.gov', url: `https://forecast.weather.gov/MapClick.php?lat=${((la + hi) / 2).toFixed(3)}&lon=${((lo + ln) / 2).toFixed(3)}` }],
        async fill(stillOpen) {
          try {
            cities ??= (await getLocal('data/cities.json')).rows;
            const { list, people } = citiesInside(a.geometry, cities);
            const el = api.$('#wn-people'); if (!el || !stillOpen()) return;
            el.classList.remove('muted');
            el.innerHTML = list.length ? `<b>${list.length} cit${list.length === 1 ? 'y' : 'ies'} inside</b>, about ${people >= 1e6 ? `${(people / 1e6).toFixed(1)} million` : people.toLocaleString()} people: ${list.slice(0, 6).map((r) => esc(r[0])).join(', ')}${list.length > 6 ? ` and ${list.length - 6} more` : ''}.` : 'No large city inside this area.';
          } catch { /* the count is extra */ }
        },
      };
    },
    byId: (id) => all.find((a) => a.id === id),
    learn: {
      what: 'Every live weather warning, watch and advisory in the United States from the National Weather Service (NWS), drawn as the exact area it covers in the NWS map colours: red tornado warnings, orange severe thunderstorms, dark red flash floods, pink winter storms, coral heat and more. Warnings mean it is happening or about to; watches mean conditions are right for it. Click an area for its page: how serious, how soon and how sure in plain words, the time left, the cities and people inside, what to do and the full text.',
      how: 'The NWS publishes every alert as it is issued in the Common Alerting Protocol (CAP) through api.weather.gov. Storm-based warnings carry their own polygon; the others name forecast zones, whose outlines the layer looks up. The people count adds up the cities inside the area from Natural Earth, so it leaves out towns and rural homes. The atlas is not a warning system: always follow local officials.',
      try: 'On a stormy spring afternoon in the Great Plains, turn on Live weather radar too and watch tornado warnings sit on top of the storms; switch the filter to "Every alert" to see wind, frost and marine advisories fill in.',
      refs: ['nwsapi', 'cap12'],
    },
  };
}
