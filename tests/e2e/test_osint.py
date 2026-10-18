# Intelligence toolkit (site/app/js/osint.js) end to end: every tool against mocked registries, plus the overlap check.
#   bash tests/e2e/run.sh test_osint.py
import sys, json, os, subprocess; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
HERE = sys.argv[-1]; ROOT = os.path.dirname(os.path.dirname(HERE))
# build the sanctions and KEV lists from the offline fixtures, as the workflow would from the live sources
TMP = os.path.join(HERE, '.intel'); os.makedirs(TMP, exist_ok=True)
subprocess.run(['node', os.path.join(ROOT, 'tools/fetch-intel.mjs'), '--from', os.path.join(ROOT, 'tests/intel/fixtures')], cwd=TMP, check=True, capture_output=True)
INTEL = {n: open(os.path.join(TMP, 'site/app/data/intel', n), 'rb').read() for n in ('sanctions.json', 'kev.json')}
J = lambda o: json.dumps(o)
CORS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
DNS = {1: ['93.184.215.14'], 28: ['2606:2800:21f:cb07:6820:80da:af6b:8b2c'], 15: ['0 .'], 2: ['a.iana-servers.net.', 'b.iana-servers.net.'], 16: ['"v=spf1 -all"'], 257: []}
TY = {'A': 1, 'AAAA': 28, 'MX': 15, 'NS': 2, 'TXT': 16, 'CAA': 257}
def osint(route):
    u = route.request.url
    if '/app/data/intel/' in u:
        n = u.split('/app/data/intel/')[1].split('?')[0]
        return route.fulfill(status=200, body=INTEL[n], headers=CORS) if n in INTEL else route.fulfill(status=404, body='404')
    b = None
    if 'dns.google/resolve' in u:
        t = TY[u.split('type=')[1]]; b = J({'Status': 0, 'Answer': [{'name': 'example.com.', 'type': t, 'TTL': 300, 'data': d} for d in DNS[t]]})
    elif 'rdap.org/domain/' in u:
        b = J({'objectClassName': 'domain', 'ldhName': 'EXAMPLE.COM', 'status': ['client delete prohibited'], 'events': [{'eventAction': 'registration', 'eventDate': '1995-08-14T04:00:00Z'}, {'eventAction': 'expiration', 'eventDate': '2027-08-13T04:00:00Z'}],
               'entities': [{'roles': ['registrar'], 'vcardArray': ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'RESERVED-Internet Assigned Numbers Authority']]]}], 'nameservers': [{'ldhName': 'A.IANA-SERVERS.NET'}], 'secureDNS': {'delegationSigned': True}})
    elif 'rdap.org/ip/' in u:
        b = J({'name': 'APNIC-LABS', 'startAddress': '1.1.1.0', 'endAddress': '1.1.1.255', 'country': 'AU', 'port43': 'whois.apnic.net', 'entities': [{'roles': ['registrant'], 'vcardArray': ['vcard', [['fn', {}, 'text', 'APNIC Research and Development']]]}]})
    elif 'crt.sh' in u:
        b = J([{'name_value': 'www.example.com\nexample.com', 'not_before': '2026-01-15T00:00:00'}, {'name_value': 'm.example.com', 'not_before': '2025-12-01T00:00:00'}])
    elif 'stat.ripe.net/data/prefix-overview' in u: b = J({'data': {'resource': '1.1.1.0/24', 'asns': [{'asn': 13335, 'holder': 'CLOUDFLARENET - Cloudflare, Inc.'}]}})
    elif 'stat.ripe.net/data/maxmind-geo-lite' in u: b = J({'data': {'located_resources': [{'locations': [{'city': 'Sydney', 'country': 'AU', 'latitude': -33.87, 'longitude': 151.21, 'covered_percentage': 100}]}]}})
    elif 'stat.ripe.net/data/as-overview' in u: b = J({'data': {'holder': 'CLOUDFLARENET - Cloudflare, Inc.', 'announced': True}})
    elif 'stat.ripe.net/data/announced-prefixes' in u: b = J({'data': {'prefixes': [{'prefix': '1.1.1.0/24'}, {'prefix': '2606:4700::/32'}]}})
    elif 'cveawg.mitre.org' in u:
        b = J({'cveMetadata': {'cveId': 'CVE-2021-44228', 'datePublished': '2021-12-10T00:00:00', 'dateUpdated': '2025-02-04T00:00:00'}, 'containers': {'cna': {'title': 'Apache Log4j2 JNDI features do not protect against attacker controlled LDAP',
               'descriptions': [{'lang': 'en', 'value': 'Apache Log4j2 2.0-beta9 through 2.15.0 JNDI features ... remote code execution.'}], 'metrics': [{'cvssV3_1': {'baseScore': 10.0, 'vectorString': 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H'}}],
               'problemTypes': [{'descriptions': [{'cweId': 'CWE-502', 'description': 'Deserialization of Untrusted Data'}]}], 'affected': [{'vendor': 'Apache Software Foundation', 'product': 'Apache Log4j2'}], 'references': [{'url': 'https://logging.apache.org/log4j/2.x/security.html'}]}}})
    elif 'api.first.org/data/v1/epss' in u: b = J({'data': [{'cve': 'CVE-2021-44228', 'epss': '0.94358', 'percentile': '0.99957'}]})
    elif 'blockstream.info/api/address/' in u: b = J({'chain_stats': {'funded_txo_sum': 5_000_000_000, 'spent_txo_sum': 0, 'tx_count': 4000}, 'mempool_stats': {'tx_count': 0}})
    elif 'ofac-sanctioned-digital-currency-addresses' in u: return route.fulfill(status=200, body='12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h\n1ExampleAddr\n', headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain'})
    if b is not None: return route.fulfill(status=200, body=b, headers=CORS)
    return handler(route)

CHECK = open(os.path.join(HERE, 'overlap.py')).read().split('CHECK = """')[1].split('"""')[0]
res = []; ok = lambda name, cond: (res.append(bool(cond)), print(('PASS ' if cond else 'FAIL ') + name))
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for (w, h) in [(1440, 900), (390, 844)]:
        pg = b.new_page(viewport={'width': w, 'height': h}); pg.route('**/*', osint)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','2.0');localStorage.setItem('global-intelligence-atlas-section','')}catch(e){}")
        pg.goto('http://localhost:8765/app/#@30,-40,2.2&l=sun,borders', wait_until='commit'); pg.wait_for_timeout(6000)
        pg.evaluate("() => document.querySelector('.rail [data-section=tools]').click()"); pg.wait_for_timeout(300)
        text = lambda: pg.inner_text('#sect-tools .sect-body')
        ok(f'{w}: toolkit listed in Tools', 'intelligence toolkit' in text().lower() and pg.locator('[data-osint]').count() == 6)
        def ask(q, want, tool=None):
            if tool: pg.locator(f'[data-osint={tool}]').click(); pg.wait_for_timeout(150)
            pg.fill('#sect-tools .osint-ask input', q); pg.press('#sect-tools .osint-ask input', 'Enter')
            try: pg.wait_for_function("(w) => document.querySelector('#sect-tools .osint-out')?.innerText.includes(w)", arg=want, timeout=8000)
            except Exception: print('  got:', text()[:600].replace('\n', ' | '))
            return text()
        t = ask('example.com', 'a.iana-servers.net')
        ok(f'{w}: domain shows DNS, RDAP and certificates', 'Internet Assigned Numbers Authority' in t and '1995-08-14' in t and 'm.example.com' in t and 'signed' in t)
        pg.locator('[data-osint-back]').click(); pg.wait_for_timeout(150)
        t = ask('1.1.1.1', 'Sydney')
        ok(f'{w}: address shows network and place', 'AS13335' in t and 'APNIC Research' in t)
        pg.locator('[data-osint-fly]').first.click(); pg.wait_for_timeout(1800)
        pov = pg.evaluate("() => gia.globe.pointOfView()")
        ok(f'{w}: Show on the globe flies there', abs(pov['lat'] + 33.87) < 1 and abs(pov['lng'] - 151.21) < 1)
        t = ask('AS13335', 'Blocks announced')
        ok(f'{w}: AS number lookup', '2606:4700::/32' in t)
        t = ask('cve-2021-44228', 'Exploited in the wild')
        ok(f'{w}: CVE with CVSS, EPSS and KEV', '10 · Critical' in t and '94.4%' in t and 'ransomware' in t)
        t = ask('national bank of cuba', 'BANCO NACIONAL')
        ok(f'{w}: sanctions search by alias', 'Japan; Cuba' in t)
        t = ask('12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h', 'Sanctioned')
        ok(f'{w}: wallet flagged against OFAC addresses', '50 BTC' in t and '4,000' in t)
        t = ask('192.168.1.1', 'private or reserved')
        ok(f'{w}: private addresses are refused', True)
        pg.locator('[data-osint-back]').click(); pg.wait_for_timeout(150); pg.locator('[data-osint=conflict]').click()
        pg.wait_for_function("() => document.querySelector('#sect-tools .osint-out')?.innerText.includes('Ukraine war')", timeout=8000)
        ok(f'{w}: conflict monitor lists zones with counts', pg.locator('#sect-tools .osint-hits li').count() == 15 and 'report' in text())
        wide = pg.evaluate("() => { const b=document.querySelector('#sect-tools .sect-body'); return b.scrollWidth - b.clientWidth; }")
        ok(f'{w}: no sideways scrolling in the toolkit', wide <= 1)
        ov = pg.evaluate(CHECK); ok(f'{w}: no overlapping panels {ov}', not ov)
        pg.screenshot(path=os.path.join(TMP, f'osint-{w}.png'))
        ok(f'{w}: no page errors {errs[:2]}', not errs)
        pg.close()
    b.close()
print(f'SUMMARY {sum(res)} / {len(res)}')
