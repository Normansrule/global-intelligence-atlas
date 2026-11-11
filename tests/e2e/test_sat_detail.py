# SPDX-License-Identifier: AGPL-3.0-only
# One satellite in depth: the ISS page says what it is and who owns it (from the satellite catalogue), its live
# speed and height and whether it is in sunlight, its orbit to scale with the sunrises it sees a day, the countries
# and seas it flies over next, the people inside its horizon and its life so far; a GPS satellite's page reads as
# navigation in medium Earth orbit. On the globe: footprint, a line to the ground and the next orbit in one draw
# call, gone when the page closes. When the catalogue does not answer, the launch year comes from the elements.
import sys, json, time; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
ISS=[{"OBJECT_NAME":"ISS (ZARYA)","OBJECT_ID":"1998-067A","NORAD_CAT_ID":25544,"OBJECT_TYPE":"PAY","OPS_STATUS_CODE":"+","OWNER":"ISS","LAUNCH_DATE":"1998-11-20","LAUNCH_SITE":"TYMSC","DECAY_DATE":None,"PERIOD":92.9,"INCLINATION":51.64,"APOGEE":422,"PERIGEE":417,"RCS":399.05}]
GPS='GPS BIIF-12 (PRN 32)\n1 41328U 16007A   26271.50000000 -.00000060  00000-0  00000-0 0  9992\n2 41328  55.2000 120.0000 0080000 230.0000 130.0000  2.00560000 76008\n'
def gps(route): return route.fulfill(status=200, body=GPS, headers={'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'})
def satcat(route):
    if 'CATNR=25544' in route.request.url: return route.fulfill(status=200, body=json.dumps(ISS), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='[]', headers={'Access-Control-Allow-Origin':'*'})
OPEN="""(re) => { const L = gia.state.selected; const g = (id) => gia.state.chan[id]?.pick ?? [];
  const pts = [...(gia.state.chan.stations?.points ?? []), ...(gia.state.chan.stations?.labels ?? []), ...g('satellites')].filter((p) => p.ref && new RegExp(re).test(p.ref.d.name));
  if (!pts.length) return false; gia.select(pts[0].ref); return pts[0].ref.d.name }"""
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { line: t('#sd-line'), head: t('#sd-head'), now: t('#sd-now'), orbit: t('#sd-orbit'), next: t('#sd-next'), see: t('#sd-see'), rec: t('#sd-rec'),
    svg: n.querySelectorAll('svg.sd-orbit ellipse.sd-path').length, ladder: !!n.querySelector('svg.sd-ladder .sd-me'), items: n.querySelectorAll('.sd-next li').length,
    btns: n.querySelectorAll('.sd-next [data-country-cc]').length } }"""
CUSTOM="(id) => (gia.state.chan[id]?.custom ?? []).map((c) => c.segs?.length ?? 0)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://celestrak.org/satcat/**', satcat); pg.route('https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops*', gps)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.21')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@20,0,3.2&l=borders,stations,satellites', wait_until='commit'); pg.wait_for_timeout(12000); pg.evaluate("() => gia.toggleLayer('satellites', true)"); pg.wait_for_timeout(5000)
    f=pg.evaluate("""async () => { const m = await import('./js/satdetail.js');
      return { p: [m.purposeOf('ISS (ZARYA)').word, m.purposeOf('STARLINK-1007').word, m.purposeOf('NAVSTAR 81 (USA 319)').word, m.purposeOf('NOAA 19').word, m.purposeOf('SL-16 R/B').word, m.purposeOf('FOO 1', 'Geostationary').word],
        wiki: m.purposeOf('HST').wiki, l: m.launchFromTle('1 25544U 98067A   26271.5'), l2: m.launchFromTle('1 59001U 24123BC  26271.5'),
        fp: m.footprint(420), geo: m.footprint(35786), rcs: [m.rcsWords(0.05), m.rcsWords(5), m.rcsWords(399)] } }""")
    check('what each one is for, from its name or group', f['p'] == ['Crewed space station', 'Internet from space', 'Satellite navigation (GPS)', 'Weather and climate', 'Spent rocket stage', 'Communications'] and f['wiki'] == 'Hubble Space Telescope', f['p'])
    check('launch year, number and piece from the elements', f['l'] == {'year': 1998, 'num': 67, 'piece': 'A', 'id': '1998-067A'} and f['l2']['id'] == '2024-123BC', (f['l'], f['l2']))
    check('horizon footprint: about 2,250 km from the ISS, 42% of Earth from geostationary', 2200 < f['fp']['km'] < 2320 and 0.41 < f['geo']['frac'] < 0.43, (f['fp'], f['geo']))
    check('radar size in words', 'phone' in f['rcs'][0] and 'car' in f['rcs'][1] and 'house' in f['rcs'][2], f['rcs'])
    nm=pg.evaluate(OPEN, r'^ISS \(ZARYA\)'); pg.wait_for_timeout(3500)
    s=pg.evaluate(TXT)
    check('the ISS page opens with what it is', nm and 'Crewed space station' in s['head'], (nm, s['head']))
    check('the top line: launched 20 November 1998 from Baikonur, owned by the station partners, years in space', '20 November 1998' in s['line'] and 'Baikonur' in s['line'] and 'International Space Station partners' in s['line'] and 'years in space' in s['line'], s['line'])
    check('live: speed in km/h with Paris to New York, height, what is under it and sun or shade', 'km/h' in s['now'] and ('Paris to New York in 12 minutes' in s['now'] or 'Paris to New York in 13 minutes' in s['now']) and 'Height' in s['now'] and 'Over' in s['now'] and ('in sunlight' in s['now'] or "Earth's shadow" in s['now']), s['now'])
    check('its orbit to scale and its height on the ladder', s['svg'] == 1 and s['ladder'] and 'Low Earth orbit' in s['orbit'] and '51.6°' in s['orbit'], s['orbit'][:200])
    check('sun and shade: share of the orbit sunlit and about 16 sunrises a day', 'of each orbit in sunlight' in s['orbit'] and any(f'{n} sunrises a day' in s['orbit'] for n in (15, 16)), s['orbit'][-200:])
    check('where next: the countries and seas of the next orbit with minutes, countries as buttons', s['items'] >= 4 and 'in ' in s['next'] and ' min' in s['next'] and 'Earth turns about 23°' in s['next'], (s['items'], s['next'][:240]))
    check('what it can see: its horizon and the people in the cities inside it', '2,2' in s['see'] and 'km away in every direction' in s['see'], s['see'][:220])
    check('its record: designator, kind, status, radar size and life so far', '1998-067A' in s['rec'] and 'Payload' in s['rec'] and 'working' in s['rec'] and 'bigger than a house' in s['rec'] and 'times the distance to the Sun' in s['rec'], s['rec'][:300])
    c=pg.evaluate(CUSTOM, 'stations')
    check('on the globe: footprint, the line down and the next orbit, in one draw call', len(c) == 1 and c[0] > 160, c)
    t1=pg.evaluate("() => document.querySelector('#sd-now')?.textContent"); pg.wait_for_timeout(4500); t2=pg.evaluate("() => document.querySelector('#sd-now')?.textContent")
    check('the live box keeps ticking', t1 != t2, (t1, t2))
    # a GPS satellite
    nm=pg.evaluate(OPEN, r'NAVSTAR|GPS'); pg.wait_for_timeout(3500)
    g=pg.evaluate(TXT)
    check('a GPS satellite: navigation in medium Earth orbit, about 12 hours a lap', nm and 'navigation' in g['head'].lower() and 'Medium Earth orbit' in g['orbit'] and 'hours' in g['orbit'], (nm, g['head'], g['orbit'][:160]))
    check('without the catalogue the launch year comes from its own elements', 'Launched' in g['line'] and 'own orbital elements' in g['rec'], (g['line'], g['rec'][-200:]))
    check('opening another satellite moves the drawing to it', pg.evaluate(CUSTOM, 'stations') == [] and len(pg.evaluate(CUSTOM, 'satellites')) == 1, (pg.evaluate(CUSTOM, 'stations'), pg.evaluate(CUSTOM, 'satellites')))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(3500)
    check('closing the page takes it off the globe', pg.evaluate(CUSTOM, 'satellites') == [], pg.evaluate(CUSTOM, 'satellites'))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, r'^ISS \(ZARYA\)'); pg.wait_for_timeout(3000)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.sd *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the satellite page fits its panel', ov == [], ov)
    pg.screenshot(path='/tmp/sd-phone.png')
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
