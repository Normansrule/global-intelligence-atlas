// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the rest of World Monitor's static map datasets (github.com/koala73/worldmonitor,
// (C) 2024-2026 Elie Habib, AGPL-3.0-only), so the atlas follows World Monitor's baseline catalogue:
// military bases, gamma irradiators, tech headquarters, cloud regions, AI research labs, startup ecosystems and
// accelerators, extra financial centres, commodity hubs and export ports, mines and processing plants, and Gulf
// foreign direct investment. tools/extract-upstream-data.mjs copies them into data/worldmonitor-static.json, already
// de-duplicated against the lists GIA draws elsewhere (Financial centres, Critical minerals). Every layer here is a few
// hundred markers at most and goes through the shared marker pass (one instanced mesh for the columns, a capped set
// of pins), so turning all of them on adds no per-item meshes.
import { worldMonitorData } from './layers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (t, s = '') => `<div class="tip"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
const point = (layer, d, color, r = 0.2, alt = 0.012, t = '') => ({ lat: d.lat, lng: d.lon, color, r, alt, tip: t, ref: { layer, d } });
const wiki = (q) => ({ label: 'Wikipedia', url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}` });
const WM_REPO = 'https://github.com/koala73/worldmonitor/blob/main/';
const credit = (file) => ({ label: `World Monitor: ${file}`, url: WM_REPO + file });
const CREDIT_ROW = ['Data', 'World Monitor by Elie Habib (AGPL-3.0), curated static list'];
const list = (a, n = 6) => (a?.length ? a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '') : '—');
const num = (x) => (x == null ? '—' : Number(x).toLocaleString());
const usd = (x) => (x == null ? '—' : x >= 1e9 ? `$${(x / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} billion` : x >= 1e6 ? `$${(x / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} million` : `$${num(x)}`);
const from = (key) => async () => (await worldMonitorData())[key] ?? [];
const rows = (pairs) => [...pairs.filter(([, v]) => v != null && v !== '' && v !== '—'), CREDIT_ROW];

// ================================================================ GEOPOLITICS
const BASE_OPERATORS = {
  'us-nato': ['United States and NATO', '#6fb8ff'], china: ['China', '#ff5f6d'], russia: ['Russia', '#e0a05a'],
  uk: ['United Kingdom', '#9fc3e6'], france: ['France', '#b7a3ff'], india: ['India', '#ffb35c'],
  italy: ['Italy', '#7ed6a0'], uae: ['United Arab Emirates', '#e3c45b'], japan: ['Japan', '#f5f5f5'],
};
const baseOp = (b) => BASE_OPERATORS[b.type] ?? [b.type, '#d98c6a'];

export const basesLayer = {
  id: 'bases', pin: 'badge', group: 'geo', label: 'Military bases', swatch: '#d98c6a', on: false, sources: ['worldmonitor'],
  load: from('bases'),
  channels(bs) {
    return { points: bs.map((b) => point('bases', b, b.status === 'closed' ? 'rgba(217,140,106,0.45)' : baseOp(b)[1], 0.17, 0.01, tip(b.name, `${baseOp(b)[0]}${b.country ? ` · in ${b.country}` : ''}`))) };
  },
  describe(b) {
    return {
      title: b.name, sub: `${baseOp(b)[0]} base${b.country ? ` · host: ${b.country}` : ''}`, probe: [b.lat, b.lon],
      rows: rows([['Operated by', baseOp(b)[0]], ['Host country', b.country], ['Branch', b.arm], ['Status', b.status ?? 'active']]),
      body: b.description,
      links: [wiki(b.name), credit('shared/military-bases-data.ts')],
    };
  },
  learn: {
    what: 'Overseas and key home military bases of the United States and NATO, China, Russia, the United Kingdom, France, India, Italy, the United Arab Emirates and Japan, coloured by the country that runs them. Faded markers are closed.',
    how: 'World Monitor’s list, built from the Overseas Military Bases dataset of Asian Religious Connections (ASIAR, University of Hong Kong, 2020) with status changes since, such as the French withdrawals from the Sahel in 2024–25 and the Chinese naval facility at Ream, Cambodia, plus major home bases.',
    try: 'Turn on Chokepoints: count how many foreign bases sit within a day’s sailing of Bab-el-Mandeb and the Strait of Hormuz.',
    refs: ['worldmonitor'],
  },
};

const SECTOR_COLORS = { ports: '#9fc3e6', energy: '#ffb35c', manufacturing: '#c9a66b', telecoms: '#b7a3ff', logistics: '#7ed6c4', mining: '#c9a66b', infrastructure: '#e3c45b' };
export const gulfFdiLayer = {
  id: 'gulffdi', pin: 'bank', group: 'geo', label: 'Gulf investments abroad', swatch: '#e3c45b', on: false, sources: ['worldmonitor'],
  load: from('gulfInvestments'),
  channels(gs) {
    return { points: gs.map((g) => point('gulffdi', g, SECTOR_COLORS[g.sector] ?? '#e3c45b', 0.14 + Math.min(0.2, Math.log10(1 + (g.investmentUSD ?? 100)) * 0.04), 0.01, tip(g.assetName, `${g.investingEntity} (${g.investingCountry}) · ${g.targetCountry}`))) };
  },
  describe(g) {
    return {
      title: g.assetName, sub: `${g.assetType} · ${g.targetCountry}`, probe: [g.lat, g.lon],
      rows: rows([['Investor', `${g.investingEntity} (${g.investingCountry})`], ['Sector', g.sector], ['Investment', g.investmentUSD != null ? usd(g.investmentUSD * 1e6) : null], ['Stake', g.stakePercent != null ? `${g.stakePercent} %` : null],
        ['Status', g.status], ['Announced', g.yearAnnounced], ['Operational', g.yearOperational], ['Tags', g.tags?.length ? g.tags.join(', ') : null]]),
      body: g.description,
      links: [...(g.sourceUrl ? [{ label: 'Source', url: g.sourceUrl }] : []), credit('src/config/gulf-fdi.ts')],
    };
  },
  learn: {
    what: 'Ports, power plants, telecoms and other critical infrastructure abroad that Saudi Arabia and the United Arab Emirates own or fund: DP World, AD Ports, Mubadala, ADIA, ADNOC, Masdar, PIF, Saudi Aramco, ACWA Power and others. Colour shows the sector; size grows with the amount invested.',
    how: 'World Monitor’s seed database of announced deals, compiled from company reports and press releases. Amounts are in U.S. dollars as announced, not adjusted.',
    try: 'Turn on Ports and Trade routes, then see how many container terminals along the China–Europe route have a Gulf owner.',
    refs: ['worldmonitor'],
  },
};

// ================================================================ INFRASTRUCTURE
export const irradiatorsLayer = {
  id: 'irradiators', pin: 'nuclear', group: 'infra', label: 'Gamma irradiators', swatch: '#c6f06e', on: false, sources: ['worldmonitor', 'iaea'],
  load: from('irradiators'),
  channels(gs) { return { points: gs.map((g) => point('irradiators', g, '#c6f06e', 0.12, 0.006, tip(`Gamma irradiator · ${g.city}`, g.country))) }; },
  describe(g) {
    return {
      title: `Gamma irradiator, ${g.city}`, sub: g.country, probe: [g.lat, g.lon],
      rows: rows([['City', g.city], ['Country', g.country], ['Operator', g.organization], ['Facility number', g.id]]),
      body: 'Industrial gamma irradiators hold large cobalt-60 sources (often over a million curies) to sterilise medical supplies, preserve food and treat materials. They are among the strongest radioactive sources in civilian use, which is why their security is regulated closely.',
      links: [{ label: 'IAEA Database on Industrial Irradiation Facilities', url: 'https://nucleus.iaea.org/sites/accelerators/Pages/Irradiator.aspx' }, credit('src/config/irradiators.ts')],
    };
  },
  learn: {
    what: 'Industrial gamma irradiation facilities: plants that sterilise medical devices and treat food with cobalt-60 or caesium-137 sources.',
    how: 'World Monitor extracted these positions from the International Atomic Energy Agency’s Database on Industrial Irradiation Facilities (DIIF) in January 2026. Positions are at city level.',
    try: 'Turn on Nuclear sites as well: irradiators are far more numerous and sit near cities and hospitals, not on coasts by cooling water.',
    refs: ['worldmonitor', 'iaea'],
  },
};

const HQ_TYPE = { faang: ['Big Tech', '#b7a3ff'], unicorn: ['Unicorn', '#ff8ad8'], public: ['Listed company', '#7ed6c4'] };
export const techHqLayer = {
  id: 'techhqs', pin: 'chip', group: 'infra', label: 'Tech headquarters', swatch: '#7ed6c4', on: false, sources: ['worldmonitor'],
  load: from('techHqs'),
  channels(ts) { return { points: ts.map((t) => point('techhqs', t, (HQ_TYPE[t.type] ?? HQ_TYPE.public)[1], t.type === 'faang' ? 0.24 : 0.14, t.type === 'faang' ? 0.02 : 0.008, tip(t.company, `${(HQ_TYPE[t.type] ?? HQ_TYPE.public)[0]} · ${t.city}`))) }; },
  describe(t) {
    return {
      title: t.company, sub: `${t.city}, ${t.country}`, wiki: t.company, probe: [t.lat, t.lon],
      rows: rows([['Kind', (HQ_TYPE[t.type] ?? HQ_TYPE.public)[0]], ['Market value', t.marketCap], ['Employees', t.employees != null ? num(t.employees) : null]]),
      links: [wiki(t.company), credit('src/config/tech-geo.ts')],
    };
  },
  learn: {
    what: 'Headquarters of the biggest technology companies, unicorns (private start-ups valued at over $1 billion) and listed tech firms worldwide. Violet: Big Tech; pink: unicorns; teal: other listed companies.',
    how: 'World Monitor’s tech-geography list, compiled from company filings and public rankings; market values are indicative, not live.',
    try: 'Zoom into the San Francisco Bay Area, then Shenzhen, then Bangalore and compare how tightly each cluster packs together.',
    refs: ['worldmonitor'],
  },
};

const CLOUD = { aws: ['Amazon Web Services', '#ffb35c'], gcp: ['Google Cloud', '#6fb8ff'], azure: ['Microsoft Azure', '#4ad4ff'], cloudflare: ['Cloudflare', '#ff8a4c'] };
export const cloudLayer = {
  id: 'cloud', pin: 'server', group: 'infra', label: 'Cloud regions', swatch: '#6fb8ff', on: false, sources: ['worldmonitor'],
  load: from('cloudRegions'),
  channels(cs) { return { points: cs.map((c) => point('cloud', c, (CLOUD[c.provider] ?? ['', '#6fb8ff'])[1], 0.15 + (c.zones ?? 2) * 0.02, 0.008 + (c.zones ?? 2) * 0.003, tip(c.name, `${(CLOUD[c.provider] ?? [c.provider])[0]} · ${c.city}`))) }; },
  describe(c) {
    return {
      title: c.name, sub: `${(CLOUD[c.provider] ?? [c.provider])[0]} · ${c.city}, ${c.country}`, probe: [c.lat, c.lon],
      rows: rows([['Provider', (CLOUD[c.provider] ?? [c.provider])[0]], ['Region code', c.id.replace(/^(aws|gcp|azure|cloudflare)-/, '')], ['City', c.city], ['Availability zones', c.zones]]),
      body: 'A cloud region is a cluster of data centres; its availability zones are separate buildings with their own power and cooling, close enough for fast links but far enough apart that one fire or flood does not take them all down.',
      links: [credit('src/config/tech-geo.ts')],
    };
  },
  learn: {
    what: 'Major cloud regions of Amazon Web Services (amber), Google Cloud (blue), Microsoft Azure (cyan) and Cloudflare (orange). Bigger markers have more availability zones.',
    how: 'World Monitor’s list of the main regions, from each provider’s published region maps; positions are the metro area, not the exact buildings.',
    try: 'Turn on Undersea cables: the big regions sit where many cables land, like Ashburn, Dublin, Frankfurt and Singapore.',
    refs: ['worldmonitor'],
  },
};

const LAB_TYPE = { industry: '#b7a3ff', corporate: '#b7a3ff', academic: '#7ed6a0', government: '#6fb8ff', nonprofit: '#ffd37a', 'research institute': '#7ed6c4' };
export const aiLabsLayer = {
  id: 'ailabs', pin: 'bolt', group: 'infra', label: 'AI research labs', swatch: '#b7a3ff', on: false, sources: ['worldmonitor'],
  load: from('aiLabs'),
  channels(ls) { return { points: ls.map((l) => point('ailabs', l, LAB_TYPE[l.type] ?? '#b7a3ff', 0.2, 0.012, tip(l.name, `${l.type} · ${l.city ?? l.country}`))) }; },
  describe(l) {
    return {
      title: l.name, sub: `${l.type} lab · ${[l.city, l.country].filter(Boolean).join(', ')}`, wiki: l.name, probe: [l.lat, l.lon],
      rows: rows([['Kind', l.type], ['Part of', l.parent], ['Founded', l.foundedYear], ['Focus', l.focusAreas?.length ? list(l.focusAreas) : null], ['Known for', l.notableWork?.length ? list(l.notableWork, 4) : null], ['Publications', l.publications], ['Faculty', l.faculty]]),
      body: l.description,
      links: [wiki(l.name), credit('src/config/ai-research-labs.ts')],
    };
  },
  learn: {
    what: 'Frontier AI research labs, AI-safety organisations and leading academic AI institutes. Violet: company labs; green: universities; blue: government; gold: non-profits.',
    how: 'World Monitor’s hand-curated list with each lab’s focus areas and best-known work.',
    try: 'Turn on AI data centres: the labs cluster in a few cities, while the compute they use is spread out to wherever power is cheap.',
    refs: ['worldmonitor'],
  },
};

const ECO_TIER = { tier1: 'Global top tier', tier2: 'Major', tier3: 'Established', emerging: 'Emerging' };
const HUB_TIER = { mega: 'Mega hub', major: 'Major hub', emerging: 'Emerging hub' };
export const startupsLayer = {
  id: 'startups', group: 'infra', label: 'Startup ecosystems', swatch: '#ff8ad8', on: false, sources: ['worldmonitor'],
  pin: (d) => (d.kind === 'accelerator' ? 'rocket' : 'city'), legend: [['city', 'Startup ecosystem or hub'], ['rocket', 'Accelerator, incubator or studio']],
  load: from('startups'),
  channels(ss) {
    return {
      points: ss.map((s) => (s.kind === 'accelerator'
        ? point('startups', s, '#ffc4ec', 0.1, 0.005, tip(s.name, `${s.type} · ${s.city}`))
        : point('startups', s, '#ff8ad8', 0.18 + Math.min(0.2, (s.unicorns ?? 0) / 300), 0.01 + Math.min(0.06, (s.unicorns ?? 0) / 1500), tip(s.name, `${ECO_TIER[s.ecosystemTier] ?? HUB_TIER[s.hubTier] ?? 'Startup hub'} · ${s.city}`)))),
    };
  },
  describe(s) {
    if (s.kind === 'accelerator') {
      return {
        title: s.name, sub: `${s.type} · ${s.city}, ${s.country}`, wiki: s.name, probe: [s.lat, s.lon],
        rows: rows([['Kind', s.type], ['Founded', s.founded], ['Alumni', s.notable?.length ? list(s.notable) : null]]),
        links: [wiki(s.name), credit('src/config/tech-geo.ts')],
      };
    }
    return {
      title: s.name, sub: `${ECO_TIER[s.ecosystemTier] ?? HUB_TIER[s.hubTier] ?? 'Startup hub'} · ${s.city}, ${s.country}`, probe: [s.lat, s.lon],
      rows: rows([['Also known as', s.hub && s.hub !== s.name ? s.hub : null], ['Venture funding, 2024', s.totalFunding2024 != null ? usd(s.totalFunding2024) : null], ['Active startups', s.activeStartups != null ? num(s.activeStartups) : null],
        ['Unicorns', s.unicorns], ['Top sectors', s.topSectors?.length ? list(s.topSectors) : null], ['Major investors', s.majorVCs?.length ? list(s.majorVCs, 4) : null], ['Notable startups', s.notableStartups?.length ? list(s.notableStartups) : null],
        ['Typical seed round', s.avgSeedRound != null ? usd(s.avgSeedRound) : null], ['Typical Series A', s.avgSeriesA != null ? usd(s.avgSeriesA) : null]]),
      body: s.description,
      links: [credit(s.kind === 'hub' ? 'src/config/tech-geo.ts' : 'src/config/startup-ecosystems.ts')],
    };
  },
  learn: {
    what: 'Startup and venture-capital ecosystems (pink, bigger with more unicorns), with venture funding, active startups and leading investors, plus accelerators, incubators and venture studios (light pink).',
    how: 'World Monitor keeps two overlapping lists, startup hubs and startup ecosystems; the atlas folds a hub into the ecosystem in the same city and keeps the rest. Funding figures are World Monitor’s 2024 estimates.',
    try: 'Click the key to show only accelerators, then zoom into the Bay Area, London and Bangalore.',
    refs: ['worldmonitor'],
  },
};

const FIN_KIND = { centre: 'Financial centre', exchange: 'Stock exchange', bank: 'Central bank or monetary institution' };
export const financeLayer = {
  id: 'finance', group: 'infra', label: 'More financial centres', swatch: '#c7d8e4', on: false, sources: ['worldmonitor'],
  pin: (d) => (d.kind === 'centre' ? 'city' : 'bank'), legend: [['city', 'Financial centre'], ['bank', 'Exchange or central bank']],
  load: from('finance'),
  channels(fs) {
    return { points: fs.map((f) => point('finance', f, f.kind === 'centre' ? '#c7d8e4' : f.kind === 'bank' ? '#e9d79a' : '#e9f2f7', f.kind === 'centre' ? 0.3 - Math.min(0.12, (f.gfciRank ?? 20) / 150) : 0.2, 0.015, tip(f.shortName && f.shortName !== f.name ? `${f.name} (${f.shortName})` : f.name, `${FIN_KIND[f.kind]} · ${f.city}`))) };
  },
  describe(f) {
    return {
      title: f.name, sub: `${FIN_KIND[f.kind]} · ${f.city}, ${f.country}`, wiki: f.name, probe: [f.lat, f.lon],
      rows: rows([['Short name', f.shortName], ['Kind', f.kind === 'centre' ? `${f.type} centre` : f.type ?? f.tier], ['Global Financial Centres Index rank', f.gfciRank], ['Specialties', f.specialties?.length ? f.specialties.join(', ') : null],
        ['Market value', f.marketCap != null ? `$${f.marketCap} trillion` : null], ['Trading hours', f.tradingHours], ['Time zone', f.timezone], ['Currency', f.currency]]),
      body: f.description,
      links: [wiki(f.name), credit('src/config/finance-geo.ts')],
    };
  },
  learn: {
    what: 'Global financial centres with their Global Financial Centres Index rank and specialties, plus the stock exchanges and central banks that the Financial centres layer does not already show (Taiwan, Jakarta, Bangkok, Lima, Mexico City, Moscow, New Zealand, Canada, Korea, Brazil, Saudi Arabia, the BIS and the IMF).',
    how: 'World Monitor’s finance-geography list, with anything already in its economic-centres list (which the Financial centres layer draws) left out.',
    try: 'Turn on Financial centres too, then Day and night, and follow the trading day west from Wellington to New York.',
    refs: ['worldmonitor'],
  },
};

const COM_KIND = { exchange: ['Commodity exchange', 'bank', '#e3c45b'], port: ['Energy port', 'anchor', '#9fc3e6'], refinery: ['Refining and energy hub', 'oil', '#c9803e'], 'export-port': ['Commodity export port', 'anchor', '#c9a66b'] };
const comKind = (c) => COM_KIND[c.kind] ?? COM_KIND.exchange;
export const commoditiesLayer = {
  id: 'commodities', group: 'infra', label: 'Commodity hubs and ports', swatch: '#e3c45b', on: false, sources: ['worldmonitor'],
  pin: (d) => comKind(d)[1], legend: [['bank', 'Commodity exchange'], ['anchor', 'Commodity port'], ['oil', 'Refining hub']],
  load: from('commodities'),
  channels(cs) { return { points: cs.map((c) => point('commodities', c, comKind(c)[2], 0.22 + Math.min(0.15, (c.annualVolumeMt ?? 0) / 4000), 0.015, tip(c.name, `${comKind(c)[0]} · ${(c.commodities ?? []).slice(0, 3).join(', ')}`))) }; },
  describe(c) {
    return {
      title: c.name, sub: `${comKind(c)[0]} · ${[c.city, c.country].filter(Boolean).join(', ')}`, wiki: c.name, probe: [c.lat, c.lon],
      rows: rows([['Kind', comKind(c)[0]], ['Commodities', c.commodities?.length ? c.commodities.join(', ') : null], ['Annual throughput', c.annualThroughput ?? (c.annualVolumeMt != null ? `${num(c.annualVolumeMt)} million tonnes` : null)]]),
      body: c.significance ?? c.description,
      links: [wiki(c.name), credit(c.kind === 'export-port' ? 'src/config/commodity-geo.ts' : 'src/config/finance-geo.ts')],
    };
  },
  learn: {
    what: 'Where raw materials are priced and shipped: commodity futures exchanges (gold), the big energy port and refining hub (blue and amber), and the bulk ports that export iron ore, coal, copper and other minerals (tan).',
    how: 'World Monitor’s commodity hubs (finance list) and commodity export ports (commodity list); the CME Group is left out because the Financial centres layer already has it.',
    try: 'Turn on Mines and processing plants and trace ore from a Pilbara mine to Port Hedland, then along Trade routes to China.',
    refs: ['worldmonitor'],
  },
};

const MINE_STATUS = { producing: 1, development: 0.7, 'care-and-maintenance': 0.45, exploration: 0.55, closed: 0.35 };
export const miningLayer = {
  id: 'mining', group: 'infra', label: 'Mines and processing plants', swatch: '#b08d5a', on: false, sources: ['worldmonitor'],
  pin: (d) => (d.kind === 'plant' ? 'factory' : 'mine'), legend: [['mine', 'Mine'], ['factory', 'Smelter, refinery or processing plant']],
  load: from('mining'),
  channels(ms) {
    return { points: ms.map((m) => point('mining', m, m.kind === 'plant' ? '#d7b98a' : `rgba(176,141,90,${MINE_STATUS[m.status] ?? 1})`, 0.26, 0.02, tip(m.name, `${m.kind === 'plant' ? `${m.type} · ` : ''}${m.mineral} · ${m.country}`))) };
  },
  describe(m) {
    return {
      title: m.name, sub: `${m.kind === 'plant' ? m.type : 'Mine'} · ${m.mineral} · ${m.country}`, wiki: m.name, probe: [m.lat, m.lon],
      rows: rows([['Mineral', m.mineral], ['Also processes', m.materials?.length ? m.materials.join(', ') : null], ['Operator', m.operator], ['Status', m.status], ['Mining method', m.openPitOrUnderground],
        ['Rank', m.productionRank], ['Capacity', m.productionCapacity ?? m.outputCapacity ?? (m.capacityTpa != null ? `${num(m.capacityTpa)} t a year` : null)], ['Output', m.annualOutput]]),
      body: m.significance,
      links: [wiki(m.name), credit('src/config/commodity-geo.ts')],
    };
  },
  learn: {
    what: 'The world’s most significant gold, silver, copper, iron ore, coal, platinum, uranium and other mines, and the smelters, refineries and separation plants that turn ore into metal. Faded mines are not producing yet or are idle.',
    how: 'World Monitor’s commodity-geography list; mines that the Critical minerals layer already shows are left out so nothing is drawn twice.',
    try: 'Click the key to show only processing plants and see how many rare-earth and battery-metal plants sit in China.',
    refs: ['worldmonitor'],
  },
};

/** Layers in the order they join the panel, with the layer each follows (see registry.js). */
export const WM_BASELINE = [
  [miningLayer, 'minerals'], [commoditiesLayer, 'mining'], [financeLayer, 'economic'], [techHqLayer, 'datacenters'], [cloudLayer, 'techhqs'],
  [aiLabsLayer, 'cloud'], [startupsLayer, 'ailabs'], [irradiatorsLayer, 'nuclear'], [basesLayer, 'hotspots'], [gulfFdiLayer, 'bases'],
];
