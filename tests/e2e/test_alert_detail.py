# SPDX-License-Identifier: AGPL-3.0-only
# One disaster alert in depth: an orange earthquake alert in Sichuan gives its level on the green, orange and red
# scale and what GDACS weighs for earthquakes, the people within 50 and 100 km, the earthquake's own page and the
# weather there; a red cyclone alert over the sea links to the same storm tracked by NASA and lists the other
# alerts nearby. The alert's rings go on the globe and come off when it closes.
import sys, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
OPEN="(type) => gia.select({ layer: 'alerts', d: gia.state.data.alerts.find((a) => a.type === type) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { head: t('#dz-head'), same: t('#dz-same'), people: t('#dz-people'), wx: t('#dz-wx'), near: t('#dz-near'), on: t('.dz-step.on b'), rings: n.querySelectorAll('#dz-people .ev-ring').length,
    quake: n.querySelector('[data-cd-quake]')?.dataset.cdQuake ?? null, event: n.querySelector('[data-cd-event]')?.dataset.cdEvent ?? null, alertIds: [...n.querySelectorAll('[data-cd-alert]')].map((b) => b.dataset.cdAlert) } }"""
CUSTOM="() => (gia.state.chan.alerts?.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@25,115,2.2&l=borders,alerts,quakes,events,cities&s=1', wait_until='commit'); pg.wait_for_timeout(10000)
    f=pg.evaluate("""async () => { const m = await import('./js/alertdetail.js');
      return { span: [m.spanWords('2026-09-25T00:00:00', '2026-09-28T12:00:00', Date.parse('2026-10-01T00:00:00Z')), m.spanWords('2026-09-27T05:13:35', '2026-09-27T05:13:35')],
        t: m.gdacsTime('2026-09-27T05:13:35') === Date.parse('2026-09-27T05:13:35Z'), lv: ['Green', 'Orange', 'Red', 'x'].map(m.levelOf) } }""")
    check('GDACS times are UTC; spans in words', f['t'] and f['span'] == ['4 days', 'a single moment'], f)
    check('levels in order on the scale', f['lv'] == [0, 1, 2, 0], f['lv'])
    # the earthquake itself, 20 km from the alert and an hour later; a NASA storm track by the cyclone; a third alert near it
    pg.evaluate("""() => { const d = gia.state.data; const t = Date.parse('2026-09-27T06:13:35Z');
      d.quakes.push({ id: 'qsc', properties: { mag: 5.9, place: '20 km E of Neijiang, China', time: t, magType: 'mww' }, geometry: { coordinates: [105.25, 29.45, 10] } });
      (d.events ??= []).push({ id: 'EONET_TEST', title: 'Typhoon Neoguri', categories: [{ id: 'severeStorms', title: 'Severe Storms' }], geometry: [{ type: 'Point', date: '2026-09-27T00:00:00Z', coordinates: [131.0, 22.0], magnitudeValue: 115, magnitudeUnit: 'kts' }] });
      d.alerts.push({ id: 'FL-77', type: 'FL', name: 'Flood in Luzon', level: 'Orange', lat: 18.5, lng: 124.0, from: '2026-09-26T00:00:00', to: '2026-09-28T00:00:00', sev: '' }) }""")
    pg.evaluate(OPEN, 'EQ'); pg.wait_for_timeout(2500)
    s=pg.evaluate(TXT)
    check('the head: orange alert, an earthquake, magnitude 5.9, and what orange means', 'Orange alert' in s['head'] and 'Earthquake' in s['head'] and '5.9' in s['head'] and s['on'] == 'Orange' and 'may be needed' in s['head'], s['head'][:300])
    check('what GDACS weighs for earthquakes', 'GDACS weighs the magnitude and depth' in s['head'], s['head'][-300:])
    check('people within 50 and 100 km, the towns named', s['rings'] == 2 and 'within 100 km' in s['people'], s['people'][:300])
    check('a link to the earthquake’s own page', s['quake'] == 'qsc' and 'The earthquake itself' in s['same'], s['same'])
    check('the weather there now', '°C' in s['wx'] and 'km/h' in s['wx'], s['wx'][:200])
    c=pg.evaluate(CUSTOM)
    check('on the globe: its two rings in one draw call', c == [240], c)
    pg.evaluate("() => document.querySelector('[data-cd-quake]').click()"); pg.wait_for_timeout(1500)
    check('the link opens the earthquake page and takes the rings off', pg.evaluate("() => gia.state.selected?.layer + ':' + gia.state.selected?.d?.id") == 'quakes:qsc' and pg.evaluate(CUSTOM) == [], pg.evaluate("() => gia.state.selected?.layer"))
    pg.evaluate(OPEN, 'TC'); pg.wait_for_timeout(2500)
    s=pg.evaluate(TXT)
    check('a red cyclone alert, the storm tracked by NASA', s['on'] == 'Red' and 'likely needed' in s['head'] and s['event'] == 'EONET_TEST' and 'Typhoon Neoguri' in s['same'], (s['on'], s['same']))
    check('the other alerts within 1,000 km, each a button to its own page', s['alertIds'] == ['FL-77'], s['alertIds'])
    pg.evaluate("() => document.querySelector('[data-cd-alert]').click()"); pg.wait_for_timeout(1500)
    check('a nearby alert opens its own page', pg.evaluate("() => gia.state.selected?.d?.id") == 'FL-77' and 'Flood' in pg.evaluate(TXT)['head'], pg.evaluate("() => gia.state.selected?.d?.id"))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes the rings off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, 'EQ'); pg.wait_for_timeout(2000)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.dz *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the alert page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
