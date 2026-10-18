// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: watch areas and alerts.
// Draw a circle anywhere on Earth, choose what to watch for (an earthquake above a magnitude, a GDACS disaster
// alert, an aircraft squawking an emergency, fire hotspots, a surge of news) and get a notification when it
// happens: a system notification in the browser or desktop app, plus a toast and a log in the panel.
// Watch areas live only in this browser (localStorage); nothing is sent anywhere. Checks run every two minutes
// while the app is open, using the same feeds as the layers (and their caches).
import { getSnapshot } from './feeds.js';
import { haversineKm, smallCircle, fmtLat, fmtLng } from './astro.js';

const KEY = 'global-intelligence-atlas-watch';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { areas: j.areas ?? [], seen: j.seen ?? {}, log: j.log ?? [] }; } catch { return { areas: [], seen: {}, log: [] }; } };
const RADII = [25, 50, 100, 250, 500, 1000];
const LEVEL = { Green: 0, Orange: 1, Red: 2 };
const DEFAULT_RULES = { quake: 5, alert: 'Orange', squawk: true, fires: 25, news: 0 };
const CHECK_MS = 2 * 60_000;

export function installWatch(api) {
  const W = load(); let version = 0; let timer = null; let draft = null; let checking = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(W)); } catch { /* private mode: kept for this session only */ } version += 1; };
  const layer = (id) => api.LAYERS.find((l) => l.id === id);

  // ------------------------------------------------------------- notifications
  async function ask() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') { try { return await Notification.requestPermission(); } catch { return 'denied'; } }
    return Notification.permission;
  }
  function notify(area, title, body, at) {
    const entry = { t: Date.now(), area: area.name, title, body, at };
    W.log.unshift(entry); W.log.length = Math.min(W.log.length, 60); save();
    api.toast(`${area.name}: ${title}`, 8000);
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`${title} · ${area.name}`, { body, tag: `${area.id}:${title}`, icon: '../icons/icon-192.png' });
        n.onclick = () => { window.focus(); if (at) api.fly(at[0], at[1], 0.4); n.close?.(); };
      }
    } catch { /* some browsers only allow notifications from a service worker; the toast and log still show it */ }
    if (api.isOpen('watch')) panel();
  }
  /** Notify once per key; keys are forgotten after `keepH` hours so a later repeat can alert again. */
  function once(key, keepH, fn) { if (W.seen[key] && Date.now() - W.seen[key] < keepH * 3600_000) return; W.seen[key] = Date.now(); fn(); }

  // ------------------------------------------------------------- the checks
  const inside = (a, lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && haversineKm(a.lat, a.lng, lat, lng) <= a.km;
  async function check({ quiet = false } = {}) {
    if (checking || !W.areas.length) return; checking = true;
    const need = (k) => W.areas.some((a) => a.rules[k]);
    const safe = (p) => p.catch(() => null);
    try {
      const [quakes, alerts, flights, fires, news] = await Promise.all([
        need('quake') ? safe(layer('quakes').load({ feed: '2.5_day' })) : null,
        need('alert') ? safe(layer('alerts').load({ level: 'Orange;Red' })) : null,
        need('squawk') ? (api.state.data.aircraft?.ac ? Promise.resolve(api.state.data.aircraft.ac) : safe(getSnapshot('livedata', 'flights.json').then((j) => { const k = Object.fromEntries(j.fields.map((f, i) => [f, i])); return j.ac.map((r) => ({ id: r[k.id], call: r[k.call], lat: r[k.lat], lng: r[k.lng], squawk: r[k.squawk], altFt: r[k.altFt] })); }))) : null,
        need('fires') ? safe(layer('fires').load({ conf: '1' })) : null,
        need('news') ? (api.state.data.news?.items ? Promise.resolve(api.state.data.news.items) : safe(getSnapshot('gdelt', 'news-top.json').then((j) => j.features.map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], count: f.properties.count, name: f.properties.name }))))) : null,
      ]);
      for (const a of W.areas) {
        const r = a.rules;
        if (r.quake && quakes) for (const f of quakes) {
          const [lng, lat] = f.geometry.coordinates; const m = f.properties.mag ?? 0;
          if (m >= r.quake && inside(a, lat, lng) && f.properties.time > a.created - 3600_000) once(`${a.id}:q:${f.id}`, 24 * 8, () => notify(a, `M${m.toFixed(1)} earthquake`, `${f.properties.place ?? ''}, ${new Date(f.properties.time).toUTCString().slice(5, 22)} UTC`, [lat, lng]));
        }
        if (r.alert && alerts) for (const x of alerts) {
          if (LEVEL[x.level] >= LEVEL[r.alert] && inside(a, x.lat, x.lng)) once(`${a.id}:g:${x.id}:${x.level}`, 24 * 14, () => notify(a, `${x.level} disaster alert`, `${x.name}${x.sev ? ` · ${x.sev}` : ''}`, [x.lat, x.lng]));
        }
        if (r.squawk && flights) for (const f of flights) {
          if (['7500', '7600', '7700'].includes(String(f.squawk)) && inside(a, f.lat, f.lng)) once(`${a.id}:s:${f.id}:${f.squawk}`, 6, () => notify(a, `Emergency squawk ${f.squawk}`, `${f.call || f.id} at ${Math.round(f.altFt ?? 0).toLocaleString()} ft · ${{ 7500: 'unlawful interference', 7600: 'radio failure', 7700: 'general emergency' }[f.squawk]}`, [f.lat, f.lng]));
        }
        if (r.fires && fires) {
          const hits = fires.rows.filter((h) => inside(a, h[0], h[1]));
          const fresh = hits.filter((h) => !W.seen[`${a.id}:f:${h[0]},${h[1]},${h[4]}`]);
          for (const h of fresh) W.seen[`${a.id}:f:${h[0]},${h[1]},${h[4]}`] = Date.now();
          if (hits.length >= r.fires && fresh.length) { const top = hits.reduce((b, h) => (h[2] > b[2] ? h : b)); notify(a, `${hits.length} fire hotspots`, `${fresh.length} new in the last check · strongest ${Math.round(top[2])} MW`, [top[0], top[1]]); }
        }
        if (r.news && news) {
          const n = news.filter((p) => inside(a, p.lat, p.lng)).reduce((s, p) => s + (p.count ?? 1), 0);
          if (n >= r.news) once(`${a.id}:n:${new Date().toISOString().slice(0, 10)}`, 30, () => notify(a, `${n} news reports`, `Places in the news inside this area in the last 24 hours reached ${n} (your threshold is ${r.news}).`, [a.lat, a.lng]));
        }
      }
      // forget old keys
      const cut = Date.now() - 15 * 86_400_000; for (const k of Object.keys(W.seen)) if (W.seen[k] < cut) delete W.seen[k];
      W.checkedAt = Date.now(); save();
    } finally { checking = false; }
    if (!quiet && api.isOpen('watch')) panel();
  }
  function schedule() { clearInterval(timer); timer = W.areas.length ? setInterval(() => { if (!document.hidden || 'Notification' in window) check(); }, CHECK_MS) : null; }

  // ------------------------------------------------------------- the panel
  const ruleText = (r) => [r.quake && `earthquakes M${r.quake}+`, r.alert && `${r.alert === 'Red' ? 'red' : 'orange and red'} disaster alerts`, r.squawk && 'emergency squawks', r.fires && `${r.fires}+ fire hotspots`, r.news && `${r.news}+ news reports a day`].filter(Boolean).join(', ') || 'nothing yet';
  function form(a) {
    const r = a.rules; const sel = (name, opts, v) => `<select data-wf="${name}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="watchform">
      <label>Name <input type="text" data-wf="name" value="${esc(a.name)}" maxlength="40" /></label>
      <p class="muted">Centre ${fmtLat(a.lat)}, ${fmtLng(a.lng)}. <button class="btn ghost" data-watch="pick">Pick on the map</button><button class="btn ghost" data-watch="centre">Use the view centre</button></p>
      <label>Radius ${sel('km', RADII.map((k) => [k, `${k.toLocaleString()} km`]), a.km)}</label>
      <h4>Tell me about</h4>
      <label class="toggle"><input type="checkbox" data-wr="quake" ${r.quake ? 'checked' : ''}/> Earthquakes of magnitude ${sel('quake', [3, 4, 4.5, 5, 5.5, 6, 7].map((m) => [m, `${m} or more`]), r.quake || 5)}</label>
      <label class="toggle"><input type="checkbox" data-wr="alert" ${r.alert ? 'checked' : ''}/> Disaster alerts (GDACS) ${sel('alert', [['Orange', 'orange and red'], ['Red', 'red only']], r.alert || 'Orange')}</label>
      <label class="toggle"><input type="checkbox" data-wr="squawk" ${r.squawk ? 'checked' : ''}/> Aircraft squawking an emergency (7500, 7600, 7700)</label>
      <label class="toggle"><input type="checkbox" data-wr="fires" ${r.fires ? 'checked' : ''}/> Fire hotspots, when there are at least ${sel('fires', [1, 10, 25, 100, 500].map((n) => [n, n]), r.fires || 25)}</label>
      <label class="toggle"><input type="checkbox" data-wr="news" ${r.news ? 'checked' : ''}/> News: at least ${sel('news', [10, 25, 50, 100, 250].map((n) => [n, `${n} reports`]), r.news || 50)} in a day</label>
      <div class="row"><button class="btn" data-watch="save">Save watch area</button><button class="btn ghost" data-watch="cancel">Cancel</button></div></div>`;
  }
  function panel() {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const areas = W.areas.map((a) => `<div class="watcharea"><b>${esc(a.name)}</b><small>${a.km.toLocaleString()} km around ${fmtLat(a.lat)}, ${fmtLng(a.lng)} · ${esc(ruleText(a.rules))}</small>
      <div class="row"><button class="btn ghost" data-watch="fly:${a.id}">Show</button><button class="btn ghost" data-watch="edit:${a.id}">Edit</button><button class="btn ghost" data-watch="del:${a.id}">Delete</button></div></div>`).join('');
    const log = W.log.slice(0, 20).map((e) => `<button class="tour-card" ${e.at ? `data-fly="${e.at[0]},${e.at[1]},0.4"` : ''}><b>${esc(e.title)}</b><span>${esc(e.area)} · ${new Date(e.t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${esc(e.body)}</span></button>`).join('');
    api.openNotes('Watch areas', `
      <p>Draw a circle anywhere and choose what to watch for. While Global Intelligence Atlas is open it checks every two minutes and tells you when something happens inside. Your watch areas stay in this ${api.isDesktop ? 'app' : 'browser'}; nothing is sent anywhere.</p>
      ${draft ? form(draft) : `<div class="row"><button class="btn" data-watch="new">Add a watch area</button>${W.areas.length ? '<button class="btn ghost" data-watch="check">Check now</button>' : ''}</div>`}
      ${perm !== 'granted' ? `<p class="muted">${perm === 'unsupported' ? 'This browser cannot show system notifications, so alerts appear as messages at the bottom of the globe and in the log below.' : perm === 'denied' ? 'Notifications are blocked for this site, so alerts appear as messages on the globe and in the log below. Allow them in your browser’s site settings to get system notifications.' : '<button class="btn ghost" data-watch="perm">Allow system notifications</button>'}</p>` : ''}
      <h4>Your watch areas <small class="muted">${W.areas.length}</small></h4>${areas || '<p class="muted">None yet.</p>'}
      <h4>Recent alerts</h4>${log || '<p class="muted">Nothing has happened in your watch areas yet.</p>'}
      ${W.checkedAt ? `<p class="muted">Last checked ${new Date(W.checkedAt).toLocaleTimeString()}. Sources: USGS earthquakes, GDACS alerts, the flight snapshot, NASA FIRMS fires and GDELT news.</p>` : ''}
      ${W.log.length ? '<p><button class="btn ghost" data-watch="clearlog">Clear the log</button></p>' : ''}`, 'watch');
  }
  function readForm() {
    const q = (s) => document.querySelector(`#notes-body [data-wf="${s}"]`); const on = (s) => document.querySelector(`#notes-body [data-wr="${s}"]`)?.checked;
    draft.name = (q('name')?.value || 'My area').trim(); draft.km = Number(q('km')?.value || draft.km);
    draft.rules = { quake: on('quake') ? Number(q('quake').value) : 0, alert: on('alert') ? q('alert').value : '', squawk: !!on('squawk'), fires: on('fires') ? Number(q('fires').value) : 0, news: on('news') ? Number(q('news').value) : 0 };
  }
  function pick(lat, lng) {
    api.state.watchPick = false; if (!draft) return;
    draft.lat = +lat.toFixed(4); draft.lng = +lng.toFixed(4); version += 1; api.refreshLayer('watch', { soft: true }); panel();
    api.toast('Centre set. Adjust the radius and what to watch for, then save.');
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-watch]'); if (!b) return;
    const [k, id] = b.dataset.watch.split(':');
    if (k === 'open') return panel();
    if (draft && ['pick', 'centre', 'save'].includes(k)) readForm();
    if (k === 'new') { const p = api.state.pov; draft = { id: `w${Date.now().toString(36)}`, name: api.placeName?.(p.lat, p.lng)?.replace(/^near /, '') || 'My area', lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4), km: p.altitude < 0.2 ? 50 : p.altitude < 0.8 ? 250 : 500, rules: { ...DEFAULT_RULES }, created: Date.now() }; showWatchLayer(); panel(); }
    if (k === 'pick') { api.state.watchPick = true; api.toast('Click the centre of your watch area on the globe'); }
    if (k === 'centre') { const p = api.state.pov; draft.lat = +p.lat.toFixed(4); draft.lng = +p.lng.toFixed(4); panel(); }
    if (k === 'cancel') { draft = null; api.state.watchPick = false; version += 1; api.refreshLayer('watch', { soft: true }); panel(); }
    if (k === 'save') {
      const i = W.areas.findIndex((a) => a.id === draft.id);
      if (i >= 0) W.areas[i] = draft; else W.areas.push(draft);
      draft = null; save(); schedule(); showWatchLayer(); panel();
      await ask(); panel(); check();
    }
    if (k === 'edit') { draft = structuredClone(W.areas.find((a) => a.id === id)); panel(); }
    if (k === 'del') { W.areas = W.areas.filter((a) => a.id !== id); save(); schedule(); api.refreshLayer('watch', { soft: true }); panel(); }
    if (k === 'fly') { const a = W.areas.find((x) => x.id === id); if (a) { showWatchLayer(); api.fly(a.lat, a.lng, Math.min(2.2, Math.max(0.15, a.km / 1400)), false); } }
    if (k === 'check') { b.textContent = 'Checking…'; await check({ quiet: true }); panel(); }
    if (k === 'perm') { await ask(); panel(); }
    if (k === 'clearlog') { W.log = []; save(); panel(); }
  });
  // also update the drawn circle while the radius select changes
  document.addEventListener('change', (e) => { if (draft && e.target.dataset?.wf === 'km') { draft.km = Number(e.target.value); version += 1; api.refreshLayer('watch', { soft: true }); } });
  function showWatchLayer() { if (!api.state.on.has('watch')) api.toggleLayer('watch', true); else api.refreshLayer('watch', { soft: true }); }

  // ------------------------------------------------------------- the layer: every circle in one batched draw call
  const watchLayer = {
    id: 'watch', group: 'live', label: 'My watch areas', swatch: '#e3b55b', on: W.areas.length > 0, pin: 'eye',
    sources: ['usgs', 'gdacs', 'opensky', 'firms', 'gdelt', 'taurinotify'],
    async load() { return { v: version }; },
    channels(d, ctx) {
      const all = draft ? [...W.areas.filter((a) => a.id !== draft.id), { ...draft, draft: true }] : W.areas;
      const key = `${version}|${all.length}`;
      if (d._key !== key) {
        d._key = key;
        if (d._fat) { d._fat.obj.geometry.dispose(); d._fat.obj.material.dispose(); }
        d._fat = all.length ? ctx.fatLines(all.map((a) => ({ pts: smallCircle(a.lat, a.lng, a.km / 111.2, 120).map(([la, lo]) => [la, lo]), color: a.draft ? '#7ed6c4' : '#e3b55b', width: a.draft ? 2.4 : 1.8, alt: 0.002 }))) : null;
        d._pts = all.map((a) => ({ lat: a.lat, lng: a.lng, alt: 0.003, r: 0.08, color: a.draft ? '#7ed6c4' : '#e3b55b', label: a.name, tip: `<div class="tip"><b>${esc(a.name)}</b><span>${esc(ruleText(a.rules))}</span></div>`, ref: { layer: 'watch', d: a } }));
      }
      return { custom: d._fat ? [d._fat] : [], points: d._pts };
    },
    count: () => (W.areas.length ? String(W.areas.length) : ''),
    open: () => panel(),
    learn: {
      what: 'Your own watch areas: circles you drew with what you asked to be told about inside each one. Open Tools → Watch areas to add, change or remove them.',
      how: 'Every two minutes, while the app is open, the same public feeds the layers use (USGS earthquakes, GDACS alerts, the flight snapshot, NASA FIRMS fires and GDELT news) are compared against each circle using great-circle distance. Each event alerts once. Everything is stored in this browser only.',
      try: 'Draw a 500 km circle around a city near a plate boundary, tick earthquakes of magnitude 4 or more, and leave the tab open for a day.',
      refs: ['usgs', 'gdacs', 'firms', 'livedata'],
    },
  };
  if (W.areas.length) { schedule(); setTimeout(() => check({ quiet: true }), 20_000); }
  return { layer: watchLayer, open: panel, pick, check, areas: () => W.areas };
}
