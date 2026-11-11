import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.17: the Earth sooner (relief and water maps after the first view, the 4K pair later still), the Sun-lit Earth under
# the close-up imagery while its tiles load or cannot load, and undersea cables that fade back at the whole-globe view.
res = []
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, info)
INIT = "try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}"
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS); errs = []; asked = []
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.on('request', lambda r: asked.append((r.url.split('/app/')[-1], pg.evaluate('0') if False else None)))
    t0 = []
    def route(r):
        u = r.request.url
        if '/textures/' in u: asked.append(u.split('/textures/')[-1])
        return handler(r)
    pg.route('**/*', route); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&l=borders,cables', wait_until='commit')
    pg.wait_for_function("() => window.gia && document.getElementById('loading')?.classList.contains('gone')", timeout=30000)
    first = [a for a in asked if isinstance(a, str)]
    check('version 2.22', pg.evaluate("() => gia.VERSION")=='2.22')
    check('the first view asks only for the quick 2K Earth', 'earth-blue-marble-2k.jpg' in first and 'earth-night-2k.jpg' in first and not any(x in first for x in ['earth-topology.png', 'earth-water.png', 'earth-blue-marble.jpg', 'earth-night.jpg']), first)
    flat = pg.evaluate("() => { const u = gia.globe.globeMaterial().uniforms; return [u.topo.value.image.width, u.water.value.image.width]; }")
    pg.wait_for_function("() => gia.globe.globeMaterial().uniforms.topo.value.image.width > 1 && gia.globe.globeMaterial().uniforms.water.value.image.width > 1", timeout=20000)
    later = pg.evaluate("() => { const u = gia.globe.globeMaterial().uniforms; return [u.topo.value.image.width, u.water.value.image.width, u.texel.value.x]; }")
    check('relief and water maps arrive after the first view', flat == [1, 1] and later[0] == 2048 and later[1] == 1600 and abs(later[2] - 1 / 2048) < 1e-9, [flat, later])
    tex = [a for a in asked if isinstance(a, str)]
    check('the 4K Earth waits until the live layers have had time to arrive', 'earth-blue-marble.jpg' not in tex, tex)
    pg.wait_for_function("() => gia.globe.globeMaterial().uniforms.dayTexture.value.image?.width === 4096 || gia.globe.globeMaterial().uniforms.dayTexture.value.image?.width > 2048", timeout=20000)
    check('… and then it swaps in', True)
    # cables fade at the whole-globe view
    fade = lambda: pg.evaluate("() => { let o = null; gia.globe.scene().traverse((x) => { if (!o && x.userData?.farOpacity != null && x.userData.farOpacity < 0.9) o = x; }); if (!o) return null; return o.material.uniforms.opacity.value; }")
    pg.wait_for_function("() => gia.state.data.cables", timeout=20000); pg.wait_for_timeout(800)
    pg.evaluate("() => void gia.globe.renderer().render(gia.globe.scene(), gia.globe.camera())"); far = fade()
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 20, lng: 0, altitude: 0.5 }, 0)"); pg.wait_for_timeout(900)
    pg.evaluate("() => void gia.globe.renderer().render(gia.globe.scene(), gia.globe.camera())"); near = fade()
    check('undersea cables fade back at the whole-globe view and return close up', far is not None and near is not None and far < 0.6 and near >= 0.89, [far, near])
    # close-up imagery that cannot load: the Sun-lit Earth shows underneath, not black
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 48.86, lng: 2.35, altitude: 0.5 }, 0)"); pg.wait_for_timeout(1500)
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 48.86, lng: 2.35, altitude: 0.2 }, 0)"); pg.wait_for_timeout(2500)
    u = pg.evaluate("() => { let m = null; gia.globe.scene().traverse((x) => { if (x.name === 'under-tiles') m = x; }); return { tiles: gia.state.detailTiles, under: m ? m.visible : null, shaded: m ? m.material === gia.globe.globeMaterial() || !!m.material.uniforms?.dayTexture : null }; }")
    check('close-up imagery: the Sun-lit Earth lies under the tiles', u['tiles'] == 'imagery' and u['under'] is True and u['shaded'], u)
    px = pg.evaluate("""() => { const c = gia.globe.renderer().domElement; gia.globe.renderer().render(gia.globe.scene(), gia.globe.camera());
      const g = c.getContext('webgl2') || c.getContext('webgl'); const w = c.width; const h = c.height; const a = new Uint8Array(4);
      let lit = 0; for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.6], [0.6, 0.4], [0.7, 0.7], [0.3, 0.3]]) { g.readPixels(Math.round(w * fx), Math.round(h * fy), 1, 1, g.RGBA, g.UNSIGNED_BYTE, a); if (a[0] + a[1] + a[2] > 12) lit++; } return lit; }""")
    check('… so the view is not black while the tiles are missing', px >= 3, px)
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 20, lng: 0, altitude: 2.4 }, 0)"); pg.wait_for_timeout(2500)
    u2 = pg.evaluate("() => { let m = null; gia.globe.scene().traverse((x) => { if (x.name === 'under-tiles') m = x; }); return { tiles: gia.state.detailTiles, under: m ? m.visible : null }; }")
    check('… and it steps aside when the tiles switch off', u2['tiles'] is None and u2['under'] is False, u2)
    # planes up close: white like real aircraft, shrinking to true size, with blinking navigation lights
    pg3 = b.new_page(viewport={'width': 1280, 'height': 800}); pg3.on('pageerror', lambda e: errs.append(str(e)[:300])); pg3.route('**/*', handler); pg3.add_init_script(INIT)
    pg3.goto('http://localhost:8765/app/#@40,-100,1.2&l=borders,aircraft&s=1', wait_until='commit')
    pg3.wait_for_function("() => window.gia && gia.state.data.aircraft?.ac?.length", timeout=40000); pg3.wait_for_timeout(1000)
    def look(alt):
        pg3.evaluate(f"() => {{ const x = gia.state.data.aircraft.ac.find((q) => !q.ground && q.altFt > 1500); gia.globe.pointOfView({{ lat: x.lat, lng: x.lng, altitude: {alt} }}, 0); }}"); pg3.wait_for_timeout(2500)
        return pg3.evaluate("() => { let col = null; let k = 0; gia.globe.scene().traverse((o) => { if (o.isInstancedMesh && o.count > 0 && o.userData?.vel && col == null) { col = [...o.instanceColor.array.slice(0, 3)].map((v) => +v.toFixed(2)); const e = o.instanceMatrix.array; k = Math.hypot(e[0], e[1], e[2]); } }); return { lights: gia.lightCount(), col, km: k * 63.71 }; }")
    farv = look(0.05); midv = look(0.004); nearv = look(0.0008)
    check('far away, planes keep their map colours and no lights', farv['lights'] == 0 and farv['col'] != [0.93, 0.95, 0.97], farv)
    check('up close, planes are painted white and carry navigation lights', midv['lights'] > 0 and midv['col'] == [0.93, 0.95, 0.97], midv)
    check('at street level a plane is drawn near its true size', nearv['km'] < 0.08 and nearv['km'] < midv['km'], [midv['km'], nearv['km']])
    # What's new opens for someone coming from v2.16 and leads with v2.17
    pg2 = b.new_page(viewport={'width': 1440, 'height': 900}); pg2.on('pageerror', lambda e: errs.append(str(e)[:300])); pg2.route('**/*', handler)
    pg2.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.16')}catch(e){}")
    pg2.goto('http://localhost:8765/app/', wait_until='commit')
    try: pg2.wait_for_function("() => document.body && document.body.innerText.toLowerCase().includes('the earth sooner')", timeout=30000)
    except Exception: pass
    wn = pg2.evaluate("() => document.body.innerText")
    lo = wn.lower(); check("What's new keeps v2.17 above v2.16", 0 <= lo.find('the earth sooner') < lo.find('from v2.16'), lo.find('the earth sooner'))
    check('no page errors', not errs, errs[:3])
    b.close()
n = sum(ok for _, ok in res); print(f'SUMMARY {n} / {len(res)}'); sys.exit(0 if n == len(res) else 1)
