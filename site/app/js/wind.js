// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — wind and temperature now.
// Thousands of short streaks drift with the current 10 m wind (like earth.nullschool.net), and a
// translucent colour wash shows air temperature. The grid comes from Open-Meteo every 6 hours; the motion
// is computed here each frame by bilinear interpolation, updating one GPU buffer in place.
import { THREE } from '../vendor/vendor.min.mjs';
import { getLocal } from './feeds.js';

const R = 100; const D2R = Math.PI / 180;
let G = null; // grid
function sample(lat, lng) {
  const { lat0, lon0, step, nlat, nlon, u, v } = G;
  let x = (lng - lon0) / step; x = ((x % nlon) + nlon) % nlon;
  const y = Math.max(0, Math.min(nlat - 1.001, (lat - lat0) / step));
  const i = Math.floor(y); const j = Math.floor(x); const fy = y - i; const fx = x - j; const j2 = (j + 1) % nlon;
  const a = i * nlon; const b = (i + 1) * nlon;
  const lerp = (arr) => (arr[a + j] * (1 - fx) + arr[a + j2] * fx) * (1 - fy) + (arr[b + j] * (1 - fx) + arr[b + j2] * fx) * fy;
  return [lerp(u), lerp(v)];
}
function tempAt(lat, lng) {
  const { lat0, lon0, step, nlat, nlon, t } = G;
  let x = (lng - lon0) / step; x = ((x % nlon) + nlon) % nlon;
  const y = Math.max(0, Math.min(nlat - 1.001, (lat - lat0) / step));
  const i = Math.floor(y); const j = Math.floor(x); const fy = y - i; const fx = x - j; const j2 = (j + 1) % nlon;
  const g = (k) => t[k] ?? 0; const a = i * nlon; const b = (i + 1) * nlon;
  return (g(a + j) * (1 - fx) + g(a + j2) * fx) * (1 - fy) + (g(b + j) * (1 - fx) + g(b + j2) * fx) * fy;
}
// three-globe's lat/lng → scene convention (checked against globe.getCoords in the tests)
function xyz(out, o, lat, lng, alt) {
  const phi = (90 - lat) * D2R; const th = (90 - lng) * D2R; const r = R * (1 + alt);
  out[o] = r * Math.sin(phi) * Math.cos(th); out[o + 1] = r * Math.cos(phi); out[o + 2] = r * Math.sin(phi) * Math.sin(th);
}
const TEMP_STOPS = [[-40, [120, 60, 200]], [-20, [60, 90, 230]], [0, [120, 210, 255]], [10, [120, 220, 150]], [20, [240, 220, 90]], [30, [250, 140, 50]], [42, [210, 40, 50]]];
function tempColor(tc) {
  for (let k = 1; k < TEMP_STOPS.length; k++) {
    const [t1, c1] = TEMP_STOPS[k]; const [t0, c0] = TEMP_STOPS[k - 1];
    if (tc <= t1 || k === TEMP_STOPS.length - 1) { const f = Math.max(0, Math.min(1, (tc - t0) / (t1 - t0))); return c0.map((c, n) => Math.round(c + (c1[n] - c) * f)); }
  }
  return TEMP_STOPS[0][1];
}
function speedColor(s, out, o) {
  const f = Math.min(1, s / 22);
  const c = f < 0.3 ? [0.55 + f, 0.75 + f * 0.5, 1] : f < 0.65 ? [1, 1, 1 - (f - 0.3) * 1.8] : [1, 1 - (f - 0.65) * 2, 0.35 - (f - 0.65)];
  out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
}

export function windLayer(api) {
  let lines = null; let shell = null; let N = 0; let P = null; let last = performance.now();
  const WIND = { get obj() { return lines; } }; const TEMP = { get obj() { return shell; } };

  function spawn(k, view) {
    let lat; let lng;
    if (view && view.altitude < 1.2) { // zoomed in: keep particles where you are looking
      const r = (view.radiusKm / 111) * Math.sqrt(Math.random()); const b = Math.random() * Math.PI * 2;
      lat = view.lat + r * Math.cos(b); lng = view.lng + (r * Math.sin(b)) / Math.max(0.2, Math.cos(view.lat * D2R));
    } else { lat = Math.asin(Math.random() * 2 - 1) / D2R * 0.93; lng = Math.random() * 360 - 180; }
    P[k * 4] = Math.max(-83, Math.min(83, lat)); P[k * 4 + 1] = lng; P[k * 4 + 2] = 0; P[k * 4 + 3] = 40 + Math.random() * 80;
  }
  function build(n) {
    N = n; P = new Float32Array(N * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 8), 4).setUsage(THREE.DynamicDrawUsage));
    lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    lines.frustumCulled = false; lines.raycast = () => {}; lines.renderOrder = 3;
    const view = api.view();
    for (let k = 0; k < N; k++) { spawn(k, view); P[k * 4 + 2] = Math.random() * P[k * 4 + 3]; }
    lines.onBeforeRender = step;
  }
  function step() {
    if (!G) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const view = api.view(); const alt = Math.max(0.0000015, Math.min(0.003, view.altitude * 0.01));
    // Motion and streak length are set in screen terms, so the flow looks the same from orbit or up close:
    // at the whole-globe view 10 m/s drifts about 1.2°/s with a ~4° streak.
    const z = Math.max(0.0004, Math.min(1.6, view.altitude)) / 2.3;
    const adv = 0.12 * z * dt; const tail = 0.45 * z;
    const pos = lines.geometry.attributes.position.array; const col = lines.geometry.attributes.color.array;
    for (let k = 0; k < N; k++) {
      const o = k * 4; const lat = P[o]; const lng = P[o + 1];
      const [u, v] = sample(lat, lng); const s = Math.hypot(u, v); const cosl = Math.max(0.15, Math.cos(lat * D2R));
      const nlat = lat + v * adv; const nlng = lng + (u * adv) / cosl;
      xyz(pos, k * 6, nlat - v * tail, nlng - (u * tail) / cosl, alt);
      xyz(pos, k * 6 + 3, nlat, nlng, alt);
      speedColor(s, col, k * 8); speedColor(s, col, k * 8 + 4);
      const life = P[o + 2] / P[o + 3]; const fade = Math.min(1, life * 6, (1 - life) * 6) * 0.85;
      col[k * 8 + 3] = 0; col[k * 8 + 7] = fade;
      P[o] = nlat; P[o + 1] = nlng; P[o + 2] += 1;
      if (P[o + 2] > P[o + 3] || Math.abs(nlat) > 84 || s < 0.2) spawn(k, view);
    }
    lines.geometry.attributes.position.needsUpdate = true; lines.geometry.attributes.color.needsUpdate = true;
  }
  function buildTemp() {
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 360; const g = cv.getContext('2d'); const img = g.createImageData(720, 360);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 720; x++) {
      const lat = 90 - (y + 0.5) / 2; const lng = -180 + (x + 0.5) / 2; const [r, gg, b] = tempColor(tempAt(Math.max(-84, Math.min(84, lat)), lng));
      const o = (y * 720 + x) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 150;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
    shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0006, 128, 64), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
    shell.rotation.y = -Math.PI / 2; shell.raycast = () => {}; shell.renderOrder = 1;
  }

  return {
    id: 'wind', group: 'science', label: 'Wind and temperature now', swatch: '#9fe3ff', on: false, fresh: true, refresh: 60 * 60_000,
    sources: ['openmeteo'],
    options: [{ id: 'show', label: 'Show', choices: [['both', 'Wind + temperature'], ['wind', 'Wind only'], ['temp', 'Temperature only']], value: 'both' }],
    async load() {
      const d = await getLocal('data/weather.json').catch(() => { throw new Error('the weather grid is created when the site deploys — it appears once the Pages workflow has run (it refreshes every 6 hours)'); });
      G = d; shell = null; return d;
    },
    channels(d, ctx) {
      const want = api.particleBudget();
      if (!lines || N !== want) build(want);
      if (!shell) buildTemp();
      const show = api.state.opts.wind?.show ?? 'both';
      return { custom: [...(show !== 'temp' ? [WIND] : []), ...(show !== 'wind' ? [TEMP] : [])] };
    },
    describeLayer: (d) => ({ rows: [['Grid', `${d.step}° (${d.nlat * d.nlon} points)`], ['Updated', new Date(d.generatedAt).toUTCString()], ['Source', 'Open-Meteo (CC BY 4.0), from national weather-service models']] }),
    learn: {
      what: 'Moving streaks show the wind 10 m above the ground right now — faster air is brighter, from pale blue through white to yellow and red above about 80 km/h. The colour wash is air temperature 2 m up, from purple (−40 °C) to red (40 °C).',
      how: 'Every 6 hours, while the site deploys, a script asks Open-Meteo for current conditions at 1,740 points on a 6° grid. Open-Meteo combines forecasts from national weather services (NOAA, DWD, ECMWF and others). Your browser interpolates between grid points and moves each streak along the flow every frame.',
      try: 'Find the trade winds blowing west along the tropics, the westerlies in the Southern Ocean, and any spinning storm. Then turn on Natural events and compare with the storm tracks.',
      refs: ['openmeteo'],
    },
    grid: () => G, sampleAt: (lat, lng) => (G ? { wind: sample(lat, lng), t: tempAt(lat, lng) } : null),
  };
}
