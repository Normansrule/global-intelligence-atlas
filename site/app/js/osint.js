// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — the Intelligence toolkit: open-source intelligence (OSINT) lookups anyone can run and
// learn from, in the Tools section. Adapted from the RECON toolkit and conflict monitor of Osiris
// (github.com/simplifaisoul/osiris, © 2026 simplifaisoul, MIT licence). Osiris runs these on its own server;
// here every lookup goes from the browser (or the desktop app) straight to a public registry through feeds.js,
// so the site stays static.
//
// Deliberately left out: port and vulnerability scanning (that probes other people's machines), and searches
// for private people (usernames, phone numbers, leaked passwords). Everything here reads public registries
// about domains, networks, software flaws, sanctioned parties and public blockchains.
import { getFeed, getLocal } from './feeds.js';
import { classify, searchSanctions, walletsIn, CONFLICT_ZONES, zoneCounts, cvssWord } from './osint-core.js';
import { TOPICS } from './news.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t ?? u)}</a>`;
const dl = (rows) => `<dl>${rows.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const day = (s) => (s ? new Date(s).toISOString().slice(0, 10) : '');
const num = (x) => Number(x).toLocaleString('en-GB');
const fail = (what, e) => `<p class="err">${esc(what)}: ${esc(e?.message ?? e)}. Try again later, or use the desktop app, which reads every registry directly.</p>`;

// One entry per tool: what it is called, what it does, and the lesson shown under its results.
export const OSINT_TOOLS = [
  { id: 'domain', glyph: 'server', color: '#7ed6c4', title: 'Domain lookup', blurb: 'Records, owner registry and certificates for a website name.', placeholder: 'example.com',
    learn: 'The Domain Name System (DNS) turns names into internet addresses. The Registration Data Access Protocol (RDAP), which replaced WHOIS, says who registered a name and when. Certificate Transparency (CT) logs record every security certificate a public authority issues, which reveals a site’s other names (subdomains).' },
  { id: 'ip', glyph: 'ix', color: '#8ecbff', title: 'Address or network', blurb: 'Who runs an internet address or autonomous system (AS) number, and roughly where.', placeholder: '1.1.1.1 or AS13335',
    learn: 'Every internet address belongs to a block handed out by one of five Regional Internet Registries (RIRs). Networks announce their blocks to each other with the Border Gateway Protocol (BGP), each under an autonomous system (AS) number. Location comes from public geolocation databases and is often only the city of the operator, not of the device.' },
  { id: 'cve', glyph: 'alert', color: '#f07a63', title: 'Software flaw', blurb: 'A Common Vulnerabilities and Exposures (CVE) record, its risk and whether attackers use it.', placeholder: 'CVE-2021-44228',
    learn: 'Each publicly known software flaw gets a Common Vulnerabilities and Exposures (CVE) number. The Common Vulnerability Scoring System (CVSS) rates how bad it could be; the Exploit Prediction Scoring System (EPSS) estimates the chance it is exploited in the next 30 days; the Cybersecurity and Infrastructure Security Agency (CISA) lists the ones already being exploited.' },
  { id: 'sanctions', glyph: 'bank', color: '#e3b55b', title: 'Sanctions search', blurb: 'People, companies, ships and aircraft under U.S. Treasury sanctions.', placeholder: 'A company, ship or name',
    learn: 'The U.S. Treasury’s Office of Foreign Assets Control (OFAC) publishes the Specially Designated Nationals (SDN) list: parties whose assets are blocked. A name match is not proof that a person or firm is the listed party; journalists and compliance teams check dates of birth, addresses and identifiers before drawing conclusions.' },
  { id: 'wallet', glyph: 'chip', color: '#b7a3ff', title: 'Crypto wallet', blurb: 'Balance and history of a Bitcoin or Ethereum address, checked against sanctions.', placeholder: 'bc1… or 0x…',
    learn: 'Public blockchains such as Bitcoin and Ethereum are open ledgers: anyone can read any address’s balance and transactions. OFAC adds the addresses of sanctioned parties to the SDN list, which is how investigators follow ransomware and sanctions-evasion money.' },
  { id: 'conflict', glyph: 'swords', color: '#f07a63', title: 'Conflict monitor', blurb: 'Active conflict zones ranked by live news reports from the last 24 hours.', placeholder: '',
    learn: 'Conflict zones are an editorial list from Osiris. The live count is the number of news articles in the last 24 hours that the GDELT Project geolocated inside each zone’s box for conflict words (airstrike, missile, shelling, ceasefire, troops, militants). Busy news is not the same as more fighting: big stories attract more coverage.' },
];
const TOOL = Object.fromEntries(OSINT_TOOLS.map((t) => [t.id, t]));

/** The block that goes into the Tools section. */
export function osintSection(glyph) {
  return `
      <h4>Intelligence toolkit</h4>
      <p class="muted">Open-source intelligence (OSINT) from public registries, adapted from Osiris. Type anything into one box, or pick a tool.</p>
      <form class="osint-ask" data-osint-form="auto"><input type="search" name="q" autocomplete="off" spellcheck="false" placeholder="Domain, address, AS number, CVE, wallet or name" aria-label="Look up anything" /><button class="btn" type="submit">Look up</button></form>
      <div class="toolgrid">${OSINT_TOOLS.map((t) => `<button class="tool" data-osint="${t.id}">${glyph(t.glyph, t.color, 22)}<b>${esc(t.title)}</b><small>${esc(t.blurb)}</small></button>`).join('')}</div>`;
}

/**
 * Wire the toolkit into the shell. `show(section, title, html, key)` puts a page in the left drawer; `back()` returns to Tools.
 */
export function installOsint({ show, back }) {
  let seq = 0; // ignore answers to earlier lookups
  const page = (t, q, body) => {
    show('tools', t.title, `
      <p><button class="btn ghost" data-osint-back="1">← All tools</button></p>
      <p class="muted">${esc(t.blurb)}</p>
      ${t.placeholder ? `<form class="osint-ask" data-osint-form="${t.id}"><input type="search" name="q" value="${esc(q)}" autocomplete="off" spellcheck="false" placeholder="${esc(t.placeholder)}" aria-label="${esc(t.title)}" /><button class="btn" type="submit">Look up</button></form>` : ''}
      <div class="osint-out" aria-live="polite">${body}</div>
      <details class="osint-learn"><summary>How this works</summary><p>${esc(t.learn)}</p><p class="muted">Adapted from ${link('https://github.com/simplifaisoul/osiris', 'Osiris')} (MIT licence). Lookups go straight from your browser to the public registry named under each result.</p></details>`, `osint:${t.id}`);
    return document.querySelector('#sect-tools .osint-out');
  };
  const into = (out, my, html) => { if (my === seq && out?.isConnected) out.innerHTML = html; };

  async function run(id, q) {
    const t = TOOL[id]; const my = ++seq;
    const c = classify(q);
    const out = page(t, q, id === 'conflict' || c.kind !== 'empty' ? '<p class="muted">Looking up…</p>' : '<p class="muted">Type something and press Look up.</p>');
    if (id !== 'conflict' && c.kind === 'empty') return;
    try {
      const html = await RUN[id](c, q);
      into(out, my, html);
    } catch (e) { into(out, my, fail('The lookup failed', e)); }
  }
  // the one-box search picks the tool from what was typed
  const pick = (q) => ({ domain: 'domain', ip: 'ip', asn: 'ip', private: 'ip', cve: 'cve', btc: 'wallet', eth: 'wallet', name: 'sanctions' }[classify(q).kind] ?? 'domain');

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-osint]');
    if (b) { const id = b.dataset.osint; if (id === 'conflict') run('conflict', ''); else page(TOOL[id], '', '<p class="muted">Type something and press Look up.</p>'); setTimeout(() => document.querySelector('#sect-tools .osint-ask input')?.focus(), 0); return; }
    const r = e.target.closest('[data-osint-run]');
    if (r) { e.preventDefault(); const [id, ...q] = r.dataset.osintRun.split(':'); run(id, q.join(':')); return; }
    const f = e.target.closest('[data-osint-fly]');
    if (f) { const [lat, lng, alt] = f.dataset.osintFly.split(',').map(Number); window.gia?.globe?.pointOfView({ lat, lng, altitude: alt || 0.9 }, 1600); return; }
    if (e.target.closest('[data-osint-back]')) back();
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-osint-form]'); if (!f) return;
    e.preventDefault();
    const q = new FormData(f).get('q')?.toString() ?? '';
    // a tool's own box still follows what was typed: a CVE number in Domain lookup opens Software flaw
    const tool = f.dataset.osintForm; const k = classify(q).kind;
    const away = tool === 'sanctions' ? ['btc', 'eth', 'cve', 'ip', 'asn', 'private'].includes(k) : !['unknown', 'empty'].includes(k);
    const id = tool === 'auto' || away ? pick(q) : tool;
    run(id, q);
  });
  return { run };
}

// ------------------------------------------------------------------ the lookups
const RUN = {
  async domain(c) {
    if (c.kind !== 'domain') return wrongKind(c, 'a domain name such as example.com');
    const d = c.value;
    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CAA'];
    const [dns, rdap, certs] = await Promise.allSettled([
      Promise.all(types.map((ty) => getFeed('dns', `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=${ty}`, { ttl: 5 * 60_000, timeout: 10_000 }).then((j) => [ty, (j.Answer ?? []).filter((a) => a.type === { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CAA: 257 }[ty]).map((a) => a.data)]))),
      getFeed('rdap', `https://rdap.org/domain/${encodeURIComponent(d)}`, { ttl: 60 * 60_000, timeout: 15_000 }),
      getFeed('crtsh', `https://crt.sh/?q=${encodeURIComponent(`%.${d}`)}&output=json&exclude=expired`, { ttl: 60 * 60_000, timeout: 25_000 }),
    ]);
    let html = '<h4>Name records (DNS)</h4>';
    if (dns.status === 'fulfilled') {
      const rows = dns.value.filter(([, v]) => v.length);
      const first = dns.value.find(([ty]) => ty === 'A')?.[1]?.[0];
      html += rows.length ? dl(rows.map(([ty, v]) => [ty, v.slice(0, 8).map((x) => (ty === 'A' || ty === 'AAAA') ? `<a href="#" data-osint-run="ip:${esc(x)}">${esc(x)}</a>` : esc(x)).join('<br>')])) : '<p class="muted">No records: the name may not exist.</p>';
      if (first) html += `<p><button class="btn ghost" data-osint-run="ip:${esc(first)}">Who hosts ${esc(first)}?</button></p>`;
      html += `<p class="muted">Source: Google Public DNS.</p>`;
    } else html += fail('DNS', dns.reason);
    html += '<h4>Registration (RDAP)</h4>';
    if (rdap.status === 'fulfilled') html += rdapDomain(rdap.value);
    else html += /404/.test(rdap.reason?.message) ? '<p class="muted">No registration record found (some country-code domains do not publish RDAP).</p>' : fail('RDAP', rdap.reason);
    html += '<h4>Certificates (Certificate Transparency)</h4>';
    if (certs.status === 'fulfilled' && Array.isArray(certs.value)) {
      const names = new Set(); let earliest = '';
      for (const r of certs.value) {
        for (const n of String(r.name_value ?? '').split('\n')) if (n && !n.startsWith('*')) names.add(n.toLowerCase());
        if (r.not_before && (!earliest || r.not_before < earliest)) earliest = r.not_before;
      }
      const list = [...names].sort().slice(0, 60);
      html += dl([['Valid certificates', num(certs.value.length)], ['Names seen', num(names.size)], ['Oldest still valid', day(earliest)]]);
      if (list.length) html += `<p class="osint-names">${list.map((n) => `<a href="#" data-osint-run="domain:${esc(n)}">${esc(n)}</a>`).join(' ')}</p>`;
      html += `<p class="muted">Source: ${link(`https://crt.sh/?q=${encodeURIComponent(d)}`, 'crt.sh')} (Sectigo).</p>`;
    } else html += certs.status === 'rejected' ? fail('crt.sh', certs.reason) : '<p class="muted">No certificates found.</p>';
    return html;
  },

  async ip(c) {
    if (c.kind === 'private') return '<p class="err">That is a private or reserved address: it only means something inside one local network, so no public registry knows it.</p>';
    if (c.kind === 'domain') return RUN.domain(c);
    if (c.kind === 'asn') return asn(c.value);
    if (c.kind !== 'ip') return wrongKind(c, 'an internet address such as 1.1.1.1, or an AS number such as AS13335');
    const ip = c.value; const R = 'https://stat.ripe.net/data/';
    const [rdap, pfx, geo] = await Promise.allSettled([
      getFeed('rdap', `https://rdap.org/ip/${encodeURIComponent(ip)}`, { ttl: 60 * 60_000, timeout: 15_000 }),
      getFeed('ripestat', `${R}prefix-overview/data.json?resource=${encodeURIComponent(ip)}&sourceapp=global-intelligence-atlas`, { ttl: 30 * 60_000 }),
      getFeed('ripestat', `${R}maxmind-geo-lite/data.json?resource=${encodeURIComponent(ip)}&sourceapp=global-intelligence-atlas`, { ttl: 60 * 60_000 }),
    ]);
    let html = '';
    const loc = geo.status === 'fulfilled' ? geo.value.data?.located_resources?.[0]?.locations?.[0] : null;
    if (loc && Number.isFinite(loc.latitude)) {
      html += `<h4>Approximate location</h4>${dl([['Place', esc([loc.city, loc.country].filter(Boolean).join(', '))], ['Accuracy', loc.covered_percentage != null ? `${Math.round(loc.covered_percentage)}% of the block` : '']])}
        <p><button class="btn ghost" data-osint-fly="${loc.latitude},${loc.longitude},0.5">Show on the globe</button></p>`;
    }
    html += '<h4>Network (BGP)</h4>';
    if (pfx.status === 'fulfilled') {
      const d = pfx.value.data ?? {};
      html += dl([['Announced block', esc(d.resource)], ['Network', (d.asns ?? []).map((a) => `<a href="#" data-osint-run="ip:AS${a.asn}">AS${a.asn}</a> ${esc(a.holder)}`).join('<br>') || 'not announced']]);
    } else html += fail('RIPEstat', pfx.reason);
    html += '<h4>Registration (RDAP)</h4>';
    html += rdap.status === 'fulfilled' ? rdapIp(rdap.value) : fail('RDAP', rdap.reason);
    return `${html}<p class="muted">Sources: RIPE NCC RIPEstat, MaxMind GeoLite (through RIPEstat) and the registry RDAP services.</p>`;
  },

  async cve(c) {
    if (c.kind !== 'cve') return wrongKind(c, 'a vulnerability number such as CVE-2021-44228');
    const id = c.value;
    const [rec, epss, kev] = await Promise.allSettled([
      getFeed('cve', `https://cveawg.mitre.org/api/cve/${id}`, { ttl: 60 * 60_000 }),
      getFeed('epss', `https://api.first.org/data/v1/epss?cve=${id}`, { ttl: 60 * 60_000 }),
      getLocal('data/intel/kev.json'),
    ]);
    if (rec.status === 'rejected') return /404/.test(rec.reason?.message) ? `<p class="err">${esc(id)} is not a published CVE record.</p>` : fail('CVE record', rec.reason);
    const cna = rec.value.containers?.cna ?? {};
    const desc = cna.descriptions?.find((x) => x.lang?.startsWith('en'))?.value ?? cna.descriptions?.[0]?.value ?? '';
    const metrics = [...(cna.metrics ?? []), ...(rec.value.containers?.adp ?? []).flatMap((a) => a.metrics ?? [])];
    let score = null; let vector = '';
    for (const m of metrics) { const v = m.cvssV4_0 ?? m.cvssV3_1 ?? m.cvssV3_0 ?? m.cvssV2_0; if (v?.baseScore != null) { score = v.baseScore; vector = v.vectorString ?? ''; break; } }
    const cwe = cna.problemTypes?.[0]?.descriptions?.[0];
    const k = kev.status === 'fulfilled' ? kev.value.ids?.[id] : null;
    const e = epss.status === 'fulfilled' ? epss.value.data?.[0] : null;
    let html = `<h4>${esc(id)}${cna.title ? `: ${esc(cna.title)}` : ''}</h4><p>${esc(desc)}</p>`;
    if (k) html += `<p class="osint-flag">Exploited in the wild: on the CISA Known Exploited Vulnerabilities (KEV) list since ${esc(k[3])}${k[4] ? ', and used in ransomware campaigns' : ''}.</p>`;
    html += dl([
      ['Severity (CVSS)', score != null ? `${score} · ${cvssWord(score)}` : 'not scored yet'],
      ['Vector', esc(vector)],
      ['Exploit chance (EPSS)', e ? `${(Number(e.epss) * 100).toFixed(1)}% in the next 30 days (higher than ${Math.round(Number(e.percentile) * 100)}% of flaws)` : ''],
      ['Weakness', esc(cwe?.cweId ? `${cwe.cweId}: ${cwe.description ?? ''}` : cwe?.description ?? '')],
      ['Affects', (cna.affected ?? []).slice(0, 5).map((a) => esc([a.vendor, a.product].filter((x) => x && x !== 'n/a').join(' '))).filter(Boolean).join('<br>')],
      ['Published', day(rec.value.cveMetadata?.datePublished)],
      ['Updated', day(rec.value.cveMetadata?.dateUpdated)],
      ['KEV list', kev.status === 'fulfilled' ? (k ? `yes (${esc(k[0])} ${esc(k[1])})` : 'not listed') : 'list not built yet'],
    ]);
    const refs = (cna.references ?? []).slice(0, 6);
    if (refs.length) html += `<ul class="articles">${refs.map((r) => `<li>${link(r.url, r.name || new URL(r.url).hostname)}</li>`).join('')}</ul>`;
    return `${html}<p class="muted">Sources: ${link(`https://www.cve.org/CVERecord?id=${id}`, 'CVE Program (MITRE)')}, FIRST EPSS, CISA KEV.</p>`;
  },

  async sanctions(c, q) {
    let data;
    try { data = await getLocal('data/intel/sanctions.json'); } catch { return '<p class="err">The sanctions list has not been built yet. It appears after the “Refresh intelligence data” workflow runs once.</p>'; }
    const query = c.kind === 'name' || c.kind === 'unknown' || c.kind === 'domain' ? q : c.value;
    const wallet = c.kind === 'btc' || c.kind === 'eth';
    const hits = wallet ? data.entries.filter((e) => walletsIn(e[6]).some((w) => w.address.toLowerCase() === c.value.toLowerCase())) : searchSanctions(data.entries, query);
    const head = `<p class="muted">${num(data.entries.length)} listed parties · list of ${day(data.generatedAt)}.</p>`;
    if (!hits.length) return `${head}<p>No listed party matches “${esc(query)}”. Spelling varies across alphabets, so also try a shorter part of the name.</p>`;
    return `${head}<p>${hits.length === 40 ? 'First 40' : hits.length} match${hits.length === 1 ? '' : 'es'}. A match is not proof of identity: compare the details.</p>
      <ul class="osint-hits">${hits.map((h) => {
        const w = walletsIn(h[6]);
        return `<li><b>${esc(h[1])}</b> <span class="chip">${esc(h[2])}</span>
          <small>${esc([h[3] && `Programmes: ${h[3]}`, h[4] && `Countries: ${h[4]}`].filter(Boolean).join(' · '))}</small>
          ${h[5]?.length ? `<small>Also known as: ${esc(h[5].join('; '))}</small>` : ''}
          ${h[6] ? `<small class="muted">${esc(h[6].slice(0, 260))}${h[6].length > 260 ? '…' : ''}</small>` : ''}
          ${w.length ? `<small>${w.slice(0, 4).map((x) => `<a href="#" data-osint-run="wallet:${esc(x.address)}">${esc(x.coin)} wallet</a>`).join(' · ')}</small>` : ''}
          <small>${link(`https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${h[0]}`, 'Official record')}</small></li>`;
      }).join('')}</ul><p class="muted">Source: U.S. Treasury OFAC SDN list (public domain), refreshed daily.</p>`;
  },

  async wallet(c) {
    if (c.kind !== 'btc' && c.kind !== 'eth') return wrongKind(c, 'a Bitcoin address (1…, 3… or bc1…) or an Ethereum address (0x…)');
    const a = c.value; const btc = c.kind === 'btc';
    const ofac = `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_${btc ? 'XBT' : 'ETH'}.txt`;
    const [info, extra, list] = await Promise.allSettled(btc
      ? [getFeed('blockstream', `https://blockstream.info/api/address/${a}`, { ttl: 60_000 }), Promise.resolve(null), getFeed('ofaccrypto', ofac, { type: 'text', ttl: 6 * 3600_000 })]
      : [getFeed('blockscout', `https://eth.blockscout.com/api/v2/addresses/${a}`, { ttl: 60_000 }), getFeed('blockscout', `https://eth.blockscout.com/api/v2/addresses/${a}/counters`, { ttl: 60_000 }), getFeed('ofaccrypto', ofac, { type: 'text', ttl: 6 * 3600_000 })]);
    let html = '';
    if (list.status === 'fulfilled') {
      const hit = list.value.split(/\s+/).some((x) => (btc ? x === a : x.toLowerCase() === a.toLowerCase()));
      html += hit ? `<p class="osint-flag">Sanctioned: this address is on the OFAC SDN list. <a href="#" data-osint-run="sanctions:${esc(a)}">Find the listed party</a></p>` : '<p class="muted">Not on the OFAC sanctioned-address list.</p>';
    }
    if (info.status === 'rejected') return html + (/400|404|422/.test(info.reason?.message) ? '<p class="err">The blockchain explorer does not know this address.</p>' : fail('Explorer', info.reason));
    const v = info.value;
    if (btc) {
      const s = v.chain_stats ?? {}; const m = v.mempool_stats ?? {};
      html += dl([['Balance', `${((s.funded_txo_sum - s.spent_txo_sum) / 1e8).toLocaleString('en-GB', { maximumFractionDigits: 8 })} BTC`], ['Received in total', `${(s.funded_txo_sum / 1e8).toLocaleString('en-GB', { maximumFractionDigits: 8 })} BTC`], ['Transactions', num(s.tx_count ?? 0)], ['Unconfirmed', m.tx_count ? num(m.tx_count) : '']]);
      html += `<p class="muted">Source: ${link(`https://blockstream.info/address/${a}`, 'Blockstream Esplora')}.</p>`;
    } else {
      const k = extra.status === 'fulfilled' ? extra.value : {};
      html += dl([['Balance', `${(Number(v.coin_balance ?? 0) / 1e18).toLocaleString('en-GB', { maximumFractionDigits: 6 })} ETH`], ['Kind', v.is_contract ? 'smart contract' : 'ordinary account'], ['Name', esc(v.name ?? v.ens_domain_name ?? '')], ['Transactions', k.transactions_count ? num(k.transactions_count) : ''], ['Token transfers', k.token_transfers_count ? num(k.token_transfers_count) : '']]);
      html += `<p class="muted">Source: ${link(`https://eth.blockscout.com/address/${a}`, 'Blockscout')}.</p>`;
    }
    return html;
  },

  async conflict() {
    const q = TOPICS.conflict[1];
    const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=PointData&format=GeoJSON&timespan=24H&maxpoints=250`;
    let counts = null; let note = '';
    try {
      const j = await getFeed('gdelt', url, { ttl: 10 * 60_000, timeout: 20_000, snapshot: 'news-conflict.json' });
      counts = zoneCounts((j.features ?? []).filter((f) => f.geometry?.coordinates).map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], count: f.properties?.count ?? 1 })));
    } catch (e) { note = fail('Live news counts', e); }
    const rank = { war: 0, high: 1, elevated: 2 };
    const zones = [...CONFLICT_ZONES].sort((a, b) => (counts ? counts[b.id] - counts[a.id] : 0) || rank[a.severity] - rank[b.severity]);
    return `${note}<p class="muted">Click a zone to fly there; turn on News with the topic Conflict to read the reports.</p>
      <ul class="osint-hits">${zones.map((z) => `<li><button class="linkish" data-osint-fly="${z.lat},${z.lng},${z.box[1] - z.box[0] > 6 ? 1.1 : 0.55}"><b>${esc(z.label)}</b></button> <span class="chip sev-${z.severity}">${{ war: 'War', high: 'High tension', elevated: 'Elevated' }[z.severity]}</span>${counts ? ` <span class="chip">${num(counts[z.id])} report${counts[z.id] === 1 ? '' : 's'}</span>` : ''}<small>${esc(z.about)}</small></li>`).join('')}</ul>
      <p class="muted">Sources: zones from Osiris; live counts from the GDELT Project GEO 2.0 API.</p>`;
  },
};

async function asn(n) {
  const R = 'https://stat.ripe.net/data/';
  const [ov, pf] = await Promise.allSettled([
    getFeed('ripestat', `${R}as-overview/data.json?resource=AS${n}&sourceapp=global-intelligence-atlas`, { ttl: 60 * 60_000 }),
    getFeed('ripestat', `${R}announced-prefixes/data.json?resource=AS${n}&sourceapp=global-intelligence-atlas`, { ttl: 60 * 60_000, timeout: 25_000 }),
  ]);
  if (ov.status === 'rejected') return fail('RIPEstat', ov.reason);
  const d = ov.value.data ?? {};
  const p = pf.status === 'fulfilled' ? pf.value.data?.prefixes ?? [] : null;
  return `<h4>AS${esc(n)}</h4>${dl([['Holder', esc(d.holder ?? 'unknown')], ['Announced now', d.announced ? 'yes' : 'no'], ['Blocks announced', p ? num(p.length) : ''], ['Of which IPv6', p ? num(p.filter((x) => x.prefix.includes(':')).length) : '']])}
    ${p?.length ? `<p class="osint-names">${p.slice(0, 24).map((x) => `<a href="#" data-osint-run="ip:${esc(x.prefix.split('/')[0])}">${esc(x.prefix)}</a>`).join(' ')}</p>` : ''}
    <p class="muted">Source: RIPE NCC RIPEstat. ${link(`https://bgp.he.net/AS${n}`, 'More on bgp.he.net')}</p>`;
}

const vcardName = (ent) => ent?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] ?? '';
const entityWith = (j, role) => (j.entities ?? []).find((e) => e.roles?.includes(role)) ?? (j.entities ?? []).flatMap((e) => e.entities ?? []).find((e) => e.roles?.includes(role));
const event = (j, a) => (j.events ?? []).find((e) => e.eventAction === a)?.eventDate;

function rdapDomain(j) {
  return dl([
    ['Registrar', esc(vcardName(entityWith(j, 'registrar')))],
    ['Registered', day(event(j, 'registration'))],
    ['Expires', day(event(j, 'expiration'))],
    ['Last changed', day(event(j, 'last changed'))],
    ['Status', esc((j.status ?? []).join(', '))],
    ['Name servers', esc((j.nameservers ?? []).map((n) => n.ldhName?.toLowerCase()).join(', '))],
    ['Security (DNSSEC)', j.secureDNS ? (j.secureDNS.delegationSigned ? 'signed' : 'not signed') : ''],
  ]) + '<p class="muted">Owner details are usually redacted for privacy; the registrar and dates are public.</p>';
}
function rdapIp(j) {
  return dl([
    ['Block name', esc(j.name)],
    ['Range', esc(j.startAddress && `${j.startAddress} – ${j.endAddress}`)],
    ['Organisation', esc(vcardName(entityWith(j, 'registrant')))],
    ['Country', esc(j.country)],
    ['Registry', esc((j.port43 ?? '').replace(/^whois\./, ''))],
    ['Allocated', day(event(j, 'registration'))],
  ]);
}
function wrongKind(c, want) {
  const hint = { domain: 'domain', ip: 'ip', asn: 'ip', cve: 'cve', btc: 'wallet', eth: 'wallet', name: 'sanctions' }[c.kind];
  return `<p class="err">That does not look like ${esc(want)}.</p>${hint ? `<p><button class="btn ghost" data-osint-run="${hint}:${esc(c.kind === 'asn' ? `AS${c.value}` : c.value)}">Look it up with ${esc(TOOL[hint].title)} instead</button></p>` : ''}`;
}
