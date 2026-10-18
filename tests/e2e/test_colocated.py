import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
# v2.11: markers that share a spot. Up close they fan out round it, each with its own symbol you can click;
# further out the "+N" badge (or a click on the spot) lists every one of them. Space objects are never spread.
res=[]
def check(name, ok, info=''): res.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ')+name, info)
INIT="try{localStorage.setItem('global-intelligence-atlas-version','2.11')}catch(e){}"
LAT, LNG = 12.9716, 77.5946   # eight technology offices in Bengaluru share this exact point
SPOT=f"(d) => Math.abs(d.lat - {LAT}) < 1e-4 && Math.abs(d.lon - {LNG}) < 1e-4"
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(getattr(e,'stack',str(e))[:400]))
    pg.route('**/*', handler); pg.add_init_script(INIT)
    pg.goto(f'http://localhost:8765/app/#@{LAT},{LNG},0.01&l=techhqs,satellites', wait_until='commit'); pg.wait_for_timeout(12000)
    n=pg.evaluate(f"() => (gia.state.data.techhqs ?? []).filter({SPOT}).length")
    check('the test spot has several offices', n >= 5, n)
    pins=pg.evaluate(f"() => gia.markers.pins.filter(p => p.home && Math.abs(p.home.lat - {LAT}) < 1e-4 && Math.abs(p.home.lng - {LNG}) < 1e-4).map(p => ({{ lat: p.lat, lng: p.lng, name: p.ref?.d?.id, alt: p.renderAlt ?? 0.004 }}))")
    check('up close every office at the spot gets its own symbol', len(pins) == n, (len(pins), n))
    check('the symbols are spread apart, not stacked', len({(round(q['lat'],6), round(q['lng'],6)) for q in pins}) == len(pins))
    # click each spread symbol: each one opens its own card
    pg.wait_for_timeout(1500); got=set(); pairs=[]
    for q in pins:
        sc=pg.evaluate(f"() => gia.globe.getScreenCoords({q['lat']}, {q['lng']}, {q['alt']})")
        hit=pg.evaluate(f"() => {{ const h = gia.pickAt({sc['x']}, {sc['y']}); return h?.ref?.d?.id ?? (h?.zoom ? 'zoom:' + h.group.map(x => x.ref?.d?.id).join('+') : null) }}")
        got.add(hit); pairs.append((q['name'], hit))
    check('each spread symbol can be clicked on its own', len(pins) > 1 and {q['name'] for q in pins} <= got, [x for x in pairs if x[0] != x[1]])
    # zoomed out: one click at the spot lists them all
    pg.evaluate(f"() => gia.globe.pointOfView({{ lat: {LAT}, lng: {LNG}, altitude: 0.6 }}, 0)"); pg.wait_for_timeout(2500)
    sc=pg.evaluate(f"() => gia.globe.getScreenCoords({LAT}, {LNG}, 0)")
    found=pg.evaluate(f"""() => {{ const want = gia.state.data.techhqs.filter({SPOT});
      for (let dx = -40; dx <= 40; dx += 4) for (let dy = -30; dy <= 30; dy += 4) {{ const h = gia.pickAt({sc['x']} + dx, {sc['y']} + dy);
        if (h?.zoom) {{ const g = new Set(h.group.map(x => x.ref?.d)); if (want.every(d => g.has(d))) return h.group.length }} }} return 0 }}""")
    check('zoomed out, the badge or the spot lists every office there', found >= n, (found, n))
    # satellites are drawn at their height, never fanned out or folded into a ground list
    sat=pg.evaluate("() => ({ n: gia.state.elevated?.length ?? 0, spread: gia.markers.pins.some(p => p.home && p.ref?.layer === 'satellites') })")
    check('satellites are never spread or listed with ground markers', not sat['spread'], sat)
    check('no page errors', not errs, errs[:3]); pg.close()
    b.close()
print(f"SUMMARY {sum(1 for _,ok in res if ok)} / {len(res)}")
