#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas: the International Space Station model for "Dock with the ISS" (v2.24).
#
# Source: NASA 3D Resources, "International Space Station (ISS) (B)" (public domain; github.com/nasa/NASA-3D-Resources,
# 3D Models/International Space Station (ISS) (B)/International Space Station (ISS) (B).glb, Draco-compressed glTF).
# The file also holds a stray copy of a truss segment floating 40 units above the station; it is left out.
#
# What this does: decodes the meshes (DracoPy), drops the stray parts, sorts every part into a role by its material
# (solar arrays, radiators, truss, modules), thins each part with fast-simplification, scales the model so the main
# truss is 109 m long (its real length), centres it, and writes site/app/data/iss.bin:
#   'ISS1', uint32 group count, then per group: uint8 role, uint8 index size (2 or 4), 2 bytes padding,
#   uint32 vertex count, uint32 index count, int16 x, y, z per vertex (metres × 400), padding to
#   a multiple of 4 bytes, the indices, padding again.
# Model axes are kept: +y points along the station's length to the forward docking port (the direction of flight),
# z runs along the truss (the orbit's normal) and +x is taken as up, away from the Earth.
#   pip install DracoPy fast-simplification numpy
#   python3 tools/build-iss.py "International Space Station (ISS) (B).glb" site/app/data/iss.bin
import sys, json, struct
import numpy as np, DracoPy, fast_simplification

ROLES = {'lambert7': 1, 'lambert4': 1, 'soyuz_blinn4': 2, 'lambert6': 2, 'lambert3': 3, 'anisotropic1': 4, 'apollohorns': 2}
STRAY = range(0, 7)  # the floating truss copy (mesh nodes 0–6, about y = 41)
Q = 400  # int16 steps per metre

def parts(p):
    b = open(p, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); bin_ = b[20 + n + 8:]
    out = []
    for m in j['meshes']:
        for pr in m['primitives']:
            ext = pr['extensions']['KHR_draco_mesh_compression']; bv = j['bufferViews'][ext['bufferView']]
            o = bv.get('byteOffset', 0); d = DracoPy.decode(bin_[o:o + bv['byteLength']])
            name = j['materials'][pr.get('material', 0)]['name'].split('.')[0]
            out.append((name, np.array(d.points, np.float64).reshape(-1, 3), np.array(d.faces, np.int64).reshape(-1, 3)))
    return out

def role(name):
    for k, r in ROLES.items():
        if name.startswith(k): return r
    return 0  # other hull parts

def main(src, dst):
    ps = [p for i, p in enumerate(parts(src)) if i not in STRAY]
    allp = np.concatenate([P for _, P, _ in ps])
    truss = np.concatenate([P for n, P, _ in ps if n.startswith('lambert3')])
    s = 109.0 / (truss[:, 2].max() - truss[:, 2].min())
    c = (allp.min(0) + allp.max(0)) / 2
    # the forward docking port: the far (+y) end of the main stack of modules
    stack = np.concatenate([P for n, P, _ in ps if n.startswith('blinn1')])
    top = stack[stack[:, 1] > stack[:, 1].max() - 0.3]
    port = ((top.min(0) + top.max(0)) / 2 - c) * s; port[1] = (stack[:, 1].max() - c[1]) * s
    # the docking adapter sticks out a little further along that axis (another material): its far face is the port
    ext = (allp - c) * s; d = ext - port; near = ext[(np.hypot(d[:, 0], d[:, 2]) < 1.5) & (d[:, 1] > 0)]
    if len(near):
        face = near[near[:, 1] > near[:, 1].max() - 0.05]; port = np.array([face[:, 0].mean(), near[:, 1].max(), face[:, 2].mean()])
    groups = {}
    tris0 = tris1 = 0
    for n, P, F in ps:
        tris0 += len(F)
        if len(F) > 600:
            P, F = fast_simplification.simplify(P.astype(np.float32), F.astype(np.int32), target_reduction=0.6)
        tris1 += len(F)
        g = groups.setdefault(role(n), [[], [], 0])
        g[0].append((np.asarray(P) - c) * s); g[1].append(np.asarray(F) + g[2]); g[2] += len(P)
    out = bytearray(b'ISS1') + struct.pack('<I', len(groups))
    for r, (Ps, Fs, nv) in sorted(groups.items()):
        P = np.round(np.concatenate(Ps) * Q).astype('<i2'); F = np.concatenate(Fs).ravel()
        isz = 2 if nv < 65536 else 4
        out += struct.pack('<BBxxII', r, isz, nv, len(F)) + P.tobytes()
        if len(out) % 4: out += b'\0' * (4 - len(out) % 4)  # indices start on a 4-byte boundary
        out += F.astype('<u2' if isz == 2 else '<u4').tobytes()
        if len(out) % 4: out += b'\0' * (4 - len(out) % 4)
    open(dst, 'wb').write(out)
    ext = (allp.max(0) - allp.min(0)) * s
    print(f'{len(out)} bytes, {tris0} → {tris1} triangles; size {ext.round(1)} m; forward port at {port.round(2)} m (the far face of the forward docking adapter)')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
