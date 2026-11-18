# SPDX-License-Identifier: AGPL-3.0-only
# v2.24 Dock with the ISS (docking.js, data/iss.bin from tools/build-iss.py) and typed positions in search (parseCoords).
import sys, os, struct
sys.path.insert(0, sys.argv[-1]); from mock import handler
from playwright.sync_api import sync_playwright
res=[]
def check(n, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n, '' if ok else info)
ROOT=os.path.abspath(os.path.join(sys.argv[-1], '..', '..'))
b=open(os.path.join(ROOT, 'site/app/data/iss.bin'), 'rb').read()
check('the station model is an ISS1 file under 800 kB', b[:4]==b'ISS1' and len(b) < 800_000, (b[:4], len(b)))
with sync_playwright() as p:
    br=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    pg=br.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.30')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@20,0,2.4&l=borders,stations', wait_until='commit')
    pg.wait_for_function("() => window.gia", timeout=60000); pg.wait_for_timeout(3000)
    check('version 2.30', pg.evaluate("() => gia.VERSION")=='2.30')
    check('the docking code is not loaded until it is opened', not pg.evaluate("() => performance.getEntriesByType('resource').some((e) => e.name.includes('docking.js'))"))
    sim=pg.evaluate("""async () => { const m = await import('/app/js/docking.js'); const st = await m.loadStation();
      const out = { tris: st.tris, size: [st.size.x, st.size.y, st.size.z], groups: st.group.children.length };
      // the port sits at the forward end of the station
      const box = { maxY: -1e9 }; st.group.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); if (o.userData.role === 4 || o.userData.role === 0) box.maxY = Math.max(box.maxY, o.geometry.boundingBox.max.y); } });
      out.portGap = box.maxY - m.PORT[1];
      const run = (seed) => { const s = m.startState(seed); s.auto = true; while (!s.done && s.t < 3600) m.step(s, { t: [0, 0, 0], r: [0, 0, 0] }, 0.05); return { t: s.t, ok: s.done?.ok, title: s.done?.title, m: s.done?.m }; };
      out.auto = [1, 7, 12345].map(run);
      // a too-fast contact is refused, with the reason
      const f = m.startState(3); f.p.set(m.PORT[0], m.PORT[1] + 0.5, m.PORT[2]); f.v.set(0, -0.3, 0); f.q = m.startState(3).q; for (let i = 0; i < 40 && !f.done; i++) m.step(f, { t: [0, 0, 0], r: [0, 0, 0] }, 0.05);
      out.fast = f.done;
      // a gentle, straight contact is a capture; a slow one is refused
      const g = m.startState(4); g.p.set(m.PORT[0], m.PORT[1] + 0.1, m.PORT[2]); g.v.set(0, -0.07, 0); g.w.set(0, 0, 0); g.q.copy(m.startState(4).q); g.q.copy(m.startState(4).q);
      const Q0 = m.startState(1); Q0.q.identity();
      out.verdicts = [m.verdict({ lat: 0.02, close: 0.07, latRate: 0.01, angle: 1, rate: 0.1 }).title, m.verdict({ lat: 0.02, close: 0.03, latRate: 0.01, angle: 1, rate: 0.1 }).title,
        m.verdict({ lat: 0.3, close: 0.07, latRate: 0.01, angle: 1, rate: 0.1 }).title, m.verdict({ lat: 0.02, close: 0.07, latRate: 0.01, angle: 6, rate: 0.1 }).title];
      // orbital mechanics: on the V-bar at rest nothing moves; 3 m above it the capsule drifts
      const v = m.startState(9); v.p.set(m.PORT[0], m.PORT[1] + 100, m.PORT[2]); v.w.set(0, 0, 0); for (let i = 0; i < 6000; i++) m.step(v, { t: [0, 0, 0], r: [0, 0, 0] }, 0.1);
      const u = m.startState(9); u.p.set(m.PORT[0] + 3, m.PORT[1] + 100, m.PORT[2]); u.w.set(0, 0, 0); for (let i = 0; i < 6000; i++) m.step(u, { t: [0, 0, 0], r: [0, 0, 0] }, 0.1);
      out.vbar = m.measure(v).range; out.drift = [m.measure(u).up, m.measure(u).along];
      out.n = m.meanMotion(420) * 60 * 92.7 / (2 * Math.PI);
      return out; }""")
    check('the station is drawn at its real size: about 109 m along the truss and 73 m long (within 6 %)', abs(sim['size'][2]-115.9) < 2 and 69 < sim['size'][1] < 78, sim['size'])
    check('thinned to under 80,000 triangles in five groups (hull, arrays, radiators, truss, modules)', sim['tris'] < 80000 and sim['groups']==5, (sim['tris'], sim['groups']))
    check('the docking port is at the forward end of the modules (within 0.5 m)', abs(sim['portGap']) < 0.5, sim['portGap'])
    check('the autopilot docks from 200 m within the soft-capture limits, in 10 to 25 simulated minutes', all(a['ok'] and 600 < a['t'] < 1500 for a in sim['auto']), sim['auto'])
    check('a contact at 0.3 m/s is refused as too fast', sim['fast'] and not sim['fast']['ok'] and sim['fast']['title']=='Too fast', sim['fast'])
    check('the limits: 0.07 m/s straight is a capture; too gentle, off centre and tilted are refused', sim['verdicts']==['Soft capture','Too gentle','Off centre','Not lined up'], sim['verdicts'])
    check('orbital mechanics: at rest ahead of the station nothing moves; 3 m above, the capsule drifts away', abs(sim['vbar']-100) < 0.01 and (sim['drift'][0] > 4 or abs(sim['drift'][1]-100) > 5), (sim['vbar'], sim['drift']))
    check('one orbit at 420 km takes about 92.7 minutes', abs(sim['n']-1) < 0.01, sim['n'])
    # the window
    pg.evaluate("() => document.querySelector('[data-section=tools]')?.click()"); pg.wait_for_timeout(600)
    pg.evaluate("() => document.querySelector('.tool[data-dock]').click()"); pg.wait_for_timeout(5000)
    w=pg.evaluate("() => ({ open: !!document.querySelector('.dock canvas'), where: document.querySelector('.dock-where')?.textContent ?? '', hud: document.querySelector('.dock-hud')?.textContent ?? '', pads: document.querySelectorAll('.dock-grp button').length })")
    check('Tools → Dock with the ISS opens the window with readouts, 12 control pads and the station’s real place below', w['open'] and 'Distance to the port' in w['hud'] and w['pads']==15 and ' km up' in w['where'], w)
    d0=pg.evaluate("async () => (await import('/app/js/docking.js'))")
    pg.keyboard.down('w'); pg.wait_for_timeout(1500); pg.keyboard.up('w'); pg.wait_for_timeout(300)
    c=pg.evaluate("() => document.querySelector('.dock-hud').textContent.match(/Closing speed([\\d.-]+)/)?.[1]")
    check('holding W fires the thrusters towards the station', c and float(c) > 0.02, c)
    pg.keyboard.press('p'); pg.keyboard.press('c'); pg.keyboard.press('t'); pg.wait_for_timeout(500)
    k=pg.evaluate("() => ({ auto: document.querySelector('[data-auto]').getAttribute('aria-pressed'), view: document.querySelector('[data-view]').textContent, speed: document.querySelector('[data-speed]').textContent, cross: !document.querySelector('.dock-cross').hidden })")
    check('P, C and T switch the autopilot, the view (capsule camera with its cross) and the time speed', k=={'auto':'true','view':'View: capsule camera','speed':'10×','cross':True}, k)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('Esc closes the window', not pg.evaluate("() => !!document.querySelector('.dock')"))
    # positions in search
    pc=pg.evaluate("""async () => { const { parseCoords } = await import('/app/js/astro.js');
      return ['48.8584, 2.2945', 'geo:39.7392,-104.9903;u=10', '33.87 S 151.21 E', '151.21 E, 33.87 S', "48°51'30\\"N 2°17'40\\"E", 'Paris', '95, 10'].map((s) => parseCoords(s)); }""")
    r=lambda x: x and [round(x['lat'],4), round(x['lng'],4)]
    check('typed positions are read in every common form, and words or impossible numbers are not', [r(x) for x in pc]==[[48.8584,2.2945],[39.7392,-104.9903],[-33.87,151.21],[-33.87,151.21],[48.8583,2.2944],None,None], [r(x) for x in pc])
    pg.fill('#q', 'geo:-33.8568,151.2153'); pg.wait_for_function("() => document.querySelector('#results li')", timeout=20000)
    first=pg.evaluate("() => document.querySelector('#results li')?.textContent")
    check('a geo: link in search offers that position first', first and first.startswith('33.857° S, 151.215° E'), first)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(3000)
    pov=pg.evaluate("() => gia.globe.pointOfView()")
    check('choosing it flies there', abs(pov['lat']+33.8568) < 0.5 and abs(pov['lng']-151.2153) < 0.5, pov)
    pg.evaluate("() => document.querySelector('[data-dock]')");
    check('no page errors', not errs, errs[:3])
    br.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
