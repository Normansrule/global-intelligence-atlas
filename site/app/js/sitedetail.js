// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: spaceports and mines in depth (v2.27).
// Two more kinds of place become pages of their own, worked out from the atlas's own data so they open offline too:
//   spaceport  the speed Earth's spin lends a rocket there, the lowest orbit tilt it can reach straight up, the cost of
//              reaching the geostationary belt from it, the directions a rocket can fly while staying over open sea
//              (drawn as a fan on the globe) and the orbits those directions lead to, the launches from its pads in the
//              atlas's launch list, and the other spaceports near it;
//   mine       what its mineral is for and which country mines most of it, its output as a share of the world's, the
//              nearest port and the export port for its mineral, where the mineral is refined, where it is priced, and
//              the other mines of the same mineral.
// Numbers that are estimates say so on the page; docs/ASSUMPTIONS.md (v2.27) lists every figure and its source.
import { unitSvg } from './icons.js';
import { haversineKm } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const sig = (n) => fmt(n, n < 10 ? 1 : 0);
const D2R = Math.PI / 180;
const R_KM = 6371.0088;

// ---------------------------------------------------------------- spaceports: orbital mechanics
/** Earth's surface speed at the equator, m/s: 2π × 6,378.137 km ÷ one sidereal day (86,164.1 s). */
export const V_EQ = 465.1;
/** Circular speed in the geostationary belt, km/s (42,164 km from Earth's centre). */
export const V_GEO = 3.075;
/** What Earth's spin lends a rocket launched due east from latitude lat, m/s. */
export const spinBoost = (lat) => V_EQ * Math.cos(lat * D2R);
/** Orbit inclination, degrees, from launch latitude and azimuth (compass bearing, degrees): cos i = cos φ · sin A. */
export const inclinationOf = (lat, az) => Math.acos(Math.max(-1, Math.min(1, Math.cos(lat * D2R) * Math.sin(az * D2R)))) / D2R;
/** The change of speed, km/s, to swing an orbit's plane by i degrees in the geostationary belt on its own: 2 v sin(i/2). */
export const geoPlaneDv = (i) => 2 * V_GEO * Math.sin((Math.abs(i) * D2R) / 2);
/** The point km away from (lat, lng) along the compass bearing az, on a sphere. */
export function destination(lat, lng, az, km) {
  const d = km / R_KM; const p1 = lat * D2R; const t = az * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = lng * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / D2R, ((l2 / D2R + 540) % 360) - 180];
}
/** Steps in degrees and km for the sea-safe search: every 5°, from 30 km out to 900 km. */
export const FAN = { step: 5, from: 30, to: 900, every: 30 };
/**
 * Which directions keep a rocket over open sea for its first 900 km (an Approximation of a range-safety corridor:
 * real ranges also weigh islands, shipping, air routes and treaty limits). landAt(lat, lng) returns a country or null.
 * Returns [{az, safe, land}] for every 5°, with the first country each unsafe direction crosses.
 */
export function seaFan(lat, lng, landAt) {
  const out = [];
  for (let az = 0; az < 360; az += FAN.step) {
    let land = null;
    for (let km = FAN.from; km <= FAN.to && !land; km += FAN.every) { const [a, b] = destination(lat, lng, az, km); land = landAt(a, b); }
    out.push({ az, safe: !land, land });
  }
  return out;
}
/** Runs of neighbouring safe directions, as [fromAz, toAz] (wrapping through north). */
export function safeRuns(fan) {
  const n = fan.length; const runs = []; if (!n) return runs;
  if (fan.every((f) => f.safe)) return [[0, 360]];
  const start = fan.findIndex((f) => !f.safe);
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const f = fan[(start + k) % n];
    if (f.safe) { if (!cur) cur = [f.az, f.az]; else cur[1] = f.az; } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}
/** Orbits people often want, with the inclination each needs (degrees). */
export const TARGETS = [
  ['Geostationary transfer', 0, 'satellites that hover over one spot: TV, weather, communications'],
  ['Space station', 51.6, 'the International Space Station'],
  ['Polar', 90, 'every part of the Earth passes beneath'],
  ['Sun-synchronous', 97.8, 'the same local time on every pass: most Earth-observing satellites'],
];
/** How the site reaches each target orbit: 'direct' when a sea-safe direction gives it within 1.5°, 'dogleg' when the orbit is flatter than the site's latitude, else 'over land'. */
export function reachOf(lat, fan) {
  const safeInc = fan.filter((f) => f.safe).map((f) => inclinationOf(lat, f.az));
  return TARGETS.map(([name, inc, what]) => {
    const need = inc === 0 ? Math.abs(lat) : inc; // the flattest orbit straight up is the latitude itself; the rest is the plane change
    const direct = safeInc.some((i) => Math.abs(i - need) <= 1.5);
    return { name, inc, what, how: inc && inc < Math.abs(lat) - 0.5 ? 'dogleg' : direct ? 'direct' : 'over land' };
  });
}
const compass = (az) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((az % 360) + 360) % 360) / 45) % 8];

// ---------------------------------------------------------------- mines: what each mineral is for
// world: world mine production in 2023, tonnes of contained metal (iron ore as usable ore, rare earths as oxide,
// uranium as uranium in 2022). top: the biggest producing country and its share. Not verified: rounded figures from
// the U.S. Geological Survey's Mineral Commodity Summaries 2024 and the World Nuclear Association (uranium), see
// docs/ASSUMPTIONS.md (v2.27); the container this was built in could not reach either source to check them again.
export const MINERALS = {
  Lithium: { uses: 'rechargeable batteries in phones, laptops and electric cars; glass and ceramics; grease', world: 180e3, top: ['Australia', 48], glyph: 'battery' },
  Cobalt: { uses: 'battery cathodes; superalloys for jet engines; cutting tools', world: 230e3, top: ['DR Congo', 74], glyph: 'battery' },
  Nickel: { uses: 'stainless steel; battery cathodes; heat-proof alloys', world: 3.6e6, top: ['Indonesia', 50], glyph: 'battery' },
  'Rare Earths': { uses: 'the strong magnets in electric motors, wind turbines and speakers; catalysts; screen phosphors', world: 350e3, top: ['China', 69], glyph: 'bolt' },
  Copper: { uses: 'electric wiring, motors and power lines; electronics; plumbing', world: 22e6, top: ['Chile', 23], glyph: 'bolt' },
  Gold: { uses: 'jewellery; bars and coins held by central banks and investors; electronics contacts', world: 3000, top: ['China', 12], glyph: 'bank' },
  Silver: { uses: 'solar panels; electronics; jewellery and coins', world: 26e3, top: ['Mexico', 25], glyph: 'solar' },
  Platinum: { uses: 'catalytic converters in diesel cars; jewellery; hydrogen fuel cells', world: 170, top: ['South Africa', 71], glyph: 'car' },
  Palladium: { uses: 'catalytic converters in petrol cars; electronics', world: 200, top: ['Russia', 44], glyph: 'car' },
  'Iron Ore': { uses: 'almost all of it becomes steel, for buildings, ships, cars and machines', world: 2.5e9, top: ['Australia', 38], glyph: 'factory' },
  Uranium: { uses: 'fuel for nuclear power stations', world: 49e3, top: ['Kazakhstan', 43], glyph: 'nuclear' },
  Graphite: { uses: 'the anode of almost every lithium-ion battery; furnace linings for steelmaking', world: 1.6e6, top: ['China', 77], glyph: 'battery' },
};
const MINERAL_ALIAS = { 'rare earth': 'Rare Earths', 'rare earth elements': 'Rare Earths', ree: 'Rare Earths', 'iron': 'Iron Ore' };
/** The table key for a mineral name in either list ("Rare earths", "lithium", ...), or null. */
export function mineralKey(name) {
  const s = String(name ?? '').trim().toLowerCase(); if (!s) return null;
  const k = Object.keys(MINERALS).find((x) => x.toLowerCase() === s) ?? MINERAL_ALIAS[s];
  return k ?? Object.keys(MINERALS).find((x) => s.includes(x.toLowerCase())) ?? null;
}
const OZ_T = 31.1035e-6; // tonnes in a troy ounce
const UNIT_T = { moz: 1e6 * OZ_T, koz: 1e3 * OZ_T, mt: 1e6, kt: 1e3, t: 1 };
/**
 * A yearly output in tonnes from text like "2.8 Moz/yr", "~430kt Cu/yr", "~200kt LCE/yr" or "~280Mt/yr".
 * Lithium carbonate equivalent counts as 18.8 % lithium; lithium hydroxide and percentages are not read.
 * Returns { t, text } or null.
 */
export function parseOutput(s) {
  const m = /(\d+(?:\.\d+)?)\s*(Moz|koz|Mt|kt|t)\b(\s*[A-Za-z]+)?/i.exec(String(s ?? '')); if (!m) return null;
  const unit = m[2].toLowerCase(); const tag = (m[3] ?? '').trim().toLowerCase();
  if (tag === 'lioh') return null;
  let t = Number(m[1]) * UNIT_T[unit]; if (tag === 'lce') t *= 0.188;
  return { t, text: m[0].trim() };
}
/** The site's yearly output as a share of world mine production, or null when either is unknown. */
export function worldShare(m) {
  const k = mineralKey(m?.mineral); const w = k && MINERALS[k].world; if (!w) return null;
  const o = parseOutput(m.annualOutput) ?? parseOutput(m.productionCapacity ?? m.outputCapacity) ?? parseOutput(m.significance) ?? (m.capacityTpa ? { t: m.capacityTpa, text: `${fmt(m.capacityTpa)} t a year` } : null);
  return o ? { ...o, share: (o.t / w) * 100 } : null;
}
/** Whether a commodity row or plant handles this mineral. */
const handles = (list, k) => !!k && (list ?? []).some((c) => mineralKey(c) === k);

// ---------------------------------------------------------------- shared page bits
export const sx = { kind: null, d: null, fan: null, port: null, fat: null };
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const sum = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const sec = (id, title, open = true) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small id="${id}-sum"></small></summary><div id="${id}"></div></details>`;
const head = (glyph, big, line, tone = 'blue') => `<div class="ev-head tone-${tone}"><span class="ev-g">${unitSvg(glyph, 34)}</span><div><b class="ev-big">${big}</b><span>${line}</span></div></div>`;
const openBtn = (layer, d, label, extra = '') => `<button class="chip" data-ix-layer="${layer}" data-ix-id="${esc(d.id ?? d.name)}">${label}${extra ? ` <span>${extra}</span>` : ''}</button>`;
const near = (rows, lat, lon, km, latKey = 'lat', lonKey = 'lon') => (rows ?? []).filter((o) => Number.isFinite(o[latKey])).map((o) => ({ o, km: haversineKm(lat, lon, o[latKey], o[lonKey]) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);

/** A compass rose: gold wedges for the directions that stay over sea. */
function rose(fan) {
  const r = 46; const c = 50; const half = (FAN.step / 2) * D2R;
  const wedge = (az) => { const a0 = az * D2R - half; const a1 = az * D2R + half; const p = (a) => `${(c + r * Math.sin(a)).toFixed(1)},${(c - r * Math.cos(a)).toFixed(1)}`; return `M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`; };
  return `<svg class="sx-rose" viewBox="0 0 100 100" role="img" aria-label="Directions over open sea, shown in gold">
    <circle cx="50" cy="50" r="46" class="sx-rose-bg"/>${fan.map((f) => `<path d="${wedge(f.az)}" class="${f.safe ? 'sx-safe' : 'sx-land'}"/>`).join('')}
    <text x="50" y="11" text-anchor="middle">N</text><text x="91" y="53" text-anchor="middle">E</text><text x="50" y="96" text-anchor="middle">S</text><text x="9" y="53" text-anchor="middle">W</text></svg>`;
}

// ---------------------------------------------------------------- the spaceport page
export function padHtml() {
  return `<div class="ix sx" data-ix="pad"><div id="sx-head"></div>${sec('sx-spin', 'Earth’s spin here')}${sec('sx-fan', 'Where rockets can fly')}${sec('sx-launch', 'Launches from here')}${sec('sx-near', 'Other spaceports', false)}</div>`;
}
/** Fills the spaceport page. countryAt(lat, lng) gives the country at a point (null at sea); launches are the atlas's launch list. */
export function padFill(s, { data, wm, countryAt, bordersReady = true, launchesOn = false, refresh }) {
  const lat = s.lat; const lng = s.lon ?? s.lng;
  const boost = spinBoost(lat); const dv = geoPlaneDv(lat);
  set('sx-head', head('rocket', `${fmt(boost)} m/s`, `free from Earth’s spin at ${fmt(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}`, 'ochre')
    + `<p class="cd-key">${esc(s.operator ?? '')}${s.country ? ` · ${esc(s.country)}` : ''}${s.status ? ` · ${esc(s.status)}` : ''}.</p>`);
  set('sx-spin', `<div class="ix-meter"><span style="--w:${((boost / V_EQ) * 100).toFixed(1)}%"></span></div>
    <p class="cd-key">A rocket fired due east starts with <b>${fmt(boost)} m/s</b> of Earth’s own spin, ${fmt((boost / V_EQ) * 100)} % of what it would get on the equator. Reaching low orbit takes about 7,800 m/s, so the spin here does ${fmt((boost / 7800) * 100)} % of that for free.</p>
    <div class="pt-chips"><span class="ld-chip tone-unk">Flattest orbit straight up: ${fmt(Math.abs(lat), 1)}°</span><span class="ld-chip tone-unk">Tilt to remove for geostationary: ${sig(dv)} km/s</span></div>
    <p class="cd-key">A rocket cannot reach an orbit tilted less than its launch latitude without a costly turn. To hover over the equator a satellite from here must swing its orbit flat, which costs up to ${sig(dv)} km/s if done on its own in the geostationary belt (real missions combine it with other burns, so they pay less).</p>`);
  sum('sx-spin-sum', `${fmt(boost)} m/s`);
  // the sea-safe fan
  if (!bordersReady || !countryAt) { set('sx-fan', '<button class="crow fact tone-blue" data-cd-layer="borders"><span class="crow-l">Switch on Countries to work out where rockets can fly from here</span><b>·</b><span class="crow-u"></span><small>show them</small></button>'); sum('sx-fan-sum', ''); sx.fan = null; }
  else {
    const fan = seaFan(lat, lng, countryAt); sx.fan = fan; const runs = safeRuns(fan); const reach = reachOf(lat, fan);
    const nSafe = fan.filter((f) => f.safe).length;
    const blocked = [...new Map(fan.filter((f) => !f.safe).map((f) => { const n = f.land?.properties?.name ?? f.land?.properties?.ADMIN ?? 'land'; return [n, n]; })).values()];
    const runText = runs.length ? runs.map(([a, b]) => (b - a >= 355 ? 'every direction' : a === b ? `${a}° (${compass(a)})` : `${a}°–${b}° (${compass(a)} to ${compass(b)})`)).join(', ') : 'no direction';
    const word = { direct: 'straight up', dogleg: 'only with a costly turn', 'over land': 'only by flying over land' };
    set('sx-fan', `<div class="sx-fanrow">${rose(fan)}<div><p class="cd-key"><b>${nSafe * FAN.step}°</b> of the compass stays over open sea for the first ${fmt(FAN.to)} km: ${runText}.${blocked.length ? ` Other directions cross ${esc(blocked.slice(0, 4).join(', '))}${blocked.length > 4 ? ' and more' : ''}.` : ''}</p></div></div>
      <ul class="ix-alts">${reach.map((r) => `<li><span class="ld-chip tone-${r.how === 'direct' ? 'ok' : 'unk'}">${esc(r.name)} · ${r.inc ? `${r.inc}°` : `${fmt(Math.abs(lat), 1)}° → 0°`}</span><small>${word[r.how]}: ${esc(r.what)}</small></li>`).join('')}</ul>
      <p class="cd-key">An approximation of a range-safety corridor from the atlas’s country outlines: real ranges also weigh small islands, shipping, air routes and their own rules. The fan is drawn on the globe.</p>`);
    sum('sx-fan-sum', runs.length ? `${nSafe * FAN.step}° over sea` : 'all over land');
  }
  // launches from its pads in the atlas's list
  const ls = (data.launches ?? []).filter((l) => Number.isFinite(l.lat) && haversineKm(lat, lng, l.lat, l.lng) <= 60).sort((a, b) => a.net - b.net);
  if (!launchesOn && !data.launches) set('sx-launch', '<button class="crow fact tone-blue" data-cd-layer="launches"><span class="crow-l">Switch on Rocket launches to see the next ones from here</span><b>·</b><span class="crow-u"></span><small>show them</small></button>');
  else if (!ls.length) set('sx-launch', `<p class="cd-key">None of the ${fmt(data.launches?.length ?? 0)} launches in the atlas’s list flies from within 60 km of here. Switch Rocket launches between Upcoming and Recent to see the other list.</p>`);
  else {
    const now = Date.now();
    set('sx-launch', `<ul class="ix-steps ix-line">${ls.slice(0, 8).map((l, i) => `<li style="--i:${i}"><span>${esc(l.rocket || l.name)}${l.mission ? ` · ${esc(l.mission)}` : ''}</span><small>${new Date(l.net).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(l.pad)}${l.orbit ? ` · ${esc(l.orbit)}` : ''}</small></li>`).join('')}</ul>
      <p class="cd-key">${ls.filter((l) => l.net > now).length} still to fly in the list, ${ls.filter((l) => l.net <= now).length} already flown. Click a launch pin for its page.</p>`);
  }
  sum('sx-launch-sum', ls.length ? `${ls.length} in the list` : '');
  // neighbours
  const all = data.spaceports ?? wm?.spaceports ?? [];
  const nb = near(all.filter((o) => o !== s && o.id !== s.id), lat, lng, 3000).slice(0, 8);
  set('sx-near', nb.length ? `<div class="lm-near">${nb.map((x) => openBtn('spaceports', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : '<p class="cd-key">No other spaceport within 3,000 km.</p>');
  sum('sx-near-sum', nb.length ? `nearest ${fmt(nb[0].km)} km` : 'none');
  Object.assign(sx, { kind: 'pad', d: s, port: null, fat: null });
  refresh?.();
}

// ---------------------------------------------------------------- the mine page
export function mineHtml() {
  return `<div class="ix sx" data-ix="mine"><div id="sx-head"></div>${sec('sx-use', 'What it is for')}${sec('sx-out', 'How much it makes')}${sec('sx-ship', 'Getting it out')}${sec('sx-refine', 'Refined and priced')}${sec('sx-same', 'The same mineral elsewhere', false)}</div>`;
}
/** Fills the mine page. layer is 'minerals' or 'mining'; wm is World Monitor's data; data the atlas's loaded layers. */
export function mineFill(m, { layer = 'mining', data, wm, refresh }) {
  const k = mineralKey(m.mineral); const info = k ? MINERALS[k] : null; const plant = m.kind === 'plant';
  set('sx-head', head(info?.glyph ?? 'mine', esc(m.mineral ?? 'Mine'), `${plant ? esc(m.type ?? 'processing plant') : m.openPitOrUnderground ? `${esc(m.openPitOrUnderground.replace('both', 'open-pit and underground'))} mine` : 'mine'} · ${esc(m.status ?? '')}`, 'ochre')
    + `<p class="cd-key">${esc(m.operator ?? 'Unknown operator')} · ${esc(m.country ?? '')}.</p>`);
  set('sx-use', info ? `<p class="cd-key">${esc(k)} goes into ${esc(info.uses)}.</p>
    <div class="ix-meter"><span style="--w:${info.top[1]}%"></span></div>
    <p class="cd-key"><b>${esc(info.top[0])}</b> mined about ${info.top[1]} % of the world’s ${esc(k.toLowerCase())} in 2023${m.country && String(m.country).toLowerCase().includes(info.top[0].toLowerCase().split(' ')[0]) ? ', and this site is there' : ''}.</p>` : `<p class="cd-key">The atlas has no notes on ${esc(m.mineral ?? 'this mineral')} yet.</p>`);
  sum('sx-use-sum', info ? `${info.top[0]} ${info.top[1]} %` : '');
  const ws = worldShare(m);
  set('sx-out', `${m.productionRank ? `<div class="pt-chips"><span class="ld-chip tone-ok">${esc(m.productionRank)}</span></div>` : ''}
    ${ws ? `<p class="cd-key">About <b>${sig(ws.t >= 1e6 ? ws.t / 1e6 : ws.t >= 1e3 ? ws.t / 1e3 : ws.t)} ${ws.t >= 1e6 ? 'million' : ws.t >= 1e3 ? 'thousand' : ''} tonnes</b> of ${esc(k.toLowerCase())} a year (from “${esc(ws.text)}”), ${ws.share >= 0.1 ? `${sig(ws.share)} %` : 'under 0.1 %'} of the world’s mine output.${plant ? ' A plant’s output is compared with mine output, so it says how much of the world’s supply passes through it.' : ''}</p>` : '<p class="cd-key">Its yearly output is not in the atlas’s list.</p>'}
    ${m.significance ? `<p class="cd-key">${esc(m.significance)}</p>` : ''}`);
  sum('sx-out-sum', ws ? `${sig(ws.share)} % of the world` : '');
  // ports: the nearest of any kind, and the export port for this mineral
  const ports = (data.ports?.length ? data.ports : wm?.ports) ?? []; const hubs = wm?.commodities ?? [];
  const anyPort = [...ports.map((o) => ['ports', o]), ...hubs.filter((c) => c.kind === 'export-port' || c.kind === 'port').map((o) => ['commodities', o])]
    .map(([l, o]) => ({ l, o, km: haversineKm(m.lat, m.lon, o.lat, o.lon) })).sort((a, b) => a.km - b.km);
  const ep = near(hubs.filter((c) => c.kind === 'export-port' && handles(c.commodities, k)), m.lat, m.lon, 20000)[0];
  const np = anyPort[0] && anyPort[0].o !== ep?.o ? anyPort[0] : null; // the export port may itself be the nearest
  set('sx-ship', `<ul class="ix-alts">${np ? `<li>${openBtn(np.l, np.o, esc(np.o.name), `${fmt(np.km)} km`)}<small>the nearest port in the atlas, in a straight line${np.km > 500 ? '. The atlas lists only the bigger ports, so a smaller harbour nearer the mine may be the real way out' : ''}</small></li>` : ''}
    ${ep ? `<li>${openBtn('commodities', ep.o, esc(ep.o.name), `${fmt(ep.km)} km`)}<small>${anyPort[0]?.o === ep.o ? 'the nearest port in the atlas, and it' : 'the nearest port that'} exports ${esc(k.toLowerCase())}${ep.km > 1500 ? ', a long way off: ore here likely leaves by another route' : ''}</small></li>` : ''}</ul>
    <p class="cd-key">${np || ep ? 'Distances are straight lines; by rail or road they are longer. The line to the port is drawn on the globe.' : 'No port in the atlas’s list.'}</p>`);
  sum('sx-ship-sum', anyPort[0] ? `port ${fmt(anyPort[0].km)} km` : '');
  sx.port = ep?.o ?? np?.o ?? null;
  // where it is refined and priced
  const plants = (wm?.mining ?? []).filter((p) => k && p.kind === 'plant' && p !== m && p.id !== m.id && mineralKey(p.mineral) === k);
  const pr = plants.map((p) => ({ o: p, km: haversineKm(m.lat, m.lon, p.lat, p.lon) })).sort((a, b) => a.km - b.km);
  const ex = hubs.filter((c) => c.kind === 'exchange' && handles(c.commodities, k));
  set('sx-refine', `${pr.length ? `<div class="lm-near"><small>${plant ? 'Other plants for' : 'Plants that refine'} ${esc(k?.toLowerCase() ?? 'it')}:</small>${pr.slice(0, 6).map((x) => openBtn('mining', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : `<p class="cd-key">No ${esc(k?.toLowerCase() ?? '')} plant in the atlas’s list.</p>`}
    ${ex.length ? `<div class="lm-near"><small>Priced on:</small>${ex.map((c) => openBtn('commodities', c, esc(c.name))).join('')}</div>` : `<p class="cd-key">${esc(k ?? 'It')} has no futures contract on the exchanges in the atlas; it sells mostly on private contracts.</p>`}`);
  sum('sx-refine-sum', `${pr.length} plant${pr.length === 1 ? '' : 's'}${ex.length ? `, ${ex.length} exchange${ex.length === 1 ? '' : 's'}` : ''}`);
  // the same mineral elsewhere, in both lists
  const pool = [...(data.minerals ?? wm?.minerals ?? []).map((o) => ['minerals', o]), ...(wm?.mining ?? []).filter((o) => o.kind !== 'plant').map((o) => ['mining', o])]
    .filter(([, o]) => k && o !== m && !(o.id && o.id === m.id) && mineralKey(o.mineral) === k).map(([l, o]) => ({ l, o, km: haversineKm(m.lat, m.lon, o.lat, o.lon) })).sort((a, b) => a.km - b.km);
  set('sx-same', pool.length ? `<div class="lm-near">${pool.slice(0, 10).map((x) => openBtn(x.l, x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}${pool.length > 10 ? `<small>and ${pool.length - 10} more</small>` : ''}</div>` : '<p class="cd-key">No other site of this mineral on the map.</p>');
  sum('sx-same-sum', pool.length ? `${pool.length} more` : 'none');
  Object.assign(sx, { kind: 'mine', d: m, fan: null, fat: null, layer });
  refresh?.();
}

// ---------------------------------------------------------------- on the globe
const gcLine = (a, b, n = 48) => { const km = haversineKm(a[0], a[1], b[0], b[1]); const y = Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R); const x = Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R); const az = Math.atan2(y, x) / D2R; return Array.from({ length: n + 1 }, (_, i) => destination(a[0], a[1], az, (km * i) / n)); };
const ring = (lat, lng, km, n = 32) => Array.from({ length: n + 1 }, (_, i) => destination(lat, lng, (i / n) * 360, km));
/** The open page's marks: the sea-safe fan for a spaceport, the line to its port for a mine. */
export function siteOverlay(ctx, layer, sel) {
  const want = layer === 'spaceports' ? 'pad' : 'mine';
  if (!sx.d || sx.kind !== want || sel?.d !== sx.d) return { custom: [] };
  if (!sx.fat) {
    const d = sx.d; const lat = d.lat; const lng = d.lon ?? d.lng; const lines = [];
    if (want === 'pad' && sx.fan) for (const f of sx.fan) if (f.safe) lines.push({ pts: [[lat, lng], ...[150, 300, 450, 600, 750, 900].map((km) => destination(lat, lng, f.az, km))], color: '#ffd37a', width: 1.4, alt: 0.004 });
    if (want === 'pad') lines.push({ pts: ring(lat, lng, FAN.to, 72), color: 'rgba(255,211,122,0.55)', width: 1.2, alt: 0.004 });
    if (want === 'mine') { lines.push({ pts: ring(lat, lng, 25, 24), color: '#c9a66b', width: 2, alt: 0.004 }); if (sx.port) { lines.push({ pts: gcLine([lat, lng], [sx.port.lat, sx.port.lon]), color: '#e3c45b', width: 2, alt: 0.004 }); lines.push({ pts: ring(sx.port.lat, sx.port.lon, 20, 24), color: '#9fc3e6', width: 2, alt: 0.004 }); } }
    sx.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.95 }) : null;
  }
  return { custom: sx.fat ? [sx.fat] : [] };
}
export function siteClose() { sx.fat?.obj?.geometry?.dispose?.(); Object.assign(sx, { kind: null, d: null, fan: null, port: null, fat: null }); }
