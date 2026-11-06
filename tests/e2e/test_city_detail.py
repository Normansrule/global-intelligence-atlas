# SPDX-License-Identifier: AGPL-3.0-only
# One city in depth: Paris's page gives the weather now and for the next 24 hours, a daylight ribbon with sunrise,
# sunset and its longest and shortest days, its people as figures with its rank, the nearest airports and where the
# main one flies, what is within 100 km, and the other side of the Earth; the globe draws the 100 km circle and
# clears it when the card closes.
import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
OPEN="() => gia.select({ layer: 'cities', d: gia.state.data.cities.find((c) => c.name === 'Paris') })"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.14')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@48.8,2.3,0.6&l=borders,cities,quakes,landmarks', wait_until='commit'); pg.wait_for_timeout(11000)
    f=pg.evaluate("""async () => { const c = await import('./js/citydetail.js');
      return { eq: c.dayLength(0, 0), pole: c.dayLength(80, 23.44), night: c.dayLength(80, -23.44), parisJun: c.dayLength(48.87, 23.44), parisDec: c.dayLength(48.87, -23.44),
        w: [c.weatherWords(0), c.weatherWords(61), c.weatherWords(95), c.weatherWords(3)] } }""")
    check('day length: about 12 h 7 min at the equator, midnight sun and polar night at 80°', 12.0 < f['eq'] < 12.2 and f['pole'] == 24 and f['night'] == 0, f)
    check('Paris: about 16 h of daylight in June and 8 h 13 min in December', 16.0 < f['parisJun'] < 16.4 and 8.1 < f['parisDec'] < 8.4, f)
    check('weather codes in words (WMO table 4677)', f['w'] == ['Clear sky', 'Light rain', 'Thunderstorm', 'Overcast'], f['w'])
    pg.evaluate(OPEN); pg.wait_for_timeout(3500)
    c=pg.evaluate("""() => { const n = document.querySelector('#notes-body'); const t = (s) => n.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
      return { line: t('#cy-line'), cc: n.querySelector('#cy-line [data-country-cc]')?.dataset.countryCc, wx: t('#cy-weather'), hourly: !!n.querySelector('svg.cy-hourly path.cy-line'), rain: n.querySelectorAll('svg.cy-hourly rect.cy-rain').length,
        sun: t('#cy-sun'), day: n.querySelector('.cy-day')?.style.left, now: !!n.querySelector('.cy-now'), people: t('#cy-people'), figs: n.querySelectorAll('#cy-people .cd-p').length,
        fly: t('#cy-fly'), aps: [...n.querySelectorAll('#cy-fly .chip')].map((e) => e.textContent), around: t('#cy-around'), lm: [...n.querySelectorAll('#cy-around [data-landmark]')].map((e) => e.dataset.landmark), anti: t('#cy-anti') } }""")
    check('the top line names its country as a button and the local time there', c['line'].startswith('Capital of France') and c['cc'] == 'FR' and 'there now (GMT+1)' in c['line'], c['line'])
    check('the weather now: temperature, words, feels-like, today’s range, wind, humidity and UV', all(x in c['wx'] for x in ['11°C', 'Light rain', 'feels like 9°', '7° to 13°', '19 km/h, gusts 38', '81%', '1.2']), c['wx'])
    check('the next 24 hours as a temperature line with rain chances', c['hourly'] and c['rain'] == 5, (c['hourly'], c['rain']))
    check('daylight: a ribbon with now marked, sunrise and sunset, tomorrow shorter, longest and shortest days', c['day'] and c['now'] and 'Sunrise 07:58, sunset 17:21' in c['sun'] and 'tomorrow is 4 minutes shorter' in c['sun'] and 'longest day has 16 h' in c['sun'] and 'shortest 8 h' in c['sun'], c['sun'])
    check('its people as figures with its rank in the world and its country', c['figs'] == 10 and 'One figure = 1 million people' in c['people'] and 'in its country' in c['people'], (c['figs'], c['people']))
    check('the nearest airports, with where the main one flies nonstop', 'CDG' in c['aps'] and 'nonstop destinations' in c['fly'] and 'Farthest nonstop' in c['fly'], (c['aps'], c['fly'][:200]))
    check('within 100 km: earthquakes counted and landmarks as buttons with distances', 'earthquakes within 300 km this week' in c['around'] and 'Eiffel Tower' in c['lm'] and 'Palace of Versailles' in c['lm'], (c['around'][:160], c['lm']))
    check('the other side of the Earth: open ocean near New Zealand', 'open ocean' in c['anti'] and '48.87° S' in c['anti'] and 'nearest city there' in c['anti'], c['anti'])
    g=pg.evaluate("() => (gia.state.chan.cities.custom ?? []).some((x) => x.segs?.length > 100)")
    check('the globe draws the 100 km circle round the city', g)
    pg.evaluate("() => document.querySelector('#cy-line [data-country-cc]').click()"); pg.wait_for_timeout(1500)
    k=pg.evaluate("() => ({ h: document.querySelector('#notes-body h3')?.innerText, ring: (gia.state.chan.cities.custom ?? []).length })")
    check('the country button opens France’s page and takes the circle away', k['h'].endswith('France') and k['ring'] == 0, k)
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(500)
    pg.evaluate(OPEN); pg.wait_for_timeout(3000)
    ov=pg.evaluate("() => { const n = document.querySelector('#notes-body'); const R = n.getBoundingClientRect().right; return [...n.querySelectorAll('.cy *')].filter((e) => e.getBoundingClientRect().right > R + 1).map((e) => String(e.className.baseVal ?? e.className)).slice(0, 5) }")
    check('on a phone the city page fits its panel', ov == [], ov)
    check('no page errors', not errs, errs[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
