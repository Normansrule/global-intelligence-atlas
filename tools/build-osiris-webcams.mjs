#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — converts the curated public-webcam lists of Osiris (simplifaisoul, MIT licence,
// src/app/api/cctv/{asia,world}-skyline.generated.ts and public-webcams.generated.ts, served by asia-live.ts,
// world-live.ts and public-webcams.ts) into tools/data/osiris-webcams.json, which tools/cameras/osiris-webcams.mjs
// adds to the "Public webcams worldwide" layer. The JSON is committed: the Osiris checkout is not available in CI.
//   node tools/build-osiris-webcams.mjs [path/to/osiris/src/app/api/cctv]
// Rules applied to every camera:
//   - Osiris's own /api/cctv/proxy addresses are never used;
//   - SkylineWebcams: only the camera's page is kept (their CDN sets hotlink protection, so no image);
//   - an image or stream is kept only when it is a direct HTTPS address from the publisher on a named host (no bare
//     IP address, no user name, password or token) and is something the atlas player can show (HLS or MP4 video);
//   - YouTube channels and provider embed players (ipcamlive, rtsp.me) become the camera's page link.
// The object literals are read with a regular expression (no eval); each Osiris row sits on one line.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? '/home/claude/ext/osiris/src/app/api/cctv';
const OUT = join(ROOT, 'tools', 'data', 'osiris-webcams.json');
const FILES = ['asia-skyline.generated.ts', 'world-skyline.generated.ts', 'public-webcams.generated.ts'];
// the *-live.ts and public-webcams.ts files only re-export these arrays; read them to be sure nothing else is added
const WRAPPERS = ['asia-live.ts', 'world-live.ts', 'public-webcams.ts'];

const CONTINENT = {
  Asia: ['China', 'Hong Kong', 'Taiwan', 'Japan', 'South Korea', 'Thailand', 'Philippines', 'Vietnam', 'Indonesia', 'Maldives', 'India', 'Sri Lanka', 'Israel', 'Jordan', 'Oman', 'Cyprus', 'Turkey'],
  Europe: ['Netherlands', 'Norway', 'Malta', 'Croatia', 'Portugal', 'United Kingdom', 'Spain', 'Ireland', 'Slovenia', 'Hungary', 'Finland', 'Switzerland', 'Germany', 'Bosnia and Herzegovina', 'Belgium', 'Albania', 'Russia', 'Vatican City', 'San Marino', 'Luxembourg', 'Italy', 'Faroe Islands', 'Estonia'],
  Africa: ['South Africa', 'Tanzania', 'Seychelles', 'Kenya', 'Senegal', 'Morocco'],
  'North America and Caribbean': ['United States', 'Canada', 'Mexico', 'US Virgin Islands', 'Costa Rica', 'Dominican Republic', 'Sint Maarten', 'El Salvador', 'Panama', 'Honduras', 'Guadeloupe', 'Grenada', 'Bermuda', 'Belize', 'Puerto Rico', 'Martinique', 'Curaçao', 'Bonaire', 'Barbados'],
  'South America': ['Brazil', 'Peru', 'Chile', 'Argentina', 'Ecuador', 'Bolivia', 'Venezuela', 'Uruguay'],
  Oceania: ['Australia'],
};
export const continentOf = (country) => Object.keys(CONTINENT).find((k) => CONTINENT[k].includes(country)) ?? 'Other';

const STR = /([a-z_]+):\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(-?\d+(?:\.\d+)?))/g;
const unq = (s) => s.replace(/\\(.)/g, '$1');
export function parseRows(ts) {
  const out = [];
  for (const line of ts.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{ id:')) continue;
    const o = {};
    for (const m of t.matchAll(STR)) o[m[1]] = m[4] !== undefined ? Number(m[4]) : unq(m[2] ?? m[3]);
    out.push(o);
  }
  return out;
}

const IP = /^(\d+\.){3}\d+$|^\[?[0-9a-f:]+\]?$/i;
const SECRET = /[?&](pass(word)?|pwd|passwd|token|auth|sig|signature|key|wmsAuthSign)=/i;
/** A direct HTTPS address on a named host with no credentials, else ''. */
export function cleanUrl(raw) {
  if (!raw || /\/api\/cctv\//.test(raw) || !/^https:\/\//i.test(raw)) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || IP.test(u.hostname) || u.username || u.password || SECRET.test(u.search)) return '';
    return u.href;
  } catch { return ''; }
}

// type — one of fetch-worldcams.mjs TYPES, guessed from the name and the page address (Skyline's are descriptive)
const RULES = [
  ['volcano', /volcan|vulkan|etna|stromboli|sakurajima|fuji(?!sawa)/],
  ['ski', /\bski|piste|slope|snow ?park|gondola/],
  ['airport', /airport|aeroporto|aeropuerto|luchthaven|flughafen|vliegveld|runway/],
  ['railway', /railway|\btrain|station(?!ary)|bahnhof|spoor/],
  ['port', /\bport\b|porto|puerto|harbou?r|haven|marina|pier|terminal|ferry|veerhaven|sluis|lock\b|dock|quay|kade|jachthaven|boulevard de ruyter|bay of|wharf|canal/],
  ['beach', /beach|playa|praia|plage|spiaggia|strand|\bbay\b|baia|bahia|coast|seafront|seaside|shore|lido|surf|island|isla|ilha|atoll|lagoon|reef|ocean|sea view|promenade/],
  ['traffic', /traffic|highway|motorway|crossing|intersection|junction|road|street|avenue|shibuya|snelweg|bridge|brug|motor ?bike/],
  ['wildlife', /wildlife|safari|zoo|bird|animal|waterhole|elephant|penguin|nest/],
  ['water', /lake|river|lago|meer|rio\b|falls|waterfall|dam\b|reservoir|fjord/],
  ['nature', /mountain|mount\b|monte|valley|forest|park|garden|national|glacier|peak|hill|nature/],
  ['weather', /weather|meteo|storm/],
  ['landmark', /panorama|skyline|downtown|centre|center|square|plaza|piazza|praça|plein|markt|church|cathedral|temple|shrine|castle|tower|palace|old town|city|town|view|harbor|monument|basilica|vrijthof/],
];
export function guessType(...texts) {
  const s = texts.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [t, re] of RULES) if (re.test(s)) return t;
  return 'other';
}

// Short, stable id (FNV-1a of the Osiris id), same scheme as fetch-worldcams.mjs but prefixed o-.
const shortId = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return `o-${(h >>> 0).toString(36)}`; };
const round = (x) => Math.round(x * 1e5) / 1e5;

function publisherOf(r, page) {
  if (r.source === 'SkylineWebcams') return 'SkylineWebcams';
  let h = '';
  try { h = new URL(page || r.stream_url || '').hostname.replace(/^www\./, ''); } catch {}
  if (/(^|\.)youtube\.com$/.test(h)) return 'YouTube Live (the operator’s own channel)';
  if (h === 'ipcamlive.com') return 'IPCamLive (owner-run camera)';
  if (h === 'rtsp.me') return 'RTSP.me (owner-run camera)';
  return h || 'Public webcam operator';
}

/** One Osiris CctvCamera → the atlas shape, or null. */
export function convert(r) {
  const lat = Number(r.lat); const lng = Number(r.lng);
  if (!r.id || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const sky = r.source === 'SkylineWebcams';
  let img = ''; let stream = ''; let page = cleanUrl(r.external_url);
  if (!sky) {
    const s = cleanUrl(r.stream_url);
    if (s && /\.(m3u8|mp4)(\?|$)/i.test(new URL(s).pathname + new URL(s).search)) stream = s;
    else if (s && !page) page = s; // an embed player with no operator page: link to the player itself
    const f = cleanUrl(r.feed_url);
    if (f && /\.(jpe?g|png|webp)(\?|$)/i.test(f)) img = f;
  }
  if (!img && !stream && !page) return null;
  const name = String(r.name || r.city || 'Webcam').trim().slice(0, 120);
  return {
    id: shortId(String(r.id)), name, lat: round(lat), lng: round(lng), city: String(r.city ?? '').slice(0, 60), country: String(r.country ?? ''),
    img, stream, page, publisher: publisherOf(r, page), type: guessType(name, page),
  };
}

function build() {
  for (const w of WRAPPERS) {
    const t = readFileSync(join(SRC, w), 'utf8');
    if (/\{ id:/.test(t)) throw new Error(`${w} now defines cameras of its own; extend this script to read it`);
  }
  const cams = []; const seenPage = new Set(); const seenId = new Set(); const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  for (const f of FILES) for (const r of parseRows(readFileSync(join(SRC, f), 'utf8'))) {
    const c = convert(r);
    if (!c) { skip('no usable position or address'); continue; }
    if (c.page && seenPage.has(c.page)) { skip('same page as another Osiris camera'); continue; }
    if (seenId.has(c.id)) { skip('duplicate id'); continue; }
    if (c.page) seenPage.add(c.page); seenId.add(c.id);
    cams.push(c);
  }
  cams.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  const byCountry = {}; const byContinent = {}; const byType = {};
  for (const c of cams) { byCountry[c.country] = (byCountry[c.country] ?? 0) + 1; const k = continentOf(c.country); byContinent[k] = (byContinent[k] ?? 0) + 1; byType[c.type] = (byType[c.type] ?? 0) + 1; }
  const doc = {
    about: 'Public webcams from the Osiris project (github.com/simplifaisoul/osiris, © 2026 simplifaisoul, MIT licence), converted by tools/build-osiris-webcams.mjs. Coordinates were resolved by Osiris via OpenStreetMap Nominatim. Images and streams © their publishers.',
    license: 'Camera list: MIT (Osiris). This conversion: AGPL-3.0-only (Global Intelligence Atlas).',
    sources: FILES.map((f) => `src/app/api/cctv/${f}`),
    total: cams.length, countries: Object.keys(byCountry).length,
    counts: { byContinent, byCountry, byType }, skipped, cameras: cams,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');
  console.log(`Osiris webcams: ${cams.length} cameras in ${doc.countries} countries → ${OUT}`);
  console.log('  by continent:', JSON.stringify(byContinent));
  for (const [why, n] of Object.entries(skipped)) console.log(`  skipped ${n}: ${why}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { readdirSync(SRC); } catch { console.error(`Osiris cctv folder not found at ${SRC}`); process.exit(1); }
  build();
}
