// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the five "watch" feeds of v2.25, without any drawing, so the live-data job
// (tools/fetch-live.mjs, in Node) and the app (watchlayers.js, in the browser) read them the same way.
//   • Lightning: NOAA nowCOAST's 15-minute lightning strike density (a world image from its map service, WMS).
//   • Hurricane forecasts: the National Hurricane Center's (NHC) active storms with their forecast points, track and
//     cone of uncertainty (CurrentStorms.json and the NOAA tropical weather summary map service).
//   • Wildfire outlines: the US interagency fire perimeters (NIFC WFIGS, an ArcGIS feature service).
//   • Restricted airspace: the US Federal Aviation Administration's (FAA) prohibited and restricted areas.
//   • GPS interference: aircraft that report poor position integrity (ADS-B NIC and NACp, from adsb.lol), counted
//     per 1° cell with gpsjam.org's published formula.
// The feed choices follow God's Eye View (Bilawal Sidhu, MIT licence) and its DATA_SOURCES.md; the code is our own.
// Field names were read from God's Eye View's parsers because this was built without network access to the
// services themselves: see docs/ASSUMPTIONS.md, v2.25.

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x, lo = -Infinity, hi = Infinity) => { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (x, max = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
const r4 = (g) => {
  const w = (x) => (typeof x[0] === 'number' ? [Math.round(x[0] * 1e4) / 1e4, Math.round(x[1] * 1e4) / 1e4] : x.map(w));
  return g?.coordinates ? { type: g.type, coordinates: w(g.coordinates) } : null;
};
const query = (base, params) => `${base}/query?${new URLSearchParams(params).toString()}`;

// ------------------------------------------------------------------ lightning (NOAA nowCOAST)
export const NOWCOAST_LIGHTNING = 'https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows';
export const LIGHTNING_LAYER = 'ldn_lightning_strike_density';
/** One plate carrée world image (the globe's own texture layout); areas outside the coverage come back transparent. */
export const lightningUrl = (w = 4096, h = 2048) => `${NOWCOAST_LIGHTNING}?${new URLSearchParams({
  SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: LIGHTNING_LAYER, STYLES: 'lightning_density', SRS: 'EPSG:4326',
  BBOX: '-180,-90,180,90', WIDTH: String(w), HEIGHT: String(h), FORMAT: 'image/png', TRANSPARENT: 'TRUE',
}).toString()}`;
export const LIGHTNING_CAPS = `${NOWCOAST_LIGHTNING}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;
/** The time of the newest lightning image named in the map service's capabilities document, or null. */
export function lightningTime(xml) {
  const at = String(xml ?? '').indexOf(`>${LIGHTNING_LAYER}<`);
  if (at < 0) return null;
  const rest = xml.slice(at, at + 200_000).split(/<\/Layer>/)[0];
  const dim = rest.match(/<Dimension[^>]*name=["']time["'][^>]*>([^<]*)<\/Dimension>/i);
  if (!dim) return null;
  const def = dim[0].match(/default=["']([^"']+)["']/i)?.[1];
  const list = dim[1].split(',').map((s) => s.trim().split('/')[0]).filter(Boolean);
  const t = def && def !== 'current' ? def : list.at(-1);
  return t && Number.isFinite(Date.parse(t)) ? new Date(Date.parse(t)).toISOString() : null;
}
/** The colour scale nowCOAST uses for the density (strikes per km² per minute, ×1,000), for the legend. */
export const LIGHTNING_SCALE = [['#4b0082', 'Low'], ['#1e90ff', ''], ['#00c800', ''], ['#ffd700', ''], ['#ff8c00', ''], ['#ff0000', 'High']];

// ------------------------------------------------------------------ hurricane forecasts (NHC)
export const NHC_STATUS = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const NHC_GIS = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
/** Layers 5, 6 and 7 of the map service: forecast points, forecast track and the cone, for every active storm. */
export const NHC_QUERIES = [
  query(`${NHC_GIS}/5`, { where: '1=1', outFields: 'idp_source,advisnum,tau,maxwind,gust', outSR: '4326', resultRecordCount: '500', geometryPrecision: '4', f: 'geojson' }),
  query(`${NHC_GIS}/6`, { where: '1=1', outFields: 'idp_source,advisnum', outSR: '4326', resultRecordCount: '32', geometryPrecision: '4', f: 'geojson' }),
  query(`${NHC_GIS}/7`, { where: '1=1', outFields: 'idp_source,advisnum', outSR: '4326', resultRecordCount: '32', geometryPrecision: '4', f: 'geojson' }),
];
export const STORM_CLASS = { HU: 'Hurricane', TS: 'Tropical storm', TD: 'Tropical depression', STS: 'Subtropical storm', STD: 'Subtropical depression', PTC: 'Potential tropical cyclone', PC: 'Post-tropical cyclone', TY: 'Typhoon' };
/** Saffir–Simpson category from the sustained wind in knots (0 = below hurricane strength). */
export const category = (kt) => (kt == null ? 0 : kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0);
const advNum = (x) => { const s = String(x ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase(); return /^\d{1,3}[A-Z]?$/.test(s) ? s : null; };
const BASIN = { al: 'Atlantic', ep: 'Eastern Pacific', cp: 'Central Pacific' };

/** Active storms from CurrentStorms.json, joined with the forecast points, track and cone of the same advisory. */
export function assembleStorms(status, gis = []) {
  const storms = [];
  for (const s of status?.activeStorms ?? []) {
    const id = String(s?.id ?? '').toLowerCase();
    if (!/^(al|ep|cp)\d{6}$/.test(id)) continue;
    const lat = num(s.latitudeNumeric, -90, 90); const lng = num(s.longitudeNumeric, -180, 180);
    if (lat == null || lng == null) continue;
    const mph = num(s.movementSpeed, 0, 200);
    storms.push({
      id, name: str(s.name, 60) ?? id.toUpperCase(), cls: str(s.classification, 8) ?? '', basin: BASIN[id.slice(0, 2)],
      lat, lng, windKt: num(s.intensity, 0, 300), pressure: num(s.pressure, 800, 1100),
      moveDir: num(s.movementDir, 0, 360), moveKt: mph == null ? null : Math.round(mph * 0.868976),
      at: str(s.lastUpdate, 40), adv: advNum(s.forecastAdvisory?.advNum), issued: str(s.forecastAdvisory?.issuance, 40),
      url: /^https:\/\/www\.nhc\.noaa\.gov\/text\/[A-Z0-9]+\.shtml$/.test(s.forecastAdvisory?.url ?? '') ? s.forecastAdvisory.url : null,
      points: [], track: null, cone: null,
    });
  }
  const [pts, lin, pgn] = gis;
  const parts = (fc, kind) => (fc?.features ?? []).map((f) => {
    const m = String(f?.properties?.idp_source ?? '').match(/^((?:al|ep|cp)\d{6})-(\d{1,3}[a-z]?)_5day_(pts|lin|pgn)$/i);
    return m && m[3].toLowerCase() === kind ? { id: m[1].toLowerCase(), adv: advNum(m[2]), f } : null;
  }).filter(Boolean);
  const P = parts(pts, 'pts'); const L = parts(lin, 'lin'); const G = parts(pgn, 'pgn');
  for (const s of storms) {
    // the newest advisory the map service has for this storm (it can lag the status file by a few minutes)
    const advs = [...P, ...L, ...G].filter((x) => x.id === s.id).map((x) => x.adv);
    const adv = advs.includes(s.adv) ? s.adv : advs.sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
    if (!adv) continue;
    s.gisAdv = adv;
    s.points = P.filter((x) => x.id === s.id && x.adv === adv && x.f.geometry?.type === 'Point').map(({ f }) => ({
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], tau: num(f.properties.tau, 0, 168), windKt: num(f.properties.maxwind, 0, 300), gustKt: num(f.properties.gust, 0, 350),
    })).filter((p) => p.tau != null).sort((a, b) => a.tau - b.tau);
    s.track = r4(L.find((x) => x.id === s.id && x.adv === adv)?.f.geometry);
    s.cone = r4(G.find((x) => x.id === s.id && x.adv === adv)?.f.geometry);
  }
  return storms;
}

// ------------------------------------------------------------------ wildfire outlines (NIFC WFIGS)
export const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0';
const FIRE_FIELDS = ['poly_IncidentName', 'attr_UniqueFireIdentifier', 'attr_IncidentSize', 'attr_PercentContained', 'attr_POOState', 'attr_IncidentTypeCategory',
  'attr_FireDiscoveryDateTime', 'poly_DateCurrent', 'attr_FireCause', 'attr_FireBehaviorGeneral', 'attr_TotalIncidentPersonnel', 'attr_POOCounty', 'attr_EstimatedCostToDate', 'attr_IncidentComplexityLevel', 'attr_CpxName'];
/** maxAllowableOffset 0.001° (about 100 m) keeps a whole fire season to a few megabytes. */
export const wfigsUrl = (offset = 0) => query(WFIGS, { where: '1=1', outFields: FIRE_FIELDS.join(','), maxAllowableOffset: '0.001', outSR: '4326', geometryPrecision: '4', f: 'geojson', ...(offset ? { resultOffset: String(offset) } : {}) });
export const FIRE_TYPE = { WF: 'Wildfire', RX: 'Prescribed fire', CX: 'Complex' };
/** Perimeters in the compact form both the app and the snapshot use; a snapshot already in that form passes through. */
export function slimFires(j) {
  if (Array.isArray(j?.fires)) return j.fires;
  const ms = (x) => { const n = num(x); if (n != null) return n; const t = Date.parse(x ?? ''); return Number.isFinite(t) ? t : null; };
  return (j?.features ?? []).filter((f) => f?.geometry && /Polygon$/.test(f.geometry.type)).map((f) => {
    const p = f.properties ?? {};
    return {
      id: str(p.attr_UniqueFireIdentifier, 40) ?? str(p.poly_IncidentName, 80), name: str(p.poly_IncidentName, 80) ?? 'Unnamed fire', acres: num(p.attr_IncidentSize, 0, 1e8),
      contained: num(p.attr_PercentContained, 0, 100), state: str(p.attr_POOState, 8), county: str(p.attr_POOCounty, 60), type: str(p.attr_IncidentTypeCategory, 4),
      found: ms(p.attr_FireDiscoveryDateTime), mapped: ms(p.poly_DateCurrent), cause: str(p.attr_FireCause, 40), behaviour: str(p.attr_FireBehaviorGeneral, 40),
      crew: num(p.attr_TotalIncidentPersonnel, 0, 1e5), cost: num(p.attr_EstimatedCostToDate, 0, 1e11), level: str(p.attr_IncidentComplexityLevel, 30), complex: str(p.attr_CpxName, 80),
      geometry: r4(f.geometry),
    };
  });
}

// ------------------------------------------------------------------ restricted airspace (FAA)
export const FAA_SUA = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0';
export const suaUrl = (offset = 0) => query(FAA_SUA, {
  where: "TYPE_CODE IN ('P','R')", outFields: 'NAME,TYPE_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,TIMESOFUSE,CONT_AGENT,CITY,STATE,OBJECTID',
  maxAllowableOffset: '0.001', outSR: '4326', geometryPrecision: '4', f: 'geojson', ...(offset ? { resultOffset: String(offset) } : {}),
});
/** "18,000 ft above sea level", "the ground", "unlimited"; the FAA writes -9998 for an unlimited ceiling. */
export function heightText(val, uom, code) {
  const v = num(val); const c = String(code ?? '').toUpperCase();
  if (c === 'SFC' || (v === 0 && !c)) return 'the ground';
  if (v == null) return 'not stated';
  const u = String(uom ?? 'FT').toUpperCase();
  if (v < 0 || c === 'UNL' || (u === 'FL' && v >= 999)) return 'unlimited';
  if (u === 'FL') return `flight level ${v} (about ${(v * 100).toLocaleString('en-US')} ft)`;
  return `${v.toLocaleString('en-US')} ${u === 'M' ? 'm' : 'ft'}${c === 'AGL' ? ' above the ground' : c === 'MSL' ? ' above sea level' : ''}`;
}
export function slimZones(j) {
  if (Array.isArray(j?.zones)) return j.zones;
  return (j?.features ?? []).filter((f) => f?.geometry && /Polygon$/.test(f.geometry.type)).map((f) => {
    const p = f.properties ?? {};
    const fl = String(p.UPPER_UOM ?? '').toUpperCase() === 'FL'; const uv = num(p.UPPER_VAL);
    const upFt = uv == null || uv < 0 || (fl && uv >= 999) ? null : fl ? uv * 100 : uv;
    return {
      id: String(p.OBJECTID ?? p.NAME), name: str(p.NAME, 80) ?? 'Unnamed area', type: p.TYPE_CODE === 'P' ? 'P' : 'R',
      top: heightText(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE), bottom: heightText(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE), topFt: upFt,
      times: str(p.TIMESOFUSE, 200), agency: str(p.CONT_AGENT, 120), city: str(p.CITY, 60), state: str(p.STATE, 30), geometry: r4(f.geometry),
    };
  });
}

// ------------------------------------------------------------------ GPS interference (ADS-B integrity)
/** Areas the live-data job asks adsb.lol about (250 nautical miles around each): busy airspace plus the regions where
 *  interference has been widely reported (the Baltic, the eastern Mediterranean, the Black Sea, the Middle East). */
export const GNSS_HUBS = [
  [54.5, 18.5], [59.5, 24.5], [56.5, 13], [52.5, 13.4], [50, 8.6], [51.5, -0.5], [48.9, 2.4], [40.5, -3.6], [41.8, 12.3], [47.5, 19.2],
  [44.2, 28.6], [45, 34], [41, 29], [37.9, 23.7], [35, 33.3], [32.5, 35], [33.5, 36.3], [36, 40], [33.3, 44.4], [25.3, 55.4], [26, 50.5], [24.9, 46.7],
  [29.8, 31.3], [41.7, 44.8], [40.4, 49.9], [39, 35.5], [30.5, 47.7], [16.8, 96.1], [35.6, 139.8], [37.5, 126.8], [40.6, -73.8], [33.9, -118.4],
];
export const gnssUrl = ([la, lo]) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/250`;
/** God's Eye View's per-aircraft rule (not a published standard; thresholds are the US ADS-B Out minima of
 *  14 CFR 91.227): GPS lost, or NACp below 8, or NIC below 7 (except NIC 0 with NACp 10 or more). */
export function gnssRow(a) {
  if (!a || typeof a.hex !== 'string') return null;
  if (a.type && !['adsb_icao', 'mlat'].includes(a.type)) return null;
  if (a.version != null && ![1, 2].includes(a.version)) return null;
  if (fin(a.seen_pos) && a.seen_pos > 60) return null;
  const nic = fin(a.nic) ? a.nic : null; const nacp = fin(a.nac_p) ? a.nac_p : null; const lost = fin(a.gpsOkBefore) && a.gpsOkBefore > 0;
  if (nic == null && nacp == null && !lost) return null;
  const lat = lost && fin(a.gpsOkLat) ? a.gpsOkLat : a.lat; const lng = lost && fin(a.gpsOkLon) ? a.gpsOkLon : a.lon;
  if (!fin(lat) || !fin(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const bad = lost || (nacp != null && nacp < 8) || (nic != null && nic < 7 && !(nic === 0 && nacp != null && nacp >= 10));
  return { hex: a.hex, lat, lng, nic, nacp, lost, bad };
}
/** gpsjam.org's published cell formula: discount the first bad aircraft, then under 2 % is low, 2–10 % medium, over 10 % high. */
export function gnssLevel(n, k) {
  const pct = n > 0 ? (100 * Math.max(0, k - 1)) / n : 0;
  return { pct, level: pct > 10 ? 'high' : pct >= 2 ? 'medium' : 'low' };
}
/** Count aircraft per 1° cell. Rows: [south, west, aircraft, bad]; cells with fewer than 3 aircraft are left out. */
export function gnssCells(rows, { deg = 1, min = 3 } = {}) {
  const seen = new Map();
  for (const r of rows) if (r && (!seen.has(r.hex) || r.bad)) seen.set(r.hex, r);
  const cells = new Map();
  for (const r of seen.values()) {
    const s = Math.floor(r.lat / deg) * deg; const w = Math.floor(r.lng / deg) * deg; const k = `${s},${w}`;
    const c = cells.get(k) ?? [s, w, 0, 0]; c[2] += 1; if (r.bad) c[3] += 1; cells.set(k, c);
  }
  return [...cells.values()].filter((c) => c[2] >= min).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---- ring order for the globe
// The globe's polygon geometry follows d3-geo: a ring encloses the area on its right, so an outer ring must run
// clockwise. GeoJSON (RFC 7946) and the ArcGIS services send outer rings anticlockwise, which the globe reads as
// "everything except this fire" and paints over the whole planet. smallSide() turns every outer ring clockwise and every
// hole anticlockwise, measured in longitude and latitude with the longitudes unwrapped across the 180° line. It assumes
// no single area is bigger than half the planet, which holds for anything drawn here.
const ringArea = (r) => {
  const xs = [r[0][0]];
  for (let i = 1; i < r.length; i++) { let x = r[i][0]; const p = xs[i - 1]; while (x - p > 180) x -= 360; while (x - p < -180) x += 360; xs.push(x); }
  let s = 0; for (let i = 0; i < r.length - 1; i++) s += xs[i] * r[i + 1][1] - xs[i + 1] * r[i][1];
  return s / 2; // above 0: anticlockwise
};
const orient = (ring, cw) => (ring.length > 3 && (ringArea(ring) > 0) === cw ? [...ring].reverse() : ring);
const fixPoly = (rings) => rings.map((r, i) => orient(r, i === 0));
export function smallSide(g) {
  if (!g?.coordinates) return g;
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: fixPoly(g.coordinates) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(fixPoly) };
  return g;
}
