# SPDX-License-Identifier: AGPL-3.0-only
# v2.21 the big moons of Saturn, Uranus and Neptune (TASS 1.7, GUST86, Triton from JPL elements), the planets on busy
# devices, and two repository fixes: no Windows-reserved file names (the desktop build checks out on Windows) and
# an offline pack that lists every file.
import sys, os, re, json
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
SAT=['mimas','enceladus','tethys','dione','rhea','titan','iapetus']; URA=['miranda','ariel','umbriel','titania','oberon']; ALL=SAT+URA+['triton']
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.21');localStorage.setItem('gia-theme','dark')}catch(e){}"
# repository checks (no browser)
bad=[]
for d, _, fs in os.walk(os.path.join(ROOT, 'site')):
    for f in fs:
        if re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$', f, re.I): bad.append(os.path.join(d, f))
check('no file has a name Windows cannot check out (CON, PRN, AUX, NUL, COM1–9, LPT1–9)', not bad, bad)
pack=json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))
names={p for p, _ in pack['files']}
missing=[p for p in names if p not in ('./',) and not os.path.exists(os.path.join(ROOT, 'site', p if not p.endswith('/') else p + 'index.html'))]
check('the offline pack lists the new moon code and maps, and only files that exist', 'app/js/outermoons.js' in names and all(f'app/textures/space/{m}.jpg' in names for m in ALL) and 'app/js/tilt.js' in names and not missing, (missing[:3], 'app/js/outermoons.js' in names))
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos", timeout=60000)
    ok=True
    try: pg.wait_for_function("() => gia.cosmos.ready()", timeout=25000)
    except Exception: ok=False
    check('the planets are ready within 25 s without being asked (the start no longer waits for an idle moment)', ok)
    check('version 2.21', pg.evaluate("() => gia.VERSION")=='2.21')
    check('the moons’ code is not loaded on the globe', not pg.evaluate("() => performance.getEntriesByType('resource').some((e) => e.name.includes('outermoons.js'))"))
    rf=pg.evaluate("async () => { const m = await import('/app/js/flightdb.js'); return [m.routeFile('CON'), m.routeFile('BAW'), m.routeFile('com1')]; }")
    check('flight routes: reserved airline codes use their underscored file', rf==['_CON.json', 'BAW.json', '_com1.json'], rf)
    # the theories themselves
    th=pg.evaluate("""async () => { const m = await import('/app/js/outermoons.js'); const AU = 149597870.7; const jd = 2461000.5;
      const s = m.saturnMoons(jd), u = m.uranusMoons(jd), t = m.triton(jd); const km = (v) => Math.hypot(...v) * AU;
      const D = Math.PI / 180; const pole = (ra, de) => [Math.cos(de * D) * Math.cos(ra * D), Math.cos(de * D) * Math.sin(ra * D), Math.sin(de * D)];
      const lat = (v, p) => Math.asin((v[0] * p[0] + v[1] * p[1] + v[2] * p[2]) / Math.hypot(...v)) / D;
      const ps = pole(40.589, 83.537), pu = pole(257.311, -15.175), pn = pole(299.36, 43.46);
      const t2 = m.triton(jd + 0.1); const h = [t[1] * t2[2] - t[2] * t2[1], t[2] * t2[0] - t[0] * t2[2], t[0] * t2[1] - t[1] * t2[0]];
      const ti0 = s.titan, ti1 = m.saturnMoons(jd + 15.945).titan; const back = Math.acos((ti0[0] * ti1[0] + ti0[1] * ti1[1] + ti0[2] * ti1[2]) / Math.hypot(...ti0) / Math.hypot(...ti1)) / D;
      return { km: Object.fromEntries([...Object.entries(s), ...Object.entries(u), ['triton', t]].map(([k, v]) => [k, Math.round(km(v))])),
        latS: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +lat(v, ps).toFixed(2)])), latU: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, +lat(v, pu).toFixed(2)])),
        retro: (h[0] * pn[0] + h[1] * pn[1] + h[2] * pn[2]) / Math.hypot(...h), titanBack: back }; }""")
    K=th['km']; RANGE={'mimas':(181000,190000),'enceladus':(236000,240000),'tethys':(293000,296000),'dione':(375000,380000),'rhea':(525000,529000),'titan':(1186000,1258000),'iapetus':(3460000,3660000),'miranda':(128000,131500),'ariel':(190000,192500),'umbriel':(264000,267500),'titania':(434000,438000),'oberon':(580000,588000),'triton':(354000,356000)}
    off=[(k,K[k]) for k,(lo,hi) in RANGE.items() if not lo<=K[k]<=hi]
    check('every moon is at its real distance from its planet (Mimas 185,000 km … Iapetus 3.56 million km)', not off, off)
    check('Saturn’s inner moons orbit in its equator (within 2°), Iapetus tilted 10–20°', all(abs(th['latS'][m])<2 for m in SAT[:-1]) and 10<abs(th['latS']['iapetus'])<20, th['latS'])
    check('Uranus’s moons orbit round its tipped-over equator (within 5°)', all(abs(v)<5 for v in th['latU'].values()), th['latU'])
    check('Triton goes round Neptune backwards', th['retro'] < -0.8, th['retro'])
    check('Titan comes back to the same place after one orbit (15.945 days, within 3°)', th['titanBack'] < 3, th['titanBack'])
    # in the app
    pg.evaluate("() => gia.cosmos.explore('saturn')"); pg.wait_for_timeout(9000)
    s=pg.evaluate("""() => { const { B } = gia.cosmos.debug(); return { loaded: performance.getEntriesByType('resource').some((e) => e.name.includes('outermoons.js')),
      hidden: ['mimas','enceladus','tethys','dione','rhea','titan','iapetus'].filter((m) => B[m].hidden),
      chips: [...document.querySelectorAll('#notes-body .moon-chips [data-space]')].map((e) => e.dataset.space),
      labels: [...document.querySelectorAll('.space-label:not([hidden])')].map((e) => e.dataset.space) }; }""")
    check('flying to Saturn loads the moons, and every one is placed', s['loaded'] and not s['hidden'], s)
    check('Saturn’s card lists its seven big moons to fly to', s['chips']==SAT, s['chips'])
    check('some of Saturn’s moons are labelled around it', len([l for l in s['labels'] if l in SAT]) >= 1, s['labels'])
    pg.evaluate("() => document.querySelector('#notes-body .moon-chips [data-space=titan]').click()"); pg.wait_for_timeout(8000)
    t=pg.evaluate("() => ({ focus: gia.cosmos.focus(), card: document.querySelector('#notes-body')?.textContent ?? '', chips: [...document.querySelectorAll('#notes-body .moon-chips [data-space]')].map((e) => e.dataset.space) })")
    check('a moon chip flies there; the moon’s card offers its planet and sisters', t['focus']=='titan' and 'Moon of Saturn' in t['card'] and t['chips'][0]=='saturn' and 'titan' not in t['chips'], t['chips'])
    check('the moon’s card says where its position comes from (TASS 1.7)', 'TASS 1.7' in t['card'], t['card'][-300:])
    badc=[]
    for m in ALL:
        pg.evaluate("(id) => gia.cosmos.explore(id, { instant: true })", m); pg.wait_for_timeout(1600)
        o=pg.evaluate("""(id) => { const { cam, B, F } = gia.cosmos.debug(); const p = B[id].pos.clone().applyMatrix4(F).project(cam); const w = B[id].mesh.material.uniforms.map.value.image?.width ?? 0; return { x: p.x, y: p.y, z: p.z, px: B[id].px, vis: B[id].mesh.visible, w }; }""", m)
        if not (o['vis'] and o['px']>60 and abs(o['x'])<0.25 and abs(o['y'])<0.25 and o['z']<1): badc.append((m,o))
    check('every one of the 13 moons is drawn centred when you fly to it', not badc, badc[:2])
    pg.wait_for_timeout(1500)
    w=pg.evaluate("() => { const { B } = gia.cosmos.debug(); return " + json.dumps(ALL) + ".map((m) => [m, B[m].mesh.material.uniforms.map.value.image?.width ?? 0]); }")
    check('each moon has its NASA map (1024 pixels wide)', all(x[1]==1024 for x in w), [x for x in w if x[1]!=1024])
    tr=pg.evaluate("() => { gia.cosmos.explore('triton', { instant: true }); return new Promise((r) => setTimeout(() => r(document.querySelector('#notes-body')?.textContent ?? ''), 1500)); }")
    check('Triton’s card says its place is approximate and credits JPL', 'approximate' in tr and 'JPL' in tr, tr[-300:])
    pg.evaluate("() => { gia.cosmos.setOrbits(true); }"); pg.evaluate("() => gia.cosmos.explore('uranus', { instant: true })"); pg.wait_for_timeout(2500)
    ol=pg.evaluate("() => { const { scene } = gia.cosmos.debug(); let n = 0; scene.traverse((o) => { if (o.isLineSegments && o.parent && o.parent.children.length && o.geometry.attributes.position.count === 5 * 160 * 2 && o.visible) n++; }); return n; }")
    check('with Orbits on, Uranus’s five moons have their orbits drawn', ol >= 1, ol)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
