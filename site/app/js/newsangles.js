// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.33: what the headlines say about a company or a country, and from which angle.
// Pure functions over the News tab's headlines (news-data branch, tools/fetch-news.mjs), shared by the
// "Companies in the news" layer (companynews.js), the country pages (countrydetail.js) and tests/newsangles.
//
// Only headlines from publishers whose ownership label is public, commercial or intergovernmental are used here;
// state-controlled outlets stay in the News tab (labelled) but are left out of these summaries. A headline counts for
// a name when the name appears in its title as a whole word, with the capitals as written ("Apple", not "apple").
// The angle is read from words in the title (a list below), so it is a guide, not an editor's judgement.

/** Angles, in the order they are shown: id, label, words that suggest it (whole words or phrases, any case). */
export const ANGLES = [
  ['politics', 'Politics and government', ['election', 'elections', 'vote', 'voters', 'president', 'presidential', 'prime minister', 'parliament', 'congress', 'senate', 'senator', 'minister', 'ministers', 'government', 'policy', 'party', 'opposition', 'coalition', 'referendum', 'white house', 'kremlin', 'downing street', 'campaign', 'diplomat', 'diplomatic', 'summit', 'sanctions', 'lawmakers', 'mp', 'mps', 'cabinet', 'trump', 'biden', 'starmer', 'macron', 'putin', 'xi', 'modi', 'zelensky']],
  ['economy', 'Economy, business and markets', ['market', 'markets', 'shares', 'stock', 'stocks', 'profit', 'profits', 'revenue', 'sales', 'earnings', 'economy', 'economic', 'inflation', 'interest rate', 'interest rates', 'tariff', 'tariffs', 'trade', 'exports', 'imports', 'jobs', 'layoffs', 'job cuts', 'investors', 'investment', 'billion', 'trillion', 'deal', 'merger', 'takeover', 'acquisition', 'bank', 'banks', 'prices', 'price', 'budget', 'tax', 'taxes', 'gdp', 'recession', 'growth', 'debt', 'valuation', 'ipo', 'factory', 'supply chain', 'oil', 'customers']],
  ['law', 'Courts and regulation', ['court', 'courts', 'judge', 'lawsuit', 'sued', 'sues', 'antitrust', 'regulator', 'regulators', 'regulation', 'fine', 'fined', 'ban', 'banned', 'bans', 'investigation', 'probe', 'ruling', 'rules', 'legal', 'law', 'laws', 'watchdog', 'commission', 'competition', 'privacy', 'trial', 'charged', 'convicted']],
  ['conflict', 'Conflict and security', ['war', 'attack', 'attacks', 'strike', 'strikes', 'airstrike', 'missile', 'missiles', 'drone', 'drones', 'troops', 'military', 'army', 'killed', 'ceasefire', 'hostage', 'hostages', 'security', 'terror', 'terrorist', 'bomb', 'shelling', 'invasion', 'rebels', 'militants', 'nato', 'weapons', 'police', 'prisoner', 'prisoners', 'soldiers', 'frontline', 'offensive', 'drills', 'warships', 'navy']],
  ['tech', 'Technology and science', ['ai', 'artificial intelligence', 'chip', 'chips', 'semiconductor', 'software', 'app', 'apps', 'iphone', 'smartphone', 'data', 'cyber', 'cyberattack', 'hack', 'hackers', 'online', 'internet', 'tech', 'robot', 'robots', 'space', 'satellite', 'scientists', 'research', 'vaccine', 'nasa']],
  ['climate', 'Climate, energy and environment', ['climate', 'emissions', 'carbon', 'flood', 'floods', 'flooding', 'drought', 'wildfire', 'wildfires', 'heatwave', 'storm', 'hurricane', 'typhoon', 'cyclone', 'earthquake', 'energy', 'renewable', 'solar', 'wind farm', 'nuclear', 'pollution', 'cop30', 'cop31']],
  ['society', 'People and society', ['protest', 'protests', 'protesters', 'union', 'unions', 'workers', 'rights', 'migrants', 'migration', 'refugees', 'asylum', 'school', 'schools', 'students', 'health', 'hospital', 'hospitals', 'doctors', 'women', 'children', 'housing', 'strike action', 'religion', 'church']],
];
const ANGLE_RE = ANGLES.map(([id, , words]) => [id, new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu')]);
export const ANGLE_LABEL = Object.fromEntries([...ANGLES.map(([id, l]) => [id, l]), ['other', 'Other news']]);

/** The angles a headline reads as, best first (at most two); ['other'] when none fits. */
export function anglesOf(title) {
  const t = String(title ?? ''); const hits = [];
  for (const [id, re] of ANGLE_RE) { const m = re.exec(t); if (m) hits.push([id, m.index]); }
  // politics and the courts often come with money words too; the first word in the title leads
  hits.sort((a, b) => a[1] - b[1]);
  return hits.length ? hits.slice(0, 2).map(([id]) => id) : ['other'];
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A matcher for a set of names (whole words, as capitalised), with words that rule a headline out (`not`, any case). */
export function nameMatcher(names, not = []) {
  const list = [...new Set(names.filter((n) => n && n.length >= 2))];
  if (!list.length) return () => false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${list.map(escRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u');
  const no = not.length ? new RegExp(`(^|[^\\p{L}])(${not.map(escRe).join('|')})`, 'iu') : null;
  return (title) => re.test(title) && !(no && no.test(title));
}

/**
 * Other names a company goes by in headlines, and words that mean a headline is about something else with the same
 * name (the Amazon rainforest, an apple orchard). Keyed by World Monitor's tech-headquarters id.
 */
export const COMPANY_ALIASES = {
  apple: { also: ['iPhone', 'iPad', 'Tim Cook', 'App Store'], not: ['orchard', 'orchards', 'cider', 'fruit', 'growers', 'harvest', 'Big Apple'] },
  google: { also: ['Alphabet', 'YouTube', 'Sundar Pichai', 'Gemini AI', 'Waymo'], not: [] },
  amazon: { also: ['AWS', 'Jeff Bezos', 'Andy Jassy'], not: ['rainforest', 'river', 'forest', 'deforestation', 'indigenous', 'tribe', 'basin', 'fire', 'fires', 'drought', 'jungle', 'wildlife'] },
  meta: { also: ['Facebook', 'Instagram', 'WhatsApp', 'Zuckerberg'], not: [] },
  microsoft: { also: ['Satya Nadella', 'Xbox', 'LinkedIn'], not: [] },
  nvidia: { also: ['Jensen Huang'], not: [] },
  tesla: { also: ['Elon Musk'], not: [] },
  netflix: { also: [], not: [] },
  openai: { also: ['ChatGPT', 'Sam Altman'], not: [] },
  samsung: { also: [], not: [] },
  tsmc: { also: ['Taiwan Semiconductor'], not: [] },
  spacex: { also: ['Starlink', 'Starship'], not: [] },
  x: { also: [], not: [] },
};
/** Names that are too common as ordinary words to count on their own. */
const TOO_COMMON = new Set(['X', 'Block', 'Square', 'Snap', 'Unity', 'Signal', 'Discord', 'Notion', 'Canva', 'Wise', 'Revolut', 'Grab', 'Sea', 'Ola', 'Swiggy', 'Zoom', 'Box', 'Slack', 'Uber', 'Lyft', 'Stripe', 'Arm', 'Intel', 'Oracle', 'Meta', 'Shopify', 'Klarna', 'Monzo']);
const ALWAYS = new Set(['Uber', 'Lyft', 'Stripe', 'Intel', 'Oracle', 'Meta', 'Shopify', 'Klarna', 'Monzo', 'Zoom', 'Arm']); // distinctive enough with their capital letter
/** The names a headline must contain for this company. */
export function companyNames(c) {
  const a = COMPANY_ALIASES[c.id] ?? { also: [], not: [] };
  const base = TOO_COMMON.has(c.company) && !ALWAYS.has(c.company) ? [] : [c.company, c.company.replace(/\s+(Inc|Corp|Group|Holdings|Ltd|Technologies)\.?$/i, '')];
  // names written in capitals by the company (NVIDIA, XPANCEO) are written Nvidia in most headlines; short ones (IBM, BYD) stay
  const title = base.filter((n) => /^[A-Z]{4,}$/.test(n)).map((n) => n[0] + n.slice(1).toLowerCase());
  return { names: [...base, ...title, ...a.also], not: a.not };
}

/** Headlines a reader can trust for this: drop state-controlled publishers (owner 'state'). */
export const credible = (items, pub) => (items ?? []).filter((h) => h && h.t && h.u && pub[h.p] && pub[h.p].owner !== 'state');

/** Stories about a set of names: newest first, one per link, each with its angles. */
export function storiesAbout(items, { names, not = [] }, max = 40) {
  const hit = nameMatcher(names, not); const seen = new Set(); const out = [];
  for (const h of [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    if (seen.has(h.u) || !hit(h.t)) continue; seen.add(h.u);
    out.push({ ...h, angles: anglesOf(h.t) }); if (out.length >= max) break;
  }
  return out;
}

/** Stories grouped by their first angle, in the ANGLES order: [[id, label, stories]]. */
export function byAngle(stories) {
  const g = new Map(); for (const s of stories) { const k = s.angles[0]; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
  return [...ANGLES.map(([id]) => id), 'other'].filter((k) => g.has(k)).map((k) => [k, ANGLE_LABEL[k], g.get(k)]);
}

/** The angle most of these stories take, counting every angle a headline has (a tie goes to the earlier angle in ANGLES). */
export function leadAngle(stories) {
  const n = new Map(); for (const s of stories) for (const a of s.angles) n.set(a, (n.get(a) ?? 0) + 1);
  const order = [...ANGLES.map(([id]) => id), 'other'];
  return order.filter((k) => n.has(k)).sort((a, b) => n.get(b) - n.get(a) || order.indexOf(a) - order.indexOf(b))[0] ?? 'other';
}

/** What people from a country are called in English headlines, for the common ones (ISO 3166 alpha-2). */
export const DEMONYMS = {
  US: ['American', 'Americans', 'US', 'U.S.', 'USA', 'United States', 'Washington'], GB: ['British', 'Britain', 'UK', 'U.K.'], CN: ['Chinese', 'Beijing'], RU: ['Russian', 'Russians', 'Moscow', 'Kremlin'],
  UA: ['Ukrainian', 'Ukrainians', 'Kyiv'], IL: ['Israeli', 'Israelis'], PS: ['Palestinian', 'Palestinians', 'Gaza', 'West Bank'], IR: ['Iranian', 'Iranians', 'Tehran'],
  IN: ['Indian', 'Indians', 'New Delhi'], PK: ['Pakistani', 'Pakistanis'], FR: ['French', 'Paris'], DE: ['German', 'Germans', 'Berlin'], JP: ['Japanese', 'Tokyo'],
  KR: ['South Korean', 'Seoul'], KP: ['North Korean', 'Pyongyang'], TW: ['Taiwanese', 'Taipei'], BR: ['Brazilian', 'Brazilians'], MX: ['Mexican', 'Mexicans'],
  CA: ['Canadian', 'Canadians', 'Ottawa'], AU: ['Australian', 'Australians', 'Canberra'], SY: ['Syrian', 'Syrians', 'Damascus'], SA: ['Saudi'], TR: ['Turkish', 'Ankara', 'Türkiye'],
  EG: ['Egyptian', 'Cairo'], SD: ['Sudanese', 'Khartoum'], VE: ['Venezuelan', 'Caracas'], IT: ['Italian', 'Rome'], ES: ['Spanish', 'Madrid'], PL: ['Polish', 'Warsaw'],
  NG: ['Nigerian', 'Abuja'], ZA: ['South African'], KE: ['Kenyan', 'Nairobi'], ET: ['Ethiopian', 'Addis Ababa'], AF: ['Afghan', 'Kabul', 'Taliban'], IQ: ['Iraqi', 'Baghdad'],
  LB: ['Lebanese', 'Beirut', 'Hezbollah'], YE: ['Yemeni', 'Houthi', 'Houthis'], NZ: ['Wellington'], AR: ['Argentine', 'Argentinian', 'Buenos Aires'], CO: ['Colombian', 'Bogotá'],
  BD: ['Bangladeshi', 'Dhaka'], ID: ['Indonesian', 'Jakarta'], PH: ['Filipino', 'Manila'], VN: ['Vietnamese', 'Hanoi'], TH: ['Thai', 'Bangkok'], MM: ['Myanmar', 'Burmese'],
  HU: ['Hungarian', 'Budapest'], NL: ['Dutch', 'Amsterdam'], BE: ['Belgian', 'Brussels'], SE: ['Swedish', 'Stockholm'], NO: ['Norwegian', 'Oslo'], FI: ['Finnish', 'Helsinki'],
  DK: ['Danish', 'Copenhagen'], GR: ['Greek', 'Athens'], IE: ['Irish', 'Dublin'], CH: ['Swiss'], AT: ['Austrian', 'Vienna'], CU: ['Cuban', 'Havana'], HT: ['Haitian'], CD: ['Congolese', 'DR Congo', 'Kinshasa'], TZ: ['Tanzania', 'Tanzanian'], CZ: ['Czech Republic', 'Czech', 'Prague'],
};

/** The countries a headline names: [{ cc, name }] from a list of { cc, name } (names as whole words, plus DEMONYMS). */
export function placesIn(title, countries) {
  const out = [];
  for (const c of countries) {
    if (!c.cc || !c.name) continue;
    const m = c._m ??= nameMatcher([c.name, ...(c.also ?? []), ...(DEMONYMS[c.cc] ?? [])]);
    if (m(title)) out.push({ cc: c.cc, name: c.name });
  }
  return out;
}

/** Where a set of stories happens: countries by how many stories name them, most first: [{ cc, name, n }]. */
export function wherePlaces(stories, countries, skip = '') {
  const n = new Map();
  for (const s of stories) for (const p of placesIn(s.t, countries)) if (p.cc !== skip) n.set(p.cc, { ...p, n: (n.get(p.cc)?.n ?? 0) + 1 });
  return [...n.values()].sort((a, b) => b.n - a.n);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const agoShort = (iso, now) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
/** The stories as HTML: grouped by angle, each linking to the publisher's own page (new tab, no referrer). */
export function storiesHtml(stories, pub, now = Date.now(), perAngle = 6) {
  if (!stories.length) return '';
  return byAngle(stories).map(([id, label, list]) => `<div class="na-angle na-${id}"><h5>${esc(label)} <small>${list.length}</small></h5><ul class="na-list">${list.slice(0, perAngle).map((s) => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener noreferrer">${esc(s.t)}</a><small>${esc(pub[s.p]?.name ?? s.p)} · ${agoShort(s.at, now)}</small></li>`).join('')}</ul></div>`).join('');
}
/** One line: how many stories, from how many publishers, by angle. */
export function storiesSummary(stories, pub) {
  if (!stories.length) return 'No stories in the last 48 hours';
  const pubs = new Set(stories.map((s) => s.p)).size;
  return `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} from ${pubs} ${pubs === 1 ? 'publisher' : 'publishers'}: ${byAngle(stories).map(([id, , l]) => `${ANGLE_LABEL[id].split(/[ ,]/)[0].toLowerCase()} ${l.length}`).join(', ')}`;
}
