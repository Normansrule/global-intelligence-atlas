# SPDX-License-Identifier: AGPL-3.0-only
# Wildlife: search an animal (iNaturalist names and photos), see the best places to see it ranked by the chance a
# sighting of its class there is this animal (GBIF counts, mocked), its months and photos; hotspot cards with the
# endemic animals seen there; the main search box; and a clear message when GBIF is down.
import sys, json, os, time, math, re
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
JPG=open(os.path.join(sys.argv[-1], 'tile.jpg'), 'rb').read()
H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
KEY=2440940; CLS=359
# state or province: (name, country code, country, lat, lng, moose sightings, mammal sightings, busiest months)
REG={'USA.2_1':('Alaska','US','United States',61.2,-149.9,9000,40000,[8,9,10]),
     'USA.20_1':('Maine','US','United States',45.3,-69.2,4000,60000,[6,7,10]),
     'CAN.9_1':('Ontario','CA','Canada',46.5,-81.0,5000,90000,[5,6,9]),
     'SWE.21_1':('Västerbotten','SE','Sweden',64.7,19.0,6000,30000,[9,10,11]),
     'NOR.12_1':('Innlandet','NO','Norway',61.3,10.4,2500,25000,[1,2,12]),
     'FIN.1_1':('Lapland','FI','Finland',67.9,25.6,1500,12000,[6,7,8]),
     'USA.51_1':('Wyoming','US','United States',43.0,-107.5,800,30000,[6,7]),
     'XXX.1_1':('Tiny','US','United States',40.0,-100.0,3,3,[1])}
TOTAL=sum(r[5] for r in REG.values())+4000  # some at no province
def rec(i, gid, lat, lng, photo):
    r=REG[gid]; d=time.strftime('%Y-%m-%d', time.gmtime(time.time()-86400*(2+i)))
    o={'key':900000+i,'decimalLatitude':lat,'decimalLongitude':lng,'eventDate':d+'T10:00:00','countryCode':r[1],'gadm':{'level0':{'gid':gid.split('.')[0],'name':r[2]},'level1':{'gid':gid,'name':r[0]}}}
    if photo: o['media']=[{'type':'StillImage','identifier':f'https://inaturalist-open-data.s3.amazonaws.com/photos/{i}/original.jpeg','license':'http://creativecommons.org/licenses/by-nc/4.0/','creator':f'Observer {i}'}]
    if i%5==0: o['media']=[{'type':'StillImage','identifier':'https://example.org/x.jpg','license':'All rights reserved','creator':'Nope'}]
    return o
calls=[]; down={'gbif':False}
def gbif(route):
    u=route.request.url; calls.append(u)
    if down['gbif']: return route.abort()
    q=parse_qs(urlparse(u).query)
    if '/species/match' in u: return route.fulfill(status=200, headers=H, body=json.dumps({'usageKey':KEY,'matchType':'EXACT','kingdom':'Animalia','class':'Mammalia','classKey':CLS,'scientificName':'Alces alces (Linnaeus, 1758)','canonicalName':'Alces alces'}))
    if '/iucnRedListCategory' in u: return route.fulfill(status=200, headers=H, body=json.dumps({'category':'LEAST_CONCERN','code':'LC'}))
    if '/occurrence/search' in u:
        tk=q.get('taxonKey',[''])[0]; gids=q.get('gadmLevel1Gid',[]); lim=int(q.get('limit',['20'])[0]); facets=q.get('facet',[])
        if tk==str(CLS):
            return route.fulfill(status=200, headers=H, body=json.dumps({'count':0,'results':[],'facets':[{'field':'GADM_LEVEL_1_GID','counts':[{'name':g,'count':REG[g][6]} for g in gids if g in REG]}]}))
        if lim==0:
            cc={}
            for r in REG.values(): cc[r[1]]=cc.get(r[1],0)+r[5]
            return route.fulfill(status=200, headers=H, body=json.dumps({'count':TOTAL,'results':[],'facets':[
              {'field':'COUNTRY','counts':sorted([{'name':k,'count':v} for k,v in cc.items()], key=lambda x:-x['count'])},
              {'field':'GADM_LEVEL_1_GID','counts':[{'name':g,'count':r[5]} for g,r in REG.items()]},
              {'field':'MONTH','counts':[{'name':str(m),'count':100+m} for m in range(1,13)]}]}))
        if gids:
            g=gids[0]; r=REG[g]
            rs=[rec(i,g,r[3]+math.sin(i)*0.8,r[4]+math.cos(i)*0.8,i%2==0) for i in range(30)]
            return route.fulfill(status=200, headers=H, body=json.dumps({'count':r[5],'results':rs,'facets':[{'field':'MONTH','counts':[{'name':str(m),'count':(500 if m in r[7] else 60)} for m in range(1,13)]}]}))
        rs=[rec(100+i,g,REG[g][3]+i*0.1,REG[g][4]-i*0.1,False) for i,g in enumerate(list(REG)*20)]
        return route.fulfill(status=200, headers=H, body=json.dumps({'count':TOTAL,'results':rs[:lim]}))
    return route.fulfill(status=404, headers=H, body='{}')
PHOTO={'medium_url':'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg','square_url':'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg','attribution':'(c) Jo Moose, some rights reserved (CC BY)','license_code':'cc-by'}
MOOSE={'id':522193,'name':'Alces alces','rank':'species','preferred_common_name':'Moose','iconic_taxon_name':'Mammalia','default_photo':PHOTO,'observations_count':91000,'wikipedia_url':'http://en.wikipedia.org/wiki/Moose'}
LEMUR={'id':43325,'name':'Lemur catta','rank':'species','preferred_common_name':'Ring-tailed Lemur','iconic_taxon_name':'Mammalia','default_photo':PHOTO,'observations_count':5000}
def inat(route):
    u=route.request.url; calls.append(u)
    if '/taxa/autocomplete' in u:
        q=parse_qs(urlparse(u).query)['q'][0].lower()
        rs=[MOOSE,{'id':1,'name':'Moosea plantus','rank':'species','iconic_taxon_name':'Plantae'}] if 'moose' in q else [LEMUR] if 'lemur' in q else [{**LEMUR,'id':41964,'name':'Panthera tigris','preferred_common_name':'Tiger'}] if 'tiger' in q else []
        return route.fulfill(status=200, headers=H, body=json.dumps({'total_results':len(rs),'results':rs}))
    if '/species_counts' in u:
        if 'endemic=true' in u: return route.fulfill(status=200, headers=H, body=json.dumps({'total_results':412,'results':[{'count':900,'taxon':LEMUR},{'count':300,'taxon':{**LEMUR,'id':43326,'name':'Cryptoprocta ferox','preferred_common_name':'Fossa'}}]}))
        return route.fulfill(status=200, headers=H, body=json.dumps({'total_results':2210,'results':[]}))
    if '/taxa/' in u and '/autocomplete' not in u:  # v2.16: the animal in depth
        ph=lambda i, lic: {'photo':{'id':900+i,'medium_url':f'https://inaturalist-open-data.s3.amazonaws.com/photos/{900+i}/medium.jpg','large_url':f'https://inaturalist-open-data.s3.amazonaws.com/photos/{900+i}/large.jpg','square_url':f'https://inaturalist-open-data.s3.amazonaws.com/photos/{900+i}/square.jpg','attribution':f'(c) Photographer {i}, some rights reserved','license_code':lic}}
        t={**MOOSE,'taxon_photos':[ph(0,'cc-by'),ph(1,'cc-by-nc'),ph(2,None),ph(3,'cc0'),ph(4,'cc-by-sa')],
           'wikipedia_summary':'The <b>moose</b> (<i>Alces alces</i>) is the largest and heaviest extant species of deer.<script>alert(1)</script>',
           'ancestors':[{'rank':'kingdom','name':'Animalia'},{'rank':'class','name':'Mammalia','preferred_common_name':'Mammals'},{'rank':'order','name':'Artiodactyla','preferred_common_name':'Even-toed Ungulates'},{'rank':'family','name':'Cervidae','preferred_common_name':'Deer'},{'rank':'genus','name':'Alces','preferred_common_name':'Moose'}],
           'observations_count':123456,'conservation_status':{'status_name':'least concern','authority':'IUCN Red List'}}
        return route.fulfill(status=200, headers=H, body=json.dumps({'total_results':1,'results':[t]}))
    return route.fulfill(status=404, headers=H, body='{}')
def img(route): return route.fulfill(status=200, body=JPG, headers={'Content-Type':'image/jpeg','Access-Control-Allow-Origin':'*'})
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); csp=[]; pg.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
    pg.route('**/*', handler)
    pg.route('https://api.gbif.org/**', gbif); pg.route('https://api.inaturalist.org/**', inat); pg.route('https://inaturalist-open-data.s3.amazonaws.com/**', img)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.20')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,10,2.2&b=bluemarble&l=borders,wildlife', wait_until='commit'); pg.wait_for_timeout(10000)
    m=pg.evaluate("async () => { const { validateLayer } = await import('./js/registry.js'); const { wildlifeLayer } = await import('./js/wildlife.js'); return validateLayer(wildlifeLayer({}), { groups: [{ id: 'places' }] }); }")
    check('the layer passes the registry check (sources in sources.js, learn text)', m == [], m)
    hs=pg.evaluate("() => { const c = gia.state.chan.wildlife; return { n: c?.points?.length ?? 0, refs: (c?.points ?? []).filter((p) => p.ref?.d?.kind === 'hotspot').length, south: (c?.points ?? []).some((p) => p.lat < -60) } }")
    check('36 unique-animal hotspots show on every continent, Antarctica included', hs['n'] == 36 and hs['refs'] == 36 and hs['south'], hs)
    check('the stylesheet is loaded once', pg.evaluate("() => document.querySelectorAll('link[data-wildlife]').length") == 1)
    # the search box in the Layers panel
    pg.evaluate("() => document.getElementById('wl-q')?.scrollIntoView({ block: 'center' })"); pg.wait_for_timeout(600)
    check('the Layers panel has a Find an animal box and popular animals', pg.evaluate("() => !!document.getElementById('wl-q') && document.querySelectorAll('.wl-pop .chip').length >= 8"))
    pg.fill('#wl-q', 'moose'); pg.wait_for_timeout(1200)
    sug=pg.evaluate("() => [...document.querySelectorAll('.wl-sug')].map((s) => s.innerText.replace(/\\s+/g, ' '))")
    check('typing “moose” suggests the moose with its photo, and leaves plants out', len(sug) == 1 and 'Moose' in sug[0] and 'Alces alces' in sug[0] and pg.evaluate("() => !!document.querySelector('.wl-sug img')"), sug)
    pg.click('.wl-sug'); pg.wait_for_timeout(4500)
    card=pg.evaluate("""() => { const n = document.querySelector('#notes-body');
      return { title: n.querySelector('h3')?.innerText, sub: n.querySelector('.sub')?.innerText, lead: n.querySelector('.wl-lead')?.innerText ?? '', rows: [...n.querySelectorAll('.wl-place')].map((r) => r.innerText.replace(/\\s+/g, ' ')),
        facts: [...n.querySelectorAll('.lm-fact')].map((f) => f.innerText.replace(/\\s+/g, ' ')), share: n.querySelector('.wl-share')?.innerText.replace(/\\s+/g, ' ') ?? '', months: n.querySelectorAll('.wl-months rect').length,
        iucn: n.querySelector('.wl-iucn')?.innerText ?? '', credit: n.querySelector('.lm-hero figcaption')?.innerText ?? '', img: n.querySelector('.lm-hero img')?.src ?? '' } }""")
    check('the moose page opens with its name and scientific name', card['title'] == 'Moose' and card['sub'] == 'Alces alces', card)
    check('the photo fades in once loaded (data-onload, no inline handlers)', pg.evaluate("() => !!document.querySelector('#notes-body .lm-frame.ready img') && !document.querySelector('#notes-body [onload],#notes-body [onerror]')"))
    check('the photo is from iNaturalist and credited with its licence', 'inaturalist' in card['img'] and 'Jo Moose' in card['credit'] and 'CC BY' in card['credit'], card['credit'])
    # v2.16: the animal in depth: a strip of openly licensed photos (unlicensed ones left out), a family tree and a summary
    gal=pg.evaluate("() => [...document.querySelectorAll('#wl-gallery .wl-ph')].map((b) => b.title)")
    check('a strip of 4 openly licensed photos, the unlicensed one left out', len(gal) == 4 and all('Photographer' in g for g in gal) and not any('Photographer 2' in g for g in gal), gal)
    about=pg.evaluate("() => ({ tree: document.querySelector('.wl-tree')?.innerText.replace(/\\s+/g, ' ') ?? '', sum: document.querySelector('.wl-sum')?.innerText ?? '', obs: document.querySelector('.wl-obs')?.innerText ?? '', script: !!document.querySelector('#wl-about script, #wl-about b:not(.wl-tree b)') })")
    check('its family tree: mammals, even-toed ungulates, deer, moose', 'Mammals' in about['tree'] and 'Deer' in about['tree'] and 'Alces' in about['tree'], about)
    check('a Wikipedia summary as plain text (no markup or script from the feed)', 'largest and heaviest' in about['sum'] and 'CC BY-SA' in about['sum'] and not about['script'] and 'alert' not in about['sum'], about)
    check('how often it is seen and its conservation status', '123.5K' in about['obs'] and 'least concern' in about['obs'], about)
    pg.click('#wl-gallery .wl-ph:nth-child(3)'); pg.wait_for_timeout(800)
    sw=pg.evaluate("() => ({ img: document.querySelector('#wl-hero img')?.src ?? '', cap: document.querySelector('#wl-hero figcaption')?.innerText ?? '', on: document.querySelector('#wl-gallery .wl-ph:nth-child(3)')?.getAttribute('aria-pressed') })")
    check('pressing a photo shows it large with its own credit and a public-domain note', '/903/large.jpg' in sw['img'] and 'Photographer 3' in sw['cap'] and 'public domain' in sw['cap'] and sw['on'] == 'true', sw)
    # Västerbotten 6000/30000 = 20% beats Alaska 9000/40000 = 22.5%? no: Alaska 22.5% first, Västerbotten 20% second
    check('best chance is Alaska: about 1 in 4 mammal sightings there is a moose', 'Best chance: Alaska, United States' in card['lead'] and '1 in 4' in card['lead'] and 'mammal' in card['lead'], card['lead'])
    check('places are ranked by chance, not by count (Alaska, Västerbotten, Lapland, Innlandet…)', len(card['rows']) >= 6 and card['rows'][0].startswith('1 Alaska') and card['rows'][1].startswith('2 Västerbotten') and 'Lapland' in card['rows'][2], card['rows'])
    check('a place with 3 records never tops the list', not any('Tiny' in r for r in card['rows'][:6]), card['rows'])
    check('each place shows its chance, when it was last seen and its best months', ('22%' in card['rows'][0] or '23%' in card['rows'][0]) and 'seen 2 days ago' in card['rows'][0] and 'Aug–Oct' in card['rows'][0], card['rows'][0])
    check('figures: chance, sightings, countries, best months', len(card['facts']) == 4 and '5' in card['facts'][2] and 'Aug–Oct' in card['facts'][3], card['facts'])
    check('the share of sightings by country adds up (United States first)', card['share'].startswith('United States') and '%' in card['share'], card['share'])
    check('a twelve-month chart and the IUCN Red List category (LC, least concern)', card['months'] == 12 and 'LC' in card['iucn'] and 'least concern' in card['iucn'], card)
    mp=pg.evaluate("""() => { const c = gia.state.chan.wildlife; const pts = c.points; const pl = pts.filter((p) => p.ref?.d?.kind === 'place');
      return { places: pl.length, dots: pts.filter((p) => !p.ref).length, hot: pts.filter((p) => p.ref?.d?.kind === 'hotspot').length, ring: c.rings?.length ?? 0, first: pl[0]?.ref.d.name, tallest: pl.reduce((a, p) => (p.alt > a.alt ? p : a)).ref.d.name, colors: new Set(pl.map((p) => p.color)).size } }""")
    check('the globe shows each place as a paw pin, tallest where the chance is best, with sightings as dots and a pulse on the best place', mp['places'] >= 6 and mp['dots'] > 100 and mp['hot'] == 0 and mp['ring'] == 1 and mp['tallest'] == 'Alaska' and mp['colors'] >= 4, mp)
    pov=pg.evaluate("() => gia.globe.pointOfView()")
    check('the globe flies to Alaska', abs(pov['lat']-61) < 3 and abs(pov['lng']+150) < 4, pov)
    pg.screenshot(path='/tmp/claude-0/w/wildlife-moose.png')
    # a place
    pg.click('#notes-body [data-wl-place="1"]'); pg.wait_for_timeout(1500)
    pl=pg.evaluate("""() => { const n = document.querySelector('#notes-body'); return { title: n.querySelector('h3')?.innerText, sub: n.querySelector('.sub')?.innerText, facts: [...n.querySelectorAll('.lm-fact')].map((f) => f.innerText.replace(/\\s+/g, ' ')),
      photos: n.querySelectorAll('.wl-photos img').length, hero: n.querySelector('.lm-hero img')?.src ?? '', credit: n.querySelector('.lm-hero figcaption')?.innerText ?? '', months: n.querySelectorAll('.wl-months rect').length, links: [...n.querySelectorAll('.quick a')].map((a) => a.textContent) } }""")
    check('a place card: Västerbotten, Sweden, #2, with chance, share and best months (Sep–Nov)', pl['title'] == 'Västerbotten' and 'Sweden' in pl['sub'] and '#2' in pl['sub'] and any('Sep–Nov' in f for f in pl['facts']), pl)
    check('the place shows only freely licensed sighting photos, medium size, credited', 'medium.jpeg' in pl['hero'] and 'CC BY-NC 4.0' in pl['credit'] and pl['photos'] >= 2 and 'example.org' not in pl['hero'], pl)
    check('links to the sightings on GBIF and iNaturalist', 'GBIF' in pl['links'] and 'iNaturalist' in pl['links'], pl['links'])
    pg.click('#notes-body [data-wl-back]'); pg.wait_for_timeout(1200)
    check('“every place” goes back to the moose page', pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText") == 'Moose')
    words=pg.evaluate("() => (document.querySelector('#notes-body .wl-lead')?.innerText ?? '').split(/\\s+/).length")
    check('the headline is one short sentence (under 25 words)', words < 25, words)
    # hotspots
    pg.click('[data-wl-clear]') if pg.evaluate("() => !!document.querySelector('[data-wl-clear]')") else pg.evaluate("() => document.querySelector('[data-wl-clear]')?.click()")
    pg.wait_for_timeout(800)
    check('“Show unique-animal hotspots” brings the hotspots back', pg.evaluate("() => gia.state.chan.wildlife.points.filter((p) => p.ref?.d?.kind === 'hotspot').length") == 36)
    pg.evaluate("() => gia.select(gia.state.chan.wildlife.points.find((p) => p.ref.d.name === 'Madagascar').ref)"); pg.wait_for_timeout(2500)
    h=pg.evaluate("""() => { const n = document.querySelector('#notes-body'); return { title: n.querySelector('h3')?.innerText, facts: [...n.querySelectorAll('.lm-fact')].map((f) => f.innerText.replace(/\\s+/g, ' ')), look: [...n.querySelectorAll('[data-wl-q]')].map((c) => c.textContent), tiles: [...n.querySelectorAll('.wl-taxon')].map((t) => t.innerText.replace(/\\s+/g, ' ')) } }""")
    check('the Madagascar card: animal species seen, found nowhere else, and the share unique (19%)', h['title'] == 'Madagascar' and any('2,210' in f for f in h['facts']) and any('412' in f for f in h['facts']) and any('19%' in f for f in h['facts']), h)
    check('animals to look for, and endemic animals as photo tiles', 'Ring-tailed lemur' in h['look'] and len(h['tiles']) == 2 and 'Ring-tailed Lemur' in h['tiles'][0], h)
    pg.screenshot(path='/tmp/claude-0/w/wildlife-hotspot.png')
    pg.click('#notes-body .wl-taxon'); pg.wait_for_timeout(4000)
    check('pressing an endemic animal opens where to see it', pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText") == 'Ring-tailed Lemur')
    # the main search box
    pg.fill('#q', 'moose'); pg.wait_for_timeout(2500)
    first=pg.evaluate("() => document.querySelector('#results li')?.innerText.replace(/\\s+/g, ' ')")
    check('the main search offers “Where to see: moose” first', first and first.startswith('Where to see: moose'), first)
    pg.press('#q', 'Enter'); pg.wait_for_timeout(4000)
    check('choosing it opens the moose page', pg.evaluate("() => document.querySelector('#notes-body h3')?.innerText") == 'Moose')
    # a shared link
    url=pg.evaluate("() => location.hash")
    check('the page keeps a shareable link to the animal', 'sel=wildlife~sp%3AAlces%20alces' in url, url)
    # GBIF down
    down['gbif']=True
    pg.evaluate("() => document.querySelector('[data-wl-q=\"Tiger\"]')?.click()"); pg.wait_for_timeout(6000)
    st=pg.evaluate("() => ({ panel: document.getElementById('wl-state')?.innerText ?? '', card: document.querySelector('#notes-body .err')?.innerText ?? '' })")
    check('with GBIF unreachable the page and the panel say so plainly', 'GBIF' in st['card'] or 'GBIF' in st['panel'] or 'did not answer' in st['panel'], st)
    check('no page errors', not errs, errs)
    check('nothing breaks the Content Security Policy', not csp, csp[:3])
    b.close()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
