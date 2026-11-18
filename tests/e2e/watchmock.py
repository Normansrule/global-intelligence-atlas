# SPDX-License-Identifier: AGPL-3.0-only
# Sample data for the v2.25 live watch layers, in each service's own answer format, with times relative to now so
# the tests never depend on the date or on a live feed: NHC CurrentStorms.json and its map service (forecast points,
# track, cone), NIFC WFIGS fire perimeters, FAA Special Use Airspace, nowCOAST lightning (a PNG), and the live-data
# job's own copies (built by running site/app/js/watchfeeds.js in Node, exactly as tools/fetch-live.mjs does).
import json, math, os, subprocess, time, zlib, struct
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
now = int(time.time() * 1000)
iso = lambda ms: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ms / 1000))
H = 3_600_000

# ---- NHC: a Category 2 hurricane in the Gulf of Mexico with a five-day forecast, and an eastern Pacific storm
# whose map-service geometry has not been published yet
TRACK = [(0, 24.5, -85.2, 85, 105), (12, 25.6, -86.1, 95, 115), (24, 26.9, -86.8, 105, 130), (36, 28.2, -87.1, 100, 120),
         (48, 29.6, -87.0, 75, 90), (72, 32.4, -85.9, 40, 50), (96, 35.0, -83.5, 25, 35), (120, 37.1, -80.2, 25, 35)]
STATUS = {"activeStorms": [
    {"id": "al182026", "binNumber": "AT3", "name": "Rafael", "classification": "HU", "intensity": "85", "pressure": "968",
     "latitude": "24.5N", "longitude": "85.2W", "latitudeNumeric": 24.5, "longitudeNumeric": -85.2, "movementDir": 330, "movementSpeed": 12,
     "lastUpdate": iso(now - H), "forecastAdvisory": {"advNum": "012", "issuance": iso(now - H), "url": "https://www.nhc.noaa.gov/text/MIATCMAT3.shtml"}},
    {"id": "ep202026", "binNumber": "EP5", "name": "Sergio", "classification": "TS", "intensity": "45", "pressure": "1000",
     "latitudeNumeric": 14.1, "longitudeNumeric": -108.4, "movementDir": 290, "movementSpeed": 9,
     "lastUpdate": iso(now - 2 * H), "forecastAdvisory": {"advNum": "003", "issuance": iso(now - 2 * H), "url": "https://www.nhc.noaa.gov/text/MIATCMEP5.shtml"}},
]}
def _cone():
    left, right = [], []
    for i, (tau, la, lo, *_r) in enumerate(TRACK):
        a, b = TRACK[max(0, i - 1)], TRACK[min(len(TRACK) - 1, i + 1)]
        dy, dx = b[1] - a[1], (b[2] - a[2]) * math.cos(math.radians(la)); n = math.hypot(dx, dy) or 1
        r = 0.25 + tau * 0.022
        left.append([round(lo - dy / n * r, 4), round(la + dx / n * r, 4)]); right.append([round(lo + dy / n * r, 4), round(la - dx / n * r, 4)])
    ring = left + right[::-1]; return ring + [ring[0]]
SRC = 'al182026-012_5day_'
GIS = [
    {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lo, la]}, "properties": {"idp_source": SRC + 'pts', "advisnum": "12", "tau": tau, "maxwind": w, "gust": g}} for tau, la, lo, w, g in TRACK]},
    {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[lo, la] for _t, la, lo, *_r in TRACK]}, "properties": {"idp_source": SRC + 'lin', "advisnum": "12"}}]},
    {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_cone()]}, "properties": {"idp_source": SRC + 'pgn', "advisnum": "12"}}]},
]

# ---- WFIGS: a big wildfire in California, a contained one in Oregon and a prescribed burn in Florida
def _blob(la, lo, km, n=40, wobble=0.25):
    pts = [[round(lo + km / 111.2 * (1 + wobble * math.sin(3 * t)) * math.cos(t) / math.cos(math.radians(la)), 4), round(la + km / 111.2 * (1 + wobble * math.sin(3 * t)) * math.sin(t), 4)] for t in (2 * math.pi * i / n for i in range(n))]
    return pts + [pts[0]]
def _fire(name, uid, la, lo, km, acres, pct, st, county, typ, days, cause, crew, cost):
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_blob(la, lo, km)]}, "properties": {
        "poly_IncidentName": name, "attr_UniqueFireIdentifier": uid, "attr_IncidentSize": acres, "attr_PercentContained": pct, "attr_POOState": st,
        "attr_IncidentTypeCategory": typ, "attr_FireDiscoveryDateTime": now - days * 24 * H, "poly_DateCurrent": now - 9 * H, "attr_FireCause": cause,
        "attr_FireBehaviorGeneral": "Active" if pct < 60 else "Minimal", "attr_TotalIncidentPersonnel": crew, "attr_POOCounty": county,
        "attr_EstimatedCostToDate": cost, "attr_IncidentComplexityLevel": "Type 1 Incident" if crew > 800 else "Type 3 Incident", "attr_CpxName": None}}
WFIGS = {"type": "FeatureCollection", "features": [
    _fire('Ridge', '2026-CABTU-012345', 39.75, -121.45, 9, 48210, 35, 'US-CA', 'Butte', 'WF', 6, 'Undetermined', 1840, 41500000),
    _fire('Cedar Creek', '2026-ORDEF-000777', 43.7, -122.1, 4, 9120, 100, 'US-OR', 'Lane', 'WF', 30, 'Natural', 12, 9800000),
    _fire('Apalachicola RX 7', '2026-FLANF-000042', 30.2, -84.9, 1.5, 640, 80, 'US-FL', 'Liberty', 'RX', 1, 'Human', 25, 15000),
], "exceededTransferLimit": False}

# ---- FAA Special Use Airspace: P-56A over the National Mall and two restricted ranges
def _rect(s, w, n, e): return [[[w, s], [e, s], [e, n], [w, n], [w, s]]]
def _zone(oid, name, code, up, upu, upc, lo, lou, loc, times, agent, city, state, poly):
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": poly}, "properties": {"OBJECTID": oid, "NAME": name, "TYPE_CODE": code,
        "UPPER_VAL": up, "UPPER_UOM": upu, "UPPER_CODE": upc, "LOWER_VAL": lo, "LOWER_UOM": lou, "LOWER_CODE": loc, "TIMESOFUSE": times, "CONT_AGENT": agent, "CITY": city, "STATE": state}}
SUA = {"type": "FeatureCollection", "features": [
    _zone(1, 'P-56A', 'P', 18000, 'FT', 'MSL', 0, 'FT', 'SFC', 'CONTINUOUS', 'NO A/G', 'WASHINGTON', 'DISTRICT OF COLUMBIA', [_blob(38.8895, -77.035, 1.6, 24, 0.1)]),
    _zone(2, 'R-2508', 'R', -9998, 'FT', 'UNL', 0, 'FT', 'SFC', '0600-2200 MON-FRI; OTHER TIMES BY NOTAM', 'JOSHUA CONTROL', 'CHINA LAKE', 'CALIFORNIA', _rect(35.0, -118.2, 36.6, -116.6)),
    _zone(3, 'R-4808N', 'R', 999, 'FL', 'MSL', 0, 'FT', 'SFC', 'CONTINUOUS', 'NELLIS CONTROL', 'LAS VEGAS', 'NEVADA', _rect(36.9, -116.6, 37.6, -115.7)),
], "exceededTransferLimit": False}

# ---- nowCOAST lightning: a world PNG with a storm complex over Florida and the Gulf, and the capabilities time
def _png_px(w, h, fn):
    raw = b''.join(b'\x00' + b''.join(bytes(fn(x, y)) for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
def _strikes(x, y):
    lng = x / 512 * 360 - 180; lat = 90 - y / 256 * 180
    d = min(math.hypot(lng - c[1], lat - c[0]) / c[2] for c in [(27.5, -82.0, 2.2), (24.0, -88.0, 1.6), (-3.0, -60.0, 3.0)])
    return (255, 40, 30, 230) if d < 0.4 else (255, 215, 0, 200) if d < 0.7 else (30, 144, 255, 150) if d < 1 else (0, 0, 0, 0)
LIGHTNING_PNG = _png_px(512, 256, _strikes)
LIGHTNING_TIME = iso(now - 6 * 60_000)
CAPS = f'''<?xml version="1.0"?><WMS_Capabilities version="1.3.0"><Capability><Layer><Name>lightning_detection</Name>
<Layer queryable="1"><Name>ldn_lightning_strike_density</Name><Title>Lightning strike density</Title>
<Dimension name="time" default="{LIGHTNING_TIME}" units="ISO8601">{iso(now - 16 * 60_000)},{iso(now - 11 * 60_000)},{LIGHTNING_TIME}</Dimension></Layer></Layer></Capability></WMS_Capabilities>'''

# ---- adsb.lol around the Baltic: Gdańsk and Kaliningrad aircraft with poor integrity, Berlin normal
def _ac(i, la, lo, nic, nacp, lost=False):
    a = {"hex": f"4b{i:04x}", "type": "adsb_icao", "version": 2, "lat": la, "lon": lo, "nic": nic, "nac_p": nacp, "seen_pos": 1.2, "alt_baro": 35000}
    if lost: a.update({"gpsOkBefore": now / 1000 - 300, "gpsOkLat": la - 0.3, "gpsOkLon": lo})
    return a
ADSB = {"now": now, "ac": [_ac(i, 54.2 + (i % 5) * 0.1, 19.1 + (i % 7) * 0.1, 0 if i % 3 else 8, 0 if i % 3 else 9) for i in range(30)]
        + [_ac(100 + i, 52.3 + (i % 4) * 0.1, 13.2 + (i % 6) * 0.1, 8, 10) for i in range(40)]
        + [_ac(200, 55.4, 20.5, 8, 10, lost=True), _ac(201, 55.5, 20.6, 8, 10), _ac(202, 55.6, 20.7, 8, 10)]}

# ---- the live-data job's copies, made by the same code the job runs
_JS = r"""
const m = await import(process.argv[1]); const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const rows = d.adsb.ac.map(m.gnssRow).filter(Boolean);
console.log(JSON.stringify({ nhc: { generatedAt: d.at, storms: m.assembleStorms(d.status, d.gis) }, perimeters: { generatedAt: d.at, fires: m.slimFires(d.wfigs) },
  airspace: { generatedAt: d.at, zones: m.slimZones(d.sua) }, gnss: { generatedAt: d.at, deg: 1, fields: ['south', 'west', 'aircraft', 'bad'], cells: m.gnssCells(rows), aircraft: rows.length, regions: 1 },
  lightning: { generatedAt: d.at, time: m.lightningTime(d.caps), bytes: 0, source: 'test' } }));
"""
def _snapshots():
    js = 'file://' + os.path.join(ROOT, 'site', 'app', 'js', 'watchfeeds.js')
    inp = json.dumps({"at": iso(now - 3 * 60_000), "status": STATUS, "gis": GIS, "wfigs": WFIGS, "sua": SUA, "adsb": ADSB, "caps": CAPS})
    r = subprocess.run(['node', '--input-type=commonjs', '-e', f"(async () => {{ {_JS} }})()", js], input=inp, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)
_snap = {}
def snapshots():
    if not _snap: _snap.update({k + '.json': json.dumps(v) for k, v in _snapshots().items()})
    return _snap

def route(u):
    """(status, body, content type) for a watch-layer URL, or None when it is not one."""
    if 'nhc.noaa.gov/CurrentStorms.json' in u: return 200, json.dumps(STATUS), 'application/json'
    if 'NHC_tropical_weather_summary/MapServer/' in u:
        i = {'5': 0, '6': 1, '7': 2}.get(u.split('/MapServer/')[1].split('/')[0])
        return (200, json.dumps(GIS[i]), 'application/json') if i is not None else (404, '{}', 'application/json')
    if 'WFIGS_Interagency_Perimeters_Current' in u: return 200, json.dumps(WFIGS), 'application/json'
    if 'Special_Use_Airspace/FeatureServer' in u: return 200, json.dumps(SUA), 'application/json'
    if 'nowcoast.noaa.gov' in u and 'GetCapabilities' in u: return 200, CAPS, 'text/xml'
    if 'nowcoast.noaa.gov' in u and 'GetMap' in u: return 200, LIGHTNING_PNG, 'image/png'
    if 'api.adsb.lol/v2/lat/' in u: return 200, json.dumps(ADSB), 'application/json'
    if 'raw.githubusercontent.com' in u and '/live-data/' in u:
        name = u.split('/live-data/')[1].split('?')[0]
        if name == 'lightning.png': return 200, LIGHTNING_PNG, 'image/png'
        if name in ('nhc.json', 'perimeters.json', 'airspace.json', 'gnss.json', 'lightning.json'): return 200, snapshots()[name], 'application/json'
    return None
