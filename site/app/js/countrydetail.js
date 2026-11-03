// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one country in depth.
// Click a country and its card becomes a country page drawn the Isotype way: its people as rows of identical
// figures (coloured by who lives in towns and cities), its rank among all countries, the country against the
// world for the measures that say most about daily life (each with its trend since 1990), its neighbours as
// buttons, the local time and daylight in its capital, and what is happening inside its borders right now on
// the layers you have on. On the globe it is outlined in gold with its neighbours traced and its capital marked.
// Facts come live from REST Countries, the World Bank and Wikipedia; nothing is copied into the site.
import { getFeed } from './feeds.js';
import { unitSvg, glyphSvg } from './icons.js';
import { solarElevation } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
const big = (n) => (n >= 1e12 ? `${fmt(n / 1e12, 1)} trillion` : n >= 1e9 ? `${fmt(n / 1e9, n < 1e10 ? 1 : 0)} billion` : n >= 1e6 ? `${fmt(n / 1e6, n < 1e7 ? 1 : 0)} million` : fmt(n));
const iso2 = (f) => f?.properties?.['ISO3166-1-Alpha-2'];

// The measures shown against the world: World Bank indicator, label, how to print it, whether higher is better.
export const MEASURES = [
  ['NY.GDP.PCAP.CD', 'Income per person', (v) => `$${fmt(v)}`, 'GDP per person, current US dollars'],
  ['SP.DYN.LE00.IN', 'Life expectancy', (v) => `${fmt(v, 1)} years`, 'at birth'],
  ['SP.URB.TOTL.IN.ZS', 'Live in towns and cities', (v) => `${fmt(v)}%`, 'of people'],
  ['IT.NET.USER.ZS', 'Use the internet', (v) => `${fmt(v)}%`, 'of people'],
  ['EG.ELC.ACCS.ZS', 'Have electricity', (v) => `${fmt(v)}%`, 'of people'],
  ['EG.FEC.RNEW.ZS', 'Renewable energy', (v) => `${fmt(v)}%`, 'of the energy used'],
  ['AG.LND.FRST.ZS', 'Forest', (v) => `${fmt(v)}%`, 'of the land'],
];
const wbUrl = (cc, ind) => `https://api.worldbank.org/v2/country/${cc};WLD/indicator/${ind}?format=json&date=1990:2025&per_page=200`;
/** A World Bank response → { me: [[year, value]...], world: [[year, value]...] }, oldest first, gaps dropped. */
export function wbSeries(j, cc) {
  const rows = Array.isArray(j) ? j[1] ?? [] : [];
  const pick = (test) => rows.filter((r) => test(r) && r.value != null).map((r) => [+r.date, +r.value]).sort((a, b) => a[0] - b[0]);
  return { me: pick((r) => r.country?.id === cc || (r.countryiso3code && r.countryiso3code !== 'WLD' && r.country?.id !== '1W')), world: pick((r) => r.countryiso3code === 'WLD' || r.country?.id === '1W') };
}

/** Pick a round number of people per figure so the row has at most `max` figures. */
export function personUnit(pop, max = 20) {
  const steps = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8];
  return steps.find((u) => pop / u <= max) ?? 1e8;
}
/** The country's people as Isotype figures: urban ones in ink blue, rural ones in ochre, the last one cut to size. */
export function peopleRow(pop, urbanPct) {
  const per = personUnit(pop); const n = pop / per; const whole = Math.floor(n); const part = n - whole;
  const urbanFig = urbanPct == null ? 0 : (n * urbanPct) / 100;
  let out = '';
  for (let i = 0; i < whole + (part >= 0.1 ? 1 : 0); i++) {
    const urban = urbanPct != null && i + 0.5 < urbanFig; const cut = i === whole ? ` part" style="--i:${i};--p:${Math.round(part * 100)}%` : `" style="--i:${i}`;
    out += `<i class="cd-p ${urban ? 'tone-blue' : urbanPct == null ? 'tone-ink' : 'tone-ochre'}${cut}">${unitSvg('person', 20)}</i>`;
  }
  const what = per >= 1e6 ? `${fmt(per / 1e6)} million` : fmt(per);
  return `<div class="cd-people crow-u" role="img" aria-label="${big(pop)} people${urbanPct != null ? `, ${fmt(urbanPct)}% in towns and cities` : ''}">${out}</div>
    <p class="cd-key">One figure = ${what} people${urbanPct != null ? ` · <span class="cd-sw tone-blue"></span>towns and cities · <span class="cd-sw tone-ochre"></span>countryside` : ''}</p>`;
}

/** A small line of a series since 1990, with the world's line under it. */
function spark(me, world, W = 92, H = 26) {
  if (me.length < 2) return '';
  const all = [...me, ...world]; const x0 = Math.min(...all.map((p) => p[0])); const x1 = Math.max(...all.map((p) => p[0]));
  const lo = Math.min(...all.map((p) => p[1])); const hi = Math.max(...all.map((p) => p[1])); const sx = (x) => 2 + ((x - x0) / Math.max(1, x1 - x0)) * (W - 4); const sy = (y) => H - 3 - ((y - lo) / Math.max(1e-9, hi - lo)) * (H - 6);
  const line = (s) => s.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('');
  const [lx, ly] = me[me.length - 1];
  return `<svg class="cd-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">${world.length > 1 ? `<path d="${line(world)}" class="cd-world"/>` : ''}<path d="${line(me)}" class="cd-me"/><circle cx="${sx(lx).toFixed(1)}" cy="${sy(ly).toFixed(1)}" r="2.2" class="cd-dot"/></svg>`;
}
/** One measure: the latest value, the world's, a bar with both marked, and the trend since 1990. */
function measureRow([, label, show, unit], s, max) {
  const me = s.me.at(-1); if (!me) return '';
  const w = s.world.at(-1); const top = max ?? Math.max(me[1], w?.[1] ?? 0) * 1.15;
  const pc = (v) => `${Math.max(0, Math.min(100, (v / top) * 100)).toFixed(1)}%`;
  const first = s.me.find((p) => p[0] >= 2000) ?? s.me[0]; const change = first && first !== me ? me[1] - first[1] : null;
  const pct = unit.startsWith('of');
  const trend = change == null ? '' : pct ? `${change >= 0 ? 'up' : 'down'} ${fmt(Math.abs(change), 0)} points since ${first[0]}` : first[1] ? `${change >= 0 ? 'up' : 'down'} ${fmt(Math.abs(change / first[1]) * 100, 0)}% since ${first[0]}` : '';
  return `<li class="cd-m"><div class="cd-mh"><span>${esc(label)}</span><b>${esc(show(me[1]))}</b></div>
    <div class="cd-bar" role="img" aria-label="${esc(label)}: ${esc(show(me[1]))}${w ? `, world ${esc(show(w[1]))}` : ''}"><span style="width:${pc(me[1])}"></span>${w ? `<i style="left:${pc(w[1])}" title="World ${esc(show(w[1]))}"></i>` : ''}</div>
    <div class="cd-mf"><small>${esc(unit)} · ${me[0]}${w ? ` · world ${esc(show(w[1]))}` : ''}${trend ? ` · ${esc(trend)}` : ''}</small>${spark(s.me, s.world)}</div></li>`;
}

// ---------------------------------------------------------------- geometry
function polysOf(f) { const g = f?.geometry; return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
/** A point-in-country test with a bounding-box pre-check, built once per country. */
export function insideTest(f) {
  const polys = polysOf(f); let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const inRing = (r, lat, lng) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };
  return (lat, lng) => lat >= y0 && lat <= y1 && lng >= x0 && lng <= x1 && polys.some((p) => inRing(p[0], lat, lng) && !p.slice(1).some((h) => inRing(h, lat, lng)));
}

/** What the layers you have on show inside this country right now. */
export function liveInside(f, data, now = Date.now()) {
  const inside = insideTest(f); const out = [];
  const quakes = (data.quakes ?? []).filter((q) => now - q.properties.time < 7 * 86400_000 && inside(q.geometry.coordinates[1], q.geometry.coordinates[0]));
  if (data.quakes) out.push({ glyph: 'quake', tone: 'red', n: quakes.length, label: quakes.length === 1 ? 'earthquake this week' : 'earthquakes this week', layer: 'quakes', top: quakes.sort((a, b) => (b.properties.mag ?? 0) - (a.properties.mag ?? 0))[0] });
  const ac = data.aircraft?.ac; if (ac) { const n = ac.reduce((k, a) => k + (a.lat != null && !a.ground && inside(a.lat, a.lng) ? 1 : 0), 0); out.push({ glyph: 'plane', tone: 'blue', n, label: n === 1 ? 'plane in its sky now' : 'planes in its sky now', layer: 'aircraft' }); }
  const ev = data.events; if (Array.isArray(ev)) { const n = ev.filter((e) => { const g = e.geometry?.at?.(-1) ?? e.geometry?.[0]; const c = g?.coordinates; return c && typeof c[0] === 'number' && inside(c[1], c[0]); }).length; out.push({ glyph: 'flame', tone: 'ochre', n, label: n === 1 ? 'natural event open' : 'natural events open', layer: 'events' }); }
  const cams = data.cameras?.cams; if (cams) { const n = cams.reduce((k, c) => k + (inside(c.lat, c.lng) ? 1 : 0), 0); if (n) out.push({ glyph: 'camera', tone: 'ink', n, label: n === 1 ? 'live camera' : 'live cameras', layer: 'cameras' }); }
  const lms = (data.landmarks ?? []).filter((l) => inside(l.lat, l.lng));
  return { counts: out, landmarks: lms };
}

/** Which of its time zones the capital keeps, from REST Countries' "UTC+09:00" strings. */
export function capitalOffset(zones, capLng) {
  const offs = (zones ?? []).map((z) => { const m = /UTC([+-])(\d\d):(\d\d)/.exec(z); return z === 'UTC' ? 0 : m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null; }).filter((x) => x != null);
  if (!offs.length) return null; if (offs.length === 1 || capLng == null) return offs[0];
  return offs.reduce((b, o) => (Math.abs(o - capLng * 4) < Math.abs(b - capLng * 4) ? o : b), offs[0]);
}

// ---------------------------------------------------------------- the open country (shared with the globe)
export const cd = { cc: null, f: null, neighbours: [], capital: null, fat: null, fatKey: null };

let ALL = null;
async function allCountries() { ALL ??= getFeed('restcountries', 'https://restcountries.com/v3.1/all?fields=cca2,population,area', { ttl: 24 * 3600_000 }).catch(() => (ALL = null, null)); return ALL; }

/** The card body: drawn at once with placeholders, filled by countryFill. */
export function countryHtml(f) {
  const cc = iso2(f);
  return `<div class="cd" data-country="${esc(cc ?? '')}">
    <p class="cd-line" id="cd-line"></p>
    <div id="cd-people" class="cd-skel"></div>
    <div class="lm-facts cd-facts" id="cd-facts">${'<div class="lm-fact skel"></div>'.repeat(4)}</div>
    <details class="qd-sec" open><summary><span>Against the world</span><small>since 1990, World Bank</small></summary><ul class="cd-ms" id="cd-ms"><li class="muted">Asking the World Bank…</li></ul></details>
    <details class="qd-sec" open id="cd-live-sec"><summary><span>Inside it right now</span><small id="cd-live-sum"></small></summary><div id="cd-live"></div></details>
    <details class="qd-sec" id="cd-more-sec"><summary><span>Languages, money and more</span><small id="cd-more-sum"></small></summary><div id="cd-more"></div></details>
    <div id="cd-near"></div>
    <details class="qd-sec" id="cd-wiki-sec"><summary><span>From Wikipedia</span><small></small></summary><div id="cd-wiki"></div></details>
  </div>`;
}

/** Fill the country page. `api` gives the app's data and actions. */
export async function countryFill(f, { stillOpen, data, refresh, featureByCc }) {
  const cc = iso2(f); const name = f.properties.name; const valid = cc && /^[A-Z]{2}$/.test(cc);
  Object.assign(cd, { cc, f, neighbours: [], capital: null }); refresh();
  const live = liveInside(f, data); fillLive(live);
  if (!valid) { const el = document.getElementById('cd-people'); if (el) el.innerHTML = ''; return; }
  const A = getFeed('restcountries', `https://restcountries.com/v3.1/alpha/${cc}?fields=name,capital,capitalInfo,population,area,region,subregion,languages,currencies,timezones`, { ttl: 24 * 3600_000 }).catch(() => null);
  const B = getFeed('restcountries', `https://restcountries.com/v3.1/alpha/${cc}?fields=cca3,borders,car,idd,tld,unMember,landlocked,startOfWeek,demonyms,independent`, { ttl: 24 * 3600_000 }).catch(() => null);
  const W = Promise.all(MEASURES.map(([ind]) => getFeed('worldbank', wbUrl(cc, ind), { ttl: 24 * 3600_000 }).then((j) => wbSeries(j, cc)).catch(() => ({ me: [], world: [] }))));
  const [a0, b0, all] = await Promise.all([A, B, allCountries()]);
  if (!stillOpen()) return;
  const a = Array.isArray(a0) ? a0[0] : a0; const b = Array.isArray(b0) ? b0[0] : b0;
  const cap = a?.capital?.[0]; const capLL = a?.capitalInfo?.latlng;
  if (cap && capLL?.length === 2) { cd.capital = { name: cap, lat: capLL[0], lng: capLL[1] }; f.properties.capLat = capLL[0]; f.properties.capLng = capLL[1]; }
  // headline: capital, local time and daylight there
  const off = capitalOffset(a?.timezones, capLL?.[1]); const line = document.getElementById('cd-line');
  if (line && a) {
    let t = '';
    if (off != null) { const d = new Date(Date.now() + off * 60_000); const hh = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; const day = capLL ? solarElevation(capLL[0], capLL[1]) > -0.833 : null; t = ` · ${hh} there now${day == null ? '' : day ? ', daytime' : ', night'}`; }
    line.innerHTML = `${esc([a.name?.official !== name ? a.name?.official : null, a.subregion ?? a.region].filter(Boolean).join(' · '))}${cap ? ` · capital <b>${esc(cap)}</b>` : ''}${esc(t)}`;
  }
  // ranks among all countries
  const rank = (k) => (all && a?.[k] ? 1 + all.filter((x) => (x[k] ?? 0) > a[k]).length : null);
  const pr = rank('population'); const ar = rank('area'); const n = all?.length;
  const facts = document.getElementById('cd-facts');
  if (facts) facts.innerHTML = a ? [
    [big(a.population), pr ? `people · ${ordinal(pr)} of ${n}` : 'people'],
    [`${fmt(a.area)} km²`, ar ? `area · ${ordinal(ar)} largest` : 'area'],
    [`${fmt(a.population / Math.max(1, a.area))}`, 'people per km²'],
    [a.timezones?.length > 1 ? `${a.timezones.length}` : (a.timezones?.[0] ?? '—'), a.timezones?.length > 1 ? 'time zones' : 'time zone'],
  ].map(([v, s]) => `<div class="lm-fact"><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('') : '<p class="muted">REST Countries did not answer.</p>';
  // more
  const more = document.getElementById('cd-more');
  if (more && (a || b)) {
    const rows = [['Languages', Object.values(a?.languages ?? {}).join(', ')], ['Money', Object.values(a?.currencies ?? {}).map((c) => `${c.name}${c.symbol ? ` (${c.symbol})` : ''}`).join(', ')],
      ['People are called', b?.demonyms?.eng?.m], ['Drives on the', b?.car?.side ? `${b.car.side}` : null], ['Phone code', b?.idd?.root ? `${b.idd.root}${b.idd.suffixes?.length === 1 ? b.idd.suffixes[0] : ''}` : null],
      ['Web addresses', b?.tld?.join(' ')], ['Week starts on', b?.startOfWeek], ['United Nations member', b ? (b.unMember ? 'yes' : 'no') : null], ['Coast', b ? (b.landlocked ? 'none: landlocked' : 'yes') : null]].filter(([, v]) => v);
    more.innerHTML = `<dl class="cd-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    const sum = document.getElementById('cd-more-sum'); if (sum) sum.textContent = Object.values(a?.languages ?? {}).slice(0, 2).join(', ');
  }
  // neighbours: buttons that fly there and open their page; outlined on the globe
  const near = document.getElementById('cd-near'); const codes = b?.borders ?? [];
  if (codes.length) {
    const nb = await getFeed('restcountries', `https://restcountries.com/v3.1/alpha?codes=${codes.join(',')}&fields=name,cca2,population`, { ttl: 24 * 3600_000 }).catch(() => []);
    if (!stillOpen()) return;
    cd.neighbours = (nb ?? []).map((x) => featureByCc(x.cca2)).filter(Boolean); refresh();
    if (near) near.innerHTML = `<div class="lm-near cd-nb"><small>Borders</small>${(nb ?? []).sort((x, y) => (y.population ?? 0) - (x.population ?? 0)).map((x) => `<button class="chip" data-country-cc="${esc(x.cca2)}"><span class="flag">${flagOf(x.cca2)}</span>${esc(x.name?.common)}</button>`).join('')}</div>`;
  } else if (near && b) near.innerHTML = `<p class="cd-key">${b.landlocked ? 'Landlocked, with no land borders listed.' : 'No land borders: surrounded by sea.'}</p>`;
  // people row (needs the urban share) and the measures
  const series = await W; if (!stillOpen()) return;
  const urban = series[2].me.at(-1)?.[1];
  const ppl = document.getElementById('cd-people'); if (ppl && a?.population) { ppl.className = ''; ppl.innerHTML = peopleRow(a.population, urban); }
  const ms = document.getElementById('cd-ms');
  if (ms) { const rows = MEASURES.map((m, i) => measureRow(m, series[i], m[3].startsWith('of') ? 100 : null)).filter(Boolean); ms.innerHTML = rows.join('') || '<li class="muted">The World Bank did not answer.</li>'; }
  // Wikipedia
  getFeed('wikipedia', `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`).then((w) => {
    const el = document.getElementById('cd-wiki'); if (!el || !w?.extract || !stillOpen()) return;
    el.innerHTML = `<p>${esc(w.extract)}</p>${w.content_urls?.desktop?.page ? `<a class="btn ghost" href="${esc(w.content_urls.desktop.page)}" target="_blank" rel="noopener">Read on Wikipedia</a>` : ''}`;
    const s = document.querySelector('#cd-wiki-sec summary small'); if (s) s.textContent = w.description ?? '';
  }).catch(() => {});
}
const flagOf = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

function fillLive({ counts, landmarks }) {
  const el = document.getElementById('cd-live'); if (!el) return;
  const rows = counts.map((c) => `<button class="crow fact tone-${c.tone}" data-cd-layer="${c.layer}"${c.top ? ` data-cd-quake="${esc(c.top.id)}"` : ''}><span class="crow-l">${esc(c.label)}</span><b>${fmt(c.n)}</b><span class="crow-u">${unitSvg(c.glyph, 18)}</span><small>${c.top ? `largest: M${(c.top.properties.mag ?? 0).toFixed(1)}, ${esc(c.top.properties.place ?? '')}` : c.n ? 'show them' : 'none right now'}</small></button>`).join('');
  const lm = landmarks.slice(0, 8).map((l) => `<button class="chip" data-landmark="${esc(l.title)}">${glyphSvg('pin', '#d6a243', 16)}${esc(l.title)}</button>`).join('');
  el.innerHTML = `${rows ? `<div class="facts">${rows}</div>` : '<p class="cd-key">Switch on Earthquakes, Live flights or Natural events to count them here.</p>'}${lm ? `<div class="lm-near"><small>Landmarks</small>${lm}</div>` : ''}`;
  const sum = document.getElementById('cd-live-sum'); if (sum) sum.textContent = counts.filter((c) => c.n).map((c) => `${fmt(c.n)} ${c.label.split(' ')[0]}`).join(', ');
}

/** What the open country adds to the globe: its outline in gold, its neighbours traced, its capital marked. */
export function countryOverlay(ctx) {
  if (!cd.f) return { custom: [], points: [] };
  // the country itself as thick gold lines (one draw call, built once per country); neighbours as thin pale lines
  if (!cd.fat || cd.fatKey !== cd.cc + cd.f.properties.name) {
    cd.fat?.obj?.geometry?.dispose?.();
    const lines = polysOf(cd.f).flatMap((p) => p.map((r) => ({ pts: r.map(([x, y]) => [y, x]), color: '#f2c66d', width: 2.6, alt: 0.0052 })));
    cd.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.95 }) : null; cd.fatKey = cd.cc + cd.f.properties.name;
  }
  const custom = cd.fat ? [cd.fat] : [];
  if (cd.neighbours.length) custom.push(ctx.outlineMesh(`cdn:${cd.cc}:${cd.neighbours.length}`, cd.neighbours, 0xc9d6ea, 0.85, 0.0048));
  const points = cd.capital ? [{ lat: cd.capital.lat, lng: cd.capital.lng, alt: 0.006, r: 0.12, color: '#f2c66d', label: cd.capital.name, tip: `<div class="tip"><b>${esc(cd.capital.name)}</b><span>capital of ${esc(cd.f.properties.name)}</span></div>`, ref: { layer: 'borders', d: cd.f } }] : [];
  return { custom, points };
}
export function countryClose() { cd.fat?.obj?.geometry?.dispose?.(); Object.assign(cd, { cc: null, f: null, neighbours: [], capital: null, fat: null, fatKey: null }); }
