import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
import json
# v2.9: open data in place of World Monitor's curated lists (opendata.js, About → Datasets).
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}"
OPEN={
 'ports.json': {'rows':[{'id':'wpi-57010','name':'Shanghai','lat':31.233,'lon':121.483,'country':'China','type':'large harbour','size':'Large','harbourType':'River natural','locode':'CN SHA','channelDepthM':12.5,'maxVesselLengthM':400,'wpi':'57010'},
                        {'id':'wpi-1','name':'Little Port','lat':30,'lon':120,'country':'China','type':'small harbour','size':'Small','wpi':'1'}]},
 'nuclear.json': {'rows':[{'id':'wd-Q1','name':'Barakah nuclear power plant','lat':23.97,'lon':52.23,'type':'plant','status':'active','operator':'Nawah, ENEC','country':'United Arab Emirates','capacityMW':5600,'opened':2020,'closed':None,'wikidata':'https://www.wikidata.org/wiki/Q1'}]},
 'cables.json': {'rows':[{'id':'marea','name':'MAREA','parts':[[[-76.06,36.85],[-50.12,37.9],[-2.95,43.27]],[[-10,45],[-9,44]]],'points':[[-76.06,36.85],[-50.12,37.9],[-2.95,43.27]],'major':False,'rfsYear':2018,'lengthKm':6605,'owners':['Meta','Microsoft','Telxius'],'landingPoints':[{'city':'Bilbao','countryName':'Spain','lat':43.27,'lon':-2.95}]}]},
}
def open_route(route):
    k=route.request.url.split('/open-data/')[1].split('?')[0]
    if k in OPEN: return route.fulfill(status=200, body=json.dumps(OPEN[k]), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
def page(b, url, serve=True):
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler)
    if serve: pg.route('**/open-data/**', open_route)
    pg.add_init_script(INIT); pg.goto(url, wait_until='commit'); pg.wait_for_timeout(11000); return pg, errs
L='l=borders,cables,ports,nuclear,waterways,spaceports'
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    # no open-data branch yet: auto falls back to World Monitor's lists, except the chokepoints that ship with the site
    pg, errs = page(b, f'http://localhost:8765/app/#@30,60,2.4&{L}', serve=False)
    check('version 2.12', pg.evaluate("() => gia.VERSION")=='2.12')
    o=pg.evaluate("async () => { const m = await import('./js/opendata.js'); return { mode: m.datasetMode(), o: { ...m.origins }, ports: gia.state.data.ports?.length, ww: gia.state.data.waterways?.length, note: gia.state.lstatus.ports?.note } }")
    check('auto without the branch: World Monitor lists, chokepoints from the EIA file', o['mode']=='auto' and o['o'].get('ports')=='worldmonitor' and o['o'].get('cables')=='worldmonitor' and o['o'].get('waterways')=='open' and o['ports']==62 and o['ww']==8, o)
    check('the status says why the open file was not used', 'open data not available yet' in (o['note'] or ''), o['note'])
    check('no page errors (fallback)', not errs, errs[:3]); pg.close()
    # with the branch
    pg, errs = page(b, f'http://localhost:8765/app/#@30,60,2.4&{L}')
    o=pg.evaluate("async () => { const m = await import('./js/opendata.js'); return { o: { ...m.origins }, ports: gia.state.data.ports?.length, nuc: gia.state.data.nuclear?.length, cab: gia.state.data.cables?.length, sp: gia.state.data.spaceports?.length, note: gia.state.lstatus.ports?.note } }")
    check('auto with the branch: open data where a file exists, World Monitor for the rest', o['o'].get('ports')=='open' and o['o'].get('nuclear')=='open' and o['o'].get('cables')=='open' and o['o'].get('spaceports')=='worldmonitor' and o['ports']==2 and o['nuc']==1 and o['cab']==1 and o['sp']==12, o)
    check('status names the open source and its terms', 'NGA World Port Index' in (o['note'] or '') and 'Public domain' in (o['note'] or ''), o['note'])
    segs=pg.evaluate("() => { const c = gia.state.chan.cables; return c.lines[0].items.length }")
    check('a cable in several parts draws each part, all pointing at the cable', segs==2, segs)
    pg.evaluate("() => gia.select({ layer: 'ports', d: gia.state.data.ports[0] })"); pg.wait_for_timeout(800)
    t=pg.inner_text('#notes-body')
    check('port card from the World Port Index: depths, LOCODE and link', 'Channel depth' in t and '12.5 m' in t and 'CN SHA' in t and '400 m' in t and 'World Port Index' in t, t[:300])
    pg.evaluate("() => gia.select({ layer: 'nuclear', d: gia.state.data.nuclear[0] })"); pg.wait_for_timeout(800)
    t=pg.inner_text('#notes-body')
    check('nuclear card from Wikidata: capacity, years and the Wikidata link', '5,600 MW' in t and '2020' in t and 'Wikidata' in t, t[:300])
    pg.evaluate("() => gia.select({ layer: 'cables', d: gia.state.data.cables[0] })"); pg.wait_for_timeout(800)
    t=pg.inner_text('#notes-body')
    check('cable card: length, owners and landings', '6,605 km' in t and 'Telxius' in t and 'Bilbao, Spain' in t, t[:300])
    # About → Datasets: switch to World Monitor's lists and back
    pg.evaluate("() => document.activeElement?.blur()"); pg.keyboard.press('Escape'); pg.wait_for_timeout(300); pg.keyboard.press('Shift+Slash'); pg.wait_for_timeout(1200)
    pg.click('[data-datasets]'); pg.wait_for_timeout(1000)
    rows=pg.evaluate("() => [...document.querySelectorAll('[data-ds]')].map(r => [r.dataset.ds, r.cells[2].textContent])")
    d=dict(rows)
    check('Datasets panel lists every layer, its open source and what it draws now', d.get('ports')=='Open data' and d.get('spaceports')=='World Monitor' and 'pipelines' in d and len(rows)>=12, rows)
    pg.select_option('#ds-mode', 'worldmonitor'); pg.wait_for_timeout(3500)
    o=pg.evaluate("async () => { const m = await import('./js/opendata.js'); return { mode: m.datasetMode(), ports: gia.state.data.ports?.length, origin: m.origins.ports, ww: gia.state.data.waterways?.length } }")
    check('choosing World Monitor redraws with its lists and is remembered', o['mode']=='worldmonitor' and o['ports']==62 and o['origin']=='worldmonitor' and o['ww']==13, o)
    pg.select_option('#ds-mode', 'auto'); pg.wait_for_timeout(2500)
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay batched', calls < 160, calls)
    check('World Monitor is still credited in About and the attribution line', 'World Monitor' in pg.inner_text('#attribution'))
    check('no page errors', not errs, errs[:3]); pg.close()
    # open only, without the branch: the layer says so instead of drawing old data
    pg, errs = page(b, f'http://localhost:8765/app/?datasets=open#@30,60,2.4&{L}', serve=False)
    s=pg.evaluate("() => gia.state.lstatus.ports")
    check('?datasets=open without the file: an error that says why', s and s['s']=='error' and 'open data not available yet' in s.get('note',''), s)
    check('no page errors (open only)', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
