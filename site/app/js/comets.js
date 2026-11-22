// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.32: the famous comets, where they are now and when they come back.
//
// Each comet follows a two-body (Kepler) orbit around the Sun from its osculating elements as published by NASA's
// Jet Propulsion Laboratory Small-Body Database (read through Wolfram|Alpha on 18 November 2026): perihelion
// distance q (AU), eccentricity e, inclination i, longitude of the ascending node and argument of perihelion
// (degrees, ecliptic and equinox J2000) and the date of the last perihelion. A Kepler orbit ignores the pulls of the
// planets and the push of the comet's own jets, so positions drift by a degree or so over a few years and return
// dates by up to months (Halley's: January 2062 here, 28 July 2061 in JPL's full prediction). Plenty at the scale
// of the solar system view; not good enough to point a telescope.
//
// Positions come back in AU from the Sun in the J2000 equator frame (EQJ), the frame Astronomy Engine and cosmos.js use.
// Pure functions; Astronomy Engine (A) is passed in for the Earth's place and the constellation.

const D = Math.PI / 180; const OBL = 23.4392911 * D; const cO = Math.cos(OBL); const sO = Math.sin(OBL);
const DAY = 864e5; const YEAR_D = 365.25; const AU_KM = 149597870.7; const C_KM_S = 299792.458;
const K_DEG = 0.9856076686; // the Gaussian gravitational constant: degrees a day for an orbit of 1 AU
const V_EARTH = 29.7847; // km/s on a circular orbit of 1 AU (vis-viva: v = 29.78 √(2/r − 1/a), r and a in AU)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const jdOf = (ms) => ms / DAY + 2440587.5;
const msOf = (jd) => (jd - 2440587.5) * DAY;
const ymd = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const my = (ms) => new Date(ms).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The planets' average distances from the Sun (AU), for "out past Neptune" and the orbit drawing. */
export const PLANET_AU = [['Mercury', 0.387], ['Venus', 0.723], ['Earth', 1], ['Mars', 1.524], ['Jupiter', 5.203], ['Saturn', 9.537], ['Uranus', 19.19], ['Neptune', 30.07]];

export const COMETS = [
  { id: 'halley', name: 'Halley’s Comet', code: '1P/Halley', dot: '#9fe6ff', q: 0.5751575, e: 0.96792212, i: 162.1952, node: 59.072, w: 112.2128, tp: '1986-02-07',
    nucleus: 'about 15 × 8 km, a dark, peanut-shaped block of ice and dust', showers: ['Eta Aquariids', 'Orionids'],
    known: 'Seen at every return since at least 240 BC; Edmond Halley worked out in 1705 that the comets of 1531, 1607 and 1682 were one and the same, and predicted its return in 1758.',
    next: '28 July 2061 (JPL’s full prediction, with the planets’ pulls)',
    missions: [['Giotto (European Space Agency, ESA)', '1986: flew 596 km from the nucleus and took the first close pictures of a comet’s core'], ['Vega 1 and 2 (Soviet Union)', '1986: flew past at about 8,900 and 8,000 km on the way back from Venus'], ['Suisei and Sakigake (Japan)', '1986: studied its cloud of gas and the solar wind from farther away']] },
  { id: 'encke', name: 'Comet Encke', code: '2P/Encke', dot: '#c9f2a6', q: 0.33623, e: 0.848514, i: 11.5017, node: 334.3121, w: 187.0125, tp: '2023-10-21',
    nucleus: 'about 4.8 km across', showers: ['Taurids'], showerNote: 'two broad, slow showers, the Southern Taurids around 10 October and the Northern Taurids around 12 November: only a few meteors an hour, but known for bright fireballs',
    known: 'The comet with the shortest period of any big comet, 3.3 years. Johann Encke worked out its orbit in 1819; it was only the second comet known to return.',
    missions: [['CONTOUR (NASA)', '2002: meant to fly past in 2003, lost a few weeks after launch']] },
  { id: 'swifttuttle', name: 'Comet Swift–Tuttle', code: '109P/Swift–Tuttle', dot: '#ffd59a', q: 0.9595162, e: 0.96322576, i: 113.4538, node: 139.3812, w: 152.9822, tp: '1992-12-11',
    nucleus: 'about 26 km across: the largest object known to pass this close to the Earth again and again', showers: ['Perseids'],
    known: 'Found by Lewis Swift and Horace Tuttle in 1862. Its orbit crosses close to the Earth’s, but the next few thousand years of its passes have been worked out and none is a hit.',
    missions: [] },
  { id: 'tempeltuttle', name: 'Comet Tempel–Tuttle', code: '55P/Tempel–Tuttle', dot: '#ffb3c7', q: 0.976428, e: 0.9055527, i: 162.4866, node: 235.271, w: 172.5, tp: '1998-02-27',
    nucleus: 'about 3.6 km across', showers: ['Leonids'],
    known: 'Each pass lays a fresh trail of dust; when the Earth runs through a young one the Leonids become a storm, thousands of meteors an hour, as in 1833, 1966 and 1999–2002.',
    missions: [] },
  { id: 'cg67p', name: 'Comet Churyumov–Gerasimenko', code: '67P/Churyumov–Gerasimenko', dot: '#d7c3ff', q: 1.243266, e: 0.6409081, i: 7.04029, node: 50.1356, w: 12.7982, tp: '2022-01-20',
    nucleus: 'two lobes, 4.1 and 2.6 km long, joined by a neck: a “rubber duck” about 10 billion tonnes in mass', showers: [],
    known: 'Found in 1969 on photographs taken by Klim Churyumov and Svetlana Gerasimenko. A pass close to Jupiter in 1959 pulled it into the inner solar system.',
    missions: [['Rosetta (ESA)', '2014–2016: the first spacecraft to orbit a comet, riding with it through its closest pass to the Sun, then landing on it'], ['Philae (ESA)', '12 November 2014: the first landing on a comet; it bounced twice and came to rest in a shadow']] },
  { id: 'halebopp', name: 'Comet Hale–Bopp', code: 'C/1995 O1 (Hale–Bopp)', dot: '#a6c8ff', q: 0.890538, e: 0.994981, i: 89.28759, node: 282.7334, w: 130.4147, tp: '1997-03-29',
    nucleus: 'about 60 km across (estimates run from 40 to 80 km), one of the largest ever seen', showers: [],
    known: 'The Great Comet of 1997: visible to the naked eye for about 18 months, longer than any comet on record. Found by Alan Hale and Thomas Bopp on the same night in July 1995.',
    missions: [] },
];
export const COMET = Object.fromEntries(COMETS.map((c) => [c.id, c]));

/** Semi-major axis (AU), period (days), aphelion (AU) and the last perihelion (Julian day) of comet c. */
export function orbitOf(c) {
  const a = c.q / (1 - c.e); const n = K_DEG / a ** 1.5; // degrees a day
  return { a, n, periodD: 360 / n, years: 360 / n / YEAR_D, Q: a * (1 + c.e), tpJd: jdOf(Date.parse(`${c.tp}T00:00:00Z`)) };
}

/** Comet c at Julian day jd: [x, y, z] in AU from the Sun, EQJ. */
export function cometPos(c, jd) {
  const o = orbitOf(c); let M = ((o.n * (jd - o.tpJd)) % 360) * D; if (M > Math.PI) M -= 2 * Math.PI; if (M < -Math.PI) M += 2 * Math.PI;
  // Kepler's equation by Newton's method; starting at π for very long, thin orbits keeps it from overshooting
  let E = c.e > 0.8 ? (M >= 0 ? Math.PI : -Math.PI) * 0.5 + M * 0.5 : M;
  for (let k = 0; k < 60; k++) { const d = (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
  const xv = o.a * (Math.cos(E) - c.e); const yv = o.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  const w = c.w * D; const N = c.node * D; const I = c.i * D;
  const xo = xv * Math.cos(w) - yv * Math.sin(w); const yo = xv * Math.sin(w) + yv * Math.cos(w);
  const x = xo * Math.cos(N) - yo * Math.cos(I) * Math.sin(N); const y = xo * Math.sin(N) + yo * Math.cos(I) * Math.cos(N); const z = yo * Math.sin(I);
  return [x, y * cO - z * sO, y * sO + z * cO];
}

/** Points around the whole orbit (EQJ, AU from the Sun), crowded near the Sun where the comet turns fast. */
export function orbitPoints(c, steps = 360) {
  const o = orbitOf(c); const out = [];
  for (let k = 0; k <= steps; k++) {
    const E = -Math.PI + (2 * Math.PI * k) / steps; const M = E - c.e * Math.sin(E); // even in E, not in time
    out.push(cometPos(c, o.tpJd + (M / D) / o.n));
  }
  return out;
}

const len = (v) => Math.hypot(v[0], v[1], v[2]);
/** Everything about comet c on `date`: distances, speed, inbound or outbound, the next and last perihelion, where it is in the sky. */
export function cometNow(A, c, date) {
  const o = orbitOf(c); const jd = jdOf(date.getTime());
  const p = cometPos(c, jd); const r = len(p); const r1 = len(cometPos(c, jd + 1));
  let geo = null; let delta = null; let con = null; let elong = null;
  if (A) {
    const t = A.MakeTime(date); const ev = A.HelioVector(A.Body.Earth, t);
    geo = [p[0] - ev.x, p[1] - ev.y, p[2] - ev.z]; delta = len(geo);
    const ra = ((Math.atan2(geo[1], geo[0]) / D + 360) % 360) / 15; const dec = Math.asin(geo[2] / delta) / D;
    try { con = A.Constellation(ra, dec).name; } catch { con = null; }
    const sunDir = [-ev.x, -ev.y, -ev.z]; // from the Earth
    elong = Math.acos(Math.max(-1, Math.min(1, (geo[0] * sunDir[0] + geo[1] * sunDir[1] + geo[2] * sunDir[2]) / (delta * len(sunDir))))) / D;
  }
  const k = Math.floor((jd - o.tpJd) / o.periodD); const lastJd = o.tpJd + k * o.periodD; const nextJd = lastJd + o.periodD;
  const v = V_EARTH * Math.sqrt(Math.max(0, 2 / r - 1 / o.a));
  return { ...o, pos: p, r, delta, geo, con, elong, inbound: r1 < r, v, vPeri: V_EARTH * Math.sqrt(2 / c.q - 1 / o.a), vAph: V_EARTH * Math.sqrt(2 / o.Q - 1 / o.a),
    lastMs: msOf(lastJd), nextMs: msOf(nextJd), yearsToNext: (nextJd - jd) / YEAR_D, active: r < 3 };
}

/** "between the orbits of Saturn and Uranus" for a distance in AU. */
export function whereAU(r) {
  if (r < PLANET_AU[0][1]) return 'inside Mercury’s orbit';
  for (let k = 0; k < PLANET_AU.length - 1; k++) if (r < PLANET_AU[k + 1][1]) return `between the orbits of ${PLANET_AU[k][0]} and ${PLANET_AU[k + 1][0]}`;
  return r < 50 ? 'beyond Neptune’s orbit, out among the Kuiper belt' : 'far beyond Neptune and the Kuiper belt';
}

/** How long the tail is now, roughly: none outside about 3 AU (the ice does not turn to gas), growing as it nears the Sun. */
export function tailAU(r) { return r >= 3 ? 0 : Math.min(0.6, 0.12 * (3 - r) / Math.max(r, 0.3)); }

/** A top-down drawing (on a square-root scale of distance) of the orbit, the planets' orbits, the comet and the Earth. */
export function orbitSvg(c, now, size = 260) {
  const o = orbitOf(c); const R = size / 2 - 8; const rMax = Math.sqrt(Math.max(o.Q, 1.6) * 1.04);
  // to the ecliptic plane: undo the tilt of the equator
  const ecl = (p) => [p[0], p[1] * cO + p[2] * sO];
  const xy = (p) => { const [x, y] = ecl(p); const r = Math.hypot(x, y) || 1e-9; const s = Math.sqrt(r) / rMax * R / r; return [size / 2 + x * s, size / 2 - y * s]; };
  const rings = PLANET_AU.filter(([, a]) => Math.sqrt(a) < rMax).map(([n, a]) => `<circle cx="${size / 2}" cy="${size / 2}" r="${(Math.sqrt(a) / rMax * R).toFixed(1)}" class="${n === 'Earth' ? 'ce-earth' : 'ce-pl'}"/>`).join('');
  const pts = orbitPoints(c, 240).map(xy).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [cx, cy] = xy(now.pos); const [px, py] = xy(cometPos(c, o.tpJd));
  return `<svg class="ce-orbit" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(c.name)}’s orbit seen from above the solar system, with the planets’ orbits"><g>${rings}</g>
    <polyline points="${pts}" class="ce-path" style="--c:${c.dot}"/><circle cx="${size / 2}" cy="${size / 2}" r="4" class="ce-sun"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5" class="ce-peri"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" class="ce-now" style="--c:${c.dot}"/></svg>
    <p class="small muted">Seen from above, distances on a square-root scale so the inner planets and the far end of the orbit both fit. The dot is where it is now; the small mark is its closest point to the Sun. Circles: the planets’ orbits${PLANET_AU.some(([n, a]) => n === 'Neptune' && Math.sqrt(a) < rMax) ? ' out to Neptune' : ''}.</p>`;
}

const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const dl = (rows) => `<dl class="sd-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const lightTime = (au) => { const m = au * AU_KM / C_KM_S / 60; return m < 60 ? `${fmt(m, 1)} minutes` : `${fmt(m / 60, 1)} hours`; };

/** The sections of a comet's page. showers: [name, month, day, zhr, parent] rows (skydetail.js SHOWERS). */
export function cometSections(A, c, date, showers = []) {
  const n = cometNow(A, c, date); const yrs = n.yearsToNext;
  const until = yrs < 1 ? `in ${fmt(yrs * 12, 0)} months` : `in about ${fmt(yrs, yrs < 10 ? 1 : 0)} years`;
  const where = [
    ['From the Sun', `${fmt(n.r, 2)} AU (${fmt(n.r * AU_KM / 1e6, 0)} million km), ${whereAU(n.r)}`],
    n.delta != null && ['From the Earth', `${fmt(n.delta, 2)} AU; its light takes ${lightTime(n.delta)} to reach us`],
    ['Speed around the Sun', `${fmt(n.v, n.v < 2 ? 2 : 1)} km/s, ${n.inbound ? 'falling in towards the Sun' : 'climbing away from the Sun'}`],
    n.con && ['In the sky', `in ${esc(n.con)}, ${fmt(n.elong, 0)}° from the Sun${n.elong < 30 ? ' (lost in the Sun’s glare)' : ''}`],
    ['Tail', n.active ? `growing: inside about 3 AU the Sun’s warmth turns its ice to gas, and the tail streams away from the Sun` : 'none now: this far from the Sun its ice stays frozen, so it is a bare, dark block and very faint'],
  ].filter(Boolean);
  const orbit = [
    ['Goes round every', `${fmt(n.years, n.years < 10 ? 2 : 0)} years`],
    ['Closest to the Sun', `${fmt(c.q, 2)} AU, at ${fmt(n.vPeri, 1)} km/s`],
    ['Farthest out', `${fmt(n.Q, 1)} AU (${whereAU(n.Q).replace('between the orbits of', 'between')}), crawling at ${fmt(n.vAph, n.vAph < 1 ? 2 : 1)} km/s`],
    ['Last closest pass', ymd(n.lastMs)],
    ['Next closest pass', `${c.next ? esc(c.next) : `about ${my(n.nextMs)}`}: ${until}`],
    ['Tilt to the planets', `${fmt(c.i, 1)}°${c.i > 90 ? ': it goes round backwards, against the planets' : ''}`],
    ['Shape', `eccentricity ${fmt(c.e, 3)}: ${c.e > 0.95 ? 'a very long, thin ellipse' : c.e > 0.8 ? 'a long ellipse' : 'an oval'}`],
  ];
  const sh = c.showers.map((s) => {
    const row = showers.find((x) => x[0] === s); if (!row) return `<li><b>${esc(s)}</b>${c.showerNote ? `<small>${esc(c.showerNote)}</small>` : ''}</li>`;
    const [, m, d, zhr] = row; const y = date.getUTCFullYear(); let peak = Date.UTC(y, m - 1, d, 12); if (peak < date.getTime() - DAY / 2) peak = Date.UTC(y + 1, m - 1, d, 12);
    return `<li><b>${esc(s)}</b><small>next peak ${ymd(peak)}, up to about ${zhr} meteors an hour under a dark sky</small></li>`;
  }).join('');
  const showerBody = c.showers.length
    ? `<p>Dust it shed on earlier passes still follows its orbit. When the Earth crosses that stream, the grains hit the air at tens of km/s and burn up as meteors:</p><ul class="sd-missions">${sh}</ul>`
    : `<p>No strong meteor shower is known from it: the Earth does not pass through its dust trail.</p>`;
  const mis = c.missions.length ? `<ul class="sd-missions">${c.missions.map(([m, t]) => `<li><b>${esc(m)}</b><small>${esc(t)}</small></li>`).join('')}</ul>` : '<p>No spacecraft has visited it yet.</p>';
  return `<div class="ce-figure">${orbitSvg(c, n)}</div>`
    + sec('Where it is now', dl(where), `${fmt(n.r, 1)} AU out`, true)
    + sec('Its orbit', dl(orbit), `every ${fmt(n.years, n.years < 10 ? 1 : 0)} years`)
    + sec('Its meteor shower', showerBody, c.showers.join(' and ') || 'none')
    + sec('The nucleus and its story', `<p><b>Nucleus:</b> ${esc(c.nucleus)}.</p><p>${esc(c.known)}</p>`)
    + sec('Visits by spacecraft', mis, c.missions.length ? `${c.missions.length}` : 'none');
}

/** The rows for the solar system card: [comet, from the Sun, next closest pass]. */
export function cometRows(A, date) {
  return COMETS.map((c) => { const n = cometNow(A, c, date); return { c, r: n.r, next: c.next ? c.next.slice(0, c.next.indexOf(' (')) : my(n.nextMs), inbound: n.inbound }; });
}
