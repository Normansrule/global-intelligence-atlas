// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the News section, modelled on World Monitor's news feeds and live news panel.
//   Headlines: the latest stories from publishers' own RSS and Atom feeds around the world (title, time, publisher,
//              link to the story on the publisher's site), filtered by region or word.
//   Live TV:   broadcasters' free official live streams: their YouTube live stream where they allow embedding, or
//              their own HLS stream where browsers may play it. Playback stops when you leave the tab.
// Both come from the news-data branch (tools/fetch-news.mjs, every 30 minutes); the lists live in newslist.js.
// Every headline and channel is labelled with who owns it (public, state or commercial), as World Monitor does.
import { getSnapshot } from './feeds.js';
import { PUBLISHERS, CHANNELS, REGIONS, OWNERS } from './newslist.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PUB = Object.fromEntries(PUBLISHERS.map((p) => [p.key, p]));
const OWN_SHORT = { public: 'Public', state: 'State', commercial: 'Commercial', intergov: 'UN' };
const REGION = Object.fromEntries(REGIONS);
const LANG = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic' };
const BRANCH = 'news-data';
const TTL = 5 * 60_000;

export function ago(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
const owner = (k) => `<span class="news-own news-own-${k}" title="${esc(OWNERS[k] ?? k)}">${esc(OWN_SHORT[k] ?? k)}</span>`;

/** The channels to offer: the latest check if there is one, otherwise the list itself (live state unknown). */
export function channelRows(snap) {
  const got = Object.fromEntries((snap?.channels ?? []).map((c) => [c.key, c]));
  return CHANNELS.map((c) => {
    const s = got[c.key];
    return { ...c, checked: s?.checked ?? null, live: s ? !!s.live : null, video: s?.video ?? null, title: s?.title ?? null, okHls: s ? s.hls ?? [] : [] };
  }).filter((c) => c.live !== false || c.yt); // offline channels without a YouTube channel have nothing to try
}

/** What the player loads for a channel: a YouTube embed or an HLS stream, or null when there is nothing to play. */
export function playable(c) {
  if (c.video) return { kind: 'yt', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(c.video)}?autoplay=1&mute=1&playsinline=1&rel=0` };
  if (c.okHls?.length) return { kind: 'hls', src: c.okHls[0] };
  if (c.yt && c.live !== false) return { kind: 'yt', src: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(c.yt)}&autoplay=1&mute=1&playsinline=1` };
  return null;
}

export function installNewsDesk(x) {
  const { shell, $ } = x;
  let tab = 'headlines';
  const filt = { region: 'all', text: '' };
  const tv = { region: 'all', playing: null };
  let hls = null;
  const root = document.querySelector('#sect-news');
  const body = () => root.querySelector('.sect-body');
  const tabs = () => `<div class="intel-tabs" role="tablist">${[['headlines', 'Headlines'], ['tv', 'Live TV']].map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-news-tab="${k}">${l}</button>`).join('')}</div>`;
  const chips = (cur, attr) => `<div class="intel-chips">${[['all', 'All'], ...REGIONS].map(([k, l]) => `<button class="intel-chip" aria-pressed="${cur === k}" data-${attr}="${k}">${esc(l)}</button>`).join('')}</div>`;

  const headlines = () => getSnapshot('newsheadlines', 'headlines.json', { branch: BRANCH, ttl: TTL });
  const channels = () => getSnapshot('newschannels', 'channels.json', { branch: BRANCH, ttl: TTL }).catch(() => null);

  function stop() {
    if (hls) { try { hls.destroy(); } catch { /* already gone */ } hls = null; }
    const p = root.querySelector('#news-player'); if (p) p.innerHTML = '';
    tv.playing = null;
  }
  async function loadHls() {
    if (!window.Hls) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/hls.light.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return window.Hls;
  }
  async function play(c) {
    stop();
    const box = root.querySelector('#news-player'); if (!box) return;
    const p = playable(c); if (!p) { box.innerHTML = '<p class="muted">This channel is not live right now.</p>'; return; }
    tv.playing = c.key;
    const cap = `<div class="news-cap"><b>${esc(c.name)}</b> ${owner(c.owner)} <small>${esc(LANG[c.lang] ?? c.lang)} · ${esc(REGION[c.region] ?? '')}${c.yt ? ` · <a href="https://www.youtube.com/channel/${esc(c.yt)}" target="_blank" rel="noopener noreferrer">Broadcaster’s channel</a>` : ''}</small></div>`;
    if (p.kind === 'yt') {
      box.innerHTML = `<div class="news-frame"><iframe src="${esc(p.src)}" title="${esc(c.name)} live" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${cap}`;
    } else {
      box.innerHTML = `<div class="news-frame"><video controls muted autoplay playsinline aria-label="${esc(c.name)} live"></video></div>${cap}`;
      const v = box.querySelector('video');
      if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = p.src;
      else {
        try {
          const H = await loadHls(); if (tv.playing !== c.key) return;
          if (!H.isSupported()) { box.insertAdjacentHTML('beforeend', '<p class="err">This browser cannot play HLS video.</p>'); return; }
          hls = new H({ lowLatencyMode: false }); hls.loadSource(p.src); hls.attachMedia(v);
          hls.on(H.Events.ERROR, (_, d) => { if (d.fatal) box.insertAdjacentHTML('beforeend', '<p class="err">The stream stopped. The broadcaster may be offline or limit where it can be watched.</p>'); });
        } catch { box.insertAdjacentHTML('beforeend', '<p class="err">Could not load the video player.</p>'); }
      }
    }
    root.querySelectorAll('[data-chan]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.chan === c.key)));
  }

  function headlineList(j) {
    const t = filt.text.toLowerCase();
    const items = (j.items ?? []).filter((i) => (filt.region === 'all' || i.r === filt.region) && (!t || i.t.toLowerCase().includes(t) || (PUB[i.p]?.name ?? '').toLowerCase().includes(t)));
    if (!items.length) return '<p class="muted">No headlines match. Try another region or clear the search.</p>';
    return `<ul class="news-list">${items.slice(0, 150).map((i) => { const p = PUB[i.p];
      return `<li><a href="${esc(i.u)}" target="_blank" rel="noopener noreferrer">${esc(i.t)}</a><small>${esc(p?.name ?? i.p)} ${owner(p?.owner)} · <time datetime="${esc(i.at)}">${esc(ago(i.at))}</time></small></li>`; }).join('')}</ul>`;
  }
  function refreshList(j) {
    const l = root.querySelector('#news-list'); if (l) l.innerHTML = headlineList(j);
  }
  let lastJ = null;

  function chanList(rows) {
    const shown = rows.filter((c) => tv.region === 'all' || c.region === tv.region);
    const on = shown.filter((c) => c.live !== false); const off = shown.filter((c) => c.live === false);
    const btn = (c) => `<button class="news-chan" data-chan="${esc(c.key)}" aria-pressed="${tv.playing === c.key}"><b>${esc(c.name)}</b><small>${owner(c.owner)} ${esc(LANG[c.lang] ?? c.lang)}${c.live ? ' · <i class="news-live">Live</i>' : ''}</small></button>`;
    return (on.length ? `<div class="news-chans">${on.map(btn).join('')}</div>` : '<p class="muted">No channel in this region was live at the last check.</p>') +
      (off.length ? `<details class="news-off"><summary>Not live at the last check (${off.length})</summary><ul>${off.map((c) => `<li>${esc(c.name)} ${owner(c.owner)} <a href="https://www.youtube.com/channel/${esc(c.yt)}/live" target="_blank" rel="noopener noreferrer">Open on YouTube</a></li>`).join('')}</ul></details>` : '');
  }

  async function render() {
    stop();
    let html = tabs();
    if (tab === 'headlines') {
      const on = x.state.on.has('news');
      html += `<p class="muted">The latest stories from news organisations around the world, from their own feeds. Each opens on the publisher’s site.</p>
        <div class="row"><button class="btn${on ? ' ghost' : ''}" data-news-layer="1">${on ? 'Hide news places on the globe' : 'Show news places on the globe'}</button><span class="muted" id="news-upd"></span></div>
        ${chips(filt.region, 'news-region')}
        <input type="search" id="news-text" class="intel-input" placeholder="Filter by word or publisher…" value="${esc(filt.text)}" aria-label="Filter headlines" autocomplete="off" />
        <div id="news-list"><p class="muted">Loading headlines…</p></div>`;
    } else {
      html += `<p class="muted">Free live news channels, played from each broadcaster’s own official stream. Sound starts muted.</p>
        <div id="news-player"></div>${chips(tv.region, 'tv-region')}<div id="news-chanlist"><p class="muted">Checking channels…</p></div>
        <p class="muted small">Labels show ownership: Public (publicly funded, independent), State (government-controlled or state-funded) or Commercial.</p>`;
    }
    shell.show('news', 'News', html, 'section:news');
    if (tab === 'headlines') {
      try {
        lastJ = await headlines(); if (tab !== 'headlines') return;
        refreshList(lastJ);
        const u = root.querySelector('#news-upd'); if (u && lastJ.updated) u.textContent = `Updated ${ago(lastJ.updated)} · ${new Set(lastJ.items.map((i) => i.p)).size} publishers`;
      } catch (e) {
        const l = root.querySelector('#news-list');
        if (l) l.innerHTML = `<p class="err">Headlines are not available yet (${esc(e.message)}). The globe’s news places layer still shows where the news is.</p>`;
      }
    } else {
      const rows = channelRows(await channels()); if (tab !== 'tv') return;
      const l = root.querySelector('#news-chanlist'); if (l) l.innerHTML = chanList(rows);
      root._rows = rows;
    }
  }
  shell.register('news', render);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-news-tab],[data-news-region],[data-tv-region],[data-chan],[data-news-layer]'); if (!t) return;
    if (t.dataset.newsTab) { tab = t.dataset.newsTab; render(); }
    else if (t.dataset.newsRegion) { filt.region = t.dataset.newsRegion; root.querySelectorAll('[data-news-region]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); if (lastJ) refreshList(lastJ); }
    else if (t.dataset.tvRegion) { tv.region = t.dataset.tvRegion; root.querySelectorAll('[data-tv-region]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); const l = root.querySelector('#news-chanlist'); if (l && root._rows) l.innerHTML = chanList(root._rows); }
    else if (t.dataset.chan) { const c = root._rows?.find((r) => r.key === t.dataset.chan); if (c) play(c); }
    else if (t.dataset.newsLayer) { x.toggleLayer('news', !x.state.on.has('news')); render(); }
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'news-text') { filt.text = e.target.value.trim(); if (lastJ) refreshList(lastJ); } });
  // stop the video when the News section is hidden or the drawer closes
  const watch = () => { if (tv.playing && (root.hidden || !document.body.classList.contains('left-open'))) stop(); };
  new MutationObserver(watch).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(watch).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { open: (t = 'headlines') => { tab = t; render(); }, stop };
}
