#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the "history" branch, for the Replay layer.
//
// Once an hour (.github/workflows/history.yml) this takes the current live-data snapshot and keeps a compact
// frame of it: every aircraft as [latitude, longitude, flight level, track], every ship as [latitude, longitude],
// the disaster alerts in force, and counts of fire hotspots. Frames older than HISTORY_DAYS (default 14) are
// dropped, so the orphan branch stays small; it is force-pushed as one commit like live-data. Earthquakes need no
// copy: the app asks the USGS catalogue for any past window directly.
//
// Usage: node tools/build-history.mjs <live-data dir> <history dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [LIVE = 'live', OUT = 'history'] = process.argv.slice(2);
const DAYS = Number(process.env.HISTORY_DAYS ?? 14);
const STALE_MIN = 90;
const read = (name) => { try { return JSON.parse(readFileSync(join(LIVE, name), 'utf8')); } catch { return null; } };
const log = (...a) => console.log('[history]', ...a);

/** One frame from live-data files. Exported for tests. */
export function makeFrame({ flights, gdacs, ships, fires }, now = Date.now()) {
  const frame = { t: null, flights: { fields: ['lat100', 'lng100', 'fl', 'trk'], rows: [] }, ships: { fields: ['lat100', 'lng100'], rows: [] }, alerts: [], fires: null, src: {} };
  if (flights?.ac?.length && flights.fields) {
    const f = Object.fromEntries(flights.fields.map((k, i) => [k, i]));
    for (const r of flights.ac) {
      const lat = r[f.lat]; const lng = r[f.lng]; if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      frame.flights.rows.push([Math.round(lat * 100), Math.round(lng * 100), r[f.ground] ? 0 : Math.max(0, Math.round((r[f.altFt] ?? 0) / 100)), Math.round(r[f.trk] ?? 0)]);
    }
    frame.t = Date.parse(flights.generatedAt); frame.src.flights = flights.src ?? null;
  }
  if (ships?.rows?.length) { for (const r of ships.rows) frame.ships.rows.push([Math.round(r[1] * 100), Math.round(r[2] * 100)]); frame.src.ships = ships.src ?? null; }
  for (const e of gdacs?.features ?? []) {
    const p = e.properties ?? {}; const [lng, lat] = e.geometry?.coordinates ?? [];
    if (typeof lat !== 'number') continue;
    frame.alerts.push({ lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, type: p.eventtype ?? null, level: p.alertlevel ?? null, name: p.name ?? p.eventname ?? null, country: p.country ?? null });
  }
  if (fires?.rows) frame.fires = { count: fires.rows.length, high: fires.rows.filter((r) => r[3] === 2).length };
  frame.t ??= now;
  return frame;
}

const hourKey = (ms) => new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, ''); // YYYYMMDDHH

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const flights = read('flights.json');
  if (!flights) { log('no flights.json in', LIVE); process.exitCode = 1; }
  else {
    const age = (Date.now() - Date.parse(flights.generatedAt)) / 60_000;
    if (age > STALE_MIN) log(`flights.json is ${Math.round(age)} minutes old; recording it anyway (marked stale)`);
    const frame = makeFrame({ flights, gdacs: read('gdacs.json'), ships: read('ships.json'), fires: read('fires.json') });
    if (age > STALE_MIN) frame.stale = true;
    mkdirSync(join(OUT, 'frames'), { recursive: true });
    const key = hourKey(frame.t); const file = `frames/${key}.json`;
    writeFileSync(join(OUT, file), JSON.stringify(frame));
    // prune, then rebuild the index from what is on disk
    const cutoff = Date.now() - DAYS * 86_400_000; const frames = [];
    for (const name of readdirSync(join(OUT, 'frames')).sort()) {
      const m = name.match(/^(\d{4})(\d{2})(\d{2})(\d{2})\.json$/); if (!m) continue;
      const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]);
      if (t < cutoff) { rmSync(join(OUT, 'frames', name)); continue; }
      let meta = null; try { const j = JSON.parse(readFileSync(join(OUT, 'frames', name), 'utf8')); meta = { t: j.t, flights: j.flights.rows.length, ships: j.ships.rows.length, alerts: j.alerts.length, fires: j.fires?.count ?? null, stale: !!j.stale }; } catch { continue; }
      frames.push({ file: `frames/${name}`, ...meta });
    }
    writeFileSync(join(OUT, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), days: DAYS, frames }));
    writeFileSync(join(OUT, 'README.md'), `# Global Intelligence Atlas history\n\nHourly frames of the live-data snapshot (aircraft, ships, disaster alerts, fire counts) for the app's Replay layer, kept for ${DAYS} days. Written by \`.github/workflows/history.yml\` on main; each run replaces the branch. Data: OpenSky Network / ADS-B exchanges, AISStream, GDACS, NASA FIRMS. See docs/REFERENCES.md on main.\n\nFrames: ${frames.length}, from ${frames[0] ? new Date(frames[0].t).toISOString() : '—'} to ${frames.at(-1) ? new Date(frames.at(-1).t).toISOString() : '—'}.\n`);
    log(`${file}: ${frame.flights.rows.length} aircraft, ${frame.ships.rows.length} ships, ${frame.alerts.length} alerts; ${frames.length} frames kept (${DAYS} days)`);
  }
}
