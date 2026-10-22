import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS, WEATHER
from playwright.sync_api import sync_playwright
import json
# v2.13: clouds, rain, snow, lightning and fire smoke drawn physically from the weather grid and FIRMS (skyfx.js).
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}"
W=json.loads(WEATHER)
LAYER="async () => (await import('./js/layers.js')).layerById.skyfx"
L=lambda expr: "async () => { const l = await ("+LAYER+")(); return "+expr+"; }"
def page(b, url, **kw):
    ctx=b.new_context(viewport={'width':1280,'height':800}, **kw); pg=ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.on('console', lambda m: m.type=='error' and 'WebGL' in m.text and errs.append(m.text[:400]))  # shader compile errors (?debug)
    pg.route('**/*', handler); pg.add_init_script(INIT); pg.goto(url, wait_until='commit'); pg.wait_for_timeout(14000); return pg, errs
calls="() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(gia.globe.renderer().info.render.calls))))"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg, errs = page(b, 'http://localhost:8765/app/?debug#@20,40,2.4&l=sun')
    base=pg.evaluate(calls)
    pg.evaluate("() => gia.toggleLayer('skyfx', true)"); pg.wait_for_timeout(9000)
    st=pg.evaluate("() => gia.state.lstatus.skyfx")
    check('the sky layer loads from weather.json and FIRMS', st and st['s']=='ok' and 'thunderstorm' in st['note'] and 'fires' in st['note'], st)
    on=pg.evaluate(calls)
    s=pg.evaluate(L("l.stats()"))
    check('four objects, at most four extra draw calls', s['objects']==4 and on-base<=4, {'off':base,'on':on,'stats':s})
    check('rain and snow fall where the grid has precipitation', s['rain']>200 and s['snow']>0 and s['rain']<=s['rainCap'], s)
    check('fire glow and smoke from the FIRMS hotspots', s['embers']>500 and s['smoke']>100, s)
    cells=pg.evaluate(L("l.cells()"))
    storms=[k for k,c in enumerate(W['wc']) if 95<=c<=99]
    near=lambda c: abs(c['lat']-(W['lat0']+(c['grid']//W['nlon'])*W['step']))<=2.01 and abs(((c['lng']-(W['lon0']+(c['grid']%W['nlon'])*W['step'])+180)%360)-180)<=4.5
    check('lightning cells are the grid points with WMO thunderstorm codes', len(cells)==min(32,2*len(storms)) and all(c['kind']=='storm' and c['grid'] in storms and near(c) for c in cells), (len(cells), len(storms), cells[:2]))
    t1=pg.evaluate(L("l.stats().t")); pg.wait_for_timeout(1200); t2=pg.evaluate(L("l.stats().t"))
    check('the sky animates (the globe keeps drawing frames while it is on)', t2>t1, (t1,t2))
    # api.skyStats feeds the Live overview: the counted rows show while the layer is on
    pg.click('[data-section="live"]'); pg.wait_for_timeout(1500)
    lt=pg.inner_text('body')
    check('Live overview counts the thunderstorms and fires', 'Thunderstorms on the globe' in lt and 'under cloud' in lt and 'Fire hotspots' in lt, lt[lt.find('Thunder')-20:lt.find('Thunder')+160] if 'Thunder' in lt else '')
    pg.keyboard.press('Escape')
    pg.evaluate("() => gia.showLearn('skyfx')"); pg.wait_for_timeout(800)
    t=pg.inner_text('#notes-body')
    check('Learn card: honest about lightning, acronyms written out, World Meteorological Organization reference', 'fire radiative power (FRP)' in t and 'World Meteorological Organization (WMO)' in t and 'not individual strikes' in t and 'Manual on Codes' in t and 'Thunderstorms' in t, t[:400])
    # zoom in on the typhoon: drops are placed inside the view
    pg.evaluate("() => gia.globe.pointOfView({ lat: 21, lng: 130, altitude: 0.15 }, 0)"); pg.wait_for_timeout(5000)
    s2=pg.evaluate(L("l.stats()"))
    check('zoomed in over a storm the drops fill the view', s2['rain']>s['rain']*0.5, s2)
    pg.evaluate("() => gia.toggleLayer('skyfx', false)")
    # compare at the same view as the baseline: close up, the map tiles add draw calls of their own
    pg.evaluate("() => gia.globe.pointOfView({ lat: 20, lng: 40, altitude: 2.4 }, 0)"); pg.wait_for_timeout(4000)
    off=pg.evaluate(calls)
    check('turning it off removes its draw calls', off<=base+1, (base, off))
    check('no page errors', not errs, errs[:3]); pg.context.close()
    # reduced motion: frozen drift and steady storm glow instead of flashes
    pg, errs = page(b, 'http://localhost:8765/app/#@20,40,2.4&l=sun,skyfx', reduced_motion='reduce')
    t1=pg.evaluate(L("l.stats().t")); pg.wait_for_timeout(1500); t2=pg.evaluate(L("l.stats().t"))
    check('reduced motion freezes the clouds, rain and smoke', t1==t2 and t1>0, (t1,t2))
    check('no page errors (reduced motion)', not errs, errs[:3]); pg.context.close()
    # the Weather map style: picking it brings the weather, picking another style takes it away
    pg, errs = page(b, 'http://localhost:8765/app/?debug#@20,40,2.4&l=sun')
    pg.evaluate("() => document.querySelector('[data-base=\"weather\"]').click()"); pg.wait_for_timeout(3000)
    w=pg.evaluate("() => ({ on: gia.state.on.has('skyfx'), base: gia.state.base, checked: document.querySelector('[data-base=\"weather\"]').getAttribute('aria-checked'), mute: gia.globe.globeMaterial().uniforms?.mute?.value, hash: location.hash })")
    check('the Weather map style switches the weather on over a muted Earth', w['on'] and w['base']=='weather' and w['checked']=='true' and w['mute']>0.3 and 'b=weather' in w['hash'] and 'skyfx' in w['hash'], w)
    pg.evaluate("() => document.querySelector('[data-base=\"bluemarble\"]').click()"); pg.wait_for_timeout(1500)
    check('picking another map style switches the weather off again', not pg.evaluate("() => gia.state.on.has('skyfx')"))
    pg.evaluate("() => { gia.toggleLayer('skyfx', true); document.querySelector('[data-base=\"weather\"]').click(); document.querySelector('[data-base=\"daynight\"]').click(); }"); pg.wait_for_timeout(1500)
    w2=pg.evaluate("() => ({ on: gia.state.on.has('skyfx'), mute: gia.globe.globeMaterial().uniforms?.mute?.value })")
    check('a weather layer you switched on yourself stays on when you leave the style, on full colour', w2['on'] and w2['mute']==0, w2)
    check('no page errors (weather style)', not errs, errs[:3]); pg.context.close()
    pg, errs = page(b, 'http://localhost:8765/app/#@20,40,2.4&b=weather&l=sun')
    check('a link with the Weather style opens with the weather on', pg.evaluate("() => gia.state.on.has('skyfx') && document.getElementById('ly-skyfx')?.checked === true"))
    check('no page errors (weather link)', not errs, errs[:3])
    b.close()
fails=[n for n,ok in res if not ok]
print(f"\n{len(res)-len(fails)}/{len(res)} passed"); sys.exit(1 if fails else 0)
