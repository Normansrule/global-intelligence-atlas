// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.38: the world clock. The time now in sixteen big cities, whether the Sun is up there,
// how far each is ahead of or behind UTC, and the hours in the next day that fall inside working hours (08:00 to 18:00
// local) in every city you tick. Local times come from the browser's own time-zone database (Intl), so summer time is
// handled by the browser; the Sun's height is a short formula good to about half a degree (docs/ASSUMPTIONS.md, v2.38).
// Pure functions apart from the browser's Intl.

const D = Math.PI / 180; const HOUR = 36e5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CITIES = [
  { id: 'honolulu', name: 'Honolulu', country: 'United States', tz: 'Pacific/Honolulu', lat: 21.31, lng: -157.86 },
  { id: 'la', name: 'Los Angeles', country: 'United States', tz: 'America/Los_Angeles', lat: 34.05, lng: -118.24 },
  { id: 'mexico', name: 'Mexico City', country: 'Mexico', tz: 'America/Mexico_City', lat: 19.43, lng: -99.13 },
  { id: 'newyork', name: 'New York', country: 'United States', tz: 'America/New_York', lat: 40.71, lng: -74.01 },
  { id: 'saopaulo', name: 'São Paulo', country: 'Brazil', tz: 'America/Sao_Paulo', lat: -23.55, lng: -46.63 },
  { id: 'london', name: 'London', country: 'United Kingdom', tz: 'Europe/London', lat: 51.51, lng: -0.13 },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', tz: 'Africa/Lagos', lat: 6.52, lng: 3.38 },
  { id: 'berlin', name: 'Berlin', country: 'Germany', tz: 'Europe/Berlin', lat: 52.52, lng: 13.40 },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', tz: 'Africa/Cairo', lat: 30.04, lng: 31.24 },
  { id: 'moscow', name: 'Moscow', country: 'Russia', tz: 'Europe/Moscow', lat: 55.76, lng: 37.62 },
  { id: 'dubai', name: 'Dubai', country: 'United Arab Emirates', tz: 'Asia/Dubai', lat: 25.20, lng: 55.27 },
  { id: 'delhi', name: 'New Delhi', country: 'India', tz: 'Asia/Kolkata', lat: 28.61, lng: 77.21 },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', tz: 'Asia/Singapore', lat: 1.35, lng: 103.82 },
  { id: 'beijing', name: 'Beijing', country: 'China', tz: 'Asia/Shanghai', lat: 39.90, lng: 116.40 },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', tz: 'Asia/Tokyo', lat: 35.68, lng: 139.69 },
  { id: 'sydney', name: 'Sydney', country: 'Australia', tz: 'Australia/Sydney', lat: -33.87, lng: 151.21 },
];
export const CITY = Object.fromEntries(CITIES.map((c) => [c.id, c]));
export const DEFAULT_PICKS = ['london', 'newyork', 'tokyo'];

const fmtCache = new Map();
const partsFmt = (tz) => {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }));
  return fmtCache.get(tz);
};

/** The wall-clock time in time zone `tz` at `ms`: { y, mo, d, h, m, wd }. */
export function localParts(ms, tz) {
  const o = {}; for (const p of partsFmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, m: +o.minute, wd: o.weekday };
}

/** Minutes that zone `tz` is ahead of UTC at `ms` (negative when behind). */
export function offsetMin(ms, tz) {
  const p = localParts(ms, tz);
  const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m);
  return Math.round((wall - Math.floor(ms / 6e4) * 6e4) / 6e4);
}

/** "UTC+5:30", "UTC−4", "UTC". */
export function offsetLabel(min) {
  if (!min) return 'UTC';
  const a = Math.abs(min); const h = Math.floor(a / 60); const m = a % 60;
  return `UTC${min > 0 ? '+' : '−'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** The Sun's height above the horizon in degrees at (lat, lng) at `ms`. A low-precision formula (about 0.5°). */
export function sunAlt(ms, lat, lng) {
  const n = ms / 864e5 - 10957.5; // days since 2000 January 1.5 (J2000)
  const L = (280.460 + 0.9856474 * n) % 360; const g = ((357.528 + 0.9856003 * n) % 360) * D;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D; const eps = (23.439 - 4e-7 * n) * D;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)); const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24; // hours
  const ha = (gmst * 15 + lng) * D - ra;
  return Math.asin(Math.sin(lat * D) * Math.sin(dec) + Math.cos(lat * D) * Math.cos(dec) * Math.cos(ha)) / D;
}

/** 'day', 'twilight' (Sun up to 6° below the horizon) or 'night'. */
export const daylight = (alt) => (alt > -0.833 ? 'day' : alt > -6 ? 'twilight' : 'night');

/** One row of the clock for city c at `ms`, compared with the viewer's own zone `here`. */
export function clockRow(c, ms, here) {
  const p = localParts(ms, c.tz); const off = offsetMin(ms, c.tz); const alt = sunAlt(ms, c.lat, c.lng);
  const mine = here ? offsetMin(ms, here) : 0; const diff = off - mine;
  const hp = localParts(ms, here || 'UTC');
  const dayShift = Math.sign(Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(hp.y, hp.mo - 1, hp.d));
  return { c, time: `${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`, h: p.h + p.m / 60, wd: p.wd, off, offText: offsetLabel(off), diff, dayShift, alt, light: daylight(alt), working: p.h >= 8 && p.h < 18 };
}

/** The whole hours (as UTC ms) in the next 24 hours, from the start of the current hour, when it is between
 *  `from` and `to` o'clock local time in every zone in `tzs`. */
export function sharedHours(ms, tzs, from = 8, to = 18) {
  const start = Math.floor(ms / HOUR) * HOUR; const out = [];
  if (!tzs.length) return out;
  for (let k = 0; k < 24; k++) {
    const t = start + k * HOUR;
    if (tzs.every((tz) => { const p = localParts(t, tz); const h = p.h + p.m / 60; return h >= from && h + 1 <= to; })) out.push(t);
  }
  return out;
}

/** Runs of consecutive hours, as [startMs, endMs] pairs. */
export function runs(hours) {
  const out = []; for (const t of hours) { const last = out[out.length - 1]; if (last && last[1] === t) last[1] = t + HOUR; else out.push([t, t + HOUR]); }
  return out;
}

const hm = (ms, tz) => { const p = localParts(ms, tz); return `${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`; };
const diffText = (r) => {
  if (!r.diff) return 'your time';
  const a = Math.abs(r.diff); const h = Math.floor(a / 60); const m = a % 60;
  return `${r.diff > 0 ? '+' : '−'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''} h`;
};
const ICON = { day: '☀', twilight: '◐', night: '☾' };

/** The World clock panel. `picks` are the city ids ticked for the meeting finder; `here` is the viewer's zone. */
export function clockHtml(ms, picks, here) {
  const rows = CITIES.map((c) => clockRow(c, ms, here));
  const list = rows.map((r) => {
    const on = picks.includes(r.c.id);
    const day = r.dayShift > 0 ? '<span class="wc-shift">tomorrow</span>' : r.dayShift < 0 ? '<span class="wc-shift">yesterday</span>' : r.wd;
    return `<li class="wc-row wc-${r.light}${r.working ? ' wc-work' : ''}" style="--hp:${(r.h / 24 * 100).toFixed(1)}%">
      <label class="wc-pick" title="Include in the meeting finder"><input type="checkbox" data-wc-pick="${r.c.id}"${on ? ' checked' : ''} aria-label="Include ${esc(r.c.name)} in the meeting finder"></label>
      <button class="wc-city" data-fly="${r.c.lat},${r.c.lng},0.9"><b>${esc(r.c.name)}</b><small>${esc(r.c.country)} · ${r.offText}</small></button>
      <span class="wc-time"><b>${r.time}</b><small><span class="wc-sun" aria-label="${r.light}">${ICON[r.light]}</span> ${day} · <span title="Compared with your clock">${diffText(r)}</span></small></span>
      <span class="wc-bar" aria-hidden="true"></span></li>`;
  }).join('');
  const zones = picks.map((id) => CITY[id]?.tz).filter(Boolean);
  const names = picks.map((id) => CITY[id]?.name).filter(Boolean);
  const rs = runs(sharedHours(ms, zones));
  let meet;
  if (zones.length < 2) meet = '<p class="muted">Tick two or more cities to find the hours that suit them all.</p>';
  else if (!rs.length) meet = `<p>There is no hour in the next day when it is 08:00 to 18:00 in all of ${esc(names.join(', '))}. Try fewer cities, or ones closer together.</p>`;
  else {
    meet = `<p>Working hours (08:00 to 18:00) overlap in all of ${esc(names.join(', '))} at:</p><ul class="wc-meet">${rs.map(([a, b]) => `<li><span><b>${hm(a, here || 'UTC')}–${hm(b, here || 'UTC')}</b> your time</span><small>${zones.map((tz, i) => `${esc(names[i])} ${hm(a, tz)}–${hm(b, tz)}`).join(' · ')}</small></li>`).join('')}</ul>`;
  }
  return `<p class="muted">Local time in sixteen cities, from your browser’s time-zone database. The bar shows the local day: the bright part is 08:00 to 18:00 and the dot is now. ☀ day, ◐ twilight, ☾ night. +9 h means nine hours ahead of your clock. Click a city to fly there.</p>
    <ul class="wc-list">${list}</ul>
    <h4>Find a meeting time</h4>${meet}
    <p class="row"><button class="btn ghost" data-wc-back="1">Back to Tools</button></p>`;
}
