# SPDX-License-Identifier: AGPL-3.0-only
# v2.32 the famous comets (comets.js), in the app: their labels, orbits and tails in the solar system view, the table
# on the solar system card and each comet's page. tests/comets/test-comets.mjs pins the numbers to a fixed date.
import sys, os, json
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
TEXT="() => { document.querySelectorAll('#notes-body details.qd-sec').forEach((d) => d.open = true); return document.querySelector('#notes-body')?.innerText ?? ''; }"
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
sw=open(os.path.join(ROOT, 'site/sw.js')).read()
check('the offline pack and the service worker have the new code', 'app/js/comets.js' in pack and "'app/js/comets.js'" in sw)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@51.5,-0.1,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(3500)
    t=pg.evaluate(TEXT)
    rows=pg.evaluate("() => [...document.querySelectorAll('#notes-body [data-space-comet]')].map((e) => e.dataset.spaceComet)")
    check('the solar system card: a table of the six comets', 'Famous comets' in t and rows==['halley','encke','swifttuttle','tempeltuttle','cg67p','halebopp'], rows)
    check('Halley comes back on 28 July 2061', '28 July 2061' in t, t[-3000:])
    lab=pg.evaluate("() => [...document.querySelectorAll('.space-label.comet')].filter((e) => !e.hidden).map((e) => e.dataset.spaceComet)")
    check('labels for the comets in view in the solar system', 'encke' in lab and 'tempeltuttle' in lab, lab)
    d=pg.evaluate("""() => { const { CS, scene } = gia.cosmos.debug(); let orbits = 0; scene.traverse((o) => { if (o.userData?.comets && o.visible) orbits = o.geometry.attributes.position.count; });
      const r = Object.fromEntries(Object.entries(CS).map(([k, v]) => [k, +v.r.toFixed(2)])); return { orbits, r, tailEncke: CS.encke.tail.visible, tailHalley: CS.halley.tail.visible }; }""")
    check('their orbits are drawn (six closed rings)', d['orbits'] == 6 * 480 * 2, d)
    check('each comet placed at its distance (Halley over 30 AU out, Encke under 5)', d['r']['halley'] > 30 and d['r']['encke'] < 5, d['r'])
    check('a tail only near the Sun', d['tailEncke'] == (d['r']['encke'] < 3) and not d['tailHalley'], d)
    pg.evaluate("() => document.querySelector('#notes-body [data-space-comet=\"halley\"]').click()"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('Halley’s page: where it is now, from the Sun and the Earth', 'Halley’s Comet' in t and 'From the Sun' in t and 'From the Earth' in t and 'Speed around the Sun' in t, t[:900])
    check('Halley’s page: its orbit drawn among the planets', pg.evaluate("() => !!document.querySelector('#notes-body .ce-orbit .ce-now') && document.querySelectorAll('#notes-body .ce-orbit .ce-pl').length === 7"))
    check('Halley’s page: goes round backwards, its showers and Giotto', 'goes round backwards' in t and 'Orionids' in t and 'Eta Aquariids' in t and 'Giotto' in t, t)
    pg.evaluate("() => gia.cosmos.comet('cg67p')"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('67P from anywhere: Rosetta and Philae', 'Churyumov' in t and 'Rosetta' in t and 'Philae' in t, t[:600])
    pg.evaluate("() => gia.cosmos.explore('earth', { instant: true })"); pg.wait_for_timeout(2500)
    pg.evaluate("() => gia.cosmos.comet('encke')"); pg.wait_for_timeout(6000)
    t=pg.evaluate(TEXT)
    check('from the globe, a comet flies out to the solar system and opens its page', pg.evaluate("() => gia.cosmos.focus()") == 'system' and 'Comet Encke' in t and 'Taurids' in t, [pg.evaluate("() => gia.cosmos.focus()"), t[:300]])
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('he famous comets') && s.includes('data-space-comet=\"halley\"'); }")
    check("What's new has a Try button for Halley's Comet", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
