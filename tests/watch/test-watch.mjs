// SPDX-License-Identifier: AGPL-3.0-only
// v2.25 live watch feeds (site/app/js/watchfeeds.js), offline: lightning time, storms joined to their forecast,
// fire and airspace records, the GPS-integrity rule and gpsjam.org's cell bands.  node tests/watch/test-watch.mjs
import * as m from '../../site/app/js/watchfeeds.js';
const res = [];
const check = (name, ok, info = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, ok ? '' : JSON.stringify(info)); };

const caps = `<Layer><Name>other</Name><Dimension name="time" default="2020-01-01T00:00:00Z">x</Dimension></Layer>
<Layer><Name>ldn_lightning_strike_density</Name><Dimension name="time" units="ISO8601" default="2026-11-11T20:55:00Z">2026-11-11T20:45:00Z,2026-11-11T20:55:00Z</Dimension></Layer>`;
check('the lightning image time is read from its own layer in the capabilities', m.lightningTime(caps) === '2026-11-11T20:55:00.000Z', m.lightningTime(caps));
check('no time when the layer is missing', m.lightningTime('<Layer><Name>x</Name></Layer>') === null);
check('the lightning request is one plate carrée world image', /SRS=EPSG%3A4326/.test(m.lightningUrl()) && /BBOX=-180%2C-90%2C180%2C90/.test(m.lightningUrl()));

const status = { activeStorms: [
  { id: 'AL052026', name: 'Ernesto', classification: 'HU', intensity: '100', pressure: '955', latitudeNumeric: 25, longitudeNumeric: -70, movementDir: 0, movementSpeed: 23, lastUpdate: '2026-08-15T21:00:00Z', forecastAdvisory: { advNum: '021', issuance: '2026-08-15T21:00:00Z', url: 'https://www.nhc.noaa.gov/text/MIATCMAT5.shtml' } },
  { id: 'xx', name: 'bad id' },
  { id: 'ep012026', name: 'Aletta', classification: 'TS', intensity: '40', latitudeNumeric: 15, longitudeNumeric: -105, forecastAdvisory: { advNum: '2', url: 'https://evil.example/x' } },
] };
const fc = (kind, items) => ({ type: 'FeatureCollection', features: items.map(([src, g, p = {}]) => ({ type: 'Feature', geometry: g, properties: { idp_source: src, ...p } })) });
const gis = [
  fc('pts', [['al052026-020_5day_pts', { type: 'Point', coordinates: [-70, 24] }, { tau: 0, maxwind: 95 }], ['al052026-020_5day_pts', { type: 'Point', coordinates: [-69, 27] }, { tau: 12, maxwind: 105 }], ['al052026-019_5day_pts', { type: 'Point', coordinates: [-71, 22] }, { tau: 0, maxwind: 90 }]]),
  fc('lin', [['al052026-020_5day_lin', { type: 'LineString', coordinates: [[-70, 24], [-69, 27]] }]]),
  fc('pgn', [['al052026-020_5day_pgn', { type: 'Polygon', coordinates: [[[-71, 24], [-68, 27], [-70, 27.5], [-71, 24]]] }]]),
];
const st = m.assembleStorms(status, gis);
check('active storms are read and bad ids dropped', st.length === 2 && st[0].id === 'al052026' && st[0].basin === 'Atlantic', st.map((s) => s.id));
check('movement is turned from miles per hour into knots', st[0].moveKt === 20, st[0].moveKt);
check('when the map service lags, the storm gets its newest advisory there (20, not 19)', st[0].gisAdv === '20' && st[0].points.length === 2 && st[0].points[1].tau === 12 && st[0].cone?.type === 'Polygon' && st[0].track?.type === 'LineString', st[0]);
check('only official NHC advisory links are kept', st[0].url && st[1].url === null);
check('Saffir–Simpson categories from knots', [63, 64, 83, 96, 113, 137].map(m.category).join() === '0,1,2,3,4,5');

const fires = m.slimFires({ features: [{ geometry: { type: 'Polygon', coordinates: [[[-120.123456, 39.1], [-120, 39.2], [-120.1, 39.3], [-120.123456, 39.1]]] }, properties: { poly_IncidentName: 'Test', attr_UniqueFireIdentifier: '2026-CA-1', attr_IncidentSize: 1234.5, attr_PercentContained: 40, attr_IncidentTypeCategory: 'WF', attr_FireDiscoveryDateTime: 1780000000000, poly_DateCurrent: '2026-11-01T00:00:00Z' } }, { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] });
check('fire outlines: polygons only, rounded to about 10 m, dates read as numbers or text', fires.length === 1 && fires[0].geometry.coordinates[0][0][0] === -120.1235 && fires[0].found === 1780000000000 && fires[0].mapped === Date.parse('2026-11-01T00:00:00Z'), fires[0]);
check('a live-data copy passes through unchanged', m.slimFires({ fires }) === fires || m.slimFires({ fires })[0] === fires[0]);

check('airspace heights in words', [m.heightText(0, 'FT', 'SFC'), m.heightText(18000, 'FT', 'MSL'), m.heightText(-9998, 'FT', 'UNL'), m.heightText(999, 'FL', 'MSL'), m.heightText(180, 'FL', 'MSL'), m.heightText(500, 'FT', 'AGL')].join(' | ')
  === 'the ground | 18,000 ft above sea level | unlimited | unlimited | flight level 180 (about 18,000 ft) | 500 ft above the ground');
const z = m.slimZones({ features: [{ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { OBJECTID: 7, NAME: 'R-1', TYPE_CODE: 'R', UPPER_VAL: 230, UPPER_UOM: 'FL', LOWER_VAL: 0, LOWER_CODE: 'SFC' } }] });
check('restricted area ceiling in feet for drawing', z[0].topFt === 23000 && z[0].type === 'R', z[0]);

const a = (o) => ({ hex: 'abc', type: 'adsb_icao', version: 2, lat: 54, lon: 19, seen_pos: 1, ...o });
check('aircraft with good GPS are not flagged', m.gnssRow(a({ nic: 8, nac_p: 10 })).bad === false);
check('NACp under 8 is flagged', m.gnssRow(a({ nic: 8, nac_p: 7 })).bad === true);
check('NIC under 7 is flagged, except NIC 0 with NACp 10 or more', m.gnssRow(a({ nic: 6, nac_p: 9 })).bad === true && m.gnssRow(a({ nic: 0, nac_p: 10 })).bad === false);
check('lost GPS is flagged at the last good position', (() => { const r = m.gnssRow(a({ nic: 8, nac_p: 10, gpsOkBefore: 1, gpsOkLat: 53, gpsOkLon: 18 })); return r.bad && r.lat === 53 && r.lng === 18; })());
check('stale positions, other message types and version 0 are left out', [a({ nic: 8, nac_p: 10, seen_pos: 90 }), a({ nic: 8, nac_p: 10, type: 'tisb_icao' }), a({ nic: 8, nac_p: 10, version: 0 }), a({})].every((x) => m.gnssRow(x) === null));
check('gpsjam.org bands: the first bad aircraft is discounted', [m.gnssLevel(50, 1).level, m.gnssLevel(50, 2).level, m.gnssLevel(50, 6).level, m.gnssLevel(50, 7).level].join() === 'low,medium,medium,high');
const rows = [...Array(4)].map((_, i) => m.gnssRow(a({ hex: `h${i}`, nic: 0, nac_p: 0, lat: 54.5, lon: 19.5 }))).concat([m.gnssRow(a({ hex: 'h0', nic: 8, nac_p: 10 })), m.gnssRow(a({ hex: 'x', nic: 8, nac_p: 10, lat: 10.5, lon: 10.5 }))]);
const cells = m.gnssCells(rows);
check('cells count each aircraft once (a bad report wins) and need 3 aircraft', JSON.stringify(cells) === '[[54,19,4,4]]', cells);

// ring order: the globe fills the right-hand side of a ring, so outer rings must be clockwise (GeoJSON sends them anticlockwise)
const shoe = (r) => r.slice(0, -1).reduce((t, p, i) => t + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0) / 2;
const ccw = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [0.5, 1], [1, 1], [0.5, 0.5]]] };
const fixed = m.smallSide(ccw); const again = m.smallSide(fixed);
check('outer rings turn clockwise and holes anticlockwise, and doing it twice changes nothing', shoe(fixed.coordinates[0]) < 0 && shoe(fixed.coordinates[1]) > 0 && JSON.stringify(again) === JSON.stringify(fixed), fixed);
const date = m.smallSide({ type: 'MultiPolygon', coordinates: [[[[179, 0], [-179, 0], [-179, 1], [179, 1], [179, 0]]]] }).coordinates[0][0];
check('a ring across the 180° line is measured unwrapped', JSON.stringify(date[1]) === '[179,1]', date);

console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
