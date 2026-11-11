# SPDX-License-Identifier: AGPL-3.0-only
# v2.16: the Print look (an ordered halftone in ink on paper, key 6) and the Open Eagle Eye credit on the webcam layer.
import sys
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.22')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,10,2.2&b=bluemarble&l=borders,cities', wait_until='commit'); pg.wait_for_timeout(9000)
    pg.keyboard.press('6'); pg.wait_for_timeout(1500)
    check('key 6 picks Print', pg.evaluate("document.body.dataset.look")=='print')
    check('the canvas uses the halftone filter', 'look-print' in pg.evaluate("getComputedStyle(document.querySelector('#globe canvas')).filter"))
    check('the Print button is checked', pg.evaluate("document.querySelector('[data-look=print]').getAttribute('aria-checked')")=='true')
    check('the view label says Print', 'Print' in (pg.evaluate("document.getElementById('view-label')?.textContent") or ''))
    pg.keyboard.press('1'); pg.wait_for_timeout(300)
    check('key 1 returns to Normal', pg.evaluate("document.body.dataset.look")=='normal')
    check('the halftone filter is defined with a tiled Bayer screen', pg.evaluate("!!document.querySelector('#look-print feTile') && !!document.querySelector('#look-print feImage')"))
    refs=pg.evaluate("JSON.stringify(gia.layerManifest().layers.find(l=>l.id==='webcams')||{})")
    check('the worldwide webcam layer credits Open Eagle Eye', 'eagleeye' in refs, refs[:300])
    check('no page errors', not errs, errs)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}'); sys.exit(0 if all(res) else 1)
