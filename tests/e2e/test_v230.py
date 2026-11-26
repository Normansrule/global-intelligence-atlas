# SPDX-License-Identifier: AGPL-3.0-only
# v2.30 the Sun, the planets and their moons in depth (spacedetail.js): each body's page gains standing there, in our
# sky, getting there, its air, size to scale and the spacecraft that went there. tests/space/test-space.mjs pins the
# numbers to fixed dates; here the page is checked in the app.
import sys, os, json
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
TEXT="() => { document.querySelectorAll('#notes-body details.qd-sec').forEach((d) => d.open = true); return document.querySelector('#notes-body')?.innerText ?? ''; }"
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
check('the offline pack has the new code', 'app/js/spacedetail.js' in pack)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@51.5,-0.1,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    pg.evaluate("() => gia.cosmos.explore('mars', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('Mars: six new sections', all(s in t for s in ['Standing there','In our sky','Getting there','Its air','Size to scale','Spacecraft that went there']), t[:1500])
    check('Mars: weight, jump and the Sun', 'Someone of 70 kg weighs like' in t and '26.5 kg' in t and 'with 43.1 % of the light' in t, t[:1500])
    check('Mars: the sky from where the globe was looking, near London', 'Seen from' in t and 'Opposition' in t and ('Next rises' in t or 'Next sets' in t), t)
    check('Mars: a 259-day trip, 3.61 km/s, and a next launch window', '259 days' in t and '3.61 km/s' in t and 'Next launch window' in t, t)
    check('Mars: carbon dioxide air drawn as bars', 'Carbon dioxide' in t and pg.evaluate("() => document.querySelectorAll('#notes-body .gx-bars li').length") >= 3, t[-1500:])
    check('Mars: drawn to scale next to the Earth', pg.evaluate("() => document.querySelectorAll('#notes-body .sd-scale circle').length") == 2)
    check('Mars: spacecraft, Perseverance among them', 'Perseverance and Ingenuity' in t and 'Highlights, not every mission' in t, t[-1200:])
    pg.evaluate("() => gia.cosmos.explore('titan', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('Titan: thick nitrogen air at 1.5 times Earth’s pressure', 'Nitrogen' in t and '1.48 × Earth’s' in t and '674' in t, t[:2500])
    check('Titan: Saturn’s sky times, said so', 'Saturn’s times' in t, t[:2500])
    check('Titan: getting there is to Saturn’s distance, with Huygens and Dragonfly', 'to Saturn’s distance' in t and 'Huygens' in t and 'Dragonfly' in t, t[-1500:])
    pg.evaluate("() => gia.cosmos.explore('bennu', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('Bennu: a jump would leave it, OSIRIS-REx brought 121 g home', 'leave it for good' in t and '121 g' in t, t[:2500])
    check('Bennu: drawn next to the Earth and the Moon', pg.evaluate("() => document.querySelectorAll('#notes-body .sd-scale circle').length") == 3)
    pg.evaluate("() => gia.cosmos.explore('sun', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('the Sun: what it is made of, by mass, and Parker Solar Probe', 'What it is made of' in t and 'By mass' in t and 'Parker Solar Probe' in t and 'Getting there' not in t, t[:2500])
    pg.evaluate("() => gia.cosmos.explore('moon', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('the Moon: 11.6 kg, the next full Moon, Apollo 11', '11.6 kg' in t and 'Full Moon' in t and 'Apollo 11' in t, t[:2500])
    n=pg.evaluate("() => document.querySelectorAll('#notes-body details.qd-sec').length")
    check('sections open and close (details)', n >= 5, n)
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('data-space=\"mars\"') && s.includes('data-space=\"titan\"'); }")
    check("What's new has Try buttons for Mars and Titan", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
