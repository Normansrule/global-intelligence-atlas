# SPDX-License-Identifier: AGPL-3.0-only
# v2.38 World clock (worldclock.js) in the Tools drawer: sixteen cities, day and night, and a meeting finder.
import sys, os, re
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
SHOTS=os.environ.get('SHOT_DIR', '/tmp')
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.removeItem('global-intelligence-atlas-clock')}catch(e){}"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}, timezone_id='Europe/London'); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@30,10,2.2&l=borders', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.globe", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    pg.click('.rail [data-section=tools]'); pg.wait_for_timeout(400)
    check('Tools has a World clock button', pg.locator('#sect-tools [data-tool=clock]').count()==1)
    pg.click('#sect-tools [data-tool=clock]'); pg.wait_for_timeout(500)
    rows=pg.evaluate("() => [...document.querySelectorAll('#sect-tools .wc-row')].map((r) => ({ name: r.querySelector('.wc-city b').textContent, time: r.querySelector('.wc-time b').textContent, light: r.className }))")
    check('sixteen cities, each with a 24-hour time', len(rows)==16 and all(len(r['time'])==5 and r['time'][2]==':' for r in rows), rows[:3])
    check('… marked day, twilight or night', all(any(k in r['light'] for k in ('wc-day','wc-twilight','wc-night')) for r in rows))
    check('the clock opens at the top of the list', pg.evaluate("() => document.querySelector('#sect-tools').scrollTop")==0)
    check('the drawer is titled World clock', pg.evaluate("() => document.querySelector('#drawer-title').textContent")=='World clock')
    t=pg.evaluate("() => document.querySelector('#sect-tools').innerText")
    check('London, New York and Tokyo are ticked and share no working hours', 'There is no hour' in t, t[-400:])
    pg.evaluate("() => { document.querySelector('#sect-tools').scrollTop = 60; }")
    pg.evaluate("() => document.querySelector('#sect-tools [data-wc-pick=tokyo]').click()"); pg.wait_for_timeout(400)
    kept=pg.evaluate("() => document.querySelector('#sect-tools').scrollTop")
    t=pg.evaluate("() => document.querySelector('#sect-tools').innerText")
    check('… untick Tokyo and London and New York overlap (13:00–18:00 London time, except in the weeks the two change clocks on different dates)', re.search(r'\d\d:00–\d\d:00\s+your time', t), t[-400:])
    check('… and the choice is remembered', pg.evaluate("() => localStorage.getItem('global-intelligence-atlas-clock')")=='["newyork","london"]')
    check('… and ticking keeps the list where it was', abs(kept-60) < 2, kept)
    pg.screenshot(path=os.path.join(SHOTS, 'v238-clock.png'))
    pg.click('#sect-tools .wc-row:has([data-wc-pick=tokyo]) .wc-city'); pg.wait_for_timeout(3500)
    pov=pg.evaluate("() => gia.state.pov")
    check('clicking a city flies there (Tokyo)', abs(pov['lat']-35.68) < 3 and abs(pov['lng']-139.69) < 3, pov)
    pg.click('.rail [data-section=tools]'); pg.wait_for_timeout(300)
    if not pg.evaluate("() => document.body.classList.contains('left-open')"): pg.click('.rail [data-section=tools]'); pg.wait_for_timeout(300)
    pg.click('#sect-tools [data-tool=clock]'); pg.wait_for_timeout(300)
    pg.click('#sect-tools [data-wc-back]'); pg.wait_for_timeout(300)
    check('Back returns to Tools', pg.evaluate("() => document.querySelector('#drawer-title').textContent")=='Tools')
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes(' world clock, and a steadier website') && s.includes('data-tool=\"clock\">Try the world clock'); }")
    check("What's new has a Try button for the world clock", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
