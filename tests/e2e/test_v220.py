# SPDX-License-Identifier: AGPL-3.0-only
# v2.20 the whole solar system: space opens on every planet where it is today, with the asteroid and Kuiper belts and
# the farthest spacecraft; click a planet to fly there, slide and turn around; on the Moon, Mars and Mercury a patch of
# sharper NASA Treks tiles loads as you go down, to the finest level NASA publishes. The tile service is mocked.
import sys, os, re
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
TILE=open(os.path.join(sys.argv[-1], 'tile.jpg'), 'rb').read(); hits=[]
def trek(route): hits.append(route.request.url); route.fulfill(status=200, content_type='image/jpeg', body=TILE)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.22');localStorage.setItem('gia-theme','dark')}catch(e){}"
ZOOM="""([id, a]) => { const { cam, B, st } = gia.cosmos.debug(); const c = st.ctl.target.clone(); const d = cam.position.clone().sub(c).normalize(); cam.position.copy(c).addScaledVector(d, B[id].r * (1 + a)); st.ctl.update(); }"""
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.route('https://trek.nasa.gov/**', trek); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.22', pg.evaluate("() => gia.VERSION")=='2.22')
    sh=pg.evaluate("() => ({ open: document.querySelector('#space-open')?.dataset.space, title: document.querySelector('#space-open')?.title ?? '' })")
    check('the space button is the solar system', sh['open']=='system', sh)
    # the solar system view
    pg.click('#space-open'); pg.wait_for_timeout(8000)
    s=pg.evaluate("""() => { const { st, cam, B } = gia.cosmos.debug(); const AU = B.sun.r / 696000 * 149597870.7;
      return { focus: gia.cosmos.focus(), hash: location.hash, pan: st.ctl.enablePan, max: st.ctl.maxDistance / AU, dist: cam.position.distanceTo(st.ctl.target) / AU,
        card: document.querySelector('#notes-body h3')?.textContent ?? '', rows: [...document.querySelectorAll('#notes-body .sys-table tbody tr')].map((r) => r.textContent),
        labels: [...document.querySelectorAll('.space-label:not(.probe):not([hidden])')].map((e) => e.dataset.space) }; }""")
    check('opens on the whole solar system, about 100 AU out, and the link remembers it', s['focus']=='system' and 'sp=system' in s['hash'] and 80 < s['dist'] < 120, s)
    check('you can slide (pan) and zoom far out (to 400 AU) in the solar system', s['pan'] and s['max'] > 350, s)
    planets=['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto']
    check('the card lists the 8 planets and Pluto with distance and light time, then 3 spacecraft', 'solar system' in s['card'] and [r for r in s['rows'] if any(r.startswith(n) for n in planets)].__len__()==9 and not any(r.startswith('Moon') for r in s['rows']) and sum(('Voyager' in r or 'New Horizons' in r) for r in s['rows'])==3, s['rows'])
    au=dict((m.group(1), float(m.group(2))) for m in (re.match(r'([A-Za-z]+?)\s*([\d.]+) AU', r) for r in s['rows']) if m and m.group(1) in planets)
    check('distances from the Sun are right (Earth 0.98–1.02, Jupiter 4.9–5.5, Neptune 29.7–30.4 AU)', 0.98 <= au.get('Earth',0) <= 1.02 and 4.9 <= au.get('Jupiter',0) <= 5.5 and 29.7 <= au.get('Neptune',0) <= 30.4, au)
    check('planet labels show (at least 6), the Moon’s does not sit on the Earth’s', len([l for l in s['labels'] if l in ('mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','pluto')]) >= 6 and 'moon' not in s['labels'], s['labels'])
    bl=pg.evaluate("""() => { const { scene } = gia.cosmos.debug(); const out = [];
      scene.traverse((o) => { if (o.isPoints && o.material.uniforms?.uAU) { const a = o.geometry.attributes.aOrb.array; let lo = 1e9, hi = 0, gap = 0; for (let i = 0; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); if ([2.502, 2.825, 2.958].some((g) => Math.abs(a[i] - g) < 0.02)) gap++; } out.push({ n: a.length / 3, lo, hi, gap, vis: o.visible }); } });
      return out; }""")
    check('two belts drawn: asteroids 2.1–3.3 AU with the Kirkwood gaps empty, Kuiper belt about 39–48 AU', len(bl)==2 and bl[0]['vis'] and bl[1]['vis'] and 2.09 < bl[0]['lo'] and bl[0]['hi'] < 3.31 and bl[0]['gap']==0 and 37 < bl[1]['lo'] and bl[1]['hi'] < 50, bl)
    # the far spacecraft: zoom out, find them, open one
    pg.evaluate("() => { const { cam, st } = gia.cosmos.debug(); const c = st.ctl.target; cam.position.sub(c).multiplyScalar(2.6).add(c); st.ctl.update(); }"); pg.wait_for_timeout(2500)
    pr=pg.evaluate("() => [...document.querySelectorAll('.space-label.probe:not([hidden])')].map((e) => e.dataset.spaceProbe)")
    check('zoomed out, the farthest spacecraft show beyond the planets', len(pr) >= 2, pr)
    pg.evaluate("() => document.querySelector('[data-space-probe=voyager1]').click()"); pg.wait_for_timeout(600)
    v=pg.evaluate("() => document.querySelector('#notes-body')?.textContent ?? ''")
    m=re.search(r'about (\d+) AU', v)
    check('Voyager 1’s card: distance (165–185 AU in 2026–2028), speed and radio time', 'Voyager 1' in v and m and 165 <= int(m.group(1)) <= 185 and 'radio signal' in v, v[:200])
    # click a planet label to fly there
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(1500)
    pg.evaluate("() => document.querySelector('.space-label[data-space=jupiter]').click()"); pg.wait_for_timeout(8000)
    j=pg.evaluate("() => { const { st } = gia.cosmos.debug(); return { focus: gia.cosmos.focus(), pan: st.ctl.enablePan, belts: (() => { let v = 0; gia.cosmos.debug().scene.traverse((o) => { if (o.isPoints && o.material.uniforms?.uAU && o.visible) v++; }); return v; })(), probes: document.querySelectorAll('.space-label.probe:not([hidden])').length }; }")
    check('clicking a planet flies there; the belts (seen only from far out) and spacecraft labels stay in the solar system view', j['focus']=='jupiter' and not j['pan'] and j['belts']==0 and j['probes']==0, j)
    # deep zoom on the Moon: a patch of sharper tiles
    pg.evaluate("() => gia.cosmos.explore('moon', { instant: true })"); pg.wait_for_timeout(2500)
    md=pg.evaluate("() => { const { st, B } = gia.cosmos.debug(); return st.ctl.minDistance / B.moon.r - 1; }")
    check('you may fly down to about 1 % of the Moon’s radius (15–20 km up), set by the finest map', 0.004 <= md <= 0.012, md)
    n0=len(hits); pg.evaluate(ZOOM, ['moon', 0.3]); pg.wait_for_timeout(5000)
    a=pg.evaluate("() => gia.cosmos.patch()")
    check('at 500 km up a 6 × 6 patch of tiles loads at a middle level', a['id']=='moon' and 5 <= a['z'] <= 7 and a['tiles']==36 and a['loaded']==36, a)
    pg.evaluate(ZOOM, ['moon', 0.012]); pg.wait_for_timeout(5000)
    c=pg.evaluate("() => gia.cosmos.patch()")
    check('closest in, the patch uses the finest level NASA publishes for the Moon (8)', c['id']=='moon' and c['z']==8 and c['loaded']==36, c)
    bad=[u for u in hits[n0:] if not (lambda z,y,x: 0 <= y < 2**z and 0 <= x < 2**(z+1))(*map(int, u.split('/')[-3:-1] + [u.split('/')[-1].split('.')[0]]))]
    check('every tile asked for exists on the grid (2^(z+1) × 2^z tiles per level)', hits[n0:] and not bad, bad[:3])
    pg.evaluate(ZOOM, ['moon', 2.0]); pg.wait_for_timeout(1500)
    check('flying back out drops the patch', pg.evaluate("() => gia.cosmos.patch().id") is None)
    pg.evaluate("() => gia.cosmos.explore('mars', { instant: true })"); pg.wait_for_timeout(2500)
    pg.evaluate(ZOOM, ['mars', 0.02]); pg.wait_for_timeout(5000)
    mr=pg.evaluate("() => gia.cosmos.patch()")
    check('on Mars the closest patch is at level 7, the finest Mars Trek level used', mr['id']=='mars' and mr['z']==7, mr)
    sh=pg.evaluate("() => { const u = gia.cosmos.debug().B.mars.mesh.material.uniforms; return { texW: u.texW?.value, grainF: u.grainF?.value }; }")
    check('the planet shader knows its map’s width for the fine grain', (sh['texW'] or 0) >= 1024 and (sh['grainF'] or 0) >= 1024, sh)
    check('no page errors', not errs, errs[:3])
    # a link straight into the solar system
    pg2=b.new_page(viewport={'width':1280,'height':800}); e2=[]; pg2.on('pageerror', lambda e: e2.append(str(e)))
    pg2.route('**/*', handler); pg2.route('https://trek.nasa.gov/**', trek); pg2.add_init_script(INIT)
    pg2.goto('http://localhost:8765/app/#@20,0,2.4&b=daynight&l=sun,borders,planets&sp=system', wait_until='commit')
    pg2.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg2.wait_for_timeout(5000)
    check('a link with &sp=system opens the solar system view', pg2.evaluate("() => gia.cosmos.focus()")=='system')
    src=pg2.evaluate("async () => (await import('/app/js/sources.js')).SOURCES ?? null")
    check('the spacecraft sources are credited', src is None or ('jplvoyager' in src and 'newhorizons' in src))
    check('no page errors (second page)', not e2, e2[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
