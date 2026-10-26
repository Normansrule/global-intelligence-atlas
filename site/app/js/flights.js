// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — live flights.
// Every aircraft is drawn as a plane-shaped pointer, turned to its real heading, in ONE instanced
// mesh (tens of thousands of planes cost a single draw call). Selecting a flight opens a
// "seatback" moving-map panel like the ones on airline screens: altitude, speed, outside air
// temperature, route progress, time to go, weather at the destination and a photo of the aircraft.

import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed, getSnapshot, isDesktop, liveProxy, viaOf, feedsReady } from './feeds.js';
import { haversineKm, greatCirclePoints, fmtLat, fmtLng, localSolarTime } from './astro.js';
import { classOf, planeGeometry as modelGeometry, CLASS_IDS, CLASSES, trueHalfLength } from './planes3d.js';
import { mountPlaneView } from './planeview.js';
let planeView = null;

const R = 100;
const MAX = 20000;
const history = new Map(); // icao -> [[lat, lng, altFt, t], ...]
let group = null; const meshes = {}; let lastList = []; const WRAP = { obj: null }; // one stable datum, so globe.gl never swaps (and removes) the shared meshes
export const flightState = { selected: null, follow: false, route: {}, trails: true };

// --------------------------------------------------------------- data
function fromAdsbLol(j) {
  return (j.ac ?? []).filter((a) => a.lat != null && a.lon != null).map((a) => ({
    id: a.hex, call: (a.flight ?? '').trim(), lat: a.lat, lng: a.lon,
    altFt: typeof a.alt_baro === 'number' ? a.alt_baro : 0, ground: a.alt_baro === 'ground',
    kt: a.gs ?? null, trk: a.track ?? a.true_heading ?? 0, vs: a.baro_rate ?? null,
    type: a.t, reg: a.r, desc: a.desc, squawk: a.squawk, cat: a.category,
  }));
}
function fromOpenSky(j) {
  return (j.states ?? []).filter((s) => s[5] != null && s[6] != null).map((s) => ({
    id: s[0], call: (s[1] ?? '').trim(), lat: s[6], lng: s[5], country: s[2],
    altFt: (s[13] ?? s[7] ?? 0) * 3.281, ground: !!s[8], kt: s[9] != null ? s[9] * 1.944 : null,
    trk: s[10] ?? 0, vs: s[11] != null ? s[11] * 196.85 : null, squawk: s[14], cat: s[17] > 1 ? s[17] : undefined,
  }));
}

// Rows from the live-data snapshot (tools/fetch-live.mjs), turned into the same objects as the live parsers.
let snapRows = null; let snapKey = '';
function fromSnapshot(j) {
  const key = `${j.generatedAt}|${j.ac?.length}`;
  if (snapKey === key) return snapRows;
  const f = j.fields; const k = Object.fromEntries(f.map((n, i) => [n, i]));
  snapRows = (j.ac ?? []).map((r) => ({ id: r[k.id], call: r[k.call] ?? '', lat0: r[k.lat], lng0: r[k.lng], lat: r[k.lat], lng: r[k.lng], altFt: r[k.altFt] ?? 0, ground: !!r[k.ground],
    kt: r[k.kt], trk: r[k.trk] ?? 0, vs: r[k.vs], squawk: r[k.squawk] ?? undefined, type: r[k.type] ?? undefined, reg: r[k.reg] ?? undefined, cat: k.cat != null ? r[k.cat] ?? undefined : undefined }));
  snapKey = key; return snapRows;
}
/** Dead reckoning: move each airborne plane along its heading at its speed since the snapshot was taken. */
function projectForward(list, ageMin) {
  const hrs = Math.min(ageMin, 25) / 60;
  for (const a of list) {
    if (a.ground || !a.kt || a.kt < 50) { a.lat = a.lat0; a.lng = a.lng0; continue; }
    const km = a.kt * 1.852 * hrs; const h = (a.trk ?? 0) * Math.PI / 180;
    const lat = Math.max(-89, Math.min(89, a.lat0 + (km * Math.cos(h)) / 111.2));
    let lng = a.lng0 + (km * Math.sin(h)) / (111.2 * Math.max(0.05, Math.cos(a.lat0 * Math.PI / 180)));
    lng = ((lng + 540) % 360) - 180;
    a.lat = Math.round(lat * 1e4) / 1e4; a.lng = Math.round(lng * 1e4) / 1e4;
  }
  return list;
}
const ago = (min) => (min < 1.5 ? 'under 2 min' : min < 90 ? `${Math.round(min)} min` : `${Math.round(min / 60)} h`);
async function snapshotFlights() {
  const j = await getSnapshot('livedata', 'flights.json', { ttl: 60_000 });
  const age = (Date.now() - Date.parse(j.generatedAt)) / 60_000;
  const ac = projectForward(fromSnapshot(j), age);
  return {
    src: `${j.src} · snapshot ${ago(age)} old`, ac, snapshotAge: age,
    statusNote: `${ac.length.toLocaleString()} aircraft from the live-data snapshot (${ago(age)} old${age > 1 ? ', positions projected forward along each heading' : ''}).${age > 40 ? ' The snapshot is stale: check the “Live data snapshot” workflow on GitHub.' : ''}`,
  };
}
const canReachLive = () => isDesktop || !!liveProxy();
let regionalFailed = false; // web without proxy: after one refusal, stop asking community exchanges this session

async function liveRegional(lat, lng) {
  const la = lat.toFixed(2); const lo = lng.toFixed(2);
  const tries = [
    ['airplaneslive', 'airplanes.live', `https://api.airplanes.live/v2/point/${la}/${lo}/250`],
    ['adsblol', 'adsb.lol', `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/250`],
    ['adsbfi', 'adsb.fi', `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/250`],
  ];
  let last = null;
  for (const [id, name, url] of tries) {
    try { const ac = fromAdsbLol(await getFeed(id, url, { ttl: 8_000, timeout: 12_000 })); if (!ac.length) throw new Error(`${name}: no aircraft here`); return { src: `${name} · live, within 250 nm of view${viaOf(url) === 'proxy' ? ' (via your proxy)' : ''}`, ac, statusNote: `${ac.length.toLocaleString()} aircraft live from ${name} near the centre of the view.` }; } catch (e) { last = e; }
  }
  throw last;
}
async function liveWorld() {
  const url = 'https://opensky-network.org/api/states/all';
  const ac = fromOpenSky(await getFeed('opensky', url, { ttl: 85_000, timeout: 30_000 }));
  if (ac.length < 500) throw new Error('OpenSky returned almost nothing');
  return { src: `OpenSky Network · live, worldwide${viaOf(url) === 'proxy' ? ' (via your proxy)' : isDesktop ? ' (desktop app)' : ''}`, ac, statusNote: `${ac.length.toLocaleString()} aircraft live from the OpenSky Network, refreshed every 90 seconds.` };
}

// --------------------------------------------------------------- aircraft types (the `aircraft-db` branch)
const knownTypes = new Map(); const typeShards = new Map(); let onTypes = null;
const typeShard = (k) => {
  if (!typeShards.has(k)) typeShards.set(k, getSnapshot('aircraftdb', `types/${k}.json`, { branch: 'aircraft-db', ttl: Infinity }).catch(() => null));
  return typeShards.get(k);
};
/** Look up types for these aircraft (at most `max` new table slices per call). Resolves to how many were found. */
export async function fillTypes(list, max = 16) {
  const by = new Map();
  for (const a of list) { if (a.type || !a.id) continue; const k = a.id.slice(0, 2); if (!by.has(k)) by.set(k, []); by.get(k).push(a); }
  let found = 0;
  await Promise.all([...by].slice(0, max).map(async ([k, as]) => {
    const shard = await typeShard(k); if (!shard) return;
    for (const a of as) { const t = shard[a.id]; if (!t) continue; knownTypes.set(a.id, t); a.type = t[0]; a.reg ??= t[1] || undefined; a.icaoClass = t[2]; found += 1; }
  }));
  return found;
}

async function loadFlights(o, ctx) {
  await feedsReady;
  const { lat, lng } = ctx.pov;
  const errors = [];
  const attempt = async (fn) => { try { return await fn(); } catch (e) { errors.push(e.message); return null; } };
  let res = null;
  if (o.scope === 'near') {
    if (canReachLive() || !regionalFailed) { res = await attempt(() => liveRegional(lat, lng)); if (!res && !canReachLive()) regionalFailed = true; }
    if (!res) res = await attempt(snapshotFlights);
  } else {
    if (canReachLive()) res = await attempt(liveWorld);
    if (!res) res = await attempt(snapshotFlights);
    if (!res && (canReachLive() || !regionalFailed)) { res = await attempt(() => liveRegional(lat, lng)); if (!res && !canReachLive()) regionalFailed = true; }
  }
  if (!res) {
    throw Object.assign(new Error(errors.join(' · ') || 'no flight source answered'), {
      help: isDesktop
        ? `No flight source answered (${errors.join('; ')}). The desktop app asks OpenSky, airplanes.live, adsb.lol and adsb.fi directly, so check your internet connection or firewall; it retries every few seconds.`
        : `No flight source answered (${errors.join('; ')}). Browsers block direct requests to flight trackers (they send no CORS headers), so the website reads a snapshot that GitHub Actions rebuilds every 10 minutes. If you run your own copy: GitHub → Actions → “Live data snapshot” → Run workflow, then reload. Or use the desktop app, which reads flights live.`,
    });
  }
  const now = Date.now();
  for (const a of res.ac) {
    const h = history.get(a.id) ?? [];
    const last = h.at(-1);
    if (!last || last[0] !== a.lat || last[1] !== a.lng) h.push([a.lat, a.lng, a.altFt, now]);
    if (h.length > 60) h.shift();
    history.set(a.id, h);
  }
  if (history.size > 60000) for (const k of [...history.keys()].slice(0, 20000)) history.delete(k);
  // Types: the snapshot already carries them; live feeds (OpenSky) do not, so planes near the view are looked up
  // in the weekly type table and remembered for the session.
  for (const a of res.ac) { const t = knownTypes.get(a.id); if (t && !a.type) { a.type = t[0]; a.reg ??= t[1] || undefined; a.icaoClass = t[2]; } }
  if (res.snapshotAge == null) { const v = ctx.view; fillTypes(res.ac.filter((a) => !a.type && Math.abs(a.lat - v.lat) * 111 < v.radiusKm * 1.3)).then((n) => { if (n) onTypes?.(); }); }
  // Base fix for gliding: between refreshes each plane keeps moving along its heading at its speed.
  for (const a of res.ac) { a._bLat = a.lat; a._bLng = a.lng; a._bT = now; a.src = res.src; }
  return res;
}

/** Move every airborne plane forward from its last fix (dead reckoning, at most 3 minutes ahead). */
function glideTo(list, now) {
  for (const a of list) {
    if (a._bT == null || a.ground || !a.kt || a.kt < 50) continue;
    const hrs = Math.min(now - a._bT, 180_000) / 3.6e6; const km = a.kt * 1.852 * hrs; const h = (a.trk ?? 0) * Math.PI / 180;
    a.lat = Math.max(-89.5, Math.min(89.5, a._bLat + (km * Math.cos(h)) / 111.2));
    a.lng = ((a._bLng + (km * Math.sin(h)) / (111.2 * Math.max(0.05, Math.cos(a._bLat * Math.PI / 180))) + 540) % 360) - 180;
  }
}
let lastPick = [];
/** Called a few times a second: planes glide smoothly instead of jumping at each refresh. */
let rebasedAt = 0;
export function glidePlanes(globe, camAlt) {
  if (!lastList.length) return null;
  const now = Date.now();
  const sel = flightState.selected ? lastList.find((a) => a.id === flightState.selected) ?? null : null;
  if (now - rebasedAt > 5000) { // the shader does the in-between motion; re-base the true positions every 5 s
    rebasedAt = now;
    layoutPlanes(globe, camAlt, lastList);
    for (const p of lastPick) { const a = p.ref.d; p.lat = a.lat; p.lng = a.lng; p.alt = a._alt ?? p.alt; }
    lastPick.__v = now; // the click index for planes is rebuilt next time markers are laid out
  } else if (sel) glideTo([sel], now); // the selected plane's numbers and the follow camera stay exact
  return sel;
}
export const flightsNow = () => lastList;

// --------------------------------------------------------------- planes drawn by type
// One instanced mesh per aircraft class (planes3d.js), so the whole fleet is still only eight draw calls.
// Zoomed out, each class is a flat top-view silhouette; below about 760 km the meshes switch to low-poly 3D
// models, lit by the scene lights, and only the planes near the view are drawn (the rest are off-screen).
// Planes glide on the GPU: each instance carries its velocity, and the vertex shader moves it by
// velocity × seconds since the last layout. Motion is perfectly smooth at any frame rate and costs
// nothing on the CPU; the CPU only re-bases positions every few seconds.
const glide = { value: 0 }; let layoutAt = performance.now();
const KT_TO_UNITS_PER_S = 0.514444 / 1000 / (6371 / R); // knots → globe units per second
const LOD_3D = 0.12; // camera altitude (globe radii) below which planes are 3D
function glideMaterial(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDt = glide;
    sh.vertexShader = `attribute vec3 instanceVel;\nuniform float uDt;\n${sh.vertexShader.replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  mvPosition.xyz += instanceVel * uDt;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`)}`;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
let mat2d = null; let mat3d = null; let lod = '2d';
function ensureMesh() {
  if (group) return group;
  mat2d = glideMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 'gia-plane-glide');
  mat3d = glideMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x56626e, flatShading: true, side: THREE.DoubleSide }), 'gia-plane-glide-3d');
  group = new THREE.Group(); group.raycast = () => {};
  for (const cls of CLASS_IDS) {
    const cap = cls === 'narrow' ? MAX : 12000;
    const vel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geo = { '2d': modelGeometry(cls, '2d').clone(), '3d': modelGeometry(cls, '3d').clone() };
    for (const g of Object.values(geo)) g.setAttribute('instanceVel', vel);
    const m = new THREE.InstancedMesh(geo['2d'], mat2d, cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.renderOrder = 5; m.raycast = () => {}; m.visible = false;
    m.userData = { cap, vel, geo };
    m.onBeforeRender = () => { glide.value = Math.min(30, (performance.now() - layoutAt) / 1000); };
    meshes[cls] = m; group.add(m);
  }
  group.add(ensureTrails());
  return group;
}
// --------------------------------------------------------------- contrails
// Every airborne plane draws a short trail that fades out behind it, so you can see at a glance which way the
// traffic is flowing. All trails are ONE instanced ribbon (one draw call for 20,000 planes): each instance
// carries the plane's position, velocity, nose and wing directions, and the vertex shader bends a strip of
// 2 × (SEG + 1) vertices out behind the tail and glides it with the plane. The trail's length follows the
// plane's speed and its drawn size, so it reads the same on screen at every zoom.
const SEG = 6;
const TRAIL_VERT = `
attribute vec2 st; // s: 0 at the plane's tail to 1 at the end of the trail; t: −1 or +1 across it
attribute vec3 iHead; attribute vec3 iVel; attribute vec3 iDir; attribute vec3 iSide; attribute vec3 iCol; attribute vec2 iLen; // iLen: plane half-length, trail length
uniform float uDt;
varying float vA; varying vec3 vCol;
void main() {
  float s = st.x;
  vec3 p = iHead + iVel * uDt - iDir * (iLen.x * 0.7 + s * iLen.y) + iSide * (st.y * iLen.x * 0.16 * (1.0 - 0.6 * s));
  vA = pow(1.0 - s, 1.7); vCol = iCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const TRAIL_FRAG = `
uniform float uAlpha;
varying float vA; varying vec3 vCol;
void main() { if (vA < 0.01) discard; gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.45), vA * uAlpha); }`;
let trailMesh = null;
function ensureTrails() {
  if (trailMesh) return trailMesh;
  const geo = new THREE.InstancedBufferGeometry();
  const st = []; const idx = [];
  for (let i = 0; i <= SEG; i++) { st.push(i / SEG, -1, i / SEG, 1); if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } }
  geo.setAttribute('st', new THREE.Float32BufferAttribute(st, 2)); geo.setIndex(idx);
  // three.js needs a position attribute to count vertices; the shader never reads it
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
  for (const [k, n] of [['iHead', 3], ['iVel', 3], ['iDir', 3], ['iSide', 3], ['iCol', 3], ['iLen', 2]]) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: { uDt: glide, uAlpha: { value: 0.5 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  trailMesh = new THREE.Mesh(geo, mat);
  trailMesh.frustumCulled = false; trailMesh.raycast = () => {}; trailMesh.renderOrder = 4; trailMesh.visible = false;
  trailMesh.onBeforeRender = () => { glide.value = Math.min(30, (performance.now() - layoutAt) / 1000); };
  return trailMesh;
}
export const trailCount = () => (trailMesh?.visible ? trailMesh.geometry.instanceCount : 0);
function setLod(next) {
  if (next === lod) return; lod = next;
  for (const m of Object.values(meshes)) { m.geometry = m.userData.geo[lod]; m.material = lod === '3d' ? mat3d : mat2d; }
}
const tmp = { c: new THREE.Color() };
export const EMERGENCY = new Set(['7500', '7600', '7700', 7500, 7600, 7700]);
const altColor = (ft, ground) => (ground ? '#8aa0b3' : ft < 10000 ? '#7ed6c4' : ft < 25000 ? '#ffd37a' : '#f2f5f7');
// Heights are exaggerated so you can see them, but only gently from far away (planes floating hundreds of
// km up made a fuzzy halo around the planet's edge). Up close they are at their true height, so the view
// from a low camera is a real ground-level perspective.
const exaggeration = (camAlt) => 1 + Math.min(8, camAlt * 5);
const liftOf = (camAlt) => Math.min(0.0004, Math.max(0.000004, camAlt * 0.0016)); // keeps planes off the ground layer
// Never above 60 % of the camera height: zoomed right in on a plane cruising at 11 km, it would otherwise be
// behind the camera and vanish. Squeezing the height down keeps it in view all the way to the closest zoom.
export const planeAlt = (a, camAlt) => (a.ground ? liftOf(camAlt) * 0.5 : Math.min(camAlt * 0.6, liftOf(camAlt) + (a.altFt / 3281 / 6371) * exaggeration(camAlt)));

/** Place every plane. Size follows the camera so planes stay a readable size on screen, until you are close
    enough to see them at their real size. Written straight into the instance buffers with plain maths (no
    per-plane library calls), because it runs twice a second for up to 20,000 planes while they glide. */
const D2R = Math.PI / 180;
const colorCache = new Map();
const rgbOf = (hex) => { let c = colorCache.get(hex); if (!c) { tmp.c.set(hex); c = [tmp.c.r, tmp.c.g, tmp.c.b]; colorCache.set(hex, c); } return c; };
let view = { x: 0, y: 0, z: 1, cosCut: -2 };
export function layoutPlanes(globe, camAlt, list = lastList) {
  ensureMesh(); lastList = list;
  glideTo(list, Date.now()); // start from where each plane is now, so a re-layout never makes planes jump back
  setLod(camAlt < LOD_3D ? '3d' : '2d');
  const size = Math.max(0.00002, Math.min(1.3, camAlt * R * 0.0115)) * (lod === '3d' ? 1.5 : 1); // 3D models a little larger, to read their shape
  // up close only planes near the view are drawn (the visible ground plus a wide margin for gliding)
  if (lod === '3d') {
    const pov = globe.pointOfView(); const phi = (90 - pov.lat) * D2R; const th = (90 - pov.lng) * D2R;
    const horizon = Math.acos(1 / (1 + camAlt)); const cut = Math.min(horizon, camAlt * 1.1) + 150 / 6371; // the camera always looks straight down: half the screen diagonal is about 0.9 × its height
    view = { x: Math.sin(phi) * Math.cos(th), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(th), cosCut: Math.cos(cut), lat: pov.lat, lng: pov.lng, cut };
  } else view = { x: 0, y: 0, z: 1, cosCut: -2 };
  layoutAt = performance.now(); glide.value = 0;
  const n = {}; for (const c of CLASS_IDS) n[c] = 0;
  const T = trailMesh.geometry.attributes; let nt = 0; const trails = flightState.trails;
  for (const a of list) {
    const phi = (90 - a.lat) * D2R; const th = (90 - a.lng) * D2R;
    const sp = Math.sin(phi); const cp = Math.cos(phi); const st = Math.sin(th); const ct = Math.cos(th);
    const ux = sp * ct; const uy = cp; const uz = sp * st; // up
    if (ux * view.x + uy * view.y + uz * view.z < view.cosCut) { a._alt = planeAlt(a, camAlt); continue; }
    const cls = classOf(a); const m = meshes[cls]; const i = n[cls];
    if (i >= m.userData.cap) continue;
    const alt = planeAlt(a, camAlt); const rr = R * (1 + alt);
    const ex_ = st; const ez = -ct; // east (y = 0)
    const nx = -cp * ct; const ny = sp; const nz = -cp * st; // north
    const h = (a.trk ?? 0) * D2R; const ch = Math.cos(h); const sh = Math.sin(h);
    const dx = nx * ch + ex_ * sh; const dy = ny * ch; const dz = nz * ch + ez * sh; // nose direction
    const rx = dy * uz - dz * uy; const ry = dz * ux - dx * uz; const rz = dx * uy - dy * ux; // right wing = nose × up
    const sel = flightState.selected === a.id; const em = EMERGENCY.has(a.squawk);
    const k = Math.max(trueHalfLength(cls), size * CLASSES[cls].scale) * (sel || em ? 2.2 : 1);
    const M = m.instanceMatrix.array; const o = i * 16;
    M[o] = rx * k; M[o + 1] = ry * k; M[o + 2] = rz * k; M[o + 3] = 0;
    M[o + 4] = dx * k; M[o + 5] = dy * k; M[o + 6] = dz * k; M[o + 7] = 0;
    M[o + 8] = ux * k; M[o + 9] = uy * k; M[o + 10] = uz * k; M[o + 11] = 0;
    M[o + 12] = ux * rr; M[o + 13] = uy * rr; M[o + 14] = uz * rr; M[o + 15] = 1;
    const col = rgbOf(sel ? '#f07a63' : em ? '#ff3b30' : altColor(a.altFt, a.ground));
    const C = m.instanceColor.array; C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
    const v = a.ground || !a.kt ? 0 : a.kt * KT_TO_UNITS_PER_S; const V = m.userData.vel.array; V[i * 3] = dx * v; V[i * 3 + 1] = dy * v; V[i * 3 + 2] = dz * v;
    if (trails && v > 0 && nt < MAX) { // the trail: 3 to 9 half-lengths of the drawn plane, by speed (so it reads the same at every zoom)
      const len = k * Math.max(3, Math.min(9, a.kt / 70));
      T.iHead.array.set([ux * rr, uy * rr, uz * rr], nt * 3); T.iVel.array.set([dx * v, dy * v, dz * v], nt * 3);
      T.iDir.array.set([dx, dy, dz], nt * 3); T.iSide.array.set([rx, ry, rz], nt * 3); T.iCol.array.set(col, nt * 3); T.iLen.array.set([k, len], nt * 2); nt++;
    }
    a._alt = alt; n[cls] = i + 1;
  }
  trailMesh.geometry.instanceCount = nt; trailMesh.visible = nt > 0;
  for (const key of ['iHead', 'iVel', 'iDir', 'iSide', 'iCol', 'iLen']) { const at = T[key]; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, Math.max(at.itemSize, nt * at.itemSize)); at.needsUpdate = true; }
  trailMesh.material.uniforms.uAlpha.value = lod === '3d' ? 0.35 : 0.5;
  for (const cls of CLASS_IDS) {
    const m = meshes[cls]; const i = n[cls]; m.count = i; m.visible = i > 0; if (!i) continue;
    const im = m.instanceMatrix; im.clearUpdateRanges?.(); im.addUpdateRange?.(0, i * 16); im.needsUpdate = true;
    const c = m.instanceColor; c.clearUpdateRanges?.(); c.addUpdateRange?.(0, i * 3); c.needsUpdate = true;
    const va = m.userData.vel; va.clearUpdateRanges?.(); va.addUpdateRange?.(0, i * 3); va.needsUpdate = true;
  }
}
/** Compile the 3D plane shader in the background at start-up, so the first close zoom does not stall while
    the graphics driver builds it (compileAsync uses parallel shader compilation where the browser has it). */
export function warmPlanes(globe) {
  ensureMesh();
  const renderer = globe.renderer(); const scene = globe.scene();
  const m = new THREE.InstancedMesh(meshes.narrow.userData.geo['3d'], mat3d, 1);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
  m.setMatrixAt(0, new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6)); m.frustumCulled = false; m.raycast = () => {};
  // the trail shader, compiled with the planes: a mesh that shares its buffers but draws nothing, so it costs nothing even if it stays
  const tg = new THREE.InstancedBufferGeometry(); const src = ensureTrails().geometry;
  for (const [k, a] of Object.entries(src.attributes)) tg.setAttribute(k, a); tg.setIndex(src.index); tg.instanceCount = 0;
  const tr = new THREE.Mesh(tg, trailMesh.material); tr.frustumCulled = false; tr.raycast = () => {};
  scene.add(m); scene.add(tr);
  const done = () => { scene.remove(m); scene.remove(tr); m.dispose?.(); };
  // globe.gl draws through a post-processing composer, which may draw straight to the screen (sRGB output) or
  // into a render target (linear output); three.js builds a different shader for each, so warm both.
  const composer = globe.postProcessingComposer?.(); const prev = renderer.getRenderTarget(); const jobs = [];
  try {
    for (const rt of [null, composer?.readBuffer].filter((x, i) => i === 0 || x)) {
      renderer.setRenderTarget(rt);
      jobs.push(renderer.compileAsync ? renderer.compileAsync(scene, globe.camera()) : Promise.resolve(renderer.compile(scene, globe.camera())));
    }
  } catch { /* fall through */ } finally { renderer.setRenderTarget(prev); }
  Promise.allSettled(jobs).then(done);
}
/** Up close only nearby planes are drawn, so a pan of more than a third of that radius needs a new layout. */
export function planesStale(pov) {
  if (lod !== '3d' || view.cut == null) return false;
  return haversineKm(view.lat, view.lng, pov.lat, pov.lng) > (view.cut * 6371) / 3;
}
export const planeCounts = () => Object.fromEntries(CLASS_IDS.map((c) => [c, meshes[c]?.count ?? 0]));

// --------------------------------------------------------------- enrichment (adsbdb)
async function aircraftInfo(hex) {
  try { return (await getFeed('adsbdb', `https://api.adsbdb.com/v0/aircraft/${hex}`, { ttl: 86_400_000 })).response?.aircraft ?? null; } catch { return null; }
}
async function routeInfo(call) {
  if (!call) return null;
  if (flightState.route[call] !== undefined) return flightState.route[call];
  try { flightState.route[call] = (await getFeed('adsbdb', `https://api.adsbdb.com/v0/callsign/${call}`, { ttl: 86_400_000 })).response?.flightroute ?? null; } catch { flightState.route[call] = null; }
  return flightState.route[call];
}
/** Standard-atmosphere outside air temperature — what the seatback screen is estimating too. */
const isaTempC = (ft) => { const km = ft / 3281; return km <= 11 ? 15 - 6.5 * km : -56.5; };

// --------------------------------------------------------------- the layer
export function flightsLayer(api) {
  return {
    id: 'aircraft', group: 'live', label: 'Live flights', swatch: '#8ecbff', on: false, refresh: 12_000, pinless: true,
    sources: ['opensky', 'adsblol', 'airplaneslive', 'adsbdb', 'livedata'],
    options: [{ id: 'scope', label: 'Coverage', choices: [['world', 'Whole world'], ['near', 'Near my view (more detail)']], value: 'world' }, { id: 'trails', label: 'Trails', choices: [['on', 'Trails behind planes'], ['off', 'No trails']], value: 'on' }],
    load: (o, ctx) => { flightState.trails = o.trails !== 'off'; onTypes ??= () => api.refreshLayer('aircraft', { soft: true }); return loadFlights(o, ctx); },
    channels(d, ctx) {
      layoutPlanes(ctx.globe, ctx.pov.altitude, d.ac);
      WRAP.obj = ensureMesh();
      lastPick = d.ac.map((a) => ({ lat: a.lat, lng: a.lng, alt: a._alt ?? 0, ref: { layer: 'aircraft', d: a } }));
      const out = { custom: [WRAP], pick: lastPick };
      const em = d.ac.filter((a) => EMERGENCY.has(a.squawk));
      if (em.length) out.rings = em.map((a) => ({ lat: a.lat, lng: a.lng, color: '#ff3b30', maxR: 1.6, speed: 2, period: 900 }));
      const sel = d.ac.find((a) => a.id === flightState.selected);
      if (sel) {
        const h = history.get(sel.id) ?? [];
        if (h.length > 1) out.paths = [{ pts: h.map(([la, lo, ft]) => [la, lo, planeAlt({ altFt: ft }, ctx.pov.altitude)]), color: ['rgba(240,122,99,0.1)', 'rgba(240,122,99,0.95)'], stroke: 0.6, passive: true }];
        const r = flightState.route[sel.call];
        if (r?.destination) out.arcs = [{ sLat: sel.lat, sLng: sel.lng, eLat: r.destination.latitude, eLng: r.destination.longitude, color: ['rgba(227,181,91,0.9)', 'rgba(227,181,91,0.2)'], stroke: 0.5, alt: 0.02, dashLen: 0.03, dashGap: 0.015, animMs: 3000 }];
        if (flightState.follow) api.followTo(sel.lat, sel.lng);
        if (api.isOpen(`flight:${sel.id}`)) updateDeck(sel);
      }
      return out;
    },
    open: (a) => openDeck(a, api),
    learn: {
      what: 'Aircraft broadcasting their position right now. Planes squawking an emergency code (7500, 7600, 7700) are drawn large in red with a pulsing ring and appear in the Live feed. Every plane has the shape of its class (wide-body, narrow-body, regional jet, turboprop, business jet, light aircraft, helicopter or fast jet), turned to its real heading; zoom in and they become 3D models, at their real size close to the ground. White is above 25,000 ft, yellow 10,000–25,000 ft, teal below 10,000 ft, grey on the ground. Each plane in the air leaves a short fading trail along its heading (longer for faster planes), so you can see which way the traffic flows; switch trails off under Trails. Click a plane for its seatback-style flight view.',
      how: 'Planes work out where they are with satellite navigation and broadcast it about twice a second on 1090 MHz (ADS-B). Thousands of volunteer receivers share what they hear. Flight trackers don’t let web pages read them directly (no CORS headers), so on the website a GitHub Actions job saves a worldwide snapshot every 4 minutes, and your browser moves each plane forward along its heading at its speed until the next one arrives (dead reckoning, as navigators did before satellites). The desktop app, or the optional proxy, reads OpenSky every 90 seconds and airplanes.live / adsb.lol every few seconds for “Near my view”. Heights are exaggerated from far away so you can see them, and true when you are close. The class comes from the ICAO type code when known, else the broadcast size category, else a guess from speed and height.',
      try: 'Pick a long-haul flight over an ocean, open its flight view and choose Follow. Then compare the “outside temperature” with the standard-atmosphere formula in the Learn page.',
      refs: ['opensky', 'airplaneslive', 'adsblol', 'adsbdb', 'livedata'],
    },
  };
}

// --------------------------------------------------------------- seatback moving-map panel
function deckNumbers(a) {
  const r = flightState.route[a.call];
  let prog = null;
  if (r?.origin && r?.destination) {
    const done = haversineKm(r.origin.latitude, r.origin.longitude, a.lat, a.lng);
    const togo = haversineKm(a.lat, a.lng, r.destination.latitude, r.destination.longitude);
    const kmh = a.kt ? a.kt * 1.852 : null;
    prog = { done, togo, frac: Math.max(0, Math.min(1, done / (done + togo))), eta: kmh && kmh > 150 ? togo / kmh : null };
  }
  return { r, prog };
}
function statsHtml(a) {
  const { prog } = deckNumbers(a);
  const hh = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
  const cells = [
    ['Altitude', a.ground ? 'On the ground' : `${Math.round(a.altFt).toLocaleString()} ft`, a.ground ? '' : `${Math.round(a.altFt / 3.281).toLocaleString()} m`],
    ['Ground speed', a.kt ? `${Math.round(a.kt * 1.1508)} mph` : '—', a.kt ? `${Math.round(a.kt * 1.852)} km/h · ${Math.round(a.kt)} kt` : ''],
    ['Heading', `${Math.round(a.trk ?? 0)}°`, compass(a.trk ?? 0)],
    ['Outside air (est.)', a.ground ? '—' : `${Math.round(isaTempC(a.altFt))} °C`, a.ground ? '' : `${Math.round(isaTempC(a.altFt) * 9 / 5 + 32)} °F standard atmosphere`],
    ['Distance to go', prog ? `${Math.round(prog.togo).toLocaleString()} km` : '—', prog ? `${Math.round(prog.togo / 1.609).toLocaleString()} mi` : 'route unknown'],
    ['Time to go', prog?.eta != null ? hh(prog.eta) : '—', prog?.eta != null ? 'at current speed' : ''],
    ['Climb rate', a.vs != null ? `${Math.round(a.vs).toLocaleString()} ft/min` : '—', a.vs > 300 ? 'climbing' : a.vs < -300 ? 'descending' : 'level'],
    ['Local time below', localSolarTime(a.lng), 'solar time'],
  ];
  return cells.map(([k, v, s]) => `<div class="cell"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
}
const compass = (d) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

function progressHtml(a) {
  const { r, prog } = deckNumbers(a);
  if (!r?.origin) return '<p class="muted">Route not published for this callsign — many private, cargo and military flights do not share one.</p>';
  const pct = Math.round((prog?.frac ?? 0) * 100);
  return `<div class="route">
    <div class="ends"><div><b>${r.origin.iata_code ?? r.origin.icao_code}</b><small>${r.origin.municipality ?? r.origin.name}</small></div>
    <div class="right"><b>${r.destination.iata_code ?? r.destination.icao_code}</b><small>${r.destination.municipality ?? r.destination.name}</small></div></div>
    <div class="track"><i style="width:${pct}%"></i><span class="plane" style="left:${pct}%">✈</span></div>
    <small class="muted">${pct}% of the great-circle distance flown</small></div>`;
}

function updateDeck(a) {
  const s = document.getElementById('deck-stats'); if (s) s.innerHTML = statsHtml(a);
  const p = document.getElementById('deck-route'); if (p) p.innerHTML = progressHtml(a);
  const pos = document.getElementById('deck-pos'); if (pos) pos.textContent = `${fmtLat(a.lat)}, ${fmtLng(a.lng)}`;
  if (document.getElementById('deck-3d')?.isConnected) planeView?.update(); else planeView = null;
}

async function openDeck(a, api) {
  flightState.selected = a.id; flightState.follow = false;
  api.openNotes('Flight view', `
    <div class="deck" data-key="flight:${a.id}">
      <p class="kicker">${a.src ?? ''}</p>
      <h3>${api.esc(a.call || a.id.toUpperCase())}</h3>
      <p class="sub" id="deck-airline">${api.esc([a.desc ?? a.type, a.reg].filter(Boolean).join(' · ') || 'Looking up aircraft…')}</p>
      <div id="deck-route">${progressHtml(a)}</div>
      <div class="stats" id="deck-stats">${statsHtml(a)}</div>
      <h4>What it looks like</h4><div id="deck-3d"></div>
      <p class="muted" id="deck-pos">${fmtLat(a.lat)}, ${fmtLng(a.lng)}</p>
      <div class="row">
        <button class="btn" data-deck="follow">Follow this flight</button>
        <button class="btn ghost" data-deck="window">Window view</button>
        <button class="btn ghost" data-deck="stop">Stop following</button>
        <button class="btn ghost" data-share="1">Copy link</button>
      </div>
      <div id="deck-photo"></div><div id="deck-dest"></div>
      <h4>How the seatback map works</h4>
      <p>Airline moving maps take the same numbers from the aircraft’s own navigation system. Here they come from the plane’s ADS-B broadcast; the outside temperature is estimated from the standard atmosphere (−6.5 °C per km up to 11 km, then −56.5 °C), which is how cruise temperatures of about −50 °C arise.</p>
      <p class="muted">Squawk ${api.esc(a.squawk ?? '—')} · ICAO address ${api.esc(a.id)} · <a href="https://globe.adsb.lol/?icao=${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Track on adsb.lol</a></p>
    </div>`, `flight:${a.id}`);
  planeView?.dispose(); planeView = mountPlaneView(document.getElementById('deck-3d'), a);
  api.refreshLayer('aircraft', { soft: true });
  if (!a.type && await fillTypes([a])) { planeView?.update(); const el = document.getElementById('deck-airline'); if (el && api.isOpen(`flight:${a.id}`)) el.textContent = [a.type, a.reg].filter(Boolean).join(' · '); api.refreshLayer('aircraft', { soft: true }); }
  const [info, route] = await Promise.all([aircraftInfo(a.id), routeInfo(a.call)]);
  if (!api.isOpen(`flight:${a.id}`)) return;
  if (info?.icao_type && !a.type) { a.type = info.icao_type; planeView?.update(); api.refreshLayer('aircraft', { soft: true }); }
  if (info) {
    document.getElementById('deck-airline').textContent = [info.manufacturer, info.type, info.registration, info.registered_owner].filter(Boolean).join(' · ');
    if (info.url_photo_thumbnail) document.getElementById('deck-photo').innerHTML = `<figure class="photo"><img src="${info.url_photo_thumbnail}" alt="Photo of ${api.esc(info.registration ?? 'the aircraft')}" loading="lazy" /><figcaption>Photo via <a href="${info.url_photo ?? '#'}" target="_blank" rel="noopener">airport-data / adsbdb</a></figcaption></figure>`;
  }
  if (route) {
    const air = route.airline ? `${route.airline.name}${route.airline.country ? ` (${route.airline.country})` : ''}` : '';
    if (air) document.getElementById('deck-airline').textContent = `${air} · ${document.getElementById('deck-airline').textContent}`;
    updateDeck(a);
    const d = route.destination;
    try {
      const w = await getFeed('openmeteo', `https://api.open-meteo.com/v1/forecast?latitude=${d.latitude}&longitude=${d.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`);
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: w.timezone });
      document.getElementById('deck-dest').innerHTML = `<h4>At ${api.esc(d.municipality ?? d.name)}</h4><dl><dt>Local time</dt><dd>${t} (${api.esc(w.timezone)})</dd><dt>Weather</dt><dd>${api.wmo(w.current.weather_code)}, ${w.current.temperature_2m} °C, wind ${w.current.wind_speed_10m} km/h</dd><dt>Airport</dt><dd>${api.esc(d.name)} · ${api.esc(d.country_name ?? '')}</dd></dl>`;
    } catch { /* optional */ }
    api.refreshLayer('aircraft', { soft: true });
  }
}
export function deckAction(kind, api) {
  const a = lastList.find((x) => x.id === flightState.selected); if (!a) return;
  if (kind === 'follow') { flightState.follow = true; api.fly(a.lat, a.lng, Math.min(api.state.pov.altitude, 0.6), false); }
  if (kind === 'window') { flightState.follow = true; api.setBase('imagery'); api.fly(a.lat, a.lng, Math.max(0.012, a.altFt / 3281 / 6371 * 3), false); }
  if (kind === 'stop') flightState.follow = false;
}
export const aircraftCount = () => lastList.length;
export { greatCirclePoints };
