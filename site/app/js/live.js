// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — "Live now": a ticker of what is happening on the planet right now, a full feed panel,
// and a hands-free Live tour that flies from event to event. Items come from the live layers
// (earthquakes, natural events, news, flights) and are clickable pins on the globe.
import { getFeed } from './feeds.js';
import { haversineKm } from './astro.js';
import { glyphSvg } from './icons.js';
const EONET_GLYPH = { wildfires: 'flame', severeStorms: 'storm', volcanoes: 'volcano', seaLakeIce: 'ice', floods: 'water', earthquakes: 'quake', drought: 'drought', dustHaze: 'dust', landslides: 'landslide', snow: 'snow', tempExtremes: 'thermo', manmade: 'factory' };
const GDACS_GLYPH = { EQ: 'quake', TC: 'storm', FL: 'water', VO: 'volcano', WF: 'flame', DR: 'drought' };
const sym = (i) => (i.glyph ? glyphSvg(i.glyph, i.color, 18) : esc(i.icon));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const SQUAWK = { 7500: 'Hijack code', 7600: 'Radio failure', 7700: 'General emergency' };

export function installLive(api) {
  const { state, $ } = api;
  let items = []; let tour = null;

  async function collect() {
    const out = [];
    try {
      const q = await getFeed('usgs', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { ttl: 4 * 60_000 });
      for (const f of q.features) out.push({ id: f.id, t: f.properties.time, kind: 'Earthquake', icon: '◉', glyph: 'quake', color: '#f79d5c', title: `M${f.properties.mag.toFixed(1)} ${f.properties.place ?? ''}`, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], weight: f.properties.mag * 10, ref: { layer: 'quakes', d: f } });
    } catch { /* feed down */ }
    try {
      const evs = state.data.events ?? (await getFeed('eonet', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10&limit=80')).events;
      for (const e of evs) { const g = e.geometry.at(-1); if (g?.type !== 'Point') continue; out.push({ id: e.id, t: new Date(g.date).getTime(), kind: e.categories?.[0]?.title ?? 'Event', icon: '▲', glyph: EONET_GLYPH[e.categories?.[0]?.id] ?? 'alert', color: '#ff8a4c', title: e.title, lat: g.coordinates[1], lng: g.coordinates[0], weight: 30, ref: { layer: 'events', d: e } }); }
    } catch { /* feed down */ }
    for (const n of (state.data.news?.items ?? []).slice(0, 25)) out.push({ id: `n-${n.name}`, t: state.data.news.at.getTime() - 1, kind: 'In the news', icon: '✦', glyph: 'news', color: '#eef3f6', title: `${n.name}: ${n.articles[0]?.title ?? ''}`, lat: n.lat, lng: n.lng, weight: 20 + n.count, ref: { layer: 'news', d: n } });
    for (const a of state.data.aircraft?.ac ?? []) if (SQUAWK[a.squawk]) out.push({ id: `sq-${a.id}`, t: Date.now(), kind: 'Aircraft squawking', icon: '✈', glyph: 'plane', color: '#f07a63', title: `${a.call || a.id} — ${SQUAWK[a.squawk]} (${a.squawk})`, lat: a.lat, lng: a.lng, weight: 100, ref: { layer: 'aircraft', d: { ...a, src: state.data.aircraft.src } } });
    const kp = state.data.aurora?.kp; const last = Array.isArray(kp) ? kp.at(-1) : null; const kpv = last ? Number(Array.isArray(last) ? last[1] : last.Kp ?? last.kp_index) : 0;
    if (kpv >= 5) out.push({ id: 'kp', t: Date.now(), kind: 'Geomagnetic storm', icon: '✺', glyph: 'sun', color: '#7ef0a0', title: `Kp ${kpv} — aurora possible far from the poles`, lat: 65, lng: -100, weight: 90, ref: null });
    for (const l of state.data.launches ?? []) if (l.net > Date.now() - 2 * 3600_000 && l.net < Date.now() + 48 * 3600_000) out.push({ id: `l-${l.id}`, t: l.net, kind: l.live ? 'Launch — live now' : 'Rocket launch', icon: '🚀', glyph: 'rocket', color: '#ff9e5e', title: `${l.name} from ${l.site}`, lat: l.lat, lng: l.lng, weight: l.live ? 120 : 60, ref: { layer: 'launches', d: l } });
    for (const a of state.data.alerts ?? []) if (a.level === 'Red') out.push({ id: `g-${a.id}`, t: a.from ? Date.parse(`${a.from}Z`) : Date.now(), kind: 'Red disaster alert', icon: '⚠', glyph: GDACS_GLYPH[a.type] ?? 'alert', color: '#ff3b30', title: `${a.name}${a.sev ? ` — ${a.sev}` : ''}`, lat: a.lat, lng: a.lng, weight: 110, ref: { layer: 'alerts', d: a } });
    items = out.filter((i) => Number.isFinite(i.lat)).sort((a, b) => b.t - a.t).slice(0, 120);
    render();
  }

  function render() {
    const tk = $('#ticker-track'); if (!tk) return;
    const top = [...items].sort((a, b) => b.weight + b.t / 3.6e6 - (a.weight + a.t / 3.6e6)).slice(0, 18);
    tk.innerHTML = top.length ? top.map((i) => `<button data-live="${esc(i.id)}" style="--c:${i.color}"><i>${sym(i)}</i><b>${esc(i.kind)}</b> ${esc(i.title.slice(0, 90))} <small>${ago(i.t)}</small></button>`).join('') : '<span class="quiet">Waiting for live feeds…</span>';
    tk.style.animationDuration = `${Math.max(40, top.length * 7)}s`;
    $('#live-count').textContent = items.length ? `${items.length} live` : 'Live';
    if (api.isOpen('live')) openFeed();
  }

  function go(i, open = true) {
    api.globe.pointOfView({ lat: i.lat, lng: i.lng, altitude: Math.min(1.2, Math.max(0.35, state.pov.altitude)) }, api.reduceMotion ? 0 : 1800);
    if (open && i.ref) { if (i.ref.layer && !state.on.has(i.ref.layer)) api.toggleLayer(i.ref.layer, true); api.select(i.ref); }
  }

  function openFeed(filter = openFeed.filter ?? 'all') {
    openFeed.filter = filter;
    const kinds = ['all', ...new Set(items.map((i) => i.kind))];
    const list = items.filter((i) => filter === 'all' || i.kind === filter);
    api.openNotes('Live now', `
      ${api.liveOverview?.() ?? ''}
      <h4>Feed</h4>
      <p class="sub">What is happening on the planet, newest first. Click any item to fly there.</p>
      <div class="row"><button class="btn" data-livetour="start">${tour ? 'Stop live tour' : 'Start live tour'}</button><button class="btn ghost" data-wall="1">Camera wall for this view</button></div>
      <div class="opts">${kinds.map((k) => `<button class="chip" data-livefilter="${esc(k)}" aria-pressed="${k === filter}">${esc(k === 'all' ? 'Everything' : k)}</button>`).join('')}</div>
      <ol class="feed">${list.map((i) => `<li><button data-live="${esc(i.id)}" style="--c:${i.color}"><i>${sym(i)}</i><span><b>${esc(i.title)}</b><small>${esc(i.kind)} · ${ago(i.t)} · ${Math.round(haversineKm(state.pov.lat, state.pov.lng, i.lat, i.lng)).toLocaleString()} km from the view</small></span></button></li>`).join('') || '<li class="muted">Nothing yet — the feeds may still be loading.</li>'}</ol>
      <p class="muted">Sources: USGS, NASA EONET, GDELT news, ADS-B squawk codes and NOAA space weather.</p>`, 'live');
  }

  function toggleTour() {
    if (tour) { clearInterval(tour); tour = null; api.toast('Live tour stopped'); return; }
    const seq = [...items].sort((a, b) => b.weight - a.weight).slice(0, 15);
    if (!seq.length) return api.toast('No live events yet — try again in a moment');
    let k = 0; const step = () => { const i = seq[k++ % seq.length]; go(i); api.toast(`Live tour ${((k - 1) % seq.length) + 1}/${seq.length}: ${i.title.slice(0, 70)}`); };
    step(); tour = setInterval(step, 10_000);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-live],[data-livetour],[data-livefilter],[data-wall],#live-open'); if (!b) return;
    if (b.id === 'live-open') return openFeed();
    if (b.dataset.live) { const i = items.find((x) => x.id === b.dataset.live); if (i) go(i); }
    if (b.dataset.livetour) { toggleTour(); if (api.isOpen('live')) openFeed(); }
    if (b.dataset.livefilter) openFeed(b.dataset.livefilter);
    if (b.dataset.wall) api.openWall();
  });
  collect(); setInterval(collect, 3 * 60_000);
  return { collect, openFeed, stopTour: () => { if (tour) toggleTour(); } };
}
