// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: lifelike close-ups. When you zoom right in, the map fills with things at their real size:
//   • Ships (below about 40 km): every live ship in view becomes its 3D model (shipview.js) at its broadcast length and
//     beam, turned to its heading and gliding at its reported speed between position reports.
//   • Streets (below about 6 km): cars, vans, lorries and buses drive along the real roads of OpenStreetMap, on the
//     correct side for the country, faster on motorways than in side streets, fewer at night. They are placeholders:
//     the roads are real, the traffic is simulated (idea from God's Eye View by Bilawal Sidhu, MIT; no code copied).
//   • Buildings (below about 2.5 km): OpenStreetMap buildings raised to their mapped height (landscape.js).
//   • v2.18: vehicles keep a safe gap to the one ahead, brake and pull away smoothly, and queue at traffic lights
//     on town roads; ships draw a foam wake at the Kelvin angle (19.5°) that grows with speed; after dark ships
//     carry their navigation lights (white masthead and stern, red to port, green to starboard) and vehicles their
//     headlights and red tail lights.
//   • v2.19: the world around the roads (world.js): buildings with windows that light up after dark and are lit by
//     the real Sun, parks, woods, rivers and lakes with moving ripples, trees, pavements, lane lines, zebra
//     crossings and street lamps.
// Planes already turn into true-size 3D models up close (flights.js). The icons and pins stay on top of all of this.
// This file is loaded only the first time you zoom in that far, so it costs nothing at start-up.
import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed } from './feeds.js';
import { shipClass, shipDims, buildShip } from './shipview.js';
import { toLocal } from './landscape.js';
import { solarElevation, subsolarPoint } from './astro.js';
import { buildWorld, sunLocal } from './world.js';

export const SHIP_ALT = 0.0065; // globe radii (about 41 km)
export const STREET_ALT = 0.0009; // about 5.7 km
export const BUILDING_ALT = 0.0004; // about 2.5 km
const EARTH_M = 6_371_000;
const D2R = Math.PI / 180;
const ROAD_R = 1800; // metres of road network around the centre
const BLD_R = 900;
const AREA_R = 1400; // parks, woods and water

/** Unit vectors up, east and north at a place, in globe.gl's axes (as in flights.js). */
export function frameAt(lat, lng) {
  const phi = (90 - lat) * D2R; const th = (90 - lng) * D2R;
  const sp = Math.sin(phi); const cp = Math.cos(phi); const st = Math.sin(th); const ct = Math.cos(th);
  return { u: [sp * ct, cp, sp * st], e: [st, 0, -ct], n: [-cp * ct, sp, -cp * st] };
}
/** A matrix that puts local metres (x east, y north, z up) at a place on a globe of radius R, turned to `heading` (° from north). */
export function placeMatrix(m, R, lat, lng, heading = 0, upM = 0) {
  const { u, e, n } = frameAt(lat, lng); const k = R / EARTH_M; const h = heading * D2R; const ch = Math.cos(h); const sh = Math.sin(h);
  // the model's +x points along the heading, +y to its left, +z up
  const fx = n[0] * ch + e[0] * sh; const fy = n[1] * ch + e[1] * sh; const fz = n[2] * ch + e[2] * sh;
  const lx = u[1] * fz - u[2] * fy; const ly = u[2] * fx - u[0] * fz; const lz = u[0] * fy - u[1] * fx;
  const r = R + upM * k;
  m.set(fx * k, lx * k, u[0] * k, u[0] * r, fy * k, ly * k, u[1] * k, u[1] * r, fz * k, lz * k, u[2] * k, u[2] * r, 0, 0, 0, 1);
  return m;
}
/**
 * Where a ship is now: its last report moved on at its speed and course. `since` is when we started showing that
 * report, so the model starts on the ship's icon and glides ahead of it (at most two minutes, about 1 km at 15 knots)
 * until the next report puts both back in step.
 */
export function deadReckon(s, now = Date.now(), since = s.t) {
  const kt = Number(s.sog) || 0; const crs = Number.isFinite(+s.cog) && +s.cog < 360 ? +s.cog : 0;
  if (kt < 0.3) return [s.lat, s.lng];
  const dt = Math.min(120, Math.max(0, (now - Math.max(s.t || 0, since || 0)) / 1000)); const d = kt * 0.5144 * dt;
  return [s.lat + (d * Math.cos(crs * D2R)) / 110_540, s.lng + (d * Math.sin(crs * D2R)) / (111_320 * Math.cos(s.lat * D2R) || 1)];
}
const headingOf = (s) => (Number.isFinite(+s.hdg) && +s.hdg < 360 ? +s.hdg : Number.isFinite(+s.cog) && +s.cog < 360 ? +s.cog : 0);

// ------------------------------------------------------------------ simulated street traffic
/** Road classes: [typical speed m/s, metres between vehicles per direction, lanes each way]. */
export const ROADS = {
  motorway: [29, 45, 3], trunk: [24, 55, 2], primary: [15, 70, 2], secondary: [13, 90, 1], tertiary: [11, 120, 1],
  unclassified: [9, 220, 1], residential: [8, 200, 1], motorway_link: [16, 70, 1], trunk_link: [14, 80, 1], primary_link: [12, 90, 1], service: [5, 400, 1],
};
/** How busy roads are at a local hour (0–23): quiet at night, peaks at 8 and 17. */
export function trafficAt(hour) {
  const h = ((hour % 24) + 24) % 24; const peak = (c, w) => Math.exp(-(((h - c) / w) ** 2));
  return Math.max(0.12, Math.min(1, 0.18 + 0.55 * (h >= 6 && h <= 22 ? 1 : 0.2) + 0.45 * peak(8, 1.6) + 0.4 * peak(17.5, 2)));
}
// Places that drive on the left, as rough boxes (good enough for simulated traffic): the UK and Ireland, Japan,
// Australia, New Zealand, South Asia, southern and eastern Africa, Indonesia and Malaysia, Thailand, Hong Kong.
const LEFT = [[49.8, -10.7, 61, 1.9], [24, 122.9, 45.6, 146], [-44, 112, -10, 154], [-47.5, 166, -34, 179], [5.8, 60.8, 35.5, 92.7],
  [-35, 10, -15, 41], [-12, 28.9, 5, 42], [-11, 95, 7, 141.1], [5.6, 97.3, 20.5, 105.7], [22.1, 113.8, 22.6, 114.5]];
export const drivesLeft = (lat, lng) => LEFT.some(([a, b, c, d]) => lat >= a && lat <= c && lng >= b && lng <= d);
const VEHICLES = [ // [name, share, length, width, height, colours]
  ['car', 0.78, 4.5, 1.8, 1.45, ['#f4f6f8', '#1b1f24', '#9aa3ab', '#c0392b', '#2e5c8a', '#e0e3e6', '#3d4a56', '#7a1f1f', '#1f6f50', '#d9b44a']],
  ['van', 0.1, 5.4, 2.0, 2.3, ['#f4f6f8', '#e8eaec', '#2b5f9e', '#c9ced3']],
  ['lorry', 0.08, 11, 2.5, 3.6, ['#e9ecef', '#b03a2e', '#1d3557', '#f1c40f', '#2d6a4f']],
  ['bus', 0.04, 12, 2.55, 3.1, ['#d62828', '#1d70b8', '#f4a261', '#2a9d8f']],
];

/** Roads from an Overpass answer as polylines in local metres around (lat0, lng0). */
export function roadsFrom(elements, lat0, lng0) {
  const out = [];
  for (const el of elements ?? []) {
    const cls = el.tags?.highway; const spec = ROADS[cls]; if (el.type !== 'way' || !spec || !(el.geometry?.length >= 2)) continue;
    const pts = el.geometry.map((g) => toLocal(lat0, lng0, g.lat, g.lon)); const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum.at(-1); if (len < 15) continue;
    const ow = el.tags.oneway; const oneway = ow === 'yes' || ow === '1' || ow === '-1' || el.tags.junction === 'roundabout' || cls === 'motorway' || cls.endsWith('_link');
    out.push({ cls, pts, cum, len, oneway, rev: ow === '-1', lanes: Math.max(1, Math.min(4, Math.round((+el.tags.lanes || spec[2] * (oneway ? 1 : 2)) / (oneway ? 1 : 2)))) });
  }
  return out;
}
/** Position and heading (radians from +x, counter-clockwise) at distance s along a road. */
export function along(w, s) {
  let i = 1; while (i < w.cum.length - 1 && w.cum[i] < s) i++;
  const a = w.pts[i - 1]; const b = w.pts[i]; const seg = w.cum[i] - w.cum[i - 1] || 1; const t = Math.max(0, Math.min(1, (s - w.cum[i - 1]) / seg));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
}
/** Seeded random numbers, so a street looks the same each time you come back. */
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** The vehicles for a road network: [{ w, s, dir, lane, v, kind, color }], at most `max`. */
export function spawnTraffic(roads, { busy = 1, max = 1800, seed = 1 } = {}) {
  const R = rng(seed); const cars = []; const total = VEHICLES.reduce((a, v) => a + v[1], 0);
  const pick = () => { let x = R() * total; for (let k = 0; k < VEHICLES.length; k++) { x -= VEHICLES[k][1]; if (x <= 0) return k; } return 0; };
  for (let wi = 0; wi < roads.length; wi++) {
    const w = roads[wi]; const [v0, gap] = ROADS[w.cls];
    for (const dir of w.oneway ? [w.rev ? -1 : 1] : [1, -1]) {
      for (let lane = 0; lane < w.lanes; lane++) {
        const n = Math.floor((w.len / gap) * busy * (0.7 + R() * 0.6));
        for (let i = 0; i < n && cars.length < max; i++) {
          let kind = pick(); if (w.cls === 'residential' && kind >= 2) kind = 0; // no lorries in side streets
          const col = VEHICLES[kind][5]; cars.push({ w: wi, s: R() * w.len, dir, lane, v: v0 * (0.75 + R() * 0.35) * (kind >= 2 ? 0.85 : 1), kind, color: col[Math.floor(R() * col.length)] });
        }
      }
    }
  }
  return cars;
}

/**
 * Move the traffic on by dt seconds, like real drivers: each vehicle keeps about 1.2 s and 2 m to the one ahead in
 * its lane, pulls away at up to 2.5 m/s² and brakes at up to 6 m/s², slows for the junction at the end of its road,
 * and on town roads stops at a traffic light that turns every 30 seconds (half the roads at a time). `clock` is the
 * simulation time in seconds. Changes the cars in place.
 */
export const LIGHTS_ON = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential']);
export function followTraffic(cars, roads, dt, clock = 0) {
  if (!cars.groups) {
    const g = new Map();
    for (const c of cars) { const k = `${c.w}|${c.dir}|${c.lane}`; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(c); c.cur = c.v; }
    Object.defineProperty(cars, 'groups', { value: [...g.values()], enumerable: false });
  }
  for (const grp of cars.groups) {
    const w = roads[grp[0].w]; const len = w.len; const dir = grp[0].dir;
    const pos = (c) => (dir > 0 ? c.s : len - c.s); // distance travelled along the road in this direction
    grp.sort((a, b) => pos(a) - pos(b));
    const red = LIGHTS_ON.has(w.cls) && Math.floor((clock + (grp[0].w % 2) * 30) / 30) % 2 === 1;
    for (let i = 0; i < grp.length; i++) {
      const c = grp[i]; const p = pos(c); const half = VEHICLES[c.kind][2] / 2;
      let gap = Infinity;
      if (grp.length > 1) { const l = grp[(i + 1) % grp.length]; let pl = pos(l); if (pl <= p) pl += len; gap = pl - p - half - VEHICLES[l.kind][2] / 2; }
      const toEnd = len - p - half; // the junction (and its stop line) at the end of the road
      // a red light: the stop line is 3 m before the junction. A driver too close to stop comfortably (5 m/s²) goes on
      // through, as on amber; everyone else stops at the line or behind the queue.
      if (red && toEnd - 3 > -0.5 && (toEnd - 3 >= (c.cur * c.cur) / 10 - 0.5 || c.cur < 1)) gap = Math.min(gap, Math.max(0, toEnd - 3) + 2);
      let target = gap < 2.3 ? 0 : Math.min(c.v, (gap - 2) / 1.2);
      if (toEnd < 30) target = Math.min(target, c.v * (0.35 + 0.65 * Math.max(0, toEnd) / 30)); // slowing for the junction
      c.cur = target > c.cur ? Math.min(target, c.cur + 2.5 * dt) : Math.max(target, c.cur - 6 * dt);
    }
  }
  for (const c of cars) {
    const w = roads[c.w]; c.s += c.cur * dt * c.dir;
    if (c.s > w.len || c.s < 0) { c.s = c.dir > 0 ? c.s - w.len : c.s + w.len; if (c.s > w.len || c.s < 0) c.s = Math.random() * w.len; } // round the corner onto the next stretch
  }
  return cars;
}

/** A ship's foam wake in its own metres (+x ahead, +y to port): two arms at the Kelvin angle (19.5°) and a churned
    centre line from the stern, longer and brighter the faster it goes. Vertex colours carry the fade (RGBA). */
export function wakeGeometry(L, B, kt) {
  const len = Math.min(L * 6, Math.max(L * 0.6, kt * L * 0.35)); const a = Math.tan(19.5 * D2R); const x0 = -L / 2; const w = Math.max(1, B * 0.12);
  const P = []; const C = []; const N = 10; const peak = Math.min(0.85, 0.25 + kt / 25);
  const strip = (side, spread, width) => {
    for (let i = 0; i < N; i++) {
      const s0 = (i / N) * len; const s1 = ((i + 1) / N) * len;
      const y0 = side * (B / 2 * (1 - spread) + s0 * a * spread); const y1 = side * (B / 2 * (1 - spread) + s1 * a * spread);
      const w0 = width * (1 + s0 / len * 2); const w1 = width * (1 + s1 / len * 2);
      const f0 = peak * (1 - i / N) ** 1.6; const f1 = peak * (1 - (i + 1) / N) ** 1.6;
      P.push(x0 - s0, y0 - w0, 0.3, x0 - s0, y0 + w0, 0.3, x0 - s1, y1 - w1, 0.3, x0 - s1, y1 - w1, 0.3, x0 - s0, y0 + w0, 0.3, x0 - s1, y1 + w1, 0.3);
      for (const f of [f0, f0, f1, f1, f0, f1]) C.push(1, 1, 1, f);
    }
  };
  strip(1, 1, w); strip(-1, 1, w); strip(0, 0, Math.max(1, B * 0.3));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  return g;
}

/** The roads as one flat mesh of asphalt strips, each as wide as its lanes (x east, y north, metres). */
export function roadSurface(roads) {
  const P = [];
  for (const w of roads) {
    const half = (w.oneway ? w.lanes : w.lanes * 2) * 1.75 + 0.6;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, ay] = w.pts[i - 1]; const [bx, by] = w.pts[i]; const L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / L) * half; const ny = ((bx - ax) / L) * half;
      P.push(ax + nx, ay + ny, 0, ax - nx, ay - ny, 0, bx + nx, by + ny, 0, bx + nx, by + ny, 0, ax - nx, ay - ny, 0, bx - nx, by - ny, 0);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); return g;
}

// ------------------------------------------------------------------ the scene objects
function vehicleGeometry(L, W, H, kind) {
  // a body and a darker cabin or windscreen band; the model faces +x
  const parts = [];
  const add = (g0, c) => { const g = g0.toNonIndexed(); const col = new THREE.Color(c); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); };
  const box = (x, z, l, w, h, c) => { const g = new THREE.BoxGeometry(l, w, h); g.translate(x, 0, z + h / 2); add(g, c); };
  if (kind === 'car') { box(0, 0.25, L, W, H * 0.45, '#ffffff'); box(-L * 0.06, 0.25 + H * 0.45, L * 0.52, W * 0.88, H * 0.45, '#20262d'); }
  else if (kind === 'van') { box(0, 0.25, L, W, H - 0.25, '#ffffff'); box(L * 0.38, 0.25 + H * 0.5, L * 0.2, W * 1.01, H * 0.3, '#20262d'); }
  else if (kind === 'lorry') { box(L * 0.38, 0.4, L * 0.22, W, H * 0.75, '#ffffff'); box(-L * 0.12, 0.6, L * 0.74, W, H - 0.6, '#f2f2f2'); }
  else { box(0, 0.35, L, W, H - 0.35, '#ffffff'); box(0, 0.35 + (H - 0.35) * 0.45, L * 1.003, W * 1.01, (H - 0.35) * 0.3, '#20262d'); }
  const merged = new THREE.BufferGeometry(); const pos = []; const col = [];
  for (const g of parts) { pos.push(...g.attributes.position.array); col.push(...g.attributes.color.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); merged.computeVertexNormals();
  return merged;
}

/**
 * Installs the close-ups on a globe.gl globe. `ships()` returns the live ships array (or null) each time it is called.
 * Returns { update(pov), active(), stats() }; call update from the camera handler, and it animates itself while active.
 */
export function installCloseup({ globe, R = 100, ships = () => null, onBusy = () => {}, note = () => {} }) {
  const scene = globe.scene();
  const root = new THREE.Group(); root.name = 'closeups'; root.matrixAutoUpdate = false; scene.add(root);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shipGeo = new Map(); const shipMesh = new Map();
  const street = new THREE.Group(); street.matrixAutoUpdate = false; root.add(street);
  // the asphalt, half see-through so sharp satellite imagery still shows the real road markings under it
  const asphalt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x3b4148, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  asphalt.frustumCulled = false; asphalt.renderOrder = 1; asphalt.visible = false; street.add(asphalt); // v2.19: world.js draws the roads
  const fleets = VEHICLES.map(([kind, , L, W, H]) => { const m = new THREE.InstancedMesh(vehicleGeometry(L, W, H, kind), mat, 2000); m.count = 0; m.frustumCulled = false; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2000 * 3), 3); street.add(m); return m; });
  let pov = { lat: 0, lng: 0, altitude: 2 }; let on = false; let raf = 0; let last = performance.now();
  const net = { lat: null, lng: null, roads: [], cars: [], left: false, busy: 1, loading: false, buildings: null, err: '' };
  const tq = new THREE.Matrix4(); const col = new THREE.Color();
  let enabled = true; try { enabled = localStorage.getItem('global-intelligence-atlas-closeups') !== 'off'; } catch { /* private mode */ }
  // v2.18: wakes, lights after dark, and traffic that follows and queues
  const wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const lampMat = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const dark = { at: 0, night: false };
  const isNight = () => { const t = Date.now(); if (t - dark.at > 10_000) { dark.at = t; dark.night = solarElevation(pov.lat, pov.lng, new Date(t)) < -3; } return dark.night; };
  const MAXL = 2000 * 4; const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 3), 3).setUsage(THREE.DynamicDrawUsage));
  lampGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXL * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 3.5, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.frustumCulled = false; lamps.renderOrder = 3; lamps.visible = false; street.add(lamps);
  let simClock = 0; const inv = new THREE.Matrix4(); const camL = new THREE.Vector3();
  /** A ship's navigation lights in its own metres: white masthead and stern, red to port (+y), green to starboard. */
  function shipLamps(d) {
    const h = Math.max(3, d.L * 0.1); const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([d.L * 0.25, 0, h * 1.6, -d.L * 0.48, 0, h * 0.5, d.L * 0.1, d.B * 0.52, h * 0.7, d.L * 0.1, -d.B * 0.52, h * 0.7], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.97, 0.88, 1, 0.97, 0.88, 1, 0.15, 0.12, 0.2, 1, 0.4], 3));
    const p = new THREE.Points(g, lampMat); p.frustumCulled = false; p.renderOrder = 3; return p;
  }

  function shipsFrame(now) {
    const list = ships(); const want = new Set(); const night = isNight();
    if (list?.length && pov.altitude < SHIP_ALT) {
      const cut = Math.max(3, pov.altitude * 6371 * 1.3); // km around the centre
      const kx = 111.32 * Math.cos(pov.lat * D2R);
      let n = 0;
      for (const s of list) {
        if (n >= 80) break;
        const dy = (s.lat - pov.lat) * 110.54; const dx = (s.lng - pov.lng) * kx; if (dx * dx + dy * dy > cut * cut) continue;
        n++; want.add(s.mmsi);
        let m = shipMesh.get(s.mmsi);
        if (!m) {
          const meta = { name: s.meta?.name ?? s.name, shipType: s.meta?.shipType ?? s.type, length: s.meta?.length ?? s.len, width: s.meta?.width ?? s.beam, draught: s.meta?.draught ?? s.draught };
          const c = shipClass(meta); const d = shipDims(c.id, meta); const key = `${c.id}|${Math.round(d.L / 5)}|${Math.round(d.B)}`;
          let g = shipGeo.get(key); if (!g) { g = buildShip(c.id, d, Number(s.mmsi) % 997 || 7).geometry; shipGeo.set(key, g); }
          m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; m.frustumCulled = false; root.add(m); shipMesh.set(s.mmsi, m);
          m.userData.dims = d; m.userData.lamps = shipLamps(d); m.add(m.userData.lamps);
        }
        const kt = Number(s.sog) || 0; const wk = kt < 0.5 ? 0 : Math.round(kt); // the wake, rebuilt only when the speed changes by a knot
        if (m.userData.wk !== wk) {
          m.userData.wk = wk; if (m.userData.wake) { m.userData.wake.geometry.dispose(); m.userData.wake.removeFromParent(); m.userData.wake = null; }
          if (wk) { const w = new THREE.Mesh(wakeGeometry(m.userData.dims.L, m.userData.dims.B, kt), wakeMat); w.frustumCulled = false; w.renderOrder = 1; m.add(w); m.userData.wake = w; }
        }
        m.userData.lamps.visible = night;
        if (m.userData.t !== s.t) { m.userData.t = s.t; m.userData.since = now; } // a new report: start again from the icon
        const [la, lo] = deadReckon(s, now, m.userData.since); placeMatrix(m.matrix, R, la, lo, headingOf(s), 0); m.matrixWorldNeedsUpdate = true;
      }
    }
    for (const [k, m] of shipMesh) if (!want.has(k)) { m.userData.wake?.geometry.dispose(); m.userData.lamps?.geometry.dispose(); m.removeFromParent(); shipMesh.delete(k); }
  }

  async function loadStreets(lat, lng) {
    net.loading = true; net.err = ''; onBusy(true);
    const ll = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const q = `[out:json][timeout:25];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link)$"](around:${ROAD_R},${lat.toFixed(5)},${lng.toFixed(5)});way["building"](around:${BLD_R},${lat.toFixed(5)},${lng.toFixed(5)}););out tags geom 6000;(way["leisure"~"^(park|garden|pitch|playground|golf_course|common)$"](around:${AREA_R},${ll});way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|allotments|orchard|reservoir|basin)$"](around:${AREA_R},${ll});way["natural"~"^(water|wood|scrub|grassland|beach|sand)$"](around:${AREA_R},${ll});way["waterway"~"^(river|canal|stream|riverbank)$"](around:${AREA_R},${ll});relation["natural"="water"](around:${AREA_R},${ll});relation["landuse"="forest"](around:${AREA_R},${ll});relation["leisure"="park"](around:${AREA_R},${ll}););out tags geom 1500;node["natural"="tree"](around:${BLD_R},${ll});out 4000;`;
    try {
      const j = await getFeed('overpass', `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { ttl: 6 * 3600_000, timeout: 40_000 });
      const els = j?.elements ?? [];
      net.lat = lat; net.lng = lng; net.left = drivesLeft(lat, lng);
      net.roads = roadsFrom(els, lat, lng);
      const hour = (new Date().getUTCHours() + new Date().getUTCMinutes() / 60 + lng / 15 + 24) % 24; net.busy = trafficAt(hour);
      net.cars = spawnTraffic(net.roads, { busy: net.busy, seed: Math.round(lat * 1000) * 7919 + Math.round(lng * 1000) });
      net.world?.dispose(); net.world = null; net.buildings = null;
      try { net.world = buildWorld(els, lat, lng, net.roads); street.add(net.world.group); net.buildings = net.world.buildings; net.frame = frameAt(lat, lng); } catch (e) { net.err = `world: ${e.message}`; } // the traffic still runs
      placeMatrix(street.matrix, R, lat, lng, 90, 0); // heading 90: local +x east, +y north
      street.matrixWorldNeedsUpdate = true;
      const at = fleets.map(() => 0); // colours in the same order streetsFrame() fills the instances
      for (const c of net.cars) col.set(c.color).toArray(fleets[c.kind].instanceColor.array, at[c.kind]++ * 3);
      for (const f of fleets) f.instanceColor.needsUpdate = true;
      note(`${net.cars.length.toLocaleString()} simulated vehicles on ${net.roads.length.toLocaleString()} real roads`);
    } catch (e) { net.err = e.message ?? 'Overpass did not answer'; note(''); }
    net.loading = false; onBusy(false);
  }

  function streetsFrame(dt) {
    const show = pov.altitude < STREET_ALT && net.lat != null;
    street.visible = show; if (net.buildings) net.buildings.visible = pov.altitude < BUILDING_ALT * 1.8;
    if (!show) return;
    if (net.world) { // v2.19: light, time and the camera for the world's shaders, all in the street's local metres
      const now = Date.now(); if (now - (net.sunAt ?? 0) > 10_000) {
        net.sunAt = now; const el = solarElevation(net.lat, net.lng, new Date(now)); net.night = Math.max(0, Math.min(1, (2 - el) / 8));
        const s = subsolarPoint(new Date(now)); const phi = (90 - s.lat) * D2R; const th = (90 - s.lng) * D2R;
        net.sun = sunLocal(new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)), net.frame);
      }
      inv.copy(street.matrixWorld).invert(); camL.copy(globe.camera().position).applyMatrix4(inv);
      net.world.update({ night: net.night, t: simClock, camLocal: camL, sunLocal: net.sun, haze: 9000, hour: (new Date().getUTCHours() + new Date().getUTCMinutes() / 60 + net.lng / 15 + 24) % 24 });
      mat.color.setScalar(1 - net.night * 0.78);
    }
    const counts = fleets.map(() => 0);
    const side = net.left ? -1 : 1;
    simClock += dt; followTraffic(net.cars, net.roads, dt, simClock);
    const night = isNight(); const LP = lampGeo.attributes.position.array; const LC = lampGeo.attributes.color.array; let nl = 0;
    for (const c of net.cars) {
      const w = net.roads[c.w];
      const [x, y, a] = along(w, c.s); const ang = c.dir > 0 ? a : a + Math.PI;
      const off = w.oneway ? (c.lane - (w.lanes - 1) / 2) * 3.4 : side * (1.8 + c.lane * 3.4); // keep to the correct side
      const ox = Math.sin(ang) * off; const oy = -Math.cos(ang) * off;
      const f = fleets[c.kind]; const i = counts[c.kind]++;
      tq.makeRotationZ(ang); tq.setPosition(x + ox, y + oy, 0.05); f.setMatrixAt(i, tq);
      if (night && nl + 4 <= MAXL) { // two headlights ahead, two tail lights behind (brighter when braking)
        const [, , L, W, H] = VEHICLES[c.kind]; const ca = Math.cos(ang); const sa = Math.sin(ang); const cx = x + ox; const cy = y + oy; const z = Math.min(1, H * 0.45);
        const brake = c.cur < c.v * 0.6 ? 1 : 0.55;
        for (const [fx, sy, r, g, b] of [[L / 2, W * 0.35, 1, 0.95, 0.8], [L / 2, -W * 0.35, 1, 0.95, 0.8], [-L / 2, W * 0.38, brake, 0.08, 0.05], [-L / 2, -W * 0.38, brake, 0.08, 0.05]]) {
          LP[nl * 3] = cx + ca * fx - sa * sy; LP[nl * 3 + 1] = cy + sa * fx + ca * sy; LP[nl * 3 + 2] = z; LC[nl * 3] = r; LC[nl * 3 + 1] = g; LC[nl * 3 + 2] = b; nl++;
        }
      }
    }
    lamps.visible = nl > 0; lampGeo.setDrawRange(0, nl); lampGeo.attributes.position.needsUpdate = true; lampGeo.attributes.color.needsUpdate = true;
    fleets.forEach((f, k) => { f.count = counts[k]; f.instanceMatrix.needsUpdate = true; });
  }

  function frame(t) {
    raf = 0; if (!on) return;
    const dt = Math.min(0.25, (t - last) / 1000); last = t;
    shipsFrame(Date.now()); streetsFrame(dt);
    raf = requestAnimationFrame(frame);
  }
  const api = {
    update(p) {
      pov = p;
      const was = on; on = enabled && p.altitude < SHIP_ALT; root.visible = on;
      if (on && !was) { last = performance.now(); raf = requestAnimationFrame(frame); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!on) { for (const [k, m] of shipMesh) { m.removeFromParent(); shipMesh.delete(k); } return; }
      if (p.altitude < STREET_ALT && !net.loading) {
        const far = net.lat == null || Math.hypot((p.lat - net.lat) * 110_540, (p.lng - net.lng) * 111_320 * Math.cos(p.lat * D2R)) > ROAD_R * 0.55;
        if (far) { clearTimeout(api.t); api.t = setTimeout(() => { if (pov.altitude < STREET_ALT) loadStreets(pov.lat, pov.lng); }, 700); }
      }
      if (p.altitude >= STREET_ALT) note('');
    },
    active: () => on,
    setEnabled(v) { enabled = !!v; try { localStorage.setItem('global-intelligence-atlas-closeups', v ? 'on' : 'off'); } catch { /* private mode */ } api.update(pov); },
    enabled: () => enabled,
    stats: () => ({ on, ships: shipMesh.size, wakes: [...shipMesh.values()].filter((m) => m.userData.wake).length, shipLamps: [...shipMesh.values()].filter((m) => m.userData.lamps?.visible).length, carLamps: lamps.visible ? lampGeo.drawRange.count : 0, stopped: net.cars.filter((c) => c.cur === 0).length, night: dark.night, roads: net.roads.length, vehicles: net.cars.length, buildings: !!net.buildings, world: net.world?.stats() ?? null, left: net.left, busy: net.busy, err: net.err, street: street.visible }),
  };
  return api;
}
