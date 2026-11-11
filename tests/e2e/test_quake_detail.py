# SPDX-License-Identifier: AGPL-3.0-only
# One earthquake in depth: the card for a quake reads like an event page (shaking, people who felt it, alert, energy,
# a depth cut-away), then fills in from the USGS detail feed (the fault's beachball and type, ShakeMap contours,
# nearby cities with their shaking, P and S arrival times, the aftershock sequence and the quality of the solution);
# the globe shows the shaking contours and the sweeping wavefronts, and clears them when the card closes.
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.21')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@37,142,1.4&l=quakes,borders', wait_until='commit'); pg.wait_for_timeout(11000)
    # the formulas
    f=pg.evaluate("""async () => { const q = await import('./js/quakedetail.js');
      return { p30: q.arrivals(30).p, s30: q.arrivals(30).s, sh: q.arrivals(120), pkp: q.arrivals(150), e: q.energyText(6.8).bombs, j: q.energyJ(7) / q.energyJ(6),
        th: q.faultType(90).kind, no: q.faultType(-90).kind, ll: q.faultType(10).name, rl: q.faultType(-170).name, w5: q.sequenceWindow(5), w7: q.sequenceWindow(7),
        mmi: [q.mmiRoman(7.2), q.mmiWord(7.2), q.mmiColor(6)] } }""")
    check('travel times follow IASP91: P at 30° in about 6.2 min, S in about 11.2', abs(f['p30'] - 6.2) < 0.05 and abs(f['s30'] - 11.2) < 0.05, f)
    check('the core casts its shadows: no P from 103° to 143°, PKP beyond, never S past 103°', f['sh']['p'] is None and f['sh']['shadow'] and f['sh']['s'] is None and 19.5 <= f['pkp']['p'] <= 20.2 and f['pkp']['s'] is None, f)
    check('energy: a magnitude 6.8 is about 16 Hiroshima bombs, one step up is about 32 times more', 15 < f['e'] < 17 and 31 < f['j'] < 32, f)
    check('fault type from rake: thrust, normal, left- and right-lateral strike-slip', f['th'] == 'thrust' and f['no'] == 'normal' and 'left' in f['ll'] and 'right' in f['rl'], f)
    check('Gardner and Knopoff windows: about 40 km and 150 days for M5, longer for M7', 38 < f['w5']['km'] < 42 and 140 < f['w5']['days'] < 160 and f['w7']['km'] > 65 and f['w7']['days'] > 800, f)
    check('Modified Mercalli words and USGS colours', f['mmi'] == ['VII', 'Very strong', '#ffff00'], f)
    # open the event
    pg.evaluate("() => gia.select({ layer: 'quakes', d: gia.state.data.quakes.find((x) => x.id === 'q0') })"); pg.wait_for_timeout(600)
    head=pg.evaluate("""() => { const n = document.querySelector('#notes-body');
      return { facts: [...n.querySelectorAll('.qd-facts .lm-fact')].map((e) => e.innerText.replace(/\\s+/g, ' ')), line: n.querySelector('.qd-line')?.innerText, alert: n.querySelector('.qd-yellow')?.innerText ?? '',
        tsu: !!n.querySelector('.qd-tsunami'), depth: !!n.querySelector('svg.qd-depth circle.qd-hypo'), energy: n.querySelector('.qd-sec')?.innerText ?? '' } }""")
    check('the card opens with magnitude, depth, worst shaking and people who felt it', head['facts'][:4] == ['M6.8 magnitude (mww)', '25 km deep', 'VII very strong shaking', '1,234 said they felt it'], head)
    check('it gives the PAGER alert in words and the tsunami flag with what it means', 'Yellow alert' in head['alert'] and '1 to 99' in head['alert'] and head['tsu'], head)
    check('energy in tonnes of TNT and Hiroshima bombs, and a depth cut-away', 'thousand tonnes of TNT' in head['energy'] and 'Hiroshima' in head['energy'] and head['depth'], head)
    pg.wait_for_timeout(3500)
    more=pg.evaluate("""() => { const n = document.querySelector('#qd-more'); const cv = n?.querySelector('canvas.qd-ball'); let mid = null, share = 0;
      if (cv) { const g = cv.getContext('2d'); const d = g.getImageData(0, 0, 112, 112).data; mid = [...d.slice((56 * 112 + 56) * 4, (56 * 112 + 56) * 4 + 4)]; let a = 0, same = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) { a++; if (Math.abs(d[i] - mid[0]) + Math.abs(d[i + 1] - mid[1]) + Math.abs(d[i + 2] - mid[2]) < 20) same++; } share = same / a; }
      return { text: n?.textContent.replace(/\s+/g, ' ') ?? '', mid, share, legend: [...n.querySelectorAll('.qd-legend span')].map((e) => e.textContent),
        cities: [...n.querySelectorAll('.qd-cities li')].map((e) => e.innerText.replace(/\\s+/g, ' ')), waves: [...n.querySelectorAll('.qd-waves tbody tr')].map((r) => [...r.children].map((c) => c.innerText)),
        dots: n.querySelectorAll('svg.qd-seq circle').length } }""")
    check('the fault: a thrust, drawn as a beachball with the shaded centre a thrust has', 'Thrust (reverse) fault' in more['text'] and more['mid'] and 0.5 < more['share'] < 0.95 and abs(sum(more['mid'][:3]) - sum(pg.evaluate("() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink'); return [1,3,5].map((i) => parseInt(c.fillStyle.slice(i, i + 2), 16)) }"))) < 6, (more['mid'], more['share']))
    check('it says which plate boundary it is on', 'plate boundary' in more['text'], more['text'][:300])
    check('shaking: ShakeMap contours IV to VII and the "Did You Feel It?" count', more['legend'] == ['IV', 'V', 'VI', 'VII'] and '1,234 people sent' in more['text'], more['legend'])
    sendai=[c for c in more['cities'] if 'Sendai' in c]
    check('nearby cities with distance, direction and their shaking (Sendai: V)', sendai and sendai[0].startswith('V ') and 'km' in sendai[0], more['cities'])
    lon=[r for r in more['waves'] if r[0] == 'London']
    check('P and S arrival times: the first waves reach London about 13 minutes later', lon and lon[0][2].startswith(('12 min', '13 min')) and lon[0][3].startswith(('23 min', '24 min')), more['waves'])
    check('the aftershock sequence is counted and plotted', 'aftershock' in more['text'] and more['dots'] > 5, more['dots'])
    check('how well it is measured: reviewed, 120 stations, 35° gap', 'Checked by a seismologist' in more['text'] and '120 seismic stations' in more['text'], more['text'][-300:])
    g1=pg.evaluate("""() => { const cs = gia.globe.customLayerData(); const w = cs.find((c) => c.obj?.material?.uniforms?.uEpi);
      return { contours: cs.some((c) => c.segs?.length > 100), wave: !!w, p: w?.obj.material.uniforms.uP.value, labels: (gia.state.chan.quakes.labels ?? []).filter((l) => ['IV','V','VI','VII'].includes(l.text)).length } }""")
    pg.wait_for_timeout(1200)
    p2=pg.evaluate("() => gia.globe.customLayerData().find((c) => c.obj?.material?.uniforms?.uEpi)?.obj.material.uniforms.uP.value")
    check('the globe draws the shaking contours, labelled, in one line set', g1['contours'] and g1['labels'] >= 4, g1)
    check('the P wavefront sweeps outward over time', g1['wave'] and p2 is not None and p2 != g1['p'], (g1, p2))
    check('the sequence is marked on the globe', pg.evaluate("() => gia.state.chan.quakes.points.some((x) => /aftershock|foreshock/.test(x.tip))"))
    # open another card: the waves and contours go
    pg.evaluate("() => gia.select({ layer: 'quakes', d: gia.state.data.quakes.find((x) => x.id === 'q5') })"); pg.wait_for_timeout(300)
    pg.keyboard.press('Escape'); pg.evaluate("() => document.querySelector('[data-close=\"notes\"]')?.click()"); pg.wait_for_timeout(1500)
    g2=pg.evaluate("() => ({ wave: gia.globe.customLayerData().some((c) => c.obj?.material?.uniforms?.uEpi), open: !!document.querySelector('#notes.open') })")
    check('closing the card takes the waves and contours off the globe', not g2['wave'] and not g2['open'], g2)
    # a phone: nothing spills sideways
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate("() => gia.select({ layer: 'quakes', d: gia.state.data.quakes.find((x) => x.id === 'q0') })"); pg.wait_for_timeout(3500)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); return [...n.querySelectorAll('.qd *')].filter((e) => e.getBoundingClientRect().right > n.getBoundingClientRect().right + 1).map((e) => e.className.baseVal ?? e.className).slice(0, 5) }")
    check('on a phone the event page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
