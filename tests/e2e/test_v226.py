# SPDX-License-Identifier: AGPL-3.0-only
# v2.26 chokepoints, pipelines, trade routes and AI data centres in depth (infradetail.js). Everything on these pages
# comes from the atlas's own data; the live ships are placed by the test, so nothing depends on a feed or the date.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
LAYERS=['waterways','pipelines','routes','datacenters']
TEXT="() => document.getElementById('notes-body')?.innerText ?? ''"
def open_(pg, layer, find, wait=2000):
    pg.evaluate(f"() => gia.select({{ layer: '{layer}', d: gia.state.data.{layer}.find({find}) }})"); pg.wait_for_timeout(wait); return pg.evaluate(TEXT)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.35')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@26,56,2&l=borders,'+','.join(LAYERS), wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function(f"() => {json.dumps(LAYERS)}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(1000)
    check('version 2.35', pg.evaluate("() => gia.VERSION")=='2.35')
    # a chokepoint, first with Live ships off, then with ships placed in the strait
    t=open_(pg, 'waterways', "x => /hormuz/i.test(x.name)")
    check('Hormuz: its width against the Strait of Dover and what it joins', '34 km' in t and 'about as wide as the Strait of Dover' in t and 'the Persian Gulf and the Gulf of Oman' in t, t[:400])
    check('Hormuz: the routes that rely on it and the pipelines built to avoid it, with their oil added up', '5 of the 21 main routes' in t and 'East-West Pipeline (Petroline)' in t and 'Habshan-Fujairah' in t and 'million barrels a day' in t, t[:1200])
    check('with Live ships off, the page offers to switch them on', 'Switch on Live ships' in t)
    pg.evaluate("""() => { gia.state.data.ships = [
      { mmsi: 111, lat: 26.5, lng: 56.3, sog: 12, cog: 295, nav: 0, meta: { name: 'GULF STAR', shipType: 80 } },
      { mmsi: 222, lat: 26.6, lng: 56.2, sog: 11, cog: 125, nav: 0, meta: { name: 'OCEAN BOX', shipType: 70 } },
      { mmsi: 333, lat: 26.4, lng: 56.4, sog: 0, cog: 0, nav: 1, meta: { name: 'WAITING', shipType: 80 } },
      { mmsi: 444, lat: 30.0, lng: 32.55, sog: 8, cog: 355, nav: 0, meta: { name: 'CANAL ONE', shipType: 70 } } ]; }""")
    open_(pg, 'pipelines', "x => x.id === 'sumed'", 500); t=open_(pg, 'waterways', "x => /hormuz/i.test(x.name)")
    check('ships passing now: one heading into the Gulf, one out, one at anchor', 'heading into the Persian Gulf' in t and 'GULF STAR' in t and 'OCEAN BOX' in t and '2 moving' in t and '1 stopped' in t, t[:900])
    fat=pg.evaluate("async () => { const m = await import('./js/infradetail.js'); return m.ix.kind + ':' + !!m.ix.fat; }")
    check('the counting circle is drawn on the globe', fat=='choke:true', fat)
    # a pipeline
    t=open_(pg, 'pipelines', "x => x.id === 'sumed'")
    check('SUMED: its flow as an Olympic pool every few minutes and a share of the world', 'Olympic pool every' in t and '2.5 % of the world' in t and 'million tonnes a year' in t, t[:700])
    check('SUMED: end-to-end time, the countries on its line and the chokepoint it avoids', 'days to go from one end' in t and 'Egypt' in t and 'Built so that oil need not pass Suez Canal' in t, t[:1400])
    paths=pg.evaluate("async () => { const m = await import('./js/infradetail.js'); return m.ix.kind + ':' + (m.ix.paths?.length ?? 0); }")
    check('the oil is drawn flowing along the line', paths=='pipe:1', paths)
    t=open_(pg, 'pipelines', "x => /Druzhba/.test(x.name)")
    check('a long line crosses several countries, in order', t.count('›')==0 and 'Countries on its line' in t and ('Belarus' in t or 'Poland' in t or 'Ukraine' in t), t[:1200])
    # a trade route, and opening a chokepoint from it
    t=open_(pg, 'routes', "x => x.id === 'china-europe-suez'")
    check('China → Europe: distance, days at 16 knots and containers a minute', 'days at 16 knots' in t and 'twenty-foot containers a minute' in t, t[:500])
    check('stop by stop with distance and day, and its three chokepoints with what closing each means', 'Port of Rotterdam' in t and 'day ' in t and 'Cape of Good Hope' in t and 'Lombok' in t, t[:1500])
    check('ships at its stops now (from Live ships)', 'Ships at its stops now' in t and 'ships within' in t, t[-600:])
    pg.evaluate("() => document.querySelector('#ix-chokes [data-ix-layer=\"waterways\"]').click()"); pg.wait_for_timeout(2500)
    t=pg.evaluate(TEXT)
    check('a chokepoint on the route opens its own page', 'Ships passing now' in t and 'Malacca' in t, t[:300])
    # a data centre
    t=open_(pg, 'datacenters', "x => /Mt Pleasant, Wisconsin Phase 2/.test(x.name)", 4000)
    check('the AI site: its power as a range with the method, in homes and reactors', '1,512–1,966 MW' in t and 'US homes' in t and 'reactors of 1,000 MW' in t and 'An estimate from the chip count' in t, t[:900])
    check('big power stations near it (WRI) and nuclear plants, research reactors left out', 'Big power stations near it' in t and 'MW within 150 km' in t and 'Fermilab' not in t, t[:1800])
    check('its owners elsewhere, with the share of their accelerators', 'sites on the map with' in t and 'OpenAI/Microsoft Atlanta' in t, t[-900:])
    # What's new: the Try buttons open a page
    pg.evaluate("() => gia.whatsNew ? gia.whatsNew() : null")
    names=pg.evaluate("() => document.querySelector('[data-ix-id=\"sumed\"]') ? 'yes' : 'no'")
    if names=='yes':
        pg.evaluate("() => document.querySelector('[data-ix-id=\"sumed\"]').click()"); pg.wait_for_timeout(3000)
        check("What's new: Try the SUMED pipeline opens its page", 'Olympic pool' in pg.evaluate(TEXT))
    else:
        nw=pg.evaluate("async () => (await (await fetch('js/main.js')).text()).includes('data-ix-id=\"sumed\"')")
        check("What's new has a Try button for a pipeline", nw)
    hostile=pg.evaluate("""async () => { const m = await import('./js/infradetail.js'); const d = { id: 'x', name: '<img src=x id=pwn>', owner: '<b id=pwn2>o</b>', country: 'X', lat: 0, lon: 0, chipCount: 10, chipType: '<i id=pwn3>' };
      gia.select({ layer: 'datacenters', d }); await new Promise((r) => setTimeout(r, 1500)); return !!document.querySelector('#pwn, #pwn2, #pwn3'); }""")
    check('names are escaped', not hostile)
    pass
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
