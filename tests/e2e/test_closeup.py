# SPDX-License-Identifier: AGPL-3.0-only
# v2.16 lifelike close-ups: live ships become true-size 3D models when you zoom in, and below about 6 km simulated
# vehicles drive on the real (here mocked) OpenStreetMap roads, with buildings below 2.5 km. Also checks that the
# close-up code is not loaded at start-up (speed) and that the switch in Map turns it off.
import sys, json, math
from urllib.parse import unquote
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
calls=[]
def overpass(route):
    q=unquote(route.request.url); calls.append(q)
    import re; m=re.search(r'around:\d+,(-?[\d.]+),(-?[\d.]+)', q); la,lo=float(m.group(1)),float(m.group(2))
    els=[]; k=1
    for i in range(-4,5):   # a grid of streets every ~300 m, one motorway, one one-way street
        cls='motorway' if i==0 else 'primary' if i%2 else 'residential'
        els.append({'type':'way','id':k,'tags':{'highway':cls},'geometry':[{'lat':la+i*0.0027,'lon':lo+j*0.004} for j in range(-5,6)]}); k+=1
        els.append({'type':'way','id':k,'tags':{'highway':'secondary','oneway':'yes' if i==2 else 'no'},'geometry':[{'lat':la+j*0.0027,'lon':lo+i*0.004} for j in range(-5,6)]}); k+=1
    for i in range(30):
        x=lo+(i%6-3)*0.0016+0.0006; y=la+(i//6-2.5)*0.0013+0.0004; d=0.0002
        els.append({'type':'way','id':1000+i,'tags':{'building':'yes','building:levels':str(2+i%7)},'geometry':[{'lat':y,'lon':x},{'lat':y+d,'lon':x},{'lat':y+d,'lon':x+d},{'lat':y,'lon':x+d},{'lat':y,'lon':x}]})
    route.fulfill(status=200, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body=json.dumps({'elements':els}))
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]; scripts=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: scripts.append(r.url) if r.url.endswith('.js') else None)
    pg.route('**/*', handler); pg.route('https://overpass-api.de/**', overpass)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@59.9,24.5,1.2&b=bluemarble&l=borders,ships', wait_until='commit'); pg.wait_for_timeout(10000)
    check('close-up code is not loaded at start-up', not any('closeup.js' in u for u in scripts))
    n=pg.evaluate("(gia.state.data.ships||[]).length")
    check('the mocked Baltic ships are loaded', n>50, n)
    s=pg.evaluate("(()=>{const s=gia.state.data.ships.find(x=>x.sog>5)||gia.state.data.ships[0];return {lat:s.lat,lng:s.lng,mmsi:s.mmsi}})()")
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{s['lat']},lng:{s['lng']},altitude:0.003}},0)"); pg.wait_for_timeout(2500)
    check('close-up code loads once you zoom in', any('closeup.js' in u for u in scripts))
    st=pg.evaluate("gia.closeup()?.stats()")
    check('ships in view become 3D models', st and st['on'] and st['ships']>=1, st)
    check('no street traffic yet at 19 km', st and st['vehicles']==0 and not st['street'], st)
    pg.evaluate("void gia.globe.pointOfView({lat:60.17,lng:24.94,altitude:0.0003},0)"); pg.wait_for_timeout(4000)  # Helsinki
    st=pg.evaluate("gia.closeup()?.stats()")
    check('streets load from Overpass below 6 km', len(calls)==1 and 'highway' in calls[0] and 'building' in calls[0], len(calls))
    check('simulated vehicles on the real roads', st and st['roads']>=18 and st['vehicles']>100 and st['street'], st)
    check('buildings are raised below 2.5 km', st and st['buildings'], st)
    check('traffic is lighter or heavier by local hour', st and 0.1<=st['busy']<=1, st)
    check('Finland drives on the right', st and st['left'] is False, st)
    m1=pg.evaluate("(()=>{const g=gia.globe.scene().getObjectByName('closeups');let a=null;g.traverse(o=>{if(o.isInstancedMesh&&o.count>0&&!a){const m=new o.matrixWorld.constructor();o.getMatrixAt(0,m);a=Array.from(m.elements)}});return a})()")
    pg.wait_for_timeout(1200)
    m2=pg.evaluate("(()=>{const g=gia.globe.scene().getObjectByName('closeups');let a=null;g.traverse(o=>{if(o.isInstancedMesh&&o.count>0&&!a){const m=new o.matrixWorld.constructor();o.getMatrixAt(0,m);a=Array.from(m.elements)}});return a})()")
    check('vehicles move', m1 and m2 and math.hypot(m1[12]-m2[12], m1[13]-m2[13])>1, (m1 and m1[12:14], m2 and m2[12:14]))
    note=pg.evaluate("document.querySelector('#attribution .close-note')?.textContent||''")
    check('the map says the traffic is simulated', 'simulated vehicles' in note, note)
    pg.evaluate("void gia.globe.pointOfView({lat:60.175,lng:24.94,altitude:0.0003},0)"); pg.wait_for_timeout(1500)
    check('a small move does not query Overpass again', len(calls)==1, len(calls))
    pg.evaluate("void gia.globe.pointOfView({lat:1.29,lng:103.85,altitude:0.0003},0)"); pg.wait_for_timeout(4000)  # Singapore
    st=pg.evaluate("gia.closeup()?.stats()")
    check('Singapore drives on the left', st and st['left'] is True and len(calls)==2, (st, len(calls)))
    pg.evaluate("document.getElementById('closeups').checked=false; document.getElementById('closeups').dispatchEvent(new Event('change'))"); pg.wait_for_timeout(500)
    st=pg.evaluate("gia.closeup()?.stats()")
    check('the Map switch turns close-ups off', st and not st['on'], st)
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{s['lat']},lng:{s['lng']},altitude:1.2}},0)"); pg.wait_for_timeout(500)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}'); sys.exit(0 if all(res) else 1)
