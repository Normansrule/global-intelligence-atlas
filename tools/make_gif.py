#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas (GIA) — render the README animations (the site served on :8765, or ATLAS_URL=https://…):
#   python3 tools/make_gif.py           the globe turning, lit by the real Sun (global-intelligence-atlas-spin.gif)
#   python3 tools/make_gif.py --looks   East Asia cycling through the sensor looks (global-intelligence-atlas-looks.gif)
import base64, io, os, re, sys
from PIL import Image
from playwright.sync_api import sync_playwright
BASE = os.environ.get('ATLAS_URL', 'http://localhost:8765').rstrip('/')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
LOOKS = '--looks' in sys.argv
frames = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 900, 'height': 560})
    v = re.search(r"export const VERSION = '([^']+)'", open(os.path.join(os.path.dirname(__file__), '..', 'site', 'app', 'js', 'main.js')).read()).group(1)
    pg.add_init_script(f"try {{ localStorage.setItem('global-intelligence-atlas-version', '{v}'); localStorage.setItem('global-intelligence-atlas-quality', 'high'); }} catch (e) {{}}")  # no What's new card
    if '--offline' in sys.argv: pg.route(lambda u: not u.startswith(BASE), lambda r: r.abort())
    view = '/app/#@33,128,1.25&b=bluemarble&l=borders,cables,nuclear,cities' if LOOKS else '/app/#@15,0,2.3&b=daynight&l=sun,stations,cables,routes'
    pg.goto(BASE + view, wait_until='commit'); pg.wait_for_timeout(15000)
    pg.evaluate("(() => { document.querySelectorAll('.topbar,.rail,.drawer,.panel,.statusbar,.ticker,.mapctl,.toast,.bottombar').forEach(e => e.style.display = 'none'); document.body.className = ''; const s = document.getElementById('stage'); Object.assign(s.style, { position: 'fixed', inset: '0' }); gia.globe.width(innerWidth).height(innerHeight); })()")
    pg.wait_for_timeout(1500)
    cdp = pg.context.new_cdp_session(pg)
    for i in range(24):
        if LOOKS: pg.evaluate(f"(() => {{ if ({i} % 6 === 0) gia.setLook('{('normal', 'nvg', 'flir', 'crt')[i // 6]}'); gia.globe.pointOfView({{ lat: 33, lng: {128 + i * 0.6}, altitude: 1.25 }}, 0); }})()")
        else: pg.evaluate(f"(() => {{ const g = gia.globe; g.pointOfView({{ lat: 15, lng: {-i * 15}, altitude: 2.3 }}, 0); }})()")
        pg.wait_for_timeout(1800)
        d = cdp.send('Page.captureScreenshot', {'format': 'png'})['data']
        frames.append(Image.open(io.BytesIO(base64.b64decode(d))).convert('RGB').resize((600, 373), Image.LANCZOS))
    b.close()
pal = [f.quantize(colors=160, method=Image.Quantize.MEDIANCUT) for f in frames]
out = 'site/docs-media/global-intelligence-atlas-' + ('looks' if LOOKS else 'spin') + '.gif'
pal[0].save(out, save_all=True, append_images=pal[1:], duration=260 if LOOKS else 110, loop=0, optimize=True)
print(out, 'frames', len(frames))
