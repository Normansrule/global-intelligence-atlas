// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — rocket launches (The Space Devs' Launch Library 2) and global disaster alerts (GDACS).
import { getFeed } from './feeds.js';
import { fmtLat, fmtLng } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;

export function countdown(ms) {
  const neg = ms < 0; let t = Math.abs(ms) / 1000;
  const d = Math.floor(t / 86400); t -= d * 86400; const h = Math.floor(t / 3600); t -= h * 3600; const m = Math.floor(t / 60); const sec = Math.floor(t - m * 60);
  const body = d ? `${d} d ${h} h ${m} min` : h ? `${h} h ${m} min` : `${m} min ${sec} s`;
  return neg ? `T+ ${body}` : `T− ${body}`;
}

// --------------------------------------------------------------- launches
export const launchesLayer = {
  id: 'launches', group: 'space', label: 'Rocket launches', swatch: '#ff9e5e', on: true, refresh: 30 * 60_000, pin: 'rocket', fresh: true,
  sources: ['ll2'],
  options: [{ id: 'which', label: 'Launches', choices: [['upcoming', 'Upcoming'], ['previous', 'Recent']], value: 'upcoming' }],
  async load(o) {
    // Launch Library 2 allows ~15 anonymous requests an hour, so results are cached for 30 minutes.
    const j = await getFeed('ll2', `https://ll.thespacedevs.com/2.2.0/launch/${o.which}/?limit=25&mode=detailed`, { ttl: 30 * 60_000, timeout: 30_000, snapshot: `launches-${o.which}.json` });
    return (j.results ?? []).map((l) => ({
      id: l.id, name: l.name, net: Date.parse(l.net), status: l.status?.name ?? '', abbrev: l.status?.abbrev ?? '', prob: l.probability,
      live: !!l.webcast_live, image: l.image ?? '', lat: Number(l.pad?.latitude), lng: Number(l.pad?.longitude), pad: l.pad?.name ?? '', site: l.pad?.location?.name ?? '',
      rocket: l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? '', provider: l.launch_service_provider?.name ?? '', ptype: l.launch_service_provider?.type ?? '',
      mission: l.mission?.name ?? '', desc: l.mission?.description ?? '', mtype: l.mission?.type ?? '', orbit: l.mission?.orbit?.name ?? '',
      vids: (l.vidURLs ?? []).map((v) => ({ title: v.title || 'Webcast', url: v.url, live: v.live })).filter((v) => /^https?:/.test(v.url)).slice(0, 3),
      info: (l.infoURLs ?? []).map((v) => ({ title: v.title || 'Mission page', url: v.url })).filter((v) => /^https?:/.test(v.url)).slice(0, 2),
    })).filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  },
  channels(ls, ctx) {
    const now = ctx.now.getTime();
    const soon = ls.filter((l) => l.net - now < 86_400_000 && l.net > now - 3600_000);
    return {
      points: ls.map((l) => {
        const hrs = (l.net - now) / 3600_000;
        return { lat: l.lat, lng: l.lng, alt: 0.01 + Math.max(0, 0.08 - Math.abs(hrs) * 0.0005), r: 0.3, color: l.live ? '#ff4d4d' : hrs > 0 && hrs < 24 ? '#ff9e5e' : '#ffc79e', label: l.name,
          tip: tip(l.name, `${countdown(l.net - now)} · ${l.site}`), ref: { layer: 'launches', d: l } };
      }),
      rings: soon.map((l) => ({ lat: l.lat, lng: l.lng, color: l.live ? '#ff4d4d' : '#ff9e5e', maxR: 2.5, speed: 1.6, period: 1400 })),
    };
  },
  describe(l) {
    const t = l.net - Date.now();
    return {
      title: l.mission || l.name, sub: `${l.rocket}${l.provider ? ` · ${l.provider}` : ''}`,
      html: `${l.image ? `<img class="newsimg" src="${esc(l.image)}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
        <p class="countdown" data-net="${l.net}">${countdown(t)}</p>
        ${l.vids.length ? `<div class="row">${l.vids.map((v) => `<a class="btn${v.live ? '' : ' ghost'}" href="${esc(v.url)}" target="_blank" rel="noopener">${v.live ? '● Watch live' : 'Watch webcast'}</a>`).join('')}</div>` : ''}`,
      rows: [['Launch time', new Date(l.net).toUTCString()], ['Status', l.status], ...(l.prob != null ? [['Weather go', `${l.prob} %`]] : []), ['Launch site', `${l.pad}, ${l.site}`], ['Mission type', l.mtype || '—'], ['Target orbit', l.orbit || '—'], ['Provider', `${l.provider}${l.ptype ? ` (${l.ptype})` : ''}`]],
      body: l.desc || 'No mission description published yet.',
      links: l.info.map((i) => ({ label: i.title, url: i.url })),
      probe: [l.lat, l.lng], actions: [['launch-azimuth', 'Why launch from here?']],
    };
  },
  learn: {
    what: 'The next 25 orbital launches worldwide at their launch pads, with a countdown, the rocket, the mission and its target orbit, and a link to the live webcast. Pads with a launch in the next 24 hours pulse; a red pin is streaming live right now.',
    how: 'The Space Devs’ Launch Library 2 is a community-maintained database of every orbital launch, updated as providers announce times and delays. Global Intelligence Atlas reads it straight from your browser every 30 minutes.',
    try: 'Open the next launch, switch on Satellite shells, and after it flies compare its target orbit with the satellites already up there. Then use the time machine to jump to the launch time and watch the pad cross the terminator.',
    refs: ['ll2'],
  },
};

// --------------------------------------------------------------- GDACS disaster alerts
const GD = { EQ: ['Earthquake', 'quake'], TC: ['Tropical cyclone', 'storm'], FL: ['Flood', 'water'], VO: ['Volcano', 'volcano'], WF: ['Wildfire', 'flame'], DR: ['Drought', 'drought'] };
const LEVEL = { Red: '#ff3b30', Orange: '#ff9f43', Green: '#5fd3a9' };
export const alertsLayer = {
  id: 'alerts', group: 'live', label: 'Disaster alerts (GDACS)', swatch: '#ff3b30', on: false, refresh: 20 * 60_000, fresh: true,
  pin: (d) => GD[d.type]?.[1] ?? 'alert',
  legend: Object.values(GD).map(([label, g]) => [g, label]),
  sources: ['gdacs'],
  options: [{ id: 'level', label: 'Level', choices: [['Orange;Red', 'Orange and red'], ['Red', 'Red only'], ['Green;Orange;Red', 'All alerts']], value: 'Orange;Red' }],
  async load(o) {
    const j = await getFeed('gdacs', `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=${o.level}`, { ttl: 15 * 60_000, timeout: 25_000, snapshot: 'gdacs.json' });
    const want = new Set(o.level.split(';'));
    return (j.features ?? []).filter((f) => f.geometry?.type === 'Point' && want.has(f.properties?.alertlevel)).map((f) => {
      const p = f.properties;
      return { id: `${p.eventtype}-${p.eventid}`, type: p.eventtype, name: p.name, desc: p.description, level: p.alertlevel, score: p.alertscore, country: p.country,
        from: p.fromdate, to: p.todate, sev: p.severitydata?.severitytext ?? '', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
        url: p.url?.report ?? `https://www.gdacs.org/report.aspx?eventid=${p.eventid}&eventtype=${p.eventtype}`, glide: p.glide };
    });
  },
  channels(as) {
    return {
      points: as.map((a) => ({ lat: a.lat, lng: a.lng, alt: a.level === 'Red' ? 0.06 : 0.03, r: a.level === 'Red' ? 0.5 : 0.35, color: LEVEL[a.level] ?? '#ff9f43', label: a.name,
        tip: tip(a.name, `${a.level} alert · ${a.sev || GD[a.type]?.[0] || ''}`), ref: { layer: 'alerts', d: a } })),
      rings: as.filter((a) => a.level === 'Red').map((a) => ({ lat: a.lat, lng: a.lng, color: '#ff3b30', maxR: 3, speed: 2, period: 1100 })),
    };
  },
  describe(a) {
    return {
      title: a.name, sub: `${a.level} alert · ${GD[a.type]?.[0] ?? a.type}${a.country ? ` · ${a.country}` : ''}`,
      rows: [['Severity', a.sev || '—'], ['From', a.from ? new Date(`${a.from}Z`).toUTCString() : '—'], ['Until', a.to ? new Date(`${a.to}Z`).toUTCString() : '—'], ['GLIDE number', a.glide || '—'], ['Position', `${fmtLat(a.lat)}, ${fmtLng(a.lng)}`]],
      body: 'GDACS alert levels estimate humanitarian impact, not just physical size: a red alert means a likely need for international assistance, combining the hazard’s strength with how many people live in the affected area and how vulnerable they are.',
      links: [{ label: 'Full GDACS report', url: a.url }], probe: [a.lat, a.lng],
    };
  },
  learn: {
    what: 'Orange and red alerts from the Global Disaster Alert and Coordination System — earthquakes, tropical cyclones, floods, volcanoes, wildfires and droughts expected to need a humanitarian response. Red alerts pulse.',
    how: 'GDACS is run by the United Nations and the European Commission. Within minutes of an event it models the hazard (shaking, wind, water) against population and vulnerability data and issues a green, orange or red alert.',
    try: 'Compare a red earthquake alert with the plain Earthquakes layer: a small quake near a big city can outrank a large one offshore.',
    refs: ['gdacs'],
  },
};
