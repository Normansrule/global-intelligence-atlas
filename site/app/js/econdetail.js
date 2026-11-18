// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: markets, cloud regions and AI labs in depth (v2.29).
// Three more layers become pages of their own, worked out on this device from the atlas's own data, so they open
// offline too:
//   market      (financial centres, exchanges, central banks) the local time there now, whether its exchange is open
//               and for how long, the world's trading day as a 24-hour strip with every big exchange's session and a
//               line for now, the exchanges open right now, and the financial places near it;
//   cloud       how long a round trip takes from the region to the world's biggest cities, how many people live within
//               10 and 30 milliseconds of it, the other providers' regions next door and the AI data centres near it,
//               with latency rings on the globe;
//   AI lab      when it was founded and what it works on, the other labs and tech headquarters around it, and the
//               compute near it: the closest cloud regions with their round-trip time and the AI data centres.
// Exchange hours ignore public holidays and late openings; docs/ASSUMPTIONS.md (v2.29) lists every figure.
import { unitSvg } from './icons.js';
import { haversineKm } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
const sig = (n) => fmt(n, n < 10 ? 1 : 0);

// ---------------------------------------------------------------- time zones and sessions
// Regular sessions in local time, Monday to Friday unless days says otherwise (0 = Sunday). Holidays, auctions and
// half days are left out. Not verified against each exchange's current rule book (see ASSUMPTIONS.md, v2.29).
const MF = [1, 2, 3, 4, 5]; const ST = [0, 1, 2, 3, 4];
export const SESSIONS = {
  nyse: ['America/New_York', '09:30', '16:00'], nasdaq: ['America/New_York', '09:30', '16:00'], tsx: ['America/Toronto', '09:30', '16:00'],
  cme: ['America/Chicago', 'globex'], bovespa: ['America/Sao_Paulo', '10:00', '17:00'], bmv: ['America/Mexico_City', '08:30', '15:00'], bvl: ['America/Lima', '09:00', '16:00'],
  lse: ['Europe/London', '08:00', '16:30'], euronext: ['Europe/Paris', '09:00', '17:30'], dax: ['Europe/Berlin', '09:00', '17:30'], six: ['Europe/Zurich', '09:00', '17:30'], moex: ['Europe/Moscow', '10:00', '18:40'],
  tse: ['Asia/Tokyo', '09:00', '15:30', ['11:30', '12:30']], sse: ['Asia/Shanghai', '09:30', '15:00', ['11:30', '13:00']], szse: ['Asia/Shanghai', '09:30', '15:00', ['11:30', '13:00']],
  hkex: ['Asia/Hong_Kong', '09:30', '16:00', ['12:00', '13:00']], sgx: ['Asia/Singapore', '09:00', '17:00', ['12:00', '13:00']], kospi: ['Asia/Seoul', '09:00', '15:30'], twse: ['Asia/Taipei', '09:00', '13:30'],
  idx: ['Asia/Jakarta', '09:00', '16:00', ['12:00', '13:30']], set: ['Asia/Bangkok', '10:00', '16:30', ['12:30', '14:30']], bse: ['Asia/Kolkata', '09:15', '15:30'], nse: ['Asia/Kolkata', '09:15', '15:30'],
  asx: ['Australia/Sydney', '10:00', '16:00'], nzx: ['Pacific/Auckland', '10:00', '16:45'],
  tadawul: ['Asia/Riyadh', '10:00', '15:00', null, ST], adx: ['Asia/Dubai', '10:00', '15:00'], dfm: ['Asia/Dubai', '10:00', '15:00'], qse: ['Asia/Qatar', '09:30', '13:15', null, ST],
  bkw: ['Asia/Kuwait', '09:00', '12:40', null, ST], bse_bahrain: ['Asia/Bahrain', '09:30', '13:00', null, ST], egx: ['Africa/Cairo', '10:00', '14:30', null, ST], tase: ['Asia/Jerusalem', '10:00', '17:25'],
  jse: ['Africa/Johannesburg', '09:00', '17:00'], nse_nigeria: ['Africa/Lagos', '10:00', '14:30'], casa: ['Africa/Casablanca', '09:30', '15:30'],
};
// Time zones of the other financial places (central banks, hubs, centres), and points to borrow a zone from.
const ZONES = {
  fed: 'America/New_York', imf: 'America/New_York', boe: 'Europe/London', ecb: 'Europe/Berlin', snb: 'Europe/Zurich', bis: 'Europe/Zurich', boj: 'Asia/Tokyo', pboc: 'Asia/Shanghai', mas: 'Asia/Singapore',
  rbi: 'Asia/Kolkata', rba: 'Australia/Sydney', boc: 'America/Toronto', bok: 'Asia/Seoul', bcb: 'America/Sao_Paulo', sama: 'Asia/Riyadh', dubai_hub: 'Asia/Dubai', cayman: 'America/Cayman', luxembourg: 'Europe/Luxembourg',
  'fc-nyc': 'America/New_York', 'fc-london': 'Europe/London', 'fc-singapore': 'Asia/Singapore', 'fc-hongkong': 'Asia/Hong_Kong', 'fc-sanfrancisco': 'America/Los_Angeles', 'fc-tokyo': 'Asia/Tokyo', 'fc-shanghai': 'Asia/Shanghai',
  'fc-chicago': 'America/Chicago', 'fc-zurich': 'Europe/Zurich', 'fc-frankfurt': 'Europe/Berlin', 'fc-sydney': 'Australia/Sydney', 'fc-seoul': 'Asia/Seoul', 'fc-mumbai': 'Asia/Kolkata', 'fc-toronto': 'America/Toronto',
  'fc-bermuda': 'Atlantic/Bermuda', 'fc-channelislands': 'Europe/Jersey',
};
// [lat, lon, zone] for places in other lists (Wikidata's exchanges have no ids the atlas knows).
const ZONE_POINTS = [[40.7, -74, 'America/New_York'], [41.9, -87.6, 'America/Chicago'], [37.8, -122.4, 'America/Los_Angeles'], [43.7, -79.4, 'America/Toronto'], [19.4, -99.1, 'America/Mexico_City'], [-23.5, -46.6, 'America/Sao_Paulo'],
  [-34.6, -58.4, 'America/Argentina/Buenos_Aires'], [-33.4, -70.6, 'America/Santiago'], [4.7, -74.1, 'America/Bogota'], [-12.0, -77.0, 'America/Lima'], [51.5, -0.1, 'Europe/London'], [48.9, 2.3, 'Europe/Paris'], [50.1, 8.7, 'Europe/Berlin'],
  [52.4, 4.9, 'Europe/Amsterdam'], [47.4, 8.5, 'Europe/Zurich'], [40.4, -3.7, 'Europe/Madrid'], [45.5, 9.2, 'Europe/Rome'], [59.3, 18.1, 'Europe/Stockholm'], [52.2, 21.0, 'Europe/Warsaw'], [41.0, 29.0, 'Europe/Istanbul'],
  [55.8, 37.6, 'Europe/Moscow'], [30.0, 31.2, 'Africa/Cairo'], [-26.2, 28.0, 'Africa/Johannesburg'], [6.5, 3.4, 'Africa/Lagos'], [-1.3, 36.8, 'Africa/Nairobi'], [33.6, -7.6, 'Africa/Casablanca'], [24.7, 46.7, 'Asia/Riyadh'],
  [25.2, 55.3, 'Asia/Dubai'], [32.1, 34.8, 'Asia/Jerusalem'], [19.1, 72.9, 'Asia/Kolkata'], [24.9, 67.0, 'Asia/Karachi'], [23.8, 90.4, 'Asia/Dhaka'], [13.8, 100.5, 'Asia/Bangkok'], [1.3, 103.8, 'Asia/Singapore'],
  [-6.2, 106.8, 'Asia/Jakarta'], [14.6, 121.0, 'Asia/Manila'], [22.3, 114.2, 'Asia/Hong_Kong'], [31.2, 121.5, 'Asia/Shanghai'], [25.0, 121.6, 'Asia/Taipei'], [37.6, 127.0, 'Asia/Seoul'], [35.7, 139.7, 'Asia/Tokyo'],
  [-33.9, 151.2, 'Australia/Sydney'], [-37.8, 145.0, 'Australia/Melbourne'], [-36.8, 174.8, 'Pacific/Auckland']];
/** The IANA time zone for a financial place: its own record, then the atlas's tables, then the nearest known city within 600 km. */
export function zoneOf(p) {
  if (p?.timezone) return p.timezone;
  const k = p?.id; if (SESSIONS[k]) return SESSIONS[k][0]; if (ZONES[k]) return ZONES[k];
  if (!Number.isFinite(p?.lat)) return null;
  let best = null; for (const [a, b, z] of ZONE_POINTS) { const km = haversineKm(p.lat, p.lon ?? p.lng, a, b); if (km <= 600 && (!best || km < best[0])) best = [km, z]; }
  return best?.[1] ?? null;
}
/** Local wall-clock parts in a zone: {y, m, d, wd (0 = Sunday), mins (since midnight)}. */
export function localParts(zone, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +o.year, m: +o.month, d: +o.day, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), mins: (+o.hour % 24) * 60 + +o.minute };
}
/** The zone's offset from UTC in minutes at that moment. */
export function offsetMin(zone, date = new Date()) {
  const p = localParts(zone, date); const asUtc = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.mins / 60), p.mins % 60);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** The session record for a place: from the atlas's table, or the place's own "09:00-13:30" field. */
export function sessionOf(p) {
  const s = SESSIONS[p?.id]; if (s) return { zone: s[0], globex: s[1] === 'globex', open: s[1] !== 'globex' ? hm(s[1]) : 0, close: s[2] ? hm(s[2]) : 0, lunch: s[3] ? s[3].map(hm) : null, days: s[4] ?? MF };
  const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(p?.tradingHours ?? ''); const z = zoneOf(p);
  return m && z ? { zone: z, open: hm(m[1]), close: hm(m[2]), lunch: null, days: MF } : null;
}
/**
 * Whether the exchange is trading at that moment, and the minutes to the next change.
 * Returns { open, lunch, mins, local } where mins is minutes until it closes (open) or opens (closed).
 */
export function marketState(s, date = new Date()) {
  if (!s) return null;
  // local minutes since 1970 at today's offset (a clock change in the next days shifts the countdown by an hour: Approximation)
  const base = Math.floor(date.getTime() / 60000) + offsetMin(s.zone, date);
  const at = (lm) => ({ wd: (Math.floor(lm / 1440) + 4) % 7, mins: ((lm % 1440) + 1440) % 1440 }); // 1 January 1970 was a Thursday
  const isOpen = (p) => {
    if (s.globex) { if (p.wd === 6) return false; if (p.wd === 5 && p.mins >= 16 * 60) return false; if (p.wd === 0 && p.mins < 17 * 60) return false; return !(p.mins >= 16 * 60 && p.mins < 17 * 60); }
    if (!s.days.includes(p.wd) || p.mins < s.open || p.mins >= s.close) return false;
    return !(s.lunch && p.mins >= s.lunch[0] && p.mins < s.lunch[1]);
  };
  const now = at(base); const open = isOpen(now);
  let mins = null; for (let t = 1; t <= 8 * 1440; t++) if (isOpen(at(base + t)) !== open) { mins = t; break; }
  return { open, lunch: !open && !!s.lunch && s.days.includes(now.wd) && now.mins >= s.lunch[0] && now.mins < s.lunch[1], mins, local: now };
}
/** Today's session in UTC minutes from 00:00 UTC (can run past 1440 or start below 0), for the 24-hour strip. */
export function sessionUtc(s, date = new Date()) {
  if (!s || s.globex) return null; const off = offsetMin(s.zone, date);
  return { from: s.open - off, to: s.close - off, lunch: s.lunch ? [s.lunch[0] - off, s.lunch[1] - off] : null };
}
export const span = (m) => { m = Math.max(0, Math.round(m)); const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60; return d ? `${d} d ${h} h` : h ? `${h} h ${mm} min` : `${mm} min`; };

// ---------------------------------------------------------------- latency
/** Light in glass fibre covers about 204 km a millisecond (refractive index about 1.47). */
export const FIBRE_KM_PER_MS = 204;
/** Real routes run longer than the great circle; 1.5 is a typical allowance (Approximation). */
export const ROUTE = 1.5;
/** Estimated round-trip time in ms over fibre for a great-circle distance, before any switching or queuing. */
export const rttMs = (km) => (2 * km * ROUTE) / FIBRE_KM_PER_MS;
/** The great-circle distance that a round-trip time allows. */
export const kmFor = (ms) => (ms * FIBRE_KM_PER_MS) / (2 * ROUTE);

// ---------------------------------------------------------------- shared page bits
export const ex = { kind: null, d: null, fat: null };
const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const sum = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const sec = (id, title, open = true) => `<details class="qd-sec"${open ? ' open' : ''}><summary><span>${title}</span><small id="${id}-sum"></small></summary><div id="${id}"></div></details>`;
const head = (glyph, big, line, tone = 'blue') => `<div class="ev-head tone-${tone}"><span class="ev-g">${unitSvg(glyph, 34)}</span><div><b class="ev-big">${big}</b><span>${line}</span></div></div>`;
const openBtn = (layer, d, label, extra = '') => `<button class="chip" data-ix-layer="${layer}" data-ix-id="${esc(d.id ?? d.name)}">${label}${extra ? ` <span>${extra}</span>` : ''}</button>`;
const near = (rows, lat, lon, km) => (rows ?? []).filter((o) => Number.isFinite(o.lat)).map((o) => ({ o, km: haversineKm(lat, lon, o.lat, o.lon ?? o.lng) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);
const people = (n) => (n >= 1e6 ? `${sig(n / 1e6)} million` : fmt(n));
const clock = (zone, date) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const label = (p) => p.shortName ?? (p.name.length > 18 ? p.id?.toUpperCase?.() ?? p.name : p.name);

/** The big exchanges drawn on the trading-day strip, west to east by their opening in UTC. */
export const STRIP = ['nzx', 'asx', 'tse', 'kospi', 'sse', 'hkex', 'sgx', 'nse', 'tadawul', 'dfm', 'jse', 'dax', 'lse', 'nyse', 'tsx', 'bovespa'];
function strip(all, me, date) {
  const rows = STRIP.map((id) => all.find((p) => p.id === id)).filter(Boolean);
  if (me && sessionOf(me) && !rows.includes(me) && !sessionOf(me).globex) rows.push(me);
  const nowM = date.getUTCHours() * 60 + date.getUTCMinutes();
  const W = 300; const x = (m) => ((((m % 1440) + 1440) % 1440) / 1440) * W; const H = 14;
  const bar = (a, b, y, cls) => { const out = []; let s = a; let e = b; while (s < e) { const segEnd = Math.min(e, Math.floor(s / 1440) * 1440 + 1440); out.push(`<rect x="${x(s).toFixed(1)}" y="${y}" width="${Math.max(1, ((segEnd - s) / 1440) * W).toFixed(1)}" height="${H - 4}" rx="2" class="${cls}"/>`); s = segEnd; } return out.join(''); };
  const body = rows.map((p, i) => {
    const s = sessionOf(p); const u = sessionUtc(s, date); const y = i * H + 2; const st = marketState(s, date);
    return `<text x="-4" y="${y + 9}" text-anchor="end">${esc(label(p))}</text>${bar(u.from, u.to, y, `ex-s${st.open ? ' ex-on' : ''}${p === me ? ' ex-me' : ''}`)}${u.lunch ? bar(u.lunch[0], u.lunch[1], y, 'ex-lunch') : ''}`;
  }).join('');
  const hH = rows.length * H + 4;
  return `<svg class="ex-strip" viewBox="-64 -14 ${W + 70} ${hH + 18}" role="img" aria-label="Each big exchange's trading hours today in UTC, with a line for now">
    ${[0, 6, 12, 18].map((h) => `<text x="${x(h * 60)}" y="-4" class="ex-h">${String(h).padStart(2, '0')}:00</text><line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="0" y2="${hH}" class="ex-grid"/>`).join('')}
    ${body}<line x1="${x(nowM)}" x2="${x(nowM)}" y1="-2" y2="${hH}" class="ex-now"/></svg>`;
}
function statusLine(st) {
  if (!st) return '';
  if (st.open) return `<span class="ld-chip tone-ok">Open now</span><span class="ld-chip tone-unk">closes in ${span(st.mins)}</span>`;
  return `<span class="ld-chip tone-${st.lunch ? 'warn' : 'off'}">${st.lunch ? 'Lunch break' : 'Closed'}</span>${st.mins != null ? `<span class="ld-chip tone-unk">opens in ${span(st.mins)}</span>` : ''}`;
}

// ---------------------------------------------------------------- the market page
export function marketHtml() {
  return `<div class="ix ex" data-ix="market"><div id="ex-head"></div>${sec('ex-day', 'The world’s trading day')}${sec('ex-open', 'Open right now')}${sec('ex-near', 'Financial places near it', false)}</div>`;
}
/** layer: 'economic' or 'finance'; all: every financial place on both lists (for the strip and the open list). */
export function marketFill(p, { layer, all, date = new Date(), refresh }) {
  const zone = zoneOf(p); const s = sessionOf(p); const st = marketState(s, date);
  // a centre or central bank: the session of the nearest exchange in the same city
  const cityEx = !s ? near(all.filter((o) => o !== p && sessionOf(o)), p.lat, p.lon, 60)[0]?.o : null; const cst = cityEx ? marketState(sessionOf(cityEx), date) : null;
  set('ex-head', zone ? head('clock', esc(clock(zone, date)), `local time in ${esc(p.city ?? p.country ?? '')} · ${esc(zone.replace(/_/g, ' '))}`, st?.open || cst?.open ? 'green' : 'blue')
    + `<div class="pt-chips">${statusLine(st)}${cityEx ? `<span class="ld-chip tone-unk">${esc(label(cityEx))}:</span>${statusLine(cst)}` : ''}${p.gfciRank ? `<span class="ld-chip tone-ok">Global Financial Centres Index #${p.gfciRank}</span>` : ''}</div>`
    + `${p.specialties?.length ? `<div class="pt-chips">${p.specialties.map((x) => `<span class="ld-chip tone-unk">${esc(x)}</span>`).join('')}</div>` : ''}${p.description ? `<p class="cd-key">${esc(p.description)}</p>` : ''}`
    + `${s?.globex ? '<p class="cd-key">CME Globex trades almost round the clock: from Sunday 17:00 to Friday 16:00 Chicago time, with an hour’s break each day.</p>' : ''}`
    : head('bank', esc(p.name), 'time zone not known'));
  set('ex-day', `${strip(all, s ? p : cityEx, date)}<p class="cd-key">Each big exchange’s regular session today in UTC, green while it trades, with lunch breaks hatched and a line for now. Public holidays and auctions are not shown.</p>`);
  const openNow = all.filter((o) => marketState(sessionOf(o), date)?.open);
  set('ex-open', openNow.length ? `<div class="lm-near">${openNow.map((o) => openBtn(o.kind ? 'finance' : 'economic', o, esc(label(o)), esc(o.city ?? o.country ?? ''))).join('')}</div><p class="cd-key">${openNow.length} of the ${all.filter((o) => sessionOf(o)).length} exchanges the atlas knows the hours of are trading now.</p>` : '<p class="cd-key">No exchange the atlas knows the hours of is trading now: it is the weekend or the quiet hours between the American close and the Asian open.</p>');
  sum('ex-open-sum', `${openNow.length} open`);
  const nb = near(all.filter((o) => o !== p && o.id !== p.id), p.lat, p.lon, 500).slice(0, 10);
  set('ex-near', nb.length ? `<div class="lm-near">${nb.map((x) => openBtn(x.o.kind ? 'finance' : 'economic', x.o, esc(label(x.o)), `${fmt(x.km)} km`)).join('')}</div>` : '<p class="cd-key">No other financial place within 500 km.</p>');
  sum('ex-near-sum', nb.length ? `${nb.length} within 500 km` : 'none');
  Object.assign(ex, { kind: 'market', d: p, fat: null });
  refresh?.();
}

// ---------------------------------------------------------------- the cloud page
export const PROVIDERS = { aws: 'Amazon Web Services', gcp: 'Google Cloud', azure: 'Microsoft Azure', cloudflare: 'Cloudflare' };
export function cloudHtml() {
  return `<div class="ix ex" data-ix="cloud"><div id="ex-head"></div>${sec('ex-rtt', 'How fast it answers')}${sec('ex-reach', 'People within reach')}${sec('ex-next', 'Next door')}</div>`;
}
export function cloudFill(c, { wm, cities = [], refresh }) {
  set('ex-head', head('server', `${c.zones ?? '?'} zones`, `${esc(PROVIDERS[c.provider] ?? c.provider)} · ${esc(c.city)}, ${esc(c.country)}`, 'blue')
    + '<p class="cd-key">A region is a cluster of data centres; each availability zone is a separate building or campus with its own power and cooling.</p>');
  const big = [...cities].sort((a, b) => b.pop - a.pop).slice(0, 400);
  const pick = []; for (const t of big) if (!pick.some((q) => haversineKm(q.lat, q.lng, t.lat, t.lng) < 1500)) pick.push(t);
  const rows = pick.slice(0, 12).map((t) => ({ t, ms: rttMs(haversineKm(c.lat, c.lon, t.lat, t.lng)) })).sort((a, b) => a.ms - b.ms);
  set('ex-rtt', `<ul class="ex-rtt">${rows.map((r) => `<li><span>${esc(r.t.name)}</span><span class="gx-bar"><i style="--w:${Math.min(100, (r.ms / 300) * 100).toFixed(1)}%"></i></span><small>${sig(r.ms)} ms</small></li>`).join('')}</ul>
    <p class="cd-key">Round trips at the speed of light in glass fibre (about 204 km a millisecond) over a route 1.5 times the straight line: the floor before routers and queues add their share. Real pings are usually higher.</p>`);
  sum('ex-rtt-sum', rows.length ? `${sig(rows[0].ms)}–${sig(rows.at(-1).ms)} ms` : '');
  const within = (ms) => cities.filter((t) => rttMs(haversineKm(c.lat, c.lon, t.lat, t.lng)) <= ms);
  const r10 = within(10); const r30 = within(30); const pop = (xs) => xs.reduce((s, t) => s + (t.pop ?? 0), 0);
  set('ex-reach', `<div class="pt-chips"><span class="ld-chip tone-ok">10 ms: ${people(pop(r10))} people</span><span class="ld-chip tone-unk">30 ms: ${people(pop(r30))} people</span></div>
    <p class="cd-key">People in the atlas’s cities and towns within a 10 ms round trip (about ${fmt(kmFor(10))} km) and 30 ms (about ${fmt(kmFor(30))} km), the two rings on the globe. Ten milliseconds feels instant even for games; thirty is fine for video calls.</p>`);
  sum('ex-reach-sum', `${people(pop(r10))} within 10 ms`);
  const others = near((wm?.cloudRegions ?? []).filter((o) => o.id !== c.id), c.lat, c.lon, 200);
  const dcs = near(wm?.datacenters ?? [], c.lat, c.lon, 500).slice(0, 6);
  set('ex-next', `${others.length ? `<div class="lm-near"><small>Other regions within 200 km:</small>${others.map((x) => openBtn('cloud', x.o, esc(`${PROVIDERS[x.o.provider] ?? x.o.provider} ${x.o.city}`), `${fmt(x.km)} km`)).join('')}</div>` : '<p class="cd-key">No other provider’s region within 200 km in the atlas’s list.</p>'}
    ${dcs.length ? `<div class="lm-near"><small>AI data centres within 500 km:</small>${dcs.map((x) => openBtn('datacenters', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : ''}`);
  sum('ex-next-sum', `${others.length} regions, ${dcs.length} AI sites`);
  Object.assign(ex, { kind: 'cloud', d: c, fat: null });
  refresh?.();
}

// ---------------------------------------------------------------- the AI-lab page
export function labHtml() {
  return `<div class="ix ex" data-ix="lab"><div id="ex-head"></div>${sec('ex-work', 'What it works on')}${sec('ex-around', 'Around it')}${sec('ex-compute', 'Compute near it')}</div>`;
}
export function labFill(l, { wm, date = new Date(), refresh }) {
  const age = l.foundedYear ? date.getUTCFullYear() - l.foundedYear : null;
  set('ex-head', head('bolt', age != null ? `${age} year${age === 1 ? '' : 's'}` : esc(l.type ?? 'lab'), `${l.foundedYear ? `founded ${l.foundedYear} · ` : ''}${esc(l.type ?? '')} lab in ${esc([l.city, l.country].filter(Boolean).join(', '))}`, 'blue'));
  set('ex-work', `${l.focusAreas?.length ? `<div class="pt-chips">${l.focusAreas.map((x) => `<span class="ld-chip tone-unk">${esc(x)}</span>`).join('')}</div>` : ''}
    ${l.notableWork?.length ? `<ul class="ix-alts">${l.notableWork.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul>` : ''}${l.publications ? `<p class="cd-key">${fmt(l.publications)} publications in World Monitor’s count.</p>` : ''}${l.description ? `<p class="cd-key">${esc(l.description)}</p>` : ''}`);
  sum('ex-work-sum', l.focusAreas?.length ? `${l.focusAreas.length} areas` : '');
  const labs = near((wm?.aiLabs ?? []).filter((o) => o.id !== l.id), l.lat, l.lon, 100);
  const hqs = near(wm?.techHqs ?? [], l.lat, l.lon, 50);
  set('ex-around', `${labs.length ? `<div class="lm-near"><small>Labs within 100 km:</small>${labs.slice(0, 10).map((x) => openBtn('ailabs', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : '<p class="cd-key">No other AI lab within 100 km in the atlas’s list.</p>'}
    <p class="cd-key">${hqs.length} tech headquarters within 50 km${hqs.length ? `, among them ${esc(hqs.slice(0, 4).map((x) => x.o.company).join(', '))}` : ''}.</p>`);
  sum('ex-around-sum', `${labs.length} labs nearby`);
  const cr = (wm?.cloudRegions ?? []).map((o) => ({ o, km: haversineKm(l.lat, l.lon, o.lat, o.lon) })).sort((a, b) => a.km - b.km).slice(0, 3);
  const dcs = (wm?.datacenters ?? []).map((o) => ({ o, km: haversineKm(l.lat, l.lon, o.lat, o.lon) })).sort((a, b) => a.km - b.km).slice(0, 4);
  set('ex-compute', `${cr.length ? `<div class="lm-near"><small>Nearest cloud regions:</small>${cr.map((x) => openBtn('cloud', x.o, esc(`${PROVIDERS[x.o.provider] ?? x.o.provider} ${x.o.city}`), `${sig(rttMs(x.km))} ms`)).join('')}</div>` : ''}
    ${dcs.length ? `<div class="lm-near"><small>Nearest AI data centres:</small>${dcs.map((x) => openBtn('datacenters', x.o, esc(x.o.name), `${fmt(x.km)} km`)).join('')}</div>` : ''}
    <p class="cd-key">Round-trip times are the fibre estimate used on the cloud pages. Labs train where the chips are, often far from where the researchers sit.</p>`);
  sum('ex-compute-sum', cr.length ? `${sig(rttMs(cr[0].km))} ms to a cloud` : '');
  Object.assign(ex, { kind: 'lab', d: l, fat: null });
  refresh?.();
}

// ---------------------------------------------------------------- on the globe
const D2R = Math.PI / 180; const R_KM = 6371.0088;
const destination = (lat, lng, az, km) => { const d = km / R_KM; const p1 = lat * D2R; const t = az * D2R; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t)); const l2 = lng * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [p2 / D2R, ((l2 / D2R + 540) % 360) - 180]; };
const ring = (lat, lng, km, n = 72) => Array.from({ length: n + 1 }, (_, i) => destination(lat, lng, (i / n) * 360, km));
/** The open cloud page's latency rings (10 ms and 30 ms round trip). */
export function econOverlay(ctx, layer, sel) {
  if (layer !== 'cloud' || ex.kind !== 'cloud' || !ex.d || sel?.d !== ex.d) return { custom: [] };
  if (!ex.fat) { const d = ex.d; ex.fat = ctx.fatLines([{ pts: ring(d.lat, d.lon, kmFor(10)), color: '#7ef0b0', width: 2, alt: 0.004 }, { pts: ring(d.lat, d.lon, kmFor(30)), color: 'rgba(111,184,255,0.8)', width: 1.6, alt: 0.004 }], { opacity: 0.95 }); }
  return { custom: ex.fat ? [ex.fat] : [] };
}
export function econClose() { ex.fat?.obj?.geometry?.dispose?.(); Object.assign(ex, { kind: null, d: null, fat: null }); }
