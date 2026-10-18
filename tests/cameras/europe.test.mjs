// SPDX-License-Identifier: AGPL-3.0-only
// Checks the parsers in tools/cameras/europe.mjs on small fixtures shaped like the real answers (trimmed from
// Osiris's italy.test.ts and sweden.test.ts, adapted from Osiris by simplifaisoul, MIT). No network.
//   node tests/cameras/europe.test.mjs
import { readFileSync } from 'node:fs';
import { clipTime, parseAutostrade, parseTrafikverket, parseKolla, countyLabel, trafikverketQuery, nadmorskiRows, eurocamRows, sources, ASPI_VIDEO } from '../../tools/cameras/europe.mjs';
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };
const throws = (f) => { try { f(); return false; } catch { return true; } };
const goodRow = (r) => Array.isArray(r) && r.length === 8 && typeof r[0] === 'string' && Number.isFinite(r[2]) && Number.isFinite(r[3]) && (r[4] || r[5]) && [r[4], r[5]].every((u) => !u || /^https:\/\/[a-z]/i.test(u));

// ── Autostrade per l'Italia (fixture from Osiris italy.test.ts)
const NOW = Date.UTC(2026, 9, 9, 6, 0);
const CLIP = 'dt4/fdb2dcf0-d228-491f-948b-032d4a12a14e-23.mp4';
const aspi = (o = {}) => ({ c_tel: 7304, t_day: '09-10-2026', t_time: '05:39', t_des_str: 'A1 MILANO-NAPOLI', t_des: 'km. 285 Arno a Firenze itinere nord', n_crd_lat: 43.79475, n_crd_lon: 11.15661, frames: { V: { c_tip_frm: 'V', n_prg_frm: -1, t_url: CLIP } }, ...o });
const it = (...c) => parseAutostrade({ webcams: c }, NOW);
check('clipTime reads dd-mm-yyyy hh:mm', clipTime('09-10-2026', '05:39') === Date.UTC(2026, 9, 9, 5, 39) && Number.isNaN(clipTime('2026-10-09', '05:39')) && Number.isNaN(clipTime(undefined, '05:39')));
const [a] = it(aspi());
check('autostrade: clip plays from Autostrade’s video host', JSON.stringify(a) === JSON.stringify(['it-aspi-7304', 'A1 km. 285 Arno a Firenze itinere nord', 43.79475, 11.15661, '', `${ASPI_VIDEO}${CLIP}`, 0, 'A1 MILANO-NAPOLI · Italy']), a);
check('autostrade: strips emoji variation selectors', it(aspi({ t_des_str: 'A4 MILANO-BRESCIA️' }))[0][7] === 'A4 MILANO-BRESCIA · Italy');
check('autostrade: drops clip paths of the wrong shape', ['../../etc/passwd', 'https://evil.example/x.mp4', CLIP.replace('.mp4', '.jpg'), `/${CLIP}`, 42].every((t_url) => it(aspi({ frames: { V: { t_url } } })).length === 0) && it(aspi({ frames: { T: { t_url: 'dt4/x.jpg' } } })).length === 0);
check('autostrade: drops stale or unstamped clips', it(aspi({ t_day: '20-11-2025' })).length === 0 && it(aspi({ t_day: '07-10-2026' })).length === 0 && it(aspi({ t_time: undefined })).length === 0 && it(aspi({ t_day: '08-10-2026', t_time: '12:00' })).length === 1);
check('autostrade: drops records outside Italy, without coordinates or id, and duplicates', it(aspi({ n_crd_lat: 48.85, n_crd_lon: 2.35 })).length === 0 && it(aspi({ n_crd_lat: null })).length === 0 && it(aspi({ c_tel: 'x' })).length === 0 && it(aspi(), aspi()).length === 1);
check('autostrade: a body that is not the list throws', throws(() => parseAutostrade(null)) && throws(() => parseAutostrade({ webcams: 'x' })));

// ── Trafikverket open API (shape of POST /v2/data.json for objecttype Camera)
const TV_IMAGE = 'https://api.trafikinfo.trafikverket.se/v2/Images/TrafficFlowCamera_39638213.Jpeg';
const tvCam = (o = {}) => ({ Id: '39638213', Name: 'Tpl Kista Västra', Active: true, Deleted: false, Type: 'Trafikflödeskamera', HasFullSizePhoto: true, PhotoUrl: TV_IMAGE, Geometry: { WGS84: 'POINT (17.966601 59.401178)' }, ...o });
const tv = (...c) => parseTrafikverket({ RESPONSE: { RESULT: [{ Camera: c }] } });
const [t] = tv(tvCam());
check('trafikverket: maps a camera (lng lat order, full-size photo)', JSON.stringify(t) === JSON.stringify(['se-tv-39638213', 'Tpl Kista Västra', 59.40118, 17.9666, `${TV_IMAGE}?type=fullsize`, '', 0, 'Trafikflödeskamera · Sweden']), t);
check('trafikverket: keeps only Trafikverket-hosted https photos', ['https://evil.example/c.jpg', TV_IMAGE.replace('https:', 'http:'), 'javascript:alert(1)', 42].every((PhotoUrl) => tv(tvCam({ PhotoUrl })).length === 0));
check('trafikverket: drops inactive, deleted, unplaceable, outside-Sweden and duplicate cameras', tv(tvCam({ Active: false })).length === 0 && tv(tvCam({ Deleted: true })).length === 0 && tv(tvCam({ Geometry: {} })).length === 0 && tv(tvCam({ Geometry: { WGS84: 'POINT (2.35 48.85)' } })).length === 0 && tv(tvCam(), tvCam()).length === 1);
check('trafikverket: an API error or empty answer throws', throws(() => parseTrafikverket({ RESPONSE: { RESULT: [{ ERROR: { SOURCE: 'Login', MESSAGE: 'Invalid authenticationkey' } }] } })) && throws(() => parseTrafikverket({})));
check('trafikverket: query carries the key and asks for active cameras', /authenticationkey="abc123"/.test(trafikverketQuery('abc123')) && /objecttype="Camera"/.test(trafikverketQuery('x')) && !/<script/.test(trafikverketQuery('"><script>')));

// ── Kolla Trafiken fallback (fixture from Osiris sweden.test.ts)
const KOLLA_IMAGE = 'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/TrafficFlowCamera_39638213.jpg';
const kolla = (o = {}) => ({ id: 1731, name: 'Tpl Kista Västra', url: KOLLA_IMAGE, lat: 59.401178, lng: 17.966601, detail: '/vagkamera/Tpl+Kista+Vastra-1731', ...o });
check('countyLabel reads like a place', countyLabel('Stockholms län') === 'Stockholm' && countyLabel('Västra Götalands län') === 'Västra Götaland' && countyLabel('Skåne län') === 'Skåne' && countyLabel(undefined) === 'Sweden');
const [k] = parseKolla([kolla()], 'Stockholm');
check('kolla: keeps the Trafikverket image', k && k[0] === 'se-tv-1731' && k[4] === KOLLA_IMAGE && k[7] === 'Stockholm · Sweden', k);
check('kolla: drops images not Trafikverket’s own over https', ['https://evil.example/cam.jpg', KOLLA_IMAGE.replace('https:', 'http:'), 'javascript:alert(1)', 42].every((url) => parseKolla([kolla({ url })], 'X').length === 0));
check('kolla: drops records outside Sweden or without coordinates or a safe id', parseKolla([kolla({ lat: 48.85, lng: 2.35 })], 'X').length === 0 && parseKolla([kolla({ lat: 'n/a' })], 'X').length === 0 && parseKolla([kolla({ id: '../../x' })], 'X').length === 0 && parseKolla({ error: true }, 'X').length === 0);

// ── Static lists
const pl = nadmorskiRows(); const eu = eurocamRows();
check(`nadmorski24: ${pl.length} HLS rows, all valid`, pl.length >= 60 && pl.every(goodRow) && pl.every((r) => /^https:\/\/ls\.tkchopin\.pl\/live\/.+\/playlist\.m3u8$/.test(r[5])) && pl.every((r) => r[2] > 53 && r[2] < 55.5 && r[3] > 14 && r[3] < 19.5));
check(`eurocams: ${eu.length} rows, all valid`, eu.length === 10 && eu.every(goodRow), eu.filter((r) => !goodRow(r)));
const ids = [...pl, ...eu].map((r) => r[0]);
check('static ids are unique', new Set(ids).size === ids.length);

// ── Module shape and metadata
const meta = JSON.parse(readFileSync(new URL('../../tools/cameras/europe.meta.json', import.meta.url)));
check('sources export key, name and run', sources.length === 4 && sources.every((s) => /^[a-z0-9]+$/.test(s.key) && s.name && typeof s.run === 'function'));
check('every source has metadata with an APA pair', sources.every((s) => { const m = meta.find((x) => x.key === s.key); return m && m.name && /^https:/.test(m.url) && m.license && m.role && m.apa?.length === 2; }));
const existing = readFileSync(new URL('../../site/app/js/sources.js', import.meta.url), 'utf8');
check('every metadata key is in sources.js', meta.every((m) => new RegExp(`^\\s+${m.key}:`, 'm').test(existing)));
for (const s of sources.filter((x) => ['nadmorski24', 'eurocams'].includes(x.key))) { const r = await s.run(); check(`${s.key}.run() works offline`, r.length > 0 && r.every(goodRow)); }

console.log(`SUMMARY ${pass} / ${n}`);
process.exit(pass === n ? 0 : 1);
