#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// v2.12 News: the offline parts of tools/fetch-news.mjs and site/app/js/newsdesk.js, with made-up feeds and pages.
import { parseFeed, mergeHeadlines, parseYouTubePage, checkHls, decode } from '../../tools/fetch-news.mjs';
import { PUBLISHERS, CHANNELS, REGIONS, OWNERS } from '../../site/app/js/newslist.js';
import { SOURCES } from '../../site/app/js/sources.js';

let pass = 0; let fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : info); };
const NOW = Date.parse('2026-10-18T12:00:00Z');
const h = (n) => new Date(NOW - n * 3600e3).toUTCString();

const rss = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Storm hits <b>coast</b> &amp; towns]]></title><link>https://example.org/a?utm=1</link><pubDate>${h(1)}</pubDate><description>long text</description></item>
<item><title>Old story</title><link>https://example.org/old</link><pubDate>${h(60)}</pubDate></item>
<item><title>No link</title><pubDate>${h(2)}</pubDate></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link><pubDate>${h(2)}</pubDate></item>
<item><title>Talks &#8216;resume&#8217;</title><link>https://example.org/b</link><pubDate>${h(3)}</pubDate></item>
</channel></rss>`;
const items = parseFeed(rss, NOW);
check('RSS: keeps stories from the last 48 hours with a title, link and time', items.length === 2, items);
check('RSS: CDATA, tags and entities are cleaned', items[0].t === 'Storm hits coast & towns' && items[1].t === 'Talks ‘resume’', items.map((i) => i.t));
check('RSS: newest first', items[0].u === 'https://example.org/a?utm=1');
check('RSS: only http(s) links', !items.some((i) => i.u.startsWith('javascript')));

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom &lt;one&gt;</title><link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/c"/><updated>${new Date(NOW - 3600e3).toISOString()}</updated></entry></feed>`;
const a = parseFeed(atom, NOW);
check('Atom: reads the alternate link and updated time', a.length === 1 && a[0].u === 'https://example.org/c' && a[0].t === 'Atom', a);
const many = `<rss><channel>${Array.from({ length: 40 }, (_, i) => `<item><title>S${i}</title><link>https://e.org/${i}</link><pubDate>${h(i / 10)}</pubDate></item>`).join('')}</channel></rss>`;
check('at most 25 stories per feed', parseFeed(many, NOW).length === 25);
check('decode handles numeric and named entities', decode('A&#x2014;B &hellip; &#169;') === 'A—B … ©');

const fresh = [{ t: 'x', u: 'https://e.org/1?a', at: new Date(NOW - 1e5).toISOString(), f: 'a:0' }];
const prev = [{ t: 'y', u: 'https://e.org/2', at: new Date(NOW - 2e5).toISOString(), f: 'b:0' }, { t: 'z', u: 'https://e.org/3', at: new Date(NOW - 3e5).toISOString(), f: 'a:0' }, { t: 'dup', u: 'https://e.org/1', at: new Date(NOW - 4e5).toISOString(), f: 'b:0' }];
const m = mergeHeadlines(fresh, prev, new Set(['b:0']), NOW);
check('a failed feed keeps its previous stories; a working one is replaced', m.some((i) => i.t === 'y') && !m.some((i) => i.t === 'z'), m);
check('the same story is listed once', m.filter((i) => i.u.startsWith('https://e.org/1')).length === 1, m);

const live = `<html><link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345"><meta name="title" content="Live news &amp; more"><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abcDEF12345","channelId":"UCknLrEdhRCp1aegoMqRaCZg","isLive":true},"playabilityStatus":{"playableInEmbed":true}};</script></html>`;
const p = parseYouTubePage(live);
check('YouTube: reads the live video, its channel and that it may be embedded', p.video === 'abcDEF12345' && p.channel === 'UCknLrEdhRCp1aegoMqRaCZg' && p.live && p.embeddable && !p.unreadable && p.title === 'Live news & more', p);
const off = parseYouTubePage('<html><link rel="canonical" href="https://www.youtube.com/channel/UCknLrEdhRCp1aegoMqRaCZg"><script>var ytInitialData = {"channelMetadataRenderer":{}};</script></html>');
check('YouTube: a channel that is not live has no video', !off.video && !off.live && !off.unreadable, off);
const bot = parseYouTubePage('<html>Sign in to confirm you’re not a bot</html>');
check('YouTube: a bot check is unreadable, not offline', bot.unreadable, bot);

const hdr = (o) => new Headers(o);
const fake = (map) => async (u) => map[u] ?? { status: 404, headers: hdr({}), text: '' };
const M = 'https://tv.example/master.m3u8';
check('HLS: playlist and rendition with open CORS play', (await checkHls(M, fake({ [M]: { status: 200, url: M, headers: hdr({ 'access-control-allow-origin': '*' }), text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n' }, 'https://tv.example/low/index.m3u8': { status: 200, headers: hdr({ 'access-control-allow-origin': 'https://normansrule.github.io' }), text: '#EXTM3U' } }))).ok);
check('HLS: no CORS header is refused', !(await checkHls(M, fake({ [M]: { status: 200, url: M, headers: hdr({}), text: '#EXTM3U\nx.ts' } }))).ok);
check('HLS: a page that is not a playlist is refused', !(await checkHls(M, fake({ [M]: { status: 200, url: M, headers: hdr({ 'access-control-allow-origin': '*' }), text: '<html>' } }))).ok);
check('HLS: a rendition without CORS is refused', !(await checkHls(M, fake({ [M]: { status: 200, url: M, headers: hdr({ 'access-control-allow-origin': '*' }), text: '#EXTM3U\nlow.m3u8' }, 'https://tv.example/low.m3u8': { status: 200, headers: hdr({}), text: '#EXTM3U' } }))).ok);

// the lists
const regions = new Set(REGIONS.map((r) => r[0]));
check('every publisher feed has a known region and an https URL', PUBLISHERS.every((p) => p.feeds.length && p.feeds.every(([r, u]) => regions.has(r) && u.startsWith('https://'))));
check('every publisher and channel has an ownership label', [...PUBLISHERS, ...CHANNELS].every((x) => OWNERS[x.owner]));
check('every region has headlines and a live channel', [...regions].filter((r) => r !== 'world').every((r) => PUBLISHERS.some((p) => p.feeds.some(([fr]) => fr === r)) && CHANNELS.some((c) => c.region === r)));
check('every channel has an official YouTube channel or its own HLS stream', CHANNELS.every((c) => /^UC[\w-]{22}$/.test(c.yt ?? '') || c.video || (c.hls ?? []).length));
check('no relay or FAST-platform streams, and no sanctioned channels', !CHANNELS.some((c) => (c.hls ?? []).some((u) => /amagi|antik\.sk|rttv|presstv|livetvstream/.test(u)) || /^rt(-|$)|press-?tv/i.test(c.key)));
check('every publisher and channel is credited in sources.js', [...PUBLISHERS.map((p) => `news_${p.key}`), ...CHANNELS.map((c) => `tv_${c.key}`), 'newsdata'].every((k) => SOURCES[k]?.name && SOURCES[k]?.url));
check('keys are unique', new Set(PUBLISHERS.map((p) => p.key)).size === PUBLISHERS.length && new Set(CHANNELS.map((c) => c.key)).size === CHANNELS.length);
console.log(`SUMMARY ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
