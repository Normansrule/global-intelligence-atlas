// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Sun, the planets, the moons and the small worlds in depth (v2.30).
// Every body's page (cosmos.js card) gains five sections, worked out on this device from Astronomy Engine and the
// figures below, so they open offline too:
//   standing there   your weight, how high you could jump, how fast you would have to go to leave, how big and how
//                    bright the Sun looks, how long a day and a year are and how many days fit in a year;
//   in our sky       where it is from the place you were looking at on the globe: up or down now, when it next rises
//                    and sets, and the best time to see it (the next opposition, greatest elongation or full Moon);
//   getting there    the classic Hohmann transfer from Earth: how long the trip takes, the speed a rocket must add
//                    from low Earth orbit, how often the planets line up for it and the next date they do;
//   its air          what the air is made of, as bars, and the pressure at the surface against Earth's;
//   size to scale    the body drawn next to the Earth (and the Moon, for small ones), and how many Earths fit inside;
//   missions         the spacecraft that went there, what each did and when.
// Physical figures are rounded from NASA's Planetary Fact Sheets (Williams, n.d.); docs/ASSUMPTIONS.md (v2.30) lists
// every approximation.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
/** Two significant figures for small numbers, whole numbers for big ones. */
export const sig = (n) => { const a = Math.abs(n); return a >= 100 ? fmt(n) : a >= 10 ? fmt(n, 1) : a >= 1 ? fmt(n, 2) : a >= 0.01 ? fmt(n, 3) : Number(n).toPrecision(2); };

// ---------------------------------------------------------------- the figures
// g: surface gravity (m/s²) · ve: escape speed (km/s) · au: mean distance from the Sun (AU; a moon uses its planet's)
// year: orbit round the Sun (Earth days) · day: sunrise to sunrise (hours; for a moon locked to its planet, its orbit)
// tilt: axial tilt (degrees) · T: mean surface or cloud-top temperature (°C) · bar: surface pressure (Earth = 1.013)
// air: main gases by volume (%), the Sun's by mass · ring: the planet a moon goes round
export const PHYS = {
  sun: { g: 274, ve: 617.7, T: 5500, air: [['Hydrogen', 73.5], ['Helium', 24.9], ['Oxygen, carbon, iron and the rest', 1.6]], airBy: 'mass' },
  mercury: { g: 3.7, ve: 4.3, au: 0.387, year: 88.0, day: 4222.6, tilt: 0.03, T: 167, bar: 0 },
  venus: { g: 8.87, ve: 10.36, au: 0.723, year: 224.7, day: 2802.0, tilt: 177.4, T: 464, bar: 92, air: [['Carbon dioxide', 96.5], ['Nitrogen', 3.5]] },
  earth: { g: 9.81, ve: 11.19, au: 1, year: 365.25, day: 24, tilt: 23.44, T: 15, bar: 1.013, air: [['Nitrogen', 78.1], ['Oxygen', 20.9], ['Argon', 0.93], ['Carbon dioxide', 0.04]] },
  moon: { g: 1.62, ve: 2.38, au: 1, year: 365.25, day: 708.7, tilt: 6.7, T: -20, bar: 0, ring: 'earth' },
  mars: { g: 3.71, ve: 5.03, au: 1.524, year: 687.0, day: 24.66, tilt: 25.19, T: -65, bar: 0.006, air: [['Carbon dioxide', 95.1], ['Nitrogen', 2.6], ['Argon', 1.9], ['Oxygen', 0.17]] },
  phobos: { g: 0.0057, ve: 0.011, au: 1.524, year: 687.0, day: 7.65, T: -40, bar: 0, ring: 'mars' },
  deimos: { g: 0.003, ve: 0.0056, au: 1.524, year: 687.0, day: 30.3, T: -40, bar: 0, ring: 'mars' },
  jupiter: { g: 24.79, ve: 59.5, au: 5.203, year: 4331, day: 9.93, tilt: 3.13, T: -110, air: [['Hydrogen', 89.8], ['Helium', 10.2]] },
  io: { g: 1.80, ve: 2.56, au: 5.203, year: 4331, day: 42.5, T: -143, bar: 0, ring: 'jupiter' },
  europa: { g: 1.31, ve: 2.03, au: 5.203, year: 4331, day: 85.2, T: -160, bar: 0, ring: 'jupiter' },
  ganymede: { g: 1.43, ve: 2.74, au: 5.203, year: 4331, day: 171.7, T: -163, bar: 0, ring: 'jupiter' },
  callisto: { g: 1.24, ve: 2.44, au: 5.203, year: 4331, day: 400.5, T: -139, bar: 0, ring: 'jupiter' },
  saturn: { g: 10.44, ve: 35.5, au: 9.537, year: 10747, day: 10.66, tilt: 26.73, T: -140, air: [['Hydrogen', 96.3], ['Helium', 3.25]] },
  mimas: { g: 0.064, ve: 0.159, au: 9.537, year: 10747, day: 22.6, T: -200, bar: 0, ring: 'saturn' },
  enceladus: { g: 0.113, ve: 0.239, au: 9.537, year: 10747, day: 32.9, T: -198, bar: 0, ring: 'saturn' },
  tethys: { g: 0.146, ve: 0.394, au: 9.537, year: 10747, day: 45.3, T: -187, bar: 0, ring: 'saturn' },
  dione: { g: 0.232, ve: 0.51, au: 9.537, year: 10747, day: 65.7, T: -186, bar: 0, ring: 'saturn' },
  rhea: { g: 0.264, ve: 0.635, au: 9.537, year: 10747, day: 108.4, T: -174, bar: 0, ring: 'saturn' },
  titan: { g: 1.35, ve: 2.64, au: 9.537, year: 10747, day: 382.7, T: -179, bar: 1.5, air: [['Nitrogen', 98.4], ['Methane', 1.4], ['Hydrogen', 0.1]], ring: 'saturn' },
  iapetus: { g: 0.223, ve: 0.573, au: 9.537, year: 10747, day: 1903.9, T: -160, bar: 0, ring: 'saturn' },
  uranus: { g: 8.87, ve: 21.3, au: 19.19, year: 30589, day: 17.24, tilt: 97.77, T: -195, air: [['Hydrogen', 82.5], ['Helium', 15.2], ['Methane', 2.3]] },
  miranda: { g: 0.079, ve: 0.193, au: 19.19, year: 30589, day: 33.9, T: -187, bar: 0, ring: 'uranus' },
  ariel: { g: 0.269, ve: 0.558, au: 19.19, year: 30589, day: 60.5, T: -213, bar: 0, ring: 'uranus' },
  umbriel: { g: 0.2, ve: 0.52, au: 19.19, year: 30589, day: 99.5, T: -198, bar: 0, ring: 'uranus' },
  titania: { g: 0.379, ve: 0.773, au: 19.19, year: 30589, day: 208.9, T: -203, bar: 0, ring: 'uranus' },
  oberon: { g: 0.346, ve: 0.726, au: 19.19, year: 30589, day: 323.1, T: -198, bar: 0, ring: 'uranus' },
  neptune: { g: 11.15, ve: 23.5, au: 30.07, year: 59800, day: 16.11, tilt: 28.32, T: -200, air: [['Hydrogen', 80], ['Helium', 19], ['Methane', 1.5]] },
  triton: { g: 0.779, ve: 1.46, au: 30.07, year: 59800, day: 141.0, T: -235, bar: 0.000014, air: [['Nitrogen', 99.9], ['Methane and carbon monoxide', 0.1]], ring: 'neptune' },
  pluto: { g: 0.62, ve: 1.21, au: 39.48, year: 90560, day: 153.3, tilt: 122.5, T: -225, bar: 0.00001, air: [['Nitrogen', 99], ['Methane', 0.5], ['Carbon monoxide', 0.05]] },
  charon: { g: 0.288, ve: 0.59, au: 39.48, year: 90560, day: 153.3, T: -220, bar: 0, ring: 'pluto' },
  ceres: { g: 0.28, ve: 0.51, au: 2.77, year: 1682, day: 9.07, tilt: 4, T: -105, bar: 0 },
  vesta: { g: 0.25, ve: 0.36, au: 2.36, year: 1325, day: 5.34, tilt: 29, T: -100, bar: 0 },
  bennu: { g: 0.000006, ve: 0.0002, au: 1.126, year: 436.6, day: 4.3, tilt: 178, T: 50, bar: 0 },
};

// The spacecraft that went there: [name, who, year(s), what it did]. Highlights, not every mission.
export const MISSIONS = {
  sun: [['SOHO', 'ESA and NASA', '1995–', 'watches the Sun nonstop from 1.5 million km sunward of Earth'], ['Parker Solar Probe', 'NASA', '2018–', 'flew through the Sun’s outer air, 6.1 million km from its surface in December 2024, the closest any spacecraft has been'], ['Solar Orbiter', 'ESA and NASA', '2020–', 'took the first pictures of the Sun’s poles']],
  mercury: [['Mariner 10', 'NASA', '1974–75', 'three flybys, the first close look'], ['MESSENGER', 'NASA', '2011–15', 'the first orbiter: mapped all of it and found ice in shadowed polar craters'], ['BepiColombo', 'ESA and JAXA', 'launched 2018', 'two orbiters travelling together, due to enter orbit in the mid-2020s']],
  venus: [['Mariner 2', 'NASA', '1962', 'the first successful flyby of another planet'], ['Venera 7', 'Soviet Union', '1970', 'the first landing on another planet that sent back data'], ['Venera 13', 'Soviet Union', '1982', 'colour pictures from the surface; it lasted 127 minutes in the heat'], ['Magellan', 'NASA', '1990–94', 'mapped 98 % of the surface by radar through the clouds'], ['Venus Express', 'ESA', '2006–14', 'studied the air and found signs of recent lava'], ['Akatsuki', 'JAXA', '2015–24', 'watched the clouds race round the planet']],
  moon: [['Luna 2', 'Soviet Union', '1959', 'the first spacecraft to reach another world'], ['Luna 9', 'Soviet Union', '1966', 'the first soft landing'], ['Apollo 11', 'NASA', '1969', 'the first people on the Moon'], ['Apollo 17', 'NASA', '1972', 'the last crew to walk there, so far'], ['Lunar Reconnaissance Orbiter', 'NASA', '2009–', 'maps it to half a metre a pixel'], ['Chang’e 4', 'China', '2019', 'the first landing on the far side'], ['Chandrayaan-3', 'India', '2023', 'the first landing near the south pole'], ['Chang’e 6', 'China', '2024', 'brought rock back from the far side']],
  mars: [['Mariner 4', 'NASA', '1965', 'the first flyby: craters, no canals'], ['Viking 1 and 2', 'NASA', '1976', 'the first long-lived landers'], ['Mars Pathfinder', 'NASA', '1997', 'the first rover, Sojourner'], ['Spirit and Opportunity', 'NASA', '2004–18', 'found signs of past water; Opportunity drove 45 km'], ['Curiosity', 'NASA', '2012–', 'climbing Mount Sharp in Gale crater'], ['Perseverance and Ingenuity', 'NASA', '2021–', 'collecting samples; Ingenuity made the first powered flight on another planet'], ['Tianwen-1 and Zhurong', 'China', '2021–22', 'orbiter, lander and rover in one mission']],
  phobos: [['Phobos 2', 'Soviet Union', '1989', 'took close pictures before contact was lost'], ['Mars Express', 'ESA', '2003–', 'has flown past it many times, once within 45 km']],
  deimos: [['Viking 2 orbiter', 'NASA', '1977', 'passed within 30 km'], ['Hope', 'United Arab Emirates', '2023', 'the closest pictures of its far side']],
  jupiter: [['Pioneer 10', 'NASA', '1973', 'the first flyby'], ['Voyager 1 and 2', 'NASA', '1979', 'found its thin rings and Io’s volcanoes'], ['Galileo', 'NASA', '1995–2003', 'the first orbiter; dropped a probe into the clouds'], ['Juno', 'NASA', '2016–', 'looping over the poles to see inside'], ['Juice', 'ESA', 'launched 2023', 'on its way, due in 2031 to study the icy moons'], ['Europa Clipper', 'NASA', 'launched 2024', 'on its way, due in 2030']],
  io: [['Voyager 1', 'NASA', '1979', 'saw the first volcanoes erupting beyond Earth'], ['Galileo', 'NASA', '1995–2003', 'flew close past it seven times'], ['Juno', 'NASA', '2023–24', 'flew within 1,500 km of its surface']],
  europa: [['Galileo', 'NASA', '1995–2003', 'found signs of a salty ocean under the ice'], ['Juno', 'NASA', '2022', 'flew within 352 km'], ['Europa Clipper', 'NASA', 'launched 2024', 'due in 2030 for about 50 close passes']],
  ganymede: [['Galileo', 'NASA', '1995–2003', 'found it has its own magnetic field'], ['Juno', 'NASA', '2021', 'flew within 1,038 km'], ['Juice', 'ESA', 'launched 2023', 'due to orbit it, the first orbiter of a moon other than ours']],
  callisto: [['Voyager 1 and 2', 'NASA', '1979', 'showed the most cratered surface known'], ['Galileo', 'NASA', '1995–2003', 'found hints of an ocean deep down']],
  saturn: [['Pioneer 11', 'NASA', '1979', 'the first flyby'], ['Voyager 1 and 2', 'NASA', '1980–81', 'showed the rings are made of thousands of ringlets'], ['Cassini–Huygens', 'NASA, ESA and ASI', '2004–17', '13 years in orbit; ended by diving into Saturn']],
  titan: [['Voyager 1', 'NASA', '1980', 'found thick nitrogen air'], ['Cassini–Huygens', 'NASA, ESA and ASI', '2004–17', 'Huygens landed in 2005, the farthest landing ever; Cassini found lakes of methane'], ['Dragonfly', 'NASA', 'planned', 'a drone helicopter, planned to launch in 2028']],
  enceladus: [['Cassini', 'NASA, ESA and ASI', '2005–15', 'found geysers of water at the south pole and flew through them']],
  mimas: [['Cassini', 'NASA, ESA and ASI', '2004–17', 'mapped the giant Herschel crater']], tethys: [['Cassini', 'NASA, ESA and ASI', '2004–17', 'mapped the long Ithaca Chasma canyon']],
  dione: [['Cassini', 'NASA, ESA and ASI', '2004–17', 'flew within 100 km and saw its ice cliffs']], rhea: [['Cassini', 'NASA, ESA and ASI', '2004–17', 'found a very thin oxygen air']],
  iapetus: [['Cassini', 'NASA, ESA and ASI', '2007', 'one close pass over its two-tone face and equatorial ridge']],
  uranus: [['Voyager 2', 'NASA', '1986', 'the only visit so far: found 10 moons and two rings']],
  miranda: [['Voyager 2', 'NASA', '1986', 'pictured cliffs up to 20 km high']], ariel: [['Voyager 2', 'NASA', '1986', 'pictured the southern half']],
  umbriel: [['Voyager 2', 'NASA', '1986', 'pictured the southern half']], titania: [['Voyager 2', 'NASA', '1986', 'pictured the southern half']], oberon: [['Voyager 2', 'NASA', '1986', 'pictured the southern half']],
  neptune: [['Voyager 2', 'NASA', '1989', 'the only visit so far: found the Great Dark Spot and the fastest winds in the solar system']],
  triton: [['Voyager 2', 'NASA', '1989', 'saw dark geyser plumes on its frozen nitrogen surface']],
  pluto: [['New Horizons', 'NASA', '2015', 'flew past at 12,500 km: mountains of water ice and a heart-shaped nitrogen glacier']],
  charon: [['New Horizons', 'NASA', '2015', 'found a red polar cap and a vast canyon belt']],
  ceres: [['Dawn', 'NASA', '2015–18', 'the first spacecraft to orbit a dwarf planet; found bright salt deposits']],
  vesta: [['Dawn', 'NASA', '2011–12', 'mapped it for 14 months before leaving for Ceres']],
  bennu: [['OSIRIS-REx', 'NASA', '2018–23', 'touched down for a moment in 2020 and brought 121 g of it back to Earth in 2023']],
};

// ---------------------------------------------------------------- standing there
const G_EARTH = 9.81; const VE_EARTH = 11.19;
const JUMP_V = Math.sqrt(2 * G_EARTH * 0.5); // m/s: the take-off speed of a 50 cm jump on Earth
/** A day and a year in words: hours, days or years. */
export const span = (h) => (h < 48 ? `${sig(h)} hours` : h < 24 * 730 ? `${sig(h / 24)} Earth days` : `${sig(h / 24 / 365.25)} Earth years`);
/** What someone of 70 kg feels like, how high a 50 cm jump goes, how fast you must go to leave. */
export function standing(id, r) {
  const p = PHYS[id]; if (!p) return null;
  const k = p.g / G_EARTH;
  const out = { weightKg: 70 * k, jumpM: 0.5 / k, ve: p.ve, veRatio: p.ve / VE_EARTH, gRatio: k };
  if (p.au) { out.sunWidth = 1 / p.au; out.sunlight = 1 / p.au ** 2; } // the Sun's apparent width and light, Earth = 1
  if (p.year && p.day) { out.year = p.year; out.day = p.day; out.daysInYear = (p.year * 24) / p.day; }
  out.r = r; return out;
}

// ---------------------------------------------------------------- getting there
const MU_SUN = 1.32712440018e11; const AU_KM = 149597870.7; const MU_EARTH = 398600.4418; const R_LEO = 6371 + 200;
const V_EARTH = Math.sqrt(MU_SUN / AU_KM); // 29.78 km/s
/** A Hohmann transfer from Earth's orbit to a circular orbit of a AU: trip time (days), speed to add from a 200 km
 * orbit (km/s), and the planets' synodic period (days). Circular, flat orbits: see ASSUMPTIONS.md. */
export function hohmann(a, year) {
  const at = (1 + a) / 2; const tDays = 0.5 * at ** 1.5 * 365.25;
  const vInf = Math.abs(V_EARTH * (Math.sqrt((2 * a) / (1 + a)) - 1));
  const vLeo = Math.sqrt(MU_EARTH / R_LEO); const dv = Math.sqrt(vInf * vInf + (2 * MU_EARTH) / R_LEO) - vLeo;
  const vArr = Math.abs(Math.sqrt(MU_SUN / (a * AU_KM)) * (1 - Math.sqrt(2 / (1 + a)))); // speed still to change on arrival
  const synodic = year ? 1 / Math.abs(1 / 365.25 - 1 / year) : null;
  // At departure the target must lead the Earth by this angle (degrees) so that both arrive together.
  const lead = 180 - (360 * tDays) / (year ?? Infinity);
  return { tDays, vInf, dv, vArr, synodic, lead };
}
const wrap = (x) => ((x % 360) + 360) % 360;
/** The next date (from t0) when a planet leads the Earth by the transfer's angle: a launch window, give or take weeks. */
export function nextWindow(A, body, lead, t0, maxDays = 1100) {
  const bodyId = A.Body[body[0].toUpperCase() + body.slice(1)];
  const ph = (d) => { const t = A.MakeTime(new Date(t0.getTime() + d * 864e5)); return wrap(A.EclipticLongitude(bodyId, t) - A.EclipticLongitude(A.Body.Earth, t) - lead + 180) - 180; };
  let prev = ph(0);
  for (let d = 1; d <= maxDays; d++) {
    const cur = ph(d);
    if (prev < 0 && cur >= 0 && cur - prev < 90) return new Date(t0.getTime() + (d - cur / (cur - prev)) * 864e5);
    if (prev > 0 && cur <= 0 && prev - cur < 90) return new Date(t0.getTime() + (d - cur / (cur - prev)) * 864e5);
    prev = cur;
  }
  return null;
}

// ---------------------------------------------------------------- in our sky
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (az) => COMPASS[Math.round(wrap(az) / 45) % 8];
/** Where a body is in the sky from one place now, its next rise and set, and its best time to be seen. */
export function skyFrom(A, id, obs, date) {
  const name = id === 'sun' ? 'Sun' : id === 'moon' ? 'Moon' : id[0].toUpperCase() + id.slice(1);
  const b = A.Body[name]; if (b == null) return null;
  const t = A.MakeTime(date); const o = new A.Observer(obs.lat, obs.lng, 0);
  const eq = A.Equator(b, t, o, true, true); const h = A.Horizon(t, o, eq.ra, eq.dec, 'normal');
  const rise = A.SearchRiseSet(b, o, +1, t, 400); const set = A.SearchRiseSet(b, o, -1, t, 400);
  const out = { alt: h.altitude, az: h.azimuth, up: h.altitude > 0, rise: rise?.date ?? null, set: set?.date ?? null, best: null };
  try {
    if (id === 'moon') { const f = A.SearchMoonPhase(180, t, 40); out.best = f && { kind: 'Full Moon', date: f.date }; }
    else if (id === 'mercury' || id === 'venus') { const e = A.SearchMaxElongation(b, t); out.best = { kind: `Greatest elongation (${e.visibility} sky, ${Math.round(e.elongation)}° from the Sun)`, date: e.time.date }; }
    else if (id !== 'sun') { const r = A.SearchRelativeLongitude(b, 0, t); out.best = { kind: 'Opposition: up all night, closest and brightest', date: r.date }; }
  } catch { /* not every body has one */ }
  return out;
}

// ---------------------------------------------------------------- the page
const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const facts = (rows) => `<dl class="sd-facts">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const day = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const when = (d) => `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
const bars = (rows) => `<ul class="gx-bars">${rows.map(([n, v]) => `<li><span>${esc(n)}</span><span class="gx-bar"><i style="--w:${Math.max(0.6, Math.min(100, v)).toFixed(1)}%"></i></span><small>${v < 1 ? sig(v) : fmt(v, 1)} %</small></li>`).join('')}</ul>`;
const EARTH_R = 6371; const MOON_R = 1737.4;
/** The body drawn to scale next to the Earth (and the Moon when it is small). */
export function scaleSvg(name, r, color) {
  const others = [['Earth', EARTH_R, '#5aa9e6'], ...(r < 2000 && r !== MOON_R ? [['Moon', MOON_R, '#c9c4ba']] : [])].filter(([, rr]) => rr !== r);
  const all = [[name, r, color], ...others]; const max = Math.max(...all.map((x) => x[1])); const H = 110; const scale = (H / 2) / max;
  let x = 4; const parts = all.map(([n, rr, c]) => { const rad = Math.max(0.6, rr * scale); const cx = x + rad; x += 2 * rad + 18; return `<circle cx="${cx.toFixed(1)}" cy="${H / 2 + 4}" r="${rad.toFixed(2)}" fill="${c}"/><text x="${cx.toFixed(1)}" y="${H + 22}" text-anchor="middle">${esc(n)}</text>`; });
  return `<svg class="sd-scale" viewBox="0 0 ${Math.max(140, x).toFixed(0)} ${H + 28}" role="img" aria-label="${esc(name)} drawn to scale next to the Earth">${parts.join('')}</svg>`;
}

/**
 * Every extra section of a body's page, as HTML. A is Astronomy Engine; obs is {lat, lng, place} on Earth to see
 * the sky from; host is the planet a moon goes round.
 */
export function spaceSections(id, { A, date = new Date(), obs, def, hostName }) {
  const p = PHYS[id]; if (!p || !def) return '';
  const out = [];
  // standing there
  if (id !== 'sun') {
    const s = standing(id, def.r);
    const rows = [['Someone of 70 kg weighs like', `${s.weightKg < 1 ? `${sig(s.weightKg * 1000)} g` : `${sig(s.weightKg)} kg`} on Earth`],
      ['A 50 cm jump on Earth goes', s.ve * 1000 < JUMP_V ? 'off into space: you would leave it for good' : s.jumpM > 1000 ? `${sig(s.jumpM / 1000)} km up` : `${sig(s.jumpM)} m up`],
      ['Speed to leave for good', `${s.ve < 0.1 ? `${sig(s.ve * 1000)} m/s` : `${sig(s.ve)} km/s`} (Earth ${VE_EARTH} km/s)`]];
    if (s.sunWidth && p.au !== 1) rows.push(['The Sun looks', `${s.sunWidth >= 1 ? `${sig(s.sunWidth)} times as wide` : `${sig(s.sunWidth * 100)} % as wide`} as from Earth, ${s.sunlight >= 1 ? `${sig(s.sunlight)} times as bright` : `with ${sig(s.sunlight * 100)} % of the light`}`]);
    if (s.day) rows.push(['Sunrise to sunrise', span(s.day)], ['A year (once round the Sun)', span(s.year * 24)], ['Days in its year', s.daysInYear < 2 ? `less than ${s.daysInYear < 1 ? 'one' : 'two'}: the Sun comes up ${s.daysInYear < 1 ? 'less than once' : 'about once'} a year` : s.daysInYear < 100 ? sig(s.daysInYear) : fmt(s.daysInYear)]);
    if (p.tilt != null) rows.push(['Axis tilted', `${sig(p.tilt)}°${p.tilt > 90 ? ' (it spins backwards)' : p.tilt < 3 ? ' (hardly any seasons)' : p.tilt > 60 ? ' (it rolls round the Sun on its side)' : ''}`]);
    rows.push(['Typical temperature', `${fmt(p.T).replace('-', '−')} °C${p.ring || ['mercury', 'mars', 'pluto', 'ceres', 'vesta', 'bennu', 'moon'].includes(id) ? ' at the surface' : ['jupiter', 'saturn', 'uranus', 'neptune'].includes(id) ? ' at the cloud tops' : ''}`]);
    out.push(sec('Standing there', facts(rows), s.gRatio < 0.001 ? `${sig(s.gRatio * 1e6)} millionths of Earth’s gravity` : `${sig(s.gRatio)} × Earth’s gravity`, true));
  } else {
    out.push(sec('Standing there', facts([['Gravity at the surface', `${sig(p.g / G_EARTH)} × Earth’s: someone of 70 kg would weigh as much as ${fmt(70 * p.g / G_EARTH)} kg`], ['Speed to leave for good', `${fmt(p.ve, 1)} km/s`], ['Surface', `about ${fmt(p.T)} °C`]]), `${sig(p.g / G_EARTH)} × Earth’s gravity`, true));
  }
  // in our sky
  if (id !== 'earth' && A && obs) {
    const skyId = p.ring && p.ring !== 'earth' ? p.ring : id;
    let s = null; try { s = skyFrom(A, skyId, obs, date); } catch { s = null; }
    if (s) {
      const where = esc(obs.place || `${fmt(Math.abs(obs.lat), 1)}° ${obs.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(obs.lng), 1)}° ${obs.lng >= 0 ? 'E' : 'W'}`);
      const rows = [[s.up ? 'Up now' : 'Below the horizon now', s.up ? `${fmt(s.alt)}° high in the ${compass(s.az)}` : `${fmt(-s.alt)}° below, in the ${compass(s.az)}`],
        s.rise && ['Next rises', when(s.rise)], s.set && ['Next sets', when(s.set)], s.best && [esc(s.best.kind), day(s.best.date)]];
      const lead = p.ring && p.ring !== 'earth' ? `<p class="cd-key">${esc(def.name)} is too faint and too close to ${esc(hostName ?? p.ring)} to see without a telescope; these are ${esc(hostName ?? p.ring)}’s times.</p>` : '';
      out.push(sec('In our sky', `${lead}${facts(rows)}<p class="cd-key">Seen from ${where}, the place the globe was looking at, in your device’s time zone. Rising and setting are for a flat horizon at sea level.</p>`, s.up ? 'up now' : s.rise ? `rises ${s.rise.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''));
    }
  }
  // getting there
  if (!['sun', 'earth', 'moon'].includes(id) && p.au) {
    const h = hohmann(p.au, p.year); const planet = p.ring ?? id;
    let win = null; if (A && ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'].includes(planet)) { try { win = nextWindow(A, planet, h.lead, date); } catch { win = null; } }
    const rows = [['The trip takes', h.tDays < 730 ? `${fmt(h.tDays)} days (${sig(h.tDays / 30.44)} months)` : `${sig(h.tDays / 365.25)} years`],
      ['Speed to add from low Earth orbit', `${sig(h.dv)} km/s (reaching orbit itself takes about 9.4 km/s)`],
      ['Speed to shed on arrival', `${sig(h.vArr)} km/s against the Sun, before ${esc(def.name)}’s own pull`],
      h.synodic && ['The planets line up for it every', h.synodic < 730 ? `${fmt(h.synodic)} days` : `${sig(h.synodic / 365.25)} years`],
      win && ['Next launch window', `around ${win.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`]];
    const real = { mars: 'Perseverance took 203 days.', jupiter: 'Juno took 5 years, with a swing past Earth.', saturn: 'Cassini took almost 7 years, swinging past Venus, Earth and Jupiter.', pluto: 'New Horizons took 9½ years, with a swing past Jupiter.', mercury: 'Real craft take years, because shedding speed towards the Sun is hard: MESSENGER took 6½.', venus: 'Venus Express took 153 days.', neptune: 'Voyager 2 took 12 years, swinging past Jupiter, Saturn and Uranus.', uranus: 'Voyager 2 took 8½ years, swinging past Jupiter and Saturn.', ceres: 'Dawn took 8 years, stopping at Vesta first.', bennu: 'OSIRIS-REx took 2 years, with a swing past Earth.' }[planet] ?? '';
    out.push(sec('Getting there', `${facts(rows)}<p class="cd-key">The classic minimum-energy path (a Hohmann transfer) between circular, flat orbits${p.ring ? ` to ${esc(hostName ?? p.ring)}’s distance` : ''}. ${real} Swinging past planets shortens the trip or saves fuel.</p>`, h.tDays < 730 ? `${fmt(h.tDays)} days` : `${sig(h.tDays / 365.25)} years`));
  }
  // its air
  if (p.air || p.bar != null) {
    const pr = p.bar == null ? 'No surface: the gas thickens into liquid deep down' : p.bar === 0 ? 'Almost none: a near-vacuum' : p.bar >= 0.1 ? `${sig(p.bar / 1.013)} × Earth’s at sea level${p.bar > 10 ? `, like being ${fmt(((p.bar / 1.013) - 1) * 10)} m under the sea` : ''}` : `${sig((p.bar / 1.013) * 100)} % of Earth’s at sea level`;
    out.push(sec(id === 'sun' ? 'What it is made of' : 'Its air', `${id === 'sun' ? '' : facts([['Pressure at the surface', pr]])}${p.air ? bars(p.air) + `<p class="cd-key">By ${p.airBy ?? 'volume'}, rounded.</p>` : ''}`, p.air ? esc(p.air[0][0]) : 'none'));
  }
  // size to scale
  const vol = (def.r / EARTH_R) ** 3;
  out.push(sec('Size to scale', `${scaleSvg(def.name, def.r, def.dot ?? '#ccc')}<p class="cd-key">${id === 'earth' ? '12,742 km across.' : vol >= 1.5 ? `About ${fmt(vol)} Earths would fit inside.` : vol >= 0.5 ? `Close to Earth’s size: ${sig(def.r / EARTH_R * 100)} % as wide.` : `${sig(def.r / EARTH_R * 100)} % as wide as the Earth, which could hold about ${1 / vol > 1e6 ? `${sig(1 / vol / 1e12)} million million` : fmt(Math.round(1 / vol))} of it.`} ${def.r * 2 < 10 ? `${fmt(def.r * 2000)} m` : `${fmt(def.r * 2)} km`} across${def.flat && def.flat < 0.99 ? `, flattened by its spin (${sig((1 - def.flat) * 100)} % shorter pole to pole)` : ''}.</p>`, def.r * 2 < 10 ? `${fmt(def.r * 2000)} m` : `${fmt(def.r * 2)} km`));
  // missions
  const ms = MISSIONS[id];
  if (ms) out.push(sec('Spacecraft that went there', `<ul class="sd-missions">${ms.map(([n, who, y, what]) => `<li><b>${esc(n)}</b> <small>${esc(who)} · ${esc(y)}</small><span>${esc(what)}</span></li>`).join('')}</ul><p class="cd-key">Highlights, not every mission.</p>`, `${ms.length}`));
  return `<div class="sd">${out.join('')}</div>`;
}
