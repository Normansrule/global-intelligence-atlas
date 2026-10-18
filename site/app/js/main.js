// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — main application.
// Copyright (C) 2026 Aleksander Norman. Builds on World Monitor, Copyright (C) 2024-2026 Elie Habib
// (https://github.com/koala73/worldmonitor). Licensed under the GNU AGPL v3.0 only; see LICENSE.

import { Globe, THREE } from '../vendor/vendor.min.mjs';
import { LAYERS, GROUPS, layerById, worldMonitorData, plateLabel } from './layers.js';
import { getFeed, getLocal } from './feeds.js';
import * as astro from './astro.js';
import { SOURCES } from './sources.js';
import { TOURS } from './tours.js';
import { moonLayer } from './moon.js';
import { installExtras, waterName } from './extras.js';
import { installSky } from './sky.js';
import { buildFatLines, nearestLine } from './fatlines.js';
import { createPulses } from './pulses.js';
import { installShell, SECTION_FOR_KEY, SECTION_FOR_TITLE } from './shell.js';
const pulses = createPulses(100);
import { Quiz, buildQuestionPool } from './quiz.js';
import { flightsLayer, flightState, layoutPlanes, deckAction, glidePlanes, flightsNow, planesStale, planeCounts, warmPlanes } from './flights.js';
import { camerasLayer, alprLayer, stopCameraMedia, alprRow } from './cameras.js';
import { citiesLayer, airportsLayer } from './places.js';
import { installNavigation } from './nav.js';
import { newsLayer } from './news.js';
import { crimeLayer } from './crime.js';
import { installLive } from './live.js';
import { openWall } from './cameras.js';
import { webcamsLayer } from './worldcams.js';
import { powerLayer, internetLayer, radioLayer, shipsLayer, overlayLayer } from './networks.js';
import { installHud } from './hud.js';
import { MarkerRenderer, GeoIndex, MultiIndex, iconsReady } from './markers.js';
import { installPerformance, installProgramKeeper, installIdleGovernor } from './perf.js';
import { clock, SPEEDS, speedLabel } from './clock.js';
import { launchesLayer, alertsLayer, countdown } from './launches.js';
import { installTrace } from './trace.js';
import { installIntel } from './intel.js';
import { windLayer } from './wind.js';
import { smallCircle } from './astro.js';
import { firesLayer, radarLayer } from './hazards.js';
import { installHealth } from './health.js';
import { installWatch } from './watch.js';
import { isDesktop, feedsReady, appConfig } from './feeds.js';
import { REGISTRY, EXTRA_GROUPS, EDITIONS, editionOf, manifest, validateLayer, pluginNames } from './registry.js';
import { DATASET_MODES, OPEN_DATA, WM_ONLY, datasetMode, setDatasetMode, infraData, origins } from './opendata.js';
export const VERSION = '2.11';
const NEW_VERSION = (() => { try { return localStorage.getItem('global-intelligence-atlas-version') !== VERSION; } catch { return false; } })();

import { glyphSvg } from './icons.js';
// The symbol shown next to each layer name (layers with pins use their own; the rest are listed here).
const LAYER_GLYPH = { quakes: 'quake', events: 'flame', alerts: 'alert', aircraft: 'plane', stations: 'sat', satellites: 'sat', sun: 'sun', moon: 'moon', power: 'bolt', internet: 'server', ships: 'ship', crime: 'badge', cities: 'city', aurora: 'snow', wind: 'dust', overlay: 'sat', cables: 'ix', pipelines: 'oil', routes: 'ship', plates: 'quake', conflicts: 'swords', grid: 'eye', borders: 'pin', radar: 'storm', fires: 'flame', watch: 'eye', replay: 'clock' };
const layerGlyph = (l) => LAYER_GLYPH[l.id] ?? (typeof l.pin === 'string' ? l.pin : null);
/** The symbol for one item (a wildfire → flame, a tanker → tanker…). */
const itemGlyph = (ref) => { const l = ref && layerById[ref.layer]; if (!l) return null; try { return (typeof l.pin === 'function' ? l.pin(ref.d) : l.pin) ?? layerGlyph(l); } catch { return layerGlyph(l); } };
import { orbitOf } from './layers.js';
import { passes, positions as satPositions } from './satellites.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const R = 100; // globe.gl globe radius in scene units
const isMobile = matchMedia('(max-width: 860px)').matches;

// ------------------------------------------------------------------ state
const state = {
  base: 'daynight', detailTiles: null, autoDetail: true,
  on: new Set(LAYERS.filter((l) => l.on).map((l) => l.id)),
  opts: Object.fromEntries(LAYERS.map((l) => [l.id, Object.fromEntries((l.options ?? []).map((o) => [o.id, structuredClone(o.value)]))])),
  data: {}, chan: {}, lstatus: {}, loadedAt: {},
  hover: null, mode: null, pov: { lat: 20, lng: 0, altitude: 2.4 },
  tool: { points: [], paths: [], arcs: [], html: [], labels: [], rings: [] },
  tour: null, quiz: null, measure: [],
};

// ------------------------------------------------------------------ base maps
const TILE = {
  imagery: { url: (x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`, max: 19, attr: 'Imagery © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community' },
  gibs: { url: (x, y, l) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${gibsDate()}/GoogleMapsCompatible_Level9/${l}/${y}/${x}.jpg`, max: 9, attr: 'NASA GIBS — VIIRS true colour for <span id="gibs-date"></span>. We acknowledge the use of imagery provided by services from NASA’s Global Imagery Browse Services (GIBS), part of NASA’s ESDIS' },
  streets: { url: (x, y, l) => `https://tile.openstreetmap.org/${l}/${x}/${y}.png`, max: 19, attr: 'Map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
};
function gibsDate() { return state.gibsDate ?? new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10); }
const TEX = {
  daynight: { attr: 'Day/night: NASA Blue Marble + Black Marble, lit from the real Sun position' },
  bluemarble: { img: 'textures/earth-blue-marble.jpg', bump: 'textures/earth-topology.png', attr: 'NASA Blue Marble, relief from three-globe' },
  night: { img: 'textures/earth-night.jpg', attr: 'NASA Black Marble city lights' },
};
let markers = null; let keeper = null; let gov = null;
let perf = { q: { pins: 140, pinsPerLayer: 40, cards: 24, labels: 120, columns: 30000 }, moving() {} };
readHash();

// ------------------------------------------------------------------ globe
const globe = new Globe($('#globe'), { rendererConfig: { antialias: true, powerPreference: 'high-performance' }, animateIn: false });
// Don't block on shader error checks: three.js otherwise waits for every shader to finish compiling the
// moment it is created (seconds on some Windows/ANGLE and Linux drivers). Errors still show with ?debug.
globe.renderer().debug.checkShaderErrors = new URLSearchParams(location.search).has('debug');
const defaultMaterial = globe.globeMaterial();
const loader = new THREE.TextureLoader();
const dayNightMaterial = new THREE.ShaderMaterial({
  uniforms: {
    dayTexture: { value: loader.load('textures/earth-blue-marble-2k.jpg') },
    nightTexture: { value: loader.load('textures/earth-night-2k.jpg') },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  },
  vertexShader: `
    varying vec3 vNormal; varying vec2 vUv;
    void main() {
      vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D dayTexture; uniform sampler2D nightTexture; uniform vec3 sunDir;
    varying vec3 vNormal; varying vec2 vUv;
    void main() {
      float i = dot(normalize(vNormal), normalize(sunDir));
      vec4 day = texture2D(dayTexture, vUv);
      vec4 night = texture2D(nightTexture, vUv) * 1.25;
      float k = smoothstep(-0.08, 0.12, i);           // civil-twilight-ish blend
      vec4 col = mix(night, day, k);
      col.rgb += vec3(1.0, 0.55, 0.25) * 0.12 * (1.0 - abs(k * 2.0 - 1.0)); // warm dusk band
      gl_FragColor = col;
    }`,
});
// Night shade for every base map except Day/night: a transparent sphere just above the ground,
// darkened on the side facing away from the Sun, with a soft twilight edge.
const nightShade = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.0008, 128, 64),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { sunDir: dayNightMaterial.uniforms.sunDir },
    vertexShader: 'varying vec3 vNormal; void main() { vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 sunDir; varying vec3 vNormal; void main() { float i = dot(normalize(vNormal), normalize(sunDir)); gl_FragColor = vec4(0.01, 0.03, 0.08, (1.0 - smoothstep(-0.12, 0.08, i)) * 0.5); }',
  }),
);
nightShade.visible = false; nightShade.raycast = () => {};
// Night shading also goes over the detail tiles, so the day/night line stays where it is when they switch in.
function updateShade() { nightShade.visible = state.on.has('sun') && (state.base !== 'daynight' || !!state.detailTiles); }
const DETAIL_ON = 0.75; const DETAIL_OFF = 1.0;
function updateSun() {
  const s = astro.subsolarPoint(clock.date());
  const c = globe.getCoords(s.lat, s.lng, 0);
  dayNightMaterial.uniforms.sunDir.value.set(c.x, c.y, c.z).normalize();
}

// Radii and line widths in globe.gl are angles on the sphere, so a 0.5° cable is 55 km wide.
// Scaling them with the camera height keeps markers and lines the same size on screen at every zoom.
let zkAlt = 2.4;
const zk = () => Math.max(0.0002, Math.min(1, zkAlt / 2.2));
function applyZoomScale(force = false) {
  const a = state.pov.altitude;
  if (!force && Math.abs(Math.log(a / zkAlt)) < 0.3) return;
  zkAlt = a;
  markers?.rescale(zk()); pulses.setScale(zk()); keeper?.schedule();
  globe.pathStroke((d) => (d.stroke == null ? null : d.stroke * zk()))
    .arcStroke((d) => (d.stroke == null ? null : d.stroke * zk()))
    .ringMaxRadius((d) => d.maxR * zk());
}
function dominant(points, a) {
  const n = {}; for (const p of points) n[p.color] = (n[p.color] ?? 0) + 1;
  const c = Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '#f07a63'; const [r, g, b] = hex2rgb(c);
  return `rgba(${r},${g},${b},${a})`;
}
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const val = (v, d) => (typeof v === 'function' ? v(d) : v);

globe
  .showAtmosphere(true).atmosphereColor('#7fb6ff').atmosphereAltitude(0.16)
  // points
  .pointLat('lat').pointLng('lng').pointAltitude('alt').pointRadius('r').pointColor('color').pointLabel('tip')
  .pointResolution(10).pointsMerge(false).pointsTransitionDuration(0)
  .onPointClick((d) => d.ref && select(d.ref))
  // rings
  .ringLat('lat').ringLng('lng').ringMaxRadius('maxR').ringPropagationSpeed('speed').ringRepeatPeriod('period')
  .ringColor((d) => { const [r, g, b] = hex2rgb(d.color); return (t) => `rgba(${r},${g},${b},${1 - t})`; })
  // paths
  .pathPoints('pts').pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2] ?? 0.002)
  .pathColor('color').pathStroke('stroke').pathLabel((d) => d.tip ?? '').pathTransitionDuration(0)
  .pathDashLength((d) => (d.dash ? d.dash[0] : d.animate ? 0.12 : 1))
  .pathDashGap((d) => (d.dash ? d.dash[1] : d.animate ? 0.015 : 0))
  .pathDashAnimateTime((d) => (d.animate && !reduceMotion ? 40000 : 0))
  .onPathClick((d, e, c) => (d.ref && !d.passive ? select(d.ref) : groundClick(e, c)))
  // arcs
  .arcStartLat('sLat').arcStartLng('sLng').arcEndLat('eLat').arcEndLng('eLng').arcColor('color').arcStroke('stroke')
  .arcAltitude((d) => d.alt ?? null).arcDashLength((d) => d.dashLen ?? 1).arcDashGap((d) => d.dashGap ?? 0)
  .arcDashAnimateTime((d) => (reduceMotion ? 0 : d.animMs ?? 0)).arcLabel((d) => d.tip ?? '').arcsTransitionDuration(0)
  .onArcClick((d, e, c) => (d.ref ? select(d.ref) : groundClick(e, c)))
  // polygons
  .polygonGeoJsonGeometry('geometry').polygonAltitude('alt').polygonLabel((d) => d.tip ?? '')
  .polygonSideColor('side').polygonsTransitionDuration(0)
  .onPolygonClick((d, _e, at) => {
    if (d.ref && !d.passive && !d.country) return select(d.ref);
    surfaceClick(at.lat, at.lng, d.country ?? null);
  })
  // labels
  .labelLat('lat').labelLng('lng').labelAltitude((d) => d.alt ?? 0.004).labelText('text').labelSize('size')
  .labelColor('color').labelDotRadius('dot').labelResolution(2).labelsTransitionDuration(0)
  .onLabelClick((d) => d.ref && select(d.ref))
  // particles (satellites, aurora)
  .particlesList('pts').particleLat('lat').particleLng('lng').particleAltitude('alt')
  .particlesColor('color').particlesSize('size').particlesSizeAttenuation(false).particleLabel(() => '').customLayerLabel(() => '')
  // Clicks on background dots, custom meshes and hexagons fall through to the ground beneath them —
  // otherwise dense layers (cameras, receivers, ships) swallow clicks meant for the map.
  .onParticleClick((_d, e, c) => groundClick(e, c)).onCustomLayerClick((_d, e, c) => groundClick(e, c)).onHexClick((_d, e, c) => groundClick(e, c))
  // html (pins)
  .htmlLat('lat').htmlLng('lng').htmlAltitude((d) => d.alt ?? 0).htmlElement('el').htmlTransitionDuration(0)
  // hexagon columns (crime density)
  .hexBinPointLat('lat').hexBinPointLng('lng').hexBinPointWeight('w').hexBinMerge(true).hexTransitionDuration(0).hexMargin(0.12)
  .hexAltitude(({ sumWeight }) => Math.min(0.25, state.pov.altitude * 0.03 * Math.sqrt(sumWeight)))
  .hexTopColor(({ points }) => dominant(points, 0.92)).hexSideColor(({ points }) => dominant(points, 0.55))
  // custom three.js objects (merged outlines)
  .customThreeObject((d) => d.obj).customThreeObjectUpdate(() => {})
  // surface clicks + camera
  .onGlobeClick(({ lat, lng }) => surfaceClick(lat, lng, state.on.has('borders') ? countryAt(lat, lng) : null))
  .onZoom((pov) => onCamera(pov))
  .onGlobeReady(() => { $('#loading').classList.add('gone'); intro(); });
setTimeout(() => $('#loading').classList.add('gone'), 8000);

restylePolygons();
zkAlt = state.pov.altitude; applyZoomScale(true);
globe.scene().add(nightShade);
markers = new MarkerRenderer(globe);
keeper = installProgramKeeper(globe);
globe.scene().add(markers.object);
setTimeout(() => markers.warm(globe.renderer(), globe.scene(), globe.camera()), 1200);
setTimeout(() => warmPlanes(globe), 2600); // the 3D aircraft shader, compiled in the background
iconsReady.then(() => { compose.last.points = null; scheduleCompose(); });
const controls = globe.controls();
controls.autoRotateSpeed = 0.35;
globe.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.75)); // 4K phones don't need 3× pixels for a globe
const nav = installNavigation({ globe, R, $, reduceMotion, onLocate: (lat, lng) => { fly(lat, lng, 0.012); state.home = [lat, lng]; setTimeout(() => probeCard(lat, lng), 400); } });
// Procedural star field (replaces a 900 kB background image).
{
  const n = 4000; const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1; const t = Math.random() * Math.PI * 2; const r = 6000 + Math.random() * 3000; const k = Math.sqrt(1 - u * u);
    pos.set([r * k * Math.cos(t), r * u, r * k * Math.sin(t)], i * 3);
    const b = 0.55 + Math.random() * 0.45; const warm = Math.random() < 0.25;
    col.set([b, b * (warm ? 0.9 : 0.97), b * (warm ? 0.78 : 1)], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  globe.scene().add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));
  globe.camera().far = Math.max(globe.camera().far, 12000); globe.camera().updateProjectionMatrix();
}
// Swap the quick 2K day/night textures for 4K ones once the page is idle.
(window.requestIdleCallback ?? ((f) => setTimeout(f, 2500)))(() => {
  const aniso = globe.renderer().capabilities.getMaxAnisotropy?.() ?? 1; // sharper when the globe is seen at an angle
  loader.load('textures/earth-blue-marble.jpg', (t) => { t.anisotropy = Math.min(8, aniso); t.colorSpace = dayNightMaterial.uniforms.dayTexture.value.colorSpace; dayNightMaterial.uniforms.dayTexture.value = t; });
  loader.load('textures/earth-night.jpg', (t) => { t.anisotropy = Math.min(8, aniso); dayNightMaterial.uniforms.nightTexture.value = t; });
});
// The globe fills the stage between the drawers; it is resized whenever a drawer opens or closes.
const stageSize = { w: innerWidth, h: innerHeight };
{ const gEl = $('#globe'); const fit = () => { const w = gEl.clientWidth; const h = gEl.clientHeight; if (!w || !h || (w === stageSize.w && h === stageSize.h && globe.width() === w)) return; stageSize.w = w; stageSize.h = h; globe.width(w).height(h); markers?.setViewport(h); perf?.refit?.(); gov?.wake(600); }; new ResizeObserver(() => requestAnimationFrame(fit)).observe(gEl); requestAnimationFrame(fit); }

function restylePolygons() {
  globe.polygonCapColor((d) => (d.country ? (d.country === state.hover ? 'rgba(227,181,91,0.20)' : 'rgba(0,0,0,0)') : val(d.cap, d)));
  globe.polygonStrokeColor((d) => (d.country ? (d.country === state.hover ? 'rgba(227,181,91,1)' : 'rgba(238,243,246,0.26)') : val(d.stroke, d)));
}

// ------------------------------------------------------------------ base-map switching
function setBase(base) {
  state.base = base; state.detailTiles = null;
  document.querySelectorAll('[data-base]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.base === base)));
  viewLabel();
  applyBase();
  refreshLayer('sun');
  writeHash();
}
function applyBase() {
  const tiles = TILE[state.base] ?? (state.detailTiles && TILE[state.detailTiles]);
  if (tiles) {
    globe.globeTileEngineMaxLevel(tiles.max).globeTileEngineUrl(tiles.url);
  } else {
    globe.globeTileEngineUrl(null);
    if (state.base === 'daynight') { updateSun(); globe.globeMaterial(dayNightMaterial); } else {
      globe.globeMaterial(defaultMaterial);
      globe.globeImageUrl(TEX[state.base].img).bumpImageUrl(TEX[state.base].bump ?? null);
    }
  }
  updateSun(); updateShade();
  if (state.base === 'gibs') globe.globeTileEngineClearCache();
  $('#gibs-pick').hidden = state.base !== 'gibs';
  const credit = tiles ? tiles.attr : TEX[state.base].attr;
  setTimeout(() => { const g = $('#gibs-date'); if (g) g.textContent = gibsDate(); });
  $('#attribution').innerHTML = `${credit} · Built on <a href="https://github.com/koala73/worldmonitor">World Monitor</a> by Elie Habib · <a href="#" data-open-about>Sources and licence</a>`;
}

// ------------------------------------------------------------------ layers: load + compose
function flightsChip(d) {
  const el = document.getElementById('flights-chip'); if (!el) return;
  el.hidden = !d?.ac?.length || !state.on.has('aircraft');
  if (el.hidden) return;
  const age = d.snapshotAge != null ? ` <small>${d.snapshotAge < 1.5 ? 'just now' : `${Math.round(d.snapshotAge)} min old`}</small>` : ' <small>live</small>';
  el.innerHTML = `${glyphSvg('plane', '#8ecbff', 16)} ${d.ac.length.toLocaleString()}${age}`;
}
async function refreshLayer(id, { soft = false } = {}) {
  const l = layerById[id];
  if (!l || !state.on.has(id)) return;
  if (soft && state.data[id]) { state.chan[id] = l.channels(state.data[id], ctx()); return scheduleCompose(); }
  const first = !state.data[id];
  if (first) setLStatus(id, 'loading');
  try {
    const data = await l.load(state.opts[id], ctx());
    state.data[id] = data;
    state.chan[id] = l.channels(data, ctx());
    state.loadedAt[id] = Date.now();
    const snap = data && (data.snapshot || Object.values(data).some?.((g) => g?.snapshot));
    setLStatus(id, 'ok', data?.statusNote ?? (snap ? 'Live source unreachable — showing the bundled snapshot' : ''));
    if (id === 'aircraft') flightsChip(data);
    if (state.pendingSel) setTimeout(() => trySharedSel(id), 0);
  } catch (err) {
    console.warn(err);
    state.loadedAt[id] = Date.now(); // back off until the layer's next refresh
    setLStatus(id, 'error', err.help ?? `Could not load: ${err.message}. The source may be down or blocked by your network; try again later.`);
  }
  compose();
}
const viewOf = (pov) => {
  const a = pov.altitude; const horizon = Math.acos(1 / (1 + a)) * astro.R_EARTH_KM; // km to the horizon
  return { lat: pov.lat, lng: pov.lng, altitude: a, radiusKm: Math.min(horizon, a * astro.R_EARTH_KM * 0.95 + 5) };
};
const fatLines = (lines, opts) => buildFatLines((a, b, c) => globe.getCoords(a, b, c), lines, opts);
const ctx = () => ({ now: clock.date(), live: clock.isLive(), base: state.base, hover: state.hover, pov: state.pov, view: viewOf(state.pov), outlineMesh, fatLines, globe, THREE });

const meshCache = {};
function outlineMesh(key, features, color = 0xeef3f6, opacity = 0.3, alt = 0.004) {
  if (meshCache[key]) return meshCache[key];
  const pos = [];
  const ring = (r) => { for (let i = 0; i + 1 < r.length; i++) { const a = globe.getCoords(r[i][1], r[i][0], alt); const b = globe.getCoords(r[i + 1][1], r[i + 1][0], alt); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); } };
  for (const f of features) {
    const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const r of p) ring(r);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  obj.raycast = () => {};
  meshCache[key] = { obj };
  return meshCache[key];
}

// Point-in-polygon country lookup (ray casting, bbox pre-filter).
let countryIndex = null;
function countryAt(lat, lng) {
  const fs = state.data.borders; if (!fs) return null;
  countryIndex ??= fs.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = 180; let x1 = -180; let y0 = 90; let y1 = -90;
    for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { f, polys, bb: [x0, x1, y0, y1] };
  });
  const inRing = (r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const c of countryIndex) {
    const [x0, x1, y0, y1] = c.bb; if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    for (const p of c.polys) if (inRing(p[0]) && !p.slice(1).some(inRing)) return c.f;
  }
  return null;
}

let composeQueued = false;
function scheduleCompose() { if (composeQueued) return; composeQueued = true; requestAnimationFrame(() => { composeQueued = false; compose(); }); }
// push(...big) overflows the call stack past ~100,000 items (the full plate-reader and camera sets do), so append in a loop
function appendAll(dst, src) { for (let i = 0; i < src.length; i++) dst.push(src[i]); }
function compose() {
  const acc = { points: [], rings: [], paths: [], arcs: [], polygons: [], labels: [], particles: [], html: [], custom: [], pick: [], hexes: [], lines: [] };
  for (const l of LAYERS) {
    if (!state.on.has(l.id)) continue;
    const ch = state.chan[l.id];
    if (!ch) continue;
    for (const k of Object.keys(acc)) if (ch[k]) appendAll(acc[k], ch[k]);
  }
  for (const k of Object.keys(state.tool)) appendAll(acc[k], state.tool[k]);
  if (acc.rings.length) acc.custom.push(pulses.wrap); // all pulsing rings: one GPU-animated object (pulses.js)
  compose.animating = acc.rings.length > 0 || acc.particles.length > 0 || acc.arcs.some((a) => a.animMs) || acc.paths.some((p) => p.animMs);
  gov?.wake(500);
  document.body.classList.toggle('close', state.pov.altitude < 0.025);
  // Only hand globe.gl the channels whose contents actually changed — re-digesting
  // unchanged paths/polygons every tick is what makes globes stutter.
  const markerDirty = ['points', 'labels', 'pick'].some((k) => { const prev = compose.last[k]; const sig = acc[k]; return !(prev && prev.length === sig.length && prev.every((x, i) => x === sig[i])); }) || compose.forceMarkers;
  if (markerDirty) { compose.forceMarkers = false; for (const k of ['points', 'labels', 'pick']) compose.last[k] = acc[k]; markerPass(acc); }
  for (const k of Object.keys(acc)) {
    if (k === 'points' || k === 'labels' || k === 'pick') continue;
    const sig = acc[k];
    const prev = compose.last[k];
    if (prev && prev.length === sig.length && prev.every((x, i) => x === sig[i])) continue;
    compose.last[k] = sig;
    SETTERS[k](sig);
    if (k === 'paths' || k === 'arcs' || k === 'rings' || k === 'hexes' || k === 'polygons') keeper?.schedule();
  }
}

compose.last = {};

// ---- Fast markers: columns in one instanced mesh, the nearest markers as sprite pins (with a label card
// for the closest ones), names as cached sprites, and a lat/lng grid index for hover and click.
state.index = new GeoIndex(0.5); state.elevated = []; const idxCache = new WeakMap();
function markerPass(acc) {
  const v = viewOf(state.pov); const q = perf.q;
  markers.setCamera(state.pov.altitude);
  const pts = filterByGlyph(acc.points); const labels = acc.labels;
  const selD = state.selected?.d;
  const pins = []; const cols = [];
  {
    const perLayer = {}; const far = v.altitude > 1.1; const lat0 = v.lat; const cosl = Math.cos(lat0 * Math.PI / 180);
    const cand = [];
    for (const p of pts) {
      const l = p.ref && layerById[p.ref.layer];
      if (!l?.pin) { cols.push(p); continue; }
      const dy = (p.lat - lat0) * 111; const dx = (p.lng - v.lng) * 111 * cosl; const km = Math.sqrt(dx * dx + dy * dy);
      if (km > v.radiusKm) { cols.push(p); continue; }
      cand.push({ p, km, l });
    }
    // Up close the nearest things win; from far away the most important ones do (taller column = bigger quake, bigger plant…).
    // Hysteresis: whatever was shown last time keeps a head start, so symbols and cards don't swap around every time the camera stops.
    const prev = markerPass.prev ?? new Set(); const keep = (c) => (prev.has(c.p.ref?.d) ? 1 : 0);
    if (far) cand.sort((x, y) => (y.p.alt ?? 0) * (1 + 0.5 * keep(y)) - (x.p.alt ?? 0) * (1 + 0.5 * keep(x)) || x.km - y.km);
    else cand.sort((x, y) => x.km * (keep(x) ? 0.6 : 1) - y.km * (keep(y) ? 0.6 : 1));
    if (cand.length > 1500) { for (const c of cand.slice(1500)) cols.push(c.p); cand.length = 1500; }
    // The thing you clicked always stays a pin — it is never clustered away or dropped when you zoom in.
    const si = selD ? cand.findIndex((c) => c.p.ref?.d === selD) : -1;
    if (si > 0) cand.unshift(cand.splice(si, 1)[0]);
    // Declutter in screen space, like a web map: the nearest markers win, cards never overlap,
    // and markers too close to a kept one fold into it as a "+N" cluster badge.
    const placed = []; const cards = []; state.clustered = [];
    if (v.altitude < 0.12) { // v2.11: things at the very same spot fan out round it, each with its own symbol (space objects are never pins)
      const spot = new Map(); for (const c of cand) { const k = `${Math.round(c.p.lat * 1e4)},${Math.round(c.p.lng * 1e4)}`; (spot.get(k) ?? spot.set(k, []).get(k)).push(c); }
      const kpx = kmPerPx();
      // the ring is wide enough that neighbouring symbols sit at least 32 px apart, so none of them folds into another
      let gi = 0;
      for (const g of spot.values()) if (g.length > 1 && g.length <= 24) { gi++; const rkm = kpx * Math.max(30, 16 / Math.sin(Math.PI / g.length)); g.forEach((c, k) => { const a = (2 * Math.PI * k) / g.length; c.grp = gi; c.at = { lat: c.p.lat + (rkm * Math.sin(a)) / 111, lng: c.p.lng + (rkm * Math.cos(a)) / (111 * Math.max(0.05, Math.cos(c.p.lat * Math.PI / 180))) }; }); }
    }
    for (const c of cand) {
      const isSel = !!selD && c.p.ref?.d === selD;
      if (!isSel && (pins.length >= q.pins || (perLayer[c.l.id] ?? 0) >= q.pinsPerLayer)) { cols.push(c.p); continue; }
      const at = c.at ?? c.p; const sc = globe.getScreenCoords(at.lat, at.lng, markers.floatAlt);
      if (!sc || sc.x < -40 || sc.y < -40 || sc.x > stageSize.w + 40 || sc.y > stageSize.h + 40) { cols.push(c.p); continue; }
      const hitsCard = !c.grp && cards.some((r) => sc.x + 14 > r.x0 && sc.x - 14 < r.x1 && sc.y + 14 > r.y0 && sc.y - 14 < r.y1);
      const near = placed.find((o) => (!c.grp || o.grp !== c.grp) && Math.abs(o.x - sc.x) < 22 && Math.abs(o.y - sc.y) < 26) ?? (hitsCard ? placed.reduce((b, o) => (!b || Math.hypot(o.x - sc.x, o.y - sc.y) < Math.hypot(b.x - sc.x, b.y - sc.y) ? o : b), null) : null);
      if (near && !isSel) { near.pin.more = (near.pin.more ?? 0) + 1; (near.pin.members ??= []).push(c.p); if (v.altitude > 0.3 && !far) cols.push(c.p); else state.clustered.push(c.p); continue; } // up close the "+N" badge stands in for the column
      perLayer[c.l.id] = (perLayer[c.l.id] ?? 0) + 1;
      const icon = typeof c.l.pin === 'function' ? c.l.pin(c.p.ref.d) : c.l.pin;
      const [title, sub] = tipParts(c.p);
      const rect = { x0: sc.x + 14, x1: sc.x + 40 + Math.min(240, 7.2 * Math.max(title.length, sub.length * 0.9)), y0: sc.y - 18, y1: sc.y + 18 };
      const cardFree = isSel || !c.grp && cards.length < (far ? Math.min(6, q.cards) : q.cards) && !cards.some((r) => r.x0 < rect.x1 && rect.x0 < r.x1 && r.y0 < rect.y1 && rect.y0 < r.y1)
        && !placed.some((o) => o.x + 14 > rect.x0 && o.x - 14 < rect.x1 && o.y + 14 > rect.y0 && o.y - 14 < rect.y1);
      if (cardFree) cards.push(rect);
      // bigger things get bigger symbols: size follows the marker's radius (magnitude, megawatts, networks…)
      const size = Math.round(Math.max(24, Math.min(38, 20 + (c.p.r ?? 0.22) * 36)) / 2) * 2;
      const pin = { lat: at.lat, lng: at.lng, home: c.at ? { lat: c.p.lat, lng: c.p.lng } : null, alt: c.p.alt, icon, size, color: solid(c.p.color, c.l.swatch), title, sub, detailed: cardFree, selected: isSel, ref: c.p.ref, tip: c.p.tip };
      pins.push(pin); placed.push({ x: sc.x, y: sc.y, pin, grp: c.grp });
    }
  }
  markerPass.prev = new Set(pins.map((p) => p.ref?.d));
  // Names never overlap each other or a symbol: place them greedily, biggest first, and drop any that would collide.
  const boxes = pins.map((p) => { const s = globe.getScreenCoords(p.lat, p.lng, markers.floatAlt); return s ? { x0: s.x - 15, x1: s.x + (p.detailed ? 260 : 15), y0: s.y - 17, y1: s.y + 17 } : null; }).filter(Boolean);
  const lbl = [];
  const sortedLabels = labels.map((l, i) => [l, i]).sort((a, b) => (b[0].size ?? 1) - (a[0].size ?? 1) || a[1] - b[1]).map(([l]) => l);
  const cam = globe.camera().position; const camL = cam.length(); const horizon = R / camL;
  const facing = (lat, lng) => { const w = globe.getCoords(lat, lng, 0); return (w.x * cam.x + w.y * cam.y + w.z * cam.z) / (Math.hypot(w.x, w.y, w.z) * camL) > horizon + 0.01; };
  for (const l of sortedLabels) {
    if (lbl.length >= q.labels) break;
    if (!facing(l.lat, l.lng)) continue; // far side of the planet: not drawn, so it must not block anything
    const size = l.px ? l.size : Math.max(11, Math.min(16, (l.size ?? 1) * 12));
    const text = l.text ?? '';
    if (text) {
      const s = globe.getScreenCoords(l.lat, l.lng, markers.floatAlt);
      if (s) {
        const box = { x0: s.x - 4, x1: s.x + 12 + text.length * size * 0.56, y0: s.y - size * 0.8, y1: s.y + size * 0.8 };
        if (boxes.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) continue;
        boxes.push(box);
      }
    }
    lbl.push({ lat: l.lat, lng: l.lng, alt: l.alt ?? 0.004, text, color: solid(l.color, '#eef3f6'), size, ref: l.ref, tip: l.tip });
  }
  markers.setPoints(cols.length > q.columns ? cols.slice(0, q.columns) : cols, zk());
  markers.setSprites(pins, lbl);
  // Index for hover and click. Things well above the ground are picked in screen space instead. Each layer's
  // index is cached against its data arrays and only rebuilt when they change (or the zoom band does).
  const cell = v.altitude < 0.05 ? 0.05 : v.altitude < 0.5 ? 0.25 : 1;
  const parts = []; const elevated = [];
  const build = (arr) => { const idx = new GeoIndex(cell); const el = []; for (const p of arr) { if (!p.ref) continue; if ((p.alt ?? 0) > 0.03) el.push(p); else idx.add(p); } return { idx, el }; };
  const use = (arr, cacheable) => {
    if (!arr?.length) return;
    let c = cacheable ? idxCache.get(arr) : null;
    if (!c || c.cell !== cell || c.v !== arr.__v) { c = { ...build(arr), cell, v: arr.__v }; if (cacheable) idxCache.set(arr, c); }
    parts.push(c.idx); for (const p of c.el) elevated.push(p);
  };
  for (const l of LAYERS) {
    if (!state.on.has(l.id)) continue; const ch = state.chan[l.id]; if (!ch) continue;
    const filtered = state.hideGlyph[l.id]?.size;
    use(filtered ? filterByGlyph(ch.points ?? []) : ch.points, !filtered); use(ch.pick, true);
  }
  use(state.tool.points, false); use(state.tool.pick, false); use(lbl, false);
  state.index = new MultiIndex(parts); state.elevated = elevated;
  cullSprites();
}
// Symbol filters: click a symbol in a layer's key to hide or show that kind (e.g. only wildfires).
state.hideGlyph = {};
function filterByGlyph(pts) {
  const active = Object.entries(state.hideGlyph).filter(([, set]) => set.size);
  if (!active.length) return pts;
  const hide = Object.fromEntries(active);
  return pts.filter((p) => { const set = p.ref && hide[p.ref.layer]; return !set || !set.has(itemGlyph(p.ref)); });
}
function toggleGlyph(layerId, g) {
  const set = (state.hideGlyph[layerId] ??= new Set());
  if (set.has(g)) set.delete(g); else set.add(g);
  document.querySelectorAll(`[data-gfilter="${layerId}:${g}"]`).forEach((b) => b.setAttribute('aria-pressed', String(!set.has(g))));
  compose.forceMarkers = true; compose();
}
/** Kinds actually on the map for a layer right now (so the key only lists what you can see). */
function presentGlyphs(l) {
  const pts = state.chan[l.id]?.points; if (!pts?.length) return new Set();
  const out = new Set(); for (const p of pts) { const g = itemGlyph(p.ref); if (g) out.add(g); if (out.size >= l.legend.length) break; } return out;
}
function chipsInner(l) {
  const have = presentGlyphs(l); const hidden = state.hideGlyph[l.id] ?? new Set();
  return l.legend.filter(([g]) => have.has(g) || hidden.has(g)).map(([g, label, c]) => `<button class="lchip" data-gfilter="${l.id}:${g}" aria-pressed="${!hidden.has(g)}" title="Show or hide: ${esc(label)}">${glyphSvg(g, c ?? l.swatch, 16)}<span>${esc(label.replace(/ \(.*\)$/, ''))}</span></button>`).join('');
}
function renderChips(id) {
  const l = layerById[id]; const el = document.querySelector(`[data-lchips="${id}"]`); if (!l?.legend || !el) return;
  const html = state.on.has(id) ? chipsInner(l) : ''; if (el.innerHTML !== html) el.innerHTML = html; el.hidden = !html;
}
const legendChips = (l) => (l.legend ? `<div class="lchips" data-lchips="${l.id}" role="group" aria-label="Show or hide kinds" ${state.on.has(l.id) ? '' : 'hidden'}>${state.on.has(l.id) ? chipsInner(l) : ''}</div>` : '');
function tipParts(p) {
  const m = /<b>([\s\S]*?)<\/b>(?:<span>([\s\S]*?)<\/span>)?/.exec(p.tip ?? '');
  const clean = (x) => (x ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  return [clean(m?.[1]) || p.label || '', clean(m?.[2])];
}
const solid = (c, fb) => (typeof c === 'string' && (c.startsWith('#') || c.startsWith('rgb')) ? c.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : fb);
// Hide sprites on the far side of the planet (sprites ignore depth so they never clip into the ground).
function cullSprites() {
  const c = globe.camera().position; const cl = c.length();
  for (const sp of markers.pool) {
    if (!sp.userData.d) continue;
    if (!sp.userData.want) { sp.visible = false; continue; }
    // Fade sprites out as they reach the planet's edge instead of letting them pile up on the rim and pop.
    const p = sp.position; const dot = (p.x * c.x + p.y * c.y + p.z * c.z) / (p.length() * cl); const edge = (R * 1.0) / cl;
    const fade = Math.max(0, Math.min(1, (dot - edge) / (sp.userData.pin ? 0.03 : 0.06)));
    sp.visible = fade > 0.02; sp.material.opacity = fade;
  }
}
const plainTip = (t) => String(t ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const SETTERS = {
  rings: (d) => pulses.set(d), paths: (d) => globe.pathsData(d), arcs: (d) => globe.arcsData(d),
  polygons: (d) => globe.polygonsData(d), particles: (d) => globe.particlesData(d),
  html: (d) => globe.htmlElementsData(d), custom: (d) => globe.customLayerData(d), pick: () => {}, lines: (d) => { state.lineSets = d; },
  hexes: (d) => globe.hexBinResolution(state.pov.altitude < 0.006 ? 9 : state.pov.altitude < 0.02 ? 8 : state.pov.altitude < 0.07 ? 7 : 6).hexBinPointsData(d),
};

// Periodic refresh — each layer declares its own cadence.
setInterval(() => {
  const now = Date.now();
  for (const l of LAYERS) if (l.refresh && state.on.has(l.id) && now - (state.loadedAt[l.id] ?? 0) >= l.refresh) refreshLayer(l.id);
  updateSun();
}, 1000);
// Time machine: while the clock runs faster than real time (or has been moved), time-driven layers
// (Sun, stations, satellites, earthquake replay) are recomputed several times a second.
setInterval(() => {
  if (clock.isLive()) return;
  updateSun();
  for (const l of LAYERS) if (l.timeDriven && state.on.has(l.id) && state.data[l.id]) state.chan[l.id] = l.channels(state.data[l.id], ctx());
  scheduleCompose();
}, 300);

// ------------------------------------------------------------------ layer panel
function countOf(id) {
  const l = layerById[id]; const ch = state.chan[id]; const d = state.data[id];
  if (!ch || !d) return '';
  if (l.count) return l.count(d);
  const n = ch.pick?.length || (ch.points?.length ?? 0) + (ch.labels?.length ?? 0) + (ch.paths?.length ?? 0) + (ch.polygons?.length ?? 0) + (ch.arcs?.length ?? 0) + (ch.particles ?? []).reduce((s2, g) => s2 + g.pts.length, 0);
  return n ? n.toLocaleString() : '';
}
function updateCount(id) { const el = document.querySelector(`[data-count="${id}"]`); if (el) el.textContent = state.on.has(id) ? countOf(id) : ''; }
function setLStatus(id, s, note = '') {
  state.lstatus[id] = { s, note };
  if (s !== 'loading') setTimeout(() => updateCount(id), 0);
  const dot = document.querySelector(`[data-status="${id}"]`);
  if (dot) { dot.dataset.s = s; dot.title = note || (s === 'ok' ? 'Loaded' : s === 'loading' ? 'Loading…' : ''); }
  const ln = document.querySelector(`[data-lnote="${id}"]`);
  if (ln) { ln.textContent = note; ln.dataset.s = s; ln.hidden = !note || !state.on.has(id) || s === 'loading'; }
  if (s === 'ok') renderChips(id);
  const lp = document.querySelector(`[data-lpanel="${id}"]`); const l = layerById[id];
  if (lp && l?.panel && s === 'ok' && !lp.contains(document.activeElement)) { lp.innerHTML = l.panel(state.data[id]); lp.hidden = !state.on.has(id); }
}
const PRESETS = [
  ['Connected planet', ['sun', 'borders', 'cities', 'cables', 'internet', 'power', 'aircraft', 'ships', 'radio', 'stations', 'satellites']],
  ['Live world', ['sun', 'borders', 'cities', 'quakes', 'events', 'alerts', 'news', 'aircraft', 'stations', 'launches']],
  ['Weather', ['sun', 'borders', 'cities', 'wind', 'events', 'alerts']],
  ['Space & time', ['sun', 'borders', 'stations', 'satellites', 'launches', 'aurora']],
  ['Aviation', ['sun', 'borders', 'cities', 'airports', 'aircraft']],
  ['Cameras', ['borders', 'cities', 'cameras', 'alpr']],
  ['Crime & civic', ['borders', 'cities', 'crime', 'cameras']],
  ['Space', ['sun', 'stations', 'satellites', 'aurora']],
  ['Earth science', ['quakes', 'plates', 'events', 'grid', 'borders']],
  ['Infrastructure', ['cables', 'pipelines', 'routes', 'waterways', 'ports', 'datacenters', 'borders']],
];
state.pending = new Map();
function renderLayerPanel() {
  const presets = `<div class="presets" role="group" aria-label="Quick presets">${PRESETS.map(([n], i) => `<button class="chip" data-preset="${i}">${esc(n)}</button>`).join('')}<button class="chip" data-preset="clear">Clear all</button></div>`;
  const wantOn = (l) => (state.pending.has(l.id) ? state.pending.get(l.id) : state.on.has(l.id));
  const active = LAYERS.filter((l) => state.on.has(l.id));
  // "On the map": every active layer as a chip you can switch off in one click
  const activeHtml = `<div class="active-layers"><div class="al-head"><b>On the map</b><small>${active.length} layer${active.length === 1 ? '' : 's'}</small></div>
    <div class="al-list">${active.map((l) => `<button class="al" data-off="${l.id}" title="Hide ${esc(l.label)}" style="--sw:${l.swatch}">${layerGlyph(l) ? glyphSvg(layerGlyph(l), l.swatch, 14) : '<i class="dot"></i>'}<span>${esc(l.label.replace(/ \(.*\)$/, ''))}</span><b aria-hidden="true">×</b></button>`).join('') || '<span class="muted">Nothing yet: tick a layer below or pick a preset.</span>'}</div></div>`;
  const html = activeHtml + presets + GROUPS.map((g) => {
    const ls = LAYERS.filter((l) => l.group === g.id); const nOn = ls.filter((l) => state.on.has(l.id)).length;
    const collapsed = state.collapsed.has(g.id);
    return `
    <section class="group${collapsed ? ' collapsed' : ''}" data-group="${g.id}"><h3><button class="gtoggle" data-gtoggle="${g.id}" aria-expanded="${!collapsed}"><i aria-hidden="true">▾</i>${esc(g.label)}</button><small>${nOn ? `${nOn} on · ` : ''}${ls.length}${g.note ? ` · ${esc(g.note)}` : ''}</small></h3>
      ${ls.map((l) => `
        <div class="layer${wantOn(l) ? ' is-on' : ''}" style="--sw:${l.swatch}" data-name="${esc(`${l.label} ${g.label}`.toLowerCase())}">
          <input type="checkbox" id="ly-${l.id}" data-layer="${l.id}" ${(state.pending.has(l.id) ? state.pending.get(l.id) : state.on.has(l.id)) ? 'checked' : ''}/>
          <label class="sw" for="ly-${l.id}" aria-hidden="true"></label>
          <label for="ly-${l.id}">${layerGlyph(l) ? glyphSvg(layerGlyph(l), l.swatch, 17) : ''}${esc(l.label)}${l.fresh ? ' <em class="new">new</em>' : ''}${state.pending.has(l.id) ? ' <em class="pend">' + (state.pending.get(l.id) ? 'will show' : 'will hide') + '</em>' : ''}<span class="cnt" data-count="${l.id}">${state.on.has(l.id) ? countOf(l.id) : ''}</span></label>
          <span class="st" data-status="${l.id}" data-s="${state.lstatus[l.id]?.s ?? ''}"></span>
          <button class="learn" data-learn="${l.id}" aria-label="Learn about ${esc(l.label)}">Learn</button>
          ${(l.options ?? []).map((o) => optionHtml(l, o)).join('')}
          ${legendChips(l)}
          ${l.panel ? `<div class="lpanel" data-lpanel="${l.id}" ${state.on.has(l.id) && state.data[l.id] ? '' : 'hidden'}>${state.on.has(l.id) ? l.panel(state.data[l.id]) : ''}</div>` : ''}
          <p class="lnote" data-lnote="${l.id}" data-s="${state.lstatus[l.id]?.s ?? ''}" ${state.on.has(l.id) && state.lstatus[l.id]?.note && state.lstatus[l.id]?.s !== 'loading' ? '' : 'hidden'}>${esc(state.lstatus[l.id]?.note ?? '')}</p>
        </div>`).join('')}
    </section>`; }).join('');
  $('#layer-list').innerHTML = html;
  filterLayers();
  const n = state.pending.size;
  $('#apply-bar').hidden = n === 0;
  $('#apply-count').textContent = `${n} change${n === 1 ? '' : 's'} ready`;
}
// Layer filter (the box above the list): hides non-matching rows without re-rendering, so typing stays smooth.
function filterLayers() {
  const q = ($('#layer-filter')?.value ?? '').trim().toLowerCase(); const list = $('#layer-list');
  list.classList.toggle('filtering', !!q);
  list.querySelectorAll('.layer').forEach((el) => { el.hidden = !!q && !el.dataset.name.includes(q); });
  list.querySelectorAll('.group').forEach((g) => { g.hidden = !!q && !g.querySelector('.layer:not([hidden])'); });
}
state.collapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem('global-intelligence-atlas-collapsed') ?? '[]')); } catch { return new Set(); } })();
function applyPending() {
  if (!state.pending.size) return;
  const shown = []; const hidden = [];
  for (const [id, on] of state.pending) { (on ? shown : hidden).push(layerById[id].label); }
  const changes = [...state.pending]; state.pending.clear();
  for (const [id, on] of changes) toggleLayer(id, on, { quiet: true });
  renderLayerPanel(); writeHash();
  toast([shown.length ? `Showing ${shown.join(', ')}` : '', hidden.length ? `Hidden ${hidden.join(', ')}` : ''].filter(Boolean).join(' · '));
}
function stage(id, on) {
  if (on === state.on.has(id)) state.pending.delete(id); else state.pending.set(id, on);
  renderLayerPanel();
}
function preset(i) {
  const want = i === 'clear' ? new Set() : new Set(PRESETS[i][1]);
  state.pending.clear();
  for (const l of LAYERS) if (want.has(l.id) !== state.on.has(l.id)) state.pending.set(l.id, want.has(l.id));
  renderLayerPanel(); applyPending();
}
function toast(msg, ms = 4200) {
  if (!msg) return;
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('out');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.hidden = true; }, 400); }, ms);
}
function optionHtml(l, o) {
  const v = state.opts[l.id][o.id];
  if (o.multi) return `<div class="opts" role="group" aria-label="${esc(o.label)}">${o.choices.map(([k, lab]) => `<button class="chip" data-opt="${l.id}:${o.id}:${k}" aria-pressed="${v.includes(k)}">${esc(lab)}</button>`).join('')}</div>`;
  return `<div class="opts"><select data-opt="${l.id}:${o.id}" aria-label="${esc(o.label)}">${o.choices.map(([k, lab]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></div>`;
}
$('#layer-list').addEventListener('change', (e) => {
  const id = e.target.dataset.layer;
  if (id) return stage(id, e.target.checked);
  const [lid, oid] = (e.target.dataset.opt ?? '').split(':');
  if (lid) { state.opts[lid][oid] = e.target.value; delete state.data[lid]; refreshLayer(lid); }
});
$('#layer-list').addEventListener('click', (e) => {
  const off = e.target.closest('[data-off]'); if (off) { toggleLayer(off.dataset.off, false); renderLayerPanel(); toast(`Hidden: ${layerById[off.dataset.off].label}`); return; }
  const gt = e.target.closest('[data-gtoggle]');
  if (gt) { const id = gt.dataset.gtoggle; if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id); try { localStorage.setItem('global-intelligence-atlas-collapsed', JSON.stringify([...state.collapsed])); } catch { /* ignore */ } gt.closest('.group').classList.toggle('collapsed'); gt.setAttribute('aria-expanded', String(!state.collapsed.has(id))); return; }
  const pr = e.target.closest('[data-preset]'); if (pr) return preset(pr.dataset.preset === 'clear' ? 'clear' : Number(pr.dataset.preset));
  const learn = e.target.closest('[data-learn]');
  if (learn) return showLearn(learn.dataset.learn);
  const chip = e.target.closest('.chip[data-opt]');
  if (chip) {
    const [lid, oid, k] = chip.dataset.opt.split(':');
    const arr = state.opts[lid][oid]; const i = arr.indexOf(k);
    if (i >= 0) arr.splice(i, 1); else arr.push(k);
    chip.setAttribute('aria-pressed', String(i < 0));
    refreshLayer(lid);
  }
});
function toggleLayer(id, on, { quiet = false } = {}) {
  if (on && state.excluded?.has(id)) return; // left out of this edition
  state.pending.delete(id);
  if (on) state.on.add(id); else { state.on.delete(id); updateCount(id); layerById[id]?.stop?.(); const lp = document.querySelector(`[data-lpanel="${id}"]`); if (lp) lp.hidden = true; }
  updateShade();
  const cb = document.getElementById(`ly-${id}`); if (cb) cb.checked = on;
  renderChips(id); const ln = document.querySelector(`[data-lnote="${id}"]`); if (ln && !on) ln.hidden = true;
  if (id === 'aircraft') flightsChip(on ? state.data.aircraft : null);
  if (on) refreshLayer(id); else compose();
  writeHash();
}

// ------------------------------------------------------------------ field notes
function openNotes(title, html, key = null) {
  // Sections (live feed, saved views, about, the tours list) open in the left drawer; details in the right one.
  const sect = (key && SECTION_FOR_KEY[key]) || SECTION_FOR_TITLE[title];
  if (sect && shell) { shell.show(sect, title, html, key ?? `section:${sect}`); return; }
  stopCameraMedia();
  state.notesKey = key;
  if (!key?.startsWith('flight:')) { flightState.selected = null; flightState.follow = false; }
  $('#notes-title').textContent = title;
  $('#notes-body').innerHTML = html;
  $('#notes').classList.add('open'); document.body.classList.add('right-open');
  // Back history: each card remembers how to reopen itself (a fresh copy, so live numbers stay live).
  const reopen = state.reopen ?? (() => openNotes(title, html, key)); state.reopen = null;
  if (state.histNav) state.histNav = false;
  else if (!key?.startsWith('flight:') || detailsHist.at(-1)?.key !== key) { detailsHist.push({ title, key, fn: reopen }); if (detailsHist.length > 30) detailsHist.shift(); }
  updateBack();
  // On narrower windows only one drawer at a time, so the globe never gets squeezed to a sliver.
  if (innerWidth < 1280 && document.body.classList.contains('left-open')) { shell?.close(); state.leftAuto = innerWidth > 860; }
  $('#notes-body').scrollTop = 0;
}
const detailsHist = [];
function updateBack() { const b = $('#notes-back'); if (!b) return; b.hidden = detailsHist.length < 2; if (!b.hidden) b.title = `Back to ${detailsHist.at(-2).title}`; }
function detailsBack() { if (detailsHist.length < 2) return; detailsHist.pop(); const prev = detailsHist.at(-1); state.histNav = true; prev.fn(); updateBack(); }
function closeNotes() { detailsHist.length = 0; updateBack(); $('#notes').classList.remove('open'); document.body.classList.remove('right-open'); if (state.leftAuto) { state.leftAuto = false; shell?.open(shell.current()); } stopCameraMedia(); state.notesKey = null; setTimeout(writeHash, 0); if (state.selected) { state.selected = null; compose.forceMarkers = true; scheduleCompose(); } if (flightState.selected) { flightState.selected = null; flightState.follow = false; refreshLayer('aircraft', { soft: true }); } }
const isOpen = (key) => (state.notesKey === key && $('#notes').classList.contains('open')) || !!shell?.isOpen(key);
const linksHtml = (links) => (links?.length ? `<div class="links">${links.filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : '');
const rowsHtml = (rows) => (rows?.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '');
const refsHtml = (ids) => `<ul class="sources">${ids.map((i) => SOURCES[i]).filter(Boolean).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a><small>${esc(s.license)}</small></li>`).join('')}</ul>`;

// Every card for something on the ground gets one-click zooms, so nobody has to wheel down from orbit.
const AIRBORNE = new Set(['aircraft', 'stations', 'satellites', 'launches', 'moon', 'sun']);
/** Where an item is, whatever shape its data has (plain lat/lng, lon, or a GeoJSON point). */
function locOf(d) {
  if (!d) return null;
  const lng = d.lng ?? d.lon ?? d.longitude; const lat = d.lat ?? d.latitude;
  if (Number.isFinite(+lat) && Number.isFinite(+lng) && lat !== null && lng !== null) return [+lat, +lng];
  const c = d.geometry?.coordinates; if ((d.geometry?.type ?? 'Point') === 'Point' && Number.isFinite(c?.[0]) && Number.isFinite(c?.[1])) return [c[1], c[0]];
  return null;
}
function zoomRow(at, layer) {
  if (!at || AIRBORNE.has(layer)) return '';
  const [lat, lng] = at; const v = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
  return `<div class="zoomrow"><button class="btn" data-zoomto="${v},street">Zoom to street level</button><button class="btn ghost" data-zoomto="${v},area">Show the area</button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-zoomto]'); if (!b) return;
  const [lat, lng, level] = b.dataset.zoomto.split(',');
  nav.zoomTo(+lat, +lng, level);
});

function select(ref) {
  const l = layerById[ref.layer];
  if (l?.open) return l.open(ref.d);
  if (!l?.describe) return showLearn(ref.layer);
  const c = l.describe(ref.d);
  state.selected = ref; compose.forceMarkers = true; scheduleCompose();
  state.reopen = () => select(ref);
  const key = `sel:${ref.layer}:${c.title}`;
  openNotes(l.label, `
    <div id="sel-wiki"></div>
    <h3 class="withglyph">${itemGlyph(ref) ? glyphSvg(itemGlyph(ref), l.swatch, 30) : ''}<span>${esc(c.title)}</span></h3>${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ''}
    ${zoomRow(c.probe ?? locOf(ref.d), ref.layer)}
    ${c.html ?? ''}${rowsHtml(c.rows)}${c.body ? `<p>${esc(c.body)}</p>` : ''}
    ${c.actions?.length ? `<div class="row">${c.actions.map(([a, t]) => `<button class="btn ghost" data-action="${a}">${esc(t)}</button>`).join('')}</div><div id="sel-action"></div>` : ''}
    ${linksHtml(c.links)}
    ${c.probe ? `<h4>Here, right now</h4>${probeHtml(c.probe[0], c.probe[1])}` : ''}
    <h4>About this layer</h4><p>${esc(l.learn.what)}</p>
    <div class="row"><button class="btn ghost" data-learn-more="${l.id}">How it is measured, and something to try</button><button class="btn ghost" data-share="1">Copy a link to this</button></div>`, key);
  writeHash();
  if (c.probe) fillProbe(c.probe[0], c.probe[1]);
  if (c.wiki) wikiCard(c.wiki, key);
  if (ref.layer === 'airports' && state.data.aircraft) runAction('airport-board');
}
// Wikipedia summary + photo for named things (only exact article matches, never disambiguation pages).
async function wikiCard(title, key) {
  try {
    const w = await getFeed('wikipedia', `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, '_'))}`, { ttl: 86_400_000 });
    if (w.type !== 'standard' || !isOpen(key)) return;
    $('#sel-wiki').innerHTML = `<figure class="wiki">${w.thumbnail ? `<img src="${esc(w.thumbnail.source)}" alt="" loading="lazy" />` : ''}<figcaption>${esc(w.extract)} <a href="${esc(w.content_urls?.desktop?.page)}" target="_blank" rel="noopener">Wikipedia</a></figcaption></figure>`;
  } catch { /* no article, no card */ }
}
/** Arrivals and departures right now, worked out from live aircraft around an airport. */
function airportBoard(ap) {
  const ac = state.data.aircraft?.ac;
  if (!ac?.length) return `<p class="muted">Turn on Live flights to see arrivals and departures here. <button class="btn ghost" data-enable-flights="1">Turn on Live flights</button></p>`;
  const arr = []; const dep = []; const ground = []; const over = [];
  for (const a of ac) {
    const km = astro.haversineKm(ap.lat, ap.lng, a.lat, a.lng); if (km > 90) continue;
    if (a.ground || (a.altFt < 400 + ap.elev && km < 6)) { if (km < 6) ground.push([a, km]); continue; }
    const toAp = astro.bearingDeg(a.lat, a.lng, ap.lat, ap.lng); const diff = Math.abs(((a.trk - toAp + 540) % 360) - 180);
    if (a.altFt > 15000) { if (km < 40) over.push([a, km]); continue; }
    if (diff < 50 && (a.vs == null || a.vs < 300)) arr.push([a, km]); else if (diff > 110 && (a.vs == null || a.vs > -300)) dep.push([a, km]); else over.push([a, km]);
  }
  const row = ([a, km], extra) => `<button class="tour-card" data-flight="${esc(a.id)}"><b>${esc(a.call || a.id.toUpperCase())}${a.type ? ` · ${esc(a.type)}` : ''}</b><span>${extra}</span></button>`;
  const eta = (a, km) => (a.kt ? Math.max(1, Math.round((km / (a.kt * 1.852)) * 60)) : null);
  arr.sort((x, y) => x[1] - y[1]); dep.sort((x, y) => x[1] - y[1]);
  const list = (title, rows, fmt) => `<h4>${title} <small class="muted">${rows.length}</small></h4>${rows.length ? rows.slice(0, 8).map((r) => row(r, fmt(r))).join('') : '<p class="muted">None right now.</p>'}`;
  return `<div class="deck">${list('Arriving', arr, ([a, km]) => `${Math.round(km)} km out · ${Math.round(a.altFt).toLocaleString()} ft${eta(a, km) ? ` · lands in about ${eta(a, km)} min` : ''}`)}
    ${list('Departing', dep, ([a, km]) => `${Math.round(km)} km away · climbing through ${Math.round(a.altFt).toLocaleString()} ft`)}
    ${list('On the ground', ground, ([a]) => (a.kt > 5 ? `taxiing at ${Math.round(a.kt)} kt` : 'parked or holding'))}
    ${over.length ? `<p class="muted">${over.length} more aircraft within 90 km are passing overhead or manoeuvring.</p>` : ''}
    <p class="muted">Worked out from each plane’s heading, height and climb rate relative to the airport${state.data.aircraft.src?.includes('snapshot') ? ', using the 10-minute snapshot moved forward in time, so treat it as an estimate' : ''}.</p></div>`;
}
async function runAction(kind) {
  const ref = state.selected; const out = $('#sel-action');
  if (kind === 'ride') return extras?.ride(true);
  if (kind === 'airport-board' && ref?.d) { if (out) out.innerHTML = airportBoard(ref.d); return; }
  if (kind === 'orbit' && ref?.d?.sat) { orbitOf.sat = ref.d.sat; orbitOf.snapshot = ref.d.snapshot; toggleLayer('satellites', true); refreshLayer('satellites', { soft: true }); if (out) out.innerHTML = '<p class="muted">Orbit drawn in violet — one full revolution from now.</p>'; }
  if (kind === 'passes' && ref?.d?.sat) {
    if (ref.d.snapshot) { out.innerHTML = '<p class="err">Pass predictions need live orbital elements, and CelesTrak is unreachable right now.</p>'; return; }
    out.innerHTML = '<p class="muted">Finding your location…</p>';
    const go = (lat, lng) => {
      const ps = passes(ref.d.sat, lat, lng, 48);
      out.innerHTML = ps.length ? `<p>Next passes above 10° for ${astro.fmtLat(lat)}, ${astro.fmtLng(lng)}:</p><dl>${ps.map((p) => {
        const dark = astro.solarElevation(lat, lng, p.maxAt) < -6;
        return `<dt>${p.start.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</dt><dd>up to ${Math.round(p.maxEl)}°, ${Math.max(1, Math.round((p.end - p.start) / 60000))} min${dark ? ' · sky dark — look for a moving star' : ' · daylight'}</dd>`;
      }).join('')}</dl><p class="muted">Satellites are only visible when your sky is dark but they are still sunlit, usually within two hours of sunset or sunrise.</p>` : '<p>No passes above 10° in the next 48 hours from here.</p>';
    };
    if (state.home) return go(...state.home);
    navigator.geolocation?.getCurrentPosition((p) => { state.home = [p.coords.latitude, p.coords.longitude]; go(...state.home); }, () => go(state.pov.lat, state.pov.lng));
  }
  if (kind === 'footprint' && ref?.d?.altKm) {
    const ang = (Math.acos(astro.R_EARTH_KM / (astro.R_EARTH_KM + ref.d.altKm)) * 180) / Math.PI;
    state.tool.paths = [{ pts: smallCircle(ref.d.lat, ref.d.lng, ang, 180).map(([a, b]) => [a, b, 0.004]), color: '#9fe3ff', stroke: 0.9, passive: true }];
    state.tool.rings = [{ lat: ref.d.lat, lng: ref.d.lng, color: '#9fe3ff', maxR: ang / Math.max(zk(), 0.001), speed: ang / Math.max(zk(), 0.001), period: 2200 }];
    compose();
    const areaFrac = (1 - Math.cos((ang * Math.PI) / 180)) / 2;
    if (out) out.innerHTML = `<p>From ${Math.round(ref.d.altKm).toLocaleString()} km up it can see a circle ${Math.round((ang * Math.PI / 180) * astro.R_EARTH_KM).toLocaleString()} km in radius — about ${(areaFrac * 100).toFixed(1)} % of Earth’s surface. Anyone inside the cyan circle could in principle see it above their horizon.</p>`;
    globe.pointOfView({ lat: ref.d.lat, lng: ref.d.lng, altitude: Math.max(state.pov.altitude, 1.8) }, reduceMotion ? 0 : 1200);
  }
  if (kind === 'launch-azimuth' && ref?.d) {
    const boost = 465.1 * Math.cos((ref.d.lat * Math.PI) / 180);
    if (out) out.innerHTML = `<p>Earth’s spin carries this pad east at <b>${Math.round(boost)} m/s</b> (${Math.round(boost * 3.6).toLocaleString()} km/h) — free speed for a rocket launching east. Orbit needs about 7,800 m/s, so that is ${((boost / 7800) * 100).toFixed(1)} % of the job done before lift-off. A pad’s latitude is also the lowest orbital inclination it can reach directly (${Math.abs(ref.d.lat).toFixed(1)}° here), which is why equatorial sites such as Kourou are prized for geostationary missions, and why most pads face an ocean: spent stages must fall on water.</p>`;
  }
  if (kind === 'crime-goto' && ref?.d?.goto) globe.pointOfView({ lat: ref.d.goto.lat, lng: ref.d.goto.lng, altitude: 0.03 }, reduceMotion ? 0 : 1800);
  if (kind === 'zoom-alpr' && ref?.d) globe.pointOfView({ lat: ref.d.lat, lng: ref.d.lng, altitude: 0.25 }, reduceMotion ? 0 : 1500);
  if (kind === 'near-flights' && ref?.d) { state.opts.aircraft.scope = 'near'; delete state.data.aircraft; toggleLayer('aircraft', true); renderLayerPanel(); globe.pointOfView({ lat: ref.d.lat, lng: ref.d.lng, altitude: 0.08 }, reduceMotion ? 0 : 1500); }
}
function legendHtml(l) {
  const items = l.legend ?? (layerGlyph(l) ? [[layerGlyph(l), l.label]] : []);
  return items.length ? `<h4>Symbols on the map</h4>${l.legend ? '<p class="muted">Click a symbol to hide or show that kind.</p>' : ''}<div class="legend">${items.map(([g, label, c]) => (l.legend ? `<button class="lchip" data-gfilter="${l.id}:${g}" aria-pressed="${!state.hideGlyph[l.id]?.has(g)}">${glyphSvg(g, c ?? l.swatch, 24)}<span>${esc(label)}</span></button>` : `<span>${glyphSvg(g, c ?? l.swatch, 24)}${esc(label)}</span>`)).join('')}</div>` : '';
}
function showLearn(id) {
  const l = layerById[id]; const st = state.lstatus[id];
  const extra = l.describeLayer && state.data[id] ? rowsHtml(l.describeLayer(state.data[id]).rows) : '';
  openNotes('Learn', `
    <h3>${esc(l.label)}</h3>
    ${st?.note ? `<p class="${st.s === 'error' ? 'err' : 'muted'}">${esc(st.note)}</p>` : ''}
    ${extra}
    ${legendHtml(l)}
    <h4>What you are seeing</h4><p>${esc(l.learn.what)}</p>
    <h4>How it is measured</h4><p>${esc(l.learn.how)}</p>
    <h4>Try this</h4><p>${esc(l.learn.try)}</p>
    ${state.on.has(id) ? '' : `<p><button class="btn" data-enable="${id}">Show this layer</button></p>`}
    ${id === 'alpr' ? '<p><button class="btn ghost" data-alpr-live="1">Load the latest for this area from OpenStreetMap</button></p>' : ''}
    ${id === 'cameras' ? '<p><button class="btn" data-wall="1">Open the camera wall for this view</button></p>' : ''}
    ${id === 'aircraft' ? '<p><button class="btn" data-board="1">Open the flights board</button></p>' : ''}
    ${id === 'stations' ? '<p><button class="btn" data-ride="on">Ride along with the ISS</button></p>' : ''}
    <h4>Sources and further reading</h4>${refsHtml(l.learn.refs)}`);
}
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#notes-body, .sect-body')) return;
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.whatsnew) whatsNew();
  if (t.dataset.learnMore) showLearn(t.dataset.learnMore);
  if (t.dataset.enable) { toggleLayer(t.dataset.enable, true); showLearn(t.dataset.enable); }
  if (t.dataset.tour) { if (state.mode !== 'tours') setMode('tours'); startTour(t.dataset.tour); }
  if (t.dataset.step) stepTour(Number(t.dataset.step));
  if (t.id === 'tour-exit') endTour();
  if (t.id === 'tour-play') toggleTourPlay(t);
  if (t.id === 'quiz-start' || t.id === 'quiz-again') startQuiz();
  if (t.id === 'quiz-next') nextQuestion();
  if (t.dataset.fly) { const [a, b, c] = t.dataset.fly.split(',').map(Number); fly(a, b, c); }
  if (t.dataset.here) { const p = state.here?.[Number(t.dataset.here)]; if (p?.ref) select(p.ref); }
  if (t.dataset.action) runAction(t.dataset.action);
  if (t.dataset.board) extras?.flightsBoard();
  if (t.dataset.share) shareLink();
  if (t.dataset.sky) { const [a, b] = t.dataset.sky.split(',').map(Number); sky.open(a, b); }
  if (t.dataset.enableFlights) { toggleLayer('aircraft', true); renderLayerPanel(); setTimeout(() => { if (state.selected?.layer === 'airports') runAction('airport-board'); }, 5000); }
  if (t.dataset.deck) deckAction(t.dataset.deck, api);
  if (t.dataset.cam) { const w = t.dataset.cam.startsWith('w-'); const c = w ? layerById.webcams.find(t.dataset.cam) : state.data.cameras?.cams.find((x) => x.id === t.dataset.cam); if (c) { select({ layer: w ? 'webcams' : 'cameras', d: c }); fly(c.lat, c.lng, Math.min(state.pov.altitude, 0.02)); } }
  if (t.dataset.alprLive) layerById.alpr.fetchLive(viewOf(state.pov)).then((n) => { t.textContent = `Loaded ${n} from OpenStreetMap`; refreshLayer('alpr'); }).catch(() => { t.textContent = 'Overpass did not respond — try again shortly'; });
});
document.addEventListener('click', (e) => { const gf = e.target.closest('[data-gfilter]'); if (gf) { const [lid, g] = gf.dataset.gfilter.split(':'); toggleGlyph(lid, g); } });
document.addEventListener('click', (e) => { if (e.target.closest('[data-open-about]')) { e.preventDefault(); setMode('about'); } });
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.close === 'notes') { closeNotes(); if (state.mode) setMode(null); } else shell?.close();
}));

// ------------------------------------------------------------------ surface clicks: probe + country card
function groundClick(e, c) {
  const g = c?.lat != null ? c : globe.toGlobeCoords(e.offsetX, e.offsetY); if (!g) return;
  surfaceClick(g.lat, g.lng, state.on.has('borders') ? countryAt(g.lat, g.lng) : null);
}
function surfaceClick(lat, lng, country) {
  if (state.clickConsumed) return; // a marker already handled this click (globe.gl's own click can arrive a frame later)
  if (state.watchPick) return watch.pick(lat, lng);
  if (state.mode === 'measure') return measureClick(lat, lng);
  if (state.mode === 'quiz') return quizClick(lat, lng);
  if (state.mode === 'trace') return tracer.trace(lat, lng);
  if (state.mode === 'tours') return;
  setPins([{ lat, lng, cls: '' }]);
  if (country) return countryCard(country, lat, lng);
  probeCard(lat, lng);
}

function probeHtml(lat, lng) {
  const now = clock.date(); const el = astro.solarElevation(lat, lng, now);
  return `
    <dl>
      <dt>Position</dt><dd>${astro.fmtLat(lat)}, ${astro.fmtLng(lng)}</dd>
      <dt>Local solar time</dt><dd>${astro.localSolarTime(lng, now)}</dd>
      <dt>Sun elevation</dt><dd>${el.toFixed(1)}° — ${el > 0 ? 'daytime' : el > -6 ? 'civil twilight' : el > -18 ? 'twilight' : 'night'}</dd>
    </dl>
    <div id="probe-live" class="muted">Fetching weather and elevation…</div>
    <div id="probe-plate" class="muted"></div>
    <h4>Look around</h4>
    <div class="row">
      <button class="btn" data-sky="${lat},${lng}">Sky above here</button>
      <a class="btn ghost" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}" target="_blank" rel="noopener">Street View</a>
      <a class="btn ghost" href="https://earth.google.com/web/@${lat},${lng},150a,900d,35y,0h,65t,0r" target="_blank" rel="noopener">Google Earth 3D</a>
      <a class="btn ghost" href="https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17" target="_blank" rel="noopener">Mapillary</a>
      <button class="btn ghost" data-fly="${lat},${lng},0.0015">Zoom to street level</button>
      <button class="btn" data-trace="${lat},${lng}">Trace connections</button>
    </div>
    <div id="probe-photos"></div><div id="probe-cams"></div>`;
}
async function fillProbe(lat, lng) {
  const token = `${lat},${lng}`; fillProbe.token = token;
  lookAround(lat, lng, token);
  getLocal('data/plate-boundaries.json').then((g) => {
    const lines = g.features.map((f) => ({ name: f.properties.Name, pts: f.geometry.coordinates.map(([a, b]) => [b, a]) }));
    const n = astro.nearestOnLines(lat, lng, lines);
    const el = $('#probe-plate');
    if (el && fillProbe.token === token) el.innerHTML = `Nearest plate boundary: <b>${esc(plateLabel(n.line.name))}</b>, about ${astro.fmtKm(n.km)} away.`;
  }).catch(() => {});
  try {
    const [w, e] = await Promise.all([
      getFeed('openmeteo', `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,weather_code&timezone=auto`),
      getFeed('openmeteo', `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`),
    ]);
    if (fillProbe.token !== token) return;
    const c = w.current; const elev = e.elevation?.[0];
    $('#probe-live').outerHTML = `<dl>
      <dt>Weather now</dt><dd>${esc(WMO[c.weather_code] ?? '—')}, ${c.temperature_2m} °C</dd>
      <dt>Wind</dt><dd>${c.wind_speed_10m} km/h from ${Math.round(c.wind_direction_10m)}°</dd>
      <dt>Humidity · clouds</dt><dd>${c.relative_humidity_2m} % · ${c.cloud_cover} %</dd>
      <dt>Ground elevation</dt><dd>${elev != null ? `${Math.round(elev).toLocaleString()} m ${elev < 0 ? '(below sea level — seafloor or depression)' : ''}` : '—'}</dd>
      <dt>Time zone</dt><dd>${esc(w.timezone ?? '—')}</dd></dl>
      <p class="muted">Weather: Open-Meteo (CC BY 4.0).</p>`;
  } catch {
    const el = $('#probe-live'); if (el && fillProbe.token === token) el.innerHTML = '<span class="err">Open-Meteo did not respond. Weather and elevation are unavailable right now.</span>';
  }
}
// Street-level photos from Panoramax (open, keyless) and the nearest live cameras.
async function lookAround(lat, lng, token) {
  const cams = state.data.cameras?.cams;
  if (cams) {
    const near = cams.map((c) => ({ c, km: astro.haversineKm(lat, lng, c.lat, c.lng) })).filter((x) => x.km < 25).sort((a, b) => a.km - b.km).slice(0, 4);
    if (near.length && $('#probe-cams')) $('#probe-cams').innerHTML = `<h4>Live cameras nearby</h4><div class="camwall">${near.map(({ c, km }) => `<button class="camtile" data-cam="${esc(c.id)}"><img src="${esc(c.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/><span>${esc(c.name)}</span><small>${km.toFixed(1)} km</small></button>`).join('')}</div>`;
  }
  try {
    const d = 0.004;
    const j = await getFeed('panoramax', `https://api.panoramax.xyz/api/search?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&limit=6`, { ttl: 3600_000 });
    const fs = (j.features ?? []).filter((f) => f.assets?.thumb?.href);
    if (fillProbe.token !== token || !fs.length || !$('#probe-photos')) return;
    $('#probe-photos').innerHTML = `<div class="photos">${fs.map((f) => `<a href="${esc(f.assets.hd?.href ?? f.assets.thumb.href)}" target="_blank" rel="noopener"><img src="${esc(f.assets.thumb.href)}" alt="Street-level photo" loading="lazy"/></a>`).join('')}</div><p class="muted">Street-level photos: Panoramax contributors (CC BY-SA).</p>`;
  } catch { /* optional */ }
}
const WMO = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail' };

function probeCard(lat, lng) {
  state.reopen = () => probeCard(lat, lng);
  openNotes('Point probe', `<h3>This spot on Earth</h3>${zoomRow([lat, lng], 'probe')}${probeHtml(lat, lng)}`);
  fillProbe(lat, lng);
}

const flagOf = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
const WB = [['NY.GDP.MKTP.CD', 'GDP (current US$)', (v) => `$${(v / 1e9).toLocaleString(undefined, { maximumFractionDigits: 0 })} bn`],
  ['SP.DYN.LE00.IN', 'Life expectancy', (v) => `${v.toFixed(1)} years`],
  ['IT.NET.USER.ZS', 'Internet users', (v) => `${v.toFixed(0)} % of people`],
  ['EG.FEC.RNEW.ZS', 'Renewable energy', (v) => `${v.toFixed(0)} % of final energy use`]];

async function countryCard(f, lat, lng) {
  const p = f.properties; const cc = p['ISO3166-1-Alpha-2']; const name = p.name;
  state.reopen = () => countryCard(f, lat, lng);
  openNotes('Country', `<h3><span class="flag">${flagOf(cc)}</span>${esc(name)}</h3>
    <div id="cc-facts" class="muted">Loading facts…</div><div id="cc-wb"></div><div id="cc-wiki"></div>
    <h4>The point you clicked</h4>${probeHtml(lat, lng)}`);
  fillProbe(lat, lng);
  const valid = cc && /^[A-Z]{2}$/.test(cc);
  if (valid) getFeed('restcountries', `https://restcountries.com/v3.1/alpha/${cc}?fields=name,capital,population,area,region,subregion,languages,currencies,timezones,latlng`).then((r) => {
    const el = $('#cc-facts'); if (!el) return;
    el.className = '';
    el.innerHTML = rowsHtml([['Official name', r.name?.official], ['Capital', r.capital?.join(', ')], ['Region', [r.region, r.subregion].filter(Boolean).join(' · ')],
      ['Population', r.population?.toLocaleString()], ['Area', r.area ? `${Math.round(r.area).toLocaleString()} km²` : '—'],
      ['Density', r.area ? `${(r.population / r.area).toFixed(0)} people/km²` : '—'],
      ['Languages', Object.values(r.languages ?? {}).join(', ')], ['Currencies', Object.values(r.currencies ?? {}).map((c) => `${c.name} (${c.symbol ?? ''})`).join(', ')],
      ['Time zones', r.timezones?.length > 3 ? `${r.timezones.length} zones` : r.timezones?.join(', ')]]);
  }).catch(() => { const el = $('#cc-facts'); if (el) el.innerHTML = '<span class="err">REST Countries did not respond.</span>'; });
  else $('#cc-facts').textContent = '';
  if (valid) Promise.allSettled(WB.map(([ind]) => getFeed('worldbank', `https://api.worldbank.org/v2/country/${cc}/indicator/${ind}?format=json&mrnev=1`))).then((rs) => {
    const rows = rs.map((r, i) => { const d = r.value?.[1]?.[0]; return d?.value != null ? [`${WB[i][1]} (${d.date})`, WB[i][2](d.value)] : null; }).filter(Boolean);
    const el = $('#cc-wb'); if (el && rows.length) el.innerHTML = `<h4>World Bank indicators</h4>${rowsHtml(rows)}`;
  });
  getFeed('wikipedia', `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`).then((w) => {
    const el = $('#cc-wiki'); if (!el || !w.extract) return;
    el.innerHTML = `<h4>From Wikipedia</h4><p>${esc(w.extract)}</p>${linksHtml([{ label: 'Read on Wikipedia', url: w.content_urls?.desktop?.page }])}`;
  }).catch(() => {});
}

// ------------------------------------------------------------------ pins / tool overlays
function pinEl(cls) { const d = document.createElement('div'); d.className = `pin ${cls}`; return d; }
function setPins(pins) { state.tool.html = pins.map((p) => ({ lat: p.lat, lng: p.lng, el: pinEl(p.cls) })); compose(); }
function clearTool() { state.tool = { points: [], paths: [], arcs: [], html: [], labels: [], rings: [] }; compose(); }
function pulse(lat, lng, rKm) { const ring = { lat, lng, color: '#7ed6c4', maxR: rKm / 111 / Math.max(zk(), 0.001), speed: rKm / 111 / 0.9 / Math.max(zk(), 0.001), period: 900 }; state.tool.rings.push(ring); compose(); setTimeout(() => { state.tool.rings = state.tool.rings.filter((r) => r !== ring); compose(); }, 3200); }
function setHover(c) {
  if (c === state.hover || state.dragging) return; // never rebuild anything while the globe is being dragged
  state.hover = c; $('#globe').style.cursor = c && !state.mode ? 'pointer' : state.mode === 'measure' || state.mode === 'quiz' ? 'crosshair' : '';
  if (state.data.borders && state.on.has('borders')) { state.chan.borders = layerById.borders.channels(state.data.borders, ctx()); compose(); }
}

// ------------------------------------------------------------------ measure
function measureClick(lat, lng) {
  if (state.measure.length >= 2) state.measure = [];
  state.measure.push([lat, lng]);
  const [a, b] = state.measure;
  state.tool.html = state.measure.map(([la, lo]) => ({ lat: la, lng: lo, el: pinEl('') }));
  state.tool.paths = [];
  if (b) {
    const km = astro.haversineKm(a[0], a[1], b[0], b[1]);
    state.tool.paths = [{ pts: astro.greatCirclePoints(a[0], a[1], b[0], b[1], 128).map(([x, y]) => [x, y, 0.006]), color: '#e3b55b', stroke: 1.1, passive: true }];
    const fibreMs = (km / 204000) * 1000; const vacMs = (km / 299792) * 1000;
    openNotes('Measure', `<h3>${astro.fmtKm(km)}</h3><p class="sub">Great-circle distance — the shortest path over the surface.</p>
      ${rowsHtml([['From', `${astro.fmtLat(a[0])}, ${astro.fmtLng(a[1])}`], ['To', `${astro.fmtLat(b[0])}, ${astro.fmtLng(b[1])}`],
        ['Initial bearing', `${astro.bearingDeg(a[0], a[1], b[0], b[1]).toFixed(1)}°`], ['Nautical miles', `${Math.round(km / 1.852).toLocaleString()} nmi`],
        ['Light in fibre, one way', `${fibreMs.toFixed(1)} ms (round trip ≥ ${(2 * fibreMs).toFixed(0)} ms)`], ['Light in vacuum', `${vacMs.toFixed(1)} ms`],
        ['Airliner at 900 km/h', `${(km / 900).toFixed(1)} h`]])}
      <p>The line curves on a flat map but is “straight” on the sphere. Its compass bearing changes along the way, which is why long flights look bent on paper charts. Real cables take longer routes, so real latency is higher than the fibre figure.</p>
      <p class="muted">Click two new points to measure again. Formulas: haversine and initial bearing (Aviation Formulary).</p>`);
  } else openNotes('Measure', '<h3>Pick the second point</h3><p>Click anywhere else on the globe.</p>');
  compose();
}

// ------------------------------------------------------------------ tours
let tourTimer = null;
function toursHome() {
  openNotes('Guided tours', `<p>Short stories told on the globe. Each one switches on the layers it needs.</p>
    ${TOURS.map((t) => `<button class="tour-card" data-tour="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.blurb)}</span></button>`).join('')}`);
}
function startTour(id) {
  const t = TOURS.find((x) => x.id === id);
  state.tour = { t, i: 0, prevOn: new Set(state.on), prevBase: state.base, prevSat: [...state.opts.satellites.groups] };
  if (t.satGroups) state.opts.satellites.groups = [...t.satGroups];
  for (const l of LAYERS) toggleLayer(l.id, t.layers.includes(l.id));
  renderLayerPanel();
  setBase(t.base);
  stepTour(0);
}
function stepTour(i) {
  const { t } = state.tour; state.tour.i = Math.max(0, Math.min(t.steps.length - 1, i));
  const s = t.steps[state.tour.i];
  globe.pointOfView(s.pov, reduceMotion ? 0 : 2600);
  openNotes(t.title, `<div class="steps">${t.steps.map((_, k) => `<i class="${k <= state.tour.i ? 'on' : ''}"></i>`).join('')}</div>
    <p class="kicker">Step ${state.tour.i + 1} of ${t.steps.length}</p><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
    <div class="row"><button class="btn ghost" data-step="${state.tour.i - 1}" ${state.tour.i === 0 ? 'disabled' : ''}>Back</button>
    ${state.tour.i < t.steps.length - 1 ? `<button class="btn" data-step="${state.tour.i + 1}">Next</button>` : '<button class="btn" id="tour-exit">Finish tour</button>'}
    <button class="btn ghost" id="tour-play" aria-pressed="${!!tourTimer}">${tourTimer ? 'Pause' : 'Autoplay'}</button></div>`);
}
function toggleTourPlay(btn) {
  if (tourTimer) { clearInterval(tourTimer); tourTimer = null; btn.textContent = 'Autoplay'; return; }
  btn.textContent = 'Pause';
  tourTimer = setInterval(() => { if (!state.tour) return; if (state.tour.i >= state.tour.t.steps.length - 1) { clearInterval(tourTimer); tourTimer = null; return; } stepTour(state.tour.i + 1); }, 10000);
}
function endTour() {
  clearInterval(tourTimer); tourTimer = null;
  if (state.tour) endTourSilently();
  setMode(null);
}

// ------------------------------------------------------------------ quiz
let pool = null;
async function quizHome() {
  openNotes('Where on Earth?', `<p>You get eight places. Click where you think each one is. Closer guesses score more — up to 1,000 points each, halving roughly every 1,000 km.</p>
    <p class="muted">Tip: switch Countries off for a harder game.</p><button class="btn" id="quiz-start">Start</button>`);
}
async function startQuiz() {
  pool ??= await buildQuestionPool();
  state.quiz = new Quiz(pool, 8); clearTool();
  globe.pointOfView({ lat: 15, lng: state.pov.lng, altitude: 2.6 }, reduceMotion ? 0 : 1200);
  askQuestion();
}
function askQuestion() {
  const q = state.quiz.current;
  openNotes('Where on Earth?', `<div class="steps">${state.quiz.rounds.map((_, k) => `<i class="${k < state.quiz.i ? 'on' : ''}"></i>`).join('')}</div>
    <p class="kicker">${esc(q.kind)} · question ${state.quiz.i + 1} of ${state.quiz.rounds.length}</p><h3>${esc(q.name)}</h3>
    <p>Click its location on the globe.</p><p class="muted">Score so far: ${state.quiz.score.toLocaleString()}</p>`);
  state.quiz.awaiting = true;
}
function quizClick(lat, lng) {
  if (!state.quiz?.awaiting) return;
  state.quiz.awaiting = false;
  const r = state.quiz.guess(lat, lng);
  state.tool.html = [{ lat, lng, el: pinEl('guess') }, { lat: r.q.lat, lng: r.q.lng, el: pinEl('truth') }];
  state.tool.arcs = [{ sLat: lat, sLng: lng, eLat: r.q.lat, eLng: r.q.lng, color: ['#f07a63', '#7ed6c4'], stroke: 0.7, dashLen: 1, dashGap: 0 }];
  compose();
  openNotes('Where on Earth?', `<p class="kicker">${esc(r.q.kind)}</p><h3>${esc(r.q.name)}</h3>
    <p class="score">+${r.pts}</p><p>You were ${r.kmText} away.</p>${r.q.fact ? `<p>${esc(r.q.fact)}</p>` : ''}
    <button class="btn" id="quiz-next">${state.quiz.done ? 'See your score' : 'Next place'}</button>`);
}
function nextQuestion() {
  clearTool();
  if (!state.quiz.done) return askQuestion();
  const best = Math.max(...state.quiz.results.map((r) => r.pts)); const avg = state.quiz.results.reduce((s, r) => s + r.km, 0) / state.quiz.results.length;
  openNotes('Where on Earth?', `<h3>Final score</h3><p class="score">${state.quiz.score.toLocaleString()}</p>
    ${rowsHtml([['Average miss', astro.fmtKm(avg)], ['Best round', `${best} points`]])}
    ${rowsHtml(state.quiz.results.map((r) => [r.q.name, `${r.kmText} · ${r.pts}`]))}
    <button class="btn" id="quiz-again">Play again</button>`);
}

// ------------------------------------------------------------------ about
function aboutPanel() {
  const repo = sourceRepoUrl();
  openNotes('About and sources', `
    <div class="credit"><p><b>Global Intelligence Atlas grew out of <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">World Monitor</a> by Elie Habib.</b>
    Its original 3D-globe concept, layer catalogue and curated datasets come from that project. Global Intelligence Atlas is now its own project: a static, server-free globe for the web and the desktop with live public feeds, deep-zoom imagery, tours, a quiz and teaching notes.</p></div>
    <p>Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">GNU AGPL v3.0</a>. You can read, copy and change the source code of this exact site: <a href="${esc(repo)}" target="_blank" rel="noopener">${esc(repo.replace('https://', ''))}</a>.</p>
    <h4>Keyboard</h4>${rowsHtml([['C', 'Trace connections'], ['S', 'Area scan'], ['[ ]', 'Time machine slower / faster'], ['\\', 'Back to live time'], ['/', 'Search'], ['R', 'Auto-rotate'], ['1 – 4', 'Normal, night vision, thermal, CRT'], ['L', 'Layers'], ['?', 'Keyboard and about'], ['Ctrl+K', 'Find anything: layers, places, flights, tools'], ['T · Q · M', 'Tours, quiz, measure'], ['Esc', 'Close the details, then the section']])}
    <p><button class="btn ghost" data-health="open">Data health: is every source working?</button> <button class="btn ghost" data-manifest>Layer manifest</button> <button class="btn ghost" data-datasets>Datasets: open data or World Monitor</button></p>
    <h4>Data, libraries and references</h4>
    <ul class="sources">${Object.values(SOURCES).filter((s) => !s.ref).map(sourceItem).join('')}</ul>
    <h4>Reference projects</h4><p class="muted">Twenty open-source projects Atlas learns from for visuals, presentation, frameworks and modelling theory. No code is copied from them, and every licence is compatible with the AGPL.</p>
    <ul class="sources">${Object.values(SOURCES).filter((s) => s.ref).map(sourceItem).join('')}</ul>`);
}
function sourceItem(s) {
  return `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a><small>${esc(s.role)} — ${esc(s.license)}</small></li>`;
}
function sourceRepoUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) { const repo = location.pathname.split('/').filter(Boolean)[0]; return `https://github.com/${m[1]}/${repo ?? `${m[1]}.github.io`}`; }
  return 'https://github.com/Normansrule/global-intelligence-atlas';
}

// ------------------------------------------------------------------ modes
function setMode(mode) {
  const next = state.mode === mode ? null : mode;
  if (state.tour && next !== 'tours') { clearInterval(tourTimer); tourTimer = null; endTourSilently(); }
  state.mode = next;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  state.measure = []; clearTool();
  $('#globe').style.cursor = state.mode === 'measure' || state.mode === 'quiz' ? 'crosshair' : '';
  if (state.mode === 'tours') toursHome();
  else if (state.mode === 'quiz') quizHome();
  else if (state.mode === 'measure') openNotes('Measure', '<h3>Pick two points</h3><p>Click the globe twice to get the great-circle distance, bearing, and how long light takes to cross it in an optical fibre.</p>');
  else if (state.mode === 'about') aboutPanel();
  else if (state.mode === 'trace') openNotes('Trace', '<h3>Click any place</h3><p>Trace draws how that spot is wired to the world: the nearest internet exchange buildings, the undersea cables that land nearby and every coast they reach, the power stations, the airport, public cameras and radio receivers, and a beam to each satellite overhead — with the light-speed delay of each link.</p><p class="muted">Tip: press C to turn Trace on or off.</p>');
  else closeNotes();
  if (state.mode !== 'trace') tracer?.clear();
  $('#globe').style.cursor = ['measure', 'quiz', 'trace'].includes(state.mode) ? 'crosshair' : '';
}
function endTourSilently() {
  const { prevOn, prevBase, prevSat } = state.tour; state.tour = null;
  state.opts.satellites.groups = prevSat;
  for (const l of LAYERS) toggleLayer(l.id, prevOn.has(l.id));
  renderLayerPanel(); setBase(prevBase);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
document.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base)));

// ------------------------------------------------------------------ search
let index = null; let sel = -1; let hits = [];
async function buildIndex() {
  const wm0 = await worldMonitorData();
  // the same rows the layers draw: open data or World Monitor's lists (opendata.js)
  const wm = { ...wm0 };
  await Promise.all(Object.keys(OPEN_DATA).map(async (id) => { wm[id] = await infraData(id, async () => wm0[id]).catch(() => wm0[id]); }));
  const I = [];
  const add = (name, kind, lat, lng, alt, ref) => I.push({ name, kind, lat, lng, alt, ref, key: name.toLowerCase() });
  wm.cables.forEach((c) => { const [lng, lat] = c.points[Math.floor(c.points.length / 2)] ?? [0, 0]; add(c.name, 'Cable', lat, lng, 1.2, { layer: 'cables', d: c }); });
  wm.pipelines.forEach((p) => { const [lng, lat] = p.points[Math.floor(p.points.length / 2)]; add(p.name, 'Pipeline', lat, lng, 1, { layer: 'pipelines', d: p }); });
  wm.ports.forEach((p) => add(p.name, 'Port', p.lat, p.lon, 0.25, { layer: 'ports', d: p }));
  wm.waterways.forEach((w) => add(w.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), 'Chokepoint', w.lat, w.lon, 0.4, { layer: 'waterways', d: w }));
  wm.datacenters.forEach((d) => add(d.name, 'AI data centre', d.lat, d.lon, 0.15, { layer: 'datacenters', d }));
  wm.spaceports.forEach((s) => add(s.name, 'Spaceport', s.lat, s.lon, 0.2, { layer: 'spaceports', d: s }));
  wm.nuclear.forEach((n) => add(n.name, 'Nuclear site', n.lat, n.lon, 0.15, { layer: 'nuclear', d: n }));
  wm.economic.forEach((e) => add(e.name, 'Financial centre', e.lat, e.lon, 0.2, { layer: 'economic', d: e }));
  wm.minerals.forEach((m) => add(m.name, 'Mine', m.lat, m.lon, 0.2, { layer: 'minerals', d: m }));
  (await getLocal('data/countries.geojson')).features.filter((f) => f.geometry).forEach((f) => {
    const c = centroid(f.geometry); if (c) add(f.properties.name, 'Country', c[0], c[1], 1.1, null);
  });
  (await getLocal('data/cities.json')).rows.forEach(([name, lat, lng, pop, capital, cc, region]) => add(name, capital ? 'Capital city' : 'City', lat, lng, 0.06, { layer: 'cities', d: { name, lat, lng, pop, capital: !!capital, cc, region } }));
  (await getLocal('data/airports.json')).rows.forEach(([iata, icao, name, lat, lng, elev, city, cc, large]) => {
    const d = { iata, icao, name, lat, lng, elev, city, cc, large: !!large };
    add(`${iata} · ${name}`, 'Airport', lat, lng, 0.03, { layer: 'airports', d });
  });
  TOURS.forEach((t) => I.push({ name: t.title, kind: 'Tour', tour: t.id, key: t.title.toLowerCase() }));
  LAYERS.forEach((l) => I.push({ name: l.label, kind: 'Layer', layer: l.id, key: l.label.toLowerCase() }));
  return I;
}
function centroid(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = null; let bestN = 0;
  for (const p of polys) if (p[0].length > bestN) { bestN = p[0].length; best = p[0]; }
  if (!best) return null;
  const [sx, sy] = best.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return [sy / best.length, sx / best.length];
}
const q = $('#q'); const list = $('#results');
q.addEventListener('input', async () => {
  index ??= await buildIndex();
  const s = q.value.trim().toLowerCase();
  if (s.length < 2) { list.hidden = true; return; }
  hits = index.filter((x) => x.key.includes(s)).sort((a, b) => a.key.indexOf(s) - b.key.indexOf(s) || (b.kind.includes('City') - a.kind.includes('City')) || a.name.length - b.name.length).slice(0, 9);
  hits.push({ name: `Search “${q.value.trim()}” worldwide`, kind: 'OpenStreetMap', osm: true });
  sel = -1; renderHits();
});
function renderHits() {
  list.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}">${esc(h.name)}<small>${esc(h.kind)}</small></li>`).join('');
  list.hidden = !hits.length;
}
q.addEventListener('keydown', (e) => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); renderHits(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderHits(); e.preventDefault(); }
  if (e.key === 'Escape') { list.hidden = true; q.blur(); }
});
$('#search').addEventListener('submit', (e) => { e.preventDefault(); choose(hits[sel >= 0 ? sel : 0]); });
list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) choose(hits[Number(li.dataset.i)]); });
q.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
async function choose(h) {
  if (!h) return;
  list.hidden = true; q.blur();
  if (h.tour) { setMode('tours'); return startTour(h.tour); }
  if (h.layer) { toggleLayer(h.layer, true); return showLearn(h.layer); }
  if (h.osm) return geocode(q.value.trim());
  if (h.ref) { toggleLayer(h.ref.layer, true); select(h.ref); }
  fly(h.lat, h.lng, h.alt);
  if (h.kind === 'Country') { setPins([]); }
}
async function geocode(text) {
  try {
    const r = await getFeed('nominatim', `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(text)}`, { ttl: 3600_000 });
    if (!r.length) return openNotes('Search', `<p>No place called “${esc(text)}” was found in OpenStreetMap.</p>`);
    openNotes('Search', `<p class="muted">Results © OpenStreetMap contributors (Nominatim).</p>${r.map((p) => {
      const bb = p.boundingbox.map(Number); const span = Math.max(bb[1] - bb[0], (bb[3] - bb[2]) * Math.cos(Number(p.lat) * Math.PI / 180));
      const alt = Math.max(0.002, Math.min(2.5, span / 40));
      return `<button class="tour-card" data-fly="${p.lat},${p.lon},${alt}"><b>${esc(p.name || p.display_name.split(',')[0])}</b><span>${esc(p.display_name)}</span></button>`;
    }).join('')}`);
    const p = r[0]; const bb = p.boundingbox.map(Number);
    fly(Number(p.lat), Number(p.lon), Math.max(0.002, Math.min(2.5, Math.max(bb[1] - bb[0], bb[3] - bb[2]) / 40)));
  } catch { openNotes('Search', '<p class="err">OpenStreetMap search did not respond. Try again in a moment.</p>'); }
}
function fly(lat, lng, altitude, pin = true) {
  globe.pointOfView({ lat, lng, altitude }, reduceMotion ? 0 : 2200);
  if (pin) setPins([{ lat, lng, cls: '' }]);
}
let followAt = 0;
function followTo(lat, lng) { if (performance.now() - followAt < 900) return; followAt = performance.now(); globe.pointOfView({ lat, lng, altitude: state.pov.altitude }, reduceMotion ? 0 : 1100); }

// ------------------------------------------------------------------ camera, readout, auto-detail, hash
function onCamera(pov) {
  const prevAlt = state.pov.altitude;
  state.pov = pov;
  nav.tune(pov.altitude);
  pulses.setScale(Math.max(0.0002, Math.min(1, pov.altitude / 2.2))); // smooth, every frame (a uniform: free)
  // The night shade floats just above the ground: 5 km up from far away (no flicker against the globe), only
  // tens of metres up close, so low planes and the camera itself are never above or inside it.
  nightShade.scale.setScalar((1 + Math.min(0.0008, Math.max(0.000006, pov.altitude * 0.0015))) / 1.0008);
  if (state.on.has('aircraft') && (Math.abs(Math.log(pov.altitude / prevAlt)) > 0.02 || planesStale(pov))) layoutPlanes(globe, pov.altitude);
  if (!onCamera.raf) onCamera.raf = requestAnimationFrame(() => {
    onCamera.raf = 0;
    // Zooming: re-seat pins on the ground and resize columns so nothing floats above or behind the camera.
    if (Math.abs(Math.log(state.pov.altitude / (onCamera.seatAlt ?? 1))) > 0.1) { onCamera.seatAlt = state.pov.altitude; markers.setCamera(state.pov.altitude); markers.reseat(); zkAlt = state.pov.altitude; markers.rescale(zk()); }
    cullSprites();
  });
  perf?.moving();
  clearTimeout(onCamera.v); onCamera.v = setTimeout(viewSettled, 280);
  if (!cursor) showReadout(pov.lat, pov.lng);
  $('#ro-alt').textContent = `eye ${Math.round(pov.altitude * astro.R_EARTH_KM).toLocaleString()} km`;
  // Automatic detail: below about 4,800 km the 4K globe picture is stretched past its resolution and turns into a
  // grey-blue blur, so switch to sharp satellite tiles well before that (and back only once you are far out).
  if (state.autoDetail && !TILE[state.base]) {
    if (!state.detailTiles && pov.altitude < (state.base === 'night' ? 0.12 : DETAIL_ON)) { state.detailTiles = 'imagery'; applyBase(); }
    else if (state.detailTiles && pov.altitude > (state.base === 'night' ? 0.2 : DETAIL_OFF)) { state.detailTiles = null; applyBase(); }
  }
  clearTimeout(onCamera.t); onCamera.t = setTimeout(writeHash, 500);
}
// After the camera stops: refresh the layers that depend on what is in view (city names, pins, cameras…).
// Work is split into small slices with a yield between layers, so the page never locks up.
const yieldToBrowser = () => new Promise((r) => (window.scheduler?.yield ? window.scheduler.yield().then(r) : setTimeout(r, 0)));
let settleRun = 0;
async function viewSettled() {
  const run = ++settleRun;
  applyZoomScale();
  for (const l of LAYERS) {
    if (!l.viewDependent || !state.on.has(l.id) || !state.data[l.id]) continue;
    await yieldToBrowser(); if (run !== settleRun) return; // a newer camera move superseded this one
    if (l.reloadOnView) refreshLayer(l.id); else state.chan[l.id] = l.channels(state.data[l.id], ctx());
  }
  compose.forceMarkers = true; compose();
}
// Screen-space picking for things drawn as particles or instances (planes, satellites, cameras from afar).
let downAt = null;
$('#globe').addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; state.clickConsumed = false; state.dragging = true; }, true);
addEventListener('pointerup', () => { state.dragging = false; }, true); addEventListener('pointercancel', () => { state.dragging = false; }, true);
$('#globe').addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || ['measure', 'quiz', 'trace'].includes(state.mode)) return; // these modes want the ground, not the marker
  if (e.target.closest?.('.pinx')) return;
  const rect = $('#globe').getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  const hit = pickAt(x, y);
  if (hit?.zoom) { state.hitAt = performance.now(); state.clickConsumed = true; openHere(hit); return; }
  if (hit) { state.hitAt = performance.now(); state.clickConsumed = true; select(hit.ref); }
}, true);
// v2.11: a "+N" badge opens a list of everything folded into it, so markers that share a spot are always reachable.
function openHere(hit) {
  state.here = hit.group ?? [];
  const rows = state.here.map((p, i) => { const [t, sub] = tipParts(p); const l = layerById[p.ref?.layer]; return `<button class="tour-card" data-here="${i}"><b>${esc(t || l?.label || 'Marker')}</b><span>${esc([l?.label, sub].filter(Boolean).join(' · '))}</span></button>`; }).join('');
  openNotes(`${state.here.length} things here`, `<p class="sub">These markers sit too close together to show one by one at this zoom. Pick one, or zoom in to see them spread out.</p>
    <div class="tour-list">${rows}</div><p><button class="btn ghost" data-fly="${hit.lat},${hit.lng},${Math.max(0.0006, state.pov.altitude / 4)}">Zoom in here</button></p>`, 'here');
}
function kmPerPx() { const fov = (globe.camera().fov * Math.PI) / 180; return Math.max(0.0005, (2 * state.pov.altitude * astro.R_EARTH_KM * Math.tan(fov / 2)) / (stageSize.h || innerHeight)); }
const occludedFn = () => { const c = globe.camera().position; const cl = c.length(); return (d) => { const w = globe.getCoords(d.lat, d.lng, d.alt ?? 0); return (w.x * c.x + w.y * c.y + w.z * c.z) / (Math.hypot(w.x, w.y, w.z) * cl) < R / cl - 0.002; }; };
function pickAt(x, y, { elevated = true } = {}) {
  const pin = markers.hitPin(x, y, occludedFn()); if (pin) return pin;
  const g = globe.toGlobeCoords(x, y);
  if (g) {
    const n = state.index.nearest(g.lat, g.lng, kmPerPx() * 9);
    if (n) { // v2.11: several things at the same spot (within 20 m) → list them all instead of silently picking one
      const same = state.index.within(n.item.lat, n.item.lng, 0.02).filter((it, i, a) => it.ref && a.findIndex((o) => o.ref?.d === it.ref.d) === i);
      return same.length > 1 ? { zoom: true, lat: n.item.lat, lng: n.item.lng, more: same.length - 1, group: same, tip: `<div class="tip"><b>${same.length} things here</b><span>Click to see them all</span></div>` } : n.item;
    }
    // merged line layers (cables, pipelines): the nearest segment within a few pixels
    let best = null;
    for (const set of state.lineSets ?? []) { const r = nearestLine(set.segs, g.lat, g.lng, best ? best.km : kmPerPx() * 6); if (r) best = { ...r, set }; }
    if (best) { const it = best.set.items[best.line]; return { lat: g.lat, lng: g.lng, ref: it.ref, tip: it.tip }; }
  }
  if (!elevated) return null;
  const cam = globe.camera().position; const cr = cam.length();
  let best = null; let bestD = 11;
  for (const p of state.elevated) {
    const s2 = globe.getScreenCoords(p.lat, p.lng, p.alt); if (!s2) continue;
    const d = Math.hypot(s2.x - x, s2.y - y); if (d < bestD) { best = p; bestD = d; }
  }
  if (best) return best;
  for (const l of LAYERS) {
    const pk = state.on.has(l.id) && l.pickScreen !== false && ['aircraft', 'satellites'].includes(l.id) && state.chan[l.id]?.pick; if (!pk) continue;
    for (const p of pk) {
      const s = globe.getScreenCoords(p.lat, p.lng, p.alt); if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y); if (d >= bestD) continue;
      const w = globe.getCoords(p.lat, p.lng, p.alt); // hidden behind the Earth?
      const dx = w.x - cam.x; const dy = w.y - cam.y; const dz = w.z - cam.z; const len = Math.hypot(dx, dy, dz);
      const tca = -(cam.x * dx + cam.y * dy + cam.z * dz) / len; const d2 = cr * cr - tca * tca;
      if (tca > 0 && d2 < R * R && tca - Math.sqrt(R * R - d2) < len - 0.01) continue;
      best = p; bestD = d;
    }
  }
  return best;
}
const planeTip = (a) => `<div class="tip"><b>${esc(a.call || a.id.toUpperCase())}${a.type ? ` · ${esc(a.type)}` : ''}</b><span>${a.ground ? 'on the ground' : `${Math.round(a.altFt).toLocaleString()} ft`}${a.kt ? ` · ${Math.round(a.kt * 1.852)} km/h` : ''} · click for the flight view</span></div>`;
// Hover tooltips from the same index (throttled).
let hoverAt = 0; const tipEl = document.createElement('div'); tipEl.className = 'hovertip'; tipEl.hidden = true; document.body.appendChild(tipEl);
$('#globe').addEventListener('pointermove', (e) => {
  const now = performance.now(); if (now - hoverAt < 70) return; hoverAt = now;
  const rect = $('#globe').getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  const h0 = pickAt(x, y, { elevated: false });
  const h = h0 && !h0.tip && h0.ref?.layer === 'aircraft' ? { ...h0, tip: planeTip(h0.ref.d) } : h0;
  if (e.buttons) { tipEl.hidden = true; return; } // no hover cards while dragging
  if (h?.tip) { const gn = !h.zoom && itemGlyph(h.ref); tipEl.innerHTML = (gn ? glyphSvg(gn, solid(h.color, layerById[h.ref.layer]?.swatch ?? '#eef3f6'), 22) : '') + h.tip; tipEl.hidden = false; tipEl.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - 300)}px, ${e.clientY + 14}px)`; $('#globe').style.cursor = 'pointer'; }
  else if (state.hover && state.pov.altitude > 0.25 && !state.mode) { tipEl.innerHTML = `<div class="tip"><b>${esc(state.hover.properties.name)}</b><span>click for the country card</span></div>`; tipEl.hidden = false; tipEl.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - 300)}px, ${e.clientY + 14}px)`; }
  else { tipEl.hidden = true; if (!state.hover) $('#globe').style.cursor = state.mode === 'measure' || state.mode === 'quiz' ? 'crosshair' : ''; }
});
$('#globe').addEventListener('pointerleave', () => { tipEl.hidden = true; });
let cursor = null;
function showReadout(lat, lng) { $('#ro-lat').textContent = astro.fmtLat(lat); $('#ro-lng').textContent = astro.fmtLng(lng); }
$('#globe').addEventListener('pointermove', (e) => {
  const c = globe.toGlobeCoords(e.offsetX, e.offsetY);
  cursor = c; if (c) showReadout(c.lat, c.lng); else showReadout(state.pov.lat, state.pov.lng);
  if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(() => { hoverQueued = false; setHover(cursor && state.on.has('borders') ? countryAt(cursor.lat, cursor.lng) : null); }); }
});
let hoverQueued = false;
$('#autodetail').addEventListener('change', (e) => { state.autoDetail = e.target.checked; if (!state.autoDetail && state.detailTiles) { state.detailTiles = null; applyBase(); } });

function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = h.match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)/);
  if (m) state.pov = { lat: +m[1], lng: +m[2], altitude: +m[3] }; else state.pov = { lat: 18, lng: Math.round(-new Date().getTimezoneOffset() / 4), altitude: 2.4 };
  const b = h.match(/[&]b=([a-z]+)/); if (b && (TILE[b[1]] || TEX[b[1]])) state.base = b[1];
  const shared = /[&]s=1/.test(h); // a link someone shared: always honour its layers
  const l = h.match(/[&]l=([\w,]*)/); state.bootLayers = l ? l[1].split(',') : []; if (l && (!NEW_VERSION || shared)) state.on = new Set(l[1].split(',').filter((x) => layerById[x] && !state.excluded?.has(x)));
  const sel = h.match(/[&]sel=([\w-]+)~([^&]+)/);
  if (sel && layerById[sel[1]]) { state.pendingSel = { layer: sel[1], id: sel[2] }; state.on.add(sel[1]); }
}
function writeHash() {
  const p = state.pov; const sel = currentSel();
  history.replaceState(null, '', `#@${p.lat.toFixed(3)},${p.lng.toFixed(3)},${p.altitude.toFixed(3)}&b=${state.base}&l=${[...state.on].join(',')}${sel ? `&sel=${sel.layer}~${encodeURIComponent(sel.id)}` : ''}`);
}
// ---- shareable links to one item: #...&sel=layer~id
const idOf = (d) => { const v = d?.id ?? d?.icao ?? d?.mmsi ?? d?.iata ?? d?.norad ?? d?.name ?? d?.title; return v == null ? null : String(v).slice(0, 80); };
function currentSel() {
  if (flightState.selected) return { layer: 'aircraft', id: flightState.selected };
  const r = state.selected; const id = r && idOf(r.d); return id ? { layer: r.layer, id } : null;
}
function shareLink() {
  writeHash();
  const url = `${location.origin}${location.pathname}${location.hash}${location.hash.includes('s=1') ? '' : '&s=1'}`;
  const done = () => toast('Link copied — it opens this view with the same layers and this item selected');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link', url)); else prompt('Copy this link', url);
}
/** After a layer loads, open the item a shared link pointed at. */
function trySharedSel(id) {
  const want = state.pendingSel; if (!want || want.layer !== id) return;
  const ch = state.chan[id]; if (!ch) return;
  const refs = [...(ch.points ?? []), ...(ch.pick ?? []), ...(ch.labels ?? [])].map((p) => p.ref).filter(Boolean);
  const ref = refs.find((r) => idOf(r.d) === decodeURIComponent(want.id)) ?? (id === 'aircraft' ? (state.data.aircraft?.ac ?? []).filter((a) => a.id === want.id).map((a) => ({ layer: 'aircraft', d: a }))[0] : null);
  if (!ref) return;
  state.pendingSel = null; select(ref);
  const d = ref.d; const lat = d.lat ?? d.geometry?.coordinates?.[1]; const lng = d.lng ?? d.geometry?.coordinates?.[0];
  if (Number.isFinite(lat) && Number.isFinite(lng) && !/@/.test(location.hash.split('&')[0])) fly(lat, lng, Math.min(state.pov.altitude, 1.2), false);
}

// ------------------------------------------------------------------ clock, spin, screenshot, keys
function tickClock() {
  const d = clock.date(); const s = astro.subsolarPoint(d); const live = clock.isLive();
  const off = (clock.now() - Date.now()) / 3600_000;
  $('#clock').innerHTML = `<b>${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}</b> UTC ${live ? '<i class="livepill">LIVE</i>' : `<i class="timepill">${off >= 0 ? '+' : '−'}${Math.abs(off) < 48 ? `${Math.abs(off).toFixed(1)} h` : `${Math.abs(off / 24).toFixed(1)} d`} · ${clock.paused ? 'paused' : speedLabel(clock.speed)}</i>`} · Sun over ${astro.fmtLat(s.lat).replace(/\.\d+/, '')}, ${astro.fmtLng(s.lng).replace(/\.\d+/, '')}`;
  const sl = $('#time-slider'); if (sl && document.activeElement !== sl) sl.value = String(Math.max(-168, Math.min(48, off)));
  $('#time-play') && ($('#time-play').textContent = clock.paused ? '▶' : '❚❚');
  $('#time-speed') && ($('#time-speed').textContent = speedLabel(clock.speed));
  document.body.classList.toggle('timetravel', !live);
}
setInterval(tickClock, 500); tickClock();
// ---- time machine controls
function stepSpeed(dir) { const i = SPEEDS.indexOf(clock.speed); const j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + dir)); clock.setSpeed(SPEEDS[j]); tickClock(); }
$('#clock').addEventListener('click', () => { $('#timebar').hidden = !$('#timebar').hidden; });
// When the time machine is open, lift the zoom buttons above it so the two never overlap.
{ const tb = $('#timebar'); const mc = document.querySelector('.stage .mapctl');
  // Keep the map controls above the time bar. Its height changes when it wraps: when the stage narrows (a side panel
  // opens) or its clock text changes length. Mutation observers run before the next paint, so measure right away.
  const lift = () => { if (mc) mc.style.bottom = tb.hidden ? '' : `${tb.offsetHeight + 22}px`; };
  const ro = new ResizeObserver(lift); ro.observe(tb); ro.observe(document.querySelector('.stage') ?? tb);
  new MutationObserver(lift).observe(tb, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });
  new MutationObserver(lift).observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
$('#time-slower').addEventListener('click', () => stepSpeed(-1));
$('#time-faster').addEventListener('click', () => stepSpeed(1));
$('#time-play').addEventListener('click', () => { clock.pause(); tickClock(); });
$('#time-live').addEventListener('click', () => { clock.live(); tickClock(); for (const id of ['sun', 'stations', 'satellites', 'quakes']) refreshLayer(id, { soft: true }); toast('Back to live time'); });
$('#time-back').addEventListener('click', () => { clock.shift(-3600_000 * 6); tickClock(); });
$('#time-fwd').addEventListener('click', () => { clock.shift(3600_000 * 6); tickClock(); });
$('#time-slider').addEventListener('input', (e) => { clock.set(Date.now() + Number(e.target.value) * 3600_000); tickClock(); });
$('#time-replay').addEventListener('click', () => replayQuakes());
function replayQuakes() {
  state.opts.quakes.feed = '2.5_week'; delete state.data.quakes; if (!state.on.has('quakes')) toggleLayer('quakes', true); else refreshLayer('quakes');
  clock.set(Date.now() - 7 * 86_400_000); clock.setSpeed(3600); $('#timebar').hidden = false; tickClock();
  globe.pointOfView({ lat: 5, lng: 150, altitude: 2.4 }, reduceMotion ? 0 : 1500);
  toast('Replaying the last 7 days of earthquakes at one hour per second — watch the Ring of Fire light up');
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === '[') stepSpeed(-1); if (e.key === ']') stepSpeed(1); if (e.key === '\\') { clock.live(); tickClock(); }
});
$('#spin').addEventListener('click', toggleSpin);
function toggleSpin() { controls.autoRotate = !controls.autoRotate; $('#spin').setAttribute('aria-pressed', String(controls.autoRotate)); }
$('#shot').addEventListener('click', () => {
  const a = document.createElement('a');
  gov?.renderNow(); // the drawing buffer isn't preserved (faster), so draw a fresh frame and read it straight away
  a.href = globe.renderer().domElement.toDataURL('image/png');
  a.download = `global-intelligence-atlas-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.png`; a.click();
});
$('#brand').addEventListener('click', (e) => { e.preventDefault(); globe.pointOfView({ lat: 18, lng: state.pov.lng, altitude: 2.4 }, reduceMotion ? 0 : 1500); });
$('#open-layers').addEventListener('click', () => shell?.open('layers'));
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === '/') { e.preventDefault(); q.focus(); }
  else if (e.key === 'r' || e.key === 'R') toggleSpin();
  else if (e.key === 'l' || e.key === 'L') shell?.open('layers');
  else if (e.key === '?') shell?.open('about');
  else if (e.key === 't' || e.key === 'T') setMode('tours');
  else if (e.key === 'q' || e.key === 'Q') setMode('quiz');
  else if (e.key === 'm' || e.key === 'M') setMode('measure');
  else if (e.key === 'c' || e.key === 'C') setMode('trace');
  else if (e.key === 'Escape') { if (state.tour) endTour(); else if (state.mode) setMode(null); else if (document.body.classList.contains('right-open')) closeNotes(); else return; e.stopImmediatePropagation(); }
});

// ------------------------------------------------------------------ sensor looks (idea from God's Eye View, MIT)
const LOOKS = ['normal', 'nvg', 'flir', 'crt', 'hud'];
function setLook(look) {
  state.look = LOOKS.includes(look) ? look : 'normal';
  document.body.dataset.look = state.look;
  hud?.show(state.look === 'hud');
  document.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === state.look)));
  viewLabel();
}
function viewLabel() {
  const el = document.getElementById('view-label'); if (!el) return;
  const b = document.querySelector(`button[data-base="${state.base}"]`)?.textContent ?? 'Map'; const l = document.querySelector(`button[data-look="${state.look}"]`)?.textContent ?? '';
  el.textContent = `Map: ${b}${l && l !== 'Normal' ? ` · ${l}` : ''}`;
}
document.getElementById('view-btn')?.addEventListener('click', () => shell?.open('map'));
document.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => setLook(b.dataset.look)));
document.addEventListener('keydown', (e) => { if (!e.target.matches('input, select, textarea') && /^[1-5]$/.test(e.key)) setLook(LOOKS[Number(e.key) - 1]); });
let hud = null; let tracer = null; let extras = null; let sky = null; let shell = null;
$('#gibs-date-input').max = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
$('#gibs-date-input').value = gibsDate();
$('#gibs-date-input').addEventListener('change', (e) => { state.gibsDate = e.target.value || null; applyBase(); });

// ------------------------------------------------------------------ plug-in layers (flights, cameras, places)
const api = { now: () => clock.date(), view: () => viewOf(state.pov), particleBudget: () => ({ High: 6000, Balanced: 3500, Fast: 1500 }[perf.q.label] ?? 4000), clearTool: () => clearTool(), setPins: (p) => setPins(p), compose: () => { compose.forceMarkers = true; compose(); }, closeNotes: () => closeNotes(), LAYERS, pulse: (a, b, c) => pulse(a, b, c), globe, state, esc, $, reduceMotion, openNotes, isOpen, refreshLayer, fly, followTo, setBase, wmo: (c) => WMO[c] ?? '—', select, toast: (m) => toast(m), toggleLayer: (id, on) => toggleLayer(id, on), openWall: () => openWall(api), placeName: (a, b) => placeName(a, b), isDesktop, repoUrl: () => sourceRepoUrl() };
const health = installHealth(api); const watch = installWatch(api);
{
  const add = (layer, afterId) => { const i = LAYERS.findIndex((l) => l.id === afterId); LAYERS.splice(i + 1, 0, layer); layerById[layer.id] = layer; };
  const added = [];
  for (const r of REGISTRY) { const l = r.make(api, { watch }); if (r.group) l.group = r.group; add(l, r.after); added.push(l); }
  for (const l of LAYERS) l.fresh = [].includes(l.id); // the “new” badge marks what changed in this version
  layerById.aircraft.on = true; layerById.cameras.on = true;
  for (const [i, g] of EXTRA_GROUPS) GROUPS.splice(i, 0, g);
  for (const l of added) {
    state.opts[l.id] = Object.fromEntries((l.options ?? []).map((o) => [o.id, structuredClone(o.value)]));
    if (l.on && (NEW_VERSION || !location.hash.includes('&l='))) state.on.add(l.id);
  }
  // hash may list layers that only exist now
  const hl = decodeURIComponent(location.hash).match(/[&]l=([\w,]*)/);
  if (hl && !NEW_VERSION) for (const id of hl[1].split(',')) if (layerById[id]) state.on.add(id);
  const q = new URLSearchParams(location.search);
  applyEdition(q.get('edition'));
  feedsReady.then(() => {
    if (!q.has('edition') && appConfig().edition) applyEdition(appConfig().edition);
    loadPlugins([...(appConfig().plugins ?? []), ...(q.get('plugins') ?? '').split(',')]);
  });
}

// ------------------------------------------------------------------ editions and plug-ins (registry.js)
// An edition leaves layers out: they leave LAYERS (so lists, presets, tours and drawing skip them) but stay in
// layerById, so code that names them keeps working. Plug-ins are layer modules in app/plugins/<name>.js.
function applyEdition(name) {
  const id = editionOf(name); const ed = EDITIONS[id];
  state.edition = id; state.excluded = new Set(ed.exclude);
  for (const x of ed.exclude) {
    if (state.on.has(x)) { if (document.querySelector('#layer-list .group')) toggleLayer(x, false, { quiet: true }); else state.on.delete(x); }
    const i = LAYERS.findIndex((l) => l.id === x); if (i >= 0) LAYERS.splice(i, 1);
  }
  document.body.dataset.edition = id;
  for (const sec of ed.hideSections) document.querySelectorAll(`.rail [data-section="${sec}"]`).forEach((b) => { b.hidden = true; });
  if (document.querySelector('#layer-list .group')) renderLayerPanel();
}
state.plugins = [];
async function loadPlugins(names) {
  for (const name of pluginNames(names.filter(Boolean))) {
    if (state.plugins.some((p) => p.name === name)) continue;
    try {
      const mod = await import(`../plugins/${name}.js`);
      for (const [k, v] of Object.entries(mod.sources ?? {})) if (!SOURCES[k]) SOURCES[k] = { ...v, plugin: name };
      const l = typeof mod.default === 'function' ? mod.default(api) : mod.default;
      const problems = validateLayer(l, { groups: GROUPS, taken: new Set(Object.keys(layerById)) });
      if (problems.length) { state.plugins.push({ name, ok: false, problems }); console.warn(`[plugins] ${name}:`, problems.join('; ')); toast(`Plug-in “${name}” was not added: ${problems[0]}`); continue; }
      if (state.excluded?.has(l.id)) continue;
      l.plugin = name; l.fresh = true;
      const after = [...LAYERS].reverse().find((x) => x.group === l.group)?.id;
      const i = after ? LAYERS.findIndex((x) => x.id === after) : LAYERS.length - 1; LAYERS.splice(i + 1, 0, l); layerById[l.id] = l;
      state.opts[l.id] = Object.fromEntries((l.options ?? []).map((o) => [o.id, structuredClone(o.value)]));
      state.plugins.push({ name, ok: true, id: l.id });
      if (l.on || state.bootLayers?.includes(l.id)) toggleLayer(l.id, true, { quiet: true });
    } catch (e) { state.plugins.push({ name, ok: false, problems: [e.message] }); console.warn(`[plugins] ${name}:`, e); }
  }
  renderLayerPanel();
}
function layerManifest() {
  return { app: 'Global Intelligence Atlas', version: VERSION, edition: state.edition, generatedAt: new Date().toISOString(),
    editions: Object.fromEntries(Object.entries(EDITIONS).map(([k, e]) => [k, { label: e.label, about: e.about, exclude: e.exclude }])),
    layers: Object.values(layerById).map((l) => ({ ...manifest(l, { origin: l.plugin ? `plugin:${l.plugin}` : 'core' }), inThisEdition: !state.excluded?.has(l.id) })),
    plugins: state.plugins };
}
function manifestPanel() {
  const m = layerManifest(); const blob = URL.createObjectURL(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }));
  openNotes('Layer manifest', `<p>Each layer describes itself: where its data comes from, under which terms, how often it refreshes and what it can do. This is the <b>${esc(EDITIONS[m.edition].label)}</b> edition (${esc(EDITIONS[m.edition].about)}).</p>
    <p><a class="btn ghost" href="${blob}" download="global-intelligence-atlas-layers-${VERSION}.json">Download the manifest (JSON)</a></p>
    <div class="table-scroll"><table class="manifest"><thead><tr><th>Layer</th><th>Sources and terms</th><th>Refresh</th><th>Can</th></tr></thead><tbody>
    ${m.layers.filter((l) => l.inThisEdition).map((l) => `<tr data-mf="${esc(l.id)}"><td><b style="color:${esc(l.swatch)}">●</b> ${esc(l.label)}<small>${esc(l.id)} · ${esc(l.group)}${l.origin !== 'core' ? ` · ${esc(l.origin)}` : ''}</small></td><td>${l.sources.map((s) => `${esc(s.name ?? s.id)}<small>${esc(s.license ?? '')}</small>`).join('')}</td><td>${l.refreshSeconds ? `${l.refreshSeconds >= 3600 ? `${Math.round(l.refreshSeconds / 3600)} h` : l.refreshSeconds >= 60 ? `${Math.round(l.refreshSeconds / 60)} min` : `${l.refreshSeconds} s`}` : 'once'}</td><td>${esc(l.capabilities.join(', '))}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">Editions: ${Object.entries(EDITIONS).map(([k, e]) => `<a href="?edition=${k}${location.hash}">${esc(e.label)}</a>`).join(' · ')}. Plug-ins: ${m.plugins.length ? m.plugins.map((p) => `${esc(p.name)} (${p.ok ? 'added' : esc(p.problems[0])})`).join(', ') : 'none'}.</p>`, 'manifest');
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-manifest]')) manifestPanel(); });

// ------------------------------------------------------------------ datasets (opendata.js)
// Most infrastructure layers can draw independently sourced open data instead of World Monitor's curated lists.
function datasetsPanel() {
  const mode = datasetMode();
  const ids = [...Object.keys(OPEN_DATA), ...WM_ONLY].filter((id) => layerById[id]);
  const now = (id) => (WM_ONLY.includes(id) || origins[id] === 'worldmonitor' ? 'World Monitor' : origins[id] === 'open' ? 'Open data' : 'not loaded yet');
  openNotes('Datasets', `<p>The infrastructure layers began with the curated lists from <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">World Monitor</a> by Elie Habib. Most of them can now draw independently sourced open data instead, refreshed monthly. World Monitor stays credited whichever you choose.</p>
    <div class="chemctl"><select id="ds-mode" aria-label="Datasets">${Object.entries(DATASET_MODES).map(([k, l]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><small>Site owners set the default with "datasets" in config.json; a link can carry ?datasets=open.</small></div>
    <div class="table-scroll"><table class="manifest"><thead><tr><th>Layer</th><th>Open data and terms</th><th>Drawing now</th></tr></thead><tbody>
    ${ids.map((id) => { const o = OPEN_DATA[id]; return `<tr data-ds="${esc(id)}"><td>${esc(layerById[id].label)}<small>${esc(id)}</small></td><td>${o ? `${esc(o.name)}<small>${esc(o.terms)}</small>` : 'None yet: World Monitor’s list only'}</td><td>${now(id)}</td></tr>`; }).join('')}
    </tbody></table></div>`, 'datasets');
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-datasets]')) datasetsPanel(); });
document.addEventListener('change', (e) => {
  if (e.target.id !== 'ds-mode') return;
  setDatasetMode(e.target.value); index = null;
  for (const id of Object.keys(OPEN_DATA)) { delete state.data[id]; delete origins[id]; if (state.on.has(id)) refreshLayer(id); }
  setTimeout(() => { if (state.notesKey === 'datasets') datasetsPanel(); }, 1500);
});

// ------------------------------------------------------------------ boot
function intro() {
  if (intro.done) return; intro.done = true;
  const target = { ...state.pov };
  if (reduceMotion || location.hash.includes('@')) return;
  globe.pointOfView({ ...target, altitude: 7 }, 0);
  requestAnimationFrame(() => globe.pointOfView(target, 2400));
}
globe.pointOfView(state.pov, 0);
setBase(state.base);
renderLayerPanel();
for (const id of state.on) refreshLayer(id);
$('#apply-now').addEventListener('click', applyPending);
$('#notes-back')?.addEventListener('click', detailsBack);
$('#layer-filter')?.addEventListener('input', filterLayers);
$('#apply-undo').addEventListener('click', () => { state.pending.clear(); renderLayerPanel(); });
const live = installLive(api);
tracer = installTrace(api);
/** A human name for a spot: the nearest big city if there is one close by, else the country or the sea. */
function placeName(lat, lng) {
  let best = null; let bestKm = 120;
  for (const c of state.data.cities ?? []) { if (Math.abs(c.lat - lat) > 1.2) continue; const km = astro.haversineKm(lat, lng, c.lat, c.lng); if (km < bestKm) { bestKm = km; best = c; } }
  const country = countryAt(lat, lng)?.properties?.name;
  if (best) return `${bestKm < 15 ? '' : 'near '}${best.name}${country ? `, ${country}` : ''}`;
  return country ?? waterName(lat, lng);
}
sky = installSky({ ...api, placeName });
extras = installExtras({
  ...api, LAYERS, PRESETS, TOURS, toggleLayer, renderLayerPanel, showLearn, preset, countryAt, geocode, fly,
  startTour: (id) => { if (state.mode !== 'tours') setMode('tours'); startTour(id); },
  start: (k) => { const b = document.createElement('button'); b.dataset.start = k; b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); },
  trace: () => { setMode('trace'); tracer.trace(state.pov.lat, state.pov.lng); },
  whatsNew: () => whatsNew(), layer: (id) => layerById[id], solarElevation: astro.solarElevation, sky: (lat, lng) => sky.open(lat, lng),
});
$('#pal-open').addEventListener('click', () => extras.open());
// Overview tiles at the top of the Live section: the state of the planet at a glance, each one clickable.
api.liveOverview = () => {
  const now = clock.date().getTime(); const t = [];
  const tile = (attrs, glyph, color, label, value, sub) => `<button class="stat" ${attrs}>${glyphSvg(glyph, color, 20)}<span>${esc(label)}</span><b>${value}</b><small>${sub}</small></button>`;
  const qs = (state.data.quakes ?? []).filter((f) => now - f.properties.time < 86_400_000);
  if (state.data.quakes) { const top = qs.reduce((b, f) => (!b || f.properties.mag > b.properties.mag ? f : b), null); t.push(tile(top ? `data-fly="${top.geometry.coordinates[1]},${top.geometry.coordinates[0]},1.2"` : 'data-enable="quakes"', 'quake', '#f79d5c', 'Earthquakes, 24 h', qs.length.toLocaleString(), top ? `strongest M${top.properties.mag.toFixed(1)}` : 'none recorded')); }
  else t.push(tile('data-enable="quakes"', 'quake', '#f79d5c', 'Earthquakes', '—', 'turn on'));
  const ac = state.data.aircraft; t.push(tile(ac ? 'data-board="1"' : 'data-enable="aircraft"', 'plane', '#8ecbff', 'Aircraft tracked', ac ? ac.ac.length.toLocaleString() : '—', ac ? (ac.snapshotAge != null ? `snapshot ${Math.round(ac.snapshotAge)} min old` : 'live') : 'turn on'));
  const iss = state.data.stations ? satPositions(state.data.stations, clock.date()).find((p) => /ISS \(ZARYA\)|^ISS$/.test(p.name)) : null;
  t.push(tile(iss ? 'data-ride="on"' : 'data-enable="stations"', 'sat', '#ffd37a', 'ISS is over', iss ? esc(placeName(iss.lat, iss.lng).replace(/^the /, '')) : '—', iss ? `${Math.round(iss.altKm)} km up · ride along` : 'turn on space stations'));
  const next = (state.data.launches ?? []).filter((l) => l.net > now - 3600_000).sort((a, b) => a.net - b.net)[0];
  t.push(tile(next ? `data-fly="${next.lat},${next.lng},1.4"` : 'data-enable="launches"', 'rocket', '#ff9e5e', 'Next launch', next ? countdown(next.net - now) : '—', next ? esc(next.name.split('|').pop().trim()) : 'turn on launches'));
  const al = state.data.alerts; t.push(tile(al ? 'data-enable="alerts"' : 'data-enable="alerts"', 'alert', '#ff3b30', 'Disaster alerts', al ? `${al.filter((a) => a.level === 'Red').length} red` : '—', al ? `${al.filter((a) => a.level === 'Orange').length} orange` : 'turn on GDACS'));
  const m = astro.moonState(clock.date()); t.push(tile('data-start="moon"', 'moon', '#e8eef3', 'The Moon', `${Math.round(m.illum * 100)} % lit`, esc(m.name)));
  const el = astro.solarElevation(state.pov.lat, state.pov.lng, clock.date());
  t.push(tile('data-tool="sky"', 'sun', '#ffd37a', 'Sun at the view centre', `${Math.round(el)}°`, el > 0 ? 'daytime · see the sky' : el > -6 ? 'twilight · see the sky' : 'night · see the sky'));
  const nw = state.data.news; t.push(tile(nw ? 'data-enable="news"' : 'data-enable="news"', 'news', '#ff9ec7', 'Places in the news', nw ? (nw.items?.length ?? 0).toLocaleString() : '—', nw ? 'last 24 hours' : 'turn on news'));
  return `<h4>At a glance</h4><div class="stats-grid">${t.join('')}</div>`;
};
shell = installShell({ $, esc, TOURS, closeNotes, closeDetails: () => { state.leftAuto = false; closeNotes(); }, openLive: () => live.openFeed('all'), openSaved: () => extras.viewsPanel(), openAbout: () => aboutPanel(), sky: () => sky.open(state.pov.lat, state.pov.lng), palette: () => extras.open() });
installIntel({ ...api, shell });
$('#flights-chip').addEventListener('click', () => extras.flightsBoard());
// Live countdowns in any open card
setInterval(() => document.querySelectorAll('.countdown[data-net]').forEach((el) => { el.textContent = countdown(Number(el.dataset.net) - Date.now()); }), 1000);
perf = installPerformance({ globe, $, toast: (m) => toast(m), onChange: () => { compose.forceMarkers = true; scheduleCompose(); } });
// Planes glide between data refreshes (twice a second; once a second on the Fast setting).
let glideAt = 0;
setInterval(() => {
  if (!state.on.has('aircraft') || document.hidden || !state.data.aircraft) return;
  const now = performance.now(); if (perf.q.label === 'Fast' && now - glideAt < 950) return; glideAt = now;
  const sel = glidePlanes(globe, state.pov.altitude);
  if (sel && flightState.follow) followTo(sel.lat, sel.lng);
}, 500);
// Keep side panels clear of the bottom bar, whose height changes when it wraps on narrower windows.
gov = installIdleGovernor(globe, {
  busy: () => controls.autoRotate || !!state.tour || flightState.follow || !!state.ride,
  animating: () => compose.animating || state.on.has('wind') || state.on.has('aircraft') || !clock.isLive(),
});
hud = installHud(api);
if (state.look === 'hud') hud.show(true);
if (NEW_VERSION) { if (!state.pendingSel) setTimeout(whatsNew, 600); try { localStorage.setItem('global-intelligence-atlas-version', VERSION); } catch { /* private mode */ } }
else if (!location.hash.includes('@') && !isMobile) welcome();
function whatsNew() {
  const g = (n, c) => glyphSvg(n, c, 26);
  openNotes(`What’s new in v${VERSION}`, `<h3>Global Intelligence Atlas (GIA) gets its own repository</h3>
    <div class="newlist">
      <span>${g('dossier', '#e3b55b')}<b>One app, web and desktop:</b> the website and the desktop app run exactly the same code, so every layer and tool is in both. The desktop app adds native fetching, the flights board feed, the ship collector and system notifications.</span>
      <span>${g('anchor', '#7ed6c4')}<b>Faster in the browser:</b> the globe engine and the first modules load in parallel, and on repeat visits the engine, Earth textures and images come straight from the offline cache while it refreshes in the background.</span>
    </div>
    <h4>From v2.9 — open data in place of World Monitor’s lists</h4>
    <div class="newlist">
      <span>${g('anchor', '#9fc3e6')}<b>Open data for infrastructure:</b> seven layers can now draw independently sourced open data, refreshed monthly: every large, medium and small port in the NGA World Port Index (with channel depths and the longest ship each takes), nuclear power plants, spaceports, stock exchanges, central banks and critical-mineral mines from Wikidata, every submarine cable on TeleGeography’s map, and the EIA’s oil chokepoints.</span>
      <span>${g('dossier', '#7ed6c4')}<b>About → Datasets:</b> choose open data where it is available (the default), open data only, or World Monitor’s curated lists as before, and see which source each layer is drawing. World Monitor stays credited either way.</span>
    </div>
    <h4>From v2.8 — pesticides measured in rivers, lakes and wells</h4>
    <div class="newlist">
      <span>${g('water', '#4fb3d9')}<b>Pesticides in rivers and wells:</b> sample results from the Water Quality Portal (U.S. Geological Survey, EPA, states and tribes) for 15 pesticides, including atrazine, glyphosate, 2,4-D, chlorpyrifos and imidacloprid, over the last three years. Pick one pesticide, wells, rivers or lakes, and detections only. Red sites were above an EPA drinking-water limit; click one for every chemical found, its highest value, how often it was found and a link to the raw results.</span>
    </div>
    <h4>From v2.7 — pollution burden by neighbourhood and environmental violations</h4>
    <div class="newlist">
      <span>${g('alert', '#ff4e6a')}<b>Pollution burden, California tracts:</b> CalEnviroScreen 4.0 for every census tract. Choose the overall score or one of its indicators (pesticide use nearby, fine particles, diesel, drinking water, traffic, asthma, poverty and more) and see each neighbourhood’s percentile.</span>
      <span>${g('badge', '#ff4e6a')}<b>Environmental violations:</b> U.S. facilities the EPA or a state found in violation, took action against or fined, from ECHO. Click one for its inspections, penalties and the EPA’s full report.</span>
    </div>
    <h4>From v2.6 — chemicals and environment, down to the square mile</h4>
    <div class="newlist">
      <span>${g('spray', '#ff8a4c')}<b>Pesticide use, California:</b> every farm pesticide application reported to the state, added up for each square mile. Pick one chemical, such as 1,3-dichloropropene or glyphosate, and tick “Aerial applications only” to see crop dusting. Click a square for its pounds, the main chemicals, the crop and the survey section.</span>
      <span>${g('spray', '#e3c45b')}<b>Pesticide estimates, U.S. counties:</b> the USGS estimate of each pesticide used on farms in every county of the lower 48 states.</span>
      <span>${g('factory', '#c8a2ff')}<b>Toxic chemical releases:</b> every facility in the EPA Toxics Release Inventory, with its top chemicals and how much were carcinogens.</span>
    </div>
    <h4>From v2.5 — layers that describe themselves, editions and plug-ins</h4>
    <div class="newlist">
      <span>${g('dossier', '#7ed6c4')}<b>Layer manifest:</b> About → Layer manifest lists every layer with its data sources, their licences, how often it refreshes and what it can do. Download it as JSON.</span>
      <span>${g('city', '#e3b55b')}<b>Editions:</b> one codebase, several atlases. Add <code>?edition=classroom</code> for schools (no surveillance cameras, plate readers, crime, conflict or Intel) or <code>?edition=lite</code> for slow devices; site owners set it in <code>config.json</code>.</span>
      <span>${g('sun', '#ffd166')}<b>Plug-ins:</b> add a layer without touching the app. Try <code>?plugins=daylength</code> for hours of daylight today at every latitude; the guide is in <code>app/plugins/README.md</code>.</span>
    </div>
    <h4>From v2.4 — replay the last two weeks</h4>
    <div class="newlist">
      <span>${g('clock', '#c8a2ff')}<b>Replay the last days:</b> a new layer under Live. Every aircraft, every ship and the disaster alerts in force, saved once an hour for 14 days, with the earthquakes of the day before each hour. Drag the slider under the layer or press Play; day and night follow the replayed hour, and turning the layer off returns to now.</span>
      <span>${g('dossier', '#e3b55b')}<b>Reference projects:</b> About and Credits now list 20 open-source projects Atlas learns from for visuals, presentation, frameworks and modelling theory, such as CesiumJS, deck.gl, kepler.gl, D3, H3, FilterPy and MovingPandas.</span>
    </div>
    <h4>From v2.3 — real terrain and buildings at street level</h4>
    <div class="newlist">
      <span>${g('plane', '#8ecbff')}<b>Street level:</b> open a flight and choose Street level. You stand in the real landscape below, with hills from Terrain Tiles and buildings from OpenStreetMap, where the plane is 30° above the horizon. A gold ring marks where it is. Its height is measured from the real ground there, not from sea level.</span>
      <span>${g('camera', '#ffcf6e')}<b>3D surroundings:</b> every camera card has a 3D surroundings button: the hills and buildings around the camera, with a pin where it stands. Drag to turn, scroll to zoom.</span>
    </div>
    <h4>From v2.2 — ships worldwide, webcams everywhere and an Intel section</h4>
    <div class="newlist">
      <span>${g('ship', '#4aa3ff')}<b>Ships worldwide:</b> Live ships now covers the world from AISStream, every vessel heard in the last 30 minutes. On the desktop app, add your own free AISStream key under the layer for ships in view as they move. Without a key the layer still shows the Baltic.</span>
      <span>${g('camera', '#ffcf6e')}<b>Public webcams worldwide:</b> about 170,000 webcams their owners publish on purpose, on every continent: roads and borders, cities, beaches, ski resorts, volcanoes and weather stations.</span>
      <span>${g('eye', '#e3b55b')}<b>Intel:</b> a new section on the left with declassified government documents, a redaction inspector that shows whether a PDF’s black boxes really hide the words, photo location, a shadow clock and a web archive lookup.</span>
      <span>${g('server', '#7ed6c4')}<b>Intelligence toolkit:</b> Tools → look up a domain, an internet address, a software flaw, a sanctions listing or a crypto wallet, adapted from Osiris.</span>
    </div>
    <h4>From v2.1 — fires, radar, alerts and a health check</h4>
    <div class="newlist">
      <span>${g('flame', '#ff7a3c')}<b>Fire hotspots:</b> every active fire NASA’s VIIRS satellites detected in the last 24 hours, coloured by how intensely it burns. Zoom in and click one for its heat output and when it was seen.</span>
      <span>${g('storm', '#5aa9ff')}<b>Weather radar:</b> rain and snow from RainViewer’s global radar mosaic for the past two hours, with a time slider and a Play button under the layer.</span>
      <span>${g('alert', '#e3b55b')}<b>Watch areas:</b> Tools → Watch areas. Draw a circle, pick what to watch for (earthquakes above a magnitude, disaster alerts, emergency squawks, fires, a surge of news) and get a notification when it happens. Stored only on this device.</span>
      <span>${g('server', '#7ed6c4')}<b>Data health:</b> Tools → Data health shows every source’s last update, count and error in one place. A weekly check opens a GitHub issue when a source breaks.</span>
      <span>${g('plane', '#8ecbff')}<b>Real aircraft types:</b> a weekly table from the OpenSky Network aircraft database fills in each plane’s type, so its shape, the flights board and search by type are right far more often.</span>
      <span>${g('camera', '#7ed6c4')}<b>Cameras fixed:</b> Québec, New Zealand and British Columbia cameras now load their pictures; names in Iceland and New Zealand are right.</span>
    </div>
    <h4>From v2.0 — now its own project</h4>
    <p>Terra Atlas has a new name and a home of its own. World Monitor, where the project began, is credited in About and in the references.</p>
    <h4>From v1.12 — 3D planes, sharper maps and news that always loads</h4>
    <div class="newlist">
      <span>${g('plane', '#8ecbff')}<b>Planes by type:</b> wide-bodies, narrow-bodies, regional jets, turboprops, business jets, light aircraft, helicopters and fast jets each have their own shape, and become 3D models when you zoom in. Very close, they are drawn at their real size.</span>
      <span>${g('eye', '#ffd37a')}<b>What it looks like from the ground:</b> open a flight for a 3D close-up next to a person for scale, then see it from below at its real height, next to the Moon at its true size, or through binoculars.</span>
      <span>${g('news', '#ff9ec7')}<b>News always loads:</b> when the GDELT news service blocks browsers or is down, the map reads a copy the live-data job saves every 20 minutes.</span>
      <span>${g('pin', '#7ed6c4')}<b>Easier zooming:</b> the mouse wheel zooms towards the cursor and covers orbit to street level in about 30 notches; every card for a place on the ground has “Zoom to street level”; double-click dives in faster.</span>
      <span>${g('sun', '#ffd37a')}<b>No more grey haze:</b> sharp satellite imagery now switches in from about 4,800 km up instead of 760 km, pulsing rings shrink as you zoom instead of washing over the map, and night shading follows you down to the ground.</span>
      <span>${g('camera', '#7ed6c4')}<b>More cameras:</b> new sources in Germany, Spain, Iceland, Taiwan (live motion pictures), New Zealand, New South Wales, British Columbia and Québec, collected daily.</span>
    </div>
    <h4>From v1.11 — a cleaner layout where nothing overlaps</h4>
    <div class="newlist">
      <span>${g('pin', '#e3b55b')}<b>Sections on the left</b> (Layers, Live, Explore, Tools, Saved, About) open one at a time; details of anything you click open on the right. The globe takes the space in between, so panels never cover each other.</span>
      <span>${g('eye', '#7ed6c4')}<b>Layers:</b> filter by typing, see every active layer in “On the map” (click × to hide one), and fold groups away. Options appear only for layers that are on.</span>
      <span>${g('news', '#ff9ec7')}<b>Live:</b> an at-a-glance board: earthquakes today, aircraft tracked, where the ISS is, the next launch, disaster alerts, the Moon and the Sun.</span>
      <span>${g('ix', '#eef3f6')}<b>Tools:</b> measure, trace, sky, area scan, flights board, ride the ISS, time machine, share and save, all in one place. The Details panel has a Back button, and Esc closes panels.</span>
      <span>${g('bolt', '#ffe066')}<b>Faster:</b> undersea cables and pipelines draw in one batch instead of 90, earthquake pulses animate on the graphics card, and the drawing resolution adapts to your screen size.</span>
    </div>
    <h4>From v1.10 — smooth and steady, plus the sky above you</h4>
    <div class="newlist">
      <span>${g('sat', '#b7a3ff')}<b>Sky above here:</b> click any spot on the ground, then “Sky above here” for a live chart of the Sun, Moon, satellites and planes overhead.</span>
      <span>${g('plane', '#8ecbff')}Planes now glide on the graphics card, perfectly smooth at any frame rate. Hover a plane for its callsign, height and speed.</span>
      <span>${g('alert', '#f07a63')}<b>Fixed:</b> the screen could flash blank when the globe was still; very large camera and plate-reader sets could stop the map updating; hovering countries caused stutter.</span>
      <span>${g('city', '#eef3f6')}Place names no longer pile on top of each other, markers stop reshuffling every time you pause, and labels fade out at the planet’s edge.</span>
    </div>
    <p class="muted">The flight snapshot now refreshes every 4 minutes instead of waiting for GitHub’s unreliable 10-minute schedule.</p>
    <h4>From v1.9 — planes that glide, airport boards, flight search and shareable links</h4>
    <div class="newlist">
      <span>${g('plane', '#8ecbff')}Planes now glide smoothly along their heading between updates instead of jumping every few seconds.</span>
      <span>${g('pin', '#b7c8d6')}Click an airport for its <b>arrivals, departures and planes on the ground</b> right now, with landing estimates.</span>
      <span>${g('eye', '#e3b55b')}Press <kbd>Ctrl</kbd>+<kbd>K</kbd> and type a callsign (BAW12), an airline prefix (UAL for every United flight), a registration or an aircraft type (A388).</span>
      <span>${g('ix', '#7ed6c4')}<b>Copy a link</b> from any card: it opens the same view, layers and selected item for whoever you send it to.</span>
    </div>
    <p class="muted">Flights on the website come from a snapshot GitHub Actions takes every 10 minutes with an OpenSky API login, about 9,600 aircraft worldwide.</p>
    <h4>From v1.8 — every marker is now the shape of what it is</h4>
    <p class="sub">No more identical bubbles: a wildfire is a flame, an earthquake a seismogram, a ship a ship. Bigger quakes and bigger power stations get bigger symbols.</p>
    <div class="newlist">
      <span>${g('flame', '#ff8a4c')}Wildfire</span><span>${g('quake', '#f79d5c')}Earthquake</span><span>${g('storm', '#9fc3e6')}Tropical storm</span><span>${g('volcano', '#ff6f61')}Volcano</span>
      <span>${g('ship', '#4aa3ff')}Cargo ship</span><span>${g('tanker', '#4aa3ff')}Tanker</span><span>${g('ferry', '#4aa3ff')}Ferry</span><span>${g('sailboat', '#4aa3ff')}Sailing boat</span>
      <span>${g('nuclear', '#9ff0c9')}Nuclear plant</span><span>${g('wind', '#d9f2ff')}Wind farm</span><span>${g('solar', '#ffe066')}Solar farm</span><span>${g('hydro', '#4aa3ff')}Hydro dam</span>
      <span>${g('camera', '#7ed6c4')}Traffic camera</span><span>${g('alpr', '#f07a63')}Plate reader</span><span>${g('car', '#ffd37a')}Vehicle crime</span><span>${g('rocket', '#ff9e5e')}Rocket launch</span>
    </div>
    <p class="muted">Each layer now has a key of its symbols: click one (in the layer list or in Learn) to hide or show that kind, for example only wildfires, or no thefts. Click a “+N” badge to zoom into a cluster. Symbols also appear in hover cards, field notes and the Live feed.</p>
    <h4>From v1.7 — live flights everywhere, a smoother globe, and the Moon</h4>
    <p class="sub">Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or the ⌘K button at the top) to find anything, then try these:</p>
    <div class="starts">
      <button class="tour-card" data-start="flights"><b>✈ Live flights that actually load</b><span>Browsers block flight trackers, so the website now reads a worldwide snapshot refreshed every 10 minutes and moves each plane forward along its heading. The desktop app reads them live.</span></button>
      <button class="tour-card" data-start="board"><b>▦ Flights board</b><span>How many planes are up, height bands, the fastest (jet-stream riders), the highest, and any emergency squawks. Click one to open its seatback view.</span></button>
      <button class="tour-card" data-start="ride"><b>🛰 Ride along with the ISS</b><span>The camera follows the space station at 27,600 km/h, telling you which country or ocean it is over and whether it is day or night below.</span></button>
      <button class="tour-card" data-start="moon"><b>🌔 Moon and tides</b><span>Where the Moon is overhead right now, its phase, the next full moon, and the two tidal bulges.</span></button>
      <button class="tour-card" data-start="palette"><b>⌘ Command palette and saved views</b><span>Every layer, preset, tour, base map, 2,500 cities and your own bookmarked views, one keystroke away.</span></button>
    </div>
    <p class="muted">Faster too: the globe stops redrawing when nothing moves (dropping to 5 frames a second while still, full speed the moment you touch it), shaders no longer block start-up, and every layer now shows in plain words where its data came from.</p>
    <h4>From v1.6 — time and connections</h4>
    <p class="sub">Click the clock at the bottom for the time machine, press C to trace any place, and look for these:</p>
    <div class="starts">
      <button class="tour-card" data-start="pur"><b>☁ Crop dusting in California</b><span>Pesticides sprayed from the air, square mile by square mile, from the state’s own use reports.</span></button>
      <button class="tour-card" data-start="history"><b>⏪ Replay the last two weeks</b><span>Every aircraft, ship and disaster alert, hour by hour, with a slider and a Play button. Day and night follow the replayed hour.</span></button>
      <button class="tour-card" data-start="replay"><b>⏱ Replay a week of earthquakes</b><span>The time machine runs the planet at one hour per second — the Sun, satellites and the ISS move with it.</span></button>
      <button class="tour-card" data-start="trace"><b>⌁ Trace how a place is connected</b><span>Internet exchanges, undersea cables to every coast they reach, power, airport, cameras, and beams to the satellites overhead.</span></button>
      <button class="tour-card" data-start="launches"><b>🚀 Rocket launches</b><span>The next 25 launches worldwide with countdowns and live webcasts.</span></button>
      <button class="tour-card" data-start="wind"><b>≋ Wind and temperature now</b><span>Thousands of streaks drifting with the real wind over a temperature map.</span></button>
      <button class="tour-card" data-start="alerts"><b>⚠ Disaster alerts</b><span>United Nations–EU GDACS orange and red alerts.</span></button>
    </div>
    <p class="muted">Pins now sit on the ground and stay clickable all the way down to street level, and the one you clicked stays pinned.</p>
    <h4>From v1.5 — faster, smoother, more detail</h4>
    <p class="sub">v1.5 rebuilds how markers are drawn: one draw call for every column, pins and names as cached sprites, map-style decluttering with “+N” cluster badges, label cards on the nearest pins, hover cards everywhere, work split into small slices so the page never freezes, and an automatic quality governor (bottom right, with a live frame-rate meter).</p>
    <h4>From v1.4 — the connected planet</h4>
    <p class="sub">v1.4 added the Overwatch HUD, NASA satellite overlays, power plants, internet buildings, live radio receivers and ships.</p>
    <div class="starts">
      <button class="tour-card" data-start="hud"><b>◎ Overwatch HUD + Area scan</b><span>A heads-up display over the globe; press S to scan everything around the crosshair — flights, satellites overhead, cameras, networks, power, weather.</span></button>
      <button class="tour-card" data-start="rain"><b>☂ Rain falling right now</b><span>NASA’s 30-minute global precipitation wrapped around the globe. Also clouds, fires, night lights, ocean temperature, smoke, snow.</span></button>
      <button class="tour-card" data-start="connected"><b>⌁ The connected planet</b><span>Cables, internet exchanges, 10,700 power plants, flights and ships in one view.</span></button>
      <button class="tour-card" data-start="radio"><b>📻 Listen live</b><span>Public shortwave receivers around the world — click one and tune the radio from that spot.</span></button>
      <button class="tour-card" data-start="ships"><b>⚓ Live ships</b><span>Ships broadcasting AIS (Automatic Identification System), worldwide when a key is set, otherwise the Baltic.</span></button>
    </div>
    <h4>From v1.3</h4>
    <p class="sub">Look for the <em class="new">new</em> tags in Layers, the red Live ticker at the top, and these one-click starts:</p>
    <div class="starts">
      <button class="tour-card" data-start="flights"><b>✈ Every flight in the sky</b><span>Live plane pointers on their real headings. Click one for the seatback flight view.</span></button>
      <button class="tour-card" data-start="cams"><b>📹 Live cameras, Los Angeles</b><span>Thousands of traffic cameras worldwide, with a camera wall.</span></button>
      <button class="tour-card" data-start="news"><b>✦ News pins</b><span>Places in the news in the last 24 hours, with headlines.</span></button>
      <button class="tour-card" data-start="crime"><b>▣ Crime map, Chicago</b><span>Official incident reports as 3D hexagon columns and pins.</span></button>
      <button class="tour-card" data-start="live"><b>● Live tour</b><span>Sit back while the globe flies from event to event.</span></button>
    </div>
    <h4>Also new</h4><p>An <b>Apply</b> button for layer changes, quick presets, live counts next to every layer, flight emergency alerts, licence-plate readers, city names, airports, and navigation that slows down as you zoom in.</p>`, 'whatsnew');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-start]'); if (!b) return;
  const k = b.dataset.start;
  const setLayers = (ids) => { state.pending.clear(); for (const l of LAYERS) if (ids.includes(l.id) !== state.on.has(l.id)) state.pending.set(l.id, ids.includes(l.id)); applyPending(); };
  if (k === 'replay') replayQuakes();
  if (k === 'trace') { setMode('trace'); tracer.trace(33.74, -118.29); }
  if (k === 'launches') { setLayers(['sun', 'borders', 'cities', 'launches', 'stations']); globe.pointOfView({ lat: 28, lng: -60, altitude: 2.2 }, 1800); showLearn('launches'); }
  if (k === 'wind') { setLayers(['sun', 'borders', 'cities', 'wind']); globe.pointOfView({ lat: 20, lng: -40, altitude: 2.3 }, 1800); showLearn('wind'); }
  if (k === 'alerts') { setLayers(['sun', 'borders', 'cities', 'alerts', 'quakes']); globe.pointOfView({ lat: 15, lng: 100, altitude: 2.3 }, 1800); showLearn('alerts'); }
  if (k === 'hud') { setLook('hud'); globe.pointOfView({ lat: 34.05, lng: -118.25, altitude: 0.12 }, 1800); setTimeout(() => hud.scan(), 2400); }
  if (k === 'rain') { state.opts.overlay.kind = 'rain'; delete state.data.overlay; setLayers(['sun', 'borders', 'cities', 'overlay']); globe.pointOfView({ lat: 10, lng: 110, altitude: 2.4 }, 1800); showLearn('overlay'); }
  if (k === 'connected') { preset(0); globe.pointOfView({ lat: 45, lng: 5, altitude: 1.4 }, 1800); }
  if (k === 'radio') { setLayers(['sun', 'borders', 'cities', 'radio']); globe.pointOfView({ lat: 45, lng: -20, altitude: 2 }, 1800); showLearn('radio'); }
  if (k === 'pur') { setLayers(['sun', 'borders', 'cities', 'pur']); globe.pointOfView({ lat: 36.6, lng: -120.2, altitude: 0.35 }, 1800); showLearn('pur'); }
  if (k === 'history') { setLayers(['sun', 'borders', 'cities', 'replay']); globe.pointOfView({ lat: 45, lng: -30, altitude: 2.4 }, 1800); showLearn('replay'); }
  if (k === 'ships') { setLayers(['borders', 'cities', 'ships']); globe.pointOfView({ lat: 59.8, lng: 24.5, altitude: 0.25 }, 1800); showLearn('ships'); }
  if (k === 'flights') { setLayers(['sun', 'borders', 'cities', 'aircraft', 'airports']); globe.pointOfView({ lat: 38, lng: -95, altitude: 1.3 }, 1800); showLearn('aircraft'); }
  if (k === 'cams') { setLayers(['borders', 'cities', 'cameras', 'alpr']); globe.pointOfView({ lat: 34.05, lng: -118.25, altitude: 0.05 }, 2000); showLearn('cameras'); setTimeout(() => api.openWall(), 3500); }
  if (k === 'news') { setLayers(['sun', 'borders', 'cities', 'news']); globe.pointOfView({ lat: 25, lng: 20, altitude: 2.3 }, 1800); showLearn('news'); }
  if (k === 'crime') { setLayers(['borders', 'cities', 'crime']); globe.pointOfView({ lat: 41.88, lng: -87.66, altitude: 0.03 }, 2000); setTimeout(() => showLearn('crime'), 2600); }
  if (k === 'board') { if (!state.on.has('aircraft')) setLayers([...state.on, 'aircraft']); setTimeout(() => extras.flightsBoard(), state.data.aircraft ? 0 : 4000); }
  if (k === 'ride') { if (!state.on.has('stations')) setLayers([...state.on, 'stations']); setTimeout(() => extras.ride(true), state.data.stations ? 0 : 2500); }
  if (k === 'moon') { setLayers(['sun', 'borders', 'cities', 'moon']); const m = astro.moonState(clock.date()); globe.pointOfView({ lat: m.lat, lng: m.lng, altitude: 2.4 }, 1800); showLearn('moon'); }
  if (k === 'palette') extras.open();
  if (k === 'live') { setLayers(['sun', 'borders', 'cities', 'quakes', 'events', 'news', 'aircraft']); setTimeout(() => document.querySelector('[data-livetour]')?.click() ?? live.openFeed(), 300); live.openFeed(); }
});
function welcome() {
  openNotes('Welcome', `<h3>A living Earth to explore</h3>
    <p>Drag to spin the globe and scroll or pinch to zoom — all the way down to streets, using satellite tiles once you get close. Click anything to open its field notes; click empty ground for the weather and the nearest plate boundary; click a country for its fact card.</p>
    <p>New here? Start with a short guided tour.</p>
    ${TOURS.slice(0, 3).map((t) => `<button class="tour-card" data-tour="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.blurb)}</span></button>`).join('')}
    <p class="muted">Built on <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">World Monitor</a> by Elie Habib. Every source is listed under About.</p>`);
}
const params = new URLSearchParams(location.search);
if (params.get('tour')) { setMode('tours'); startTour(params.get('tour')); }
if (params.get('mode')) setMode(params.get('mode'));
setLook(params.get('look') ?? 'normal');
if (window.__TAURI_INTERNALS__) {
  document.body.classList.add('desktop');
  // Desktop app: send outside links to the system browser instead of a dead new-window request.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="http"]');
    if (a && new URL(a.href).origin !== location.origin) { e.preventDefault(); window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: a.href }); }
  });
}
window.gia = { layerManifest, loadPlugins, applyEdition, health, watch, planeCounts, gov: () => gov, extras: () => extras, tracer: () => tracer, markers, pickAt: (x, y) => pickAt(x, y), live, applyPending, preset, VERSION, globe, state, setBase, toggleLayer, startTour, setMode, select, showLearn, surfaceClick, countryAt, setLook, refreshLayer, flightState }; // for tinkering in the console
