// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — pure helpers for the Intelligence toolkit (osint.js). No DOM, so Node can test them
// (tests/intel/test-intel.mjs). Ported and adapted from Osiris (github.com/simplifaisoul/osiris,
// © 2026 simplifaisoul, MIT licence): input checks from its RECON routes and the conflict zones from
// src/app/api/conflicts/route.ts.

/** Work out what someone typed: a domain, an internet address, a network number, a vulnerability id, a wallet or a name. */
export function classify(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'empty', value: '' };
  const cve = s.match(/^cve[-\s]?(\d{4})[-\s]?(\d{4,})$/i);
  if (cve) return { kind: 'cve', value: `CVE-${cve[1]}-${cve[2]}` };
  const asn = s.match(/^as\s?(\d{1,10})$/i);
  if (asn) return { kind: 'asn', value: asn[1] };
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: 'eth', value: s };
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s)) return { kind: 'btc', value: s };
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((x) => x > 255)) return { kind: 'unknown', value: s };
    const [a, b] = o;
    const priv = a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    return { kind: priv ? 'private' : 'ip', value: s };
  }
  if (s.includes(':') && /^[0-9a-f:.]+$/i.test(s) && s.split(':').length >= 3) {
    const l = s.toLowerCase();
    return { kind: l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) ? 'private' : 'ip', value: l };
  }
  // a domain, possibly pasted as a link
  let host = s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) { try { host = new URL(host).hostname; } catch { /* keep */ } }
  host = host.replace(/\/.*$/, '').replace(/\.$/, '').toLowerCase();
  if (/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)) return { kind: 'domain', value: host };
  if (/^[\p{L}\p{N} .,'&()-]{3,}$/u.test(s) && /\p{L}/u.test(s) && !/^[a-z0-9-]+$/i.test(s)) return { kind: 'name', value: s };
  return { kind: 'unknown', value: s };
}

const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Search the compact sanctions list (tools/fetch-intel.mjs) for a name. Every word typed must appear in the
 * entry's name or one alias (any order). Exact and whole-name matches rank first.
 * @param {Array} entries rows of [id, name, type, programmes, countries, aliases, remarks]
 */
export function searchSanctions(entries, query, limit = 40) {
  const q = fold(query); if (q.length < 3) return [];
  const words = q.split(' ');
  const hits = [];
  for (const e of entries) {
    let best = 0;
    for (const n of [e[1], ...(e[5] ?? [])]) {
      const f = fold(n); if (!f) continue;
      const pad = ` ${f} `;
      if (!words.every((w) => pad.includes(` ${w}`))) continue;
      const score = f === q ? 3 : words.every((w) => pad.includes(` ${w} `)) ? 2 : 1;
      if (score > best) best = score;
    }
    if (best) hits.push([best, e]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1][1].length - b[1][1].length);
  return hits.slice(0, limit).map((h) => h[1]);
}

/** Find any listed digital currency addresses in an entry's remarks (OFAC writes "Digital Currency Address - XBT …"). */
export const walletsIn = (remarks) => [...String(remarks ?? '').matchAll(/Digital Currency Address - (\w+) ([A-Za-z0-9]{20,})/g)].map((m) => ({ coin: m[1], address: m[2] }));

/**
 * Active conflict and tension zones, from Osiris's conflict route (reviewed October 2026). Each box is used to
 * count live GDELT conflict reports. Severity: war, high or elevated. These are editorial outlines, not borders.
 */
export const CONFLICT_ZONES = [
  { id: 'ukraine', label: 'Ukraine war', severity: 'war', lat: 48.5, lng: 31.2, box: [44, 53, 22, 40], about: 'Russia’s full-scale invasion of Ukraine; active front lines in the east and south.' },
  { id: 'gaza', label: 'Gaza', severity: 'war', lat: 31.35, lng: 34.35, box: [31, 32, 34, 34.8], about: 'Military operations and a humanitarian crisis in the Gaza Strip.' },
  { id: 'sudan', label: 'Sudan civil war', severity: 'war', lat: 15, lng: 30, box: [10, 22, 22, 38], about: 'War between the Sudanese Armed Forces (SAF) and the Rapid Support Forces (RSF).' },
  { id: 'myanmar', label: 'Myanmar', severity: 'war', lat: 19.5, lng: 96.5, box: [10, 28, 92, 101], about: 'Civil war between the military government and opposition and ethnic armed groups.' },
  { id: 'yemen', label: 'Yemen', severity: 'war', lat: 15.5, lng: 48, box: [12, 20, 42, 55], about: 'Houthi operations, coalition strikes and attacks on Red Sea shipping.' },
  { id: 'drc', label: 'Eastern Democratic Republic of the Congo (DRC)', severity: 'war', lat: -1, lng: 28.5, box: [-5, 5, 25, 32], about: 'The M23 rebel offensive and wider instability in the eastern provinces.' },
  { id: 'lebanon', label: 'Lebanon border', severity: 'high', lat: 33.38, lng: 35.48, box: [33, 34.5, 35, 36.5], about: 'Cross-border military operations in southern Lebanon.' },
  { id: 'syria', label: 'Syria', severity: 'high', lat: 35, lng: 38.5, box: [32, 37, 35, 42], about: 'Post-war transition with local insurgencies and foreign strikes.' },
  { id: 'red-sea', label: 'Red Sea shipping', severity: 'high', lat: 16, lng: 40, box: [12, 22, 36, 44], about: 'Missile and drone attacks on merchant ships passing the Bab-el-Mandeb strait.' },
  { id: 'sahel', label: 'Sahel', severity: 'high', lat: 14, lng: 5, box: [10, 20, -5, 15], about: 'Insurgencies and military governments across Mali, Burkina Faso and Niger.' },
  { id: 'somalia', label: 'Somalia', severity: 'high', lat: 5, lng: 46, box: [-2, 12, 40, 52], about: 'The al-Shabaab insurgency and counter-terrorism operations.' },
  { id: 'iraq', label: 'Iraq', severity: 'elevated', lat: 33.3, lng: 44.4, box: [29, 37.5, 38, 49], about: 'Militia activity and counter-terrorism operations.' },
  { id: 'ethiopia', label: 'Ethiopia', severity: 'elevated', lat: 9, lng: 38.7, box: [3, 15, 33, 48], about: 'Regional conflicts, including in Amhara and Oromia.' },
  { id: 'taiwan-strait', label: 'Taiwan Strait', severity: 'elevated', lat: 24, lng: 119.5, box: [22, 26, 117, 122], about: 'Military drills and cross-strait tension.' },
  { id: 'korean-dmz', label: 'Korean Demilitarized Zone (DMZ)', severity: 'elevated', lat: 38.3, lng: 127, box: [37, 39.5, 124, 130], about: 'Cross-border tension between North and South Korea.' },
];

/** Sum the article counts of news points inside each zone's box. */
export function zoneCounts(points) {
  const out = Object.fromEntries(CONFLICT_ZONES.map((z) => [z.id, 0]));
  for (const p of points) {
    for (const z of CONFLICT_ZONES) {
      const [s, n, w, e] = z.box;
      if (p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e) out[z.id] += p.count ?? 1;
    }
  }
  return out;
}

/** Common Vulnerability Scoring System (CVSS) score → severity word. */
export const cvssWord = (x) => (x == null ? '' : x >= 9 ? 'Critical' : x >= 7 ? 'High' : x >= 4 ? 'Medium' : x > 0 ? 'Low' : 'None');
