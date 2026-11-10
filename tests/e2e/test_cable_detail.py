# SPDX-License-Identifier: AGPL-3.0-only
# One undersea cable in depth: 2Africa's page gives its length against journeys you know and in light-time, its
# owners, its landing stations by country, how many cables each of its countries has (the fragile ones marked),
# the ships stopped or at anchor over its route away from port, and the cables that share its landings. On the
# globe light flows along it and its landing stations are ringed; closing clears them.
# Real records: tests/e2e/fixtures/cables-detail.json (36 cables from the open-data branch, TeleGeography).
import sys, json, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
CABLES=open(os.path.join(sys.argv[-1],'fixtures','cables-detail.json')).read()
def opendata(route):
    if route.request.url.endswith('/cables.json'): return route.fulfill(status=200, body=CABLES, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404', headers={'Access-Control-Allow-Origin':'*'})
OPEN="(id) => gia.select({ layer: 'cables', d: gia.state.data.cables.find((c) => c.id === id) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { head: t('#cb-head'), land: t('#cb-land'), landSum: t('#cb-land-sum'), cut: t('#cb-cut'), cutSum: t('#cb-cut-sum'), over: t('#cb-over'), overSum: t('#cb-over-sum'), share: t('#cb-share'),
    fragile: [...n.querySelectorAll('.cb-cut li.fragile > span:first-child')].map((e) => e.textContent), ccs: [...n.querySelectorAll('#cb-land [data-country-cc]')].map((b) => b.dataset.countryCc),
    mmsi: [...n.querySelectorAll('#cb-over [data-mmsi]')].map((b) => b.dataset.mmsi), shareIds: [...n.querySelectorAll('[data-cable-id]')].map((b) => b.dataset.cableId), beam: !!n.querySelector('.cb-beam') } }"""
GLOBE="() => { const c = gia.state.chan.cables; return { custom: (c.custom ?? []).length, rings: (c.custom?.[1]?.segs?.length ?? 0) / 5, paths: (c.paths ?? []).length, anim: (c.paths ?? []).every((p) => p.animMs > 0) } }"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://raw.githubusercontent.com/**/open-data/**', opendata)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/?datasets=open#@10,45,2.2&l=borders,cables,ships&s=1', wait_until='commit'); pg.wait_for_timeout(12000)
    f=pg.evaluate("""async () => { const m = await import('./js/cabledetail.js');
      return { ms: m.lightMs(6605), words: [m.lengthWords(45000), m.lengthWords(6600), m.lengthWords(400)], km: Math.round(m.routeKm({ points: [[0, 0], [1, 0]] })) } }""")
    check('light-time through fibre: about 32 ms across the Atlantic (MAREA, 6,605 km)', 32 < f['ms'] < 33, f['ms'])
    check('lengths against journeys you know', 'round the Earth' in f['words'][0] and 'London to New York' in f['words'][1] and 'London to Paris' in f['words'][2], f['words'])
    check('a route without a length is measured along its drawn points', f['km'] == 111, f['km'])
    # 2Africa, with one ship at anchor over its route in the Arabian Sea, one moving there and one far off
    pg.evaluate("""() => { const s = gia.state.data.ships; s.push({ mmsi: 999000001, lat: 16.21, lng: 60.755, sog: 0, cog: 0, nav: 1, t: Date.now(), meta: { name: 'TEST ANCHOR', shipType: 70 } },
      { mmsi: 999000002, lat: 16.21, lng: 60.76, sog: 12, cog: 90, nav: 0, t: Date.now(), meta: { name: 'TEST MOVING', shipType: 70 } },
      { mmsi: 999000003, lat: 16.7, lng: 60.755, sog: 0, cog: 0, nav: 1, t: Date.now(), meta: { name: 'TEST FAR', shipType: 70 } }) }""")
    pg.evaluate(OPEN, '2africa'); pg.wait_for_timeout(2500)
    s=pg.evaluate(TXT)
    check('the head: 45,000 km, 1.12 times round the Earth, its light-time and the satellite comparison', '45,000 km' in s['head'] and 'round the Earth' in s['head'] and '220 ms' in s['head'] and 'geostationary' in s['head'] and s['beam'], s['head'][:300])
    check('in service since 2024 and its eight owners', 'In service since 2024' in s['head'] and 'Shared by 8 companies' in s['head'] and 'Meta' in s['head'], s['head'][-300:])
    check('landings by country, countries as buttons', 'stations in' in s['landSum'] and 'Mogadishu' in s['land'] and 'Marseille' in s['land'] and len(s['ccs']) >= 30 and 'SO' in s['ccs'], (s['landSum'], len(s['ccs'])))
    check('if it were cut: countries with three or fewer cables marked (Seychelles)', 'Seychelles' in s['fragile'] and 'or fewer' in s['cutSum'], (s['fragile'], s['cutSum']))
    check('ships over it: the one at anchor on the route, not the moving one or the far one', s['mmsi'][:1] == ['999000001'] and '999000002' not in s['mmsi'] and '999000003' not in s['mmsi'] and 'at anchor' in s['over'] and 'stopped within 2 km' in s['overSum'], (s['mmsi'], s['over'][:200]))
    check('cables that share its landings, each a button to its own page', len(s['shareIds']) >= 10, s['shareIds'][:5])
    g=pg.evaluate(GLOBE)
    check('on the globe: landing rings in one draw call and light flowing along every part', g['custom'] == 2 and g['rings'] > 40 * 24 and g['paths'] >= 40 and g['anim'], g)
    sid=s['shareIds'][0]
    pg.evaluate("(id) => document.querySelector(`[data-cable-id=\"${id}\"]`).click()", sid); pg.wait_for_timeout(1500)
    check('a shared cable opens its own page', pg.evaluate("() => String(gia.state.selected?.d?.id)") == sid, pg.evaluate("() => gia.state.selected?.d?.id"))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    g=pg.evaluate(GLOBE)
    check('closing the page takes the light and the rings off the globe', g['custom'] == 1 and g['paths'] == 0, g)
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, '2africa'); pg.wait_for_timeout(2000)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.cb *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the cable page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
