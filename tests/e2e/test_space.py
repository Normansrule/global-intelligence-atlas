# SPDX-License-Identifier: AGPL-3.0-only
# Space: the Sun, the Moon, the planets and Jupiter's big moons drawn behind the globe where they really are, each one
# explorable (fly there, turn it, read its card, fly on, fly back to the globe), and the cinematic Earth shaders.
import sys, json, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
TILE=open(os.path.join(sys.argv[-1], 'tile.jpg'), 'rb').read()
trek_hits=[]
def trek(route):
    trek_hits.append(route.request.url)
    return route.fulfill(status=200, body=TILE, headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'})
BODIES=['sun','mercury','venus','moon','mars','jupiter','io','europa','ganymede','callisto','saturn','uranus','neptune','pluto']
ON_SCREEN="""(id) => { const { cam, B, F } = gia.cosmos.debug(); const b = B[id]; const w = b.pos.clone().applyMatrix4(F); const n = w.clone().project(cam);
  return { visible: b.mesh.visible, px: b.px, x: n.x, y: n.y, z: n.z, ready: !!b.mesh.material.uniforms.map.value.image?.width && b.mesh.material.uniforms.map.value.image.width > 1 }; }"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    shader=[]; pg.on('console', lambda m: ('Shader Error' in m.text or 'shader' in m.text.lower() and m.type == 'error') and shader.append(m.text[:300]))
    pg.route('**/*', handler); pg.route('https://trek.nasa.gov/**', trek)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12');localStorage.setItem('gia-theme','dark')}catch(e){}")
    pg.goto('http://localhost:8765/app/?debug#@20,10,2.4&b=daynight&l=sun,borders,planets', wait_until='commit'); pg.wait_for_timeout(14000)
    pg.wait_for_function('() => gia.cosmos.ready()', timeout=20000)
    m=pg.evaluate("() => gia.cosmos.info('moon')")
    check('the Moon is where Astronomy Engine puts it (356,000–407,000 km away)', m and 356000 < m['km'] < 407000, m)
    s=pg.evaluate("() => gia.cosmos.info('sun').km / 149597870.7")
    check('the Sun is about 1 astronomical unit away', 0.98 < s < 1.02, s)
    lib=pg.evaluate("""async () => { const A = await import('./vendor/astronomy.min.mjs'); const { B, st } = gia.cosmos.debug(); const t = st.t;
      const P = new (B.moon.pos.constructor)().setFromMatrixColumn(B.moon.basis, 0); const N = new (B.moon.pos.constructor)().setFromMatrixColumn(B.moon.basis, 1);
      const E = new (B.moon.pos.constructor)().setFromMatrixColumn(B.moon.basis, 2).negate(); const toE = B.moon.pos.clone().negate().normalize();
      const lon = Math.atan2(toE.dot(E), toE.dot(P)) * 180 / Math.PI; const lat = Math.asin(toE.dot(N)) * 180 / Math.PI; const l = A.Libration(t);
      return { lon, lat, elon: l.elon, elat: l.elat }; }""")
    check('the Moon turns the face it really shows us, libration included (within 0.2°)', abs(lib['lon']-lib['elon']) < 0.2 and abs(lib['lat']-lib['elat']) < 0.2, lib)
    calls=pg.evaluate("() => { const { scene } = gia.cosmos.debug(); let pts = 0; scene.traverse((o) => { if (o.isPoints) pts++; }); return pts; }")
    check('all far-away bodies are one set of dots (one draw call)', calls == 1, calls)
    check('no shader errors (Earth, air, bodies, rings, sky)', not shader, shader)
    # Explore: fly to the Moon
    pg.evaluate("() => document.querySelector('#space-open').click()"); pg.wait_for_timeout(9000)
    st=pg.evaluate("""() => ({ inSpace: document.body.classList.contains('in-space'), bar: !document.querySelector('.space-bar').hidden,
      card: document.querySelector('#notes-body h3')?.textContent ?? '', rows: document.querySelector('#notes-body .facts')?.textContent ?? '', hash: location.hash,
      mainCtl: gia.globe.controls().enabled })""")
    check('the space button flies to the Moon: space bar, Moon card with live distance', st['inSpace'] and st['bar'] and 'Moon' in st['card'] and 'From Earth now' in st['rows'], st)
    check('the globe’s own controls rest while exploring, and the link remembers the place', (not st['mainCtl']) and 'sp=moon' in st['hash'], st)
    o=pg.evaluate(ON_SCREEN, 'moon')
    check('the Moon fills the view, on screen, with its map loaded', o['visible'] and o['px'] > 120 and abs(o['x']) < 0.2 and abs(o['y']) < 0.2 and o['ready'], o)
    # Every body: fly there (instantly) and check it is drawn in the middle of the view
    bad=[]
    for id in BODIES:
        pg.evaluate("(id) => gia.cosmos.explore(id, { instant: true })", id); pg.wait_for_timeout(1800)
        o=pg.evaluate(ON_SCREEN, id)
        if not (o['visible'] and o['px'] > 60 and abs(o['x']) < 0.25 and abs(o['y']) < 0.25 and o['z'] < 1): bad.append((id, o))
    check('every body (Sun, 8 planets less Earth, Pluto, the Moon, 4 moons of Jupiter) is drawn centred when you fly to it', not bad, bad)
    pg.evaluate("() => gia.cosmos.explore('saturn', { instant: true })"); pg.wait_for_timeout(1500)
    r=pg.evaluate("() => { const { scene } = gia.cosmos.debug(); let ring = null; scene.traverse((o) => { if (o.material?.uniforms?.span) ring = o; }); return ring?.visible; }")
    check('Saturn has its rings', r)
    # Sharper NASA Treks mosaic when you fly in close to the Moon (tiles mocked here)
    pg.evaluate("() => gia.cosmos.explore('moon', { instant: true })"); pg.wait_for_timeout(1500)
    pg.evaluate("() => { const { cam, st, B } = gia.cosmos.debug(); const t = st.ctl.target; cam.position.sub(t).setLength(B.moon.r * 1.6).add(t); }"); pg.wait_for_timeout(9000)
    h=pg.evaluate("() => gia.cosmos.debug().st.hires.moon")
    check('flying in close loads NASA’s Moon Trek mosaic (128 tiles)', h == 'ok' and len(trek_hits) >= 128 and all('/3/' in u for u in trek_hits), (h, len(trek_hits)))
    # Back to Earth: the globe takes over again where the camera is
    pg.evaluate("() => gia.cosmos.explore('earth')"); pg.wait_for_timeout(9000)
    back=pg.evaluate("() => ({ inSpace: document.body.classList.contains('in-space'), ctl: gia.globe.controls().enabled, alt: gia.globe.pointOfView().altitude, focus: gia.cosmos.focus(), hash: location.hash })")
    check('Earth brings you back to the globe, controls and all', not back['inSpace'] and back['ctl'] and back['focus'] is None and 0.5 < back['alt'] < 6 and 'sp=' not in back['hash'], back)
    # Labels hide with the layer
    pg.evaluate("() => gia.toggleLayer('planets', false)"); pg.wait_for_timeout(1500)
    v=pg.evaluate("() => [...document.querySelectorAll('.space-label')].filter((e) => !e.hidden).length + (gia.cosmos.info('moon').visible ? 1 : 0)")
    check('switching the layer off hides the Moon and planets from the sky', v == 0, v)
    check('no page errors', not errs, errs)
    pg.close()
    # A link into space opens there; the day theme keeps the paper background but space is still black
    pg=b.new_page(viewport={'width':1280,'height':800}); errs2=[]; pg.on('pageerror', lambda e: errs2.append(str(e)))
    pg.route('**/*', handler); pg.route('https://trek.nasa.gov/**', trek)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12');localStorage.setItem('gia-theme','light')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@20,10,2.4&b=daynight&l=sun,planets&sp=jupiter', wait_until='commit'); pg.wait_for_timeout(16000)
    j=pg.evaluate("() => ({ focus: gia.cosmos.focus(), stars: gia.cosmos.stars.visible })")
    check('a link with &sp=jupiter opens at Jupiter; the day theme hides the night sky on the globe', j['focus'] == 'jupiter' and j['stars'] is False, j)
    o=pg.evaluate(ON_SCREEN, 'jupiter')
    check('…and Jupiter is drawn even on the day theme', o['visible'] and o['px'] > 60, o)
    check('no page errors (second page)', not errs2, errs2)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
