#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: writes one <link rel="modulepreload"> for every script the app imports at start-up into
// site/app/index.html, between the "preload:start" and "preload:end" comments. Without them the browser finds each
// level of imports only after the level above has downloaded (about eight round trips); with them it asks for all
// of them at once. Modules loaded later on purpose (import('./closeup.js')) are left out.
//   node tools/build-preload.mjs          rewrite the list
//   node tools/build-preload.mjs --check  exit 1 if the list is out of date (used by the tests)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'app');
const HTML = join(APP, 'index.html');
const STATIC = /^\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

/** Every module reachable through static imports from the entry points, in breadth-first order. */
export function staticGraph(entries) {
  const seen = new Set(); const queue = [...entries];
  while (queue.length) {
    const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
    if (!f.endsWith('.js')) continue; // the vendor bundle has no relative imports to follow
    const src = readFileSync(join(APP, f), 'utf8');
    for (const m of src.matchAll(STATIC)) queue.push(relative(APP, normalize(join(APP, dirname(f), m[1]))).split('\\').join('/'));
  }
  return [...seen];
}
const list = staticGraph(['js/main.js']).filter((f) => f !== 'js/main.js');
const block = ['  <link rel="modulepreload" href="js/main.js" />', ...list.map((f) => `  <link rel="modulepreload" href="${f}" />`)].join('\n');
const html = readFileSync(HTML, 'utf8');
const re = /( *<!-- preload:start[^>]*-->\n)[\s\S]*?( *<!-- preload:end -->)/;
if (!re.test(html)) { console.error('index.html has no preload:start / preload:end markers'); process.exit(1); }
const next = html.replace(re, (_, a, b) => `${a}${block}\n${b}`);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('FAIL the module preload list in site/app/index.html is out of date: run node tools/build-preload.mjs'); process.exit(1); }
  console.log(`PASS the module preload list is current (${list.length + 1} modules)`);
} else { writeFileSync(HTML, next); console.log(`Wrote ${list.length + 1} module preloads`); }
