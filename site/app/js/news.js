// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — live news pins. The GDELT Project reads news in 65+ languages every 15 minutes and
// geocodes every place mentioned; its GEO 2.0 API returns the places in the news for a topic as points,
// each with the articles that mention it. World Monitor's core is news, so this brings a slice of it back.
import { getFeed } from './feeds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const TOPICS = {
  top: ['Top stories', '(breaking OR "this morning" OR announced OR officials)'],
  disaster: ['Disasters', '(earthquake OR flood OR wildfire OR hurricane OR typhoon OR cyclone OR tornado OR landslide OR eruption)'],
  conflict: ['Conflict', '(airstrike OR missile OR shelling OR ceasefire OR troops OR militants)'],
  protest: ['Protests', '(protest OR protesters OR demonstration OR strike OR rally)'],
  science: ['Science and space', '(NASA OR launch OR satellite OR telescope OR scientists OR discovery)'],
  climate: ['Climate and energy', '(heatwave OR drought OR emissions OR "power grid" OR blackout OR pipeline)'],
};
const COLORS = { top: '#eef3f6', disaster: '#ff8a4c', conflict: '#f07a63', protest: '#ffd37a', science: '#b7a3ff', climate: '#7ed6c4' };

function parseArticles(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return [...doc.querySelectorAll('a[href]')].map((a) => ({ url: a.getAttribute('href'), title: (a.getAttribute('title') || a.textContent || '').trim() }))
    .filter((a) => /^https?:\/\//.test(a.url) && a.title).slice(0, 8);
}

export const newsLayer = {
  id: 'news', group: 'live', label: 'News around the world', swatch: '#ff9ec7', on: true, refresh: 15 * 60_000, pin: 'news',
  sources: ['gdelt'],
  options: [{ id: 'topic', label: 'Topic', choices: Object.entries(TOPICS).map(([k, [l]]) => [k, l]), value: 'top' }],
  async load(o) {
    const [label, q] = TOPICS[o.topic] ?? TOPICS.top;
    const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=PointData&format=GeoJSON&timespan=24H&maxpoints=250`;
    const j = await getFeed('gdelt', url, { ttl: 10 * 60_000, timeout: 20_000, snapshot: `news-${o.topic in TOPICS ? o.topic : 'top'}.json` });
    const items = (j.features ?? []).filter((f) => f.geometry?.coordinates).map((f) => ({
      name: f.properties.name, count: f.properties.count ?? 1, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      image: f.properties.shareimage || f.properties.urlsocialimage || '', articles: parseArticles(f.properties.html), topic: o.topic, topicLabel: label,
    })).filter((i) => i.articles.length);
    items.sort((a, b) => b.count - a.count);
    return { items, topic: o.topic, at: new Date() };
  },
  channels(d) {
    const c = COLORS[d.topic] ?? '#eef3f6'; const max = Math.max(1, ...d.items.map((i) => i.count));
    return {
      points: d.items.map((i) => ({ lat: i.lat, lng: i.lng, alt: 0.01 + 0.08 * Math.sqrt(i.count / max), r: 0.28, color: c, label: i.name,
        tip: `<div class="tip"><b>${esc(i.name)}</b><span>${i.count} article${i.count === 1 ? '' : 's'} · ${esc(i.articles[0]?.title ?? '')}</span></div>`, ref: { layer: 'news', d: i } })),
      rings: d.items.slice(0, 12).map((i) => ({ lat: i.lat, lng: i.lng, color: c.length === 7 ? c : '#eef3f6', maxR: 2.2, speed: 1.4, period: 1600 })),
    };
  },
  describe(i) {
    return {
      title: i.name, sub: `${i.count} article${i.count === 1 ? '' : 's'} in the last 24 hours · ${i.topicLabel}`,
      html: `${i.image ? `<img class="newsimg" src="${esc(i.image)}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}<ul class="articles">${i.articles.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><small>${esc(new URL(a.url).hostname.replace(/^www\./, ''))}</small></li>`).join('')}</ul>`,
      body: 'Headlines are grouped by the place they mention, so a story about a country appears at its centre. Always read the article before drawing conclusions — automatic geocoding can misplace stories.',
      probe: [i.lat, i.lng], wiki: i.name.split(',')[0],
    };
  },
  learn: {
    what: 'Places in the news in the last 24 hours for the chosen topic. Taller pins mean more articles; the busiest places pulse. Click a pin for the headlines, with links to the original reporting.',
    how: 'The GDELT Project monitors news worldwide, extracts every place name and geocodes it. Its public GEO API returns those points with the articles attached. Browsers often cannot read it directly (it sends no CORS (Cross-Origin Resource Sharing) headers when busy), so Global Intelligence Atlas falls back to a copy the live-data job refreshes every 20 minutes; when the GEO API itself is down, that copy is built from GDELT’s 15-minute event export instead.',
    try: 'Switch the topic to Disasters, then turn on Natural events and Earthquakes to see which reported events line up with instrument data.',
    refs: ['gdelt'],
  },
};
