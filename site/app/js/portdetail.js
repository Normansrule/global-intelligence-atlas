// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one port in depth.
// Click a port and its card becomes a port page:
//   the sea now      waves, swell, the water temperature, the current and the wind at the harbour mouth, with the
//                    sea state in words (World Meteorological Organization (WMO) sea-state code) and a wave that
//                    moves as high and as fast as the real one (Open-Meteo marine and forecast models);
//   the tide         the sea level over yesterday, today and tomorrow, with the next high and low water;
//   your ship        a cut-away of the harbour's depths (channel, anchorage, cargo pier, oil and gas terminals)
//                    with the tide on top, and which of nine typical ships can get in: at any tide, at high
//                    tide only, too deep, too long or too wide;
//   getting in       what the World Port Index says about entering: tide, swell and ice limits, pilots, tugs,
//                    traffic services, shelter and the turning basin;
//   what it handles  containers, bulk, oil, gas, roll-on/roll-off and more, the heaviest lift its cranes manage,
//                    repairs, dry dock, supplies and services;
//   ships here now   the live ships within 20 km, moored, at anchor or moving, by kind, the biggest of them and
//                    whether the deepest one would touch bottom in the channel;
//   getting there    the nearest city, airports and other harbours;
//   charts           the Sailing Directions volume, the chart, the navigational warning area.
// On the globe: the 20 km circle the ships are counted in and a 100 km circle, in one draw call.
// The harbour facts come from the U.S. National Geospatial-Intelligence Agency's World Port Index (Pub. 150);
// a World Monitor port borrows the record of the index port nearest to it. Nothing here is for navigation.
import { getFeed, getSnapshot } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, bearingDeg, smallCircle } from './astro.js';
import { cities, airports } from './citydetail.js';
import { shipKind, KIND_LABEL } from './shipdb.js';
import { mountShipView, paintThumbs, shipClass, shipDims } from './shipview.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const KM_PER_DEG = 111.195;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const short = (deg) => (deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
const title = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
export const SHIP_RADIUS_KM = 20; // "here now" means within this distance of the port
const NEAR_KM = 100;

// ---------------------------------------------------------------- the World Port Index's yes / no answers
// The order tools/fetch-open-data.mjs packs them into each port's `yn` string (WPI_FLAGS there; a test checks
// the two lists match). Each entry: key, plain words, the section of the page it belongs to.
export const PORT_FLAGS = [
  ['erTide', 'Tide limits entry', 'in'], ['erSwell', 'Heavy swell limits entry', 'in'], ['erIce', 'Ice limits entry', 'in'], ['erOther', 'Other entry limits', 'in'],
  ['overheadLimits', 'Bridges or cables overhead', 'in'], ['goodHoldingGround', 'Good holding ground for anchors', 'in'], ['turningArea', 'Turning basin', 'in'], ['portSecurity', 'Port security', 'in'],
  ['etaMessage', 'Arrival time must be sent ahead', 'in'], ['qtPratique', 'Free pratique (health clearance)', 'in'], ['qtSanitation', 'Ship sanitation certificate', 'in'], ['qtOther', 'Other quarantine rules', 'in'],
  ['tss', 'Traffic Separation Scheme (TSS)', 'in'], ['vts', 'Vessel Traffic Service (VTS)', 'in'], ['firstPortOfEntry', 'First port of entry to the country', 'in'], ['usRep', 'United States representative', 'in'],
  ['ptCompulsory', 'Pilot compulsory', 'pilot'], ['ptAvailable', 'Pilot available', 'pilot'], ['ptLocalAssist', 'Local pilot assistance', 'pilot'], ['ptAdvisable', 'Pilot advisable', 'pilot'],
  ['tugsSalvage', 'Salvage tugs', 'pilot'], ['tugsAssist', 'Tugs to assist', 'pilot'],
  ['cmTelephone', 'Telephone', 'comms'], ['cmTelegraph', 'Telefax', 'comms'], ['cmRadio', 'Radio', 'comms'], ['cmRadioTel', 'Radiotelephone', 'comms'], ['cmAir', 'Airport nearby', 'comms'], ['cmRail', 'Railway link', 'comms'],
  ['searchAndRescue', 'Search and rescue', 'pilot'],
  ['loWharves', 'Wharves', 'berth'], ['loAnchor', 'Anchorage', 'berth'], ['loDangCargo', 'Dangerous-cargo anchorage', 'berth'], ['loMedMoor', 'Mediterranean mooring (stern to)', 'berth'],
  ['loBeachMoor', 'Beach mooring', 'berth'], ['loIceMoor', 'Ice mooring', 'berth'], ['loRoro', 'Roll-on/roll-off (RoRo)', 'cargo'], ['loSolidBulk', 'Solid bulk', 'cargo'],
  ['loLiquidBulk', 'Liquid bulk', 'cargo'], ['loContainer', 'Containers', 'cargo'], ['loBreakBulk', 'Break bulk', 'cargo'], ['loOilTerm', 'Oil terminal', 'cargo'],
  ['loLongTerm', 'Liquefied natural gas (LNG) terminal', 'cargo'], ['loOther', 'Other cargo', 'cargo'],
  ['medFacilities', 'Medical care', 'service'], ['garbageDisposal', 'Garbage disposal', 'service'], ['cht', 'Chemical holding-tank disposal', 'service'], ['degauss', 'Degaussing', 'service'], ['dirtyBallast', 'Dirty ballast disposal', 'service'],
  ['crFixed', 'Fixed cranes', 'crane'], ['crMobile', 'Mobile cranes', 'crane'], ['crFloating', 'Floating cranes', 'crane'], ['cranesContainer', 'Container cranes', 'crane'],
  ['lifts100', '100 t and more', 'lift'], ['lifts50', '50 to 100 t', 'lift'], ['lifts25', '25 to 49 t', 'lift'], ['lifts0', 'up to 24 t', 'lift'],
  ['srLongshore', 'Dock workers', 'service'], ['srElectrical', 'Shore power', 'service'], ['srSteam', 'Steam', 'service'], ['srNavigEquip', 'Navigation equipment', 'service'],
  ['srElectRepair', 'Electrical repair', 'service'], ['srIceBreaking', 'Ice breaking', 'service'], ['srDiving', 'Divers', 'service'],
  ['suProvisions', 'Food', 'supply'], ['suWater', 'Drinking water', 'supply'], ['suFuel', 'Fuel oil', 'supply'], ['suDiesel', 'Diesel', 'supply'],
  ['suAviationFuel', 'Aviation fuel', 'supply'], ['suDeck', 'Deck stores', 'supply'], ['suEngine', 'Engine stores', 'supply'],
];
/** A port's answers as { key: 'Y' | 'N' | 'U' } (all 'U' when the record has none). */
export function portFlags(p) {
  const s = String(p?.yn ?? ''); const out = {};
  PORT_FLAGS.forEach(([k], i) => { out[k] = s[i] === 'Y' || s[i] === 'N' ? s[i] : 'U'; });
  return out;
}

// ---------------------------------------------------------------- the sea
// WMO sea-state code 3700 (the Douglas scale): the significant wave height in metres at the top of each step.
export const SEA_STATES = [[0, 'Calm (glassy)'], [0.1, 'Calm (rippled)'], [0.5, 'Smooth'], [1.25, 'Slight'], [2.5, 'Moderate'], [4, 'Rough'], [6, 'Very rough'], [9, 'High'], [14, 'Very high'], [Infinity, 'Phenomenal']];
/** The sea state for a significant wave height in metres: { code 0–9, word }. */
export function seaState(m) {
  if (m == null || !Number.isFinite(m)) return null;
  const i = SEA_STATES.findIndex(([top], k) => (k === 0 ? m <= 0 : m <= top));
  const code = i < 0 ? 9 : i; return { code, word: SEA_STATES[code][1] };
}
// Beaufort wind force from the wind in km/h (World Meteorological Organization limits, rounded).
const BEAUFORT = [[1, 'Calm'], [6, 'Light air'], [12, 'Light breeze'], [20, 'Gentle breeze'], [29, 'Moderate breeze'], [39, 'Fresh breeze'], [50, 'Strong breeze'], [62, 'Near gale'], [75, 'Gale'], [89, 'Strong gale'], [103, 'Storm'], [118, 'Violent storm'], [Infinity, 'Hurricane force']];
export function beaufort(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return null;
  const f = BEAUFORT.findIndex(([top]) => kmh < top); return { force: f, word: BEAUFORT[f][1] };
}

/**
 * The turns of the tide in an hourly sea-level series: every local high and low, refined with a parabola through
 * the three hours around it so the time and height fall between the hours. times are ms, levels metres.
 */
export function tideTurns(times, levels) {
  const out = [];
  for (let i = 1; i < levels.length - 1; i++) {
    const a = levels[i - 1]; const b = levels[i]; const c = levels[i + 1];
    if (a == null || b == null || c == null) continue;
    const hi = b > a && b >= c; const lo = b < a && b <= c; if (!hi && !lo) continue;
    const den = a - 2 * b + c; const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const step = times[i + 1] - times[i];
    out.push({ t: times[i] + off * step, v: b - 0.25 * (a - c) * off, high: hi });
  }
  return out;
}

/** The tide over the window as a line, shaded below, with the turns labelled and now marked. */
function tideChart(times, levels, turns, now, off, W = 320, H = 118) {
  const pts = times.map((t, i) => [t, levels[i]]).filter(([, v]) => v != null); if (pts.length < 6) return '';
  const t0 = pts[0][0]; const t1 = pts.at(-1)[0]; const lo = Math.min(...pts.map((x) => x[1])); const hi = Math.max(...pts.map((x) => x[1]));
  const pad = Math.max(0.05, (hi - lo) * 0.18);
  const sx = (t) => 4 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 8); const sy = (v) => 14 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (H - 34);
  const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)} ${sy(v).toFixed(1)}`).join('');
  const area = `${line}L${sx(t1).toFixed(1)} ${H - 18}L${sx(t0).toFixed(1)} ${H - 18}Z`;
  const clock = (t) => { const d = new Date(t + off * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const marks = turns.filter((x) => x.t >= t0 && x.t <= t1).map((x) => `<circle cx="${sx(x.t).toFixed(1)}" cy="${sy(x.v).toFixed(1)}" r="2.6" class="pt-turn ${x.high ? 'hi' : 'lo'}"/><text x="${sx(x.t).toFixed(1)}" y="${(sy(x.v) + (x.high ? -5 : 12)).toFixed(1)}" text-anchor="middle" class="pt-tt">${clock(x.t)}</text>`).join('');
  // midnights (local) as day labels
  const days = []; const first = new Date(t0 + off * 1000); first.setUTCHours(24, 0, 0, 0);
  for (let m = first.getTime() - off * 1000; m < t1; m += 86400_000) days.push(m);
  const dayTicks = days.map((m) => `<line x1="${sx(m).toFixed(1)}" x2="${sx(m).toFixed(1)}" y1="10" y2="${H - 18}" class="pt-mid"/><text x="${(sx(m) + 3).toFixed(1)}" y="${H - 6}" class="pt-tick">${esc(new Date(m + off * 1000).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }))}</text>`).join('');
  const nowX = sx(Math.min(t1, Math.max(t0, now)));
  const k = pts.findIndex(([t]) => t >= now); const nowV = k > 0 ? pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * (now - pts[k - 1][0])) / Math.max(1, pts[k][0] - pts[k - 1][0]) : pts[0][1];
  return `<svg class="pt-tide" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sea level from ${fmt(lo, 1)} to ${fmt(hi, 1)} m over three days">${dayTicks}<path d="${area}" class="pt-sea"/><path d="${line}" class="pt-level"/>${marks}
    <line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="8" y2="${H - 18}" class="pt-nowline"/><circle cx="${nowX.toFixed(1)}" cy="${sy(nowV).toFixed(1)}" r="3.6" class="pt-nowdot"/></svg>`;
}

/** A wave drawn as high and as quick as the real one: one sine path, scrolling with CSS (period in seconds). */
function liveWave(heightM, periodS) {
  const amp = Math.max(1.5, Math.min(13, 2 + (heightM ?? 0) * 3)); const W = 120; const H = 34; const mid = H / 2;
  let d = `M0 ${mid}`; for (let x = 0; x <= W * 2; x += 4) d += `L${x} ${(mid - amp * Math.sin((x / W) * 2 * Math.PI * 2)).toFixed(1)}`;
  const dur = Math.max(3, Math.min(16, periodS || 8));
  return `<svg class="pt-wave" viewBox="0 0 ${W} ${H}" aria-hidden="true"><g style="--dur:${dur}s"><path d="${d}L${W * 2} ${H}L0 ${H}Z" class="pt-wv"/></g></svg>`;
}

// ---------------------------------------------------------------- will my ship fit
// Typical ships, loaded: length, beam (width) and draught (depth below the waterline) in metres, and which
// berth depth they need. The real ones vary; these are round figures for each class, not any one ship.
export const REF_SHIPS = [
  { id: 'fishing', cls: 'fishing', name: 'Fishing boat', glyph: 'fishing', len: 30, beam: 8, draught: 4, berth: 'cargo' },
  { id: 'ferry', cls: 'ferry', name: 'Car ferry', glyph: 'ferry', len: 200, beam: 30, draught: 6.5, berth: 'cargo' },
  { id: 'cruise', cls: 'cruise', name: 'Biggest cruise ship', glyph: 'ferry', len: 365, beam: 47, draught: 9.3, berth: 'cargo' },
  { id: 'panamax', cls: 'bulk', name: 'Panamax bulk carrier', glyph: 'ship', len: 225, beam: 32.3, draught: 12, berth: 'cargo' },
  { id: 'lng', cls: 'gas', name: 'Large LNG carrier', glyph: 'tanker', len: 345, beam: 54, draught: 12, berth: 'lng' },
  { id: 'neopanamax', cls: 'container', name: 'Neopanamax container ship', glyph: 'ship', len: 366, beam: 49, draught: 15.2, berth: 'cargo' },
  { id: 'ulcv', cls: 'container', name: 'Biggest container ship', glyph: 'ship', len: 400, beam: 61.5, draught: 16.5, berth: 'cargo' },
  { id: 'capesize', cls: 'bulk', name: 'Capesize bulk carrier', glyph: 'ship', len: 290, beam: 45, draught: 18, berth: 'cargo' },
  { id: 'vlcc', cls: 'tanker', name: 'Very large crude carrier', glyph: 'tanker', len: 330, beam: 60, draught: 22.5, berth: 'oil' },
];
/** The depth that limits a ship at this port: the shallower of the channel and its berth (null if unknown). */
export function controllingDepth(p, berth) {
  const b = berth === 'oil' ? (p.oilTerminalDepthM ?? null) : berth === 'lng' ? (p.lngTerminalDepthM ?? null) : (p.cargoPierDepthM ?? null);
  const c = p.channelDepthM ?? null; const ds = [b, c].filter((x) => x != null && x > 0);
  return ds.length ? Math.min(...ds) : null;
}
/**
 * Can this ship get in? { ok: 'yes' | 'tide' | 'anchor' | 'no' | '?', why } — 'tide' when it fits only on the
 * top of the tide, 'anchor' when the berth is too shallow but it can lie at anchor and work cargo by barge.
 */
export function shipVerdict(p, s) {
  const why = [];
  if (p.maxVesselLengthM && s.len > p.maxVesselLengthM) return { ok: 'no', why: `longer than the ${fmt(p.maxVesselLengthM)} m limit` };
  if (p.maxBeamM && s.beam > p.maxBeamM) return { ok: 'no', why: `wider than the ${fmt(p.maxBeamM, 1)} m limit` };
  if (p.maxDraftM && s.draught > p.maxDraftM) return { ok: 'no', why: `draws more than the ${fmt(p.maxDraftM, 1)} m limit` };
  const flags = portFlags(p);
  if (s.berth === 'oil' && p.oilTerminalDepthM == null && flags.loOilTerm === 'N') return { ok: 'no', why: 'no oil terminal' };
  if (s.berth === 'lng' && p.lngTerminalDepthM == null && flags.loLongTerm === 'N') return { ok: 'no', why: 'no gas terminal' };
  if (s.berth === 'lng' && p.lngTerminalDepthM == null && flags.loLongTerm !== 'Y') return { ok: '?', why: 'no gas terminal recorded' };
  const d = controllingDepth(p, s.berth);
  if (d == null) return { ok: '?', why: 'depths not published' };
  if (s.draught <= d) { why.push(`${fmt(d - s.draught, 1)} m to spare`); return { ok: 'yes', why: why.join(', ') }; }
  if (p.tideM && s.draught <= d + p.tideM) return { ok: 'tide', why: `only near high tide (${fmt(s.draught - d, 1)} m short at low water)` };
  if (p.anchorageDepthM && s.draught <= p.anchorageDepthM && (p.channelDepthM == null || s.draught <= p.channelDepthM + (p.tideM ?? 0))) return { ok: 'anchor', why: 'berths too shallow: it would anchor and work cargo by barge' };
  return { ok: 'no', why: `${fmt(s.draught - d, 1)} m too deep` };
}
const VERDICT = { yes: ['ok', 'fits'], tide: ['warn', 'high tide'], anchor: ['warn', 'anchors off'], no: ['bad', 'cannot'], '?': ['unk', 'unknown'] };

/** The harbour's depths as a cut-away: one column of water per depth, the tide on top and the chosen ship's hull. */
export function depthSvg(p, ship, W = 320, H = 178) {
  const cols = [['Channel', p.channelDepthM], ['Anchorage', p.anchorageDepthM], ['Cargo pier', p.cargoPierDepthM], ['Oil terminal', p.oilTerminalDepthM], ['Gas terminal', p.lngTerminalDepthM]].filter(([, v]) => v > 0);
  if (!cols.length) return '';
  const tide = p.tideM ?? 0; const deep = Math.max(ship?.draught ?? 0, ...cols.map(([, v]) => v)) + 2; const top = 26; const bot = H - 22;
  const sy = (m) => top + (m / deep) * (bot - top); const tideH = Math.min(top - 4, (tide / deep) * (bot - top));
  const x0 = 96; const cw = (W - x0 - 4) / cols.length;
  const water = cols.map(([name, v], i) => { const x = x0 + i * cw; return `<g class="pt-col" style="--i:${i}"><rect x="${(x + 2).toFixed(1)}" y="${top}" width="${(cw - 4).toFixed(1)}" height="${(sy(v) - top).toFixed(1)}" class="pt-w"/>
      <rect x="${(x + 2).toFixed(1)}" y="${sy(v).toFixed(1)}" width="${(cw - 4).toFixed(1)}" height="${(bot - sy(v)).toFixed(1)}" class="pt-bed"/>
      <text x="${(x + cw / 2).toFixed(1)}" y="${(sy(v) - 4).toFixed(1)}" text-anchor="middle" class="pt-d">${fmt(v, 1)} m</text>
      <text x="${(x + cw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="pt-tick">${esc(name)}</text></g>`; }).join('');
  const tideBand = tide ? `<rect x="${x0}" y="${(top - tideH).toFixed(1)}" width="${W - x0 - 4}" height="${tideH.toFixed(1)}" class="pt-tideband"/><text x="${W - 6}" y="${(top - tideH - 3).toFixed(1)}" text-anchor="end" class="pt-tick">high tide +${fmt(tide, 1)} m</text>` : '';
  // the ship: a hull from the waterline down to its draught, with its draught line run across every column
  let hull = '';
  if (ship) {
    const d = sy(ship.draught); const hw = 80;
    hull = `<path d="M6 ${top - 10}L${hw} ${top - 10}L${hw - 6} ${d.toFixed(1)}L14 ${d.toFixed(1)}Z" class="pt-hull"/><path d="M14 ${top - 10}L14 ${top - 24}L34 ${top - 24}L34 ${top - 10}" class="pt-hull"/>
      <line x1="6" x2="${W - 4}" y1="${d.toFixed(1)}" y2="${d.toFixed(1)}" class="pt-draft"/><text x="8" y="${(d + 12).toFixed(1)}" class="pt-d">draws ${fmt(ship.draught, 1)} m</text>`;
  }
  return `<svg class="pt-depth" viewBox="0 0 ${W} ${H}" role="img" aria-label="Depths: ${cols.map(([n, v]) => `${n} ${fmt(v, 1)} m`).join(', ')}${tide ? `; tide ${fmt(tide, 1)} m` : ''}">
    <line x1="0" x2="${W}" y1="${top}" y2="${top}" class="pt-wl"/><text x="${W - 6}" y="${top + 11}" text-anchor="end" class="pt-tick">low water</text>${tideBand}${water}${hull}</svg>`;
}

// ---------------------------------------------------------------- ships here now
const NAV_WORD = { 0: 'under way', 1: 'at anchor', 2: 'not under command', 3: 'restricted', 5: 'moored', 6: 'aground', 7: 'fishing', 8: 'sailing' };
const KIND_ONE = { cargo: 'cargo ship', tanker: 'tanker', passenger: 'passenger ship', fishing: 'fishing vessel', tug: 'tug', leisure: 'sailing or pleasure boat', other: 'other vessel' };
const KIND_GLYPH = { cargo: 'ship', tanker: 'tanker', passenger: 'ferry', fishing: 'fishing', tug: 'tug', leisure: 'sailboat', other: 'ship' };
/** The live ships within `km` of the port, with how far, their kind and whether they are tied up, anchored or moving. */
export function shipsNear(p, ships, metaOf = (s) => s.meta ?? {}, km = SHIP_RADIUS_KM) {
  if (!ships) return null;
  const dLat = km / KM_PER_DEG + 0.01; const out = [];
  for (const s of ships) {
    if (s.lat == null || Math.abs(s.lat - p.lat) > dLat) continue;
    const d = haversineKm(p.lat, p.lon, s.lat, s.lng); if (d > km) continue;
    const m = metaOf(s) ?? {}; const kind = shipKind(m.shipType ?? s.meta?.shipType) ?? 'other';
    const state = s.nav === 5 ? 'moored' : s.nav === 1 ? 'anchored' : (s.sog ?? 0) > 0.5 ? 'moving' : 'still';
    out.push({ s, km: d, kind, state, name: m.name ?? s.meta?.name ?? `MMSI ${s.mmsi}`, len: m.length ?? null, draughtM: m.draught ? m.draught / 10 : null });
  }
  return out.sort((a, b) => a.km - b.km);
}

// ---------------------------------------------------------------- the open port (shared with the globe)
export const pt = { key: null, p: null, rec: null, fat: null, ship: null, view: null };
let WPI = null;
/** The World Port Index rows (open data), loaded once: used to give a World Monitor port its harbour record. */
async function wpiRows() { WPI ??= getSnapshot('ngawpi', 'ports.json', { branch: 'open-data', ttl: 24 * 3600_000 }).then((j) => j.rows ?? []).catch(() => []); return WPI; }
/** The harbour record behind a port: its own when it is from the index, otherwise the index port nearest it (within 25 km). */
export async function harbourRecord(p) {
  if (p.wpi) return p;
  const rows = await wpiRows();
  let best = null; for (const r of rows) { if (Math.abs(r.lat - p.lat) > 0.3) continue; const d = haversineKm(p.lat, p.lon, r.lat, r.lon); if (d <= 25 && (!best || (r.size === 'Large') - (best.r.size === 'Large') > 0 || d < best.d)) best = { r, d }; }
  return best?.r ?? null;
}
const marineUrl = (lat, lng) => `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction&hourly=sea_level_height_msl&past_days=1&forecast_days=2&cell_selection=sea&timezone=GMT`;
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day&timezone=auto`;

export function portHtml(p) {
  return `<div class="pt" data-port="${esc(p.id ?? p.name)}">
    <p class="cd-line" id="pt-line"></p>
    <div class="cy-now-box" id="pt-sea"><div class="lm-fact skel"></div></div>
    <div id="pt-tide"></div>
    <details class="qd-sec" open><summary><span>Can it take your ship?</span><small id="pt-fit-sum"></small></summary><div id="pt-fit"><p class="muted">Reading the harbour…</p></div></details>
    <details class="qd-sec" open><summary><span>Ships here now</span><small id="pt-ships-sum"></small></summary><div id="pt-ships"></div></details>
    <details class="qd-sec"><summary><span>Getting in</span><small id="pt-in-sum"></small></summary><div id="pt-in"></div></details>
    <details class="qd-sec"><summary><span>What it handles</span><small id="pt-cargo-sum"></small></summary><div id="pt-cargo"></div></details>
    <details class="qd-sec"><summary><span>Getting there</span><small id="pt-near-sum"></small></summary><div id="pt-near"></div></details>
    <details class="qd-sec"><summary><span>Charts and notices</span><small id="pt-chart-sum"></small></summary><div id="pt-chart"></div></details>
  </div>`;
}

const chip = (state, label) => `<span class="ld-chip pt-yn tone-${state === 'Y' ? 'ok' : state === 'N' ? 'off' : 'unk'}" title="${state === 'Y' ? 'Yes' : state === 'N' ? 'No' : 'Not known'}">${state === 'Y' ? '✓ ' : state === 'N' ? '✕ ' : '? '}${esc(label)}</span>`;
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };
const sum = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

/** Fill the port page. */
export async function portFill(p, { stillOpen, data, countryAt, refresh, shipMeta }) {
  Object.assign(pt, { key: p.id ?? `${p.name}|${p.lat}`, p, rec: null, fat: null, ship: null }); refresh();
  const [rec, sea, w, list, aps] = await Promise.all([harbourRecord(p).catch(() => null), getFeed('openmeteo', marineUrl(p.lat, p.lon), { ttl: 30 * 60_000 }).catch(() => null), getFeed('openmeteo', wxUrl(p.lat, p.lon), { ttl: 15 * 60_000 }).catch(() => null), cities().catch(() => []), airports().catch(() => [])]);
  if (!stillOpen()) return;
  pt.rec = rec; const r = rec ?? {}; const flags = portFlags(r); const has = !!rec?.yn;
  const now = Date.now(); const off = w?.utc_offset_seconds ?? 0;
  // the line: what kind of harbour, where, the time there and the water it opens on
  const country = countryAt(p.lat, p.lon); const cname = country?.properties?.name ?? p.country; const cc = country?.properties?.['ISO3166-1-Alpha-2'] ?? r.cc; // a small country can fall between the map's borders: use the index's code
  const local = w ? new Date(now + off * 1000) : null;
  const kind = [r.size ? `${r.size}` : null, r.use && r.use !== 'Cargo' ? r.use.toLowerCase() : null, r.harbourType ? r.harbourType.toLowerCase() : null].filter(Boolean).join(' ');
  set('pt-line', `${kind ? `${esc(kind[0].toUpperCase() + kind.slice(1))} harbour` : p.type ? `${esc(title(p.type))} port` : 'Port'} in ${cc ? `<button class="linkish" data-country-cc="${esc(cc)}">${esc(cname)}</button>` : esc(cname ?? '—')}${local ? ` · <b>${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}</b> there now${w.timezone_abbreviation ? ` (${esc(w.timezone_abbreviation)})` : ''}` : ''}${r.water ? ` · on the ${esc(r.water.split(';')[0])}` : ''}${!p.wpi && rec ? ` · harbour record: <i>${esc(rec.name)}</i>` : ''}`);
  // the sea now
  const c = sea?.current ?? {}; const cw = w?.current ?? {};
  const st = seaState(c.wave_height); const bf = beaufort(cw.wind_speed_10m);
  if (c.wave_height != null || cw.wind_speed_10m != null) {
    const vis = cw.visibility != null ? cw.visibility / 1000 : null;
    set('pt-sea', `<div class="cy-wx pt-now"><span class="pt-wave-box">${liveWave(c.wave_height, c.wave_period)}</span>
      <div><b class="cy-temp">${c.wave_height != null ? `${fmt(c.wave_height, 1)} m` : '—'}</b><span>${st ? `${esc(st.word)} sea` : 'waves not modelled here'}${c.wave_period ? `, a wave every ${fmt(c.wave_period)} s` : ''}${c.wave_direction != null ? ` from the ${dirWord(c.wave_direction)}` : ''}</span></div>
      <dl class="cy-wx-dl"><dt>Wind</dt><dd>${cw.wind_speed_10m != null ? `${fmt(cw.wind_speed_10m)} km/h ${short(cw.wind_direction_10m)}` : '—'}</dd>
      <dt>Water</dt><dd>${c.sea_surface_temperature != null ? `${fmt(c.sea_surface_temperature, 1)}°C` : '—'}</dd>
      <dt>Swell</dt><dd>${c.swell_wave_height != null ? `${fmt(c.swell_wave_height, 1)} m` : '—'}</dd>
      <dt>${vis != null && vis < 2 ? 'Fog' : 'Current'}</dt><dd>${vis != null && vis < 2 ? `${fmt(vis, 1)} km` : c.ocean_current_velocity != null ? `${fmt(c.ocean_current_velocity / 1.852, 1)} kn ${c.ocean_current_direction != null ? `→${short(c.ocean_current_direction)}` : ''}` : '—'}</dd></dl>
      <p class="pt-more">${[bf ? `${esc(bf.word)} (force ${bf.force}) from the ${dirWord(cw.wind_direction_10m ?? 0)}${cw.wind_gusts_10m ? `, gusts ${fmt(cw.wind_gusts_10m)} km/h` : ''}` : null, c.swell_wave_period ? `swell every ${fmt(c.swell_wave_period)} s from the ${dirWord(c.swell_wave_direction ?? 0)}` : null, vis != null && vis >= 2 ? `you can see ${fmt(Math.min(vis, 50))} km` : null].filter(Boolean).join(' · ')}</p>
      ${bf && bf.force >= 8 ? `<p class="pt-warn">${esc(bf.word)}: ports often stop pilotage and crane work in winds like this.</p>` : ''}</div>`);
  } else set('pt-sea', '<p class="muted">Open-Meteo did not answer, so there is no sea or weather for now.</p>');
  // the tide
  const times = (sea?.hourly?.time ?? []).map((s) => Date.parse(`${s}Z`)); const lv = sea?.hourly?.sea_level_height_msl ?? [];
  if (lv.filter((v) => v != null).length > 6) {
    const turns = tideTurns(times, lv); const next = turns.filter((x) => x.t > now).slice(0, 2);
    const today = lv.filter((v, i) => v != null && Math.abs(times[i] - now) < 12 * 3600_000); const range = today.length ? Math.max(...today) - Math.min(...today) : null;
    const clock = (t) => { const d = new Date(t + off * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
    const rising = (() => { const k = times.findIndex((t) => t > now); return k > 0 && lv[k] != null && lv[k - 1] != null ? lv[k] > lv[k - 1] : null; })();
    set('pt-tide', `<details class="qd-sec" open><summary><span>The tide</span><small>${rising == null ? '' : rising ? 'rising' : 'falling'}${range != null ? ` · ${fmt(range, 1)} m today` : ''}</small></summary>
      ${tideChart(times, lv, turns, now, off)}
      <p class="cd-key">${next.map((x) => `${x.high ? 'High' : 'Low'} water <b>${clock(x.t)}</b> (${x.v >= 0 ? '+' : ''}${fmt(x.v, 2)} m)`).join(' · ')}${r.tideM ? `${next.length ? '. ' : ''}The World Port Index gives a ${fmt(r.tideM, 1)} m range here` : ''}. Sea level from a global ocean model, local time; not for navigation.</p></details>`);
  } else set('pt-tide', r.tideM ? `<p class="cd-key">Tides here rise and fall about <b>${fmt(r.tideM, 1)} m</b> (World Port Index).</p>` : '');
  // will my ship fit
  const fitEl = document.getElementById('pt-fit');
  const pic = (s) => `<span class="sv-slot" data-sv="${s.cls}|${s.len}|${s.beam}|${s.draught}">${unitSvg(s.glyph, 18)}</span>`;
  const drawFit = () => {
    if (!fitEl) return;
    const verdicts = REF_SHIPS.map((s) => ({ s, v: shipVerdict(r, s) }));
    const sel = REF_SHIPS.find((s) => s.id === pt.ship) ?? [...verdicts].reverse().find((x) => x.v.ok === 'yes')?.s ?? REF_SHIPS[0];
    pt.ship = sel.id;
    const svg = depthSvg(r, sel);
    const limits = [r.maxVesselLengthM ? `${fmt(r.maxVesselLengthM)} m long` : null, r.maxBeamM ? `${fmt(r.maxBeamM, 1)} m wide` : null, r.maxDraftM ? `${fmt(r.maxDraftM, 1)} m deep` : null].filter(Boolean);
    fitEl.innerHTML = `<div id="pt-3d" class="ship-3d"></div>${svg || '<p class="cd-key">The World Port Index publishes no depths for this harbour.</p>'}
      <ul class="pt-ships">${verdicts.map(({ s, v }) => `<li><button class="pt-ship${s.id === sel.id ? ' on' : ''}" data-pt-ship="${s.id}" aria-pressed="${s.id === sel.id}"><span class="pt-g">${pic(s)}</span><span><b>${esc(s.name)}</b><small>${fmt(s.len)} m long, draws ${fmt(s.draught, 1)} m</small></span><span class="ld-chip tone-${VERDICT[v.ok][0]}">${VERDICT[v.ok][1]}</span></button><small class="pt-why">${esc(v.why)}</small></li>`).join('')}</ul>
      <p class="cd-key">${limits.length ? `Largest ship allowed: ${limits.join(', ')}. ` : ''}${r.offshoreMax ? `Offshore moorings take up to ${r.offshoreMax.filter(Boolean).length ? [r.offshoreMax[0] ? `${fmt(r.offshoreMax[0])} m long` : null, r.offshoreMax[2] ? `${fmt(r.offshoreMax[2], 1)} m deep` : null].filter(Boolean).join(', ') : 'larger ships'}. ` : ''}Depths are charted at low water; real ships also keep some water under the keel. Typical loaded ships, not any one vessel.</p>`;
    paintThumbs(fitEl); pt.view?.dispose(); pt.view = mountShipView(document.getElementById('pt-3d'), { length: sel.len, width: sel.beam, draught: sel.draught * 10 }, { cls: sel.cls, seed: sel.len, name: sel.name });
    const fits = verdicts.filter((x) => x.v.ok === 'yes').length;
    sum('pt-fit-sum', svg ? `${fits} of ${REF_SHIPS.length} fit at any tide` : 'no depths published');
  };
  if (fitEl) { fitEl.onclick = (e) => { const b = e.target.closest('[data-pt-ship]'); if (!b) return; pt.ship = b.dataset.ptShip; drawFit(); }; drawFit(); }
  // ships here now
  fillShips(p, r, data, shipMeta);
  // getting in
  if (has || r.shelter || r.entranceWidthM) {
    const inF = PORT_FLAGS.filter(([, , g]) => g === 'in' || g === 'pilot');
    const limitsOn = ['erTide', 'erSwell', 'erIce', 'erOther', 'overheadLimits'].filter((k) => flags[k] === 'Y').length;
    set('pt-in', `<dl class="facts">${[['Shelter', r.shelter], ['Entrance width', r.entranceWidthM ? `${fmt(r.entranceWidthM)} m` : null], ['Under-keel clearance system', r.ukc]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="pt-chips">${inF.filter(([k]) => flags[k] !== 'U').map(([k, l]) => chip(flags[k], l)).join('') || '<p class="cd-key">The index does not say.</p>'}</div>
      <p class="cd-key">✓ yes, ✕ no; what the index does not know is left out.</p>`);
    sum('pt-in-sum', [r.shelter ? `${r.shelter.toLowerCase()} shelter` : null, flags.ptCompulsory === 'Y' ? 'pilot compulsory' : null, limitsOn ? `${limitsOn} entry limit${limitsOn === 1 ? '' : 's'}` : null].filter(Boolean).join(', '));
  } else set('pt-in', '<p class="cd-key">Switch on open data (About → Datasets) for the World Port Index record of this harbour.</p>');
  // what it handles
  if (has) {
    const CARGO = [['loContainer', 'ship', 'Containers'], ['loSolidBulk', 'mine', 'Dry bulk'], ['loLiquidBulk', 'water', 'Liquid bulk'], ['loOilTerm', 'oil', 'Oil'], ['loLongTerm', 'gas', 'Liquefied gas'], ['loRoro', 'car', 'Roll-on/roll-off'], ['loBreakBulk', 'bag', 'Break bulk'], ['loDangCargo', 'alert', 'Dangerous cargo']];
    const tiles = CARGO.map(([k, g, l]) => `<span class="pt-tile ${flags[k] === 'Y' ? 'on' : flags[k] === 'N' ? 'off' : 'unk'}" title="${flags[k] === 'Y' ? 'Yes' : flags[k] === 'N' ? 'No' : 'Not known'}">${unitSvg(g, 22)}<small>${esc(l)}</small></span>`).join('');
    const LIFTS = [['lifts0', 24], ['lifts25', 49], ['lifts50', 100], ['lifts100', 150]]; const top = [...LIFTS].reverse().find(([k]) => flags[k] === 'Y');
    const ladder = `<div class="pt-lift" role="img" aria-label="Heaviest lift: ${top ? (top[0] === 'lifts100' ? '100 tonnes or more' : `up to ${top[1]} tonnes`) : 'not known'}">${LIFTS.map(([k, t], i) => `<span class="${flags[k] === 'Y' ? 'on' : ''}" style="--h:${20 + i * 18}px;--i:${i}"><b>${i === 3 ? '100+' : t}</b></span>`).join('')}<small>tonnes in one lift</small></div>`;
    const group = (g) => PORT_FLAGS.filter(([k, , x]) => x === g && flags[k] === 'Y').map(([, l]) => `<span class="ld-chip pt-yn tone-ok">${esc(l)}</span>`).join('');
    const cranes = group('crane'); const services = group('service'); const supplies = group('supply');
    set('pt-cargo', `<div class="pt-tiles">${tiles}</div>${ladder}
      <dl class="facts">${[['Repairs', r.repairs], ['Dry dock', r.drydock], ['Railway', r.railway]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${cranes ? `<p class="pt-h">Cranes</p><div class="pt-chips">${cranes}</div>` : ''}${services ? `<p class="pt-h">Services</p><div class="pt-chips">${services}</div>` : ''}${supplies ? `<p class="pt-h">Supplies</p><div class="pt-chips">${supplies}</div>` : ''}`);
    const n = CARGO.filter(([k]) => flags[k] === 'Y').length;
    sum('pt-cargo-sum', [n ? `${n} kind${n === 1 ? '' : 's'} of cargo` : null, top ? (top[0] === 'lifts100' ? '100 t+ lifts' : `lifts to ${top[1]} t`) : null].filter(Boolean).join(', ') || 'not recorded');
  } else set('pt-cargo', p.note ? `<p>${esc(p.note)}</p>` : '<p class="cd-key">Not recorded.</p>');
  // getting there
  const city = list.map((x) => [x, haversineKm(p.lat, p.lon, x.lat, x.lng)]).sort((a, b) => a[1] - b[1])[0];
  const ap = aps.map((a) => ({ ...a, km: haversineKm(p.lat, p.lon, a.lat, a.lng) })).filter((a) => a.km < 150).sort((a, b) => (b.large - a.large) || a.km - b.km).slice(0, 3).sort((a, b) => a.km - b.km);
  const others = (data.ports ?? []).filter((q) => q !== p && Math.abs(q.lat - p.lat) < 1).map((q) => [q, haversineKm(p.lat, p.lon, q.lat, q.lon)]).filter(([, d]) => d > 0.5 && d <= NEAR_KM).sort((a, b) => a[1] - b[1]);
  set('pt-near', `${city ? `<p>${city[1] < 10 ? `In <b>${esc(city[0].name)}</b>` : `${fmt(city[1])} km ${dirWord(bearingDeg(city[0].lat, city[0].lng, p.lat, p.lon))} of <b>${esc(city[0].name)}</b>`}${city[0].pop ? `, a city of ${fmt(city[0].pop)}` : ''}.</p>` : ''}
    ${ap.length ? `<ul class="cy-aps">${ap.map((a) => `<li><button class="chip" data-fly="${a.lat},${a.lng},0.25">${esc(a.iata || a.icao)}</button><span><b>${esc(a.name)}</b><small>${fmt(a.km)} km ${esc(dirWord(bearingDeg(p.lat, p.lon, a.lat, a.lng)))}</small></span></li>`).join('')}</ul>` : '<p class="cd-key">No airport with scheduled flights within 150 km.</p>'}
    ${others.length ? `<div class="lm-near"><small>Other harbours within ${NEAR_KM} km</small>${others.slice(0, 8).map(([q, d]) => `<button class="chip" data-fly="${q.lat},${q.lon},0.12">${esc(q.name)} <span>${fmt(d)} km</span></button>`).join('')}</div>` : ''}`);
  sum('pt-near-sum', [ap[0] ? `${ap[0].iata || ap[0].icao}, ${fmt(ap[0].km)} km` : null, others.length ? `${others.length} harbour${others.length === 1 ? '' : 's'} near` : null].filter(Boolean).join(' · '));
  // charts and notices
  const rows = [['Region', r.region ? title(r.region) : null], ['Sailing Directions', r.pub], ['Chart', r.chart], ['Navigational warning area (NAVAREA)', r.navArea], ['UN/LOCODE', r.locode ?? null], ['World Port Index number', r.wpi ?? null], ['Also called', r.alt]].filter(([, v]) => v);
  set('pt-chart', rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<div class="${String(v).length > 22 ? 'wide' : ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="cd-key">${r.navArea ? `Warnings for ships in NAVAREA ${esc(r.navArea)} are broadcast by the World-Wide Navigational Warning Service; <a href="https://msi.nga.mil/NavWarnings" target="_blank" rel="noopener">read the current ones</a>.` : ''}</p>` : '<p class="cd-key">No chart details recorded.</p>');
  sum('pt-chart-sum', r.navArea ? `NAVAREA ${r.navArea}` : r.locode ?? '');
  pt.fat?.obj?.geometry?.dispose?.(); pt.fat = null; refresh();
}

/** The live ships within 20 km: how many, tied up, at anchor or moving, by kind, the biggest and the deepest. */
export function fillShips(p, r, data, shipMeta) {
  const near = shipsNear(p, data.ships, shipMeta);
  if (!near) {
    set('pt-ships', `<button class="crow fact tone-blue" data-cd-layer="ships"><span class="crow-l">Switch on Live ships to see the vessels in port now</span><b>·</b><span class="crow-u">${unitSvg('ship', 18)}</span><small>show them</small></button>`);
    sum('pt-ships-sum', 'Live ships off'); return;
  }
  const by = (k) => near.filter((x) => x.state === k).length;
  const kinds = Object.entries(near.reduce((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const units = near.slice(0, 60).map((x, i) => `<i class="pt-u st-${x.state}" style="--i:${i}" title="${esc(x.name)}">${unitSvg(KIND_GLYPH[x.kind] ?? 'ship', 16)}</i>`).join('');
  const deepest = near.filter((x) => x.draughtM).sort((a, b) => b.draughtM - a.draughtM)[0];
  const biggest = near.filter((x) => x.len).sort((a, b) => b.len - a.len).slice(0, 5);
  const ch = r.channelDepthM;
  const bigPic = (x) => { const m = shipMeta(x.s); const c = shipClass(m); const d = shipDims(c.id, m); return `<span class="sv-slot" title="${esc(c.label)}" data-sv="${c.id}|${d.L}|${d.B}|${d.T}"></span>`; };
  set('pt-ships', near.length ? `<div class="pt-units" role="img" aria-label="${near.length} ships">${units}${near.length > 60 ? `<small>+${near.length - 60}</small>` : ''}</div>
    <p class="pt-states"><span class="st-moored">■ ${by('moored')} moored</span><span class="st-anchored">■ ${by('anchored')} at anchor</span><span class="st-moving">■ ${by('moving')} moving</span>${by('still') ? `<span class="st-still">■ ${by('still')} stopped</span>` : ''}</p>
    <p class="cd-key">${kinds.map(([k, n]) => `${n} ${esc(n === 1 ? KIND_ONE[k] ?? k : KIND_LABEL[k] ?? k)}`).join(', ')}.${deepest ? ` Deepest: <b>${esc(deepest.name)}</b>, drawing ${fmt(deepest.draughtM, 1)} m${ch ? ` against a ${fmt(ch, 1)} m channel (${deepest.draughtM <= ch ? `${fmt(ch - deepest.draughtM, 1)} m to spare` : 'it needs the tide'})` : ''}.` : ''}</p>
    ${biggest.length ? `<ul class="pt-big">${biggest.map((x) => `<li>${bigPic(x)}<button class="chip" data-mmsi="${x.s.mmsi}">${unitSvg(KIND_GLYPH[x.kind] ?? 'ship', 16)}${esc(x.name)}</button><small>${fmt(x.len)} m · ${esc(x.state === 'still' ? 'stopped' : x.state === 'anchored' ? 'at anchor' : x.state)} · ${fmt(x.km, 1)} km</small></li>`).join('')}</ul>` : ''}`
    : `<p class="cd-key">No ship heard within ${SHIP_RADIUS_KM} km in the last half hour. Receivers do not cover every coast.</p>`);
  paintThumbs(document.getElementById('pt-ships'));
  sum('pt-ships-sum', `${near.length} within ${SHIP_RADIUS_KM} km`);
}

/** On the globe: the 20 km circle ships are counted in and the 100 km circle, in one draw call. */
export function portOverlay(ctx, sel) {
  if (!pt.p || sel?.d !== pt.p) return { custom: [] };
  pt.fat ??= ctx.fatLines([
    { pts: smallCircle(pt.p.lat, pt.p.lon, SHIP_RADIUS_KM / KM_PER_DEG, 120), color: '#5cc8ff', width: 1.8, alt: 0.004 },
    { pts: smallCircle(pt.p.lat, pt.p.lon, NEAR_KM / KM_PER_DEG, 120), color: '#f2c66d', width: 1.1, alt: 0.004 },
  ], { opacity: 0.9 });
  return { custom: [pt.fat] };
}
export function portClose() { pt.fat?.obj?.geometry?.dispose?.(); pt.view?.dispose(); Object.assign(pt, { key: null, p: null, rec: null, fat: null, ship: null, view: null }); }
