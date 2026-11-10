# SPDX-License-Identifier: AGPL-3.0-only
# v2.14 security. Every page carries a Content-Security-Policy that runs only the site's own script files, and the
# page guard (app/js/guard.js) takes inline handlers, javascript: links and unsandboxed frames off whatever HTML
# reaches the page. Then the whole app is fed hostile data: every name, title, place and description in every feed
# (and in the site's own data files) carries an HTML payload. Nothing it carries may become a real element.
import sys, os, json, re; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
res = []
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
BASE = 'http://localhost:8765'
INIT = """window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile || '') + ':' + e.lineNumber));
try { localStorage.setItem('global-intelligence-atlas-version', '2.13') } catch (e) {}"""

# ------------------------------------------------------------------------------------------- hostile feed data
PAY = '"\'><i data-pwn=1>x</i><img src=x data-pwn=2 onerror="window.__pwn=1"><a data-pwn=3 href="javascript:window.__pwn=2">'
TEXT_KEYS = {'name', 'title', 'place', 'description', 'desc', 'summary', 'headline', 'label', 'text', 'country', 'countryName',
             'city', 'operator', 'owner', 'agency', 'mission', 'site', 'note', 'dest', 'destination', 'municipality', 'extract',
             'common', 'official', 'location', 'abbrev', 'blurb', 'type_name', 'full_name', 'country_name', 'airline'}
NAMEISH = re.compile(r"^[A-Z][A-Za-z .,'()-]{2,40}$")
def poison(v, key=None, in_rows=False):
    if isinstance(v, dict): return {k: poison(x, k) for k, x in v.items()}
    if isinstance(v, list): return [poison(x, key, in_rows or key == 'rows') for x in v]
    if isinstance(v, str) and (key in TEXT_KEYS or (in_rows and NAMEISH.match(v))): return v + PAY
    return v
def poison_body(body):
    try: return json.dumps(poison(json.loads(body)))
    except Exception: return body
class Hostile:
    """Wraps a Playwright route so every JSON answer the mocks give (and the site's own data files) is poisoned."""
    def __init__(self, r): self.r = r; self.request = r.request
    def fulfill(self, **kw):
        ct = str((kw.get('headers') or {}).get('Content-Type', ''))
        b = kw.get('body')
        if b is not None and 'json' in ct: kw['body'] = poison_body(b if isinstance(b, str) else b.decode('utf-8', 'replace'))
        return self.r.fulfill(**kw)
    def continue_(self):
        u = self.request.url
        if '/app/data/' in u and u.split('?')[0].endswith('.json'):
            resp = self.r.fetch(); return self.r.fulfill(response=resp, body=poison_body(resp.text()))
        return self.r.continue_()
    def abort(self, *a): return self.r.abort(*a)
def hostile(route): return handler(Hostile(route))

PWN = """() => ({ els: document.querySelectorAll('[data-pwn]').length, pwn: window.__pwn ?? null, csp: window.__csp.length,
  live: [...document.querySelectorAll('a[href]')].filter((a) => /^\\s*(javascript|data|vbscript):/i.test(a.getAttribute('href'))).length,
  inline: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length })"""
# every item each layer has, opened one after another; every hover tip each layer drew, parsed (not run)
OPEN_ALL = """async () => {
  const opened = []; const tips = []; const pwned = [];
  for (const [id, v] of Object.entries(gia.state.data)) {
    const list = Array.isArray(v) ? v : (v?.items ?? v?.list ?? v?.stations ?? null);
    if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object') continue;
    for (const d of list.slice(0, 2)) {
      try { gia.select({ layer: id, d }); opened.push(id); } catch (e) {}
      // each page replaces the last one, so look after every page has had time to fill in from its own feeds
      for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 400)); const n = document.querySelectorAll('[data-pwn]').length; if (n) pwned.push(`${id}:${n}`); }
    }
  }
  for (const ch of Object.values(gia.state.chan ?? {})) for (const p of (ch?.points ?? []).slice(0, 200)) if (typeof p.tip === 'string') tips.push(p.tip);
  const t = document.createElement('template'); t.innerHTML = tips.join('');
  return { opened: [...new Set(opened)], pwned: [...new Set(pwned)], tips: tips.length, tipPwn: t.content.querySelectorAll('[data-pwn]').length, tipPoisoned: tips.filter((s) => s.includes('data-pwn')).length };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', handler); pg.add_init_script(INIT)

    # 1. every page has the policy and runs with no violations
    metas = set()
    for path in ['/', '/learn/', '/credits/', '/download/', '/fluid/', '/app/']:
        pg.goto(BASE + path, wait_until='load'); pg.wait_for_timeout(2500 if path != '/app/' else 9000)
        meta = pg.evaluate("() => document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? ''")
        inline = pg.evaluate("() => [...document.scripts].filter((s) => !s.src && s.textContent.trim()).length")
        v = pg.evaluate('window.__csp'); metas.add(meta)
        check(f'{path}: a Content-Security-Policy that runs only the site\'s own scripts, no inline script, no violations',
              "script-src 'self'" in meta and "object-src 'none'" in meta and "base-uri 'self'" in meta and 'unsafe-inline' not in meta.split('script-src')[1].split(';')[0] and inline == 0 and v == [], (meta[:80], inline, v[:3]))
    check('the policy is the same on every page', len(metas) == 1, metas)

    # 2. the guard: injected handlers, javascript: links and frames
    g = pg.evaluate("""async () => {
      const box = document.createElement('div'); document.body.appendChild(box);
      box.innerHTML = '<img id=g1 src="data:," onerror="window.__pwn=1"><img id=g2 src="nope.png" onerror="this.remove()"><figure id=g3><img src="nope2.png" onerror="this.closest(\\'figure\\').remove()"></figure><a id=g4 href=" javascript:window.__pwn=2">x</a><a id=g5 href="https://example.com/" target="_blank">ok</a><iframe id=g6 src="https://evil.example/"></iframe>';
      await new Promise((r) => setTimeout(r, 1500));
      document.getElementById('g4')?.click();
      const a5 = document.getElementById('g5');
      const out = { pwn: window.__pwn ?? null, handlers: box.querySelectorAll('[onerror]').length, g2: !!document.getElementById('g2'), g3: !!document.getElementById('g3'),
        g4: document.getElementById('g4')?.hasAttribute('href'), g5: a5.getAttribute('href'), rel: a5.rel, sandbox: document.getElementById('g6')?.getAttribute('sandbox') ?? '', frameSrc: document.getElementById('g6')?.getAttribute('src') ?? null };
      box.remove(); return out; }""")
    check('an injected onerror handler never runs and is taken off', g['pwn'] is None and g['handlers'] == 0, g)
    check('the app\'s own broken-picture fallbacks still work (the picture, then its figure, go)', not g['g2'] and not g['g3'], g)
    check('a javascript: link loses its address; a normal link keeps it and opens with noopener', g['g4'] is False and g['g5'] == 'https://example.com/' and 'noopener' in g['rel'], g)
    check('an iframe to an unknown site is sandboxed and emptied', 'allow-scripts' in g['sandbox'] and 'allow-top-navigation' not in g['sandbox'] and g['frameSrc'] is None, g)
    nd = pg.evaluate("() => fetch('js/newsdesk.js').then((r) => r.text())")
    check('live TV frames are sandboxed without top navigation', 'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups' in nd)

    # 3. hostile data everywhere
    pg2 = b.new_page(viewport={'width': 1280, 'height': 800})
    errs2 = []; pg2.on('pageerror', lambda e: errs2.append(str(e)))
    pg2.route('**/*', hostile); pg2.add_init_script(INIT)
    pg2.goto(BASE + '/app/?datasets=open#@30,10,2.4&l=borders,quakes,events,news,launches,stations,cities,airports,landmarks,cables,ports,nuclear,pipelines,alerts,fires,aircraft,ships,cameras,power&s=1', wait_until='commit')
    for _ in range(40):
        pg2.wait_for_timeout(1000)
        if pg2.evaluate("() => Object.values(gia.state.data).filter((v) => (Array.isArray(v) ? v.length : v)).length") >= 14: break
    pg2.wait_for_timeout(3000)
    pg2.evaluate("() => document.getElementById('live-open')?.click()"); pg2.wait_for_timeout(1500)
    o = pg2.evaluate(OPEN_ALL)
    check('many layers loaded hostile data and their pages were opened', len(o['opened']) >= 10, o['opened'])
    check('no layer page turned the payload into an element', o['pwned'] == [], o['pwned'])
    check('hover tips carry the payload as text only', o['tipPoisoned'] > 0 and o['tipPwn'] == 0, o)
    s = pg2.evaluate(PWN)
    check('no payload became an element, ran, or left a javascript: link or inline handler', s['els'] == 0 and s['pwn'] is None and s['live'] == 0 and s['inline'] == 0, s)
    for q in ['Tokyo', 'Paris']:
        pg2.fill('#q', q); pg2.wait_for_timeout(1200)
    s = pg2.evaluate(PWN)
    check('search results built from hostile names stay text', s['els'] == 0 and s['pwn'] is None, s)
    # 4. a crafted share link (the address is typed by someone else)
    pg3 = b.new_page(viewport={'width': 1280, 'height': 800}); pg3.route('**/*', handler); pg3.add_init_script(INIT)
    pg3.goto(BASE + '/app/?plugins=..%2F..%2Fx,https://evil.example/x&edition=%22%3E%3Ci%20data-pwn%3E#@1,1,2&l=borders&sel=cities~%22%3E%3Ci%20data-pwn%3E&s=1%22%3E%3Ci%20data-pwn%3E', wait_until='commit')
    pg3.wait_for_timeout(9000)
    pg3.evaluate("() => { const b = [...document.querySelectorAll('button, [data-mode]')].find((x) => /about/i.test(x.textContent)); b?.click(); }"); pg3.wait_for_timeout(1500)
    s = pg3.evaluate(PWN)
    check('a crafted link (odd plug-in names, edition, selection) changes nothing on the page', s['els'] == 0 and s['pwn'] is None and s['csp'] == 0, s)
    check('no page errors, with or without hostile data', not errs and not errs2, (errs + errs2)[:3])
    b.close()
print('SUMMARY', sum(res), '/', len(res))
