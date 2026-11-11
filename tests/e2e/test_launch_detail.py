# SPDX-License-Identifier: AGPL-3.0-only
# One rocket launch in depth: a launch pad's page gives a live countdown, the weather at the pad for the launch hour,
# the flight plan step by step (ticked off live during the flight), the heading it leaves on from the pad latitude
# and orbit tilt, where the booster lands, the crew, the rocket to scale with its record and the pad's own count.
# The globe draws its climb, first orbit, landing spot and a 300 km circle; during the flight a ring marks the rocket.
# Uses three real Launch Library 2 records (fixtures/launches-detail.json) moved to times around now.
import sys, json, time, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
now=time.time()
def iso(s): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now+s))
LL=json.load(open(os.path.join(sys.argv[-1], 'fixtures', 'launches-detail.json')))
SHIFT=[2*3600+600, -200, 30*3600]  # Starlink from Vandenberg in 2 h 10 min, Crew-13 flying for 200 s, Long March 2C tomorrow
for l, s in zip(LL['results'], SHIFT):
    l['net']=iso(s); l['window_start']=iso(s); l['window_end']=iso(s+(0 if s < 0 else 960)); l['webcast_live']=s < 0
    if s < 0: l['status']={"id":6,"name":"Launch in Flight","abbrev":"In Flight","description":"The launch vehicle has lifted off."}
LLB=json.dumps(LL)
def ll2(route): return route.fulfill(status=200, body=LLB, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
def meteo(route):
    t0=int(now//3600)*3600
    times=[time.strftime('%Y-%m-%dT%H:00', time.gmtime(t0+i*3600)) for i in range(-2, 48)]
    n=len(times)
    body={"latitude":34.6,"longitude":-120.6,"timezone":"GMT","hourly":{"time":times,"temperature_2m":[16.0]*n,"precipitation_probability":[10]*n,"cloud_cover":[95]*n,
      "wind_speed_10m":[22.0]*n,"wind_gusts_10m":[31.0]*n,"wind_direction_10m":[300]*n,"wind_speed_250hPa":[190.0]*n,"weather_code":[3]*n}}
    return route.fulfill(status=200, body=json.dumps(body), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
OPEN="(n) => gia.select({ layer: 'launches', d: gia.state.data.launches.find((l) => l.name.includes(n)) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { line: t('#ld-line'), count: t('#ld-count'), when: t('#ld-when'), wx: t('#ld-wx'), plan: t('#ld-plan'), where: t('#ld-where'), crew: t('#ld-crew'), rocket: t('#ld-rocket'),
    boost: t('#ld-boost'), mission: t('#ld-mission'), pad: t('#ld-pad'), crewShown: !n.querySelector('#ld-crew-sec')?.hidden, boostShown: !n.querySelector('#ld-boost-sec')?.hidden,
    steps: n.querySelectorAll('.ld-plan li').length, done: n.querySelectorAll('.ld-plan li.done').length, next: n.querySelector('.ld-plan li.next b')?.textContent ?? '',
    faces: n.querySelectorAll('.ld-crew li').length, pips: n.querySelectorAll('.ld-pips i').length, bad: n.querySelectorAll('.ld-pips i.bad').length,
    svg: !!n.querySelector('svg.ld-scale .ld-me'), cc: n.querySelector('#ld-line [data-country-cc]')?.dataset.countryCc } }"""
CUSTOM="() => (gia.state.chan.launches.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://ll.thespacedevs.com/**', ll2); pg.route('https://api.open-meteo.com/v1/forecast**', meteo)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,-100,2.4&l=borders,launches,cities&s=1', wait_until='commit'); pg.wait_for_timeout(12000)
    f=pg.evaluate("""async () => { const m = await import('./js/launchdetail.js');
      const o = (name, orbit, ab, lat, lng, cc) => m.targetOrbit({ name, mission: name, orbit, orbitAbbrev: ab }, lat, lng, cc);
      const iss = o('Crew-13', 'Low Earth Orbit', 'LEO', 28.6, -80.6, 'USA'); const sl = o('Starlink Group 15-21', 'Low Earth Orbit', 'LEO', 34.63, -120.61, 'USA');
      const sso = o('Sentinel', 'Sun-Synchronous Orbit', 'SSO', 34.63, -120.61, 'USA'); const gto = o('Comsat', 'Geostationary Transfer Orbit', 'GTO', 28.5, -80.6, 'USA'); const kou = o('Metop', 'Sun-Synchronous Orbit', 'SSO', 5.24, -52.77, 'GUF');
      const az = (x, lat) => Math.round(m.launchAzimuth(lat, x.inc, x.south).az);
      return { iso: [m.isoSeconds('-PT38M'), m.isoSeconds('PT1H1M55S'), m.isoSeconds('P158DT21H53M'), m.isoSeconds('P0D'), m.isoSeconds('soon')],
        clk: [m.tClock(-2280), m.tClock(3715), m.tClock(68)], words: ['MECO', 'SECO-2', 'Max-Q', 'Stage 1 LOX Load', 'Stage 1 Landing'].map(m.stepWords),
        inc: [iss.inc, sl.inc, sso.inc, gto.inc], az: [az(iss, 28.6), az(sl, 34.63), az(sso, 34.63), az(gto, 28.5), az(kou, 5.24)], low: m.launchAzimuth(45, 30).direct,
        spin: [Math.round(m.spinBoost(0)), Math.round(m.spinBoost(28.5))], ins: m.pathAt(0, 0, 90, 520).map((x) => Math.round(x * 10) / 10),
        light: [m.launchLight(0, 0, Date.UTC(2026, 2, 20, 12)).key, m.launchLight(0, 0, Date.UTC(2026, 2, 20, 18, 40)).key, m.launchLight(0, 0, Date.UTC(2026, 2, 20, 0)).key],
        watch: m.wxWatch({ rain: 60, cloud: 50, gust: 70, wind: 30, jet: 200, code: 3 }).length, calm: m.wxWatch({ rain: 5, cloud: 20, gust: 20, wind: 10, jet: 80, code: 1 }).length } }""")
    check('ISO 8601 durations from the timeline in seconds (negative before lift-off)', f['iso'] == [-2280, 3715, 158*86400+21*3600+53*60, 0, None], f['iso'])
    check('T− and T+ clocks', f['clk'] == ['T− 38:00', 'T+ 1:01:55', 'T+ 1:08'], f['clk'])
    check('flight-plan steps written out with the abbreviation in brackets', f['words'] == ['Main engine cut-off (MECO)', 'Second engine cut-off 2 (SECO-2)', 'Maximum aerodynamic pressure (Max-Q)', 'Stage 1 liquid oxygen (LOX) loading', 'Booster lands'], f['words'])
    check('orbit tilts: the space station, a Starlink shell, sun-synchronous, due east for GTO', f['inc'] == [51.64, 70, 97.6, 28.5], f['inc'])
    check('headings: north-east to the ISS, south from Vandenberg, due east to GTO, north from Kourou to sun-synchronous', f['az'][0] == 45 and 150 <= f['az'][1] <= 160 and 185 <= f['az'][2] <= 200 and f['az'][3] == 90 and 340 <= f['az'][4] <= 352, f['az'])
    check('a tilt lower than the pad latitude cannot be reached directly', f['low'] is False, f['low'])
    check("Earth's spin: 465 m/s at the equator, 409 m/s at Cape Canaveral", f['spin'] == [465, 409], f['spin'])
    check('the modelled climb reaches orbit about 1,700 km downrange (15.3°) while the Earth turns 2.2° under it', 13 < f['ins'][1] < 13.3 and abs(f['ins'][0]) < 0.1, f['ins'])
    check('daylight, twilight and night launches', f['light'] == ['day', 'twilight', 'night'], f['light'])
    check('weather that holds a launch: rain, gusts and the jet stream; none on a calm day', f['watch'] == 3 and f['calm'] == 0, (f['watch'], f['calm']))
    # Starlink from Vandenberg in two hours
    pg.evaluate(OPEN, '15-21'); pg.wait_for_timeout(3500)
    s=pg.evaluate(TXT)
    check('top line: the pad, the country and the world count', 'Space Launch Complex 4E' in s['line'] and s['cc'] == 'US' and 'United States' in s['line'] and 'orbital launch attempt' in s['line'], s['line'])
    check('a live countdown and the status', 'T− 2 h' in s['count'] and 'To Be Determined' in s['count'] and 'accurate to the month' in s['count'], s['count'])
    check('when: your time, the time at the pad and day or night', 'Your time' in s['when'] and 'At the pad' in s['when'] and 'launch' in s['when'], s['when'])
    check('weather at lift-off with the jet stream and the thick cloud flagged', 'Weather at lift-off' in s['wx'] and '190 km/h' in s['wx'] and 'jet stream' in s['wx'] and 'thick cloud' in s['wx'], s['wx'][:300])
    check('the flight plan: 23 steps, none done yet, propellant loading next', s['steps'] == 23 and s['done'] == 0 and 'propellant' in s['next'].lower(), (s['steps'], s['done'], s['next']))
    check('where it goes: the heading south-south-east for the 70° shell, over the Pacific', 'south-south-east' in s['where'] and 'Starlink group 15' in s['where'] and 'Pacific Ocean' in s['where'], s['where'][:400])
    check('the booster lands on the drone ship, downrange, at its landing time', 'Of Course I Still Love You' in s['where'] and 'km downrange' in s['where'] and 'T+ 8:21' in s['where'], s['where'][-260:])
    check('the rocket to scale and its numbers', s['svg'] and '70 m' in s['rocket'] and '22,800 kg' in s['rocket'] and 'jumbo jets' in s['rocket'] and 'to 1' in s['rocket'], s['rocket'][:300])
    check('every launch it has flown as squares, one per launch or grouped', s['pips'] > 50 and 'launches succeeded' in s['rocket'], (s['pips'], s['rocket'][:200]))
    check('a booster not yet assigned says so, with its landing', s['boostShown'] and 'not yet named' in s['boost'] and 'Of Course I Still Love You' in s['boost'], s['boost'][:300])
    check('the pad: its launch count and the people within 300 km', 'launch from this pad' in s['pad'] and 'within 300 km' in s['pad'], s['pad'][:300])
    c=pg.evaluate(CUSTOM)
    check('on the globe: circle, climb, first orbit and landing mark in one draw call', len(c) == 1 and c[0] > 300, c); before=c[0] if c else 0
    # Crew-13, 200 s into its flight
    pg.evaluate(OPEN, 'Crew-13'); pg.wait_for_timeout(3500)
    k=pg.evaluate(TXT)
    check('the crew: four people with role, agency and age', k['crewShown'] and k['faces'] == 4 and 'Jessica Watkins' in k['crew'] and 'Commander' in k['crew'] and 'years old' in k['crew'], k['crew'][:300])
    check('the spacecraft and where it is going', 'Crew Dragon' in k['crew'] and 'International Space Station' in k['crew'], k['crew'][:200])
    check('in flight: the steps done so far are ticked and the next is marked', k['done'] >= 10 and k['next'] != '', (k['done'], k['next']))
    check('heading north-east for the space station\'s 51.6° orbit', 'north-east' in k['where'] and 'International Space Station' in k['where'], k['where'][:300])
    c=pg.evaluate(CUSTOM)
    check('in flight the globe also marks where the rocket should be (more lines than before lift-off)', len(c) == 1 and c[0] > before, (c, before))
    check('the booster: serial, its 3rd flight, days since the last, flying back to the landing zone', 'B1101' in k['boost'] and '3rd flight' in k['boost'] and '230 days since its last flight' in k['boost'] and 'lands near the pad' in k['where'] and 'Landing Zone 40' in k['where'], (k['boost'][:300], k['where'][-200:]))
    # Long March 2C from inland China, tomorrow
    pg.evaluate(OPEN, 'Long March 2C'); pg.wait_for_timeout(3500)
    m2=pg.evaluate(TXT)
    check('an inland pad: due east, and spent stages fall on land', '90°' in m2['where'] and 'inland' in m2['where'] and m2['cc'] == 'CN', (m2['where'][:400], m2['cc']))
    check('no timeline published, no crew, no booster', 'not published' in m2['plan'] and not m2['crewShown'] and not m2['boostShown'], (m2['plan'], m2['crewShown'], m2['boostShown']))
    check('one failure among its launches shows as a red square', m2['bad'] == 1 and '65 of 66' in m2['rocket'], (m2['bad'], m2['rocket'][:200]))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes it off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    pg.evaluate(OPEN, '15-21'); pg.wait_for_timeout(2500)
    pg.screenshot(path='/tmp/claude-0/ld-desk.png')
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    for n in ['15-21', 'Crew-13']:
        pg.evaluate(OPEN, n); pg.wait_for_timeout(2500)
        ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.ld *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
        check(f'on a phone the {n} page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
