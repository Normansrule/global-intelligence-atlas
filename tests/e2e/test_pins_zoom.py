# SPDX-License-Identifier: AGPL-3.0-only
# Pins stay visible all the way down: fly onto one ship, earthquake and power plant at seven heights, from orbit
# to the closest zoom (about 570 m), and check a symbol is drawn on it each time. Planes never rise above the camera.
import sys, json; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res=[]
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+name, '' if ok else info)
PROBE="""async ([id, alt]) => {
  const d = gia.state.data[id]; const arr = Array.isArray(d) ? d : (d?.features ?? []);
  const it = arr[Math.floor(arr.length / 3)]; const lat = it.lat ?? it.geometry.coordinates[1]; const lng = it.lng ?? it.lon ?? it.geometry.coordinates[0];
  gia.globe.pointOfView({ lat, lng, altitude: alt }, 0); await new Promise((r) => setTimeout(r, 2500));
  const el = gia.globe.renderer().domElement; const W = el.clientWidth, H = el.clientHeight; const cam = gia.globe.camera();
  const sc = gia.globe.getScreenCoords(lat, lng, 0); const v = new (cam.position.constructor)(); let near = 0;
  for (const sp of gia.markers.pool) { if (!sp.visible || !sp.userData.pin) continue; sp.getWorldPosition(v); v.project(cam);
    if (v.z < 1 && Math.hypot((v.x + 1) / 2 * W - sc.x, (1 - v.y) / 2 * H - sc.y) < 80) near++; }
  return near;
}"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS); pg=b.new_page(viewport={'width':1280,'height':800}); pg.route('**/*', handler)
    pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.12')}catch(e){}")
    pg.goto('http://localhost:8765/app/#@30,-40,2.2&b=bluemarble&l=ships,quakes,power', wait_until='commit'); pg.wait_for_timeout(15000)
    for id in ['ships', 'quakes', 'power']:
        got = {alt: pg.evaluate(PROBE, [id, alt]) for alt in [0.3, 0.05, 0.01, 0.002, 0.0005, 0.00009]}
        check(f'a {id} symbol stays on screen from 0.3 down to the closest zoom', all(n >= 1 for n in got.values()), got)
    alts = pg.evaluate("async () => { const { planeAlt } = await import('./js/flights.js'); return [0.3, 0.01, 0.00009].map((c) => planeAlt({ altFt: 38000 }, c) < c); }")
    check('a plane at 38,000 ft stays below the camera at every zoom', all(alts), alts)
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
