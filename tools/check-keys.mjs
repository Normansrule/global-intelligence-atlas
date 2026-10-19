#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: check each repository secret the data jobs use, without printing any value.
// For each key it says whether it is set and, where the service has a cheap check, whether the service accepts it.
// Run by .github/workflows/keys.yml (by hand, or on a branch push that changes it). Writes a Markdown table.
import { censusRefusal } from './fetch-economy.mjs';

const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.12 (+https://github.com/Normansrule/global-intelligence-atlas; key check)' };
const env = (k) => (process.env[k] ?? '').trim();
const go = async (url, opt = {}) => { const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers ?? {}) }, signal: AbortSignal.timeout(30_000) }); return { status: r.status, text: await r.text() }; };

const CHECKS = [
  ['OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET', 'live.yml (worldwide flights)', ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'], async () => {
    const r = await go('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('OPENSKY_CLIENT_ID'), client_secret: env('OPENSKY_CLIENT_SECRET') }) });
    if (r.status === 401 || r.status === 400) return [false, `OpenSky refused the login (HTTP ${r.status}${/invalid_client/.test(r.text) ? ', invalid client: the client id or secret is wrong, or the API client was deleted' : ''})`];
    if (r.status !== 200) return [false, `OpenSky login HTTP ${r.status}`];
    return /"access_token"/.test(r.text) ? [true, 'OpenSky issued a token'] : [false, 'OpenSky answered without a token'];
  }],
  ['CENSUS_API_KEY', 'economy.yml (U.S. county home values)', ['CENSUS_API_KEY'], async () => {
    const r = await go(`https://api.census.gov/data/2023/acs/acs5?get=NAME&for=state:01&key=${encodeURIComponent(env('CENSUS_API_KEY'))}`);
    try { JSON.parse(r.text); return r.status === 200 ? [true, 'the Census data API answered with data'] : [false, `HTTP ${r.status}`]; } catch { return [false, censusRefusal(r.status, r.text, process.env.CENSUS_API_KEY)]; }
  }],
  ['FIRMS_MAP_KEY', 'live.yml (fires)', ['FIRMS_MAP_KEY'], async () => {
    const r = await go(`https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(env('FIRMS_MAP_KEY'))}`);
    return r.status === 200 && /transaction_limit|current_transactions/.test(r.text) ? [true, 'FIRMS knows the key'] : [false, `FIRMS HTTP ${r.status}${/invalid/i.test(r.text) ? ', invalid key' : ''}`];
  }],
  ['WSDOT_ACCESS_CODE', 'data.yml and camera-check.yml (Washington State cameras, API fallback)', ['WSDOT_ACCESS_CODE'], async () => {
    const r = await go(`https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${encodeURIComponent(env('WSDOT_ACCESS_CODE'))}`);
    return r.status === 200 && r.text.trim().startsWith('[') ? [true, 'WSDOT answered with cameras'] : [false, `WSDOT HTTP ${r.status}`];
  }],
  ['ONTARIO_511_KEY', 'data.yml (optional fallback; the public camera list needs no key)', ['ONTARIO_511_KEY'], null],
  ['ALBERTA_511_KEY', 'data.yml (optional fallback; the public camera list needs no key)', ['ALBERTA_511_KEY'], null],
  ['AISSTREAM_KEY', 'live.yml (ships)', ['AISSTREAM_KEY'], null],
];

console.log('### Repository secrets\n\nValues are never printed.\n\n| Secret | Used by | Set | Accepted | Note |\n|---|---|---|---|---|');
let bad = 0;
for (const [label, use, names, test] of CHECKS) {
  const missing = names.filter((n) => !env(n));
  let ok = null; let note = '';
  if (missing.length) note = `not set: ${missing.join(', ')}`;
  else if (test) { try { [ok, note] = await test(); } catch (e) { ok = false; note = e.name === 'TimeoutError' ? 'timed out' : e.message; } }
  else note = 'no cheap check; see the job that uses it';
  const spaced = names.some((n) => process.env[n] && process.env[n] !== process.env[n].trim());
  if (spaced) note += ' (the secret has spaces or a line break around it; the jobs trim it)';
  if (ok === false) bad++;
  console.log(`| ${label} | ${use} | ${missing.length ? 'no' : 'yes'} | ${ok == null ? '—' : ok ? 'yes' : 'no'} | ${note.replace(/\|/g, '/')} |`);
}
if (bad) process.exitCode = 1;
