import sys, base64; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
SP=sys.argv[-1]; TILE=open(f'{SP}/tile.jpg','rb').read(); res=[]
def h(route):
    u=route.request.url
    if 'gdeltproject' in u: return route.abort('failed')   # browsers blocked by CORS
    if 'arcgisonline' in u or 'tile.openstreetmap' in u: return route.fulfill(status=200, body=TILE, headers={'Content-Type':'image/jpeg','Access-Control-Allow-Origin':'*'})
    return handler(route)
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', h); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-quality','high');localStorage.setItem('global-intelligence-atlas-version','1.11')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,10,2.2&l=sun,borders,cities,news,quakes,aircraft', wait_until='commit'); pg.wait_for_timeout(16000)
    check('version 2.11', pg.evaluate("() => gia.VERSION")=='2.11')
    st = pg.evaluate("() => ({n: gia.state.data.news?.items?.length, err: gia.state.lstatus?.news})")
    check('news loads from snapshot when GDELT is blocked', (st['n'] or 0) > 0, st)
    w = pg.evaluate("() => [...document.querySelectorAll('.newlist > span')].map(s => s.getBoundingClientRect().width)")
    check("what's new text is not squashed", w and min(w) > 200, w[:3])
    # wheel zoom towards cursor
    pg.evaluate("() => gia.globe.pointOfView({lat:30,lng:10,altitude:0.8},0)"); pg.wait_for_timeout(1500)
    r = pg.evaluate("() => { const r=document.getElementById('globe').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    cx, cy = r[0]+r[2]*0.75, r[1]+r[3]*0.5
    target = pg.evaluate(f"() => gia.globe.toGlobeCoords({r[2]*0.75},{r[3]*0.5})")
    pg.mouse.move(cx, cy)
    for _ in range(6): pg.mouse.wheel(0, -100); pg.wait_for_timeout(60)
    pg.wait_for_timeout(1500)
    pov = pg.evaluate("() => gia.globe.pointOfView()")
    check('wheel zooms in', pov['altitude'] < 0.8*0.4, pov)
    check('wheel zooms towards the cursor', abs(pov['lng']-target['lng']) < abs(10-target['lng'])*0.7, (target, pov))
    after = pg.evaluate(f"() => gia.globe.toGlobeCoords({r[2]*0.75},{r[3]*0.5})")
    check('point under cursor stays near', abs(after['lng']-target['lng']) < 2.0 and abs(after['lat']-target['lat']) < 2.0, after)
    for _ in range(40): pg.mouse.wheel(0, -100); pg.wait_for_timeout(30)
    pg.wait_for_timeout(2500)
    a = pg.evaluate("() => gia.globe.pointOfView().altitude")
    check('about 40 notches reach street level', a < 0.0006, a)
    # imagery switches in mid-zoom
    pg.evaluate("() => gia.globe.pointOfView({lat:30,lng:10,altitude:0.5},0)"); pg.wait_for_timeout(1500)
    check('sharp tiles at 0.5', pg.evaluate("() => gia.state.detailTiles")=='imagery')
    pg.evaluate("() => gia.globe.pointOfView({lat:30,lng:10,altitude:1.6},0)"); pg.wait_for_timeout(1500)
    check('globe picture again when far', pg.evaluate("() => gia.state.detailTiles") is None)
    # zoom-to-street button on a quake card
    pg.evaluate("() => { const q=gia.state.data.quakes; const d=(q.items??q.features??q)[0]; gia.select({layer:'quakes', d}); }"); pg.wait_for_timeout(1200)
    has = pg.evaluate("() => !!document.querySelector('#notes-body [data-zoomto]')")
    check('cards have zoom buttons', has)
    if has:
        pg.click('#notes-body [data-zoomto$=",street"]'); pg.wait_for_timeout(3000)
        a = pg.evaluate("() => gia.globe.pointOfView().altitude"); check('zoom to street level', a < 0.0005, a)
    # planes: 2D far, 3D close
    pg.evaluate("() => gia.globe.pointOfView({lat:40,lng:-95,altitude:2},0)"); pg.wait_for_timeout(2500)
    far = pg.evaluate("() => gia.planeCounts()")
    pg.evaluate("() => gia.globe.pointOfView({lat:40.6,lng:-74,altitude:0.05},0)"); pg.wait_for_timeout(2500)
    near = pg.evaluate("() => gia.planeCounts()")
    check('planes drawn by class far away', sum(far.values()) > 1000, far)
    check('only nearby planes drawn up close', 0 < sum(near.values()) < sum(far.values())/5, near)
    pg.evaluate("() => gia.globe.pointOfView({lat:47,lng:-74,altitude:0.05},0)"); pg.wait_for_timeout(2500)
    near2 = pg.evaluate("() => gia.planeCounts()")
    check('panning up close re-lays planes', near2 != near, near2)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(1 for _,o in res if o), '/', len(res))
