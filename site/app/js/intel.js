// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Intel section. Open-source intelligence (OSINT) means finding things out from
// material anyone can read. This section gathers three kinds of it:
//   Documents: once-secret government records that have been released officially, pinned where they happened
//              and laid out on a timeline, with links to the archive that holds each original.
//   Tools:     the redaction inspector (redaction.js) and photo, shadow and web-archive tools (photo-osint.js).
//   Archives:  where released records live, around the world, with a search link for each.
// Everything runs in the browser; nothing is uploaded anywhere.
import { LAYERS, GROUPS, layerById } from './layers.js';
import { getLocal } from './feeds.js';
import { glyphSvg } from './icons.js';
import { openInspector, inspectUrl } from './redaction.js';
import { openPhotoTool, openShadowTool, openWaybackTool } from './photo-osint.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SWATCH = '#e3b55b';
const Y0 = 1910; const Y1 = 2030;
const filt = { from: Y0, to: Y1, topics: null, text: '' }; // topics: null = all
let DATA = null;
const data = async () => (DATA ??= await getLocal('data/declassified.json'));
const yearOf = (d) => Number(d.date.slice(0, 4));
const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); return d === 1 && m === 1 ? String(y) : new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const searchUrl = (a, q) => a.search.replace('{q}', encodeURIComponent(q));
const iaSearch = (q) => `https://archive.org/search?query=${encodeURIComponent(q)}`;
function shown(d) {
  const y = yearOf(d);
  if (y < filt.from || y > filt.to) return false;
  if (filt.topics && !filt.topics.has(d.topic)) return false;
  if (filt.text) { const t = filt.text.toLowerCase(); if (![d.title, d.place, d.summary, d.by].some((s) => s.toLowerCase().includes(t))) return false; }
  return true;
}

// ---------------------------------------------------------------- the globe layer
export const declassLayer = {
  id: 'declass', group: 'intel', label: 'Declassified documents', swatch: SWATCH, pin: 'dossier',
  sources: ['ciafoia', 'naracatalog', 'nsarchive', 'wilsonarchive', 'tnadiscovery'],
  async load() { return data(); },
  channels(j) {
    const docs = j.docs.filter(shown);
    return {
      points: docs.map((d) => ({ lat: d.lat, lng: d.lng, alt: 0.012, r: 0.26, color: j.topics[d.topic]?.[1] ?? SWATCH, label: d.title,
        tip: `<div class="tip"><b>${esc(d.title)}</b><span>${esc(fmtDate(d.date))} · ${esc(d.place)}</span></div>`, ref: { layer: 'declass', d } })),
    };
  },
  describe(d) {
    const a = DATA.archives[d.archive];
    return {
      title: d.title, sub: `${fmtDate(d.date)} · ${d.place}`,
      html: `<p>${esc(d.summary)}</p>`,
      rows: [['Created by', d.by], ['Released to the public', String(d.released)], ['Original held by', a?.short ?? d.archive], ['Topic', DATA.topics[d.topic]?.[0] ?? d.topic]],
      links: [
        d.url && { label: 'Official record', url: d.url },
        a && { label: `Search ${a.short}`, url: searchUrl(a, d.q) },
        { label: 'Search the Internet Archive', url: iaSearch(d.q) },
      ].filter(Boolean),
      body: 'The released year is the first official public release; many records came out in stages, often with parts still blacked out. Read the original in the archive before relying on a summary.',
      probe: [d.lat, d.lng], wiki: d.wiki,
    };
  },
  learn: {
    what: 'Records that governments once classified as secret and have since released, pinned at the place they describe. Use the Intel section to filter them by year and topic, and to search the archives that hold them.',
    how: 'Most countries release classified records after a set time (25 years in the United States under Executive Order 13526, 20 years in the United Kingdom and Australia), or when someone asks under a freedom of information law. This index is curated by hand from official archives and links to each original; it holds no leaked material.',
    try: 'Open Intel, drag the timeline to 1945–1991 and pick Cold War, then turn on Conflict zones to compare where the documents cluster.',
    refs: ['ciafoia', 'naracatalog', 'nsarchive', 'wilsonarchive', 'tnadiscovery', 'eo13526'],
  },
};
LAYERS.push(declassLayer); layerById.declass = declassLayer;
GROUPS.push({ id: 'intel', label: 'Open-source intelligence' });

// ---------------------------------------------------------------- the Intel section
export function installIntel(x) {
  const { shell, $ } = x;
  let tab = 'docs';
  const body = () => document.querySelector('#sect-intel .sect-body');
  const tabs = () => `<div class="intel-tabs" role="tablist">${[['docs', 'Documents'], ['tools', 'Tools'], ['archives', 'Archives']].map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-intel-tab="${k}">${l}</button>`).join('')}</div>`;

  function timeline(j) {
    const W = 320; const H = 76; const xOf = (y) => 8 + ((y - Y0) / (Y1 - Y0)) * (W - 16);
    const rows = Object.keys(j.topics);
    const ticks = []; for (let y = 1920; y <= 2020; y += 20) ticks.push(`<line x1="${xOf(y)}" x2="${xOf(y)}" y1="6" y2="${H - 16}" class="tl-grid"/><text x="${xOf(y)}" y="${H - 4}" class="tl-year">${y}</text>`);
    const dots = j.docs.map((d) => {
      const y = Number(d.date.slice(0, 4)) + (Number(d.date.slice(5, 7)) - 1) / 12;
      return `<circle cx="${xOf(y).toFixed(1)}" cy="${(10 + rows.indexOf(d.topic) * 8).toFixed(1)}" r="3.2" fill="${j.topics[d.topic][1]}" class="${shown(d) ? '' : 'off'}" data-doc="${d.id}"><title>${esc(`${d.date.slice(0, 4)} · ${d.title}`)}</title></circle>`;
    }).join('');
    const band = `<rect x="${xOf(filt.from)}" y="4" width="${Math.max(0, xOf(filt.to) - xOf(filt.from))}" height="${H - 18}" class="tl-band"/>`;
    return `<svg class="intel-tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of documents, ${filt.from} to ${filt.to}">${band}${ticks.join('')}${dots}</svg>`;
  }
  function docList(j) {
    const docs = j.docs.filter(shown).sort((a, b) => a.date.localeCompare(b.date));
    if (!docs.length) return '<p class="muted">No documents match. Widen the years or clear the topics.</p>';
    return docs.map((d) => `<button class="tour-card intel-doc" data-doc="${d.id}"><b><i style="background:${j.topics[d.topic][1]}"></i>${esc(d.title)}</b><span>${d.date.slice(0, 4)} · ${esc(d.place)} · ${esc(j.archives[d.archive]?.short ?? '')}</span></button>`).join('');
  }
  function refreshDocs() {
    const j = DATA; if (!j || tab !== 'docs') return;
    const tl = body()?.querySelector('.intel-tl'); if (tl) tl.outerHTML = timeline(j);
    const list = body()?.querySelector('#intel-list'); if (list) list.innerHTML = docList(j);
    const n = body()?.querySelector('#intel-count'); if (n) n.textContent = `${j.docs.filter(shown).length} of ${j.docs.length}`;
    const yr = body()?.querySelector('#intel-years'); if (yr) yr.textContent = `${filt.from}–${filt.to}`;
    const on = x.state.on.has('declass'); const lb = body()?.querySelector('[data-intel-layer]');
    if (lb) { lb.className = on ? 'btn ghost' : 'btn'; lb.textContent = on ? 'Hide pins on the globe' : 'Pin them on the globe'; }
    if (x.state.on.has('declass')) x.refreshLayer('declass', { soft: true });
  }

  async function render() {
    let html = tabs();
    if (tab === 'docs') {
      const j = await data();
      const chips = Object.entries(j.topics).map(([k, [l, c]]) => `<button class="intel-chip" aria-pressed="${!filt.topics || filt.topics.has(k)}" data-topic="${k}"><i style="background:${c}"></i>${esc(l)}</button>`).join('');
      html += `<p class="muted">Records governments once kept secret and have since released. Each links to the archive that holds the original.</p>
        <div class="row"><button class="btn${x.state.on.has('declass') ? ' ghost' : ''}" data-intel-layer="1">${x.state.on.has('declass') ? 'Hide pins on the globe' : 'Pin them on the globe'}</button><span class="muted" id="intel-count"></span></div>
        <h4>Timeline <span class="muted" id="intel-years">${filt.from}–${filt.to}</span></h4>
        ${timeline(j)}
        <div class="intel-range"><label>From <input type="range" id="intel-from" min="${Y0}" max="${Y1}" step="1" value="${filt.from}" aria-label="From year"></label><label>To <input type="range" id="intel-to" min="${Y0}" max="${Y1}" step="1" value="${filt.to}" aria-label="To year"></label></div>
        <div class="intel-chips">${chips}</div>
        <input type="search" id="intel-text" class="intel-input" placeholder="Filter by word, place or agency…" value="${esc(filt.text)}" aria-label="Filter documents" autocomplete="off" />
        <div id="intel-list"></div>
        <h4>Search released documents</h4>
        <p class="muted">Searches the Internet Archive’s public texts. Results with a PDF can go straight into the redaction inspector.</p>
        <form class="intel-search" id="intel-ia"><input type="search" class="intel-input" name="q" placeholder="e.g. Venona, Berlin tunnel, U-2" aria-label="Search the Internet Archive" /><button class="btn">Search</button></form>
        <div id="intel-ia-out"></div>`;
    } else if (tab === 'tools') {
      const g = (n, c) => glyphSvg(n, c, 22);
      html += `<p class="muted">Investigation tools that run on your own computer. Files you open are read in the browser and never uploaded.</p>
        <div class="toolgrid">
          <button class="tool" data-intel-tool="redact">${g('dossier', '#e3b55b')}<b>Redaction inspector</b><small>Are the black boxes in a PDF real, or is the text still underneath?</small></button>
          <button class="tool" data-intel-tool="photo">${g('camera', '#7ed6c4')}<b>Photo location</b><small>Read where and when a photo was taken from its metadata.</small></button>
          <button class="tool" data-intel-tool="shadow">${g('sun', '#ffd37a')}<b>Shadow clock</b><small>Work out when or where a photo was taken from a shadow.</small></button>
          <button class="tool" data-intel-tool="wayback">${g('server', '#8ecbff')}<b>Web archive lookup</b><small>See old copies of a web page, even after it was changed or deleted.</small></button>
        </div>
        <h4>Good practice</h4>
        <ul class="intel-notes"><li>Check every finding against a second, independent source.</li><li>Record where and when you found each thing, so others can check it.</li><li>Respect privacy: public does not mean fair game. Do not use these tools to track or expose private people.</li></ul>`;
    } else {
      const j = await data();
      html += `<p class="muted">Where released records live. Searches open the archive’s own site in a new tab.</p>` +
        Object.values(j.archives).map((a) => `<div class="intel-arch"><b>${esc(a.name)}</b><small>${esc(a.country)}</small><p>${esc(a.holds)}</p><div class="row"><a class="btn ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost" data-fly="${a.lat},${a.lng},0.4">Show on globe</button></div></div>`).join('') +
        `<form class="intel-search" id="intel-all"><input type="search" class="intel-input" name="q" placeholder="Search every archive for…" aria-label="Search every archive" /><button class="btn">Links</button></form><div id="intel-all-out"></div>`;
    }
    shell.show('intel', 'Open-source intelligence', html, 'section:intel');
    if (tab === 'docs') refreshDocs();
  }
  shell.register('intel', render);

  async function iaResults(q, out) {
    out.innerHTML = '<p class="muted">Searching…</p>';
    const query = `(${q}) AND mediatype:texts AND (declassified OR FOIA OR "freedom of information" OR CIA OR FBI)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=creator&rows=15&output=json`;
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const docs = (await r.json()).response?.docs ?? [];
      out.innerHTML = docs.length ? docs.map((d) => `<div class="intel-arch"><b>${esc(Array.isArray(d.title) ? d.title[0] : d.title)}</b><small>${esc([d.date?.slice(0, 10), Array.isArray(d.creator) ? d.creator[0] : d.creator].filter(Boolean).join(' · '))}</small>
        <div class="row"><a class="btn ghost" href="https://archive.org/details/${encodeURIComponent(d.identifier)}" target="_blank" rel="noopener">Read</a><button class="btn ghost" data-ia-inspect="${esc(d.identifier)}">Inspect redactions</button></div></div>`).join('')
        : `<p class="muted">Nothing found. <a href="${iaSearch(q)}" target="_blank" rel="noopener">Try the full Internet Archive search</a>.</p>`;
    } catch (e) { out.innerHTML = `<p class="err">The Internet Archive did not respond (${esc(e.message)}). <a href="${iaSearch(q)}" target="_blank" rel="noopener">Search on its site instead</a>.</p>`; }
  }
  async function iaInspect(id) {
    x.toast('Finding the PDF in that item…');
    try {
      const m = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`)).json();
      const f = (m.files ?? []).filter((f) => /\.pdf$/i.test(f.name)).sort((a, b) => (a.source === 'original' ? -1 : 1) - (b.source === 'original' ? -1 : 1))[0];
      if (!f) return x.toast('That item has no PDF file.');
      inspectUrl(x, `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`, f.name);
    } catch (e) { x.toast(`Could not read that item: ${e.message}`); }
  }

  const root = document.querySelector('#sect-intel');
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-intel-tab],[data-topic],[data-doc],[data-intel-layer],[data-intel-tool],[data-ia-inspect]'); if (!t) return;
    if (t.dataset.intelTab) { tab = t.dataset.intelTab; render(); }
    else if (t.dataset.topic) {
      const all = Object.keys(DATA.topics); const k = t.dataset.topic;
      // first click on a chip shows only that topic; later clicks add or remove; none left = all
      if (!filt.topics) filt.topics = new Set([k]); else if (filt.topics.has(k)) filt.topics.delete(k); else filt.topics.add(k);
      if (!filt.topics.size || filt.topics.size === all.length) filt.topics = null;
      root.querySelectorAll('[data-topic]').forEach((b) => b.setAttribute('aria-pressed', String(!filt.topics || filt.topics.has(b.dataset.topic))));
      refreshDocs();
    } else if (t.dataset.doc) {
      const d = DATA.docs.find((v) => v.id === t.dataset.doc); if (!d) return;
      if (!x.state.on.has('declass')) { x.toggleLayer('declass', true); refreshDocs(); }
      x.fly(d.lat, d.lng, 1.2, false); x.select({ layer: 'declass', d });
    } else if (t.dataset.intelLayer) { x.toggleLayer('declass', !x.state.on.has('declass')); render(); }
    else if (t.dataset.intelTool) ({ redact: () => openInspector(x), photo: () => openPhotoTool(x), shadow: () => openShadowTool(x), wayback: () => openWaybackTool(x) })[t.dataset.intelTool]();
    else if (t.dataset.iaInspect) iaInspect(t.dataset.iaInspect);
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'intel-from' || e.target.id === 'intel-to') {
      let a = Number(root.querySelector('#intel-from').value); let b = Number(root.querySelector('#intel-to').value);
      if (a > b) { if (e.target.id === 'intel-from') b = a; else a = b; root.querySelector('#intel-from').value = a; root.querySelector('#intel-to').value = b; }
      filt.from = a; filt.to = b; refreshDocs();
    } else if (e.target.id === 'intel-text') { filt.text = e.target.value.trim(); refreshDocs(); }
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault(); const q = new FormData(e.target).get('q')?.trim(); if (!q) return;
    if (e.target.id === 'intel-ia') iaResults(q, $('#intel-ia-out'));
    if (e.target.id === 'intel-all') $('#intel-all-out').innerHTML = `<ul class="intel-links">${Object.values(DATA.archives).map((a) => `<li><a href="${esc(searchUrl(a, q))}" target="_blank" rel="noopener">${esc(a.short)}</a></li>`).join('')}</ul>`;
  });
  return { open: () => { tab = 'docs'; render(); }, tool: (k) => root.querySelector(`[data-intel-tool="${k}"]`)?.click() };
}
