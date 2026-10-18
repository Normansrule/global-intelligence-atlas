// SPDX-License-Identifier: AGPL-3.0-only
// Checks tools/data/osiris-webcams.json (the Osiris public-webcam lists, MIT, simplifaisoul) and the merge hook in
// tools/cameras/osiris-webcams.mjs that adds them to the worldwide webcam layer.
//   node tests/cameras/osiris-webcams.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { osirisWebcams, mergeIntoWorldcams } from '../../tools/cameras/osiris-webcams.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : info); };

const cams = osirisWebcams();
const doc = JSON.parse(readFileSync(join(ROOT, 'tools/data/osiris-webcams.json'), 'utf8'));
const by = {}; for (const c of cams) by[c.country] = (by[c.country] ?? 0) + 1;
console.log(`  ${cams.length} cameras in ${Object.keys(by).length} countries:`, Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
check('the JSON header totals match the list', doc.total === cams.length && doc.countries === Object.keys(by).length, [doc.total, cams.length]);
check('mainland China has at least 2 cameras', (by.China ?? 0) >= 2, by.China);
check('Japan has more than 50 cameras', (by.Japan ?? 0) > 50, by.Japan);
check('South Korea and Southeast Asia are covered', by['South Korea'] > 0 && ['Thailand', 'Philippines', 'Vietnam', 'Indonesia'].every((k) => by[k] > 0), by);
check('Africa and Latin America are covered', ['South Africa', 'Kenya', 'Tanzania', 'Brazil', 'Mexico', 'Peru', 'Argentina'].every((k) => by[k] > 0), by);
check('at least 60 countries', Object.keys(by).length >= 60, Object.keys(by).length);
const urls = cams.flatMap((c) => [c.img, c.stream, c.page].filter(Boolean));
check('no Osiris proxy addresses', !urls.some((u) => /\/api\/cctv\//.test(u)), urls.filter((u) => /\/api\/cctv\//.test(u)).slice(0, 3));
check('no http:// addresses', !urls.some((u) => /^http:/i.test(u)), urls.filter((u) => /^http:/i.test(u)).slice(0, 3));
const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
check('every page, image and stream is a valid https address on a named host', urls.every((u) => /^https:\/\//.test(u) && host(u) && !/^(\d+\.){3}\d+$/.test(host(u)) && !host(u).includes(':')), urls.filter((u) => !/^https:\/\//.test(u) || !host(u)).slice(0, 3));
check('no credentials in any address', !urls.some((u) => { const x = new URL(u); return x.username || x.password || /[?&](pass(word)?|pwd|token|auth|sig)=/i.test(x.search); }));
check('SkylineWebcams cameras carry only their page (hotlink-protected CDN)', cams.filter((c) => c.publisher === 'SkylineWebcams').every((c) => !c.img && !c.stream && host(c.page) === 'www.skylinewebcams.com'));
check('streams are HLS or MP4 that the atlas player can show', cams.filter((c) => c.stream).every((c) => /\.(m3u8|mp4)(\?|$)/.test(c.stream)));
check('YouTube and embed players are page links, not streams', !cams.some((c) => /youtube|ipcamlive|rtsp\.me/.test(c.stream + c.img)));
check('ids are unique', new Set(cams.map((c) => c.id)).size === cams.length);
const TYPES = ['traffic', 'landmark', 'beach', 'ski', 'weather', 'aviation', 'nature', 'water', 'airport', 'port', 'volcano', 'science', 'observatory', 'satellite', 'border', 'railway', 'space', 'wildlife', 'tourism', 'other'];
check('every type is a worldcams type and every camera has a position and publisher', cams.every((c) => TYPES.includes(c.type) && Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.publisher && c.name));

// dedupe on a tiny fixture shaped like fetch-worldcams.mjs state
const fx = [
  { id: 'o-a', name: 'Piazza Test - Italy', lat: 45.0, lng: 9.0, city: 'X', country: 'Italy', img: '', stream: '', page: 'https://www.skylinewebcams.com/a.html', publisher: 'SkylineWebcams', type: 'landmark' },
  { id: 'o-b', name: 'Harbour Cam', lat: 52.0, lng: 4.0, city: 'Y', country: 'Netherlands', img: '', stream: 'https://h.example.org/live/x.m3u8', page: 'https://example.org/b', publisher: 'example.org', type: 'port' },
  { id: 'o-c', name: 'Harbour Cam', lat: 52.01, lng: 4.0, city: 'Y', country: 'Netherlands', img: '', stream: '', page: 'https://example.org/c', publisher: 'example.org', type: 'port' },
  { id: 'o-d', name: 'New Cam', lat: -33.9, lng: 18.4, city: 'Cape Town', country: 'South Africa', img: '', stream: '', page: 'https://www.youtube.com/@x/live', publisher: 'YouTube Live (the operator’s own channel)', type: 'beach' },
  { id: 'o-e', name: 'Bad', lat: 1, lng: 1, city: '', country: '', img: 'http://1.2.3.4/x.jpg', stream: '', page: '/api/cctv/proxy?url=x', publisher: 'x', type: 'other' },
  { id: 'w-1', name: 'Clash', lat: 10, lng: 10, city: '', country: '', img: '', stream: '', page: 'https://example.net/clash', publisher: 'Windy Webcams', type: 'zzz' },
];
const cells = { '40_0': [['w-1', 'Piazza test', 45.5, 9.5, 'https://img.example/1.jpg', '', 0, 1, 'Italy', 'X', 'https://www.skylinewebcams.com/a.html']], '50_0': [['w-2', 'Harbour cam', 52.0005, 4.0005, 'https://img.example/2.jpg', '', 0, 9, 'Netherlands', 'Y', '']] };
const pubs = [['Windy Webcams', 1]]; const pubIx = new Map([['Windy Webcams', 0]]); const pubCount = [2]; const density = {};
const ids = new Set(['w-1', 'w-2']); const uniq = (id) => { let x = id; for (let k = 2; ids.has(x); k++) x = `${id}-${k}`; ids.add(x); return x; };
const res = mergeIntoWorldcams({ cells, pubs, pubIx, pubCount, density, uniq, types: TYPES }, fx);
check('dedupe: same page address is skipped', res.skipped['same page as a WorldCam camera'] === 1, res);
check('dedupe: same name within 150 m is skipped, same name 1.1 km away is kept', res.skipped['same name within 150 m of a WorldCam camera'] === 1 && cells['50_0'].some((r) => r[0] === 'o-c'), cells['50_0']);
check('unsafe addresses are refused', res.skipped['no HTTPS address from the publisher'] === 1);
check('added rows land in the right cell with publisher, type and density', res.added === 3 && cells['-40_10']?.[0]?.[0] === 'o-d' && pubs[cells['-40_10'][0][6]][0].startsWith('YouTube') && cells['-40_10'][0][7] === TYPES.indexOf('beach') && density['-34_18'] === 1, { res, cells, pubs });
check('ids stay unique and unknown types fall back to other', cells['10_10']?.[0]?.[0] === 'w-1-2' && cells['10_10'][0][7] === TYPES.length - 1 && pubCount[0] === 3, cells['10_10']);

// the real list merged into an empty state: everything goes in once, ids unique, nothing lost
const s2 = { cells: {}, pubs: [], pubIx: new Map(), pubCount: [], density: {}, uniq: (() => { const seen = new Set(); return (id) => { let x = id; for (let k = 2; seen.has(x); k++) x = `${id}-${k}`; seen.add(x); return x; }; })(), types: TYPES };
const r2 = mergeIntoWorldcams(s2, cams);
check('the real list merges in full into an empty layer', r2.added === cams.length && s2.pubCount.reduce((a, b) => a + b, 0) === cams.length, r2);

console.log(`SUMMARY ${pass} / ${n}`);
process.exitCode = pass === n ? 0 : 1;
