# SPDX-License-Identifier: AGPL-3.0-only
# v2.37 Visitors from other stars (interstellar.js): ʻOumuamua, Borisov and 3I/ATLAS on their open paths in the
# solar system view, with labels, a table on the system card and a page each.
import sys, os
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
SHOTS=os.environ.get('SHOT_DIR', '/tmp')
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@30,10,2.2&l=sun,borders', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(4000)
    d=pg.evaluate("""() => { const { VS, B } = gia.cosmos.debug(); const AU = B.sun.r / 696000 * 149597870.7;
      return { r: Object.fromEntries(Object.entries(VS).map(([k, v]) => [k, v.pos.length() / AU])), labels: [...document.querySelectorAll('.space-label.visitor:not([hidden])')].map((e) => e.dataset.spaceVisitor) }; }""")
    check('the three visitors are placed where they are now (3I/ATLAS 10–17 AU out, the others far beyond Neptune)', 10 < d['r']['atlas3i'] < 17 and d['r']['oumuamua'] > 40 and d['r']['borisov'] > 40, d)
    check('… and labelled in the whole solar system view', set(d['labels']) >= {'atlas3i'}, d['labels'])
    pg.evaluate("() => document.querySelector('[data-space-card]')?.click()"); pg.wait_for_timeout(1500)
    t=pg.evaluate("""() => { const h = [...document.querySelectorAll('#notes-body h4')].find((x) => x.textContent === 'Visitors from other stars'); const tb = h?.nextElementSibling;
      return tb ? [...tb.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim())) : null; }""")
    check('the solar system card: a table of the three, with how fast each is leaving (26, 32, 58 km/s)', t and [r[2] for r in t]==['26 km/s','32 km/s','58 km/s'], t)
    pg.evaluate("() => document.querySelector('#notes-body [data-space-visitor=atlas3i]').click()"); pg.wait_for_timeout(2000)
    x=pg.evaluate("() => document.querySelector('#notes-body')?.innerText ?? ''")
    check('3I/ATLAS’s page: from the Sun now, leaving, closest to the Sun on 29 October 2025 and to the Earth on 19 December 2025', 'leaving the solar system' in x and '29 October 2025' in x and '19 December 2025' in x and 'never comes back' in x, x[:600])
    pg.screenshot(path=os.path.join(SHOTS, 'v237-atlas.png'))
    pg.evaluate("() => document.querySelector('#notes-body [data-space-visitor=oumuamua]').click()"); pg.wait_for_timeout(1500)
    check('… with buttons to the other two (ʻOumuamua opens)', 'ʻOumuamua' in pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText ?? ''"))
    vis=pg.evaluate("() => gia.cosmos.debug().scene.getObjectByProperty ? (() => { let n = 0; gia.cosmos.debug().scene.traverse((o) => { if (o.userData?.visitors) n = o.geometry.attributes.position.count; }); return n; })() : 0")
    check('their open paths are drawn', vis >= 3 * 2 * 300, vis)
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('isitors from other stars') && s.includes('data-space-visitor=\"atlas3i\"'); }")
    check("What's new has a Try button for 3I/ATLAS", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
