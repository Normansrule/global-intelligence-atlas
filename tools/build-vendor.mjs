#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Rebuild site/app/vendor/vendor.min.mjs: globe.gl, three.js and satellite.js in one ES module, so the app
// itself needs no build step. The shipped bundle was made from three 0.186 and satellite.js 5.0.0 with
// globe.gl 2.x; test the globe (tests/e2e) after changing versions, since three.js changes shader chunks.
//   npm i --no-save esbuild globe.gl three@0.186.0 satellite.js@5.0.0
//   node tools/build-vendor.mjs
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';

const entry = '.vendor-entry.mjs';
writeFileSync(entry, "export { default as Globe } from 'globe.gl';\nexport * as THREE from 'three';\nexport * as satellite from 'satellite.js';\n");
try {
  await build({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'eof', outfile: 'site/app/vendor/vendor.min.mjs' });
  console.log('wrote site/app/vendor/vendor.min.mjs');
} finally { rmSync(entry, { force: true }); }
