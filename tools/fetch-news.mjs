#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the "news-data" branch behind the News tab (site/app/js/newsdesk.js). Every 30 minutes
// (.github/workflows/news.yml) it reads each publisher's own RSS or Atom feed and checks each broadcaster's live
// stream, using the lists in site/app/js/newslist.js.
//
//   headlines.json  { updated, items: [{ t: title, u: link, at: ISO time, p: publisher key, r: region, f: feed id }] }
//                   Only the title, link and time are kept, from the last 48 hours, at most 25 per feed.
//   channels.json   { updated, channels: [{ key, name, owner, region, lang, yt, video, live, title, hls, checked }] }
//                   live: true, false, or null when YouTube would not show the runner the channel page.
//                   video: the broadcaster's current YouTube live video when it is live and embedding is allowed;
//                   hls: the broadcaster's own HLS streams that answered with a playlist and open Cross-Origin
//                   Resource Sharing (CORS) for the site's origin, on the playlist and on its first rendition.
//   status.json     one row per feed and channel: ok and a note.
// A feed that fails keeps its previous headlines; a channel that cannot be checked keeps its previous result.
//
// Usage: node tools/fetch-news.mjs <outDir> [headlines,channels]
// The parsers are exported for tests/news/test-news.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLISHERS, CHANNELS } from '../site/app/js/newslist.js';

const MAIN = !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
const OUT = MAIN ? (process.argv[2] ?? 'news') : 'news';
const ONLY = new Set(((MAIN && process.argv[3]) || 'headlines,channels').split(','));
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.12 (+https://github.com/Normansrule/global-intelligence-atlas; news headlines reader)' };
/** The site's real origin, sent so the CORS check answers for the page that will play the stream. */
const ORIGIN = 'https://normansrule.github.io';
const MAX_AGE = 48 * 3600e3;
const PER_FEED = 25;
const log = (...a) => console.log('[news]', ...a);

// ---------- feed parsing ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/<\/?[a-z][^>]*>/gi, '') // markup that was escaped inside the title (Atom type="html")
  .replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : null; };
const safeUrl = (u) => { try { const x = new URL(decode(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

/** RSS 2.0 items or Atom entries -> [{ t, u, at }], newest first, only the last 48 hours, at most `max`. */
export function parseFeed(xml, now = Date.now(), max = PER_FEED) {
  const out = [];
  const blocks = [...String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  for (const [, kind, b] of blocks) {
    const t = decode(tag(b, 'title'));
    let u = null;
    if (kind.toLowerCase() === 'entry') {
      const links = [...b.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
      const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a)) ?? links[0];
      u = pick ? safeUrl(pick.match(/href=["']([^"']+)["']/i)?.[1]) : null;
    } else u = safeUrl(tag(b, 'link') ?? tag(b, 'guid'));
    const when = Date.parse(decode(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date') ?? ''));
    if (!t || !u || !Number.isFinite(when)) continue;
    if (now - when > MAX_AGE || when - now > 3600e3) continue;
    out.push({ t: t.slice(0, 300), u, at: new Date(when).toISOString() });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** Merge fresh items per feed with the previous file's items for feeds that failed; drop duplicate links. */
export function mergeHeadlines(fresh, prevItems, failed, now = Date.now()) {
  const keep = (prevItems ?? []).filter((i) => failed.has(i.f) && now - Date.parse(i.at) <= MAX_AGE);
  const seen = new Set(); const items = [];
  for (const i of [...fresh, ...keep].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = i.u.replace(/[?#].*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); items.push(i);
  }
  return items;
}

// ---------- live channel checks ----------
/** Read a YouTube watch or channel /live page: the live video id, whether it is live now and may be embedded. */
export function parseYouTubePage(html) {
  const s = String(html);
  const video = s.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
    ?? s.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1] ?? null;
  const channel = s.match(/"videoDetails":\{[^}]*?"channelId":"(UC[\w-]{22})"/)?.[1] ?? s.match(/<meta itemprop="channelId" content="(UC[\w-]{22})"/)?.[1] ?? null;
  const live = /"isLiveNow":true/.test(s) || /"videoDetails":\{[^}]*?"isLive":true/.test(s);
  const embeddable = /"playableInEmbed":true/.test(s);
  const title = decode(s.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? '') || null;
  // a page we could not read (a consent or bot check) says nothing about whether the channel is live
  const unreadable = !/ytInitial(PlayerResponse|Data)/.test(s) || /consent\.youtube\.com|confirm you(?:’|')re not a bot|"status":"LOGIN_REQUIRED"/i.test(s);
  return { video, channel, live, embeddable, title, unreadable };
}

async function get(url, headers = {}, timeout = 30_000, tries = 2) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      return { status: r.status, headers: r.headers, text: await r.text(), url: r.url };
    } catch (e) { if (i >= tries) throw e; }
  }
}

async function checkYouTube(c) {
  const tries = [];
  if (c.yt) tries.push(`https://www.youtube.com/channel/${c.yt}/live`);
  if (c.video) tries.push(`https://www.youtube.com/watch?v=${c.video}`);
  const notes = []; let unread = false;
  for (const url of tries) {
    try {
      const r = await get(url, { 'Accept-Language': 'en' });
      if (r.status !== 200) { notes.push(`HTTP ${r.status}`); continue; }
      const p = parseYouTubePage(r.text);
      if (p.unreadable) { unread = true; notes.push(`page could not be read (${r.text.length} bytes${/not a bot/i.test(r.text) ? ', bot check' : /consent/i.test(r.text) ? ', consent page' : ''})`); continue; }
      if (!p.video) { notes.push('not live now (no live video on the channel)'); continue; }
      if (c.yt && p.channel && p.channel !== c.yt) { notes.push(`video belongs to another channel (${p.channel})`); continue; }
      if (!p.live) { notes.push(`${p.video} is not live now`); continue; }
      if (!p.embeddable) {
        const o = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${p.video}`)}`);
        if (o.status !== 200) { notes.push(`${p.video}: the broadcaster does not allow embedding`); continue; }
      }
      return { ok: true, video: p.video, title: p.title, note: `live on YouTube (${p.video})` };
    } catch (e) { notes.push(e.name === 'TimeoutError' ? 'timed out' : e.message); }
  }
  return { ok: false, unknown: unread, note: notes.join('; ') || 'no YouTube channel' };
}

const corsOk = (h) => { const a = h.get('access-control-allow-origin'); return a === '*' || a === ORIGIN; };
/** An HLS stream plays in the page only if the playlist and its renditions answer with open CORS. */
export async function checkHls(url, fetcher = get) {
  const r = await fetcher(url, { Origin: ORIGIN });
  if (r.status !== 200) return { ok: false, note: `HTTP ${r.status}` };
  if (!r.text.trimStart().startsWith('#EXTM3U')) return { ok: false, note: 'not an HLS playlist' };
  if (!corsOk(r.headers)) return { ok: false, note: 'no CORS header for the site, so browsers cannot play it' };
  const child = r.text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (child) {
    const c = await fetcher(new URL(child, r.url || url).href, { Origin: ORIGIN });
    if (c.status !== 200) return { ok: false, note: `rendition HTTP ${c.status}` };
    if (!corsOk(c.headers)) return { ok: false, note: 'rendition has no CORS header' };
  }
  return { ok: true, note: 'HLS playlist with open CORS' };
}

// ---------- run ----------
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const write = (name, obj) => { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), JSON.stringify(obj)); };

async function headlines(status) {
  const prev = readJson(join(OUT, 'headlines.json'), { items: [] });
  const fresh = []; const failed = new Set();
  const jobs = PUBLISHERS.flatMap((p) => p.feeds.map(([region, url], i) => ({ p, region, url, f: `${p.key}:${i}` })));
  await Promise.all(jobs.map(async ({ p, region, url, f }) => {
    try {
      const r = await get(url, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const items = parseFeed(r.text);
      if (!items.length) throw new Error('no stories from the last 48 hours');
      for (const i of items) fresh.push({ ...i, p: p.key, r: region, f });
      status[`feed ${f} ${p.name}`] = { ok: true, note: `${items.length} stories` };
    } catch (e) {
      failed.add(f);
      status[`feed ${f} ${p.name}`] = { ok: false, note: `${e.name === 'TimeoutError' ? 'timed out' : e.message} (${new URL(url).host})` };
    }
  }));
  const items = mergeHeadlines(fresh, prev.items, failed);
  if (items.length < 20) { log(`only ${items.length} headlines; keeping the previous file`); return; }
  write('headlines.json', { updated: new Date().toISOString(), items });
  log(`${items.length} headlines from ${jobs.length - failed.size}/${jobs.length} feeds`);
}

async function channels(status) {
  const prev = Object.fromEntries((readJson(join(OUT, 'channels.json'), { channels: [] }).channels ?? []).map((c) => [c.key, c]));
  const out = await Promise.all(CHANNELS.map(async (c) => {
    const row = { key: c.key, name: c.name, owner: c.owner, region: c.region, lang: c.lang, yt: c.yt ?? null, video: null, live: false, title: null, hls: [], checked: new Date().toISOString() };
    const notes = []; let reached = false;
    if (c.yt || c.video) {
      const y = await checkYouTube(c);
      if (y.ok) { row.video = y.video; row.title = y.title; row.live = true; }
      // YouTube would not show the page to the runner: leave it to the broadcaster's channel embed in the browser
      else if (y.unknown && c.yt) row.ytUnknown = true;
      reached ||= y.ok || !/timed out|fetch failed/.test(y.note);
      notes.push(`YouTube: ${y.note}`);
    }
    for (const u of c.hls ?? []) {
      try { const h = await checkHls(u); reached = true; if (h.ok) { row.hls.push(u); row.live = true; } notes.push(`HLS ${new URL(u).host}: ${h.note}`); }
      catch (e) { notes.push(`HLS ${new URL(u).host}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`); }
    }
    if (!row.live && row.ytUnknown) row.live = null;
    status[`channel ${c.key} ${c.name}`] = { ok: row.live !== false, note: notes.join(' | ') + (row.live === null ? ' (offered through the channel’s live embed, not verified)' : '') };
    // nothing answered at all (a network fault on the runner): keep what the last run found
    return !reached && prev[c.key] ? prev[c.key] : row;
  }));
  write('channels.json', { updated: new Date().toISOString(), channels: out });
  log(`${out.filter((c) => c.live).length}/${out.length} channels verified live, ${out.filter((c) => c.live === null).length} left to the YouTube channel embed`);
}

if (MAIN) {
  const status = {};
  if (ONLY.has('headlines')) await headlines(status);
  if (ONLY.has('channels')) await channels(status);
  const old = readJson(join(OUT, 'status.json'), { feeds: {} }).feeds ?? {};
  write('status.json', { updated: new Date().toISOString(), feeds: { ...old, ...status } });
  for (const [k, v] of Object.entries(status)) log(v.ok ? 'ok  ' : 'FAIL', k, '—', v.note);
  if (!existsSync(join(OUT, 'headlines.json'))) process.exitCode = 1;
}
