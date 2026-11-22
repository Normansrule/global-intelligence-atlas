# SPDX-License-Identifier: AGPL-3.0-only
# v2.33 in the app: no shards or blotches when zooming in (the backdrop under the map tiles never writes depth; the
# night shade is drawn over the ground up close), Companies in the news and "In the news" on country pages (credible
# outlets only, stories by angle, the countries they name), and Dock with the ISS you can look around in, with a view
# straight down at the Earth. tests/newsangles/test-newsangles.mjs checks the matching on its own.
import sys, os, json, datetime, base64
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.35');localStorage.setItem('gia-theme','dark')}catch(e){}"
now=datetime.datetime.now(datetime.timezone.utc)
iso=lambda m: (now-datetime.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
H=[('Apple shares fall after iPhone sales slow in China','bbc',5),('EU regulators fine Apple over App Store rules','guardian',30),
   ('Tim Cook meets the president at the White House','npr',60),('Apple wins appeal in Brussels court','aljazeera',70),
   ('Apple orchards hit by late frost','bbc',80),('France and Germany agree new budget rules','dw',90),
   ('French farmers protest outside parliament in Paris','france24',100),('Nvidia earnings beat forecasts as AI chip demand grows','cbc',110),
   ('Microsoft fined by EU competition regulator','guardian',120),('Floods hit southern France','bbc',130)]
HEAD={'updated': iso(3), 'items': [{'t':t,'u':f'https://example.org/{i}','at':iso(m),'p':p,'r':'world','f':f'{p}:0'} for i,(t,p,m) in enumerate(H)]}
def news(route):
    k=route.request.url.split('/news-data/')[1].split('?')[0]
    if k!='headlines.json': return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=200, body=json.dumps(HEAD), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwAEZgHmq4oFdwAAAABJRU5ErkJggg==')
tiles=[]
def tile(route): tiles.append(route.request.url); return route.fulfill(status=200, body=PNG, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'})
TEXT="() => { document.querySelectorAll('#notes-body details.qd-sec').forEach((d) => d.open = true); return document.querySelector('#notes-body')?.innerText ?? ''; }"
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
sw=open(os.path.join(ROOT, 'site/sw.js')).read()
check('the offline pack and the service worker have the new code', all(f'app/js/{m}.js' in pack and f"'app/js/{m}.js'" in sw for m in ['companynews', 'newsangles']))
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('**/news-data/**', news); pg.route(lambda u: 'World_Imagery/MapServer/tile/7/' in u, tile); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@46,3,1.2&l=borders,companynews', wait_until='commit'); pg.wait_for_timeout(11000)
    check('version 2.35', pg.evaluate("() => gia.VERSION")=='2.35')
    # zooming in: the backdrop never writes depth and is drawn first; the night shade drops its depth test up close
    z=pg.evaluate("""async () => { gia.setBase('imagery'); await new Promise((r) => setTimeout(r, 800)); let u = null, n = null; gia.globe.scene().traverse((o) => { if (o.name === 'under-tiles') u = o; if (o.name === 'night-shade') n = o; });
      const far = n.material.depthTest; gia.globe.pointOfView({ lat: 46, lng: 3, altitude: 0.02 }, 0); await new Promise((r) => setTimeout(r, 600)); const near = n.material.depthTest;
      gia.globe.pointOfView({ lat: 46, lng: 3, altitude: 1.2 }, 0); await new Promise((r) => setTimeout(r, 600));
      return { u: !!u && !u.material.depthWrite && u.renderOrder < 0 && u.children.some((c) => c.material.colorWrite === false && c.renderOrder < u.renderOrder), far, near, back: n.material.depthTest }; }""")
    check('the Earth under the map tiles never writes depth, so coarse tiles cannot be cut by it; a sphere below still hides the far side', z['u'], z)
    check('the night shade uses the depth test from far away and drops it below about 600 km', z['far'] and not z['near'] and z['back'], z)
    pg.evaluate("() => gia.setBase('daynight')")
    # Companies in the news
    d=pg.evaluate("() => { const d = gia.state.data.companynews; return d && { names: d.rows.map((r) => r.c.id), apple: d.rows.find((r) => r.c.id === 'apple')?.stories.length, n: d.headlines }; }")
    check('Companies in the news: Apple, Nvidia and Microsoft named, Apple most; the state-run outlet is not read', d and d['names'][0]=='apple' and {'apple','nvidia','microsoft'} <= set(d['names']) and d['n']==len(H)-1, d)
    check('Apple counts three stories: not its orchards, not the state-run outlet', d and d['apple']==3, d)
    pg.evaluate("() => gia.select({ layer: 'companynews', d: gia.state.data.companynews.rows.find((r) => r.c.id === 'apple') })"); pg.wait_for_timeout(1500)
    t=pg.evaluate(TEXT)
    a=pg.evaluate("() => ({ bar: document.querySelectorAll('#notes-body .na-bar i').length, angles: [...document.querySelectorAll('#notes-body .na-angle h5')].map((h) => h.firstChild.textContent.trim()), links: [...document.querySelectorAll('#notes-body .na-list a')].map((a) => [a.target, a.rel]), cc: [...document.querySelectorAll('#notes-body [data-country-cc]')].map((e) => e.dataset.countryCc) })")
    check('Apple’s page: its stories grouped by angle (politics, economy, courts), with a bar of the angles', 'Apple in the news' in t and a['bar']==3 and a['angles']==['Politics and government','Economy, business and markets','Courts and regulation'], (a, t[:400]))
    check('each story opens at the publisher, in a new tab without passing the opener', a['links'] and all(x==['_blank','noopener noreferrer'] for x in a['links']), a['links'])
    check('where Apple’s stories are: China, as a button that opens its page', a['cc']==['CN'], a['cc'])
    check('the page says where the stories come from and that the angle is a guide', 'state-controlled outlets left out' in t and 'treat it as a guide' in t, t[-500:])
    pg.screenshot(path=os.path.join(os.environ.get('SHOT_DIR', '/tmp'), 'v233-apple.png'))
    pg.evaluate("() => document.querySelector('#notes-body [data-country-cc=\"CN\"]').click()"); pg.wait_for_timeout(5000)
    check('… and that button opens China’s country page', pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText ?? ''").endswith('China'), pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText"))
    # "In the news" on a country page
    pg.evaluate("() => { gia.surfaceClick(46.5, 2.5, gia.countryAt(46.5, 2.5)); }"); pg.wait_for_timeout(5000)
    t=pg.evaluate(TEXT)
    n=pg.evaluate("() => [...document.querySelectorAll('#cd-news .na-list a')].map((a) => a.textContent)")
    check('France’s page: In the news, by its name, its people (French) and its capital', 'In the news' in t and set(n)=={'France and Germany agree new budget rules','French farmers protest outside parliament in Paris','Floods hit southern France'}, (n, t[:300]))
    check('… sorted into economy, people and society, and climate', [x for x in pg.evaluate("() => [...document.querySelectorAll('#cd-news .na-angle')].map((e) => e.className.split('na-')[2]?.trim())")]==['economy','climate','society'], pg.evaluate("() => [...document.querySelectorAll('#cd-news .na-angle')].map((e) => e.className)"))
    pg.screenshot(path=os.path.join(os.environ.get('SHOT_DIR', '/tmp'), 'v233-country.png'))
    # Dock with the ISS: look around, pause, the Earth below
    o=pg.evaluate("""async () => { const m = await import('/app/js/docking.js'); const d = await m.openDocking({ iss: () => ({ lat: 48.85, lng: 2.35, altKm: 420, over: 'France' }), placeName: (lat, lng) => gia.countryAt(lat, lng)?.properties?.name ?? null });
      await new Promise((r) => setTimeout(r, 2500)); const g = d.below(); return { lat: g.lat, lng: g.lng, text: document.querySelector('.dock-below').textContent, views: document.querySelector('[data-view]').textContent }; }""")
    check('the ground below is the station’s real place (within 0.5°), named', abs(o['lat']-48.85) < 0.5 and abs(o['lng']-2.35) < 0.5 and 'France' in o['text'] and '48.' in o['text'], o)
    pg.wait_for_timeout(2500)
    check('sharp satellite imagery under the station: a 5 × 5 block of zoom-7 tiles around it', len(set(tiles)) >= 25 and pg.evaluate("async () => { const d = await (await import('/app/js/docking.js')).openDocking(); for (let i = 0; i < 40 && d.patches() < 25; i++) await new Promise((r) => setTimeout(r, 250)); return d.patches(); }") == 25, (len(set(tiles)), tiles[:2]))
    box=pg.evaluate("() => { const r = document.querySelector('.dock canvas').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
    pg.mouse.move(*box); pg.mouse.down(); pg.mouse.move(box[0]+200, box[1]+60, steps=8); pg.mouse.up(); pg.mouse.wheel(0, 400); pg.wait_for_timeout(300)
    l=pg.evaluate("async () => { const d = await (await import('/app/js/docking.js')).openDocking(); return { ...d.look }; }")
    check('dragging swings the view round and scrolling pulls it out', l['yaw'] < -0.8 and l['pitch'] < -0.2 and l['zoom'] > 1.3, l)
    pg.mouse.dblclick(*box); pg.wait_for_timeout(200)
    l=pg.evaluate("async () => { const d = await (await import('/app/js/docking.js')).openDocking(); return { ...d.look }; }")
    check('double-click puts the view back', l['yaw']==0 and l['pitch']==0 and l['zoom']==1, l)
    pg.keyboard.press(' '); t0=pg.evaluate("async () => (await (await import('/app/js/docking.js')).openDocking()).state().t"); pg.wait_for_timeout(800)
    t1=pg.evaluate("async () => (await (await import('/app/js/docking.js')).openDocking()).state().t")
    check('Space pauses time so you can look around (and says so on its button)', t1==t0 and pg.evaluate("() => document.querySelector('[data-pause]').getAttribute('aria-pressed')")=='true', (t0, t1))
    for _ in range(3): pg.keyboard.press('c')
    pg.wait_for_timeout(600)
    v=pg.evaluate("""async () => { const d = await (await import('/app/js/docking.js')).openDocking(); d.frame(0.016); return { view: d.view(), label: document.querySelector('[data-view]').textContent }; }""")
    check('C now has a fourth view: the Earth below, from the station’s Earth-facing side', v['view']=='Earth below' and v['label']=='View: Earth below', v)
    pg.screenshot(path=os.path.join(os.environ.get('SHOT_DIR', '/tmp'), 'v233-dock-below.png'))
    pg.mouse.move(*box); pg.mouse.down(); pg.mouse.move(box[0], box[1]+260, steps=8); pg.mouse.up(); pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(os.environ.get('SHOT_DIR', '/tmp'), 'v233-dock-look.png'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc still closes it', not pg.evaluate("() => !!document.querySelector('.dock')"))
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('Companies in the news') && s.includes('data-ix-layer=\"companynews\"'); }")
    check("What's new has a Try button for Companies in the news", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
