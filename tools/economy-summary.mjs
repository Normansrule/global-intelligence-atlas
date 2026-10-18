#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: print economy-data status.json as a Markdown table for the workflow's job summary.
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2] ?? 'economy/status.json', 'utf8'));
console.log('### Economy data sources\n\n| Source | OK | Note |\n|---|---|---|');
for (const [k, v] of Object.entries(s.feeds ?? {})) console.log(`| ${k} | ${v.ok ? 'yes' : 'no'} | ${String(v.note ?? '').replace(/\|/g, '/').slice(0, 300)} |`);
