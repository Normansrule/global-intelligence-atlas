// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.33: Companies in the news. The headquarters of the companies the last 48 hours of
// credible headlines name (World Monitor's tech-headquarters list, 280 companies), sized by how many stories, each
// with a page: the stories grouped by angle (politics, economy, courts, conflict, technology...), the countries those
// stories are about, and the publishers. Headlines come from the News tab's publishers' own feeds (news-data branch);
// state-controlled outlets are left out (newsangles.js says how stories are matched and sorted).
import { getSnapshot, getLocal } from './feeds.js';
import { worldMonitorData } from './layers.js';
import { PUBLISHERS } from './newslist.js';
import { credible, companyNames, storiesAbout, storiesHtml, storiesSummary, wherePlaces, byAngle, leadAngle, ANGLE_LABEL, DEMONYMS, placesIn, anglesOf } from './newsangles.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PUB = Object.fromEntries(PUBLISHERS.map((p) => [p.key, p]));
const ANGLE_C = { politics: '#8fb3ff', economy: '#7ed6c4', law: '#e3b55b', conflict: '#f07a63', tech: '#b7a3ff', climate: '#7fe39a', society: '#ffb3c7', other: '#c9c4ba' };

/** The headlines the summaries read (credible publishers only). */
export async function credibleHeadlines() {
  const j = await getSnapshot('newsheadlines', 'headlines.json', { branch: 'news-data', ttl: 5 * 60_000 });
  return { items: credible(j.items, PUB), updated: j.updated };
}
let COUNTRIES = null; let SHAPES = null;
/** The atlas's country outlines with their ISO code (Taiwan has none in the file, so it is given TW). */
export async function countryShapes() {
  SHAPES ??= getLocal('data/countries.geojson').then((g) => g.features.map((f) => ({ cc: f.properties.name === 'Taiwan' ? 'TW' : f.properties['ISO3166-1-Alpha-2'], name: f.properties.name, geometry: f.geometry })).filter((c) => /^[A-Z]{2}$/.test(c.cc ?? '')));
  return SHAPES;
}
/** Countries for "where": name and ISO code from the atlas's own outlines. */
export async function countryList() {
  COUNTRIES ??= countryShapes().then((fs) => fs.map((f) => ({ cc: f.cc, name: f.name })));
  return COUNTRIES;
}
const ccOf = { USA: 'US', UK: 'GB', 'South Korea': 'KR', China: 'CN', Japan: 'JP', Germany: 'DE', France: 'FR', India: 'IN', Israel: 'IL', Canada: 'CA', Netherlands: 'NL', Sweden: 'SE', Taiwan: 'TW', Singapore: 'SG', Ireland: 'IE', Switzerland: 'CH', Australia: 'AU', Brazil: 'BR' };

/** A bar of the stories' angles and its key. */
export function angleBar(stories) {
  if (!stories.length) return '';
  const angles = byAngle(stories);
  return `<div class="na-bar" role="img" aria-label="${esc(angles.map(([, l, s]) => `${l}: ${s.length}`).join(', '))}">${angles.map(([id, , s]) => `<i style="--w:${(100 * s.length / stories.length).toFixed(1)}%;--c:${ANGLE_C[id]}" title="${esc(ANGLE_LABEL[id])}: ${s.length}"></i>`).join('')}</div>
    <div class="na-key">${angles.map(([id, l, s]) => `<span><i style="--c:${ANGLE_C[id]}"></i>${esc(l)} ${s.length}</span>`).join('')}</div>`;
}

/** The "In the news" section of a country page: credible stories that name the country, its capital or its people. */
export async function countryNews(cc, name, demonym) {
  const h = await credibleHeadlines();
  const names = [name, ...(DEMONYMS[cc] ?? []), ...(demonym ? [demonym] : [])].filter((x) => x && x.length > 2 || /^[A-Z.]{2,}$/.test(x ?? ''));
  const stories = storiesAbout(h.items, { names: [...new Set(names)] });
  if (!stories.length) return '<p class="cd-key">No story from the credible outlets names it in the last 48 hours.</p>';
  return `<div class="na"><p class="cd-key">${esc(storiesSummary(stories, PUB))}.</p>${angleBar(stories)}${storiesHtml(stories, PUB, Date.now(), 4)}
    <p class="small muted">From public broadcasters and established newspapers’ own feeds (state-controlled outlets left out); a story counts when its title names the country, its capital or its people. Angles are read from title words, so treat them as a guide.</p></div>`;
}

/** The page for one company. */
export function companyHtml(c, stories, countries, now = Date.now()) {
  const where = wherePlaces(stories, countries, ccOf[c.country] ?? '');
  const bar = angleBar(stories);
  return `<div class="na">
    <p class="cd-key">${esc(storiesSummary(stories, PUB))}.</p>${bar}
    ${where.length ? `<div class="lm-near"><small>Where these stories are:</small>${where.slice(0, 10).map((p) => `<button class="chip" data-country-cc="${esc(p.cc)}">${esc(p.name)} <small>${p.n}</small></button>`).join('')}</div>` : ''}
    ${storiesHtml(stories, PUB, now)}
    <p class="small muted">Headlines from public broadcasters and established newspapers’ own feeds in the last 48 hours (state-controlled outlets left out), matched on the company’s name and products. The angle is read from words in each title, so treat it as a guide. Stories open on the publisher’s site.</p></div>`;
}

export function companyNewsLayer() {
  return {
    id: 'companynews', group: 'econ', label: 'Companies in the news', swatch: '#8fb3ff', on: false, refresh: 15 * 60_000, pin: 'news',
    sources: ['worldmonitor', 'newsdata'],
    async load() {
      const [wm, h, countries] = await Promise.all([worldMonitorData(), credibleHeadlines(), countryList()]);
      const rows = (wm.techHqs ?? []).map((c) => ({ c, countries, stories: storiesAbout(h.items, companyNames(c)) })).filter((x) => x.stories.length).sort((a, b) => b.stories.length - a.stories.length);
      return { rows, countries, updated: h.updated, headlines: h.items.length, statusNote: `${rows.length} companies named in ${h.items.length.toLocaleString()} credible headlines from the last 48 hours` };
    },
    channels(d, ctx) {
      const max = Math.max(1, ...d.rows.map((r) => r.stories.length));
      return {
        points: d.rows.map((r) => {
          const lead = leadAngle(r.stories); const k = Math.sqrt(r.stories.length / max);
          return { lat: r.c.lat, lng: r.c.lon, r: 0.18 + 0.5 * k, alt: 0.01 + 0.08 * k, color: ANGLE_C[lead], ref: { layer: 'companynews', d: r },
            tip: `<div class="tip"><b>${esc(r.c.company)}</b><span>${r.stories.length} ${r.stories.length === 1 ? 'story' : 'stories'} · mostly ${esc(ANGLE_LABEL[lead].toLowerCase())}</span></div>`,
            label: ctx.view.altitude < 1.6 || k > 0.5 ? `${r.c.company} · ${r.stories.length}` : '' };
        }),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      return { title: `${r.c.company} in the news`, sub: `Headquarters: ${r.c.city}, ${r.c.country}`, probe: [r.c.lat, r.c.lon], wiki: r.c.company,
        html: companyHtml(r.c, r.stories, r.countries ?? [], Date.now()) };
    },
    describeLayer: (d) => ({ rows: [['Companies named', d.rows.length.toLocaleString()], ['Credible headlines read', d.headlines.toLocaleString()], ['Headlines updated', d.updated ? new Date(d.updated).toUTCString().slice(5, 22) : '—']] }),
    learn: {
      what: 'The companies in the news right now, at their headquarters: the bigger the circle, the more stories in the last 48 hours; its colour is the angle most of them take (blue politics, teal economy and markets, amber courts and regulation, red conflict, violet technology). Click one for the stories, grouped by angle, and the countries they are about.',
      how: 'Every 30 minutes the atlas reads the headlines of public broadcasters and established newspapers from their own feeds (the News tab). Here state-controlled outlets are left out, and each headline is matched against 280 technology companies in World Monitor’s headquarters list by name and by their best-known products or leaders (iPhone for Apple, ChatGPT for OpenAI). Words in the title sort it into an angle and pick out the countries it names.',
      try: 'Click the biggest circle in California, then click a country under “Where these stories are” to see that country’s own news.',
      refs: ['newsdata', 'worldmonitor'],
    },
  };
}

/** Stories per country: [{ cc, name, geometry, stories }] for the countries that credible headlines name, most first. */
export function storiesByCountry(items, shapes) {
  const by = new Map();
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); const seen = new Set();
  for (const h of sorted) {
    if (seen.has(h.u)) continue; seen.add(h.u);
    const places = placesIn(h.t, shapes); if (!places.length) continue;
    const s = { ...h, angles: anglesOf(h.t) };
    for (const p of places) { if (!by.has(p.cc)) by.set(p.cc, []); by.get(p.cc).push(s); }
  }
  return shapes.filter((c) => by.has(c.cc)).map((c) => ({ ...c, stories: by.get(c.cc) })).sort((a, b) => b.stories.length - a.stories.length);
}

/** v2.35 The world in the news: each country shaded by how many credible stories name it, coloured by their main angle. */
export function countryNewsLayer() {
  return {
    id: 'countrynews', group: 'live', label: 'Countries in the news', swatch: '#b7a3ff', on: false, refresh: 15 * 60_000, pin: 'news',
    sources: ['newsdata', 'natearth'],
    async load() {
      const [h, shapes] = await Promise.all([credibleHeadlines(), countryShapes()]);
      const rows = storiesByCountry(h.items, shapes);
      return { rows, updated: h.updated, headlines: h.items.length, statusNote: `${rows.length} countries named in ${h.items.length.toLocaleString()} credible headlines from the last 48 hours` };
    },
    channels(d) {
      const max = Math.max(1, ...d.rows.map((r) => r.stories.length));
      return {
        polygons: d.rows.map((r) => {
          const lead = leadAngle(r.stories); const k = Math.sqrt(r.stories.length / max); const c = ANGLE_C[lead];
          const a = (x) => `${c}${Math.round(x * 255).toString(16).padStart(2, '0')}`;
          return { geometry: r.geometry, cap: a(0.14 + 0.5 * k), side: a(0.08), stroke: a(0.85), alt: 0.004 + 0.012 * k, ref: { layer: 'countrynews', d: r },
            tip: `<div class="tip"><b>${esc(r.name)}</b><span>${r.stories.length} ${r.stories.length === 1 ? 'story' : 'stories'} · mostly ${esc(ANGLE_LABEL[lead].toLowerCase())}</span></div>` };
        }),
      };
    },
    count: (d) => d.rows.length.toLocaleString(),
    describe(r) {
      return { title: `${r.name} in the news`, sub: `${r.stories.length} ${r.stories.length === 1 ? 'story' : 'stories'} in the last 48 hours`, wiki: r.name,
        html: `<div class="na"><p class="cd-key">${esc(storiesSummary(r.stories, PUB))}.</p>${angleBar(r.stories)}${storiesHtml(r.stories, PUB, Date.now(), 4)}
          <p><button class="btn ghost" data-country-cc="${esc(r.cc)}">Open ${esc(r.name)}’s page</button></p>
          <p class="small muted">From public broadcasters and established newspapers’ own feeds (state-controlled outlets left out); a story counts when its title names the country, its capital or its people, so one story can count for several countries. Angles are read from title words: a guide.</p></div>` };
    },
    describeLayer: (d) => ({ rows: d.rows.slice(0, 8).map((r) => [r.name, `${r.stories.length} · ${ANGLE_LABEL[leadAngle(r.stories)].split(/[ ,]/)[0].toLowerCase()}`]) }),
    learn: {
      what: 'Which countries the news is about right now: each country is shaded by how many stories from the last 48 hours name it, and coloured by the angle most of them take (blue politics, teal economy and markets, amber courts and regulation, red conflict, violet technology, green climate, pink people and society). Click one for its stories by angle.',
      how: 'Every 30 minutes the atlas reads the headlines of public broadcasters and established newspapers from their own feeds (the News tab). State-controlled outlets are left out here. A headline counts for a country when its title names the country, what its people are called or its capital (Kyiv for Ukraine, the White House for the United States).',
      try: 'Switch it on and look for the most strongly shaded countries, then click one.',
      refs: ['newsdata', 'natearth'],
    },
  };
}
