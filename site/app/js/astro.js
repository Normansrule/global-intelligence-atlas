// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — astronomy + geodesy helpers (no dependencies).
// Formulas: NOAA / USNO low-precision solar position (≈0.01° over 1950–2050),
// haversine + spherical destination/bearing (Ed Williams, "Aviation Formulary").

export const R_EARTH_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Subsolar point (where the Sun is directly overhead) for a Date. */
export function subsolarPoint(date = new Date()) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * D2R; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * D2R; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * R2D;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) * R2D;
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const lng = wrapLng(ra - gmstHours * 15);
  return { lat: dec, lng, declination: dec };
}

/** Great-circle distance in km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing in degrees (0 = north). */
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const p1 = lat1 * D2R; const p2 = lat2 * D2R; const dl = (lng2 - lng1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached travelling `distDeg` degrees of arc from (lat,lng) on `bearing`. */
export function destination(lat, lng, bearing, distDeg) {
  const p1 = lat * D2R; const l1 = lng * D2R; const b = bearing * D2R; const d = distDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * R2D, wrapLng(l2 * R2D)];
}

/** Circle of points (lat,lng) of angular radius `radiusDeg` around a centre. */
export function smallCircle(lat, lng, radiusDeg, steps = 180) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(destination(lat, lng, (i / steps) * 360, radiusDeg));
  return pts;
}

/** Day/night terminator line (90° from the subsolar point). */
export function terminator(date = new Date()) {
  const s = subsolarPoint(date);
  return smallCircle(s.lat, s.lng, 90, 240);
}

/** Solar elevation angle (degrees) seen from a point — ignores refraction. */
export function solarElevation(lat, lng, date = new Date()) {
  const s = subsolarPoint(date);
  const cosZ = Math.sin(lat * D2R) * Math.sin(s.lat * D2R)
    + Math.cos(lat * D2R) * Math.cos(s.lat * D2R) * Math.cos((lng - s.lng) * D2R);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) * R2D;
}

/** Local mean solar time "HH:MM" from longitude (15° = 1 hour). */
export function localSolarTime(lng, date = new Date()) {
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  const m = (((utcMin + lng * 4) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
}

/** Distance (km) from a point to the nearest vertex-densified polyline in a set. */
export function nearestOnLines(lat, lng, lines) {
  let best = { km: Infinity, line: null };
  for (const line of lines) {
    for (const [la, lo] of line.pts) {
      const km = haversineKm(lat, lng, la, lo);
      if (km < best.km) best = { km, line };
    }
  }
  return best;
}

/** Interpolate points along a great circle (for arcs/paths drawn on the surface). */
export function greatCirclePoints(lat1, lng1, lat2, lng2, n = 64) {
  const p1 = lat1 * D2R; const l1 = lng1 * D2R; const p2 = lat2 * D2R; const l2 = lng2 * D2R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [[lat1, lng1]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d); const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(z, Math.hypot(x, y)) * R2D, Math.atan2(y, x) * R2D]);
  }
  return out;
}

export const fmtKm = (km) => (km >= 100 ? `${Math.round(km).toLocaleString()} km` : `${km.toFixed(1)} km`);
export const fmtLat = (v) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'N' : 'S'}`;
export const fmtLng = (v) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'E' : 'W'}`;

/**
 * Moon position, low-precision formulae from the Astronomical Almanac (as given by Meeus and in
 * "Low-precision formulae for planetary positions", Van Flandern & Pulkkinen 1979): about 0.3° in
 * position, which is well under the Moon's own half-degree width.
 * Returns the sublunar point, distance, and phase.
 */
export function moonState(date = new Date()) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; const T = d / 36525;
  const s = (a, b) => Math.sin((a + b * T) * D2R); const c = (a, b) => Math.cos((a + b * T) * D2R);
  const lam = 218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22)
    + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const bet = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const L = lam * D2R; const B = bet * D2R;
  const l = Math.cos(B) * Math.cos(L); const m = 0.9175 * Math.cos(B) * Math.sin(L) - 0.3978 * Math.sin(B); const n = 0.3978 * Math.cos(B) * Math.sin(L) + 0.9175 * Math.sin(B);
  const ra = Math.atan2(m, l) * R2D; const dec = Math.asin(n) * R2D;
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  // Sun's ecliptic longitude (same model as subsolarPoint) for the phase
  const g = (357.529 + 0.98560028 * d) * D2R; const q = 280.459 + 0.98564736 * d;
  const sunLon = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const age = ((((lam - sunLon) % 360) + 360) % 360); // 0 new → 180 full → 360 new
  const elong = Math.acos(Math.cos(B) * Math.cos((lam - sunLon) * D2R)) * R2D;
  const illum = (1 - Math.cos(elong * D2R)) / 2;
  const distKm = R_EARTH_KM / Math.sin(par * D2R);
  return { lat: dec, lng: wrapLng(ra - gmstHours * 15), distKm, illum, age, waxing: age < 180, name: moonPhaseName(age) };
}
export function moonPhaseName(age) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(age / 45) % 8];
}
/** The next time the Moon reaches a phase angle (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function nextMoonPhase(targetAge, from = new Date()) {
  // The phase angle only ever grows (about 12° a day), so the distance still to go shrinks until we
  // pass the target and then jumps back up to nearly 360°.
  const togo = (age) => (((targetAge - age) % 360) + 360) % 360;
  let t = from.getTime(); let prev = togo(moonState(from).age);
  for (let i = 0; i < 24 * 31; i++) {
    t += 3600_000; const now = togo(moonState(new Date(t)).age);
    if (now > prev + 1) return new Date(t - 1800_000);
    prev = now;
  }
  return null;
}
