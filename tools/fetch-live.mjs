#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the "live-data" snapshot.
//
// Several of the best live feeds cannot be read straight from a web page because they don't send
// Cross-Origin Resource Sharing (CORS) headers. Flight trackers are the main example.
// This script runs on GitHub Actions every ~10 minutes (.github/workflows/live.yml). It fetches those
// feeds server-side and writes small JSON files that the workflow force-pushes to an orphan branch
// called `live-data`. raw.githubusercontent.com serves that branch with CORS headers, so the site reads
// it from any browser. The desktop app and the optional proxy fetch live instead.
//
// Usage: node tools/fetch-live.mjs <outDir>
// Optional env: OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET (free OpenSky API client, better quota)
//               FIRMS_MAP_KEY (free NASA FIRMS map key; without it the public 24-hour fire files are used)
//               AIRCRAFT_DB_DIR (default ./adb: a checkout of the `aircraft-db` branch, see build-aircraft-db.mjs)
//               AISSTREAM_KEY (free AISStream key, https://aisstream.io): ships worldwide. AIS_SECONDS (default 60)
//               is how long each round listens (LIVE_ONLY=ships runs just that feed); vessels stay in ships.json for 30 minutes after their last report.
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AIS_URL, SHIP_FIELDS, STATIC_FIELDS, aisSubscription, createAisStore, parseFrame } from '../site/app/js/ais.js';

const OUT = process.argv[2] ?? 'live';
mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/1.7 (+https://github.com/Normansrule/global-intelligence-atlas; educational globe)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[live]', ...a);
const status = { generatedAt: new Date().toISOString(), run: process.env.GITHUB_RUN_ID ?? null, feeds: {} };

async function get(url, { type = 'json', timeout = 45_000, headers = {} } = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return type === 'text' ? r.text() : r.json();
}
const write = (name, obj) => { const s = typeof obj === 'string' ? obj : JSON.stringify(obj); writeFileSync(join(OUT, name), s); return s.length; };
const ageMin = (name) => {
  const p = join(OUT, name); if (!existsSync(p)) return Infinity;
  try { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.generatedAt) return (Date.now() - Date.parse(j.generatedAt)) / 60_000; } catch { /* text file */ }
  return (Date.now() - statSync(p).mtimeMs) / 60_000;
};

// ------------------------------------------------------------------ flights
// Compact rows: [icao24, callsign, lat, lng, altFt, onGround(0|1), knots, track°, vertical ft/min, squawk, type, registration, category]
// category uses OpenSky's numbers: 2 light, 3 small, 4 large, 5 high-vortex large (B757), 6 heavy, 7 high performance,
// 8 rotorcraft, 9 glider, 10 balloon, 12 ultralight, 14 drone (0/1 = not broadcast). The site picks a 3D model from it.
const FIELDS = ['id', 'call', 'lat', 'lng', 'altFt', 'ground', 'kt', 'trk', 'vs', 'squawk', 'type', 'reg', 'cat'];
const ADSB_CAT = { A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8, B1: 9, B2: 10, B3: 11, B4: 12, B6: 14, B7: 15 };
const r1 = (x, d = 0) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

async function openskyToken() {
  const id = process.env.OPENSKY_CLIENT_ID; const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const r = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }), signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`OpenSky token HTTP ${r.status}`);
  return (await r.json()).access_token;
}
async function fromOpenSky() {
  let token = null; let why = process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET ? '' : ', no API client keys set';
  try { token = await openskyToken(); } catch (e) { why = `, API client login failed: ${e.message}`; log('OpenSky login failed, trying anonymous:', e.message); }
  const j = await get('https://opensky-network.org/api/states/all?extended=1', { timeout: 60_000, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const rows = (j.states ?? []).filter((s) => s[5] != null && s[6] != null).map((s) => [
    s[0], (s[1] ?? '').trim(), r1(s[6], 3), r1(s[5], 3), r1((s[13] ?? s[7] ?? 0) * 3.281), s[8] ? 1 : 0,
    s[9] != null ? r1(s[9] * 1.944) : null, r1(s[10] ?? 0), s[11] != null ? r1(s[11] * 196.85) : null, s[14] ?? null, null, null, s[17] > 1 ? s[17] : null,
  ]);
  return { src: `OpenSky Network (worldwide${token ? ', API client' : `, anonymous${why}`})`, at: (j.time ?? Date.now() / 1000) * 1000, rows };
}
// Regional fallback: community ADS-B exchanges only answer "within N nautical miles of a point", so we
// sweep the busiest airspace (1 request a second to respect their limits) and merge by ICAO address.
const HUBS = [
  [40.6, -74], [42, -87.9], [33.9, -84.4], [32.9, -97], [39.8, -104.7], [34, -118.4], [37.6, -122.4], [47.5, -122.3], [25.8, -80.3], [29.9, -95.3],
  [38.9, -77], [44.9, -93.2], [36.1, -115.2], [33.4, -112], [43.7, -79.6], [49.2, -123.2], [45.5, -73.7], [19.4, -99.1], [21.3, -157.9], [61.2, -150],
  [51.5, -0.4], [49, 2.5], [50, 8.6], [52.3, 4.8], [48.4, 11.8], [41.3, 2.1], [40.5, -3.6], [41.8, 12.3], [47.5, 19.3], [55.6, 12.6], [59.7, 17.9], [52.2, 21],
  [41.3, 28.8], [55.9, 37.4], [25.3, 55.4], [25.3, 51.6], [24.9, 46.7], [30.1, 31.4], [28.6, 77.1], [19.1, 72.9], [13.2, 77.7], [1.36, 103.99], [13.7, 100.7],
  [22.3, 113.9], [31.1, 121.8], [40.1, 116.6], [37.5, 126.4], [35.6, 139.8], [34.4, 135.2], [-33.9, 151.2], [-37.7, 144.8], [-27.4, 153.1], [-31.9, 116],
  [-36.9, 174.8], [-23.4, -46.5], [-34.8, -58.5], [4.7, -74.1], [-12, -77.1], [-33.4, -70.8], [-26.1, 28.2], [-1.3, 36.9], [6.6, 3.3], [9.0, 38.8], [36.7, 3.2],
  [64, -22.6], [53.4, -6.2], [60.2, 11.1], [38.8, -9.1], [37.9, 23.9], [45.4, -75.7], [39.2, -76.7], [35.2, -80.9], [30.2, -97.7], [39.3, -94.7], [40.8, -111.9],
];
function rowFromAdsb(a) {
  return [a.hex, (a.flight ?? '').trim(), r1(a.lat, 3), r1(a.lon, 3), typeof a.alt_baro === 'number' ? a.alt_baro : 0, a.alt_baro === 'ground' ? 1 : 0,
    r1(a.gs), r1(a.track ?? a.true_heading ?? 0), a.baro_rate ?? null, a.squawk ?? null, a.t ?? null, a.r ?? null, ADSB_CAT[a.category] ?? null];
}
async function fromExchanges() {
  const APIS = [
    ['airplanes.live', (la, lo) => `https://api.airplanes.live/v2/point/${la}/${lo}/250`],
    ['adsb.lol', (la, lo) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/250`],
    ['adsb.fi', (la, lo) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/250`],
  ];
  for (const [name, url] of APIS) {
    const seen = new Map(); let ok = 0; let fail = 0;
    for (const [la, lo] of HUBS) {
      try { const j = await get(url(la, lo), { timeout: 20_000 }); ok += 1; for (const a of j.ac ?? []) if (a.lat != null && a.lon != null) seen.set(a.hex, rowFromAdsb(a)); } catch (e) { fail += 1; if (fail === 1) log(name, e.message); }
      if (fail >= 4 && ok === 0) break; // this exchange is refusing us; try the next one
      await sleep(1100);
    }
    if (seen.size > 500) return { src: `${name} (${ok} regions around major airports)`, at: Date.now(), rows: [...seen.values()] };
    log(`${name}: only ${seen.size} aircraft (${ok} ok, ${fail} failed)`);
  }
  throw new Error('no flight source answered');
}
// Aircraft type table (ICAO 24-bit address → [type, registration, ICAO class]) from the weekly `aircraft-db` job.
// OpenSky sends no type, so without it the app could only guess each plane's shape.
function typeTable() {
  const dir = join(process.env.AIRCRAFT_DB_DIR ?? 'adb', 'types');
  if (!existsSync(dir)) return null;
  const t = new Map();
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(dir, f), 'utf8')))) t.set(k, v);
  return t;
}
async function flights() {
  let res = null;
  try { res = await fromOpenSky(); if (res.rows.length < 1000) throw new Error(`only ${res.rows.length} aircraft`); } catch (e) { log('OpenSky:', e.message); res = null; }
  if (!res) res = await fromExchanges();
  const types = typeTable(); let typed = 0;
  if (types) for (const r of res.rows) { const t = types.get(r[0]); if (t) { if (!r[10]) r[10] = t[0]; if (!r[11] && t[1]) r[11] = t[1]; } if (r[10]) typed += 1; }
  const n = write('flights.json', { generatedAt: new Date(res.at).toISOString(), src: res.src, fields: FIELDS, ac: res.rows, typed });
  return { note: `${res.rows.length} aircraft from ${res.src}, ${typed} with a known type${types ? '' : ' (no aircraft-db table yet)'}, ${(n / 1024).toFixed(0)} KB`, count: res.rows.length };
}

// ------------------------------------------------------------------ slower feeds (only refreshed when stale)
// ------------------------------------------------------------------ fire hotspots (NASA FIRMS)
// VIIRS on NOAA-20 sees active fires at 375 m. With a free FIRMS map key the area API is used; without one, the
// public 24-hour global file. Compact rows: [lat, lng, fire radiative power MW, confidence 0 low|1 nominal|2 high,
// minutes since 1970 (UTC), 1 = day | 0 = night]. Refreshed every 30 minutes (FIRMS updates every few hours).
const FIRE_FIELDS = ['lat', 'lng', 'frp', 'conf', 't', 'day'];
function parseFirms(csv) {
  const [head, ...lines] = csv.trim().split('\n'); const h = head.split(',').map((x) => x.trim()); const c = Object.fromEntries(h.map((x, i) => [x, i]));
  if (c.latitude == null || c.longitude == null) throw new Error(`unexpected FIRMS columns: ${head.slice(0, 120)}`);
  const conf = (v) => { const s = String(v).trim().toLowerCase(); if (/^\d+$/.test(s)) return Number(s) >= 80 ? 2 : Number(s) >= 30 ? 1 : 0; return s[0] === 'h' ? 2 : s[0] === 'l' ? 0 : 1; };
  const rows = [];
  for (const l of lines) {
    const f = l.split(','); const lat = Number(f[c.latitude]); const lng = Number(f[c.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const t = String(f[c.acq_time] ?? '0').padStart(4, '0'); const at = Date.parse(`${f[c.acq_date]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
    rows.push([r1(lat, 3), r1(lng, 3), r1(Number(f[c.frp]) || 0, 1), conf(f[c.confidence]), Number.isFinite(at) ? Math.round(at / 60_000) : null, f[c.daynight] === 'N' ? 0 : 1]);
  }
  return rows;
}
async function fires() {
  if (ageMin('fires.json') < 30) return 'fresh enough';
  const key = process.env.FIRMS_MAP_KEY;
  const tries = [
    ...(key ? [['VIIRS NOAA-20 (FIRMS area API)', `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/world/1`], ['VIIRS Suomi NPP (FIRMS area API)', `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/world/1`]] : []),
    ['VIIRS NOAA-20, global 24 hours', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv'],
    ['VIIRS Suomi NPP, global 24 hours', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv'],
    ['MODIS Terra and Aqua, global 24 hours', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv'],
  ];
  let lastErr = null;
  for (const [src, url] of tries) {
    try {
      const rows = parseFirms(await get(url, { type: 'text', timeout: 120_000 }));
      if (rows.length < 100) throw new Error(`only ${rows.length} hotspots`);
      const n = write('fires.json', { generatedAt: new Date().toISOString(), src: `NASA FIRMS · ${src}`, fields: FIRE_FIELDS, rows });
      return { note: `${rows.length} hotspots from ${src}, ${(n / 1024).toFixed(0)} KB`, count: rows.length };
    } catch (e) { lastErr = e; log('FIRMS', src, e.message); }
  }
  throw lastErr ?? new Error('no FIRMS file answered');
}

// Ships worldwide from AISStream. The stream is listened to for AIS_SECONDS each round and merged with the previous
// snapshot, so ships.json holds every vessel heard in the last 30 minutes. ships-static.json (names, call signs,
// destinations, sizes) is kept for a day. The `ws` package is used when installed (it compresses the stream, which
// AISStream asks for); otherwise Node's own WebSocket.
async function openSocket(url) {
  try { const { WebSocket: WS } = await import('ws'); return new WS(url, { perMessageDeflate: true }); } catch { return new WebSocket(url); }
}
async function listenAis(key, seconds, store, boxes) {
  const ws = await openSocket(process.env.AIS_URL ?? AIS_URL); ws.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    let err = null;
    const stop = setTimeout(() => ws.close(), seconds * 1000);
    ws.onopen = () => ws.send(aisSubscription(key, boxes));
    ws.onmessage = (e) => { const m = parseFrame(e.data); if (m?.error) { err = new Error(`AISStream: ${m.error}`); ws.close(); } else store.add(m); };
    ws.onerror = (e) => { err ??= new Error(`AISStream connection failed${e?.message ? `: ${e.message}` : ''}`); };
    ws.onclose = () => { clearTimeout(stop); if (err && !store.messages) reject(err); else resolve(store.messages); };
  });
}
async function ships() {
  const key = process.env.AISSTREAM_KEY;
  if (!key) return { note: 'skipped: add the free AISSTREAM_KEY secret for ships worldwide (the app uses the Finnish Baltic feed meanwhile)', count: 0 };
  const store = createAisStore();
  try { store.load(JSON.parse(readFileSync(join(OUT, 'ships.json'), 'utf8')).rows, JSON.parse(readFileSync(join(OUT, 'ships-static.json'), 'utf8')).rows); } catch { /* first run */ }
  const before = store.messages; const seconds = Number(process.env.AIS_SECONDS ?? 60);
  await listenAis(key, seconds, store);
  const heard = store.messages - before;
  if (!heard) throw new Error('AISStream sent nothing (check the AISSTREAM_KEY secret)');
  store.prune(30);
  const rows = store.rows(); const statics = store.statics(); const at = new Date().toISOString();
  const n = write('ships.json', { generatedAt: at, src: 'AISStream', fields: SHIP_FIELDS, rows });
  write('ships-static.json', { generatedAt: at, src: 'AISStream', fields: STATIC_FIELDS, rows: statics });
  return { note: `${rows.length} vessels (${heard} reports in ${seconds} s), ${(n / 1024).toFixed(0)} KB`, count: rows.length };
}

async function launches() {
  if (ageMin('launches-upcoming.json') < 55) return 'fresh enough';
  for (const which of ['upcoming', 'previous']) {
    const j = await get(`https://ll.thespacedevs.com/2.2.0/launch/${which}/?limit=25&mode=detailed`);
    write(`launches-${which}.json`, { ...j, generatedAt: new Date().toISOString() });
    await sleep(3000);
  }
  return 'upcoming + previous';
}
async function gdacs() {
  const j = await get('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Green;Orange;Red');
  write('gdacs.json', { ...j, generatedAt: new Date().toISOString() });
  return `${j.features?.length ?? 0} events`;
}
async function tles() {
  // CelesTrak asks that a group is downloaded at most once every two hours.
  if (ageMin('tle-meta.json') < 115) return 'fresh enough';
  const out = [];
  for (const g of ['stations', 'visual', 'weather', 'gps-ops', 'geo', 'starlink']) {
    try { const t = await get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, { type: 'text', timeout: 90_000 }); if (t.includes('\n1 ')) { write(`tle-${g}.txt`, t); out.push(g); } } catch (e) { log(`TLE ${g}:`, e.message); }
    await sleep(2000);
  }
  if (out.length) write('tle-meta.json', { generatedAt: new Date().toISOString(), groups: out });
  if (!out.length) throw new Error('CelesTrak answered for no group (the previous orbits are kept)');
  return out.join(', ');
}

// ------------------------------------------------------------------ news (GDELT)
// The GDELT GEO 2.0 API (places in the news) is often offline or slow and sends no CORS headers when it fails,
// so the site reads these copies. One topic is refreshed per round (each about every 25 minutes). If GEO is
// down, the newest GDELT 2.0 event export (every 15 minutes, with a location and source link for each event)
// is turned into the same shape.
const TOPICS = {
  top: '(breaking OR "this morning" OR announced OR officials)',
  disaster: '(earthquake OR flood OR wildfire OR hurricane OR typhoon OR cyclone OR tornado OR landslide OR eruption)',
  conflict: '(airstrike OR missile OR shelling OR ceasefire OR troops OR militants)',
  protest: '(protest OR protesters OR demonstration OR strike OR rally)',
  science: '(NASA OR launch OR satellite OR telescope OR scientists OR discovery)',
  climate: '(heatwave OR drought OR emissions OR "power grid" OR blackout OR pipeline)',
};
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleFromUrl = (u) => {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean).reverse().find((x) => /[a-z]{3,}-[a-z]{3,}/i.test(x)) ?? '';
    const t = decodeURIComponent(seg).replace(/\.(s?html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').replace(/\b\d{5,}\b/g, '').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : new URL(u).hostname;
  } catch { return u; }
};
const TOPIC_WORDS = {
  disaster: /earthquake|quake|flood|wildfire|bushfire|hurricane|typhoon|cyclone|tornado|landslide|volcan|eruption|storm|tsunami|disaster/i,
  science: /nasa|space|launch|satellite|telescope|scien|research|discover|rocket|astronom|esa-|spacex/i,
  climate: /climate|heatwave|heat-wave|drought|emission|power-grid|blackout|outage|pipeline|energy|carbon|renewable/i,
};
let eventsCache = null;
async function fromEvents(topic) {
  if (!eventsCache) {
    const last = await get('http://data.gdeltproject.org/gdeltv2/lastupdate.txt', { type: 'text' });
    const zipUrl = last.split('\n').map((l) => l.trim().split(' ').pop()).find((u) => /export\.CSV\.zip$/i.test(u));
    if (!zipUrl) throw new Error('no export file listed');
    const r = await fetch(zipUrl, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`export HTTP ${r.status}`);
    const zp = join(OUT, '.events.zip'); writeFileSync(zp, Buffer.from(await r.arrayBuffer()));
    const csv = execFileSync('unzip', ['-p', zp], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
    execFileSync('rm', ['-f', zp]);
    eventsCache = csv.split('\n').map((l) => l.split('\t')).filter((c) => c.length > 60);
  }
  // CAMEO root codes: 14 protest; 15 force posture, 18 assault, 19 fight, 20 mass violence → conflict.
  // Other topics are matched on words in the article address (most news sites put the headline there).
  const want = topic === 'protest' ? ['14'] : topic === 'conflict' ? ['15', '18', '19', '20'] : null;
  const words = TOPIC_WORDS[topic] ?? null;
  const places = new Map();
  for (const c of eventsCache) {
    if (want && !want.includes(c[28])) continue;
    if (words && !words.test(c[60] ?? '')) continue;
    const name = c[52]; const lat = Number(c[56]); const lng = Number(c[57]); const url = c[60];
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !/^https?:/.test(url ?? '')) continue;
    const p = places.get(name) ?? { name, lat, lng, count: 0, urls: new Set() };
    p.count += Number(c[33]) || 1; p.urls.add(url); places.set(name, p);
  }
  const features = [...places.values()].sort((a, b) => b.count - a.count).slice(0, 250).map((p) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { name: p.name, count: p.count, html: [...p.urls].slice(0, 8).map((u) => `<a href="${escHtml(u)}" title="${escHtml(titleFromUrl(u))}">${escHtml(titleFromUrl(u))}</a>`).join('<br>') },
  }));
  return { type: 'FeatureCollection', features, via: 'GDELT 2.0 event export' };
}
async function news() {
  const stale = Object.keys(TOPICS).map((t) => [t, ageMin(`news-${t}.json`)]).filter(([, age]) => age >= 20).sort((a, b) => b[1] - a[1]);
  if (!stale.length) return 'fresh enough';
  const done = []; let geoDown = false;
  for (const [topic] of stale.slice(0, 3)) { // at most three topics a round keeps GDELT happy
    let j = null; let via = 'GDELT GEO 2.0 API';
    try {
      if (geoDown) throw new Error('skipped (down this round)');
      const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(`${TOPICS[topic]} sourcelang:english`)}&mode=PointData&format=GeoJSON&timespan=24H&maxpoints=250`;
      j = await get(url, { timeout: 30_000 });
      if (!j.features?.length) throw new Error('empty');
    } catch (e) {
      log('GDELT GEO', topic, e.message, '→ event export'); geoDown = true;
      try { j = await fromEvents(topic); via = j.via; } catch (e2) { log('GDELT events:', e2.message); continue; }
    }
    write(`news-${topic}.json`, { ...j, generatedAt: new Date().toISOString(), via });
    done.push(`${topic} ${j.features.length}`);
    await sleep(1500);
  }
  if (!done.length) throw new Error('GDELT unreachable');
  return `${done.join(', ')} places via ${geoDown ? 'event export' : 'GEO API'}`;
}

// status.json feeds the app's Data health panel. A feed that is "fresh enough" keeps the time and count of its
// last real refresh from the previous status file.
const prevStatus = (() => { try { return JSON.parse(readFileSync(join(OUT, 'status.json'), 'utf8')).feeds ?? {}; } catch { return {}; } })();
const only = process.env.LIVE_ONLY?.split(','); // e.g. LIVE_ONLY=ships for a quick local test
for (const [name, fn] of [['flights', flights], ['gdacs', gdacs], ['launches', launches], ['tle', tles], ['news', news], ['fires', fires], ['ships', ships]]) {
  if (only && !only.includes(name)) { if (prevStatus[name]) status.feeds[name] = prevStatus[name]; continue; }
  const t0 = Date.now();
  try {
    const r = await fn(); const fresh = r !== 'fresh enough'; const note = typeof r === 'object' ? r.note : r;
    status.feeds[name] = fresh ? { ok: true, note, at: new Date().toISOString(), count: r.count ?? null, ms: Date.now() - t0 } : { ...prevStatus[name], ok: prevStatus[name]?.ok ?? true, note: prevStatus[name]?.note ?? note };
    log(name, '→', note);
  } catch (e) { status.feeds[name] = { ...prevStatus[name], ok: false, note: e.message, failedAt: new Date().toISOString() }; log(name, 'FAILED:', e.message); }
}
write('status.json', status);
write('README.md', `# Global Intelligence Atlas live-data\n\nMachine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by \`.github/workflows/live.yml\` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.\n\nLast run: ${status.generatedAt}\n\n${Object.entries(status.feeds).map(([k, v]) => `- **${k}**: ${v.ok ? 'ok' : 'failed'} — ${v.note}`).join('\n')}\n\nData: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news). See docs/REFERENCES.md on main for licences.\n`);
if (!only && !status.feeds.flights?.ok && !existsSync(join(OUT, 'flights.json'))) process.exitCode = 1;
