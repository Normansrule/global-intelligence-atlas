// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: ship positions from AISStream (aisstream.io), shared by the live-data job
// (tools/fetch-live.mjs), the optional proxy (proxy/worker.js) and the desktop app's ship layer.
//
// Ships broadcast the Automatic Identification System (AIS) on marine VHF (very high frequency) radio.
// AISStream relays what its volunteer receivers hear as a WebSocket stream. It needs a free API key and
// does not allow connections straight from a browser (the key would be exposed), so a server or the desktop
// app opens the stream, listens for a few seconds, and keeps the latest report of each vessel.
// No DOM, no imports: this file runs in Node, Cloudflare Workers and the browser alike.

export const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
// Compact rows: one array per vessel, in this order.
export const SHIP_FIELDS = ['mmsi', 'lat', 'lng', 'sog', 'cog', 'hdg', 'nav', 't', 'name', 'type'];
export const STATIC_FIELDS = ['mmsi', 'name', 'type', 'call', 'imo', 'dest', 'draught', 'len', 'beam', 't'];
const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'];

/** The first message AISStream expects (within three seconds of connecting). Boxes are [[south, west], [north, east]]. */
export function aisSubscription(key, boxes = [[[-90, -180], [90, 180]]]) {
  return JSON.stringify({ APIKey: key, BoundingBoxes: boxes, FilterMessageTypes: TYPES });
}

/** A view (centre and radius in km) as one or two AISStream boxes (two when it crosses the 180° meridian). */
export function viewBoxes(v) {
  const dLat = Math.min(90, v.radiusKm / 111); const s = Math.max(-90, v.lat - dLat); const n = Math.min(90, v.lat + dLat);
  const dLng = Math.min(180, dLat / Math.max(0.05, Math.cos((Math.min(80, Math.abs(v.lat)) * Math.PI) / 180)));
  const r = (x) => Math.round(x * 100) / 100;
  if (dLng >= 180) return [[[r(s), -180], [r(n), 180]]];
  const w = v.lng - dLng; const e = v.lng + dLng;
  if (w < -180) return [[[r(s), r(w + 360)], [r(n), 180]], [[r(s), -180], [r(n), r(e)]]];
  if (e > 180) return [[[r(s), r(w)], [r(n), 180]], [[r(s), -180], [r(n), r(e - 360)]]];
  return [[[r(s), r(w)], [r(n), r(e)]]];
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const clean = (s) => (typeof s === 'string' ? s.replace(/[@\s]+$/, '').replace(/\s+/g, ' ').trim() : '') || null; // AIS pads text with @
const minutes = (ms) => Math.round(ms / 60_000);

/**
 * Keeps the latest position and static data of every vessel heard. Feed it parsed AISStream messages with
 * add(); rows() and statics() return compact arrays (SHIP_FIELDS, STATIC_FIELDS). load() seeds it from an
 * earlier snapshot so coverage builds up between runs; maxAgeMin drops vessels not heard from since.
 */
export function createAisStore() {
  const pos = new Map(); const stat = new Map(); let messages = 0;
  const statOf = (mmsi) => { let s = stat.get(mmsi); if (!s) stat.set(mmsi, (s = { mmsi })); return s; };
  return {
    get messages() { return messages; },
    get size() { return pos.size; },
    staticOf: (mmsi) => stat.get(mmsi),
    add(m, now = Date.now()) {
      if (!m || typeof m !== 'object' || !m.Message) return false;
      const type = m.MessageType; const body = m.Message[type]; const meta = m.MetaData ?? {};
      if (!body) return false;
      const mmsi = Number(meta.MMSI ?? body.UserID);
      if (!Number.isInteger(mmsi) || mmsi <= 0) return false;
      messages++;
      const t = minutes(Date.parse(String(meta.time_utc ?? '').replace(/ \+0000 UTC$/, 'Z').replace(' ', 'T')) || now);
      const name = clean(meta.ShipName);
      if (name) statOf(mmsi).name = name;
      if (type === 'ShipStaticData') {
        const s = statOf(mmsi); const d = body.Dimension ?? {};
        Object.assign(s, {
          name: clean(body.Name) ?? s.name, type: num(body.Type) ?? s.type, call: clean(body.CallSign) ?? s.call,
          imo: num(body.ImoNumber) || s.imo, dest: clean(body.Destination) ?? s.dest, draught: num(body.MaximumStaticDraught) || s.draught,
          len: (num(d.A) ?? 0) + (num(d.B) ?? 0) || s.len, beam: (num(d.C) ?? 0) + (num(d.D) ?? 0) || s.beam, t,
        });
        return true;
      }
      if (type === 'StaticDataReport') {
        const s = statOf(mmsi); const a = body.ReportA ?? {}; const b = body.ReportB ?? {};
        if (a.Valid) s.name = clean(a.Name) ?? s.name;
        if (b.Valid) {
          const d = b.Dimension ?? {};
          Object.assign(s, { type: num(b.ShipType) ?? s.type, call: clean(b.CallSign) ?? s.call, len: (num(d.A) ?? 0) + (num(d.B) ?? 0) || s.len, beam: (num(d.C) ?? 0) + (num(d.D) ?? 0) || s.beam });
        }
        s.t = t; return true;
      }
      // a position report (class A, or class B for smaller craft)
      const lat = num(body.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude); const lng = num(body.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return false;
      const sog = num(body.Sog); const cog = num(body.Cog); const hdg = num(body.TrueHeading);
      pos.set(mmsi, {
        mmsi, lat: round(lat, 4), lng: round(lng, 4), sog: sog != null && sog < 102.3 ? round(sog, 1) : null, cog: cog != null && cog < 360 ? Math.round(cog) : null,
        hdg: hdg != null && hdg < 360 ? hdg : null, nav: num(body.NavigationalStatus) ?? null, t,
      });
      return true;
    },
    /** Adds earlier rows (SHIP_FIELDS / STATIC_FIELDS order); a vessel's newer report wins. */
    load(rows = [], statics = []) {
      for (const r of statics) { const s = Object.fromEntries(STATIC_FIELDS.map((f, i) => [f, r[i]])); if (s.mmsi && !((stat.get(s.mmsi)?.t ?? -1) > s.t)) stat.set(s.mmsi, { ...stat.get(s.mmsi), ...s }); }
      for (const r of rows) {
        const p = { mmsi: r[0], lat: r[1], lng: r[2], sog: r[3], cog: r[4], hdg: r[5], nav: r[6], t: r[7] };
        if (p.mmsi && !(pos.get(p.mmsi)?.t > p.t)) pos.set(p.mmsi, p);
        if (r[8] || r[9] != null) { const s = statOf(r[0]); s.name ??= r[8]; s.type ??= r[9]; }
      }
    },
    /** Drops vessels last heard more than maxAgeMin minutes ago (static data is kept longer: staticMaxAgeMin). */
    prune(maxAgeMin, staticMaxAgeMin = 24 * 60, now = Date.now()) {
      const t = minutes(now);
      for (const [k, p] of pos) if (t - p.t > maxAgeMin) pos.delete(k);
      for (const [k, s] of stat) if (!pos.has(k) && t - (s.t ?? 0) > staticMaxAgeMin) stat.delete(k);
    },
    rows() { return [...pos.values()].map((p) => { const s = stat.get(p.mmsi); return [p.mmsi, p.lat, p.lng, p.sog, p.cog, p.hdg, p.nav, p.t, s?.name ?? null, s?.type ?? null]; }); },
    statics() { return [...stat.values()].filter((s) => s.call || s.imo || s.dest || s.draught || s.len).map((s) => STATIC_FIELDS.map((f) => s[f] ?? null)); },
  };
}

/** Parses one WebSocket frame (text, ArrayBuffer, Uint8Array or Buffer) into a message object, or null. */
export function parseFrame(data) {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    return JSON.parse(text);
  } catch { return null; }
}
