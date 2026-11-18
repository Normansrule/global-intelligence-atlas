# SPDX-License-Identifier: AGPL-3.0-only
# v2.27 spaceports and mines in depth (sitedetail.js). Everything on these pages comes from the atlas's own data and
# country outlines; the launches are placed by the test, so nothing depends on a feed or the date.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
LAYERS=['spaceports','minerals','mining']
TEXT="() => document.getElementById('notes-body')?.innerText ?? ''"
def open_(pg, layer, find, wait=2000):
    pg.evaluate(f"() => gia.select({{ layer: '{layer}', d: gia.state.data.{layer}.find({find}) }})"); pg.wait_for_timeout(wait); return pg.evaluate(TEXT)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.30')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,-90,2&l=borders,'+','.join(LAYERS), wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function(f"() => {json.dumps(LAYERS + ['borders'])}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(1000)
    check('version 2.30', pg.evaluate("() => gia.VERSION")=='2.30')
    # a spaceport, first with no launch list, then with launches placed at its pads
    pg.evaluate("() => { delete gia.state.data.launches; if (gia.state.on.has('launches')) gia.toggleLayer('launches', false); }")
    t=open_(pg, 'spaceports', "x => /Kennedy/.test(x.name)")
    check('Kennedy: the speed Earth’s spin lends a rocket there', 'm/s' in t and 'free from Earth’s spin' in t and 'Flattest orbit straight up: 28.' in t, t[:500])
    check('Kennedy: the cost of flattening its orbit for geostationary, said to be an upper bound', 'Tilt to remove for geostationary: 1.5 km/s' in t and 'real missions combine it' in t, t[:900])
    check('Kennedy: the directions over open sea and the orbits they reach', 'stays over open sea for the first 900 km' in t and 'Space station · 51.6°' in t and 'straight up' in t and 'approximation of a range-safety corridor' in t, t[:1800])
    check('with no launch list, the page offers to switch launches on', 'Switch on Rocket launches' in t, t[-600:])
    rose=pg.evaluate("() => [document.querySelectorAll('.sx-rose .sx-safe').length, document.querySelectorAll('.sx-rose path').length]")
    check('the compass rose has 72 wedges, some of them over sea', rose[1]==72 and 0 < rose[0] < 72, rose)
    fat=pg.evaluate("async () => { const m = await import('./js/sitedetail.js'); return m.sx.kind + ':' + !!m.sx.fat; }")
    check('the sea-safe fan is drawn on the globe', fat=='pad:true', fat)
    pg.evaluate("""() => { const now = Date.now(); gia.state.data.launches = [
      { id: 'a', name: 'Falcon 9 | Test One', rocket: 'Falcon 9 Block 5', mission: 'Test One', net: now + 864e5, lat: 28.608, lng: -80.604, pad: 'Launch Complex 39A', orbit: 'Low Earth Orbit' },
      { id: 'b', name: 'Atlas V | Test Two', rocket: 'Atlas V 551', mission: 'Test Two', net: now - 864e5, lat: 28.562, lng: -80.577, pad: 'Space Launch Complex 41', orbit: 'Geostationary Transfer Orbit' },
      { id: 'c', name: 'Electron | Far Away', rocket: 'Electron', mission: 'Far Away', net: now + 2 * 864e5, lat: -39.26, lng: 177.86, pad: 'Rocket Lab LC-1A', orbit: 'Sun-Synchronous Orbit' } ]; }""")
    t=open_(pg, 'spaceports', "x => /Kennedy/.test(x.name)")
    check('launches from its pads, nearest in time first, and none from elsewhere', 'Falcon 9 Block 5' in t and 'Atlas V 551' in t and 'Electron' not in t and '1 still to fly in the list, 1 already flown' in t, t[-800:])
    t=open_(pg, 'spaceports', "x => /Vandenberg/.test(x.name)")
    check('Vandenberg reaches polar and Sun-synchronous orbits straight up', 'Polar · 90°' in t and 'Sun-synchronous · 97.8°' in t, t[:1800])
    near=pg.evaluate("() => document.querySelectorAll('#sx-near [data-ix-layer=\"spaceports\"]').length")
    check('other spaceports open from the page', near > 0, near)
    # a mine with an output, its export port and exchanges
    t=open_(pg, 'mining', "x => x.id === 'escondida'")
    check('Escondida: what copper is for and who mines most of it', 'electric wiring' in t and 'Chile mined about 23 %' in t and 'this site is there' in t, t[:700])
    check('Escondida: its output as a share of the world’s', '1.2 million tonnes' in t and '5.5 % of the world’s mine output' in t, t[:1200])
    check('Escondida: the nearest port and the export port for copper', 'the nearest port in the atlas, and it exports copper' in t and 'Coloso Port / Antofagasta' in t and 'Port of Santos' not in t, t[:1600])
    check('Escondida: refined at the copper smelters, priced on the London Metal Exchange', 'Chagres Copper Smelter' in t and 'London Metal Exchange' in t, t[:2200])
    fat=pg.evaluate("async () => { const m = await import('./js/sitedetail.js'); return m.sx.kind + ':' + !!m.sx.fat + ':' + (m.sx.port?.name ?? ''); }")
    check('the line to its export port is drawn on the globe', fat.startswith('mine:true:Coloso'), fat)
    t=open_(pg, 'minerals', "x => /lithium/i.test(x.mineral)")
    check('a critical-mineral mine has the same page (lithium: batteries, Australia)', 'rechargeable batteries' in t and 'Australia mined about 48 %' in t and 'The same mineral elsewhere' in t, t[:900])
    pg.evaluate("() => document.querySelector('#sx-same details, #sx-same') && document.querySelectorAll('details.qd-sec').forEach((d) => d.open = true)")
    pg.evaluate("() => document.querySelector('#sx-same [data-ix-layer]').click()"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('another mine of the same mineral opens its own page', 'rechargeable batteries' in t and 'How much it makes' in t, t[:300])
    t=open_(pg, 'mining', "x => x.kind === 'plant' && /Rand Refinery/.test(x.name)")
    check('a refinery: its throughput against the world’s mine output', '700 tonnes' in t and 'passes through it' in t, t[:1200])
    # What's new has Try buttons for both
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('data-ix-layer=\"spaceports\"') && s.includes('data-ix-id=\"escondida\"'); }")
    check("What's new has Try buttons for a spaceport and a mine", nw)
    hostile=pg.evaluate("""async () => { const d = { id: 'x', name: '<img src=x id=pwn>', operator: '<b id=pwn2>o</b>', mineral: '<i id=pwn3>', country: 'X', lat: 0, lon: 0, significance: '<u id=pwn4>' };
      gia.select({ layer: 'mining', d }); await new Promise((r) => setTimeout(r, 1500)); return !!document.querySelector('#pwn, #pwn2, #pwn3, #pwn4'); }""")
    check('names are escaped', not hostile)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
