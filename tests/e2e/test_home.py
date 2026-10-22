import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# The home page story: one live globe pinned beside five chapters. Scrolling to a chapter turns the globe and
# lights only its points; nothing is ever left invisible, on a phone or with reduced motion.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
HIDDEN="() => [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity < 0.9).length"
SWEEP="async () => { for (let y = 0; y < document.body.scrollHeight; y += 250) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } }"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    ctx=b.new_context(viewport={'width':1440,'height':900}); pg=ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.route('**/*', handler)
    pg.goto('http://localhost:8765/', wait_until='commit'); pg.wait_for_timeout(5000)
    check('the headline is split into words that stay readable text', pg.locator('.hero h1 .w').count()>=5 and pg.locator('.hero h1').inner_text().strip()=='The world right now, counted')
    check('the hero counts arrive from the feeds', pg.locator('#tq').inner_text().strip() not in ('…',''), pg.locator('#tq').inner_text())
    seen=[]
    for i,kind in enumerate(['quakes','fires','storms','volcanoes','all'], start=1):
        pg.evaluate(f"document.getElementById('ch{i}').scrollIntoView({{block:'center'}})"); pg.wait_for_timeout(1800)
        st=pg.evaluate("() => ({ dot: document.querySelector('.ch-dots a[aria-current]')?.dataset.go, cap: document.getElementById('stage-cap').textContent, big: document.getElementById('ch%d').closest('section').querySelector('[data-count]')?.textContent, stuck: Math.round(document.querySelector('.journey-stage .stage').getBoundingClientRect().top) })" % i)
        seen.append(st)
        check(f'chapter {i} steers the globe ({kind})', st['dot']==kind and st['cap'], st)
    check('the globe stays pinned while the chapters scroll', len({s['stuck'] for s in seen})==1, [s['stuck'] for s in seen])
    check('each chapter shows its live number', all(s['big'] not in ('…','',None) for s in seen[:4]), [s['big'] for s in seen])
    pg.evaluate(SWEEP); pg.wait_for_timeout(2500)
    check('after scrolling, nothing is left hidden', pg.evaluate(HIDDEN)==0, pg.evaluate(HIDDEN))
    pg.goto('http://localhost:8765/', wait_until='commit'); pg.wait_for_timeout(4000)
    pg.click('#tally button[data-k="quakes"]'); pg.wait_for_timeout(600)
    check('a tally row still picks its points', pg.locator('#tally button[data-k="quakes"]').get_attribute('aria-pressed')=='true' and 'Earthquakes' in pg.locator('#stage-cap').inner_text())
    check('no page errors', not errs, errs[:3]); ctx.close()
    for name,kw in [('phone',{'viewport':{'width':390,'height':844}}),('reduced motion',{'viewport':{'width':1280,'height':800},'reduced_motion':'reduce'})]:
        ctx=b.new_context(**kw); pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.route('**/*', handler)
        pg.goto('http://localhost:8765/', wait_until='commit'); pg.wait_for_timeout(4000)
        pg.evaluate(SWEEP); pg.wait_for_timeout(2500)
        sx=pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        check(f'{name}: nothing hidden, no sideways scroll, no errors', pg.evaluate(HIDDEN)==0 and sx<=0 and not errs, (pg.evaluate(HIDDEN), sx, errs[:2]))
        if name=='phone':
            pg.evaluate("document.getElementById('ch2').scrollIntoView({block:'start'})"); pg.wait_for_timeout(800)
            g=pg.evaluate("() => { const s = document.querySelector('.journey-stage').getBoundingClientRect(); const n = document.querySelector('.nav').getBoundingClientRect(); return { stageTop: s.top, navBottom: n.bottom } }")
            check('phone: the globe sits just under the navigation', abs(g['stageTop']-g['navBottom'])<=2, g)
        ctx.close()
    b.close()
fails=[n for n,ok in res if not ok]
print(f"SUMMARY {len(res)-len(fails)} / {len(res)}"); sys.exit(1 if fails else 0)
