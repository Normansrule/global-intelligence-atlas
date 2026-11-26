// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.36: spacecraft at work. The observatories parked at the Sun–Earth Lagrange points
// (L1 towards the Sun, L2 away from it), the orbiters and rovers at Mars, the probe that dives closest to the Sun, and
// the missions on their way. Where a place can be worked out honestly on the device it is: L1 and L2 sit about
// 1.5 million km from the Earth along the Sun–Earth line, the Mars fleet is wherever Mars is, and Parker Solar Probe's
// distance from the Sun follows its fixed orbit (a Kepler ellipse timed from a known close pass). The ones in cruise
// have no position here, only where they are going and when.
//
// Mission facts (launch dates, what each does) are typed from NASA, ESA, ISRO, JAXA and UAE Space Agency pages;
// statuses are as of mid-2025 and are not re-checked here (see docs/ASSUMPTIONS.md, v2.36).
// Pure functions: the caller passes the Earth–Mars distance and the date.

const DAY = 864e5; const AU_KM = 149597870.7; const C_KM_S = 299792.458; const GM_SUN = 1.32712440018e11; // km³/s²
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const ymd = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const dl = (rows) => `<dl class="sd-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

/** Where each group is. L1 and L2: the Sun–Earth points about 1.5 million km from the Earth (0.01 AU). */
export const PLACES = {
  l1: { name: 'Sun–Earth L1', short: 'L1', km: 1.49e6, dot: '#ffd27a', what: 'the point about 1.5 million km from the Earth towards the Sun where the Sun’s and the Earth’s pulls balance for something going round the Sun with the Earth. From there a spacecraft sees the Sun without ever being eclipsed, and catches the solar wind about an hour before it reaches us.' },
  l2: { name: 'Sun–Earth L2', short: 'L2', km: 1.51e6, dot: '#b7a3ff', what: 'the point about 1.5 million km from the Earth on the far side from the Sun. A telescope there keeps the Sun, the Earth and the Moon behind its shield on one side, so it can stay cold and look out at the whole sky over a year.' },
  mars: { name: 'Mars', short: 'Mars', dot: '#ff8a5c', what: 'in orbit around Mars or on its surface. The orbiters map it, watch its weather and thin air escaping, and relay the rovers’ data to Earth.' },
  sun: { name: 'Around the Sun', short: 'Sun', dot: '#ffb347', what: 'on its own orbit round the Sun, swooping in close to study the Sun’s outer atmosphere and the wind it blows out.' },
  cruise: { name: 'On the way', short: 'Cruise', dot: '#7fe3c4', what: 'between the planets, on the way to where it will work.' },
};

/** The fleet. `launched` is the launch year; `arrives` for those in cruise. Statuses as of mid-2025 (not re-checked). */
export const CRAFT = [
  { id: 'jwst', name: 'James Webb Space Telescope', short: 'Webb', place: 'l2', agency: 'NASA, ESA and the Canadian Space Agency', launched: 2021, ref: 'nasajwst',
    does: 'The biggest telescope in space, a 6.5 m gold-coated mirror looking in infrared: the first galaxies, stars being born and the air of planets round other stars.', fact: 'Launched on 25 December 2021, it reached L2 about a month later. Its sunshield, the size of a tennis court, keeps the mirror below about −220 °C.' },
  { id: 'euclid', name: 'Euclid', short: 'Euclid', place: 'l2', agency: 'ESA', launched: 2023, ref: 'esascience',
    does: 'Maps billions of galaxies across a third of the sky to measure dark matter and dark energy, from how the universe’s shape has stretched over 10 billion years.', fact: 'Launched in July 2023; its first full-sky data release is due in 2026.' },
  { id: 'soho', name: 'SOHO (Solar and Heliospheric Observatory)', short: 'SOHO', place: 'l1', agency: 'ESA and NASA', launched: 1995, ref: 'esascience',
    does: 'Watches the Sun without a break: its corona, the eruptions it throws out, and how it shakes inside.', fact: 'Launched in December 1995 for a two-year mission, it is still working nearly 30 years on. Its pictures have also found more than 5,000 comets, most of them by amateurs looking at the public images.' },
  { id: 'dscovr', name: 'DSCOVR (Deep Space Climate Observatory)', short: 'DSCOVR', place: 'l1', agency: 'NOAA and NASA', launched: 2015, ref: 'nasaepic',
    does: 'Measures the solar wind for space-weather warnings, and its EPIC camera photographs the whole sunlit Earth several times a day.', fact: 'Its full-disc pictures of the Earth are published every day on NASA’s EPIC site.' },
  { id: 'aditya', name: 'Aditya-L1', short: 'Aditya-L1', place: 'l1', agency: 'ISRO (Indian Space Research Organisation)', launched: 2023, ref: 'isroaditya',
    does: 'India’s first solar observatory: the Sun’s corona and the particles and magnetic field of the solar wind.', fact: 'Launched in September 2023, it reached its orbit round L1 on 6 January 2024.' },
  { id: 'ace', name: 'ACE (Advanced Composition Explorer)', short: 'ACE', place: 'l1', agency: 'NASA', launched: 1997, ref: 'esascience',
    does: 'Samples the particles of the solar wind and from beyond the solar system; with DSCOVR it gives about an hour’s warning of solar storms.', fact: 'Launched in August 1997.' },
  { id: 'mro', name: 'Mars Reconnaissance Orbiter', short: 'MRO', place: 'mars', agency: 'NASA', launched: 2005, ref: 'nasamars',
    does: 'Its HiRISE camera sees things on Mars as small as a kitchen table; it also scouts landing sites and relays rover data.', fact: 'In orbit since March 2006.' },
  { id: 'odyssey', name: '2001 Mars Odyssey', short: 'Odyssey', place: 'mars', agency: 'NASA', launched: 2001, ref: 'nasamars',
    does: 'Mapped the ice under Mars’s surface and still relays rover data.', fact: 'The longest-working spacecraft at another planet, in orbit since October 2001.' },
  { id: 'maven', name: 'MAVEN (Mars Atmosphere and Volatile Evolution)', short: 'MAVEN', place: 'mars', agency: 'NASA', launched: 2013, ref: 'nasamars',
    does: 'Measures how the Sun strips Mars’s upper air away, which tells how Mars lost most of its atmosphere and water.', fact: 'In orbit since September 2014.' },
  { id: 'mex', name: 'Mars Express', short: 'Mars Express', place: 'mars', agency: 'ESA', launched: 2003, ref: 'esascience',
    does: 'Europe’s first mission to another planet: 3D maps of the surface, and radar that found signs of water under the south polar ice.', fact: 'In orbit since December 2003.' },
  { id: 'tgo', name: 'ExoMars Trace Gas Orbiter', short: 'TGO', place: 'mars', agency: 'ESA', launched: 2016, ref: 'esascience',
    does: 'Sniffs the thin air for traces of gases such as methane, and maps water ice just below the surface.', fact: 'In orbit since October 2016.' },
  { id: 'hope', name: 'Hope (Emirates Mars Mission)', short: 'Hope', place: 'mars', agency: 'UAE Space Agency and the Mohammed bin Rashid Space Centre', launched: 2020, ref: 'nasamars',
    does: 'The first full picture of Mars’s weather through a whole Martian day and year, from a high orbit.', fact: 'The Arab world’s first planetary mission, in orbit since February 2021.' },
  { id: 'curiosity', name: 'Curiosity rover', short: 'Curiosity', place: 'mars', surface: true, agency: 'NASA', launched: 2011, ref: 'nasamars',
    does: 'A car-sized rover climbing Mount Sharp in Gale Crater, reading the rock layers of an old lake.', fact: 'Landed on 6 August 2012.' },
  { id: 'perseverance', name: 'Perseverance rover', short: 'Perseverance', place: 'mars', surface: true, agency: 'NASA', launched: 2020, ref: 'nasamars',
    does: 'Looks for signs of past life in Jezero Crater, an old river delta, and seals rock samples in tubes for a later mission to bring home.', fact: 'Landed on 18 February 2021, with the Ingenuity helicopter, which made 72 flights before it was grounded in January 2024.' },
  { id: 'parker', name: 'Parker Solar Probe', short: 'Parker', place: 'sun', agency: 'NASA', launched: 2018, ref: 'nasaparker',
    does: 'Flies through the Sun’s outer atmosphere, the corona, to find out what heats it and drives the solar wind.', fact: 'On 24 December 2024 it passed 6.1 million km from the Sun’s surface at about 190 km/s, the closest and fastest any human-made object has been.' },
  { id: 'solo', name: 'Solar Orbiter', short: 'Solar Orbiter', place: 'sun', agency: 'ESA and NASA', launched: 2020, ref: 'esascience',
    does: 'Takes the closest pictures of the Sun, and is tilting its orbit to see the Sun’s poles for the first time.', fact: 'In 2025 it sent the first pictures of the Sun’s south pole.' },
  { id: 'clipper', name: 'Europa Clipper', short: 'Europa Clipper', place: 'cruise', to: 'Jupiter, for Europa', arrives: 2030, agency: 'NASA', launched: 2024, ref: 'nasamissions',
    does: 'Will fly past Jupiter’s moon Europa about 49 times to find out whether the ocean under its ice could support life.', fact: 'The biggest planetary spacecraft NASA has built; launched on 14 October 2024.' },
  { id: 'juice', name: 'JUICE (Jupiter Icy Moons Explorer)', short: 'JUICE', place: 'cruise', to: 'Jupiter, then orbit Ganymede', arrives: 2031, agency: 'ESA', launched: 2023, ref: 'esascience',
    does: 'Will study Ganymede, Callisto and Europa, and become the first spacecraft to orbit a moon other than our own.', fact: 'Launched in April 2023; it flew past the Moon and the Earth in August 2024 and Venus in August 2025.' },
  { id: 'bepi', name: 'BepiColombo', short: 'BepiColombo', place: 'cruise', to: 'Mercury', arrives: 2026, agency: 'ESA and JAXA', launched: 2018, ref: 'esascience',
    does: 'Two orbiters travelling together, one European and one Japanese, to study Mercury’s surface, inside and magnetic field.', fact: 'Launched in October 2018; after six flybys of Mercury it was due to go into orbit round it in late 2026.' },
  { id: 'lucy', name: 'Lucy', short: 'Lucy', place: 'cruise', to: 'the Trojan asteroids that share Jupiter’s orbit', arrives: 2027, agency: 'NASA', launched: 2021, ref: 'nasamissions',
    does: 'Will visit eight asteroids, most of them Trojans, leftovers from when the planets formed.', fact: 'On the way it flew past Dinkinesh in 2023, finding it has a small moon, and Donaldjohanson in April 2025.' },
  { id: 'hera', name: 'Hera', short: 'Hera', place: 'cruise', to: 'Didymos and Dimorphos', arrives: 2026, agency: 'ESA', launched: 2024, ref: 'esascience',
    does: 'Will measure the crater DART left and Dimorphos’s new orbit, turning the first asteroid deflection test into a method.', fact: 'Launched in October 2024; it flew past Mars and its moon Deimos in March 2025.', asteroid: 'didymos' },
  { id: 'psyche-craft', name: 'Psyche', short: 'Psyche', place: 'cruise', to: 'the metal-rich asteroid Psyche', arrives: 2029, agency: 'NASA', launched: 2023, ref: 'nasamissions',
    does: 'Will orbit Psyche, perhaps part of the iron core of a world that lost its rocky outside.', fact: 'Launched on 13 October 2023; it is pushed by electric (ion) thrusters.', asteroid: 'psyche' },
];
export const CRAFT_BY = Object.fromEntries(CRAFT.map((c) => [c.id, c]));

/** Parker Solar Probe's final orbit (from December 2024): a fixed ellipse round the Sun, timed from its 22nd close pass.
 *  Closest 0.0459 AU from the Sun's centre (6.9 million km; 6.1 million above the surface), round every 88 days. */
export const PARKER = { q: 0.0459, periodD: 88, tp: Date.UTC(2024, 11, 24, 11, 53) };

/** Where Parker is on its orbit at `ms`: distance from the Sun (AU), speed (km/s), falling in or climbing out, next close pass. */
export function parkerNow(ms, P = PARKER) {
  const a = (P.periodD / 365.25) ** (2 / 3); const e = 1 - P.q / a;
  const n = (ms - P.tp) / (P.periodD * DAY); const orbits = Math.floor(n); const M = 2 * Math.PI * (n - orbits);
  let E = M; for (let i = 0; i < 30; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const r = a * (1 - e * Math.cos(E)); const rKm = r * AU_KM; const aKm = a * AU_KM;
  return { r, a, e, rKm, v: Math.sqrt(GM_SUN * (2 / rKm - 1 / aKm)), inbound: M > Math.PI, nextMs: P.tp + (orbits + 1) * P.periodD * DAY, pass: orbits + 23, Q: a * (1 + e) };
}

/** How far a spacecraft is from the Earth now, in km, or null when it has no position here (cruise). */
export function fromEarthKm(c, { marsAU, ms }) {
  if (c.place === 'l1' || c.place === 'l2') return PLACES[c.place].km;
  if (c.place === 'mars') return marsAU != null ? marsAU * AU_KM : null;
  return null;
}
const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const signal = (km) => { const s = km / C_KM_S; return s < 90 ? `${fmt(s, 1)} seconds` : `${fmt(s / 60, 1)} minutes`; };

/** Rows for the solar system card's table: [{ c, where, far, sig }]. */
export function craftRows(ctx) {
  return CRAFT.map((c) => {
    const km = fromEarthKm(c, ctx);
    const where = c.place === 'cruise' ? `to ${c.to}, ${c.arrives}` : c.place === 'sun' && c.id === 'parker' ? `${fmt(parkerNow(ctx.ms).rKm / 1e6, 1)} million km from the Sun` : `${PLACES[c.place].short}${c.surface ? ' (surface)' : ''}`;
    return { c, where, far: km == null ? '—' : km < 1e7 ? `${fmt(km / 1e6, 2)} million km` : `${fmt(km / AU_KM, 2)} AU`, sig: km == null ? '—' : signal(km) };
  });
}

/** A sketch of the Sun, L1, the Earth and L2 along one line (not to scale: the Sun is 100 times farther than L1). */
export function lagrangeSvg(which) {
  const on = (k) => (k === which ? ' class="on"' : '');
  return `<svg class="lg-svg" viewBox="0 0 320 70" role="img" aria-label="The Sun on the left, then L1, the Earth and L2 along one line; ${which === 'l1' ? 'L1, between the Sun and the Earth' : 'L2, beyond the Earth'}, is marked">
    <circle cx="22" cy="35" r="18" fill="#ffc861"/><text x="22" y="66" text-anchor="middle">Sun</text>
    <path d="M44 35 H300" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 4"/><text x="120" y="28" text-anchor="middle" opacity="0.7">≈150 million km</text>
    <g${on('l1')}><circle cx="205" cy="35" r="5"/><text x="205" y="58" text-anchor="middle">L1</text></g>
    <circle cx="245" cy="35" r="8" fill="#5b8fd8"/><text x="245" y="58" text-anchor="middle">Earth</text>
    <g${on('l2')}><circle cx="285" cy="35" r="5"/><text x="285" y="58" text-anchor="middle">L2</text></g>
    <text x="245" y="16" text-anchor="middle" opacity="0.7">1.5 million km each side</text></svg><p class="small muted">Not to scale: the Sun is about 100 times farther from the Earth than L1 or L2.</p>`;
}

/** The page of one spacecraft. */
export function craftSections(c, ctx) {
  const pl = PLACES[c.place]; const km = fromEarthKm(c, ctx);
  const where = [['Where', esc(pl.name) + (c.surface ? ', on the surface' : c.place === 'mars' ? ', in orbit' : '')]];
  if (km != null) where.push(['From the Earth now', `${km < 1e7 ? `${fmt(km / 1e6, 2)} million km` : `${fmt(km / AU_KM, 2)} AU (${fmt(km / 1e6, 0)} million km)`}`], ['A radio signal takes', `${signal(km)} each way`]);
  if (c.id === 'parker') {
    const p = parkerNow(ctx.ms);
    where.push(['From the Sun now', `${fmt(p.rKm / 1e6, 1)} million km (${fmt(p.r, 3)} AU), ${p.inbound ? 'falling in towards the Sun' : 'climbing away from it'}`],
      ['Speed', `${fmt(p.v, 0)} km/s round the Sun`], ['Next close pass', `${ymd(p.nextMs)} (about its ${ord(p.pass)}), 6.1 million km above the surface at about ${fmt(Math.sqrt(GM_SUN * (2 / (PARKER.q * AU_KM) - 1 / (p.a * AU_KM))), 0)} km/s`],
      ['Its orbit', `every ${PARKER.periodD} days, from ${fmt(PARKER.q, 3)} AU out to ${fmt(p.Q, 2)} AU, nearly to Venus’s orbit`]);
  }
  if (c.place === 'cruise') where.push(['Going to', esc(c.to)], ['Arrives', String(c.arrives)]);
  where.push(['Launched', String(c.launched)], ['Run by', esc(c.agency)]);
  const near = CRAFT.filter((x) => x.place === c.place && x.id !== c.id);
  return sec('Where it is', dl(where), km != null ? (km < 1e7 ? `${fmt(km / 1e6, 1)} million km away` : `${fmt(km / AU_KM, 2)} AU away`) : c.place === 'sun' ? 'round the Sun' : `arrives ${c.arrives}`, true)
    + (c.place === 'l1' || c.place === 'l2' ? lagrangeSvg(c.place) : '')
    + sec('What it does', `<p>${esc(c.does)}</p><p>${esc(c.fact)}</p>`, '', true)
    + sec(`About ${esc(pl.name)}`, `<p>Here means ${esc(pl.what)}</p>${near.length ? `<p><b>Also there:</b> ${near.map((x) => `<button class="linkish" data-space-craft="${x.id}">${esc(x.short)}</button>`).join(', ')}.</p>` : ''}`, `${near.length + 1} spacecraft`)
    + (c.asteroid ? `<p><button class="btn ghost" data-space-asteroid="${c.asteroid}">Where its asteroid is now</button></p>` : '');
}
