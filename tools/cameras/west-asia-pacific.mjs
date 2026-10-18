// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — public traffic cameras for the US West/South and Asia-Pacific:
// Houston TranStar (Texas), NDOT (Nevada), UDOT (Utah), ODOT TripCheck (Oregon), LTA Singapore and
// MLIT river cameras (Japan). Source lists, URLs and record shapes adapted from Osiris by simplifaisoul, MIT
// (https://github.com/simplifaisoul/osiris, src/app/api/cctv). Every request goes through get() and identifies
// the atlas honestly; Osiris's spoofed-header "stealthFetch" is not used, so a source that refuses an honest
// request is reported by fetch-cameras.mjs instead of being worked around.
// Parsers are pure and exported so tests/cameras/west-asia-pacific.test.mjs can run them on fixtures.
import { get, ok, row, pool } from './util.mjs';

const CAP = 5000;
const inBox = (lat, lng, b) => ok(lat, lng) && lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3];
const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// ── Texas: TxDOT inventory joined to Houston TranStar JPEGs ───────────────────────────────────────────
// TxDOT's ITS site lists every district's cameras with coordinates, but serves the pictures as base64 inside
// JSON (no image URL a static page can show), and answers null for Houston and Yoakum anyway. Houston TranStar
// publishes plain JPEGs by numeric id; a TxDOT camera is kept only when its "Road @ Cross street" label matches
// exactly one TranStar listing, so no picture is ever placed at the wrong intersection.
export const TXDOT_BASE = 'https://its.txdot.gov/its/DistrictIts/';
export const TRANSTAR = 'https://traffic.houstontranstar.org';
export const TX_DISTRICTS = { HOU: 'Houston', YKM: 'Yoakum' };
const TX_BOX = [25.8, 36.6, -106.7, -93.4];
const normalName = (v) => String(v).toLowerCase().replaceAll('&amp;', 'and').replace(/[^a-z0-9]/g, '');

/** TxDOT GetCctvStatusListByDistrict → [{ id, name, lat, lng, district }] (deduplicated, online, in Texas). */
export function parseTxdotInventory(data, district) {
  const groups = data?.roadwayCctvStatuses;
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new Error('TxDOT inventory is missing roadwayCctvStatuses');
  const out = new Map();
  for (const rows of Object.values(groups)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const id = r.icd_Id;
      if (typeof id !== 'string' || !id.trim() || id.length > 256 || r.hasSnapshot !== true) continue;
      if (r.statusDescription === 'Device Error' || r.statusDescription === 'Device Offline') continue;
      if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || !inBox(r.latitude, r.longitude, TX_BOX)) continue;
      out.set(id, { id, name: clean(r.name) || id, lat: r.latitude, lng: r.longitude, district });
    }
  }
  return [...out.values()];
}
/** Roadway keys from the TranStar mobile camera index page. */
export const parseTranstarRoads = (html) => [...new Set([...html.matchAll(/roadway=([^"'&<>]+)/g)].map((m) => m[1]))];
/** Camera links on one TranStar roadway page → [{ road, name, id }]. */
export const parseTranstarCameras = (road, html) => [...html.matchAll(/cam=([^"'&<>]+)(?:&amp;|&)id=(\d+)/g)].map((m) => {
  let name = m[1]; try { name = decodeURIComponent(name); } catch { /* keep raw */ }
  return { road, name: name.replaceAll('_', ' '), id: m[2] };
});
/** Join TxDOT cameras to unique TranStar listings → rows. */
export function matchTranstar(txdot, listings) {
  const index = new Map();
  for (const l of listings) {
    const key = normalName(`${l.road} @ ${l.name}`);
    const prev = index.get(key);
    if (prev && prev.id !== l.id) index.set(key, null); else if (!index.has(key)) index.set(key, l);
  }
  const out = new Map();
  for (const c of txdot) {
    const m = index.get(normalName(c.name));
    if (!m || out.has(m.id)) continue;
    out.set(m.id, row(`transtar-${m.id}`, c.name, c.lat, c.lng, `${TRANSTAR}/snapshots/cctv/${m.id}.jpg`, '', `${TX_DISTRICTS[c.district] ?? 'Texas'} · Texas`));
  }
  return [...out.values()];
}
async function transtar() {
  const page = `${TRANSTAR}/mobile/itranstar_cctv.aspx`;
  const roads = parseTranstarRoads(await get(page, 'text'));
  if (roads.length < 20) throw new Error(`Houston TranStar road list is incomplete (${roads.length} roads)`);
  const listings = (await pool(roads, 4, async (road) => {
    try { return parseTranstarCameras(road, await get(`${page}?roadway=${encodeURIComponent(road)}`, 'text')); } catch (e) { console.warn(`transtar ${road}: ${e.message}`); return []; }
  })).flat();
  if (listings.length < 300) throw new Error(`Houston TranStar camera list is incomplete (${listings.length})`);
  const txdot = (await pool(Object.keys(TX_DISTRICTS), 2, async (d) => parseTxdotInventory(await get(`${TXDOT_BASE}GetCctvStatusListByDistrict?districtCode=${d}`), d))).flat();
  return matchTranstar(txdot, listings).slice(0, CAP);
}

// ── IBI 511 DataTables endpoint (Nevada, Utah) ────────────────────────────────────────────────────────
/** URL-encoded DataTables `query` parameter for one page. */
export function buildQuery(start, length) {
  return encodeURIComponent(JSON.stringify({
    columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }, { name: 'roadway', s: true }, { data: 3, name: '' }],
    order: [{ column: 1, dir: 'asc' }], start, length, search: { value: '' },
  }));
}
/** `POINT (lng lat)` → { lat, lng } or null. */
export function parseWkt(wkt) {
  const m = typeof wkt === 'string' && wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]); const lat = parseFloat(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
const PAGE = 100; // the server caps a page at 100 rows
async function ibi511(base, map) {
  const url = (start) => `${base}/List/GetData/Cameras?query=${buildQuery(start, PAGE)}&lang=en-US`;
  const init = { headers: { 'X-Requested-With': 'XMLHttpRequest' } }; // the header the site's own table sends
  const first = await get(url(0), 'json', init);
  const total = Math.min(Number(first?.recordsTotal) || 0, CAP);
  const starts = []; for (let s = PAGE; s < total; s += PAGE) starts.push(s);
  const pages = await pool(starts, 4, async (s) => { try { return (await get(url(s), 'json', init))?.data ?? []; } catch (e) { console.warn(`${base} page ${s}: ${e.message}`); return []; } });
  const out = new Map();
  for (const rec of [first?.data ?? [], ...pages].flat()) { const r = map(rec); if (r) out.set(r[0], r); }
  return [...out.values()].slice(0, CAP);
}

// Nevada — NDOT / nvroads.com, ~600 cameras; 587 of them carry a public HLS playlist (CORS-open).
export const NDOT_BASE = 'https://www.nvroads.com';
const NV_BOX = [34.9, 42.1, -120.1, -113.9];
export function mapNevada(rec) {
  if (!rec || typeof rec.id !== 'number') return null;
  const img = rec.images?.[0];
  if (!img || img.blocked || img.disabled) return null;
  const p = parseWkt(rec.latLng?.geography?.wellKnownText);
  if (!p || !inBox(p.lat, p.lng, NV_BOX)) return null;
  const snapshot = img.imageUrl ? `${NDOT_BASE}${img.imageUrl}` : '';
  const video = img.videoDisabled ? '' : clean(img.videoUrl);
  const stream = /\.m3u8(\?|$)/i.test(video) ? video : '';
  if (!snapshot && !stream) return null;
  const name = clean(img.description) || clean(rec.location) || clean(rec.roadway);
  const r = row(`ndot-${rec.id}`, name && name !== 'N/A' ? name : `NDOT Camera ${rec.id}`, p.lat, p.lng, snapshot, stream, 'Nevada');
  return r[4] || r[5] ? r : null;
}
// Utah — UDOT Traffic (IBI 511 at prod-ut.ibi511.com), ~2,000 cameras with JPEG snapshots.
export const UDOT_BASE = 'https://prod-ut.ibi511.com';
const UT_BOX = [36.9, 42.1, -114.2, -108.9];
export function mapUtah(rec) {
  if (!rec || typeof rec.id !== 'number') return null;
  const img = rec.images?.[0];
  if (!img || img.blocked || img.disabled) return null;
  const p = parseWkt(rec.latLng?.geography?.wellKnownText);
  if (!p || !inBox(p.lat, p.lng, UT_BOX)) return null;
  const road = clean(rec.roadway);
  return row(`udot-${rec.id}`, clean(rec.location) || road || 'UDOT Traffic Camera', p.lat, p.lng, `${UDOT_BASE}/map/Cctv/${rec.id}`, '', road && road !== 'Unknown' ? `${road} · Utah` : 'Utah');
}

// ── Oregon — ODOT TripCheck, ~1,100 cameras (Esri-style feature dump; frames on tripcheck.com) ──────────
export const TRIPCHECK_INVENTORY = 'https://www.tripcheck.com/Scripts/map/data/cctvinventory.js';
const OR_BOX = [41.9, 46.3, -124.6, -116.4];
export function mapOregon(feature) {
  const a = feature?.attributes;
  if (!a || a.cameraId == null || !a.filename) return null;
  if (typeof a.latitude !== 'number' || typeof a.longitude !== 'number' || !inBox(a.latitude, a.longitude, OR_BOX)) return null;
  const route = clean(a.route);
  return row(`odot-${a.cameraId}`, clean(a.title) || route || `ODOT Camera ${a.cameraId}`, a.latitude, a.longitude,
    `https://tripcheck.com/RoadCams/cams/${String(a.filename).trim()}`, '', route ? `${route} · Oregon` : 'Oregon');
}
export function parseOregon(data) {
  const out = new Map();
  for (const f of data?.features ?? []) { const r = mapOregon(f); if (r && !out.has(r[0])) out.set(r[0], r); }
  return [...out.values()].slice(0, CAP);
}
async function oregon() {
  // TripCheck answers 406 to a JSON Accept header; it serves the file (JSON despite the .js name) to */*.
  const body = await get(TRIPCHECK_INVENTORY, 'raw');
  try { return parseOregon(JSON.parse(body)); } catch (e) { throw new Error(`TripCheck inventory is not JSON: ${e.message}`); }
}

// ── Singapore — LTA traffic images via data.gov.sg (~90 expressway cameras, images refresh every minute) ─
export const LTA_URL = 'https://api.data.gov.sg/v1/transport/traffic-images';
export function parseSingapore(data) {
  const out = new Map();
  for (const c of data?.items?.[0]?.cameras ?? []) {
    const lat = Number(c?.location?.latitude); const lng = Number(c?.location?.longitude);
    if (!c?.camera_id || !c.image || !ok(lat, lng)) continue;
    const r = row(`sg-${c.camera_id}`, `LTA camera ${c.camera_id}`, lat, lng, c.image, '', 'Singapore');
    if (r[4]) out.set(r[0], r);
  }
  return [...out.values()];
}

// ── Japan — MLIT river-monitoring cameras (cam.river.go.jp), Tokyo and Yokohama ─────────────────────────
// A fixed list: MLIT publishes these stills at stable URLs but no machine-readable inventory. Only Osiris's
// entries with surveyed coordinates are kept; its YouTube streams are left to the world-webcam layer.
export const MLIT_CAMERAS = [
  ['303329015', 'Aoba Platform, Meguro Ward', 35.649111, 139.693419, 'Tokyo'],
  ['303585018', 'Asayama Bridge', 35.536928, 139.498187, 'Yokohama'],
  ['303585047', 'Atago-Shirane Bridge', 35.47929, 139.552883, 'Yokohama'],
  ['103585088', 'Banri Bridge', 35.463406, 139.622166, 'Yokohama'],
  ['103073090', 'Bentenjima Bridge, Urayasu', 35.639903, 139.887903, 'Chiba'],
  ['221281005', 'Shuto Expressway Route 7, Arakawa', 35.698164, 139.859811, 'Tokyo'],
  ['cctv_130001_31C03351', 'Den-en-chofu water-level station, Tama River', 35.582931, 139.672006, 'Tokyo'],
  ['221320032', 'Den-en-chofu, Ota Ward', 35.589261, 139.665769, 'Tokyo'],
  ['303329016', 'Ebara regulating pond, Shinagawa', 35.627906, 139.716111, 'Tokyo'],
  ['221320007', 'Futako-Tamagawa Rise Tower, Setagaya', 35.610458, 139.629478, 'Tokyo'],
  ['303585121', 'Hachiman Bridge', 35.41315, 139.628097, 'Yokohama'],
  ['103585089', 'Heiwa Bridge', 35.46374, 139.588114, 'Yokohama'],
];
export const mlitRows = () => MLIT_CAMERAS.map(([id, name, lat, lng, area]) => row(`mlit-${id}`, name, lat, lng, `https://cam.river.go.jp/cam/now/${id}.jpg`, '', `${area} · Japan`));

export const sources = [
  { key: 'transtar', name: 'Houston TranStar + TxDOT (Texas)', run: transtar },
  { key: 'ndot', name: 'NDOT nvroads.com (Nevada)', run: () => ibi511(NDOT_BASE, mapNevada) },
  { key: 'udot', name: 'UDOT Traffic (Utah)', run: () => ibi511(UDOT_BASE, mapUtah) },
  { key: 'odot', name: 'ODOT TripCheck (Oregon)', run: oregon },
  { key: 'ltasg', name: 'LTA traffic images (Singapore)', run: async () => parseSingapore(await get(LTA_URL)) },
  { key: 'mlitriver', name: 'MLIT river cameras (Japan)', run: async () => mlitRows() },
];
