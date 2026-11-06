#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: writes site/app/data/offline-pack.json, the list of files that "Save everything for
// offline" (Tools → Offline kit) stores on a device. Every file the site serves, except the README media, the
// video sources and anything over 25 MB. Run it after adding or removing files:  node tools/build-offline-pack.mjs
// The files bots rebuild (cameras, webcams, sanctions lists) keep their names, so the list stays right between runs;
// a file that has gone is skipped on the device, never an error.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'site');
const SKIP_DIR = new Set(['docs-media', 'node_modules', '.git']);
const SKIP_FILE = /(^|\/)(\.|offline-pack\.json$)|\.(map|md|mp4|webm|mov)$/i;
const MAX = 25 * 1024 * 1024;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIR.has(name)) walk(p); continue; }
    const rel = relative(ROOT, p).split(sep).join('/');
    if (SKIP_FILE.test(rel) || st.size > MAX) continue;
    // index.html pages are stored under their folder address too, which is how they are opened
    files.push([rel.replace(/(^|\/)index\.html$/, '$1') || './', st.size]);
  }
})(ROOT);
const bytes = files.reduce((s, [, b]) => s + b, 0);
const out = { note: 'Built by tools/build-offline-pack.mjs. Paths are relative to the site root.', generatedAt: new Date().toISOString().slice(0, 10), count: files.length, bytes, files };
writeFileSync(join(ROOT, 'app', 'data', 'offline-pack.json'), `${JSON.stringify(out)}\n`);
console.log(`offline-pack.json: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
