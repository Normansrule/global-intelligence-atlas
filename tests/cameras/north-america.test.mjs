#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Offline checks for tools/cameras/north-america.mjs. Fixtures are trimmed from the sample payloads in Osiris's
// *.test.ts files (adapted from Osiris by simplifaisoul, MIT). Run: node tests/cameras/north-america.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as na from '../../tools/cameras/north-america.mjs';

let pass = 0; let total = 0;
const t = async (name, fn) => { total++; try { await fn(); pass++; console.log(`PASS ${name}`); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); } };
const [ID, NAME, LAT, LNG, IMG, STREAM, , AREA] = [0, 1, 2, 3, 4, 5, 6, 7];

// ── IBI 511 ──
const FDOT = na.IBI.fl511; const MTO = na.IBI.on511;
const sample = {
  id: 1, roadway: 'I-95', direction: 'Northbound', location: 'I-95 MP 134.0 Northbound', county: 'Brevard',
  latLng: { geography: { wellKnownText: 'POINT (-80.892882 26.17325)' } },
  images: [{ imageUrl: '/map/Cctv/1', videoUrl: 'https://dis-se18.divas.cloud:8200/chan-1_h/index.m3u8', blocked: false, disabled: false }],
};
const img0 = (o) => ({ ...sample, images: [{ ...sample.images[0], ...o }] });
const openCfg = { ...FDOT, snapshotOnly: false };

await t('parseWkt reads lng first and rejects other shapes', () => {
  assert.deepEqual(na.parseWkt('POINT (-80.892882 26.17325)'), { lat: 26.17325, lng: -80.892882 });
  assert.equal(na.parseWkt(null), null); assert.equal(na.parseWkt('LINESTRING (0 0, 1 1)'), null);
});
await t('cameraLabel keeps places, strips code prefixes, falls back to road+direction', () => {
  assert.equal(na.cameraLabel(sample), 'I-95 MP 134.0 Northbound');
  assert.equal(na.cameraLabel({ ...sample, location: 'GDOT-1130: I-20 E at SR5 MM 34.2 (Douglas)' }), 'I-20 E at SR5 MM 34.2 (Douglas)');
  assert.equal(na.cameraLabel({ ...sample, roadway: 'I-485', direction: 'Outer', location: 'CCTV10-I485-30.1O_I85' }), 'I-485 Outer');
  assert.equal(na.cameraLabel({ ...sample, location: 'SR-389 @MP3.3' }), 'SR-389 @MP3.3');
  assert.equal(na.cameraLabel({ ...sample, location: 'N/A' }), 'I-95 Northbound');
  assert.equal(na.cameraLabel({ ...sample, location: null, roadway: null }), null);
});
await t('cameraCity prefers city, then county, then state', () => {
  assert.equal(na.cameraCity({ ...sample, city: 'Bullhead City' }, 'Arizona'), 'Bullhead City');
  assert.equal(na.cameraCity(sample, 'Florida'), 'Brevard County');
  assert.equal(na.cameraCity({ ...sample, city: 'N/A', county: 'N/A' }, 'Florida'), 'Florida');
  assert.equal(na.cameraCity({ ...sample, county: 'Toronto' }, 'Ontario', ''), 'Toronto');
});
await t('mapIbi511Record maps a streaming camera (open deployment)', () => {
  assert.deepEqual(na.mapIbi511Record(sample, openCfg), ['fl-1', 'I-95 MP 134.0 Northbound', 26.17325, -80.89288, 'https://fl511.com/map/Cctv/1',
    'https://dis-se18.divas.cloud:8200/chan-1_h/index.m3u8', 0, 'Florida · Brevard County · I-95']);
});
await t('Florida is snapshot-only; auth-gated, disabled and non-HLS video is dropped', () => {
  const r = na.mapIbi511Record(sample, FDOT); assert.equal(r[STREAM], ''); assert.equal(r[IMG], 'https://fl511.com/map/Cctv/1');
  assert.equal(na.mapIbi511Record(img0({ isVideoAuthRequired: true }), openCfg)[STREAM], '');
  assert.equal(na.mapIbi511Record(img0({ videoDisabled: true }), openCfg)[STREAM], '');
  assert.equal(na.mapIbi511Record(img0({ videoUrl: 'https://fl511.com/snapshots?id=4&ext=.jpg' }), openCfg)[STREAM], '');
});
await t('mapIbi511Record skips blocked, disabled, unplaced and out-of-state rows', () => {
  assert.equal(na.mapIbi511Record(img0({ blocked: true }), FDOT), null);
  assert.equal(na.mapIbi511Record(img0({ disabled: true }), FDOT), null);
  assert.equal(na.mapIbi511Record({ ...sample, images: [] }, FDOT), null);
  assert.equal(na.mapIbi511Record({ ...sample, latLng: null }, FDOT), null);
  assert.equal(na.mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-84.33 34.07)' } } }, FDOT), null);
});
await t('Ontario row (511on.ca) maps with an un-suffixed region', () => {
  const qew = { id: 1283, roadway: 'QEW', direction: 'Unknown', location: 'QEW East of Concession Road', county: 'Niagara',
    latLng: { geography: { wellKnownText: 'POINT (-78.925595 42.911243)' } }, images: [{ imageUrl: '/map/Cctv/2555', blocked: false, disabled: false }] };
  assert.deepEqual(na.mapIbi511Record(qew, MTO), ['on-1283', 'QEW East of Concession Road', 42.91124, -78.92559, 'https://511on.ca/map/Cctv/2555', '', 0, 'Ontario · Niagara · QEW']);
});
await t('Louisiana labels by cross-street, then roadway, then caption; keeps HLS', () => {
  const la = { id: 1, roadway: 'I-20', location: 'I-20 at I-220 Off Ramp', latLng: { geography: { wellKnownText: 'POINT (-93.630833 32.538889)' } },
    images: [{ id: 1, description: 'Traffic closest to this camera is traveling eastbound on I-20.', imageUrl: '/map/Cctv/1', videoUrl: 'https://ITSStreamingBR2.dotd.la.gov/public/shr-cam-030.streams/playlist.m3u8' }] };
  const r = na.mapIbi511Record(la, na.IBI.la511);
  assert.equal(r[ID], 'la-1'); assert.equal(r[NAME], 'I-20 at I-220 Off Ramp'); assert.equal(r[IMG], 'https://511la.org/map/Cctv/1');
  assert.match(r[STREAM], /dotd\.la\.gov.*playlist\.m3u8$/);
  assert.equal(na.mapIbi511Record({ ...la, location: 'N/A', roadway: null }, na.IBI.la511)[NAME], 'Traffic closest to this camera is traveling eastbound on I-20.');
  assert.equal(na.mapIbi511Record({ ...la, latLng: { geography: { wellKnownText: 'POINT (-95.37 29.76)' } } }, na.IBI.la511), null);
});
await t('parseIbi511Page reads rows and recordsTotal', () => {
  const p = na.parseIbi511Page({ recordsTotal: 2, data: [sample, { ...sample, id: 2, latLng: null }] }, FDOT);
  assert.equal(p.total, 2); assert.equal(p.raw, 2); assert.equal(p.rows.length, 1);
  assert.deepEqual(na.parseIbi511Page({}, FDOT), { rows: [], raw: 0, total: 0 });
});
await t('buildQuery encodes start/length the way the DataTables endpoint expects', () => {
  const q = JSON.parse(decodeURIComponent(na.buildQuery(50, 50)));
  assert.equal(q.start, 50); assert.equal(q.length, 50); assert.equal(q.columns.length, 4);
  assert.ok(na.ibi511PageUrl(na.IBI.ab511, 0).startsWith('https://511.alberta.ca/List/GetData/Cameras?query='));
});
await t('loadIbi511 pages at the deployment size (Alberta: 50) with ≤4 in flight, and dedupes', async () => {
  const asked = []; let inFlight = 0; let peak = 0;
  const fake = async (u) => {
    const q = JSON.parse(new URL(u).searchParams.get('query')); asked.push([q.start, q.length]);
    inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--;
    const rows = Array.from({ length: Math.min(q.length, 320 - q.start) }, (_, i) => ({ ...sample, id: q.start + i + 1, latLng: { geography: { wellKnownText: 'POINT (-114.2 51.1)' } } }));
    return { recordsTotal: 320, data: rows };
  };
  const cams = await na.loadIbi511(na.IBI.ab511, fake);
  assert.equal(cams.length, 320); assert.ok(peak <= 4, `peak ${peak}`);
  assert.deepEqual(asked.map((a) => a[0]).sort((a, b) => a - b), [0, 50, 100, 150, 200, 250, 300]);
  assert.ok(asked.every((a) => a[1] === 50));
});
await t('loadIbi511 retries a failed page once and throws on a short read', async () => {
  let failOnce = true;
  const flaky = async (u) => { const q = JSON.parse(new URL(u).searchParams.get('query')); if (q.start === 100 && failOnce) { failOnce = false; throw new Error('429'); }
    return { recordsTotal: 200, data: Array.from({ length: 100 }, (_, i) => ({ ...sample, id: q.start + i + 1 })) }; };
  assert.equal((await na.loadIbi511(FDOT, flaky)).length, 200);
  const dead = async (u) => { const q = JSON.parse(new URL(u).searchParams.get('query')); if (q.start > 0) throw new Error('500'); return { recordsTotal: 500, data: [sample] }; };
  await assert.rejects(na.loadIbi511(FDOT, dead), /short read/);
});

// ── Edmonton ──
const yeg = (o = {}) => ({ Code: 106, Forge: 1, Latitude: '53.4573', Longitude: '-113.589', MMSUrl: 'cityed1-winkcdn1.winkcdn.com',
  PrimaryRoad: '23 Avenue', SecondaryRoad: 'Terwillegar Drive', Status: '1', StreamCode: 'WF06-3E67-A9A3-DD98-BCE9_ab', StreamCodeMask: '23ave_terw', ...o });
await t('parseEdmonton assembles the HLS playlist from host, forge and stream code', () => {
  assert.deepEqual(na.parseEdmonton({ d: [yeg()] }), [['yeg-106', '23 Avenue & Terwillegar Drive', 53.4573, -113.589, '',
    'https://cityed1-winkcdn1.winkcdn.com/1/public/hls/WF06-3E67-A9A3-DD98-BCE9_ab.m3u8', 0, 'Alberta · Edmonton']]);
});
await t('parseEdmonton drops offline, unplaced, foreign-host and unsafe rows; dedupes', () => {
  for (const o of [{ Status: '0' }, { Latitude: '' }, { Latitude: '51.0447', Longitude: '-114.0719' }, { StreamCode: '../evil' }, { Forge: undefined }, { Code: undefined }, { MMSUrl: 'winkcdn.com.example.com' }])
    assert.deepEqual(na.parseEdmonton({ d: [yeg(o)] }), [], JSON.stringify(o));
  assert.equal(na.parseEdmonton({ d: [yeg(), yeg()] }).length, 1);
  assert.deepEqual(na.parseEdmonton(null), []); assert.deepEqual(na.parseEdmonton({ d: 'error' }), []);
});

// ── Indiana ──
const indot = { title: 'I-94: 1-094-035-8-1 E OF US421', uri: 'camera/21504', features: [{ geometry: { coordinates: [-86.86994, 41.66028] } }], __typename: 'Camera', active: true,
  views: [{ url: 'https://public.carsprogram.org/cameras/IN/INDOT_528_sdRf2LeZp7VYFgcF.flv.png', category: 'VIDEO' }] };
await t('mapIndotFeature keeps poster still and rebuilt HLS stream', () => {
  assert.deepEqual(na.mapIndotFeature(indot), ['indot-21504', 'I-94: E OF US421', 41.66028, -86.86994, 'https://public.carsprogram.org/cameras/IN/INDOT_528_sdRf2LeZp7VYFgcF.flv.png',
    'https://skysfs4.trafficwise.org/preroll/INDOT_528_sdRf2LeZp7VYFgcF/playlist.m3u8', 0, 'Indiana']);
});
await t('mapIndotFeature drops placeholders, inactive, non-camera, out-of-state and id-less features', () => {
  assert.equal(na.mapIndotFeature({ ...indot, views: [{ url: '/images/icon-camera-closed-fill-solid-padded.svg' }] }), null);
  assert.equal(na.mapIndotFeature({ ...indot, active: false }), null);
  assert.equal(na.mapIndotFeature({ ...indot, __typename: 'Event' }), null);
  assert.equal(na.mapIndotFeature({ ...indot, features: [{ geometry: { coordinates: [-118.24, 34.05] } }] }), null);
  assert.equal(na.mapIndotFeature({ ...indot, uri: null }), null);
  assert.equal(na.parseIndot({ data: { mapFeaturesQuery: { mapFeatures: [indot, indot] } } }).length, 1);
  assert.throws(() => na.parseIndot({}));
});
await t('cleanIndotTitle strips delimited asset numbers only', () => {
  assert.equal(na.cleanIndotTitle('I-65: 1-065-172-4-2 SR-38'), 'I-65: SR-38');
  assert.equal(na.cleanIndotTitle('I-94: 1-094-041-0-2NORTH OF WARNKE RD'), 'I-94: 1-094-041-0-2NORTH OF WARNKE RD');
  assert.equal(na.cleanIndotTitle('I-70: 1-070-064-6-eb-ra-cam-1 REST PARK PLAINFIELD EB'), 'I-70: REST PARK PLAINFIELD EB');
});

// ── Michigan ──
const mi = { route: '11 Mile', county: 'Wayne County <a href="/MiDrive/map?cameras=true&lat=42.491304&lon=-83.04479&zoom=15&id=1129"target="_blank">Go to</a>',
  location: ' @ Mound NB', image: '<img alt="north" id="1129Img" src="https://micamerasimages.net/thumbs/semtoc_cam_253.flv.jpg?item=1" height="170"><div id="1129Div"></div>' };
await t('mapMiDrive extracts coordinates, id and frame URL out of embedded HTML', () => {
  assert.deepEqual(na.mapMiDrive(mi), ['mdot-1129', '11 Mile @ Mound NB', 42.4913, -83.04479, 'https://micamerasimages.net/thumbs/semtoc_cam_253.flv.jpg?item=1', '', 0, 'Michigan · Wayne County']);
  assert.equal(na.mapMiDrive({ ...mi, county: mi.county.replace('&lat=', '&amp;lat=').replace('&lon=', '&amp;lon=') })[LAT], 42.4913);
});
await t('mapMiDrive skips incomplete and out-of-state records', () => {
  assert.equal(na.mapMiDrive({ ...mi, county: 'Wayne County' }), null);
  assert.equal(na.mapMiDrive({ ...mi, image: '<img src="/relative/path.jpg">' }), null);
  assert.equal(na.mapMiDrive({}), null);
  assert.equal(na.mapMiDrive({ ...mi, county: mi.county.replace('lat=42.491304&lon=-83.04479', 'lat=51.5072&lon=-0.1276') }), null);
  assert.equal(na.mapMiDrive({ ...mi, route: null, location: null })[NAME], 'MDOT camera 1129');
});

// ── Inline route.ts sources ──
await t('parseWsdot keeps placed cameras with an image (http upgraded to https)', () => {
  const r = na.parseWsdot([{ CameraID: 9001, Title: 'I-5 at NE 45th St', ImageURL: 'http://images.wsdot.wa.gov/nw/005vc16952.jpg', CameraLocation: { Latitude: 47.66, Longitude: -122.32, RoadName: 'I-5' } },
    { CameraID: 9002, Title: 'No image', ImageURL: '', CameraLocation: { Latitude: 47.6, Longitude: -122.3 } }, { CameraID: 9003, ImageURL: 'https://x.wsdot.wa.gov/a.jpg', CameraLocation: {} }]);
  assert.deepEqual(r, [['wsdot-9001', 'I-5 at NE 45th St', 47.66, -122.32, 'https://images.wsdot.wa.gov/nw/005vc16952.jpg', '', 0, 'Washington · I-5']]);
});
await t('parseWsdot also reads the mobile-app list', () => {
  const r = na.parseWsdot({ cameras: { items: [{ id: 5, title: 'SR 520 at Montlake', url: 'https://images.wsdot.wa.gov/nw/520vc00430.jpg', lat: 47.64, lon: -122.3, roadName: 'SR 520' }, { id: 6, title: 'No place', url: 'https://images.wsdot.wa.gov/x.jpg' }] } });
  assert.deepEqual(r, [['wsdot-5', 'SR 520 at Montlake', 47.64, -122.3, 'https://images.wsdot.wa.gov/nw/520vc00430.jpg', '', 0, 'Washington · SR 520']]);
});
await t('parseOttawa builds the still URL from the camera number', () => {
  const r = na.parseOttawa([{ id: 12, number: 2003, latitude: 45.42, longitude: -75.69, description: 'Bank St & Wellington St' }, { id: 13, latitude: null, longitude: -75 }]);
  assert.deepEqual(r, [['ott-12', 'Bank St & Wellington St', 45.42, -75.69, 'https://traffic.ottawa.ca/map/camera?id=2003', '', 0, 'Ontario · Ottawa']]);
});
await t('parseToronto reads Point and MultiPoint features', () => {
  const r = na.parseToronto({ features: [
    { geometry: { type: 'MultiPoint', coordinates: [[-79.3832, 43.6532]] }, properties: { REC_ID: 8001, MAINROAD: 'YONGE ST', CROSSROAD: 'QUEEN ST', IMAGEURL: 'http://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc8001.jpg' } },
    { geometry: { type: 'Point', coordinates: [-79.4, 43.7] }, properties: { REC_ID: 8002, MAINROAD: 'BAY ST' } }] });
  assert.equal(r.length, 1); assert.equal(r[0][ID], 'tor-8001'); assert.equal(r[0][NAME], 'YONGE ST / QUEEN ST'); assert.ok(r[0][IMG].startsWith('https://opendata.toronto.ca/'));
});
await t('Butler County static rows are valid HTTPS stills', () => {
  assert.equal(na.BUTLER.length, 2); assert.ok(na.BUTLER.every((r) => r[IMG].startsWith('https://') && r[AREA].startsWith('Ohio')));
});

// ── Module contract ──
await t('sources export: unique keys, names, run functions, required keys present', () => {
  const keys = na.sources.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(na.sources.every((s) => typeof s.run === 'function' && s.name && /^[a-z0-9]+$/.test(s.key)));
  for (const k of ['on511', 'ab511', 'az511', 'fl511', 'ga511', 'drivenc', 'la511', 'yegtraffic', 'indot', 'midrive', 'wsdot']) assert.ok(keys.includes(k), k);
});
await t('meta.json covers every source with an APA pair; only on511/ab511 replace', () => {
  const meta = JSON.parse(readFileSync(new URL('../../tools/cameras/north-america.meta.json', import.meta.url)));
  const mk = meta.map((m) => m.key).sort(); assert.deepEqual(mk, na.sources.map((s) => s.key).sort());
  assert.ok(meta.every((m) => m.name && /^https:\/\//.test(m.url) && m.license && m.role && m.apa.length === 2 && m.apa[1].includes(m.url.replace(/\/$/, '').split('/')[2])));
  assert.deepEqual(meta.filter((m) => m.replace).map((m) => m.key).sort(), ['ab511', 'on511']);
});
await t('ID prefixes are distinct per source', () => {
  const p = Object.values(na.IBI).map((c) => c.idPrefix); assert.equal(new Set(p).size, p.length);
});

console.log(`SUMMARY ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
