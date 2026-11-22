# SPDX-License-Identifier: AGPL-3.0-only
# v2.31 tonight's sky, the next 60 days and the far spacecraft (skydetail.js), in the app. tests/sky/test-sky.mjs pins
# the numbers to fixed dates; here the sections are checked on today's sky.
import sys, os, json
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.35');localStorage.setItem('gia-theme','dark')}catch(e){}"
TEXT="() => { document.querySelectorAll('#notes-body details.qd-sec').forEach((d) => d.open = true); return document.querySelector('#notes-body')?.innerText ?? ''; }"
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
check('the offline pack has the new code', 'app/js/skydetail.js' in pack)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@-33.9,151.2,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.35', pg.evaluate("() => gia.VERSION")=='2.35')
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(3000)
    t=pg.evaluate(TEXT)
    check('the solar system card: Tonight from the place the globe was looking at (Sydney)', 'Tonight from' in t and 'Australia' in t, t[:600])
    check('tonight: darkness hours, or why there are none', 'Full darkness' in t or 'No full darkness' in t, t[:800])
    n=pg.evaluate("() => document.querySelectorAll('#notes-body .sk-list li').length")
    check('tonight: the Moon and seven planets listed', n == 8, n)
    check('tonight: magnitude explained', 'smaller is brighter' in t)
    ev=pg.evaluate("() => document.querySelectorAll('#notes-body .sk-ahead li').length")
    check('the next 60 days: at least the Moon’s phases (8 or more events)', ev >= 8, ev)
    check('the next 60 days: phases drawn', pg.evaluate("() => document.querySelectorAll('#notes-body .sk-ahead .sk-phase').length") >= 4)
    pg.evaluate("() => document.querySelector('#notes-body .sk-list [data-space=\"jupiter\"]').click()"); pg.wait_for_timeout(3000)
    t=pg.evaluate(TEXT)
    check('a planet in tonight’s list opens its page', 'Jupiter' in t and 'Standing there' in t, t[:300])
    pg.evaluate("() => gia.cosmos.explore('moon', { instant: true })"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('the Moon: the month ahead with five phases', 'The month ahead' in t and pg.evaluate("() => document.querySelectorAll('#notes-body .sk-month .sk-phase').length") == 5, t[:2000])
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(2500)
    pg.evaluate("() => document.querySelector('#notes-body [data-space-probe=\"voyager1\"]').click()"); pg.wait_for_timeout(1500)
    t=pg.evaluate(TEXT)
    check('Voyager 1: distance from Earth now and the round trip for a command', 'From Earth now' in t and 'hours there and back' in t, t[:900])
    check('Voyager 1: one light-day from the Sun', 'One light-day from the Sun' in t, t[:1200])
    check('Voyager 1: Gliese 445 and the golden record', 'Gliese 445' in t and 'gold-plated record' in t, t)
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(2000)
    pg.evaluate("() => document.querySelector('#notes-body [data-space-probe=\"newhorizons\"]').click()"); pg.wait_for_timeout(1500)
    t=pg.evaluate(TEXT)
    check('New Horizons: Clyde Tombaugh', 'Clyde Tombaugh' in t, t)
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('onight’s sky and the far spacecraft') && s.includes('data-space=\"system\"'); }")
    check("What's new has a button for the solar system", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
