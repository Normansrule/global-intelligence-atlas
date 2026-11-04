# SPDX-License-Identifier: AGPL-3.0-only
# One natural event in depth: a typhoon's page gives its category on the Saffir-Simpson scale, its wind over its
# life, how fast and which way it is moving and its track coloured by strength; a volcano's page counts the people
# within 10, 30 and 100 km and says which way the ash would drift, with rings and an arrow on the globe; a
# wildfire's page gives its size, the fire weather and which way it would spread. Closing clears the globe.
import sys, json, time; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
now=time.time()
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now-h*3600))
KTS=[35, 50, 70, 90, 115, 125]
EV={"events":[
  {"id":"S1","title":"Typhoon Testing","categories":[{"id":"severeStorms","title":"Severe Storms"}],"sources":[{"id":"JTWC","url":"https://www.metoc.navy.mil/jtwc/"}],
   "geometry":[{"type":"Point","date":iso(6*(5-i)),"magnitudeValue":v,"magnitudeUnit":"kts","coordinates":[135-i*0.6,13+i*0.3]} for i,v in enumerate(KTS)]},
  {"id":"V1","title":"Etna Volcano, Italy","categories":[{"id":"volcanoes","title":"Volcanoes"}],"sources":[{"id":"SIVolcano","url":"https://volcano.si.edu/"}],
   "geometry":[{"type":"Point","date":iso(72),"coordinates":[14.99,37.75]}]},
  {"id":"E1","title":"Wildfire - Butte County, California","categories":[{"id":"wildfires","title":"Wildfires"}],"sources":[],
   "geometry":[{"type":"Point","date":iso(30),"magnitudeValue":12000,"magnitudeUnit":"acres","coordinates":[-121.6,39.7]}]}]}
def eonet(route): return route.fulfill(status=200, body=json.dumps(EV), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
OPEN="(id) => gia.select({ layer: 'events', d: gia.state.data.events.find((e) => e.id === id) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { line: t('#ev-line'), main: t('#ev-main'), wx: t('#ev-weather'), people: t('#ev-people'), rep: t('#ev-reports'), cc: n.querySelector('#ev-line [data-country-cc]')?.dataset.countryCc,
    on: n.querySelector('.ev-scale span.on')?.textContent, dots: n.querySelectorAll('svg.ev-wind circle').length, rings: n.querySelectorAll('.ev-ring').length,
    figs: n.querySelectorAll('#ev-people .cd-p').length, fires: !!n.querySelector('#ev-main [data-cd-layer="fires"]') } }"""
CUSTOM="() => (gia.state.chan.events.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://eonet.gsfc.nasa.gov/**', eonet)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,60,2.2&l=borders,events,fires', wait_until='commit'); pg.wait_for_timeout(12000)
    f=pg.evaluate("""async () => { const m = await import('./js/eventdetail.js');
      return { steps: [33, 34, 63, 64, 96, 137, 160].map(m.stormStep), basin: [m.basinWord(15, 130), m.basinWord(20, -60), m.basinWord(-15, 60), m.basinWord(15, 88)],
        acres: m.areaKm2(12000, 'acres'), nm: m.areaKm2(100, 'NM^2'), words: [m.areaWords(1), m.areaWords(48.6), m.areaWords(4000)],
        mo: m.motion([{ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 1, t: 6 * 3600e3 }]) } }""")
    check('Saffir-Simpson steps from the wind in knots', f['steps'] == [0, 1, 1, 2, 4, 6, 6], f['steps'])
    check('typhoon in the north-west Pacific, hurricane in the Atlantic, cyclone in the Indian Ocean', f['basin'] == ['typhoon', 'hurricane', 'cyclone', 'cyclone'], f['basin'])
    check('sizes in km² from acres and square nautical miles, put against places you know', 48 < f['acres'] < 49 and 342 < f['nm'] < 344 and 'football pitches' in f['words'][0] and 'Manhattan' in f['words'][1] and 'Belgium' in f['words'][2], f)
    check('speed and heading from the last two fixes', 18 < f['mo']['kmh'] < 19 and 89 < f['mo']['deg'] < 91, f['mo'])
    # the typhoon
    pg.evaluate(OPEN, 'S1'); pg.wait_for_timeout(3000)
    s=pg.evaluate(TXT)
    check('the storm: 125 knots, a category 4 typhoon, marked on the scale', '125 knots' in s['main'] and 'Category 4 typhoon' in s['main'] and s['on'] == '4', (s['main'][:120], s['on']))
    check('its wind over its life, one dot per report, with its peak', s['dots'] == 6 and 'Strongest so far: 125 knots' in s['main'], (s['dots'], s['main'][-160:]))
    check('how fast and which way it is moving, and how far it has come', 'Moving north-west at' in s['main'] and 'It has come' in s['main'], s['main'])
    check('the top line: over open water, how long it has been going and the last report', 'over open water' in s['line'] and 'going for' in s['line'] and 'last report' in s['line'], s['line'])
    check('the weather there now, and the reports with their source', '11°C' in s['wx'] and 'from the south-west' in s['wx'] and '6 reports' in s['rep'] and 'JTWC' in s['rep'], (s['wx'], s['rep']))
    c=pg.evaluate(CUSTOM)
    check('on the globe: the 300 km ring and the track coloured by strength, in one draw call', len(c) == 1 and c[0] > 120 + 5 - 1, c)
    # the volcano
    pg.evaluate(OPEN, 'V1'); pg.wait_for_timeout(3000)
    v=pg.evaluate(TXT)
    check('the volcano: in Italy, the ground height and which way the ash would drift', v['cc'] == 'IT' and 'ground height' in v['main'] and 'Ash would drift east' in v['main'] and '45 km/h' in v['main'], (v['line'], v['main']))
    check('people within 10, 30 and 100 km as figures, with the cities named', v['rings'] == 3 and v['figs'] > 0 and 'Catania' in v['people'] and 'within 100 km' in v['people'], (v['rings'], v['figs'], v['people'][:300]))
    c=pg.evaluate(CUSTOM)
    check('on the globe: three rings and the ash arrow (the storm track gone)', len(c) == 1 and c[0] == 3 * 120 + 3, c)
    # the wildfire
    pg.evaluate(OPEN, 'E1'); pg.wait_for_timeout(3000)
    w=pg.evaluate(TXT)
    check('the wildfire: its size in km² and against Manhattan, in the United States', '49 km²' in w['main'] and '12,000 acres' in w['main'] and 'Manhattan' in w['main'] and w['cc'] == 'US', (w['main'][:200], w['cc']))
    check('fire weather and which way it would spread, and the satellite hotspots near it', 'would spread north-east' in w['main'] and 'humidity 81%' in w['main'] and w['fires'], w['main'])
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes it all off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    for id in ['S1', 'V1']:
        pg.evaluate(OPEN, id); pg.wait_for_timeout(2500)
        ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.ev *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
        check(f'on a phone the {id} page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
