# SPDX-License-Identifier: AGPL-3.0-only
# v2.39 Wildfire tracker (wildfire.js, firetracker.js, fireview.js): hot spots coloured by age, grouped into fires,
# a fire's page with its spread played back on a map and the globe, the biggest fires list, and the view from the ground.
import sys, os, json, time, math
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS, _png_px, _terrarium
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
SHOTS=os.environ.get('SHOT_DIR', '/tmp')
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.39');localStorage.setItem('gia-theme','dark')}catch(e){}"
now=int(time.time()*1000); MIN=60000
# A fire in northern California that runs east about 1 km every 12-hour pass for three days (six passes).
LAT, LNG = 39.70, -121.60; KLNG = 111.32*math.cos(math.radians(LAT))
def fire_rows(passes):
    out=[]
    for p in passes:
        tm=(now-(62-p*12)*3600000)//MIN
        for i in range(6):
            for j in range(4): out.append([round(LAT+(j-1.5)*0.375/110.574,4), round(LNG+(p+i*0.25)/KLNG,4), 15+5*i, 1, tm+i, p%2])
    return out
LIVE=fire_rows([4,5]); OLD=fire_rows([0,1,2,3])
FIRES=json.dumps({"generatedAt":"%s"%time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now/1000-600)),"src":"NASA FIRMS · VIIRS NOAA-20, global 24 hours","fields":['lat','lng','frp','conf','t','day'],"rows":LIVE+[[-10.0,25.0,4,1,(now-3600000)//MIN,1]]})
la0=round(LAT,3); lo0=round(LNG,3)
SPREAD=json.dumps({"generatedAt":"x","src":"NASA FIRMS · VIIRS NOAA-20, global 7 days","fields":[],"fires":[[la0,lo0,[[round((r[0]-la0)*1000),round((r[1]-lo0)*1000),r[2],r[3],r[4],r[5]] for r in OLD+LIVE]]]})
HILLS=_png_px(256,256,lambda x,y: _terrarium(int(420+60*math.sin(2*math.pi*x/256)*math.cos(2*math.pi*y/256))))
def local(route):
    u=route.request.url
    if 'elevation-tiles-prod/terrarium/' in u: return route.fulfill(status=200, body=HILLS, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'})
    if '/live-data/fires-spread.json' in u: return route.fulfill(status=200, body=SPREAD, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    if '/live-data/fires.json' in u: return route.fulfill(status=200, body=FIRES, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    return handler(route)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', local); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@39.7,-121.5,0.08&l=borders,fires', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.state && gia.state.data.fires", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.39', pg.evaluate("() => gia.VERSION")=='2.39')
    c=pg.evaluate("() => gia.state.chan.fires?.particles?.map((p) => [p.color, p.pts.length])")
    check('hot spots are coloured by age by default (newest pale yellow)', c and c[0][0].lower()=='#fff2a8' and sum(n for _,n in c)==len(LIVE)+1, c)
    peak=max(LIVE, key=lambda r: r[2])
    pg.evaluate("(r) => gia.select({ layer: 'fires', d: gia.state.data.fires.rows.find((q) => q[0] === r[0] && q[1] === r[1] && q[4] === r[4]) })", peak)
    pg.wait_for_function("() => document.querySelector('#wf-map svg')", timeout=20000); pg.wait_for_timeout(500)
    t=pg.evaluate("() => document.querySelector('#wf-track').innerText")
    check('the page of the whole fire: its area, hot spots and that it is spreading east', 'km²' in t and str(len(OLD+LIVE)) in t and 'spreading east' in t, t[:500])
    check('… from 7 days of data, six satellite passes', 'up to 7 days' in t and 'pass 6 of 6' in t, t[-600:])
    check('… with the fire weather', 'Wind' in t and 'km/h' in t, t[:800])
    sq=pg.evaluate("() => document.querySelectorAll('#wf-map svg rect[x]').length")
    check('the map shows every detection', sq==len(OLD+LIVE), sq)
    g=pg.evaluate("() => (gia.state.chan.fires.points || []).length")
    check('the whole fire is drawn on the globe, with its outline', g >= len(OLD+LIVE) and len(pg.evaluate("() => gia.state.chan.fires.paths || []"))==1, g)
    pg.evaluate("() => { const s = document.querySelector('#wf-t'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); }"); pg.wait_for_timeout(400)
    sq0=pg.evaluate("() => document.querySelectorAll('#wf-map svg rect[x]').length"); g0=pg.evaluate("() => (gia.state.chan.fires.points || []).length")
    check('scrubbing to the first pass shows only that pass, on the map and on the globe', sq0==24 and g0 < g, (sq0, g0))
    pg.click('[data-wf-play]'); pg.wait_for_timeout(1600)
    check('Play runs the passes in order', 'pass 3 of 6' in pg.evaluate("() => document.querySelector('#wf-when').textContent") or 'pass 2 of 6' in pg.evaluate("() => document.querySelector('#wf-when').textContent"), pg.evaluate("() => document.querySelector('#wf-when').textContent"))
    pg.wait_for_timeout(3500)
    check('… and stops at the latest', 'pass 6 of 6' in pg.evaluate("() => document.querySelector('#wf-when').textContent"))
    pg.screenshot(path=os.path.join(SHOTS, 'v239-fire.png'))
    pg.click('[data-wf-stand="180"]')
    pg.wait_for_function("() => window.gia.fireview", timeout=20000)
    pg.evaluate("() => gia.fireview.ready"); pg.wait_for_timeout(2500)
    v=pg.evaluate("() => ({ counts: gia.fireview.counts(), st: gia.fireview.state, look: document.querySelector('.fv-look')?.textContent, note: document.querySelector('.fv-note')?.textContent, calls: gia.fireview.info()?.calls })")
    check('in person: standing south of the fire, looking north', v['look'].startswith('Looking north') and abs(v['st']['yaw']) < 1, v['look'])
    check('… with flames, the glow of the fire line and smoke', v['counts']['flames'] > 48 and v['counts']['glows']==24 and v['counts']['smoke'] > 0, v['counts'])
    check('… on the real ground, burnt ground darkened', v['st'].get('burntVertices', 0) > 0 and 'burnt ground darkened' in v['note'], v)
    pg.click('[data-fv="closer"]'); pg.wait_for_timeout(200)
    check('Walk closer moves you 250 m nearer', abs(pg.evaluate("() => gia.fireview.state.dist") - v['st']['dist'] + 250) < 1)
    pg.click('[data-fv="full"]'); pg.wait_for_timeout(600)
    check('Full screen fills the window', pg.evaluate("() => document.querySelector('.fv-overlay .fv-canvas')?.getBoundingClientRect().width ?? 0") > 1300)
    pg.screenshot(path=os.path.join(SHOTS, 'v239-inperson.png'))
    pg.select_option('.fv-overlay [data-fv-h]', '2'); pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(SHOTS, 'v239-heli.png'))
    check('… or from a helicopter, 450 m up and looking down at it', pg.evaluate("() => gia.fireview.state.hi")==2 and pg.evaluate("() => gia.fireview.state.pitch") < 0)
    pg.click('[data-fv="full"]'); pg.wait_for_timeout(300)
    pg.click('.rail [data-section=tools]'); pg.wait_for_timeout(300)
    if not pg.evaluate("() => document.body.classList.contains('left-open')"): pg.click('.rail [data-section=tools]'); pg.wait_for_timeout(300)
    pg.click('#sect-tools [data-tool=wildfires]'); pg.wait_for_function("() => document.querySelector('#sect-tools [data-wf-fire]')", timeout=15000)
    n=pg.evaluate("() => document.querySelectorAll('#sect-tools [data-wf-fire]').length")
    check('Tools → Wildfire tracker lists the fire (and not the lone hot spot)', n==1, n)
    nw=pg.evaluate("async () => { const s = await (await fetch('js/main.js')).text(); return s.includes('A wildfire tracker') && s.includes('data-tool=\"wildfires\"'); }")
    check("What's new has a Try button for the wildfire tracker", nw)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
