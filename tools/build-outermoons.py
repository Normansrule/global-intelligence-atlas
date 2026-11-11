#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas: converts the coefficient tables of Stellarium's tass17.c and gust86.c (Johannes Gajdosik, MIT
# licence) into the TASS data and the gustElem() function used in site/app/js/outermoons.js (v2.21).
#   curl -O https://raw.githubusercontent.com/Stellarium/stellarium/master/src/core/planetsephems/{tass17,gust86}.c
#   python3 tools/build-outermoons.py <folder with the two .c files> tass.json gust.js
# then paste tass.json after "const TASS = " and gust.js over the GUST86 block in outermoons.js.
import re, sys, json
src = sys.argv[1]; out = sys.argv[2]; CUT = 0
t = open(f'{src}/tass17.c').read()
terms = {}
for m in re.finditer(r'static const struct Tass17Term (\w+)\[\d+\] = \{(.*?)\n\};', t, re.S):
    rows = [[float(x) for x in r.split(',')] for r in re.findall(r'\{\{([^}]*)\}\}', m.group(2))]
    terms[m.group(1)] = rows
multis = {}
for m in re.finditer(r'static const struct Tass17MultiTerm (\w+)\[\d+\] = \{(.*?)\n\};', t, re.S):
    ms = []
    for mm in re.finditer(r'\{\{([^}]*)\},\s*(\d+),\s*(\w+)\}', m.group(2)):
        ms.append([[int(x) for x in mm.group(1).split(',')], mm.group(3)])
    multis[m.group(1)] = ms
bodies = []
bm = re.search(r'tass17bodies\[\d*\]\s*=\s*\{(.*)\n\};', t, re.S).group(1)
for m in re.finditer(r'\{\s*"(\w+)",\s*([-\d.e+]+),\s*([-\d.e+]+),\s*\{([^}]*)\},\s*\{(.*?)\}\s*\n\s*\}', bm, re.S):
    name, mu, aam, s0, ser = m.groups()
    series = [s for _, s in re.findall(r'\{(\d+),(\w+)\}', ser)]
    bodies.append({'name': name.lower(), 'mu': float(mu), 'aam': float(aam), 's0': [float(x) for x in s0.split(',')], 'series': series})
kept = dropped = 0
def ser(name, k):
    global kept, dropped
    res = []
    for j, (idx, tn) in enumerate(multis[name]):
        rows = terms[tn]
        if k == 1 and j == 0: keep = rows  # the longitudes feed every argument: keep all
        else: keep = [r for r in rows if abs(r[0]) >= CUT]
        kept += len(keep); dropped += len(rows) - len(keep)
        if keep or (k == 1 and j == 0): res.append([idx[:7], [[float(f'{v:.10g}') for v in r] for r in keep]])
    return res
data = [{'name': b['name'], 'mu': b['mu'], 'aam': b['aam'], 's0': b['s0'], 'series': [ser(s, k) for k, s in enumerate(b['series'])]} for b in bodies]
rot = [float(x) for x in re.search(r'TASS17toVSOP87\[9\] = \{([^}]*)\}', t).group(1).split(',')]
json.dump({'bodies': data, 'rot': rot}, open(out, 'w'), separators=(',', ':'))
print(len(bodies), [b['name'] for b in bodies], 'kept', kept, 'dropped', dropped)

# GUST86
g = open(f'{src}/gust86.c').read()
S_OUT = sys.argv[3]
body=re.search(r'void CalcGust86Elem\(const double t,double elem\[5\*6\],void \*user\) \{(.*?)\n\}', g, re.S).group(1)
body=body.replace('double an[5],ae[5],ai[5];','const an = [], ae = [], ai = [];').replace('int i;','')
body=re.sub(r'for \(i=0;i<5;i\+\+\) \{','for (let i = 0; i < 5; i++) {',body)
body=re.sub(r'fmod\(([^,]+),\s*2\*M_PI\)', r'mod2pi(\1)', body)
body=re.sub(r'(?<![\w.])(cos|sin)\(', r'Math.\1(', body)
body=re.sub(r'(\d)\.(?=\s*[)*;,])', r'\1', body)
body=re.sub(r'\n\s*\n','\n',body)
arrs={}
for n in ['fqn','phn','phe','phi']: arrs[n]=re.search(n+r'\[5\] = \{([^}]*)\}', g).group(1).replace('\n','').replace(' ','')
for n in ['fqe','fqi']: arrs[n]=re.search(n+r'\[5\] = \{([^}]*)\}', g).group(1).replace('\n','').replace(' ','').replace('M_PI','Math.PI')
rmu=re.search(r'gust86_rmu\[5\] = \{([^}]*)\}', g).group(1).replace('\n','').replace(' ','')
rot=re.search(r'GUST86toVsop87\[9\] = \{([^}]*)\}', g).group(1).replace('\n','').replace(' ','')
js='// GUST86 (Laskar and Jacobson 1987): generated from Stellarium\'s gust86.c by Johannes Gajdosik (MIT licence).\n'
for n,v in arrs.items(): js+=f'const {n.upper()} = [{v}];\n'
js+=f'const GUST_RMU = [{rmu}];\nconst GUST_ROT = [{rot}];\n'
js+='function gustElem(t) {\n  const elem = new Float64Array(30); const fqn = FQN, fqe = FQE, fqi = FQI, phn = PHN, phe = PHE, phi = PHI;'+body+'\n  return elem;\n}\n'
open(S_OUT,'w').write(js)
