# SPDX-License-Identifier: AGPL-3.0-only
# Live motion: every plane in the air leaves a fading trail (all of them in one draw call, switchable off);
# a big event that appears while the page is open leads the Live strip marked "Just in" and sends a shockwave
# across the globe, while events already there at load (or from a layer switched on later) do not; and from far
# away the name cards on the globe carry only the name.
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
ADD="""async ([id, mag, lng, lat]) => { const { getFeed } = await import('./js/feeds.js');
  const j = await getFeed('usgs', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { ttl: 4 * 60_000 });
  j.features.unshift({ id, properties: { mag, place: 'off the coast of Chile', time: Date.now() - 60000 }, geometry: { coordinates: [lng, lat, 10] } });
  const before = gia.state.tool.rings.length; await gia.live.collect();
  const b = document.querySelector('#ticker-track button');
  return { fresh: gia.live.fresh(), flashes: gia.state.tool.rings.filter((r) => r.flash).length, before, first: b?.dataset.live, mark: b?.querySelector('em')?.textContent ?? '', cls: b?.className ?? '' }; }"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@48,5,0.6&b=bluemarble&l=aircraft,borders', wait_until='commit'); pg.wait_for_timeout(12000)
    t=pg.evaluate("""async () => { const f = await import('./js/flights.js'); const ac = f.flightsNow(); const air = ac.filter((a) => !a.ground && a.kt >= 50).length;
      let trails = 0; gia.globe.scene().traverse((o) => { if (!o.userData?.keeper && o.visible && o.geometry?.instanceCount > 0 && o.material?.vertexShader?.includes('iLen')) trails++; });
      let kept = 0; gia.globe.scene().traverse((o) => { if (o.userData?.keeper && o.geometry?.isInstancedBufferGeometry && o.geometry.instanceCount > 1) kept++; });
      return { n: f.trailCount(), air, total: ac.length, objects: trails, kept }; }""")
    check('every plane in the air has a trail, and none on the ground', t['n'] > 0 and t['n'] == t['air'] and t['air'] < t['total'] + 1, t)
    check('all trails are a single object (one draw call)', t['objects'] == 1, t)
    check('the shader keeper holds one speck, not a second copy of every trail', t['kept'] == 0, t)
    pg.evaluate("() => gia.globe.pointOfView({ lat: 51.4, lng: -0.4, altitude: 0.08 }, 0)"); pg.wait_for_timeout(3000)
    t2=pg.evaluate("async () => (await import('./js/flights.js')).trailCount()")
    check('trails still draw close up, for the planes near the view', 0 < t2 <= t['n'], t2)
    pg.evaluate("() => { gia.state.opts.aircraft.trails = 'off'; delete gia.state.data.aircraft; gia.refreshLayer('aircraft'); }"); pg.wait_for_timeout(4000)
    check('Trails: No trails switches them all off', pg.evaluate("async () => (await import('./js/flights.js')).trailCount()") == 0)
    # Just in (a fresh page)
    pg.close(); pg=b.new_page(viewport={'width':1280,'height':800}); pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@-33,-72,1.4&b=bluemarble&l=borders,quakes,landmarks', wait_until='commit'); pg.wait_for_timeout(10000)
    first=pg.evaluate("() => ({ fresh: gia.live.fresh(), marks: document.querySelectorAll('#ticker-track button.new').length })")
    check('nothing is "Just in" when the page opens', first['fresh'] == [] and first['marks'] == 0, first)
    j=pg.evaluate(ADD, ['justin-a', 6.1, -72, -33])
    check('a new M6.1 earthquake leads the Live strip marked Just in', j['first'] == 'justin-a' and j['mark'] == 'Just in' and 'new' in j['cls'] and j['fresh'] == ['justin-a'], j)
    check('and sends one shockwave across the globe from where it happened', j['flashes'] == 1, j)
    small=pg.evaluate(ADD, ['justin-b', 4.0, 10, 10])
    check('a small one (under M4.5) is not marked', 'justin-b' not in small['fresh'], small)
    pg.wait_for_timeout(9500)
    check('the shockwave stops after a few seconds', pg.evaluate("() => gia.state.tool.rings.filter((r) => r.flash).length") == 0)
    # a layer switched on later does not mark what it already had (the emergency squawk in the mocked flights)
    pg.evaluate("() => gia.toggleLayer('aircraft', true)"); pg.wait_for_timeout(5000)
    late=pg.evaluate("async () => { await gia.live.collect(); return gia.live.fresh(); }")
    check('a layer switched on later does not mark its old items as new', not any(x.startswith('sq-') for x in late), late)
    # far away: name cards are only the name
    pg.evaluate("() => gia.globe.pointOfView({ lat: 20, lng: 10, altitude: 2.3 }, 0)"); pg.wait_for_timeout(3500)
    far=pg.evaluate("() => gia.markers.pins.filter((p) => p.detailed && !p.selected).map((p) => p.sub)")
    check('from far away the cards on the globe carry only the name', len(far) > 0 and all(not s for s in far), far)
    pg.evaluate("() => gia.globe.pointOfView({ lat: 41.9, lng: 12.45, altitude: 0.3 }, 0)"); pg.wait_for_timeout(3500)
    near=pg.evaluate("() => gia.markers.pins.filter((p) => p.detailed).map((p) => p.sub)")
    check('closer in they show the kind and place again', any(near), near)
    check('no page errors', not errs, errs)
    pg.screenshot(path='/tmp/claude-0/w/live-motion.png')
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
