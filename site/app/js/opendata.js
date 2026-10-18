// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: open data in place of World Monitor's curated lists (HANDOFF.md section 9, item 9).
// Infrastructure layers that started with World Monitor's lists can draw independently sourced open data instead:
// Wikidata (nuclear plants, spaceports, exchanges and central banks, mines), the NGA World Port Index, TeleGeography's
// cable map and the EIA's chokepoints. tools/fetch-open-data.mjs writes the files to the `open-data` branch monthly;
// the chokepoints ship with the site. Choose with "datasets" in config.json, ?datasets=… or About → Datasets:
//   auto          open data where its file exists, World Monitor's list otherwise (the default)
//   open          open data only (a layer whose file is missing shows an error)
//   worldmonitor  World Monitor's lists, as before v2.9
// World Monitor's credit stays in About, the attribution line and NOTICE.md whichever is chosen.
import { getSnapshot, getLocal, appConfig, feedsReady } from './feeds.js';

export const DATASET_MODES = {
  auto: 'Open data where it is available, World Monitor’s lists otherwise',
  open: 'Open data only',
  worldmonitor: 'World Monitor’s curated lists (as before v2.9)',
};
/** Open replacement for each layer: the file, the source key in sources.js, a short name and the terms. */
export const OPEN_DATA = {
  cables: { file: 'cables.json', source: 'telegeography', name: 'TeleGeography Submarine Cable Map', terms: 'CC BY-NC-SA 3.0' },
  ports: { file: 'ports.json', source: 'ngawpi', name: 'NGA World Port Index', terms: 'Public domain' },
  nuclear: { file: 'nuclear.json', source: 'wikidata', name: 'Wikidata', terms: 'CC0 1.0' },
  spaceports: { file: 'spaceports.json', source: 'wikidata', name: 'Wikidata', terms: 'CC0 1.0' },
  economic: { file: 'economic.json', source: 'wikidata', name: 'Wikidata', terms: 'CC0 1.0' },
  minerals: { file: 'minerals.json', source: 'wikidata', name: 'Wikidata', terms: 'CC0 1.0' },
  waterways: { local: 'data/open/waterways.json', source: 'eia', name: 'U.S. Energy Information Administration', terms: 'Public domain' },
};
/** Layers that still have only World Monitor's list. */
export const WM_ONLY = ['pipelines', 'routes', 'datacenters', 'conflicts', 'hotspots'];

const KEY = 'global-intelligence-atlas-datasets';
const valid = (m) => Object.hasOwn(DATASET_MODES, m ?? '');
export function datasetMode() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('datasets') : null;
  if (valid(q)) return q;
  try { const s = localStorage.getItem(KEY); if (valid(s)) return s; } catch { /* storage blocked */ }
  return valid(appConfig().datasets) ? appConfig().datasets : 'auto';
}
export function setDatasetMode(m) {
  if (!valid(m)) return;
  try { localStorage.setItem(KEY, m); } catch { /* storage blocked */ }
  const u = new URL(location.href); if (u.searchParams.has('datasets')) { u.searchParams.set('datasets', m); history.replaceState(null, '', u); }
}

/** Last origin of each layer's data ('open' or 'worldmonitor'), for About → Datasets and checks. */
export const origins = {};

/** The rows a layer draws: open data or World Monitor's list (`wm` returns it), by the chosen mode. */
export async function infraData(id, wm) {
  await feedsReady;
  const mode = datasetMode(); const o = OPEN_DATA[id]; let why = '';
  if (o && mode !== 'worldmonitor') {
    try {
      const j = o.local ? await getLocal(o.local) : await getSnapshot(o.source, o.file, { branch: 'open-data', ttl: 24 * 3600_000 });
      if (!Array.isArray(j?.rows) || !j.rows.length) throw new Error(`${o.file ?? o.local} has no rows`);
      const rows = [...j.rows]; origins[id] = 'open';
      return Object.assign(rows, { origin: 'open', statusNote: `${rows.length.toLocaleString()} from ${o.name} (open data, ${o.terms})` });
    } catch (e) {
      if (mode === 'open') throw new Error(`open data not available yet: ${e.message}`);
      why = e.message;
    }
  }
  const rows = [...(await wm())]; origins[id] = 'worldmonitor';
  return Object.assign(rows, { origin: 'worldmonitor', statusNote: why ? `World Monitor’s list (open data not available yet: ${why})` : undefined });
}
