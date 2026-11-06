# SPDX-License-Identifier: AGPL-3.0-only
# What a ship looks like: the kind of ship is read from its broadcast type, its size and its name, built in 3D at its
# real size with its cargo (container stacks, hatch covers, gas domes...), and said in words with what it carries.
# A ship's card shows its model; a port page shows the reference ship you pick in 3D and a side-on picture of every
# ship in its lists.
import sys, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
PORTS=open(os.path.join(sys.argv[-1],'fixtures','ports-detail.json')).read()
def opendata(route):
    if route.request.url.endswith('/ports.json'): return route.fulfill(status=200, body=PORTS, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404', headers={'Access-Control-Allow-Origin':'*'})
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://raw.githubusercontent.com/**/open-data/**', opendata)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.14')}catch(e){}")
    pg.goto('http://localhost:8765/app/?datasets=open#@1.3,103.7,0.5&l=borders,ports,ships&s=1', wait_until='commit'); pg.wait_for_timeout(12000)
    f=pg.evaluate("""async () => { const m = await import('./js/shipview.js'); const k = (name, shipType, length) => m.shipClass({ name, shipType, length }).id;
      return { kinds: [k('MAERSK EINDHOVEN', 71, 366), k('MSC GULSUN', 70, 400), k('AL KHUWAIR', 84, 315), k('ARCTIC PRINCESS LNG', 84, 288), k('GLOVIS CROWN', 70, 200), k('CAPE OCEAN', 70, 292), k('NONAME', 70, 229), k('NONAME', 70, 110), k('SYMPHONY OF THE SEAS', 60, 362), k('STENA', 60, 180), k('X', 30, 30), k('X', 52, 28), k('X', 36, 12)],
        how: [m.shipClass({ name: 'NONAME', shipType: 70, length: 229 }).how, m.shipClass({ name: 'MAERSK X', shipType: 70 }).how],
        dims: m.shipDims('container', { length: 366, width: 49, draught: 152 }), teu: m.cargoWords('container', { L: 366, B: 49, T: 15.2 }), vlcc: m.cargoWords('tanker', { L: 330, B: 60, T: 22.5 }),
        built: Object.keys(m.SHIP_CLASSES).map((c) => { const s = m.buildShip(c, m.shipDims(c, {}), 3); const n = s.geometry.attributes.position.count; const ok = n > 30 && s.geometry.attributes.color.count === n && s.top > s.F; s.geometry.dispose(); return ok ? c : '!' + c; }) } }""")
    check('the kind of ship from its type, size and name', f['kinds'] == ['container','container','tanker','gas','car','bulk','bulk','general','cruise','ferry','fishing','tug','sail'], f['kinds'])
    check('it says how it knows', 'best guess' in f['how'][0] and f['how'][1] == 'its name', f['how'])
    check('its real size from AIS (draught in decimetres)', f['dims']['L'] == 366 and f['dims']['B'] == 49 and abs(f['dims']['T'] - 15.2) < 0.01 and f['dims']['real'], f['dims'])
    check('what it carries: a Neopanamax holds about 13,000 to 15,000 containers, a very large crude carrier about 2 million barrels', any(f"About {n:,} containers" in f['teu'] for n in range(13000, 15100, 100)) and 'million' not in f['teu'] and ('2,100,000 barrels' in f['vlcc'] or '2,000,000 barrels' in f['vlcc'] or '2,200,000 barrels' in f['vlcc']), (f['teu'], f['vlcc']))
    check('every kind builds as one coloured geometry', all(not c.startswith('!') for c in f['built']), f['built'])
    mmsi=pg.evaluate("() => { const s = gia.state.data.ships.find((x) => x.meta?.shipType >= 70 && x.meta?.shipType < 80); s.meta.name = 'EVER TEST'; return s.mmsi }")
    pg.evaluate("(m) => gia.select({ layer: 'ships', d: gia.state.data.ships.find((x) => x.mmsi === m) })", mmsi); pg.wait_for_timeout(2500)
    s=pg.evaluate("() => { const h = document.getElementById('ship-3d'); const c = h?.querySelector('canvas'); return { canvas: !!c && c.width > 100, note: h?.querySelector('.sv-note')?.textContent ?? '' } }")
    check('a ship’s card shows its model and says what it is and carries', s['canvas'] and 'Container ship (from its name)' in s['note'] and 'containers when full' in s['note'] and '1.8 m person' in s['note'], s)
    pg.evaluate("() => gia.select({ layer: 'ports', d: gia.state.data.ports.find((p) => /Jurong/.test(p.name)) })"); pg.wait_for_timeout(9000)
    s=pg.evaluate("() => { const h = document.getElementById('pt-3d'); return { canvas: !!h?.querySelector('canvas'), note: h?.querySelector('.sv-note')?.textContent ?? '', imgs: document.querySelectorAll('#pt-fit img.sv-thumb').length } }")
    check('the port page: the chosen reference ship in 3D and a picture of each of the nine', s['canvas'] and s['imgs'] == 9 and 'drawn to scale' in s['note'], s)
    pg.evaluate("() => document.querySelector('[data-pt-ship=\"vlcc\"]').click()"); pg.wait_for_timeout(1500)
    s=pg.evaluate("() => document.querySelector('#pt-3d .sv-note')?.textContent ?? ''")
    check('picking another ship shows it', s.startswith('Very large crude carrier') and '330 m long' in s and 'barrels' in s, s[:200])
    pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(500)
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate("(m) => gia.select({ layer: 'ships', d: gia.state.data.ships.find((x) => x.mmsi === m) })", mmsi); pg.wait_for_timeout(2000)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('#ship-3d *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className)).slice(0, 5) }")
    check('on a phone the ship model fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
