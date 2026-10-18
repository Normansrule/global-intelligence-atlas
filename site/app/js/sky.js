// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the sky above a place.
// A live polar chart, like a planisphere seen from below: the horizon is the outer circle and straight up
// is the centre. It plots the Sun, the Moon, every loaded satellite and every plane near you at its real
// direction (azimuth) and height above the horizon (elevation), redrawn every two seconds.
import { subsolarPoint, moonState, R_EARTH_KM, haversineKm } from './astro.js';
import { positions } from './satellites.js';

const D2R = Math.PI / 180;
const ecef = (lat, lng, altKm = 0) => { const r = R_EARTH_KM + altKm; const cl = Math.cos(lat * D2R); return [r * cl * Math.cos(lng * D2R), r * cl * Math.sin(lng * D2R), r * Math.sin(lat * D2R)]; };

/** Azimuth (degrees from north, clockwise) and elevation (degrees above the horizon) of a target. */
export function lookAngles(oLat, oLng, tLat, tLng, tAltKm) {
  const O = ecef(oLat, oLng); const T = ecef(tLat, tLng, tAltKm);
  const d = [T[0] - O[0], T[1] - O[1], T[2] - O[2]]; const len = Math.hypot(...d);
  const sp = Math.sin(oLat * D2R); const cp = Math.cos(oLat * D2R); const sl = Math.sin(oLng * D2R); const cl = Math.cos(oLng * D2R);
  const e = -sl * d[0] + cl * d[1]; const n = -sp * cl * d[0] - sp * sl * d[1] + cp * d[2]; const u = cp * cl * d[0] + cp * sl * d[1] + sp * d[2];
  return { az: ((Math.atan2(e, n) / D2R) + 360) % 360, el: Math.asin(u / len) / D2R, rangeKm: len };
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirName = (az) => COMPASS[Math.round(az / 45) % 8];

export function installSky(api) {
  const { state, esc } = api;
  let timer = null; let at = null;

  function objects(lat, lng, now) {
    const out = [];
    const s = subsolarPoint(now); const sun = lookAngles(lat, lng, s.lat, s.lng, 1.496e8);
    out.push({ kind: 'sun', name: 'Sun', ...sun, color: '#ffd37a', r: 9 });
    const m = moonState(now); const moon = lookAngles(lat, lng, m.lat, m.lng, m.distKm - R_EARTH_KM);
    out.push({ kind: 'moon', name: `Moon (${Math.round(m.illum * 100)} % lit)`, ...moon, color: '#e8eef3', r: 7 });
    const groups = [];
    if (state.data.stations) groups.push(['station', state.data.stations]);
    if (state.data.satellites) for (const g of Object.values(state.data.satellites)) if (g?.sats) groups.push(['sat', g]);
    for (const [kind, g] of groups) {
      for (const p of positions(g, now)) {
        if (!Number.isFinite(p.lat) || (p.altKm < 2000 && haversineKm(lat, lng, p.lat, p.lng) > 4000)) continue; // low orbits only show within ~4,000 km
        const a = lookAngles(lat, lng, p.lat, p.lng, p.altKm);
        if (a.el > 0) out.push({ kind: /ISS/.test(p.name) ? 'iss' : kind, name: p.name, ...a, color: /ISS/.test(p.name) ? '#ffd37a' : '#b7a3ff', r: /ISS/.test(p.name) ? 6 : 2.6, km: p.altKm });
      }
    }
    for (const a of state.data.aircraft?.ac ?? []) {
      if (a.ground || haversineKm(lat, lng, a.lat, a.lng) > 200) continue;
      const v = lookAngles(lat, lng, a.lat, a.lng, a.altFt / 3281);
      if (v.el > 2) out.push({ kind: 'plane', name: a.call || a.id.toUpperCase(), ...v, color: '#8ecbff', r: 3.2, trk: a.trk, ft: a.altFt, id: a.id });
    }
    return out;
  }

  function svg(objs) {
    const S = 300; const C = S / 2; const Rr = C - 18;
    const xy = (az, el) => { const rr = Rr * (1 - Math.max(0, el) / 90); return [C + rr * Math.sin(az * D2R), C - rr * Math.cos(az * D2R)]; };
    const rings = [0, 30, 60].map((e) => `<circle cx="${C}" cy="${C}" r="${Rr * (1 - e / 90)}" class="sky-ring"/>`).join('');
    const ticks = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([t, az]) => { const [x, y] = xy(az, -9); return `<text x="${x}" y="${y}" class="sky-dir">${t}</text>`; }).join('');
    const dots = objs.filter((o) => o.el > 0).sort((a, b) => a.r - b.r).map((o) => {
      const [x, y] = xy(o.az, o.el);
      if (o.kind === 'plane') return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(o.trk ?? 0).toFixed(0)})"><path d="M0 -4.5 1 -1 4.5 1 4.5 2 1 1 .8 3.5 2 4.5 2 5 0 4.4 -2 5 -2 4.5 -.8 3.5 -1 1 -4.5 2 -4.5 1 -1 -1z" fill="${o.color}"/><title>${esc(o.name)} · ${Math.round(o.el)}° up</title></g>`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${o.r}" fill="${o.color}"${o.kind === 'sun' ? ' class="sky-sun"' : ''}><title>${esc(o.name)} · ${Math.round(o.el)}° up, ${dirName(o.az)}</title></circle>${o.kind === 'iss' || o.kind === 'sun' || o.kind === 'moon' ? `<text x="${(x + o.r + 3).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="sky-lbl">${o.kind === 'iss' ? 'ISS' : o.kind === 'sun' ? 'Sun' : 'Moon'}</text>` : ''}`;
    }).join('');
    return `<svg class="sky" viewBox="0 0 ${S} ${S}" role="img" aria-label="Sky chart: horizon at the edge, straight up at the centre"><circle cx="${C}" cy="${C}" r="${Rr}" class="sky-bg"/>${rings}<line x1="${C}" y1="${C - Rr}" x2="${C}" y2="${C + Rr}" class="sky-ring"/><line x1="${C - Rr}" y1="${C}" x2="${C + Rr}" y2="${C}" class="sky-ring"/>${ticks}${dots}</svg>`;
  }

  function render() {
    if (!at || !api.isOpen('sky')) { stop(); return; }
    const now = api.now(); const objs = objects(at.lat, at.lng, now);
    const up = objs.filter((o) => o.el > 0);
    const sun = objs.find((o) => o.kind === 'sun'); const moon = objs.find((o) => o.kind === 'moon');
    const planes = up.filter((o) => o.kind === 'plane').sort((a, b) => b.el - a.el);
    const sats = up.filter((o) => o.kind === 'sat' || o.kind === 'iss' || o.kind === 'station').sort((a, b) => b.el - a.el);
    const line = (o) => `<li><b>${esc(o.name)}</b> ${Math.round(o.el)}° up in the ${dirName(o.az)}${o.ft ? ` · ${Math.round(o.ft).toLocaleString()} ft, ${Math.round(o.rangeKm)} km away` : o.km ? ` · ${Math.round(o.km).toLocaleString()} km up, ${Math.round(o.rangeKm).toLocaleString()} km away` : ''}</li>`;
    const el = document.getElementById('sky-live'); if (!el) return;
    el.innerHTML = `${svg(objs)}
      <p class="sub">${sun.el > 0 ? `Sun ${Math.round(sun.el)}° up in the ${dirName(sun.az)}` : sun.el > -6 ? 'Twilight' : 'Night'} · ${moon.el > 0 ? `Moon ${Math.round(moon.el)}° up in the ${dirName(moon.az)}` : 'Moon below the horizon'}</p>
      <h4>Satellites above the horizon <small class="muted">${sats.length}</small></h4>
      ${sats.length ? `<ul class="skylist">${sats.slice(0, 8).map(line).join('')}</ul>` : `<p class="muted">${state.on.has('satellites') || state.on.has('stations') ? 'None of the loaded satellites is above the horizon here right now.' : 'Turn on Space stations or Satellite shells to see satellites here.'}</p>`}
      <h4>Planes in your sky <small class="muted">${planes.length}</small></h4>
      ${planes.length ? `<ul class="skylist">${planes.slice(0, 8).map(line).join('')}</ul>` : `<p class="muted">${state.on.has('aircraft') ? 'No aircraft within 200 km are more than 2° above the horizon.' : 'Turn on Live flights to see planes here.'}</p>`}`;
  }
  function stop() { clearInterval(timer); timer = null; }
  function open(lat, lng) {
    at = { lat, lng };
    api.openNotes('Sky above here', `<h3>The sky above ${esc(api.placeName(lat, lng))}</h3>
      <p class="muted">Read it like a map of the sky: the edge is the horizon, the centre is straight overhead, north is at the top and east on the right. Positions update every two seconds and follow the time machine.</p>
      <div id="sky-live"></div>
      <p class="muted">Satellites are only visible to the eye when your sky is dark but they are still in sunlight, usually in the two hours after sunset or before sunrise. Planes appear low near the edge until they are within about 50 km.</p>`, 'sky');
    render(); stop(); timer = setInterval(render, 2000);
  }
  return { open, lookAngles };
}
