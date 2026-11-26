# SPDX-License-Identifier: AGPL-3.0-only
# v2.34 asteroids (asteroids.js), in the app: their labels and orbits in the solar system view, the table on the
# solar system card and each asteroid's page. tests/asteroids/test-asteroids.mjs pins the numbers to a fixed date.
import sys, os, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
TEXT="() => { document.querySelectorAll('#notes-body details.qd-sec').forEach((d) => d.open = true); return document.querySelector('#notes-body')?.innerText ?? ''; }"
SHOTS=os.environ.get('SHOT_DIR', '/tmp')
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
sw=open(os.path.join(ROOT, 'site/sw.js')).read()
check('the offline pack and the service worker have the new code', 'app/js/asteroids.js' in pack and "'app/js/asteroids.js'" in sw)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@51.5,-0.1,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(3500)
    t=pg.evaluate(TEXT)
    rows=pg.evaluate("() => [...document.querySelectorAll('#notes-body [data-space-asteroid]')].map((e) => e.dataset.spaceAsteroid)")
    check('the solar system card: a table of the six asteroids', 'Asteroids that pass the Earth' in t and rows==['apophis','didymos','eros','psyche','ryugu','itokawa'], rows)
    check('Apophis passes on 13 April 2029', '13 April 2029' in t, t[-2500:])
    d=pg.evaluate("""() => { const { AS, scene } = gia.cosmos.debug(); let orbits = 0; scene.traverse((o) => { if (o.userData?.asteroids && o.visible) orbits = o.geometry.attributes.position.count; });
      return { orbits, r: Object.fromEntries(Object.entries(AS).map(([k, v]) => [k, +v.r.toFixed(2)])) }; }""")
    check('their orbits are drawn (six closed rings)', d['orbits'] == 6 * 240 * 2, d)
    check('each placed at its distance from the Sun (Apophis inside the Earth’s orbit, Psyche in the belt)', d['r']['apophis'] < 1.1 and 2.5 < d['r']['psyche'] < 3.4, d['r'])
    lab=pg.evaluate("() => [...document.querySelectorAll('.space-label.asteroid')].map((e) => e.dataset.spaceAsteroid)")
    check('a label for each asteroid', sorted(lab)==sorted(rows), lab)
    pg.evaluate("() => document.querySelector('#notes-body [data-space-asteroid=\"apophis\"]').click()"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('Apophis’s page: where it is, how far from the Earth, and its 2029 pass', 'Apophis' in t and 'From the Earth' in t and '32,000 km' in t and 'geostationary' in t, t[:900])
    check('… its orbit drawn among the planets, its size and OSIRIS-APEX', pg.evaluate("() => !!document.querySelector('#notes-body .ce-orbit .ce-now')") and '340 m' in t and 'OSIRIS-APEX' in t, t[-800:])
    pg.screenshot(path=os.path.join(SHOTS, 'v234-apophis.png'))
    pg.evaluate("() => gia.cosmos.explore('earth', { instant: true })"); pg.wait_for_timeout(2500)
    pg.evaluate("() => gia.cosmos.asteroid('didymos')"); pg.wait_for_timeout(6000)
    t=pg.evaluate(TEXT)
    check('from the globe, an asteroid flies out to the solar system and opens its page (Didymos: DART and Hera)', pg.evaluate("() => gia.cosmos.focus()") == 'system' and 'Didymos and Dimorphos' in t and 'DART' in t and 'Hera' in t, [pg.evaluate("() => gia.cosmos.focus()"), t[:300]])
    pg.screenshot(path=os.path.join(SHOTS, 'v234-didymos.png'))
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('steroids that pass the Earth') && s.includes('data-space-asteroid=\"apophis\"'); }")
    check("What's new has a Try button for Apophis", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
