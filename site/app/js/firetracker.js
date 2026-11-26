// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.39: the wildfire tracker's pages. Click any fire hot spot and its card becomes the page
// of the whole fire it belongs to (wildfire.js): how big it is, which way and how fast it is spreading, the fire
// weather, a map that plays its spread back pass by pass (and plays it on the globe at the same time), and a button
// to stand on the ground and watch it (fireview.js). Tools → Wildfire tracker lists the biggest fires burning now.
// The 7 days come from the live-data bot's fires-spread.json; without it, the live layer's 24 hours are used.
import { getFeed, getSnapshot } from './feeds.js';
import { cities } from './citydetail.js';
import { haversineKm, bearingDeg } from './astro.js';
import { clusterFires, mergeFires, unpackSpread, spread, spreadWords, passes, fireSvg, ageLegend, ageColor, topFires, maybeIndustrial, hull, toKm, fromKm, tMs, dirWord, viewpoint } from './wildfire.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const HOUR = 36e5;
const when = (t) => `${new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23' })} UTC`;
const ago = (ms) => { const h = ms / HOUR; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto`;

/** Shared state: the tracked fire, the playback time, the weather there. */
export const track = { fire: null, t: null, playing: false, timer: 0, wind: null, all: null, at: 0, src: '' };

/** All fires: the bot's 7 days merged with the live 24 hours (cached for 10 minutes). */
export async function allFires(liveRows) {
  if (track.all && Date.now() - track.at < 10 * 60_000) return track.all;
  let spreadFires = []; track.src = 'the last 24 hours';
  try { const j = await getSnapshot('firms', 'fires-spread.json', { ttl: 30 * 60_000 }); spreadFires = unpackSpread(j); if (spreadFires.length) track.src = 'up to 7 days'; } catch { /* the 24 hours alone */ }
  track.all = spreadFires.length ? mergeFires(spreadFires, liveRows) : clusterFires(liveRows ?? []); track.at = Date.now();
  return track.all;
}
/** The fire a hot spot belongs to. */
export function fireOf(fires, r) {
  return fires.find((f) => f.rows.includes(r)) ?? fires.find((f) => f.rows.some((q) => q[0] === r[0] && q[1] === r[1] && q[4] === r[4]))
    ?? [...fires].sort((a, b) => haversineKm(a.lat, a.lng, r[0], r[1]) - haversineKm(b.lat, b.lng, r[0], r[1]))[0];
}

function nearWords(list, lat, lng) {
  const near = list.map((c) => [c, haversineKm(lat, lng, c.lat, c.lng)]).sort((a, b) => a[1] - b[1])[0];
  if (!near) return '';
  return near[1] < 8 ? `at ${esc(near[0].name)}` : `${fmt(near[1])} km ${dirWord(bearingDeg(near[0].lat, near[0].lng, lat, lng))} of ${esc(near[0].name)}`;
}

/** The fire page, filled into #wf-track. */
export async function fillTrack(r, { stillOpen, liveRows, refresh }) {
  const host = () => document.getElementById('wf-track');
  const fires = await allFires(liveRows); if (!stillOpen() || !host()) return;
  const f = fireOf(fires, r); if (!f) { host().innerHTML = ''; return; }
  stop(); Object.assign(track, { fire: f, t: f.last, refresh });
  const [list, w] = await Promise.all([cities().catch(() => []), getFeed('openmeteo', wxUrl(f.lat, f.lng), { ttl: 15 * 60_000 }).catch(() => null)]);
  if (!stillOpen() || !host()) return;
  const cur = w?.current; track.wind = cur ? { speed: cur.wind_speed_10m, from: cur.wind_direction_10m, gust: cur.wind_gusts_10m } : null;
  const sp = spread(f); const ps = passes(f.rows); const now = Date.now();
  const flare = maybeIndustrial(f);
  const windTxt = cur ? `Wind ${fmt(cur.wind_speed_10m)} km/h from the ${dirWord(cur.wind_direction_10m)}${cur.wind_gusts_10m > cur.wind_speed_10m + 10 ? `, gusts ${fmt(cur.wind_gusts_10m)}` : ''}; it pushes fire and smoke towards the ${dirWord(cur.wind_direction_10m + 180)}. Humidity ${fmt(cur.relative_humidity_2m)} %${cur.relative_humidity_2m < 25 ? ' (very dry: fire weather)' : ''}, ${fmt(cur.temperature_2m)} °C.` : 'Fire weather did not load.';
  host().innerHTML = `
    <div class="wf-head"><p class="sub">${nearWords(list, f.lat, f.lng)}${flare ? ' · <b>may be an industrial heat source</b> (small, and in the same place on every pass)' : ''}</p>
    <div class="wf-figs">
      <span><b>${fmt(f.areaKm2, f.areaKm2 < 10 ? 1 : 0)} km²</b><small>seen burning</small></span>
      <span><b>${fmt(f.n)}</b><small>hot spots</small></span>
      <span><b>${fmt(f.frp)} MW</b><small>heat, all passes</small></span>
      <span><b class="wf-trend wf-${sp.trend.replace(' ', '-')}">${esc(sp.trend)}</b><small>last seen ${ago(now - f.last)}</small></span>
    </div></div>
    <p>${esc(spreadWords(f, sp))}</p>
    <p class="muted">${esc(windTxt)}</p>
    <div class="wf-play">
      <div id="wf-map">${fireSvg(f, f.last)}</div>
      <div class="wf-ctl"><button class="btn" data-wf-play="1" aria-label="Play the spread">▶ Play the spread</button>
        <input type="range" id="wf-t" min="0" max="${ps.length - 1}" value="${ps.length - 1}" step="1" aria-label="Satellite pass">
        <output id="wf-when">${when(f.last)} · pass ${ps.length} of ${ps.length}</output></div>
      ${ageLegend((now - f.first) / HOUR)}
    </div>
    <p class="muted">From ${esc(track.src)} of NASA FIRMS hot spots: ${ps.length} satellite pass${ps.length === 1 ? '' : 'es'} since ${when(f.first)}. Each square is one 375 m pixel where the satellite saw a fire; the line is the outer edge of all of them, the dashed line the edge a day earlier. Cloud and thick smoke can hide a fire from a pass.</p>
    <h4>See it in person</h4>
    <p class="muted">Stand on the real ground 1.5 km from the edge of the part burning now and look at it: the flames where satellites saw it burning in the 12 hours before its last pass, the glow of the fire line, smoke drifting with the wind, the ground already burnt. Choose which side to stand on.</p>
    <div class="row wf-sides" role="group" aria-label="Which side to stand on">${[['north', 0], ['east', 90], ['south', 180], ['west', 270]].map(([n, deg]) => `<button class="btn ghost" data-wf-stand="${deg}">From the ${n}</button>`).join('')}</div>
    <div id="wf-view" class="wf-view" hidden></div>`;
  refresh?.();
}

function setT(i) {
  const f = track.fire; if (!f) return; const ps = passes(f.rows); const p = ps[Math.max(0, Math.min(ps.length - 1, i))];
  track.t = i >= ps.length - 1 ? f.last : p.t + 50 * 60_000;
  const map = document.getElementById('wf-map'); if (map) map.innerHTML = fireSvg(f, track.t);
  const out = document.getElementById('wf-when'); if (out) out.textContent = `${when(p.t)} · pass ${i + 1} of ${ps.length}`;
  const s = document.getElementById('wf-t'); if (s && +s.value !== i) s.value = String(i);
  track.refresh?.();
}
function stop() { clearInterval(track.timer); track.timer = 0; track.playing = false; const b = document.querySelector('[data-wf-play]'); if (b) b.textContent = '▶ Play the spread'; }
function play() {
  const f = track.fire; if (!f) return; const n = passes(f.rows).length; if (n < 2) return;
  if (track.playing) return stop();
  track.playing = true; let i = 0; setT(0);
  const b = document.querySelector('[data-wf-play]'); if (b) b.textContent = '❚❚ Pause';
  track.timer = setInterval(() => { i += 1; if (i >= n || !document.getElementById('wf-map')) { stop(); setT(n - 1); return; } setT(i); }, reduceMotion ? 1400 : 700);
}

/** The tracked fire on the globe: its detections up to the playback time coloured by age, and its outline. */
export function trackOverlay(selectedRow) {
  const f = track.fire; if (!f || !selectedRow || !f.rows.includes(selectedRow) && fireOf([f], selectedRow) !== f) return null;
  const t = track.t ?? f.last;
  const shown = f.rows.filter((r) => tMs(r) <= t);
  const h = hull(shown.map((r) => toKm(f.lat, f.lng, r[0], r[1])));
  const ring = h.length >= 3 ? [...h, h[0]].map(([x, y]) => { const [la, lo] = fromKm(f.lat, f.lng, x, y); return [la, lo, 0.0016]; }) : null;
  return {
    points: shown.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0015, r: 0.03, color: ageColor((t - tMs(r)) / HOUR), label: '', ref: { layer: 'fires', d: r } })),
    paths: ring ? [{ pts: ring, color: '#ffd37a', stroke: 1.4 }] : [],
  };
}

/** Tools → Wildfire tracker: the biggest fires burning now. */
export async function biggestHtml(liveRows) {
  const fires = await allFires(liveRows); const list = await cities().catch(() => []);
  const top = topFires(fires, 15);
  if (!top.length) return '<p class="muted">No fire hot spots have loaded yet. Turn on Fire hotspots in Layers and try again.</p>';
  return `<p class="muted">The 15 fires giving off the most heat that burned in the last 36 hours, from NASA FIRMS (${esc(track.src)}). Click one for its page, its spread and a view from the ground.</p>
    <ol class="wf-top">${top.map((f) => { const sp = spread(f); return `<li><button class="tour-card" data-wf-fire="${f.id}"><b>${nearWords(list, f.lat, f.lng) || `${f.lat.toFixed(2)}°, ${f.lng.toFixed(2)}°`}</b><span>${fmt(f.areaKm2, f.areaKm2 < 10 ? 1 : 0)} km² · ${fmt(f.n)} hot spots · ${esc(sp.trend)}${sp.move && sp.move.km >= 0.5 ? ` · spreading ${dirWord(sp.move.bearing)}` : ''} · last seen ${ago(Date.now() - f.last)}</span></button></li>`; }).join('')}</ol>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-wf-play]')) play();
    const st = e.target.closest('[data-wf-stand]');
    if (st && track.fire) {
      const host = document.getElementById('wf-view'); if (!host) return;
      host.hidden = false; document.querySelectorAll('[data-wf-stand]').forEach((b) => b.setAttribute('aria-pressed', String(b === st)));
      import('./fireview.js').then((m) => { track.view?.dispose?.(); track.view = m.mountFireView(host, { fire: track.fire, side: +st.dataset.wfStand, wind: track.wind }); window.gia && (window.gia.fireview = track.view); });
    }
    const fb = e.target.closest('[data-wf-fire]');
    if (fb && track.all) {
      const f = track.all.find((x) => x.id === fb.dataset.wfFire); const g = window.gia; if (!f || !g) return;
      const go = () => { g.select({ layer: 'fires', d: f.peak }); g.globe.pointOfView({ lat: f.lat, lng: f.lng, altitude: 0.06 }, reduceMotion ? 0 : 1600); };
      if (!g.state.on.has('fires')) { g.toggleLayer('fires', true); setTimeout(go, 800); } else go();
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'wf-t') { stop(); setT(+e.target.value); } });
}
export { viewpoint };
