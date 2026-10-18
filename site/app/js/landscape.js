// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: a small piece of real landscape, a few kilometres across, for the street-level views.
//   Terrain:   Terrain Tiles (Mapzen / Tilezen on the AWS Registry of Open Data): heights encoded in the colour of
//              each pixel of a PNG tile ("Terrarium": metres = red × 256 + green + blue / 256 − 32768).
//   Buildings: OpenStreetMap footprints from the Overpass API, raised to their mapped height, or their number of
//              floors × 3.2 m, or a typical height for the kind of building.
// Everything is built in local metres around one point (x east, y north, z up, the point's ground at z = 0) and
// merged into one mesh for the ground and one for all buildings, so a whole town costs two draw calls.
import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed } from './feeds.js';

export const TERRAIN_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Terrarium pixel → metres above sea level. */
export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
/** Local metres around (lat0, lng0) → latitude and longitude, and back. */
export const toLatLng = (lat0, lng0, x, y) => [lat0 + y / M_PER_DEG_LAT, lng0 + x / mPerDegLng(lat0)];
export const toLocal = (lat0, lng0, lat, lng) => [(lng - lng0) * mPerDegLng(lat0), (lat - lat0) * M_PER_DEG_LAT];

// ------------------------------------------------------------------ terrain
const tiles = new Map(); // "z/x/y" → Promise<ImageData>
function tile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tiles.has(key)) {
    if (tiles.size > 24) tiles.delete(tiles.keys().next().value);
    tiles.set(key, new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); resolve(g.getImageData(0, 0, c.width, c.height)); };
      img.onerror = () => { tiles.delete(key); reject(new Error('the terrain tile did not load')); };
      img.src = TERRAIN_URL(z, x, y);
    }));
  }
  return tiles.get(key);
}
const worldPx = (lat, lng, z) => {
  const s = 256 * 2 ** z; const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};

/**
 * Heights on an n × n grid covering ±radiusM around a point. Returns { n, radiusM, heights (metres above sea
 * level, row 0 = south), ground (height at the centre), at(x, y) for any local point inside }.
 */
export async function elevationGrid(lat, lng, radiusM, n = 129) {
  // a zoom where one tile is about as wide as the radius: 4 to 9 tiles, about 10–40 m between samples
  const z = Math.max(10, Math.min(14, Math.round(Math.log2(mPerDegLng(lat) * 360 / radiusM))));
  const [s, w] = toLatLng(lat, lng, -radiusM, -radiusM); const [nn, e] = toLatLng(lat, lng, radiusM, radiusM);
  const [x0, y1] = worldPx(s, w, z); const [x1, y0] = worldPx(nn, e, z);
  const need = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) need.push([tx, ty]);
  const max = 2 ** z; const got = new Map();
  await Promise.all(need.map(async ([tx, ty]) => { got.set(`${tx}/${ty}`, await tile(z, ((tx % max) + max) % max, ty)); }));
  const px = (gx, gy) => { // one pixel's height at whole world-pixel coordinates
    const im = got.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`); if (!im) return 0;
    const i = ((((gy % 256) + 256) % 256) * im.width + (((gx % 256) + 256) % 256)) * 4;
    return decodeTerrarium(im.data[i], im.data[i + 1], im.data[i + 2]);
  };
  const sample = (la, lo) => { // bilinear
    const [fx, fy] = worldPx(la, lo, z); const gx = Math.floor(fx - 0.5); const gy = Math.floor(fy - 0.5); const ax = fx - 0.5 - gx; const ay = fy - 0.5 - gy;
    return (px(gx, gy) * (1 - ax) + px(gx + 1, gy) * ax) * (1 - ay) + (px(gx, gy + 1) * (1 - ax) + px(gx + 1, gy + 1) * ax) * ay;
  };
  const heights = new Float32Array(n * n); const step = (2 * radiusM) / (n - 1);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const [la, lo] = toLatLng(lat, lng, -radiusM + c * step, -radiusM + r * step); heights[r * n + c] = sample(la, lo); }
  const at = (x, y) => { // bilinear on the grid
    const fc = Math.max(0, Math.min(n - 1.001, (x + radiusM) / step)); const fr = Math.max(0, Math.min(n - 1.001, (y + radiusM) / step));
    const c = Math.floor(fc); const r = Math.floor(fr); const ac = fc - c; const ar = fr - r; const h = (rr, cc) => heights[rr * n + cc];
    return (h(r, c) * (1 - ac) + h(r, c + 1) * ac) * (1 - ar) + (h(r + 1, c) * (1 - ac) + h(r + 1, c + 1) * ac) * ar;
  };
  return { n, radiusM, zoom: z, heights, ground: sample(lat, lng), at };
}

const C_WATER = new THREE.Color(0x2f6f9f); const C_LOW = new THREE.Color(0x5e7d4f); const C_MID = new THREE.Color(0x8a8455); const C_HIGH = new THREE.Color(0x9a8f86); const C_SNOW = new THREE.Color(0xeef2f5);
function groundColour(h, out) {
  if (h <= 0.5) return out.copy(C_WATER);
  if (h < 400) return out.copy(C_LOW).lerp(C_MID, h / 400);
  if (h < 1800) return out.copy(C_MID).lerp(C_HIGH, (h - 400) / 1400);
  return out.copy(C_HIGH).lerp(C_SNOW, Math.min(1, (h - 1800) / 900));
}
/** The grid as one mesh, heights relative to the centre's ground. */
export function terrainMesh(grid, material) {
  const { n, radiusM, heights, ground } = grid;
  const geo = new THREE.PlaneGeometry(2 * radiusM, 2 * radiusM, n - 1, n - 1); // rows from north to south
  const pos = geo.attributes.position; const col = new Float32Array(pos.count * 3); const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = n - 1 - Math.floor(i / n); const h = heights[r * n + (i % n)];
    pos.setZ(i, (h <= 0.5 ? 0 : h) - ground); groundColour(h, c).toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.name = 'terrain'; mesh.receiveShadow = false;
  return mesh;
}

// ------------------------------------------------------------------ buildings
const TYPICAL = { house: 6, detached: 6, semidetached_house: 6, bungalow: 4, garage: 3, garages: 3, shed: 3, hut: 3, roof: 4, carport: 3, terrace: 9, residential: 12, apartments: 15, commercial: 12, retail: 6, office: 18, industrial: 9, warehouse: 9, church: 18, cathedral: 30, hospital: 18, school: 9, university: 15, hotel: 24, train_station: 12, stadium: 20 };
const num = (s) => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
/** Height and base of a building from its OpenStreetMap tags (metres). */
export function buildingHeight(t = {}) {
  let h = num(t.height); if (h != null && /ft|'/.test(String(t.height))) h *= 0.3048;
  const levels = num(t['building:levels']); const roof = num(t['roof:levels']) ?? 0;
  if (h == null && levels != null) h = (levels + roof * 0.5) * 3.2 + 1;
  const how = h != null ? (num(t.height) != null ? 'mapped' : 'floors') : 'typical';
  if (h == null) h = TYPICAL[t.building] ?? 8;
  let min = num(t.min_height); if (min == null && num(t['building:min_level']) != null) min = num(t['building:min_level']) * 3.2;
  return { h: Math.max(2, Math.min(h, 900)), min: Math.max(0, Math.min(min ?? 0, h - 1)), how };
}
/** Overpass: building outlines around a point (up to `max`). */
export async function fetchBuildings(lat, lng, radiusM, max = 4000) {
  const q = `[out:json][timeout:25];way["building"](around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)});out tags geom ${max};`;
  const j = await getFeed('overpass', `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { ttl: 3600_000, timeout: 40_000 });
  return (j.elements ?? []).filter((e) => e.type === 'way' && e.geometry?.length >= 4).map((e) => ({ id: e.id, tags: e.tags ?? {}, geometry: e.geometry }));
}
const WALL = new THREE.Color(0xd8d2c6); const WALL_TALL = new THREE.Color(0xa9bccb); const ROOF = new THREE.Color(0x8c8378);
/**
 * All buildings as one mesh. `elevAt(x, y)` gives the ground height (metres, relative to the centre) at a local point,
 * so each building stands on the terrain. Returns { mesh, count, mapped, floors, typical, tallest }.
 */
export function buildingsMesh(buildings, lat0, lng0, elevAt, material) {
  const P = []; const C = []; let count = 0; let tallest = null; const how = { mapped: 0, floors: 0, typical: 0 };
  const push = (a, b, c, col) => { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (let k = 0; k < 3; k++) C.push(col.r, col.g, col.b); };
  const wc = new THREE.Color();
  for (const b of buildings) {
    let ring = b.geometry.map((g) => toLocal(lat0, lng0, g.lat, g.lon));
    if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
    if (ring.length < 3) continue;
    const v2 = ring.map(([x, y]) => new THREE.Vector2(x, y));
    if (THREE.ShapeUtils.isClockWise(v2)) { v2.reverse(); ring.reverse(); }
    const { h, min, how: hw } = buildingHeight(b.tags); how[hw]++;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length; const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    let base = Infinity; for (const [x, y] of ring) base = Math.min(base, elevAt(x, y)); if (!Number.isFinite(base)) base = elevAt(cx, cy);
    const z0 = base + min; const z1 = base + h;
    wc.copy(WALL).lerp(WALL_TALL, Math.min(1, h / 120));
    for (let i = 0; i < ring.length; i++) { // walls, facing out (counter-clockwise outline)
      const a = ring[i]; const c = ring[(i + 1) % ring.length];
      push([a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], wc); push([a[0], a[1], z0], [c[0], c[1], z1], [a[0], a[1], z1], wc);
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) push([ring[i][0], ring[i][1], z1], [ring[j][0], ring[j][1], z1], [ring[k][0], ring[k][1], z1], ROOF);
    count++; if (!tallest || h > tallest.h) tallest = { h, name: b.tags.name ?? null, x: cx, y: cy };
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.name = 'buildings';
  return { mesh, count, ...how, tallest };
}

/** One material for both meshes (vertex colours, lit), shared so the shader compiles once. */
export const landscapeMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/**
 * The landscape around a point: { group, grid, elevAt(x, y) relative to the centre, ground (metres above sea level),
 * buildings: { count, … } | null, notes: [] }. Terrain or buildings failing leaves a flat plain or no buildings,
 * with a note, rather than nothing.
 */
export async function buildLandscape(lat, lng, { radiusM = 1500, buildingsM = 700, material = landscapeMaterial() } = {}) {
  const group = new THREE.Group(); group.name = 'landscape'; const notes = [];
  const [gridR, bR] = await Promise.allSettled([elevationGrid(lat, lng, radiusM), buildingsM > 0 ? fetchBuildings(lat, lng, buildingsM) : Promise.resolve([])]);
  let grid = gridR.status === 'fulfilled' ? gridR.value : null;
  if (!grid) { notes.push(`Terrain unavailable (${gridR.reason?.message ?? 'no answer'}); showing flat ground.`); grid = { n: 2, radiusM, heights: new Float32Array(4).fill(1), ground: 1, at: () => 1, zoom: null }; }
  const elevAt = (x, y) => grid.at(x, y) - grid.ground;
  group.add(terrainMesh(grid, material));
  let buildings = null;
  if (bR.status === 'fulfilled') { buildings = buildingsMesh(bR.value, lat, lng, elevAt, material); if (buildings.count) group.add(buildings.mesh); }
  else notes.push(`Buildings unavailable (${bR.reason?.message ?? 'no answer'}).`);
  return { group, grid, elevAt, ground: grid.ground, buildings, notes };
}

/** Frees the GPU memory of a landscape group (geometries only; the material is shared). */
export function disposeLandscape(group) { group?.traverse((o) => o.geometry?.dispose()); group?.removeFromParent(); }
