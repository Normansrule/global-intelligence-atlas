# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas: how long a first visit takes, measured the way a visitor meets it: over HTTP/2 with gzip
# (as GitHub Pages serves the site), on a throttled network and CPU, with the live feeds mocked (tests/e2e/mock.py).
#   H2=1 python3 tests/perf/startup.py site 5 mobile     # 9 Mbit/s, 150 ms round trip, CPU 4x slower
#   H2=1 python3 tests/perf/startup.py site 5 cable      # 20 Mbit/s, 40 ms, CPU 2x slower
# Prints medians: fcp (first paint), ready (the globe is up), earth (the day texture is in), kbWire (bytes before the Earth).
# The finished Earth is max(ready, earth). Software WebGL (SwiftShader) makes absolute times pessimistic; compare versions
# on the same machine. Needs openssl, node and Playwright.
import sys, os, gzip, tempfile, json, threading, statistics, http.server, functools, socketserver
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'e2e')); from mock import handler
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1]; RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 3; PROF = sys.argv[3] if len(sys.argv) > 3 else 'cable'
PROFILES = {'cable': (40, 20e6, 2), 'mobile': (150, 9e6, 4)}  # rtt ms, bits/s, cpu slowdown
GZ = ('.js', '.mjs', '.json', '.css', '.html', '.svg', '.geojson', '.txt')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        p = self.translate_path(self.path)
        if os.path.isdir(p): p = os.path.join(p, 'index.html')
        if not os.path.isfile(p) or not p.endswith(GZ) or 'gzip' not in self.headers.get('Accept-Encoding', ''): return super().send_head()
        data = gzip.compress(open(p, 'rb').read(), 6)
        self.send_response(200); self.send_header('Content-Type', self.guess_type(p)); self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(data))); self.end_headers()
        import io; return io.BytesIO(data)
H.extensions_map.update({'.mjs': 'text/javascript', '.js': 'text/javascript'})
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
import subprocess, time
H2 = os.environ.get('H2') == '1'
if H2:
    K = tempfile.mkdtemp(); subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', K + '/key.pem', '-out', K + '/cert.pem', '-days', '1', '-subj', '/CN=localhost'], check=True, capture_output=True)
    srv = subprocess.Popen(['node', os.path.join(HERE, 'h2-server.mjs'), ROOT, '8766', K]); time.sleep(1)
else: srv = S(('127.0.0.1', 8766), functools.partial(H, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
rtt, bps, cpu = PROFILES[PROF]
INIT = """try{localStorage.setItem('global-intelligence-atlas-version', '%s')}catch(e){}
new MutationObserver((m, o) => { const l = document.getElementById('loading'); if (l && l.classList.contains('gone') && !window.__ready) { window.__ready = performance.now(); } }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });""" % (os.environ.get('VER') or __import__('re').search(r"VERSION = '([^']+)'", open(os.path.join(ROOT, 'app/js/main.js')).read()).group(1))
out = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'])
    for i in range(RUNS):
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page()
        def route(r):
            if '//localhost:8766/' in r.request.url: return r.fallback()
            return handler(r)
        pg.route('**/*', route); pg.add_init_script(INIT)
        cdp = ctx.new_cdp_session(pg); cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': rtt, 'downloadThroughput': bps / 8, 'uploadThroughput': bps / 8})
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
        pg.goto(('https' if H2 else 'http') + '://localhost:8766/app/', wait_until='load', timeout=120000)
        pg.wait_for_function('() => window.__ready', timeout=120000); pg.wait_for_timeout(1500)
        r = pg.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource');
          const before = res.filter((e) => e.startTime < window.__ready);
          const tex = res.find((e) => /earth-(blue-marble|dark|night)[^/]*\\.jpg/.test(e.name)); const by = {}; for (const e of res.filter((e) => e.startTime < (tex ? tex.responseEnd : 1e9))) { const k = (e.name.match(/\\.(\\w+)(\\?|$)/) || [, 'x'])[1]; by[k] = (by[k] || 0) + Math.round((e.transferSize || 0) / 1024); }
          return { by, earth: Math.round(tex ? tex.responseEnd : 0), ready: Math.round(window.__ready), fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd),
            kbWire: Math.round(before.reduce((a, e) => a + (e.transferSize || 0), 0) / 1024), reqs: before.length,
            slow: before.filter((e) => e.name.includes('localhost')).sort((a, b) => b.responseEnd - a.responseEnd).slice(0, 6).map((e) => [e.name.replace(/^.*\\/app\\//, ''), Math.round(e.startTime), Math.round(e.responseEnd), Math.round((e.transferSize || 0) / 1024)]) } }""")
        out.append(r); ctx.close()
    b.close()
for k in ['fcp', 'dcl', 'ready', 'earth', 'load', 'kbWire', 'reqs']: print(f"{k:7s} median {statistics.median(x[k] for x in out):8.0f}   runs {[x[k] for x in out]}")
print('kB by type before Earth:', out[-1]['by']); print('last-arriving before ready:', json.dumps(out[-1]['slow']))

if H2: srv.kill()
