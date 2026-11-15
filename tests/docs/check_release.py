#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas (GIA): check that a release is complete on paper. Every version string (HANDOFF.md section 8)
# agrees with VERSION in site/app/js/main.js, and the release has its section in docs/ASSUMPTIONS.md (what it assumed,
# approximated or could not verify), its row in NOTICE.md (the change list the AGPL asks for) and its CHANGELOG.md section;
# every licence notice that NOTICE.md points to exists.
#   python3 tests/docs/check_release.py        → "SUMMARY n / n"
import os, re, sys, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()
res = []
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')

v = re.search(r"export const VERSION = '([^']+)'", read('site/app/js/main.js')).group(1)  # e.g. 2.23
full = v + '.0'

# the version strings
found = {
    'site/sw.js': re.search(r"const VERSION = 'global-intelligence-atlas-v([\d.]+)'", read('site/sw.js')).group(1),
    'site/app/index.html': re.search(r'<small class="ver">v([\d.]+)</small>', read('site/app/index.html')).group(1),
    'site/index.html': re.search(r'<a href="app/">Version ([\d.]+)</a>', read('site/index.html')).group(1),
}
check('the web app, its service worker and the website say ' + v, all(x == v for x in found.values()), found)
lock = json.loads(read('desktop/package-lock.json'))
cargo_lock = re.search(r'name = "global-intelligence-atlas"\nversion = "([^"]+)"', read('desktop/src-tauri/Cargo.lock'))
desk = {
    'desktop/package.json': json.loads(read('desktop/package.json'))['version'],
    'desktop/package-lock.json': lock['version'] + ' / ' + lock['packages']['']['version'],
    'tauri.conf.json': json.loads(read('desktop/src-tauri/tauri.conf.json'))['version'],
    'Cargo.toml': re.search(r'^version = "([^"]+)"', read('desktop/src-tauri/Cargo.toml'), re.M).group(1),
    'Cargo.lock': cargo_lock.group(1) if cargo_lock else None,
}
check('the desktop app says ' + full, all(x in (full, f'{full} / {full}') for x in desk.values()), desk)
cff = read('CITATION.cff')
check('CITATION.cff says ' + full, re.search(r'^version: ' + re.escape(full) + r'$', cff, re.M), re.search(r'^version: .*$', cff, re.M).group(0))
pins = {}
for f in sorted(os.listdir(os.path.join(ROOT, 'tests', 'e2e'))):
    if f.endswith('.py'):
        for x in re.findall(r"gia\.VERSION\"\)=='([\d.]+)'", read('tests/e2e/' + f)):
            pins.setdefault(x, []).append(f)  # (older stored versions elsewhere are on purpose: they test What's new)
check('every version check in the tests says ' + v, list(pins) == [v], {k: sorted(set(f))[:4] for k, f in pins.items() if k != v})

# assumptions, change list, changelog
assum = read('docs/ASSUMPTIONS.md')
sec = re.search(r'^## v' + re.escape(v) + r'\b.*?(?=^## |\Z)', assum, re.M | re.S)
check(f'docs/ASSUMPTIONS.md has a section for v{v}, at the top', sec and re.findall(r'^## v([\d.]+)', assum, re.M)[0] == v, re.findall(r'^## v([\d.]+)', assum, re.M)[:2])
check(f'its items are labelled (Assumption, Approximation, Not verified or Judgement)', sec and re.search(r'\*\*(Assumption|Approximation|Not verified|Judgement)', sec.group(0)))
notice = read('NOTICE.md')
check(f'NOTICE.md has a row for v{full}', f'| v{full}:' in notice)
check(f'CHANGELOG.md has a section for v{v}', re.search(r'^## .* v' + re.escape(v) + ':', read('CHANGELOG.md'), re.M))
lic = sorted(set(re.findall(r'\(LICENSES/([^)]+)\)', notice)))
check('every licence notice NOTICE.md points to exists', lic and all(os.path.exists(os.path.join(ROOT, 'LICENSES', x)) for x in lic), lic)
check('the README, REFERENCES and the app’s About panel point to docs/ASSUMPTIONS.md', 'docs/ASSUMPTIONS.md' in read('README.md') and 'ASSUMPTIONS.md' in read('docs/REFERENCES.md') and '/docs/ASSUMPTIONS.md' in read('site/app/js/main.js'))

print(f'SUMMARY {sum(res)} / {len(res)}')
sys.exit(0 if all(res) else 1)
