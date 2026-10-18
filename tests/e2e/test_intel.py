# End-to-end checks for the Intel section: declassified documents, the redaction inspector and the OSINT tools.
#   bash tests/e2e/run.sh test_intel.py      # expect "SUMMARY n / n"
import sys, os, json, io, base64; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
HERE = sys.argv[-1]; ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SAMPLE = open(os.path.join(ROOT, 'site/app/data/redaction-sample.pdf'), 'rb').read()

def jpeg_with_gps():
    try:
        from PIL import Image
    except ImportError:
        return None
    im = Image.new('RGB', (64, 48), (90, 120, 160)); ex = Image.Exif()
    ex[0x010f] = 'TestCam'; ex[0x0110] = 'Model 1'
    g = ex.get_ifd(0x8825)
    g.update({1: 'N', 2: (48.0, 51.0, 29.6), 3: 'E', 4: (2.0, 17.0, 40.2), 29: '2026:06:21', 7: (12.0, 0.0, 0.0)})
    b = io.BytesIO(); im.save(b, 'JPEG', exif=ex); return b.getvalue()

def intel_routes(route):
    u = route.request.url; H = {'Access-Control-Allow-Origin': '*'}
    if 'archive.org/advancedsearch' in u:
        return route.fulfill(status=200, headers={**H, 'Content-Type': 'application/json'}, body=json.dumps({'response': {'docs': [{'identifier': 'test-memo', 'title': 'Test memo (released)', 'date': '1979-03-14T00:00:00Z'}]}}))
    if 'archive.org/metadata/test-memo' in u:
        return route.fulfill(status=200, headers={**H, 'Content-Type': 'application/json'}, body=json.dumps({'files': [{'name': 'memo.pdf', 'source': 'original'}]}))
    if 'archive.org/download/test-memo/memo.pdf' in u:
        return route.fulfill(status=200, headers={**H, 'Content-Type': 'application/pdf'}, body=SAMPLE)
    if 'web.archive.org/cdx' in u:
        ts = '19990101000000' if 'limit=1&' in u or u.endswith('limit=1') else '20260101000000'
        return route.fulfill(status=200, headers={**H, 'Content-Type': 'application/json'}, body=json.dumps([['timestamp', 'statuscode'], [ts, '200']]))
    return handler(route)

ok = 0; total = 0
def check(name, cond, extra=''):
    global ok, total; total += 1; ok += bool(cond); print(('PASS ' if cond else 'FAIL ') + name, extra)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS); pg = b.new_page(viewport={'width': 1440, 'height': 900})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', intel_routes)
    pg.goto('http://localhost:8765/app/#@30,-40,2.2&b=bluemarble&l=sun,borders', wait_until='commit'); pg.wait_for_timeout(8000)
    pg.click('.rail [data-section="intel"]'); pg.wait_for_timeout(800)
    n = pg.evaluate("() => document.querySelectorAll('#sect-intel .intel-doc').length")
    check('documents list', n >= 40, n)
    check('timeline dots', pg.evaluate("() => document.querySelectorAll('#sect-intel .intel-tl circle').length") == n)
    pg.click('#sect-intel [data-topic="nuclear"]'); pg.wait_for_timeout(300)
    nn = pg.evaluate("() => document.querySelectorAll('#sect-intel .intel-doc').length")
    check('topic filter', 0 < nn < n, nn)
    pg.fill('#intel-from', '1960'); pg.dispatch_event('#intel-from', 'input'); pg.wait_for_timeout(300)
    check('year filter', pg.evaluate("() => [...document.querySelectorAll('#sect-intel .intel-doc span')].every(s => +s.textContent.slice(0,4) >= 1960)"))
    pg.click('#sect-intel .intel-doc'); pg.wait_for_timeout(1500)
    check('document card', pg.evaluate("() => document.querySelector('#notes.open') && /Released to the public/.test(document.querySelector('#notes-body').textContent)"))
    check('layer on', pg.evaluate("() => gia.state.on.has('declass') && gia.state.chan.declass.points.length > 0"))
    # archive search -> redaction inspector
    pg.fill('#intel-ia input[name=q]', 'memo'); pg.click('#intel-ia button'); pg.wait_for_timeout(800)
    pg.click('[data-ia-inspect="test-memo"]'); pg.wait_for_timeout(12000)
    body = pg.evaluate("() => document.querySelector('#redact-out')?.innerText || ''")
    check('inspector verdict', 'Not safely redacted' in body, body[:120].replace('\n', ' '))
    check('hidden text found', 'Dr. Imaginary Placeholder' in body)
    check('unapplied redaction', 'marked but not applied' in body)
    check('two saves', 'Saves in the file\n2' in body or 'Saves in the file\t2' in body or '2 (earlier versions' in body)
    check('safe box counted', pg.evaluate("() => /Black boxes\\s*2/.test(document.querySelector('#redact-out').innerText)"))
    with pg.expect_download() as dl: pg.click('[data-redact-flatten]')
    flat = open(dl.value.path(), 'rb').read()
    check('flattened copy has no text', flat.startswith(b'%PDF') and b'Placeholder' not in flat and b'/Font' not in flat, len(flat))
    # photo location
    jpg = jpeg_with_gps()
    pg.evaluate("() => gia.extras && document.querySelector('.rail [data-section=\"intel\"]')")
    pg.click('#sect-intel [data-intel-tab="tools"]'); pg.wait_for_timeout(300)
    pg.click('[data-intel-tool="photo"]'); pg.wait_for_timeout(300)
    if jpg:
        pg.set_input_files('#exif-file', files=[{'name': 'paris.jpg', 'mimeType': 'image/jpeg', 'buffer': jpg}]); pg.wait_for_timeout(800)
        t = pg.evaluate("() => document.querySelector('#exif-out').innerText")
        check('photo GPS read', '48.858' in t and 'TestCam' in t, t[:100].replace('\n', ' '))
        check('photo sun angle', 'Sun stood' in t)
    # shadow clock
    pg.click('#sect-intel [data-intel-tool="shadow"]'); pg.wait_for_timeout(300)
    pg.click('#shadow-form button[value="where"]'); pg.wait_for_timeout(500)
    check('shadow circle drawn', pg.evaluate("() => gia.state.tool.paths.length === 1 && gia.state.tool.paths[0].pts.length > 300"))
    pg.click('#shadow-form button[value="when"]'); pg.wait_for_timeout(500)
    check('shadow times', 'UTC' in pg.evaluate("() => document.querySelector('#shadow-out').innerText") or 'never' in pg.evaluate("() => document.querySelector('#shadow-out').innerText"))
    # web archive
    pg.click('#sect-intel [data-intel-tool="wayback"]'); pg.wait_for_timeout(300)
    pg.fill('#wb-form input[name=url]', 'example.com'); pg.click('#wb-form button'); pg.wait_for_timeout(800)
    check('wayback copies', '1999-01-01' in pg.evaluate("() => document.querySelector('#wb-out').innerText"))
    # archives directory
    pg.click('#sect-intel [data-intel-tab="archives"]'); pg.wait_for_timeout(300)
    check('archives directory', pg.evaluate("() => document.querySelectorAll('#sect-intel .intel-arch').length") >= 15)
    check('no page errors', not errs, errs[:3])
    print(f'SUMMARY {ok} / {total}')
    b.close()
