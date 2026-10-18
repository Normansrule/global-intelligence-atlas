# Worldwide webcam layer: density when far, cells and pins when near, a camera opens, no page errors, draw calls stay low.
#   bash tests/e2e/run.sh webcams.py
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
def h(route):
    u=route.request.url
    if 'localhost' not in u and any(x in u for x in ('windy.com','.jpg','.png','.gif','m3u8')): return route.fulfill(status=404, body='')
    return handler(route)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', h); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.11')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@46,10,2.2&l=borders,webcams', wait_until='commit'); pg.wait_for_timeout(14000)
    d = pg.evaluate("() => { const d=gia.state.data.webcams; return d && {density: d.density?.length, total: d.total}; }")
    check('density grid when far out', d and d['density'] and d['density'] > 500, d)
    calls_far = pg.evaluate("() => gia.globe.renderer().info.render.calls")
    pg.evaluate("() => gia.globe.pointOfView({lat:47.3,lng:11.4,altitude:0.25},0)"); pg.wait_for_timeout(6000)
    n = pg.evaluate("() => gia.state.data.webcams?.cams?.length ?? 0")
    check('cells load near the Alps', n > 2000, n)
    calls_near = pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay batched', calls_near < 90, {'far': calls_far, 'near': calls_near})
    c = pg.evaluate("() => { const c=gia.state.data.webcams.cams.find(x=>x.img); gia.select({layer:'webcams', d:c}); return c && {id:c.id, src:c.source, img:c.img.slice(0,60)}; }"); pg.wait_for_timeout(1500)
    t = pg.evaluate("() => ({title: document.querySelector('#notes h3')?.textContent, kicker: document.querySelector('#notes .kicker')?.textContent, img: !!document.getElementById('cam-img')?.src})")
    check('a webcam opens with its publisher', t['title'] and t['kicker'] == c['src'] and t['img'], (c, t))
    s = pg.evaluate("() => { const c=gia.state.data.webcams.cams.find(x=>x.stream && !x.img); if(!c) return 'none'; gia.select({layer:'webcams', d:c}); return c.id; }"); pg.wait_for_timeout(1500)
    if s != 'none': check('stream-only webcam hides the empty still', pg.evaluate("() => document.getElementById('cam-img')?.hidden === true"), s)
    pg.evaluate("() => gia.state.opts.webcams.show = 'traffic'"); pg.evaluate("() => gia.refreshLayer('webcams')"); pg.wait_for_timeout(3000)
    n2 = pg.evaluate("() => gia.state.data.webcams?.cams?.length ?? 0")
    check('filter narrows the list', 0 < n2 < n, (n, n2))
    check('no page errors', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(ok for _, ok in res)} / {len(res)}")
