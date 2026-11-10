# SPDX-License-Identifier: AGPL-3.0-only
# v2.19 a whole city up close: tilt to look across a city; buildings with windows that are lit by the real Sun and
# light up after dark; parks, woods, rivers and lakes from OpenStreetMap with trees and rippling water; pavements,
# lane lines, zebra crossings and street lamps. Overpass is mocked with a made-up town.
import sys, json, math, re, random
from urllib.parse import unquote
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
# A made-up town for screenshots and tests (Overpass is unreachable here): a street grid, a motorway, a river with
# banks, a lake, a park with paths and trees, rows of buildings of mixed heights and shapes, street trees.
def town(la, lo):
    R=random.Random(7); els=[]; k=[1]
    def nid(): k[0]+=1; return k[0]
    def way(tags, pts): els.append({'type':'way','id':nid(),'tags':tags,'geometry':[{'lat':a,'lon':b} for a,b in pts]})
    dy=0.0027; dx=0.004
    for i in range(-4,5):
        cls='motorway' if i==-3 else 'primary' if i%2 else 'residential'
        way({'highway':cls,'name':f'Street {i}'}, [(la+i*dy, lo+j*dx) for j in range(-5,6)])
        way({'highway':'secondary' if i%2 else 'tertiary','oneway':'yes' if i==2 else 'no'}, [(la+j*dy, lo+i*dx) for j in range(-5,6)])
    # river running east-west between -1 and -2 rows, with its area
    rv=la-1.5*dy
    way({'waterway':'river','name':'River'}, [(rv+0.0002*math.sin(j/2), lo+j*dx/2) for j in range(-10,11)])
    way({'natural':'water','water':'river'}, [(rv-0.00035+0.0002*math.sin(j/2), lo+j*dx/2) for j in range(-10,11)]+[(rv+0.00035+0.0002*math.sin(j/2), lo+j*dx/2) for j in range(10,-11,-1)]+[(rv-0.00035+0.0002*math.sin(-5), lo-10*dx/2)])
    # a park with a lake, two blocks
    px,py=lo+0.0003, la+0.0003; pw,ph=dx*2-0.0006, dy-0.0006
    way({'leisure':'park','name':'Central Park'}, [(py,px),(py,px+pw),(py+ph,px+pw),(py+ph,px),(py,px)])
    lk=[(py+ph/2+ph*0.25*math.sin(t/12*2*math.pi), px+pw*0.35+pw*0.15*math.cos(t/12*2*math.pi)) for t in range(13)]
    way({'natural':'water','name':'Pond'}, lk)
    for t in range(40): els.append({'type':'node','id':nid(),'tags':{'natural':'tree'},'lat':py+R.random()*ph,'lon':px+pw*0.55+R.random()*pw*0.42})
    way({'landuse':'grass'}, [(la-dy*3+0.0003,lo-dx*3+0.0003),(la-dy*3+0.0003,lo-dx+-0.0003),(la-dy*2-0.0003,lo-dx-0.0003),(la-dy*2-0.0003,lo-dx*3+0.0003),(la-dy*3+0.0003,lo-dx*3+0.0003)])
    way({'landuse':'forest'}, [(la+dy*3+0.0003,lo+dx*2+0.0003),(la+dy*3+0.0003,lo+dx*4-0.0003),(la+dy*4-0.0003,lo+dx*4-0.0003),(la+dy*4-0.0003,lo+dx*2+0.0003),(la+dy*3+0.0003,lo+dx*2+0.0003)])
    # buildings: blocks around the centre, mixed sizes, a few towers
    for bi in range(-3,3):
        for bj in range(-3,3):
            if (bi,bj) in [(0,0),(0,1)] or bi==-2: continue   # the park, the river row
            by0=la+bi*dy; bx0=lo+bj*dx
            for r in range(3):
                for c in range(5):
                    w=0.00045+R.random()*0.0002; h=0.00045+R.random()*0.0002
                    x=bx0+0.00035+c*0.00068; y=by0+0.00035+r*0.00072
                    lv=R.choice([2,3,3,4,5,6,8]) if abs(bi)+abs(bj)>2 else R.choice([6,10,14,22,35])
                    way({'building':R.choice(['apartments','yes','office','commercial','house']),'building:levels':str(lv)}, [(y,x),(y+h,x),(y+h,x+w),(y,x+w),(y,x)])
    for t in range(120):  # street trees along residential rows
        i=R.choice([-4,-2,0,2,4]); j=R.uniform(-5,5)
        els.append({'type':'node','id':nid(),'tags':{'natural':'tree'},'lat':la+i*dy+0.00012,'lon':lo+j*dx})
    return els
def overpass(route):
    q=unquote(route.request.url); m=re.search(r'around:\d+,(-?[\d.]+),(-?[\d.]+)', q)
    route.fulfill(status=200, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body=json.dumps({'elements':town(float(m.group(1)),float(m.group(2)))}))
def night_place(pg): return pg.evaluate("async () => { const a = await import('./js/astro.js'); const s = a.subsolarPoint(new Date()); let lng = s.lng + 180; if (lng > 180) lng -= 360; return { lat: Math.max(-50, Math.min(50, -s.lat)), lng }; }")
def day_place(pg): return pg.evaluate("async () => { const a = await import('./js/astro.js'); const s = a.subsolarPoint(new Date()); return { lat: Math.max(-50, Math.min(50, s.lat + 10)), lng: s.lng }; }")
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://overpass-api.de/**', overpass)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,10,1.2&l=borders', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.globe", timeout=40000); pg.wait_for_timeout(2000)
    u=pg.evaluate("""async () => { const w = await import('./js/world.js'); const t = await import('./js/tilt.js');
      const rel = { type: 'relation', members: [ { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] }, { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 0, lon: 1 }] }, { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 0, lon: 0 }] }, { type: 'way', role: 'inner', geometry: [{ lat: 0.2, lon: 0.2 }, { lat: 0.3, lon: 0.3 }] } ] };
      const r = w.relationRings(rel);
      return { kinds: [{ leisure: 'park' }, { landuse: 'forest' }, { natural: 'water' }, { waterway: 'river' }, { natural: 'beach' }, { highway: 'primary' }].map(w.groundKind),
        ring: r.length === 1 && r[0].length === 4 && r[0][0][0] === r[0][3][0] && r[0][0][1] === r[0][3][1],
        styles: [w.facadeStyle({ building: 'office', 'building:levels': '40' }, 130), w.facadeStyle({ building: 'house' }, 6), w.facadeStyle({ building: 'warehouse' }, 9), w.facadeStyle({ building: 'apartments', 'building:levels': '5' }, 17)],
        inside: [w.inside(5, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]), w.inside(15, 5, [[0, 0], [10, 0], [10, 10], [0, 10]])], area: w.area([[0, 0], [10, 0], [10, 10], [0, 10]]),
        lit: [w.windowsLit(20), w.windowsLit(3), w.windowsLit(23.5)],
        tilt: [t.tiltFactor(0.01), t.tiltFactor(0.15), t.tiltFactor(0.3), t.tiltLimit(700), t.tiltLimit(300), t.tiltLimit(100000)] }; }""")
    check('the map sorts parks, woods, water, rivers and beaches (and leaves roads alone)', u['kinds']==['green','wood','water','river','sand',None], u['kinds'])
    check('split lakes and woods (relations) are joined into whole outlines', u['ring'], u)
    st=u['styles']
    check('towers get glass walls, houses house windows, warehouses few, flats a window a storey', [x['style'] for x in st]==[1,2,3,0] and abs(st[3]['floorH']-3.4)<0.01 and st[0]['levels']==40, st)
    check('point-in-polygon and area for scattering trees', u['inside']==[True,False] and abs(u['area']-100)<1e-9, u)
    check('more windows lit in the evening than at 3 a.m.', u['lit'][0]>u['lit'][2]>u['lit'][1], u['lit'])
    tl=u['tilt']
    check('tilt is full near the ground, half way at 950 km, none from far away', tl[0]==1 and abs(tl[1]-0.5)<1e-9 and tl[2]==0, tl)
    check('the tilt never takes the camera lower than 250 m', abs(math.cos(math.radians(tl[3]))*700-250)<0.5 and abs(math.cos(math.radians(tl[4]))*300-250)<0.5 and tl[5]==75, tl)
    # by day in the made-up town
    d=day_place(pg)
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{d['lat']},lng:{d['lng']},altitude:0.0003}},0)")
    try: pg.wait_for_function("() => gia.closeup && gia.closeup()?.stats().world", timeout=60000)
    except Exception: print('DEBUG', d, pg.evaluate("[gia.state.pov, gia.closeup && gia.closeup()?.stats()]"), errs[:3]); raise
    pg.wait_for_timeout(2000)
    w=pg.evaluate("gia.closeup().stats().world")
    check('parks, woods, a pond, a river and its banks come from the map', w['parks']>=2 and w['woods']>=1 and w['water']>=3, w)
    check('the mapped trees and trees through parks and woods', w['mappedTrees']==160 and w['trees']>1000, w)
    check('street lamps along the roads, lane lines and crossings', w['lamps']>500 and w['marks']>1000, w)
    check('every building drawn, towers in glass, houses as houses', w['buildings']>=400 and w['glass']>20 and w['homes']>20, w)
    check('by day: no lamps on', w['night']<0.2 and not w['lampsOn'], w)
    h=pg.evaluate("location.hash")
    check('a close-up link keeps its height (not rounded to 0)', re.search(r'@-?[\d.]+,-?[\d.]+,0\.0003', h), h)
    before=pg.evaluate("gia.globe.pointOfView()")
    pg.click('#tilt'); pg.wait_for_timeout(3500)
    eff=pg.evaluate("gia.tilter().effective()"); after=pg.evaluate("gia.globe.pointOfView()"); sky=pg.evaluate("gia.tilter().sky()")
    check('the tilt button swings the view down by 60°', 57<eff<=60.01 and pg.get_attribute('#tilt','aria-pressed')=='true', eff)
    check('… while "where am I looking" stays the same', abs(after['lat']-before['lat'])<1e-6 and abs(after['lng']-before['lng'])<1e-6 and abs(after['altitude']-before['altitude'])<1e-6, (before, after))
    check('… with the sky above the horizon, and the link keeps the tilt', sky['visible'] and sky['k']>0.9 and '&t=60' in pg.evaluate("location.hash"), (sky, pg.evaluate("location.hash")))
    cx=pg.evaluate("(() => { const c = gia.globe.camera(); const r = c.position.length(); return r; })()")
    check('… and the camera is lower over the ground than straight above', cx < 100*(1+before['altitude'])-0.001, cx)
    pg.evaluate("void gia.globe.pointOfView({lat:20,lng:0,altitude:1.5},0)"); pg.wait_for_timeout(1500)
    check('zoomed out, the globe never tips over', pg.evaluate("gia.tilter().effective()")==0 and not pg.evaluate("gia.tilter().sky()")['visible'])
    pg.keyboard.press('v'); pg.wait_for_timeout(500)
    check('V turns the tilt off again', pg.evaluate("gia.tilter().get()")==0 and pg.get_attribute('#tilt','aria-pressed')=='false')
    # after dark
    n=night_place(pg)
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{n['lat']},lng:{n['lng']},altitude:0.0003}},0)"); pg.wait_for_timeout(9000)
    w=pg.evaluate("gia.closeup().stats().world")
    check('after dark the windows and the street lamps light up', w and w['night']>0.9 and w['lampsOn'], w)
    check('no page errors', not errs, errs[:3])
    pg.close()
    # a shared link opens tilted
    pg=b.new_page(viewport={'width':1280,'height':800}); pg.route('**/*', handler); pg.route('https://overpass-api.de/**', overpass)
    pg.goto(f"http://localhost:8765/app/#@{d['lat']},{d['lng']},0.0003&l=borders&s=1&t=50", wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.tilter && gia.tilter() && gia.tilter().effective() > 45", timeout=60000)
    check('a link with &t=50 opens tilted', True)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}'); sys.exit(0 if all(res) else 1)
