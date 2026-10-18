import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
import json, os, subprocess, tempfile
# v2.11 economy, property and industry: the six layers in economy.js, fed the offline output of tools/fetch-economy.mjs
# (built from tests/economy/fixtures) as if it were the economy-data branch.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
OUT=tempfile.mkdtemp()
subprocess.run(['node', os.path.join(ROOT, 'tests/economy/test-economy.mjs')], env={**os.environ, 'ECONOMY_TEST_OUT': OUT}, check=True, capture_output=True)
def econ(route):
    k=route.request.url.split('/economy-data/')[1].split('?')[0]; p=os.path.join(OUT, k)
    if os.path.isfile(p): return route.fulfill(status=200, body=open(p,'rb').read(), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
def works(route):
    body={'elements':[{'type':'way','id':7,'center':{'lat':51.51,'lon':-0.12},'tags':{'man_made':'works','name':'Test Brewery','product':'beer'}}]}
    return route.fulfill(status=200, body=json.dumps(body), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.11')}catch(e){}"
LAYERS=['houseprices','homevalues','propsales','exports','industry','osmworks']
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.route('**/economy-data/**', econ)
    pg.route(lambda u: 'overpass' in u and 'works' in __import__('urllib.parse').parse.unquote(u), works)
    pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@51.5,-0.13,0.3&l=borders,'+','.join(LAYERS), wait_until='commit'); pg.wait_for_timeout(12000)
    man={l['id']: l for l in pg.evaluate("() => gia.layerManifest()")['layers']}
    for lid in LAYERS:
        l=man.get(lid, {})
        check(f'{lid}: in the economy group with sources and a learn card', l.get('group')=='econ' and l.get('sources') and all(s['name'] for s in l['sources']) and 'learn' in l.get('capabilities', []), l.get('sources'))
        st=pg.evaluate(f"() => gia.state.lstatus['{lid}']")
        check(f'{lid}: loads', st and st.get('s')=='ok', st)
    # open a card from each layer
    for lid, field in [('propsales','sold'), ('houseprices','%'), ('exports','export'), ('industry','t'), ('homevalues','$')]:
        t=pg.evaluate(f"""async () => {{ const d = gia.state.data['{lid}']; const rows = d?.rows ?? d; const r = Array.isArray(rows) ? rows[0] : null; if (!r) return null;
          gia.select({{ layer: '{lid}', d: r }}); await new Promise(f => setTimeout(f, 500)); return document.querySelector('#notes-body')?.innerText ?? '' }}""")
        check(f'{lid}: card opens', t and field in t.lower() if field.isalpha() else t and field in t, (t or '')[:140].replace('\n',' · '))
    check('no home addresses reach the page', not pg.evaluate("() => /DOWNING|PARLIAMENT|FLAT 1/.test(JSON.stringify(gia.state.data.propsales ?? {}))"))
    ed=pg.evaluate("async () => { const r = await import('./js/registry.js'); return r.EDITIONS.lite.exclude.includes('propsales') && r.EDITIONS.lite.exclude.includes('osmworks') }")
    check('the lite edition leaves out the heavy property and OpenStreetMap layers', ed)
    pg.evaluate("() => gia.closeNotes?.()"); pg.keyboard.press('Escape'); pg.wait_for_timeout(1500)
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay under 120 with every economy layer on', calls < 120, calls)
    check('no page errors', not errs, errs[:3]); pg.close()
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
