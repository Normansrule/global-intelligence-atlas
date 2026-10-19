import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
import json, datetime
# v2.12 News: the News section in the rail. Headlines from the news-data branch (publishers' own feeds) with region
# and word filters, and Live TV that plays broadcasters' official streams and stops when you leave the tab.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
now=datetime.datetime.now(datetime.timezone.utc)
iso=lambda m: (now-datetime.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
HEAD={'updated': iso(3), 'items': [
  {'t':'Flooding closes roads across the region','u':'https://www.bbc.com/news/1','at':iso(5),'p':'bbc','r':'europe','f':'bbc:3'},
  {'t':'Election results due in Nairobi','u':'https://www.africanews.com/2','at':iso(40),'p':'africanews','r':'africa','f':'africanews:0'},
  {'t':'Typhoon nears the coast','u':'https://www.japantimes.co.jp/3','at':iso(120),'p':'japantimes','r':'asia','f':'japantimes:0'},
  {'t':'Ceasefire talks resume','u':'https://www.aljazeera.com/4','at':iso(200),'p':'aljazeera','r':'mideast','f':'aljazeera:0'}]}
CH={'updated': iso(3), 'channels': [
  {'key':'dw','live':True,'video':'abcDEF12345','hls':['https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/master.m3u8']},
  {'key':'france24','live':None,'video':None,'hls':[]},
  {'key':'sky','live':False,'video':None,'hls':[]},
  {'key':'trtworld','live':True,'video':None,'hls':['https://tv-trtworld.medya.trt.com.tr/master.m3u8']}]}
def news(route):
    k=route.request.url.split('/news-data/')[1].split('?')[0]
    body={'headlines.json':HEAD,'channels.json':CH}.get(k)
    if body is None: return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    return route.fulfill(status=200, body=json.dumps(body), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
embeds=[]
def yt(route): embeds.append(route.request.url); return route.fulfill(status=200, body='<html><body>player</body></html>', headers={'Content-Type':'text/html'})
def m3u8(route): return route.fulfill(status=200, body='#EXTM3U\n', headers={'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*'})
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.12');localStorage.setItem('global-intelligence-atlas-section','layers')}catch(e){}"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.route('**/news-data/**', news)
    pg.route(lambda u: 'youtube' in u and '/embed/' in u, yt); pg.route('**/*.m3u8', m3u8)
    pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,10,2.5&l=borders', wait_until='commit'); pg.wait_for_timeout(9000)
    btn=pg.locator('.rail [data-section="news"]')
    check('the rail has a News button', btn.count()==1 and btn.is_visible())
    btn.click(); pg.wait_for_timeout(1500)
    check('News opens with the headlines', pg.locator('#sect-news').is_visible() and pg.locator('#drawer-title').inner_text()=='News')
    links=pg.locator('#news-list a')
    check('every headline from the feed is listed', links.count()==4, links.count())
    meta=pg.locator('#news-list li').first.inner_text()
    check('each headline shows the publisher, its ownership and how long ago', 'BBC News' in meta and 'Public' in meta and 'min ago' in meta, meta.replace('\n',' · '))
    check("headlines open on the publisher's site in a new tab, without passing the page", all(links.nth(i).get_attribute('target')=='_blank' and 'noopener' in links.nth(i).get_attribute('rel') and 'noreferrer' in links.nth(i).get_attribute('rel') for i in range(links.count())))
    check('state-funded publishers are labelled', 'State' in pg.locator('#news-list li', has_text='Ceasefire').inner_text())
    pg.click('[data-news-region="africa"]'); pg.wait_for_timeout(300)
    check('a region chip shows only that region', links.count()==1 and 'Nairobi' in links.first.inner_text(), links.count())
    pg.click('[data-news-region="all"]'); pg.fill('#news-text', 'typhoon'); pg.wait_for_timeout(300)
    check('the search filters by word', links.count()==1 and 'Typhoon' in links.first.inner_text())
    pg.fill('#news-text', ''); pg.wait_for_timeout(200)
    check('the updated time is shown', 'Updated' in pg.locator('#news-upd').inner_text())
    was=pg.evaluate("() => gia.state.on.has('news')"); lbl=pg.locator('[data-news-layer]').inner_text()
    pg.click('[data-news-layer]'); pg.wait_for_timeout(800)
    now_on=pg.evaluate("() => gia.state.on.has('news')")
    check('the button shows or hides the news places layer on the globe', now_on != was and (('Show' in lbl) == (not was)), (was, now_on, lbl))
    # Live TV
    pg.click('[data-news-tab="tv"]'); pg.wait_for_timeout(1500)
    names=pg.locator('.news-chan b').all_inner_texts()
    check('Live TV lists the channels that were live or could not be checked', 'DW News' in names and 'France 24 English' in names and 'TRT World' in names, names[:8])
    off_t=pg.locator('.news-off').text_content() if pg.locator('.news-off').count() else ''
    check('channels found offline are listed apart, with a link to the broadcaster', 'Sky News' not in names and 'Sky News' in off_t and pg.locator('.news-off a').count()>=1, (off_t[:80], names))
    pg.click('[data-chan="dw"]'); pg.wait_for_timeout(1000)
    src=pg.locator('#news-player iframe').get_attribute('src') or ''
    check("a verified live channel plays the broadcaster's YouTube live video, muted, from the no-cookie player", 'youtube-nocookie.com/embed/abcDEF12345' in src and 'mute=1' in src, src)
    pg.click('[data-chan="france24"]'); pg.wait_for_timeout(800)
    src=pg.locator('#news-player iframe').get_attribute('src') or ''
    check("a channel the server could not check plays through the broadcaster's channel live embed", 'live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg' in src, src)
    check('only one channel plays at a time', pg.locator('#news-player iframe, #news-player video').count()==1)
    pg.click('[data-chan="trtworld"]'); pg.wait_for_timeout(2500)
    check("a channel with only its own HLS stream plays in a video element", pg.locator('#news-player video').count()==1 and pg.locator('#news-player iframe').count()==0)
    check('the player says who owns the channel', 'State' in pg.locator('.news-cap').inner_text())
    pg.click('[data-tv-region="africa"]'); pg.wait_for_timeout(300)
    check('the region chips filter the channels', set(pg.locator('.news-chan b').all_inner_texts()) <= {'Africanews','Channels Television','Arise News'})
    pg.click('.rail [data-section="layers"]'); pg.wait_for_timeout(800)
    check('leaving News stops the video', pg.locator('#news-player iframe, #news-player video').count()==0)
    # back to News, play, close the drawer
    pg.click('.rail [data-section="news"]'); pg.wait_for_timeout(1200)
    pg.click('[data-news-tab="tv"]'); pg.wait_for_timeout(1200); pg.click('[data-tv-region="all"]'); pg.click('[data-chan="dw"]'); pg.wait_for_timeout(600)
    pg.click('.rail [data-section="news"]'); pg.wait_for_timeout(800)
    check('closing the drawer stops the video', pg.locator('#news-player iframe, #news-player video').count()==0)
    check('no page errors', not errs, errs[:3]); pg.close()
    # phone width
    pg=b.new_page(viewport={'width':390,'height':844}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.route('**/*', handler); pg.route('**/news-data/**', news); pg.route(lambda u: 'youtube' in u and '/embed/' in u, yt)
    pg.add_init_script(INIT); pg.goto('http://localhost:8765/app/#@20,10,2.5&l=borders', wait_until='commit'); pg.wait_for_timeout(8000)
    btn=pg.locator('.rail [data-section="news"]')
    box=btn.bounding_box()
    check('on a phone the News button fits in the bottom bar', box and box['x']>=0 and box['x']+box['width']<=390, box)
    btn.click(); pg.wait_for_timeout(1500); pg.click('[data-news-tab="tv"]'); pg.wait_for_timeout(1200); pg.click('[data-chan="dw"]'); pg.wait_for_timeout(800)
    fb=pg.locator('.news-frame').bounding_box()
    check('on a phone the player fits the screen width', fb and fb['x']>=0 and fb['x']+fb['width']<=390, fb)
    check('no page errors on a phone', not errs, errs[:3])
    # a short window: all nine rail buttons still fit
    pg=b.new_page(viewport={'width':900,'height':650}); pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto('http://localhost:8765/app/#@20,10,2.5&l=borders', wait_until='commit'); pg.wait_for_timeout(6000)
    fit=pg.evaluate("() => { const r=document.querySelector('.rail').getBoundingClientRect(); const bs=[...document.querySelectorAll('.rail button')]; return bs.length >= 9 && bs.every(b => b.getBoundingClientRect().bottom <= r.bottom + 1) }")
    check('in a short window (900 by 650) every rail button fits', fit); pg.close()
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
