# SPDX-License-Identifier: AGPL-3.0-only
# One port in depth: a World Port Index harbour's page gives the sea now (waves in words, wind, water, swell), the
# tide over three days with the next high and low water, a cut-away of its depths with which of nine typical ships
# can get in, what limits entry, the cargo it handles and its heaviest lift, the live ships within 20 km, the nearest
# airports and its charts. A World Monitor port borrows the record of the index port nearest it. Closing clears the globe.
# Real records: tests/e2e/fixtures/ports-detail.json (Jurong Island, Keppel and Abadan, read by tools/fetch-open-data.mjs).
import sys, json, time, math, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
HERE=sys.argv[-1]
PORTS=open(os.path.join(HERE,'fixtures','ports-detail.json')).read()
now=time.time(); h0=int(now//3600)*3600-24*3600
T=[time.strftime('%Y-%m-%dT%H:%M', time.gmtime(h0+i*3600)) for i in range(72)]
LEVEL=[round(1.2*math.sin(2*math.pi*(h0+i*3600)/(12.42*3600)),3) for i in range(72)]
MARINE=json.dumps({"latitude":1.25,"longitude":103.75,"utc_offset_seconds":0,"timezone":"GMT",
  "current":{"time":T[24],"wave_height":1.6,"wave_direction":200,"wave_period":7.5,"swell_wave_height":0.9,"swell_wave_direction":210,"swell_wave_period":11,"sea_surface_temperature":29.4,"ocean_current_velocity":1.9,"ocean_current_direction":95},
  "hourly":{"time":T,"sea_level_height_msl":LEVEL}})
def marine(route): return route.fulfill(status=200, body=MARINE, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
def opendata(route):
    u=route.request.url
    if u.endswith('/ports.json'): return route.fulfill(status=200, body=PORTS, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404', headers={'Access-Control-Allow-Origin':'*'})
SEL="(name) => gia.select({ layer: 'ports', d: gia.state.data.ports.find((p) => p.name.startsWith(name)) })"
TXT="""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  return { line: t('#pt-line'), sea: t('#pt-sea'), tide: t('#pt-tide'), fit: t('#pt-fit'), fitSum: t('#pt-fit-sum'), ships: t('#pt-ships'), shipsSum: t('#pt-ships-sum'), inn: t('#pt-in'), inSum: t('#pt-in-sum'),
    cargo: t('#pt-cargo'), near: t('#pt-near'), chart: t('#pt-chart'), cc: n.querySelector('#pt-line [data-country-cc]')?.dataset.countryCc,
    cols: n.querySelectorAll('svg.pt-depth .pt-col').length, hull: !!n.querySelector('svg.pt-depth .pt-hull'), turns: n.querySelectorAll('svg.pt-tide .pt-turn').length,
    verdicts: [...n.querySelectorAll('.pt-ship')].map((b) => [b.dataset.ptShip, b.querySelector('.ld-chip').textContent]), on: n.querySelector('.pt-ship.on')?.dataset.ptShip,
    lift: n.querySelectorAll('.pt-lift span.on').length, units: n.querySelectorAll('.pt-units .pt-u').length, mmsi: [...n.querySelectorAll('[data-mmsi]')].map((b) => b.dataset.mmsi), wave: !!n.querySelector('.pt-wave') } }"""
CUSTOM="() => (gia.state.chan.ports?.custom ?? []).map((c) => (c.segs?.length ?? 0) / 5)"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://marine-api.open-meteo.com/**', marine); pg.route('https://raw.githubusercontent.com/**/open-data/**', opendata)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.14')}catch(e){}")
    pg.goto('http://localhost:8765/app/?datasets=open#@1.3,103.8,0.4&l=borders,ports,ships,cities&s=1', wait_until='commit'); pg.wait_for_timeout(12000)
    f=pg.evaluate("""async () => { const m = await import('./js/portdetail.js'); const r = { channelDepthM: 14, cargoPierDepthM: 12, oilTerminalDepthM: 17, tideM: 2, anchorageDepthM: 20, yn: '' };
      const v = (id) => m.shipVerdict(r, m.REF_SHIPS.find((s) => s.id === id)).ok;
      const T = Array.from({ length: 30 }, (_, i) => i * 3600e3); const L = T.map((t) => Math.sin(2 * Math.PI * t / (12 * 3600e3)));
      return { states: [0, 0.05, 0.3, 1, 2, 3, 5, 7, 12, 15].map((x) => m.seaState(x).code), bf: [0, 10, 40, 80, 130].map((x) => m.beaufort(x).force),
        v: ['fishing', 'panamax', 'neopanamax', 'capesize', 'vlcc'].map(v), turns: m.tideTurns(T, L).map((x) => [x.high, Math.round(x.t / 36e5 * 10) / 10]),
        long: m.shipVerdict({ ...r, maxVesselLengthM: 300 }, m.REF_SHIPS.find((s) => s.id === 'ulcv')).why, none: m.shipVerdict({ yn: '' }, m.REF_SHIPS[0]).ok } }""")
    check('sea states on the WMO scale from the wave height', f['states'] == [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], f['states'])
    check('Beaufort force from the wind in km/h', f['bf'] == [0, 2, 6, 9, 12], f['bf'])
    check('which ships fit: at any tide, anchoring off when the berth is shallow, or too deep', f['v'] == ['yes', 'yes', 'anchor', 'no', 'no'], f['v'])
    check('a ship over the length limit is refused for that reason, and no depths means unknown', 'longer than the 300 m limit' in f['long'] and f['none'] == '?', (f['long'], f['none']))
    check('tide turns found and placed between the hours', f['turns'][:3] == [[True, 3.0], [False, 9.0], [True, 15.0]], f['turns'][:4])
    # Jurong Island, Singapore: a large harbour from the World Port Index
    pg.evaluate(SEL, 'Jurong'); pg.wait_for_timeout(3500)
    s=pg.evaluate(TXT)
    check('the line: large harbour in Singapore, the time there and the water it opens on', s['cc'] == 'SG' and 'Large' in s['line'] and 'there now' in s['line'] and 'Strait of Malacca' in s['line'], s['line'])
    check('the sea now: 1.6 m, a moderate sea, with wind, water temperature, swell and current', '1.6 m' in s['sea'] and 'Moderate sea' in s['sea'] and '29.4°C' in s['sea'] and '0.9 m' in s['sea'] and '1 kn' in s['sea'] and 'Gentle breeze' in s['sea'] and s['wave'], s['sea'])
    check('the tide over three days with the turns marked and the next high and low water', s['turns'] >= 9 and 'High water' in s['tide'] and 'Low water' in s['tide'] and 'not for navigation' in s['tide'], (s['turns'], s['tide'][:200]))
    check('the depths drawn as columns (channel, anchorage, cargo pier, oil terminal) with a ship hull', s['cols'] == 4 and s['hull'] and '14 m' in s['fit'] and '17 m' in s['fit'], (s['cols'], s['fit'][:200]))
    vd=dict(s['verdicts'])
    check('nine typical ships judged from the 14 m channel: a Panamax fits, a Neopanamax cannot, no gas terminal recorded', len(vd) == 9 and vd['panamax'] == 'fits' and vd['neopanamax'] == 'cannot' and vd['vlcc'] == 'cannot' and vd['lng'] == 'unknown', vd)
    check('the biggest ship that fits is shown by default, and the count is in the heading', s['on'] == 'panamax' and '4 of 9 fit at any tide' in s['fitSum'], (s['on'], s['fitSum']))
    pg.click('[data-pt-ship="vlcc"]'); pg.wait_for_timeout(300)
    t=pg.evaluate(TXT)
    check('choosing another ship redraws its hull and draught', t['on'] == 'vlcc' and 'draws 22.5 m' in t['fit'], (t['on'], t['fit'][:120]))
    check('getting in: good shelter, pilot compulsory, a turning basin and other entry limits', 'Good' in s['inn'] and 'Pilot compulsory' in s['inn'] and 'Turning basin' in s['inn'] and 'pilot compulsory' in s['inSum'], (s['inn'][:300], s['inSum']))
    check('what it handles: lifts of 100 t and more, major repairs, a large dry dock, floating cranes, fuel', s['lift'] == 3 and 'Major' in s['cargo'] and 'Large' in s['cargo'] and 'Floating cranes' in s['cargo'] and 'Fuel oil' in s['cargo'], (s['lift'], s['cargo'][:300]))
    check('ships here now: counted within 20 km, moored, at anchor or moving, the biggest named', s['units'] > 0 and 'moored' in s['ships'] and 'at anchor' in s['ships'] and 'within 20 km' in s['shipsSum'] and '563000001' in s['mmsi'], (s['units'], s['ships'][:200], s['mmsi'][:3]))
    check('the deepest ship against the channel', 'MOCK STAR' in s['ships'] and 'drawing 12.5 m against a 14 m channel' in s['ships'], s['ships'][:400])
    check('getting there: the city, the airport and the other harbours near', 'Singapore' in s['near'] and 'SIN' in s['near'] and 'Keppel' in s['near'], s['near'][:300])
    check('charts: the Sailing Directions volume, chart and NAVAREA XI', 'Pub. 174' in s['chart'] and '71253' in s['chart'] and 'XI' in s['chart'] and 'SG JUR' in s['chart'], s['chart'][:300])
    c=pg.evaluate(CUSTOM)
    check('on the globe: the 20 km and 100 km circles in one draw call', len(c) == 1 and c[0] == 2 * 120, c)
    pg.click('[data-mmsi="563000001"]'); pg.wait_for_timeout(1500)
    sel=pg.evaluate("() => [gia.state.selected?.layer, gia.state.selected?.d?.mmsi]")
    check('a ship in port opens its own card, and the port circles go', sel == ['ships', 563000001] and pg.evaluate(CUSTOM) == [], (sel, pg.evaluate(CUSTOM)))
    # Abadan, Iran: a river harbour with tide limits
    pg.evaluate(SEL, 'Abadan'); pg.wait_for_timeout(3000)
    a=pg.evaluate(TXT)
    check('a river harbour, 9 m deep: tide limits entry, a car ferry fits, the biggest cruise ship needs the tide', 'Tide limits entry' in a['inn'] and dict(a['verdicts'])['ferry'] == 'fits' and dict(a['verdicts'])['cruise'] == 'high tide' and dict(a['verdicts'])['panamax'] == 'cannot', (a['inn'][:200], a['verdicts']))
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(800)
    check('closing the page takes the circles off the globe', pg.evaluate(CUSTOM) == [], pg.evaluate(CUSTOM))
    # a World Monitor port borrows the nearest index record
    pg.goto('http://localhost:8765/app/?datasets=worldmonitor#@1.3,103.8,0.4&l=borders,ports,cities&s=1', wait_until='commit'); pg.wait_for_timeout(10000)
    pg.evaluate(SEL, 'Port of Singapore'); pg.wait_for_timeout(3500)
    w=pg.evaluate(TXT)
    check('World Monitor’s Port of Singapore borrows the nearest index record (Keppel)', 'Keppel' in w['line'] and w['cols'] >= 3 and 'Switch on Live ships' in w['ships'], (w['line'], w['cols'], w['ships'][:80]))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(SEL, 'Port of Singapore'); pg.wait_for_timeout(2500)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.pt *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the port page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
