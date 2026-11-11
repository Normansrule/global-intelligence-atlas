# SPDX-License-Identifier: AGPL-3.0-only
# One country in depth: France's page shows its people as Isotype figures (towns and cities against countryside), its
# ranks, the country against the world with trends, languages and money, neighbours as buttons, local time in the
# capital and what is inside its borders now; the globe outlines it in gold with its neighbours and capital; a
# neighbour button opens that country; closing the page clears the globe.
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
OPEN="(c) => { const [lat, lng] = c; gia.surfaceClick(lat, lng, gia.countryAt(lat, lng)); }"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@46,3,1.2&l=borders,quakes,landmarks', wait_until='commit'); pg.wait_for_timeout(11000)
    f=pg.evaluate("""async () => { const c = await import('./js/countrydetail.js'); const fr = gia.state.data.borders.find((x) => x.properties['ISO3166-1-Alpha-2'] === 'FR'); const inside = c.insideTest(fr);
      return { unit: c.personUnit(68042591), small: c.personUnit(39244), off: c.capitalOffset(['UTC-10:00', 'UTC+01:00', 'UTC+12:00'], 2.33), one: c.capitalOffset(['UTC'], 0),
        paris: inside(48.85, 2.35), london: inside(51.5, -0.12), corsica: inside(42.15, 9.1),
        wb: c.wbSeries([{}, [{ country: { id: 'FR' }, countryiso3code: 'FRA', date: '2020', value: 3 }, { country: { id: '1W' }, countryiso3code: 'WLD', date: '2020', value: 5 }, { country: { id: 'FR' }, countryiso3code: 'FRA', date: '2019', value: 2 }]], 'FR') } }""")
    check('one figure stands for a round number of people (5 million for France, 2,000 for Monaco)', f['unit'] == 5e6 and f['small'] == 2000, f)
    check('the capital keeps the time zone nearest its longitude (Paris: UTC+1 of France\'s 14)', f['off'] == 60 and f['one'] == 0, f)
    check('the point-in-country test: Paris and Corsica in, London out', f['paris'] and f['corsica'] and not f['london'], f)
    check('World Bank rows split into the country and the world, oldest first', f['wb'] == {'me': [[2019, 2], [2020, 3]], 'world': [[2020, 5]]}, f['wb'])
    pg.evaluate(OPEN, [46.5, 2.5]); pg.wait_for_timeout(3500)
    c=pg.evaluate("""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
      return { h: n.querySelector('h3')?.innerText, line: t('#cd-line'), facts: [...n.querySelectorAll('#cd-facts .lm-fact')].map((e) => e.innerText.replace(/\\s+/g, ' ')),
        figs: n.querySelectorAll('.cd-people .cd-p').length, blue: n.querySelectorAll('.cd-people .cd-p.tone-blue').length, part: n.querySelectorAll('.cd-people .cd-p.part').length, key: t('.cd-key'),
        ms: [...n.querySelectorAll('.cd-m')].map((e) => e.querySelector('.cd-mh')?.innerText.replace(/\\s+/g, ' ')), world: n.querySelectorAll('.cd-bar i').length, sparks: n.querySelectorAll('.cd-spark path.cd-me').length, small: t('.cd-m small'),
        nb: [...n.querySelectorAll('[data-country-cc]')].map((e) => e.dataset.countryCc), more: t('#cd-more'), wiki: t('#cd-wiki'),
        lm: [...n.querySelectorAll('#cd-live [data-landmark]')].map((e) => e.dataset.landmark), live: t('#cd-live') } }""")
    check('the page opens on France with its official name, region, capital and the time there', c['h'].endswith('France') and 'French Republic' in c['line'] and 'Western Europe' in c['line'] and 'capital Paris' in c['line'] and 'there now' in c['line'], c['line'])
    check('people, area, density and time zones, with ranks among all countries', c['facts'] == ['68 million people · 22nd of 250', '551,695 km² area · 49th largest', '123 people per km²', '14 time zones'], c['facts'])
    check('its people as Isotype figures: 14 (one cut to size), 11 of them in towns and cities', c['figs'] == 14 and c['part'] == 1 and c['blue'] == 11 and 'One figure = 5 million people' in c['key'], (c['figs'], c['blue'], c['part'], c['key']))
    check('seven measures against the world, each with a world mark and a trend line', len(c['ms']) == 7 and c['ms'][0] == 'Income per person $44,400' and c['world'] == 7 and c['sparks'] == 7, c['ms'])
    check('each measure gives its year, the world figure and the change since 2000', '2023' in c['small'] and 'world $' in c['small'] and 'since 2000' in c['small'], c['small'])
    check('neighbours as buttons, biggest first', c['nb'][:2] == ['DE', 'IT'] and len(c['nb']) == 8, c['nb'])
    check('languages, money, driving side, phone code and United Nations membership', all(x in c['more'] for x in ['French', 'Euro (€)', 'right', '+33', '.fr', 'monday']), c['more'])
    check('what is inside it now: earthquakes this week, and its landmarks as buttons', 'earthquakes this week' in c['live'] and 'Eiffel Tower' in c['lm'], (c['live'][:200], c['lm']))
    check('a Wikipedia summary', 'French Republic' in c['wiki'], c['wiki'])
    g=pg.evaluate("""() => { const cs = gia.state.chan.borders; return { n: cs.custom.length, fat: cs.custom.some((c) => c.segs?.length > 50), labels: (cs.points ?? []).map((l) => l.label) } }""")
    check('the globe outlines France in gold, traces its neighbours and marks Paris', g['n'] >= 3 and g['fat'] and g['labels'] == ['Paris'], g)
    pg.evaluate("() => document.querySelector('[data-country-cc=\"DE\"]').click()"); pg.wait_for_timeout(2500)
    de=pg.evaluate("() => ({ h: document.querySelector('#notes-body h3')?.innerText, cc: document.querySelector('#notes-body .cd')?.dataset.country, labels: (gia.state.chan.borders.points ?? []).map((l) => l.label) })")
    check('a neighbour button opens that country (and copes when a feed has nothing for it)', de['h'].endswith('Germany') and de['cc'] == 'DE' and de['labels'] == [], de)
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    g2=pg.evaluate("() => ({ n: gia.state.chan.borders.custom.length, labels: (gia.state.chan.borders.points ?? []).length })")
    check('closing the page takes the outline off the globe', g2['n'] <= 2 and g2['labels'] == 0, g2)
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, [46.5, 2.5]); pg.wait_for_timeout(3500)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.cd *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the country page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
