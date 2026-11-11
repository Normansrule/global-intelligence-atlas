# SPDX-License-Identifier: AGPL-3.0-only
# v2.15: Air quality (Open-Meteo / CAMS, mocked), US weather warnings (NWS, mocked, with a zone-based alert and an
# expired one), the snapshot fallbacks for both, the air at any clicked spot, the sound button and Listen.
import sys, json, time, re
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
iso=lambda s: time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time()+s))
down={'aq':False,'nws':False}; calls=[]

def aq_value(lat, lng):
    # Delhi-ish places very bad, the rest by latitude band, so every colour shows
    if abs(lat-28.6)<1.5 and abs(lng-77.2)<1.5: return 182
    return [22, 64, 120, 160, 240, 35][int(abs(lat)//12) % 6]
def air(route):
    u=route.request.url; calls.append(u)
    if down['aq']: return route.abort()
    q=parse_qs(urlparse(u).query); lats=[float(x) for x in q['latitude'][0].split(',')]; lngs=[float(x) for x in q['longitude'][0].split(',')]
    def one(lat, lng):
        a=aq_value(lat, lng); pm=a*0.35
        cur={'time':'2026-11-09T06:00','us_aqi':a,'european_aqi':a*0.6,'pm2_5':pm,'pm10':pm*1.6,'ozone':60,'nitrogen_dioxide':18,'sulphur_dioxide':4,'carbon_monoxide':300,'dust':80 if a==240 else 2,'uv_index':3.4,
             'us_aqi_pm2_5':a,'us_aqi_pm10':a*0.7,'us_aqi_ozone':40,'us_aqi_nitrogen_dioxide':20,'us_aqi_sulphur_dioxide':5,'us_aqi_carbon_monoxide':3,'grass_pollen':35,'birch_pollen':0.2}
        r={'latitude':lat,'longitude':lng,'utc_offset_seconds':0,'current':cur}
        if 'hourly=' in u:
            t0=int(time.time()//3600*3600)-24*3600; hs=[time.strftime('%Y-%m-%dT%H:00', time.gmtime(t0+i*3600)) for i in range(24*6)]
            vals=[max(5, a+40*((i%24)-12)/12*(-1 if (i%24)<12 else 1)) for i in range(len(hs))]
            r['hourly']={'time':hs,'us_aqi':vals,'pm2_5':[v*0.35 for v in vals],'uv_index':[3]*len(hs)}
        return r
    out=[one(a,b) for a,b in zip(lats,lngs)]
    return route.fulfill(status=200, headers=H, body=json.dumps(out if len(out)>1 else out[0]))

SQ=lambda a,b,c,d: {'type':'Polygon','coordinates':[[[b,a],[d,a],[d,c],[b,c],[b,a]]]}
def feat(i, event, sev, urg, cert, geom, ends=7200, onset=-1800, zones=None, instruction='Move to a basement or an interior room on the lowest floor.'):
    return {'id':f'https://api.weather.gov/alerts/urn:oid:test.{i}','type':'Feature','geometry':geom,'properties':{
        'id':f'https://api.weather.gov/alerts/urn:oid:test.{i}','areaDesc':'Dallas, TX; Tarrant, TX' if i==1 else f'Area {i}','sent':iso(-3600),'effective':iso(-3600),'onset':iso(onset),'expires':iso(ends),'ends':iso(ends),
        'status':'Actual','messageType':'Alert','category':'Met','severity':sev,'certainty':cert,'urgency':urg,'event':event,'senderName':'NWS Fort Worth TX',
        'headline':f'{event} issued','description':'At 1:05 AM CDT, a severe thunderstorm capable of producing a tornado was located near Dallas.\n\nHAZARD...Tornado.','instruction':instruction,'response':'Shelter',
        'parameters':{'NWSheadline':[f'{event.upper()} IN EFFECT']},'affectedZones':zones or [f'https://api.weather.gov/zones/forecast/TXZ{100+i}']}}
NWS={'type':'FeatureCollection','features':[
  feat(1,'Tornado Warning','Extreme','Immediate','Observed',SQ(32.4,-97.6,33.2,-96.4),zones=['https://api.weather.gov/zones/forecast/TXZ119']),
  feat(2,'Severe Thunderstorm Watch','Severe','Expected','Possible',SQ(31.5,-99,34.5,-95.5),ends=4*3600,zones=['https://api.weather.gov/zones/forecast/TXZ119']),
  feat(3,'Winter Storm Warning','Severe','Expected','Likely',None,ends=20*3600,zones=['https://api.weather.gov/zones/forecast/COZ034','https://api.weather.gov/zones/forecast/COZ035'],instruction=None),
  feat(4,'Wind Advisory','Minor','Expected','Likely',SQ(40,-105,41,-104)),
  feat(5,'Flood Warning','Moderate','Expected','Likely',SQ(30,-91,31,-90),ends=-600),
]}
def nws(route):
    u=route.request.url; calls.append(u)
    if down['nws']: return route.abort()
    if '/zones/forecast/COZ' in u:
        z=u.rsplit('/',1)[1]; o=0 if z.endswith('34') else 1
        return route.fulfill(status=200, headers=H, body=json.dumps({'id':u,'geometry':SQ(39+o,-107,40+o,-105.5)}))
    if '/zones/' in u: return route.fulfill(status=404, headers=H, body='{}')
    if '/alerts/active' in u: return route.fulfill(status=200, headers=H, body=json.dumps(NWS))
    return route.fulfill(status=404, headers=H, body='{}')
def snap(route):
    u=route.request.url
    if u.endswith('/air.json'): return route.fulfill(status=200, headers=H, body=json.dumps({'generatedAt':iso(0),'rows':SNAP_ROWS}))
    if u.endswith('/nws.json'): return route.fulfill(status=200, headers=H, body=json.dumps({'generatedAt':iso(0),'alerts':[{'id':'snap-1','event':'Tornado Warning','severity':'Extreme','urgency':'Immediate','certainty':'Observed','area':'Snap, OK','ends':iso(3600),'onset':iso(-60),'zones':[],'geometry':SQ(35,-98,36,-97)}],'total':1}))
    return route.fallback()
SNAP_ROWS=[]

with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); csp=[]; pg.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
    pg.route('**/*', handler)
    pg.route('https://air-quality-api.open-meteo.com/**', air); pg.route('https://api.weather.gov/**', nws)
    pg.route('https://raw.githubusercontent.com/**/live-data/*.json', snap)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@35,-97,1.6&b=bluemarble&l=borders,air,warnings', wait_until='commit'); pg.wait_for_timeout(12000)

    v=pg.evaluate("""async () => { const { validateLayer } = await import('./js/registry.js'); const { airLayer } = await import('./js/airquality.js'); const { warningsLayer } = await import('./js/warnings.js');
      return [validateLayer(airLayer({ $: () => null }), { groups: [{ id: 'science' }] }), validateLayer(warningsLayer({ $: () => null }), { groups: [{ id: 'live' }] })]; }""")
    check('both layers pass the registry check (sources listed, learn text)', v == [[], []], v)
    a=pg.evaluate("() => { const c = gia.state.chan.air; const ps = c?.points ?? []; return { n: ps.length, colours: [...new Set(ps.map((p) => p.color))].length, delhi: ps.find((p) => p.ref?.d?.name === 'Delhi')?.color, rings: c?.rings?.length ?? 0, batches: performance.getEntriesByType('resource').filter((r) => r.name.includes('air-quality-api') && !r.name.includes('hourly')).length } }")
    check('about 400 air-quality places on the globe, in batched requests', 380 <= a['n'] <= 420 and len([c for c in calls if 'air-quality-api' in c and 'hourly' not in c]) <= 6, a)
    check('every US index colour shows, Delhi in red (unhealthy)', a['colours'] >= 5 and a['delhi'] == '#e5413a', a)
    check('places worse than "unhealthy for sensitive groups" pulse', a['rings'] > 0, a)

    # the page for one place
    pg.evaluate("() => { const d = gia.state.data.air.find((x) => x.name === 'Delhi'); gia.select({ layer: 'air', d }); }"); pg.wait_for_timeout(2500)
    body=pg.inner_text('#notes-body')
    check('the page title names the place', pg.inner_text('#notes-body h3').strip() == 'Air in Delhi', pg.inner_text('#notes-body h3'))
    check('the index now, in words', '182' in body and 'Unhealthy' in body, body[:300])
    check('who should act and what to do', 'Everyone' in body and 'Cut down' in body, body[:500])
    check('fine particles as cigarettes (Muller and Muller)', re.search(r'2\.9\s*cigarettes a day', body) is not None, body[:600])
    check('the main pollutant and why', 'main pollutant' in body and 'PM2.5' in body, body[:800])
    bars=pg.evaluate("() => document.querySelectorAll('#notes-body .aq-strip rect').length")
    check('the next five days hour by hour (about 100+ bars)', bars >= 100, bars)
    check('the cleanest hours to be outside', 'Cleanest today' in body or 'Cleanest tomorrow' in body, body)
    check('the gauge needle is drawn', pg.evaluate("() => !!document.querySelector('#notes-body .aq-needle')"))
    folded=pg.evaluate("() => { const d = document.querySelector('#notes-body .aq-more'); return { open: d.open, bars: d.querySelectorAll('.aq-bar').length, pollen: d.textContent.includes('Grass') && !d.textContent.includes('Birch') } }")
    check('each pollutant against the WHO guideline and pollen are folded away (min-max)', not folded['open'] and folded['bars'] == 6 and folded['pollen'], folded)

    # the air at any spot ("Here now" inside the page) and its own page
    pg.evaluate("() => { const m = document.querySelector('#notes-body details.more'); if (m) m.open = true; }"); pg.wait_for_timeout(1500)
    probe=pg.evaluate("() => document.querySelector('#probe-air')?.innerText ?? ''")
    check('"Here now" gives the air at that spot', 'Air:' in probe and 'unhealthy' in probe, probe)
    pg.click('#probe-air [data-air]'); pg.wait_for_timeout(2000)
    check('"The air here in depth" opens a page for that spot', pg.inner_text('#notes-body h3').strip() == 'The air here' and 'US Air Quality Index' in pg.inner_text('#notes-body'), pg.inner_text('#notes-body')[:200])

    # warnings
    w=pg.evaluate("() => { const d = gia.state.data.warnings; const ps = gia.state.chan.warnings?.polygons ?? []; return { n: d?.alerts?.length, events: d?.alerts?.map((a) => a.event), zone: d?.alerts?.find((a) => a.event === 'Winter Storm Warning')?.geometry?.type, top: ps.at(-1)?.ref?.d?.event, red: ps.find((p) => p.ref?.d?.event === 'Tornado Warning')?.stroke, note: d?.statusNote } }")
    check('warnings and watches drawn, advisories and expired alerts left out', w['n'] == 3 and 'Wind Advisory' not in w['events'] and 'Flood Warning' not in w['events'], w)
    check('a zone-based alert gets its outline from its forecast zones', w['zone'] == 'MultiPolygon', w)
    check('the tornado warning is drawn last (on top) in NWS red', w['top'] == 'Tornado Warning' and w['red'] == '#FF0000', w)
    check('the status says how many were drawn', '3 drawn of 5' in (w['note'] or ''), w)
    pg.evaluate("() => { const d = gia.state.data.warnings.alerts.find((a) => a.event === 'Tornado Warning'); gia.select({ layer: 'warnings', d }); }"); pg.wait_for_timeout(2000)
    body=pg.inner_text('#notes-body')
    check('the page explains severity, urgency and certainty in plain words', 'extraordinary threat' in body and 'act now' in body and 'happening now' in body, body[:600])
    check('the time left counts down', re.search(r'\d+ h( \d+ min)? left', body) is not None, body[:300])
    check('the cities and people inside are counted', 'Dallas' in body and 'million' in body, body)
    check('what to do comes before the full text, which is folded', body.index('What to do') < body.index('The full text') and not pg.evaluate("() => document.querySelector('#notes-body .wn-more').open"), body)
    check('another alert over the same zone is one click away', pg.evaluate("() => !!document.querySelector('#notes-body [data-warning]')"))
    pg.click('#notes-body [data-warning]'); pg.wait_for_timeout(1200)
    check('… and opens its page', pg.inner_text('#notes-body h3').strip() == 'Severe Thunderstorm Watch', pg.inner_text('#notes-body h3'))
    hostile=pg.evaluate("""async () => { const { warningsLayer } = await import('./js/warnings.js'); const l = warningsLayer({ $: () => null });
      const c = l.describe({ id: 'x', event: '<img src=x data-x=1>', area: '<b>A</b>', severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', instruction: '<script>bad()</script>', description: '<i>d</i>', zones: [], geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
      return c.html.includes('<script>') || c.html.includes('<img src=x') || c.html.includes('<b>A</b>'); }""")
    check('alert text is escaped (no markup from the feed runs)', hostile is False)

    # sound and Listen
    s=pg.evaluate("() => ({ btn: !!document.getElementById('sound-toggle'), pressed: document.getElementById('sound-toggle')?.getAttribute('aria-pressed'), listen: !!document.getElementById('notes-listen') })")
    check('a speaker button in the top bar, off by default, and Listen in the page header', s['btn'] and s['pressed'] == 'false' and s['listen'], s)
    pg.click('#sound-toggle'); pg.wait_for_timeout(200)
    check('the speaker switches sound on and remembers it', pg.evaluate("() => document.getElementById('sound-toggle').getAttribute('aria-pressed') === 'true' && localStorage.getItem('gia-sound') === '1'"))
    pg.click('#sound-toggle')
    txt=pg.evaluate("async () => { const { pageText } = await import('./js/sound.js'); return pageText(document.getElementById('notes-body'), 'T'); }")
    check('Listen reads the page but not its folded sections', 'Severe Thunderstorm Watch' in txt and 'HAZARD' not in txt, txt[:300])
    ov=pg.evaluate("() => { const a = document.getElementById('sound-toggle').getBoundingClientRect(); const b = document.getElementById('theme-toggle').getBoundingClientRect(); return a.right <= b.left + 1 && a.height >= 24; }")
    check('the speaker sits beside the day/night button without overlapping it', ov)

    # snapshot fallbacks: a fresh visit while both services are down
    SNAP_ROWS[:]=[[35.69,139.75,77,40,20,30,50,10,2,200,1,2]]
    down['aq']=True; down['nws']=True
    pg2=b.new_page(viewport={'width':1280,'height':800}); pg2.on('pageerror', lambda e: errs.append(str(e)))
    pg2.route('**/*', handler); pg2.route('https://air-quality-api.open-meteo.com/**', air); pg2.route('https://api.weather.gov/**', nws); pg2.route('https://raw.githubusercontent.com/**/live-data/*.json', snap)
    pg2.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg2.goto('http://localhost:8765/app/#@35,-97,1.6&b=bluemarble&l=borders,air,warnings', wait_until='commit'); pg2.wait_for_function("() => window.gia && gia.state.data.air && gia.state.data.warnings", timeout=30000)
    f=pg2.evaluate("() => ({ air: gia.state.data.air?.length, tokyo: gia.state.data.air?.[0]?.name, warn: gia.state.data.warnings?.alerts?.map((a) => a.id), src: gia.state.data.warnings?.src })")
    check('with Open-Meteo unreachable, air comes from the hourly snapshot', f['air'] == 1 and f['tokyo'] == 'Tokyo', f)
    check('with the NWS unreachable, warnings come from the snapshot', f['warn'] == ['snap-1'] and f['src'] == 'snapshot', f)
    pg2.evaluate("() => gia.select({ layer: 'air', d: gia.state.data.air[0] })"); pg2.wait_for_timeout(2500)
    check('a place page still shows the index now from the snapshot, and says the forecast needs the service', '77' in pg2.inner_text('#notes-body') and 'not answering' in pg2.inner_text('#notes-body'), pg2.inner_text('#notes-body')[:300])

    check('no page errors', not errs, errs[:3])
    check('nothing breaks the Content Security Policy', not csp, csp[:3])
    b.close()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
