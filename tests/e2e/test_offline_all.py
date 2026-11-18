# SPDX-License-Identifier: AGPL-3.0-only
# v2.25 offline mode for everything added since v2.14: use the app online once (the live watch layers, space and the
# small worlds, a city close-up, Dock with the ISS), press "Save everything", then switch the network off and open it
# again. Every part must still work from what the device saved, and each live layer must say how old its copy is.
import sys, json
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
WATCH=['cyclones','lightning','perimeters','airspace','gnss']
URL='http://localhost:8765/app/#@30,-90,2.2&l=borders,stations,'+','.join(WATCH)
net={'down': False}
def route(r):
    if net['down'] and not r.request.url.startswith('http://localhost'): return r.abort('internetdisconnected')
    return handler(r)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); ctx=b.new_context(viewport={'width':1280,'height':800}, service_workers='allow')
    ctx.route('**/*', route)
    ctx.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.31')}catch(e){}")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    # the service worker first, so everything after this goes through it
    pg.goto('http://localhost:8765/app/', wait_until='load')
    pg.evaluate("async () => { await navigator.serviceWorker.register('../sw.js'); await navigator.serviceWorker.ready; }")
    pg.goto(URL, wait_until='commit'); pg.reload(wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    check('the service worker controls the page', pg.evaluate("() => !!navigator.serviceWorker.controller"))
    pg.wait_for_function(f"() => {json.dumps(WATCH)}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(2000)
    on=pg.evaluate(f"() => {json.dumps(WATCH)}.map((k) => [k, gia.state.lstatus[k]?.s])")
    check('online: the five live watch layers load', all(s=='ok' for _, s in on), on)
    pg.evaluate("async () => (await import('./js/docking.js')).loadStation()"); pg.evaluate("() => import('./js/closeup.js')")
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 48.8584, lng: 2.2945, altitude: 0.0003 }, 0)")
    try: pg.wait_for_function("() => gia.closeup()?.stats()?.buildings", timeout=60000)
    except Exception: pass
    cu=pg.evaluate("() => gia.closeup?.()?.stats?.() ?? null")
    check('online: a close-up of Paris with its buildings', cu and cu.get('buildings'), cu)
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 30, lng: -90, altitude: 2.2 }, 0)"); pg.wait_for_timeout(1500)
    # space and the small worlds, Dock with the ISS and a city close-up, once each
    pg.evaluate("() => gia.cosmos.explore('mars')"); pg.wait_for_timeout(7000)
    pg.evaluate("() => gia.cosmos.explore('saturn')"); pg.wait_for_timeout(6000)
    pg.keyboard.press('Escape'); pg.evaluate("() => gia.cosmos.explore('earth')"); pg.wait_for_timeout(5000)
    # Save everything (the Offline kit's button sends the same message)
    pk=pg.evaluate("""async () => { const list = await (await fetch('data/offline-pack.json')).json(); const urls = list.files.map(([f]) => new URL('../' + f, location.href).href);
      return await new Promise((resolve) => { navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'pack-done') resolve(e.data); });
        navigator.serviceWorker.controller.postMessage({ type: 'pack', urls }); setTimeout(() => resolve('timeout'), 240000); }); }""")
    check('Save everything stores the whole offline pack', isinstance(pk, dict) and pk['done'] >= pk['total'] - 2 and pk['total'] > 1500, pk)

    # --- the network is switched off; the app is opened again from the device
    net['down']=True; ctx.set_offline(True)
    pg.goto(URL, wait_until='commit'); pg.reload(wait_until='commit'); pg.wait_for_function("() => window.gia", timeout=60000)
    pg.wait_for_function(f"() => {json.dumps(WATCH)}.every((k) => gia.state.data[k])", timeout=60000); pg.wait_for_timeout(2500)
    o=pg.evaluate(f"""() => ({{ chip: !document.querySelector('#offline-chip')?.hidden, online: navigator.onLine,
      notes: Object.fromEntries({json.dumps(WATCH)}.map((k) => [k, gia.state.lstatus[k]])),
      storms: gia.state.data.cyclones?.storms?.length, cone: !!gia.state.data.cyclones?.storms?.[0]?.cone, light: !!gia.state.data.lightning?.tex,
      fires: gia.state.data.perimeters?.fires?.length, zones: gia.state.data.airspace?.zones?.length, cells: gia.state.data.gnss?.cells?.length, sats: gia.state.lstatus.stations?.s === 'ok' && !!gia.state.data.stations ? 1 : 0 }})""")
    check('offline: the app opens from the device and shows the Offline chip', o['chip'] and o['online'] is False, o)
    check('offline: every live watch layer draws its saved copy (storm and cone, lightning, fires, airspace, GPS cells)', o['storms']==2 and o['cone'] and o['light'] and o['fires']==2 and o['zones']==3 and o['cells']==3, o)
    check('offline: each of them says it is showing what this device saved, and how long ago', all(v and v.get('s')=='ok' and 'Offline: showing what this device saved' in (v.get('note') or '') for v in o['notes'].values()), o['notes'])
    check('offline: the space station is still placed (saved or bundled orbits)', o['sats'] > 0, o['sats'])
    pg.evaluate("() => gia.cosmos.explore('mars')"); pg.wait_for_timeout(7000)
    m=pg.evaluate("() => ({ hidden: ['phobos','deimos'].filter((id) => gia.cosmos.debug().B[id]?.hidden !== false), chips: [...document.querySelectorAll('#notes-body .moon-chips [data-space]')].map((e) => e.dataset.space) })")
    check('offline: space works, Mars with Phobos and Deimos in their real shapes', not m['hidden'] and m['chips']==['phobos','deimos'], m)
    pg.evaluate("() => gia.cosmos.explore('saturn')"); pg.wait_for_timeout(6000)
    sat=pg.evaluate("() => [...document.querySelectorAll('#notes-body .moon-chips [data-space]')].map((e) => e.dataset.space)")
    check('offline: Saturn and its moons', 'titan' in sat, sat)
    pg.keyboard.press('Escape'); pg.evaluate("() => gia.cosmos.explore('earth')"); pg.wait_for_timeout(5000)
    pg.evaluate("() => document.querySelector('[data-section=tools]')?.click()"); pg.wait_for_timeout(600)
    pg.evaluate("() => document.querySelector('.tool[data-dock]').click()"); pg.wait_for_timeout(6000)
    d=pg.evaluate("() => ({ canvas: !!document.querySelector('.dock canvas'), hud: document.querySelector('.dock-hud')?.textContent ?? '', where: document.querySelector('.dock-where')?.textContent ?? '' })")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('offline: Dock with the ISS opens with the station model and its readouts', d['canvas'] and 'Distance to the port' in d['hud'] and ' km up' in d['where'], d)
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 48.8584, lng: 2.2945, altitude: 0.0003 }, 0)")
    try: pg.wait_for_function("() => gia.closeup()?.stats()?.buildings", timeout=60000)
    except Exception: pass
    cu2=pg.evaluate("() => gia.closeup?.()?.stats?.() ?? null")
    check('offline: the Paris close-up comes back with its buildings from the saved copy', cu2 and cu2.get('buildings'), cu2)
    pg.evaluate("() => void gia.globe.pointOfView({ lat: 30, lng: -90, altitude: 2.2 }, 0)"); pg.wait_for_timeout(1000)
    pg.evaluate("() => document.querySelector('#offline-chip').click()"); pg.wait_for_timeout(1500)
    kit=pg.evaluate("() => [...document.querySelectorAll('.ok-works li b')].map((e) => e.textContent)")
    check('the Offline kit lists what works offline, including space, close-ups, docking and the live watch layers', all(x in kit for x in ['Space','City close-ups','Dock with the ISS','Live watch layers']), kit)
    ctx.set_offline(False)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
