#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas (GIA): check that the README's pictures and local links exist, that its version matches the app,
# and that the progress tracker agrees with HANDOFF.md section 9 and the open-data layers in site/app/js/opendata.js.
#   python3 tests/docs/check_readme.py        → "SUMMARY n / n"
import os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()
res = []
def check(name, ok, info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')

readme, handoff, opendata, main = read('README.md'), read('HANDOFF.md'), read('site/app/js/opendata.js'), read('site/app/js/main.js')

# every local picture and link points at a file that exists
targets = re.findall(r'(?:src="|\]\()(?!https?:|#|mailto:)([^")#\s]+)', readme)
missing = sorted({t for t in targets if not os.path.exists(os.path.join(ROOT, t))})
check('README pictures and local links exist', targets and not missing, missing)
check('every README picture is from site/docs-media', all(t.startswith('site/docs-media/') for t in re.findall(r'<img src="([^"]+)"', readme)))
check('the changelog exists and starts with this version', os.path.exists(os.path.join(ROOT, 'CHANGELOG.md')))

# version
v = re.search(r"export const VERSION = '([^']+)'", main).group(1)
check('README version badge matches the app', f'version-{v}.0-' in readme, v)
check('changelog has this version', f'## 🚀 v{v}:' in read('CHANGELOG.md') or f' v{v}:' in read('CHANGELOG.md'), v)

# progress tracker against HANDOFF.md section 9
sec = handoff[handoff.index('## 9.'):handoff.index('## 10.')]
items = re.findall(r'^(\d+)\. \*\*(\([^)]*\))?', sec, re.M)
total = len(items); done = sum(1 for _, s in items if s.startswith('(Done'))
started = sum(1 for _, s in items if s.startswith('(Started'))
open_layers = len(re.findall(r'^  \w+: \{ (?:file|local):', opendata, re.M))
wm_only = len(re.search(r'WM_ONLY = \[([^\]]*)\]', opendata).group(1).split(','))
pct = int((done + open_layers / (open_layers + wm_only) * started) / total * 100)
rows = re.findall(r'^\| (\d+) \| [^|]+\| (✅ Done|🟡 In progress|⬜ Planned)', readme, re.M)
check('tracker lists every roadmap item', len(rows) == total, (len(rows), total))
check('tracker done count matches HANDOFF', sum(1 for _, s in rows if s == '✅ Done') == done and f'{done} of {total} items done' in readme and f'roadmap-{done}_of_{total}_done' in readme, (done, total))
check('tracker in-progress count matches HANDOFF', sum(1 for _, s in rows if s == '🟡 In progress') == started)
check('open-data layer count matches opendata.js', f'{open_layers} of {open_layers + wm_only} layers' in readme, (open_layers, wm_only))
check('overall percentage', f'**{pct} %**' in readme, pct)
bar = re.search(r'`([█░]{30})`', readme)
check('progress bar length matches the percentage', bar and bar.group(1).count('█') == round(pct * 30 / 100), (pct, bar and bar.group(1).count('█')))

# credits that must never be dropped
check('World Monitor and Elie Habib credited', 'github.com/koala73/worldmonitor' in readme and 'Elie Habib' in readme)
check('Osiris credited', 'github.com/simplifaisoul/osiris' in readme)
check('licence stated', 'AGPL-3.0-only' in readme)

print(f'SUMMARY {sum(res)} / {len(res)}')
sys.exit(0 if all(res) else 1)
