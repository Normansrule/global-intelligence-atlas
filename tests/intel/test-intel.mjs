// SPDX-License-Identifier: AGPL-3.0-only
// Offline checks for tools/fetch-intel.mjs and the pure helpers in site/app/js/osint.js.  Run: node tests/intel/test-intel.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, buildSanctions, buildKev } from '../../tools/fetch-intel.mjs';
import { classify, searchSanctions, zoneCounts, CONFLICT_ZONES } from '../../site/app/js/osint-core.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

ok('CSV with quotes, doubled quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
});
const sdn = buildSanctions(fx('SDN.CSV'), fx('ALT.CSV'), fx('ADD.CSV'));
ok('sanctions rows joined with aliases and countries', () => {
  assert.equal(sdn.length, 4);
  const bnc = sdn.find((r) => r[0] === 306);
  assert.equal(bnc[1], 'BANCO NACIONAL DE CUBA');
  assert.deepEqual(bnc[5], ['BNC', 'NATIONAL BANK OF CUBA']);
  assert.equal(bnc[4], 'Japan; Cuba');
  assert.match(bnc[6], /a\.k\.a\. "BNC"/);
  assert.equal(sdn.find((r) => r[0] === 9999)[3], 'SDGT IRGC');
  assert.equal(sdn.find((r) => r[0] === 36)[2], 'entity');
});
ok('KEV keeps valid CVE ids only', () => {
  const k = buildKev(fx('known_exploited_vulnerabilities.json'));
  assert.equal(k.count, 1); assert.equal(k.ids['CVE-2021-44228'][4], 1);
});
ok('classify recognises each lookup kind', () => {
  assert.equal(classify('example.com').kind, 'domain');
  assert.equal(classify('https://www.Example.co.uk/path').value, 'www.example.co.uk');
  assert.equal(classify('1.1.1.1').kind, 'ip');
  assert.equal(classify('2606:4700:4700::1111').kind, 'ip');
  assert.equal(classify('AS13335').kind, 'asn');
  assert.equal(classify('as 15169').value, '15169');
  assert.equal(classify('cve-2021-44228').value, 'CVE-2021-44228');
  assert.equal(classify('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').kind, 'btc');
  assert.equal(classify('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').kind, 'btc');
  assert.equal(classify('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045').kind, 'eth');
  assert.equal(classify('192.168.1.1').kind, 'private');
  assert.equal(classify('localhost').kind, 'unknown');
  assert.equal(classify('Banco Nacional').kind, 'name');
});
ok('sanctions search matches names, aliases and is accent and order insensitive', () => {
  assert.equal(searchSanctions(sdn, 'national bank cuba')[0][0], 306);
  assert.equal(searchSanctions(sdn, 'BNC')[0][0], 306);
  assert.equal(searchSanctions(sdn, 'person example')[0][0], 9999);
  assert.equal(searchSanctions(sdn, 'zz').length, 0);
});
ok('conflict zone counts use each zone’s box', () => {
  const pts = [{ lat: 48, lng: 35, count: 3 }, { lat: 31.5, lng: 34.4, count: 2 }, { lat: 0, lng: 0, count: 9 }];
  const c = zoneCounts(pts);
  assert.equal(c.ukraine, 3); assert.equal(c.gaza, 2);
  assert.ok(CONFLICT_ZONES.length >= 13);
});
console.log(`SUMMARY ${n} / ${n}`);
