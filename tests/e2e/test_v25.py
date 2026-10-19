import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.5: the layer registry (manifests), editions and plug-in layers.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}"
BROKEN="export default { id: 'Bad Id', group: 'nowhere', label: '', swatch: 'red', sources: ['nope'] };"
def page(b, url, wait=11000):
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.route('**/plugins/broken.js', lambda r: r.fulfill(status=200, body=BROKEN, headers={'Content-Type':'text/javascript'}))
    pg.add_init_script(INIT); pg.goto(url, wait_until='commit'); pg.wait_for_timeout(wait); return pg, errs
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    # full edition: every layer has a valid manifest
    pg, errs = page(b, 'http://localhost:8765/app/#@20,0,2.4&l=borders,sun')
    check('version 2.12', pg.evaluate("() => gia.VERSION")=='2.12')
    m=pg.evaluate("() => gia.layerManifest()")
    ids=[l['id'] for l in m['layers']]
    check('manifest lists every layer once', len(ids)==len(set(ids)) and len(ids) >= 40 and m['edition']=='full', len(ids))
    nosrc=[l['id'] for l in m['layers'] if not l['sources'] or any(s['name'] is None for s in l['sources'])]
    check('every layer names sources that sources.js knows', not nosrc, nosrc)
    check('licences come with the sources', all(l['licences'] for l in m['layers']), [l['id'] for l in m['layers'] if not l['licences']])
    caps={l['id']: l['capabilities'] for l in m['layers']}
    check('capabilities are read from the layer', 'panel' in caps['replay'] and 'view-dependent' in caps['ships'] and 'time-driven' in caps['quakes'] and 'learn' in caps['quakes'], caps['replay'])
    v=pg.evaluate("""async () => { const r = await import('./js/registry.js'); const { layerById } = await import('./js/layers.js');
      return Object.values(layerById).map(l => [l.id, r.validateLayer(l, { groups: [{id:l.group}], taken: new Set() }).filter(x => !x.startsWith('id must'))]).filter(([, p]) => p.length) }""")
    check('every built-in layer passes validateLayer', not v, v[:5])
    check('editions: classroom leaves out cameras and crime', 'classroom' not in [e for l in m['layers'] if l['id']=='cameras' for e in l['editions']] and 'classroom' in [e for l in m['layers'] if l['id']=='quakes' for e in l['editions']])
    pg.evaluate("() => document.activeElement?.blur()"); pg.keyboard.press('Shift+Slash'); pg.wait_for_timeout(1200)
    pg.click('[data-manifest]'); pg.wait_for_timeout(1200)
    t=pg.evaluate("() => ({ rows: document.querySelectorAll('.manifest tbody tr').length, dl: !!document.querySelector('a[download$=\".json\"]') })")
    check('About → Layer manifest shows a table and a download', t['rows'] >= 40 and t['dl'], t)
    check('no page errors (full)', not errs, errs[:3]); pg.close()
    # classroom edition
    pg, errs = page(b, 'http://localhost:8765/app/?edition=classroom#@20,0,2.4&l=borders,sun,cameras,crime,quakes')
    e=pg.evaluate("() => ({ ed: gia.state.edition, on: [...gia.state.on], intel: document.querySelector('.rail [data-section=intel]')?.hidden, list: [...document.querySelectorAll('#layer-list [data-layer]')].map(x => x.dataset.layer) })")
    check('classroom edition is applied', e['ed']=='classroom', e['ed'])
    check('excluded layers are off and not listed', 'cameras' not in e['on'] and 'crime' not in e['on'] and 'cameras' not in e['list'] and 'alpr' not in e['list'] and 'quakes' in e['list'], e['on'])
    check('Intel section hidden in the classroom edition', e['intel'] is True, e['intel'])
    pg.evaluate("() => gia.toggleLayer('crime', true)"); pg.wait_for_timeout(500)
    check('an excluded layer cannot be turned on', 'crime' not in pg.evaluate("() => [...gia.state.on]"))
    check('no page errors (classroom)', not errs, errs[:3]); pg.close()
    # plug-ins
    pg, errs = page(b, 'http://localhost:8765/app/?plugins=daylength,broken,../evil#@20,0,2.4&l=borders,sun,daylength', 12000)
    s=pg.evaluate("() => ({ plugins: gia.state.plugins, on: gia.state.on.has('daylength'), status: gia.state.lstatus.daylength, row: !!document.querySelector('#layer-list [data-layer=daylength]') })")
    pl={x['name']: x for x in s['plugins']}
    check('daylength plug-in is added, listed and turned on from the link', pl.get('daylength',{}).get('ok') and s['row'] and s['on'] and s['status'] and s['status']['s']=='ok', s)
    check('a broken plug-in is refused with reasons', pl.get('broken',{}).get('ok') is False and len(pl['broken']['problems']) >= 4, pl.get('broken'))
    check('names outside app/plugins are ignored', '../evil' not in pl and 'evil' not in pl, list(pl))
    d=pg.evaluate("async () => { const m = await import('./plugins/daylength.js'); return [m.dayLength(0, 0), m.dayLength(60, 23.44), m.dayLength(75, 23.44), m.dayLength(75, -23.44)] }")
    check('day length: 12 h at the equinox, 18 h 50 at 60° N in June, midnight sun and polar night', abs(d[0]-12.1)<0.1 and abs(d[1]-18.85)<0.1 and d[2]==24 and d[3]==0, d)
    mf=pg.evaluate("() => gia.layerManifest().layers.find(l => l.id === 'daylength')")
    check('plug-in appears in the manifest with its origin', mf and mf['origin']=='plugin:daylength' and mf['sources'][0]['id']=='solar', mf)
    check('no page errors (plug-ins)', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
