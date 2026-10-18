import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.10: the Global Intelligence Atlas (GIA) repository launch: branding and browser tuning (modulepreload, service-worker cache).
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.11')}catch(e){}"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&l=borders,cables', wait_until='commit'); pg.wait_for_timeout(10000)
    check('version 2.11', pg.evaluate("() => gia.VERSION")=='2.11')
    check('title names Global Intelligence Atlas (GIA)', 'Global Intelligence Atlas (GIA)' in pg.title(), pg.title())
    pre=pg.evaluate("() => [...document.querySelectorAll('link[rel=modulepreload]')].map(l => l.href)")
    check('modulepreload hints for the engine and the first modules', len(pre)>=5 and any(u.endswith('vendor/vendor.min.mjs') for u in pre) and any(u.endswith('js/main.js') for u in pre), pre)
    used=pg.evaluate("() => performance.getEntriesByType('resource').map(e => e.name)")
    check('every preloaded file is one the app really loads (no wasted download)', all(u in used for u in pre), [u for u in pre if u not in used])
    imports=pg.evaluate("async () => { const r = await fetch('js/main.js'); const t = await r.text(); return [...t.matchAll(/from '\\.\\/([a-z-]+\\.js)'/g)].map(m => m[1]) }")
    check('every preloaded app module is imported by main.js', all(u.split('/js/')[1] in imports for u in pre if '/js/' in u and not u.endswith('/main.js')), imports[:8])
    ok=pg.evaluate("async () => { const rs = await Promise.all([...document.querySelectorAll('link[rel=modulepreload]')].map(l => fetch(l.href))); return rs.every(r => r.ok) }")
    check('preloaded files exist', ok)
    sw=pg.evaluate("async () => (await fetch('../sw.js')).text()")
    check('service worker cache is v2.10', "global-intelligence-atlas-v2.10'" in sw)
    heavy=pg.evaluate("async () => { const t = await (await fetch('../sw.js')).text(); const re = new RegExp(t.match(/const HEAVY = \\/(.*)\\/;/)[1]); return ['/global-intelligence-atlas/app/vendor/vendor.min.mjs', '/global-intelligence-atlas/app/textures/earth-night-2k.jpg', '/global-intelligence-atlas/site/docs-media/home.jpg'].every(p => re.test(p)) && !['/global-intelligence-atlas/app/js/main.js', '/global-intelligence-atlas/app/config.json', '/global-intelligence-atlas/app/data/worldmonitor-static.json'].some(p => re.test(p)) }")
    check('cache-first only for heavy files; code, config and data stay network-first', heavy)
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay batched', calls < 120, calls)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,o in res if o)} / {len(res)}")
