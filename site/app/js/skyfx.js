// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — the sky drawn physically: clouds, rain, snow, lightning and fire smoke.
// Everything is driven by real data: the Open-Meteo grid written at deploy time (data/weather.json: cloud cover,
// precipitation, World Meteorological Organization weather code, wind, temperature) and NASA FIRMS fire hotspots
// (the same cached download as the fire hotspots layer). The whole layer is four draw calls:
//   1. clouds: one sphere shell whose shader turns the 6° cloud-cover grid into cloud texture with 3D fractal noise,
//      drifting with the wind grid, lit by the Sun, with thunderstorm lightning flickering inside the same shader;
//   2. rain and snow: one line buffer of falling streaks, animated entirely on the GPU;
//   3. fire glow: one additive point buffer, one point per hotspot, flickering on the GPU;
//   4. smoke: one point buffer of puffs rising from the fires and drifting downwind, also animated on the GPU.
// The CPU only re-picks where drops and puffs live when the view moves, and times the lightning strokes.
import { THREE } from '../vendor/vendor.min.mjs';
import { getLocal } from './feeds.js';
import { subsolarPoint } from './astro.js';
import { loadFireRows } from './hazards.js';

const R = 100; const D2R = Math.PI / 180;
const CLOUD_R = 1.01; // cloud shell radius (× R): exaggerated ~60 km so it parallaxes visibly over the ground
const RAIN_TOP = 0.0095; const RAIN_BOT = 0.0003; // drops fall from just inside the cloud shell to the ground
const MAX_CELLS = 32; // thunderstorm cells the cloud shader can light at once (one vec4 uniform each)
const isStorm = (c) => c >= 95 && c <= 99; // WMO 95 thunderstorm, 96/99 with hail
const isSnow = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;

// three-globe's lat/lng → scene convention (as wind.js)
function dir(lat, lng) { const p = (90 - lat) * D2R; const t = (90 - lng) * D2R; return [Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]; }
/** Bilinear value of one grid array at a point, wrapping in longitude (the grid is 6° from lat0/lon0). */
function bilerp(G, arr, lat, lng) {
  const { lat0, lon0, step, nlat, nlon } = G;
  let x = (lng - lon0) / step; x = ((x % nlon) + nlon) % nlon;
  const y = Math.max(0, Math.min(nlat - 1.001, (lat - lat0) / step));
  const i = Math.floor(y); const j = Math.floor(x); const fy = y - i; const fx = x - j; const j2 = (j + 1) % nlon;
  const g = (k) => arr[k] ?? 0; const a = i * nlon; const b = (i + 1) * nlon;
  return (g(a + j) * (1 - fx) + g(a + j2) * fx) * (1 - fy) + (g(b + j) * (1 - fx) + g(b + j2) * fx) * fy;
}
const nearest = (G, lat, lng) => {
  const i = Math.max(0, Math.min(G.nlat - 1, Math.round((lat - G.lat0) / G.step)));
  const j = (((Math.round((lng - G.lon0) / G.step)) % G.nlon) + G.nlon) % G.nlon; return i * G.nlon + j;
};
const gridLat = (G, k) => G.lat0 + Math.floor(k / G.nlon) * G.step; const gridLng = (G, k) => G.lon0 + (k % G.nlon) * G.step;
const wrapLng = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
const expRand = () => -Math.log(1 - Math.random());

// ------------------------------------------------------------------ noise volume
// A 64³ tiling noise volume made once on the CPU, so the cloud shader pays one hardware-filtered texture fetch per
// octave instead of eight hashes. R, G: smooth value noise (8 cells across), B: finer value noise (16 cells),
// A: inverted cellular (Worley) noise, which gives the cauliflower look of cumulus at small scales.
let NOISE = null;
function noiseVolume() {
  if (NOISE) return NOISE;
  const S = 64; const data = new Uint8Array(S * S * S * 4);
  // mulberry32: a plain linear congruential generator laid out on a 3D lattice puts its values on planes, which
  // shows up as diagonal streaks in the clouds
  const lattice = (P, seed) => {
    const a = new Float32Array(P * P * P); let s = seed >>> 0;
    for (let i = 0; i < a.length; i++) { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return a;
  };
  const value = (L, P, x, y, z) => { // quintic-interpolated value noise on a P³ lattice that tiles every P cells
    const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z); const q = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const fx = q(x - xi); const fy = q(y - yi); const fz = q(z - zi); const at = (i, j, k) => L[((i % P) * P + (j % P)) * P + (k % P)];
    const l = (a, b, f) => a + (b - a) * f;
    return l(l(l(at(xi, yi, zi), at(xi + 1, yi, zi), fx), l(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), fx), fy),
      l(l(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), fx), l(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), fx), fy), fz);
  };
  const L1 = lattice(8, 7); const L2 = lattice(8, 91); const L3 = lattice(16, 1234);
  const F = 8; const pts = lattice(F, 555); const pts2 = lattice(F, 777); const pts3 = lattice(F, 999); // one feature point per cell
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = ((z * S + y) * S + x) * 4; const u = x / S; const v = y / S; const w = z / S;
    data[o] = value(L1, 8, u * 8, v * 8, w * 8) * 255; data[o + 1] = value(L2, 8, u * 8, v * 8, w * 8) * 255; data[o + 2] = value(L3, 16, u * 16, v * 16, w * 16) * 255;
    const cx = u * F; const cy = v * F; const cz = w * F; const ix = Math.floor(cx); const iy = Math.floor(cy); const iz = Math.floor(cz); let d = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const X = ix + a; const Y = iy + b; const Z = iz + c; const k = ((((X % F) + F) % F) * F + (((Y % F) + F) % F)) * F + (((Z % F) + F) % F);
      const dx = X + pts[k] - cx; const dy = Y + pts2[k] - cy; const dz = Z + pts3[k] - cz; d = Math.min(d, dx * dx + dy * dy + dz * dz);
    }
    data[o + 3] = Math.max(0, 1 - Math.sqrt(d) * 1.1) * 255;
  }
  NOISE = new THREE.Data3DTexture(data, S, S, S);
  NOISE.format = THREE.RGBAFormat; NOISE.type = THREE.UnsignedByteType; NOISE.minFilter = NOISE.magFilter = THREE.LinearFilter;
  NOISE.wrapS = NOISE.wrapT = NOISE.wrapR = THREE.RepeatWrapping; NOISE.unpackAlignment = 1; NOISE.needsUpdate = true;
  return NOISE;
}

// ------------------------------------------------------------------ shaders
// Shared GLSL: lat/lng of a unit vector in three-globe's frame, the grid lookup, and the local east/north axes.
const GLSL_GEO = `
  uniform vec4 uGrid; // lat0, lon0, step, unused
  uniform vec2 uGridN; // nlon, nlat
  vec2 latLng(vec3 n) { return vec2(degrees(asin(clamp(n.y, -1.0, 1.0))), 90.0 - degrees(atan(n.z, n.x))); }
  vec2 gridUv(vec2 ll) { return vec2(((ll.y - uGrid.y) / uGrid.z + 0.5) / uGridN.x, ((ll.x - uGrid.x) / uGrid.z + 0.5) / uGridN.y); }
  vec3 eastOf(vec3 n) { vec2 h = vec2(n.z, -n.x); float l = length(h); return l > 1e-4 ? vec3(h.x, 0.0, h.y) / l : vec3(1.0, 0.0, 0.0); }
`;
const CLOUD_VS = `
  varying vec3 vN; varying vec3 vWorld;
  void main() { vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CLOUD_FS = `
  precision highp float; precision highp sampler3D;
  ${GLSL_GEO}
  uniform sampler2D uSky;   // r cloud cover, g precipitation (sqrt-scaled), b thunderstorm, a snow
  uniform sampler2D uAir;   // r, g wind u/v (m/s, ±40 → 0..1), b low cloud, a high cloud
  uniform sampler3D uNoise;
  uniform vec3 uSun; uniform float uLit; uniform float uT; uniform float uOct; uniform float uGain; uniform float uFade; uniform float uFlow;
  uniform vec4 uCell[${MAX_CELLS}]; // xyz: storm direction, w: flash brightness now
  varying vec3 vN; varying vec3 vWorld;
  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64); // decorrelates octaves
  float fbm(vec3 q, float oct) {
    float a = 0.5; float s = 0.0; float w = 0.0;
    for (int i = 0; i < 8; i++) {
      float k = clamp(oct - float(i), 0.0, 1.0); if (k <= 0.0) break; // the last octave fades in with zoom
      vec4 t = texture(uNoise, q);
      // large scales: smooth value noise (fronts, bands); small scales: billowy cellular noise (cumulus tops)
      float v = mix(t.r, t.a, smoothstep(1.0, 3.0, float(i)));
      s += a * k * v; w += a * k; q = ROT * q * 2.03 + 0.17; a *= uGain;
    }
    return s / max(w, 1e-3);
  }
  void main() {
    vec3 n = normalize(vN);
    // Coverage from the 6° grid, read at a point nudged by low-frequency noise so the grid never shows.
    vec4 warp = texture(uNoise, n * 0.55 + 0.31) - 0.5; warp += (texture(uNoise, n * 1.4 + 0.13) - 0.5) * 0.5;
    vec2 ll = latLng(n) + warp.gb * vec2(12.0, 15.0);
    vec4 sky = texture2D(uSky, gridUv(ll)); vec4 air = texture2D(uAir, gridUv(ll));
    float cov = sky.r; float rain = sky.g; float hiFrac = air.a / max(0.05, air.b + air.a);
    // Wind as a 3D tangent vector, to advect the noise (a two-phase flow map: two copies of the texture slide
    // downwind half a cycle apart and cross-fade, so the clouds drift without ever stretching out).
    vec3 e = eastOf(n); vec3 no = cross(n, e);
    vec3 wind = (e * (air.r - 0.5) + no * (air.g - 0.5)) * 80.0; // m/s
    // A short cycle keeps the slide small: a long one shears the fine octaves into fibres where the wind turns.
    float P = 8.0; float ph0 = fract(uT / P); float ph1 = fract(uT / P + 0.5);
    float w0 = 1.0 - abs(2.0 * ph0 - 1.0); float w1 = 1.0 - w0;
    vec3 base = n * 1.6;
    vec3 str = base;
    vec3 q0 = str - wind * (uFlow * ph0 * P) + 0.37; vec3 q1 = str - wind * (uFlow * ph1 * P) + 0.61;
    vec3 wq0 = (texture(uNoise, q0 * 0.5).rgb - 0.5) * 0.16; vec3 wq1 = (texture(uNoise, q1 * 0.5).rgb - 0.5) * 0.16;
    float f0 = fbm(q0 + wq0, uOct); float f1 = fbm(q1 + wq1, uOct);
    float f = 0.5 + (f0 * w0 + f1 * w1 - 0.5) / sqrt(w0 * w0 + w1 * w1); // variance-preserving cross-fade
    f = clamp(0.5 + (f - 0.5) * 2.1, 0.0, 1.0); // averaging octaves flattens the noise; restore its contrast
    // Threshold the noise so the cloudy fraction of each area tracks the reported cover; overcast fills in.
    // (at full cover the threshold drops below zero: an unbroken deck, still textured through its density)
    float thr = mix(0.86, -0.12, cov);
    float d = smoothstep(thr, thr + 0.22 + 0.12 * hiFrac, f);
    float thick = clamp(rain * 1.4 + (1.0 - hiFrac) * 0.35, 0.0, 1.0); // rain clouds are deep; cirrus is thin
    float alpha = pow(d, 0.8) * mix(0.45, 0.97, thick) * mix(1.0, 0.6, hiFrac * (1.0 - rain));
    // Light: the same Sun direction as the day/night globe, a soft terminator, a warm band at dusk.
    float ndl = dot(n, uSun);
    float day = uLit > 0.5 ? smoothstep(-0.10, 0.28, ndl) : 1.0;
    vec3 tint = mix(vec3(1.0, 0.56, 0.32), vec3(1.0), smoothstep(0.02, 0.32, ndl * uLit + (1.0 - uLit)));
    // Relief: treat the noise as cloud-top height and light its slope from the Sun. The slope comes from screen-space
    // derivatives (free, and as fine as the pixels at every zoom) instead of a second noise lookup toward the Sun.
    vec3 toSun = uSun - n * ndl; toSun = length(toSun) > 1e-4 ? normalize(toSun) : e;
    // Two octaves are enough for the large-scale relief, so this costs four texture reads, not another full fbm.
    vec3 sd = toSun * 0.05;
    float lo0 = texture(uNoise, q0 + wq0).r + 0.5 * texture(uNoise, ROT * (q0 + wq0) * 2.03 + 0.17).r;
    float ls0 = texture(uNoise, q0 + wq0 + sd).r + 0.5 * texture(uNoise, ROT * (q0 + wq0 + sd) * 2.03 + 0.17).r;
    float lo1 = texture(uNoise, q1 + wq1).r + 0.5 * texture(uNoise, ROT * (q1 + wq1) * 2.03 + 0.17).r;
    float ls1 = texture(uNoise, q1 + wq1 + sd).r + 0.5 * texture(uNoise, ROT * (q1 + wq1 + sd) * 2.03 + 0.17).r;
    float rise = (ls0 - lo0) * w0 + (ls1 - lo1) * w1; // > 0: the cloud climbs toward the Sun, so this side is in shade
    float shade = 1.0 - clamp(rise * 3.0 * (1.3 - 0.6 * max(ndl, 0.0)), -0.12, 0.42) * uLit;
    vec3 white = vec3(0.98, 0.98, 0.97); vec3 grey = vec3(0.50, 0.53, 0.58);
    vec3 col = mix(white, grey, clamp(rain * 0.4 + d * thick * 0.15, 0.0, 0.55));
    col = mix(col, col * vec3(0.92, 0.95, 1.05), hiFrac * 0.5);
    col *= 0.5 + 0.55 * mix(f, smoothstep(thr, thr + 0.5, f), 0.4); // thin edges are greyer, the deep middle bright: texture inside the deck, not a flat sheet
    col = col * tint * day * shade + col * vec3(0.045, 0.05, 0.065); // night side: near-black, a trace of moonlight
    // Lightning: each active cell lights the cloud from inside, brightest where the cloud is thickest.
    float g = 0.0;
    for (int i = 0; i < ${MAX_CELLS}; i++) {
      vec4 c = uCell[i]; if (c.w <= 0.001) continue;
      float dd = 1.0 - dot(n, c.xyz); // ≈ angle² / 2
      g += c.w * (exp(-dd * 60000.0) + 0.5 * exp(-dd * 4000.0)); // a ~35 km core lighting ~150 km of cloud
    }
    // the flash shows through the cloud unevenly: brightest in the thick turrets, ragged at the edges
    g *= (0.4 + 1.0 * d) * (0.3 + 0.9 * smoothstep(0.2, 0.9, f)) * 2.4 * mix(1.0, 0.3, day); // daylight drowns most of a flash
    col += vec3(0.74, 0.80, 1.0) * g;
    alpha = max(alpha, clamp(g * 0.5, 0.0, 0.8));
    // Look through more cloud near the limb (a thin layer seen edge-on), and fade out as the camera dives in.
    vec3 view = normalize(cameraPosition - vWorld);
    float mu0 = abs(dot(n, view)); float mu = max(0.25, mu0);
    alpha = 1.0 - pow(1.0 - clamp(alpha, 0.0, 0.96), 1.0 / mu);
    // ...but not past the globe's edge, where the raised shell would show as a ragged fringe against the sky
    alpha = min(alpha, 0.96) * uFade * smoothstep(0.04, 0.22, mu0);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }`;
// Rain and snow: two vertices per drop (top and bottom of the streak). The column, fall phase, rate and wind are
// attributes; the fall itself is computed here, so the buffer is only rewritten when the view moves.
const RAIN_VS = `
  ${GLSL_GEO}
  attribute vec4 aDrop; // phase, rate (mm/h), kind (0 rain, 1 snow), end (0 top, 1 bottom)
  attribute vec2 aWind; // u, v m/s at the column
  uniform float uT; uniform vec3 uSun; uniform float uLit; uniform float uJit; uniform float uFade; uniform sampler2D uSky;
  varying float vA; varying vec3 vC;
  float h1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
  void main() {
    vec3 n = normalize(position); float snow = aDrop.z; float rate = aDrop.y;
    float speed = snow > 0.5 ? 0.16 + 0.06 * h1(aDrop.x * 7.1) : 1.25 + 0.5 * h1(aDrop.x * 3.7);
    float t = uT * speed + aDrop.x; float cyc = floor(t); float f = fract(t);
    // each fall starts from a slightly different spot, so the drops never repeat in place
    vec3 e = eastOf(n); vec3 no = cross(n, e);
    vec2 j = vec2(h1(cyc + aDrop.x * 91.0), h1(cyc * 1.7 + aDrop.x * 53.0)) - 0.5;
    vec3 col = normalize(n + (e * j.x + no * j.y) * uJit);
    float len = snow > 0.5 ? 0.00006 : 0.0007 + 0.0016 * clamp(rate / 8.0, 0.0, 1.0);
    float h = mix(${RAIN_TOP.toFixed(4)}, ${RAIN_BOT.toFixed(4)}, f) + len * (1.0 - aDrop.w);
    // slant with the wind (drops fall at ~9 m/s); snow also flutters
    vec2 w = aWind / (9.0 + length(aWind)) * (snow > 0.5 ? 2.0 : 0.6);
    vec3 side = e * w.x + no * w.y;
    if (snow > 0.5) side += (e * sin(uT * 2.3 + aDrop.x * 40.0) + no * cos(uT * 1.9 + aDrop.x * 31.0)) * 0.12;
    vec3 p = col * ${R}.0 * (1.0 + h) + side * ${R}.0 * (h - ${RAIN_BOT.toFixed(4)}) * 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float day = uLit > 0.5 ? smoothstep(-0.12, 0.25, dot(n, uSun)) : 1.0;
    float fade = smoothstep(0.0, 0.12, f) * smoothstep(1.0, 0.9, f);
    fade *= smoothstep(0.5, 0.9, texture2D(uSky, gridUv(latLng(n))).r); // only under the cloud deck
    vA = (snow > 0.5 ? 0.55 + 0.3 * clamp(rate / 3.0, 0.0, 1.0) : 0.10 + 0.40 * clamp(rate / 8.0, 0.0, 1.0)) * fade * (0.25 + 0.75 * day) * uFade;
    vC = (snow > 0.5 ? vec3(1.0) : vec3(0.70, 0.76, 0.85)) * (0.3 + 0.7 * day);
  }`;
const RAIN_FS = 'varying float vA; varying vec3 vC; void main() { gl_FragColor = vec4(vC, vA); }';
// Fire glow: one point per hotspot, sized by fire radiative power, flickering; brighter on the night side.
const EMBER_VS = `
  attribute vec2 aFire; // frp MW, seed
  uniform float uT; uniform float uPx; uniform vec3 uSun; uniform float uLit;
  varying float vI;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    float frp = aFire.x; float s = aFire.y;
    float flick = 0.78 + 0.22 * sin(uT * (6.0 + s * 9.0) + s * 40.0) * sin(uT * (2.3 + s * 3.0) + s * 17.0);
    float km = 1.2 + 0.55 * sqrt(frp); // apparent glow radius on the ground
    float px = km / 63.71 * uPx / -mv.z;
    gl_PointSize = clamp(px, 1.6 + min(4.0, sqrt(frp) * 0.25), 72.0);
    float night = uLit > 0.5 ? 1.0 - smoothstep(-0.1, 0.2, dot(normalize(position), uSun)) : 0.5;
    vI = flick * (0.45 + 0.55 * night) * (0.45 + 0.55 * clamp(frp / 60.0, 0.0, 1.0));
  }`;
const EMBER_FS = `
  varying float vI;
  void main() {
    vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; if (r2 > 1.0) discard;
    float core = exp(-r2 * 14.0); float halo = exp(-r2 * 3.2) * (1.0 - r2);
    vec3 c = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.86, 0.55), core);
    gl_FragColor = vec4(c * (core * 1.2 + halo * 0.55) * vI, 1.0);
  }`;
// Smoke: puffs cycle forever at their fire; age decides how far they have risen, spread and blown downwind.
const SMOKE_VS = `
  ${GLSL_GEO}
  attribute vec2 aWind; attribute vec4 aPuff; // phase, life (s), frp MW, seed
  uniform float uT; uniform float uPx; uniform vec3 uSun; uniform float uLit; uniform float uFade;
  varying float vA; varying vec3 vC; varying float vSeed;
  float h1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
  void main() {
    vec3 n = normalize(position); vec3 e = eastOf(n); vec3 no = cross(n, e);
    float age = fract(uT / aPuff.y + aPuff.x); float frp = aPuff.z; float s = aPuff.w;
    // one puff's life stands for ~3 hours of transport: 10 m/s carries it about 100 km (≈1.7 scene units)
    vec2 drift = aWind * 0.17 * age;
    vec2 spread = (vec2(h1(s * 3.1), h1(s * 7.7)) - 0.5) * (0.01 + 0.3 * age);
    float rise = 0.0006 + (0.0012 + 0.0025 * clamp(frp / 200.0, 0.0, 1.0)) * sqrt(age);
    vec3 p = normalize(n + (e * (drift.x + spread.x) + no * (drift.y + spread.y)) / ${R}.0) * ${R}.0 * (1.0 + rise);
    vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
    float size = (0.05 + 0.8 * age) * (0.5 + 0.5 * clamp(sqrt(frp) / 10.0, 0.0, 1.5));
    gl_PointSize = clamp(size * uPx / -mv.z, 1.5, 160.0);
    float day = uLit > 0.5 ? smoothstep(-0.12, 0.25, dot(n, uSun)) : 1.0;
    vA = smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.4) * (0.16 + 0.3 * clamp(frp / 150.0, 0.0, 1.0)) * uFade;
    vec3 smoke = mix(vec3(0.36, 0.32, 0.28), vec3(0.72, 0.72, 0.74), age); // dark and brown when fresh, paler as it ages
    vC = smoke * (0.12 + 0.88 * day) + vec3(1.0, 0.42, 0.12) * (1.0 - day) * max(0.0, 1.0 - age * 5.0) * 0.6; // lit from below at night
    vSeed = s;
  }`;
const SMOKE_FS = `
  precision highp sampler3D;
  uniform sampler3D uNoise; varying float vA; varying vec3 vC; varying float vSeed;
  void main() {
    vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.0; if (r > 1.0) discard;
    float nz = texture(uNoise, vec3(gl_PointCoord * 0.45, vSeed)).a * 0.6 + texture(uNoise, vec3(gl_PointCoord * 0.9 + vSeed, vSeed * 0.5)).r * 0.6;
    float a = vA * smoothstep(1.0, 0.25, r) * clamp(nz, 0.0, 1.2);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vC, a);
  }`;

export function skyLayer(api) {
  let G = null; let fires = []; let fireNote = '';
  let clouds = null; let rain = null; let embers = null; let smoke = null; let skyTex = null; let airTex = null;
  let cells = []; let lastView = null; let lastCheck = 0; let t0 = performance.now(); let lastTick = 0; let frozenT = 7.3;
  const reduce = !!api.reduceMotion;
  const U = { // uniforms shared by the four materials
    uT: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uLit: { value: 1 }, uFade: { value: 1 }, uPx: { value: 800 }, uJit: { value: 0.004 },
    uGrid: { value: new THREE.Vector4(-84, -180, 6, 0) }, uGridN: { value: new THREE.Vector2(60, 29) },
  };
  const CLOUDS = { get obj() { return clouds; } }; const RAIN = { get obj() { return rain; } };
  const EMBERS = { get obj() { return embers; } }; const SMOKE = { get obj() { return smoke; } };
  const budget = () => api.particleBudget();

  // ---------------------------------------------------------------- data → textures and storm cells
  function gridTextures() {
    const { nlat, nlon } = G; const n = nlat * nlon;
    const a = new Uint8Array(n * 4); const b = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) {
      const pr = G.pr[k] ?? 0; const wc = G.wc[k] ?? 0; const t = G.t[k] ?? 10;
      a[k * 4] = Math.round(Math.min(100, G.cc[k] ?? 0) * 2.55);
      a[k * 4 + 1] = Math.round(Math.sqrt(Math.min(1, pr / 12)) * 255); // sqrt: drizzle already darkens a little
      a[k * 4 + 2] = isStorm(wc) ? 255 : 0;
      a[k * 4 + 3] = isSnow(wc) || (pr > 0.1 && t < 0.5) ? 255 : 0;
      b[k * 4] = Math.round(Math.max(0, Math.min(1, (G.u[k] ?? 0) / 80 + 0.5)) * 255);
      b[k * 4 + 1] = Math.round(Math.max(0, Math.min(1, (G.v[k] ?? 0) / 80 + 0.5)) * 255);
      b[k * 4 + 2] = Math.round(Math.min(100, G.cl?.[k] ?? G.cc[k] ?? 0) * 2.55);
      b[k * 4 + 3] = Math.round(Math.min(100, G.ch?.[k] ?? 0) * 2.55);
    }
    const mk = (arr) => { const t = new THREE.DataTexture(arr, nlon, nlat, THREE.RGBAFormat, THREE.UnsignedByteType); t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t; };
    skyTex?.dispose(); airTex?.dispose(); skyTex = mk(a); airTex = mk(b);
    U.uGrid.value.set(G.lat0, G.lon0, G.step, 0); U.uGridN.value.set(nlon, nlat);
    if (clouds) { clouds.material.uniforms.uSky.value = skyTex; clouds.material.uniforms.uAir.value = airTex; }
    if (rain) rain.material.uniforms.uSky.value = skyTex;
  }
  /** Thunderstorm cells: grid points whose WMO code is 95–99, two jittered cells each (a 6° box holds several storms).
   *  Only when the models report none anywhere, the very wettest points stand in, marked "heavy" (not lightning). */
  function buildCells() {
    const pts = []; const n = G.nlat * G.nlon;
    for (let k = 0; k < n; k++) if (isStorm(G.wc[k])) pts.push({ k, kind: 'storm', pr: G.pr[k] ?? 0 });
    if (!pts.length) for (let k = 0; k < n; k++) if ((G.pr[k] ?? 0) >= 8) pts.push({ k, kind: 'heavy', pr: G.pr[k] });
    pts.sort((a, b) => b.pr - a.pr);
    const per = pts.length * 2 <= MAX_CELLS ? 2 : 1;
    cells = [];
    for (const p of pts) for (let s = 0; s < per && cells.length < MAX_CELLS; s++) {
      const lat = gridLat(G, p.k) + (Math.random() - 0.5) * 4; const lng = gridLng(G, p.k) + (Math.random() - 0.5) * 4 / Math.max(0.3, Math.cos(gridLat(G, p.k) * D2R));
      cells.push({ lat, lng, kind: p.kind, grid: p.k, next: performance.now() + Math.random() * 4000, strokes: [], at: dir(lat, lng) });
    }
    stormInfo.storms = pts.filter((p) => p.kind === 'storm').length; stormInfo.heavy = pts.filter((p) => p.kind === 'heavy').length;
  }
  const stormInfo = { storms: 0, heavy: 0 };
  // Lightning timing: a flash is 1–4 return strokes of 20–70 ms, 40–160 ms apart, then seconds of quiet. Each
  // flash lights a slightly different part of the cell. Reduced motion: a steady dim glow instead.
  function flashes(now) {
    const arr = clouds.material.uniforms.uCell.value;
    for (let i = 0; i < MAX_CELLS; i++) {
      const c = cells[i]; const v = arr[i];
      if (!c) { v.set(0, 0, 0, 0); continue; }
      if (reduce) { v.set(c.at[0], c.at[1], c.at[2], c.kind === 'storm' ? 0.12 : 0.05); continue; }
      if (now >= c.next) {
        const k = 1 + Math.floor(Math.random() ** 1.6 * 4); let s = now;
        const jl = c.lat + (Math.random() - 0.5) * 1.4; const jg = c.lng + (Math.random() - 0.5) * 1.4; c.flashAt = dir(jl, jg);
        c.strokes = Array.from({ length: k }, (_, i2) => { const st = { s, d: 20 + Math.random() * 50, a: i2 === 0 ? 1 : 0.45 + Math.random() * 0.5 }; s += st.d + 40 + Math.random() * 120; return st; });
        c.next = s + (c.kind === 'storm' ? 1200 + expRand() * 4500 : 6000 + expRand() * 12000);
      }
      let w = 0;
      for (const st of c.strokes) { const dt = now - st.s; if (dt >= 0) w += st.a * (dt < st.d ? 1 : Math.exp(-(dt - st.d) / 35)); }
      if (c.kind === 'heavy') w *= 0.5;
      const at = c.flashAt ?? c.at; v.set(at[0], at[1], at[2], w > 0.003 ? Math.min(1.6, w) : 0);
    }
  }

  // ---------------------------------------------------------------- objects
  function buildClouds() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSky: { value: skyTex }, uAir: { value: airTex }, uNoise: { value: noiseVolume() }, uOct: { value: 5 }, uGain: { value: 0.58 },
        uFlow: { value: reduce ? 0 : 1 / 6371e3 * 1800 }, // 1 s on screen = 30 min of real drift
        uCell: { value: Array.from({ length: MAX_CELLS }, () => new THREE.Vector4()) } },
      vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(R * CLOUD_R, 192, 96), mat);
    clouds.raycast = () => {}; clouds.renderOrder = 6; clouds.frustumCulled = false; clouds.onBeforeRender = tick;
  }
  function pointsObj(n, attrs, vs, fs, extra = {}) {
    const geo = new THREE.BufferGeometry();
    for (const [name, size] of attrs) geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage));
    return { geo, mat: new THREE.ShaderMaterial({ uniforms: U, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, ...extra }) };
  }
  function buildRain(n) {
    const { geo, mat } = pointsObj(n * 2, [['position', 3], ['aDrop', 4], ['aWind', 2]], RAIN_VS, RAIN_FS);
    mat.uniforms = { ...U, uSky: { value: skyTex } };
    rain = new THREE.LineSegments(geo, mat); rain.userData.n = n;
    rain.raycast = () => {}; rain.renderOrder = 5; rain.frustumCulled = false; rain.onBeforeRender = tick;
  }
  function buildEmbers(n) {
    const { geo, mat } = pointsObj(n, [['position', 3], ['aFire', 2]], EMBER_VS, EMBER_FS, { blending: THREE.AdditiveBlending });
    embers = new THREE.Points(geo, mat); embers.userData.n = n;
    embers.raycast = () => {}; embers.renderOrder = 3; embers.frustumCulled = false; embers.onBeforeRender = tick;
  }
  function buildSmoke(n) {
    const { geo, mat } = pointsObj(n, [['position', 3], ['aWind', 2], ['aPuff', 4]], SMOKE_VS, SMOKE_FS);
    mat.uniforms = { ...U, uNoise: { value: noiseVolume() } };
    smoke = new THREE.Points(geo, mat); smoke.userData.n = n;
    smoke.raycast = () => {}; smoke.renderOrder = 4; smoke.frustumCulled = false; smoke.onBeforeRender = tick;
  }

  // ---------------------------------------------------------------- where drops and puffs live
  // Zoomed out: drops are spread over every raining grid cell in proportion to rate × area, which reads as grey
  // curtains under the rain clouds. Zoomed in: they are placed inside the view (as wind.js does), where it rains.
  function inView(view) {
    const r = (view.radiusKm / 111) * Math.sqrt(Math.random()); const b = Math.random() * Math.PI * 2;
    return [Math.max(-84, Math.min(84, view.lat + r * Math.cos(b))), wrapLng(view.lng + (r * Math.sin(b)) / Math.max(0.2, Math.cos(view.lat * D2R)))];
  }
  function placeRain(view) {
    const n = rain.userData.n; const pos = rain.geometry.attributes.position.array; const drop = rain.geometry.attributes.aDrop.array; const wind = rain.geometry.attributes.aWind.array;
    const wet = []; let sum = 0;
    for (let k = 0; k < G.nlat * G.nlon; k++) { const pr = G.pr[k] ?? 0; if (pr >= 0.2) { sum += pr ** 0.6 * Math.max(0.1, Math.cos(gridLat(G, k) * D2R)); wet.push([k, sum]); } }
    const local = view.altitude < 1.2;
    let used = 0; let snowN = 0;
    for (let i = 0; i < n * 3 && used < n; i++) {
      let lat = 0; let lng = 0; let pr = 0;
      for (let tries = 0; tries < 12 && pr < 0.2; tries++) {
        if (local && tries < 8) [lat, lng] = inView(view);
        else if (wet.length) {
          const x = Math.random() * sum; let lo = 0; let hi = wet.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (wet[m][1] < x) lo = m + 1; else hi = m; }
          const k = wet[lo][0]; lat = gridLat(G, k) + (Math.random() - 0.5) * G.step; lng = wrapLng(gridLng(G, k) + (Math.random() - 0.5) * G.step);
        } else break;
        pr = bilerp(G, G.pr, lat, lng);
      }
      if (pr < 0.2) { if (!wet.length && !local) break; continue; }
      const k = nearest(G, lat, lng); const snow = isSnow(G.wc[k]) || bilerp(G, G.t, lat, lng) < 0.5 ? 1 : 0;
      const d = dir(lat, lng); const ph = Math.random() * 10; const u = bilerp(G, G.u, lat, lng); const v = bilerp(G, G.v, lat, lng);
      for (let e = 0; e < 2; e++) {
        const o = used * 2 + e; pos[o * 3] = d[0]; pos[o * 3 + 1] = d[1]; pos[o * 3 + 2] = d[2];
        drop[o * 4] = ph; drop[o * 4 + 1] = pr; drop[o * 4 + 2] = snow; drop[o * 4 + 3] = e;
        wind[o * 2] = u; wind[o * 2 + 1] = v;
      }
      used += 1; snowN += snow;
    }
    rain.geometry.setDrawRange(0, used * 2); // drops that found no rain are simply not drawn
    for (const a of ['position', 'aDrop', 'aWind']) rain.geometry.attributes[a].needsUpdate = true;
    rain.userData.used = used; rain.userData.snow = snowN;
    U.uJit.value = local ? Math.min(0.012, (view.radiusKm / 6371) * 0.08) : 0.012;
  }
  function placeFires(view) {
    const local = view.altitude < 1.2;
    const near = (r) => Math.abs(r[0] - view.lat) * 111 < view.radiusKm && Math.abs(wrapLng(r[1] - view.lng)) * 111 * Math.max(0.1, Math.cos(view.lat * D2R)) < view.radiusKm * 1.2;
    // Glow: the fires in view first when zoomed in, then the strongest anywhere, up to the cap.
    const ne = embers.userData.n; const pool = local ? [...fires.filter(near), ...fires.filter((r) => !near(r))] : fires;
    const pos = embers.geometry.attributes.position.array; const fa = embers.geometry.attributes.aFire.array;
    const m = Math.min(ne, pool.length);
    for (let i = 0; i < m; i++) { const r = pool[i]; const d = dir(r[0], r[1]); const s = 1 + 0.0006; pos[i * 3] = d[0] * R * s; pos[i * 3 + 1] = d[1] * R * s; pos[i * 3 + 2] = d[2] * R * s; fa[i * 2] = r[2]; fa[i * 2 + 1] = ((r[0] * 7.3 + r[1] * 3.1) % 1 + 1) % 1; }
    embers.geometry.setDrawRange(0, m); embers.geometry.attributes.position.needsUpdate = true; embers.geometry.attributes.aFire.needsUpdate = true;
    embers.userData.used = m;
    // Smoke: puffs shared out by fire radiative power (big fires get many), among the fires in view when zoomed in.
    // Few big plumes read as smoke; a puff each over thousands of fires would read as cotton wool. So the puffs go to
    // the strongest fires (in view when zoomed in), about a dozen or more per plume.
    const ns = smoke.userData.n; const src = (local && fires.some(near) ? fires.filter(near) : fires).slice(0, Math.max(30, Math.round(ns / 20)));
    const sp = smoke.geometry.attributes.position.array; const sw = smoke.geometry.attributes.aWind.array; const pf = smoke.geometry.attributes.aPuff.array;
    let used = 0;
    if (src.length && G) {
      const cdf = []; let sum = 0; for (const r of src) { sum += Math.max(1, r[2]) ** 0.8; cdf.push(sum); }
      for (let i = 0; i < ns; i++) {
        const x = Math.random() * sum; let lo = 0; let hi = cdf.length - 1; while (lo < hi) { const mm = (lo + hi) >> 1; if (cdf[mm] < x) lo = mm + 1; else hi = mm; }
        const r = src[lo]; const d = dir(r[0], r[1]);
        sp[i * 3] = d[0]; sp[i * 3 + 1] = d[1]; sp[i * 3 + 2] = d[2];
        sw[i * 2] = bilerp(G, G.u, r[0], r[1]); sw[i * 2 + 1] = bilerp(G, G.v, r[0], r[1]);
        pf[i * 4] = Math.random(); pf[i * 4 + 1] = 7 + Math.random() * 5; pf[i * 4 + 2] = r[2]; pf[i * 4 + 3] = Math.random();
      }
      used = ns;
    }
    smoke.geometry.setDrawRange(0, used);
    for (const a of ['position', 'aWind', 'aPuff']) smoke.geometry.attributes[a].needsUpdate = true;
    smoke.userData.used = used;
  }
  function place(view) { lastView = { ...view }; if (rain && G) placeRain(view); if (embers && smoke) placeFires(view); }
  function moved(v) {
    const l = lastView; if (!l) return true;
    if ((l.altitude < 1.2) !== (v.altitude < 1.2)) return true;
    if (v.altitude >= 1.2) return false;
    const ratio = v.altitude / l.altitude; if (ratio > 1.5 || ratio < 0.66) return true;
    const dKm = Math.hypot(v.lat - l.lat, wrapLng(v.lng - l.lng) * Math.cos(v.lat * D2R)) * 111;
    return dKm > v.radiusKm * 0.3;
  }

  // ---------------------------------------------------------------- per frame (shared by all four objects)
  const tmp = new THREE.Vector2();
  function tick(renderer, scene, camera) {
    const now = performance.now(); if (now - lastTick < 2) return; lastTick = now;
    U.uT.value = reduce ? frozenT : (now - t0) / 1000;
    const s = subsolarPoint(api.now()); const d = dir(s.lat, s.lng); U.uSun.value.set(d[0], d[1], d[2]);
    U.uLit.value = api.state.base === 'daynight' || api.state.base === 'weather' || api.state.on.has('sun') ? 1 : 0;
    const view = api.view(); const a = view.altitude;
    U.uFade.value = Math.max(0, Math.min(1, (a - 0.012) / 0.04));
    renderer.getDrawingBufferSize(tmp); U.uPx.value = tmp.y / (2 * Math.tan((camera.fov ?? 50) * D2R / 2));
    if (clouds) {
      const q = budget(); const oct = q >= 6000 ? 5 : q >= 3500 ? 4.5 : 4; // quality governor: fewer octaves when slow
      clouds.material.uniforms.uOct.value = Math.min(8, oct + (a < 0.6 ? 1 : 0) + (a < 0.15 ? 1 : 0) + (a < 0.05 ? 1 : 0) + (a < 0.02 ? 1 : 0));
      clouds.material.uniforms.uGain.value = a < 0.2 ? 0.7 : a < 0.6 ? 0.64 : 0.58; // close up, the fine octaves carry the texture
      if (cells.length) flashes(now);
    }
    if (now - lastCheck > 500) { lastCheck = now; if (moved(view)) place(view); }
  }

  // Counts for the Live overview in main.js (api.liveOverview); null while the layer is off or not loaded yet.
  api.skyStats = () => {
    if (!G || !api.state.on.has('skyfx')) return null;
    const n = G.nlat * G.nlon; let cc = 0; for (let k = 0; k < n; k++) cc += G.cc[k] ?? 0;
    return { storms: stormInfo.storms, cloud: cc / n / 100, fires: fireNote === 'fires unavailable right now' ? null : (embers?.userData.used ?? fires.length) };
  };
  return {
    id: 'skyfx', group: 'science', label: 'Clouds, rain, storms and fire smoke', swatch: '#dfe8f2', on: false, fresh: true, refresh: 60 * 60_000,
    sources: ['openmeteo', 'wmocodes', 'firms', 'livedata'],
    options: [{ id: 'show', label: 'Show', choices: [['all', 'Clouds, rain, storms and fire'], ['weather', 'Weather only'], ['fire', 'Fire glow and smoke only']], value: 'all' }],
    async load() {
      const [w, f] = await Promise.allSettled([getLocal('data/weather.json'), loadFireRows()]);
      if (w.status !== 'fulfilled') throw new Error('the weather grid is created when the site deploys — it appears once the Pages workflow has run (it refreshes every 6 hours)');
      if (!Array.isArray(w.value.cc)) throw new Error('this weather grid was made before cloud data was added; the next deploy (within 6 hours) brings it');
      G = w.value;
      // Fires: nominal and high confidence only, strongest first (the glow cap keeps the biggest).
      fires = f.status === 'fulfilled' ? f.value.rows.filter((r) => r[3] >= 1).sort((a, b) => b[2] - a[2]) : [];
      fireNote = f.status === 'fulfilled' ? `${fires.length.toLocaleString()} fires · ${f.value.src}` : 'fires unavailable right now';
      gridTextures(); buildCells(); lastView = null;
      const n = G.nlat * G.nlon; let rainPts = 0; let snowPts = 0; let ccSum = 0;
      for (let k = 0; k < n; k++) { ccSum += G.cc[k] ?? 0; if ((G.pr[k] ?? 0) >= 0.2) { rainPts += 1; if (isSnow(G.wc[k]) || (G.t[k] ?? 10) < 0.5) snowPts += 1; } }
      return { at: Date.parse(G.generatedAt), step: G.step, points: n, cover: ccSum / n, rainPts, snowPts, storms: stormInfo.storms, heavy: stormInfo.heavy, cells: cells.length, fires: fires.length, fireNote,
        statusNote: `${stormInfo.storms} thunderstorm grid points · ${rainPts} with rain or snow · ${fireNote}` };
    },
    channels() {
      const want = budget();
      if (!clouds) buildClouds();
      if (!rain || rain.userData.n !== want) { buildRain(want); lastView = null; }
      const ne = Math.min(18000, want * 3); const ns = Math.round(want / 2);
      if (!embers || embers.userData.n !== ne) { buildEmbers(ne); lastView = null; }
      if (!smoke || smoke.userData.n !== ns) { buildSmoke(ns); lastView = null; }
      if (clouds.material.uniforms.uSky.value !== skyTex) { clouds.material.uniforms.uSky.value = skyTex; clouds.material.uniforms.uAir.value = airTex; }
      if (!lastView) place(api.view());
      const show = api.state.opts.skyfx?.show ?? 'all';
      return { custom: [...(show !== 'fire' ? [CLOUDS, RAIN] : []), ...(show !== 'weather' ? [EMBERS, SMOKE] : [])] };
    },
    count: (d) => `${d.storms} storms`,
    describeLayer: (d) => ({ rows: [
      ['Grid', `${d.step}° (${d.points} points), mean cloud cover ${Math.round(d.cover)} %`],
      ['Thunderstorms', d.storms ? `${d.storms} grid points with WMO code 95–99 (${d.cells} flashing cells)` : d.heavy ? `none reported; ${d.heavy} very wet points glow faintly instead (heavy rain, not confirmed lightning)` : 'none reported right now'],
      ['Rain or snow', `${d.rainPts} grid points (${d.snowPts} snow)`],
      ['Fires', d.fireNote],
      ['Updated', new Date(d.at).toUTCString()],
      ['Source', 'Open-Meteo (CC BY 4.0) model analysis; NASA FIRMS'],
    ] }),
    learn: {
      what: 'The sky as it is right now, drawn the way it would look from space: clouds where the weather models say there are clouds, grey streaks of rain and white snowflakes falling where it is raining or snowing, lightning flickering inside thunderstorms, and wildfires glowing orange with smoke drifting downwind. Clouds on the night side are dark, so lightning and fires stand out best there.',
      how: 'Every 6 hours, when the site deploys, a script asks Open-Meteo for the current cloud cover, rainfall, temperature, wind and World Meteorological Organization (WMO) weather code at 1,740 points on a 6° grid. Your browser fills in the detail between points with 3D fractal noise (so the cloud texture is made up, but where the clouds are is not) and slides it along with the wind. Lightning flashes where the models put a thunderstorm (WMO codes 95 to 99): these are storms forecast for now, not individual strikes picked up by a lightning detector, and the flash timing is invented to look natural. Fires are NASA’s Fire Information for Resource Management System (FIRMS) hotspots from the last 24 hours; the glow is sized by fire radiative power (FRP), the heat each fire gives off, and smoke rises higher and further for hotter fires.',
      try: 'Spin to the night side and look for lightning in the tropics, then zoom right in on a storm to watch rain fall below the cloud. Find a big wildfire (turn on Fire hotspots to see the raw detections) and follow its smoke downwind. Turn on Wind and temperature as well to see the clouds move with the flow.',
      refs: ['openmeteo', 'wmocodes', 'firms', 'viirs', 'livedata'],
    },
    // for tests and tinkering
    cells: () => cells.map((c) => ({ lat: c.lat, lng: c.lng, kind: c.kind, grid: c.grid })),
    /** Test and screenshot hook: hold one stroke in every cell for ms (a real stroke is too short for a slow renderer). */
    flash: (ms = 1500) => { const now = performance.now(); for (const c of cells) { c.strokes = [{ s: now, d: ms, a: 1 }]; c.flashAt = c.at; c.next = now + ms + 2000; } },
    stats: () => ({ t: U.uT.value, snow: rain?.userData.snow ?? 0, rain: rain?.userData.used ?? 0, rainCap: rain?.userData.n ?? 0, embers: embers?.userData.used ?? 0, smoke: smoke?.userData.used ?? 0, objects: [clouds, rain, embers, smoke].filter(Boolean).length }),
  };
}
