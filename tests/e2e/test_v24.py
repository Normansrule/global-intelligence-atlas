import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS, HISTORY_INDEX
from playwright.sync_api import sync_playwright
import json
# v2.4: the Replay layer (hourly frames from the history branch, USGS earthquakes for the window) and the reference projects.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
IDX=json.loads(HISTORY_INDEX)['frames']
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,0,2.4&l=borders,sun,replay', wait_until='commit'); pg.wait_for_timeout(12000)
    check('version 2.11', pg.evaluate("() => gia.VERSION")=='2.11')
    st=pg.evaluate("() => ({ s: gia.state.lstatus?.replay, d: !!gia.state.data.replay, frames: gia.state.data.replay?.index.frames.length, quakes: gia.state.data.replay?.quakes?.length, note: gia.state.data.replay?.statusNote })")
    check('replay loads 48 hourly frames and the USGS window', st['d'] and st['frames']==48 and st['quakes']==140, st)
    c=pg.evaluate("async () => { const { clock } = await import('./js/clock.js'); return { t: clock.now(), paused: clock.paused } }")
    check('clock is set to the latest frame and paused', c['paused'] and c['t']==IDX[-1]['t'], (c, IDX[-1]['t']))
    # open Layers so the replay controls are in the page
    if not pg.evaluate("() => document.body.classList.contains('left-open')"):
        pg.click('.rail [data-section=layers]')
        pg.wait_for_timeout(800)
    pg.evaluate("() => document.querySelector('#replay-slider')?.scrollIntoView({block:'center'})"); pg.wait_for_timeout(400)
    has=pg.evaluate("() => ({ slider: !!document.querySelector('#replay-slider'), max: document.querySelector('#replay-slider')?.max, label: document.querySelector('#replay-time')?.textContent })")
    check('panel has a slider over every frame and a label', has['slider'] and has['max']=='47' and 'aircraft' in (has['label'] or ''), has)
    pg.evaluate("() => { const s = document.querySelector('#replay-slider'); s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true })); }"); pg.wait_for_timeout(1500)
    c=pg.evaluate("async () => { const { clock } = await import('./js/clock.js'); return { t: clock.now(), label: document.querySelector('#replay-time')?.textContent } }")
    check('moving the slider shows that hour', c['t']==IDX[10]['t'], c)
    check('a late snapshot is labelled', 'snapshot was late' in (c['label'] or ''), c['label'])
    pg.click('[data-replay-step="1"]'); pg.wait_for_timeout(1200)
    t11=pg.evaluate("async () => (await import('./js/clock.js')).clock.now()")
    check('+1 h steps forward one frame', t11==IDX[11]['t'], t11)
    pg.click('#replay-play'); pg.wait_for_timeout(3200)
    t_play=pg.evaluate("async () => (await import('./js/clock.js')).clock.now()")
    check('Play advances through the frames', t_play > IDX[11]['t'], (t_play-IDX[11]['t'])/3600000)
    btn=pg.evaluate("() => document.querySelector('#replay-play')?.textContent")
    check('Play turns into Pause', 'Pause' in (btn or ''), btn)
    pg.click('#replay-play'); pg.wait_for_timeout(300)
    # earthquake and alert cards
    card=pg.evaluate("""() => { const d = gia.state.data.replay; const q = d.quakes.find(q => q.t <= Date.now()); gia.select({ layer: 'replay', d: { kind: 'quake', ...q } }); return q.place }"""); pg.wait_for_timeout(800)
    txt=pg.inner_text('#notes-body')
    check('earthquake card opens', 'earthquake' in txt.lower() and card in txt, card)
    # draw calls stay batched: particles are a handful of groups
    calls=pg.evaluate("() => gia.globe.renderer().info.render.calls")
    check('replay stays batched (draw calls)', calls < 120, calls)
    # turning it off returns to live time
    pg.evaluate("() => { gia.toggleLayer('replay', false); gia.applyPending?.(); }"); pg.wait_for_timeout(1500)
    c=pg.evaluate("async () => { const { clock } = await import('./js/clock.js'); return { live: clock.isLive(), paused: clock.paused } }")
    check('turning Replay off returns to live time', c['live'] and not c['paused'], c)
    # reference projects
    r=pg.evaluate("async () => { const { SOURCES } = await import('./js/sources.js'); const refs = Object.values(SOURCES).filter(s => s.ref); return { n: refs.length, urls: refs.map(s => s.url), lic: refs.map(s => s.license) } }")
    ok_lic=all(l in ('MIT','ISC','Apache-2.0','BSD-2-Clause','BSD-3-Clause') for l in r['lic'])
    check('20 reference projects, all on GitHub with permissive licences', r['n']==20 and all(u.startswith('https://github.com/') for u in r['urls']) and ok_lic, r['lic'])
    pg.evaluate("() => document.activeElement?.blur()"); pg.keyboard.press('Escape'); pg.wait_for_timeout(300); pg.keyboard.press('Shift+Slash'); pg.wait_for_timeout(1500)
    about=pg.evaluate("() => document.body.innerText")
    check('About lists the reference projects', 'reference projects' in about.lower() and 'kepler.gl' in about and 'MovingPandas' in about)
    check('no page errors', not errs, errs[:3])
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
