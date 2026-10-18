import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
import json, os
# World Monitor baseline: the rest of World Monitor's static map datasets as layers (wmbaseline.js).
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.10')}catch(e){}"
WM=json.load(open(os.path.join(sys.argv[-1], '..', '..', 'site', 'app', 'data', 'worldmonitor-static.json')))
# layer id -> (JSON key, group, a field label its card must show)
LAYERS={
 'bases': ('bases', 'geo', 'Operated by'), 'gulffdi': ('gulfInvestments', 'geo', 'Investor'),
 'irradiators': ('irradiators', 'infra', 'Country'), 'techhqs': ('techHqs', 'infra', 'Kind'), 'cloud': ('cloudRegions', 'infra', 'Availability zones'),
 'ailabs': ('aiLabs', 'infra', 'Focus'), 'startups': ('startups', 'infra', 'Venture funding'), 'finance': ('finance', 'infra', 'Global Financial Centres Index rank'),
 'commodities': ('commodities', 'infra', 'Commodities'), 'mining': ('mining', 'infra', 'Mineral'),
}
def page(b, url):
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler)
    pg.add_init_script(INIT); pg.goto(url, wait_until='commit'); pg.wait_for_timeout(11000); return pg, errs
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg, errs = page(b, 'http://localhost:8765/app/#@25,40,2.4&l=borders,'+','.join(LAYERS))
    check('version 2.10', pg.evaluate("() => gia.VERSION")=='2.10')
    m=pg.evaluate("() => gia.layerManifest()")
    man={l['id']: l for l in m['layers']}
    for lid,(key,group,field) in LAYERS.items():
        n=pg.evaluate(f"() => gia.state.data['{lid}']?.length ?? null")
        want=len(WM.get(key, []))
        check(f'{lid}: loads all {want} items from {key}', want > 0 and n==want, (n, want))
        l=man.get(lid, {})
        check(f'{lid}: in group {group}, credits World Monitor, has a learn card', l.get('group')==group and any(s['id']=='worldmonitor' for s in l.get('sources', [])) and 'learn' in l.get('capabilities', []) and 'cards' in l.get('capabilities', []), l)
        st=pg.evaluate(f"() => gia.state.lstatus['{lid}']?.s")
        check(f'{lid}: status ok', st=='ok', st)
        # open the card of an item that has the field the check looks for
        idx=pg.evaluate(f"""() => {{ const l = gia.state.data['{lid}']; const k = {{ startups: 'totalFunding2024', finance: 'gfciRank', ailabs: 'focusAreas', mining: 'mineral', commodities: 'commodities' }}['{lid}']; const i = k ? l.findIndex(d => d[k] != null) : 0; return Math.max(0, i) }}""")
        pg.evaluate(f"() => gia.select({{ layer: '{lid}', d: gia.state.data['{lid}'][{idx}] }})"); pg.wait_for_timeout(500)
        t=pg.inner_text('#notes-body')
        check(f'{lid}: card shows its fields and the World Monitor credit', field in t and 'World Monitor' in t, t[:160].replace('\n', ' · '))
    # nothing drawn twice: the extra finance and mining lists skip what Financial centres and Critical minerals show
    econ={e['name'].lower() for e in WM['economic']}
    dup=[f['name'] for f in WM['finance'] if f['kind']!='centre' and (f['name'].lower() in econ or (f.get('shortName') or '').lower() in econ)]
    check('finance leaves out exchanges and banks the economic layer has', not dup, dup)
    mineral_names={c['name'] for c in WM['minerals']}
    check('mining leaves out the critical-mineral mines', not [x for x in WM['mining'] if x['name'] in mineral_names] and len([x for x in WM['mining'] if x['kind']=='mine']) > 40)
    check('startup hubs folded into ecosystems in the same city', any(s.get('hub') for s in WM['startups']) and len({(round(s['lat'],1), round(s['lon'],1)) for s in WM['startups'] if s['kind']!='accelerator'}) >= len([s for s in WM['startups'] if s['kind']!='accelerator']) - 3)
    check('bases from every operator, China and Russia included', {'us-nato','china','russia','uk','france','india'} <= {x['type'] for x in WM['bases']})
    check('existing keys are still there', all(k in WM for k in ['cables','pipelines','ports','waterways','tradeRoutes','datacenters','spaceports','nuclear','economic','minerals','conflicts','hotspots']))
    pg.evaluate("() => gia.closeNotes?.()"); pg.keyboard.press('Escape'); pg.wait_for_timeout(1500)
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('draw calls stay under 120 with all the new layers on', calls < 120, calls)
    ed=pg.evaluate("async () => { const r = await import('./js/registry.js'); return r.EDITIONS.classroom.exclude.includes('bases') }")
    check('the classroom edition leaves out military bases', ed)
    check('no page errors', not errs, errs[:3]); pg.close()
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
