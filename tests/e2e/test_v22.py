import sys, json; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.2: ships worldwide from the live-data snapshot, the ship card, Data health, and the Baltic fallback.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
BALTIC=json.dumps({"type":"FeatureCollection","features":[{"mmsi":230000000+i,"type":"Feature","geometry":{"type":"Point","coordinates":[24+i*0.01,59.9]},"properties":{"mmsi":230000000+i,"sog":5.0,"cog":90,"heading":90,"navStat":0,"timestampExternal":0}} for i in range(50)]})
def baltic(route):
    u=route.request.url
    if 'meri.digitraffic.fi/api/ais/v1/locations' in u: return route.fulfill(status=200, body=BALTIC, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    if 'meri.digitraffic.fi/api/ais/v1/vessels' in u: return route.fulfill(status=200, body='[]', headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return handler(route)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', baltic); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@1.3,103.8,2.2&l=borders,ships', wait_until='commit'); pg.wait_for_timeout(14000)
    check('version 2.12', pg.evaluate("() => gia.VERSION")=='2.12')
    d=pg.evaluate("() => { const s=gia.state.data.ships; return s && { n: s.length, src: s.src, parts: gia.state.chan.ships?.particles.length, st: gia.state.lstatus.ships?.s } }")
    check('ships load worldwide from the snapshot', d and d['n']==4001 and d['src']=='world' and d['st']=='ok', d)
    check('ships drawn as one particle cloud', d and d['parts']==1, d)
    pg.wait_for_timeout(1500)
    pg.evaluate("() => gia.select({layer:'ships', d: gia.state.data.ships.find(s => s.mmsi===563000001)})"); pg.wait_for_timeout(600)
    t=pg.inner_text('#notes-body')
    check('ship card shows static details from ships-static.json', 'MOCK STAR' in pg.inner_text('#notes') and '9V1234' in t and 'ROTTERDAM' in t and '12.5 m' in t and '300 m' in t, t[:300])
    check('ship card names its source', 'AISStream (live-data snapshot)' in t)
    pg.evaluate("() => { document.querySelector('.rail [data-section=layers]').click(); }"); pg.wait_for_timeout(800)
    note=pg.evaluate("() => document.querySelector('[data-lpanel=ships]')?.innerText || ''")
    check('layer panel says worldwide', 'Worldwide: 4,001 vessels' in note, note)
    check('no key form on the website', pg.evaluate("() => !document.querySelector('[data-ais-form]')"))
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay batched', calls < 40, calls)
    pg.evaluate("() => gia.health.show()"); pg.wait_for_timeout(2500)
    check('data health lists ships worldwide', 'Ships worldwide (AISStream)' in pg.inner_text('#notes-body'))
    # without a snapshot: the Baltic feed takes over
    pg2=b.new_page(viewport={'width':1280,'height':800}); pg2.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg2.route('**/*', baltic); pg2.route('**/live-data/ships.json*', lambda r: r.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})); pg2.add_init_script(INIT)
    pg2.goto('http://localhost:8765/app/#@60,24,1.2&l=borders,ships', wait_until='commit'); pg2.wait_for_timeout(14000)
    f=pg2.evaluate("() => { const s=gia.state.data.ships; return s && { n: s.length, src: s.src } }")
    check('falls back to the Baltic without a snapshot', f and f['src']=='baltic' and f['n']==50, f)
    pg2.evaluate("() => gia.select({layer:'ships', d: gia.state.data.ships[0]})"); pg2.wait_for_timeout(500)
    check('Baltic card names Fintraffic', 'Fintraffic Digitraffic' in pg2.inner_text('#notes-body'))
    # with a proxy: ships in view come from its /ais endpoint and follow the camera
    pg3=b.new_page(viewport={'width':1280,'height':800}); pg3.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400])); seen=[]
    def proxied(route):
        u=route.request.url
        if u.endswith('/app/config.json') or '/app/config.json?' in u: return route.fulfill(status=200, body=json.dumps({"liveData":"auto","liveDataFallback":"https://raw.githubusercontent.com/Normansrule/global-intelligence-atlas/live-data/","proxy":"https://proxy.test"}), headers={'Content-Type':'application/json'})
        if u.startswith('https://proxy.test/ais'):
            seen.append(u); return route.fulfill(status=200, body=json.dumps({"rows":[[563000001,1.3,103.9,9.9,50,50,0,int(__import__('time').time()//60)+1,"MOCK STAR",70],[999000001,1.2,103.7,4,10,None,0,int(__import__('time').time()//60),"PROXY ONLY",80]],"statics":[]}), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
        return baltic(route)
    pg3.route('**/*', proxied); pg3.add_init_script(INIT)
    pg3.goto('http://localhost:8765/app/#@1.3,103.8,0.3&l=borders,ships', wait_until='commit'); pg3.wait_for_timeout(15000)
    q=pg3.evaluate("() => { const s=gia.state.data.ships||[]; const a=s.find(x=>x.mmsi===563000001); return { n: s.length, live: s.filter(x=>x.via==='live').length, lat: a?.lat, extra: !!s.find(x=>x.mmsi===999000001) } }")
    check('proxy adds ships in view and newer positions win', q['live']==2 and q['lat']==1.3 and q['extra'] and q['n']==4002, {**q, 'calls': seen[:2]})
    check('proxy box covers the view', seen and all(p in seen[0] for p in ['b=']), seen[:1])
    # desktop app: the page asks the Rust side (ais_collect) with the key saved under the layer
    pg4=b.new_page(viewport={'width':1280,'height':800}); pg4.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg4.route('**/*', baltic)
    pg4.add_init_script(INIT + """
      window.__aisCalls = [];
      window.__TAURI_INTERNALS__ = { invoke: async (cmd, a) => {
        if (cmd === 'fetch_text') { const r = await fetch(a.url); if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { http: r.status }); return r.text(); }
        if (cmd === 'ais_collect') { window.__aisCalls.push(a); const t = new Date().toISOString().replace('T', ' ').replace('Z', '000 +0000 UTC');
          return [JSON.stringify({ MessageType: 'PositionReport', MetaData: { MMSI: 777000001, ShipName: 'DESKTOP LIVE', time_utc: t }, Message: { PositionReport: { UserID: 777000001, Latitude: 1.28, Longitude: 103.85, Sog: 3, Cog: 10, TrueHeading: 511, NavigationalStatus: 0 } } }),
                  JSON.stringify({ MessageType: 'ShipStaticData', MetaData: { MMSI: 777000001, time_utc: t }, Message: { ShipStaticData: { UserID: 777000001, Name: 'DESKTOP LIVE@@', Type: 80, CallSign: 'D3SK', Destination: 'SINGAPORE', MaximumStaticDraught: 9, Dimension: { A: 150, B: 30, C: 12, D: 12 } } } })]; }
        throw new Error('unknown command ' + cmd);
      } };""")
    pg4.goto('http://localhost:8765/app/#@1.3,103.8,0.3&l=borders,ships', wait_until='commit'); pg4.wait_for_timeout(14000)
    if not pg4.evaluate("() => document.body.classList.contains('left-open')"): pg4.click('.rail [data-section=layers]')
    pg4.wait_for_timeout(600)
    check('desktop shows the key form', pg4.evaluate("() => !!document.querySelector('[data-ais-form] input')"))
    check('no AISStream call without a key', pg4.evaluate("() => window.__aisCalls.length")==0)
    pg4.fill('[data-ais-form] input', 'test-key-1234'); pg4.click('[data-ais-form] button'); pg4.wait_for_timeout(5000)
    w=pg4.evaluate("() => ({ calls: window.__aisCalls.length, key: window.__aisCalls[0]?.key, boxes: window.__aisCalls[0]?.boxes, s: (gia.state.data.ships||[]).find(x=>x.mmsi===777000001)?.via })")
    check('saving a key asks AISStream for ships in view', w['calls']>=1 and w['key']=='test-key-1234' and w['s']=='live', w)
    pg4.evaluate("() => gia.select({layer:'ships', d: gia.state.data.ships.find(x=>x.mmsi===777000001)})"); pg4.wait_for_timeout(500)
    t4=pg4.inner_text('#notes-body')
    check('desktop live ship card', 'D3SK' in t4 and 'SINGAPORE' in t4 and '180 m' in t4 and 'AISStream, live in view' in t4, t4[:200])
    check('no page errors', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
