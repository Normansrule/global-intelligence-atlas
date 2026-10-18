// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — cameras.
//  • Traffic cameras: public road-agency CCTV (Caltrans, NYC DOT, 511 Ontario, 511 Alberta …),
//    collected by tools/fetch-cameras.mjs in GitHub Actions and shipped as data/cameras.json.
//    Snapshots load straight from the agency; Caltrans cameras with a video stream play live (HLS).
//  • Licence-plate readers (ALPR, e.g. Flock Safety): positions mapped in OpenStreetMap, largely by
//    the DeFlock project. Bundled as a daily grid snapshot (data/alpr/) and refreshable live from
//    the Overpass API for the area you are looking at.
import './surroundings.js'; // the “3D surroundings” button
import { getFeed, getLocal } from './feeds.js';
import { haversineKm, fmtLat, fmtLng } from './astro.js';

const tip = (t, s = '') => `<div class="tip"><b>${t}</b>${s ? `<span>${s}</span>` : ''}</div>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inView = (v, lat, lng) => Math.abs(lat - v.lat) * 111 < v.radiusKm && haversineKm(v.lat, v.lng, lat, lng) < v.radiusKm; // cheap latitude test first

let camTimer = null; let hls = null;
export function stopCameraMedia() { clearInterval(camTimer); camTimer = null; if (hls) { hls.destroy(); hls = null; } }

// --------------------------------------------------------------- traffic CCTV
export function camerasLayer(api) {
  return {
    id: 'cameras', group: 'cams', label: 'Live traffic cameras', swatch: '#7ed6c4', on: false, viewDependent: true, pin: 'camera',
    sources: ['caltrans', 'nycdot', 'tfl', 'hktd', 'digitraffic', 'on511', 'ab511', 'autobahn', 'drivebc', 'nzta', 'twfreeway', 'qc511', 'nswlive', 'vegagerdin', 'dgt'],
    async load() {
      const d = await getLocal('data/cameras.json').catch(() => { throw new Error('the camera list has not been collected yet — run the “Refresh camera data” workflow once (see the README)'); });
      const src = d.sources.map((s) => s.name);
      return { at: d.generatedAt, src: d.sources, cams: d.cams.map(([id, name, lat, lng, img, stream, si, extra]) => ({ id, name, lat, lng, img, stream, source: src[si], extra })) };
    },
    channels(d, ctx) {
      const v = ctx.view;
      const near = v.altitude < 1.2 ? d.cams.filter((c) => inView(v, c.lat, c.lng)).slice(0, 1500) : [];
      return {
        particles: (d._particles ??= [{ color: '#7ed6c4', size: 1.4, pts: d.cams.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.001 })) }]), // memoised: a new particle set would force a shader rebuild
        points: near.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.004, r: 0.06, color: '#7ed6c4', tip: tip(esc(c.name), `${esc(c.source)} · click for the live view`), ref: { layer: 'cameras', d: c }, label: c.name })),
        pick: (d._pick ??= d.cams.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.001, ref: { layer: 'cameras', d: c } }))),
      };
    },
    describeLayer: (d) => ({ rows: [['Cameras', d.cams.length.toLocaleString()], ['Collected', new Date(d.at).toUTCString()], ...d.src.map((s) => [s.name, `${s.count.toLocaleString()} cameras`])] }),
    open: (c) => openCamera(c, api),
    learn: {
      what: 'Public road cameras published by transport agencies: California, New York City, British Columbia, Québec, Ontario and Alberta; London, Finland, Germany, Spain and Iceland; Hong Kong and Taiwan; New Zealand and New South Wales. Zoom in to see camera pins; click one to watch it. Most show a still image that refreshes every 15 seconds; many Caltrans cameras stream live video, London’s JamCams play a short recent clip and Taiwan’s freeway cameras are live motion pictures. Mainland China’s road agencies publish no open camera feeds, so Hong Kong and Taiwan are the cameras in the region.',
      how: 'Agencies publish open lists of their cameras with a snapshot address. A GitHub Action collects the lists every day into one file for this site; the pictures themselves always come straight from the agency when you open a camera, so they are as fresh as the agency makes them.',
      try: 'Open a freeway camera at rush hour, then switch on Live flights near the same city and watch the approach path overhead.',
      refs: ['caltrans', 'nycdot', 'tfl', 'hktd', 'digitraffic', 'on511', 'ab511', 'autobahn', 'drivebc', 'nzta', 'twfreeway', 'qc511', 'nswlive', 'vegagerdin', 'dgt'],
    },
  };
}

// Also used by the worldwide webcam layer (worldcams.js), which passes its own nearby list. A camera may have only a
// video stream (img empty) and a publisher page (c.page).
export async function openCamera(c, api, near = null) {
  const nearby = near ?? api.state.data.cameras?.cams.filter((x) => x !== c).map((x) => ({ x, km: haversineKm(c.lat, c.lng, x.lat, x.lng) })).sort((a, b) => a.km - b.km).slice(0, 6) ?? [];
  const mjpeg = /mjpg|mjpeg/i.test(c.img); // a live motion-JPEG stream: the <img> plays it, so never reload it
  const still = !!c.img;
  const bust = () => (mjpeg ? c.img : `${c.img}${c.img.includes('?') ? '&' : '?'}t=${Date.now()}`);
  api.openNotes('Live camera', `
    <p class="kicker">${esc(c.source)}</p><h3>${esc(c.name)}</h3>
    <p class="sub">${fmtLat(c.lat)}, ${fmtLng(c.lng)}${c.extra ? ` · ${esc(c.extra)}` : ''}</p>
    <figure class="cam">
      ${c.stream ? '<video id="cam-video" muted autoplay playsinline controls hidden></video>' : ''}
      <img id="cam-img" ${still ? `src="${esc(bust())}"` : 'hidden'} alt="Latest image from ${esc(c.name)}" />
      <figcaption><span class="live-dot"></span><span id="cam-status">${c.stream ? 'Connecting to the live stream…' : mjpeg ? 'Live motion picture' : 'Still image · refreshes every 15 s'}</span></figcaption>
    </figure>
    <div class="row"><button class="btn ghost" data-fly="${c.lat},${c.lng},0.004">Fly to it</button>${still ? `<a class="btn ghost" href="${esc(c.img)}" target="_blank" rel="noopener">Open image</a>` : ''}${c.page ? `<a class="btn ghost" href="${esc(c.page)}" target="_blank" rel="noopener">Publisher’s page</a>` : ''}
      <a class="btn ghost" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat},${c.lng}" target="_blank" rel="noopener">Street View here</a>
      <button class="btn ghost" data-surround="${c.lat},${c.lng}" data-surround-label="${esc(c.name)}">3D surroundings</button></div>
    <div id="surround-3d" hidden></div>
    ${nearby.length ? `<h4>Nearby cameras</h4><div class="camwall">${nearby.map(({ x, km }) => `<button class="camtile" data-cam="${esc(x.id)}">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<img alt=""/>'}<span>${esc(x.name)}</span><small>${km < 10 ? km.toFixed(1) : Math.round(km)} km</small></button>`).join('')}</div>` : ''}
    <p class="muted">Images are published by ${esc(c.source)} and are shown as-is. If a picture is grey or stale, the camera is offline on the agency’s side.</p>`, `cam:${c.id}`);
  const img = document.getElementById('cam-img');
  img.onerror = () => { const s = document.getElementById('cam-status'); if (s) s.textContent = 'This camera is not sending images right now.'; };
  if (still && !mjpeg) camTimer = setInterval(() => { const el = document.getElementById('cam-img'); if (el && !el.hidden) el.src = bust(); }, 15_000);
  if (c.stream) playStream(c.stream);
}

async function playStream(url) {
  const video = document.getElementById('cam-video'); const img = document.getElementById('cam-img'); const status = document.getElementById('cam-status');
  const ok = () => { video.hidden = false; img.hidden = true; status.textContent = /\.mp4($|\?)/.test(url) ? 'Latest video clip (loops) — updated every few minutes by the agency' : 'Live video'; };
  const fail = () => { video?.remove(); status.textContent = img.getAttribute('src') ? 'Live video unavailable here — showing the latest still (refreshes every 15 s)' : 'Live video unavailable here — try the publisher’s page'; };
  try {
    if (/\.mp4($|\?)/.test(url)) { video.loop = true; video.src = url; video.onloadeddata = ok; video.onerror = fail; return; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; video.onloadeddata = ok; video.onerror = fail; return; }
    if (!window.Hls) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/hls.light.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    if (!window.Hls?.isSupported()) return fail();
    hls = new window.Hls({ lowLatencyMode: true, maxBufferLength: 10 });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); ok(); });
    hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data.fatal) { hls.destroy(); hls = null; fail(); } });
    hls.loadSource(url); hls.attachMedia(video);
  } catch { fail(); }
}

// --------------------------------------------------------------- licence-plate readers (ALPR)
const cellKey = (lat, lng) => `${Math.floor(lat / 10) * 10}_${Math.floor(lng / 10) * 10}`;
export function alprLayer(api) {
  let index = null; let density = null; const cells = new Map(); const live = new Map(); let lastRows = null; let lastKey = '';
  return {
    id: 'alpr', group: 'cams', label: 'Licence-plate readers', swatch: '#f07a63', on: false, viewDependent: true, reloadOnView: true, pin: 'alpr',
    sources: ['osm', 'deflock', 'overpass'],
    async load(_o, ctx) {
      const v = ctx.view;
      if (index === null) index = await getLocal('data/alpr/index.json').catch(() => false);
      if (index) {
        const want = new Set();
        const span = Math.min(180, v.radiusKm / 111 + 10);
        for (let la = v.lat - span; la <= v.lat + span; la += 10) for (let lo = v.lng - span * 1.5; lo <= v.lng + span * 1.5; lo += 10) {
          const k = cellKey(Math.max(-89, Math.min(89, la)), ((((lo + 180) % 360) + 360) % 360) - 180);
          if (index.cells[k]) want.add(k);
        }
        if (v.altitude > 1.2) { // zoomed out: a 1° density grid instead of 150,000+ individual readers
          density ??= await getLocal('data/alpr/density.json').then((d) => d.rows).catch(() => []);
          return { rows: [], density, at: index.generatedAt, total: index.total, hasIndex: true };
        }
        await Promise.all([...want].filter((k) => !cells.has(k)).map(async (k) => cells.set(k, (await getLocal(`data/alpr/${k}.json`).catch(() => ({ rows: [] }))).rows)));
      } else if (v.altitude < 0.25) {
        await this.fetchLive(v);
      }
      // Same cells as last time → return the very same object, so the particle cloud and the click index
      // (tens of thousands of readers) are reused instead of rebuilt every time the camera stops.
      const key = `${cells.size}|${live.size}`;
      if (lastRows && key === lastKey) return lastRows;
      const rows = [];
      for (const c of cells.values()) for (const r of c) rows.push(r);
      const seen = new Set(rows.map((r) => r[0]));
      for (const r of live.values()) if (!seen.has(r[0])) rows.push(r);
      lastKey = key; lastRows = { rows, at: index?.generatedAt ?? null, total: index?.total ?? rows.length, hasIndex: !!index };
      return lastRows;
    },
    async fetchLive(v) {
      const d = Math.min(1.5, v.radiusKm / 111);
      const q = `[out:json][timeout:25];node["surveillance:type"="ALPR"](${(v.lat - d).toFixed(4)},${(v.lng - d * 1.4).toFixed(4)},${(v.lat + d).toFixed(4)},${(v.lng + d * 1.4).toFixed(4)});out;`;
      const j = await getFeed('overpass', `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { ttl: 300_000, timeout: 30_000 });
      for (const n of j.elements ?? []) live.set(n.id, alprRow(n));
      return (j.elements ?? []).length;
    },
    channels(d, ctx) {
      const v = ctx.view;
      if (d.density) {
        const max = d.density.reduce((m, r) => Math.max(m, r[2]), 1);
        return { points: d.density.map(([lat, lng, n]) => ({ lat, lng, alt: 0.004 + 0.12 * Math.log1p(n) / Math.log1p(max), r: 0.35, color: n > 500 ? '#f07a63' : n > 50 ? '#f39a86' : 'rgba(240,122,99,0.55)', tip: tip(`${n.toLocaleString()} mapped readers`, 'in this 1° square — zoom in for each camera'), ref: { layer: 'alpr', d: { density: n, lat, lng } } })) };
      }
      const near = v.altitude < 0.9 ? d.rows.filter((r) => inView(v, r[1], r[2])).slice(0, 1200) : [];
      return {
        particles: (d._particles ??= [{ color: '#f07a63', size: 1.2, pts: d.rows.map((r) => ({ lat: r[1], lng: r[2], alt: 0.001 })) }]),
        points: near.map((r) => ({ lat: r[1], lng: r[2], alt: 0.003, r: 0.05, color: '#f07a63', tip: tip(esc(r[3] || 'Licence-plate reader'), esc(r[4] || 'mapped in OpenStreetMap')), ref: { layer: 'alpr', d: r }, label: r[3] || 'ALPR' })),
        pick: (d._pick ??= d.rows.map((r) => ({ lat: r[1], lng: r[2], alt: 0.001, ref: { layer: 'alpr', d: r } }))),
      };
    },
    describeLayer: (d) => ({ rows: [['Mapped readers loaded', d.density ? 'zoom in to load individual readers' : d.rows.length.toLocaleString()], ['Worldwide in snapshot', d.hasIndex ? d.total.toLocaleString() : 'no snapshot yet — zoom in to load live from OpenStreetMap'], ...(d.at ? [['Snapshot date', new Date(d.at).toUTCString()]] : [])] }),
    describe(r) {
      if (r.density) return { title: `${r.density.toLocaleString()} licence-plate readers`, sub: `mapped in the 1° square around ${fmtLat(r.lat)}, ${fmtLng(r.lng)}`, body: 'Zoom in to load every individual reader in this area with its maker, operator and direction.', actions: [['zoom-alpr', 'Zoom in here']] };
      const [id, lat, lng, brand, operator, dir, mount, extra] = r;
      return {
        title: brand ? `${brand} licence-plate reader` : 'Licence-plate reader', sub: operator ? `Operated by ${operator}` : 'Operator not recorded in OpenStreetMap',
        rows: [['Position', `${fmtLat(lat)}, ${fmtLng(lng)}`], ['Facing', dir ? `${dir}°` : '—'], ['Mounted on', mount || '—'], ...(extra ? [['Notes', extra]] : [])],
        body: 'Automatic licence-plate recognition (ALPR) cameras photograph passing vehicles, read the plate with software and log time and place. Supporters say they help recover stolen cars and solve crimes; privacy groups warn that shared databases can track people’s movements over time. Where they are is public because volunteers map them.',
        links: [{ label: 'OpenStreetMap node', url: `https://www.openstreetmap.org/node/${id}` }, { label: 'DeFlock map', url: `https://deflock.me/map#map=17/${lat}/${lng}` }, { label: 'Street View here', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}` }],
        probe: [lat, lng],
      };
    },
    learn: {
      what: 'Automatic licence-plate readers — Flock Safety and other brands — as mapped by volunteers in OpenStreetMap, much of it through the DeFlock project. Zoom in for individual pins; each one says who makes and operates it when that is known.',
      how: 'Mappers record each camera as a surveillance node tagged “ALPR”, usually with manufacturer, operator and facing direction. A daily GitHub Action downloads every such node worldwide; when you zoom right in, the layer also asks OpenStreetMap’s Overpass service for the latest additions in view. Coverage depends entirely on volunteers, so an empty area may simply be unmapped.',
      try: 'Compare the reader network with the traffic cameras in the same city. Then read both sides of the debate: police departments’ published policies and the ACLU and EFF analyses linked below.',
      refs: ['osm', 'deflock', 'overpass', 'eff_alpr', 'aclu_alpr'],
    },
  };
}
export function alprRow(n) {
  const t = n.tags ?? {};
  return [n.id, n.lat, n.lon, t.manufacturer || t.brand || '', t.operator || '', t.direction || t['camera:direction'] || '', t['camera:mount'] || '', t.note || ''];
}

// --------------------------------------------------------------- camera wall
let wallTimer = null;
export function openWall(api) {
  const cams = api.state.data.cameras?.cams;
  if (!cams) { api.toggleLayer('cameras', true); return api.toast('Loading cameras — open the wall again in a moment'); }
  const { lat, lng } = api.state.pov;
  const near = cams.map((c) => ({ c, km: haversineKm(lat, lng, c.lat, c.lng) })).sort((a, b) => a.km - b.km).slice(0, 12);
  let el = document.getElementById('wall');
  if (!el) { el = document.createElement('div'); el.id = 'wall'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Camera wall'); document.body.appendChild(el); }
  const bust = (u) => (/mjpg|mjpeg/i.test(u) ? u : `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`); // live MJPEG streams are never reloaded
  el.innerHTML = `<div class="wall-head"><b>Camera wall</b><span>${near.length} cameras nearest the centre of your view · refreshing every 20 s</span><button class="icon" id="wall-close" aria-label="Close camera wall">×</button></div>
    <div class="wall-grid">${near.map(({ c, km }) => `<button class="wall-tile" data-walltile="${esc(c.id)}"><img src="${esc(bust(c.img))}" alt="" onerror="this.style.visibility='hidden'"/><span><b>${esc(c.name)}</b><small>${esc(c.source)} · ${km < 10 ? km.toFixed(1) : Math.round(km)} km</small></span><i class="live-dot"></i></button>`).join('')}</div>`;
  el.hidden = false;
  clearInterval(wallTimer);
  wallTimer = setInterval(() => el.querySelectorAll('.wall-tile img').forEach((img, k) => { if (!/mjpg|mjpeg/i.test(near[k].c.img)) img.src = bust(near[k].c.img); }), 20_000);
  const close = () => { el.hidden = true; clearInterval(wallTimer); el.querySelectorAll('.wall-tile img').forEach((img) => img.removeAttribute('src')); }; // also stops live streams
  el.querySelector('#wall-close').onclick = close;
  el.onclick = (e) => { const t = e.target.closest('[data-walltile]'); if (!t) return; const c = cams.find((x) => x.id === t.dataset.walltile); close(); api.select({ layer: 'cameras', d: c }); };
  document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
}
