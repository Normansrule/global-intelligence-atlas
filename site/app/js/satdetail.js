// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one satellite in depth.
// Click a space station or any satellite dot and its card becomes a satellite page:
//   what it is     its job in plain words (crewed station, internet, navigation, weather, imaging, debris…),
//                  who owns it, when and where it was launched, its radar size and whether it still works
//                  (the CelesTrak satellite catalogue, SATCAT; the launch year always comes from its own elements);
//   right now      speed, height and the country or ocean under it, ticking live, and whether it is in sunlight
//                  or in Earth's shadow;
//   its orbit      drawn to scale around the Earth with perigee and apogee, and its height on a ladder from an
//                  airliner to the geostationary ring;
//   sun and shade  how much of each orbit is sunlit and how many sunrises it sees a day;
//   what it sees   the circle of Earth above whose horizon it stands, and the people in the cities inside it;
//   where next     the countries and seas it will fly over in its next orbit, with the minutes until each;
//   its life       orbits flown and distance travelled since launch.
// On the globe: its footprint circle, a line down to the ground and its next orbit, in one draw call.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { R_EARTH_KM, haversineKm, smallCircle, solarElevation, fmtLat, fmtLng } from './astro.js';
import { propagate, satTime, orbitalElements } from './satellites.js';
import { cities } from './citydetail.js';
import { waterName } from './extras.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const D2R = Math.PI / 180;
const GEO_KM = 35_786;
const SUN_KM = 149_597_871;
const big = (n) => (n >= 1e9 ? `${fmt(n / 1e9, 1)} billion` : n >= 1e6 ? `${fmt(n / 1e6, 1)} million` : fmt(n));

// ---------------------------------------------------------------- what it is
// Its job from its name (and the group it was loaded in). Order matters: the first match wins.
const PURPOSES = [
  [/\b(R\/B|ROCKET BODY)\b/, 'rocket', 'Spent rocket stage', 'The upper stage that put a satellite in orbit and stayed there.'],
  [/\bDEB\b|DEBRIS/, 'alert', 'Space debris', 'A fragment from a break-up or collision, tracked so working satellites can dodge it.'],
  [/ISS \(ZARYA\)|^ISS\b|ZARYA|ZVEZDA/, 'sat', 'Crewed space station', 'People live and work aboard, doing experiments in near-zero gravity.', 'International Space Station'],
  [/TIANHE|TIANGONG|^CSS\b/, 'sat', 'Crewed space station', 'China\'s station, home to three taikonauts at a time.', 'Tiangong space station'],
  [/^HST$|HUBBLE/, 'eye', 'Space telescope', 'Above the blur of the air, it photographs galaxies billions of light years away.', 'Hubble Space Telescope'],
  [/STARLINK/, 'server', 'Internet from space', 'One of thousands of SpaceX satellites beaming broadband to dishes on the ground.', 'Starlink'],
  [/ONEWEB/, 'server', 'Internet from space', 'Part of the OneWeb constellation, bringing internet to places without cables.', 'OneWeb'],
  [/KUIPER/, 'server', 'Internet from space', 'Part of Amazon\'s Project Kuiper broadband constellation.', 'Project Kuiper'],
  [/NAVSTAR|\bGPS\b/, 'pin', 'Satellite navigation (GPS)', 'Its clock signal lets every phone and car work out where it is.', 'Global Positioning System'],
  [/GALILEO|\bGSAT0/, 'pin', 'Satellite navigation (Galileo)', 'Europe\'s navigation system, a signal for positioning anywhere on Earth.', 'Galileo (satellite navigation)'],
  [/GLONASS|COSMOS 2[45]\d\d/, 'pin', 'Satellite navigation (GLONASS)', 'Russia\'s navigation system, used alongside GPS by most phones.', 'GLONASS'],
  [/BEIDOU/, 'pin', 'Satellite navigation (BeiDou)', 'China\'s navigation system, worldwide since 2020.', 'BeiDou'],
  [/\bQZS\b|MICHIBIKI|IRNSS|NAVIC/, 'pin', 'Satellite navigation', 'A regional navigation satellite that sharpens positioning over its home country.'],
  [/\bGOES\b/, 'storm', 'Weather (geostationary)', 'Watches the Americas around the clock; its pictures are the cloud loops on the evening news.', 'Geostationary Operational Environmental Satellite'],
  [/METEOSAT|\bMSG\b|\bMTG\b/, 'storm', 'Weather (geostationary)', 'Watches Europe and Africa around the clock for EUMETSAT.', 'Meteosat'],
  [/HIMAWARI/, 'storm', 'Weather (geostationary)', 'Watches East Asia and the western Pacific for the Japan Meteorological Agency.', 'Himawari (satellite)'],
  [/NOAA|METOP|SUOMI|\bNPP\b|JPSS|FENGYUN|\bFY-?\d|METEOR|DMSP|ELEKTRO|\bAQUA\b|\bTERRA\b/, 'storm', 'Weather and climate', 'Scans the whole planet strip by strip, feeding forecasts and climate records.'],
  [/LANDSAT/, 'camera', 'Earth imaging', 'Photographs the land every 16 days, a record going back to 1972.', 'Landsat program'],
  [/SENTINEL/, 'camera', 'Earth imaging', 'Part of Europe\'s Copernicus programme, watching land, sea and air.', 'Copernicus Programme'],
  [/WORLDVIEW|SKYSAT|FLOCK|DOVE|PLEIADES|SPOT \d|KOMPSAT|CARTOSAT|GAOFEN|JILIN|ICEYE|CAPELLA/, 'camera', 'Earth imaging', 'Takes pictures of the ground, sharp enough to see cars or fields.'],
  [/IRIDIUM/, 'radio', 'Satellite phones', 'One of 66 satellites that carry calls and messages anywhere on Earth.', 'Iridium satellite constellation'],
  [/ORBCOMM|GLOBALSTAR|INMARSAT|INTELSAT|\bSES\b|EUTELSAT|VIASAT|TDRS|ASTRA|TELSTAR|ECHOSTAR|DIRECTV|ARABSAT|TURKSAT|SKYNET|AMAZONAS|HISPASAT/, 'radio', 'Communications', 'Relays television, phone calls or data between places on the ground.'],
  [/CUBESAT|\bSAT\b-?\d|LEMUR|SPIRE/, 'sat', 'Small satellite', 'A shoebox-sized satellite, often a university experiment or a data start-up.'],
];
const BY_GROUP = { Weather: ['storm', 'Weather and climate', 'Watches clouds, temperature and storms for forecasters.'], 'GPS (MEO)': ['pin', 'Satellite navigation (GPS)', 'Its clock signal lets every phone and car work out where it is.'], Geostationary: ['radio', 'Communications', 'Relays television, phone calls or data between places on the ground.'], Starlink: ['server', 'Internet from space', 'One of thousands of SpaceX satellites beaming broadband to dishes on the ground.'], 'Space stations': ['sat', 'Space station', 'A station or a craft visiting one.'] };
/** What a satellite is for: { icon, word, line, wiki? }. */
export function purposeOf(name, group) {
  const n = String(name ?? '').toUpperCase();
  for (const [re, icon, word, line, wiki] of PURPOSES) if (re.test(n)) return { icon, word, line, wiki };
  const g = BY_GROUP[group];
  return g ? { icon: g[0], word: g[1], line: g[2] } : { icon: 'sat', word: 'Satellite', line: 'One of the satellites in the bright, easy-to-see group.' };
}

/** The international designator from a TLE's first line ("98067A" → { year: 1998, num: 67, piece: 'A', id: '1998-067A' }). */
export function launchFromTle(l1) {
  const m = /^1 .{7}(\d{2})(\d{3})(\S{0,3})/.exec(String(l1 ?? '')); if (!m) return null;
  const yy = +m[1]; const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return { year, num: +m[2], piece: m[3].trim(), id: `${year}-${m[2]}${m[3].trim()}` };
}

// CelesTrak SATCAT codes for owners and launch sites, in words.
const OWNERS = { US: 'the United States', PRC: 'China', CIS: 'Russia (and the Soviet Union before it)', ESA: 'the European Space Agency', JPN: 'Japan', IND: 'India', FR: 'France', UK: 'the United Kingdom', GER: 'Germany', IT: 'Italy', CA: 'Canada', ISS: 'the International Space Station partners (USA, Russia, Europe, Japan and Canada)', SES: 'SES (Luxembourg)', ITSO: 'Intelsat', EUME: 'EUMETSAT, Europe\'s weather satellite agency', GLOB: 'Globalstar', ORB: 'ORBCOMM', IRID: 'Iridium', SKOR: 'South Korea', NKOR: 'North Korea', ISRA: 'Israel', IRAN: 'Iran', BRAZ: 'Brazil', AUS: 'Australia', NZ: 'New Zealand', UAE: 'the United Arab Emirates', TURK: 'Türkiye', SPN: 'Spain', ARGN: 'Argentina', NOR: 'Norway', LUXE: 'Luxembourg', INMA: 'Inmarsat', EUTE: 'Eutelsat', SAUD: 'Saudi Arabia', O3B: 'O3b Networks', TWN: 'Taiwan', SING: 'Singapore', INDO: 'Indonesia', MEX: 'Mexico', THAI: 'Thailand', NETH: 'the Netherlands', SWED: 'Sweden', FIN: 'Finland', POL: 'Poland', SAFR: 'South Africa', EGYP: 'Egypt', NIG: 'Nigeria', PAKI: 'Pakistan', VTNM: 'Vietnam', KAZ: 'Kazakhstan', UKR: 'Ukraine', AB: 'the Arab Satellite Communications Organization', TBD: 'an owner not yet recorded' };
const SITES = { AFETR: 'Cape Canaveral, Florida', AFWTR: 'Vandenberg, California', TYMSC: 'Baikonur, Kazakhstan', PKMTR: 'Plesetsk, Russia', KYMSC: 'Kapustin Yar, Russia', VOSTO: 'Vostochny, Russia', DLS: 'Dombarovsky, Russia', SVOBO: 'Svobodny, Russia', JSC: 'Jiuquan, China', TSC: 'Taiyuan, China', XSC: 'Xichang, China', WSC: 'Wenchang, China', YSLA: 'the Yellow Sea (sea launch, China)', FRGUI: 'Kourou, French Guiana', SRILR: 'Sriharikota, India', TNSTA: 'Tanegashima, Japan', KSCUT: 'Uchinoura, Japan', RLLB: 'Mahia Peninsula, New Zealand', WLPIS: 'Wallops Island, Virginia', KODAK: 'Kodiak, Alaska', SEMLS: 'Semnan, Iran', SHAHR: 'Shahrud, Iran', YAVNE: 'Palmachim, Israel', NSC: 'Naro, South Korea', YUN: 'Sohae, North Korea', SNMLP: 'the San Marco platform, Kenya', KWAJ: 'Kwajalein Atoll, Marshall Islands', SEAL: 'Sea Launch, Pacific Ocean', ERAS: 'an aircraft (air launch)', SADOL: 'a submarine in the Barents Sea', WRAS: 'an aircraft (air launch)', OREN: 'Orenburg, Russia', AMBLE: 'an aircraft (air launch)' };
const TYPES = { PAY: 'Payload (a working or retired satellite)', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };
const STATUS = { '+': 'working', P: 'partly working', B: 'standing by as a backup', S: 'a spare', X: 'working on an extended mission', D: 'decayed (it has fallen back to Earth)', '-': 'no longer working', '?': 'status unknown' };
/** A radar cross-section in m², against something you can picture. */
export function rcsWords(m2) {
  if (!(m2 > 0)) return '';
  if (m2 < 0.1) return 'about the size of a phone or a shoebox';
  if (m2 < 1) return 'about the size of a suitcase';
  if (m2 < 10) return 'about the size of a car';
  if (m2 < 100) return 'about the size of a bus';
  return 'bigger than a house';
}

// ---------------------------------------------------------------- right now
/** Footprint: the ground distance (km) to its horizon, and the angle (degrees) at Earth's centre. */
export function footprint(altKm) {
  const ang = Math.acos(R_EARTH_KM / (R_EARTH_KM + Math.max(0, altKm))) / D2R;
  return { ang, km: ang * D2R * R_EARTH_KM, frac: (1 - Math.cos(ang * D2R)) / 2 };
}
/** In sunlight? From its height the Sun is still up while it sits less than the horizon dip below the ground horizon. */
export function sunlit(lat, lng, altKm, date) { return solarElevation(lat, lng, date) > -footprint(altKm).ang; }

/** Sun and shade over one orbit: share of time sunlit and the number of sunrises it sees in that orbit. */
export function lightShare(sat, snapshot, now = new Date(), steps = 120) {
  const per = (2 * Math.PI) / sat.satrec.no; let lit = 0; let n = 0; let rises = 0; let prev = null;
  for (let i = 0; i <= steps; i++) {
    const d = new Date(now.getTime() + (i / steps) * per * 60_000); const p = propagate(sat, satTime(sat, d, snapshot)); if (!p) continue;
    const s = sunlit(p.lat, p.lng, p.altKm, d); n++; if (s) lit++; if (prev === false && s) rises++; prev = s;
  }
  return n ? { frac: lit / n, rises, perDay: (rises * 1440) / per } : null;
}

/** The places under it over the coming minutes: [{ name, cc, inMin }] in order, one entry per country or sea crossed. */
export function overflights(sat, snapshot, now, countryAt, minutes, stepSec = 30) {
  const out = [];
  for (let s = 0; s <= minutes * 60; s += stepSec) {
    const d = new Date(now.getTime() + s * 1000); const p = propagate(sat, satTime(sat, d, snapshot)); if (!p) continue;
    const f = countryAt(p.lat, p.lng); const name = f?.properties?.name ?? waterName(p.lat, p.lng); const cc = f?.properties?.['ISO3166-1-Alpha-2'] ?? null;
    if (out.at(-1)?.name !== name) out.push({ name, cc, inMin: s / 60, lat: p.lat, lng: p.lng });
  }
  return out;
}

// ---------------------------------------------------------------- pictures
const LADDER = [[11, 'airliner', 'start', 46], [420, 'ISS', 'middle', 46], [20_200, 'GPS', 'end', 46], [GEO_KM, 'geostationary', 'end', 56]];
/** Its height on a logarithmic ladder from an airliner to the geostationary ring. */
export function heightLadder(altKm, W = 300, H = 62) {
  const top = Math.max(50_000, altKm * 1.3); const lo = Math.log10(8); const hi = Math.log10(top);
  const x = (km) => 8 + ((Math.log10(Math.max(8, km)) - lo) / (hi - lo)) * (W - 16);
  const ticks = LADDER.map(([km, label, anchor, y]) => `<line x1="${x(km).toFixed(1)}" x2="${x(km).toFixed(1)}" y1="26" y2="34" class="sd-tick"/><text x="${(anchor === 'end' && label === 'geostationary' ? W - 4 : x(km) + (anchor === 'start' ? -4 : 0)).toFixed(1)}" y="${y}" text-anchor="${anchor === 'end' && label === 'GPS' ? 'middle' : anchor}" class="ev-tick">${label}</text>`).join('');
  const me = x(altKm);
  return `<svg class="sd-ladder" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fmt(altKm)} km up, on a scale from an airliner at 11 km to the geostationary ring at 35,786 km">
    <line x1="8" x2="${W - 8}" y1="30" y2="30" class="sd-axis"/>${ticks}
    <g class="sd-me"><circle cx="${me.toFixed(1)}" cy="30" r="5"/><text x="${Math.min(W - 30, Math.max(30, me)).toFixed(1)}" y="16" text-anchor="middle">${fmt(altKm)} km</text></g></svg>`;
}
/** Where on its ellipse it is now: true anomaly (radians from perigee) from the mean anomaly in its elements. */
export function trueAnomaly(sat, date) {
  const r = sat.satrec; const tMin = (date.getTime() - (r.jdsatepoch - 2440587.5) * 86400_000) / 60_000;
  const M = (((r.mo + r.no * tMin) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); const e = r.ecco;
  let E = M; for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}
/** Its orbit to scale around the Earth, perigee to the right, with where it is now. */
export function orbitSvg(el, nu, W = 300, H = 170) {
  const a = el.a; const e = el.ecc; const b = a * Math.sqrt(1 - e * e);
  const s = Math.min((W - 24) / (2 * a), (H - 24) / (2 * b)); const fx = W / 2 + a * e * s; const cy = H / 2; // the Earth sits at a focus
  const rE = Math.max(3, R_EARTH_KM * s); const rNow = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
  const sx = fx + rNow * Math.cos(nu) * s; const sy = cy - rNow * Math.sin(nu) * s;
  const peri = fx + a * (1 - e) * s; const apo = fx - a * (1 + e) * s;
  const geo = (R_EARTH_KM + GEO_KM) * s; const showGeo = el.apogeeKm < GEO_KM * 0.8 && geo < W;
  return `<svg class="sd-orbit" viewBox="0 0 ${W} ${H}" role="img" aria-label="Orbit to scale: ${fmt(el.perigeeKm)} km at its lowest, ${fmt(el.apogeeKm)} km at its highest">
    ${showGeo ? `<circle cx="${fx.toFixed(1)}" cy="${cy}" r="${geo.toFixed(1)}" class="sd-geo"/>` : ''}
    <circle cx="${fx.toFixed(1)}" cy="${cy}" r="${rE.toFixed(1)}" class="sd-earth"/>
    <ellipse cx="${(W / 2).toFixed(1)}" cy="${cy}" rx="${(a * s).toFixed(1)}" ry="${(b * s).toFixed(1)}" class="sd-path"/>
    ${e > 0.02 ? `<circle cx="${peri.toFixed(1)}" cy="${cy}" r="2.5" class="sd-apse"/><text x="${Math.min(W - 4, peri + 4).toFixed(1)}" y="${cy + 13}" text-anchor="${peri > W - 40 ? 'end' : 'start'}" class="ev-tick">lowest ${fmt(el.perigeeKm)} km</text><circle cx="${apo.toFixed(1)}" cy="${cy}" r="2.5" class="sd-apse"/><text x="${Math.max(4, apo - 4).toFixed(1)}" y="${cy + 13}" text-anchor="${apo < 40 ? 'start' : 'end'}" class="ev-tick">highest ${fmt(el.apogeeKm)} km</text>` : ''}
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4.5" class="sd-now"/>
    <text x="4" y="12" class="ev-tick">to scale${showGeo ? ' · dashed: the geostationary ring' : ''}</text></svg>`;
}

// ---------------------------------------------------------------- the open satellite (shared with the globe)
export const sd = { norad: null, p: null, fat: null, builtAt: 0, timer: null, track: null };
const satcatUrl = (n) => `https://celestrak.org/satcat/records.php?CATNR=${n}&FORMAT=JSON`;
const PARIS_NY_KM = 5837;

export function satHtml(p) {
  return `<div class="sd" data-norad="${esc(p.norad)}">
    <p class="cd-line" id="sd-line"></p>
    <div id="sd-head"></div>
    <div class="cy-now-box" id="sd-now"><div class="lm-fact skel"></div></div>
    <details class="qd-sec" open><summary><span>Its orbit</span><small id="sd-orbit-sum"></small></summary><div id="sd-orbit"></div></details>
    <details class="qd-sec" open><summary><span>Where next</span><small id="sd-next-sum"></small></summary><div id="sd-next"></div></details>
    <details class="qd-sec"><summary><span>What it can see</span><small id="sd-see-sum"></small></summary><div id="sd-see"></div></details>
    <details class="qd-sec"><summary><span>Its record</span><small id="sd-rec-sum"></small></summary><div id="sd-rec"></div></details>
  </div>`;
}

const where = (lat, lng, countryAt) => { const f = countryAt(lat, lng); return f ? { name: f.properties.name, cc: f.properties['ISO3166-1-Alpha-2'] } : { name: waterName(lat, lng), cc: null }; };
const placeBtn = (w) => (w.cc ? `<button class="linkish" data-country-cc="${esc(w.cc)}">${esc(w.name)}</button>` : esc(w.name));

/** The live box: speed, height, what is under it and sun or shade. Built once, then its figures are updated in place
 *  every two seconds while open (no redraw, so nothing flickers). */
function nowParts(p, countryAt) {
  const w = where(p.lat, p.lng, countryAt); const lit = sunlit(p.lat, p.lng, p.altKm, new Date()); const kmh = p.speedKms * 3600;
  return { kmh: `${fmt(kmh)} km/h`, sub: `${fmt(p.speedKms, 2)} km a second: Paris to New York in ${fmt(PARIS_NY_KM / kmh * 60)} minutes`, alt: `${fmt(p.altKm)} km`,
    over: placeBtn(w), overKey: w.name, pos: `${fmtLat(p.lat)}, ${fmtLng(p.lng)}`, lit, light: lit ? `${unitSvg('sun', 14)} in sunlight` : `${unitSvg('moon', 14)} in Earth's shadow` };
}
function nowBox(p, countryAt) {
  const q = nowParts(p, countryAt);
  return `<div class="cy-wx sd-live"><div><b class="cy-temp" data-sd="kmh">${q.kmh}</b><span data-sd="sub">${q.sub}</span></div>
    <dl class="cy-wx-dl"><dt>Height</dt><dd data-sd="alt">${q.alt}</dd><dt>Over</dt><dd data-sd="over" data-key="${esc(q.overKey)}">${q.over}</dd><dt>Position</dt><dd class="sd-pos" data-sd="pos">${q.pos}</dd><dt>Light</dt><dd data-sd="light" class="${q.lit ? 'sd-sun' : 'sd-shade'}">${q.light}</dd></dl></div>`;
}
function nowUpdate(box, p, countryAt) {
  const q = nowParts(p, countryAt); const f = (k) => box.querySelector(`[data-sd="${k}"]`);
  for (const k of ['kmh', 'sub', 'alt', 'pos']) { const e = f(k); if (e && e.textContent !== q[k]) e.textContent = q[k]; }
  const o = f('over'); if (o && o.dataset.key !== q.overKey) { o.innerHTML = q.over; o.dataset.key = q.overKey; }
  const l = f('light'); const cls = q.lit ? 'sd-sun' : 'sd-shade'; if (l && l.className !== cls) { l.className = cls; l.innerHTML = q.light; }
}

/** Fill the satellite page. */
export async function satFill(p, { stillOpen, countryAt, refresh }) {
  const sat = p.sat; if (!sat) return;
  clearInterval(sd.timer);
  Object.assign(sd, { norad: p.norad, p, fat: null, builtAt: 0, track: null });
  const now = new Date(); const el = orbitalElements(sat); const per = el.periodMin; const geo = /^Geostationary/.test(el.cls);
  const pur = purposeOf(p.name, p.group);
  const tle = launchFromTle(sat.l1);
  const cur = propagate(sat, satTime(sat, now, p.snapshot)) ?? p;
  // head: what it is
  const head = document.getElementById('sd-head');
  if (head) head.innerHTML = `<div class="ev-head tone-blue"><span class="ev-g">${unitSvg(pur.icon, 34)}</span><div><b class="ev-big sd-word">${esc(pur.word)}</b><span>${esc(pur.line)}</span></div></div>`;
  // the live box
  const box = document.getElementById('sd-now');
  const tick = () => {
    if (!stillOpen() || sd.norad !== p.norad) { clearInterval(sd.timer); return; }
    const q = propagate(sat, satTime(sat, new Date(), p.snapshot)); if (q && box) nowUpdate(box, q, countryAt);
  };
  if (box) box.innerHTML = nowBox(cur, countryAt);
  sd.timer = setInterval(tick, 2000);
  // its orbit
  const oEl = document.getElementById('sd-orbit'); const light = lightShare(sat, p.snapshot, now);
  if (oEl) {
    const orbitsDay = 1440 / per;
    oEl.innerHTML = `${orbitSvg(el, trueAnomaly(sat, satTime(sat, now, p.snapshot)))}${heightLadder(cur.altKm)}
      <p class="cd-key"><b>${esc(el.cls)}.</b> Once round every ${per >= 120 ? `${fmt(per / 60, 1)} hours` : `${fmt(per)} minutes`}${orbitsDay >= 1.5 ? `, ${fmt(orbitsDay, 1)} times a day` : ''}; ${el.ecc < 0.01 ? 'an almost perfect circle' : `between ${fmt(el.perigeeKm)} and ${fmt(el.apogeeKm)} km up`}. Tilted ${fmt(el.incDeg, 1)}° to the equator, ${el.incDeg > 96 && el.incDeg < 102 ? 'a sun-synchronous orbit: it crosses each place at the same local time every day' : el.incDeg > 90 ? 'going round against Earth\'s spin (retrograde)' : el.incDeg < 5 ? 'so it stays over the equator' : `so it flies over everywhere between ${fmt(Math.min(el.incDeg, 180 - el.incDeg))}° north and south`}.</p>
      ${light ? `<p class="cd-key">${light.frac >= 0.995 ? `<b>Always in sunlight</b> on this orbit${geo ? ', except for short eclipses around the equinoxes' : ''}.` : `<b>${fmt(light.frac * 100)}% of each orbit in sunlight</b>, the rest in Earth's shadow${light.perDay >= 1.5 ? `: it sees ${fmt(light.perDay)} sunrises a day` : ''}.`}</p>` : ''}`;
    const s = document.getElementById('sd-orbit-sum'); if (s) s.textContent = `${fmt(per)} min`;
  }
  // where next
  const nEl = document.getElementById('sd-next');
  if (nEl) {
    if (geo) {
      const w = where(cur.lat, cur.lng, countryAt);
      nEl.innerHTML = `<p class="cd-key">It goes round once a day, as fast as the Earth turns, so it hangs still above <b>${fmt(Math.abs(cur.lng), 1)}° ${cur.lng >= 0 ? 'east' : 'west'}</b> over ${placeBtn(w)}. A dish pointed at it never has to move.</p>`;
      const s = document.getElementById('sd-next-sum'); if (s) s.textContent = 'stays put';
    } else {
      const mins = Math.min(per, 120); const list = overflights(sat, p.snapshot, now, countryAt, mins, per > 200 ? 120 : 30);
      sd.track = list;
      nEl.innerHTML = `<ol class="sd-next">${list.slice(0, 14).map((x, i) => `<li><span class="sd-t">${i === 0 ? 'now' : `in ${fmt(x.inMin)} min`}</span>${x.cc ? `<button class="linkish" data-country-cc="${esc(x.cc)}">${esc(x.name)}</button>` : `<span class="sd-sea">${esc(x.name)}</span>`}</li>`).join('')}</ol>
        <p class="cd-key">${list.length > 14 ? `and ${fmt(list.length - 14)} more. ` : ''}Its next ${fmt(mins)} minutes, drawn on the globe. Earth turns about ${fmt((per / 1436) * 360)}° under it each orbit, so the next pass runs further west.</p>`;
      const land = list.filter((x) => x.cc).length; const s = document.getElementById('sd-next-sum'); if (s) s.textContent = `${fmt(land)} countr${land === 1 ? 'y' : 'ies'}`;
    }
  }
  // what it can see
  const fp = footprint(cur.altKm); const list = await cities().catch(() => []); if (!stillOpen()) return;
  const inside = list.filter((c) => Math.abs(c.lat - cur.lat) <= fp.ang + 0.5 && haversineKm(cur.lat, cur.lng, c.lat, c.lng) <= fp.km);
  const pop = inside.reduce((s, c) => s + (c.pop || 0), 0); const biggest = [...inside].sort((a, b) => (b.pop || 0) - (a.pop || 0)).slice(0, 4);
  const seeEl = document.getElementById('sd-see');
  if (seeEl) {
    seeEl.innerHTML = `<p class="cd-key">From ${fmt(cur.altKm)} km up its horizon is <b>${fmt(fp.km)} km</b> away in every direction: a circle covering ${fmt(fp.frac * 100, 1)}% of Earth, drawn on the globe. ${pop ? `Inside it right now: <b>${big(pop)} people</b> in ${fmt(inside.length)} cities on the map${biggest.length ? `, the biggest ${esc(biggest.map((c) => c.name).join(', '))}` : ''}. Anyone there could, in principle, see it above their horizon.` : 'No city on the map is inside it right now: it is over empty ocean or ice.'}</p>
      <p class="cd-key">To spot it with your own eyes, your sky must be dark while it is still in sunlight, usually in the two hours after sunset or before sunrise. “When can I see it from here?” below works out the times.</p>`;
    const s = document.getElementById('sd-see-sum'); if (s) s.textContent = pop ? `${big(pop)} people` : `${fmt(fp.km)} km`;
  }
  // its record (SATCAT), with the launch year from its own elements as the fallback
  const rec = await getFeed('celestrak-satcat', satcatUrl(p.norad), { ttl: 7 * 86_400_000, timeout: 10_000 }).then((r) => (Array.isArray(r) ? r[0] : null)).catch(() => null);
  if (!stillOpen()) return;
  const launched = rec?.LAUNCH_DATE ? new Date(`${rec.LAUNCH_DATE}T12:00:00Z`) : tle ? new Date(Date.UTC(tle.year, 6, 1)) : null;
  const yrs = launched ? (Date.now() - launched) / (365.25 * 86_400_000) : null;
  const line = document.getElementById('sd-line');
  if (line) {
    const owner = rec?.OWNER ? OWNERS[rec.OWNER] ?? rec.OWNER : null; const site = rec?.LAUNCH_SITE ? SITES[rec.LAUNCH_SITE] ?? rec.LAUNCH_SITE : null;
    line.innerHTML = `${launched ? `Launched <b>${rec?.LAUNCH_DATE ? esc(launched.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })) : `in ${tle.year}`}</b>` : 'In orbit'}${site ? ` from ${esc(site)}` : ''}${owner ? ` · owned by ${esc(owner)}` : ''}${yrs != null ? ` · <b>${yrs < 1 ? `${fmt(yrs * 12)} months` : `${fmt(yrs, yrs < 10 ? 1 : 0)} years`}</b> in space` : ''}`;
  }
  const rEl = document.getElementById('sd-rec');
  if (rEl) {
    const life = yrs != null && yrs > 0 ? { orbits: (yrs * 365.25 * 1440) / per, km: ((yrs * 365.25 * 1440) / per) * 2 * Math.PI * el.a } : null;
    const rcs = rec?.RCS != null && rec.RCS !== '' ? Number(rec.RCS) : null;
    const rows = [
      ['Catalogue number', `NORAD ${p.norad}`], ['International designator', rec?.OBJECT_ID ?? tle?.id ?? '—'],
      ...(rec?.OBJECT_TYPE ? [['Kind', TYPES[rec.OBJECT_TYPE] ?? rec.OBJECT_TYPE]] : []),
      ...(rec?.OPS_STATUS_CODE ? [['Status', STATUS[rec.OPS_STATUS_CODE] ?? rec.OPS_STATUS_CODE]] : []),
      ...(rcs ? [['Radar size', `${fmt(rcs, rcs < 1 ? 2 : 1)} m², ${rcsWords(rcs)}`]] : []),
    ];
    rEl.innerHTML = `${life ? `<p class="cd-key">Since launch it has gone round the Earth about <b>${big(Math.round(life.orbits))} times</b> and travelled ${big(life.km)} km${life.km > SUN_KM ? `, ${fmt(life.km / SUN_KM, life.km > 10 * SUN_KM ? 0 : 1)} times the distance to the Sun` : `, ${fmt(life.km / 384_400, 0)} times the distance to the Moon`}.</p>` : ''}
      <dl class="sd-rec">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="cd-key">${rec ? 'From the CelesTrak satellite catalogue (SATCAT), built from U.S. Space Force tracking.' : `The satellite catalogue did not answer, so this is what its own orbital elements say: piece ${esc(tle?.piece || 'A')} of launch ${fmt(tle?.num ?? 0)} of ${tle?.year ?? '—'}.`}</p>`;
    const s = document.getElementById('sd-rec-sum'); if (s) s.textContent = rec?.OBJECT_ID ?? tle?.id ?? '';
  }
  refresh();
}

/** On the globe: its footprint, a line straight down to the ground and its next orbit, in one draw call (rebuilt as it moves). */
export function satOverlay(ctx, sel) {
  if (!sd.p || sel?.d?.norad !== sd.norad) return { custom: [] };
  const t = Date.now();
  if (!sd.fat || t - sd.builtAt > 1500) {
    sd.fat?.obj?.geometry?.dispose?.(); const sat = sd.p.sat; const now = ctx.now ?? new Date();
    const p = propagate(sat, satTime(sat, now, sd.p.snapshot)); if (!p) return { custom: [] };
    const fp = footprint(p.altKm); const lines = [];
    lines.push({ pts: smallCircle(p.lat, p.lng, fp.ang, 160), color: '#9fe3ff', width: 1.4, alt: 0.004 });
    lines.push({ pts: [[p.lat, p.lng, 0.003], [p.lat, p.lng, p.altKm / R_EARTH_KM]], color: '#9fe3ff', width: 1.2 });
    const per = (2 * Math.PI) / sat.satrec.no;
    if (!/^Geostationary/.test(orbitalElements(sat).cls)) {
      const mins = Math.min(per, 120); const step = per > 200 ? 120 : 30; const pts = [];
      for (let s = 0; s <= mins * 60; s += step) { const q = propagate(sat, satTime(sat, new Date(now.getTime() + s * 1000), sd.p.snapshot)); if (q) pts.push([q.lat, q.lng]); }
      lines.push({ pts, color: '#c9b8ff', width: 2.4, alt: 0.005 });
    }
    sd.fat = ctx.fatLines(lines, { opacity: 0.9 }); sd.builtAt = t;
  }
  return { custom: sd.fat ? [sd.fat] : [] };
}
export function satClose() { clearInterval(sd.timer); sd.fat?.obj?.geometry?.dispose?.(); Object.assign(sd, { norad: null, p: null, fat: null, builtAt: 0, timer: null, track: null }); }
