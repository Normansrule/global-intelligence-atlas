// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: landmarks worth seeing in every part of the world, each with a reference photo.
//
// data/landmarks.json is a hand-picked list (English Wikipedia title, position, kind, country). Nothing else is
// stored: when a card opens, three small requests fill it in, each cached for a week:
//   1. the Wikipedia Action API gives the article's freely licensed lead image, first sentence, coordinates and
//      Wikidata item (pilicense=free leaves out non-free "fair use" pictures);
//   2. imageinfo on that file gives a 960 px thumbnail from Wikimedia Commons with its author and licence, which the
//      card prints under the photo with links to the file page and the licence;
//   3. Wikidata gives the facts drawn as labelled figures: when it was built, height or elevation, area, visitors a
//      year and whether it is a UNESCO (United Nations Educational, Scientific and Cultural Organization) World
//      Heritage Site.
// A landmark whose requests fail still shows its name, kind, country and position.
import { getLocal, getFeed } from './feeds.js';
import { haversineKm, fmtLat, fmtLng } from './astro.js';
import { glyphSvg } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const WEEK = 7 * 86_400_000;
const WP = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities&props=claims&ids=';

/** The six kinds: glyph, short label for the legend and card, colour. */
export const KINDS = {
  ancient: ['columns', 'Ancient site', '#c9a66b'],
  sacred: ['dome', 'Temple, church or mosque', '#e3c45b'],
  fort: ['castle', 'Castle, fort or palace', '#d98c6a'],
  modern: ['tower', 'Tower or monument', '#93b6ff'],
  bridge: ['bridge', 'Bridge or engineering', '#9fc3e6'],
  nature: ['peak', 'Natural wonder', '#72d2be'],
};
const kindOf = (d) => KINDS[d.kind] ?? KINDS.modern;
let regionNames = null;
const country = (cc) => { if (!cc) return ''; try { regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(cc) ?? cc; } catch { return cc; } };

// ------------------------------------------------------------------ Wikidata facts
const claim = (e, p) => e?.claims?.[p]?.filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue) ?? [];
const first = (e, p) => { const cs = claim(e, p); return (cs.find((c) => c.rank === 'preferred') ?? cs[0])?.mainsnak.datavalue.value; };
/** "+1887-01-28T00:00:00Z" with its precision → "1887", "1880s", "3rd century BC", "2560 BC". */
export function fmtWhen(v) {
  if (!v?.time) return null;
  const m = /^([+-])0*(\d+)-/.exec(v.time); if (!m) return null;
  const y = +m[2]; const bc = m[1] === '-'; const p = v.precision ?? 9;
  if (p <= 7) { const c = Math.ceil(y / 100); const s = c % 10 === 1 && c !== 11 ? 'st' : c % 10 === 2 && c !== 12 ? 'nd' : c % 10 === 3 && c !== 13 ? 'rd' : 'th'; return `${c}${s} century${bc ? ' BC' : ''}`; }
  if (p === 8) return `${Math.floor(y / 10) * 10}s${bc ? ' BC' : ''}`;
  return bc ? `${y} BC` : y < 1000 ? `${y} AD` : String(y);
}
const UNIT = { Q11573: 1, Q3710: 0.3048, Q828224: 1000 }; // metre, foot, kilometre
const AREA = { Q712226: 1, Q35852: 0.01, Q25343: 1e-6, Q81292: 0.004047, Q232291: 2.58999 }; // to km²
const unitOf = (q) => String(q?.unit ?? '').split('/').pop();
const qty = (q, table) => { const f = table[unitOf(q)]; return q && f ? Math.abs(parseFloat(q.amount)) * f : null; };
const big = (n) => (n >= 1e4 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : Math.round(n).toLocaleString());
/** The facts worth a figure, from one Wikidata item: [icon, value, label]. */
export function factsOf(e) {
  const out = [];
  const when = fmtWhen(first(e, 'P571')) ?? fmtWhen(first(e, 'P1619'));
  if (when) out.push(['built', when, 'Built']);
  const h = qty(first(e, 'P2048'), UNIT); if (h) out.push(['height', `${Math.round(h).toLocaleString()} m`, 'Tall']);
  const el = qty(first(e, 'P2044'), UNIT); if (el && !h) out.push(['peak', `${Math.round(el).toLocaleString()} m`, 'Above sea']);
  const a = qty(first(e, 'P2046'), AREA); if (a) out.push(['area', a >= 10 ? `${big(a)} km²` : `${(a * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`, 'Area']);
  // visitors a year: the most recent figure (qualifier P585, point in time)
  const vs = claim(e, 'P1174').map((c) => ({ n: parseFloat(c.mainsnak.datavalue.value.amount), t: c.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? '' })).filter((v) => v.n > 0).sort((x, y) => (x.t < y.t ? 1 : -1));
  if (vs[0]) out.push(['people', big(vs[0].n), `Visitors a year${vs[0].t ? ` (${/\d{4}/.exec(vs[0].t)?.[0]})` : ''}`]);
  if (claim(e, 'P757').length || claim(e, 'P1435').some((c) => c.mainsnak.datavalue.value.id === 'Q9259')) out.push(['unesco', 'UNESCO', 'World Heritage']);
  return out;
}
const ICON = {
  built: 'M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5',
  height: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  peak: 'M3 20l6-11 4 6 2-3 6 8z',
  area: 'M4 4h16v16H4zM4 12h16M12 4v16',
  people: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 20c0-3.3 1.8-6 4-6s6 2.7 6 6',
  unesco: 'M12 3l9 5H3zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
const factHtml = ([k, v, label]) => `<div class="lm-fact" title="${esc(label)}">${icon(k)}<b>${esc(v)}</b><small>${esc(label)}</small></div>`;

// ------------------------------------------------------------------ fetching
const strip = (html) => { const t = document.createElement('template'); t.innerHTML = String(html ?? ''); return t.content.textContent.replace(/\s+/g, ' ').trim(); };
/** Everything the card shows about one title. Resolves even when some requests fail. */
export async function enrich(title) {
  const out = { title };
  const page = (await getFeed('mediawiki', `${WP}&redirects=1&prop=pageimages|pageprops|extracts|coordinates&piprop=name&pilicense=free&ppprop=wikibase_item&exintro=1&explaintext=1&exsentences=1&titles=${encodeURIComponent(title)}`, { ttl: WEEK })).query?.pages?.[0];
  if (!page || page.missing) return out;
  out.title = page.title; out.extract = page.extract?.trim() || ''; out.qid = page.pageprops?.wikibase_item;
  out.at = page.coordinates?.[0] ? [page.coordinates[0].lat, page.coordinates[0].lon] : null;
  const jobs = [];
  if (page.pageimage) {
    jobs.push(getFeed('mediawiki', `${WP}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=960&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|Credit&titles=${encodeURIComponent(`File:${page.pageimage}`)}`, { ttl: WEEK }).then((j) => {
      const ii = j.query?.pages?.[0]?.imageinfo?.[0]; if (!ii?.thumburl) return;
      const m = ii.extmetadata ?? {};
      out.photo = { src: ii.thumburl, page: ii.descriptionurl, author: strip(m.Artist?.value) || strip(m.Credit?.value) || 'Unknown author', license: strip(m.LicenseShortName?.value) || 'see file page', licenseUrl: m.LicenseUrl?.value || ii.descriptionurl };
    }).catch(() => {}));
  }
  if (out.qid) jobs.push(getFeed('wikidataapi', WD + out.qid, { ttl: WEEK }).then((j) => { out.facts = factsOf(j.entities?.[out.qid]); }).catch(() => {}));
  await Promise.all(jobs);
  return out;
}

// ------------------------------------------------------------------ the card
function heroHtml(w) {
  if (!w.photo) return '';
  const p = w.photo;
  return `<figure class="lm-hero"><div class="lm-frame"><img src="${esc(p.src)}" alt="${esc(w.title)}" decoding="async" onload="this.parentNode.classList.add('ready')" onerror="this.closest('figure').remove()"/></div>
    <figcaption><a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.author.length > 60 ? `${p.author.slice(0, 57)}…` : p.author)}</a> · <a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a> · Wikimedia Commons</figcaption></figure>`;
}

/** Up to three other landmarks within 800 km, nearest first. */
/** The nearest public traffic camera within 15 km, from the Cameras layer when it has loaded. */
export function nearestCam(d, cams) {
  let best = null;
  for (const c of cams ?? []) { if (Math.abs(c.lat - d.lat) > 0.2 || !c.img) continue; const km = haversineKm(d.lat, d.lng, c.lat, c.lng); if (km < 15 && (!best || km < best.km)) best = { c, km }; }
  return best;
}
const liveHtml = ({ c, km }) => `<button class="lm-live" data-cam="${esc(c.id)}" title="Open this live camera"><img src="${esc(c.img)}" alt="" loading="lazy" onerror="this.closest('button').remove()"/><span><i class="live-dot"></i><b>Live</b> ${esc(c.name)}</span><small>${km < 10 ? km.toFixed(1) : Math.round(km)} km</small></button>`;
const nearby = (d, all) => all.filter((o) => o !== d).map((o) => [o, haversineKm(d.lat, d.lng, o.lat, o.lng)]).filter(([, km]) => km < 800).sort((a, b) => a[1] - b[1]).slice(0, 3);

export function landmarksLayer(api) {
  let all = [];
  return {
    id: 'landmarks', group: 'places', label: 'Landmarks', swatch: '#e3c45b', on: true, sources: ['mediawiki', 'commons', 'wikidataapi'],
    pin: (d) => kindOf(d)[0],
    legend: Object.values(KINDS).map(([g, label, c]) => [g, label, c]),
    async load() {
      const j = await getLocal('data/landmarks.json');
      all = j.rows.map(([title, lat, lng, kind, cc]) => ({ title, lat, lng, kind, cc }));
      return all;
    },
    channels(ls) {
      // a few hundred pins at most, so all of them stay on at every zoom
      return { points: ls.map((d) => ({ lat: d.lat, lng: d.lng, alt: 0.008, r: 0.16, color: kindOf(d)[2], tip: tip(d.title, `${kindOf(d)[1]}${d.cc ? ` · ${country(d.cc)}` : ''}`), ref: { layer: 'landmarks', d } })) };
    },
    describe(d) {
      const near = nearby(d, all);
      return {
        title: d.title, sub: [kindOf(d)[1], country(d.cc)].filter(Boolean).join(' · '),
        probe: [d.lat, d.lng],
        html: `${(() => { const cam = nearestCam(d, api.state?.data?.cameras?.cams); return cam ? liveHtml(cam) : ''; })()}<div id="lm-facts" class="lm-facts"><div class="lm-fact skel"></div><div class="lm-fact skel"></div><div class="lm-fact skel"></div></div><p id="lm-line" class="lm-line"></p>
          ${near.length ? `<div class="lm-near"><small>Nearby</small>${near.map(([o, km]) => `<button class="chip" data-landmark="${esc(o.title)}">${glyphSvg(kindOf(o)[0], kindOf(o)[2], 16)}${esc(o.title)} <span>${km < 10 ? km.toFixed(1) : Math.round(km)} km</span></button>`).join('')}</div>` : ''}`,
        links: [
          { label: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(d.title.replace(/ /g, '_'))}` },
          { label: 'Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${d.lat},${d.lng}` },
          { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/#map=16/${d.lat}/${d.lng}` },
        ],
        /** Called once the card is open: fills in the photo, the figures and the first sentence. */
        async fill(stillOpen) {
          const hero = api.$('#sel-wiki'); if (hero) hero.innerHTML = '<div class="lm-hero"><div class="lm-frame loading"></div></div>';
          let w = { title: d.title };
          try { w = await enrich(d.title); } catch { /* offline: name, kind, country and position still show */ }
          if (!stillOpen()) return;
          if (hero) hero.innerHTML = heroHtml(w);
          const f = api.$('#lm-facts');
          if (f) f.innerHTML = (w.facts ?? []).map(factHtml).join('') || `<div class="lm-fact">${icon('peak')}<b>${fmtLat(d.lat)}</b><small>${fmtLng(d.lng)}</small></div>`;
          const line = api.$('#lm-line'); if (line) line.textContent = w.extract ?? '';
        },
      };
    },
    learn: {
      what: `Nearly 200 landmarks across every continent: ancient sites, temples, churches and mosques, castles and palaces, towers and monuments, great bridges and works of engineering, and natural wonders. Click one for its photo, a line about it and its key figures.`,
      how: 'The list is chosen by hand to cover every region. Each card loads the article’s freely licensed lead photo from Wikimedia Commons, credited to its author under its own licence, the first sentence of the English Wikipedia article, and figures from Wikidata (built, height or elevation, area, visitors a year, World Heritage status). Nothing is copied into the site.',
      try: 'Open a landmark and follow the Nearby chips to tour a region one place at a time; click a symbol in the legend to keep only natural wonders.',
      refs: ['mediawiki', 'commons', 'wikidataapi'],
    },
    /** For the Nearby chips. */
    byTitle: (t) => all.find((d) => d.title === t),
  };
}
