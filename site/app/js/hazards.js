// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: fire hotspots and weather radar.
//  • Fire hotspots: NASA FIRMS (Fire Information for Resource Management System) active fires seen by the VIIRS
//    (Visible Infrared Imaging Radiometer Suite) instrument in the last 24 hours. Browsers read the copy the
//    live-data job saves every 30 minutes; the desktop app reads NASA's public file directly.
//  • Weather radar: RainViewer's global radar mosaic for the past two hours in 10-minute frames, wrapped on a
//    transparent shell just above the ground, with a time slider and a play button in the Layers panel.
import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed, getSnapshot, isDesktop } from './feeds.js';
import { fmtLat, fmtLng, haversineKm } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const ago = (ms) => { const m = Math.round(ms / 60_000); return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// --------------------------------------------------------------- fire hotspots (NASA FIRMS)
const FIRMS_PUBLIC = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';
const CONF = ['low', 'nominal', 'high'];
/** Same compact rows as tools/fetch-live.mjs: [lat, lng, frp MW, confidence 0–2, minutes since 1970, day 1|0]. */
export function parseFirms(csv) {
  const [head, ...lines] = csv.trim().split('\n'); const h = head.split(',').map((x) => x.trim()); const c = Object.fromEntries(h.map((x, i) => [x, i]));
  const conf = (v) => { const s = String(v).trim().toLowerCase(); if (/^\d+$/.test(s)) return Number(s) >= 80 ? 2 : Number(s) >= 30 ? 1 : 0; return s[0] === 'h' ? 2 : s[0] === 'l' ? 0 : 1; };
  const rows = [];
  for (const l of lines) {
    const f = l.split(','); const lat = Number(f[c.latitude]); const lng = Number(f[c.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const t = String(f[c.acq_time] ?? '0').padStart(4, '0'); const at = Date.parse(`${f[c.acq_date]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
    rows.push([lat, lng, Number(f[c.frp]) || 0, conf(f[c.confidence]), Number.isFinite(at) ? Math.round(at / 60_000) : null, f[c.daynight] === 'N' ? 0 : 1]);
  }
  return rows;
}
// Colour by fire radiative power (megawatts): a smouldering field burn is a few MW, a large wildfire front hundreds.
const frpColor = (frp) => (frp >= 100 ? '#fff1a8' : frp >= 20 ? '#ffb340' : '#ff5a36');
const inView = (v, lat, lng) => Math.abs(lat - v.lat) * 111 < v.radiusKm && haversineKm(v.lat, v.lng, lat, lng) < v.radiusKm;

/** Every hotspot of the last 24 hours, from the live-data snapshot (or NASA directly in the desktop app). Shared by the
 *  fire hotspots layer and the fire glow and smoke in skyfx.js, so both draw the same fires from one cached download. */
export async function loadFireRows() {
  if (isDesktop) {
    const rows = parseFirms(await getFeed('firms', FIRMS_PUBLIC, { type: 'text', ttl: 30 * 60_000, timeout: 90_000 }));
    return { rows, src: 'NASA FIRMS · VIIRS NOAA-20, global 24 hours (live)', at: Date.now() };
  }
  const j = await getSnapshot('firms', 'fires.json', { ttl: 10 * 60_000 });
  return { rows: j.rows, src: j.src, at: Date.parse(j.generatedAt) };
}

export function firesLayer() {
  return {
    id: 'fires', group: 'live', label: 'Fire hotspots (NASA FIRMS)', swatch: '#ff7a3c', on: false, refresh: 15 * 60_000, viewDependent: true, pin: 'flame',
    sources: ['firms', 'livedata'],
    options: [{ id: 'conf', label: 'Confidence', choices: [['1', 'Nominal and high'], ['2', 'High only'], ['0', 'All detections']], value: '1' }],
    async load(o) {
      const { rows, src, at } = await loadFireRows();
      const min = Number(o.conf);
      const fires = rows.filter((r) => r[3] >= min);
      return { rows: fires, total: rows.length, src, at, statusNote: `${fires.length.toLocaleString()} hotspots in the last 24 hours · ${src}${isDesktop ? '' : ` · saved ${ago(Date.now() - at)}`}` };
    },
    channels(d, ctx) {
      const v = ctx.view;
      // Far away: three particle clouds (one draw call each) coloured by intensity. Close: the strongest
      // fires in view also get clickable flame symbols.
      d._particles ??= [['#ff5a36', 1.3, (f) => f < 20], ['#ffb340', 1.8, (f) => f >= 20 && f < 100], ['#fff1a8', 2.4, (f) => f >= 100]]
        .map(([color, size, test]) => ({ color, size, pts: d.rows.filter((r) => test(r[2])).map((r) => ({ lat: r[0], lng: r[1], alt: 0.0012 })) }));
      const near = v.altitude < 1.1 ? d.rows.filter((r) => inView(v, r[0], r[1])).sort((a, b) => b[2] - a[2]).slice(0, 600) : [];
      return {
        particles: d._particles,
        points: near.map((r) => ({ lat: r[0], lng: r[1], alt: 0.003, r: 0.05 + Math.min(0.2, r[2] / 800), color: frpColor(r[2]), tip: tip(`Fire hotspot · ${Math.round(r[2])} MW`, `${CONF[r[3]]} confidence · ${r[4] ? ago(Date.now() - r[4] * 60_000) : ''}`), ref: { layer: 'fires', d: r }, label: '' })),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[0], lng: r[1], alt: 0.0012, ref: { layer: 'fires', d: r } }))),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describeLayer: (d) => ({ rows: [['Hotspots shown', d.rows.length.toLocaleString()], ['All detections', d.total.toLocaleString()], ['Source', d.src], ['Saved', new Date(d.at).toUTCString()]] }),
    describe(r) {
      const [lat, lng, frp, conf, t, day] = r;
      return {
        title: `Fire hotspot, ${Math.round(frp)} MW`, sub: `${fmtLat(lat)}, ${fmtLng(lng)}`,
        rows: [['Fire radiative power', `${frp.toFixed(1)} MW (${frp >= 100 ? 'very intense' : frp >= 20 ? 'strong' : 'small or smouldering'})`], ['Detection confidence', CONF[conf]],
          ['Seen', t ? `${new Date(t * 60_000).toUTCString()} (${ago(Date.now() - t * 60_000)})` : '—'], ['Pass', day ? 'daytime' : 'night-time']],
        body: 'Each hotspot is a 375-metre pixel where the satellite measured more heat than its surroundings: a wildfire, a farm burning stubble, a gas flare or a volcano. Fire radiative power is the heat given off as light, in megawatts; it tracks how much fuel is burning.',
        links: [{ label: 'NASA FIRMS map here', url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng.toFixed(3)},${lat.toFixed(3)},10.0z` }],
        probe: [lat, lng],
      };
    },
    learn: {
      what: 'Every active fire NASA’s VIIRS instrument detected in the last 24 hours, about 375 metres across each. Red dots are small fires, orange strong ones and pale yellow the most intense. Zoom in for clickable flame symbols.',
      how: 'VIIRS flies on the NOAA-20 and Suomi NPP satellites, which pass over every place about twice a day. It measures heat in the middle-infrared; pixels much hotter than their neighbours are flagged as fires within about three hours. FIRMS publishes them openly. The live-data job saves a copy every 30 minutes because NASA’s files are not readable directly from a web page; the desktop app reads them live.',
      try: 'Turn on Natural events and compare NASA’s named wildfires with the raw hotspots around them. Then look at Africa south of the Sahara by day: most of those dots are farmers clearing fields.',
      refs: ['firms', 'viirs', 'livedata'],
    },
  };
}

// --------------------------------------------------------------- weather radar (RainViewer)
// Free use is limited to 100 requests a minute per address, zoom 7 and the "Universal Blue" colours (scheme 2),
// so a global frame is built from 512-pixel tiles at zoom 1 (4 tiles) while playing and zoom 2 (16) when still.
const RV = 'https://api.rainviewer.com/public/weather-maps.json';
const tokens = { left: 90, at: Date.now() };
async function token() {
  for (;;) {
    const now = Date.now(); if (now - tokens.at > 60_000) { tokens.left = 90; tokens.at = now; }
    if (tokens.left > 0) { tokens.left -= 1; return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const loadImg = async (url) => { await token(); return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('a radar tile did not load')); i.src = url; }); };
const frames = new Map(); // `${path}|${z}` -> Promise<CanvasTexture>
function frameTexture(host, path, z) {
  const key = `${path}|${z}`;
  if (frames.has(key)) return frames.get(key);
  const job = (async () => {
    const n = 2 ** z; const T = 512; const W = n * T;
    const merc = document.createElement('canvas'); merc.width = W; merc.height = W; const mc = merc.getContext('2d');
    const tiles = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) tiles.push(loadImg(`${host}${path}/512/${z}/${x}/${y}/2/1_1.png`).then((img) => mc.drawImage(img, x * T, y * T)).catch(() => {}));
    await Promise.all(tiles);
    // Web Mercator → plate carrée (the globe's texture layout), one row at a time.
    const out = document.createElement('canvas'); out.width = W; out.height = W / 2; const oc = out.getContext('2d');
    for (let y = 0; y < out.height; y++) {
      const lat = 90 - ((y + 0.5) * 180) / out.height; if (Math.abs(lat) > 85.05) continue;
      const my = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * W;
      oc.drawImage(merc, 0, Math.floor(my), W, 1, 0, y, W, 1);
    }
    const tex = new THREE.CanvasTexture(out); tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace; tex.anisotropy = 4;
    return tex;
  })();
  frames.set(key, job);
  if (frames.size > 30) { const [k, p] = frames.entries().next().value; frames.delete(k); p.then((t) => t.dispose()).catch(() => {}); }
  job.catch(() => frames.delete(key));
  return job;
}
let shell = null; const SHELL = { get obj() { return shell; } };
let warmed = false;
function ensureShell(api) {
  if (shell) return shell;
  shell = new THREE.Mesh(new THREE.SphereGeometry(100 * 1.0016, 160, 80), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.8 }));
  shell.rotation.y = -Math.PI / 2; // three-globe's texture alignment, as in the NASA overlay
  shell.renderOrder = 2; shell.raycast = () => {};
  return shell;
}
/** Compile the radar material before it is first drawn, so switching the layer on does not stall a frame. */
function warm(api) {
  if (warmed) return; warmed = true;
  try { const r = api.globe.renderer(); r.compileAsync?.(shell, api.globe.camera(), api.globe.scene()); } catch { /* compiled on first draw instead */ }
}

export function radarLayer(api) {
  const rs = { idx: -1, playing: null, d: null };
  const label = (f) => { const t = new Date(f.time * 1000); return `${t.toISOString().slice(11, 16)} UTC · ${ago(Date.now() - t)}`; };
  async function show(i, z) {
    const d = rs.d; if (!d) return;
    rs.idx = Math.max(0, Math.min(d.frames.length - 1, i));
    const f = d.frames[rs.idx];
    const el = document.getElementById('radar-time'); if (el) el.textContent = `${label(f)}${rs.idx === d.frames.length - 1 ? ' · latest' : ''}`;
    const sl = document.getElementById('radar-slider'); if (sl && Number(sl.value) !== rs.idx) sl.value = String(rs.idx);
    const tex = await frameTexture(d.host, f.path, z ?? (rs.playing ? 1 : 2));
    if (rs.d !== d || d.frames[rs.idx] !== f) return; // moved on meanwhile
    ensureShell(api).material.map = tex; shell.material.needsUpdate = true; api.compose();
  }
  function play(on, { redraw = true } = {}) {
    const was = !!rs.playing; clearInterval(rs.playing); rs.playing = null;
    const b = document.getElementById('radar-play'); if (b) b.textContent = on ? '❚❚ Pause' : '▶ Play';
    if (!on) { if (was && redraw) show(rs.idx); return; } // paused: swap in the sharper frame
    let busy = false;
    rs.playing = setInterval(async () => {
      if (busy || !rs.d) return; busy = true;
      const next = (rs.idx + 1) % rs.d.frames.length;
      try { await show(next, 1); frameTexture(rs.d.host, rs.d.frames[(next + 1) % rs.d.frames.length].path, 1); } finally { busy = false; }
    }, 650);
  }
  document.addEventListener('input', (e) => { if (e.target.id === 'radar-slider') { const i = Number(e.target.value); play(false, { redraw: false }); show(i); } });
  document.addEventListener('click', (e) => { const b = e.target.closest('#radar-play'); if (b) play(!rs.playing); });
  return {
    id: 'radar', group: 'live', label: 'Weather radar (RainViewer)', swatch: '#5aa9ff', on: false, refresh: 10 * 60_000,
    sources: ['rainviewer'],
    options: [{ id: 'opacity', label: 'Opacity', choices: [['0.8', '80 %'], ['1', 'Solid'], ['0.55', '55 %']], value: '0.8' }],
    async load(o) {
      const j = await getFeed('rainviewer', RV, { ttl: 5 * 60_000, proxy: false });
      const fr = [...(j.radar?.past ?? []), ...(j.radar?.nowcast ?? [])];
      if (!fr.length) throw new Error('RainViewer listed no radar frames');
      const wasLatest = !rs.d || rs.idx === rs.d.frames.length - 1;
      rs.d = { host: j.host, frames: fr, opacity: Number(o.opacity), at: j.generated * 1000 };
      const i = wasLatest ? fr.length - 1 : Math.min(rs.idx, fr.length - 1);
      await frameTexture(j.host, fr[i].path, 2); // the first frame must exist before the layer reports "loaded"
      rs.idx = i;
      return { ...rs.d, statusNote: `${fr.length} frames, every 10 minutes, ${label(fr[0]).split(' · ')[0]}–${label(fr.at(-1)).split(' · ')[0]}` };
    },
    channels(d) {
      ensureShell(api); warm(api);
      shell.material.opacity = d.opacity;
      frameTexture(d.host, d.frames[rs.idx].path, 2).then((t) => { if (!rs.playing && shell.material.map !== t) { shell.material.map = t; shell.material.needsUpdate = true; api.compose(); } });
      return { custom: [SHELL] };
    },
    count: (d) => `${d.frames.length} frames`,
    // Time slider and play button, shown under the layer in the Layers panel while it is on.
    panel: (d) => (d ? `<div class="radarctl"><button class="btn ghost" id="radar-play" type="button">${rs.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <input type="range" id="radar-slider" min="0" max="${d.frames.length - 1}" step="1" value="${rs.idx}" aria-label="Radar time" />
      <small id="radar-time">${esc(label(d.frames[rs.idx]))}${rs.idx === d.frames.length - 1 ? ' · latest' : ''}</small></div>` : ''),
    stop: () => play(false),
    describeLayer: (d) => ({ rows: [['Frames', `${d.frames.length} (past two hours, every 10 minutes)`], ['Showing', label(d.frames[rs.idx])], ['Source', 'RainViewer global radar mosaic']] }),
    learn: {
      what: 'Rain and snow seen by weather radars in the last two hours, in 10-minute steps: light blue is drizzle, deeper blue and purple heavy rain. Use the slider under this layer in Layers, or press Play to watch storms move.',
      how: 'Ground radars send out microwave pulses and time the echoes off raindrops and snowflakes. RainViewer merges more than a thousand national radars into one world map; areas without radar (most oceans, much of Africa) stay empty. The free service allows two hours of history and a limited number of map tiles a minute, so the globe loads a coarse world image while playing and a sharper one when paused.',
      try: 'Find a line of storms in the United States or Europe, press Play and estimate how fast it travels using Measure (M).',
      refs: ['rainviewer'],
    },
  };
}
