#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas: data for the small worlds (v2.22).
#
# 1. Shapes. Phobos, Deimos and Vesta come as latitude-longitude grid meshes from Stellarium (models/m1phobos.obj.gz,
#    m2deimos.obj.gz, 4vesta_21_MLfix.obj; each texture coordinate is the longitude and latitude of its vertex), Bennu as
#    NASA 3D Resources' STL shape model (3D Printing/Asteroid 101955 Bennu). Each becomes a radius map: 65 rows (90° N to
#    90° S) by 129 columns (180° W to 180° E), the same order as the vertices of THREE.SphereGeometry(1, 128, 64), as
#    little-endian unsigned 16-bit numbers, radius / mean radius × 16384. The app moves each sphere vertex out to it.
#      python3 tools/build-smallworlds.py shapes <folder with the four files> site/app/data/shapes
# 2. The Martian moons. Converts the term tables of Stellarium's marssat.c (Valery Lainey's ephemerides, compiled by
#    Johannes Gajdosik, MIT licence) into the JSON pasted after "const MARSSAT = " in site/app/js/smallworlds.js.
#      python3 tools/build-smallworlds.py marssat marssat.c marssat.json
import sys, re, json, gzip, os
import numpy as np

NX, NY = 128, 64  # segments: 129 × 65 vertices
SCALE = 16384

def read_obj(p):
    op = gzip.open if p.endswith('.gz') else open
    V, T, pairs = [], [], []
    with op(p, 'rt') as f:
        for l in f:
            s = l.split()
            if not s: continue
            if s[0] == 'v': V.append([float(x) for x in s[1:4]])
            elif s[0] == 'vt': T.append([float(x) for x in s[1:3]])
            elif s[0] == 'f':
                for x in s[1:]:
                    a = x.split('/'); pairs.append((int(a[0]) - 1, int(a[1]) - 1))
    V = np.array(V); T = np.array(T); pairs = np.array(pairs)
    P = V[pairs[:, 0]]; uv = T[pairs[:, 1]]
    return uv[:, 0], uv[:, 1], np.linalg.norm(P, axis=1)

def read_stl(p):
    b = open(p, 'rb').read(); n = int(np.frombuffer(b[80:84], '<u4')[0])
    d = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
    v0, v1, v2 = (d['v'][:, i].astype(float) for i in range(3))
    vol = np.einsum('ij,ij->i', v0, np.cross(v1, v2)) / 6
    c = ((v0 + v1 + v2) / 4 * vol[:, None]).sum(0) / vol.sum()  # centre of the volume
    P = np.concatenate([v0, v1, v2, (v0 + v1 + v2) / 3]) - c
    r = np.linalg.norm(P, axis=1); lon = np.arctan2(P[:, 1], P[:, 0]); lat = np.arcsin(P[:, 2] / r)
    return lon / (2 * np.pi) + 0.5, lat / np.pi + 0.5, r

def grid(u, v, r):
    """Nearest-node average of the samples, holes filled from their neighbours, seam and poles made whole."""
    ix = np.rint(np.mod(u, 1) * NX).astype(int); iy = np.rint((1 - v) * NY).astype(int)
    s = np.zeros((NY + 1, NX + 1)); n = np.zeros_like(s)
    np.add.at(s, (iy, ix), r); np.add.at(n, (iy, ix), 1)
    s[:, 0] += s[:, NX]; n[:, 0] += n[:, NX]  # 180° W and 180° E are one meridian
    g = np.where(n > 0, s / np.maximum(n, 1), np.nan)[:, :NX]
    for row in (0, NY): g[row, :] = np.nanmean(g[row, :]) if np.isfinite(g[row, :]).any() else np.nan
    for _ in range(200):
        bad = ~np.isfinite(g)
        if not bad.any(): break
        p = np.pad(g, ((1, 1), (0, 0)), mode='edge'); nb = np.stack([np.roll(g, 1, 1), np.roll(g, -1, 1), p[:-2], p[2:]])
        g[bad] = np.nanmean(nb, 0)[bad]
    for row in (0, NY): g[row, :] = g[row, :].mean()
    g = np.concatenate([g, g[:, :1]], 1)
    w = np.cos(np.radians(90 - np.arange(NY + 1) * 180 / NY))[:, None] * np.ones((1, NX + 1))
    mean = (g * w).sum() / w.sum()
    return g / mean, mean

def shapes(src, out):
    os.makedirs(out, exist_ok=True)
    # Phobos's model texture is turned half a turn from NASA's Phobos map (which the atlas uses): shift by 0.5.
    jobs = [('phobos', 'm1phobos.obj.gz', 0.5), ('deimos', 'm2deimos.obj.gz', 0), ('vesta', '4vesta_21_MLfix.obj', 0), ('bennu', 'Asteroid 101955 Bennu.stl', 0)]
    for id, f, du in jobs:
        p = os.path.join(src, f)
        u, v, r = read_stl(p) if f.endswith('.stl') else read_obj(p)
        g, mean = grid(u + du, v, r)
        np.round(g * SCALE).astype('<u2').tofile(os.path.join(out, f'{id}.bin'))
        print(f'{id}: mean radius {mean:.3f} (model units), from {g.min():.2f} to {g.max():.2f} times it')

def marssat(src, out):
    t = open(src).read()
    terms = {m.group(1): [[float(x) for x in r.split(',')] for r in re.findall(r'\{\s*([-\d.e+]+\s*,\s*[-\d.e+]+\s*,\s*[-\d.e+]+)\s*\}', m.group(2))]
             for m in re.finditer(r'static const struct MarsSatTerm (\w+)\[\d+\] = \{(.*?)\n\};', t, re.S)}
    bodies = []
    for m in re.finditer(r'"(\w+)",\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+),\s*\{([^}]*)\},\s*\{(.*?)\}\s*\n\s*\}', t, re.S):
        name, mu, l, acc, c, lists = m.groups()
        names = re.findall(r'\{(\w+),\s*\d+', lists)
        bodies.append({'name': name, 'mu': float(mu), 'l': float(l), 'acc': float(acc), 'c': [float(x) for x in c.replace('\n', ' ').split(',') if x.strip()], 'lists': [terms[n] for n in names]})
    json.dump(bodies, open(out, 'w'), separators=(',', ':'))
    print([(b['name'], [len(x) for x in b['lists']]) for b in bodies])

if __name__ == '__main__':
    {'shapes': shapes, 'marssat': marssat}[sys.argv[1]](sys.argv[2], sys.argv[3])
