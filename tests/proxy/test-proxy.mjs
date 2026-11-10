// SPDX-License-Identifier: AGPL-3.0-only
// The optional Cloudflare Worker proxy (proxy/worker.js), offline: a stub cache and a stub upstream stand in for
// Cloudflare and the data hosts. v2.14 security: other websites' visitors are turned away, only listed hosts on the
// standard port are reached, a redirect may not leave the list, and every answer is marked as inert data.
const store = new Map();
globalThis.caches = { default: { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, r); } } };
let upstream = (url) => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url) => { const r = upstream(String(url)); Object.defineProperty(r, 'url', { value: r._url ?? String(url) }); return r; };
const { default: worker } = await import('../../proxy/worker.js');
const env = { ALLOWED_ORIGINS: 'https://normansrule.github.io' };
const ctx = { waitUntil: () => {} };
const call = (target, origin = 'https://normansrule.github.io') => worker.fetch(new Request(`https://p.example/?url=${encodeURIComponent(target)}`, { headers: origin ? { Origin: origin } : {} }), env, ctx);
let pass = 0, total = 0;
const check = (name, ok, info = '') => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${info}`}`); };

let r = await call('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations');
check('a listed host is fetched for the site', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://normansrule.github.io', r.status);
check('the answer is marked as inert data', r.headers.get('X-Content-Type-Options') === 'nosniff' && /sandbox/.test(r.headers.get('Content-Security-Policy') ?? ''), [...r.headers]);
r = await call('https://celestrak.org/x', 'https://evil.example');
check('a browser on another website is turned away', r.status === 403, r.status);
r = await call('https://evil.example/');
check('a host that is not listed is refused', r.status === 403, r.status);
r = await call('https://celestrak.org:8443/');
check('a listed host on another port is refused', r.status === 403, r.status);
r = await call('http://celestrak.org/');
check('plain http is refused', r.status === 403, r.status);
r = await call('https://user:pw@celestrak.org/');
check('credentials in the address are refused', r.status === 403, r.status);
upstream = (url) => { const x = new Response('secret', { status: 200 }); x._url = 'https://evil.example/landing'; return x; };
r = await call('https://crt.sh/?q=example.com');
check('a redirect that leaves the list is dropped', r.status === 502, r.status);
upstream = (url) => { const x = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/rdap+json' } }); x._url = 'https://rdap.verisign.com/com/v1/domain/example.com'; return x; };
r = await call('https://rdap.org/domain/example.com');
check('rdap.org may hand a query on to the registry that holds it', r.status === 200, r.status);
r = await worker.fetch(new Request('https://p.example/?url=https://celestrak.org/', { method: 'POST', headers: { Origin: 'https://normansrule.github.io' } }), env, ctx);
check('only GET', r.status === 405, r.status);
console.log('SUMMARY', pass, '/', total);
process.exit(pass === total ? 0 : 1);
