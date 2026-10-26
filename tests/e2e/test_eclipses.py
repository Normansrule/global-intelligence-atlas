# SPDX-License-Identifier: AGPL-3.0-only
# Eclipses and landing sites: the eclipse list (Astronomy Engine), Watch (time machine, Day/night map, camera), the
# Moon's shadow on the Earth where NASA puts it, the Earth's red shadow on the Moon, and the landing-site pins.
import sys, os, io; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
from PIL import Image
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
def patch(pg, x, y, r=5):
    im=Image.open(io.BytesIO(pg.screenshot(clip={'x': x - r, 'y': y - r, 'width': 2 * r + 1, 'height': 2 * r + 1}))).convert('RGB')
    return list(im.resize((1, 1), Image.BOX).getpixel((0, 0)))  # the patch's average colour
lum=lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
AXIS="""() => { const { B, F } = gia.cosmos.debug(); const m = B.moon.pos.clone().applyMatrix4(F); const s = B.sun.pos.clone().applyMatrix4(F);
  const d = m.clone().sub(s).normalize(); const b = m.dot(d); const h = b * b - (m.lengthSq() - 100 * 100); if (h < 0) return null;
  const p = m.clone().addScaledVector(d, -b - Math.sqrt(h)); const g = gia.globe.toGeoCoords(p); return { lat: g.lat, lng: g.lng }; }"""
SCREEN="""([lat, lng]) => { const c = gia.globe.getCoords(lat, lng, 0); const r = gia.globe.renderer().domElement.getBoundingClientRect(); const v = new (gia.cosmos.debug().cam.position.constructor)(c.x, c.y, c.z).project(gia.globe.camera());
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    shader=[]; pg.on('console', lambda m: ('Shader Error' in m.text or 'shader' in m.text.lower() and m.type == 'error') and shader.append(m.text[:300]))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12');localStorage.setItem('gia-theme','dark')}catch(e){}")
    pg.goto('http://localhost:8765/app/?debug#@20,10,2.4&b=bluemarble&l=borders,planets', wait_until='commit'); pg.wait_for_timeout(14000)
    pg.wait_for_function('() => gia.cosmos.ready()', timeout=20000)
    # pin the clock to a known day, so the list below is always the same
    pg.evaluate("() => { gia.clock.pause(true); gia.clock.set(Date.parse('2026-10-25T12:00:00Z')); }"); pg.wait_for_timeout(600)
    pg.evaluate("() => document.querySelector('[data-eclipses]') ? document.querySelector('[data-eclipses]').click() : gia.cosmos.eclipses()"); pg.wait_for_timeout(1500)
    if not pg.evaluate("() => !!document.querySelector('.ecl-list')"): pg.evaluate("() => gia.cosmos.eclipses()"); pg.wait_for_timeout(1500)
    L=pg.evaluate("() => gia.cosmos.eclipseList()")
    rows=pg.evaluate("() => document.querySelectorAll('.ecl-list li').length")
    egypt=[e for e in L if e['body'] == 'sun' and e['kind'] == 'total' and not e['past']]
    check('the eclipse list shows the coming ones, plus the last total of each kind', rows >= 9 and any(e['past'] for e in L), (rows, len(L)))
    check('the total eclipse of 2 August 2027 is greatest over Egypt (NASA: 25.5° N, 33.2° E, 10:07 UTC)', egypt and abs(egypt[0]['lat'] - 25.5) < 0.3 and abs(egypt[0]['lng'] - 33.2) < 0.3 and abs(egypt[0]['peak'] / 1000 - 1817201200) < 120, egypt[:1])
    lunar=[e for e in L if e['body'] == 'moon' and e['kind'] == 'total' and not e['past']]
    check('the next total eclipse of the Moon is 31 December 2028 (NASA: 16:52 UTC, 71 minutes red)', lunar and abs(lunar[0]['peak'] / 1000 - 1861894300) < 180 and 65 < lunar[0]['total'] < 78, lunar[:1])
    # Watch the eclipse of the Sun
    e=egypt[0]; i=L.index(e)
    pg.evaluate("(i) => document.querySelector(`[data-eclipse='${i}']`).click()", i); pg.wait_for_timeout(4500)
    w=pg.evaluate("() => ({ base: gia.state.base, speed: gia.clock.speed, bar: !document.querySelector('#timebar').hidden })")
    check('Watch switches to the Day/night map and runs the time machine at 10 minutes a second', w['base'] == 'daynight' and w['speed'] == 600 and w['bar'], w)
    pg.evaluate("(t) => { gia.clock.pause(true); gia.clock.set(t); }", e['peak']); pg.wait_for_timeout(2000)
    ax=pg.evaluate(AXIS); on=pg.evaluate("() => gia.globe.globeMaterial().uniforms.eclOn.value")
    check('at the peak the Moon’s shadow falls where NASA puts greatest eclipse (within 0.5°)', ax and on == 1 and abs(ax['lat'] - e['lat']) < 0.5 and abs(ax['lng'] - e['lng']) < 0.5, (ax, on))
    pg.evaluate("() => { gia.globe.pointOfView({ lat: 25.5, lng: 33.2, altitude: 2.1 }, 0); document.querySelectorAll('.html-marker, .sun-marker').forEach((el) => el.style.visibility = 'hidden'); gia.toggleLayer('sun', false); }"); pg.wait_for_timeout(1500)
    xy=pg.evaluate(SCREEN, [25.5, 33.2]); dark=patch(pg, *xy)
    pg.evaluate("(t) => gia.clock.set(t)", e['peak'] + 86400000); pg.wait_for_timeout(2000)
    light=patch(pg, *xy); off=pg.evaluate("() => gia.globe.globeMaterial().uniforms.eclOn.value")
    check('the ground under the shadow is dark, and lit again a day later (shadow switched off)', lum(dark) < 0.35 * lum(light) and off == 0, (dark, light, off))
    # It stops by itself two hours after the middle
    pg.evaluate("(t) => { gia.clock.set(t); gia.clock.setSpeed(600); }", e['peak'] + 2 * 3600000 - 2000); pg.wait_for_timeout(1500)
    check('Watch pauses by itself two hours after the middle of the eclipse', pg.evaluate("() => gia.clock.paused"))
    # Watch the eclipse of the Moon: out at the Moon, which turns red
    pg.evaluate("() => gia.cosmos.eclipses()"); pg.wait_for_timeout(800)
    L2=pg.evaluate("() => gia.cosmos.eclipseList()"); j=next(k for k, x in enumerate(L2) if x['body'] == 'moon' and x['kind'] == 'total' and not x['past']); m=L2[j]
    pg.evaluate("(i) => document.querySelector(`[data-eclipse='${i}']`).click()", j); pg.wait_for_timeout(9000)
    pg.evaluate("(t) => { gia.clock.pause(true); gia.clock.set(t); }", m['peak']); pg.wait_for_timeout(1500)
    f=pg.evaluate("() => gia.cosmos.focus()")
    mc=pg.evaluate("""() => { const { B, F, cam } = gia.cosmos.debug(); const v = B.moon.pos.clone().applyMatrix4(F).project(cam); const r = gia.globe.renderer().domElement.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }""")
    red=patch(pg, *mc, r=12)
    pg.evaluate("(t) => gia.clock.set(t)", m['peak'] + 86400000); pg.wait_for_timeout(1800)
    mc2=pg.evaluate("""() => { const { B, F, cam } = gia.cosmos.debug(); const v = B.moon.pos.clone().applyMatrix4(F).project(cam); const r = gia.globe.renderer().domElement.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }""")
    full=patch(pg, *mc2, r=12)
    check('the eclipsed Moon is a dim copper red, and bright grey a day later', f == 'moon' and red[0] > 1.8 * red[2] and lum(red) < 0.5 * lum(full) and abs(full[0] - full[2]) < 30, (f, red, full))
    # Landing sites
    pg.evaluate("() => { gia.clock.live(); gia.cosmos.explore('moon', { instant: true }); }"); pg.wait_for_timeout(2500)
    pg.evaluate("() => { const { cam, st, B } = gia.cosmos.debug(); const t = st.ctl.target; cam.position.sub(t).setLength(B.moon.r * 2.0).add(t); }"); pg.wait_for_timeout(1500)
    n=pg.evaluate("() => [...document.querySelectorAll('.space-site')].filter((e) => !e.hidden).map((e) => e.textContent)")
    check('the Moon shows its landing sites as pins (named once it fills the view)', len(n) >= 5 and pg.evaluate("() => document.querySelector('.space-sites').classList.contains('named')"), n)
    pg.evaluate("() => { const { cam, st, B } = gia.cosmos.debug(); const t = st.ctl.target; cam.position.sub(t).setLength(B.moon.r * 3.4).add(t); }"); pg.wait_for_timeout(1200)
    vis=pg.evaluate("() => { const el = [...document.querySelectorAll('.space-site')].find((e) => !e.hidden && e.textContent.startsWith('Apollo')); if (el) el.click(); return el?.textContent ?? null; }"); pg.wait_for_timeout(2500)
    card=pg.evaluate("() => document.querySelector('#notes-body')?.textContent ?? ''")
    check('a pin opens its story (an Apollo landing: crew, date, place)', vis and vis in card and 'Crew' in card and 'Landed on the Moon' in card and ('° N' in card or '° S' in card), (vis, card[:200]))
    pg.evaluate("() => document.querySelector('.space-bar .sb-sites').click()"); pg.wait_for_timeout(800)
    check('the Landings button in the space bar hides the pins', pg.evaluate("() => document.querySelector('.space-sites').hidden"))
    pg.evaluate("() => document.querySelector('.space-bar .sb-sites').click()"); pg.wait_for_timeout(300)
    pg.evaluate("() => gia.cosmos.explore('mars', { instant: true })"); pg.wait_for_timeout(2500)
    nm=pg.evaluate("() => [...document.querySelectorAll('.space-site')].filter((e) => !e.hidden).length")
    check('Mars has its landers and rovers too', nm >= 1, nm)
    check('no shader errors', not shader, shader)
    check('no page errors', not errs, errs)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
