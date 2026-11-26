// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.37: visitors from other stars. The three objects known to have come into the solar system
// from interstellar space and left again: 1I/ʻOumuamua (2017), 2I/Borisov (2019) and 3I/ATLAS (2025). Each is on an
// open (hyperbolic) path round the Sun, eccentricity above 1, so unlike the comets (comets.js) it never comes back.
//
// Elements are from NASA JPL's Small-Body Database, read through Wolfram|Alpha on 23 November 2026: perihelion distance
// q (AU), eccentricity e, inclination i, longitude of the ascending node and argument of perihelion (degrees, ecliptic
// J2000). The time of perihelion is given to about an hour (`tp`); see docs/ASSUMPTIONS.md (v2.37).
// Pure functions; Astronomy Engine (A) is passed in for the Earth's place.
import { whereAU } from './comets.js';

const D = Math.PI / 180; const OBL = 23.4392911 * D; const cO = Math.cos(OBL); const sO = Math.sin(OBL);
const DAY = 864e5; const AU_KM = 149597870.7; const C_KM_S = 299792.458;
const K2 = 0.01720209895 ** 2; // GM of the Sun in AU³/day²
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const ymd = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const dl = (rows) => `<dl class="sd-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const len = (v) => Math.hypot(v[0], v[1], v[2]);

export const VISITORS = [
  { id: 'oumuamua', name: 'ʻOumuamua', code: '1I/ʻOumuamua (A/2017 U1)', n: 1, dot: '#ff9f6b', q: 0.2559, e: 1.2011, i: 122.742, node: 24.597, w: 241.811, tp: Date.UTC(2017, 8, 9, 11, 45),
    found: 'Found on 19 October 2017 by Robert Weryk with the Pan-STARRS1 telescope on Haleakalā, Hawaiʻi, already on its way out: it had passed closest to the Sun on 9 September and to the Earth on 14 October, 24 million km away.',
    size: 'perhaps 100–400 m long and very elongated or flat; it was too small and faint to see its shape, which is worked out from how its brightness changed as it tumbled',
    known: 'The first object seen coming from another star. It showed no gas or dust, yet it sped up slightly as it left, as if pushed by gas too faint to see; what it is made of is still argued about. Its name is Hawaiian for a scout, or a messenger from afar arriving first.' },
  { id: 'borisov', name: 'Borisov', code: '2I/Borisov (C/2019 Q4)', n: 2, dot: '#9fe6ff', q: 2.00652, e: 3.35648, i: 44.05264, node: 308.1477, w: 209.1237, tp: Date.UTC(2019, 11, 8, 13, 0),
    found: 'Found on 30 August 2019 by Gennadiy Borisov, an amateur astronomer, with a telescope he built himself in Crimea, while it was still coming in.',
    size: 'a nucleus well under 1 km across, inside a cloud of gas and dust tens of thousands of km wide',
    known: 'The first comet known from another star, and it looked much like ours, though richer in carbon monoxide ice, a hint that it formed somewhere very cold. Hubble watched part of its nucleus break off in March 2020.' },
  { id: 'atlas3i', name: '3I/ATLAS', code: '3I/ATLAS (C/2025 N1)', n: 3, dot: '#c7a6ff', q: 1.35642, e: 6.13941, i: 175.1131, node: 322.1569, w: 128.01, tp: Date.UTC(2025, 9, 29, 11, 30),
    found: 'Found on 1 July 2025 by the ATLAS (Asteroid Terrestrial-impact Last Alert System) survey telescope at Río Hurtado, Chile, about four months before it passed closest to the Sun.',
    size: 'a comet with a nucleus no more than a few km across (Hubble’s limit was about 5.6 km; probably much smaller)',
    known: 'The fastest of the three, and the most open path: it goes round the Sun almost in the planets’ plane but the wrong way round. It passed within about 30 million km of Mars on 3 October 2025, where spacecraft photographed it, and by Jupiter in March 2026. Its speed suggests it may be older than the Sun, from the Milky Way’s old thick disc.' },
];
export const VISITOR = Object.fromEntries(VISITORS.map((v) => [v.id, v]));

/** The shape of visitor v's path: semi-major axis (negative), speed far from the Sun (km/s), the angle it is turned through. */
export function pathOf(v) {
  const a = v.q / (1 - v.e); const n = Math.sqrt(K2 / (-a) ** 3); // radians a day
  const vInf = Math.sqrt(K2 / -a) * AU_KM / 86400;
  return { a, n, vInf, turn: 2 * Math.asin(1 / v.e) / D, nuMax: Math.acos(-1 / v.e) / D };
}

/** Visitor v at time ms: [x, y, z] in AU from the Sun, EQJ (like comets.js). Hyperbolic Kepler: M = e sinh H − H. */
export function visitorPos(v, ms) {
  const o = pathOf(v); const M = o.n * (ms - v.tp) / DAY;
  let H = Math.asinh(M / v.e); for (let k = 0; k < 60; k++) { const d = (v.e * Math.sinh(H) - H - M) / (v.e * Math.cosh(H) - 1); H -= d; if (Math.abs(d) < 1e-13) break; }
  const xv = -o.a * (v.e - Math.cosh(H)); const yv = -o.a * Math.sqrt(v.e * v.e - 1) * Math.sinh(H);
  const w = v.w * D; const N = v.node * D; const I = v.i * D;
  const xo = xv * Math.cos(w) - yv * Math.sin(w); const yo = xv * Math.sin(w) + yv * Math.cos(w);
  const x = xo * Math.cos(N) - yo * Math.cos(I) * Math.sin(N); const y = xo * Math.sin(N) + yo * Math.cos(I) * Math.cos(N); const z = yo * Math.sin(I);
  return [x, y * cO - z * sO, y * sO + z * cO];
}

/** Points along the path from `before` years before perihelion to `after` years after, closer together near the Sun. */
export function visitorPath(v, before = 20, after = 20, steps = 240) {
  const out = []; const span = (y) => Math.sign(y) * Math.sqrt(Math.abs(y));
  for (let k = 0; k <= steps; k++) { const s = -Math.sqrt(before) + (Math.sqrt(before) + Math.sqrt(after)) * k / steps; out.push(visitorPos(v, v.tp + Math.sign(s) * s * s * 365.25 * DAY)); }
  return out;
}

/** Everything about visitor v on `date`: from the Sun and the Earth, speed, closest pass by the Earth. */
export function visitorNow(A, v, date) {
  const ms = date.getTime(); const o = pathOf(v); const p = visitorPos(v, ms); const r = len(p);
  const speed = Math.sqrt(K2 * (2 / r - 1 / o.a)) * AU_KM / 86400;
  let delta = null; let near = null;
  if (A) {
    const earth = (t) => { const e = A.HelioVector(A.Body.Earth, A.MakeTime(new Date(t))); return [e.x, e.y, e.z]; };
    const e = earth(ms); delta = len([p[0] - e[0], p[1] - e[1], p[2] - e[2]]);
    // the closest pass by the Earth: a day-by-day search within a year of perihelion, refined to the hour
    let best = { au: Infinity, ms: 0 };
    for (let t = v.tp - 365 * DAY; t <= v.tp + 365 * DAY; t += DAY) { const q = visitorPos(v, t); const g = earth(t); const d = len([q[0] - g[0], q[1] - g[1], q[2] - g[2]]); if (d < best.au) best = { au: d, ms: t }; }
    for (let t = best.ms - DAY; t <= best.ms + DAY; t += 3600e3) { const q = visitorPos(v, t); const g = earth(t); const d = len([q[0] - g[0], q[1] - g[1], q[2] - g[2]]); if (d < best.au) best = { au: d, ms: t }; }
    near = best;
  }
  return { ...o, pos: p, r, delta, speed, near, outbound: ms > v.tp, yearsSince: (ms - v.tp) / (365.25 * DAY), passedNeptune: r > 30.07 };
}

/** Rows for the solar system card. */
export function visitorRows(A, date) {
  return VISITORS.map((v) => { const n = visitorNow(null, v, date); return { v, r: n.r, vInf: n.vInf, year: new Date(v.tp).getUTCFullYear() }; });
}

/** The page of one visitor. */
export function visitorSections(A, v, date) {
  const n = visitorNow(A, v, date);
  const where = [
    ['From the Sun', `${fmt(n.r, 1)} AU (${fmt(n.r * AU_KM / 1e9, 2)} billion km), ${whereAU(n.r)}`],
    n.delta != null && ['From the Earth', `${fmt(n.delta, 1)} AU; its light takes ${fmt(n.delta * AU_KM / C_KM_S / 3600, 1)} hours to reach us`],
    ['Speed', `${fmt(n.speed, 1)} km/s, ${n.outbound ? 'leaving the solar system' : 'falling in towards the Sun'}`],
    ['Speed in interstellar space', `${fmt(n.vInf, 1)} km/s (${fmt(n.vInf * 3.15576e7 / AU_KM, 1)} AU a year), the speed it came in with and will leave with`],
  ].filter(Boolean);
  const path = [
    ['Closest to the Sun', `${ymd(v.tp)}, ${fmt(v.q, 2)} AU (${fmt(v.q * AU_KM / 1e6, 0)} million km), ${whereAU(v.q)}`],
    n.near && ['Closest to the Earth', `${ymd(n.near.ms)}, ${fmt(n.near.au, 2)} AU (${fmt(n.near.au * AU_KM / 1e6, 0)} million km)`],
    ['Eccentricity', `${fmt(v.e, 2)}: above 1, an open path that never comes back`],
    ['Turned by the Sun through', `${fmt(n.turn, 0)}°`],
    ['Tilt to the planets’ plane', `${fmt(v.i, 0)}°${v.i > 90 ? ' (going round the opposite way to the planets)' : ''}`],
  ].filter(Boolean);
  return sec('Where it is now', dl(where), `${fmt(n.r, 1)} AU from the Sun`, true)
    + sec('Its path through the solar system', dl(path), `e = ${fmt(v.e, 2)}`, true)
    + sec('Found', `<p>${esc(v.found)}</p>`)
    + sec('What it is', `<p><b>Size:</b> ${esc(v.size)}.</p><p>${esc(v.known)}</p>`);
}
