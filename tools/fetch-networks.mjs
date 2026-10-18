#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — collect public network directories into site/app/data/networks.json:
//   • PeeringDB facilities (colocation data centres / internet exchange buildings) with coordinates
//   • KiwiSDR public shortwave receivers (community directory at rx.linkfanel.net)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const OUT = 'site/app/data/networks.json';
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/1.4 (educational map)', Accept: 'application/json' };
const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
const r4 = (x) => Math.round(x * 1e4) / 1e4;

let facilities = prev.facilities ?? [];
try {
  const r = await fetch('https://www.peeringdb.com/api/fac', { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  facilities = j.data.filter((f) => f.status === 'ok' && ok(Number(f.latitude), Number(f.longitude)))
    .map((f) => [f.name, r4(Number(f.latitude)), r4(Number(f.longitude)), f.city, f.country, f.net_count ?? 0, f.ix_count ?? 0, f.website ?? ''])
    .sort((a, b) => b[5] - a[5]);
  console.log(`PeeringDB: ${facilities.length} facilities`);
} catch (e) { console.warn(`PeeringDB: ${e.message} — keeping ${facilities.length} from the previous run`); }

let radios = prev.radios ?? [];
try {
  const r = await fetch('http://rx.linkfanel.net/kiwisdr_com.js', { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await r.text();
  const list = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1).replace(/,\s*([\]}])/g, '$1'));
  radios = list.map((k) => {
    const m = String(k.gps ?? '').match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/); if (!m) return null;
    const lat = Number(m[1]); const lng = Number(m[2]); if (!ok(lat, lng) || !/^https?:\/\//.test(k.url ?? '')) return null;
    if (k.offline === 'yes' || k.status === 'offline') return null;
    return [String(k.name ?? 'KiwiSDR').replace(/<[^>]+>/g, '').slice(0, 90), r4(lat), r4(lng), k.url, Number(k.users ?? 0), Number(k.users_max ?? 0), String(k.antenna ?? '').slice(0, 80), String(k.loc ?? '').slice(0, 60)];
  }).filter(Boolean);
  console.log(`KiwiSDR: ${radios.length} receivers`);
} catch (e) { console.warn(`KiwiSDR: ${e.message} — keeping ${radios.length} from the previous run`); }

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), facilities, radios }));
console.log(`wrote ${OUT}`);
