// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: tonight's sky, the months ahead and the far spacecraft in depth (v2.31).
// Worked out on this device with Astronomy Engine (Cross, 2023), so it opens offline too:
//   tonight     the hours of full darkness where the globe was looking, and for the Moon and each planet whether it
//               is up in them, when it is highest, in which direction, how bright and in front of which stars;
//   ahead       the next 60 days: the Moon's phases, the Moon passing close to a planet, planets close to each other,
//               oppositions and greatest elongations, the peaks of the big meteor showers and eclipses;
//   the month   the Moon's page: its phases for the next month as little drawings;
//   far craft   for Voyager 1 and 2 and New Horizons: distance from Earth now (not just the Sun), the round trip for
//               a radio command, light-day milestones, and the star each will pass next.
// docs/ASSUMPTIONS.md (v2.31) lists every approximation.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const DAY = 864e5;
export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const NAKED = new Set(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Moon']); // easy without a telescope
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Altitude and azimuth of a body from one place at one time (degrees). */
export function altAz(A, name, o, date) {
  const t = A.MakeTime(date); const eq = A.Equator(A.Body[name], t, o, true, true);
  const h = A.Horizon(t, o, eq.ra, eq.dec, 'normal'); return { alt: h.altitude, az: h.azimuth, ra: eq.ra, dec: eq.dec };
}

/**
 * The next stretch of full darkness (the Sun more than 18° below the horizon) from date, or the one under way.
 * Returns { from, to } or { none: 'midnight sun' | 'twilight all night' } near the poles in summer.
 */
export function darkness(A, obs, date) {
  const o = new A.Observer(obs.lat, obs.lng, 0); const t = A.MakeTime(date);
  const now = altAz(A, 'Sun', o, date).alt;
  // Under way: the night's darkness from its start (so evening planets that have set still count), found by searching
  // forward from 16 hours earlier.
  let from; if (now < -18) { const d = A.SearchAltitude(A.Body.Sun, o, -1, A.MakeTime(new Date(date.getTime() - 16 * 36e5)), 1, -18); from = d && d.date <= date ? d.date : date; } else { const d = A.SearchAltitude(A.Body.Sun, o, -1, t, 1.5, -18); if (!d) { return { none: A.SearchAltitude(A.Body.Sun, o, -1, t, 1.5, 0) ? 'twilight all night' : 'midnight sun' }; } from = d.date; }
  const e = A.SearchAltitude(A.Body.Sun, o, +1, A.MakeTime(from), 1.5, -18);
  return { from, to: e ? e.date : new Date(from.getTime() + 12 * 36e5) };
}

/** For the Moon and each planet: whether it is up during tonight's darkness (or twilight, for Mercury and Venus). */
export function tonight(A, obs, date) {
  const o = new A.Observer(obs.lat, obs.lng, 0); const dk = darkness(A, obs, date);
  // Mercury and Venus are seen in twilight, so the window starts and ends with the Sun 6° down.
  let from = dk.from; let to = dk.to;
  if (dk.none) { from = date; to = new Date(date.getTime() + DAY); }
  const tw0 = new Date(from.getTime() - 90 * 6e4); const tw1 = new Date(to.getTime() + 90 * 6e4);
  const rows = ['Moon', ...PLANETS].map((name) => {
    const inner = name === 'Mercury' || name === 'Venus'; const a = inner ? tw0 : from; const b = inner ? tw1 : to;
    let best = null; for (let ms = a.getTime(); ms <= b.getTime(); ms += 10 * 6e4) {
      const d = new Date(ms); if (inner && altAz(A, 'Sun', o, d).alt > -6) continue;
      const h = altAz(A, name, o, d); if (!best || h.alt > best.alt) best = { ...h, at: d };
    }
    let mag = null; try { mag = A.Illumination(A.Body[name], A.MakeTime(date)).mag; } catch { /* none */ }
    let con = ''; try { const eq = A.Equator(A.Body[name], A.MakeTime(date), o, false, true); con = A.Constellation(eq.ra, eq.dec).name; } catch { /* none */ }
    const up = best && best.alt > 10; return { name, up, best, mag, con, naked: NAKED.has(name), elong: name === 'Moon' ? null : A.AngleFromSun(A.Body[name], A.MakeTime(date)) };
  });
  return { dark: dk, rows };
}

// The big annual meteor showers: [name, peak month (1–12), day, typical hourly rate at a dark site (ZHR), parent].
// Peak dates vary by a day from year to year (International Meteor Organization calendar).
export const SHOWERS = [['Quadrantids', 1, 3, 110, 'asteroid 2003 EH1'], ['Lyrids', 4, 22, 18, 'comet Thatcher'], ['Eta Aquariids', 5, 6, 50, 'Halley’s comet'],
  ['Perseids', 8, 12, 100, 'comet Swift–Tuttle'], ['Draconids', 10, 8, 10, 'comet Giacobini–Zinner'], ['Orionids', 10, 21, 20, 'Halley’s comet'], ['Leonids', 11, 17, 15, 'comet Tempel–Tuttle'],
  ['Geminids', 12, 14, 150, 'asteroid 3200 Phaethon'], ['Ursids', 12, 22, 10, 'comet Tuttle']];
const QUARTER = ['New Moon', 'First quarter', 'Full Moon', 'Last quarter'];
/** Everything worth looking up for in the next `days` days, in date order: { date, kind, text, body? }. */
export function ahead(A, date, days = 60) {
  const t0 = A.MakeTime(date); const end = date.getTime() + days * DAY; const out = [];
  let q = A.SearchMoonQuarter(t0);
  while (q.time.date.getTime() < end) { out.push({ date: q.time.date, kind: 'moon', text: QUARTER[q.quarter], q: q.quarter }); q = A.NextMoonQuarter(q); }
  for (const p of PLANETS) {
    try {
      if (p === 'Mercury' || p === 'Venus') { let e = A.SearchMaxElongation(A.Body[p], t0); if (e.time.date.getTime() < end) out.push({ date: e.time.date, kind: 'planet', body: p, text: `${p} at its farthest from the Sun in the ${e.visibility} sky (${Math.round(e.elongation)}°): best seen ${e.visibility === 'morning' ? 'before sunrise' : 'after sunset'}` }); }
      else { const r = A.SearchRelativeLongitude(A.Body[p], 0, t0); if (r.date.getTime() < end) out.push({ date: r.date, kind: 'planet', body: p, text: `${p} at opposition: up all night, at its closest and brightest` }); }
    } catch { /* skip */ }
  }
  // The Moon near a planet, and planets near each other: the closest point of each pass under 4° (2° for planets).
  const sep = (a, b, ms) => { const t = A.MakeTime(new Date(ms)); return A.AngleBetween(A.GeoVector(A.Body[a], t, true), A.GeoVector(A.Body[b], t, true)); };
  const passes = (a, b, lim, step) => {
    for (let ms = date.getTime() + step; ms < end - step; ms += step) {
      const s0 = sep(a, b, ms - step); const s1 = sep(a, b, ms); const s2 = sep(a, b, ms + step);
      if (s1 < lim && s1 <= s0 && s1 < s2) { let lo = ms - step; let hi = ms + step; for (let i = 0; i < 20; i++) { const m1 = lo + (hi - lo) / 3; const m2 = hi - (hi - lo) / 3; if (sep(a, b, m1) < sep(a, b, m2)) hi = m2; else lo = m1; } const m = (lo + hi) / 2; out.push({ date: new Date(m), kind: 'pair', body: b, text: `${a === 'Moon' ? 'The Moon' : a} ${fmt(sep(a, b, m), 1)}° from ${b}`, sepDeg: sep(a, b, m) }); }
    }
  };
  for (const p of PLANETS.filter((x) => NAKED.has(x))) passes('Moon', p, 4, 6 * 36e5);
  for (let i = 0; i < PLANETS.length; i++) for (let j = i + 1; j < PLANETS.length; j++) if (NAKED.has(PLANETS[i]) && NAKED.has(PLANETS[j])) passes(PLANETS[i], PLANETS[j], 2, DAY);
  const y = date.getUTCFullYear();
  for (const yy of [y, y + 1]) for (const [n, m, d, zhr, parent] of SHOWERS) { const ms = Date.UTC(yy, m - 1, d, 12); if (ms >= date.getTime() - DAY / 2 && ms < end) out.push({ date: new Date(ms), kind: 'shower', text: `${n} meteor shower peaks: up to about ${zhr} an hour under a dark sky, from ${parent}`, zhr }); }
  try { const le = A.SearchLunarEclipse(t0); if (le.peak.date.getTime() < end) out.push({ date: le.peak.date, kind: 'eclipse', text: `${le.kind[0].toUpperCase()}${le.kind.slice(1)} eclipse of the Moon` }); } catch { /* none */ }
  try { const se = A.SearchGlobalSolarEclipse(t0); if (se.peak.date.getTime() < end) out.push({ date: se.peak.date, kind: 'eclipse', text: `${se.kind[0].toUpperCase()}${se.kind.slice(1)} eclipse of the Sun (somewhere on Earth)` }); } catch { /* none */ }
  return out.sort((a, b) => a.date - b.date);
}

/** A small drawing of the Moon's phase: q 0 new, 1 first quarter, 2 full, 3 last quarter (northern-hemisphere view). */
export function phaseSvg(q, size = 26) {
  const r = size / 2 - 1; const c = size / 2;
  const lit = q === 2 ? `<circle cx="${c}" cy="${c}" r="${r}" class="sk-lit"/>` : q === 0 ? '' : `<path d="M${c} ${c - r} A${r} ${r} 0 0 ${q === 1 ? 1 : 0} ${c} ${c + r} Z" class="sk-lit"/>`;
  return `<svg class="sk-phase" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" class="sk-dark"/>${lit}</svg>`;
}

// ---------------------------------------------------------------- the far spacecraft
const AU_KM = 149597870.7; const C_KM_S = 299792.458; const LIGHT_DAY_AU = (C_KM_S * 86400) / AU_KM; // 173.14 AU
/** A probe's position as a heliocentric J2000 equatorial vector in AU, from its published distance and direction. */
export function probeVec(p, date) {
  const au = p.au + (p.auYr * (date.getTime() - Date.UTC(2025, 0, 1))) / 31557600000;
  const a = (p.ra * 15 * Math.PI) / 180; const d = (p.dec * Math.PI) / 180;
  return { au, x: au * Math.cos(d) * Math.cos(a), y: au * Math.cos(d) * Math.sin(a), z: au * Math.sin(d) };
}
// What lies ahead of each: the star it will pass closest to in the next 100,000 years (NASA/JPL mission pages).
export const PROBE_MORE = {
  voyager1: { next: 'In about 40,000 years it will pass 1.6 light-years from the star Gliese 445, in the constellation of Camelopardalis.', carries: 'a gold-plated record of sounds and pictures from Earth', still: 'Still sending from its last few instruments, which measure the magnetic field and the charged gas around it; the others are off to save power.', power: 'Its plutonium power supply gives about 4 watts less every year, so instruments are switched off one by one.' },
  voyager2: { next: 'In about 40,000 years it will pass 1.7 light-years from the star Ross 248, in the constellation of Andromeda.', carries: 'a gold-plated record of sounds and pictures from Earth', still: 'Still sending from its last few instruments. It flies south of the planets, so only the big dish near Canberra, Australia, can send it commands.', power: 'Its plutonium power supply gives about 4 watts less every year, so instruments are switched off one by one.' },
  newhorizons: { next: 'It is heading out through the Kuiper belt; it will leave the Sun’s bubble of solar wind in the 2040s, if it is still working.', carries: 'a small part of the ashes of Clyde Tombaugh, who discovered Pluto in 1930', still: 'Still studying the Kuiper belt and the solar wind, and taking pictures of the stars from where no camera has been.' },
};
/** The far spacecraft's page sections: from Earth now, signal times, milestones, what is next. */
export function probeSections(A, p, date) {
  const v = probeVec(p, date); const e = A.HelioVector(A.Body.Earth, A.MakeTime(date)); // equatorial J2000, AU
  const dEarth = Math.hypot(v.x - e.x, v.y - e.y, v.z - e.z); const hours = (dEarth * AU_KM) / C_KM_S / 3600;
  const more = PROBE_MORE[p.id] ?? {};
  const rows = [['From Earth now', `${fmt(dEarth, 1)} AU (${fmt((dEarth * AU_KM) / 1e9, 1)} billion km): ${dEarth > v.au ? 'farther' : 'nearer'} than from the Sun, as Earth is on the ${dEarth > v.au ? 'far' : 'near'} side`],
    ['A command and its answer take', `${fmt(hours * 2, 1)} hours there and back`],
    ['Its speed away from the Sun', `${fmt((p.auYr * AU_KM) / 31557600, 1)} km/s, ${fmt(p.auYr, 2)} AU a year`]];
  const tLD = Date.UTC(2025, 0, 1) + ((LIGHT_DAY_AU - p.au) / p.auYr) * 31557600000;
  const ldWhen = new Date(tLD);
  rows.push(['One light-day from the Sun (173 AU)', tLD <= date.getTime() ? `passed in ${ldWhen.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` : `in ${ldWhen.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`]);
  const lt = (p.au + p.auYr * ((date.getTime() - Date.UTC(2025, 0, 1)) / 31557600000)) / 63241.1; // light-years
  rows.push(['How far it has gone towards the nearest star', `${fmt(lt * 100 / 4.24, 3)} % of the distance to Proxima Centauri, the nearest star (4.24 light-years); at its speed that distance takes about ${fmt(Math.round(4.24 * 63241.1 / p.auYr / 1000) * 1000)} years, though it is not heading there`]);
  return `<dl class="sd-facts">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
    ${more.still ? `<p>${esc(more.still)} ${esc(more.power ?? '')}</p>` : ''}
    ${more.carries ? `<p class="small">It carries ${esc(more.carries)}.</p>` : ''}
    ${more.next ? `<p class="small"><b>Next:</b> ${esc(more.next)}</p>` : ''}`;
}

// ---------------------------------------------------------------- the pages
const sec = (title, body, sum = '', open = false) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small>${sum}</small></summary><div>${body}</div></details>`;
const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dmy = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** The solar system card's two new sections: tonight's sky and the next 60 days. */
export function skySections(A, obs, date) {
  if (!A || !obs) return '';
  const where = esc(obs.place || `${fmt(Math.abs(obs.lat), 1)}° ${obs.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(obs.lng), 1)}° ${obs.lng >= 0 ? 'E' : 'W'}`);
  const tn = tonight(A, obs, date); const seen = tn.rows.filter((r) => r.up);
  const darkLine = tn.dark.none ? `No full darkness here tonight (${tn.dark.none}).` : `Full darkness from ${hm(tn.dark.from)} until ${hm(tn.dark.to)}${tn.dark.from.getTime() <= date.getTime() ? '; it is dark now' : ''}.`;
  const list = `<ul class="sk-list">${tn.rows.map((r) => `<li class="${r.up ? 'sk-up' : 'sk-down'}"><button class="linkish" data-space="${r.name.toLowerCase()}">${esc(r.name)}</button><span>${r.up ? `highest ${fmt(r.best.alt)}° in the ${compass(r.best.az)} at ${hm(r.best.at)}${r.mag != null ? `, magnitude ${fmt(r.mag, 1)}` : ''}${r.naked ? '' : ', binoculars or a telescope'}` : r.elong != null && r.elong < 15 ? 'too close to the Sun to see' : 'not up in the dark hours'}</span><small>${esc(r.con)}</small></li>`).join('')}</ul>`;
  const ev = ahead(A, date, 60);
  const evHtml = ev.length ? `<ul class="sk-ahead">${ev.map((e) => `<li class="sk-${e.kind}"><b>${dmy(e.date)}</b>${e.kind === 'moon' ? phaseSvg(e.q, 18) : '<i></i>'}<span>${esc(e.text)}</span></li>`).join('')}</ul>` : '';
  return sec(`Tonight from ${where}`, `<p class="cd-key">${darkLine} The place the globe was looking at, in your device’s time zone; magnitude: smaller is brighter, the brightest stars are about 0.</p>${list}`, `${seen.length} to see`, true)
    + sec('The next 60 days', `${evHtml}<p class="cd-key">Times are when it is closest or exact, wherever you are; meteor peaks vary by a day year to year and the Moon washes out faint meteors.</p>`, `${ev.length} events`);
}
/** The Moon's page: its phases over the next month. */
export function moonMonth(A, date) {
  if (!A) return '';
  let q = A.SearchMoonQuarter(A.MakeTime(date)); const rows = [];
  for (let i = 0; i < 5; i++) { rows.push(q); q = A.NextMoonQuarter(q); }
  return sec('The month ahead', `<div class="sk-month">${rows.map((r) => `<div>${phaseSvg(r.quarter, 34)}<b>${QUARTER[r.quarter]}</b><small>${dmy(r.time.date)}</small></div>`).join('')}</div><p class="cd-key">As seen from the northern hemisphere; south of the equator the lit side is the other way round.</p>`, `${QUARTER[rows[0].quarter].toLowerCase()} ${dmy(rows[0].time.date)}`);
}
