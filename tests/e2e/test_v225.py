# SPDX-License-Identifier: AGPL-3.0-only
# v2.25 live watch layers (watchlayers.js, watchfeeds.js): lightning, hurricane forecasts, wildfire outlines, restricted
# airspace and GPS interference. Every service answers with recorded-format sample data made relative to now
# (watchmock.py), so nothing here depends on a live feed or on the date. A second page has every service down and
# must fall back to the live-data copies.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
DIRECT=['nowcoast.noaa.gov','www.nhc.noaa.gov','mapservices.weather.noaa.gov','services3.arcgis.com','services6.arcgis.com']
LAYERS='borders,cyclones,lightning,perimeters,airspace,gnss'
STATE="""() => { const d = gia.state.data; const c = gia.state.chan; return {
  storms: d.cyclones?.storms?.map((s) => [s.name, s.points.length, s.cone?.type ?? null, s.track?.type ?? null]), stormNote: d.cyclones?.statusNote,
  cone: (c.cyclones?.polygons ?? []).length, track: (c.cyclones?.paths ?? []).length, stormPts: (c.cyclones?.points ?? []).length,
  light: !!d.lightning?.tex, lightSrc: d.lightning?.src, lightNote: d.lightning?.statusNote,
  fires: d.perimeters?.fires?.map((f) => f.name), firePolys: (c.perimeters?.polygons ?? []).length,
  zones: d.airspace?.zones?.map((z) => [z.name, z.type, z.top]), cells: d.gnss?.cells?.map((x) => [x.south, x.west, x.level]), gnssNote: d.gnss?.statusNote } }"""
with sync_playwright() as p:
    br=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=br.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('**/live-data/lightning.json', lambda r: r.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'}))  # the copy missing: nowCOAST itself
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.35')}catch(e){}")
    pg.goto(f'http://localhost:8765/app/#@30,-90,2.2&l={LAYERS}', wait_until='commit')
    pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function("() => ['cyclones','lightning','perimeters','airspace','gnss'].every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.35', pg.evaluate("() => gia.VERSION")=='2.35')
    reg=pg.evaluate("""async () => { const { validateLayer } = await import('./js/registry.js'); const w = await import('./js/watchlayers.js');
      const ls = [w.lightningLayer(), w.cyclonesLayer({}), w.perimetersLayer({}), w.airspaceLayer({}), w.gnssLayer({})];
      const v = (l) => validateLayer(l, { groups: [{ id: 'live' }] }); return ls.map((l) => [l.id, l.group, v(l).length === 0 ? 'ok' : v(l)]); }""")
    check('five live layers, each a valid registry layer in Live Earth', [r[2] for r in reg]==['ok']*5 and all(r[1]=='live' for r in reg), reg)
    s=pg.evaluate(STATE)
    check('hurricane forecasts: the storm with its 8 forecast points, track and cone; the storm still waiting for its map', s['storms']==[['Rafael',8,'Polygon','LineString'],['Sergio',0,None,None]] and s['cone']==1 and s['track']==1, s)
    check('lightning: with the live-data copy missing, the world image straight from nowCOAST', s['light'] and s['lightSrc']=='live', s)
    check('wildfire outlines: wildfires drawn, biggest first; prescribed burns hidden by default', s['fires']==['Ridge','Cedar Creek'] and s['firePolys']==2, s)
    cw=pg.evaluate("""() => { const sh = (r) => r.slice(0, -1).reduce((t, p, i) => t + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0);
      const outer = (g) => g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
      return gia.globe.polygonsData().flatMap((d) => outer(d.geometry).map(sh)).map((a) => a < 0); }""")
    check('the globe gets every outline clockwise, so it fills the fire and not the rest of the planet', cw and all(cw), cw)
    check('restricted airspace: P-56A and two ranges, with their ceilings in words', s['zones']==[['P-56A','P','18,000 ft above sea level'],['R-2508','R','unlimited'],['R-4808N','R','unlimited']], s['zones'])
    check('GPS interference: the Gdańsk cell is high, Berlin low (from the live-data copy)', ['54','19','high'] in [[str(a),str(b),c] for a,b,c in s['cells']] and ['52','13','low'] in [[str(a),str(b),c] for a,b,c in s['cells']], s['cells'])
    # the pages
    pg.evaluate("() => gia.select({ layer: 'cyclones', d: gia.state.data.cyclones.storms[0] })"); pg.wait_for_timeout(1500)
    t=pg.evaluate("() => document.getElementById('notes-body')?.innerText ?? ''")
    check('a storm’s page: wind in knots and km/h, its category, motion and the forecast hour by hour', 'Hurricane Rafael' in t and '85 kt (157 km/h)' in t and 'north-northwest at 10 kt' in t and '+120 h' in t and 'Category 3' in t, t[:600])
    pg.evaluate("() => gia.select({ layer: 'perimeters', d: gia.state.data.perimeters.fires[0] })"); pg.wait_for_timeout(1500)
    t=pg.evaluate("() => document.getElementById('notes-body')?.innerText ?? ''")
    check('a fire’s page: acres and km², containment, how long it has burned, crews and cost', '48,210 acres (195 km²)' in t and '35 % of its edge' in t and '6 days ago' in t and '1,840' in t and 'US$41,500,000' in t, t[:600])
    pg.evaluate("() => gia.select({ layer: 'airspace', d: gia.state.data.airspace.zones[0] })"); pg.wait_for_timeout(1500)
    t=pg.evaluate("() => document.getElementById('notes-body')?.innerText ?? ''")
    check('an airspace page says what prohibited means and when it is in use', 'closed to all aircraft' in t and 'CONTINUOUS' in t and 'the ground' in t, t[:500])
    pg.evaluate("() => gia.select({ layer: 'gnss', d: gia.state.data.gnss.cells.find((c) => c.level === 'high') })"); pg.wait_for_timeout(1500)
    t=pg.evaluate("() => document.getElementById('notes-body')?.innerText ?? ''")
    check('a GPS cell’s page gives the counts and the caveat that a faulty transponder looks the same', '30' in t and '20' in t and 'faulty or old transponder' in t, t[:500])
    hostile=pg.evaluate("""async () => { const w = await import('./js/watchlayers.js'); const f = await import('./js/watchfeeds.js');
      const fires = f.slimFires({ features: [{ geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] }, properties: { poly_IncidentName: '<img src=x id=pwn>', attr_FireCause: '<b id=pwn2>x</b>' } }] });
      const storms = f.assembleStorms({ activeStorms: [{ id: 'al012026', name: '<img src=x id=pwn3>', latitudeNumeric: 20, longitudeNumeric: -60, forecastAdvisory: { advNum: '1' } }] }, []);
      const tips = w.perimetersLayer({}).channels({ fires }).polygons[0].tip + w.cyclonesLayer({}).channels({ storms }).points[0].tip;
      gia.select({ layer: 'perimeters', d: fires[0] }); await new Promise((r) => setTimeout(r, 800)); const a = !!document.querySelector('#pwn, #pwn2');
      gia.select({ layer: 'cyclones', d: storms[0] }); await new Promise((r) => setTimeout(r, 800)); const b = !!document.querySelector('#pwn3');
      return a || b || tips.includes('<img'); }""")
    check('names from the feeds are escaped', not hostile)
    opts=pg.evaluate("""async () => { const w = await import('./js/watchlayers.js'); const l = w.perimetersLayer({}); const a = await l.load({ which: 'all' }); const z = await w.airspaceLayer({}).load({ which: 'P' }); return [a.fires.length, z.zones.length]; }""")
    check('options: prescribed burns can be shown, and prohibited areas alone', opts==[3,1], opts)
    pg.screenshot(path='v225-watch.png')
    check('no page errors', not errs, errs[:3])
    # every service down: the live-data copies
    pg2=br.new_page(viewport={'width':1280,'height':800}); errs2=[]
    pg2.on('pageerror', lambda e: errs2.append(str(e)))
    pg2.route('**/*', handler)
    for h in DIRECT: pg2.route(f'**://{h}/**', lambda r: r.abort())
    pg2.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.35')}catch(e){}")
    pg2.goto(f'http://localhost:8765/app/#@30,-90,2.2&l={LAYERS}', wait_until='commit')
    pg2.wait_for_function("() => window.gia", timeout=60000)
    pg2.wait_for_function("() => ['cyclones','lightning','perimeters','airspace','gnss'].every((k) => gia.state.data[k])", timeout=90000); pg2.wait_for_timeout(1000)
    s2=pg2.evaluate(STATE)
    check('with every service down, all five layers come from the live-data copies (lightning comes from there first anyway)', s2['storms']==s['storms'] and s2['light'] and s2['lightSrc']=='snapshot' and 'live-data copy' in (s2['lightNote'] or '') and s2['fires']==s['fires'] and s2['zones']==s['zones'] and s2['cells']==s['cells'], s2)
    check('the lightning copy says which 15 minutes it shows', 'strikes in the 15 minutes to' in (s2['lightNote'] or ''), s2['lightNote'])
    check('no page errors on the fallback page', not errs2, errs2[:3])
    br.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
