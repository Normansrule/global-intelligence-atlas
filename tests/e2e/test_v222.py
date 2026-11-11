# SPDX-License-Identifier: AGPL-3.0-only
# v2.22 the small worlds: Phobos and Deimos (Lainey's ephemerides) and Charon, and Ceres, Vesta and Bennu on their orbits;
# Phobos, Deimos, Vesta and Bennu in their real shapes (radius maps built by tools/build-smallworlds.py).
import sys, os, json, struct
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
NEW=['phobos','deimos','charon','ceres','vesta','bennu']; SHAPED=['phobos','deimos','vesta','bennu']
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.22');localStorage.setItem('gia-theme','dark')}catch(e){}"
# the shape files (no browser)
import math
sh={}
for s in SHAPED:
    b=open(os.path.join(ROOT, 'site/app/data/shapes', f'{s}.bin'), 'rb').read(); v=[x/16384 for x in struct.unpack(f'<{len(b)//2}H', b)]
    w=[math.cos(math.radians(90-(i//129)*180/64)) for i in range(len(v))]
    sh[s]={'n': len(v), 'lo': min(v), 'hi': max(v), 'mean': sum(a*c for a,c in zip(v,w))/sum(w)}
check('four shape files, each a radius for every vertex of a 128 × 64 sphere, averaging 1', all(x['n']==129*65 and abs(x['mean']-1)<0.01 for x in sh.values()), sh)
check('the shapes are not balls: Deimos and Phobos lumpy (longest over shortest > 1.6), Bennu nearly round (within 15 %)', sh['deimos']['hi']/sh['deimos']['lo']>1.6 and sh['phobos']['hi']/sh['phobos']['lo']>1.6 and 0.85<sh['bennu']['lo'] and sh['bennu']['hi']<1.15, sh)
pack={p for p,_ in json.load(open(os.path.join(ROOT, 'site/app/data/offline-pack.json')))['files']}
check('the offline pack lists the new code, shapes and maps', 'app/js/smallworlds.js' in pack and all(f'app/data/shapes/{s}.bin' in pack for s in SHAPED) and all(f'app/textures/space/{s}.jpg' in pack for s in NEW))
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&b=daynight&l=sun,borders,planets', wait_until='commit')
    pg.wait_for_function("() => window.gia && gia.cosmos && gia.cosmos.ready()", timeout=60000); pg.wait_for_timeout(1500)
    check('version 2.22', pg.evaluate("() => gia.VERSION")=='2.22')
    check('the small worlds’ code is not loaded on the globe', not pg.evaluate("() => performance.getEntriesByType('resource').some((e) => e.name.includes('smallworlds.js'))"))
    th=pg.evaluate("""async () => { const m = await import('/app/js/smallworlds.js'); const AU = 149597870.7; const jd = 2461000.5; const D = Math.PI / 180;
      const km = (v) => Math.hypot(...v) * AU; const ang = (a, b) => Math.acos((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)) / D;
      const pole = [Math.cos(52.887 * D) * Math.cos(317.681 * D), Math.cos(52.887 * D) * Math.sin(317.681 * D), Math.sin(52.887 * D)];
      const lat = (v) => Math.asin((v[0] * pole[0] + v[1] * pole[1] + v[2] * pole[2]) / Math.hypot(...v)) / D;
      const mm = m.marsMoons(jd); const ph = []; for (let k = 0; k < 40; k++) ph.push(km(m.marsMoons(jd + k * 0.37).phobos));
      return { phMin: Math.min(...ph), phMax: Math.max(...ph), de: km(mm.deimos), latP: lat(mm.phobos), latD: lat(mm.deimos),
        backP: ang(mm.phobos, m.marsMoons(jd + 0.31891).phobos), backD: ang(mm.deimos, m.marsMoons(jd + 1.26244).deimos),
        sun: Object.fromEntries(['ceres', 'vesta', 'bennu'].map((id) => [id, Math.hypot(...m.asteroid(id, jd))])),
        vestaBack: ang(m.asteroid('vesta', jd), m.asteroid('vesta', jd + m.PERIOD.vesta)) }; }""")
    check('Phobos stays 9,230–9,520 km from Mars’s centre and Deimos about 23,460 km', 9200 < th['phMin'] and th['phMax'] < 9550 and 23400 < th['de'] < 23520, th)
    check('both orbit in Mars’s equator (within 2.5°)', abs(th['latP']) < 2.5 and abs(th['latD']) < 2.5, th)
    check('Phobos comes back in 7 h 39 min and Deimos in 30 h 18 min (within 1.5°)', th['backP'] < 1.5 and th['backD'] < 1.5, th)
    check('Ceres, Vesta and Bennu are where their orbits allow (2.55–2.99, 2.15–2.58, 0.89–1.36 AU from the Sun)', 2.55 < th['sun']['ceres'] < 2.99 and 2.15 < th['sun']['vesta'] < 2.58 and 0.89 < th['sun']['bennu'] < 1.36, th['sun'])
    check('Vesta comes back to the same place after one year of its own (within 0.01°)', th['vestaBack'] < 0.01, th['vestaBack'])
    # Mars and its moons
    pg.evaluate("() => gia.cosmos.explore('mars')"); pg.wait_for_timeout(8000)
    m=pg.evaluate("() => ({ loaded: performance.getEntriesByType('resource').some((e) => e.name.includes('smallworlds.js')), hidden: ['phobos','deimos'].filter((id) => gia.cosmos.debug().B[id].hidden), card: document.querySelector('#notes-body')?.textContent ?? '', chips: [...document.querySelectorAll('#notes-body .moon-chips [data-space]')].map((e) => e.dataset.space) })")
    check('flying to Mars loads the small worlds; its card lists Phobos and Deimos under “Moons”', m['loaded'] and not m['hidden'] and m['chips']==['phobos','deimos'] and 'Moons:' in m['card'], m)
    badc=[]
    for s in NEW:
        pg.evaluate("(id) => gia.cosmos.explore(id, { instant: true })", s); pg.wait_for_timeout(2500)
        o=pg.evaluate("""(id) => { const { cam, B, F, st } = gia.cosmos.debug(); const b = B[id]; const p = b.pos.clone().applyMatrix4(F).project(cam);
          return { x: p.x, y: p.y, z: p.z, px: b.px, vis: b.mesh.visible, verts: b.mesh.geometry.attributes.position.count, w: b.mesh.material.uniforms.map.value.image?.width ?? 0, rMax: b.rMax ?? 1, minD: st.ctl.minDistance / b.r }; }""", s)
        if not (o['vis'] and o['px']>60 and abs(o['x'])<0.25 and abs(o['y'])<0.25 and o['z']<1 and o['w']>=512 and (o['verts']==129*65) == (s in SHAPED)): badc.append((s,o))
        if s=='deimos': deim=o
    check('each of the six is drawn centred with its map when you fly to it, the four odd-shaped ones in their shape', not badc, badc[:2])
    check('you cannot fly into Deimos’s long end: the closest approach allows for its shape', deim['minD'] > deim['rMax'] > 1.3, deim)
    ch=pg.evaluate("""() => { gia.cosmos.explore('charon', { instant: true }); const { B } = gia.cosmos.debug(); const KM = 100 / 6371.0088;
      const d = B.charon.pos.clone().sub(B.pluto.pos); const pm = { x: B.pluto.basis.elements[0], y: B.pluto.basis.elements[1], z: B.pluto.basis.elements[2] };
      return new Promise((r) => setTimeout(() => r({ km: d.length() / KM, along: (d.x * pm.x + d.y * pm.y + d.z * pm.z) / d.length(), card: document.querySelector('#notes-body')?.textContent ?? '' }), 1500)); }""")
    check('Charon is 19,596 km out, straight over Pluto’s prime meridian (the side that faces it)', abs(ch['km']-19596) < 2 and ch['along'] > 0.9999, {k: ch[k] for k in ('km','along')})
    check('Charon’s card offers Pluto (“Goes round”) and says where its place comes from', 'Goes round' in ch['card'] and 'meridian of Pluto' in ch['card'], ch['card'][-300:])
    cards={}
    for s in ['phobos','bennu','vesta']:
        pg.evaluate("(id) => gia.cosmos.explore(id, { instant: true })", s); pg.wait_for_timeout(1200); cards[s]=pg.evaluate("() => document.querySelector('#notes-body')?.textContent ?? ''")
    check('the cards credit the sources: Lainey for Phobos, Minor Planet Center and OSIRIS-REx for Bennu (approximate), Dawn for Vesta', 'Lainey' in cards['phobos'] and 'Minor Planet Center' in cards['bennu'] and 'approximate' in cards['bennu'] and 'OSIRIS-REx' in cards['bennu'] and 'Dawn' in cards['vesta'], {k: v[-200:] for k, v in cards.items()})
    pg.evaluate("() => gia.cosmos.explore('system', { instant: true })"); pg.wait_for_timeout(2000)
    rows=pg.evaluate("() => [...document.querySelectorAll('#notes-body .sys-table tbody tr')].map((r) => r.textContent)")
    sw=[r for r in rows if r.startswith(('Ceres','Vesta','Bennu'))]
    check('the solar system card lists the small worlds with their distances', len(sw)==3, rows)
    pg.evaluate("() => { const { cam, st } = gia.cosmos.debug(); const c = st.ctl.target; cam.position.sub(c).multiplyScalar(0.05).add(c); st.ctl.update(); }"); pg.wait_for_timeout(2500)
    lab=pg.evaluate("() => [...document.querySelectorAll('.space-label:not([hidden])')].map((e) => e.dataset.space)")
    check('zoomed in on the inner solar system, at least one of the small worlds is named', any(x in lab for x in ('ceres','vesta','bennu')), lab)
    pg.evaluate("() => gia.cosmos.setOrbits(true)"); pg.wait_for_timeout(1500)
    ol=pg.evaluate("""() => { const { scene } = gia.cosmos.debug(); const n = {}; scene.traverse((o) => { if (o.isLineSegments) { const c = o.geometry.attributes.position.count; n[c] = (n[c] ?? 0) + 1; } }); return n; }""")
    check('with Orbits on, the orbits of the asteroids, Mars’s moons and Charon are drawn', ol.get(str(3*360*2),0)>=1 and ol.get(str(2*160*2),0)>=1 and ol.get(str(160*2),0)>=1, ol)
    src=pg.evaluate("async () => { const s = (await import('/app/js/sources.js')).SOURCES; return ['lainey', 'stellariummarssat', 'mpcorb', 'stellariumdata', 'usgsdawn', 'bennumosaic'].filter((k) => !s?.[k]); }")
    check('every new source is credited', not src, src)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
