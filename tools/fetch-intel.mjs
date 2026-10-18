#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — reference lists for the Intelligence toolkit (site/app/js/osint.js), adapted from
// the RECON tools in Osiris (github.com/simplifaisoul/osiris, MIT). Browsers cannot download these lists
// directly (no CORS (Cross-Origin Resource Sharing) headers), so GitHub Actions builds compact copies daily
// (.github/workflows/intel.yml). Each list is optional: if a source is down, its previous file is kept.
//   site/app/data/intel/sanctions.json  U.S. Treasury Office of Foreign Assets Control (OFAC)
//                                       Specially Designated Nationals (SDN) list (public domain)
//   site/app/data/intel/kev.json        CISA Known Exploited Vulnerabilities (KEV) catalogue (public domain)
// Usage: node tools/fetch-intel.mjs            (from the repository root)
//        node tools/fetch-intel.mjs --from DIR  (parse SDN.CSV, ALT.CSV, ADD.CSV and kev.json saved in DIR; for tests)
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'site/app/data/intel';
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.0 (+https://github.com/Normansrule/global-intelligence-atlas; educational map)' };
const OFAC = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/';
const KEV = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const fromDir = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '';

async function get(url) {
  if (fromDir) return readFileSync(join(fromDir, url.split('/').pop()), 'utf8');
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}: ${body.slice(0, 160)}`);
  return body;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}
// OFAC writes "-0-" for an empty field.
const val = (s) => { const t = (s ?? '').trim(); return t === '-0-' ? '' : t; };

/** Build the compact sanctions list: [id, name, type, programmes, countries, aliases, remarks]. */
export function buildSanctions(sdnCsv, altCsv, addCsv) {
  const alt = new Map(); const add = new Map();
  for (const r of parseCsv(altCsv)) { const id = val(r[0]); const n = val(r[3]); if (id && n) (alt.get(id) ?? alt.set(id, []).get(id)).push(n); }
  for (const r of parseCsv(addCsv)) { const id = val(r[0]); const c = val(r[4]); if (id && c) { const s = add.get(id) ?? add.set(id, new Set()).get(id); s.add(c); } }
  const out = [];
  for (const r of parseCsv(sdnCsv)) {
    const id = val(r[0]); const name = val(r[1]);
    if (!/^\d+$/.test(id) || !name) continue;
    const type = val(r[2]).toLowerCase() || 'entity';
    // remarks hold dates of birth, identifiers and digital currency addresses; keep them short
    const remarks = val(r[11]).replace(/\s+/g, ' ').slice(0, 600);
    out.push([Number(id), name, type, val(r[3]).replace(/[\[\]]/g, ''), [...(add.get(id) ?? [])].join('; '), (alt.get(id) ?? []).slice(0, 12), remarks]);
  }
  return out;
}

/** Build the compact KEV table: CVE id → [vendor, product, name, date added, ransomware use, due date]. */
export function buildKev(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const ids = {};
  for (const v of j.vulnerabilities ?? []) {
    if (!/^CVE-\d{4}-\d{4,}$/.test(v.cveID ?? '')) continue;
    ids[v.cveID] = [v.vendorProject ?? '', v.product ?? '', v.vulnerabilityName ?? '', v.dateAdded ?? '', v.knownRansomwareCampaignUse === 'Known' ? 1 : 0, v.dueDate ?? ''];
  }
  return { catalogVersion: j.catalogVersion ?? '', count: Object.keys(ids).length, ids };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const at = new Date().toISOString();
  let failed = 0;
  try {
    const [sdn, alt, add] = await Promise.all(['SDN.CSV', 'ALT.CSV', 'ADD.CSV'].map((f) => get(OFAC + f)));
    const entries = buildSanctions(sdn, alt, add);
    if (entries.length < 1000 && !fromDir) throw new Error(`only ${entries.length} entries; keeping the previous list`);
    writeFileSync(join(OUT, 'sanctions.json'), JSON.stringify({ generatedAt: at, source: 'U.S. Treasury OFAC SDN list', url: 'https://sanctionslist.ofac.treas.gov/', fields: ['id', 'name', 'type', 'programs', 'countries', 'aliases', 'remarks'], entries }));
    console.log(`sanctions: ${entries.length} entries`);
  } catch (e) { failed++; console.warn(`sanctions: ${e.message}${existsSync(join(OUT, 'sanctions.json')) ? ' (previous file kept)' : ''}`); }
  try {
    const kev = buildKev(await get(KEV));
    if (kev.count < 100 && !fromDir) throw new Error(`only ${kev.count} entries; keeping the previous list`);
    writeFileSync(join(OUT, 'kev.json'), JSON.stringify({ generatedAt: at, source: 'CISA Known Exploited Vulnerabilities catalog', ...kev }));
    console.log(`kev: ${kev.count} vulnerabilities`);
  } catch (e) { failed++; console.warn(`kev: ${e.message}${existsSync(join(OUT, 'kev.json')) ? ' (previous file kept)' : ''}`); }
  if (failed === 2) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) main();
