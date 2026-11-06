// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: offline mode, part 3, what you see. When the internet goes (a dropped connection,
// a blocked network or the whole world's), the atlas keeps going on what is on the device:
//  • an "Offline" chip in the top bar, a toast when it changes, and each layer saying how old its saved copy is;
//  • back online: every layer that is on refreshes by itself;
//  • the Offline kit (Tools, or click the chip): what works with no internet, what this device has saved and how
//    old it is, "Save everything for offline" (every bundled dataset, texture and page, through sw.js), and
//    "Where am I", worked out on the device alone: GPS position, the nearest city and airport, sunrise, sunset and
//    dusk, the Moon, which planets are up and when the space station next flies over.
import { onNet, isOffline, listSaved, clearSaved, ago, probe } from './lastknown.js';
import { SOURCES } from './sources.js';
import { haversineKm, bearingDeg, moonState, fmtLat, fmtLng, localSolarTime } from './astro.js';
import { cities, airports } from './citydetail.js';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const hhmm = (d) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const WORKS = [
  ['The globe', 'day and night lit from the real Sun, borders, relief, the night-time lights'],
  ['Satellites', 'every orbit worked out on the device, from the last orbits it saw or the bundled snapshot'],
  ['Sun, Moon and planets', 'where they are, eclipses, the Moon’s phase and tides'],
  ['Countries, cities, airports, landmarks', 'their pages from the bundled data'],
  ['Search', 'every bundled place, airport, port and layer'],
  ['Tools', 'measure, time machine, tours, the quiz, saved views, pictures'],
  ['Last known', 'every feed you have opened, with its age: quakes, storms, fires, news, launches'],
  ['Lessons and the fluid lab', 'the Learn pages and the simulations'],
];

export function installOffline(api) {
  const { $, esc, toast, openNotes, state } = api;
  // styles in their own file (no inline styles: the security update's content policy)
  if (!document.querySelector('link[data-offline-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/offline.css'; l.dataset.offlineCss = '1'; document.head.append(l);
  }

  // ---------------------------------------------------------------- the chip
  const chip = document.createElement('button');
  chip.id = 'offline-chip'; chip.className = 'chipbtn offb'; chip.hidden = true; chip.type = 'button';
  chip.title = 'No internet. The atlas is showing what this device saved. Click for the Offline kit.';
  chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2"/><path d="M3 3l18 18"/></svg><span>Offline</span>';
  chip.addEventListener('click', () => openKit());
  const bar = document.querySelector('.top-status'); if (bar) bar.insertBefore(chip, document.getElementById('theme-toggle'));
  const live = document.createElement('p'); live.className = 'sr'; live.setAttribute('aria-live', 'polite'); document.body.append(live);

  function show(down, quiet = false) {
    chip.hidden = !down;
    document.body.classList.toggle('is-offline', down);
    if (quiet) return;
    const msg = down ? 'Offline. Showing what this device saved; live data comes back by itself.' : 'Back online. Refreshing the live layers.';
    toast(msg); live.textContent = msg;
    if (!down) setTimeout(() => { for (const id of state.on) api.refreshLayer(id); }, 400);
    if (kitOpen()) openKit();
  }
  show(isOffline(), true);
  onNet((down) => show(down));

  // ---------------------------------------------------------------- service worker messages
  const sw = () => navigator.serviceWorker?.controller ?? null;
  const swReady = () => navigator.serviceWorker?.ready ?? Promise.reject(new Error('no service worker'));
  let packInfo = null; let packJob = null;
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data; if (d?.from !== 'gia-sw') return;
    if (d.type === 'pack-info') { packInfo = d; paintPack(); }
    if (d.type === 'pack-progress' || d.type === 'pack-done') {
      packJob = d.type === 'pack-done' ? null : d;
      const el = $('#ok-pack-state');
      if (el) el.textContent = d.type === 'pack-done' ? `Saved ${(d.done - d.failed).toLocaleString()} files (${mb(d.bytes)})${d.failed ? `; ${d.failed} were not there and were skipped` : ''}. The atlas now opens with no internet.` : `Saving… ${d.done.toLocaleString()} of ${d.total.toLocaleString()} files (${mb(d.bytes)})`;
      const bar2 = $('#ok-pack-bar'); if (bar2) bar2.value = d.done / Math.max(1, d.total);
      if (d.type === 'pack-done') { sw()?.postMessage({ type: 'pack-info' }); try { localStorage.setItem('gia-offline-pack', String(Date.now())); } catch { /* private window */ } }
    }
  });
  function paintPack() {
    const el = $('#ok-pack-info'); if (!el || !packInfo) return;
    el.textContent = packInfo.files ? `${packInfo.files.toLocaleString()} files saved for offline${packInfo.tiles ? `, plus ${packInfo.tiles.toLocaleString()} map tiles you have looked at` : ''}.` : packInfo.tiles ? `${packInfo.tiles.toLocaleString()} map tiles you have looked at are kept.` : 'Nothing saved for offline yet.';
  }
  async function savePack() {
    const st = $('#ok-pack-state');
    try {
      await swReady();
      if (!sw()) throw new Error('reload the page once, then try again');
      const m = await fetch('data/offline-pack.json', { cache: 'no-cache' }).then((r) => r.json());
      // ask the browser not to clear these when space runs low
      try { await navigator.storage?.persist?.(); } catch { /* optional */ }
      sw().postMessage({ type: 'pack', urls: m.files.map(([p]) => new URL(`../${p}`, location.href).href) });
      packJob = { done: 0, total: m.count, bytes: 0 };
      if (st) st.textContent = `Saving… 0 of ${m.count.toLocaleString()} files`;
    } catch (err) {
      if (st) st.textContent = api.isDesktop ? 'The desktop app already carries every file; nothing to save.' : `Could not start: ${err.message}. Offline saving needs the site served over https (as on GitHub Pages).`;
    }
  }

  // ---------------------------------------------------------------- the Offline kit
  const kitOpen = () => document.body.classList.contains('right-open') && document.querySelector('#notes-title')?.textContent === 'Offline kit';
  async function openKit() {
    const down = isOffline();
    const saved = await listSaved();
    // one row per source: its newest copy and how many places/areas it covers
    const by = new Map();
    for (const e of saved) { const k = e.id.split(':')[0]; const g = by.get(k) ?? { id: k, t: 0, n: 0, b: 0 }; g.t = Math.max(g.t, e.t); g.n += 1; g.b += e.n; by.set(k, g); }
    const rows = [...by.values()].sort((a, b) => b.t - a.t);
    const total = saved.reduce((s, e) => s + e.n, 0);
    let est = null; try { est = await navigator.storage?.estimate?.(); } catch { /* optional */ }
    let persisted = false; try { persisted = !!(await navigator.storage?.persisted?.()); } catch { /* optional */ }
    const packed = (() => { try { return Number(localStorage.getItem('gia-offline-pack')) || 0; } catch { return 0; } })();
    openNotes('Offline kit', `<div class="ok">
      <p class="ok-state" data-down="${down}"><b>${down ? 'Offline' : 'Online'}</b> ${down ? 'The atlas is running on what this device has. Live data comes back by itself when the internet does.' : 'Everything you open is also kept on this device, so it still works if the internet goes.'}</p>
      ${down ? '<p><button class="btn ghost" data-ok="retry">Check the connection now</button></p>' : ''}
      <h4>Where am I</h4>
      <p class="muted">Worked out on this device alone. A phone’s GPS needs no internet; a computer may need the view’s centre instead.</p>
      <div class="row"><button class="btn" data-ok="gps">Use my position</button><button class="btn ghost" data-ok="view">Use the centre of the view</button></div>
      <div id="ok-here" aria-live="polite"></div>
      <h4>Works with no internet</h4>
      <ul class="ok-works">${WORKS.map(([a, b]) => `<li><b>${esc(a)}</b> <span>${esc(b)}</span></li>`).join('')}</ul>
      <p class="muted">Needs the internet: live flights and ships after 20 and 60 minutes, satellite imagery and street maps you have not looked at, weather radar, web searches, news video and live cameras.</p>
      <h4>Save everything for offline</h4>
      <p>Every bundled dataset, Earth texture and page, so the atlas opens and runs with no internet at all. <span class="muted">About ${mb(await packBytes())}.${packed ? ` Last saved ${ago(packed)}.` : ''}</span></p>
      <div class="row"><button class="btn" data-ok="pack" ${packJob ? 'disabled' : ''}>${packed ? 'Save again (updates it)' : 'Save everything'}</button><button class="btn ghost" data-ok="clear">Clear what is saved</button></div>
      <progress id="ok-pack-bar" max="1" value="${packJob ? packJob.done / Math.max(1, packJob.total) : 0}" ${packJob ? '' : 'hidden'}></progress>
      <p id="ok-pack-state" class="muted" aria-live="polite"></p><p id="ok-pack-info" class="muted"></p>
      <details class="ok-saved"><summary>Last known data on this device <span class="muted">${rows.length} sources, ${mb(total)}</span></summary>
        ${rows.length ? `<ul class="ok-list">${rows.map((g) => `<li><span>${esc(SOURCES[g.id]?.name ?? g.id)}</span><em>${ago(g.t)}${g.n > 1 ? ` · ${g.n}` : ''}</em></li>`).join('')}</ul>` : '<p class="muted">Nothing yet. Each feed is kept the first time a layer that uses it is switched on.</p>'}
      </details>
      <p class="muted">Storage: ${est ? `${mb(est.usage ?? 0)} used of ${mb(est.quota ?? 0)} this browser allows` : 'unknown'}${persisted ? ' · kept even when space runs low' : ''}. Saved feeds older than 45 days are dropped, and planes and ships are never shown once their copy is too old to be right.</p>
    </div>`);
    if (packJob) $('#ok-pack-bar').hidden = false;
    sw()?.postMessage({ type: 'pack-info' });
  }
  let packSize = null;
  async function packBytes() {
    if (packSize != null) return packSize;
    try { packSize = (await fetch('data/offline-pack.json').then((r) => r.json())).bytes; } catch { packSize = 75 * 1048576; }
    return packSize;
  }

  // ---------------------------------------------------------------- Where am I
  async function here(lat, lng, how) {
    const out = $('#ok-here'); if (!out) return;
    out.innerHTML = '<p class="muted">Working it out…</p>';
    const now = api.now?.() ?? new Date();
    const [cs, as] = await Promise.all([cities().catch(() => []), airports().catch(() => [])]);
    const near = (list, f = () => true) => { let best = null; let bd = Infinity; for (const p of list) { if (!f(p)) continue; const d = haversineKm(lat, lng, p.lat, p.lng); if (d < bd) { bd = d; best = p; } } return best && { p: best, km: bd, dir: compass(bearingDeg(lat, lng, best.lat, best.lng)) }; };
    const city = near(cs); const big = near(cs, (c) => c.pop >= 1e6); const ap = near(as, (a) => a.large) ?? near(as);
    const sun = await sunTimes(lat, lng, now);
    const m = moonState(now);
    const sky = await planetsUp(lat, lng, now);
    const iss = await issPass(lat, lng);
    const dist = (x) => (x.km < 1 ? 'here' : `${x.km < 10 ? x.km.toFixed(1) : Math.round(x.km).toLocaleString()} km ${x.dir}`);
    const solar = localSolarTime(lng, now);
    out.innerHTML = `<dl class="ok-here">
      <dt>Position</dt><dd><b>${fmtLat(lat)}, ${fmtLng(lng)}</b> <span class="muted">${esc(how)}</span></dd>
      ${city ? `<dt>Nearest town</dt><dd><button class="linkbtn" data-fly="${city.p.lat},${city.p.lng},0.05">${esc(city.p.name)}</button> ${dist(city)}</dd>` : ''}
      ${big && big.p !== city?.p ? `<dt>Nearest big city</dt><dd><button class="linkbtn" data-fly="${big.p.lat},${big.p.lng},0.1">${esc(big.p.name)}</button> ${dist(big)}</dd>` : ''}
      ${ap ? `<dt>Nearest airport</dt><dd><button class="linkbtn" data-fly="${ap.p.lat},${ap.p.lng},0.03">${esc(ap.p.name)}${ap.p.iata ? ` (${esc(ap.p.iata)})` : ''}</button> ${dist(ap)}</dd>` : ''}
      <dt>Sun</dt><dd>${sun}</dd>
      <dt>Sun time</dt><dd>${solar} local solar time (noon is when the Sun is highest)</dd>
      <dt>Moon</dt><dd>${esc(m.name)}, ${Math.round(m.illum * 100)}% lit</dd>
      <dt>Planets up</dt><dd>${sky}</dd>
      ${iss ? `<dt>Space station</dt><dd>${iss}</dd>` : ''}
    </dl>
    <div class="row"><button class="btn ghost" data-fly="${lat},${lng},0.02">Fly there</button></div>`;
  }
  let A = null;
  const engine = async () => (A ??= await import('../vendor/astronomy.min.mjs'));
  async function sunTimes(lat, lng, now) {
    try {
      const E = await engine(); const o = new E.Observer(lat, lng, 0);
      const t = (x) => x?.date ?? null;
      const rise = t(E.SearchRiseSet(E.Body.Sun, o, +1, now, 1)); const set = t(E.SearchRiseSet(E.Body.Sun, o, -1, now, 1));
      const dusk = t(E.SearchAltitude(E.Body.Sun, o, -1, now, 1, -6));
      const eq = E.Equator(E.Body.Sun, now, o, true, true); const alt = E.Horizon(now, o, eq.ra, eq.dec, 'normal').altitude;
      if (!rise && !set) return alt > 0 ? 'Up all day (midnight sun)' : 'Down all day (polar night)';
      return `${alt > 0 ? `Up, ${Math.round(alt)}° high` : alt > -6 ? 'Twilight' : 'Down'} · next sunset <b>${hhmm(set)}</b>${dusk ? `, dark ${hhmm(dusk)}` : ''} · next sunrise <b>${hhmm(rise)}</b>`;
    } catch { return '—'; }
  }
  async function planetsUp(lat, lng, now) {
    try {
      const E = await engine(); const o = new E.Observer(lat, lng, 0);
      const up = [];
      for (const b of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']) {
        const eq = E.Equator(E.Body[b], now, o, true, true); const h = E.Horizon(now, o, eq.ra, eq.dec, 'normal');
        if (h.altitude > 5) up.push(`${b} ${Math.round(h.altitude)}° up in the ${compass(h.azimuth)}`);
      }
      return up.length ? esc(up.join(' · ')) : 'None above the horizon now';
    } catch { return '—'; }
  }
  async function issPass(lat, lng) {
    try {
      const S = await import('./satellites.js'); const g = await S.loadGroup('stations');
      if (g.snapshot) return ''; // the bundled orbits are too old to time a pass
      const iss = g.sats.find((s) => /ISS|ZARYA/.test(s.name)); if (!iss) return '';
      const p = S.passes(iss, lat, lng, 36)[0];
      return p ? `Next pass ${p.start.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, up to ${Math.round(p.maxEl)}° high, rising in the ${compass(p.az)}` : 'No pass above 10° in the next 36 hours';
    } catch { return ''; }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ok], [data-offline]'); if (!t) return;
    if (t.dataset.offline === 'open') return openKit();
    const k = t.dataset.ok;
    if (k === 'retry') { t.disabled = true; t.textContent = 'Checking…'; probe().then((ok) => { if (!ok) { t.disabled = false; t.textContent = 'Still offline. Check again'; } }); }
    if (k === 'view') here(state.pov.lat, state.pov.lng, 'the centre of the view');
    if (k === 'gps') {
      const out = $('#ok-here');
      if (!navigator.geolocation) { if (out) out.innerHTML = '<p class="err">This browser cannot give a position. Use the centre of the view.</p>'; return; }
      if (out) out.innerHTML = '<p class="muted">Asking for your position…</p>';
      navigator.geolocation.getCurrentPosition(
        (p) => here(p.coords.latitude, p.coords.longitude, `GPS, to about ${Math.round(p.coords.accuracy).toLocaleString()} m`),
        (err) => { if (out) out.innerHTML = `<p class="err">${err.code === 1 ? 'Position not allowed. You can allow it in the browser’s site settings, or use the centre of the view.' : 'No position yet (no GPS fix, and no internet to look it up). Try outdoors, or use the centre of the view.'}</p>`; },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
      );
    }
    if (k === 'pack') { t.disabled = true; savePack(); $('#ok-pack-bar') && ($('#ok-pack-bar').hidden = false); }
    if (k === 'clear') {
      clearSaved().then(() => { sw()?.postMessage({ type: 'pack-clear' }); try { localStorage.removeItem('gia-offline-pack'); } catch { /* ignore */ } toast('Cleared the data saved for offline on this device.'); if (kitOpen()) openKit(); });
    }
  });

  return { openKit, isOffline };
}
