// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: chokepoints, pipelines, trade routes and AI data centres in depth (v2.26).
// Each of the four becomes a page of its own, worked out from the atlas's own data, so it opens offline too:
//   chokepoint   how narrow it is, the live ships passing now and which way they are heading, the trade routes that
//                rely on it, the pipelines that let oil or gas avoid it, and what happens if it closes;
//   pipeline     its length against journeys you know, its capacity as a flow you can picture (an Olympic pool every
//                so many seconds, a share of the world's oil or gas), how long the oil or gas takes end to end, the
//                countries its line crosses, the chokepoint it lets cargo avoid and the pipelines it meets;
//   trade route  each stop as a timeline with the distance and days at sea from the start, the chokepoints it relies
//                on and what closing each would do, its volume as boxes or barrels per minute, and the live ships at
//                each stop now;
//   data centre  the electricity its chips draw, as homes and reactors, the big power stations near it, other sites
//                of the same owners and its neighbours.
// On the globe each page draws its own marks (the counting circle, the line with flow, rings at the stops).
// Numbers that are estimates say so on the page; docs/ASSUMPTIONS.md (v2.26) lists every figure and its source.
import { unitSvg } from './icons.js';
import { haversineKm } from './astro.js';
import { shipKind } from './shipdb.js';
import { lengthWords } from './cabledetail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const sig = (n) => fmt(n, n < 10 ? 1 : 0);
const KM_PER_NMI = 1.852;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- chokepoints
// One record per waterway, whichever list it comes from (the EIA's eight with open data on, World Monitor's thirteen
// otherwise). width: narrowest navigable width in km (Not verified: public figures, see ASSUMPTIONS.md); axis: the
// compass bearing of one way through, with what each way leads to; r: the radius in km the live ships are counted in.
export const CHOKES = {
  hormuz: { width: 33.8, widthWords: 'at its narrowest, with two lanes about 3 km wide each way', joins: 'the Persian Gulf and the Gulf of Oman', axis: 300, ways: ['into the Persian Gulf', 'out to the Gulf of Oman'], r: 80, alt: null, altWords: 'There is no other way out of the Gulf by sea. Only the pipelines below can carry some of its oil round it.' },
  malacca: { width: 2.7, widthWords: 'at the Phillips Channel off Singapore, its narrowest point', joins: 'the Indian Ocean and the South China Sea', axis: 315, ways: ['towards the Indian Ocean', 'towards Singapore and the Pacific'], r: 150, alt: 'lombok', altWords: 'Ships could go round through the Lombok or Sunda Strait in Indonesia, a longer passage, and the largest tankers already take Lombok because Malacca is too shallow for them.' },
  suez: { width: 0.2, widthWords: 'a canal about 200 m wide and 193 km long, with no locks', joins: 'the Mediterranean and the Red Sea', axis: 0, ways: ['north to the Mediterranean', 'south to the Red Sea'], r: 110, alt: 'good_hope', extraKm: 6000, altWords: 'Ships between Asia and Europe go round Africa by the Cape of Good Hope instead: roughly 6,000 km and 10 to 14 days more.' },
  bab_el_mandeb: { width: 29, widthWords: 'at its narrowest, between Yemen and Djibouti', joins: 'the Red Sea and the Gulf of Aden', axis: 330, ways: ['into the Red Sea', 'out to the Gulf of Aden'], r: 60, alt: 'good_hope', extraKm: 6000, altWords: 'Ships bound for the Suez Canal go round Africa by the Cape of Good Hope instead: roughly 6,000 km and 10 to 14 days more.' },
  turkish_straits: { width: 0.7, widthWords: 'the Bosporus at its narrowest, through the middle of Istanbul', joins: 'the Black Sea and the Mediterranean', axis: 30, ways: ['north to the Black Sea', 'south to the Sea of Marmara'], r: 45, alt: null, altWords: 'There is no other way out of the Black Sea by sea. The Baku–Tbilisi–Ceyhan pipeline was built partly so that Caspian oil would not need it.' },
  danish_straits: { width: 4, widthWords: 'the Øresund at Helsingør, the narrowest of the three passages', joins: 'the Baltic Sea and the North Sea', axis: 180, ways: ['south into the Baltic', 'north to the Kattegat'], r: 70, alt: null, altWords: 'Smaller ships can use the Kiel Canal across Germany instead; the largest ones have no other way into the Baltic.' },
  panama: { width: 0.055, widthWords: 'the new locks are 55 m wide, setting the largest ship that fits (Neopanamax)', joins: 'the Atlantic and the Pacific', axis: 315, ways: ['to the Atlantic side (Colón)', 'to the Pacific side (Balboa)'], r: 50, alt: null, extraKm: 12600, altWords: 'Without it, a ship from New York to San Francisco sails round South America: roughly 12,600 km and two to three weeks more.' },
  good_hope: { width: null, widthWords: 'open ocean, but every ship rounding Africa passes here', joins: 'the Atlantic and the Indian Ocean', axis: 90, ways: ['east to the Indian Ocean', 'west to the Atlantic'], r: 150, alt: null, altWords: 'It is itself the way round when the Red Sea or the Suez Canal is closed, so its traffic rises when theirs falls.' },
  gibraltar: { width: 14, widthWords: 'at its narrowest, between Spain and Morocco', joins: 'the Atlantic and the Mediterranean', axis: 90, ways: ['into the Mediterranean', 'out to the Atlantic'], r: 50, alt: null, altWords: 'The only other way in or out of the Mediterranean is the Suez Canal at the far end.' },
  dover_strait: { width: 33, widthWords: 'between Dover and Cap Gris-Nez', joins: 'the English Channel and the North Sea', axis: 45, ways: ['north-east to the North Sea', 'south-west to the Channel'], r: 50, alt: null, altWords: 'Ships could go round the north of Scotland instead, a much longer passage.' },
  taiwan_strait: { width: 130, widthWords: 'at its narrowest, between Taiwan and mainland China', joins: 'the South China Sea and the East China Sea', axis: 30, ways: ['north to the East China Sea', 'south to the South China Sea'], r: 120, alt: null, altWords: 'Ships can pass east of Taiwan in the open Pacific instead, a little longer and rougher.' },
  korea_strait: { width: 50, widthWords: 'the western channel between Busan and Tsushima', joins: 'the East China Sea and the Sea of Japan', axis: 45, ways: ['north-east to the Sea of Japan', 'south-west to the East China Sea'], r: 90, alt: null, altWords: 'Ships for the Sea of Japan could come in from the north, through the Tsugaru or La Pérouse Strait, a much longer way.' },
  kerch_strait: { width: 4, widthWords: 'roughly, at its narrowest', joins: 'the Black Sea and the Sea of Azov', axis: 0, ways: ['north into the Sea of Azov', 'south to the Black Sea'], r: 40, alt: null, altWords: 'It is the only way in or out of the Sea of Azov.' },
  lombok: { width: 20, widthWords: 'roughly, between Bali and Lombok', joins: 'the Indian Ocean and the Java Sea', axis: 0, ways: ['north to the Java Sea and Makassar Strait', 'south to the Indian Ocean'], r: 60, alt: null, altWords: 'It is itself the deep-water way round the Strait of Malacca, used by tankers too deep for Malacca.' },
};
const CHOKE_ALIAS = { hormuz_strait: 'hormuz', malacca_strait: 'malacca', bosphorus: 'turkish_straits', cape_of_good_hope: 'good_hope', lombok_strait: 'lombok' };
/** The record for a waterway from either list (by id, else by name). */
export function chokeKey(w) {
  const id = String(w?.id ?? '').toLowerCase(); if (CHOKES[id]) return id; if (CHOKE_ALIAS[id]) return CHOKE_ALIAS[id];
  const n = String(w?.name ?? w ?? '').toLowerCase();
  const by = [['hormuz', 'hormuz'], ['malacca', 'malacca'], ['suez', 'suez'], ['mandeb', 'bab_el_mandeb'], ['bospor', 'turkish_straits'], ['turkish', 'turkish_straits'], ['danish', 'danish_straits'], ['panama', 'panama'], ['good hope', 'good_hope'], ['gibraltar', 'gibraltar'], ['dover', 'dover_strait'], ['taiwan', 'taiwan_strait'], ['korea', 'korea_strait'], ['kerch', 'kerch_strait'], ['lombok', 'lombok']];
  return by.find(([k]) => n.includes(k))?.[1] ?? null;
}
// Pipelines built (at least partly) so that oil or gas need not pass a chokepoint. Judgement, from each line's own history.
export const BYPASS = [
  [/SUMED/i, 'suez'], [/Trans-Israel|Eilat/i, 'suez'], [/East-West Pipeline|Petroline|Abqaiq-Yanbu/i, 'hormuz'], [/Habshan-Fujairah|ADCOP/i, 'hormuz'],
  [/Baku-Tbilisi-Ceyhan|BTC/i, 'turkish_straits'], [/China-Myanmar/i, 'malacca'], [/Kirkuk-Ceyhan/i, 'hormuz'],
];
export const bypassOf = (p) => BYPASS.find(([re]) => re.test(p?.name ?? ''))?.[1] ?? null;

/** Smallest difference between two bearings, in degrees (0–180). */
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
/** The live ships within the chokepoint's circle: moving ones split by which way they head, plus those stopped. */
export function shipsThrough(w, ships, metaOf = (s) => s.meta ?? {}) {
  if (!ships) return null;
  const c = CHOKES[chokeKey(w)] ?? { r: 60, axis: 0, ways: ['one way', 'the other way'] };
  const lat = w.lat; const lon = w.lon ?? w.lng; const dLat = c.r / 111 + 0.05; const out = { r: c.r, ways: [[], []], across: [], still: [], kinds: {} };
  for (const s of ships) {
    if (s.lat == null || Math.abs(s.lat - lat) > dLat) continue;
    const d = haversineKm(lat, lon, s.lat, s.lng); if (d > c.r) continue;
    const m = metaOf(s) ?? {}; const kind = shipKind(m.shipType ?? s.meta?.shipType) ?? 'other';
    const row = { s, km: d, kind, name: m.name ?? s.meta?.name ?? `MMSI ${s.mmsi}` };
    out.kinds[kind] = (out.kinds[kind] ?? 0) + 1;
    const moving = (s.sog ?? 0) > 1 && s.nav !== 1 && s.nav !== 5 && s.cog != null;
    if (!moving) { out.still.push(row); continue; }
    if (angDiff(s.cog, c.axis) <= 60) out.ways[0].push(row); else if (angDiff(s.cog, c.axis + 180) <= 60) out.ways[1].push(row); else out.across.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- lines (pipelines and routes)
/** [[lat, lng]…] from World Monitor's [[lng, lat]…]. */
export const latLng = (pts) => (pts ?? []).map(([lng, lat]) => [lat, lng]);
/** Length of a line of [lat, lng] points in km, along great circles between them. */
export const lineKm = (pts) => pts.reduce((a, p, i) => (i ? a + haversineKm(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0), 0);
/** Points every `stepKm` along a line of [lat, lng] (straight in latitude and longitude within each segment). */
export function sampleLine(pts, stepKm = 25) {
  const out = []; for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]; const n = Math.max(1, Math.ceil(haversineKm(a[0], a[1], b[0], b[1]) / stepKm));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out.length ? out : pts.slice();
}
/** Distance in km from a point to a line of [lat, lng] (flat within each segment: fine for these distances). */
export function distToLine(lat, lng, pts) {
  if (pts.length === 1) return haversineKm(lat, lng, pts[0][0], pts[0][1]);
  let best = Infinity; const k = Math.cos(lat * D2R);
  for (let i = 1; i < pts.length; i++) {
    const [aLat, aLng] = pts[i - 1]; const [bLat, bLng] = pts[i]; if (Math.abs(aLng - bLng) > 180) continue;
    const ax = aLng * k; const bx = bLng * k; const px = lng * k; const dx = bx - ax; const dy = bLat - aLat;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (lat - aLat) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), lat - (aLat + t * dy)) * 111.195);
  }
  return best;
}
const numKm = (s) => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

// ---------------------------------------------------------------- capacity and volume
// Unit factors (exact or standard): a barrel is 0.158987 m³; a cubic foot 0.0283168 m³; an Olympic pool holds at least
// 2,500 m³ (50 × 25 × 2 m). Approximations: about 7.33 barrels in a tonne of crude oil; about 10.5 TWh of energy in a
// billion cubic metres of natural gas; world demand about 102 million barrels of oil a day and 4,000 bcm of gas a year.
export const BBL_M3 = 0.158987; const CF_M3 = 0.0283168; export const POOL_M3 = 2500;
export const BBL_PER_T = 7.33; export const TWH_PER_BCM = 10.5; export const WORLD_OIL_BPD = 102e6; export const WORLD_GAS_BCM = 4000;
/** "1.2 million bpd" → { oil, bpd }, "33 mcm/day" or "3.2 bcf/day" or "55 bcm/year" → { gas, bcmY }, else null. */
export function parseCapacity(s) {
  const t = String(s ?? '').toLowerCase().replace(/,/g, ''); const m = t.match(/([\d.]+)\s*(million|m\b|k\b)?\+?\s*(bpd|bcm\/year|mcm\/day|bcf\/day)/);
  if (!m) return null; let n = Number(m[1]); if (m[2] === 'million' || m[2] === 'm') n *= 1e6; if (m[2] === 'k') n *= 1e3;
  if (m[3] === 'bpd') return { kind: 'oil', bpd: n, plus: t.includes('+') };
  const bcmY = m[3] === 'bcm/year' ? n : m[3] === 'mcm/day' ? (n * 365) / 1000 : (n * 1e9 * CF_M3 * 365) / 1e9;
  return { kind: 'gas', bcmY, plus: t.includes('+') };
}
/** Volume per second in m³ for a parsed capacity (gas at standard conditions). */
export const m3PerS = (c) => (c?.kind === 'oil' ? (c.bpd * BBL_M3) / 86400 : c ? (c.bcmY * 1e9) / (365 * 86400) : 0);
/** A trade route's volume ("47M+ TEU/year", "6.5M+ bpd", "77M+ tonnes/year", "14K+ transits/year") as { n, unit, perYear }. */
export function parseVolume(s) {
  const t = String(s ?? ''); const m = t.match(/([\d.]+)\s*([MK])?\+?\s*(TEU|bpd|tonnes|transits)/i); if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1); const unit = m[3].toLowerCase();
  return { n, unit, perYear: unit === 'bpd' ? n * 365 : n };
}
// Speed at sea by kind of route (Approximation): container ships slow-steam at about 16 knots, tankers and bulk carriers
// at about 13 and 12.5.
export const KNOTS = { container: 16, energy: 13, bulk: 12.5 };
export const daysAt = (km, kn) => km / (kn * KM_PER_NMI * 24);

// ---------------------------------------------------------------- data centres
// IT power per accelerator in kW, with its share of the server, network and storage around it (Approximation, from
// vendors' system figures: DGX A100 6.5 kW for 8, DGX H100 10.2 kW for 8, DGX B200 14.3 kW for 8, a GB200 NVL72 rack
// about 120–132 kW for 72). Older or less-known chips get rougher figures; unknown chips are taken as H100-class.
export const KW_PER_CHIP = [
  [/GB300/i, 1.95], [/GB200/i, 1.8], [/B200/i, 1.8], [/H200|H100|GH200/i, 1.3], [/A100/i, 0.8], [/V100/i, 0.45], [/P100|K80|K40|K20/i, 0.4],
  [/MI300X/i, 1.3], [/MI300A/i, 0.9], [/MI250|MI210/i, 0.7], [/TPU v4/i, 0.35], [/TPU v3/i, 0.5], [/TPU v[12]/i, 0.3],
  [/Trainium2/i, 0.8], [/Trainium/i, 0.4], [/Gaudi/i, 0.8], [/Max 1550/i, 0.8], [/Maia/i, 0.9], [/Groq/i, 0.4], [/Dojo/i, 0.5], [/PEZY/i, 0.2],
];
export const kwPerChip = (type) => KW_PER_CHIP.find(([re]) => re.test(type ?? ''))?.[1] ?? 1.3;
// Power usage effectiveness (PUE): total site power over IT power. New AI sites aim at about 1.2; the industry average
// is about 1.56 (Uptime Institute). The page shows the range.
export const PUE = [1.2, 1.56];
export const HOME_KWH = 10791; // a US home's electricity in a year, 2022 (EIA)
/** Site power in MW as [low, high] for a cluster, or null when its chip count is unknown. */
export function sitePowerMW(d) {
  if (!(d?.chipCount > 0)) return null; const it = (d.chipCount * kwPerChip(d.chipType)) / 1000;
  return PUE.map((p) => it * p);
}
export const homesFor = (mw) => (mw * 1000 * 8760) / HOME_KWH;
/** The owners of a cluster as a list ("OpenAI,Microsoft" → ['OpenAI', 'Microsoft']). */
export const ownersOf = (d) => String(d?.owner ?? '').split(/[,/&]+/).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- the open page (shared with the globe)
export const ix = { kind: null, d: null, fat: null, paths: null };
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const sum = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const sec = (id, title, open = true) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small id="${id}-sum"></small></summary><div id="${id}"></div></details>`;
const head = (glyph, big, line, tone = 'blue') => `<div class="ev-head tone-${tone}"><span class="ev-g">${unitSvg(glyph, 34)}</span><div><b class="ev-big">${big}</b><span>${line}</span></div></div>`;
const openBtn = (layer, d, label, extra = '') => `<button class="chip" data-ix-layer="${layer}" data-ix-id="${esc(d.id ?? d.name)}">${label}${extra ? ` <span>${extra}</span>` : ''}</button>`;
const shipsOff = (what) => `<button class="crow fact tone-blue" data-cd-layer="ships"><span class="crow-l">Switch on Live ships to see ${what}</span><b>·</b><span class="crow-u">${unitSvg('anchor', 18)}</span><small>show them</small></button>`;
const titleCase = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s-(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/(?!^)\b(Of|The|El|De)\b/g, (w) => w.toLowerCase());
/** A width against straits people know. */
export function widthWords(km) {
  const near = (r) => r > 0.8 && r < 1.25;
  if (km >= 100) return `${fmt(km / 344, 1)} times London to Paris`;
  if (near(km / 33.3)) return 'about as wide as the Strait of Dover';
  if (km > 33.3) return `${fmt(km / 33.3, 1)} times the width of the Strait of Dover`;
  if (km >= 1) return `${fmt(33.3 / km, 0)} times narrower than the Strait of Dover`;
  return `${fmt(km * 1000)} m: a few minutes' walk across`;
}
const KIND_WORD = { cargo: 'cargo', tanker: 'tankers', passenger: 'passenger', fishing: 'fishing', tug: 'tugs', leisure: 'leisure', other: 'other' };
const kindChips = (kinds) => Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="ld-chip tone-unk">${fmt(n)} ${KIND_WORD[k] ?? k}</span>`).join('');
const shipList = (rows, n = 6) => rows.slice(0, n).map((x) => `<button class="chip" data-mmsi="${x.s.mmsi}">${unitSvg(x.kind === 'tanker' ? 'tanker' : 'ship', 16)}${esc(x.name)}</button>`).join('');

// Chokepoints -----------------------------------------------------------------------------------------------------
export function chokeHtml() {
  return `<div class="ix" data-ix="choke"><div id="ix-head"></div>${sec('ix-ships', 'Ships passing now')}${sec('ix-routes', 'Trade routes that rely on it')}${sec('ix-pipes', 'Pipelines that avoid it')}${sec('ix-alt', 'If it closed')}</div>`;
}
/** Fill a chokepoint page. data: the app's layer data; wm: World Monitor's static lists (routes and pipelines are read from there when their layers are off). */
export function chokeFill(w, { data, wm, metaOf, refresh }) {
  Object.assign(ix, { kind: 'choke', d: w, fat: null, paths: null });
  const key = chokeKey(w); const c = CHOKES[key] ?? {}; const name = titleCase(w.name);
  const width = c.width == null ? null : c.width < 1 ? `${fmt(c.width * 1000)} m` : `${sig(c.width)} km`;
  set('ix-head', head('strait', width ?? 'Open sea', esc(c.widthWords ?? 'a narrow passage that much shipping must use')) + `<p class="cd-key">${esc(name)} joins <b>${esc(c.joins ?? 'two seas')}</b>.${c.width && c.width >= 1 ? ` That is ${widthWords(c.width)}.` : ''}</p>`);
  // ships passing now
  const t = shipsThrough(w, data.ships, metaOf);
  if (!t) { set('ix-ships', shipsOff(`the ships passing ${esc(name)}`)); sum('ix-ships-sum', 'Live ships off'); }
  else {
    const moving = t.ways[0].length + t.ways[1].length + t.across.length; const all = moving + t.still.length;
    set('ix-ships', all ? `<div class="ix-ways">${(c.ways ?? ['one way', 'the other way']).map((wd, i) => `<div class="ix-way"><span class="ix-arrow" style="--b:${((c.axis ?? 0) + i * 180) % 360}deg">${unitSvg('ship', 18)}</span><b>${fmt(t.ways[i].length)}</b><small>heading ${esc(wd)}</small></div>`).join('')}</div>
      <div class="pt-chips">${kindChips(t.kinds)}</div>
      <div class="lm-near">${shipList([...t.ways[0], ...t.ways[1]].sort((a, b) => a.km - b.km))}</div>
      <p class="cd-key">Within ${fmt(t.r)} km of its middle: ${fmt(moving)} moving${t.across.length ? ` (${fmt(t.across.length)} crossing or turning)` : ''} and ${fmt(t.still.length)} stopped or at anchor. Which way a ship heads is read from its own reported course; only ships the Live ships layer hears are counted.</p>`
      : `<p class="cd-key">No ship heard within ${fmt(t.r)} km just now. Live ships covers the whole world only with a key or the desktop app; otherwise it is the Baltic.</p>`);
    sum('ix-ships-sum', all ? `${fmt(moving)} moving, ${fmt(t.still.length)} stopped` : 'none heard');
  }
  // trade routes through it
  const routes = (data.routes ?? wm?.tradeRoutes ?? []).filter((r) => r.stops.some(([a, b, n]) => chokeKey(n) === key || haversineKm(a, b, w.lat, w.lon) < 150));
  set('ix-routes', routes.length ? `<div class="lm-near">${routes.map((r) => openBtn('routes', r, esc(r.name), esc(r.volumeDesc ?? ''))).join('')}</div><p class="cd-key">${routes.length} of the ${(data.routes ?? wm?.tradeRoutes ?? []).length} main routes on the map pass here.</p>` : '<p class="cd-key">None of the main routes on the map pass here.</p>');
  sum('ix-routes-sum', routes.length ? `${routes.length} route${routes.length === 1 ? '' : 's'}` : 'none');
  // pipelines that avoid it
  const pipes = (data.pipelines ?? wm?.pipelines ?? []).filter((p) => bypassOf(p) === key);
  const oil = pipes.map((p) => parseCapacity(p.capacity)).filter((x) => x?.kind === 'oil').reduce((s, x) => s + x.bpd, 0);
  set('ix-pipes', pipes.length ? `<div class="lm-near">${pipes.map((p) => openBtn('pipelines', p, esc(p.name), esc(p.capacity ?? ''))).join('')}</div>${oil ? `<p class="cd-key">Together up to <b>${sig(oil / 1e6)} million barrels a day</b> of oil can go round ${esc(name)} by pipe, if the lines have room to spare.</p>` : ''}` : `<p class="cd-key">No pipeline on the map was built to avoid ${esc(name)}.</p>`);
  sum('ix-pipes-sum', pipes.length ? `${pipes.length} pipeline${pipes.length === 1 ? '' : 's'}` : 'none');
  // if it closed
  const alt = c.alt ? (data.waterways ?? wm?.waterways ?? []).find((x) => chokeKey(x) === c.alt) : null;
  set('ix-alt', `<p class="cd-key">${esc(c.altWords ?? 'Ships would have to find a longer way round.')}</p>${c.extraKm ? `<p class="cd-key">At 14 knots, ${fmt(c.extraKm)} km more is about <b>${fmt(daysAt(c.extraKm, 14), 0)} days</b> at sea.</p>` : ''}${alt ? `<div class="lm-near"><small>The way round:</small>${openBtn('waterways', alt, esc(titleCase(alt.name)))}</div>` : ''}`);
  sum('ix-alt-sum', c.extraKm ? `+${fmt(c.extraKm)} km` : '');
  refresh?.();
}

// Pipelines -------------------------------------------------------------------------------------------------------
export function pipeHtml() {
  return `<div class="ix" data-ix="pipe"><div id="ix-head"></div>${sec('ix-flow', 'What it carries')}${sec('ix-cross', 'Countries on its line')}${sec('ix-avoid', 'Chokepoints it avoids or passes')}${sec('ix-meets', 'Pipelines it meets', false)}</div>`;
}
export function pipeFill(p, { data, wm, countryAt, refresh }) {
  Object.assign(ix, { kind: 'pipe', d: p, fat: null, paths: null });
  const pts = latLng(p.points); const drawn = lineKm(pts); const given = numKm(p.length); const km = given ?? drawn;
  set('ix-head', head(p.type === 'gas' ? 'gas' : 'oil', `${fmt(km)} km`, `${given ? '' : 'about, along the drawn line: '}${esc(lengthWords(km))}`, p.type === 'gas' ? 'blue' : 'ochre')
    + `<p class="cd-key">${esc(p.type === 'gas' ? 'A gas' : 'An oil')} pipeline run by <b>${esc(p.operator ?? 'an unknown operator')}</b>${given && Math.abs(drawn - given) / given > 0.25 ? `. The line on the map is simplified, ${fmt(drawn)} km against its real ${fmt(given)} km` : ''}.</p>`);
  // what it carries
  const cap = parseCapacity(p.capacity); const q = m3PerS(cap);
  if (cap) {
    const pool = POOL_M3 / q; const share = cap.kind === 'oil' ? cap.bpd / WORLD_OIL_BPD : cap.bcmY / WORLD_GAS_BCM;
    const speed = cap.kind === 'oil' ? [1, 2] : [5, 10]; const days = speed.map((v) => (km * 1000) / v / 86400);
    set('ix-flow', `<div class="pt-chips">${cap.kind === 'oil' ? `<span class="ld-chip tone-unk">about ${sig(cap.bpd * 365 / BBL_PER_T / 1e6)} million tonnes a year</span>` : `<span class="ld-chip tone-unk">about ${fmt(cap.bcmY * TWH_PER_BCM)} TWh of energy a year</span>`}</div>
      <div class="ix-pool"><span class="ix-fill" style="--s:${Math.max(1.2, Math.min(12, pool)).toFixed(2)}s"></span></div>
      <p class="cd-key">Full, it moves <b>${sig(q)} m³ every second</b>${cap.kind === 'gas' ? ' (measured at normal pressure)' : ''}: enough to fill an Olympic pool every <b>${pool < 120 ? `${sig(pool)} seconds` : `${sig(pool / 60)} minutes`}</b>. That is about ${share < 0.001 ? 'a tenth of a per cent' : `${fmt(share * 100, share < 0.1 ? 1 : 0)} %`} of the world's ${cap.kind === 'oil' ? 'oil use' : 'gas use'}.</p>
      <p class="cd-key">${cap.kind === 'oil' ? 'Oil' : 'Gas'} travels at about ${speed[0]}–${speed[1]} m/s in a line like this, so it takes roughly <b>${days[1] < 1 ? `${fmt(days[1] * 24)}–${fmt(days[0] * 24)} hours` : `${sig(days[1])}–${sig(days[0])} days`}</b> to go from one end to the other. Rough figures: real flow depends on the pressure and how full the line runs.</p>`);
    sum('ix-flow-sum', p.capacity);
  } else { set('ix-flow', '<p class="cd-key">Its capacity is not given.</p>'); sum('ix-flow-sum', ''); }
  // countries on its line
  const seen = []; for (const [a, b] of sampleLine(pts, 20)) { const f = countryAt?.(a, b); const n = f?.properties?.name ?? f?.properties?.ADMIN; const cc = f?.properties?.['ISO3166-1-Alpha-2']; if (n && seen.at(-1)?.n !== n && !seen.some((x) => x.n === n)) seen.push({ n, cc }); }
  set('ix-cross', seen.length ? `<ol class="ix-steps">${seen.map((x, i) => `<li style="--i:${i}">${x.cc && x.cc !== '-99' ? `<button class="linkish" data-country-cc="${esc(x.cc)}">${esc(x.n)}</button>` : esc(x.n)}</li>`).join('')}</ol><p class="cd-key">In order along the drawn line${p.countries?.length ? `; its record lists ${esc(p.countries.join(', '))}` : ''}. Undersea stretches cross no country.</p>`
    : `<p class="cd-key">${p.countries?.length ? `Its record lists ${esc(p.countries.join(', '))}. ` : ''}The line runs under the sea.</p>`);
  sum('ix-cross-sum', seen.length ? `${seen.length} ${seen.length === 1 ? 'country' : 'countries'}` : '');
  // chokepoints it avoids or passes
  const ways = data.waterways ?? wm?.waterways ?? []; const avoid = bypassOf(p); const av = avoid ? ways.find((x) => chokeKey(x) === avoid) : null;
  const near = ways.filter((x) => x !== av && distToLine(x.lat, x.lon, pts) < 250);
  set('ix-avoid', `${av ? `<p class="cd-key">Built so that ${p.type === 'gas' ? 'gas' : 'oil'} need not pass <b>${esc(titleCase(av.name))}</b>.</p><div class="lm-near">${openBtn('waterways', av, esc(titleCase(av.name)))}</div>` : ''}${near.length ? `<div class="lm-near"><small>Runs near:</small>${near.map((x) => openBtn('waterways', x, esc(titleCase(x.name)))).join('')}</div>` : ''}${!av && !near.length ? '<p class="cd-key">No chokepoint on or near its line.</p>' : ''}`);
  sum('ix-avoid-sum', av ? `avoids ${titleCase(av.name)}` : near.length ? `${near.length} nearby` : 'none');
  // pipelines it meets: another line with a point within 30 km of this one
  const all = data.pipelines ?? wm?.pipelines ?? []; const meets = all.filter((o) => o !== p && o.id !== p.id && latLng(o.points).some(([a, b]) => distToLine(a, b, pts) < 30));
  set('ix-meets', meets.length ? `<div class="lm-near">${meets.map((o) => openBtn('pipelines', o, esc(o.name), o.type)).join('')}</div>` : '<p class="cd-key">It meets no other line on the map.</p>');
  sum('ix-meets-sum', meets.length ? `${meets.length}` : 'none');
  refresh?.();
}

// Trade routes ----------------------------------------------------------------------------------------------------
export function routeHtml() {
  return `<div class="ix" data-ix="route"><div id="ix-head"></div>${sec('ix-stops', 'Stop by stop')}${sec('ix-chokes', 'Chokepoints it relies on')}${sec('ix-ships', 'Ships at its stops now')}</div>`;
}
export function routeFill(r, { data, wm, metaOf, refresh }) {
  Object.assign(ix, { kind: 'route', d: r, fat: null, paths: null });
  const kn = KNOTS[r.category] ?? 14; const legs = r.stops.map((s, i) => (i ? haversineKm(r.stops[i - 1][0], r.stops[i - 1][1], s[0], s[1]) : 0));
  const km = legs.reduce((a, b) => a + b, 0); const vol = parseVolume(r.volumeDesc);
  const per = vol ? vol.perYear / (365 * 24 * 60) : 0;
  const volWords = !vol ? '' : vol.unit === 'teu' ? `about ${fmt(per)} twenty-foot containers a minute, day and night` : vol.unit === 'bpd' ? `about ${fmt(vol.n * BBL_M3 / 1440)} m³ of oil a minute` : vol.unit === 'tonnes' ? `about ${fmt(per)} tonnes a minute` : `about ${fmt(vol.perYear / 365)} a day`;
  set('ix-head', head(r.category === 'energy' ? 'tanker' : 'ship', `${fmt(km)} km`, `at least, as straight hops between its waypoints: about ${fmt(daysAt(km, kn), 0)} days at ${kn} knots`, 'ochre')
    + `<p class="cd-key">${esc(r.volumeDesc ?? '')}${volWords ? `: ${volWords}` : ''}. ${r.status === 'active' ? '' : `Status: ${esc(r.status)}. `}Real ships keep to sea lanes round the land, so the true distance is longer.</p>`);
  const ways = data.waterways ?? wm?.waterways ?? []; let acc = 0;
  const chokeOf = (s) => ways.find((x) => chokeKey(x) && chokeKey(x) === chokeKey(s[2])) ?? ways.find((x) => haversineKm(x.lat, x.lon, s[0], s[1]) < 120);
  set('ix-stops', `<ol class="ix-steps ix-line">${r.stops.map((s, i) => { acc += legs[i]; const ch = i && i < r.stops.length - 1 ? chokeOf(s) : null;
    return `<li style="--i:${i}">${ch ? openBtn('waterways', ch, esc(s[2])) : `<button class="linkish" data-zoomto="${(+s[0]).toFixed(4)},${(+s[1]).toFixed(4)},area">${esc(s[2])}</button>`}<small>${i ? `${fmt(acc)} km · day ${fmt(daysAt(acc, kn), 0)}` : 'start'}</small></li>`; }).join('')}</ol>`);
  sum('ix-stops-sum', `${r.stops.length} stops`);
  const chokes = r.stops.slice(1, -1).map(chokeOf).filter(Boolean);
  set('ix-chokes', chokes.length ? `<ul class="ix-alts">${chokes.map((x) => { const c = CHOKES[chokeKey(x)] ?? {}; return `<li>${openBtn('waterways', x, esc(titleCase(x.name)))}<small>${esc(c.altWords ?? '')}</small></li>`; }).join('')}</ul>` : '<p class="cd-key">It passes no chokepoint: open sea from end to end.</p>');
  sum('ix-chokes-sum', chokes.length ? `${chokes.length}` : 'none');
  if (!data.ships) { set('ix-ships', shipsOff('the ships at each stop')); sum('ix-ships-sum', 'Live ships off'); }
  else {
    const rows = r.stops.map((s) => [s[2], shipsThrough({ lat: s[0], lon: s[1], id: chokeKey(s[2]) ?? '' }, data.ships, metaOf)]);
    const tot = rows.reduce((a, [, t]) => a + t.ways[0].length + t.ways[1].length + t.across.length + t.still.length, 0);
    set('ix-ships', `<ul class="ix-alts">${rows.map(([n, t]) => { const k = t.ways[0].length + t.ways[1].length + t.across.length + t.still.length; return `<li><b>${esc(n)}</b><small>${k ? `${fmt(k)} ships within ${fmt(t.r)} km` : 'none heard'}</small></li>`; }).join('')}</ul>`);
    sum('ix-ships-sum', `${fmt(tot)} heard`);
  }
  refresh?.();
}

// Data centres ----------------------------------------------------------------------------------------------------
export function dcHtml() {
  return `<div class="ix" data-ix="dc"><div id="ix-head"></div>${sec('ix-power', 'The power it needs')}${sec('ix-plants', 'Big power stations near it')}${sec('ix-owner', 'Its owners elsewhere')}${sec('ix-near', 'Neighbours', false)}</div>`;
}
export async function dcFill(d, { data, wm, plants, stillOpen, refresh }) {
  Object.assign(ix, { kind: 'dc', d, fat: null, paths: null });
  const mw = sitePowerMW(d); const planned = d.status === 'planned';
  set('ix-head', head('chip', d.chipCount ? fmt(d.chipCount) : '—', `${esc(d.chipType && d.chipType !== 'Unknown' ? d.chipType : 'accelerators of unknown type')}${planned ? ', planned' : ''}`, 'blue')
    + `<p class="cd-key">${esc(ownersOf(d).join(' and ') || 'Unknown owner')} · ${esc(d.country ?? '')}.</p>`);
  if (mw) {
    const reactors = mw[0] / 1000; const homes = homesFor(mw[0]);
    set('ix-power', `<div class="ix-meter"><span style="--w:${Math.min(100, (mw[1] / 2000) * 100).toFixed(1)}%"></span></div>
      <p class="cd-key">About <b>${fmt(mw[0])}–${fmt(mw[1])} MW</b> when its chips run flat out: ${sig(kwPerChip(d.chipType))} kW for each accelerator with its share of the servers and network, times ${PUE[0]} to ${PUE[1]} for cooling and losses. An estimate from the chip count, not a figure from the owner.</p>
      <div class="pt-chips"><span class="ld-chip tone-unk">${fmt(homes)} US homes' electricity</span><span class="ld-chip tone-unk">${reactors < 1 ? `${fmt(reactors * 100)} % of a 1,000 MW reactor` : `${sig(reactors)} reactors of 1,000 MW`}</span><span class="ld-chip tone-unk">${fmt(mw[0] * 8.76, 0)} GWh a year</span></div>`);
    sum('ix-power-sum', `${fmt(mw[0])}–${fmt(mw[1])} MW`);
  } else { set('ix-power', '<p class="cd-key">Its chip count is not known, so its power cannot be estimated.</p>'); sum('ix-power-sum', ''); }
  // big power stations near it (500 MW and up, within 150 km) and nuclear plants within 300 km
  const rows = (await plants?.().catch(() => null)) ?? []; if (stillOpen && !stillOpen()) return;
  const big = rows.filter((p) => p.mw >= 500 && Math.abs(p.lat - d.lat) < 1.5).map((p) => ({ p, km: haversineKm(d.lat, d.lon, p.lat, p.lng) })).filter((x) => x.km <= 150).sort((a, b) => b.p.mw - a.p.mw);
  const nukes = (data.nuclear ?? wm?.nuclear ?? []).filter((n) => n.status === 'active' && (n.type ?? 'plant') === 'plant' && Math.abs(n.lat - d.lat) < 3).map((n) => ({ n, km: haversineKm(d.lat, d.lon, n.lat, n.lon) })).filter((x) => x.km <= 300).sort((a, b) => a.km - b.km);
  const mwNear = big.reduce((s, x) => s + x.p.mw, 0);
  set('ix-plants', `${big.length ? `<ul class="ix-alts">${big.slice(0, 6).map((x) => `<li><button class="linkish" data-cd-layer="power" data-cd-power="${x.p.lat},${x.p.lng}">${esc(x.p.name)}</button><small>${fmt(x.p.mw)} MW ${esc(String(x.p.fuel ?? '').toLowerCase())} · ${fmt(x.km)} km</small></li>`).join('')}</ul>
    <p class="cd-key">${big.length} station${big.length === 1 ? '' : 's'} of 500 MW or more within 150 km, ${fmt(mwNear)} MW together${mw ? `; this site alone would take ${fmt((mw[0] / mwNear) * 100)} % of that` : ''}. From the World Resources Institute's database, which ends in 2021.</p>` : '<p class="cd-key">No power station of 500 MW or more within 150 km in the World Resources Institute database.</p>'}
    ${nukes.length ? `<div class="lm-near"><small>Nuclear plants within 300 km:</small>${nukes.slice(0, 5).map((x) => `<span class="ld-chip tone-unk">${esc(x.n.name)} · ${fmt(x.km)} km</span>`).join('')}</div>` : ''}`);
  sum('ix-plants-sum', big.length ? `${fmt(mwNear)} MW within 150 km` : 'none');
  // the same owners elsewhere, and neighbours within 100 km
  const all = data.datacenters ?? wm?.datacenters ?? []; const mine = new Set(ownersOf(d).map((s) => s.toLowerCase()));
  const same = all.filter((o) => o !== d && o.id !== d.id && ownersOf(o).some((s) => mine.has(s.toLowerCase()))).sort((a, b) => (b.chipCount ?? 0) - (a.chipCount ?? 0));
  const chips = same.reduce((s, o) => s + (o.chipCount ?? 0), 0) + (d.chipCount ?? 0);
  set('ix-owner', same.length ? `<div class="lm-near">${same.slice(0, 10).map((o) => openBtn('datacenters', o, esc(o.name), o.chipCount ? fmt(o.chipCount) : '')).join('')}${same.length > 10 ? `<small>and ${same.length - 10} more</small>` : ''}</div><p class="cd-key">${same.length + 1} sites on the map with ${fmt(chips)} accelerators in all${d.chipCount ? `; this one has ${fmt((d.chipCount / chips) * 100)} %` : ''}.</p>` : '<p class="cd-key">No other site of the same owners on the map.</p>');
  sum('ix-owner-sum', same.length ? `${same.length} more` : 'none');
  const near = all.filter((o) => o !== d && o.id !== d.id && Math.abs(o.lat - d.lat) < 1).map((o) => ({ o, km: haversineKm(d.lat, d.lon, o.lat, o.lon) })).filter((x) => x.km <= 100).sort((a, b) => a.km - b.km);
  set('ix-near', near.length ? `<div class="lm-near">${near.slice(0, 10).map((x) => openBtn('datacenters', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : '<p class="cd-key">No other AI site within 100 km.</p>');
  sum('ix-near-sum', near.length ? `${near.length} within 100 km` : 'none');
  refresh?.();
}

// ---------------------------------------------------------------- on the globe
const ring = (lat, lng, km, n = 48) => { const r = km / 111.195; const k = Math.max(0.15, Math.cos(lat * D2R)); return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [lat + r * Math.sin(a), lng + (r * Math.cos(a)) / k]; }); };
/** The open page's marks for the given layer: rings, and flow along a pipeline or a route. */
export function infraOverlay(ctx, layer, sel) {
  const want = { waterways: 'choke', pipelines: 'pipe', routes: 'route', datacenters: 'dc' }[layer];
  if (!ix.d || ix.kind !== want || sel?.d !== ix.d) return { custom: [], paths: [] };
  if (!ix.fat) {
    const d = ix.d; const lines = []; ix.paths = [];
    if (want === 'choke') { const c = CHOKES[chokeKey(d)] ?? { r: 60 }; lines.push({ pts: ring(d.lat, d.lon, c.r, 72), color: '#f2c66d', width: 2, alt: 0.004 }); }
    if (want === 'dc') { lines.push({ pts: ring(d.lat, d.lon, 150, 72), color: '#c9b8ff', width: 2, alt: 0.004 }); lines.push({ pts: ring(d.lat, d.lon, 8, 24), color: '#b7a3ff', width: 2, alt: 0.004 }); }
    if (want === 'pipe') {
      const pts = latLng(d.points); for (const e of [pts[0], pts.at(-1)]) if (e) lines.push({ pts: ring(e[0], e[1], 25, 24), color: '#f2c66d', width: 1.6, alt: 0.004 });
      ix.paths = [{ pts: sampleLine(pts, 40).map(([a, b]) => [a, b, 0.0045]), color: d.type === 'gas' ? ['rgba(111,184,255,0.15)', '#cfe8ff'] : ['rgba(201,128,62,0.15)', '#ffd7a8'], stroke: 2.4, dash: [0.05, 0.025], animMs: 3000, passive: true }];
    }
    if (want === 'route') for (const s of d.stops) lines.push({ pts: ring(s[0], s[1], 60, 32), color: '#e3b55b', width: 1.6, alt: 0.004 });
    ix.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.95 }) : null;
  }
  return { custom: ix.fat ? [ix.fat] : [], paths: ix.paths ?? [] };
}
export function infraClose() { ix.fat?.obj?.geometry?.dispose?.(); Object.assign(ix, { kind: null, d: null, fat: null, paths: null }); }
