// SPDX-License-Identifier: AGPL-3.0-only
// Checks the Open Eagle Eye merge (tools/cameras/eagle-eye.mjs) on a small fixture shaped like its registry.
//   node tests/cameras/eagle-eye.test.mjs
import { mergeEagleEye, rejectReason, EAGLE_TYPE } from '../../tools/cameras/eagle-eye.mjs';
let pass = 0; let n = 0;
const check = (name, ok, info = '') => { n++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : info); };
const TYPES = ['traffic', 'landmark', 'beach', 'ski', 'weather', 'aviation', 'nature', 'water', 'airport', 'port', 'volcano', 'science', 'observatory', 'satellite', 'border', 'railway', 'space', 'wildlife', 'tourism', 'other'];
const cam = (id, lat, lng, url, extra = {}) => ({ id, name: `Cam ${id}`, url, category: 'highway', country: 'US', city: 'X', coordinates: { lat, lng }, verified: true, auth: false, ...extra });
const accept = (u) => (/\.gov\//.test(u) || /geonet\.org\.nz/.test(u) ? ['Agency', 0] : null);

check('a good record passes', rejectReason(cam('a', 40, -105, 'https://cams.dot.gov/a.jpg')) === '');
check('http is refused', rejectReason(cam('b', 40, -105, 'http://cams.dot.gov/a.jpg')) === 'not HTTPS');
check('a bare IP address is refused', rejectReason(cam('c', 40, -105, 'https://10.1.2.3/a.jpg')) === 'bare IP address');
check('a password or key in the address is refused', rejectReason(cam('d', 40, -105, 'https://cams.dot.gov/a.jpg?key=abc')) === 'address carries credentials');
check('cameras that need a sign-in are refused', rejectReason(cam('e', 40, -105, 'https://cams.dot.gov/a.jpg', { auth: true })) === 'needs a sign-in');
check('unverified cameras are refused', rejectReason(cam('f', 40, -105, 'https://cams.dot.gov/a.jpg', { verified: false })) === 'not verified by Open Eagle Eye');
check('a 0,0 position is refused', rejectReason(cam('g', 0, 0, 'https://cams.dot.gov/a.jpg')) === 'no position');
check('every category maps to a worldcams type', Object.values(EAGLE_TYPE).every((t) => TYPES.includes(t)));

const state = () => { const ids = new Set(); return { cells: { '40_-110': [['w-1', 'Old', 40.0001, -105.0001, 'https://old.dot.gov/x.jpg', '', 0, 0, 'US', 'X', '']] }, pubs: [['Old agency', 0]], pubIx: new Map([['Old agency', 0]]), pubCount: [1], density: {}, uniq: (x) => { let y = x; for (let i = 2; ids.has(y); i++) y = `${x}-${i}`; ids.add(y); return y; }, types: TYPES }; };
const s = state();
const list = [
  cam('near', 40, -105, 'https://new.dot.gov/near.jpg'), // within 60 m of the existing camera
  cam('same', 41, -105, 'https://old.dot.gov/x.jpg'), // same image address
  cam('far', 41.5, -104.5, 'https://new.dot.gov/far.jpg'),
  cam('vol', -39.28, 175.57, 'https://images.geonet.org.nz/volcano/r.jpg', { category: 'volcano', country: 'NZ' }),
  cam('host', 42, -100, 'https://random-cams.example.com/a.jpg'), // not a reviewed host
  cam('native', 35, -90, 'https://new.dot.gov/n.jpg'),
];
const r = mergeEagleEye(s, list, accept, [['n-1', 'Native', 35.0002, -90.0002, 'https://agency.gov/n.jpg']]);
const rows = Object.values(s.cells).flat().filter((x) => x[0].startsWith('e-'));
check('two cameras are added', r.added === 2 && rows.length === 2, r);
check('the near, same-address, unreviewed and native duplicates are skipped', r.skipped['a camera is already listed within 60 m'] === 2 && r.skipped['same image address as a camera already listed'] === 1 && r.skipped['host not on the reviewed publisher list'] === 1, r.skipped);
const vol = rows.find((x) => x[3] > 170);
check('the volcano camera lands in its 10° cell with the volcano type', vol && s.cells['-40_170']?.includes(vol) && TYPES[vol[7]] === 'volcano', vol);
check('rows have the eleven worldcams columns and an image, no stream', rows.every((x) => x.length === 11 && x[4].startsWith('https://') && x[5] === ''));
check('a new publisher is registered and counted', s.pubs.length === 2 && s.pubCount[1] === 2, s.pubs);
check('the density grid is updated', Object.values(s.density).reduce((a, b) => a + b, 0) === 2);
const again = state(); const r2 = mergeEagleEye(again, list, accept, [['n-1', 'Native', 35.0002, -90.0002, '']]);
const ids1 = rows.map((x) => x[0]).sort().join(); const ids2 = Object.values(again.cells).flat().filter((x) => x[0].startsWith('e-')).map((x) => x[0]).sort().join();
check('ids are stable from run to run', r2.added === 2 && ids1 === ids2, [ids1, ids2]);
console.log(`\n${pass}/${n} passed`);
process.exit(pass === n ? 0 : 1);
