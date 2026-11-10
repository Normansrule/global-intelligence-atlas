# SPDX-License-Identifier: AGPL-3.0-only
# v2.18 close-ups closer to life: traffic that keeps its distance, brakes, pulls away and queues at red lights;
# ships with a foam wake at the Kelvin angle; navigation lights on ships and head and tail lights on vehicles after dark.
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
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://overpass-api.de/**', overpass)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@59.9,24.5,1.2&b=bluemarble&l=borders,ships', wait_until='commit')
    pg.wait_for_function("() => window.gia && (gia.state.data.ships||[]).length > 50", timeout=40000)
    # the driving model on its own: one 300 m town road, twelve cars, a minute of simulated time
    sim=pg.evaluate("""async () => { const m = await import('./js/closeup.js');
      const road = { cls: 'primary', pts: [[0, 0], [300, 0]], cum: [0, 300], len: 300, lanes: 1, oneway: true };
      const cars = Array.from({ length: 12 }, (_, i) => ({ w: 0, s: i * 22, dir: 1, lane: 0, v: 13, kind: 0 }));
      let minGap = 1e9; let stopped = 0; let past = 0; let jerk = 0; let prev = cars.map((c) => c.cur ?? 13);
      for (let t = 0; t < 60; t += 0.05) { m.followTraffic(cars, [road], 0.05, t);
        const red = Math.floor(t / 30) % 2 === 1;
        const s = cars.map((c) => c.s).sort((a, b) => a - b); for (let i = 1; i < s.length; i++) minGap = Math.min(minGap, s[i] - s[i - 1] - 4.5);
        if (red && t > 40) { stopped = Math.max(stopped, cars.filter((c) => c.cur === 0).length); past = Math.max(past, cars.filter((c) => c.cur === 0 && c.s > 300 - 2.25 - 2.9 && c.s < 299).length); }
        cars.forEach((c, i) => { jerk = Math.max(jerk, Math.abs(c.cur - prev[i]) / 0.05); prev[i] = c.cur; }); }
      return { minGap, stopped, past, jerk }; }""")
    check('vehicles never run into the one ahead', sim['minGap'] > 0.5, sim)
    check('a red light makes a queue', sim['stopped'] >= 3, sim)
    check('… and the first car stops at the line, not past it', sim['past'] == 0, sim)
    check('they speed up and brake like cars (at most 6 m/s²)', sim['jerk'] <= 6.01, sim)
    s=pg.evaluate("(()=>{const s=gia.state.data.ships.find(x=>x.sog>5);return s&&{lat:s.lat,lng:s.lng,mmsi:s.mmsi}})()")
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{s['lat']},lng:{s['lng']},altitude:0.003}},0)"); pg.wait_for_timeout(3000)
    st=pg.evaluate("gia.closeup()?.stats()")
    check('a moving ship draws a foam wake', st and st['wakes']>=1, st)
    g=pg.evaluate("""async () => { const m = await import('./js/closeup.js'); const a = m.wakeGeometry(200, 32, 5).attributes.position; const b = m.wakeGeometry(200, 32, 18).attributes.position;
      const ext = (p) => { let mn = 1e9; for (let i = 0; i < p.count; i++) mn = Math.min(mn, p.getX(i)); return -mn; }; return [ext(a), ext(b)]; }""")
    check('the wake grows with speed', g[1] > g[0] > 100, g)
    # after dark: put a ship and the street where it is night now
    night=pg.evaluate("async () => { const a = await import('./js/astro.js'); const s = a.subsolarPoint(new Date()); let lng = s.lng + 180; if (lng > 180) lng -= 360; return { lat: Math.max(-55, Math.min(55, -s.lat)), lng }; }")
    pg.evaluate(f"() => {{ gia.state.data.ships.push({{ mmsi: 999999001, lat: {night['lat']}, lng: {night['lng']}, sog: 12, cog: 45, hdg: 45, t: Date.now(), name: 'NIGHT TEST', type: 70, len: 180, beam: 28 }}); }}")
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{night['lat']},lng:{night['lng']},altitude:0.003}},0)"); pg.wait_for_timeout(12000)
    st=pg.evaluate("gia.closeup()?.stats()")
    check('after dark ships carry their navigation lights', st and st['night'] and st['shipLamps']>=1, st)
    pg.evaluate(f"void gia.globe.pointOfView({{lat:{night['lat']},lng:{night['lng']},altitude:0.0003}},0)"); pg.wait_for_timeout(5000)
    st=pg.evaluate("gia.closeup()?.stats()")
    check('… and vehicles their head and tail lights', st and st['carLamps']>=40 and st['carLamps']==4*min(st['vehicles'],2000), st)
    pg.evaluate("void gia.globe.pointOfView({lat:60.17,lng:24.94,altitude:0.0003},0)"); pg.wait_for_timeout(9000)
    st=pg.evaluate("gia.closeup()?.stats()")
    check('in town, some traffic waits at red lights', st and st['stopped']>=1 and st['vehicles']>100, st)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}'); sys.exit(0 if all(res) else 1)
