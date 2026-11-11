# SPDX-License-Identifier: AGPL-3.0-only
# The flight view and the ship card in depth: callsign to airline and flight number, the scheduled route and the path
# on the globe, the 3D model of the exact type, search by flight number and airline, the airline filter, a ship's flag,
# type and size, and the scheduled routes out of an airport.
# Run with the recorded real snapshot: MOCK_REAL=1 bash tests/e2e/run.sh test_flights_detail.py
import sys, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
REAL=os.environ.get('MOCK_REAL')=='1'
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22');localStorage.setItem('gia-theme','dark')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@51,-20,1.6&b=bluemarble&l=borders,aircraft,ships', wait_until='commit'); pg.wait_for_timeout(16000)
    # pick a British Airways flight when the snapshot has one, else any airline flight the tables know
    pick=pg.evaluate("""() => { const ac = gia.state.data.aircraft?.ac ?? []; const a = ac.find((a) => /^BAW\\d+$/.test(a.call) && !a.ground) || ac.find((a) => /^[A-Z]{3}\\d+$/.test(a.call) && !a.ground);
      return a && { id: a.id, call: a.call }; }""")
    check('the flights load', pick, pick)
    pg.evaluate("(id) => { const a = gia.state.data.aircraft.ac.find((x) => x.id === id); gia.select({ layer: 'aircraft', d: a }); gia.globe.pointOfView({ lat: a.lat, lng: a.lng, altitude: 1.4 }, 0); }", pick['id']); pg.wait_for_timeout(6000)
    deck=pg.evaluate("() => document.querySelector('.deck')?.innerText ?? ''")
    head=pg.evaluate("() => document.querySelector('.deck .fl-head h3')?.textContent ?? ''")
    if pick['call'].startswith('BAW'):
        check('the callsign decodes to the flight number and airline (BAW to BA, British Airways)', head.startswith('BA ') and 'British Airways' in deck, (head, deck[:200]))
    else:
        check('the callsign decodes to a flight number and airline', head and head != pick['call'], (head, deck[:200]))
    check('the flight view says what the plane is doing (phase of flight)', any(w in deck for w in ['Cruising', 'Climbing', 'Descending', 'approach', 'Taxiing']), deck[:300])
    if REAL: check('it names the scheduled origin and destination with a progress bar', '% of' in deck and ' km' in deck, deck[:400])
    check('it says where the aircraft is registered', 'Registered in' in deck, deck[:600])
    check('it counts the airline’s planes in the air now', 'In the air now' in deck, deck[:800])
    paths=pg.evaluate("() => gia.globe.pathsData().length"); labels=pg.evaluate("() => (gia.state.chan.aircraft?.labels ?? []).map((l) => l.text).filter((t) => / · (from|to)$/.test(t))")
    if REAL: check('the globe draws the route flown, the track and the path ahead, with both airports labelled', paths >= 3 and len(labels) == 2, (paths, labels))
    # the 3D model of the exact type, in the airline's tail colour
    pg.evaluate("(id) => { const a = gia.state.data.aircraft.ac.find((x) => x.id === id); a.type = 'B77W'; gia.select({ layer: 'aircraft', d: a }); }", pick['id']); pg.wait_for_timeout(2500)
    note=pg.evaluate("() => document.querySelector('#deck-3d .pv-note')?.textContent ?? ''")
    check('the flight view shows a 3D model of the exact type, to scale (Boeing 777-300ER: 73.9 m, two engines)', 'Boeing 777-300ER' in note and '73.9 m long' in note and 'two jet engines' in note, note)
    pg.evaluate("(id) => { const a = gia.state.data.aircraft.ac.find((x) => x.id === id); a.type = 'CRJ9'; gia.select({ layer: 'aircraft', d: a }); }", pick['id']); pg.wait_for_timeout(2500)
    note=pg.evaluate("() => document.querySelector('#deck-3d .pv-note')?.textContent ?? ''")
    check('a regional jet gets its engines on the tail and a T-tail', 'CRJ900' in note and 'on the tail' in note and 'T-tail' in note, note)
    # search by flight number, then by airline
    num=head.replace(' ', '')
    pg.fill('#q', num); pg.wait_for_timeout(1200)
    hits=pg.evaluate("() => [...document.querySelectorAll('#results li')].map((li) => li.innerText)")
    check(f'searching “{num}” finds the flight in the air', any('In the air now' in h for h in hits), hits[:4])
    if pick['call'].startswith('BAW'):
        pg.fill('#q', 'British Airways'); pg.wait_for_timeout(1200)
        hits=pg.evaluate("() => [...document.querySelectorAll('#results li')].map((li) => li.innerText)")
        check('searching an airline lists it with its planes in the air now', any('Airline' in h and 'in the air now' in h for h in hits), hits[:4])
    pg.keyboard.press('Escape')
    # the airline filter
    pg.evaluate("() => document.querySelector('[data-airline]')?.click()"); pg.wait_for_timeout(1500)
    f=pg.evaluate("() => gia.flightState.airline")
    check('“Show only” keeps just that airline’s planes', f and pick['call'].startswith(f), f)
    pg.evaluate("() => document.querySelector('[data-airline]')?.click()"); pg.wait_for_timeout(800)
    check('pressing it again shows every airline', pg.evaluate("() => gia.flightState.airline") is None)
    # ships: flag from the Maritime Identification Digits, type from the AIS code, size, canal fit
    sh=pg.evaluate("""() => { const s = gia.state.data.ships ?? []; const a = s.find((x) => x.mmsi === 563000001) ?? s.find((x) => String(x.mmsi).length === 9 && x.meta?.shipType >= 70 && x.meta?.shipType < 90) ?? s[0];
      if (!a) return null; gia.select({ layer: 'ships', d: a }); return a.mmsi; }"""); pg.wait_for_timeout(800)
    card=pg.inner_text('#notes-body') if sh else ''
    check('a ship card names its flag and type', 'Flag' in card and 'Type' in card, card[:300])
    if sh == 563000001:
        check('MMSI 563… is a Singapore ship; 300 × 48 m is Neopanamax', 'Singapore' in card and 'Cargo ship' in card and '300 m long × 48 m wide' in card and 'Neopanamax' in card, card[:500])
    n0=pg.evaluate("() => (gia.state.data.ships ?? []).length")
    pg.evaluate("() => document.querySelector('[data-shipkind]')?.click()"); pg.wait_for_timeout(1500)
    k=pg.evaluate("() => gia.state.chan.ships?.pick?.length ?? null")
    check('“Show only cargo ships” filters the ships layer', k is not None and 0 < k < n0, (k, n0))
    # airports: every scheduled nonstop route out of Heathrow, listed and drawn as one batched line set
    pg.evaluate("() => gia.toggleLayer('airports', true)"); pg.wait_for_timeout(3000)
    pg.evaluate("() => { const a = gia.state.data.airports.find((x) => x.iata === 'LHR'); gia.select({ layer: 'airports', d: a }); }"); pg.wait_for_timeout(3500)
    apt=pg.inner_text('#apt-routes') if pg.query_selector('#apt-routes') else ''
    drawn=pg.evaluate("() => (gia.state.chan.airports?.custom ?? []).length")
    check('an airport card lists its scheduled routes and draws them (one batched line set)', 'nonstop destinations' in apt and 'Busiest routes' in apt and drawn == 1, (apt[:200], drawn))
    check('no page errors', not errs, errs[:5])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
