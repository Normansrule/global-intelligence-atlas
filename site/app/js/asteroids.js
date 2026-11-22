// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.34: asteroids that pass the Earth, and the ones spacecraft went to.
//
// Like the comets (comets.js), each asteroid follows a two-body (Kepler) orbit around the Sun from its osculating
// elements in NASA JPL's Small-Body Database, read through Wolfram|Alpha on 19 November 2026: perihelion distance q
// (AU), eccentricity e, inclination i, longitude of the ascending node and argument of perihelion (degrees, ecliptic
// J2000) and the date of the last perihelion. Didymos's angles are typed from JPL's published values (see `src`).
// The close passes by the Earth are searched on these orbits, day by day; the Earth's own pull, which bends a path
// in the last few days before a very close pass, is left out, so a pass closer than about 0.05 AU is given with
// JPL's own figure (`pass`) and the search only finds the date.
//
// Pure functions; Astronomy Engine (A) is passed in for the Earth's place.
import { orbitOf, cometPos, cometNow, orbitSvg, whereAU } from './comets.js';

const DAY = 864e5; const AU_KM = 149597870.7; const LD_KM = 384400; const C_KM_S = 299792.458;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const jdOf = (ms) => ms / DAY + 2440587.5;
const ymd = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const ASTEROIDS = [
  { id: 'apophis', name: 'Apophis', code: '99942 Apophis (2004 MN4)', dot: '#ff9d7a', q: 0.74606903, e: 0.19114961, i: 3.3409932, node: 203.90419, w: 126.67243, tp: '2026-11-21',
    size: 'about 340 m across, shaped like a peanut; a stony (S-type) rock', spin: 'tumbles, turning about once every 30.6 hours',
    pass: { ms: Date.UTC(2029, 3, 13, 21, 46), km: 38000, text: '13 April 2029, about 32,000 km above the Earth’s surface: closer than the geostationary satellites, and bright enough to see without a telescope from Europe, Africa and western Asia' },
    known: 'When it was found in 2004 it briefly had the highest impact risk ever given to an asteroid, for 2029. Radar measurements since have ruled out any impact for at least the next 100 years. The 2029 pass is the closest of an asteroid this big known in advance: the Earth’s pull will change its orbit, its spin and maybe set off small landslides on it.',
    missions: [['OSIRIS-APEX (NASA)', 'the spacecraft that brought Bennu’s sample home, sent on to meet Apophis just after its 2029 pass and stay with it for 18 months'], ['Ramses (ESA)', 'a proposed small mission to fly alongside it through the pass']] },
  { id: 'didymos', name: 'Didymos and Dimorphos', code: '65803 Didymos (1996 GT)', dot: '#ffd27a', q: 1.01307152, e: 0.383258, i: 3.4143, node: 72.987, w: 319.59, tp: '2024-11-28',
    src: 'Inclination, node and argument of perihelion typed from JPL’s published values; perihelion, aphelion and the last perihelion date through Wolfram|Alpha.',
    size: 'Didymos about 780 m across, with a moon, Dimorphos, about 150 m across, going round it 1.2 km away', spin: 'Didymos turns every 2.26 hours, so fast that loose rock drifts towards its equator',
    known: 'The first test of moving an asteroid. NASA’s DART spacecraft (Double Asteroid Redirection Test) hit Dimorphos at 6.1 km/s on 26 September 2022 and shortened its 11 hour 55 minute orbit round Didymos by 33 minutes, far more than the impact alone would have done, because the rubble it blasted off pushed back too. Neither rock was ever a danger to the Earth.',
    missions: [['DART (NASA)', 'hit Dimorphos on 26 September 2022, with the Italian LICIACube filming from 55 km away'], ['Hera (ESA)', 'launched in October 2024, due to arrive in late 2026 to measure the crater, Dimorphos’s mass and the new orbit']] },
  { id: 'eros', name: 'Eros', code: '433 Eros', dot: '#e8b98c', q: 1.133458, e: 0.2226906, i: 10.82773, node: 304.27434, w: 178.91029, tp: '2026-02-17',
    size: 'about 34 × 11 × 11 km, shaped like a saddle; a stony (S-type) rock', spin: 'turns every 5.27 hours',
    known: 'The first near-Earth asteroid found (1898) and the second-biggest. Astronomers once timed its close passes to measure the size of the solar system. It cannot hit the Earth on its present orbit.',
    missions: [['NEAR Shoemaker (NASA)', 'the first spacecraft to orbit an asteroid, from February 2000, and the first to land on one, on 12 February 2001']] },
  { id: 'psyche', name: 'Psyche', code: '16 Psyche', dot: '#c8d0dc', q: 2.5304942, e: 0.1341243, i: 3.09723, node: 150.019, w: 229.5888, tp: '2025-04-28',
    size: 'about 220 km across; dense and rich in metal, perhaps part of the iron core of a world that lost its rocky outside', spin: 'turns every 4.2 hours',
    known: 'One of the biggest objects in the asteroid belt and the largest that seems to be mostly metal. It never comes near the Earth; it stays between Mars and Jupiter.',
    missions: [['Psyche (NASA)', 'launched 13 October 2023, flew past Mars in 2026 and is due to arrive in 2029 to orbit it for about two years']] },
  { id: 'ryugu', name: 'Ryugu', code: '162173 Ryugu (1999 JU3)', dot: '#a99c8f', q: 0.96338781, e: 0.19111632, i: 5.866632, node: 251.29446, w: 211.61035, tp: '2026-03-18',
    size: 'about 900 m across, shaped like a spinning top; dark, carbon-rich (C-type) rubble', spin: 'turns every 7.6 hours',
    known: 'A loose pile of rubble held together by its own weak gravity. The grains brought back hold water-bearing minerals and amino acids from the early solar system.',
    missions: [['Hayabusa2 (JAXA)', 'reached it in 2018, fired a copper projectile to make a crater, took two samples and dropped them back to Australia in December 2020']] },
  { id: 'itokawa', name: 'Itokawa', code: '25143 Itokawa (1998 SF36)', dot: '#d6c2a0', q: 0.95304009, e: 0.28025544, i: 1.62118, node: 69.0769, w: 162.82017, tp: '2025-09-17',
    size: 'about 535 m long, shaped like a sea otter; a stony (S-type) rubble pile', spin: 'turns every 12.1 hours',
    known: 'The first asteroid a spacecraft brought dust home from. The grains matched the most common kind of meteorite, which tied those meteorites to stony asteroids like this one.',
    missions: [['Hayabusa (JAXA)', 'landed twice in November 2005; its capsule came back to Australia in June 2010 with about 1,500 grains']] },
];
export const ASTEROID = Object.fromEntries(ASTEROIDS.map((a) => [a.id, a]));

/** The Earth's distance (AU) from asteroid a on a day. */
function earthDist(A, a, ms) {
  const p = cometPos(a, jdOf(ms)); const ev = A.HelioVector(A.Body.Earth, A.MakeTime(new Date(ms)));
  return Math.hypot(p[0] - ev.x, p[1] - ev.y, p[2] - ev.z);
}

/** Close passes by the Earth within `years` from `date`, nearer than `limit` AU: [{ ms, au }], soonest first. */
export function closePasses(A, a, date, years = 30, limit = 0.2) {
  const out = []; const t0 = date.getTime(); const t1 = t0 + years * 365.25 * DAY; let p2 = earthDist(A, a, t0); let p1 = earthDist(A, a, t0 + DAY);
  for (let t = t0 + 2 * DAY; t <= t1; t += DAY) {
    const d = earthDist(A, a, t);
    if (p1 < p2 && p1 <= d && p1 < limit) {
      // refine to the hour around the day of the minimum
      let best = [t - DAY, p1]; for (let h = -24; h <= 24; h++) { const m = t - DAY + h * 3600e3; const x = earthDist(A, a, m); if (x < best[1]) best = [m, x]; }
      out.push({ ms: best[0], au: best[1] });
    }
    p2 = p1; p1 = d;
  }
  return out;
}

/** How far that is, in the measures people know: km, Moon distances, Earth widths. */
export function howFar(au) {
  const km = au * AU_KM; const ld = km / LD_KM;
  return ld < 1 ? `${fmt(Math.round(km / 1000) * 1000)} km, ${fmt(ld * 100, 0)} % of the way to the Moon` : ld < 100 ? `${fmt(km / 1e6, 1)} million km, ${fmt(ld, 1)} times as far as the Moon` : `${fmt(au, 2)} AU (${fmt(km / 1e6, 0)} million km)`;
}

const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const dl = (rows) => `<dl class="sd-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const lightTime = (au) => { const m = au * AU_KM / C_KM_S / 60; return `${fmt(m, 1)} minutes`; };

/** The next close pass of asteroid a: JPL's figure when it is very close, otherwise the search's. */
export function nextPass(A, a, date, years = 30) {
  const found = closePasses(A, a, date, years, 0.2);
  if (a.pass && a.pass.ms > date.getTime()) return { ms: a.pass.ms, au: a.pass.km / AU_KM, text: a.pass.text, jpl: true, found };
  return found.length ? { ...found[0], text: `${ymd(found[0].ms)}, ${howFar(found[0].au)}`, found } : null;
}

/** The sections of an asteroid's page. */
export function asteroidSections(A, a, date) {
  const n = cometNow(A, a, date); const o = orbitOf(a);
  const where = [
    ['From the Sun', `${fmt(n.r, 2)} AU (${fmt(n.r * AU_KM / 1e6, 0)} million km), ${whereAU(n.r)}`],
    n.delta != null && ['From the Earth', `${howFar(n.delta)}; its light takes ${lightTime(n.delta)} to reach us`],
    ['Speed around the Sun', `${fmt(n.v, 1)} km/s, ${n.inbound ? 'falling in towards the Sun' : 'climbing away from the Sun'}`],
    n.con && ['In the sky', `in ${esc(n.con)}, ${fmt(n.elong, 0)}° from the Sun`],
  ].filter(Boolean);
  const crosses = a.q < 1.017 && o.Q > 0.983;
  const orbit = [
    ['Goes round every', o.years < 2 ? `${fmt(o.periodD, 0)} days` : `${fmt(o.years, 2)} years`],
    ['Closest to the Sun', `${fmt(a.q, 2)} AU`], ['Farthest out', `${fmt(o.Q, 2)} AU`],
    ['Next closest to the Sun', ymd(n.nextMs)],
    ['Its path and the Earth’s', crosses ? 'it crosses the Earth’s orbit' : a.q < 1.3 ? 'it comes near the Earth’s orbit but does not cross it' : 'it stays far outside the Earth’s orbit'],
  ];
  let passBody = ''; let passSum = '';
  const np = A ? nextPass(A, a, date) : null;
  if (np) {
    // after a pass as close as Apophis's the Earth's pull leaves it on a new orbit, so later passes on the old one mean nothing
    const others = np.jpl ? [] : np.found.filter((p) => Math.abs(p.ms - np.ms) > 60 * DAY).slice(0, 4);
    passBody = `<p><b>Next close pass:</b> ${esc(np.text)}.</p>${np.jpl ? '<p class="small muted">JPL’s figure, which includes the Earth’s own pull; that pull bends the path so much in the last days that the simple orbit here only finds the date. After it, the asteroid will be on a different orbit (about 1.1 years round the Sun instead of 0.89), so no later passes are listed.</p>' : ''}`
      + (others.length ? `<p>Later passes within 0.2 AU (30 million km): ${others.map((p) => `${ymd(p.ms)} (${fmt(p.au, 3)} AU)`).join('; ')}.</p>` : '');
    passSum = new Date(np.ms).getUTCFullYear();
  } else { passBody = '<p>It does not come within 0.2 AU (30 million km) of the Earth in the next 30 years.</p>'; passSum = 'none soon'; }
  const mis = `<ul class="sd-missions">${a.missions.map(([m, t]) => `<li><b>${esc(m)}</b><small>${esc(t)}</small></li>`).join('')}</ul>`;
  return `<div class="ce-figure">${orbitSvg(a, n)}</div>`
    + sec('Where it is now', dl(where), `${fmt(n.delta ?? n.r, 2)} AU away`, true)
    + sec('Passing the Earth', passBody, passSum, true)
    + sec('Its orbit', dl(orbit), o.years < 2 ? `every ${fmt(o.periodD, 0)} days` : `every ${fmt(o.years, 1)} years`)
    + sec('The rock itself', `<p><b>Size:</b> ${esc(a.size)}. <b>Spin:</b> ${esc(a.spin)}.</p><p>${esc(a.known)}</p>`)
    + sec('Visits by spacecraft', mis, `${a.missions.length}`);
}

/** Rows for the solar system card: [asteroid, from the Earth now, next close pass]. */
export function asteroidRows(A, date) {
  return ASTEROIDS.map((a) => { const n = cometNow(A, a, date); const np = nextPass(A, a, date, 15); return { a, delta: n.delta, next: np ? (np.jpl ? ymd(np.ms) : `${new Date(np.ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`) : 'not within 15 years', jpl: !!np?.jpl }; });
}
