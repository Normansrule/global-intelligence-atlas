# SPDX-License-Identifier: AGPL-3.0-only
# v2.35 Countries in the news (companynews.js countryNewsLayer): each country shaded by how many credible headlines
# name it, coloured by their main angle; clicking one lists its stories and opens its page.
import sys, os, json, datetime
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
SHOTS=os.environ.get('SHOT_DIR', '/tmp')
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
now=datetime.datetime.now(datetime.timezone.utc)
iso=lambda m: (now-datetime.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
H=[('Russian drones strike Kyiv overnight','bbc',5),('Ukraine and Russia agree prisoner swap','guardian',20),('Kremlin rejects ceasefire plan','npr',40),
   ('Taiwan shares hit record as chip exports grow','cbc',50),('Election called in Japan after budget row','dw',60),('Tokyo markets fall','bbc',70),
   ('Brazilian court bans social media app','guardian',80),('Iranian protesters rally in Tehran','aljazeera',90),('Floods hit Kenya','bbc',100)]
HEAD={'updated': iso(3), 'items': [{'t':t,'u':f'https://example.org/{i}','at':iso(m),'p':p,'r':'world','f':f'{p}:0'} for i,(t,p,m) in enumerate(H)]}
def news(route):
    k=route.request.url.split('/news-data/')[1].split('?')[0]
    if k!='headlines.json': return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=200, body=json.dumps(HEAD), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('**/news-data/**', news); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@40,60,1.8&l=borders,countrynews', wait_until='commit'); pg.wait_for_timeout(11000)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    d=pg.evaluate("() => { const d = gia.state.data.countrynews; return d && { rows: d.rows.map((r) => [r.cc, r.stories.length]), n: d.headlines }; }")
    rows=dict(d['rows']) if d else {}
    check('Countries in the news: Russia and Ukraine most named (Kremlin, Kyiv, Russian), the state-run outlet not read', d and d['n']==len(H)-1 and rows.get('RU')==3 and rows.get('UA')==2 and 'IR' not in rows, d)
    check('Taiwan counts although the outline file has no code for it; Japan by name and by Tokyo', rows.get('TW')==1 and rows.get('JP')==2, rows)
    pol=pg.evaluate("() => gia.globe.polygonsData().filter((x) => x.ref?.layer === 'countrynews').map((x) => [x.ref.d.cc, x.cap])")
    caps=dict(pol)
    check('each country named is shaded on the globe, Russia most strongly, in the conflict colour', len(pol)==len(rows) and caps['RU'].startswith('#f07a63') and int(caps['RU'][-2:],16) > int(caps['KE'][-2:],16), pol)
    pg.evaluate("() => gia.select({ layer: 'countrynews', d: gia.state.data.countrynews.rows.find((r) => r.cc === 'RU') })"); pg.wait_for_timeout(1500)
    t=pg.evaluate("() => document.querySelector('#notes-body')?.innerText ?? ''")
    check('Russia’s card: its stories by angle and a button to its page', 'Russia in the news' in t and 'CONFLICT AND SECURITY' in t.upper() and pg.evaluate("() => !!document.querySelector('#notes-body [data-country-cc=\"RU\"]')"), t[:500])
    pg.screenshot(path=os.path.join(SHOTS, 'v235-countries.png'))
    pg.evaluate("() => document.querySelector('#notes-body [data-country-cc=\"RU\"]').click()"); pg.wait_for_timeout(5000)
    check('… which opens Russia’s country page with In the news', pg.evaluate("() => (document.querySelector('#notes-body h3')?.innerText ?? '').endsWith('Russia') && !!document.querySelector('#cd-news')"))
    ed=pg.evaluate("async () => { const r = await import('/app/js/registry.js'); return r.EDITIONS.classroom.exclude; }")
    check('the classroom edition leaves the news layers out, as it does the news pins', 'countrynews' in ed and 'companynews' in ed, ed)
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('ountries in the news') && s.includes('data-ix-layer=\"countrynews\"'); }")
    check("What's new has a Try button for Countries in the news", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
