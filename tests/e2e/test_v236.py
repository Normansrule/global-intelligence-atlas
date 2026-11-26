# SPDX-License-Identifier: AGPL-3.0-only
# v2.36 A sleeker atlas (frosted map controls, one-line layer rows with the source underneath, info buttons, a quieter
# status bar) and Spacecraft at work (spacecraft.js): the fleet at L1, L2 and Mars, Parker Solar Probe, the missions on the way.
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
    pg.goto('http://localhost:8765/app/#@30,10,2.2&l=sun,borders,quakes', wait_until='commit'); pg.wait_for_timeout(9000)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    r=pg.evaluate("""() => { const row = document.querySelector('label[for=ly-fires]:not(.sw)'); const l = document.querySelector('[data-learn="fires"]');
      return { name: row?.querySelector('.ln')?.firstChild?.textContent, src: row?.querySelector('.ln .src')?.textContent, learnText: l?.textContent.trim(), learnLabel: l?.getAttribute('aria-label'), svg: !!l?.querySelector('svg'), w: l?.getBoundingClientRect().width,
        h: row?.getBoundingClientRect().height }; }""")
    check('a layer row: its name, its source underneath (Fire hotspots / NASA FIRMS), one line of name', r['name']=='Fire hotspots' and r['src']=='NASA FIRMS' and r['h'] < 40, r)
    check('Learn is an info button, still named for screen readers and at least 24 px', r['learnText']=='' and r['svg'] and r['learnLabel']=='Learn about Fire hotspots (NASA FIRMS)' and r['w'] >= 24, r)
    m=pg.evaluate("""() => { const bs = [...document.querySelectorAll('.mapctl > button')]; const cs = bs.map((x) => getComputedStyle(x));
      return { gaps: bs.slice(1).map((x, i) => Math.round(x.getBoundingClientRect().top - bs[i].getBoundingClientRect().bottom)), first: cs[0].borderTopLeftRadius, mid: cs[1].borderTopLeftRadius, last: cs[cs.length - 1].borderBottomLeftRadius, blur: cs[0].backdropFilter }; }""")
    check('the map buttons are one frosted stack: no gaps, round only at the ends', all(g <= 0 for g in m['gaps']) and m['first']=='10px' and m['mid']=='0px' and m['last']=='10px' and 'blur' in m['blur'], m)
    q=pg.evaluate("() => getComputedStyle(document.querySelector('.statusbar .quality')).opacity")
    check('the status bar’s frame rate and quality step back', float(q) < 1, q)
    # spacecraft at work
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_function("() => gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(2500)
    pg.evaluate("() => document.querySelector('[data-space-card]')?.click()"); pg.wait_for_timeout(1500)
    t=pg.evaluate("""() => { const h = [...document.querySelectorAll('#notes-body h4')].find((x) => x.textContent === 'Spacecraft at work'); const tb = h?.nextElementSibling;
      return tb ? [...tb.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim())) : null; }""")
    rows={x[0]: x for x in (t or [])}
    check('the solar system card: a Spacecraft at work table with Webb at L2 (5 seconds) and the Mars fleet in minutes', t and len(t)==22 and rows.get('Webb',[None,None,None])[1]=='L2' and rows['Webb'][2]=='5 seconds' and 'minutes' in rows['MRO'][2], t[:3] if t else t)
    check('… Parker given by its distance from the Sun now, Europa Clipper by where it is going', 'million km from the Sun' in rows.get('Parker',['',''])[1] and 'Jupiter' in rows.get('Europa Clipper',['',''])[1], [rows.get('Parker'), rows.get('Europa Clipper')])
    pg.evaluate("() => gia.cosmos.craft('jwst')"); pg.wait_for_timeout(1500)
    w=pg.evaluate("() => ({ t: document.querySelector('#notes-body')?.innerText ?? '', svg: !!document.querySelector('#notes-body .lg-svg g.on'), euclid: !!document.querySelector('#notes-body [data-space-craft=euclid]') })")
    check('Webb’s page: at L2 about 1.5 million km away, the Sun–L1–Earth–L2 sketch, Euclid next to it', 'Sun–Earth L2' in w['t'] and '1.51 million km' in w['t'] and w['svg'] and w['euclid'], w['t'][:400])
    pg.screenshot(path=os.path.join(SHOTS, 'v236-webb.png'))
    pg.evaluate("() => document.querySelector('#notes-body [data-space-craft=euclid]').click()"); pg.wait_for_timeout(1500)
    check('… and Euclid opens from there', 'Euclid' in pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText ?? ''"))
    pg.evaluate("() => gia.cosmos.craft('parker')"); pg.wait_for_timeout(1500)
    pt=pg.evaluate("() => document.querySelector('#notes-body')?.innerText ?? ''")
    check('Parker’s page: from the Sun now, its speed, its next close pass', 'From the Sun now' in pt and 'km/s' in pt and 'Next close pass' in pt, pt[:400])
    pg.evaluate("() => gia.cosmos.craft('mro')"); pg.wait_for_timeout(1500)
    mt=pg.evaluate("() => document.querySelector('#notes-body')?.innerText ?? ''")
    check('MRO’s page: Mars’s distance in AU and minutes of radio, and a Fly to Mars button', ' AU' in mt and 'minutes each way' in mt and pg.evaluate("() => !!document.querySelector('#notes-body [data-space=mars]')"), mt[:400])
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('sleeker atlas, and the spacecraft at work') && s.includes('data-space-craft=\"jwst\"'); }")
    check("What's new has a Try button for Webb", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
