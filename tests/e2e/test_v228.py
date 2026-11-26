# SPDX-License-Identifier: AGPL-3.0-only
# v2.28 conflict zones, watch regions and military bases in depth (geodetail.js). Everything on these pages comes from
# the atlas's own data and country outlines, so nothing depends on a feed or the date.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
LAYERS=['conflicts','hotspots','bases']
TEXT="() => document.getElementById('notes-body')?.innerText ?? ''"
def open_(pg, layer, find, wait=3000):
    pg.evaluate(f"() => gia.select({{ layer: '{layer}', d: gia.state.data.{layer}.find({find}) }})"); pg.wait_for_timeout(wait); return pg.evaluate(TEXT)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.39')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@15,40,2&l=borders,'+','.join(LAYERS), wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function(f"() => {json.dumps(LAYERS + ['borders'])}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(1000)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    # a conflict zone
    t=open_(pg, 'conflicts', "x => x.id === 'sudan'")
    check('Sudan: its drawn area in km² against a country you know', 'thousand km²' in t and 'size of' in t and 'not a front line' in t, t[:500])
    check('Sudan: intensity and the parties', 'Intensity: high' in t and 'Rapid Support Forces (RSF)' in t, t[:700])
    check('Sudan: countries it covers, with Sudan first and the method', 'Countries it covers' in t and t.index('Sudan', t.index('Countries it covers')) > 0 and 'points spread over it' in t, t[:1400])
    bars=pg.evaluate("() => document.querySelectorAll('.gx-bars li').length")
    check('the country shares are drawn as bars', bars >= 1, bars)
    check('Sudan: people in its cities and towns, said to be a lower bound', 'Khartoum' in t and 'a lower bound' in t and 'million people' in t, t[:2000])
    t=open_(pg, 'conflicts', "x => x.id === 'iran'")
    check('Iran: bases of several powers in and near it', 'Military bases in and near it' in t and 'United States and NATO' in t and 'inside the drawn area' in t, t[:2500])
    check('Iran: what is at stake, including Bushehr and the Strait of Hormuz', 'Bushehr' in t and 'Nuclear plants' in t and ('Hormuz' in t or 'HORMUZ' in t), t[-1500:])
    # a watch region
    t=open_(pg, 'hotspots', "x => x.id === 'horn_africa'")
    check('Horn of Africa: everything within 500 km, with the countries in reach', 'within 500 km' in t and 'Somalia' in t, t[:1200])
    check('Horn of Africa: the nearest conflict zone and its distance', 'Nearest conflict' in t and ' km' in t, t[-600:])
    fat=pg.evaluate("async () => { const m = await import('./js/geodetail.js'); return m.gx.kind + ':' + !!m.gx.fat; }")
    check('the 500 km ring is drawn on the globe', fat=='spot:true', fat)
    # a military base, and opening a rival from its page
    t=open_(pg, 'bases', "x => x.id === 'camp_lemonnier'")
    check('Camp Lemonnier: its network, by host country', 'United States and NATO bases on the map in' in t and 'Japan' in t, t[:900])
    check('Camp Lemonnier: other powers within 1,000 km, China nearest', 'Other powers within 1,000 km' in t and 'Chinese PLA Support Base' in t and 'France' in t, t[:1800])
    check('Camp Lemonnier: what it overlooks, Bab el-Mandeb first', 'What it overlooks' in t and 'Bab' in t and 'days’ sailing' in t, t[-700:])
    fat=pg.evaluate("async () => { const m = await import('./js/geodetail.js'); return m.gx.kind + ':' + !!m.gx.fat + ':' + (m.gx.lines?.length ?? 0); }")
    check('a ring and lines to the other powers are drawn', fat.startswith('base:true:') and int(fat.split(':')[2]) >= 3, fat)
    pg.evaluate("() => document.querySelector('#gx-rivals [data-ix-layer=\"bases\"]').click()"); pg.wait_for_timeout(3000)
    t=pg.evaluate(TEXT)
    check('another power’s base opens its own page', 'Its network' in t and 'Camp Lemonnier' in t, t[:600])
    pg.evaluate("() => document.querySelectorAll('details.qd-sec').forEach((d) => d.open = true)")
    pg.evaluate("() => document.querySelector('#gx-watch [data-ix-layer=\"conflicts\"]').click()"); pg.wait_for_timeout(4000)
    t=pg.evaluate(TEXT)
    check('a conflict zone opens from a base page', 'Countries it covers' in t, t[:300])
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('data-ix-id=\"sudan\"') && s.includes('data-ix-id=\"camp_lemonnier\"'); }")
    check("What's new has Try buttons for a conflict and a base", nw)
    hostile=pg.evaluate("""async () => { const d = { id: 'x', name: '<img src=x id=pwn>', type: '<b id=pwn2>', country: '<i id=pwn3>', arm: '<u id=pwn4>', description: '<s id=pwn5>', lat: 0, lon: 0 };
      gia.select({ layer: 'bases', d }); await new Promise((r) => setTimeout(r, 1500)); return !!document.querySelector('#pwn, #pwn2, #pwn3, #pwn4, #pwn5'); }""")
    check('names are escaped', not hostile)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
