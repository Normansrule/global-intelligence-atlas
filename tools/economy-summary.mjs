#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: print a data branch's status.json as a Markdown table for the workflow's job summary
// (economy.yml, news.yml). Usage: node tools/economy-summary.mjs <status.json> [title]
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2] ?? 'economy/status.json', 'utf8'));
console.log(`### ${process.argv[3] ?? 'Economy data sources'}\n\n| Source | OK | Note |\n|---|---|---|`);
for (const [k, v] of Object.entries(s.feeds ?? {})) console.log(`| ${k} | ${v.ok ? 'yes' : 'no'} | ${String(v.note ?? '').replace(/\|/g, '/').slice(0, 300)} |`);
