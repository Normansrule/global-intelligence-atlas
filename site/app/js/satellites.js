// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — satellites from CelesTrak TLEs, propagated in the browser with
// SGP4 (satellite.js). Falls back to a bundled snapshot if CelesTrak is unreachable.

import { satellite } from '../vendor/vendor.min.mjs';
import { getFeed, getLocal } from './feeds.js';
import { R_EARTH_KM } from './astro.js';

export const SAT_GROUPS = {
  stations: { label: 'Space stations', celestrak: 'stations', color: '#ffd37a', size: 1.6 },
  visual: { label: '100 brightest', celestrak: 'visual', color: '#e9f2f7', size: 1.0 },
  weather: { label: 'Weather', celestrak: 'weather', color: '#7ed6c4', size: 1.0 },
  'gps-ops': { label: 'GPS (MEO)', celestrak: 'gps-ops', color: '#b7a3ff', size: 1.3 },
  geo: { label: 'Geostationary', celestrak: 'geo', color: '#f39a86', size: 0.9 },
  starlink: { label: 'Starlink', celestrak: 'starlink', color: '#9fc3e6', size: 0.55 },
};

function parseTle(text, limit = Infinity) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1 && out.length < limit; ) {
    if (lines[i]?.startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      out.push({ name: 'Unnamed', l1: lines[i], l2: lines[i + 1] }); i += 2; continue;
    }
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push({ name: lines[i].replace(/^0\s+/, ''), l1: lines[i + 1], l2: lines[i + 2] }); i += 3; continue;
    }
    i += 1;
  }
  return out.map((t) => {
    try {
      const satrec = satellite.twoline2satrec(t.l1, t.l2);
      return { ...t, satrec, norad: satrec.satnum };
    } catch { return null; }
  }).filter(Boolean);
}

const loaded = {}; // group -> { sats, snapshot, epoch }

/** Load one group. Returns { sats, snapshot: boolean, snapshotEpoch?: Date } */
export async function loadGroup(group) {
  if (loaded[group]) return loaded[group];
  const g = SAT_GROUPS[group];
  try {
    const txt = await getFeed(`celestrak:${group}`, `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g.celestrak}&FORMAT=tle`, { type: 'text', ttl: 3 * 3600_000, snapshot: `tle-${g.celestrak}.txt` });
    const sats = parseTle(txt, group === 'starlink' ? 9000 : 2000);
    if (!sats.length) throw new Error('empty TLE set');
    loaded[group] = { sats, snapshot: false };
  } catch (err) {
    // Offline / blocked: use the bundled LEO snapshot (only meaningful for LEO groups).
    if (!['stations', 'visual', 'weather'].includes(group)) throw err;
    const txt = await getLocal('data/tle-snapshot-leo.txt', 'text');
    let sats = parseTle(txt);
    if (group === 'stations') sats = sats.filter((s) => /ISS|ZARYA|TIANGONG|CSS/.test(s.name));
    else sats = sats.slice(0, group === 'visual' ? 400 : 200);
    const epoch = sats.length ? new Date((sats[0].satrec.jdsatepoch - 2440587.5) * 86400000) : null;
    loaded[group] = { sats, snapshot: true, snapshotEpoch: epoch };
  }
  return loaded[group];
}

/** Snapshot TLEs are old: propagate them relative to their own epoch so orbits stay sane. */
function timeFor(sat, now, snapshot, t0) {
  if (!snapshot) return now;
  const epochMs = (sat.satrec.jdsatepoch - 2440587.5) * 86400000;
  return new Date(epochMs + (now - t0));
}

/** Position of one satellite → { lat, lng, altKm, speedKms } or null if decayed. */
export function propagate(sat, date) {
  const pv = satellite.propagate(sat.satrec, date);
  if (!pv.position || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  const speedKms = v ? Math.hypot(v.x, v.y, v.z) : null;
  const lat = satellite.degreesLat(geo.latitude);
  const lng = satellite.degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(geo.height) || geo.height < 80) return null;
  return { lat, lng, altKm: geo.height, speedKms };
}

const T0 = Date.now();
/** Propagate a whole group to a date → particle list. */
export function positions(groupData, now = new Date()) {
  const out = [];
  for (const s of groupData.sats) {
    const p = propagate(s, timeFor(s, now, groupData.snapshot, T0));
    if (p) out.push({ ...p, alt: p.altKm / R_EARTH_KM, name: s.name, norad: s.norad, sat: s });
  }
  return out;
}

/** Ground track ±minutes around now (for a single satellite). */
export function groundTrack(sat, snapshot, minutes = 95, stepSec = 30, now = new Date()) {
  const pts = [];
  for (let s = -minutes * 60; s <= minutes * 60; s += stepSec) {
    const d = new Date(now.getTime() + s * 1000);
    const p = propagate(sat, timeFor(sat, d, snapshot, T0));
    if (p) pts.push([p.lat, p.lng, p.altKm / R_EARTH_KM]);
  }
  return pts;
}

/** Orbital period (minutes) from mean motion — Kepler's third law in disguise. */
export const periodMinutes = (sat) => (2 * Math.PI) / sat.satrec.no; // no = rad/min

const MU = 398600.4418;
/** Orbital elements from the TLE: size, shape and tilt of the orbit. */
export function orbitalElements(sat) {
  const r = sat.satrec; const n = r.no / 60; const a = Math.cbrt(MU / (n * n));
  const perigeeKm = a * (1 - r.ecco) - R_EARTH_KM; const apogeeKm = a * (1 + r.ecco) - R_EARTH_KM;
  const incDeg = (r.inclo * 180) / Math.PI; const periodMin = (2 * Math.PI) / r.no;
  const cls = r.ecco > 0.25 ? 'Highly elliptical orbit' : Math.abs(periodMin - 1436) < 30 && incDeg < 15 ? 'Geostationary / geosynchronous (GEO)' : apogeeKm > 2000 ? (apogeeKm > 30000 ? 'High Earth orbit' : 'Medium Earth orbit (MEO)') : 'Low Earth orbit (LEO)';
  return { a, perigeeKm, apogeeKm, incDeg, periodMin, ecc: r.ecco, cls };
}
/** One full orbit as a path (lat, lng, altitude in globe radii). */
export function orbitPath(sat, snapshot, now = new Date(), steps = 180) {
  const per = (2 * Math.PI) / sat.satrec.no; const pts = [];
  for (let i = 0; i <= steps; i++) {
    const d = new Date(now.getTime() + (i / steps) * per * 60000);
    const p = propagate(sat, timeFor(sat, d, snapshot, T0));
    if (p) pts.push([p.lat, p.lng, p.altKm / R_EARTH_KM]);
  }
  return pts;
}
/** Passes above 10° elevation for an observer in the next `hours`. */
export function passes(sat, lat, lng, hours = 36) {
  const obs = { longitude: satellite.degreesToRadians(lng), latitude: satellite.degreesToRadians(lat), height: 0.05 };
  const out = []; let cur = null; const t0 = Date.now();
  for (let s = 0; s < hours * 3600; s += 20) {
    const d = new Date(t0 + s * 1000);
    const pv = satellite.propagate(sat.satrec, d); if (!pv.position) continue;
    const ecf = satellite.eciToEcf(pv.position, satellite.gstime(d));
    const look = satellite.ecfToLookAngles(obs, ecf);
    const el = (look.elevation * 180) / Math.PI;
    if (el > 10) {
      if (!cur) cur = { start: d, maxEl: el, maxAt: d, az: (look.azimuth * 180) / Math.PI };
      if (el > cur.maxEl) { cur.maxEl = el; cur.maxAt = d; }
      cur.end = d;
    } else if (cur) { out.push(cur); cur = null; if (out.length >= 6) break; }
  }
  return out;
}
