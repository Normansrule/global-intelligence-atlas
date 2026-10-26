// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the layer registry.
//
// Every layer is a self-describing module: an object with id, group, label, swatch, sources, refresh and the hooks
// load / channels / describe / learn (see HANDOFF.md section 4). This file lists the layers the app adds on top of the
// core catalogue in layers.js, where each one goes, and which editions include it. manifest() turns any layer into a
// plain description (id, group, sources with their licences, refresh, capabilities) for the About panel, the
// downloadable manifest and checks; validateLayer() checks a layer, including plug-ins loaded at run time.
//
// Editions ship different atlases from one codebase: choose one with "edition" in config.json or ?edition=… in the
// address. Plug-ins are extra layer modules in app/plugins/<name>.js, listed in config.json "plugins" or ?plugins=…;
// see app/plugins/README.md.
import { flightsLayer } from './flights.js';
import { camerasLayer, alprLayer } from './cameras.js';
import { citiesLayer, airportsLayer } from './places.js';
import { landmarksLayer } from './landmarks.js';
import { newsLayer } from './news.js';
import { crimeLayer } from './crime.js';
import { webcamsLayer } from './worldcams.js';
import { powerLayer, internetLayer, radioLayer, shipsLayer, overlayLayer } from './networks.js';
import { launchesLayer, alertsLayer } from './launches.js';
import { windLayer } from './wind.js';
import { skyLayer } from './skyfx.js';
import { moonLayer } from './moon.js';
import { planetsLayer } from './cosmos.js';
import { firesLayer, radarLayer } from './hazards.js';
import { replayLayer } from './replay.js';
import { pesticideUseLayer, pesticideEstimatesLayer, toxicReleasesLayer, calEnviroScreenLayer, enforcementLayer, waterQualityLayer } from './chemicals.js';
import { WM_BASELINE } from './wmbaseline.js';
import { housePricesLayer, homeValuesLayer, propertySalesLayer, exportsLayer, industryLayer, osmWorksLayer } from './economy.js';
import { SOURCES } from './sources.js';

/** Groups the registry adds to the core ones, with the index they take. */
export const EXTRA_GROUPS = [[1, { id: 'cams', label: 'Cameras' }], [3, { id: 'places', label: 'Places' }], [2, { id: 'civic', label: 'Civic data' }], [6, { id: 'chem', label: 'Chemicals and environment' }], [7, { id: 'econ', label: 'Economy, property and industry' }]];

/** Layers added on top of layers.js, in order: make(api, ctx) returns the layer, after names the layer it follows. */
export const REGISTRY = [
  { make: (api) => flightsLayer(api), after: 'events' },
  { make: (api) => camerasLayer(api), after: 'aurora' },
  { make: (api) => webcamsLayer(api), after: 'cameras' },
  { make: (api) => alprLayer(api), after: 'webcams' },
  { make: () => citiesLayer, after: 'grid' },
  { make: () => airportsLayer, after: 'cities' },
  { make: (api) => landmarksLayer(api), after: 'cities' },
  { make: () => newsLayer, after: 'aircraft' },
  { make: () => crimeLayer, after: 'alpr', group: 'civic' },
  { make: () => shipsLayer, after: 'news' },
  { make: () => radioLayer, after: 'alpr' },
  { make: (api) => overlayLayer(api), after: 'satellites' },
  { make: () => internetLayer, after: 'cables' },
  { make: () => powerLayer, after: 'nuclear' },
  { make: () => launchesLayer, after: 'stations' },
  { make: () => alertsLayer, after: 'events' },
  { make: (api) => windLayer(api), after: 'grid' },
  { make: (api) => skyLayer(api), after: 'wind' },
  { make: () => moonLayer, after: 'sun' },
  { make: () => planetsLayer, after: 'moon' },
  { make: (api) => firesLayer(api), after: 'events' },
  { make: (api) => radarLayer(api), after: 'fires' },
  { make: (api, ctx) => ctx.watch.layer, after: 'alerts' },
  { make: (api) => replayLayer(api), after: 'radar' },
  { make: (api) => pesticideUseLayer(api), after: 'replay' },
  { make: (api) => pesticideEstimatesLayer(api), after: 'pur' },
  { make: () => toxicReleasesLayer(), after: 'pestus' },
  { make: (api) => calEnviroScreenLayer(api), after: 'tri' },
  { make: () => enforcementLayer(), after: 'ces' },
  { make: (api) => waterQualityLayer(api), after: 'echo' },
  // v2.11 economy, property and industry (economy.js)
  { make: (api) => housePricesLayer(api), after: 'wqp' },
  { make: (api) => homeValuesLayer(api), after: 'houseprices' },
  { make: (api) => propertySalesLayer(api), after: 'homevalues' },
  { make: (api) => exportsLayer(api), after: 'propsales' },
  { make: (api) => industryLayer(api), after: 'exports' },
  { make: (api) => osmWorksLayer(api), after: 'industry' },
  // the rest of World Monitor's static map datasets (wmbaseline.js)
  ...WM_BASELINE.map(([layer, after]) => ({ make: () => layer, after })),
];

/** Editions: what each one leaves out. Layers and rail sections not listed stay. */
export const EDITIONS = {
  full: { label: 'Full atlas', about: 'Every layer and section.', exclude: [], hideSections: [] },
  classroom: {
    label: 'Classroom',
    about: 'For schools: the live Earth, space, science, infrastructure and places, without surveillance cameras, licence-plate readers, crime maps, conflict zones, military bases, news pins, watch areas or the Intel section.',
    exclude: ['cameras', 'webcams', 'alpr', 'crime', 'conflicts', 'hotspots', 'bases', 'news', 'watch', 'declass'],
    hideSections: ['intel'],
  },
  lite: {
    label: 'Lite',
    about: 'For slow computers and phones: leaves out the heaviest layers (camera lists, the wind field, weather radar, replay, crime maps and square-mile pesticide records, home sales by postcode and factories mapped in OpenStreetMap).',
    exclude: ['cameras', 'webcams', 'alpr', 'crime', 'wind', 'radar', 'replay', 'pur', 'propsales', 'osmworks'],
    hideSections: [],
  },
};
export const editionOf = (name) => (Object.hasOwn(EDITIONS, name ?? '') ? name : 'full');

/** Plain description of a layer: what it is, where its data comes from and under which terms, what it can do. */
export function manifest(l, { origin = 'core', editions = EDITIONS } = {}) {
  const sources = (l.sources ?? []).map((id) => ({ id, name: SOURCES[id]?.name ?? null, url: SOURCES[id]?.url ?? null, license: SOURCES[id]?.license ?? null }));
  const caps = [];
  if (l.viewDependent) caps.push('view-dependent');
  if (l.reloadOnView) caps.push('reloads-on-view');
  if (l.timeDriven) caps.push('time-driven');
  if (l.options?.length) caps.push('options');
  if (l.panel) caps.push('panel');
  if (l.stop) caps.push('stop');
  if (l.pin || l.legend) caps.push('pins');
  if (l.describe) caps.push('cards');
  if (l.learn) caps.push('learn');
  return {
    id: l.id, group: l.group, label: l.label, swatch: l.swatch, origin,
    refreshSeconds: l.refresh ? Math.round(l.refresh / 1000) : null,
    sources, licences: [...new Set(sources.map((s) => s.license).filter(Boolean))],
    capabilities: caps,
    editions: Object.entries(editions).filter(([, e]) => !e.exclude.includes(l.id)).map(([k]) => k),
  };
}

/** Problems with a layer object (empty when it is fine). `taken` is the set of ids already in use. */
export function validateLayer(l, { groups = [], taken = new Set() } = {}) {
  const p = [];
  if (!l || typeof l !== 'object') return ['not a layer object'];
  if (typeof l.id !== 'string' || !/^[a-z][a-z0-9]{1,31}$/.test(l.id)) p.push('id must be 2–32 lower-case letters or digits');
  else if (taken.has(l.id)) p.push(`id "${l.id}" is already used`);
  if (!groups.some((g) => g.id === l.group)) p.push(`unknown group "${l.group}"`);
  if (typeof l.label !== 'string' || !l.label.trim()) p.push('label is missing');
  if (typeof l.swatch !== 'string' || !/^#[0-9a-f]{6}$/i.test(l.swatch)) p.push('swatch must be a colour like #4aa3ff');
  if (typeof l.load !== 'function') p.push('load() is missing');
  if (typeof l.channels !== 'function') p.push('channels() is missing');
  if (!Array.isArray(l.sources) || !l.sources.length) p.push('sources must list at least one key from sources.js');
  else for (const s of l.sources) if (!SOURCES[s]) p.push(`source "${s}" is not in sources.js (add it there and to tools/build-references.py)`);
  if (!l.learn?.what) p.push('learn.what is missing (every layer explains itself)');
  return p;
}

/** Plug-in names allowed from the address or config.json: a file name in app/plugins/, nothing else. */
export const pluginNames = (list) => [...new Set((list ?? []).map(String).filter((n) => /^[a-z][a-z0-9-]{0,39}$/.test(n)))];
