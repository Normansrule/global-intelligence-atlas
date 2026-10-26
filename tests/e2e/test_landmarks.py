# SPDX-License-Identifier: AGPL-3.0-only
# Landmarks: pins for every kind on every continent, visible from orbit down to street level; a card with the
# Commons photo and its credit, figures from Wikidata, one sentence from Wikipedia and Nearby chips; a card that still
# works when Wikimedia is unreachable; and item cards that keep their long parts folded away.
import sys, json, os; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
JPG=open(os.path.join(sys.argv[-1], 'tile.jpg'), 'rb').read()
PAGE={'query':{'pages':[{'pageid':9232,'title':'Eiffel Tower','extract':'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France.',
  'pageimage':'Tour_Eiffel_Wikimedia_Commons.jpg','pageprops':{'wikibase_item':'Q243'},'coordinates':[{'lat':48.8583,'lon':2.2944}]}]}}
INFO={'query':{'pages':[{'title':'File:Tour Eiffel Wikimedia Commons.jpg','imageinfo':[{'thumburl':'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/960px-Tour_Eiffel_Wikimedia_Commons.jpg',
  'descriptionurl':'https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons.jpg',
  'extmetadata':{'Artist':{'value':'<a href="//commons.wikimedia.org/wiki/User:Benh">Benh LIEU SONG</a>'},'LicenseShortName':{'value':'CC BY-SA 3.0'},'LicenseUrl':{'value':'https://creativecommons.org/licenses/by-sa/3.0'}}}]}]}}
q=lambda unit, n: {'mainsnak':{'datavalue':{'value':{'amount':f'+{n}','unit':f'http://www.wikidata.org/entity/{unit}'}}},'rank':'normal'}
WD={'entities':{'Q243':{'claims':{
  'P571':[{'mainsnak':{'datavalue':{'value':{'time':'+1887-01-28T00:00:00Z','precision':11}}},'rank':'normal'}],
  'P2048':[q('Q11573', 330)],
  'P1174':[{**q('1', 5800000), 'qualifiers':{'P585':[{'datavalue':{'value':{'time':'+2015-00-00T00:00:00Z'}}}]}}, {**q('1', 6100000), 'qualifiers':{'P585':[{'datavalue':{'value':{'time':'+2023-00-00T00:00:00Z'}}}]}}],
  'P1435':[{'mainsnak':{'datavalue':{'value':{'id':'Q9259'}}},'rank':'normal'}]}}}}
down={'on':False}
def wiki(route):
    u=route.request.url
    if down['on']: return route.abort()
    body=INFO if 'imageinfo' in u else PAGE
    return route.fulfill(status=200, body=json.dumps(body), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
def wd(route):
    if down['on']: return route.abort()
    return route.fulfill(status=200, body=json.dumps(WD), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
def img(route): return route.fulfill(status=200, body=JPG, headers={'Content-Type':'image/jpeg'})
PINS="""async ([lat, lng, alt]) => {
  gia.globe.pointOfView({ lat, lng, altitude: alt }, 0); await new Promise((r) => setTimeout(r, 2500));
  const el = gia.globe.renderer().domElement; const W = el.clientWidth, H = el.clientHeight; const cam = gia.globe.camera();
  const sc = gia.globe.getScreenCoords(lat, lng, 0); const v = new (cam.position.constructor)(); let near = 0;
  for (const sp of gia.markers.pool) { if (!sp.visible || !sp.userData.pin) continue; sp.getWorldPosition(v); v.project(cam);
    if (v.z < 1 && Math.hypot((v.x + 1) / 2 * W - sc.x, (1 - v.y) / 2 * H - sc.y) < 80) near++; }
  return near;
}"""
WORDS="""() => { const b = document.querySelector('#notes-body'); const t = [...b.querySelectorAll(':scope > :not(details)')].map((e) => e.innerText).join(' ');
  return t.split(/\\s+/).filter(Boolean).length; }"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.route('https://en.wikipedia.org/w/api.php**', wiki); pg.route('https://www.wikidata.org/w/api.php**', wd); pg.route('https://upload.wikimedia.org/**', img)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,10,2.2&b=bluemarble&l=landmarks', wait_until='commit'); pg.wait_for_timeout(12000)
    info=pg.evaluate("() => { const d = gia.state.data.landmarks ?? []; return { n: d.length, kinds: [...new Set(d.map((x) => x.kind))].length, south: d.some((x) => x.lat < -60), lon: [Math.min(...d.map((x) => x.lng)), Math.max(...d.map((x) => x.lng))], titles: new Set(d.map((x) => x.title)).size } }")
    check('about 190 landmarks of all six kinds load, from Antarctica to the Pacific', info['n'] >= 180 and info['kinds'] == 6 and info['south'] and info['lon'][0] < -150 and info['lon'][1] > 160 and info['titles'] == info['n'], info)
    check('the layer is on by default', pg.evaluate("() => gia.state.on.has('landmarks')"))
    m=pg.evaluate("async () => { const { validateLayer } = await import('./js/registry.js'); const { landmarksLayer } = await import('./js/landmarks.js'); return validateLayer(landmarksLayer({}), { groups: [{ id: 'places' }] }); }")
    check('the layer passes the registry check (sources in sources.js, learn text)', m == [], m)
    got={alt: pg.evaluate(PINS, [48.8584, 2.2945, alt]) for alt in [2.0, 0.3, 0.02, 0.002, 0.0002]}
    check('the Eiffel Tower pin stays on screen from orbit to street level', all(n >= 1 for n in got.values()), got)
    # the card (with one traffic camera 200 m away, as the Cameras layer would have it)
    pg.evaluate("() => { gia.state.data.cameras = { ...(gia.state.data.cameras ?? {}), cams: [{ id: 'lm-test-cam', name: 'Pont d’Iéna', lat: 48.8597, lng: 2.2925, img: 'https://upload.wikimedia.org/cam.jpg' }] }; }")
    pg.evaluate("() => gia.select({ layer: 'landmarks', d: gia.state.data.landmarks.find((x) => x.title === 'Eiffel Tower') })"); pg.wait_for_timeout(2500)
    card=pg.evaluate("""() => { const n = document.querySelector('#notes-body'); const img = n.querySelector('.lm-hero img');
      return { img: img?.src ?? null, loaded: !!img?.complete && img.naturalWidth > 0, credit: n.querySelector('.lm-hero figcaption')?.innerText ?? '', facts: [...n.querySelectorAll('.lm-fact')].map((f) => f.innerText.replace(/\\s+/g, ' ')),
        line: n.querySelector('#lm-line')?.textContent ?? '', near: [...n.querySelectorAll('[data-landmark]')].map((c) => c.dataset.landmark), more: !!n.querySelector('details.more:not([open])'), title: n.querySelector('h3')?.innerText } }""")
    check('the card shows the Commons photo, loaded', card['img'] and 'upload.wikimedia.org' in card['img'] and card['loaded'], card)
    check('the photo is credited to its author with its licence', 'Benh LIEU SONG' in card['credit'] and 'CC BY-SA 3.0' in card['credit'], card['credit'])
    f=' | '.join(card['facts'])
    check('figures from Wikidata: built 1887, 330 m tall, latest visitor count, UNESCO', '1887' in f and '330 m' in f and '6.1M' in f and '2023' in f and 'UNESCO' in f, card['facts'])
    check('one sentence from Wikipedia', card['line'].startswith('The Eiffel Tower is') and card['line'].count('.') <= 2, card['line'])
    check('Nearby chips list other landmarks, nearest first', len(card['near']) >= 2 and card['near'][0] in ('Louvre', 'Notre-Dame de Paris'), card['near'])
    check('weather, position and layer notes wait folded under More', card['more'])
    live=pg.evaluate("() => { const b = document.querySelector('#notes-body .lm-live'); return b ? { cam: b.dataset.cam, text: b.innerText.replace(/\\s+/g, ' ') } : null; }")
    check('a live camera within 15 km shows on the card', live and live['cam'] == 'lm-test-cam' and 'Live' in live['text'] and '0.2 km' in live['text'], live)
    words=pg.evaluate(WORDS)
    check('the open card is short (under 90 words before More)', words < 90, words)
    pg.screenshot(path='/tmp/claude-0/w/landmark-card.png')
    pg.click(f'#notes-body [data-landmark="{card["near"][0]}"]'); pg.wait_for_timeout(2500)
    check('a Nearby chip opens that landmark', pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText") == card['near'][0])
    # other item cards are compact too: figures as tiles and one row of buttons
    pg.evaluate("() => gia.toggleLayer('quakes', true)"); pg.wait_for_timeout(4000)
    q2=pg.evaluate("""() => { const d = gia.state.data.quakes; const f = Array.isArray(d) ? d[0] : d?.features?.[0]; if (!f) return null; gia.select({ layer: 'quakes', d: f });
      const n = document.querySelector('#notes-body'); return { tiles: n.querySelectorAll('dl.facts > div').length, quick: n.querySelectorAll('.quick > *').length, street: !!n.querySelector('.quick [data-zoomto$=",street"]'), more: !!n.querySelector('details.more') } }""")
    check('an earthquake card shows figures as tiles and one row of buttons', q2 and q2['tiles'] >= 2 and q2['quick'] >= 2 and q2['street'] and q2['more'], q2)
    # Wikimedia unreachable
    down['on']=True
    pg.evaluate("() => gia.select({ layer: 'landmarks', d: gia.state.data.landmarks.find((x) => x.title === 'Machu Picchu') })"); pg.wait_for_timeout(3000)
    off=pg.evaluate("() => { const n = document.querySelector('#notes-body'); return { title: n.querySelector('h3')?.innerText, sub: n.querySelector('.sub')?.innerText, facts: n.querySelectorAll('.lm-fact:not(.skel)').length, skel: n.querySelectorAll('.skel, .loading').length } }")
    check('no live camera row where none is near', pg.evaluate("() => !document.querySelector('#notes-body .lm-live')"))
    check('offline, the card still shows name, kind, country and position', off['title'] == 'Machu Picchu' and 'Peru' in (off['sub'] or '') and off['facts'] >= 1 and off['skel'] == 0, off)
    when=pg.evaluate("async () => { const { fmtWhen } = await import('./js/landmarks.js'); return [fmtWhen({ time: '-2560-00-00T00:00:00Z', precision: 9 }), fmtWhen({ time: '+0080-00-00T00:00:00Z', precision: 9 }), fmtWhen({ time: '+1201-00-00T00:00:00Z', precision: 7 }), fmtWhen({ time: '+1880-00-00T00:00:00Z', precision: 8 })]; }")
    check('dates read as people say them', when == ['2560 BC', '80 AD', '13th century', '1880s'], when)
    check('no page errors', not errs, errs)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
