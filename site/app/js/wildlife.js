// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: wildlife. Search any animal and see where you have the best chance of seeing it, and
// where the most animals found nowhere else live.
//
// Where to see an animal (all live, cached for a day):
//   1. iNaturalist finds the animal from its everyday name ("moose") and gives a freely licensed photo.
//   2. GBIF (the Global Biodiversity Information Facility) matches it to its backbone taxonomy, then counts every
//      sighting people logged in the last ten years (human observations only: no museum drawers, no fossils), by
//      country, by state or province (GADM level 1) and by month.
//   3. The chance in a place is the share of all sightings of that kind of animal there (all mammals for a moose, all
//      birds for a puffin) that are this animal. Dividing by the class corrects for where people look: a place with
//      many birdwatchers logs many birds of every kind. Places with few records are pulled towards the animal's
//      average (a beta prior worth PRIOR sightings), so three lucky records never top the list.
//   4. A sample of sightings in the best places gives each one its position, the months it is seen in, when it was
//      last seen and photos (only those with a Creative Commons licence or public-domain mark, credited).
// Unique-animal hotspots: data/wildlife.json lists the places richest in animals found nowhere else (after Myers et
// al., 2000); a hotspot card asks iNaturalist how many animal species people have seen there and how many of them are
// endemic, with their photos.
import { getLocal, getFeed } from './feeds.js';
import { GLYPHS } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const DAY = 86_400_000;
const GB = 'https://api.gbif.org/v1/';
const IN = 'https://api.inaturalist.org/v1/';
export const PRIOR = 200; // sightings of the class the shrinkage is worth
const TOP = 10; // places sampled for positions, months and photos
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const yearsBack = (n = 10) => { const y = new Date().getFullYear(); return `${y - n},${y}`; };
const OCC = () => `${GB}occurrence/search?basisOfRecord=HUMAN_OBSERVATION&occurrenceStatus=PRESENT&hasCoordinate=true&hasGeospatialIssue=false&year=${yearsBack()}`;
const enc = encodeURIComponent;
let regionNames = null;
const countryName = (cc) => { if (!cc) return ''; try { regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(cc) ?? cc; } catch { return cc; } };

// A paw for places to see an animal (added here so this layer stays self-contained; icons.js draws it like any glyph).
const toe = (x, y, rx, ry) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
GLYPHS.paw ??= [
  ['M12 11.6c3.3 0 6.4 3.6 6.4 6.6 0 2-1.4 3.2-3.2 3.2-1.3 0-2.1-.7-3.2-.7s-1.9.7-3.2.7c-1.8 0-3.2-1.2-3.2-3.2 0-3 3.1-6.6 6.4-6.6z', 'c'],
  [`${toe(4.4, 10.4, 2.1, 2.6)}${toe(8.9, 5.6, 2.3, 2.8)}${toe(15.1, 5.6, 2.3, 2.8)}${toe(19.6, 10.4, 2.1, 2.6)}`, 'c'],
];

// ------------------------------------------------------------------ pure helpers (tested)
/** One GBIF facet as [{ name, count }], whichever way the field is spelled (COUNTRY, GADM_LEVEL_1_GID…). */
export function facetOf(j, field) {
  const want = field.replace(/_/g, '').toLowerCase();
  return (j?.facets ?? []).find((f) => String(f.field).replace(/_/g, '').toLowerCase() === want)?.counts ?? [];
}
/**
 * Rank places by the chance that a sighting of this kind of animal there is this animal.
 * rows: [{ id, k (sightings of the animal), n (sightings of its class) }]. Returns the rows with
 * raw = k/n, p = the smoothed chance, share = k / all k, best first.
 */
export function rankPlaces(rows, { prior = PRIOR, min = 5 } = {}) {
  const ok = rows.filter((r) => r.k > 0).map((r) => ({ ...r, n: Math.max(r.n || 0, r.k) }));
  const K = ok.reduce((s, r) => s + r.k, 0); const N = ok.reduce((s, r) => s + r.n, 0);
  if (!K) return [];
  const m = K / N;
  return ok.filter((r) => r.k >= min || ok.length <= 3)
    .map((r) => ({ ...r, raw: r.k / r.n, p: (r.k + prior * m) / (r.n + prior), share: r.k / K }))
    .sort((a, b) => b.p - a.p || b.k - a.k);
}
/** 0.237 → "24%", 0.0237 → "2.4%", 0.00237 → "0.24%". */
export function pct(p) {
  const v = p * 100;
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 1) return `${v.toFixed(1).replace(/\.0$/, '')}%`;
  if (v >= 0.01) return `${v.toPrecision(2)}%`;
  return '<0.01%';
}
/** 0.2 → "1 in 5". */
export const oneIn = (p) => (p > 0 ? `1 in ${Math.max(1, Math.round(1 / p)).toLocaleString()}` : '—');
/** The months worth going, as ranges: [counts × 12] → "Jun–Sep" (months with at least 70 % of the busiest one). */
export function bestMonths(counts, cut = 0.7) {
  const max = Math.max(...counts); if (!(max > 0)) return '';
  const on = counts.map((c) => c >= max * cut);
  if (on.every(Boolean)) return 'All year';
  const start = on.findIndex((v, i) => v && !on[(i + 11) % 12]); // a month that starts a run (wraps round December)
  const runs = []; let run = null;
  for (let s = 0; s < 12; s++) { const i = (start + s) % 12; if (on[i]) { if (run) run[1] = i; else runs.push(run = [i, i]); } else run = null; }
  return runs.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]}–${MONTHS[b]}`)).join(', ');
}
/** The word for the class the chance is counted against. */
export function classWord(cls) {
  return ({ Mammalia: 'mammal', Aves: 'bird', Reptilia: 'reptile', Squamata: 'reptile', Testudines: 'reptile', Crocodylia: 'reptile', Amphibia: 'amphibian', Actinopterygii: 'fish', Elasmobranchii: 'shark and ray', Insecta: 'insect', Arachnida: 'spider and scorpion', Gastropoda: 'snail and slug', Cephalopoda: 'octopus and squid', Malacostraca: 'crab and shrimp', Anthozoa: 'coral and anemone', Scyphozoa: 'jellyfish' })[cls] ?? 'animal';
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
/** "2026-10-31T09:12:00" or a range "2026-10-30/2026-10-31" → days ago from now. */
export function daysAgo(date, now = Date.now()) {
  const t = Date.parse(String(date ?? '').slice(0, 10)); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}
const agoWords = (d) => (d == null ? '' : d === 0 ? 'seen today' : d === 1 ? 'seen yesterday' : d < 60 ? `seen ${d} days ago` : d < 730 ? `seen ${Math.round(d / 30)} months ago` : `seen ${Math.round(d / 365)} years ago`);
/** A photo from a GBIF record we may show: Creative Commons or public domain, with its author. */
export function photoOf(rec) {
  for (const m of rec?.media ?? []) {
    const lic = String(m.license ?? '');
    if ((m.type && m.type !== 'StillImage') || !m.identifier || !/creativecommons|publicdomain/i.test(lic)) continue;
    const src = String(m.identifier).replace(/^http:/, 'https:').replace(/\/original\.(jpe?g|png)/i, '/medium.$1');
    const code = (/licenses\/([a-z-]+)\/([\d.]+)/i.exec(lic) ?? [])[1]; const ver = (/licenses\/[a-z-]+\/([\d.]+)/i.exec(lic) ?? [])[1];
    return { src, by: m.creator || m.rightsHolder || rec.recordedBy || 'unknown', lic: /publicdomain/i.test(lic) ? 'Public domain' : code ? `CC ${code.toUpperCase()}${ver ? ` ${ver}` : ''}` : 'CC', licUrl: lic, page: m.references || rec.references || `https://www.gbif.org/occurrence/${rec.key}` };
  }
  return null;
}
/** Colour for a chance 0..1 relative to the best place: cool blue → sea green → ochre → hot orange. */
export function heat(t) {
  const stops = [[0, [90, 169, 255]], [0.4, [114, 210, 190]], [0.7, [242, 184, 75]], [1, [255, 112, 67]]];
  const x = Math.max(0, Math.min(1, t)); let i = 1; while (i < stops.length - 1 && stops[i][0] < x) i++;
  const [a, ca] = stops[i - 1]; const [b, cb] = stops[i]; const f = (x - a) / (b - a || 1);
  return `#${ca.map((v, j) => Math.round(v + (cb[j] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ fetching
/** iNaturalist taxa as { id, name, common, photo, iconic, obs, wiki }. */
const PLANTISH = new Set(['Plantae', 'Fungi', 'Chromista', 'Protozoa', 'Bacteria', 'Archaea', 'Viruses']);
const taxonOf = (t) => ({
  id: t.id, name: t.name, common: t.preferred_common_name || '', rank: t.rank, iconic: t.iconic_taxon_name || '', obs: t.observations_count ?? null, wiki: t.wikipedia_url || '',
  photo: t.default_photo?.medium_url && t.default_photo.license_code ? { src: t.default_photo.medium_url, thumb: t.default_photo.square_url || t.default_photo.medium_url, by: t.default_photo.attribution || '', lic: String(t.default_photo.license_code).toUpperCase().replace(/^CC-/, 'CC ') } : null,
});
const LIC_URL = { 'cc-by': 'by', 'cc-by-sa': 'by-sa', 'cc-by-nd': 'by-nd', 'cc-by-nc': 'by-nc', 'cc-by-nc-sa': 'by-nc-sa', 'cc-by-nc-nd': 'by-nc-nd' };
const licUrl = (code) => (code === 'cc0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : LIC_URL[code] ? `https://creativecommons.org/licenses/${LIC_URL[code]}/4.0/` : '');
const textOf = (html) => { if (!html) return ''; try { const d = new DOMParser().parseFromString(String(html), 'text/html'); d.querySelectorAll('script,style,template,noscript').forEach((x) => x.remove()); return d.body.textContent.replace(/\s+/g, ' ').trim(); } catch { return String(html).replace(/<[^>]*>/g, ''); } };
const LINEAGE = ['class', 'order', 'family', 'genus'];
/**
 * v2.16: the animal in depth, from iNaturalist's taxon page: up to 12 photos people took of it in the wild, each with
 * an open licence (Creative Commons or public domain) and its photographer, a short Wikipedia summary, its family tree
 * and how many times it has been seen. Returns null when iNaturalist does not answer.
 */
export function taxonDetail(t) {
  if (!t) return null;
  const photos = (t.taxon_photos ?? []).map((x) => x.photo).filter((ph) => ph?.medium_url && ph.license_code).slice(0, 12).map((ph) => ({
    src: ph.large_url || ph.medium_url.replace('/medium.', '/large.'), thumb: ph.square_url || ph.url || ph.medium_url, by: ph.attribution || '',
    lic: String(ph.license_code).toUpperCase().replace(/^CC-/, 'CC ').replace(/^CC0$/, 'CC0 (public domain)'), licUrl: licUrl(ph.license_code), page: ph.id ? `https://www.inaturalist.org/photos/${ph.id}` : '',
  }));
  const lineage = LINEAGE.map((r) => (t.ancestors ?? []).find((a) => a.rank === r)).filter(Boolean).map((a) => ({ rank: a.rank, name: a.name, common: a.preferred_common_name || '' }));
  const summary = textOf(t.wikipedia_summary).slice(0, 700);
  const cs = t.conservation_status; const status = cs?.status_name ? { label: cs.status_name, by: cs.authority || '' } : null;
  return { photos, lineage, summary, status, obs: t.observations_count ?? null, wiki: t.wikipedia_url || '' };
}
export async function suggest(q) {
  try {
    const j = await getFeed('inaturalist', `${IN}taxa/autocomplete?q=${enc(q)}&per_page=12&is_active=true&locale=en`, { ttl: DAY });
    const all = (j.results ?? []).filter((t) => !PLANTISH.has(t.iconic_taxon_name) && !t.extinct).map(taxonOf);
    const sp = all.filter((t) => t.rank === 'species' || t.rank === 'subspecies');
    return (sp.length ? sp : all).slice(0, 6);
  } catch {
    const j = await getFeed('gbif', `${GB}species/suggest?q=${enc(q)}&rank=SPECIES&limit=8`, { ttl: DAY });
    return (j ?? []).filter((t) => t.kingdom === 'Animalia').slice(0, 6).map((t) => ({ id: null, gbif: t.key, name: t.canonicalName || t.scientificName, common: '', rank: 'species', photo: null }));
  }
}
const occ = (q) => getFeed('gbif', `${OCC()}&${q}`, { ttl: DAY });
/** Everything the map and the species page show about one animal. */
export async function study(t) {
  const m = await getFeed('gbif', `${GB}species/match?name=${enc(t.name)}&kingdom=Animalia`, { ttl: 7 * DAY });
  const key = t.gbif ?? (m.matchType && m.matchType !== 'NONE' ? m.usageKey : null);
  if (!key) throw Object.assign(new Error(`GBIF has no animal called ${t.name}`), { help: `GBIF does not know “${t.common || t.name}”. Try its scientific name.` });
  const classKey = m.classKey ?? 1; const word = m.classKey ? classWord(m.class) : 'animal';
  const f = await occ(`taxonKey=${key}&limit=0&facet=country&facet=gadmLevel1Gid&facet=month&facetLimit=80`);
  const total = f.count ?? 0;
  const countries = facetOf(f, 'country').map((c) => ({ cc: c.name, k: c.count }));
  let regions = facetOf(f, 'gadmLevel1Gid').map((c) => ({ id: c.name, k: c.count }));
  // Sea animals mostly sight outside any province (GADM covers land): then rank countries, whose waters GBIF counts.
  const onLand = regions.reduce((s, r) => s + r.k, 0);
  const level = regions.length && onLand >= total * 0.5 ? 'gadmLevel1Gid' : 'country';
  if (level === 'country') regions = countries.map((c) => ({ id: c.cc, k: c.k }));
  const iucn = getFeed('gbif', `${GB}species/${key}/iucnRedListCategory`, { ttl: 7 * DAY }).catch(() => null);
  const world = occ(`taxonKey=${key}&limit=300`).catch(() => ({ results: [] }));
  let ranked = [];
  if (regions.length) {
    const den = await occ(`taxonKey=${classKey}&limit=0&facet=${level}&facetLimit=${regions.length + 5}&${regions.map((r) => `${level}=${enc(r.id)}`).join('&')}`).catch(() => null);
    const n = new Map(facetOf(den, level).map((c) => [c.name, c.count]));
    ranked = rankPlaces(regions.map((r) => ({ ...r, n: n.get(r.id) ?? 0 })));
  }
  const top = ranked.slice(0, TOP);
  const samples = await Promise.all(top.map((r) => occ(`taxonKey=${key}&${level}=${enc(r.id)}&limit=40&facet=month&facetLimit=12`).catch(() => null)));
  const w = await world;
  const places = [];
  const byId = new Map();
  for (const rec of w.results ?? []) { const id = level === 'country' ? rec.countryCode : rec.gadm?.level1?.gid; if (id) (byId.get(id) ?? byId.set(id, []).get(id)).push(rec); }
  ranked.forEach((r, i) => {
    const s = samples[i]?.results ?? byId.get(r.id) ?? [];
    const pts = s.filter((x) => Number.isFinite(x.decimalLatitude) && Number.isFinite(x.decimalLongitude));
    if (!pts.length) return;
    const g = pts.find((x) => x.gadm)?.gadm;
    const cc = pts.find((x) => x.countryCode)?.countryCode ?? (level === 'country' ? r.id : '');
    const mf = samples[i] ? facetOf(samples[i], 'month') : [];
    const months = mf.length ? MONTHS.map((_, k) => mf.find((c) => Number(c.name) === k + 1)?.count ?? 0) : null;
    const last = pts.map((x) => daysAgo(x.eventDate)).filter((d) => d != null).sort((a, b) => a - b)[0] ?? null;
    places.push({
      kind: 'place', id: `sp:${t.name}|${r.id}`, gid: r.id, level, rank: places.length + 1,
      name: level === 'country' ? countryName(cc) : (g?.level1?.name || pts.find((x) => x.stateProvince)?.stateProvince || r.id),
      country: level === 'country' ? '' : (countryName(cc) || g?.level0?.name || ''), cc,
      lat: median(pts.map((x) => x.decimalLatitude)), lng: median(pts.map((x) => x.decimalLongitude)),
      k: r.k, n: r.n, p: r.p, raw: r.raw, share: r.share, months, last,
      photos: s.map(photoOf).filter(Boolean).filter((ph, j, a) => a.findIndex((o) => o.src === ph.src) === j).slice(0, 6),
    });
  });
  const dots = [...(w.results ?? []), ...samples.flatMap((s) => s?.results ?? [])].filter((x) => Number.isFinite(x.decimalLatitude)).map((x) => [x.decimalLatitude, x.decimalLongitude]);
  const mAll = facetOf(f, 'month'); const months = MONTHS.map((_, k) => mAll.find((c) => Number(c.name) === k + 1)?.count ?? 0);
  const iu = await iucn;
  return {
    kind: 'species', id: `sp:${t.name}`, t, key, word, total, level, months,
    countries: countries.map((c) => ({ ...c, name: countryName(c.cc), share: total ? c.k / total : 0 })),
    places: places.slice(0, 40), dots: dots.slice(0, 900),
    iucn: iu?.code && iu.code !== 'NE' ? { code: iu.code, label: String(iu.category ?? '').toLowerCase().replace(/_/g, ' ') } : null,
  };
}

// ------------------------------------------------------------------ page parts
const IUCN_COLOR = { LC: '#72d2be', NT: '#b9d77a', VU: '#f2b84b', EN: '#ff9e5e', CR: '#ff7043', EW: '#c792ea', EX: '#9aa5b1', DD: '#a7b5c6' };
const photoHtml = (ph, alt) => (ph ? `<figure class="lm-hero"><div class="lm-frame"><img src="${esc(ph.src)}" alt="${esc(alt)}" decoding="async" data-onload="ready" data-fallback="figure"/></div>
  <figcaption>${esc(String(ph.by).replace(/^\(c\)\s*/i, '© ').slice(0, 70))} · ${ph.licUrl ? `<a href="${esc(ph.licUrl)}" target="_blank" rel="noopener">${esc(ph.lic)}</a>` : esc(ph.lic)}${ph.page ? ` · <a href="${esc(ph.page)}" target="_blank" rel="noopener">source</a>` : ' · iNaturalist'}</figcaption></figure>` : '');
const ICON = {
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.2v1.6',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  paw: 'M12 12c3 0 5.5 3 5.5 5.5 0 1.6-1.2 2.6-2.7 2.6-1.1 0-1.8-.6-2.8-.6s-1.7.6-2.8.6c-1.5 0-2.7-1-2.7-2.6C6.5 15 9 12 12 12zM5 9.5v.1M9 6v.1M15 6v.1M19 9.5v.1',
};
const fact = (k, v, label, title = label) => `<div class="lm-fact" title="${esc(title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg><b>${esc(v)}</b><small>${esc(label)}</small></div>`;
const big = (n) => (n >= 1e4 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : Math.round(n).toLocaleString());
/** Twelve bars, the months worth going in colour. */
export function monthsSvg(counts, color = 'var(--accent-2)') {
  const max = Math.max(1, ...counts); const cut = max * 0.7;
  return `<svg class="wl-months" viewBox="0 0 240 64" role="img" aria-label="Sightings by month">${counts.map((c, i) => { const h = Math.max(2, (c / max) * 46); return `<rect x="${i * 20 + 3}" y="${50 - h}" width="14" height="${h}" rx="1.5" fill="${c >= cut && c > 0 ? color : 'var(--line)'}"><title>${MONTHS[i]}: ${c.toLocaleString()}</title></rect><text x="${i * 20 + 10}" y="62" text-anchor="middle">${MONTHS[i][0]}</text>`; }).join('')}</svg>`;
}
function countryBar(sp) {
  const top = sp.countries.slice(0, 5); const rest = Math.max(0, 1 - top.reduce((s, c) => s + c.share, 0));
  const cols = ['var(--accent)', 'var(--accent-2)', 'var(--ochre)', 'var(--red)', 'var(--ink-2)'];
  const seg = top.map((c, i) => `<i style="flex:${c.share};background:${cols[i]}" title="${esc(c.name)} ${pct(c.share)}"></i>`).join('') + (rest > 0.005 ? `<i style="flex:${rest};background:var(--line)" title="Other ${pct(rest)}"></i>` : '');
  return `<div class="wl-share"><div class="wl-bar">${seg}</div><ul>${top.map((c, i) => `<li><i style="background:${cols[i]}"></i>${esc(c.name)} <b>${pct(c.share)}</b></li>`).join('')}${rest > 0.005 ? `<li><i style="background:var(--line)"></i>Other <b>${pct(rest)}</b></li>` : ''}</ul></div>`;
}
const animal = (sp) => (sp.t.common || sp.t.name).toLowerCase();
function placeRow(pl, max, sp) {
  return `<button class="wl-place" data-wl-place="${pl.rank - 1}" style="--w:${Math.max(4, (pl.p / max) * 100).toFixed(1)}%;--c:${heat(pl.p / max)}">
    <span class="wl-rank">${pl.rank}</span><span class="wl-name"><b>${esc(pl.name)}</b>${pl.country ? `<small>${esc(pl.country)}</small>` : ''}</span>
    <span class="wl-pct" title="${esc(`About ${oneIn(pl.p)} ${sp.word} sightings logged here is a ${animal(sp)}`)}">${pct(pl.p)}</span>
    <span class="wl-meter"><i></i></span><small class="wl-meta">${[agoWords(pl.last), pl.months ? bestMonths(pl.months) : ''].filter(Boolean).join(' · ')}</small></button>`;
}
function speciesBody(sp) {
  const best = sp.places[0]; const max = best?.p ?? 1;
  if (!best) return `<p class="muted">No sightings with a position were logged on GBIF in the last ten years. It may be very rare, live where few people look, or be known by another name.</p>`;
  return `<p class="wl-lead"><b>Best chance: ${esc(best.name)}${best.country ? `, ${esc(best.country)}` : ''}.</b> About ${esc(oneIn(best.p))} ${esc(sp.word)} sightings logged there is a ${esc(animal(sp))}.</p>
    <div class="lm-facts">${fact('target', pct(best.p), `chance in ${best.name}`, `Share of ${sp.word} sightings there`)}${fact('eye', big(sp.total), 'sightings, 10 years')}${fact('globe', String(sp.countries.length), sp.countries.length === 1 ? 'country' : 'countries')}${best.months ? fact('cal', bestMonths(best.months) || '—', `best months in ${best.name}`) : ''}</div>
    <h4 class="wl-h">Best places to see it <small>chance a ${esc(sp.word)} sighting is a ${esc(animal(sp))}</small></h4>
    <div class="wl-places">${sp.places.slice(0, 8).map((pl) => placeRow(pl, max, sp)).join('')}</div>
    <h4 class="wl-h">Where its sightings are <small>share of all ${big(sp.total)}</small></h4>${countryBar(sp)}
    ${best.months ? `<h4 class="wl-h">When, in ${esc(best.name)}</h4>${monthsSvg(best.months)}` : sp.months.some((c) => c) ? `<h4 class="wl-h">When, worldwide</h4>${monthsSvg(sp.months)}` : ''}
    <p class="wl-how">Chance: the share of all ${esc(sp.word)} sightings logged in a place in the last ten years that were ${esc(animal(sp))}s, from ${esc(big(sp.total))} records on GBIF, so busy birding or hiking spots don’t win just for having more people. Places with few records are pulled towards the average. It tells you where to go, not a promise: animals move, and people log what they find exciting.</p>`;
}
function placeBody(pl, sp) {
  return `<div class="lm-facts">${fact('target', pct(pl.p), 'chance', `About ${oneIn(pl.p)} ${sp.word} sightings here`)}${fact('eye', big(pl.k), 'sightings, 10 years')}${fact('star', pct(pl.share), `of all ${animal(sp)} sightings`)}${pl.months ? fact('cal', bestMonths(pl.months) || '—', 'best months') : ''}</div>
    <p class="wl-lead">About <b>${esc(oneIn(pl.p))}</b> ${esc(sp.word)} sightings logged here is a ${esc(animal(sp))}${pl.last != null ? `; one was ${esc(agoWords(pl.last))}` : ''}.</p>
    ${pl.months ? monthsSvg(pl.months) : ''}
    ${pl.photos.length > 1 ? `<div class="wl-photos">${pl.photos.slice(1, 5).map((ph) => `<a href="${esc(ph.page)}" target="_blank" rel="noopener" title="${esc(`${ph.by} · ${ph.lic}`)}"><img src="${esc(ph.src)}" alt="" loading="lazy" data-fallback="remove"/></a>`).join('')}</div>` : ''}
    <div class="lm-near"><button class="chip" data-wl-back="1">${esc(sp.t.common || sp.t.name)}: every place</button></div>`;
}
const taxonButton = (t, n) => `<button class="wl-taxon" data-wl-taxon="${t.id}" title="Where to see it">${t.photo ? `<img src="${esc(t.photo.thumb)}" alt="" loading="lazy" data-fallback="remove"/>` : '<span class="wl-nopic"></span>'}<b>${esc(t.common || t.name)}</b>${n != null ? `<small>${n.toLocaleString()} seen</small>` : `<small><i>${esc(t.name)}</i></small>`}</button>`;

/** For the main search box: up to two common animal names containing the text (exact name first). */
let namesP = null;
export async function animalNames(q) {
  const s = String(q ?? '').trim().toLowerCase(); if (s.length < 3) return [];
  namesP ??= getLocal('data/wildlife.json').then((j) => j.names ?? []).catch(() => []);
  return (await namesP).filter((n) => n.includes(s)).sort((a, b) => (b === s) - (a === s) || a.indexOf(s) - b.indexOf(s) || a.length - b.length).slice(0, 2);
}

// ------------------------------------------------------------------ the layer
export const POPULAR = ['Moose', 'Polar bear', 'Tiger', 'Atlantic puffin', 'Koala', 'Orca', 'Snow leopard', 'Giant panda', 'Humpback whale', 'Red panda', 'Ring-tailed lemur', 'Bald eagle'];
export function wildlifeLayer(api) {
  const ws = { hotspots: [], sp: null, job: null, sugs: [], taxa: new Map(), msg: '', seq: 0 };
  const H = (s) => api.$?.(s) ?? document.querySelector(s);
  // the stylesheet lives next to atlas.css, loaded once
  if (typeof document !== 'undefined' && !document.querySelector('link[data-wildlife]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/wildlife.css', import.meta.url).href; l.dataset.wildlife = '1'; document.head.appendChild(l); }

  function setPanel() { const p = document.querySelector('[data-lpanel="wildlife"]'); if (p && !p.contains(document.activeElement)) p.innerHTML = layer.panel(true); else { const s = document.getElementById('wl-state'); if (s) s.innerHTML = stateHtml(); } }
  const stateHtml = () => (ws.msg ? `<span class="${ws.msg.startsWith('!') ? 'err' : 'muted'}">${esc(ws.msg.replace(/^!/, ''))}</span>` : ws.sp?.places ? `<span>Showing <b>${esc(ws.sp.t.common || ws.sp.t.name)}</b>: ${ws.sp.places.length} places${ws.sp.places[0] ? `, best ${esc(ws.sp.places[0].name)}` : ''}.</span> <button class="chip" data-wl-clear="1">Show unique-animal hotspots</button>` : '<span class="muted">Leaf pins: the places with the most animals found nowhere else.</span>');
  const sugHtml = () => ws.sugs.map((t, i) => `<button class="wl-sug" data-wl-pick="${i}">${t.photo ? `<img src="${esc(t.photo.thumb)}" alt="" loading="lazy" data-fallback="remove"/>` : '<span class="wl-nopic"></span>'}<span><b>${esc(t.common || t.name)}</b><small><i>${esc(t.name)}</i>${t.obs ? ` · ${big(t.obs)} sightings` : ''}</small></span></button>`).join('');

  /** Look an animal up and show where to see it. */
  async function run(t) {
    const my = ++ws.seq;
    ws.sugs = []; ws.msg = `Counting sightings of ${t.common || t.name}…`; setPanel();
    if (t.id) ws.taxa.set(String(t.id), t);
    if (!api.state?.on?.has('wildlife')) api.toggleLayer?.('wildlife', true);
    ws.job = study(t);
    ws.sp = { kind: 'species', id: `sp:${t.name}`, t, pending: true };
    api.select?.({ layer: 'wildlife', d: ws.sp });
    try {
      const r = await ws.job; if (my !== ws.seq) return;
      ws.sp = r; ws.msg = ''; api.refreshLayer?.('wildlife', { soft: true }); setPanel();
      const b = r.places[0]; if (b) api.fly?.(b.lat, b.lng, r.places.length > 1 ? 1.6 : 0.9, false);
      api.compose?.();
    } catch (e) { if (my !== ws.seq) return; ws.msg = `!${e.help ?? 'GBIF did not answer. Try again in a moment.'}`; setPanel(); }
  }
  async function runText(q) {
    q = String(q ?? '').trim(); if (q.length < 2) return;
    ws.msg = `Looking up ${q}…`; setPanel();
    try { const s = await suggest(q); if (!s.length) { ws.msg = `!No animal called “${q}” was found. Try another name.`; setPanel(); return; } run(s[0]); } catch { ws.msg = '!iNaturalist and GBIF did not answer. Try again in a moment.'; setPanel(); }
  }
  let timer = 0;
  if (typeof document !== 'undefined') {
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'wl-q') return;
      clearTimeout(timer); const q = e.target.value.trim();
      if (q.length < 2) { ws.sugs = []; const b = document.getElementById('wl-sugs'); if (b) b.innerHTML = ''; return; }
      timer = setTimeout(async () => { try { ws.sugs = await suggest(q); } catch { ws.sugs = []; } if (document.getElementById('wl-q')?.value.trim() !== q) return; const b = document.getElementById('wl-sugs'); if (b) b.innerHTML = sugHtml(); }, 280);
    });
    document.addEventListener('submit', (e) => { if (e.target.id !== 'wl-form') return; e.preventDefault(); const q = document.getElementById('wl-q')?.value; if (ws.sugs[0]) run(ws.sugs[0]); else runText(q); });
    document.addEventListener('click', (e) => {
      const ph = e.target.closest('[data-wl-ph]');
      if (ph && ws.detail) { const i = Number(ph.dataset.wlPh); const h = document.getElementById('wl-hero'); if (h && ws.detail.photos[i]) { h.innerHTML = photoHtml(ws.detail.photos[i], document.getElementById('notes-title')?.textContent || 'Animal'); ph.parentElement.querySelectorAll('[data-wl-ph]').forEach((x) => x.setAttribute('aria-pressed', String(x === ph))); } return; }
      const b = e.target.closest('[data-wl-pick],[data-wl-q],[data-wl-taxon],[data-wl-place],[data-wl-clear],[data-wl-back]'); if (!b) return;
      if (b.dataset.wlPick != null) return run(ws.sugs[Number(b.dataset.wlPick)]);
      if (b.dataset.wlQ != null) return runText(b.dataset.wlQ);
      if (b.dataset.wlTaxon != null) { const t = ws.taxa.get(b.dataset.wlTaxon); return t ? run(t) : null; }
      if (b.dataset.wlPlace != null && ws.sp?.places) { const pl = ws.sp.places[Number(b.dataset.wlPlace)]; if (pl) { api.fly?.(pl.lat, pl.lng, 0.6, false); api.select?.({ layer: 'wildlife', d: pl }); } return; }
      if (b.dataset.wlBack != null && ws.sp?.places) return api.select?.({ layer: 'wildlife', d: ws.sp });
      if (b.dataset.wlClear != null) { ws.seq++; ws.sp = null; ws.msg = ''; api.refreshLayer?.('wildlife', { soft: true }); setPanel(); api.closeNotes?.(); }
    });
  }

  const layer = {
    id: 'wildlife', group: 'places', label: 'Wildlife: where to see it', swatch: '#72d2be', on: false, fresh: true,
    sources: ['gbif', 'inaturalist', 'myers2000'],
    pin: (d) => (d?.kind === 'hotspot' ? 'leaf' : 'paw'),
    legend: [['leaf', 'Unique-animal hotspot', '#72d2be'], ['paw', 'Place to see the animal you searched', '#ff7043']],
    async load() {
      const j = await getLocal('data/wildlife.json');
      ws.hotspots = j.hotspots.map(([name, lat, lng, r, why, look]) => ({ kind: 'hotspot', id: `hs:${name}`, name, lat, lng, r, why, look }));
      // a shared link to an animal (#…&sel=wildlife~sp:Alces alces) opens it again
      const m = /[&#]sel=wildlife~sp(?:%3A|:)([^&|%]+(?:%20[^&|%]+)*)/i.exec(typeof location !== 'undefined' ? location.hash : '');
      if (m && !ws.sp) { const name = decodeURIComponent(m[1]); setTimeout(() => runText(name), 0); }
      return { hotspots: ws.hotspots, statusNote: '' };
    },
    channels() {
      const sp = ws.sp?.places ? ws.sp : null;
      if (!sp) {
        return { points: ws.hotspots.map((h) => ({ lat: h.lat, lng: h.lng, alt: 0.03, r: 0.3, color: '#72d2be', tip: tip(h.name, 'Animals found nowhere else'), ref: { layer: 'wildlife', d: h } })) };
      }
      const max = sp.places[0]?.p ?? 1;
      const points = sp.places.map((pl) => ({ lat: pl.lat, lng: pl.lng, alt: 0.02 + 0.3 * (pl.p / max), r: 0.1 + 0.32 * (pl.p / max), color: heat(pl.p / max), tip: tip(`${pl.rank}. ${pl.name}`, `${pct(pl.p)} chance · ${pl.country || (sp.t.common || sp.t.name)}`), ref: { layer: 'wildlife', d: pl } }));
      for (const [lat, lng] of sp.dots) points.push({ lat, lng, alt: 0.004, r: 0.05, color: '#f2b84b' });
      const b = sp.places[0];
      return { points, rings: b ? [{ lat: b.lat, lng: b.lng, color: '#ff7043', maxR: 3, speed: 1.4, period: 1700 }] : [] };
    },
    count: () => (ws.sp?.places ? `${ws.sp.places.length} places` : `${ws.hotspots.length} hotspots`),
    panel: () => `<div class="wl-ctl"><form id="wl-form" class="wl-form" role="search"><input id="wl-q" type="search" placeholder="Find an animal: moose, puffin, koala…" autocomplete="off" aria-label="Find an animal"/><button class="btn" type="submit">Find</button></form>
      <div id="wl-sugs" class="wl-sugs">${sugHtml()}</div>
      <div class="wl-pop">${POPULAR.map((n) => `<button class="chip" data-wl-q="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <p id="wl-state" class="wl-state">${stateHtml()}</p></div>`,
    describe(d) {
      if (d.kind === 'hotspot') {
        return {
          title: d.name, sub: 'Unique-animal hotspot', probe: [d.lat, d.lng],
          html: `<p class="wl-lead">${esc(d.why)}</p>
            <div id="wl-hs-facts" class="lm-facts"><div class="lm-fact skel"></div><div class="lm-fact skel"></div><div class="lm-fact skel"></div></div>
            <h4 class="wl-h">Look for</h4><div class="lm-near">${d.look.map((n) => `<button class="chip" data-wl-q="${esc(n)}">${esc(n)}</button>`).join('')}</div>
            <h4 class="wl-h">Found only here, seen most <small>iNaturalist</small></h4><div id="wl-hs-grid" class="wl-grid"><div class="wl-taxon skel"></div><div class="wl-taxon skel"></div><div class="wl-taxon skel"></div></div>`,
          links: [{ label: 'iNaturalist', url: `https://www.inaturalist.org/observations?lat=${d.lat}&lng=${d.lng}&radius=${d.r}&endemic=true&taxon_id=1&view=species` }],
          async fill(stillOpen) {
            const q = `lat=${d.lat}&lng=${d.lng}&radius=${d.r}&taxon_id=1&quality_grade=research`;
            const [all, end] = await Promise.all([
              getFeed('inaturalist', `${IN}observations/species_counts?${q}&per_page=1`, { ttl: 7 * DAY }).catch(() => null),
              getFeed('inaturalist', `${IN}observations/species_counts?${q}&endemic=true&per_page=12`, { ttl: 7 * DAY }).catch(() => null),
            ]);
            if (!stillOpen()) return;
            const f = H('#wl-hs-facts'); const g = H('#wl-hs-grid');
            const nAll = all?.total_results; const nEnd = end?.total_results;
            if (f) f.innerHTML = nAll != null || nEnd != null ? [nAll != null ? fact('eye', big(nAll), 'animal species seen') : '', nEnd != null ? fact('star', big(nEnd), 'found nowhere else') : '', nAll && nEnd != null ? fact('target', pct(nEnd / nAll), 'of them unique', 'Share of the animal species seen here that are endemic') : ''].join('') : '<p class="muted">iNaturalist did not answer; the animals to look for are above.</p>';
            const ts = (end?.results ?? []).map((r) => ({ t: taxonOf(r.taxon), n: r.count }));
            for (const { t } of ts) ws.taxa.set(String(t.id), t);
            if (g) g.innerHTML = ts.length ? ts.map(({ t, n }) => taxonButton(t, n)).join('') : '<p class="muted">No endemic animals listed here on iNaturalist yet.</p>';
          },
        };
      }
      if (d.kind === 'place') {
        const sp = ws.sp?.places ? ws.sp : null;
        if (!sp) return { title: d.name, sub: d.country, html: '' };
        return {
          title: d.name, sub: `${sp.t.common || sp.t.name} · ${d.country ? `${d.country} · ` : ''}#${d.rank} of ${sp.places.length}`, probe: [d.lat, d.lng],
          html: `<div id="wl-place-photo">${photoHtml(d.photos[0], sp.t.common || sp.t.name)}</div>${placeBody(d, sp)}`,
          links: [
            { label: 'GBIF', url: `https://www.gbif.org/occurrence/search?taxon_key=${sp.key}&${d.level === 'country' ? `country=${enc(d.gid)}` : `gadm_gid=${enc(d.gid)}`}&basis_of_record=HUMAN_OBSERVATION` },
            sp.t.id ? { label: 'iNaturalist', url: `https://www.inaturalist.org/observations?taxon_id=${sp.t.id}&lat=${d.lat.toFixed(3)}&lng=${d.lng.toFixed(3)}&radius=150` } : null,
          ].filter(Boolean),
        };
      }
      // the animal's own page
      const t = d.t;
      return {
        title: t.common ? t.common.replace(/^./, (c) => c.toUpperCase()) : t.name, sub: t.name,
        html: `<div id="wl-hero">${photoHtml(t.photo, t.common || t.name)}</div><div id="wl-gallery" class="wl-gallery" role="group" aria-label="Photos"></div><div id="wl-iucn"></div><div id="wl-about"></div><div id="wl-sp-body">${d.places ? speciesBody(d) : '<div class="lm-facts"><div class="lm-fact skel"></div><div class="lm-fact skel"></div><div class="lm-fact skel"></div></div><p class="muted">Counting ten years of sightings worldwide…</p>'}</div>`,
        links: [t.wiki ? { label: 'Wikipedia', url: t.wiki } : null, t.id ? { label: 'iNaturalist', url: `https://www.inaturalist.org/taxa/${t.id}` } : null].filter(Boolean),
        async fill(stillOpen) {
          if (t.id) { // v2.16: photos, a summary and the family tree, alongside the sightings
            getFeed('inaturalist', `${IN}taxa/${t.id}?locale=en`, { ttl: 7 * DAY }).then((j) => {
              if (!stillOpen()) return; const det = taxonDetail(j?.results?.[0]); if (!det) return; ws.detail = det;
              const g = H('#wl-gallery'); if (g && det.photos.length > 1) g.innerHTML = det.photos.map((ph, i) => `<button class="wl-ph" data-wl-ph="${i}" aria-pressed="${i === 0}" title="${esc(`${ph.by} · ${ph.lic}`)}" aria-label="Photo ${i + 1} of ${det.photos.length}"><img src="${esc(ph.thumb)}" alt="" loading="lazy" decoding="async" data-fallback="remove"/></button>`).join('');
              if (det.photos[0] && !t.photo) { const h = H('#wl-hero'); if (h) h.innerHTML = photoHtml(det.photos[0], t.common || t.name); }
              const a = H('#wl-about'); if (!a) return;
              a.innerHTML = `${det.lineage.length ? `<p class="wl-tree">${det.lineage.map((x) => `<span title="${esc(x.rank)}">${esc(x.common || x.name)}${x.common && x.rank === 'genus' ? ` <i>${esc(x.name)}</i>` : ''}</span>`).join('<b aria-hidden="true">›</b>')}</p>` : ''}
                ${det.summary ? `<p class="wl-sum">${esc(det.summary)}${det.summary.length >= 700 ? '…' : ''} <small>${det.wiki ? `<a href="${esc(det.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : 'Wikipedia'}, CC BY-SA</small></p>` : ''}
                ${det.obs ? `<p class="wl-obs muted">${esc(big(det.obs))} sightings on iNaturalist${det.status ? ` · ${esc(det.status.label)}${det.status.by ? ` (${esc(det.status.by)})` : ''}` : ''}</p>` : ''}`;
            }).catch(() => {});
          }
          let sp = d.places ? d : null;
          if (!sp) { try { sp = await ws.job; } catch (e) { if (stillOpen()) { const b = H('#wl-sp-body'); if (b) b.innerHTML = `<p class="err">${esc(e.help ?? 'GBIF did not answer. Try again in a moment.')}</p>`; } return; } }
          if (!stillOpen() || sp.t.name !== t.name) return;
          const b = H('#wl-sp-body'); if (b && !d.places) b.innerHTML = speciesBody(sp);
          const iu = H('#wl-iucn'); if (iu && sp.iucn) iu.innerHTML = `<p class="wl-iucn" style="--c:${IUCN_COLOR[sp.iucn.code] ?? 'var(--ink-2)'}"><b>${esc(sp.iucn.code)}</b> ${esc(sp.iucn.label)} <small>IUCN Red List</small></p>`;
          if (!t.photo) { const ph = sp.places.flatMap((p) => p.photos)[0]; const host = H('#sel-wiki'); if (ph && host) host.innerHTML = photoHtml(ph, t.common || t.name); }
        },
      };
    },
    search: (q) => runText(q),
    learn: {
      what: 'Search any animal, from a moose to a puffin, and see where on Earth you have the best chance of seeing it in the wild, with its photo, the best places ranked by chance, when to go and how recently it was seen. With no search, leaf pins mark the places richest in animals found nowhere else.',
      how: 'Sightings come from GBIF, which pools observations from iNaturalist, eBird, national wildlife surveys and others: only records of animals people saw in the last ten years count. The chance in a place is the share of all sightings of that class there (all mammals for a moose, all birds for a puffin) that are this animal, so busy places do not win just because more people look. Places with few records are pulled towards the animal’s average. Photos come from iNaturalist and GBIF records under Creative Commons licences and are credited. The hotspot list follows Myers et al. (2000); its counts of endemic species come live from iNaturalist.',
      try: 'Search “moose”, then press the best place to see the months it is seen in. Open Madagascar’s hotspot and press any lemur to see where to find it.',
      refs: ['gbif', 'inaturalist', 'myers2000'],
    },
  };
  return layer;
}
