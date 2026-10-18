// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v1.7 extras:
//  • Command palette (Ctrl+K or ⌘K): type to find any layer, preset, tour, base map, city, saved view or action.
//  • Saved views: bookmark the camera, base map and layers, and come back later (kept in this browser).
//  • Ride along with the ISS: the camera follows the station, showing what it is flying over.
//  • Flights board: a live summary of every aircraft on the map, with the fastest, highest and emergencies.
import { positions } from './satellites.js';
import { getLocal } from './feeds.js';
import { EMERGENCY } from './flights.js';

const KEY = 'global-intelligence-atlas-views';
const readViews = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const writeViews = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(0, 40))); return true; } catch { return false; } };

/** Rough ocean or sea name for a point that isn't in any country. */
export function waterName(lat, lng) {
  if (lat > 66) return 'the Arctic Ocean';
  if (lat < -60) return 'the Southern Ocean';
  if (lat > 30 && lat < 46 && lng > -6 && lng < 36) return 'the Mediterranean Sea';
  if (lat > 12 && lat < 30 && lng > 32 && lng < 44) return 'the Red Sea';
  if (lat > 8 && lat < 30 && lng > -98 && lng < -60) return lat > 18 && lng < -81 ? 'the Gulf of Mexico' : 'the Caribbean Sea';
  if (lng > 20 && lng < 147 && lat < 25 && !(lng > 100 && lat > -10)) return 'the Indian Ocean';
  const west = lat > 10 ? -98 : lat > -10 ? -60 : -68;
  if (lng > west && lng < 20) return 'the Atlantic Ocean';
  return 'the Pacific Ocean';
}

export function installExtras(x) {
  const { $, esc, state, globe, LAYERS, toast } = x;

  // ------------------------------------------------------------ command palette
  const box = document.createElement('div');
  box.id = 'palette'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Command palette');
  box.innerHTML = `<div class="pal-card"><input id="pal-q" type="search" autocomplete="off" spellcheck="false" placeholder="Type a layer, place, flight (e.g. UAL, BAW12), tour or action…" aria-label="Search commands" />
    <ul id="pal-list" role="listbox"></ul><p class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close · <kbd>Ctrl</kbd>+<kbd>K</kbd> any time</p></div>`;
  document.body.appendChild(box);
  const input = box.querySelector('#pal-q'); const list = box.querySelector('#pal-list');
  let items = []; let shown = []; let sel = 0; let cities = null;

  function commands() {
    const out = [];
    const c = (group, label, run, hint = '') => out.push({ group, label, run, hint, key: `${label} ${group} ${hint}`.toLowerCase() });
    c('Action', 'Ride along with the ISS', () => ride(true), 'follow the space station');
    c('Action', 'Flights board', () => flightsBoard(), 'fastest, highest, emergencies');
    c('Action', 'Sky above the centre of the view', () => x.sky(state.pov.lat, state.pov.lng), 'Sun, Moon, satellites and planes overhead');
    c('Action', 'Save this view', () => saveView(), 'bookmark camera and layers');
    c('Action', 'Saved views', () => viewsPanel(), 'your bookmarks');
    c('Action', 'Replay a week of earthquakes', () => x.start('replay'), 'time machine');
    c('Action', 'Trace connections here', () => x.trace(), 'cables, power, airports');
    c('Action', 'Back to live time', () => $('#time-live')?.click());
    c('Action', 'Save a picture of the globe', () => $('#shot')?.click(), 'screenshot');
    c('Action', 'Spin the globe on or off', () => $('#spin')?.click(), 'auto-rotate');
    c('Action', 'Camera wall for this view', () => x.openWall(), 'live cameras');
    c('Action', 'What’s new in this version', () => x.whatsNew());
    for (const l of LAYERS) c('Layer', `${state.on.has(l.id) ? 'Hide' : 'Show'} ${l.label}`, () => { x.toggleLayer(l.id, !state.on.has(l.id)); x.renderLayerPanel(); toast(`${state.on.has(l.id) ? 'Showing' : 'Hidden'}: ${l.label}`); }, l.group);
    for (const l of LAYERS) c('Learn', `About ${l.label}`, () => x.showLearn(l.id));
    x.PRESETS.forEach(([n], i) => c('Preset', n, () => x.preset(i)));
    for (const t of x.TOURS) c('Tour', t.title, () => x.startTour(t.id), t.blurb);
    document.querySelectorAll('button[data-base]').forEach((b) => c('Base map', b.textContent.trim(), () => b.click()));
    document.querySelectorAll('button[data-look]').forEach((b) => c('Look', b.textContent.trim(), () => b.click()));
    for (const v of readViews()) c('Saved view', v.name, () => goView(v), new Date(v.at).toLocaleDateString());
    if (cities) for (const ct of cities) c('Place', ct.name, () => x.fly(ct.lat, ct.lng, ct.pop > 5e6 ? 0.12 : 0.06), ct.region || ct.cc);
    return out;
  }
  function score(it, q) {
    if (!q) return it.group === 'Action' ? 3 : it.group === 'Saved view' ? 2.5 : it.group === 'Preset' ? 2 : it.group === 'Place' ? -1 : 1;
    const l = it.label.toLowerCase();
    if (l.startsWith(q)) return 10 - l.length / 100;
    if (l.includes(` ${q}`)) return 8;
    if (l.includes(q)) return 6;
    if (it.key.includes(q)) return 3;
    // letters in order ("iss rd" → "Ride along with the ISS")
    const words = q.split(/\s+/).filter(Boolean);
    return words.length > 1 && words.every((w) => it.key.includes(w)) ? 2 : -Infinity;
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    shown = items.map((it) => [score(it, q), it]).filter(([s]) => s > -Infinity && (q || s >= 0)).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, it]) => it);
    // Live flights: callsign (UAL123, or just UAL for every United flight), registration, aircraft type or ICAO address
    const fl = flightMatches(q); if (fl.length) shown = (shown.length && score(shown[0], q) >= 10 ? [shown[0], ...fl, ...shown.slice(1)] : [...fl, ...shown]).slice(0, 60);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="pal-g">${esc(it.group)}</span><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</li>`).join('')
      : `<li class="pal-empty">Nothing matches. Press Enter to search the map for “${esc(input.value)}”.</li>`;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function flightMatches(q) {
    const ac = state.data.aircraft?.ac; if (!ac || q.length < 2 || !state.on.has('aircraft')) return [];
    const Q = q.toUpperCase().replace(/\s+/g, ''); const out = [];
    for (const a of ac) {
      const call = (a.call ?? '').toUpperCase();
      const hit = call.startsWith(Q) ? 3 : (a.reg ?? '').toUpperCase().replace('-', '').startsWith(Q.replace('-', '')) ? 2 : (a.type ?? '').toUpperCase() === Q ? 1 : a.id?.toUpperCase() === Q ? 2 : 0;
      if (hit) out.push([hit, a]);
      if (out.length > 400) break;
    }
    return out.sort((x, y) => y[0] - x[0] || (x[1].call ?? '').localeCompare(y[1].call ?? '')).slice(0, 12).map(([, a]) => ({
      group: 'Flight', label: a.call || a.id.toUpperCase(),
      hint: [a.type, a.reg, a.ground ? 'on the ground' : `${Math.round(a.altFt).toLocaleString()} ft`, a.kt ? `${Math.round(a.kt * 1.852)} km/h` : ''].filter(Boolean).join(' · '),
      run: () => { x.layer('aircraft').open(a); globe.pointOfView({ lat: a.lat, lng: a.lng, altitude: Math.min(state.pov.altitude, 0.5) }, x.reduceMotion ? 0 : 1600); },
      key: '',
    }));
  }
  function open() {
    items = commands(); box.hidden = false; input.value = ''; sel = 0; render(); input.focus();
    if (!cities) getLocal('data/cities.json').then((d) => { cities = d.rows.map(([name, lat, lng, pop, capital, cc, region]) => ({ name, lat, lng, pop, cc, region })); if (!box.hidden) { items = commands(); render(); } }).catch(() => {});
  }
  function close() { box.hidden = true; }
  function run(i) {
    const it = shown[i];
    close();
    if (it) it.run(); else if (input.value.trim()) x.geocode(input.value.trim());
  }
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); });
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); box.hidden ? open() : close(); }
  });

  // ------------------------------------------------------------ saved views
  function saveView() {
    const p = state.pov;
    const place = x.countryAt(p.lat, p.lng)?.properties?.name ?? waterName(p.lat, p.lng).replace(/^the /, '');
    const name = prompt('Name this view', `${place} · ${new Date().toLocaleDateString()}`);
    if (!name) return;
    const v = { name: name.slice(0, 80), at: Date.now(), pov: { lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4), altitude: +p.altitude.toFixed(4) }, base: state.base, layers: [...state.on] };
    const all = readViews().filter((o) => o.name !== v.name); all.unshift(v);
    toast(writeViews(all) ? `Saved “${v.name}”. Find it again with Ctrl+K.` : 'This browser won’t let the page save anything (private mode?).');
  }
  function goView(v) {
    const want = new Set(v.layers.filter((id) => LAYERS.some((l) => l.id === id)));
    for (const l of LAYERS) if (want.has(l.id) !== state.on.has(l.id)) x.toggleLayer(l.id, want.has(l.id));
    x.renderLayerPanel();
    if (v.base !== state.base) document.querySelector(`button[data-base="${v.base}"]`)?.click();
    globe.pointOfView(v.pov, x.reduceMotion ? 0 : 2000);
    toast(`Saved view: ${v.name}`);
  }
  function viewsPanel() {
    const vs = readViews();
    x.openNotes('Saved views', `<h3>Your saved views</h3>
      <p class="sub">Camera, base map and layers, kept in this browser only. Press Ctrl+K and type a name to jump back.</p>
      ${vs.length ? vs.map((v, i) => `<div class="viewrow"><button class="tour-card" data-view="${i}"><b>${esc(v.name)}</b><span>${v.layers.length} layers · ${esc(v.base)} · saved ${new Date(v.at).toLocaleString()}</span></button><button class="btn ghost" data-view-del="${i}" aria-label="Delete ${esc(v.name)}">Delete</button></div>`).join('') : '<p class="muted">Nothing saved yet.</p>'}
      <p><button class="btn" data-view-save="1">Save the current view</button></p>`, 'views');
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#notes-body, .sect-body')) return;
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.view) goView(readViews()[Number(t.dataset.view)]);
    if (t.dataset.viewDel) { const vs = readViews(); vs.splice(Number(t.dataset.viewDel), 1); writeViews(vs); viewsPanel(); }
    if (t.dataset.viewSave) { saveView(); viewsPanel(); }
    if (t.dataset.flight) { const a = state.data.aircraft?.ac.find((f) => f.id === t.dataset.flight); if (a) { x.layer('aircraft').open({ ...a, src: state.data.aircraft.src }); x.fly(a.lat, a.lng, Math.min(state.pov.altitude, 0.4), false); } }
    if (t.dataset.ride) ride(t.dataset.ride === 'on');
  });

  // ------------------------------------------------------------ ride along with the ISS
  const chip = document.createElement('div');
  chip.id = 'ride'; chip.hidden = true;
  chip.innerHTML = '<span class="ride-dot"></span><div><b>Riding with the ISS</b><small id="ride-txt">…</small></div><button class="btn ghost" id="ride-stop">Stop</button>';
  (document.getElementById('stage') ?? document.body).appendChild(chip);
  chip.querySelector('#ride-stop').addEventListener('click', () => ride(false));
  let lastTxt = 0; let lastCam = 0;
  function issNow() {
    const g = state.data.stations; if (!g) return null;
    return positions(g, x.now()).find((p) => /ISS \(ZARYA\)|^ISS$/.test(p.name)) ?? null;
  }
  function ride(on) {
    if (!on) { state.ride = null; chip.hidden = true; return; }
    if (!state.on.has('stations')) { x.toggleLayer('stations', true); x.renderLayerPanel(); }
    state.ride = { alt: Math.min(Math.max(state.pov.altitude, 0.25), 0.6) };
    chip.hidden = false; x.closeNotes?.();
    const p = issNow(); if (p) globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: state.ride.alt }, x.reduceMotion ? 0 : 1500);
    lastCam = performance.now() + 1500;
    requestAnimationFrame(step);
  }
  function step(t) {
    if (!state.ride) return;
    const p = issNow();
    if (p && t > lastCam) {
      // follow in small steps; the user can still zoom (the altitude is taken from the camera each time)
      state.ride.alt = Math.min(3, Math.max(0.03, state.pov.altitude));
      globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: state.ride.alt }, 0);
      lastCam = t + 50;
    }
    if (p && t - lastTxt > 1000) {
      lastTxt = t;
      const c = x.countryAt(p.lat, p.lng)?.properties;
      const over = c?.name ?? waterName(p.lat, p.lng);
      const day = x.solarElevation(p.lat, p.lng, x.now()) > 0 ? 'in daylight' : 'in darkness';
      const el = $('#ride-txt'); if (el) el.textContent = `Over ${over} · ${Math.round(p.altKm)} km up · ${Math.round(p.speedKms * 3600).toLocaleString()} km/h · ${day} below`;
    }
    requestAnimationFrame(step);
  }
  // Grabbing the globe stops the ride, like any follow camera.
  globe.renderer().domElement.addEventListener('pointerdown', () => { if (state.ride) { ride(false); toast('Stopped riding with the ISS'); } });

  // ------------------------------------------------------------ flights board
  function flightsBoard() {
    if (!state.on.has('aircraft')) { x.toggleLayer('aircraft', true); x.renderLayerPanel(); }
    const d = state.data.aircraft;
    if (!d?.ac?.length) { x.openNotes('Flights board', `<h3>Flights board</h3><p>${esc(state.lstatus.aircraft?.note || 'Flights are still loading — try again in a few seconds.')}</p>`, 'flightsboard'); return; }
    const ac = d.ac; const air = ac.filter((a) => !a.ground);
    const band = [[0, 10000, 'below 10,000 ft', '#7ed6c4'], [10000, 25000, '10,000–25,000 ft', '#ffd37a'], [25000, 36000, '25,000–36,000 ft', '#f2f5f7'], [36000, 1e6, 'above 36,000 ft', '#b7d9ff']]
      .map(([a, b, l, c]) => [l, c, air.filter((f) => f.altFt >= a && f.altFt < b).length]);
    const max = Math.max(...band.map((b) => b[2]), 1);
    const row = (a, extra) => `<button class="tour-card" data-flight="${esc(a.id)}"><b>${esc(a.call || a.id.toUpperCase())}${a.type ? ` · ${esc(a.type)}` : ''}</b><span>${extra}</span></button>`;
    const fastest = [...air].filter((a) => a.kt).sort((a, b) => b.kt - a.kt).slice(0, 5);
    const highest = [...air].sort((a, b) => b.altFt - a.altFt).slice(0, 5);
    const em = ac.filter((a) => EMERGENCY.has(a.squawk));
    const countries = {}; for (const a of ac) if (a.country) countries[a.country] = (countries[a.country] ?? 0) + 1;
    const topC = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 6);
    x.openNotes('Flights board', `<div class="deck"><h3>Flights board</h3>
      <p class="sub">${esc(d.src)}</p>
      <div class="stats"><div class="cell"><span>Aircraft</span><b>${ac.length.toLocaleString()}</b><small>on the map</small></div><div class="cell"><span>In the air</span><b>${air.length.toLocaleString()}</b><small>${Math.round(air.length / ac.length * 100)} %</small></div>
      <div class="cell"><span>On the ground</span><b>${(ac.length - air.length).toLocaleString()}</b><small>taxiing or parked</small></div><div class="cell"><span>Emergencies</span><b>${em.length}</b><small>squawk 7500/7600/7700</small></div></div>
      <h4>Height bands</h4><div class="bars">${band.map(([l, c, n]) => `<div class="bar"><span>${l}</span><i style="width:${(n / max) * 100}%;background:${c}"></i><b>${n.toLocaleString()}</b></div>`).join('')}</div>
      ${em.length ? `<h4>Emergency squawks</h4>${em.map((a) => row(a, `squawk ${esc(a.squawk)} · ${Math.round(a.altFt).toLocaleString()} ft`)).join('')}` : ''}
      <h4>Fastest over the ground</h4>${fastest.map((a) => row(a, `${Math.round(a.kt * 1.852).toLocaleString()} km/h · ${Math.round(a.altFt).toLocaleString()} ft${a.kt > 560 ? ' · riding a jet stream tailwind' : ''}`)).join('')}
      <h4>Highest</h4>${highest.map((a) => row(a, `${Math.round(a.altFt).toLocaleString()} ft · ${Math.round(a.altFt / 3.281).toLocaleString()} m`)).join('')}
      ${topC.length ? `<h4>Registered in</h4><dl>${topC.map(([n, v]) => `<dt>${esc(n)}</dt><dd>${v.toLocaleString()}</dd>`).join('')}</dl>` : ''}
      <p class="muted">Airliners cruise at 30,000–41,000 ft where the air is thin (less drag) but engines still get enough oxygen. Ground speeds above ~1,000 km/h are almost always a strong jet-stream tailwind, not a faster plane.</p></div>`, 'flightsboard');
  }

  return { open, ride, flightsBoard, saveView, viewsPanel };
}
