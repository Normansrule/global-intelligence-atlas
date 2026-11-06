// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one rocket launch in depth.
// Click a launch pad and its card becomes a launch page (The Space Devs' Launch Library 2, detailed mode):
//   when        a live countdown, how sure the time is, the launch window, the time at the pad and yours, and
//               whether it flies in daylight, at twilight (the glowing "jellyfish" plume) or at night;
//   weather     the forecast at the pad for the launch hour (Open-Meteo): wind, gusts, cloud, rain chance and
//               the jet stream 10 km up, and which of them usually holds a launch;
//   flight plan every step from propellant loading to satellite deployment with T− and T+ times, ticking live;
//   where to    its target orbit, the heading it leaves on (from the pad latitude and the orbit's tilt), the free
//               speed Earth's spin gives it, the seas and countries under its climb, and where the booster lands;
//   the rocket  drawn to scale beside the Statue of Liberty and the Saturn V, its payload in cars, its weight
//               and thrust, and every launch it has flown as a row of squares;
//   booster     the serial number, how many times it has flown and where it will land;
//   crew        who is on board, their agency, age and days already spent in space;
//   the pad     how many launches it has seen, this year and since the last one, and the world's count.
// On the globe: the climb to orbit, its first orbit, the booster landing spot and a 300 km circle, in one draw call;
// during the flight a dot marks where the rocket should be by now.
import { getFeed } from './feeds.js';
import { unitSvg } from './icons.js';
import { haversineKm, destination, smallCircle, solarElevation, wrapLng } from './astro.js';
import { cities } from './citydetail.js';
import { waterName } from './extras.js';
import { countdown } from './launches.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const D2R = Math.PI / 180;
const KM_PER_DEG = 111.195;
const SIDEREAL_S = 86_164.1;
const big = (n) => (n >= 1e9 ? `${fmt(n / 1e9, 1)} billion` : n >= 1e6 ? `${fmt(n / 1e6, 1)} million` : fmt(n));
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${fmt(n)}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const dateWords = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const COMPASS = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// ---------------------------------------------------------------- times
/** An ISO 8601 duration ("-PT38M", "PT1H1M55S", "P158DT21H53M") in seconds; null when it is not one. */
export function isoSeconds(s) {
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const v = (Number(m[2] ?? 0) * 86400) + (Number(m[3] ?? 0) * 3600) + (Number(m[4] ?? 0) * 60) + Number(m[5] ?? 0);
  return m[1] ? -v : v;
}
/** "T− 38:00", "T+ 1:01:55" for a time relative to lift-off in seconds. */
export function tClock(sec) {
  const a = Math.abs(Math.round(sec)); const h = Math.floor(a / 3600); const m = Math.floor((a % 3600) / 60); const s = a % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return sec === 0 ? 'T 0' : `${sec < 0 ? 'T−' : 'T+'} ${body}`;
}

// ---------------------------------------------------------------- the flight plan in plain words
// The short names the flight timelines use, written out with the abbreviation in brackets.
const STEP_WORDS = [
  [/^MECO\b/i, 'Main engine cut-off (MECO)'], [/^BECO\b/i, 'Booster engine cut-off (BECO)'], [/^SECO-?(\d)?/i, (m) => `Second engine cut-off${m[1] ? ` ${m[1]}` : ''} (SECO${m[1] ? `-${m[1]}` : ''})`],
  [/^SES-?(\d)?/i, (m) => `Second engine start${m[1] ? ` ${m[1]}` : ''} (SES${m[1] ? `-${m[1]}` : ''})`], [/^Max-?Q/i, 'Maximum aerodynamic pressure (Max-Q)'],
  [/LOX Load/i, (m, a) => a.replace(/LOX Load/i, 'liquid oxygen (LOX) loading')], [/^RP-1 Load/i, 'Kerosene (RP-1) loading'], [/^Prop Load/i, 'Propellant loading starts'],
  [/^GO for Prop Load/i, 'Go for propellant loading'], [/^GO for Launch/i, 'Go for launch'], [/^Engine Chill/i, 'Engine chill'], [/^Tank Press/i, 'Tanks pressurised'], [/^Startup/i, 'Flight computer takes over (startup)'],
  [/^Ignition/i, 'Ignition'], [/^Liftoff/i, 'Lift-off'], [/^Fairing Sep/i, 'Nose fairing separates'], [/^Stage (\d) Separation/i, (m) => `Stage ${m[1]} separates`],
  [/^Entry Burn Startup/i, 'Booster re-entry burn starts'], [/^Entry Burn Shutdown/i, 'Re-entry burn ends'], [/^Stage 1 Landing Burn/i, 'Booster landing burn'], [/^Stage 1 Landing/i, 'Booster lands'],
  [/^Boostback/i, 'Booster turns back (boostback burn)'], [/^Payload Sep|Spacecraft Sep|Deployment/i, (m, a) => a.replace(/Sep\b/i, 'separation')],
];
export function stepWords(abbrev) {
  const a = String(abbrev ?? '').trim();
  for (const [re, w] of STEP_WORDS) { const m = re.exec(a); if (m) return typeof w === 'function' ? w(m, a) : w; }
  return a;
}
/** The flight plan, sorted: [{ sec, label, about }]. */
export function flightPlan(l) {
  return (l?.timeline ?? []).map((t) => ({ sec: isoSeconds(t.relative_time), label: stepWords(t.type?.abbrev), about: t.type?.description ?? '' })).filter((t) => t.sec != null).sort((a, b) => a.sec - b.sec);
}

// ---------------------------------------------------------------- where it goes
// The orbit's tilt from what it is going to (stations and navigation systems sit at known tilts), then from the
// kind of orbit. Rough on purpose: the page says when a tilt is an estimate.
const BY_NAME = [
  [/\b(ISS|Crew-\d+|Dragon CRS|CRS-\d|Cygnus|Progress MS|Soyuz MS|Starliner|Axiom|Ax-\d|HTV-?X?|Dream Chaser)\b/i, 51.64, 'the International Space Station (ISS)'],
  [/Shenzhou|Tianzhou|Tiangong|Mengzhou/i, 41.47, 'China\'s Tiangong space station'],
  [/\bGPS\b|Navstar/i, 55, 'the GPS satellites'], [/Galileo/i, 56, 'the Galileo satellites'], [/GLONASS/i, 64.8, 'the GLONASS satellites'], [/BeiDou/i, 55, 'the BeiDou satellites'],
  [/Molniya|Meridian/i, 63.4, 'a Molniya orbit'],
];
// Starlink shells by group number (the first number of "Starlink Group 6-12").
const STARLINK = { 2: 70, 4: 53.2, 6: 43, 8: 53, 10: 53, 12: 43, 15: 70 };
const ESCAPE = /Lunar|Moon|Mars|Heliocentric|Sun-Earth|L1|L2|Escape|Interplanetary|TLI|Venus|Jupiter|Asteroid/i;
const HIGH = /^(GTO|GEO|GSO|SubGTO|Sub-GTO|SSTO|Super-GTO)$/i;
const isVandenberg = (lat, lng) => lat > 34 && lat < 35.2 && lng > -121.2 && lng < -120;
const isFlorida = (lat, lng) => lat > 28 && lat < 29 && lng > -81 && lng < -80.3;

/** What kind of orbit and what tilt: { kind, inc, basis, estimated, south }. kind: leo | high | meo | escape | sub. */
export function targetOrbit(l, lat, lng, cc) {
  const name = `${l.name ?? ''} ${l.mission ?? ''}`; const ab = l.orbitAbbrev ?? ''; const on = l.orbit ?? '';
  const pad = Math.abs(lat); const russia = cc === 'RUS' || cc === 'KAZ'; const kourou = lat > 4 && lat < 6 && lng > -54 && lng < -52;
  const out = (kind, inc, basis, estimated = true) => {
    let south = !(inc > 90 && (kourou || russia)) && (inc > 90 || cc === 'CHN' || cc === 'JPN' || cc === 'IND' || isVandenberg(lat, lng) || (isFlorida(lat, lng) && inc < 48 && /Starlink/i.test(name)));
    if (lat < 0) south = inc > 90 && !kourou; // southern pads head north-east unless going round the poles
    return { kind, inc, basis, estimated, south };
  };
  if (/sub-?orbital/i.test(`${on} ${ab}`)) return out('sub', Math.max(pad, 0), 'a flight that comes back down without reaching orbit', false);
  if (ESCAPE.test(`${on} ${ab}`)) return out('escape', pad, `leaving Earth for ${on || 'deep space'}, launched due east to borrow Earth's spin`);
  for (const [re, inc, what] of BY_NAME) if (re.test(name)) return out(/GPS|Galileo|GLONASS|BeiDou|Molniya/.test(what) ? 'meo' : 'leo', inc, `the tilt of ${what}`, false);
  if (/^SSO$/i.test(ab) || /sun-?synchronous/i.test(on)) return out('leo', 97.6, 'a sun-synchronous orbit, which crosses each place at the same local time every day (about 97 to 98°)', false);
  if (/^PO$/i.test(ab) || /polar/i.test(on)) return out('leo', 90, 'a polar orbit, over both poles');
  if (HIGH.test(ab) || /geostationary|geosynchronous/i.test(on)) return out('high', pad, 'a geostationary transfer orbit (GTO), launched due east to borrow Earth\'s spin and tilt as little as possible');
  if (/^MEO$/i.test(ab) || /medium/i.test(on)) return out('meo', 55, 'a typical medium Earth orbit (MEO)');
  const sl = /Starlink Group (\d+)/i.exec(name);
  if (sl && STARLINK[sl[1]]) return out('leo', STARLINK[sl[1]], `Starlink group ${sl[1]}'s shell`);
  if (/Starlink/i.test(name)) return out('leo', isVandenberg(lat, lng) ? 53 : 43, 'the usual Starlink shell from this pad');
  if (isVandenberg(lat, lng)) return out('leo', 70, 'the usual tilt for low orbits from this coast, where rockets must fly south over the sea');
  return out('leo', Math.max(pad, 0), 'launching due east, the cheapest way up');
}

/** The heading a rocket leaves on to reach a tilt from a latitude (sin Az = cos i / cos φ, Curtis 2020).
 *  { az (degrees from north), direct } where direct is false when the pad is further from the equator than the tilt. */
export function launchAzimuth(lat, inc, south = false) {
  const r = Math.cos(inc * D2R) / Math.cos(lat * D2R);
  if (Math.abs(r) > 1) return { az: 90, direct: false };
  const b = Math.asin(r) / D2R; // north-going solution, east of north for prograde, west of north for retrograde
  return { az: (south ? 180 - b : b + 360) % 360, direct: true };
}
/** Free speed from Earth's spin at a latitude, m/s (465.1 m/s at the equator). */
export const spinBoost = (lat) => 465.1 * Math.cos(lat * D2R);

/** Where the rocket is t seconds after lift-off on the modelled path: it climbs to orbit insertion (about 1,700 km
 *  downrange at T+ 8 min 40 s) speeding up, then coasts round on its orbit while the Earth turns under it. */
export function pathAt(lat, lng, az, t, { insKm = 1700, insSec = 520, orbitMin = 92 } = {}) {
  const tt = Math.max(0, t);
  const arc = tt <= insSec ? (insKm * (tt / insSec) ** 2) / KM_PER_DEG : insKm / KM_PER_DEG + ((tt - insSec) * 360) / (orbitMin * 60);
  const [a, b] = destination(lat, lng, az, arc);
  return [a, wrapLng(b - (tt * 360) / SIDEREAL_S)];
}
/** The path as points from lift-off to `toSec`, every `step` seconds. */
export function pathPoints(lat, lng, az, toSec, step = 20, opts) {
  const pts = []; for (let t = 0; t <= toSec; t += step) pts.push(pathAt(lat, lng, az, t, opts)); return pts;
}
const ORBIT_MIN = { leo: 92, meo: 92, high: 92, escape: 92, sub: 0 };
const COAST_SEC = { leo: 92 * 60, meo: 40 * 60, high: 25 * 60, escape: 25 * 60, sub: 0 };

// ---------------------------------------------------------------- light at lift-off
/** Daylight, twilight or night at the pad at a moment, and what that means for seeing it. */
export function launchLight(lat, lng, t) {
  const el = solarElevation(lat, lng, new Date(t));
  if (el > 0) return { key: 'day', icon: 'sun', word: 'A daylight launch', line: 'Watch for the white trail of exhaust; the flame itself is hard to see against a bright sky.' };
  if (el > -18) return { key: 'twilight', icon: 'moon', word: 'A twilight launch', line: 'The pad is dark but the Sun still lights the sky high above, so the climbing plume can glow like a huge jellyfish, seen hundreds of kilometres away.' };
  return { key: 'night', icon: 'moon', word: 'A night launch', line: 'Its flame lights up the coast and can be seen as a bright, moving star hundreds of kilometres away.' };
}

// ---------------------------------------------------------------- the weather at the pad
const wxUrl = (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_250hPa,weather_code&forecast_days=16&timezone=GMT`;
/** The forecast hour for lift-off from an Open-Meteo answer (times in GMT), or null. */
export function wxAt(w, t) {
  const h = w?.hourly; if (!h?.time) return null;
  const key = new Date(Math.floor(t / 3600_000) * 3600_000).toISOString().slice(0, 13);
  const i = h.time.findIndex((x) => String(x).slice(0, 13) === key); if (i < 0) return null;
  const v = (k) => (h[k]?.[i] ?? null);
  return { temp: v('temperature_2m'), rain: v('precipitation_probability'), cloud: v('cloud_cover'), wind: v('wind_speed_10m'), gust: v('wind_gusts_10m'), dir: v('wind_direction_10m'), jet: v('wind_speed_250hPa'), code: v('weather_code') };
}
/** What in a forecast hour usually holds a launch (simplified from the launch weather rules ranges publish). */
export function wxWatch(x) {
  if (!x) return [];
  const out = [];
  if ((x.code ?? 0) >= 95) out.push(['storm', 'Thunderstorms forecast: no rocket flies near lightning.']);
  else if ((x.rain ?? 0) >= 40 || (x.cloud ?? 0) >= 90) out.push(['storm', 'Showers or thick cloud: a climbing rocket can trigger lightning, so the rules forbid flying through it.']);
  if ((x.gust ?? 0) >= 55 || (x.wind ?? 0) >= 45) out.push(['wind', 'Strong wind at the pad, enough to hold many launches.']);
  if ((x.jet ?? 0) >= 150) out.push(['wind', 'A strong jet stream about 10 km up: the wind shear shakes the rocket as it climbs.']);
  return out;
}

// ---------------------------------------------------------------- the rocket
const SATURN_V = 110.6; const LIBERTY = 93;
/** The rocket drawn to scale beside the Statue of Liberty (93 m with its pedestal) and the Saturn V (110.6 m). */
export function rocketSvg(len, diam, name, W = 300, H = 170) {
  if (!(len > 0)) return '';
  const top = 16; const ground = H - 22; const s = (ground - top) / Math.max(len, SATURN_V, LIBERTY);
  const rocket = (x, L, D, cls) => {
    const h = L * s; const w = Math.max(4, D * s); const nose = Math.min(h * 0.14, w * 2.6); const y = ground - h;
    return `<path class="${cls}" d="M${(x - w / 2).toFixed(1)} ${ground} V${(y + nose).toFixed(1)} Q${x} ${(y - 1).toFixed(1)} ${(x + w / 2).toFixed(1)} ${(y + nose).toFixed(1)} V${ground} Z"/>
      <path class="${cls}" d="M${(x - w / 2).toFixed(1)} ${ground} l-${(w * 0.45).toFixed(1)} 0 l${(w * 0.45).toFixed(1)} -${(h * 0.1).toFixed(1)} Z M${(x + w / 2).toFixed(1)} ${ground} l${(w * 0.45).toFixed(1)} 0 l-${(w * 0.45).toFixed(1)} -${(h * 0.1).toFixed(1)} Z"/>`;
  };
  const lib = (x) => { const h = LIBERTY * s; const ped = h * 0.51; const fig = h - ped; const pw = Math.max(10, 20 * s);
    return `<path class="ld-ref" d="M${x - pw / 2} ${ground} h${pw} l-${pw * 0.18} -${ped * 0.35} v-${ped * 0.65} h-${pw * 0.64} v${ped * 0.65} Z
      M${x - pw * 0.2} ${ground - ped} l${pw * 0.06} -${fig * 0.78} q${pw * 0.14} -${fig * 0.1} ${pw * 0.28} 0 l${pw * 0.06} ${fig * 0.78} Z M${x + pw * 0.12} ${ground - ped - fig * 0.7} l${pw * 0.1} -${fig * 0.3} l${pw * 0.06} 0 l-${pw * 0.04} ${fig * 0.32} Z"/>`; };
  const xs = [W * 0.2, W * 0.5, W * 0.8];
  const lab = (x, t, sub, cls = 'ld-tick') => `<text x="${x}" y="${H - 9}" text-anchor="middle" class="${cls}">${esc(t)}</text><text x="${x}" y="${H - 0.5}" text-anchor="middle" class="ld-tick">${esc(sub)}</text>`;
  const short = String(name ?? 'This rocket').replace(/\s+Block\s+\d+.*$/i, '').slice(0, 18);
  return `<svg class="ld-scale" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(short)}, ${fmt(len, 1)} metres tall, beside the Statue of Liberty (93 m) and the Saturn V (110.6 m)">
    <line x1="4" y1="${ground}" x2="${W - 4}" y2="${ground}" class="ld-ground"/>
    ${lib(xs[0])}${rocket(xs[1], len, diam || 3.7, 'ld-me')}${rocket(xs[2], SATURN_V, 10.1, 'ld-ref')}
    <text x="${xs[1]}" y="${(ground - len * s - 5).toFixed(1)}" text-anchor="middle" class="ld-h">${fmt(len, 1)} m</text>
    ${lab(xs[0], 'Statue of Liberty', '93 m')}${lab(xs[1], short, `${fmt(len, 1)} m`, 'ld-tick ld-b')}${lab(xs[2], 'Saturn V', '110.6 m')}</svg>`;
}
/** Every launch of a rocket as a square (green flew, red failed); one square stands for more than one launch above 120. */
export function recordSquares(ok, bad) {
  const n = ok + bad; if (!(n > 0)) return '';
  const per = n > 120 ? Math.ceil(n / 120) : 1; const okN = Math.round(ok / per); const badN = Math.max(bad ? 1 : 0, Math.round(bad / per));
  return `<span class="ld-pips" role="img" aria-label="${fmt(ok)} successful and ${fmt(bad)} failed launches">${Array.from({ length: okN + badN }, (_, i) => `<i class="${i >= okN ? 'bad' : ''}" style="--i:${Math.min(i, 120)}"></i>`).join('')}</span>${per > 1 ? `<small class="ld-per">one square = ${fmt(per)} launches</small>` : ''}`;
}
const CAR_KG = 1500; const JUMBO_T = 400;

// ---------------------------------------------------------------- the open launch (shared with the globe)
export const ld = { id: null, l: null, fat: null, builtAt: 0, timer: null, az: null, orbit: null, landing: null };

export function launchHtml(l) {
  const vids = (l.vids ?? []).filter((v, i, a) => a.findIndex((x) => x.url === v.url) === i).slice(0, 2);
  return `<div class="ld" data-launch="${esc(l.id)}">
    ${l.image ? `<img class="newsimg" src="${esc(l.image)}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
    <p class="cd-line" id="ld-line"></p>
    <div class="ld-count" id="ld-count"><b class="countdown" data-net="${l.net}">${countdown(l.net - Date.now())}</b><span id="ld-status"></span></div>
    ${vids.length ? `<div class="row">${vids.map((v, i) => `<a class="btn${v.live ? '' : ' ghost'}" href="${esc(v.url)}" target="_blank" rel="noopener"${v.title ? ` title="${esc(v.title)}"` : ''}>${v.live ? '● Watch live' : i ? 'Another webcast' : 'Watch webcast'}</a>`).join('')}</div>` : ''}
    <div class="cy-now-box" id="ld-when"><div class="lm-fact skel"></div></div>
    <div id="ld-wx"></div>
    <details class="qd-sec" open id="ld-plan-sec"><summary><span>Flight plan</span><small id="ld-plan-sum"></small></summary><div id="ld-plan"></div></details>
    <details class="qd-sec" open><summary><span>Where it goes</span><small id="ld-where-sum"></small></summary><div id="ld-where"></div></details>
    <details class="qd-sec" id="ld-crew-sec" hidden><summary><span>Crew</span><small id="ld-crew-sum"></small></summary><div id="ld-crew"></div></details>
    <details class="qd-sec"><summary><span>The rocket</span><small id="ld-rocket-sum"></small></summary><div id="ld-rocket"></div></details>
    <details class="qd-sec" id="ld-boost-sec" hidden><summary><span>Booster</span><small id="ld-boost-sum"></small></summary><div id="ld-boost"></div></details>
    <details class="qd-sec"><summary><span>Mission</span><small id="ld-mission-sum"></small></summary><div id="ld-mission"></div></details>
    <details class="qd-sec"><summary><span>The pad</span><small id="ld-pad-sum"></small></summary><div id="ld-pad"></div></details>
  </div>`;
}
const setSum = (id, t) => { const s = document.getElementById(id); if (s) s.textContent = t; };
const STATUS_TONE = { Go: 'ok', Success: 'ok', TBC: 'warn', TBD: 'warn', Hold: 'warn', 'In Flight': 'ok', Failure: 'bad', 'Partial Failure': 'bad' };

/** The flight plan as a list; steps already done are ticked, the next one is marked, updated every second. */
function planHtml(plan) {
  return `<ol class="ld-plan">${plan.map((p, i) => `<li data-sec="${p.sec}" style="--i:${i}"><span class="ld-t">${tClock(p.sec)}</span><span><b>${esc(p.label)}</b>${p.about ? `<small>${esc(p.about)}</small>` : ''}</span></li>`).join('')}</ol>`;
}
function planTick(el, net) {
  const e = (Date.now() - net) / 1000; let marked = false;
  for (const li of el.querySelectorAll('li[data-sec]')) {
    const s = Number(li.dataset.sec); const done = e >= s; const next = !done && !marked; if (next) marked = true;
    const cls = done ? 'done' : next ? 'next' : ''; if (li.className !== cls) li.className = cls;
  }
}

/** Fill the launch page. */
export async function launchFill(l, { stillOpen, countryAt, refresh, byIso3 = () => null }) {
  clearInterval(ld.timer);
  const r = l.raw ?? {}; const cfg = r.rocket?.configuration ?? {}; const pad = r.pad ?? {}; const loc = pad.location ?? {};
  const lat = l.lat; const lng = l.lng; const cc = loc.country_code ?? pad.country_code ?? '';
  const orbit = targetOrbit({ name: l.name, mission: l.mission, orbit: l.orbit, orbitAbbrev: r.mission?.orbit?.abbrev }, lat, lng, cc);
  const { az, direct } = launchAzimuth(lat, orbit.inc, orbit.south);
  const stages = r.rocket?.launcher_stage ?? []; const land = stages.find((s) => s.landing?.attempt) ?? null;
  const plan = flightPlan(r);
  const landSec = plan.find((p) => /Booster lands/.test(p.label))?.sec ?? null;
  const landing = land ? { km: land.landing.downrange_distance ?? null, rtls: /RTLS|Landing Zone|LZ-/i.test(`${land.landing.type?.abbrev ?? ''} ${land.landing.location?.name ?? ''}`), name: land.landing.location?.name ?? '', abbrev: land.landing.location?.abbrev ?? '', type: land.landing.type?.name ?? '' } : null;
  Object.assign(ld, { id: l.id, l, fat: null, builtAt: 0, az, orbit, landing });

  // where, and the world count
  // a pad on the shore can sit just outside the country outline, so look a little around it too
  let country = countryAt(lat, lng);
  for (let k = 0; !country && k < 16; k++) { const [a, b] = destination(lat, lng, k * 45, (k < 8 ? 3 : 8) / KM_PER_DEG); country = countryAt(a, b); }
  country ??= byIso3(cc); // or by the pad's own country code
  const cname = country?.properties?.name; const ccode = country?.properties?.['ISO3166-1-Alpha-2'];
  const line = document.getElementById('ld-line');
  if (line) line.innerHTML = `From ${esc(pad.name || l.pad)}${cname ? `, <button class="linkish" data-country-cc="${esc(ccode)}">${esc(cname)}</button>` : ''}${r.orbital_launch_attempt_count ? ` · the world's <b>${ord(r.orbital_launch_attempt_count)}</b> orbital launch attempt${r.orbital_launch_attempt_count_year ? `, ${ord(r.orbital_launch_attempt_count_year)} of ${new Date(l.net).getUTCFullYear()}` : ''}` : ''}`;

  // status and how sure the time is
  const st = document.getElementById('ld-status');
  if (st) {
    const prec = r.net_precision?.name; const ws = Date.parse(r.window_start); const we = Date.parse(r.window_end); const win = Number.isFinite(ws) && Number.isFinite(we) ? (we - ws) / 60_000 : null;
    st.innerHTML = `<span class="ld-chip tone-${STATUS_TONE[l.abbrev] ?? 'warn'}" title="${esc(r.status?.description ?? '')}">${esc(l.status || '—')}</span>
      ${prec && !/^(Second|Minute)$/i.test(prec) ? `<small>time accurate to the ${esc(prec.toLowerCase())}</small>` : ''}
      ${win != null && prec && /^(Second|Minute|Hour)$/i.test(prec) ? `<small>${win < 1 ? 'instantaneous window: it must go on the second' : `window ${fmt(win)} min`}</small>` : ''}
      ${l.prob != null ? `<small>${fmt(l.prob)}% chance of good weather</small>` : ''}
      ${r.holdreason ? `<small class="ld-warn">Hold: ${esc(r.holdreason)}</small>` : ''}${r.failreason ? `<small class="ld-warn">${esc(r.failreason)}</small>` : ''}`;
  }

  // when: your time, the pad's time and the light
  const when = document.getElementById('ld-when'); const light = launchLight(lat, lng, l.net);
  if (when) {
    let padTime = ''; try { padTime = loc.timezone_name ? new Date(l.net).toLocaleString('en-GB', { timeZone: loc.timezone_name, weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : ''; } catch { padTime = ''; }
    const mine = new Date(l.net).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    when.innerHTML = `<div class="cy-wx ld-when"><span class="cy-wx-g tone-${light.key === 'day' ? 'ochre' : 'blue'}">${unitSvg(light.icon, 30)}</span><div><b class="ld-word">${esc(light.word)}</b><span>${esc(light.line)}</span></div>
      <dl class="cy-wx-dl"><dt>Your time</dt><dd>${esc(mine)}</dd>${padTime ? `<dt>At the pad</dt><dd>${esc(padTime)}</dd>` : ''}<dt>UTC</dt><dd>${esc(new Date(l.net).toISOString().slice(11, 16))}</dd></dl></div>`;
  }

  // the flight plan
  const pEl = document.getElementById('ld-plan');
  if (pEl) {
    if (plan.length) { pEl.innerHTML = `${planHtml(plan)}<p class="cd-key">Times from lift-off, from the published timeline. Steps already done are ticked; the next one is marked.</p>`; planTick(pEl, l.net); setSum('ld-plan-sum', `${fmt(plan.length)} steps`); }
    else { pEl.innerHTML = `<p class="cd-key">${esc(l.provider || 'The launch provider')} has not published a step-by-step timeline for this flight. Most rockets reach orbit about 8 to 10 minutes after lift-off.</p>`; setSum('ld-plan-sum', 'not published'); }
  }

  // where it goes
  const wEl = document.getElementById('ld-where');
  if (wEl) {
    const boost = spinBoost(lat);
    const climb = orbit.kind === 'sub' ? [] : pathPoints(lat, lng, az, 520, 40).slice(1);
    const under = []; for (const [a, b] of climb) { const f = countryAt(a, b); const n = f ? f.properties.name : waterName(a, b); if (under.at(-1)?.n !== n) under.push({ n, cc: f?.properties?.['ISO3166-1-Alpha-2'] ?? null }); }
    const overLand = climb.slice(0, 3).filter(([a, b]) => countryAt(a, b)).length >= 2;
    const insert = orbit.kind === 'sub' ? null : pathAt(lat, lng, az, 520);
    wEl.innerHTML = `<div class="ev-head tone-ochre"><span class="ev-g ld-compass" style="--az:${az.toFixed(0)}deg">${unitSvg('rocket', 30)}</span><div><b class="ev-big">${fmt(az)}° · ${esc(dirWord(az))}</b><span>${orbit.kind === 'sub' ? 'up and back down' : `the heading it leaves on, for an orbit tilted ${fmt(direct ? orbit.inc : Math.abs(lat), 1)}°`}</span></div></div>
      <p class="cd-key"><b>${esc(l.orbit || 'Orbit not given')}.</b> ${orbit.estimated ? 'Estimated from' : 'Set by'} ${esc(orbit.basis)}.${direct ? '' : ` That tilt is lower than the pad's latitude, ${fmt(Math.abs(lat), 1)}°, so it starts due east and the rocket must turn later, at a cost in fuel (a "dogleg").`}</p>
      ${under.length ? `<p class="cd-key">Its climb to orbit passes over ${under.map((u) => (u.cc ? `<button class="linkish" data-country-cc="${esc(u.cc)}">${esc(u.n)}</button>` : esc(u.n))).join(' → ')}${insert ? `, reaching orbit about 1,700 km downrange some 8½ minutes after lift-off (drawn on the globe in orange, then its first orbit in lilac)` : ''}.${overLand ? ' <b>This pad is inland:</b> spent stages fall on land downrange, so the areas below are cleared.' : ''}</p>` : ''}
      <p class="cd-key">Earth's spin carries this pad east at <b>${fmt(boost)} m/s</b> (${fmt(boost * 3.6)} km/h), free speed for a rocket going east: ${fmt((boost / 7800) * 100, 1)}% of the 7,800 m/s orbit needs.${orbit.kind === 'escape' ? ' After reaching a parking orbit it fires again to leave Earth altogether.' : orbit.kind === 'high' ? ' It first reaches a low parking orbit, then fires again to climb towards 35,786 km.' : ''}</p>
      ${landing ? `<p class="cd-key">${unitSvg('anchor', 14)} The booster ${landing.rtls ? `flies back and lands near the pad${landing.name ? ` at ${esc(landing.name)}` : ''}` : `lands on ${landing.type ? `the ${esc(landing.type.toLowerCase().replace(/^autonomous spaceport drone ship$/, 'drone ship'))}` : ''} <b>${esc(landing.name)}</b>${landing.abbrev && landing.abbrev !== landing.name ? ` (${esc(landing.abbrev)})` : ''}${landing.km ? `, ${fmt(landing.km)} km downrange` : ''}`}${landSec != null ? ` at ${tClock(landSec)}` : ''}, marked on the globe.</p>` : ''}`;
    setSum('ld-where-sum', r.mission?.orbit?.abbrev && r.mission.orbit.abbrev !== 'N/A' ? r.mission.orbit.abbrev : dirWord(az));
  }

  // the crew
  const crew = r.rocket?.spacecraft_stage?.launch_crew ?? []; const craft = r.rocket?.spacecraft_stage;
  const cSec = document.getElementById('ld-crew-sec'); const cEl = document.getElementById('ld-crew');
  if (cSec && cEl && (crew.length || craft?.spacecraft)) {
    cSec.hidden = false; if (crew.length) cSec.open = true;
    cEl.innerHTML = `${craft?.spacecraft ? `<p class="cd-key">${esc(craft.spacecraft.name)}${craft.spacecraft.serial_number ? ` (${esc(craft.spacecraft.serial_number)})` : ''}${craft.destination ? ` to <b>${esc(craft.destination)}</b>` : ''}.</p>` : ''}
      ${crew.length ? `<ul class="ld-crew">${crew.map((c, i) => { const a = c.astronaut ?? {}; const dob = Date.parse(a.date_of_birth); const age = Number.isFinite(dob) ? Math.floor((l.net - dob) / (365.25 * 86_400_000)) : null; const days = isoSeconds(a.time_in_space); const first = !a.first_flight || Date.parse(a.first_flight) >= l.net - 86_400_000;
        return `<li style="--i:${i}">${a.profile_image ? `<img src="${esc(a.profile_image)}" alt="" loading="lazy" onerror="this.remove()"/>` : `<span class="ld-face">${unitSvg('person', 22)}</span>`}<span><b>${a.wiki ? `<a href="${esc(a.wiki)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name ?? '—')}</b><small>${esc(c.role?.role ?? 'Crew')}${a.agency?.name ? ` · ${esc(a.agency.abbrev || a.agency.name)}` : ''}${a.nationality ? ` · ${esc(a.nationality)}` : ''}</small><small>${age != null ? `${fmt(age)} years old · ` : ''}${first ? '<b>first spaceflight</b>' : days ? `${fmt(days / 86400)} days in space so far` : 'has flown before'}</small></span></li>`; }).join('')}</ul>` : ''}`;
    setSum('ld-crew-sum', crew.length ? `${fmt(crew.length)} on board` : 'uncrewed');
  }

  // the rocket
  const rEl = document.getElementById('ld-rocket');
  if (rEl) {
    const ok = cfg.successful_launches ?? 0; const bad = cfg.failed_launches ?? 0; const n = ok + bad;
    const thrustT = cfg.to_thrust ? cfg.to_thrust / 9.80665 : null; const twr = thrustT && cfg.launch_mass ? thrustT / cfg.launch_mass : null;
    const facts = [
      cfg.leo_capacity ? `<b>${fmt(cfg.leo_capacity)} kg</b> to low Earth orbit (LEO), as much as ${fmt(cfg.leo_capacity / CAR_KG)} cars` : '',
      cfg.gto_capacity ? `<b>${fmt(cfg.gto_capacity)} kg</b> to geostationary transfer orbit (GTO)` : '',
      cfg.launch_mass ? `<b>${fmt(cfg.launch_mass)} tonnes</b> at lift-off${cfg.launch_mass >= JUMBO_T * 0.6 ? `, as heavy as ${fmt(cfg.launch_mass / JUMBO_T, 1)} fully loaded jumbo jets` : ''}` : '',
      thrustT ? `<b>${fmt(cfg.to_thrust)} kilonewtons</b> of thrust, a push of ${fmt(thrustT)} tonnes${twr ? `; it rises because the push beats its weight ${fmt(twr, 1)} to 1` : ''}` : '',
      cfg.max_stage ? `${fmt(cfg.max_stage)} stage${cfg.max_stage === 1 ? '' : 's'}${cfg.reusable ? ', first stage reusable' : ''}` : '',
    ].filter(Boolean);
    rEl.innerHTML = `${rocketSvg(cfg.length, cfg.diameter, cfg.name || l.rocket)}
      ${facts.length ? `<ul class="ld-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${n ? `<div class="ld-rec"><p class="cd-key"><b>${fmt(ok)} of ${fmt(n)} launches succeeded</b> (${fmt((ok / n) * 100, 1)}%)${cfg.consecutive_successful_launches ? `, the last ${fmt(cfg.consecutive_successful_launches)} in a row` : ''}${cfg.maiden_flight ? `; flying since ${esc(dateWords(Date.parse(cfg.maiden_flight)))}` : ''}.</p>${recordSquares(ok, bad)}</div>` : '<p class="cd-key">Its first flight: no launches on record yet.</p>'}
      ${cfg.attempted_landings ? `<p class="cd-key">Booster landings: ${fmt(cfg.successful_landings ?? 0)} of ${fmt(cfg.attempted_landings)} attempts.</p>` : ''}
      ${cfg.description ? `<p class="cd-key">${esc(cfg.description)}</p>` : ''}
      ${cfg.wiki_url ? `<p><a href="${esc(cfg.wiki_url)}" target="_blank" rel="noopener">${esc(cfg.full_name || cfg.name)} on Wikipedia</a></p>` : ''}`;
    setSum('ld-rocket-sum', cfg.length ? `${fmt(cfg.length, 1)} m tall` : n ? `${fmt(n)} launches` : 'first flight');
  }

  // the booster
  const bSec = document.getElementById('ld-boost-sec'); const bEl = document.getElementById('ld-boost');
  if (bSec && bEl && stages.length) {
    bSec.hidden = false;
    bEl.innerHTML = `<ul class="ld-boost">${stages.map((s) => { const b = s.launcher ?? {}; const nth = s.launcher_flight_number; const L = s.landing; const named = b.serial_number && !/^unknown/i.test(b.serial_number);
      const life = [nth ? (nth === 1 ? '<b>Its first flight</b>' : `Its <b>${ord(nth)} flight</b>`) : '', b.first_launch_date && nth > 1 ? `first flew ${esc(dateWords(Date.parse(b.first_launch_date)))}` : '',
        s.turn_around_time_days != null && nth > 1 ? `${fmt(s.turn_around_time_days)} days since its last flight${s.previous_flight?.name ? ` (${esc(s.previous_flight.name.split('|').pop().trim())})` : ''}` : ''].filter(Boolean).join('; ');
      return `<li><b>${named ? esc(b.serial_number) : 'Booster not yet named'}</b><small>${esc(s.type ?? 'Core')}${named ? '' : ': the provider picks it nearer the day'}</small>
        ${life ? `<span>${life}.</span>` : ''}
        ${L?.attempt ? `<span>${L.success === true ? 'Landed' : L.success === false ? 'Landing failed' : 'Lands'} on ${esc(L.location?.name ?? 'its landing site')}${L.downrange_distance ? `, ${fmt(L.downrange_distance)} km downrange` : ''}.${L.location?.successful_landings ? ` ${fmt(L.location.successful_landings)} boosters have landed there.` : ''}</span>` : L ? '<span>Not recovered: it falls into the sea.</span>' : ''}</li>`; }).join('')}</ul>`;
    const s0 = stages[0]; const sn = s0.launcher?.serial_number && !/^unknown/i.test(s0.launcher.serial_number) ? s0.launcher.serial_number : 'to be named'; setSum('ld-boost-sum', `${sn}${s0.launcher_flight_number ? ` · flight ${s0.launcher_flight_number}` : ''}`);
  }

  // the mission
  const mEl = document.getElementById('ld-mission');
  if (mEl) {
    const m = r.mission ?? {}; const who = (m.agencies ?? []).map((a) => a.name).filter(Boolean); const upd = (r.updates ?? [])[0]; const patches = (r.mission_patches ?? []).filter((p) => /^https:/.test(p.image_url ?? '')).slice(0, 3);
    mEl.innerHTML = `${patches.length ? `<div class="ld-patches">${patches.map((p) => `<img src="${esc(p.image_url)}" alt="${esc(p.name ?? 'Mission patch')}" title="${esc(p.name ?? '')}" loading="lazy" onerror="this.remove()"/>`).join('')}</div>` : ''}
      <p>${esc(l.desc || 'No mission description published yet.')}</p>
      <dl class="sd-rec"><dt>Kind</dt><dd>${esc(l.mtype || '—')}</dd>${who.length ? `<dt>For</dt><dd>${esc(who.join(', '))}</dd>` : ''}${(r.program ?? []).length ? `<dt>Programme</dt><dd>${esc(r.program.map((p) => p.name).join(', '))}</dd>` : ''}<dt>Launched by</dt><dd>${esc(l.provider || '—')}${r.launch_service_provider?.successful_launches != null ? `, ${fmt(r.launch_service_provider.successful_launches)} successful launches` : ''}</dd></dl>
      ${upd?.comment ? `<p class="cd-key ld-upd">Latest note${upd.created_by ? ` from ${esc(upd.created_by)}` : ''}${Date.parse(upd.created_on) ? `, ${esc(dateWords(Date.parse(upd.created_on)))}` : ''}: “${esc(upd.comment)}”</p>` : ''}
      ${(l.info ?? []).length ? `<p>${l.info.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>`).join(' · ')}</p>` : ''}`;
    setSum('ld-mission-sum', l.mtype || '');
  }

  // the pad
  const padEl = document.getElementById('ld-pad');
  if (padEl) {
    const turn = isoSeconds(r.pad_turnaround); const rows = [
      r.pad_launch_attempt_count ? `The <b>${ord(r.pad_launch_attempt_count)}</b> launch from this pad${r.pad_launch_attempt_count_year ? `, ${ord(r.pad_launch_attempt_count_year)} this year` : ''}.` : '',
      turn ? `${turn < 86400 * 2 ? `${fmt(turn / 3600)} hours` : `${fmt(turn / 86400)} days`} since its last launch.` : '',
      r.location_launch_attempt_count && loc.name ? `The ${ord(r.location_launch_attempt_count)} from ${esc(loc.name.split(',')[0])}.` : '',
      r.agency_launch_attempt_count && l.provider ? `${esc(l.provider)}'s ${ord(r.agency_launch_attempt_count)} launch${r.agency_launch_attempt_count_year ? `, ${ord(r.agency_launch_attempt_count_year)} this year` : ''}.` : '',
    ].filter(Boolean);
    padEl.innerHTML = `${rows.length ? `<ul class="ld-facts">${rows.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      <p class="cd-key">A pad's latitude, ${fmt(Math.abs(lat), 1)}° ${lat >= 0 ? 'north' : 'south'}, is the lowest orbit tilt it can reach without a costly turn, which is why pads near the equator are prized for geostationary missions and most face an ocean, where spent stages can fall safely.</p>
      ${pad.wiki_url ? `<p><a href="${esc(pad.wiki_url)}" target="_blank" rel="noopener">About ${esc(loc.name?.split(',')[0] || pad.name)}</a>${pad.map_url ? ` · <a href="${esc(pad.map_url)}" target="_blank" rel="noopener">Map</a>` : ''}</p>` : ''}
      <div id="ld-see"></div>`;
    setSum('ld-pad-sum', r.pad_launch_attempt_count ? `launch ${fmt(r.pad_launch_attempt_count)}` : '');
  }

  // a live tick: the flight plan, and during the flight the rocket's modelled position on the globe
  const tick = () => {
    if (!stillOpen() || ld.id !== l.id) { clearInterval(ld.timer); return; }
    const pe = document.getElementById('ld-plan'); if (pe) planTick(pe, l.net);
    const e = (Date.now() - l.net) / 1000; if (e >= 0 && e <= COAST_SEC[orbit.kind] + 60 && Date.now() - ld.builtAt > 2000) { ld.fat?.obj?.geometry?.dispose?.(); ld.fat = null; refresh(); }
  };
  ld.timer = setInterval(tick, 1000);
  refresh();

  // people near it, and the weather at the pad at lift-off (both from the network)
  const ahead = l.net - Date.now(); const wxOk = ahead > -3600_000 && ahead < 15.5 * 86_400_000;
  const [list, w] = await Promise.all([cities().catch(() => []), wxOk ? getFeed('openmeteo', wxUrl(lat, lng), { ttl: 30 * 60_000 }).catch(() => null) : null]);
  if (!stillOpen() || ld.id !== l.id) return;
  const near = list.filter((c) => Math.abs(c.lat - lat) < 3 && haversineKm(lat, lng, c.lat, c.lng) <= 300).sort((a, b) => (b.pop || 0) - (a.pop || 0));
  const pop = near.reduce((s, c) => s + (c.pop || 0), 0);
  const see = document.getElementById('ld-see');
  if (see) see.innerHTML = `<p class="cd-key">${pop ? `<b>${big(pop)} people</b> in ${fmt(near.length)} cities on the map live within 300 km (the circle on the globe)${near.length ? `, the biggest ${esc(near.slice(0, 3).map((c) => c.name).join(', '))}` : ''}: close enough to watch it climb in a clear sky.` : 'No city on the map lies within 300 km: it climbs over empty country or sea.'}</p>`;
  const x = wxOk ? wxAt(w, l.net) : null; const wEl2 = document.getElementById('ld-wx');
  if (wEl2) {
    if (x) {
      const watch = wxWatch(x);
      wEl2.innerHTML = `<details class="qd-sec" open><summary><span>Weather at lift-off</span><small>${watch.length ? `${fmt(watch.length)} to watch` : 'looks fine'}</small></summary>
        <dl class="cy-wx-dl ld-wx"><dt>Wind</dt><dd>${fmt(x.wind)} km/h${x.gust != null ? `, gusts ${fmt(x.gust)}` : ''}</dd><dt>Cloud</dt><dd>${fmt(x.cloud)}%</dd><dt>Rain chance</dt><dd>${fmt(x.rain)}%</dd><dt>10 km up</dt><dd>${x.jet != null ? `${fmt(x.jet)} km/h` : '—'}</dd></dl>
        ${watch.length ? `<ul class="ld-watch">${watch.map(([ic, t]) => `<li>${unitSvg(ic, 16)}<span>${esc(t)}</span></li>`).join('')}</ul>` : '<p class="cd-key">Nothing in the forecast for that hour that usually stops a launch.</p>'}
        ${r.weather_concerns ? `<p class="cd-key">Forecasters: ${esc(r.weather_concerns)}</p>` : ''}
        <p class="cd-key">The Open-Meteo forecast for the pad at the launch hour (${fmt(x.temp)}°C). The range's own weather officers make the call.</p></details>`;
    } else wEl2.innerHTML = '';
  }
}

/** On the globe: the climb (orange), the first orbit (lilac), the booster's landing spot and a 300 km circle, in one draw
 *  call; while it flies, a small ring where the rocket should be by now. */
export function launchOverlay(ctx, sel) {
  if (!ld.l || sel?.d?.id !== ld.id) return { custom: [] };
  if (!ld.fat) {
    const l = ld.l; const lines = []; const k = ld.orbit?.kind ?? 'leo'; const az = ld.az ?? 90;
    lines.push({ pts: smallCircle(l.lat, l.lng, 300 / KM_PER_DEG, 120), color: '#ffc79e', width: 1.1, alt: 0.003 });
    if (k === 'sub') lines.push({ pts: pathPoints(l.lat, l.lng, az, 240, 20, { insKm: 300, insSec: 240 }), color: '#ff9e5e', width: 3, alt: 0.006 });
    else {
      lines.push({ pts: pathPoints(l.lat, l.lng, az, 520, 20), color: '#ff9e5e', width: 3.2, alt: 0.006 });
      lines.push({ pts: pathPoints(l.lat, l.lng, az, COAST_SEC[k], 30, { orbitMin: ORBIT_MIN[k] }).slice(17), color: '#c9b8ff', width: 1.8, alt: 0.006 });
    }
    const L = ld.landing;
    if (L) {
      const at = L.rtls || !L.km ? destination(l.lat, l.lng, az + 180, 8 / KM_PER_DEG) : destination(l.lat, l.lng, az, L.km / KM_PER_DEG);
      const d = 22 / KM_PER_DEG;
      for (const b of [45, 135]) lines.push({ pts: [destination(at[0], at[1], b, d), destination(at[0], at[1], b + 180, d)], color: '#7ed6c4', width: 2.6, alt: 0.006 });
      lines.push({ pts: smallCircle(at[0], at[1], 30 / KM_PER_DEG, 40), color: '#7ed6c4', width: 1.4, alt: 0.006 });
    }
    const e = (Date.now() - l.net) / 1000;
    if (e >= 0 && e <= COAST_SEC[k] + 60) { const [a, b] = pathAt(l.lat, l.lng, az, e, k === 'sub' ? { insKm: 300, insSec: 240 } : { orbitMin: ORBIT_MIN[k] }); lines.push({ pts: smallCircle(a, b, 45 / KM_PER_DEG, 32), color: '#ff4d4d', width: 2.8, alt: 0.008 }); }
    ld.fat = ctx.fatLines(lines, { opacity: 0.92 }); ld.builtAt = Date.now();
  }
  return { custom: ld.fat ? [ld.fat] : [] };
}
export function launchClose() { clearInterval(ld.timer); ld.fat?.obj?.geometry?.dispose?.(); Object.assign(ld, { id: null, l: null, fat: null, builtAt: 0, timer: null, az: null, orbit: null, landing: null }); }
