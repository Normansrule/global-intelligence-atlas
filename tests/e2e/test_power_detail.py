# SPDX-License-Identifier: AGPL-3.0-only
# One power station in depth: Drax's page gives its power and how hard it ran against coal plants generally, the
# people its output supplies, its carbon over the whole life cycle against every other kind of power and in cars,
# the United Kingdom's plants by fuel with its rank, and its neighbours; Hornsea 1's page says how hard the wind farm
# is likely running right now. The 50 km ring and the lines to its neighbours go on the globe and come off on close.
# Real records: site/app/data/power-plants.json (World Resources Institute Global Power Plant Database).
import sys, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
OPEN="(name) => gia.select({ layer: 'power', d: gia.state.data.power.find((p) => p.name === name) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { head: t('#pw-head'), run: t('#pw-run'), now: t('#pw-now'), co2: t('#pw-co2'), mix: t('#pw-mix'), near: t('#pw-near'), me: t('#pw-co2 .pw-row.me span'), parts: n.querySelectorAll('.pw-mix i').length, ids: [...n.querySelectorAll('[data-cd-power]')].map((b) => b.dataset.cdPower) } }"""
CUSTOM="() => (gia.state.chan.power?.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.21')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@53.7,-1,0.5&l=borders,power&s=1', wait_until='commit'); pg.wait_for_timeout(10000)
    f=pg.evaluate("""async () => { const m = await import('./js/powerdetail.js');
      return { cf: m.capacityFactor(1000, 7889.4), co2: m.yearCo2(1000, 'Coal'), w: [m.windShare(2), m.windShare(7.5), m.windShare(12), m.windShare(30)], s: m.solarShare(500) } }""")
    check('capacity factor: 1,000 MW making 7,889 GWh ran 90% of the time', abs(f['cf'] - 0.9) < 0.001, f['cf'])
    check('1,000 GWh of coal is 820,000 tonnes over the life cycle', f['co2'] == 820000, f['co2'])
    check('a wind turbine: nothing below 3 m/s, full at 12, shut down above 25', f['w'][0] == 0 and 0.2 < f['w'][1] < 0.25 and f['w'][2] == 1 and f['w'][3] == 0 and f['s'] == 0.5, f)
    pg.evaluate(OPEN, 'Drax'); pg.wait_for_timeout(2500)
    s=pg.evaluate(TXT)
    check('the head: 1,980 MW, a coal power station, Drax Power', '1,980 MW' in s['head'] and 'Coal power station' in s['head'] and 'Drax Power' in s['head'], s['head'])
    check('how hard it ran: 17% against 42% for coal, and the people it supplies', 'This plant' in s['run'] and '17%' in s['run'] and 'Typical coal' in s['run'] and '42%' in s['run'] and '3,008 GWh' in s['run'] and 'people' in s['run'], s['run'])
    check('carbon: coal marked among all kinds of power, in tonnes and cars', s['me'] == 'Coal' and '2.5 million tonnes' in s['co2'] and 'cars' in s['co2'], s['co2'][-250:])
    check('the United Kingdom’s plants by fuel, and its rank', "United Kingdom's plants" in s['mix'] and s['parts'] >= 4 and 'number' in s['mix'], s['mix'][:250])
    check('its neighbours, each a button to its own page', len(s['ids']) >= 3 and 'Drax GT' in s['near'], s['near'][:200])
    c=pg.evaluate(CUSTOM)
    check('on the globe: the ring and a line to each neighbour in one draw call', len(c) == 1 and c[0] == 120 + len(s['ids']), (c, len(s['ids'])))
    pg.evaluate("() => document.querySelector('[data-cd-power]').click()"); pg.wait_for_timeout(1500)
    check('a neighbour opens its own page', pg.evaluate("() => gia.state.selected?.d?.name") != 'Drax' and pg.evaluate("() => gia.state.selected?.layer") == 'power', pg.evaluate("() => gia.state.selected?.d?.name"))
    pg.evaluate(OPEN, 'Hornsea 1 - Heron & Njord'); pg.wait_for_timeout(2500)
    s=pg.evaluate(TXT)
    check('a wind farm: how hard it is likely running right now', 'Right now' in s['now'] and 'm/s' in s['now'] and 'MW' in s['now'] and 'Typical wind' in s['run'], (s['now'], s['run'][:120]))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes them off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, 'Drax'); pg.wait_for_timeout(2500)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.pw *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the plant page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
