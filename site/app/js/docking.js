// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: Dock with the ISS (v2.24). Fly a crew capsule from 200 m out to the station's forward
// docking port, by hand or with the autopilot, over the part of the Earth the real station is above right now.
// Loaded only when opened.
//   The station: NASA 3D Resources' ISS model (public domain), thinned and scaled to its real 109 m truss by
//   tools/build-iss.py into data/iss.bin. +y is the direction of flight (the forward port faces it), z runs along
//   the truss (the orbit's normal), +x points away from the Earth: the local frame of the orbit.
//   The motion: the Clohessy–Wiltshire equations (Clohessy & Wiltshire, 1960), which give how a nearby craft drifts
//   relative to a station in a circular orbit; on the line straight ahead of the station (the V-bar) a craft at rest
//   stays at rest, anywhere else orbital mechanics slowly pulls it away.
//   Soft capture: the initial-contact limits of the International Docking System Standard (IDSS), which the
//   station's docking adapters follow: closing at 0.05–0.10 m/s, within 0.10 m of the axis, drifting sideways at
//   under 0.04 m/s, lined up within 4° and turning at under 0.4°/s.
//   The idea of an autopilot that flies the approach axis by axis comes from Daniel Petrov's autopilot for SpaceX's
//   ISS Docking Simulator (Eclipse Public License 2.0); no code is taken from it. The capsule, the controls and the
//   look are the atlas's own.
//   v2.33: drag to look around and scroll or pinch to zoom in every view, pause to look, and a fourth view straight
//   down from the station's Earth-facing side (where the real Cupola is). The Earth below has its night lights, blue
//   air and dusk band, and the ground under the station is drawn from the same satellite imagery as the globe
//   (Esri World Imagery, zoom 7: about 1.2 km a pixel), refreshed as it slides by.
import { THREE } from '../vendor/vendor.min.mjs';
import { subsolarPoint, bearingDeg } from './astro.js';

const D2R = Math.PI / 180;
export const PORT = [-0.30, 13.27, 0.23]; // the forward docking port in the model (metres; printed by tools/build-iss.py)
export const LIMITS = { closeMin: 0.05, closeMax: 0.10, lateral: 0.10, latRate: 0.04, angle: 4, rate: 0.4 };
const TRANS_ACC = 0.03; // m/s², thrusters on one axis
const ROT_ACC = 0.5 * D2R; // rad/s²
const MU = 398600.4418; const R_E = 6371.0088;
export const meanMotion = (altKm = 420) => Math.sqrt(MU / (R_E + altKm) ** 3); // rad/s

// ------------------------------------------------------------------ the simulation (no drawing; tested on its own)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const AXIS = V(0, 1, 0); // out of the port
// The capsule's own axes: +Z its nose (the docking side), +Y its top, +X its right. Lined up for docking, the nose
// faces the station (−y), its top points away from the Earth (+x) and its right is −z.
const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(1, 0, 0), V(0, -1, 0)));

export function startState(seed = 1) {
  const r = (a) => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) * 2 - 1) * a; };
  const err = new THREE.Quaternion().setFromEuler(new THREE.Euler((4 + r(2)) * D2R, (-6 + r(2)) * D2R, (8 + r(3)) * D2R));
  return {
    p: V(PORT[0] + 3 + r(1), PORT[1] + 200, PORT[2] - 2 + r(1)), v: V(0, 0, 0), // the docking ring's position, m and m/s
    q: Q0.clone().multiply(err), w: V(r(0.1) * D2R, r(0.1) * D2R, r(0.1) * D2R), // attitude; body rates, rad/s
    t: 0, n: meanMotion(), hold: 0, auto: false, done: null,
  };
}

/** Where the capsule stands relative to the port, in the numbers the HUD shows. */
export function measure(s) {
  const r = s.p.clone().sub(V(...PORT)); const along = r.dot(AXIS); const lat = r.clone().addScaledVector(AXIS, -along);
  const vAlong = s.v.dot(AXIS); const vLat = s.v.clone().addScaledVector(AXIS, -vAlong);
  const e = Q0.clone().invert().multiply(s.q); if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
  const ang = 2 * Math.acos(Math.min(1, e.w)) / D2R; // total misalignment
  return {
    range: r.length(), along, close: -vAlong, lat: lat.length(), up: lat.x, right: -lat.z, latRate: vLat.length(),
    pitch: 2 * e.x / D2R, yaw: 2 * e.y / D2R, roll: 2 * e.z / D2R, angle: ang, rate: s.w.length() / D2R,
  };
}

/** Clohessy–Wiltshire: the pull of orbital mechanics on a craft at r (m) moving at v (m/s) relative to the station. */
export function cw(r, v, n) {
  return V(3 * n * n * r.x + 2 * n * v.y, -2 * n * v.x, -n * n * r.z);
}

/** The autopilot's commands: translation (station frame, m/s²) and rotation (body frame, rad/s²). */
export function autopilot(s, dt) {
  const m = measure(s);
  const e = Q0.clone().invert().multiply(s.q); if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
  const wn = 0.15; const rot = V(e.x, e.y, e.z).multiplyScalar(-2 * wn * wn).addScaledVector(s.w, -2 * wn);
  // along the axis: fast far out, a hold at 20 m like the real approach, then a steady 0.08 m/s to contact
  const lined = m.lat < 0.05 && m.angle < 1 && m.latRate < 0.01;
  let vt;
  if (m.along > 21) vt = Math.min(0.5, Math.max(0.12, 0.0025 * m.along + 0.05));
  else if (s.hold < 10 || !lined) { vt = Math.max(-0.1, Math.min(0.1, (m.along - 20) * 0.05)); if (Math.abs(m.along - 20) < 0.5 && Math.abs(m.close) < 0.02) s.hold += dt; }
  else vt = 0.08;
  const r = s.p.clone().sub(V(...PORT)); const lat = r.clone().addScaledVector(AXIS, -r.dot(AXIS));
  const vLat = s.v.clone().addScaledVector(AXIS, -s.v.dot(AXIS));
  const wl = m.along < 21 ? 0.08 : 0.04;
  const acc = lat.multiplyScalar(-wl * wl).addScaledVector(vLat, -2 * wl).addScaledVector(AXIS, 0.4 * (-vt - s.v.dot(AXIS)));
  return { acc: acc.sub(cw(s.p.clone().sub(V(...PORT)), s.v, s.n)), rot };
}

/** One step of dt seconds. ctl: { t: [x, y, z] body thrust in −1…1, r: [pitch, yaw, roll] in −1…1 } (ignored on autopilot). */
export function step(s, ctl, dt) {
  if (s.done) return s;
  let accS; let rot;
  if (s.auto) {
    const a = autopilot(s, dt);
    const body = a.acc.clone().applyQuaternion(s.q.clone().invert());
    body.set(clamp(body.x, TRANS_ACC), clamp(body.y, TRANS_ACC), clamp(body.z, TRANS_ACC));
    accS = body.applyQuaternion(s.q); rot = V(clamp(a.rot.x, ROT_ACC), clamp(a.rot.y, ROT_ACC), clamp(a.rot.z, ROT_ACC));
  } else {
    accS = V(...ctl.t).multiplyScalar(TRANS_ACC).applyQuaternion(s.q); rot = V(...ctl.r).multiplyScalar(ROT_ACC);
  }
  const rel = s.p.clone().sub(V(...PORT));
  s.v.addScaledVector(accS.add(cw(rel, s.v, s.n)), dt); s.p.addScaledVector(s.v, dt);
  s.w.addScaledVector(rot, dt);
  const ang = s.w.length() * dt;
  if (ang > 0) s.q.multiply(new THREE.Quaternion().setFromAxisAngle(s.w.clone().normalize(), ang)).normalize();
  s.t += dt;
  const m = measure(s);
  if (m.along <= 0) s.done = verdict(m);
  else if (m.range > 600) s.done = { ok: false, title: 'Drifted away', why: 'The capsule is more than 600 m from the station.' };
  return s;
}
const clamp = (x, a) => Math.max(-a, Math.min(a, x));

/** At contact: did the docking ring capture? The first limit missed is the reason given. */
export function verdict(m) {
  const L = LIMITS; const f = (x, d = 2) => x.toFixed(d);
  const miss = [
    [m.lat > 1.5, 'Missed the port', `The capsule passed the docking port ${f(m.lat, 1)} m off its axis.`],
    [m.close > L.closeMax, 'Too fast', `Closing at ${f(m.close, 3)} m/s; the docking ring captures at ${L.closeMin}–${L.closeMax} m/s.`],
    [m.close < L.closeMin, 'Too gentle', `Closing at ${f(m.close, 3)} m/s, too slowly for the capture latches to engage (${L.closeMin}–${L.closeMax} m/s).`],
    [m.lat > L.lateral, 'Off centre', `${f(m.lat)} m off the axis at contact; the limit is ${L.lateral} m.`],
    [m.latRate > L.latRate, 'Sliding sideways', `Drifting sideways at ${f(m.latRate, 3)} m/s at contact; the limit is ${L.latRate} m/s.`],
    [m.angle > L.angle, 'Not lined up', `Tilted ${f(m.angle, 1)}° from the port's axis; the limit is ${L.angle}°.`],
    [m.rate > L.rate, 'Still turning', `Turning at ${f(m.rate)}°/s at contact; the limit is ${L.rate}°/s.`],
  ].find(([bad]) => bad);
  if (miss) return { ok: false, title: miss[1], why: miss[2], m };
  return { ok: true, title: 'Soft capture', why: `Contact at ${f(m.close, 3)} m/s, ${f(m.lat * 100, 1)} cm off centre, ${f(m.angle, 1)}° off line. The hooks latch, then the two hatches can open.`, m };
}

// ------------------------------------------------------------------ drawing
const ROLE_LOOK = [
  { color: 0xc9c8c2, metalness: 0.2, roughness: 0.6 }, // hull
  { color: 0x5c4318, metalness: 0.55, roughness: 0.35, emissive: 0x120c02 }, // solar arrays
  { color: 0xf1f1ec, metalness: 0.05, roughness: 0.8 }, // radiators
  { color: 0x8c8f93, metalness: 0.6, roughness: 0.45 }, // truss
  { color: 0xdcdbd4, metalness: 0.15, roughness: 0.65 }, // modules
];

/** data/iss.bin → { group, tris, size } (see tools/build-iss.py for the layout). */
export async function loadStation(url = new URL('../data/iss.bin', import.meta.url)) {
  const buf = await (await fetch(url)).arrayBuffer(); const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'ISS1') throw new Error('not an ISS model');
  const n = dv.getUint32(4, true); let o = 8; const group = new THREE.Group(); let tris = 0;
  for (let k = 0; k < n; k++) {
    const role = dv.getUint8(o); const isz = dv.getUint8(o + 1); const nv = dv.getUint32(o + 4, true); const ni = dv.getUint32(o + 8, true); o += 12;
    const q = new Int16Array(buf, o, nv * 3); o += nv * 6; o = (o + 3) & ~3;
    const idx = isz === 2 ? new Uint16Array(buf, o, ni) : new Uint32Array(buf, o, ni); o += ni * isz; o = (o + 3) & ~3;
    const pos = new Float32Array(nv * 3); for (let i = 0; i < pos.length; i++) pos[i] = q[i] / 400;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ ...(ROLE_LOOK[role] ?? ROLE_LOOK[0]), flatShading: true, side: THREE.DoubleSide }));
    mesh.userData.role = role; group.add(mesh); tris += ni / 3;
  }
  const size = new THREE.Box3().setFromObject(group).getSize(V());
  return { group, tris, size };
}

/** A crew capsule of typical size (4 m across, about 8 m with its trunk), built from turned profiles. Origin: the docking ring. */
function capsule() {
  const g = new THREE.Group();
  const lathe = (pts, mat) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 48), mat); m.rotation.x = Math.PI / 2; return m; };
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide });
  const cells = new THREE.MeshStandardMaterial({ color: 0x1b2440, metalness: 0.5, roughness: 0.3, emissive: 0x05070d, side: THREE.DoubleSide });
  // LatheGeometry turns about +y; rotating by 90° about x puts that along −z, so profiles run from the nose (0) backwards.
  g.add(lathe([[0.62, 0], [0.66, -0.25], [0.9, -0.45], [1.0, -0.6]], dark)); // docking ring and adapter
  g.add(lathe([[1.0, -0.6], [1.35, -0.75], [1.9, -3.6], [2.0, -4.0]], white)); // the capsule's sloped sides
  g.add(lathe([[2.0, -4.0], [1.95, -4.15], [0.2, -4.4]], dark)); // heat shield
  g.add(lathe([[1.85, -4.4], [1.85, -7.9]], cells)); // trunk with solar cells
  g.add(lathe([[1.85, -7.9], [1.6, -8.0], [0, -8.0]], dark)); // the trunk's closed end
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshBasicMaterial({ color: 0x0b1020 }));
  for (const a of [0.5, -0.5]) { const w = win.clone(); w.position.set(Math.sin(a) * 1.55, Math.cos(a) * 1.55, -2.2); w.lookAt(w.position.clone().multiplyScalar(3).setZ(-1.6)); g.add(w); }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 })); light.position.set(1.4, 0, -0.9); g.add(light);
  const light2 = light.clone(); light2.material = new THREE.MeshBasicMaterial({ color: 0x34c759 }); light2.position.x = -1.4; g.add(light2);
  return g;
}

/** The docking port's target: the adapter ring and a cross to line up on. */
function target() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 10, 48), new THREE.MeshStandardMaterial({ color: 0x9a9a96, metalness: 0.5, roughness: 0.4 }));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  const glow = new THREE.LineBasicMaterial({ color: 0x5cf2a3, transparent: true, opacity: 0.8 });
  const cross = new THREE.BufferGeometry().setFromPoints([V(-0.4, 0.02, 0), V(0.4, 0.02, 0), V(0, 0.02, -0.4), V(0, 0.02, 0.4)]);
  g.add(new THREE.LineSegments(cross, glow));
  // the approach corridor: a cone of 10° about the axis out to 200 m, drawn faintly
  const pts = []; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; pts.push(V(0, 0, 0), V(Math.cos(a) * 35, 200, Math.sin(a) * 35)); }
  for (const d of [20, 200]) for (let i = 0; i < 64; i++) { const a = i / 64 * 2 * Math.PI; const b = (i + 1) / 64 * 2 * Math.PI; const r = d * Math.tan(10 * D2R); pts.push(V(Math.cos(a) * r, d, Math.sin(a) * r), V(Math.cos(b) * r, d, Math.sin(b) * r)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5cf2a3, transparent: true, opacity: 0.18 })));
  g.position.set(...PORT); return g;
}

// ------------------------------------------------------------------ the Earth below
/** Web Mercator tile maths (the slippy-map scheme). */
export const tileOf = (lat, lng, z) => { const n = 2 ** z; const la = Math.max(-85.05, Math.min(85.05, lat)) * D2R; return [Math.floor(((lng + 180) / 360) * n) % n, Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n)]; };
export const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / D2R;
/** A point on the Earth in the docking scene's Earth frame (lng 0 on +x, north +y, east −z: the sphere's own texture layout). */
export const earthPoint = (lat, lng, r = 1) => V(Math.cos(lat * D2R) * Math.cos(lng * D2R) * r, Math.sin(lat * D2R) * r, -Math.cos(lat * D2R) * Math.sin(lng * D2R) * r);
const EARTH_TILT = 0.95; // radians up from straight down, so the curved horizon shows
export const TILE_Z = 7; export const TILE_N = 5; // a 5 × 5 block of zoom-7 tiles, about 1,500 km across at the equator
const TILE_URL = (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

// The Earth's look: day imagery shaded by the real Sun, city lights only where it is dark, blue air toward the edge
// and a red-orange band along the terminator (the globe's own Earth, simplified). TILE: a patch of sharp imagery,
// faded out at the block's edge (attribute edge) and lit by the night texture through the global uv (attribute guv).
function earthMaterial(day, night, sunDir, tile = false) {
  return new THREE.ShaderMaterial({
    uniforms: { day: { value: day }, night: { value: night }, sunDir },
    defines: tile ? { TILE: 1 } : {}, transparent: tile, depthWrite: !tile,
    vertexShader: `varying vec3 vN; varying vec2 vUv; varying vec2 gUv; varying vec3 vPos; varying float vEdge;
      #ifdef TILE
      attribute vec2 guv; attribute float edge;
      #endif
      void main() { vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz); vUv = uv; vPos = (modelMatrix * vec4(position, 1.0)).xyz;
        #ifdef TILE
        gUv = guv; vEdge = edge;
        #else
        gUv = uv; vEdge = 1.0;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sunDir;
      varying vec3 vN; varying vec2 vUv; varying vec2 gUv; varying vec3 vPos; varying float vEdge;
      void main() {
        vec3 n = normalize(vN); vec3 L = normalize(sunDir); vec3 V = normalize(cameraPosition - vPos); float i = dot(n, L);
        vec4 d = texture2D(day, vUv); d.rgb *= 0.62 + 0.45 * smoothstep(-0.05, 0.6, i);
        vec4 nt = texture2D(night, gUv); nt.rgb = nt.rgb * nt.rgb * vec3(1.9, 1.55, 1.05) * 2.1 + vec3(0.004, 0.009, 0.022);
        float k = smoothstep(-0.08, 0.12, i); vec4 c = mix(nt, d, k);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 2.6);
        c.rgb = mix(c.rgb, vec3(0.38, 0.62, 1.0), rim * 0.55 * smoothstep(-0.2, 0.45, i));
        c.rgb += vec3(1.0, 0.45, 0.18) * (0.10 + 0.35 * rim) * (1.0 - abs(k * 2.0 - 1.0));
        gl_FragColor = vec4(c.rgb, vEdge);
      }`,
  });
}

/** One imagery tile as a curved patch, 1 km above the sphere (its flat facets sag up to 2 km between vertices). */
function tilePatch(x, y, z, x0, y0, n, tex, night, sunDir) {
  const S = 10; const pos = []; const uv = []; const guv = []; const edge = []; const nrm = []; const idx = [];
  for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
    const fy = y + j / S; const fx = x + i / S;
    const lat = tileLat(fy, z); const lng = (fx / 2 ** z) * 360 - 180;
    const p = earthPoint(lat, lng, R_E + 1); pos.push(p.x, p.y, p.z); const q = p.clone().normalize(); nrm.push(q.x, q.y, q.z);
    uv.push(i / S, 1 - j / S); guv.push((lng + 180) / 360, (lat + 90) / 180);
    const ex = Math.min(fx - x0, x0 + n - fx); const ey = Math.min(fy - y0, y0 + n - fy); const e = Math.min(ex, ey);
    edge.push(Math.min(1, Math.max(0, e / 0.8)));
  }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const a = j * (S + 1) + i; idx.push(a, a + S + 1, a + 1, a + 1, a + S + 1, a + S + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('guv', new THREE.Float32BufferAttribute(guv, 2)); g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, earthMaterial(tex, night, sunDir, true)); m.renderOrder = 1; return m;
}

/** Drag to look, scroll or pinch to zoom: { yaw, pitch, zoom } that the cameras read. */
export function lookControls(el, onReset) {
  const look = { yaw: 0, pitch: 0, zoom: 1, moved: 0 }; const pts = new Map(); let pinch = 0;
  const clampLook = () => { look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch)); look.zoom = Math.max(0.25, Math.min(30, look.zoom)); };
  el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); el.setPointerCapture?.(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) { look.yaw -= (e.clientX - p[0]) * 0.006; look.pitch -= (e.clientY - p[1]) * 0.006; look.moved++; }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) look.zoom *= pinch / Math.max(1, d); pinch = d; }
    clampLook();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); look.zoom *= Math.exp(Math.max(-200, Math.min(200, e.deltaY * (e.deltaMode ? 16 : 1))) * 0.0015); clampLook(); }, { passive: false });
  el.addEventListener('dblclick', () => { look.yaw = 0; look.pitch = 0; look.zoom = 1; onReset?.(); });
  return look;
}
/** Swing an offset round an up axis (yaw) and then tilt it (pitch). */
function swing(off, upAxis, yaw, pitch) {
  const o = off.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(upAxis, yaw));
  const right = o.clone().cross(upAxis); if (right.lengthSq() < 1e-9) return o;
  return o.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right.normalize(), pitch));
}

// ------------------------------------------------------------------ the window
let open = null;
/** Opens the docking window. iss(): the station now ({ lat, lng, altKm }) or null; now(): the atlas's clock. */
export async function openDocking({ iss = () => null, now = () => new Date(), onClose, placeName = () => null, tiles = true } = {}) {
  if (open) return open;
  if (!document.querySelector('link[data-dock-css]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/docking.css', import.meta.url).href; l.dataset.dockCss = '1'; document.head.append(l); }
  const root = document.createElement('div'); root.className = 'dock'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Dock with the International Space Station');
  root.innerHTML = `<canvas></canvas><div class="dock-cross" hidden></div>
    <header class="dock-top"><div><b>Dock with the ISS</b><small class="dock-where">…</small></div>
      <button class="dock-x" aria-label="Close" title="Close (Esc)">×</button></header>
    <p class="dock-below" aria-live="off"></p><p class="dock-hint">Drag to look around · scroll or pinch to zoom · double-click to reset</p>
    <small class="dock-attr" hidden>Imagery © Esri, Maxar, Earthstar Geographics</small>
    <dl class="dock-hud"></dl>
    <p class="dock-msg" aria-live="polite"></p>
    <div class="dock-result" hidden><b></b><p></p><div><button class="btn" data-again>Try again</button> <button class="btn ghost" data-close>Back to the globe</button></div></div>
    <nav class="dock-pad" aria-label="Controls">
      <div class="dock-grp" aria-label="Move"><span>Move</span>
        <button data-t="0,1,0" title="Up (R)">▲</button><button data-t="-1,0,0" title="Left (A)">◀</button><button data-t="0,0,1" title="Forward (W)">⊕</button><button data-t="1,0,0" title="Right (D)">▶</button><button data-t="0,-1,0" title="Down (F)">▼</button><button data-t="0,0,-1" title="Back (S)">⊖</button></div>
      <div class="dock-grp" aria-label="Turn"><span>Turn</span>
        <button data-r="-1,0,0" title="Nose up (↑)">⤒</button><button data-r="0,1,0" title="Nose left (←)">↶</button><button data-r="0,0,-1" title="Roll left (Q)">⟲</button><button data-r="0,-1,0" title="Nose right (→)">↷</button><button data-r="1,0,0" title="Nose down (↓)">⤓</button><button data-r="0,0,1" title="Roll right (E)">⟳</button></div>
      <div class="dock-grp dock-modes"><button data-auto aria-pressed="false" title="Autopilot (P)">Autopilot</button><button data-view title="Change view (C)">View: chase</button><button data-speed title="Time speed (T)">1×</button><button data-pause aria-pressed="false" title="Pause to look around (Space)">Pause</button></div>
    </nav>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const canvas = $('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.autoClear = false;
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);
  const sky = new THREE.Scene(); const camE = new THREE.PerspectiveCamera(50, 1, 1, 60000); // the Earth and stars, in kilometres

  // stars
  const sp = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2500; i++) { const u = rnd() * 2 - 1; const a = rnd() * 2 * Math.PI; const r = Math.sqrt(1 - u * u); sp.push(r * Math.cos(a) * 50000, u * 50000, r * Math.sin(a) * 50000); }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }));
  sky.add(stars);
  // the Earth below, turned so the point under the station is the real one now
  const tl = new THREE.TextureLoader(); const tex = tl.load(new URL('../textures/earth-blue-marble.jpg', import.meta.url).href);
  const nightTex = tl.load(new URL('../textures/earth-night.jpg', import.meta.url).href); tex.anisotropy = nightTex.anisotropy = 8; nightTex.wrapS = THREE.RepeatWrapping;
  const sunDirE = { value: V(1, 0, 0) };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R_E, 192, 96), earthMaterial(tex, nightTex, sunDirE));
  const air = new THREE.Mesh(new THREE.SphereGeometry(R_E + 60, 96, 48), new THREE.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const earthG = new THREE.Group(); earthG.add(earth, air); sky.add(earthG);
  const sunE = new THREE.DirectionalLight(0xffffff, 3.2); sky.add(sunE, new THREE.AmbientLight(0x223344, 0.25));

  const sun = new THREE.DirectionalLight(0xffffff, 2.6); const earthshine = new THREE.HemisphereLight(0x2a3a55, 0x4a6aa0, 0.35);
  scene.add(sun, earthshine);
  const head = new THREE.PointLight(0xffffff, 0, 60, 1.5); scene.add(head); // floodlights in the dark
  const ship = capsule(); scene.add(ship); scene.add(target());
  let station = null; const msg = $('.dock-msg');
  msg.textContent = 'Loading the station…';
  loadStation().then((st) => { station = st; scene.add(st.group); msg.textContent = ''; }).catch(() => { msg.textContent = 'The station model could not be loaded.'; });

  // where the real station is, and which way it is flying
  let alt = 420; const placeEarth = () => {
    const a = iss(); const t = now();
    const b = iss(new Date(t.getTime() + 10000));
    if (a) alt = a.altKm ?? alt;
    const lat = a?.lat ?? 0; const lng = a?.lng ?? 0;
    const hdg = a && b ? bearingDeg(a.lat, a.lng, b.lat, b.lng) : 51.6;
    const p = (la, lo) => V(Math.cos(la * D2R) * Math.cos(lo * D2R), Math.sin(la * D2R), -Math.cos(la * D2R) * Math.sin(lo * D2R));
    const up = p(lat, lng); const north = V(0, 1, 0).addScaledVector(up, -up.y).normalize(); const east = north.clone().cross(up).normalize();
    const fwd = north.clone().multiplyScalar(Math.cos(hdg * D2R)).addScaledVector(east, Math.sin(hdg * D2R));
    const side = up.clone().cross(fwd);
    const B = new THREE.Matrix4().makeBasis(up, fwd, side).transpose(); // Earth frame → station frame
    earthG.setRotationFromMatrix(B); earthG.position.set(-(R_E + alt), 0, 0); earthG.updateMatrix();
    const ss = subsolarPoint(t); sunLocal.copy(p(ss.lat, ss.lng));
    where = a ? `Over ${a.over ?? `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`} · ${Math.round(alt)} km up` : 'A typical orbit (turn on space stations to fly over where the station really is)';
    dark = null; light(); return { lat, lng };
  };
  // the Sun: from the real subsolar point, turned with the Earth below, so the station passes into and out of shadow
  const sunLocal = V(1, 0, 0); let where = ''; let dark = null;
  function light() {
    const sd = sunLocal.clone().applyQuaternion(earthG.quaternion).normalize();
    sunE.position.copy(sd).multiplyScalar(1e5); sun.position.copy(sd); sunDirE.value.copy(sd);
    const d = sd.x < -Math.sqrt(1 - (R_E / (R_E + alt)) ** 2) && Math.hypot(sd.y, sd.z) < R_E / (R_E + alt); // the Sun is behind the Earth
    sun.intensity = d ? 0 : 2.6; head.intensity = d ? 40 : 0;
    if (d !== dark) { dark = d; earthshine.intensity = d ? 1.1 : 0.35; $('.dock-where').textContent = `${where} · ${dark ? 'in the Earth’s shadow' : 'in sunlight'}`; }
  }
  placeEarth();

  let s = startState(Date.now() % 100000 + 1); s.n = meanMotion(alt);
  const keys = new Set(); const held = { t: [0, 0, 0], r: [0, 0, 0] };
  let view = 0; const VIEWS = ['chase', 'capsule camera', 'from the station', 'Earth below']; let speed = 1; const SPEEDS = [1, 10, 50]; let paused = false;
  const look = lookControls(canvas);
  const ctl = () => {
    const k = (a, b) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
    return { t: [k('d', 'a') + held.t[0], k('r', 'f') + held.t[1], k('w', 's') + held.t[2]].map((x) => Math.max(-1, Math.min(1, x))),
      r: [k('arrowdown', 'arrowup') + held.r[0], k('arrowleft', 'arrowright') + held.r[1], k('e', 'q') + held.r[2]].map((x) => Math.max(-1, Math.min(1, x))) };
  };
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    e.stopImmediatePropagation(); // the globe's own shortcuts (C, S, R…) wait while the window is open
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') {
      if (k === 'escape') { close(); return; }
      if (k === 'p') return toggleAuto(); if (k === 'c') return cycleView(); if (k === 't') return cycleSpeed(); if (k === ' ') { e.preventDefault(); return togglePause(); }
      if ('wasdrfqe'.includes(k) || k.startsWith('arrow')) { keys.add(k); e.preventDefault(); }
    } else keys.delete(k);
  };
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
  const autoBtn = $('[data-auto]'); const viewBtn = $('[data-view]'); const speedBtn = $('[data-speed]');
  const toggleAuto = () => { s.auto = !s.auto; autoBtn.setAttribute('aria-pressed', String(s.auto)); };
  const pauseBtn = $('[data-pause]');
  const cycleView = () => { view = (view + 1) % VIEWS.length; viewBtn.textContent = `View: ${VIEWS[view]}`; $('.dock-cross').hidden = view !== 1; Object.assign(look, { yaw: 0, pitch: 0, zoom: 1 }); root.dataset.dockView = VIEWS[view]; };
  const cycleSpeed = () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; speedBtn.textContent = `${speed}×`; };
  const togglePause = () => { paused = !paused; pauseBtn.setAttribute('aria-pressed', String(paused)); pauseBtn.textContent = paused ? 'Resume' : 'Pause'; };
  autoBtn.onclick = toggleAuto; viewBtn.onclick = cycleView; speedBtn.onclick = cycleSpeed; pauseBtn.onclick = togglePause;
  for (const b of root.querySelectorAll('[data-t], [data-r]')) {
    const kind = b.dataset.t ? 't' : 'r'; const v = (b.dataset.t ?? b.dataset.r).split(',').map(Number);
    const set = (on) => { held[kind] = held[kind].map((x, i) => x + (on ? v[i] : -v[i])); b.classList.toggle('on', on); };
    let down = false;
    b.addEventListener('pointerdown', (e) => { if (!down) { down = true; set(true); b.setPointerCapture(e.pointerId); } });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { if (down) { down = false; set(false); } });
  }
  const result = $('.dock-result');
  $('[data-again]').onclick = () => { const a = s.auto; s = startState(Date.now() % 100000 + 1); s.n = meanMotion(alt); s.auto = a; result.hidden = true; };
  $('[data-close]').onclick = () => close(); $('.dock-x').onclick = () => close();

  const hud = $('.dock-hud');
  const ok = (good) => (good ? 'ok' : 'warn');
  function drawHud() {
    const m = measure(s); const L = LIMITS; const near = m.along < 30;
    const lr = `${Math.abs(m.up) < 0.005 ? '' : `${Math.abs(m.up).toFixed(2)} m ${m.up > 0 ? 'high' : 'low'}`}${Math.abs(m.up) >= 0.005 && Math.abs(m.right) >= 0.005 ? ', ' : ''}${Math.abs(m.right) < 0.005 ? '' : `${Math.abs(m.right).toFixed(2)} m ${m.right > 0 ? 'right' : 'left'}`}` || 'on the axis';
    hud.innerHTML = [
      ['Distance to the port', `${m.along >= 10 ? m.along.toFixed(1) : Math.max(0, m.along).toFixed(2)} m`, 'ok'],
      ['Closing speed', `${m.close.toFixed(3)} m/s`, near ? ok(m.close <= L.closeMax && m.close >= (m.along < 3 ? L.closeMin : -1)) : ok(m.close < 0.6)],
      ['Off the axis', lr, ok(m.lat <= (near ? L.lateral : Math.max(L.lateral, m.along * Math.tan(10 * D2R))))],
      ['Sideways drift', `${m.latRate.toFixed(3)} m/s`, ok(m.latRate <= L.latRate)],
      ['Pitch · yaw · roll', `${m.pitch.toFixed(1)}° · ${m.yaw.toFixed(1)}° · ${m.roll.toFixed(1)}°`, ok(m.angle <= L.angle)],
      ['Turning', `${m.rate.toFixed(2)}°/s`, ok(m.rate <= L.rate)],
      ['Time', `${Math.floor(s.t / 60)} min ${String(Math.floor(s.t % 60)).padStart(2, '0')} s`, 'ok'],
    ].map(([k, v, c]) => `<div class="${c}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    if (!s.done) msg.textContent = s.auto ? (s.hold > 0 && s.hold < 10 && m.along < 21 ? 'Autopilot: holding at 20 m, as the real approach does, before the final run in' : 'Autopilot flying') : m.along > 190 && s.t < 20 ? 'Line up on the green cross and close in slowly. P for autopilot, C to change the view.' : '';
  }

  // the ground under the station: where it is, sharp imagery there, and its name
  const below = $('.dock-below'); const attr = $('.dock-attr'); const patches = new Map(); let centre = ''; let lastBelow = 0; const blk = { x0: 0, y0: 0 };
  function subPoint() { const q = earthG.worldToLocal(V(0, 0, 0)).normalize(); return { lat: Math.asin(q.y) / D2R, lng: Math.atan2(-q.z, q.x) / D2R }; }
  const dropPatch = (rec) => { if (rec.mesh) { earthG.remove(rec.mesh); rec.mesh.geometry.dispose(); rec.mesh.material.dispose(); rec.mesh = null; } };
  function groundTiles(lat, lng) {
    const [cx, cy] = tileOf(lat, lng, TILE_Z); const key = `${cx}/${cy}`; if (key === centre) return; centre = key;
    const n = 2 ** TILE_Z; const x0 = cx - (TILE_N >> 1); const y0 = Math.max(0, Math.min(n - TILE_N, cy - (TILE_N >> 1))); const want = new Set(); Object.assign(blk, { x0, y0 });
    const build = (rec) => { dropPatch(rec); rec.mesh = tilePatch(rec.x, rec.y, TILE_Z, blk.x0, blk.y0, TILE_N, rec.tex, nightTex, sunDirE); earthG.add(rec.mesh); };
    for (let j = 0; j < TILE_N; j++) for (let i = 0; i < TILE_N; i++) {
      const x = x0 + i; const y = y0 + j; const wx = ((x % n) + n) % n; const id = `${wx}/${y}`; want.add(id);
      const old = patches.get(id);
      if (old) { old.x = x; if (old.tex) build(old); continue; } // re-fade the edges for the new block
      const rec = { x, y, tex: null, mesh: null }; patches.set(id, rec);
      tl.load(TILE_URL(wx, y, TILE_Z), (t) => {
        if (!open || patches.get(id) !== rec) { t.dispose(); return; }
        t.anisotropy = 8; rec.tex = t; build(rec); attr.hidden = false;
      }, undefined, () => {});
    }
    for (const [id, rec] of patches) if (!want.has(id)) { dropPatch(rec); rec.tex?.dispose(); patches.delete(id); }
  }
  function updateBelow(t) {
    if (t - lastBelow < 1000) return; lastBelow = t;
    const g = subPoint(); if (tiles && speed <= 10) groundTiles(g.lat, g.lng);
    const name = placeName(g.lat, g.lng);
    const sunUp = earthPoint(g.lat, g.lng).applyQuaternion(earthG.quaternion).dot(sunDirE.value) > 0;
    below.textContent = `Below: ${name ? `${name}, ` : ''}${Math.abs(g.lat).toFixed(1)}° ${g.lat >= 0 ? 'N' : 'S'}, ${Math.abs(g.lng).toFixed(1)}° ${g.lng >= 0 ? 'E' : 'W'} · ${sunUp ? 'daytime' : 'night'}`;
    return g;
  }

  function frame(dt, t = performance.now()) {
    const sub = paused ? 0 : Math.min(dt * speed, 2); const n = Math.ceil(sub / 0.05);
    for (let i = 0; i < n && !s.done; i++) step(s, ctl(), sub / n);
    if (s.done && result.hidden) {
      result.hidden = false; result.dataset.ok = String(s.done.ok);
      result.querySelector('b').textContent = s.done.title; result.querySelector('p').textContent = s.done.why;
      msg.textContent = '';
    }
    ship.position.copy(s.p); ship.quaternion.copy(s.q);
    // the ground slides backwards under the station at the orbit's rate
    earthG.rotateOnWorldAxis(V(0, 0, 1), -s.n * sub); light();
    // cameras: each view's own place, swung round by dragging and pulled in or out by zooming
    const fov = view === 3 || view === 1 ? Math.max(8, Math.min(75, 60 * look.zoom)) : 50;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (view === 0) {
      const upA = V(0, 1, 0).applyQuaternion(s.q);
      cam.position.copy(swing(V(0, 6.5, -20).multiplyScalar(look.zoom).applyQuaternion(s.q), upA, look.yaw, look.pitch).add(s.p)); cam.up.copy(upA);
      // straight on it looks ahead to the station; once swung round it turns to keep the capsule in the middle
      const w = Math.max(0, 1 - (Math.abs(look.yaw) + Math.abs(look.pitch)) / 0.6) / Math.max(1, look.zoom);
      cam.lookAt(swing(V(0, -1.5, 40).applyQuaternion(s.q), upA, look.yaw, look.pitch).multiplyScalar(w).add(s.p));
    } else if (view === 1) {
      cam.position.copy(V(0, 0, 0.2).applyQuaternion(s.q).add(s.p)); cam.up.copy(V(0, 1, 0).applyQuaternion(s.q));
      cam.lookAt(V(0, 0, 10).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-look.pitch, look.yaw, 0, 'YXZ'))).applyQuaternion(s.q).add(s.p));
    } else if (view === 2) {
      cam.position.copy(swing(V(6, 3, 6).multiplyScalar(look.zoom), V(1, 0, 0), look.yaw, look.pitch).add(V(...PORT))); cam.up.set(1, 0, 0); cam.lookAt(s.p);
    } else {
      // under the station's Earth-facing side, looking down and ahead (the horizon at the top, as from the Cupola);
      // drag down to look straight down, up to see the station's underside
      const b = station ? new THREE.Box3().setFromObject(station.group) : null;
      cam.position.set(b ? b.min.x - 1.5 : -12, b ? (b.min.y + b.max.y) / 2 : 0, b ? (b.min.z + b.max.z) / 2 : 0);
      cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(-1.45, Math.min(1.5, look.pitch + EARTH_TILT)), look.yaw, 0, 'YXZ')));
    }
    updateBelow(t);
    head.position.copy(cam.position);
    camE.quaternion.copy(cam.quaternion); camE.position.copy(cam.position).multiplyScalar(0.001); camE.fov = cam.fov; camE.aspect = cam.aspect; camE.updateProjectionMatrix();
    renderer.clear(); renderer.render(sky, camE); renderer.clearDepth(); renderer.render(scene, cam);
    drawHud();
  }
  const size = () => { const w = root.clientWidth; const h = root.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(root); size();
  let last = performance.now(); let raf = 0; let placed = 0;
  const loop = (t) => { const dt = Math.min(0.1, (t - last) / 1000); last = t; if (t - placed > 30000 && !paused) { placed = t; placeEarth(); } frame(dt, t); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  root.querySelector('.dock-x').focus();

  function close() {
    cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true);
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); sky.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); tex.dispose(); nightTex.dispose();
    for (const rec of patches.values()) rec.tex?.dispose(); patches.clear();
    renderer.dispose(); root.remove(); open = null; onClose?.();
  }
  open = { close, state: () => s, measure: () => measure(s), station: () => station, setState: (fn) => fn(s), frame, view: () => VIEWS[view], setView: (i) => { view = (i + VIEWS.length - 1) % VIEWS.length; cycleView(); }, look, below: () => { lastBelow = 0; return updateBelow(performance.now()); }, patches: () => [...patches.values()].filter((r) => r.mesh).length, paused: () => paused, togglePause, setSpeed: (x) => { speed = x; speedBtn.textContent = `${x}×`; }, sun: (v) => { sunLocal.copy(earthG.worldToLocal(V(...v).add(earthG.position)).normalize()); dark = null; light(); }, dark: () => dark };
  return open;
}
