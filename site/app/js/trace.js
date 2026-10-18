// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — Trace: how one spot on Earth is wired to everything else.
// Click a place and Global Intelligence Atlas draws the physical links that serve it — the nearest internet exchange
// buildings, the undersea cable landing and every coast those cables reach, the power stations nearby,
// the closest airport, public cameras and radio receivers, and a beam to each satellite overhead right now —
// with distances and the light-speed delay of each hop. All from public data; no people are tracked.
import { THREE } from '../vendor/vendor.min.mjs';
import { getLocal } from './feeds.js';
import { haversineKm, fmtLat, fmtLng } from './astro.js';
import { worldMonitorData } from './layers.js';
import { loadGroup, positions } from './satellites.js';
import { overhead } from './hud.js';
import { FUEL } from './networks.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const km = (x) => (x < 10 ? `${x.toFixed(1)} km` : `${Math.round(x).toLocaleString()} km`);
const fibreMs = (d) => (d / 204_000) * 1000;
const ms = (x) => (x < 1 ? `${(x * 1000).toFixed(0)} µs` : `${x.toFixed(1)} ms`);
const C = { net: '#7ed6c4', cable: '#e3b55b', power: '#ffe066', air: '#b7c8d6', cam: '#9ff0c9', radio: '#b7a3ff', sat: '#9fe3ff' };

let cache = null;
async function datasets() {
  if (cache) return cache;
  const [wm, nets, plants, airports] = await Promise.all([
    worldMonitorData(),
    getLocal('data/networks.json').catch(() => ({ facilities: [], radios: [] })),
    getLocal('data/power-plants.json').catch(() => ({ rows: [] })),
    getLocal('data/airports.json').catch(() => ({ rows: [] })),
  ]);
  // Group cable landing points into stations: one place, every cable that lands there.
  const landings = new Map();
  for (const c of wm.cables) for (const lp of c.landingPoints ?? []) {
    const k = `${lp.lat.toFixed(1)},${lp.lon.toFixed(1)}`;
    let L = landings.get(k); if (!L) landings.set(k, (L = { lat: lp.lat, lng: lp.lon, city: lp.city, country: lp.countryName, cables: [] }));
    if (!L.cables.includes(c)) L.cables.push(c);
  }
  cache = {
    cables: wm.cables, landings: [...landings.values()],
    facilities: nets.facilities.map(([name, lat, lng, city, country, nets2, ixs]) => ({ name, lat, lng, city, country, nets: nets2, ixs })),
    radios: nets.radios.map(([name, lat, lng, url, users, max, antenna, loc]) => ({ name, lat, lng, url, loc })),
    plants: plants.rows.map(([name, lat, lng, mw, fuel, country]) => ({ name, lat, lng, mw, fuel, country })),
    airports: airports.rows.filter((a) => a[8]).map(([iata, icao, name, lat, lng, elev, city]) => ({ iata, name, lat, lng, city })),
  };
  return cache;
}
function nearest(list, lat, lng, n = 1, maxKm = Infinity) {
  const out = [];
  for (const it of list) { if (Math.abs(it.lat - lat) * 111 > maxKm) continue; const d = haversineKm(lat, lng, it.lat, it.lng); if (d <= maxKm) out.push({ it, d }); }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}

export function installTrace(api) {
  const { state, globe } = api;
  const beams = new THREE.Group(); beams.raycast = () => {};
  const beamObj = { obj: beams };
  let run = 0;

  async function trace(lat, lng) {
    const my = ++run;
    api.clearTool();
    api.setPins([{ lat, lng, cls: '' }]);
    api.pulse(lat, lng, 60);
    api.openNotes('Trace', `<div class="trace"><p class="kicker">Tracing ${fmtLat(lat)}, ${fmtLng(lng)}…</p><div class="scanbar"><i></i></div></div>`, 'trace');
    const D = await datasets(); if (my !== run) return;
    const now = api.now();

    const nets = nearest(D.facilities, lat, lng, 3);
    // Also the busiest meeting point within 300 km — usually where the region's networks really interconnect.
    const hub = nearest(D.facilities, lat, lng, 400, 300).sort((a, b) => b.it.nets - a.it.nets)[0];
    if (hub && !nets.some((n) => n.it === hub.it)) nets.push(hub);
    const landing = nearest(D.landings, lat, lng, 1)[0];
    const plants = nearest(D.plants, lat, lng, 60, 150).sort((a, b) => b.it.mw - a.it.mw);
    const airport = nearest(D.airports, lat, lng, 1)[0];
    const radio = nearest(D.radios, lat, lng, 1)[0];
    const camsAll = state.data.cameras?.cams ?? (await getLocal('data/cameras.json').then((d) => d.cams.map(([id, name, la, lo, img, stream, si]) => ({ id, name, lat: la, lng: lo, img, source: d.sources[si]?.name }))).catch(() => []));
    const cams = nearest(camsAll, lat, lng, 3, 50);
    const flights = (state.data.aircraft?.ac ?? []).filter((a) => haversineKm(lat, lng, a.lat, a.lng) < 100);
    const groups = await Promise.all(['stations', 'visual', 'gps-ops', 'weather'].map((g) => loadGroup(g).then((x) => (x.snapshot ? null : x)).catch(() => null)));
    if (my !== run) return;
    const sats = groups.filter(Boolean).flatMap((g) => positions(g, now));
    const up = new Set(overhead(groups.filter(Boolean).flatMap((g) => g.sats), lat, lng, now).map((s) => s.name));
    const visible = sats.filter((s) => up.has(s.name)).slice(0, 40);

    // ---- draw, one family at a time (so you see the web assemble itself)
    const arc = (a, b, color, stroke = 0.5) => ({ sLat: a.lat, sLng: a.lng, eLat: b.lat, eLng: b.lng, color: [color, color], stroke, dashLen: 0.4, dashGap: 0.08, animMs: 1600 });
    const here = { lat, lng };
    const steps = [];
    steps.push(() => nets.forEach(({ it }) => api.state.tool.arcs.push(arc(here, it, C.net, 0.6))));
    if (landing) steps.push(() => {
      api.state.tool.arcs.push(arc(here, landing.it, C.cable, 0.7));
      for (const c of landing.it.cables) {
        api.state.tool.paths.push({ pts: c.points.map(([lo, la]) => [la, lo, 0.004]), color: C.cable, stroke: 0.9, animate: true, passive: true });
        for (const lp of c.landingPoints ?? []) if (haversineKm(lp.lat, lp.lon, landing.it.lat, landing.it.lng) > 300) api.state.tool.arcs.push({ ...arc(landing.it, { lat: lp.lat, lng: lp.lon }, 'rgba(227,181,91,0.8)', 0.4), animMs: 3000 });
      }
    });
    steps.push(() => plants.slice(0, 6).forEach(({ it }) => api.state.tool.arcs.push(arc(it, here, FUEL[it.fuel] ?? C.power, 0.45))));
    if (airport) steps.push(() => api.state.tool.arcs.push(arc(here, airport.it, C.air, 0.45)));
    steps.push(() => { cams.forEach(({ it }) => api.state.tool.arcs.push(arc(here, it, C.cam, 0.35))); if (radio) api.state.tool.arcs.push(arc(here, radio.it, C.radio, 0.35)); });
    steps.push(() => {
      beams.clear();
      const g0 = globe.getCoords(lat, lng, 0.0005);
      for (const s of visible) {
        const p = globe.getCoords(s.lat, s.lng, s.alt);
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(g0.x, g0.y, g0.z), new THREE.Vector3(p.x, p.y, p.z)]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: /NAVSTAR|GPS/.test(s.name) ? 0xb7a3ff : /ISS|TIANHE|CSS/.test(s.name) ? 0xffd37a : 0x9fe3ff, transparent: true, opacity: 0.8 }));
        line.raycast = () => {}; beams.add(line);
      }
      api.state.tool.custom = [beamObj];
    });
    steps.forEach((f, i) => setTimeout(() => { if (my === run) { f(); api.compose(); } }, api.reduceMotion ? 0 : 220 * i));
    globe.pointOfView({ lat, lng, altitude: Math.max(0.9, Math.min(2.2, state.pov.altitude)) }, api.reduceMotion ? 0 : 1600);

    // ---- report
    const reach = landing ? [...new Set(landing.it.cables.flatMap((c) => (c.landingPoints ?? []).map((l) => l.countryName)))].filter((x) => x && x !== landing.it.country) : [];
    const byFuel = {}; for (const { it } of plants) byFuel[it.fuel] = (byFuel[it.fuel] ?? 0) + it.mw;
    const totalMW = Object.values(byFuel).reduce((a, b) => a + b, 0);
    const row = (color, title, detail, fly) => `<li style="--c:${color}"><button ${fly ? `data-fly="${fly}"` : ''}><b>${title}</b><small>${detail}</small></button></li>`;
    const sec = (t, body) => `<h4>${t}</h4>${body}`;
    api.openNotes('Trace', `<div class="trace done">
      <p class="kicker">${fmtLat(lat)}, ${fmtLng(lng)} · ${now.toUTCString().slice(17, 25)} UTC</p>
      <h3>How this place is connected</h3>
      <div class="scan-grid">
        <div style="--c:${C.net}"><b>${nets[0] ? ms(fibreMs(nets[0].d)) : '—'}</b><span>to the nearest internet exchange by fibre (one way, at least)</span></div>
        <div style="--c:${C.cable}"><b>${reach.length}</b><span>countries reached by the cables at the nearest landing</span></div>
        <div style="--c:${C.power}"><b>${totalMW ? `${(totalMW / 1000).toFixed(1)} GW` : '—'}</b><span>generating capacity within 150 km</span></div>
        <div style="--c:${C.sat}"><b>${up.size}</b><span>tracked satellites above the horizon</span></div>
      </div>
      ${sec('Internet', `<ul class="trace-list">${nets.map(({ it, d }) => row(C.net, `${esc(it.name)}${it === hub?.it ? ' <em class="new">regional hub</em>' : ''}`, `${esc(it.city)} · ${it.nets} networks inside · ${km(d)} · ≥ ${ms(fibreMs(d))} each way`, `${it.lat},${it.lng},0.01`)).join('') || '<li class="muted">No exchange data yet — run the data workflow.</li>'}</ul>`)}
      ${landing ? sec('Undersea cables', `<ul class="trace-list">${row(C.cable, `${esc(landing.it.city)}, ${esc(landing.it.country)} landing`, `${km(landing.d)} away · ${landing.it.cables.length} cable${landing.it.cables.length === 1 ? '' : 's'}: ${landing.it.cables.map((c) => esc(c.name)).join(', ')}`, `${landing.it.lat},${landing.it.lng},0.3`)}</ul><p class="muted">These cables reach ${reach.slice(0, 12).map(esc).join(', ')}${reach.length > 12 ? ` and ${reach.length - 12} more` : ''}.</p>`) : ''}
      ${plants.length ? sec('Power', `<ul class="trace-list">${plants.slice(0, 5).map(({ it, d }) => row(FUEL[it.fuel] ?? C.power, esc(it.name), `${it.fuel} · ${it.mw.toLocaleString()} MW · ${km(d)}`, `${it.lat},${it.lng},0.05`)).join('')}</ul><p class="muted">${Object.entries(byFuel).sort((a, b) => b[1] - a[1]).map(([f, mw]) => `${f} ${Math.round((mw / totalMW) * 100)} %`).join(' · ')} of the capacity within 150 km (Global Power Plant Database).</p>`) : sec('Power', '<p class="muted">No power station of 50 MW or more within 150 km.</p>')}
      ${airport ? sec('Air', `<ul class="trace-list">${row(C.air, `${esc(airport.it.iata)} · ${esc(airport.it.name)}`, `${esc(airport.it.city)} · ${km(airport.d)}${state.data.aircraft ? ` · ${flights.length} aircraft within 100 km right now` : ''}`, `${airport.it.lat},${airport.it.lng},0.05`)}</ul>`) : ''}
      ${sec('Eyes and ears', `<ul class="trace-list">${cams.map(({ it, d }) => `<li style="--c:${C.cam}"><button data-cam="${esc(it.id)}"><b>${esc(it.name)}</b><small>Public camera · ${esc(it.source ?? '')} · ${km(d)}</small></button></li>`).join('')}${radio ? `<li style="--c:${C.radio}"><button data-fly="${radio.it.lat},${radio.it.lng},0.2"><b>${esc(radio.it.name)}</b><small>Public shortwave receiver · ${km(radio.d)}</small></button> <a href="${esc(radio.it.url)}" target="_blank" rel="noopener">Listen live</a></li>` : ''}</ul>${cams.length ? '' : '<p class="muted">No public road camera within 50 km.</p>'}`)}
      ${sec('Space', visible.length ? `<ul class="trace-list">${visible.slice(0, 8).map((s) => row(C.sat, esc(s.name), `${Math.round(s.altKm).toLocaleString()} km up · ${ms(((s.altKm) / 299_792) * 1000)} by radio`, '')).join('')}</ul><p class="muted">Cyan beams point to each one. From the ISS a radio signal takes about 1.4 ms to reach you; from GPS, about 67 ms.</p>` : '<p class="muted">Satellite positions need live orbital data from CelesTrak.</p>')}
      <div class="row"><button class="btn" data-hudscan="1">Area scan here</button><button class="btn ghost" data-trace-clear="1">Clear the trace</button></div>
      <p class="muted">Distances are straight lines over the surface; real fibre follows roads and seabeds, so real delays are longer. Light in glass travels at about 204,000 km/s.</p>
    </div>`, 'trace');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-trace-clear]')) { run += 1; beams.clear(); api.clearTool(); api.closeNotes(); }
    const t = e.target.closest('[data-trace]'); if (t) { const [a, b] = t.dataset.trace.split(',').map(Number); trace(a, b); }
  });
  return { trace, clear() { run += 1; beams.clear(); } };
}
