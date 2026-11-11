# SPDX-License-Identifier: AGPL-3.0-only
# One nuclear plant in depth: Doel's page gives its power, a year's output and the people it supplies, the people in
# its 16, 30 and 80 km planning zones (Antwerp inside the first), which way the wind would carry a release, and the
# plants near it; the rings and the wind arrow go on the globe and come off when it closes.
# Real records: tests/e2e/fixtures/nuclear-detail.json (five plants from the open-data branch, Wikidata).
import sys, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
NUC=open(os.path.join(sys.argv[-1],'fixtures','nuclear-detail.json')).read()
def opendata(route):
    if route.request.url.endswith('/nuclear.json'): return route.fulfill(status=200, body=NUC, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404', headers={'Access-Control-Allow-Origin':'*'})
OPEN="(name) => gia.select({ layer: 'nuclear', d: gia.state.data.nuclear.find((n) => n.name.startsWith(name)) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { head: t('#nk-head'), zones: t('#nk-zones'), wind: t('#nk-wind'), near: t('#nk-near'), rings: n.querySelectorAll('#nk-zones .ev-ring').length, figs: n.querySelectorAll('#nk-zones .cd-p').length } }"""
CUSTOM="() => (gia.state.chan.nuclear?.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://raw.githubusercontent.com/**/open-data/**', opendata)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg.goto('http://localhost:8765/app/?datasets=open#@51,4,1.2&l=borders,nuclear,cities&s=1', wait_until='commit'); pg.wait_for_timeout(10000)
    y=pg.evaluate("async () => { const m = await import('./js/nucleardetail.js'); return m.yearOutput(1000) }")
    check('1,000 MW at 90% makes about 7.9 TWh a year, the electricity of about 2.1 million people', 7.8 < y['twh'] < 8.0 and 2.0e6 < y['people'] < 2.2e6, y)
    pg.evaluate(OPEN, 'Doel'); pg.wait_for_timeout(3000)
    s=pg.evaluate(TXT)
    check('the head: 1,026 MW, active, in service since 1975, a year’s output', '1,026 MW' in s['head'] and 'since 1975' in s['head'] and 'TWh' in s['head'] and 'million people' in s['head'], s['head'])
    check('people in its three planning zones, Antwerp inside 16 km', s['rings'] == 3 and s['figs'] > 0 and 'Antwerp' in s['zones'] and 'within 16 km' in s['zones'] and 'within 80 km' in s['zones'], s['zones'][:300])
    check('which way the air is moving, from the wind now', 'The air is moving north-east' in s['wind'] and '19 km/h' in s['wind'], s['wind'])
    check('the other plants within 300 km', 'Borssele' in s['near'] and 'Tihange' in s['near'] and 'Gravelines' in s['near'], s['near'])
    c=pg.evaluate(CUSTOM)
    check('on the globe: three rings and the wind arrow in one draw call', len(c) == 1 and c[0] == 3 * 120 + 3, c)
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes them off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, 'Doel'); pg.wait_for_timeout(2500)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.nk *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the plant page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
