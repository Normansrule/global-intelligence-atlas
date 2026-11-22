# SPDX-License-Identifier: AGPL-3.0-only
# v2.29 markets, cloud regions and AI labs in depth (econdetail.js). Whether an exchange is open depends on the clock,
# so these checks only ask that the page says one way or the other; tests/econ/test-econ.mjs pins the hours to dates.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
LAYERS=['economic','finance','cloud','ailabs']
TEXT="() => document.getElementById('notes-body')?.innerText ?? ''"
def open_(pg, layer, find, wait=3000):
    pg.evaluate(f"() => gia.select({{ layer: '{layer}', d: gia.state.data.{layer}.find({find}) }})"); pg.wait_for_timeout(wait); return pg.evaluate(TEXT)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.35')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@15,40,2&l=borders,'+','.join(LAYERS), wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function(f"() => {json.dumps(LAYERS)}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(1000)
    check('version 2.35', pg.evaluate("() => gia.VERSION")=='2.35')
    # an exchange
    t=open_(pg, 'economic', "x => x.id === 'nyse'")
    check('NYSE: the local time in New York', 'local time in' in t and 'America/New York' in t, t[:300])
    check('NYSE: open or closed, with how long until that changes', ('Open now' in t and 'closes in' in t) or ('Closed' in t and 'opens in' in t), t[:400])
    rows=pg.evaluate("() => document.querySelectorAll('.ex-strip rect.ex-s').length")
    check('the trading-day strip draws a session for each big exchange', rows >= 16, rows)
    check('the strip has a line for now and says holidays are left out', pg.evaluate("() => !!document.querySelector('.ex-strip .ex-now')") and 'Public holidays' in t, t[:1200])
    check('Open right now counts the exchanges with known hours', 'exchanges the atlas knows the hours of' in t or 'No exchange the atlas knows' in t, t[:1800])
    check('NYSE: financial places near it', 'Financial places near it' in t and 'within 500 km' in t, t[-800:])
    # a central bank borrows its city's zone but has no session
    t=open_(pg, 'economic', "x => x.id === 'fed'")
    check('Federal Reserve: local time, no trading status', 'local time in' in t and 'closes in' not in t and 'opens in' not in t, t[:400])
    # a financial centre from the other list
    t=open_(pg, 'finance', "x => x.id === 'fc-london'")
    check('London financial centre: local time and the trading day', 'Europe/London' in t and 'The world’s trading day' in t, t[:500])
    # a cloud region
    t=open_(pg, 'cloud', "x => x.id === 'aws-us-east-1'")
    check('AWS Virginia: zones and provider in the head', '6 zones' in t and 'Amazon Web Services' in t, t[:300])
    check('AWS Virginia: New York answers first, in a few ms', 'How fast it answers' in t and t.index('New York') < t.index('Tokyo'), t[:900])
    check('round trips are called a floor, not a ping', '204 km a millisecond' in t and 'Real pings are usually higher' in t, t[:1500])
    check('people within 10 and 30 ms', '10 ms:' in t and '30 ms:' in t and 'million people' in t, t[:2000])
    check('AI data centres next door', 'AI data centres within 500 km' in t, t[-1500:])
    fat=pg.evaluate("async () => { const m = await import('./js/econdetail.js'); return m.ex.kind + ':' + !!m.ex.fat; }")
    check('the 10 ms and 30 ms rings are drawn on the globe', fat=='cloud:true', fat)
    # an AI lab, then a cloud region from its page
    t=open_(pg, 'ailabs', "x => x.id === 'anthropic-research'")
    check('Anthropic: founded and what it works on', 'founded 2021' in t and 'What it works on' in t and 'Interpretability' in t, t[:700])
    check('Anthropic: the labs around it, OpenAI nearest', 'Labs within 100 km' in t and t.index('OpenAI') < t.index('Stanford HAI'), t[:1600])
    check('Anthropic: the nearest cloud regions with round-trip times', 'Nearest cloud regions' in t and ' ms' in t, t[-900:])
    pg.evaluate("() => document.querySelector('#ex-compute [data-ix-layer=\"cloud\"]').click()"); pg.wait_for_timeout(3000)
    t=pg.evaluate(TEXT)
    check('a cloud region opens from a lab page', 'How fast it answers' in t, t[:300])
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('data-ix-id=\"nyse\"') && s.includes('data-ix-id=\"aws-us-east-1\"'); }")
    check("What's new has Try buttons for an exchange and a cloud region", nw)
    hostile=pg.evaluate("""async () => { const d = { id: 'x', name: '<img src=x id=pwn>', provider: '<b id=pwn2>', city: '<i id=pwn3>', country: '<u id=pwn4>', zones: 2, lat: 10, lon: 10 };
      gia.select({ layer: 'cloud', d }); await new Promise((r) => setTimeout(r, 2000));
      gia.select({ layer: 'ailabs', d: { id: 'y', name: '<s id=pwn5>', type: '<s id=pwn6>', city: 'x', country: 'y', focusAreas: ['<s id=pwn7>'], lat: 10, lon: 10 } }); await new Promise((r) => setTimeout(r, 1500));
      return !!document.querySelector('#pwn, #pwn2, #pwn3, #pwn4, #pwn5, #pwn6, #pwn7'); }""")
    check('names are escaped', not hostile)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
