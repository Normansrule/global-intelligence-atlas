# SPDX-License-Identifier: AGPL-3.0-only
# Ship wakes and flowing storm tracks: every ship under way with a known course trails a Kelvin wake (all of them
# in one draw call, none for moored ships or ships reporting no course), and a moving natural event draws its
# track with dashes that flow toward its latest position, which pulses.
import sys, json; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
STORM={"events":[{"id":"S1","title":"Typhoon Test","categories":[{"id":"severeStorms","title":"Severe Storms"}],"sources":[],
  "geometry":[{"type":"Point","date":f"2026-10-2{i}T00:00:00Z","coordinates":[140-i*2.5,12+i*1.5]} for i in range(5)]},
  {"id":"E1","title":"Wildfire - Butte County, California","categories":[{"id":"wildfires","title":"Wildfires"}],"geometry":[{"type":"Point","date":"2026-09-26T10:00:00Z","coordinates":[-121.6,39.7]}],"sources":[]}]}
def eonet(route): return route.fulfill(status=200, body=json.dumps(STORM), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://eonet.gsfc.nasa.gov/**', eonet)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@1.3,103.8,0.4&b=bluemarble&l=ships,borders,events', wait_until='commit'); pg.wait_for_timeout(13000)
    w=pg.evaluate("""async () => { const { shipWakes } = await import('./js/wakes.js'); const ss = gia.state.data.ships ?? [];
      const moving = ss.filter((s) => s.sog >= 0.5 && s.sog < 102.3 && s.cog >= 0 && s.cog < 360).length;
      let objs = 0; gia.globe.scene().traverse((o) => { if (!o.userData?.keeper && o.visible && o.geometry?.instanceCount > 0 && o.material?.vertexShader?.includes('uTan')) objs++; });
      return { n: shipWakes().count(), moving, total: ss.length, objs }; }""")
    check('every ship under way with a known course has a wake, moored ones none', w['n'] > 0 and w['n'] == w['moving'] and w['moving'] < w['total'], w)
    check('all wakes are a single object (one draw call)', w['objs'] == 1, w)
    pg.evaluate("() => gia.globe.pointOfView({ lat: 1.25, lng: 103.8, altitude: 0.004 }, 0)"); pg.wait_for_timeout(2500)
    check('wakes still draw at street level', pg.evaluate("async () => (await import('./js/wakes.js')).shipWakes().count()") > 0)
    t=pg.evaluate("""() => { const ch = gia.state.chan.events; const p = ch.paths.find((x) => x.ref.d.id === 'S1');
      return { animMs: p?.animMs ?? 0, dash: p?.dash ?? null, ring: ch.rings.some((r) => Math.abs(r.lat - 18) < 0.01 && Math.abs(r.lng - 130) < 0.01), fireRing: ch.rings.length } }""")
    check('the storm track flows (animated dashes)', t['animMs'] >= 4000 and t['dash'], t)
    check('the storm’s latest position pulses, a one-point fire does not', t['ring'] and t['fireRing'] == 1, t)
    pg.evaluate("() => gia.globe.pointOfView({ lat: 15, lng: 133, altitude: 0.9 }, 0)"); pg.wait_for_timeout(3000)
    pg.screenshot(path='/tmp/claude-0/w/storm.png')
    pg.evaluate("() => gia.globe.pointOfView({ lat: 1.2, lng: 103.9, altitude: 0.25 }, 0)"); pg.wait_for_timeout(3000)
    pg.screenshot(path='/tmp/claude-0/w/wakes.png')
    check('no page errors', not errs, errs)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
