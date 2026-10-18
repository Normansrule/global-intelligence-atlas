// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — Overwatch HUD. A heads-up display over the globe (inspired by the augmented-reality
// glasses of superhero films) that reads out what is around the crosshair, and an Area Scan that pulls
// every public layer together into one report: what flies overhead, which satellites can see this spot,
// the cameras, networks, power and cables nearby, and the weather — all from open data.
import { getFeed, getLocal } from './feeds.js';
import { haversineKm, fmtLat, fmtLng, localSolarTime, solarElevation } from './astro.js';
import { satellite } from '../vendor/vendor.min.mjs';
import { loadGroup } from './satellites.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const km = (x) => (x < 10 ? `${x.toFixed(1)} km` : `${Math.round(x).toLocaleString()} km`);

/** Satellites above 10° elevation for an observer, right now. */
export function overhead(sats, lat, lng, now = new Date()) {
  const obs = { longitude: satellite.degreesToRadians(lng), latitude: satellite.degreesToRadians(lat), height: 0.05 };
  const gmst = satellite.gstime(now); const out = [];
  for (const s of sats) {
    const pv = satellite.propagate(s.satrec, now); if (!pv.position || typeof pv.position === 'boolean') continue;
    const look = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
    const el = (look.elevation * 180) / Math.PI;
    if (el > 10) out.push({ name: s.name, el, az: (look.azimuth * 180) / Math.PI, rangeKm: look.rangeSat });
  }
  return out.sort((a, b) => b.el - a.el);
}
const compass = (d) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((d % 360) + 360) % 360) / 45) % 8];

export function installHud(api) {
  const { state, $, globe } = api;
  const el = document.createElement('div'); el.id = 'hud'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg class="reticle" viewBox="0 0 200 200"><circle cx="100" cy="100" r="46"/><circle cx="100" cy="100" r="80" class="thin"/><path d="M100 30v26M100 144v26M30 100h26M144 100h26"/><circle cx="100" cy="100" r="2.5" class="dot"/></svg>
    <div class="hud-tl"><b>OVERWATCH</b><span id="hud-time"></span><span id="hud-pos"></span><span id="hud-alt"></span></div>
    <div class="hud-tr" id="hud-counts"></div>
    <div class="hud-bl" id="hud-near"></div>
    <button class="hud-scan" id="hud-scan">SCAN AREA <small>(S)</small></button>
    <div class="hud-sweep"></div>`;
  (document.getElementById('stage') ?? document.body).appendChild(el);

  function nearby(center, radius) {
    const res = [];
    for (const l of api.LAYERS) {
      if (!state.on.has(l.id)) continue;
      const ch = state.chan[l.id]; if (!ch) continue;
      const pts = ch.pick?.length ? ch.pick : [...(ch.points ?? []), ...(ch.labels ?? [])];
      let n = 0; let best = null;
      for (const p of pts) { if (p.lat == null) continue; const d = haversineKm(center.lat, center.lng, p.lat, p.lng); if (d < radius) { n += 1; if (!best || d < best.d) best = { d, p }; } }
      if (n) res.push({ l, n, best });
    }
    return res.sort((a, b) => b.n - a.n);
  }

  function tick() {
    if (el.hidden) return;
    const p = state.pov; const now = api.now();
    $('#hud-time').textContent = `${now.toISOString().slice(11, 19)} UTC · local solar ${localSolarTime(p.lng, now)}`;
    $('#hud-pos').textContent = `${fmtLat(p.lat)}  ${fmtLng(p.lng)}`;
    $('#hud-alt').textContent = `eye ${Math.round(p.altitude * 6371).toLocaleString()} km · sun ${solarElevation(p.lat, p.lng, now).toFixed(0)}°`;
    const r = Math.max(5, Math.min(250, p.altitude * 6371 * 0.35));
    const near = nearby(p, r);
    $('#hud-counts').innerHTML = `<b>WITHIN ${km(r)}</b>${near.slice(0, 8).map((x) => `<span style="--c:${x.l.swatch}">${x.n.toLocaleString()} <i>${esc(x.l.label)}</i></span>`).join('') || '<span>No active layers in range</span>'}`;
    const cl = near.map((x) => ({ ...x.best, l: x.l })).sort((a, b) => a.d - b.d).slice(0, 4);
    $('#hud-near').innerHTML = cl.map((c) => `<span>▸ ${esc(c.l.label)} <b>${km(c.d)}</b></span>`).join('');
  }
  setInterval(tick, 1000);

  async function scan() {
    const p = { ...state.pov }; const r = Math.max(10, Math.min(400, p.altitude * 6371 * 0.5));
    el.classList.remove('scanning'); void el.offsetWidth; el.classList.add('scanning');
    api.pulse(p.lat, p.lng, r);
    api.openNotes('Area scan', `<div class="scan"><p class="kicker">Scanning ${km(r)} around ${fmtLat(p.lat)}, ${fmtLng(p.lng)}…</p><div class="scanbar"><i></i></div></div>`, 'scan');
    const now = api.now();
    const cityP = getLocal('data/cities.json').then((d) => d.rows.map(([name, lat, lng, pop, , cc]) => ({ name, lat, lng, pop, cc })).map((c) => ({ ...c, d: haversineKm(p.lat, p.lng, c.lat, c.lng) })).sort((a, b) => a.d - b.d)[0]).catch(() => null);
    const wxP = getFeed('openmeteo', `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m,cloud_cover,visibility&timezone=auto`).catch(() => null);
    const satP = Promise.all(['stations', 'visual', 'gps-ops', 'weather'].map((g) => loadGroup(g).then((x) => (x.snapshot ? [] : x.sats)).catch(() => []))).then((gs) => overhead(gs.flat(), p.lat, p.lng, now));
    const [city, wx, sats] = await Promise.all([cityP, wxP, satP]);
    if (!api.isOpen('scan')) return;
    const near = nearby(p, r);
    const flights = (state.data.aircraft?.ac ?? []).filter((a) => haversineKm(p.lat, p.lng, a.lat, a.lng) < r);
    const hi = flights.filter((a) => a.altFt > 20000).length;
    const gps = sats.filter((s) => /NAVSTAR|GPS/.test(s.name)).length;
    const section = (t, body) => `<h4>${t}</h4>${body}`;
    api.openNotes('Area scan', `<div class="scan done">
      <p class="kicker">${km(r)} around ${fmtLat(p.lat)}, ${fmtLng(p.lng)} · ${now.toUTCString().slice(17, 25)} UTC</p>
      <h3>${city ? `${esc(city.name)}${city.d > 15 ? ` <small>(${km(city.d)} away)</small>` : ''}` : 'Open ocean or wilderness'}</h3>
      <div class="scan-grid">
        <div><b>${flights.length.toLocaleString()}</b><span>aircraft in range${flights.length ? ` · ${hi} above 20,000 ft` : ''}</span></div>
        <div><b>${sats.length}</b><span>tracked satellites above the horizon${gps ? ` · ${gps} GPS` : ''}</span></div>
        ${near.filter((x) => x.l.id !== 'aircraft').slice(0, 6).map((x) => `<div style="--c:${x.l.swatch}"><b>${x.n.toLocaleString()}</b><span>${esc(x.l.label)}</span></div>`).join('')}
      </div>
      ${wx ? section('Conditions', `<p>${api.wmo(wx.current.weather_code)}, ${wx.current.temperature_2m} °C, wind ${wx.current.wind_speed_10m} km/h, cloud ${wx.current.cloud_cover} %, visibility ${Math.round((wx.current.visibility ?? 0) / 1000)} km. Local time ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: wx.timezone })} (${esc(wx.timezone)}). Sun ${solarElevation(p.lat, p.lng, now).toFixed(0)}° above the horizon.</p>`) : ''}
      ${sats.length ? section('Satellites that can see this spot right now', `<ol class="sats">${sats.slice(0, 10).map((s) => `<li><b>${esc(s.name)}</b> <small>${Math.round(s.el)}° up, towards the ${compass(s.az)} · ${Math.round(s.rangeKm).toLocaleString()} km away</small></li>`).join('')}</ol><p class="muted">From the brightest satellites, space stations, GPS and weather groups. Thousands more (Starlink, debris) are overhead too.</p>`) : ''}
      ${near.length ? section('Nearest of each', `<ul class="nearest">${near.map((x) => `<li><button data-scanref="${esc(x.l.id)}">${esc(x.l.label)}: <b>${esc(String(x.best.p.label ?? x.best.p.ref?.d?.name ?? x.best.p.ref?.d?.call ?? '').slice(0, 60) || 'nearest item')}</b> <small>${km(x.best.d)}</small></button></li>`).join('')}</ul>`) : section('Tip', '<p>Switch on more layers (presets are at the top of the Layers panel) and scan again — every active layer is included.</p>')}
      <div class="row"><button class="btn" data-hudscan="1">Scan again</button><button class="btn ghost" data-trace="${p.lat},${p.lng}">Trace connections</button><button class="btn ghost" data-wall="1">Camera wall here</button></div>
    </div>`, 'scan');
    const refs = Object.fromEntries(near.map((x) => [x.l.id, x.best.p.ref]));
    document.querySelectorAll('[data-scanref]').forEach((b) => b.addEventListener('click', () => refs[b.dataset.scanref] && api.select(refs[b.dataset.scanref])));
  }
  $('#hud-scan').addEventListener('click', scan);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-hudscan]')) scan(); });
  document.addEventListener('keydown', (e) => { if (!e.target.matches('input, select, textarea') && (e.key === 's' || e.key === 'S')) scan(); });
  return { show(on) { el.hidden = !on; document.body.classList.toggle('hud-on', on); tick(); }, scan };
}
