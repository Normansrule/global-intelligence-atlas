#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Offline tests for tools/cameras/west-asia-pacific.mjs. Fixtures are trimmed from the Osiris test suite
// (adapted from Osiris by simplifaisoul, MIT: src/app/api/cctv/*.test.ts) plus a data.gov.sg sample.
// Run: node tests/cameras/west-asia-pacific.test.mjs
import { readFileSync } from 'node:fs';
import {
  sources, parseTxdotInventory, parseTranstarRoads, parseTranstarCameras, matchTranstar,
  buildQuery, parseWkt, mapNevada, mapUtah, mapOregon, parseOregon, parseSingapore, mlitRows,
} from '../../tools/cameras/west-asia-pacific.mjs';

let pass = 0; let total = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(name, fn) {
  total++;
  try { const r = fn(); if (r !== true) throw new Error(`got ${JSON.stringify(r)}`); pass++; console.log(`PASS ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); }
}
const throws = (fn, msg) => { try { fn(); return false; } catch (e) { return e.message.includes(msg); } };

// ── Texas / TranStar ──
const tx = { icd_Id: 'IH20 @ Dallas-Tarrant CL', name: 'IH20 @ Dallas-Tarrant CL', latitude: 32.676316, longitude: -97.035836, hasSnapshot: true };
const inv = (rows) => ({ roadwayCctvStatuses: { IH20: rows } });
t('txdot: maps one camera', () => eq(parseTxdotInventory(inv([tx]), 'HOU'), [{ id: tx.icd_Id, name: tx.name, lat: tx.latitude, lng: tx.longitude, district: 'HOU' }]));
t('txdot: dedupes and drops bad rows', () => parseTxdotInventory(inv([tx, tx, null, { ...tx, hasSnapshot: false }, { ...tx, latitude: null }, { ...tx, latitude: NaN }, { ...tx, longitude: 0 }, { ...tx, icd_Id: '' }, { ...tx, icd_Id: 'x', statusDescription: 'Device Error' }]), 'HOU').length === 1);
t('txdot: rejects a payload without roadwayCctvStatuses', () => throws(() => parseTxdotInventory({}, 'HOU'), 'roadwayCctvStatuses'));
t('transtar: parses roads (deduplicated)', () => eq(parseTranstarRoads('<a href="?roadway=IH-45_North">I-45</a><a href="?roadway=IH-45_North">again</a>'), ['IH-45_North']));
t('transtar: parses camera links', () => eq(parseTranstarCameras('IH-45_North', "<a href='?cam=Franklin&id=202'>Franklin</a><a href='?cam=North_Main&amp;id=7'>x</a>"), [{ road: 'IH-45_North', name: 'Franklin', id: '202' }, { road: 'IH-45_North', name: 'North Main', id: '7' }]));
const hou = (name, district = 'HOU') => ({ id: name, name, lat: 29.765444, lng: -95.367628, district });
t('transtar: unique exact match only', () => {
  const r = matchTranstar([hou('IH-45 North @ Franklin'), hou('IH-10 East @ Franklin')], [{ road: 'IH-45_North', name: 'Franklin', id: '202' }, { road: 'IH-69_Eastex', name: 'Franklin', id: '999' }]);
  return eq(r, [['transtar-202', 'IH-45 North @ Franklin', 29.76544, -95.36763, 'https://traffic.houstontranstar.org/snapshots/cctv/202.jpg', '', 0, 'Houston · Texas']]);
});
t('transtar: keeps Yoakum district label', () => matchTranstar([hou('IH-10 West @ FM 1458', 'YKM')], [{ road: 'IH-10_West', name: 'FM 1458', id: '364' }])[0][7] === 'Yoakum · Texas');
t('transtar: drops ambiguous matches', () => matchTranstar([hou('IH-45 North @ Franklin')], [{ road: 'IH-45_North', name: 'Franklin', id: '202' }, { road: 'IH-45_North', name: 'Franklin', id: '999' }]).length === 0);

// ── IBI 511 helpers ──
t('wkt: parses POINT (lng lat)', () => eq(parseWkt('POINT (-111.66204 40.24863)'), { lat: 40.24863, lng: -111.66204 }));
t('wkt: tolerates whitespace', () => eq(parseWkt('POINT(  -111.5   40.7 )'), { lat: 40.7, lng: -111.5 }));
t('wkt: null for bad input', () => [undefined, null, '', 'LINESTRING (1 2, 3 4)'].every((w) => parseWkt(w) === null));
t('buildQuery: paging encoded', () => { const q = JSON.parse(decodeURIComponent(buildQuery(200, 100))); return q.start === 200 && q.length === 100 && eq(q.order, [{ column: 1, dir: 'asc' }]) && eq(q.search, { value: '' }); });

// ── Nevada ──
const nv = { id: 2, roadway: 'McCarran & Caughlin/cashill', location: 'N/A', latLng: { geography: { wellKnownText: 'POINT (-119.8 39.5)' } },
  images: [{ id: 2, description: 'McCarran & Caughlin/cashill', imageUrl: '/map/Cctv/2', videoUrl: 'https://d2wse2.its.nv.gov:443/renoxcd02/abc_public.stream/playlist.m3u8', blocked: false, disabled: false }] };
const nvImg = (p) => ({ ...nv, images: [{ ...nv.images[0], ...p }] });
t('nevada: snapshot + HLS stream', () => eq(mapNevada(nv), ['ndot-2', 'McCarran & Caughlin/cashill', 39.5, -119.8, 'https://www.nvroads.com/map/Cctv/2', 'https://d2wse2.its.nv.gov:443/renoxcd02/abc_public.stream/playlist.m3u8', 0, 'Nevada']));
t('nevada: snapshot only when no video', () => { const r = mapNevada(nvImg({ videoUrl: null })); return r[4] === 'https://www.nvroads.com/map/Cctv/2' && r[5] === ''; });
t('nevada: ignores disabled video', () => mapNevada(nvImg({ videoDisabled: true }))[5] === '');
t('nevada: drops blocked/disabled/imageless', () => [nvImg({ blocked: true }), nvImg({ disabled: true }), { ...nv, images: [] }].every((r) => mapNevada(r) === null));
t('nevada: drops coordinates outside Nevada', () => mapNevada({ ...nv, latLng: { geography: { wellKnownText: 'POINT (-80.19 25.76)' } } }) === null && mapNevada({ ...nv, latLng: null }) === null);
t('nevada: falls back to id name', () => mapNevada({ ...nv, roadway: null, images: [{ ...nv.images[0], description: null }] })[1] === 'NDOT Camera 2');

// ── Utah ──
const ut = { id: 112731, location: 'Freedom Blvd / 200 W @ 1100 N, PVO', roadway: 'Unknown', latLng: { geography: { wellKnownText: 'POINT (-111.66204 40.24863)' } }, images: [{ imageUrl: '/map/Cctv/112731', blocked: false, disabled: false }] };
t('utah: maps a record', () => eq(mapUtah(ut), ['udot-112731', 'Freedom Blvd / 200 W @ 1100 N, PVO', 40.24863, -111.66204, 'https://prod-ut.ibi511.com/map/Cctv/112731', '', 0, 'Utah']));
t('utah: name fallbacks', () => mapUtah({ ...ut, location: null, roadway: 'I-15 NB' })[1] === 'I-15 NB' && mapUtah({ ...ut, location: null, roadway: null })[1] === 'UDOT Traffic Camera');
t('utah: skips blocked/disabled/imageless', () => [[{ blocked: true }], [{ disabled: true }], [], null].every((images) => mapUtah({ ...ut, images }) === null));
t('utah: skips bad or out-of-state coordinates', () => [null, { geography: { wellKnownText: 'bad' } }, { geography: { wellKnownText: 'POINT (-0.1276 51.5072)' } }].every((latLng) => mapUtah({ ...ut, latLng }) === null));

// ── Oregon ──
const orA = { cameraId: 277, filename: 'AstoriaUS101MeglerBrNB_pid392.jpg', latitude: 46.18785, longitude: -123.85347, route: 'US101 ', title: 'US101 at Astoria - ODOT District Office' };
const orF = (p) => ({ attributes: { ...orA, ...p } });
t('oregon: maps a feature', () => eq(mapOregon({ attributes: orA }), ['odot-277', 'US101 at Astoria - ODOT District Office', 46.18785, -123.85347, 'https://tripcheck.com/RoadCams/cams/AstoriaUS101MeglerBrNB_pid392.jpg', '', 0, 'US101 · Oregon']));
t('oregon: name fallbacks', () => mapOregon(orF({ title: null }))[1] === 'US101' && mapOregon(orF({ title: null, route: null }))[1] === 'ODOT Camera 277');
t('oregon: skips missing id/filename/coords and outside box', () => [orF({ cameraId: null }), orF({ filename: null }), {}, orF({ latitude: null }), orF({ longitude: undefined }), orF({ latitude: 51.5072, longitude: -0.1276 })].every((f) => mapOregon(f) === null));
t('oregon: parseOregon dedupes features', () => parseOregon({ features: [{ attributes: orA }, { attributes: orA }, orF({ cameraId: 278 })] }).length === 2);

// ── Singapore ──
const sg = JSON.parse(readFileSync(new URL('./fixtures/west-asia-pacific/singapore.json', import.meta.url), 'utf8'));
t('singapore: parses data.gov.sg cameras, drops bad rows', () => {
  const r = parseSingapore(sg);
  return r.length === 2 && eq(r[0], ['sg-1001', 'LTA camera 1001', 1.29531, 103.87115, 'https://images.data.gov.sg/api/traffic-images/2026/10/7a2f5d7e-1001.jpg', '', 0, 'Singapore']);
});
t('singapore: empty payload → no rows', () => parseSingapore({}).length === 0);

// ── Japan ──
t('mlit: static rows have HTTPS images and Japan coordinates', () => { const r = mlitRows(); return r.length === 12 && r.every((c) => c[0].startsWith('mlit-') && c[4].startsWith('https://cam.river.go.jp/cam/now/') && c[2] > 35 && c[2] < 36 && c[3] > 139 && c[3] < 140); });

// ── Module shape ──
t('sources: unique keys, names and run functions', () => sources.length === 6 && new Set(sources.map((s) => s.key)).size === 6 && sources.every((s) => s.key && s.name && typeof s.run === 'function'));
const meta = JSON.parse(readFileSync(new URL('../../tools/cameras/west-asia-pacific.meta.json', import.meta.url), 'utf8'));
t('meta: one entry per source key with APA pair', () => eq(meta.map((m) => m.key).sort(), sources.map((s) => s.key).sort()) && meta.every((m) => m.name && m.url.startsWith('https://') && m.license && m.role && m.apa.length === 2));
const reg = readFileSync(new URL('../../site/app/js/sources.js', import.meta.url), 'utf8');
t('meta: no key already in sources.js', () => meta.every((m) => !new RegExp(`^\\s*${m.key}:`, 'm').test(reg)));

console.log(`SUMMARY ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
