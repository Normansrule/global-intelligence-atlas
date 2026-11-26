// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.39: the wildfire tracker. NASA FIRMS hot spots (VIIRS, 375 m pixels) grouped into
// fires, each fire's spread over the detections we have (24 hours from the live layer, up to 7 days from the bot's
// fires-spread.json), which way and how fast it is moving, a map of it that plays back pass by pass, and a place to
// stand to see it in person (fireview.js). Rows are the live layer's: [lat, lng, frp MW, conf 0|1|2, minutes since
// 1970 UTC, day 1|0]. Pure functions; see docs/ASSUMPTIONS.md (v2.39) for what is approximated.

const D = Math.PI / 180; const KM_LAT = 110.574; const MIN = 60_000; const HOUR = 36e5;
const kmLng = (lat) => 111.320 * Math.cos(lat * D);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** One VIIRS pixel is 375 m × 375 m at the centre of the swath (0.14 km²). */
export const PIXEL_KM = 0.375; export const PIXEL_KM2 = PIXEL_KM * PIXEL_KM;

/** Age bands: hours since a hot spot was seen, the colour on the map and the words for it. */
export const AGES = [
  { h: 3, color: '#fff2a8', word: 'burning now (under 3 hours)' },
  { h: 12, color: '#ffb340', word: '3 to 12 hours ago' },
  { h: 24, color: '#ff5a36', word: '12 to 24 hours ago' },
  { h: 72, color: '#b3322a', word: '1 to 3 days ago' },
  { h: Infinity, color: '#6d4b45', word: '3 to 7 days ago' },
];
export const ageBand = (hours) => AGES.findIndex((a) => hours < a.h);
export const ageColor = (hours) => AGES[Math.max(0, ageBand(hours))].color;
export const tMs = (r) => (r[4] ?? 0) * MIN;

/**
 * Hot spots into fires: every hot spot within about `linkKm` of another belongs to the same fire (a grid of cells
 * `linkKm` wide, each cell joined to its eight neighbours). Returns fires, biggest heat first:
 * { id, lat, lng, n, frp (total MW of all detections), maxFrp, peak (strongest row), first, last (ms), areaKm2, rows }.
 */
export function clusterFires(rows, { linkKm = 2, minN = 1 } = {}) {
  const cell = linkKm / KM_LAT; const cells = new Map();
  for (const r of rows) {
    const cy = Math.floor(r[0] / cell); const cx = Math.floor(r[1] / (linkKm / Math.max(1, kmLng(r[0]))));
    const k = `${cy}:${cx}`; let c = cells.get(k); if (!c) cells.set(k, (c = { cy, cx, rows: [], p: null })); c.rows.push(r);
  }
  const find = (c) => { while (c.p) { if (c.p.p) c.p = c.p.p; c = c.p; } return c; };
  for (const c of cells.values()) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dy && !dx) continue; const o = cells.get(`${c.cy + dy}:${c.cx + dx}`); if (!o) continue;
    const a = find(c); const b = find(o); if (a !== b) b.p = a;
  }
  const groups = new Map();
  for (const c of cells.values()) { const root = find(c); let g = groups.get(root); if (!g) groups.set(root, (g = [])); for (const r of c.rows) g.push(r); }
  const out = [];
  for (const g of groups.values()) if (g.length >= minN) out.push(summarise(g));
  return out.sort((a, b) => b.frp - a.frp);
}

/** The figures for one fire from its rows. */
export function summarise(rows) {
  let lat = 0; let lng = 0; let frp = 0; let peak = rows[0]; let first = Infinity; let last = -Infinity;
  const px = new Set();
  for (const r of rows) {
    lat += r[0]; lng += r[1]; frp += r[2]; if (r[2] > peak[2]) peak = r;
    const t = tMs(r); if (t < first) first = t; if (t > last) last = t;
    px.add(`${Math.round(r[0] * KM_LAT / PIXEL_KM)}:${Math.round(r[1] * kmLng(r[0]) / PIXEL_KM)}`);
  }
  lat /= rows.length; lng /= rows.length;
  return { id: `${lat.toFixed(2)},${lng.toFixed(2)}`, lat, lng, n: rows.length, frp, maxFrp: peak[2], peak, first, last, areaKm2: px.size * PIXEL_KM2, rows };
}

/** Local kilometres east and north of (lat0, lng0). */
export const toKm = (lat0, lng0, lat, lng) => [(lng - lng0) * kmLng(lat0), (lat - lat0) * KM_LAT];
export const fromKm = (lat0, lng0, x, y) => [lat0 + y / KM_LAT, lng0 + x / kmLng(lat0)];

/** The convex hull of [x, y] points (Andrew's monotone chain), anticlockwise. */
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export const polyArea = (h) => { let s = 0; for (let i = 0; i < h.length; i++) { const a = h[i]; const b = h[(i + 1) % h.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

/** Satellite passes: the fire's rows split wherever more than `gapMin` minutes pass without a detection. */
export function passes(rows, gapMin = 50) {
  const s = [...rows].sort((a, b) => a[4] - b[4]); const out = [];
  for (const r of s) { const cur = out[out.length - 1]; if (cur && r[4] - cur.t1 <= gapMin) { cur.rows.push(r); cur.t1 = r[4]; } else out.push({ t0: r[4], t1: r[4], rows: [r] }); }
  return out.map((p) => ({ t: p.t0 * MIN, n: p.rows.length, frp: p.rows.reduce((a, r) => a + r[2], 0), day: p.rows[0][5] === 1, rows: p.rows }));
}

/**
 * How the fire is moving: the centre of its newest detections against the centre of its oldest (a third each),
 * giving a bearing (degrees from north), km/day, and whether it is growing, steady or dying down (detections in the
 * newest quarter of the time span against the one before). Null when it was seen over less than 6 hours.
 */
export function spread(f, now = Date.now()) {
  const s = [...f.rows].sort((a, b) => a[4] - b[4]);
  const span = f.last - f.first;
  const tail = (rs) => rs.reduce((a, r) => [a[0] + r[0] / rs.length, a[1] + r[1] / rs.length], [0, 0]);
  let move = null;
  if (span >= 6 * HOUR && s.length >= 6) {
    const k = Math.max(2, Math.floor(s.length / 3)); const a = s.slice(0, k); const b = s.slice(-k);
    const [la0, lo0] = tail(a); const [la1, lo1] = tail(b);
    const [x, y] = toKm(la0, lo0, la1, lo1); const km = Math.hypot(x, y);
    const days = (tMs(b[b.length - 1]) + tMs(b[0]) - tMs(a[0]) - tMs(a[a.length - 1])) / 2 / 864e5;
    move = { km, bearing: (Math.atan2(x, y) / D + 360) % 360, kmPerDay: days > 0 ? km / days : 0 };
  }
  const q = Math.max(span / 4, 3 * HOUR); const newest = f.rows.filter((r) => tMs(r) > f.last - q).length; const before = f.rows.filter((r) => tMs(r) <= f.last - q && tMs(r) > f.last - 2 * q).length;
  const trend = f.last < now - 18 * HOUR ? 'quiet' : newest > before * 1.3 + 2 ? 'growing' : newest * 1.3 + 2 < before ? 'dying down' : 'steady';
  return { move, trend, newest, before, hours: span / HOUR };
}

/** Rows seen at or before time `t` (ms): the fire as it was then. */
export const asOf = (f, t) => f.rows.filter((r) => tMs(r) <= t);

/** A place to stand: `km` outside the edge of `rows` (by default the whole fire; fireview.js passes the part burning
 *  now) on the given side (bearing from their centre), facing their centre. */
export function viewpoint(f, side = 180, km = 1.5, rows = f.rows) {
  const c = rows.length ? rows.reduce((a, r) => [a[0] + r[0] / rows.length, a[1] + r[1] / rows.length], [0, 0]) : [f.lat, f.lng];
  const pts = rows.map((r) => toKm(c[0], c[1], r[0], r[1]));
  // how far they reach from their centre in the direction of `side`
  const ux = Math.sin(side * D); const uy = Math.cos(side * D);
  const reach = pts.reduce((m, [x, y]) => Math.max(m, x * ux + y * uy), 0) + PIXEL_KM / 2;
  const dist = reach + km; const [lat, lng] = fromKm(c[0], c[1], ux * dist, uy * dist);
  return { lat, lng, facing: (side + 180) % 360, distKm: dist, reachKm: reach, centre: c };
}

/** The fire's radius: the farthest detection from its centre, in km (at least one pixel). */
export const radiusKm = (f) => f.rows.reduce((m, r) => Math.max(m, Math.hypot(...toKm(f.lat, f.lng, r[0], r[1]))), PIXEL_KM);

/** Might this be an industrial heat source (a gas flare, a steel works) rather than a wildfire? Tiny and in the same
 *  place on every pass over several days. Only a hint: FIRMS's own static-source mask is not in the live files. */
export function maybeIndustrial(f) {
  return f.areaKm2 <= 4 * PIXEL_KM2 && (f.last - f.first) >= 2 * 864e5 && passes(f.rows).length >= 4;
}

/** A sentence about how the fire is behaving. */
export function spreadWords(f, sp) {
  const parts = [];
  if (sp.move && sp.move.km >= 0.5) parts.push(`Its newest hot spots are ${fmt(sp.move.km, 1)} km ${dirWord(sp.move.bearing)} of its first ones, so it is spreading ${dirWord(sp.move.bearing)} at about ${fmt(sp.move.kmPerDay, 1)} km a day.`);
  else if (sp.move) parts.push('Its newest hot spots are about where the first ones were: it is burning in place rather than running.');
  else parts.push('It has been seen over too short a time to say which way it is spreading.');
  parts.push(sp.trend === 'growing' ? 'It is growing: more hot spots in the latest passes than before.' : sp.trend === 'dying down' ? 'It is dying down: fewer hot spots in the latest passes.' : sp.trend === 'quiet' ? 'No hot spots for over 18 hours: it may be out, or hidden by cloud.' : 'It is about as active as it was.');
  return parts.join(' ');
}

/**
 * The fire as a small map (SVG), drawn in kilometres: each detection a 375 m square coloured by its age at `t`, the
 * outline of everything seen up to `t`, the outline a day before as a dashed line, a scale bar and north.
 */
export function fireSvg(f, t = f.last, { size = 320 } = {}) {
  const pts = f.rows.map((r) => [r, ...toKm(f.lat, f.lng, r[0], r[1])]);
  const R = pts.reduce((m, [, x, y]) => Math.max(m, Math.abs(x), Math.abs(y)), 1) + PIXEL_KM * 2;
  const s = size / (2 * R); const X = (x) => size / 2 + x * s; const Y = (y) => size / 2 - y * s;
  const shown = pts.filter(([r]) => tMs(r) <= t);
  const sq = Math.max(2, PIXEL_KM * s);
  const cells = shown.sort((a, b) => a[0][4] - b[0][4]).map(([r, x, y]) => `<rect x="${(X(x) - sq / 2).toFixed(1)}" y="${(Y(y) - sq / 2).toFixed(1)}" width="${sq.toFixed(1)}" height="${sq.toFixed(1)}" fill="${ageColor((t - tMs(r)) / HOUR)}"/>`).join('');
  const outline = (rs, cls) => { const h = hull(rs.map(([, x, y]) => [x, y])); return h.length >= 3 ? `<path class="${cls}" d="M${h.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('L')}Z"/>` : ''; };
  const dayBefore = shown.filter(([r]) => tMs(r) <= t - 24 * HOUR);
  const bar = [0.5, 1, 2, 5, 10, 20, 50].find((k) => k * s >= size / 5) ?? 50;
  return `<svg class="wf-map" viewBox="0 0 ${size} ${size}" role="img" aria-label="Map of the fire's hot spots up to ${new Date(t).toUTCString()}">
    <rect class="wf-bg" width="${size}" height="${size}" rx="8"/>
    ${outline(dayBefore, 'wf-old')}${outline(shown, 'wf-edge')}${cells}
    <g class="wf-scale"><path d="M12 ${size - 14}h${(bar * s).toFixed(1)}"/><text x="12" y="${size - 20}">${bar} km</text></g>
    <g class="wf-north" transform="translate(${size - 20} 22)"><path d="M0 -10L5 6L0 2L-5 6Z"/><text y="18" text-anchor="middle">N</text></g>
  </svg>`;
}

/** The legend for the age colours. */
export const ageLegend = (maxH = 168) => `<ul class="wf-legend">${AGES.filter((a, i) => i === 0 || AGES[i - 1].h < maxH).map((a) => `<li><i style="--c:${a.color}"></i>${esc(a.word)}</li>`).join('')}</ul>`;

/** Rows for the list of the biggest fires burning now. */
export function topFires(fires, n = 15, now = Date.now()) {
  return fires.filter((f) => f.n >= 3 && f.last > now - 36 * HOUR && !maybeIndustrial(f)).slice(0, n);
}

/** The bot's compact form of the fires-spread file → fires with full rows. Each fire: [lat, lng, rows] where each
 *  row is [dLat×1000, dLng×1000, frp, conf, minutes, day] relative to the fire's centre. */
export function unpackSpread(j) {
  return (j?.fires ?? []).map(([la, lo, rs]) => summarise(rs.map(([a, b, frp, c, t, d]) => [la + a / 1000, lo + b / 1000, frp, c, t, d])));
}
export function packSpread(fires) {
  return fires.map((f) => { const la = Math.round(f.lat * 1000) / 1000; const lo = Math.round(f.lng * 1000) / 1000; return [la, lo, f.rows.map((r) => [Math.round((r[0] - la) * 1000), Math.round((r[1] - lo) * 1000), r[2], r[3], r[4], r[5]])]; });
}

/** Thins a fire to at most `max` rows, keeping every row of the newest day and the strongest of older ones. */
export function thin(f, max = 500) {
  if (f.rows.length <= max) return f;
  const cut = f.last - 24 * HOUR; const recent = f.rows.filter((r) => tMs(r) > cut).sort((a, b) => b[2] - a[2]).slice(0, max);
  const older = f.rows.filter((r) => tMs(r) <= cut).sort((a, b) => b[2] - a[2]).slice(0, Math.max(0, max - recent.length));
  return summarise([...recent, ...older]);
}

/** Merges the 7-day spread fires with the live 24-hour rows: the live rows win for the last day. */
export function mergeFires(spreadFires, liveRows) {
  const live = liveRows ?? []; let since = Infinity; for (const r of live) { const t = tMs(r); if (t < since) since = t; }
  const old = spreadFires.flatMap((f) => f.rows).filter((r) => tMs(r) < since);
  return clusterFires(old.concat(live));
}
