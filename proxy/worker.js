// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas optional CORS proxy, a Cloudflare Worker (the free plan allows 100,000 requests a day).
// It lets the website read live feeds that don't send CORS headers, such as flight trackers, in real
// time instead of from the 10-minute snapshot. It forwards only GET requests to the allowlisted
// data hosts below, caches each answer for a few seconds so many visitors share one upstream
// request, and adds CORS headers for your site only.
//
// Deploy:  cd proxy && npx wrangler login && npx wrangler deploy
// Then put the printed https://global-intelligence-atlas-proxy.<you>.workers.dev URL in site/app/config.json → "proxy".
//
// Ships in view (optional): `npx wrangler secret put AISSTREAM_KEY` (free key from https://aisstream.io). Then
// GET /ais?b=south,west,north,east listens to AISStream for a few seconds and returns the vessels in that box.
// Answers are cached for a minute per 2° box, because AISStream allows only three connections per key at once.
import { AIS_URL, SHIP_FIELDS, STATIC_FIELDS, aisSubscription, createAisStore, parseFrame } from '../site/app/js/ais.js';
const HOSTS = [
  'opensky-network.org', 'api.airplanes.live', 'api.adsb.lol', 'opendata.adsb.fi', 'api.adsbdb.com',
  'll.thespacedevs.com', 'www.gdacs.org', 'celestrak.org', 'api.gdeltproject.org', 'meri.digitraffic.fi',
  'firms.modaps.eosdis.nasa.gov',
  // Intelligence toolkit (osint.js)
  'dns.google', 'rdap.org', 'crt.sh', 'stat.ripe.net', 'cveawg.mitre.org', 'api.first.org', 'blockstream.info', 'eth.blockscout.com',
];
// Seconds to cache each host's answers at the edge.
const TTL = { 'opensky-network.org': 60, 'api.airplanes.live': 8, 'api.adsb.lol': 8, 'opendata.adsb.fi': 8, 'api.adsbdb.com': 86400, 'll.thespacedevs.com': 900, 'www.gdacs.org': 600, 'celestrak.org': 7200, 'firms.modaps.eosdis.nasa.gov': 1800, 'rdap.org': 3600, 'crt.sh': 3600, 'cveawg.mitre.org': 3600, 'api.first.org': 3600 };

export default {
  async fetch(request, env, ctx) {
    const origins = (env.ALLOWED_ORIGINS ?? 'https://normansrule.github.io,http://localhost:8765').split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes('*') ? '*' : origins.includes(origin) ? origin : origins[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });
    if (new URL(request.url).pathname === '/ais') return ais(request, env, ctx, cors);
    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url') ?? ''); } catch { return new Response('Pass ?url=https://…', { status: 400, headers: cors }); }
    if (target.protocol !== 'https:' || !HOSTS.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }
    const ttl = TTL[target.hostname] ?? 30;
    const cache = caches.default; const key = new Request(target.toString());
    let res = await cache.match(key);
    if (!res) {
      const headers = { 'User-Agent': 'GlobalIntelligenceAtlas-Proxy/1.7 (+https://github.com/Normansrule/global-intelligence-atlas)', Accept: 'application/json, text/plain, */*' };
      if (target.hostname === 'opensky-network.org' && env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
        const tok = await openskyToken(env); if (tok) headers.Authorization = `Bearer ${tok}`;
      }
      const up = await fetch(target.toString(), { headers, cf: { cacheTtl: ttl } });
      res = new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

let token = null; let tokenExp = 0;
async function openskyToken(env) {
  if (token && Date.now() < tokenExp) return token;
  const r = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }),
  });
  if (!r.ok) return null;
  const j = await r.json(); token = j.access_token; tokenExp = Date.now() + (j.expires_in - 60) * 1000; return token;
}

// --------------------------------------------------------------- ships in a box, from AISStream
async function ais(request, env, ctx, cors) {
  const json = (o, status = 200, ttl = 0) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store' } });
  if (!env.AISSTREAM_KEY) return json({ error: 'this proxy has no AISSTREAM_KEY secret' }, 404);
  const b = (new URL(request.url).searchParams.get('b') ?? '').split(',').map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isFinite(x)) || b[0] < -90 || b[2] > 90 || b[0] >= b[2] || b[1] < -180 || b[3] > 180 || b[1] >= b[3]) return json({ error: 'pass ?b=south,west,north,east' }, 400);
  // snap to a 2° grid so nearby views share one cached answer
  const g = (x, f) => Math.max(-180, Math.min(180, f(x / 2) * 2)); const box = [[Math.max(-90, g(b[0], Math.floor)), g(b[1], Math.floor)], [Math.min(90, g(b[2], Math.ceil)), g(b[3], Math.ceil)]];
  const key = new Request(`https://ais.cache/${box.flat().join(',')}`);
  const hit = await caches.default.match(key);
  if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }
  const up = await fetch((env.AIS_URL ?? AIS_URL).replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } }); // AIS_URL: tests only
  const ws = up.webSocket;
  if (!ws) return json({ error: `AISStream refused the connection (HTTP ${up.status})` }, 502);
  ws.accept();
  const store = createAisStore(); let err = null;
  await new Promise((resolve) => {
    const done = () => { try { ws.close(); } catch { /* already closed */ } resolve(); };
    const timer = setTimeout(done, 6000);
    ws.addEventListener('message', (e) => { const m = parseFrame(e.data); if (m?.error) { err = m.error; clearTimeout(timer); done(); } else if (store.add(m) && store.messages >= 4000) { clearTimeout(timer); done(); } });
    ws.addEventListener('close', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', () => { err ??= 'connection error'; clearTimeout(timer); resolve(); });
    ws.send(aisSubscription(env.AISSTREAM_KEY, [box]));
  });
  if (err && !store.size) return json({ error: `AISStream: ${err}` }, 502);
  const res = json({ generatedAt: new Date().toISOString(), src: 'AISStream via proxy', box, fields: SHIP_FIELDS, rows: store.rows(), staticFields: STATIC_FIELDS, statics: store.statics() }, 200, 60);
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
