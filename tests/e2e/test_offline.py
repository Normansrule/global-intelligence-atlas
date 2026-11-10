# SPDX-License-Identifier: AGPL-3.0-only
# Offline mode: every feed's last good copy is kept on the device (IndexedDB) and shown, with its age, when the
# internet goes; the app notices a dead internet even when the network adapter still says "online"; planes are not
# drawn from an old copy; the Offline kit works things out on the device alone; back online, layers refresh; and
# the service worker opens the whole app with the network switched off.
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
URL='http://localhost:8765/app/#@30,140,2.2&l=borders,quakes,events,cities'
net={'down': False}
def route(r):
    u=r.request.url
    if net['down'] and not u.startswith('http://localhost'): return r.abort('internetdisconnected')
    return handler(r)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); ctx=b.new_context(viewport={'width':1280,'height':800}, service_workers='allow')
    ctx.route('**/*', route)
    ctx.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='commit'); pg.wait_for_timeout(10000)
    live=pg.evaluate("() => ({ q: gia.state.data.quakes?.length ?? 0, note: gia.state.lstatus.quakes })")
    saved=pg.evaluate("async () => (await (await import('./js/lastknown.js')).listSaved()).map((e) => e.id)")
    check('online: quakes load and their feed is kept on the device', live['q'] > 0 and 'usgs' in saved, (live, saved))
    a=pg.evaluate("""async () => { const m = await import('./js/lastknown.js'); return {
      flights: m.maxAge('https://x/live-data/flights.json', 'livedata') / 60000, adsb: m.maxAge('u', 'adsblol') / 60000,
      route: m.maxAge('https://api.adsbdb.com/v0/callsign/BAW1', 'adsbdb') / 1440 / 60000, ships: m.maxAge('https://x/live-data/ships.json', 'aisstream') / 60000,
      tle: m.maxAge('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', 'celestrak:stations') / 1440 / 60000, quakes: m.maxAge('https://earthquake.usgs.gov/x', 'usgs') / 1440 / 60000 } }""")
    check('freshness: planes 20 min, ships 60 min, orbits 14 days, quakes and flight routes 45 days', a == {'flights': 20, 'adsb': 20, 'route': 45, 'ships': 60, 'tle': 14, 'quakes': 45}, a)
    old=pg.evaluate("""async () => { const m = await import('./js/lastknown.js'); const d = await new Promise((r) => { const q = indexedDB.open('gia-offline', 1); q.onsuccess = () => r(q.result); });
      await new Promise((r) => { const t = d.transaction('feeds', 'readwrite'); t.objectStore('feeds').put({ k: 'https://x/live-data/flights.json', id: 'livedata', type: 'json', raw: '{"ac":[]}', t: Date.now() - 3600000, n: 9 }); t.oncomplete = r; });
      return [await m.recall('https://x/live-data/flights.json', 'livedata'), (await m.recall('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', 'usgs'))?.v?.features?.length ?? 'none'] }""")
    check('an hour-old copy of the flights is never shown; a quake copy is', old[0] is None and old[1] != 0, old)

    # --- the internet goes, but the computer still says it is online (navigator.onLine stays true)
    net['down']=True
    pg.reload(wait_until='commit'); pg.wait_for_timeout(12000)
    o=pg.evaluate("""() => ({ q: gia.state.data.quakes?.length ?? 0, note: gia.state.lstatus.quakes, chip: !document.querySelector('#offline-chip')?.hidden, body: document.body.classList.contains('is-offline'), online: navigator.onLine })""")
    check('internet down, adapter still online: the app works it out and shows the Offline chip', o['chip'] and o['body'] and o['online'], o)
    check('quakes draw from the saved copy, and the layer says how old it is', o['q'] == live['q'] > 0 and o['note']['s'] == 'ok', o)
    pg.evaluate("() => gia.refreshLayer('quakes')"); pg.wait_for_timeout(800)
    n=pg.evaluate("() => gia.state.lstatus.quakes")
    check('the layer note reads “Offline: showing what this device saved …”', 'Offline: showing what this device saved' in (n.get('note') or ''), n)
    pg.evaluate("() => document.querySelector('#offline-chip').click()"); pg.wait_for_timeout(1500)
    k=pg.evaluate("() => ({ t: document.querySelector('#notes-title')?.textContent, state: document.querySelector('.ok-state')?.innerText, works: document.querySelectorAll('.ok-works li').length, saved: document.querySelector('.ok-saved summary')?.innerText, list: [...document.querySelectorAll('.ok-list li span')].map((e) => e.textContent) })")
    check('the chip opens the Offline kit: offline state, what works, and the saved sources', k['t'] == 'Offline kit' and k['state'].startswith('Offline') and k['works'] >= 6 and any('Geological' in s or 'USGS' in s for s in k['list']), k)
    pg.evaluate("() => gia.globe.pointOfView({ lat: 48.86, lng: 2.35, altitude: 0.4 }, 0)"); pg.wait_for_timeout(400)
    pg.evaluate("() => document.querySelector('[data-ok=view]').click()"); pg.wait_for_timeout(3000)
    h=pg.evaluate("() => document.querySelector('#ok-here')?.innerText ?? ''")
    check('Where am I, offline: position, nearest city and airport, Sun, Moon and planets', all(x in h for x in ['48.86', 'Paris', 'Airport', 'sunset', 'lit', 'Planets up']), h[:400])
    srch=pg.evaluate("""async () => { document.querySelector('#q').value = 'Zzyzxville'; document.querySelector('#search').dispatchEvent(new Event('submit', { cancelable: true })); await new Promise((r) => setTimeout(r, 1500)); return document.querySelector('#notes-body')?.innerText ?? '' }""")
    check('a web search offline says so, and that bundled places are still found', 'Offline' in srch and 'bundled' in srch, srch[:200])

    # --- the internet comes back
    net['down']=False
    pg.evaluate("async () => (await import('./js/lastknown.js')).probe()"); pg.wait_for_timeout(3000)
    back=pg.evaluate("() => ({ chip: !document.querySelector('#offline-chip').hidden, note: gia.state.lstatus.quakes })")
    check('back online: the chip goes and the layers refresh from the live source', not back['chip'] and 'Offline' not in (back['note'].get('note') or ''), back)

    # --- the service worker: save everything, then open the app with the network switched off
    pg.goto('http://localhost:8765/app/', wait_until='load')
    reg=pg.evaluate("async () => { await navigator.serviceWorker.register('../sw.js'); await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller }")
    if not reg: pg.reload(wait_until='load'); pg.wait_for_timeout(2000)
    pk=pg.evaluate("""() => new Promise((resolve) => {
      const urls = ['data/cities.json', 'data/airports.json', 'data/countries.geojson', 'data/no-such-file.json', '../learn/', 'https://example.com/evil.js'].map((u) => new URL(u, location.href).href);
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'pack-done') resolve(e.data); });
      navigator.serviceWorker.controller.postMessage({ type: 'pack', urls }); setTimeout(() => resolve('timeout'), 20000); })""")
    check('Save everything: the files are saved, a missing one is skipped, another site is refused', isinstance(pk, dict) and pk['total'] == 5 and pk['failed'] == 1 and pk['done'] == 5, pk)
    ctx.set_offline(True)
    pg.goto('http://localhost:8765/app/#@20,0,2.4&l=borders,cities', wait_until='commit'); pg.wait_for_timeout(9000)
    off=pg.evaluate("() => ({ gia: !!window.gia, cities: gia?.state?.data?.cities?.length ?? 0, chip: !document.querySelector('#offline-chip')?.hidden, online: navigator.onLine })")
    check('network switched off: the app opens from the device, draws cities and shows Offline', off['gia'] and off['cities'] > 1000 and off['chip'] and off['online'] is False, off)
    pg.goto('http://localhost:8765/learn/', wait_until='commit'); pg.wait_for_timeout(1500)
    check('the Lessons page opens offline too', 'Lesson' in (pg.evaluate("() => document.body.innerText") or '') or 'lesson' in (pg.evaluate("() => document.body.innerText") or ''))
    ctx.set_offline(False)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
