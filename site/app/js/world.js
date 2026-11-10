// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the world around you up close (v2.19). Everything here comes from the same OpenStreetMap
// answer as the close-up roads (closeup.js), built in local metres (x east, y north, z up) and drawn in a handful of
// draw calls:
//   • Buildings with facades: rows of windows one storey (about 3.2 m) apart, glass curtain walls on towers, shop
//     windows at street level on shops and offices, brick, stone, plaster or concrete colours, roofs in slate,
//     terracotta or tar. They are lit by the real Sun (from its position now), so the sunny and shaded sides are
//     right, and after dark about a third of the windows glow, each its own warm or cool colour.
//   • The ground: parks, grass, woods and fields in their greens; rivers, canals, lakes and ponds with ripples that
//     catch the Sun and the sky; pavements beside every road; lane lines (yellow in the Americas, white elsewhere),
//     edge lines and zebra crossings.
//   • Trees: the ones mapped one by one in OpenStreetMap, plus trees scattered through parks and woods.
//   • Street lamps along town roads, each throwing a warm pool of light on the road after dark.
// Distant parts fade into the haze of the air, as they do when you look across a real city.
// The shapes, heights and places are real (OpenStreetMap); the windows, colours and lamps are drawn to look right,
// not mapped one by one.
import { THREE } from '../vendor/vendor.min.mjs';
import { buildingHeight, toLocal } from './landscape.js';

const D2R = Math.PI / 180;
// ------------------------------------------------------------------ pure helpers (tested in test_v219.py)
/** A seeded random number generator, so a place looks the same each time you come back. */
export const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Is a point inside a polygon (ray casting)? */
export function inside(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) c = !c; }
  return c;
}
/** Area of a polygon (m², always positive). */
export function area(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); }
/** What a piece of the map is, for the ground: 'water' | 'wood' | 'green' | 'sand' | 'river' (a line) | null. */
export function groundKind(t = {}) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.waterway && ['river', 'canal', 'stream'].includes(t.waterway)) return 'river';
  if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub') return 'wood';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (['park', 'garden', 'pitch', 'playground', 'golf_course', 'common', 'dog_park'].includes(t.leisure) || ['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'allotments', 'orchard', 'vineyard', 'farmland'].includes(t.landuse) || t.natural === 'grassland') return 'green';
  return null;
}
/** How wide a mapped river line is drawn when it has no mapped banks (m). */
export const RIVER_W = { river: 28, canal: 14, stream: 4 };
/** How many windows are lit at a local hour, relative to an ordinary evening: most in the evening, few after 1 a.m. */
export function windowsLit(hour) { const h = ((hour % 24) + 24) % 24; return h >= 17 && h < 23 ? 1.2 : h >= 23 || h < 1 ? 0.85 : h < 5 ? 0.3 : h < 8 ? 0.65 : 0.9; }
/** The look of a building from its tags and height: { style, floorH, levels }.
 *  style 0 punched windows (homes, flats), 1 glass curtain wall (towers and offices), 2 houses, 3 sheds and factories. */
export function facadeStyle(tags = {}, h = 10) {
  const b = tags.building; const lv = parseFloat(tags['building:levels']);
  const levels = Number.isFinite(lv) && lv > 0 ? lv : Math.max(1, Math.round(h / 3.2));
  const floorH = Math.max(2.6, Math.min(5, h / levels));
  let style = 0;
  if (['industrial', 'warehouse', 'garage', 'garages', 'shed', 'hut', 'roof', 'carport', 'barn', 'farm_auxiliary'].includes(b)) style = 3;
  else if (['house', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'farm'].includes(b) || (b === 'yes' && h <= 8)) style = 2;
  else if (h >= 45 || (['office', 'commercial'].includes(b) && h >= 20)) style = 1;
  return { style, floorH, levels };
}
/** Pieces of polygon from an Overpass relation: outer member ways joined end to end into closed rings. */
export function relationRings(el) {
  const parts = (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 2).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const rings = []; const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  while (parts.length) {
    let ring = parts.shift(); let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (same(ring.at(-1), p[0])) ring = ring.concat(p.slice(1)); else if (same(ring.at(-1), p.at(-1))) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// ------------------------------------------------------------------ shaders (all shading in the local metres)
const COMMON = `uniform float uNight; uniform float uLit; uniform float uT; uniform vec3 uSun; uniform vec3 uCam; uniform float uHaze;
vec3 haze(vec3 c, vec3 p) { float d = length(uCam - p); float f = 1.0 - exp(-d / uHaze); vec3 hz = mix(vec3(0.70, 0.79, 0.88), vec3(0.025, 0.035, 0.07), uNight); return mix(c, hz, f * 0.85); }
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`;
const BLD_VS = `attribute vec4 aFac; attribute vec3 aInfo; attribute vec3 aCol; varying vec4 vFac; varying vec3 vInfo; varying vec3 vCol; varying vec3 vN; varying vec3 vP;
void main() { vFac = aFac; vInfo = aInfo; vCol = aCol; vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BLD_FS = `${COMMON}
varying vec4 vFac; varying vec3 vInfo; varying vec3 vCol; varying vec3 vN; varying vec3 vP;
float box(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
void main() {
  vec3 n = normalize(vN); float sunUp = max(0.0, uSun.z);
  float lam = 0.38 + 0.62 * max(0.0, dot(n, uSun)) * smoothstep(-0.05, 0.12, uSun.z) + 0.12 * n.z;
  vec3 base = vCol * mix(lam, 0.10 + 0.05 * n.z, uNight);
  vec3 c = base;
  if (vFac.w < 0.5) { // a wall: windows
    float u = vFac.x; float v = vFac.y; float fh = vInfo.x; int style = int(vInfo.y + 0.5); float H = vInfo.z;
    float colW = style == 1 ? 1.6 : style == 3 ? 7.0 : 3.1;
    float fl = floor(v / fh); float fy = fract(v / fh); float ci = floor(u / colW); float cx = fract(u / colW);
    float aa = clamp(fwidth(u) / colW, 0.0, 1.0); float aay = clamp(fwidth(v) / fh, 0.0, 1.0);
    float w;
    if (style == 1) w = box(fy, 0.06, 0.94, aay) * box(cx, 0.05, 0.95, aa);
    else if (style == 3) w = box(fy, 0.55, 0.85, aay) * box(cx, 0.15, 0.85, aa) * step(0.5, fl + 0.5);
    else w = box(fy, 0.28, 0.82, aay) * box(cx, 0.24, 0.76, aa);
    if (fl < 0.5 && vInfo.y > 0.5 && vInfo.y < 1.5) w = box(fy, 0.08, 0.80, aay) * box(cx, 0.04, 0.96, aa); // shop windows at street level
    w *= step(0.6, v) * (1.0 - step(H - 0.7, v)); // none in the plinth or the parapet
    float cover = style == 1 ? 0.8 : style == 3 ? 0.1 : 0.28; // how much of a wall is glass, seen from far away
    float far = smoothstep(0.35, 0.8, max(aa, aay)); w = mix(w, cover, far);
    vec3 view = normalize(uCam - vP); float fres = pow(1.0 - max(dot(n, view), 0.0), 2.0);
    vec3 glass = mix(vec3(0.10, 0.14, 0.19), vec3(0.55, 0.68, 0.80), 0.25 + 0.6 * fres) * mix(0.55 + 0.45 * sunUp, 0.06, uNight);
    if (style == 1) glass = mix(glass, vec3(0.30, 0.45, 0.58) * mix(1.0, 0.1, uNight), 0.35);
    float h1 = hash(vec3(fl, ci, vFac.z)); float h2 = hash(vec3(ci + 7.0, fl * 1.7, vFac.z + 3.0));
    float share = (style == 3 ? 0.12 : style == 1 ? 0.40 : 0.32) * uLit;
    float lit = step(h1, share);
    vec3 lamp = mix(vec3(1.0, 0.78, 0.48), vec3(0.82, 0.88, 1.0), step(0.72, h2)) * (0.65 + 0.5 * h2);
    vec3 win = mix(glass, mix(glass, lamp, lit), uNight);
    win = mix(win, mix(glass, lamp, share * 0.9), far * uNight);
    c = mix(base, win, w);
  }
  gl_FragColor = vec4(haze(c, vP), 1.0);
}`;
const GND_VS = `attribute vec4 aC; attribute float aK; varying vec4 vC; varying float vK; varying vec3 vP;
void main() { vC = aC; vK = aK; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GND_FS = `${COMMON}
varying vec4 vC; varying float vK; varying vec3 vP;
void main() {
  vec3 c = vC.rgb; float day = 1.0 - uNight; float sun = smoothstep(-0.05, 0.25, uSun.z);
  c *= mix(0.55 + 0.45 * sun, 0.13, uNight);
  if (vK > 0.5) { // water: ripples that move with time, the sky in them at a glance, the Sun glinting
    vec2 q = vP.xy;
    float dx = cos(q.x * 0.31 + uT * 1.3) * 0.5 + cos((q.x + q.y) * 0.83 + uT * 2.1) * 0.25 + cos(q.x * 2.1 - q.y * 1.3 + uT * 3.3) * 0.1;
    float dy = cos(q.y * 0.27 - uT * 1.1) * 0.5 + cos((q.x - q.y) * 0.77 + uT * 1.7) * 0.25 + cos(q.y * 1.9 + q.x * 1.1 - uT * 2.9) * 0.1;
    vec3 n = normalize(vec3(dx * 0.09, dy * 0.09, 1.0));
    vec3 v = normalize(uCam - vP); float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    vec3 sky = mix(vec3(0.62, 0.76, 0.90), vec3(0.03, 0.05, 0.10), uNight);
    c = mix(c, sky, 0.15 + 0.7 * fres);
    vec3 h = normalize(v + uSun); c += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 220.0) * 2.2 * sun * day;
  }
  gl_FragColor = vec4(haze(c, vP), vC.a);
}`;
const POOL_VS = `attribute vec3 aAt; attribute float aR; varying vec2 vQ; varying vec3 vP;
void main() { vQ = position.xy; vec3 p = aAt + vec3(position.xy * aR, 0.0); vP = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const POOL_FS = `${COMMON}
varying vec2 vQ; varying vec3 vP;
void main() { float r = length(vQ); float a = (1.0 - smoothstep(0.0, 1.0, r)); a = a * a * 0.55 * uNight; float d = length(uCam - vP); a *= exp(-d / (uHaze * 1.4));
  gl_FragColor = vec4(vec3(1.0, 0.74, 0.42) * a, a); }`;

const GREENS = { green: [0.36, 0.55, 0.30], wood: [0.20, 0.38, 0.20], sand: [0.86, 0.80, 0.62] };
const WATER = [0.12, 0.30, 0.42];
const WALLS = [[0.80, 0.76, 0.69], [0.70, 0.45, 0.36], [0.86, 0.84, 0.80], [0.62, 0.60, 0.58], [0.78, 0.68, 0.52], [0.55, 0.34, 0.27], [0.90, 0.88, 0.82], [0.68, 0.70, 0.72]];
const TOWER = [[0.55, 0.62, 0.68], [0.42, 0.50, 0.56], [0.70, 0.72, 0.74], [0.36, 0.44, 0.50]];
const ROOFS = [[0.33, 0.33, 0.35], [0.45, 0.43, 0.40], [0.26, 0.27, 0.30], [0.55, 0.53, 0.50]];
const TILE_ROOFS = [[0.62, 0.30, 0.22], [0.50, 0.26, 0.20], [0.35, 0.36, 0.40], [0.45, 0.42, 0.38]];

/** All buildings as one mesh with facade attributes. Returns { mesh, count, glass, homes }. */
export function cityBuildings(buildings, lat0, lng0, material) {
  const P = []; const N = []; const F = []; const I = []; const C = []; let count = 0; let glass = 0; let homes = 0;
  const tri = (a, b, c, n, fa, fb, fc, info, col) => { P.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) { N.push(...n); I.push(...info); C.push(...col); } F.push(...fa, ...fb, ...fc); };
  for (const b of buildings) {
    let ring = b.geometry.map((g) => toLocal(lat0, lng0, g.lat, g.lon));
    if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
    if (ring.length < 3) continue;
    const v2 = ring.map(([x, y]) => new THREE.Vector2(x, y));
    if (THREE.ShapeUtils.isClockWise(v2)) { v2.reverse(); ring.reverse(); }
    const { h, min } = buildingHeight(b.tags ?? {}); const { style, floorH } = facadeStyle(b.tags, h);
    const R = seeded(Number(b.id) || count + 1); const seed = Math.floor(R() * 97);
    const wall = style === 1 ? TOWER[Math.floor(R() * TOWER.length)] : WALLS[Math.floor(R() * WALLS.length)];
    const roof = style === 2 ? TILE_ROOFS[Math.floor(R() * TILE_ROOFS.length)] : ROOFS[Math.floor(R() * ROOFS.length)];
    const shop = style === 0 && (['commercial', 'retail', 'office', 'hotel'].includes(b.tags?.building) || b.tags?.shop || R() < 0.25) ? 1 : style;
    const z0 = min; const z1 = h; const H = z1 - z0; let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const c = ring[(i + 1) % ring.length]; const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const n = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L, 0]; const info = [floorH, shop === 1 && style === 0 ? 1 : style, H];
      // u runs along the wall from a whole column, so windows never get cut at the corners
      const u0 = u; const u1 = u + L;
      tri([a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], n, [u0, 0, seed, 0], [u1, 0, seed, 0], [u1, H, seed, 0], info, wall);
      tri([a[0], a[1], z0], [c[0], c[1], z1], [a[0], a[1], z1], n, [u0, 0, seed, 0], [u1, H, seed, 0], [u0, H, seed, 0], info, wall);
      u = u1 + 1.3;
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) tri([ring[i][0], ring[i][1], z1], [ring[j][0], ring[j][1], z1], [ring[k][0], ring[k][1], z1], [0, 0, 1], [0, 0, seed, 1], [0, 0, seed, 1], [0, 0, seed, 1], [floorH, style, H], roof);
    count++; if (style === 1) glass++; if (style === 2) homes++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(F, 4)); g.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3));
  const mesh = new THREE.Mesh(g, material); mesh.name = 'buildings'; mesh.frustumCulled = false;
  return { mesh, count, glass, homes };
}

/** A strip `half` metres either side of a polyline, pushed as triangles at height z. */
function strip(P, pts, half, z, from = 0, to = Infinity) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]; const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / L) * half; const ny = ((bx - ax) / L) * half;
    P.push(ax + nx, ay + ny, z, ax - nx, ay - ny, z, bx + nx, by + ny, z, bx + nx, by + ny, z, ax - nx, ay - ny, z, bx - nx, by - ny, z);
  }
  return P;
}
const roadHalf = (w) => (w.oneway ? w.lanes : w.lanes * 2) * 1.75 + 0.6;

/**
 * Builds the world around (lat0, lng0) from an Overpass answer and the roads (closeup.js roadsFrom).
 * Returns { group, update({ night, t, camLocal, sunLocal, haze }), stats(), dispose() }.
 */
export function buildWorld(elements, lat0, lng0, roads, { americas = lng0 < -30, maxTrees = 7000 } = {}) {
  const group = new THREE.Group(); group.name = 'world';
  const uniforms = { uNight: { value: 0 }, uLit: { value: 1 }, uT: { value: 0 }, uSun: { value: new THREE.Vector3(0.3, 0.3, 0.9) }, uCam: { value: new THREE.Vector3(0, 0, 2000) }, uHaze: { value: 9000 } };
  const bldMat = new THREE.ShaderMaterial({ uniforms, vertexShader: BLD_VS, fragmentShader: BLD_FS, side: THREE.DoubleSide });
  const gndMat = new THREE.ShaderMaterial({ uniforms, vertexShader: GND_VS, fragmentShader: GND_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const R = seeded(Math.round(lat0 * 1000) * 7919 + Math.round(lng0 * 1000));
  const loc = (g) => toLocal(lat0, lng0, g.lat, g.lon);

  // ---- areas: parks, woods, water
  const areas = []; const rivers = []; const treesAt = [];
  for (const el of elements ?? []) {
    if (el.type === 'node' && el.tags?.natural === 'tree') { treesAt.push([...toLocal(lat0, lng0, el.lat, el.lon), 1]); continue; }
    const kind = groundKind(el.tags); if (!kind) continue;
    if (kind === 'river') { if (el.type === 'way' && el.geometry?.length >= 2) rivers.push({ pts: el.geometry.map(loc), w: RIVER_W[el.tags.waterway] ?? 10 }); continue; }
    const rings = el.type === 'way' && el.geometry?.length >= 4 ? [el.geometry.map((g) => [g.lat, g.lon])] : el.type === 'relation' ? relationRings(el) : [];
    for (const r of rings) {
      let ring = r.map(([la, lo]) => toLocal(lat0, lng0, la, lo)); if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 0.01) ring = ring.slice(0, -1);
      if (ring.length >= 3) areas.push({ kind, ring, a: area(ring) });
    }
  }
  // drawn biggest first, so a pond sits on its park
  areas.sort((a, b) => b.a - a.a);
  const GP = []; const GC = []; const GK = [];
  const fill = (P, col, alpha, k) => { for (let i = 0; i < P.length / 3; i++) { GC.push(col[0], col[1], col[2], alpha); GK.push(k); } for (let i = 0; i < P.length; i++) GP.push(P[i]); }; // (no spread: too many arguments for big towns)
  let z = 0.02;
  for (const a of areas) {
    const v2 = a.ring.map(([x, y]) => new THREE.Vector2(x, y)); if (THREE.ShapeUtils.isClockWise(v2)) v2.reverse();
    const P = []; for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) P.push(v2[i].x, v2[i].y, z, v2[j].x, v2[j].y, z, v2[k].x, v2[k].y, z);
    const water = a.kind === 'water'; const col = water ? WATER : GREENS[a.kind];
    const jit = 0.9 + R() * 0.2; fill(P, col.map((c) => c * jit), water ? 0.94 : 0.9, water ? 1 : 0); z += 0.002;
  }
  for (const r of rivers) fill(strip([], r.pts, r.w / 2, 0.03), WATER, 0.94, 1);
  // pavements, asphalt and markings
  const lane = americas ? [0.95, 0.78, 0.2] : [0.95, 0.95, 0.92]; const white = [0.95, 0.95, 0.92];
  for (const w of roads) fill(strip([], w.pts, roadHalf(w) + (w.cls.startsWith('motorway') ? 1 : 2.6), 0.06), [0.60, 0.59, 0.56], 0.88, 0);
  for (const w of roads) fill(strip([], w.pts, roadHalf(w), 0.07), [0.20, 0.22, 0.24], 0.92, 0);
  const marks = []; const zebra = [];
  for (const w of roads) {
    const half = roadHalf(w) - 0.6; const dash = w.cls.startsWith('motorway') ? [3, 9] : [3, 5];
    // dashed lines between lanes (and the centre line of a two-way road), every lane width across
    const lanesAll = w.oneway ? w.lanes : w.lanes * 2;
    for (let k = 1; k < lanesAll; k++) {
      const off = -half + (k * 2 * half) / lanesAll; const centre = !w.oneway && k === w.lanes;
      for (let s = 2; s < w.len - 2; s += dash[0] + dash[1]) {
        const p0 = along(w, s); const p1 = along(w, Math.min(w.len, s + dash[0]));
        const nx = -Math.sin(p0[2]) * off; const ny = Math.cos(p0[2]) * off;
        strip(centre ? marks.yellow ??= [] : marks, [[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny]], 0.22, 0.09);
      }
    }
    // solid edge lines on bigger roads, zebra crossings where town roads meet
    if (['motorway', 'trunk', 'primary', 'secondary'].includes(w.cls)) for (const side of [-1, 1]) strip(marks, w.pts.map(([x, y], i) => { const j = Math.min(w.pts.length - 1, i + 1); const i0 = j === i ? i - 1 : i; const a = Math.atan2(w.pts[j][1] - w.pts[i0][1], w.pts[j][0] - w.pts[i0][0]); return [x - Math.sin(a) * side * (half - 0.3), y + Math.cos(a) * side * (half - 0.3)]; }), 0.15, 0.09);
    if (!w.cls.startsWith('motorway') && !w.cls.startsWith('trunk')) {
      for (const s of [6, w.len - 6]) {
        if (w.len < 30) continue; const [x, y, a] = along(w, s); const ca = Math.cos(a); const sa = Math.sin(a);
        for (let q = -half + 0.5; q < half - 0.3; q += 1.2) { const cx = x - sa * q; const cy = y + ca * q; strip(zebra, [[cx - ca * 1.6, cy - sa * 1.6], [cx + ca * 1.6, cy + sa * 1.6]], 0.3, 0.09); }
      }
    }
  }
  fill(marks, white, 0.85, 0); fill(marks.yellow ?? [], lane, 0.9, 0); fill(zebra, white, 0.85, 0);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(GP, 3)); gg.setAttribute('aC', new THREE.Float32BufferAttribute(GC, 4)); gg.setAttribute('aK', new THREE.Float32BufferAttribute(GK, 1));
  const ground = new THREE.Mesh(gg, gndMat); ground.name = 'ground'; ground.frustumCulled = false; ground.renderOrder = 1; group.add(ground);

  // ---- trees: mapped ones, then scattered through parks and woods
  for (const a of areas) {
    if (a.kind !== 'green' && a.kind !== 'wood') continue;
    const n = Math.min(a.kind === 'wood' ? 2500 : 900, Math.floor(a.a / (a.kind === 'wood' ? 80 : 320)));
    let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity; for (const [x, y] of a.ring) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
    for (let i = 0, tries = 0; i < n && tries < n * 3 && treesAt.length < maxTrees; tries++) { const x = minx + R() * (maxx - minx); const y = miny + R() * (maxy - miny); if (inside(x, y, a.ring)) { treesAt.push([x, y, a.kind === 'wood' ? 2 : 0]); i++; } }
  }
  const nT = Math.min(maxTrees, treesAt.length);
  const crown = new THREE.IcosahedronGeometry(1, 0); crown.scale(2.6, 2.6, 2.3); crown.translate(0, 0, 6.2);
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 4.4, 6); trunk.rotateX(Math.PI / 2); trunk.translate(0, 0, 2.2);
  const treeGeo = mergeColoured([[crown, [0.27, 0.47, 0.22]], [trunk, [0.36, 0.27, 0.19]]]);
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, Math.max(1, nT)); trees.count = nT; trees.frustumCulled = false; trees.name = 'trees';
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3(); const at = new THREE.Vector3(); const zAxis = new THREE.Vector3(0, 0, 1); const col = new THREE.Color();
  for (let i = 0; i < nT; i++) {
    const [x, y, k] = treesAt[i]; const s = (k === 2 ? 0.9 : 0.75) + R() * 0.55;
    q.setFromAxisAngle(zAxis, R() * Math.PI * 2); sc.set(s, s, s * (0.85 + R() * 0.35)); at.set(x, y, 0); trees.setMatrixAt(i, m4.compose(at, q, sc));
    col.setRGB(0.75 + R() * 0.4, 0.8 + R() * 0.35, 0.7 + R() * 0.3); if (k === 2) col.multiplyScalar(0.75); trees.setColorAt(i, col);
  }
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  group.add(trees);

  // ---- street lamps: a pole every ~32 m on town roads, and a pool of light on the road after dark
  const lampsAt = [];
  for (const w of roads) {
    if (w.cls === 'service') continue; const both = ['motorway', 'trunk', 'primary', 'secondary'].includes(w.cls); const off = roadHalf(w) + 1.2;
    for (let s = 10, k = 0; s < w.len - 5 && lampsAt.length < 5000; s += 32, k++) {
      const [x, y, a] = along(w, s); const nx = -Math.sin(a); const ny = Math.cos(a);
      for (const side of both ? [1, -1] : [k % 2 ? 1 : -1]) lampsAt.push([x + nx * off * side, y + ny * off * side, a, side]);
    }
  }
  const poleGeo = mergeColoured([[new THREE.CylinderGeometry(0.09, 0.13, 8, 5).rotateX(Math.PI / 2).translate(0, 0, 4), [0.30, 0.31, 0.33]], [new THREE.BoxGeometry(0.12, 1.8, 0.12).translate(0, -0.9, 7.9), [0.30, 0.31, 0.33]], [new THREE.BoxGeometry(0.5, 0.6, 0.18).translate(0, -1.7, 7.8), [1, 0.92, 0.75]]]);
  const poles = new THREE.InstancedMesh(poleGeo, treeMat, Math.max(1, lampsAt.length)); poles.count = lampsAt.length; poles.frustumCulled = false; poles.name = 'lamp-posts';
  const poolGeo = new THREE.InstancedBufferGeometry(); poolGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const PA = new Float32Array(lampsAt.length * 3); const PR = new Float32Array(lampsAt.length);
  lampsAt.forEach(([x, y, a, side], i) => {
    q.setFromAxisAngle(zAxis, a + (side > 0 ? 0 : Math.PI)); at.set(x, y, 0); sc.set(1, 1, 1); poles.setMatrixAt(i, m4.compose(at, q, sc));
    const hx = x + Math.sin(a) * side * 1.7; const hy = y - Math.cos(a) * side * 1.7; PA.set([hx, hy, 0.12], i * 3); PR[i] = 9 + R() * 3;
  });
  poolGeo.setAttribute('aAt', new THREE.InstancedBufferAttribute(PA, 3)); poolGeo.setAttribute('aR', new THREE.InstancedBufferAttribute(PR, 1)); poolGeo.instanceCount = lampsAt.length;
  const pools = new THREE.Mesh(poolGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: POOL_VS, fragmentShader: POOL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pools.frustumCulled = false; pools.renderOrder = 2; pools.name = 'lamp-light';
  group.add(poles); group.add(pools);
  // the lamp heads themselves glow after dark
  const headGeo = new THREE.BufferGeometry(); const HP = new Float32Array(lampsAt.length * 3);
  lampsAt.forEach(([x, y, a, side], i) => HP.set([x + Math.sin(a) * side * 1.7, y - Math.cos(a) * side * 1.7, 7.7], i * 3));
  headGeo.setAttribute('position', new THREE.BufferAttribute(HP, 3));
  const heads = new THREE.Points(headGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  heads.frustumCulled = false; heads.renderOrder = 3; heads.name = 'lamp-heads'; group.add(heads);

  // ---- buildings
  const bl = (elements ?? []).filter((e) => e.type === 'way' && e.tags?.building && e.geometry?.length >= 4);
  const city = cityBuildings(bl, lat0, lng0, bldMat); if (city.count) group.add(city.mesh);

  const counts = { parks: areas.filter((a) => a.kind === 'green').length, woods: areas.filter((a) => a.kind === 'wood').length, water: areas.filter((a) => a.kind === 'water').length + rivers.length, trees: nT, mappedTrees: treesAt.filter((t) => t[2] === 1).length, lamps: lampsAt.length, buildings: city.count, glass: city.glass, homes: city.homes, marks: (marks.length + (marks.yellow?.length ?? 0) + zebra.length) / 18 };
  return {
    group, buildings: city.count ? city.mesh : null, uniforms,
    update({ night = 0, t = 0, camLocal, sunLocal, haze, hour = 21 } = {}) {
      uniforms.uNight.value = night; uniforms.uLit.value = windowsLit(hour); uniforms.uT.value = t; if (camLocal) uniforms.uCam.value.copy(camLocal); if (sunLocal) uniforms.uSun.value.copy(sunLocal).normalize();
      if (haze) uniforms.uHaze.value = haze; treeMat.color.setScalar(1 - night * 0.82); pools.visible = night > 0.05; heads.visible = night > 0.3; heads.material.opacity = night;
    },
    stats: () => ({ ...counts, night: uniforms.uNight.value, lampsOn: pools.visible, windowsLit: uniforms.uLit.value }),
    dispose() { group.traverse((o) => { o.geometry?.dispose(); }); for (const m of [bldMat, gndMat, treeMat, pools.material, heads.material]) m.dispose(); group.removeFromParent(); },
  };
}

/** Position and heading along a road (as closeup.js along()). */
function along(w, s) {
  let i = 1; while (i < w.cum.length - 1 && w.cum[i] < s) i++;
  const a = w.pts[i - 1]; const b = w.pts[i]; const seg = w.cum[i] - w.cum[i - 1] || 1; const t = Math.max(0, Math.min(1, (s - w.cum[i - 1]) / seg));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
}
/** Several geometries, each in one colour, merged into one with vertex colours. */
function mergeColoured(list) {
  const pos = []; const nor = []; const col = [];
  for (const [g0, c] of list) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (let i = 0; i < g.attributes.position.count; i++) col.push(...c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
/** The Sun's direction in local east, north, up components, from its direction on the globe. */
export function sunLocal(sunWorld, frame) { const [e, n, u] = [frame.e, frame.n, frame.u]; const d = (a) => sunWorld.x * a[0] + sunWorld.y * a[1] + sunWorld.z * a[2]; return new THREE.Vector3(d(e), d(n), d(u)); }
export const DEG = D2R;
