import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.3: real terrain and OpenStreetMap buildings in the street-level plane view and the cameras' 3D surroundings.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.10')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@51.5,-0.12,1.5&l=borders,aircraft,cameras', wait_until='commit'); pg.wait_for_timeout(14000)
    check('version 2.10', pg.evaluate("() => gia.VERSION")=='2.10')
    u=pg.evaluate("""async () => { const m = await import('./js/landscape.js');
      return { dec: m.decodeTerrarium(128, 100, 128), h1: m.buildingHeight({building:'yes', height:'45 m'}), h2: m.buildingHeight({building:'apartments','building:levels':'10'}), h3: m.buildingHeight({building:'house'}), h4: m.buildingHeight({building:'yes', height:"100'"}), back: m.toLocal(51.5, -0.12, ...m.toLatLng(51.5, -0.12, 300, -200)) } }""")
    check('terrain colours decode to metres', abs(u['dec']-100.5) < 1e-9, u['dec'])
    check('building heights from height, floors or type', u['h1']['h']==45 and u['h1']['how']=='mapped' and abs(u['h2']['h']-33)<1e-9 and u['h2']['how']=='floors' and u['h3']['h']==6 and abs(u['h4']['h']-30.48)<0.01, u)
    check('local metres round-trip', abs(u['back'][0]-300)<0.01 and abs(u['back'][1]+200)<0.01, u['back'])
    l=pg.evaluate("""async () => { const m = await import('./js/landscape.js'); const l = await m.buildLandscape(51.5, -0.12, { radiusM: 1500, buildingsM: 700 });
      const t = l.group.getObjectByName('terrain'); const bm = l.group.getObjectByName('buildings'); bm.geometry.computeBoundingBox();
      return { ground: l.ground, zoom: l.grid.zoom, meshes: l.group.children.length, tVerts: t.geometry.attributes.position.count, b: { count: l.buildings.count, mapped: l.buildings.mapped, floors: l.buildings.floors, typical: l.buildings.typical, tallest: l.buildings.tallest }, top: bm.geometry.boundingBox.max.z, towerBase: Math.min(...[[-192,-132],[-168,-132],[-168,-108],[-192,-108]].map(([x,y]) => l.elevAt(x,y))), slope: l.elevAt(500, 0) - l.elevAt(-500, 0), notes: l.notes } }""")
    check('terrain loads from Terrarium tiles', 100 <= l['ground'] <= 356 and l['tVerts']==129*129 and l['zoom'] is not None, l)
    check('ground follows the slope (rises to the east)', l['slope'] > 5, l['slope'])
    check('60 buildings merged into one mesh', l['meshes']==2 and l['b']['count']==60, l['b'])
    check('the tallest building is the mapped tower', l['b']['tallest']['name']=='Mock Tower' and l['b']['tallest']['h']==120 and l['b']['mapped']==1 and l['b']['floors']==19, l['b']['tallest'])
    check('buildings stand on the terrain', abs(l['top'] - (l['towerBase'] + 120)) < 1, (l['top'], l['towerBase']))
    # street level in the flight panel
    a=pg.evaluate("() => { const list = gia.state.data.aircraft?.ac ?? []; const a = list.find(x => !x.ground && x.altFt > 20000) ?? list[0]; if (!a) return null; gia.select({layer:'aircraft', d:a}); return { id: a.id, alt: a.altFt }; }"); pg.wait_for_timeout(2500)
    has=pg.evaluate("() => !!document.querySelector('[data-pv=street]')")
    check('flight panel offers Street level', a and has, a)
    if has:
        pg.click('[data-pv=street]'); pg.wait_for_timeout(5000)
        note=pg.inner_text('#deck-3d .pv-note')
        check('street level shows height above the ground and buildings', 'above the ground here' in note and 'buildings from OpenStreetMap' in note and 'gold ring' in note, note)
    # 3D surroundings in a camera card
    c=pg.evaluate("() => { const c = gia.state.data.cameras?.cams?.[0]; if (!c) return null; gia.select({layer:'cameras', d:c}); return c.name; }"); pg.wait_for_timeout(1500)
    btn=pg.evaluate("() => !!document.querySelector('[data-surround]')")
    check('camera card has a 3D surroundings button', c and btn, c)
    if btn:
        pg.click('[data-surround]'); pg.wait_for_timeout(5000)
        s=pg.evaluate("() => ({ note: document.querySelector('.sv-note')?.innerText, calls: gia.surroundings?.info()?.calls, w: document.querySelector('.sv-canvas')?.width })")
        check('3D surroundings loads terrain and buildings', s['note'] and '60 buildings' in s['note'] and 'tallest 120 m (Mock Tower)' in s['note'], s)
        check('3D surroundings stays batched (few draw calls)', s['calls'] is not None and s['calls'] <= 6, s['calls'])
    check('no page errors', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
