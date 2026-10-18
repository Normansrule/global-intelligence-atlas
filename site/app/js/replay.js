// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: Replay, the last days hour by hour.
// The hourly history job (tools/build-history.mjs, branch `history`) keeps a compact frame of the live-data snapshot:
// every aircraft, every ship, the disaster alerts in force and the number of fire hotspots. This layer plays those
// frames back with a slider and a Play button under the layer in Layers, sets the app's clock to the frame's time
// (so day and night match), and adds the earthquakes of the 24 hours before each frame from the USGS catalogue,
// which answers for any past window directly.
import { getSnapshot, getFeed } from './feeds.js';
import { clock } from './clock.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const when = (t) => { const d = new Date(t); return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toISOString().slice(11, 16)} UTC`; };
const ALERT = { Red: '#ff5a4e', Orange: '#ffa94d', Green: '#7ed67e' };
const KIND = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire', TS: 'Tsunami' };
const FL_COLOURS = [['#9fd4ff', 0, 100], ['#5aa9ff', 100, 280], ['#c8a2ff', 280, 999]]; // flight levels: low, climbing, cruise

export function replayLayer(api) {
  const rs = { idx: -1, playing: null, d: null, frames: new Map(), quakes: null };
  const frameAt = (i) => rs.d?.index.frames[i];
  async function loadFrame(i) {
    const f = frameAt(i); if (!f) return null;
    if (!rs.frames.has(f.file)) {
      if (rs.frames.size > 48) rs.frames.delete(rs.frames.keys().next().value);
      rs.frames.set(f.file, getSnapshot('history', f.file, { branch: 'history', ttl: Infinity }).catch((e) => { rs.frames.delete(f.file); throw e; }));
    }
    return rs.frames.get(f.file);
  }
  const label = (f, fr) => `${when(f.t)}${f.stale ? ' (snapshot was late)' : ''} · ${(fr?.flights.rows.length ?? f.flights).toLocaleString()} aircraft${f.ships ? ` · ${f.ships.toLocaleString()} ships` : ''}${f.alerts ? ` · ${f.alerts} alert${f.alerts === 1 ? '' : 's'}` : ''}`;
  function syncPanel() {
    const f = frameAt(rs.idx); if (!f) return;
    const el = document.getElementById('replay-time'); if (el) el.textContent = label(f, rs.current);
    const sl = document.getElementById('replay-slider'); if (sl && Number(sl.value) !== rs.idx) sl.value = String(rs.idx);
  }
  async function show(i) {
    const d = rs.d; if (!d) return;
    rs.idx = Math.max(0, Math.min(d.index.frames.length - 1, i)); syncPanel();
    const want = rs.idx; const fr = await loadFrame(want);
    if (rs.d !== d || rs.idx !== want) return; // moved on meanwhile
    rs.current = fr; syncPanel();
    clock.pause(true); clock.set(fr.t); // the sun and night side follow the replayed hour
    api.refreshLayer('sun', { soft: true }); api.refreshLayer('replay', { soft: true });
  }
  function play(on) {
    clearInterval(rs.playing); rs.playing = null;
    const b = document.getElementById('replay-play'); if (b) b.textContent = on ? '❚❚ Pause' : '▶ Play';
    if (!on) return;
    let busy = false;
    rs.playing = setInterval(async () => {
      if (busy || !rs.d) return; busy = true;
      const next = (rs.idx + 1) % rs.d.index.frames.length;
      try { await show(next); loadFrame((next + 1) % rs.d.index.frames.length).catch(() => {}); } finally { busy = false; }
    }, 900);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('input', (e) => { if (e.target.id === 'replay-slider') { play(false); show(Number(e.target.value)); } });
    document.addEventListener('click', (e) => {
      if (e.target.closest('#replay-play')) play(!rs.playing);
      const s = e.target.closest('[data-replay-step]'); if (s) { play(false); show(rs.idx + Number(s.dataset.replayStep)); }
    });
  }
  async function quakesFor(index) {
    const first = index.frames[0]?.t; const last = index.frames.at(-1)?.t; if (!first) return [];
    const start = new Date(first - 86_400_000).toISOString().slice(0, 19); const end = new Date(last + 3_600_000).toISOString().slice(0, 19);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}&minmagnitude=4&orderby=time-asc&limit=4000`;
    const j = await getFeed('usgs', url, { ttl: 30 * 60_000, timeout: 30_000, proxy: false });
    return (j.features ?? []).map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], mag: f.properties.mag, place: f.properties.place, t: f.properties.time, url: f.properties.url }));
  }
  return {
    id: 'replay', group: 'live', label: 'Replay the last days', swatch: '#c8a2ff', on: false, refresh: 30 * 60_000,
    sources: ['history', 'usgs', 'opensky', 'gdacs'],
    async load() {
      const index = await getSnapshot('history', 'index.json', { branch: 'history', ttl: 10 * 60_000 });
      if (!index.frames?.length) throw new Error('the history branch has no frames yet (the History for replay workflow adds one an hour)');
      const wasLatest = !rs.d || rs.idx === rs.d.index.frames.length - 1;
      rs.d = { index };
      const i = wasLatest ? index.frames.length - 1 : Math.min(rs.idx, index.frames.length - 1);
      rs.idx = i; rs.current = await loadFrame(i);
      if (!rs.quakes) rs.quakes = quakesFor(index).catch(() => []);
      rs.d.quakes = await rs.quakes;
      clock.pause(true); clock.set(rs.current.t); api.refreshLayer('sun', { soft: true });
      const days = (index.frames.at(-1).t - index.frames[0].t) / 86_400_000;
      return { ...rs.d, statusNote: `${index.frames.length} hourly frames over ${days < 1 ? `${Math.round(days * 24)} hours` : `${days.toFixed(1)} days`}; showing ${when(rs.current.t)}` };
    },
    channels(d) {
      const fr = rs.current; if (!fr) return {};
      // aircraft by flight level and ships: memoised per frame, so stepping back to a frame reuses its buffers
      fr._particles ??= [
        ...FL_COLOURS.map(([color, lo, hi]) => ({ color, size: 1.2, pts: fr.flights.rows.filter((r) => r[2] >= lo && r[2] < hi).map((r) => ({ lat: r[0] / 100, lng: r[1] / 100, alt: 0.004 + Math.min(0.03, r[2] / 15000) })) })),
        { color: '#4aa3ff', size: 1.5, pts: fr.ships.rows.map((r) => ({ lat: r[0] / 100, lng: r[1] / 100, alt: 0.0015 })) },
      ].filter((g) => g.pts.length);
      const quakes = (d.quakes ?? []).filter((q) => q.t <= fr.t && q.t > fr.t - 86_400_000);
      const points = [
        ...quakes.map((q) => ({ lat: q.lat, lng: q.lng, alt: 0.006, r: 0.12 + (q.mag - 4) * 0.12, color: q.t > fr.t - 3_600_000 ? '#ff5a4e' : '#ffb15e', tip: tip(`M${q.mag.toFixed(1)} ${q.place ?? ''}`, `${Math.round((fr.t - q.t) / 3_600_000)} h before this frame`), ref: { layer: 'replay', d: { kind: 'quake', ...q } } })),
        ...fr.alerts.map((a) => ({ lat: a.lat, lng: a.lng, alt: 0.008, r: 0.35, color: ALERT[a.level] ?? '#e3b55b', tip: tip(a.name ?? KIND[a.type] ?? 'Disaster alert', `${a.level ?? ''} alert in force at this hour`), ref: { layer: 'replay', d: { kind: 'alert', t: fr.t, ...a } } })),
      ];
      return { particles: fr._particles, points };
    },
    count: (d) => `${d.index.frames.length} hours`,
    describe(x) {
      if (x.kind === 'quake') return { title: `Magnitude ${x.mag.toFixed(1)} earthquake`, sub: x.place ?? '', rows: [['Time', when(x.t)], ['Depth', `${Math.round(x.depth)} km`]], links: x.url ? [{ label: 'USGS event page', url: x.url }] : [] };
      return { title: x.name ?? KIND[x.type] ?? 'Disaster alert', sub: `${x.level ?? ''} ${KIND[x.type] ?? ''} alert`.trim(), rows: [['In force at', when(x.t)], ['Country', x.country ?? '—']], body: 'Alerts from GDACS, the Global Disaster Alert and Coordination System, as they stood at this hour.' };
    },
    panel: (d) => (d ? `<div class="radarctl replayctl"><button class="btn ghost" id="replay-play" type="button">${rs.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <input type="range" id="replay-slider" min="0" max="${d.index.frames.length - 1}" step="1" value="${rs.idx}" aria-label="Replay time" />
      <span class="replay-steps"><button class="btn ghost" type="button" data-replay-step="-1" aria-label="One hour back">−1 h</button><button class="btn ghost" type="button" data-replay-step="1" aria-label="One hour on">+1 h</button></span>
      <small id="replay-time">${esc(label(frameAt(rs.idx), rs.current))}</small></div>` : ''),
    stop: () => { play(false); clock.live(); api.refreshLayer('sun', { soft: true }); },
    describeLayer: (d) => ({ rows: [['Frames', `${d.index.frames.length}, hourly, kept ${d.index.days} days`], ['Showing', when(rs.current?.t)], ['Earthquakes', `${(d.quakes ?? []).length} of magnitude 4 or more in the window (USGS)`]] }),
    learn: {
      what: 'The last two weeks, hour by hour: every aircraft (coloured by height), every ship, the disaster alerts in force and the earthquakes of the previous 24 hours. Drag the slider under this layer in Layers, or press Play; the day and night side of the globe follow the replayed hour.',
      how: 'A GitHub Action saves a compact copy of the live-data snapshot every hour on the `history` branch and drops copies older than 14 days. Positions are rounded to about a kilometre, which is plenty at globe scale and keeps each hour to about 200 KB. Earthquakes come straight from the USGS catalogue, which can be asked about any past window. Turning the layer off returns the clock to now.',
      try: 'Press Play and watch the wave of transatlantic flights cross the ocean each night, then find the hour a big earthquake struck and look at the alerts that followed.',
      refs: ['history', 'usgs', 'gdacs', 'opensky', 'keplergl', 'movingpandas'],
    },
  };
}
