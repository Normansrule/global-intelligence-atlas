// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the app shell. A rail of sections on the left (Layers, Live, Explore, Tools, Saved, About)
// opens one section at a time in the left drawer; details of whatever you click open in the right drawer.
// The globe gets whatever space is left, so panels never cover each other or the controls.
import { glyphSvg } from './icons.js';
import { installOsint, osintSection } from './osint.js';

const TITLES = { layers: 'Layers', map: 'Map style', live: 'Live now', explore: 'Explore', tools: 'Tools', intel: 'Open-source intelligence', saved: 'Saved views', about: 'About and sources' };
// openNotes() calls whose content is a "section" rather than the details of one thing
export const SECTION_FOR_KEY = { live: 'live', views: 'saved', about: 'about' };
export const SECTION_FOR_TITLE = { 'About and sources': 'about', 'Saved views': 'saved', 'Live now': 'live', 'Guided tours': 'explore' };

export function installShell(x) {
  const { $, esc } = x;
  let current = 'layers'; let key = 'section:layers';
  const body = (s) => document.querySelector(`#sect-${s} .sect-body`);

  function setOpen(open) {
    document.body.classList.toggle('left-open', open);
    installOsint({ show, back: () => tools() });
  document.querySelectorAll('.rail [data-section]').forEach((b) => b.setAttribute('aria-pressed', String(open && b.dataset.section === current)));
    try { localStorage.setItem('global-intelligence-atlas-section', open ? current : ''); } catch { /* private mode */ }
  }
  /** Show a section; `html` replaces its content when given (routed from openNotes). */
  function show(section, title, html, k) {
    current = section; key = k ?? `section:${section}`;
    // narrower windows (and phones) show one drawer at a time
    if (innerWidth < 1280 && document.body.classList.contains('right-open')) x.closeDetails();
    document.querySelectorAll('.drawer .sect').forEach((el) => { el.hidden = el.id !== `sect-${section}`; });
    $('#drawer-title').textContent = title ?? TITLES[section];
    if (html != null) { const b = body(section); if (b) { b.innerHTML = html; b.scrollTop = 0; } }
    setOpen(true);
  }
  function close() { setOpen(false); key = null; }
  const isOpen = (k) => document.body.classList.contains('left-open') && key === k;

  function explore() {
    const g = (n, c) => glyphSvg(n, c, 22);
    const tours = x.TOURS.map((t) => `<button class="tour-card" data-tour="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.blurb)}</span></button>`).join('');
    show('explore', 'Explore', `
      <h4>Start here</h4>
      <div class="toolgrid">
        <button class="tool" data-start="live">${g('news', '#ff9ec7')}<b>Live tour</b><small>Sit back while the globe flies from event to event.</small></button>
        <button class="tool" data-start="flights">${g('plane', '#8ecbff')}<b>Live flights</b><small>About 10,000 aircraft, gliding in real time.</small></button>
        <button class="tool" data-start="connected">${g('ix', '#7ed6c4')}<b>Connected planet</b><small>Cables, internet buildings, power, ships.</small></button>
        <button class="tool" data-start="moon">${g('moon', '#e8eef3')}<b>Moon and tides</b><small>Phase, distance and the two tidal bulges.</small></button>
        <button class="tool" data-start="wind">${g('dust', '#9fe3ff')}<b>Wind now</b><small>Streaks drifting with the real wind.</small></button>
        <button class="tool" data-start="cams">${g('camera', '#7ed6c4')}<b>Live cameras</b><small>Traffic cameras and a camera wall.</small></button>
      </div>
      <h4>Guided tours</h4>${tours}
      <h4>Test yourself</h4>
      <button class="tour-card" data-mode="quiz"><b>Where on Earth?</b><span>Eight places, click where you think each one is. Closer guesses score more.</span></button>
      <h4>Read more</h4>
      <div class="row"><a class="btn ghost" href="../learn/">Lessons</a><a class="btn ghost" href="../fluid/">Fluid lab</a><a class="btn ghost" href="../download/">Desktop app</a><a class="btn ghost" href="../">Home page</a></div>
      <p class="muted" style="margin-top:12px"><button class="btn ghost" data-whatsnew="1">What’s new in this version</button></p>`);
  }
  function tools() {
    const g = (n, c) => glyphSvg(n, c, 22);
    show('tools', 'Tools', `
      <p class="muted">Each tool works on whatever you are looking at. Keyboard shortcuts are in brackets.</p>
      <h4>Measure and analyse</h4>
      <div class="toolgrid">
        <button class="tool" data-mode="measure">${g('pin', '#e3b55b')}<b>Measure</b><small>Great-circle distance, bearing and light-speed delay.</small></button>
        <button class="tool" data-mode="trace">${g('ix', '#7ed6c4')}<b>Trace [C]</b><small>How a place is wired to the world.</small></button>
        <button class="tool" data-tool="sky">${g('sat', '#b7a3ff')}<b>Sky above here</b><small>Sun, Moon, satellites and planes overhead.</small></button>
        <button class="tool" data-hudscan="1">${g('eye', '#9ff8e8')}<b>Area scan [S]</b><small>Everything around the centre of the view.</small></button>
      </div>
      <h4>Monitor</h4>
      <div class="toolgrid">
        <button class="tool" data-watch="open">${g('alert', '#e3b55b')}<b>Watch areas</b><small>Get notified about quakes, alerts, emergencies and fires in places you choose.</small></button>
        <button class="tool" data-health="open">${g('server', '#7ed6c4')}<b>Data health</b><small>Is every source working? Last update, counts and errors.</small></button>
      </div>
      <h4>Flights and space</h4>
      <div class="toolgrid">
        <button class="tool" data-board="1">${g('plane', '#8ecbff')}<b>Flights board</b><small>Fastest, highest, emergencies.</small></button>
        <button class="tool" data-ride="on">${g('sat', '#ffd37a')}<b>Ride with the ISS</b><small>The camera follows the station.</small></button>
        <button class="tool" data-tool="find">${g('plane', '#e3b55b')}<b>Find a flight</b><small>Callsign, airline, registration or type.</small></button>
        <button class="tool" data-wall="1">${g('camera', '#7ed6c4')}<b>Camera wall</b><small>Every live camera in view.</small></button>
      </div>
      <h4>Time</h4>
      <div class="toolgrid">
        <button class="tool" data-tool="time">${g('sun', '#ffd37a')}<b>Time machine</b><small>Run the planet forwards or back, up to 7 days.</small></button>
        <button class="tool" data-start="replay">${g('quake', '#f79d5c')}<b>Replay quakes</b><small>A week of earthquakes at an hour a second.</small></button>
      </div>
      <h4>Share and keep</h4>
      <div class="toolgrid">
        <button class="tool" data-share="1">${g('ix', '#eef3f6')}<b>Copy a link</b><small>This view, these layers, what is selected.</small></button>
        <button class="tool" data-view-save="1">${g('pin', '#eef3f6')}<b>Save this view</b><small>Keep it under Saved.</small></button>
        <button class="tool" data-tool="shot">${g('eye', '#eef3f6')}<b>Picture</b><small>Save the globe as a PNG.</small></button>
        <button class="tool" data-tool="spin">${g('moon', '#eef3f6')}<b>Spin [R]</b><small>Rotate the globe slowly.</small></button>
      </div>${osintSection(glyphSvg)}`);
  }

  function open(section) {
    if (document.body.classList.contains('left-open') && current === section) return close();
    if (section === 'layers') return show('layers');
    if (section === 'map') return show('map');
    if (section === 'live') return x.openLive();
    if (section === 'explore') return explore();
    if (section === 'tools') return tools();
    if (section === 'saved') return x.openSaved();
    if (section === 'about') return x.openAbout();
    if (extra[section]) return extra[section]();
  }
  // sections added by other modules (intel.js): register(section, open)
  const extra = {};
  const register = (section, fn) => { extra[section] = fn; };
  document.querySelectorAll('.rail [data-section]').forEach((b) => b.addEventListener('click', () => open(b.dataset.section)));
  $('#drawer-close')?.addEventListener('click', close);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]'); if (!t) return;
    const k = t.dataset.tool;
    if (k === 'sky') x.sky();
    if (k === 'time') { $('#timebar').hidden = !$('#timebar').hidden; }
    if (k === 'shot') $('#shot')?.click();
    if (k === 'spin') $('#spin')?.click();
    if (k === 'find') { x.palette(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target.matches('input, select, textarea')) return;
    if (document.querySelector('#palette:not([hidden])')) return;
    if (document.body.classList.contains('left-open') && !document.body.classList.contains('right-open')) close();
  });
  // restore the last open section (Layers on a first visit)
  let last = 'layers'; try { last = localStorage.getItem('global-intelligence-atlas-section') ?? 'layers'; } catch { /* ignore */ }
  if (matchMedia('(max-width: 860px)').matches) close(); else if (!last) close(); else if (last === 'layers' || !['explore', 'tools', 'intel'].includes(last)) show('layers'); else setTimeout(() => open(last), 0);
  return { show, close, open, isOpen, current: () => current, explore, tools, register };
}
