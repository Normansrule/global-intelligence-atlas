// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — North American traffic-camera sources (US states, Canadian provinces and cities).
// Adapted from Osiris by simplifaisoul, MIT (github.com/simplifaisoul/osiris, src/app/api/cctv: ibi511.ts, ontario.ts,
// alberta.ts, arizona.ts, florida.ts, georgia.ts, northcarolina.ts, louisiana.ts, edmonton.ts, indiana.ts,
// michigan.ts and the inline WSDOT, Ottawa, Toronto and Butler County sources in route.ts).
// Every request is an honest one made through util.get(): our own User-Agent, no forged headers, no proxies.
// The parsers are pure and exported so tests/cameras/north-america.test.mjs can run them on fixtures offline.
import { get, ok, row, pool } from './util.mjs';

const CAP = 5000;          // never keep more than this many cameras from one source
const CONCURRENCY = 4;     // at most four requests in flight against one agency

// ─────────────────────────────────────────────────────────────────────────────
// IBI 511 platform. Several agencies run the same vendor stack, and its own camera page reads a keyless
// DataTables endpoint, /List/GetData/Cameras?query=<json>&lang=en, that pages (at most 100 rows) and gives each
// camera's position as WKT "POINT (lng lat)" and a public JPEG at /map/Cctv/{imageId}.

/** The URL-encoded DataTables `query` parameter for one page. */
export function buildQuery(start, length) {
  return encodeURIComponent(JSON.stringify({
    columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }, { name: 'roadway', s: true }, { data: 3, name: '' }],
    order: [{ column: 1, dir: 'asc' }], start, length, search: { value: '' },
  }));
}
export const ibi511PageUrl = (cfg, start) => `${cfg.base}/List/GetData/Cameras?query=${buildQuery(start, cfg.pageSize ?? 100)}&lang=en`;

/** `POINT (lng lat)` → { lat, lng }, or null. */
export function parseWkt(wkt) {
  const m = String(wkt ?? '').match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]); const lat = parseFloat(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const blank = (s) => { const t = s == null ? '' : String(s).trim(); return t && t !== 'N/A' && t !== 'Unknown' ? t : ''; };
/** An asset-code prefix in front of a readable label: `GDOT-1130: I-20 E at SR5 …`, `ALPH-0050: …`. */
const CODE_PREFIX = /^[A-Z]{2,8}-?\d*\s*:\s*/;

/** The best name a row supports: a readable location, else the road and the direction it watches. */
export function cameraLabel(rec) {
  const loc = blank(rec?.location).replace(CODE_PREFIX, '');
  if (loc && / /.test(loc)) return loc;          // a space separates a place name from an equipment code
  const road = blank(rec?.roadway);
  if (!road) return loc || null;
  const dir = blank(rec?.direction);
  return dir ? `${road} ${dir}` : road;
}
/** City, else county (with a suffix), else the state, for the caption. */
export function cameraCity(rec, state, countySuffix = ' County') {
  const city = blank(rec?.city); if (city) return city;
  const county = blank(rec?.county); if (county) return `${county}${countySuffix}`;
  return state;
}
const hls = (u) => { const t = u == null ? '' : String(u).trim(); return /^https?:\/\/.*\.m3u8(\?|$)/i.test(t) ? t : ''; };

/** One /List/GetData/Cameras row → a GIA camera row, or null. */
export function mapIbi511Record(rec, cfg) {
  if (!rec || typeof rec.id !== 'number') return null;
  const img = rec.images?.[0];
  if (!img || img.blocked || img.disabled) return null;
  const c = parseWkt(rec.latLng?.geography?.wellKnownText);
  if (!c || !ok(c.lat, c.lng)) return null;
  const b = cfg.bounds;
  if (c.lat < b.minLat || c.lat > b.maxLat || c.lng < b.minLng || c.lng > b.maxLng) return null;
  const snapshot = img.imageUrl ? new URL(img.imageUrl, cfg.base).href : '';
  // `isVideoAuthRequired` means the playlist needs a session only the agency's own player gets; those edges answer
  // 401 to everyone else, so such rows (and agencies whose video edge is closed) show the public still instead.
  const video = img.videoDisabled || img.isVideoAuthRequired === true || cfg.snapshotOnly ? '' : hls(img.videoUrl);
  if (!snapshot && !video) return null;
  const name = (cfg.label ? cfg.label(rec, img) : cameraLabel(rec)) || `${cfg.source} camera ${rec.id}`;
  const place = cfg.label ? cfg.state : cameraCity(rec, cfg.state, cfg.countySuffix);
  const area = [cfg.state, place !== cfg.state ? place : '', blank(rec.roadway)].filter(Boolean).join(' · ');
  return row(`${cfg.idPrefix}-${rec.id}`, name, c.lat, c.lng, snapshot, video, area);
}
/** One DataTables page → { rows, total }. */
export function parseIbi511Page(json, cfg) {
  const data = Array.isArray(json?.data) ? json.data : [];
  return { rows: data.map((r) => mapIbi511Record(r, cfg)).filter(Boolean), raw: data.length, total: Number(json?.recordsTotal) || 0 };
}

const XHR = { headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 30_000 };
/** Every camera one IBI deployment publishes, paged politely and de-duplicated. `fetchJson` is injectable for tests. */
export async function loadIbi511(cfg, fetchJson = (u) => get(u, 'json', XHR)) {
  const size = cfg.pageSize ?? 100;
  const seen = new Map();
  const ingest = (p) => { for (const r of p.rows) if (seen.size < CAP || seen.has(r[0])) seen.set(r[0], r); };
  const first = parseIbi511Page(await fetchJson(ibi511PageUrl(cfg, 0)), cfg);
  ingest(first);
  const starts = [];
  for (let s = size; s < first.total && s < CAP; s += size) starts.push(s);
  const failed = [];
  let raw = first.raw;
  await pool(starts, CONCURRENCY, async (s) => {
    try { const p = parseIbi511Page(await fetchJson(ibi511PageUrl(cfg, s)), cfg); raw += p.raw; ingest(p); } catch { failed.push(s); }
  });
  for (const s of failed) {     // one quiet retry each: these agencies throttle bursts rather than refuse them
    try { const p = parseIbi511Page(await fetchJson(ibi511PageUrl(cfg, s)), cfg); raw += p.raw; ingest(p); } catch { /* counted below */ }
  }
  // A read materially short of recordsTotal is lost pages, not a smaller network: throw so the previous list is kept.
  const expected = Math.min(first.total, CAP);
  if (expected > 0 && raw < expected * 0.95) throw new Error(`${cfg.source} short read: ${raw} of ${first.total} rows`);
  return [...seen.values()];
}

export const IBI = {
  on511: { base: 'https://511on.ca', idPrefix: 'on', source: '511 Ontario', state: 'Ontario', countySuffix: '', bounds: { minLat: 41.6, maxLat: 57.0, minLng: -95.3, maxLng: -74.2 } },
  ab511: { base: 'https://511.alberta.ca', idPrefix: 'ab', source: '511 Alberta', state: 'Alberta', pageSize: 50, bounds: { minLat: 48.9, maxLat: 60.1, minLng: -120.1, maxLng: -109.9 } },
  az511: { base: 'https://az511.gov', idPrefix: 'az', source: 'ADOT', state: 'Arizona', bounds: { minLat: 31.3, maxLat: 37.1, minLng: -115.0, maxLng: -109.0 } },
  fl511: { base: 'https://fl511.com', idPrefix: 'fl', source: 'FDOT', state: 'Florida', snapshotOnly: true, bounds: { minLat: 24.4, maxLat: 31.1, minLng: -87.7, maxLng: -79.9 } },
  ga511: { base: 'https://511ga.org', idPrefix: 'ga', source: 'GDOT', state: 'Georgia', snapshotOnly: true, bounds: { minLat: 30.3, maxLat: 35.1, minLng: -85.7, maxLng: -80.8 } },
  drivenc: { base: 'https://drivenc.gov', idPrefix: 'nc', source: 'NCDOT', state: 'North Carolina', snapshotOnly: true, bounds: { minLat: 33.8, maxLat: 36.6, minLng: -84.4, maxLng: -75.4 } },
  // Louisiana's `location` is a real cross-street on every row, and `description` is a sentence about traffic
  // direction, so the label order differs from the other deployments.
  la511: { base: 'https://511la.org', idPrefix: 'la', source: 'LADOTD', state: 'Louisiana', bounds: { minLat: 28.8, maxLat: 33.1, minLng: -94.2, maxLng: -88.6 },
    label: (rec, img) => [rec.location, rec.roadway, img?.description].map(blank).find(Boolean) || null },
};

// ─────────────────────────────────────────────────────────────────────────────
// City of Edmonton — the site's own map calls an ASP.NET page method (POST, JSON body, rows wrapped in `d`).
// Live HLS only: https://{MMSUrl}/{Forge}/public/hls/{StreamCode}.m3u8 on the city's winkcdn.com host.
const YEG = { minLat: 53.3, maxLat: 53.8, minLng: -114.0, maxLng: -113.2 };
export function parseEdmonton(payload) {
  const rows = payload?.d; if (!Array.isArray(rows)) return [];
  const out = []; const seen = new Set();
  for (const r of rows) {
    if (String(r?.Status) !== '1') continue;
    const code = r.Code != null ? String(r.Code) : '';
    if (!code || seen.has(code)) continue;
    const host = String(r.MMSUrl ?? '').trim().toLowerCase(); const stream = String(r.StreamCode ?? '').trim();
    if (host !== 'winkcdn.com' && !host.endsWith('.winkcdn.com')) continue;
    if (!Number.isInteger(r.Forge) || !/^[\w-]+$/.test(stream)) continue;
    const lat = parseFloat(r.Latitude ?? ''); const lng = parseFloat(r.Longitude ?? '');
    if (!ok(lat, lng) || lat < YEG.minLat || lat > YEG.maxLat || lng < YEG.minLng || lng > YEG.maxLng) continue;
    seen.add(code);
    const roads = [r.PrimaryRoad, r.SecondaryRoad].map((x) => String(x ?? '').trim()).filter(Boolean);
    out.push(row(`yeg-${code}`, roads.join(' & ') || `Edmonton camera ${code}`, lat, lng, '', `https://${host}/${r.Forge}/public/hls/${stream}.m3u8`, 'Alberta · Edmonton'));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Indiana — INDOT TrafficWise on the CARS 511 platform (GraphQL map query, one request for the whole state).
// Each view's poster frame (public.carsprogram.org/cameras/IN/INDOT_{n}_{token}.flv.png, refreshed about once a
// minute) is the still; the HLS playlist is keyed by the same token on skysfs4.trafficwise.org.
const IN_B = { minLat: 37.7, maxLat: 41.9, minLng: -88.2, maxLng: -84.6 };
const INDOT_POSTER = /\/cameras\/IN\/(INDOT_\d+_[A-Za-z0-9_-]+)\.flv\.png$/;
export const INDOT_QUERY = `query MapFeatures($input: MapFeaturesArgs!) {
  mapFeaturesQuery(input: $input) {
    mapFeatures { title uri features { geometry } __typename ... on Camera { active views(limit: 1) { category ... on CameraView { url } } } }
    error { message }
  }
}`;
export const indotStream = (token) => `https://skysfs4.trafficwise.org/preroll/${token}/playlist.m3u8`;
/** `I-94: 1-094-035-8-1 E OF US421` → `I-94: E OF US421` (only when the asset number is cleanly delimited). */
export const cleanIndotTitle = (t) => String(t ?? '').replace(/(^|:\s*)\d+(?:-[0-9a-z_]+)*\s+/, '$1').replace(/\s+/g, ' ').trim();
export function mapIndotFeature(f) {
  if (f?.__typename !== 'Camera' || f.active === false) return null;
  const poster = String(f.views?.[0]?.url ?? '');
  const token = poster.match(INDOT_POSTER)?.[1]; if (!token) return null;
  const [lng, lat] = f.features?.[0]?.geometry?.coordinates ?? [];
  if (!ok(lat, lng) || lat < IN_B.minLat || lat > IN_B.maxLat || lng < IN_B.minLng || lng > IN_B.maxLng) return null;
  const id = String(f.uri ?? '').match(/camera\/(\d+)/)?.[1]; if (!id) return null;
  return row(`indot-${id}`, cleanIndotTitle(f.title) || `INDOT camera ${id}`, lat, lng, poster, indotStream(token), 'Indiana');
}
export function parseIndot(json) {
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error('511in returned no mapFeatures');
  const seen = new Map();
  for (const f of feats) { const r = mapIndotFeature(f); if (r && !seen.has(r[0])) seen.set(r[0], r); }
  return [...seen.values()].slice(0, CAP);
}

// ─────────────────────────────────────────────────────────────────────────────
// Michigan — MDOT MiDrive camera list. Fields carry rendered HTML: coordinates and the id are in the county
// column's "Go to" link, the frame URL in the image column's <img src>.
const MI_B = { minLat: 41.6, maxLat: 48.3, minLng: -90.5, maxLng: -82.1 };
const stripHtml = (s) => String(s).replace(/<a\b[\s\S]*?<\/a>/gi, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
export function mapMiDrive(rec) {
  const county = String(rec?.county ?? ''); const image = String(rec?.image ?? '');
  const c = county.match(/lat=(-?[\d.]+)&(?:amp;)?lon=(-?[\d.]+)/); const src = image.match(/src="(https?:\/\/[^"]+)"/); const id = county.match(/[?&]id=(\d+)/);
  if (!c || !src || !id) return null;
  const lat = parseFloat(c[1]); const lng = parseFloat(c[2]);
  if (!ok(lat, lng) || lat < MI_B.minLat || lat > MI_B.maxLat || lng < MI_B.minLng || lng > MI_B.maxLng) return null;
  const name = [rec.route, rec.location].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').trim();
  return row(`mdot-${id[1]}`, name || `MDOT camera ${id[1]}`, lat, lng, src[1].replace(/&amp;/g, '&'), '', ['Michigan', stripHtml(county)].filter(Boolean).join(' · '));
}
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const dedupe = (rows) => { const m = new Map(); for (const r of rows) if (r && (r[4] || r[5]) && !m.has(r[0])) m.set(r[0], r); return [...m.values()].slice(0, CAP); };
export const parseMiDrive = (json) => { if (!Array.isArray(json)) throw new Error('MiDrive returned a non-array payload'); return dedupe(json.map(mapMiDrive)); };

// ─────────────────────────────────────────────────────────────────────────────
// Washington — WSDOT camera list (array of { CameraID, Title, ImageURL, CameraLocation: { Latitude, Longitude } }).
export function parseWsdot(json) {
  const list = Array.isArray(json) ? json : json?.cameras ?? [];
  return dedupe(list.map((c) => {
    const lat = num(c?.CameraLocation?.Latitude); const lng = num(c?.CameraLocation?.Longitude);
    if (!ok(lat, lng) || !c.ImageURL || c.IsActive === false) return null;
    return row(`wsdot-${c.CameraID}`, c.Title || `WSDOT camera ${c.CameraID}`, lat, lng, c.ImageURL, '', ['Washington', c.CameraLocation?.RoadName].filter(Boolean).join(' · '));
  }));
}

// City of Ottawa — traffic.ottawa.ca camera list; each camera's still is served at /map/camera?id={number}.
export function parseOttawa(json) {
  return dedupe((Array.isArray(json) ? json : []).map((c) => {
    const lat = num(c?.latitude); const lng = num(c?.longitude); const n = c?.number ?? c?.id;
    if (!ok(lat, lng) || n == null) return null;
    return row(`ott-${c.id ?? n}`, c.description || `Ottawa camera ${n}`, lat, lng, `https://traffic.ottawa.ca/map/camera?id=${encodeURIComponent(n)}`, '', 'Ontario · Ottawa');
  }));
}

// City of Toronto — open-data traffic camera list (GeoJSON, EPSG:4326; geometry may be a MultiPoint).
export function parseToronto(json) {
  return dedupe((json?.features ?? []).map((f) => {
    let co = f?.geometry?.coordinates; if (Array.isArray(co?.[0])) co = co[0];
    const p = f?.properties ?? {}; const [lng, lat] = (co ?? []).map(num);
    if (!ok(lat, lng) || !p.IMAGEURL) return null;
    const name = [p.MAINROAD, p.CROSSROAD].map((x) => String(x ?? '').trim()).filter(Boolean).join(' / ');
    return row(`tor-${p.REC_ID ?? p._id}`, name || `Toronto camera ${p.REC_ID}`, lat, lng, p.IMAGEURL, '', 'Ontario · Toronto');
  }));
}

// Butler County Sheriff's Office (Ohio) — two public tower cameras the office publishes on its own site.
export const BUTLER = [
  row('butler-hamilton', 'Hamilton, OH', 39.3988617, -84.5595353, 'https://gsccam.butlersheriff.org/axis-cgi/jpg/image.cgi', '', 'Ohio · Butler County'),
  row('butler-129-747', 'OH-129 at OH-747', 39.381435, -84.438423, 'https://towercam.butlersheriff.org/axis-cgi/jpg/image.cgi', '', 'Ohio · Butler County'),
];

const TORONTO_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson';

export const sources = [
  { key: 'on511', name: '511 Ontario (Ontario)', run: () => loadIbi511(IBI.on511) },
  { key: 'ab511', name: '511 Alberta (Alberta)', run: () => loadIbi511(IBI.ab511) },
  { key: 'az511', name: 'AZ511 (Arizona)', run: () => loadIbi511(IBI.az511) },
  { key: 'fl511', name: 'FL511 (Florida)', run: () => loadIbi511(IBI.fl511) },
  { key: 'ga511', name: '511GA (Georgia)', run: () => loadIbi511(IBI.ga511) },
  { key: 'drivenc', name: 'DriveNC (North Carolina)', run: () => loadIbi511(IBI.drivenc) },
  { key: 'la511', name: '511LA (Louisiana)', run: () => loadIbi511(IBI.la511) },
  { key: 'yegtraffic', name: 'City of Edmonton traffic cameras (Alberta)', run: async () =>
    parseEdmonton(await get('https://edmontontrafficcam.com/Default.aspx/GetCameras', 'json', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{}', timeout: 20_000 })) },
  { key: 'indot', name: 'INDOT TrafficWise (Indiana)', run: async () => parseIndot(await get('https://511in.org/api/graphql', 'json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30_000,
    body: JSON.stringify({ query: INDOT_QUERY, variables: { input: { north: IN_B.maxLat, south: IN_B.minLat, east: IN_B.maxLng, west: IN_B.minLng, zoom: 16, layerSlugs: ['normalCameras'], nonClusterableUris: null } } }),
  })) },
  { key: 'midrive', name: 'MDOT MiDrive (Michigan)', run: async () => parseMiDrive(await get('https://mdotjboss.state.mi.us/MiDrive/camera/list')) },
  { key: 'wsdot', name: 'WSDOT (Washington)', run: async () => parseWsdot(await get('https://data.wsdot.wa.gov/log/public/cameras.json')) },
  { key: 'ottawatraffic', name: 'City of Ottawa traffic cameras (Ontario)', run: async () => parseOttawa(await get('https://traffic.ottawa.ca/beta/camera_list')) },
  { key: 'torontocams', name: 'City of Toronto traffic cameras (Ontario)', run: async () => parseToronto(await get(TORONTO_URL)) },
  { key: 'butleroh', name: 'Butler County Sheriff tower cameras (Ohio)', run: async () => BUTLER },
];
