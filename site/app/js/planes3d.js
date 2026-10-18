// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: aircraft shapes by type.
// Each plane is sorted into one of eight classes (wide-body, narrow-body, regional jet, turboprop, business
// jet, light aircraft, helicopter, fast jet) from its ICAO type code, its broadcast emitter category or, when
// neither is known, its speed and height. Every class has two procedural models built from the same
// measurements: a flat top-view silhouette for the zoomed-out map (a few dozen triangles) and a low-poly 3D
// model for close views and the "from the ground" viewer (about 300 triangles). Both are built in model
// units: the nose is at +Y = 1, the tail at −1, the right wing towards +X and up is +Z.
import { THREE } from '../vendor/vendor.min.mjs';

// Real sizes (metres) of a typical member of each class, used for true-scale drawing and the ground view.
export const CLASSES = {
  heavy: { label: 'Wide-body airliner', eg: 'Boeing 777-300ER', L: 73.9, S: 64.8, H: 18.5, scale: 1.3 },
  narrow: { label: 'Narrow-body airliner', eg: 'Airbus A320', L: 37.6, S: 35.8, H: 11.8, scale: 1 },
  regional: { label: 'Regional jet', eg: 'Embraer E175', L: 31.7, S: 26.0, H: 9.9, scale: 0.88 },
  turboprop: { label: 'Turboprop', eg: 'ATR 72', L: 27.2, S: 27.1, H: 7.7, scale: 0.88 },
  bizjet: { label: 'Business jet', eg: 'Bombardier Challenger 350', L: 20.9, S: 21.0, H: 6.1, scale: 0.78 },
  light: { label: 'Light aircraft', eg: 'Cessna 172', L: 8.3, S: 11.0, H: 2.7, scale: 0.66 },
  heli: { label: 'Helicopter', eg: 'Airbus H135', L: 12.2, S: 10.2, H: 3.5, scale: 0.7 },
  fighter: { label: 'Fast jet', eg: 'F-16 Fighting Falcon', L: 15.1, S: 9.96, H: 4.9, scale: 0.8 },
};
export const CLASS_IDS = Object.keys(CLASSES);

// ICAO aircraft type designators (Doc 8643), matched by pattern.
const TYPE_RULES = [
  ['heli', /^(R22|R44|R66|EC\d\d|H1[0-9]\d|H160|H175|H215|H225|AS\d\d|AS3B|AS5N|S76|S92|S61|S64|A109|A119|A139|A169|A189|B06T?|B105|B212|B230|B407|B412|B427|B429|B430|B505|BK17|MI\d+|KA\d\d|UH1Y?|H60|H47|H53|H64|EH10|AW\d+|NH90|TIGR|LYNX|EN28|EN48|MD\d00|H500|HUCO|PUMA|ALO3|EXPL|GAZL|S300|CABR)$/],
  ['fighter', /^(F1[4568]|F22|F35|FA18|F18[EFS]?|EUFI|TOR|RFAL|MIR2|M2000|JAS39|SU\d\d|MG\d\d|MIG\d+|J10|J20|JF17|T38|T45|HAWK|M346|L39|A10|AV8B|HARR|F5|F4|AJET|ALPH|L159|T50|FA50|T7)$/],
  ['heavy', /^(B74\w|B76\w|B77\w|B78\w|B79\w|A30[0-9B]\w?|A310|A33\w|A34\w|A35\w|A38\w|MD11|DC10|L101|IL96|IL76|A124|A225|AN22|C5M?|C17|A400|KC10|K35R|C135|E3TF|E3CF|B52|KC46|B2|BLCF|A3ST|A337)$/],
  ['regional', /^(CRJ\w|E135|E145|E45X|E170|E175|E75[LS]|E190|E195|E290|E295|F70|F100|RJ70|RJ85|RJ1H|B46[123]|SU95|AJ27|A148|A158)$/],
  ['narrow', /^(A31[89]|A32\w|A2\dN|BCS[13]|B71\w|B72\w|B73\w|B75\w|B3[789]M|MD8\w|MD9\w|DC9\w|C919|T204|T154|Y42|B190B)$/],
  ['turboprop', /^(AT4\w|AT7\w|ATR\w|DH8\w|DHC[2-7]|SF34|SB20|JS3\d|JS41|D328|B190|BE20|BE30|BE9[LT]|B350|PC12|C208|C30J|C130|L410|AN2[46]|AN30|AN32|MA60|Y12|F50|F27|SH36|SW4|E120|P180|TBM\d|KODI|PC6T?|C212|CN35|C295|P3|E110|PC21|PC9|T6|TEX2|DHC6|AT8T|M28)$/],
  ['bizjet', /^(C25\w|C5\d\w|C56X|C68A|C700|C750|GLF\d|GL5T|GL7T|GLEX|G280|GA\dC|CL30|CL35|CL60|FA\d\w|F2TH|F900|FA7X|FA8X|LJ\d\d|PC24|E50P|E55P|E545|E550|HDJT|H25B|BE40|PRM1|SF50|EA50|C510|ASTR|G150|GALX|WW24)$/],
  ['light', /^(C1\d\d|C2[01]\d|C3\d\d|C4\d\d|P28\w|PA\d\d\w?|P32\w|P46T|SR2\d|DA[24]\d|DA62|BE3[3-6]|BE55|BE58|BE76|M20\w|C82\w|AA5|GLAS|TB\d\d|RV\d+|A210|DR40|C77R|C72R|BL8|CH7\w|PIVI|ULAC|ECHO|G115|GLID|DG\d+|AS\d\dK?|ASK\d+|LS\d|DUOD|S12|J3|CUB|BALL|AMPH|SIRA|EV97|TECN|P92|C42|WT9|ZLIN|Z42|Z43|SUBA|SAVG|PNR\w|NG5)$/],
];
// OpenSky / ADS-B emitter categories (see tools/fetch-live.mjs)
const CAT = { 2: 'light', 4: 'narrow', 5: 'narrow', 6: 'heavy', 7: 'fighter', 8: 'heli', 9: 'light', 10: 'light', 12: 'light', 14: 'light' };

/** { cls, how } where how is 'type', 'category' or 'estimate'. */
export function classify(a) {
  const t = String(a.type ?? '').toUpperCase();
  if (t) for (const [cls, re] of TYPE_RULES) if (re.test(t)) return { cls, how: 'type' };
  // ICAO aircraft class from the type table (H = helicopter, L1P = single piston, L2T = twin turboprop, L4J = four jets)
  const k = String(a.icaoClass ?? '');
  if (k) { if (k[0] === 'H' || k[0] === 'G') return { cls: 'heli', how: 'type' }; if (/^L\dP/.test(k)) return { cls: 'light', how: 'type' }; if (/^L\dT/.test(k)) return { cls: 'turboprop', how: 'type' }; if (/^L4J/.test(k)) return { cls: 'heavy', how: 'type' }; }
  const c = typeof a.cat === 'string' ? ({ A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8, B1: 9, B2: 10, B4: 12, B6: 14 })[a.cat] : a.cat;
  if (c === 3) return { cls: (a.kt ?? 0) > 300 || a.altFt > 28000 ? 'bizjet' : 'turboprop', how: 'category' };
  if (CAT[c]) return { cls: CAT[c], how: 'category' };
  // No type and no category: a guess from how it flies.
  const kt = a.kt ?? 0; const ft = a.altFt ?? 0;
  if (a.ground) return { cls: 'narrow', how: 'estimate' };
  if (ft < 3500 && kt > 0 && kt < 120) return { cls: 'light', how: 'estimate' };
  if (ft < 12000 && kt < 190) return { cls: 'light', how: 'estimate' };
  if (ft < 26000 && kt < 310) return { cls: 'turboprop', how: 'estimate' };
  if (ft > 41500) return { cls: 'bizjet', how: 'estimate' };
  return { cls: 'narrow', how: 'estimate' };
}
export function classOf(a) {
  if (a._cls === undefined || a._clsT !== a.type || a._clsC !== a.cat) { const r = classify(a); a._cls = r.cls; a._clsHow = r.how; a._clsT = a.type; a._clsC = a.cat; }
  return a._cls;
}

// ---------------------------------------------------------------- measurements, in model units
// r fuselage radius; wing/stab: y of root mid-chord, root chord cr, tip chord ct, half-span s, sweep°, z;
// fin: root chord cr, tip chord ct, height h, sweep°; eng: nacelles [x, y, z, radius, length, prop radius]
const T = 0.022; // wing thickness
const SPEC = {
  heavy: { r: 0.084, nose: 0.2, wing: { y: 0.04, cr: 0.44, ct: 0.1, s: 0.877, sw: 32, z: -0.035 }, stab: { y: -0.86, cr: 0.21, ct: 0.07, s: 0.29, sw: 35 }, fin: { y: -0.83, cr: 0.25, ct: 0.09, h: 0.22, sw: 40 }, eng: [[0.3, 0.2, -0.1, 0.052, 0.2]] },
  narrow: { r: 0.105, nose: 0.2, wing: { y: 0.02, cr: 0.4, ct: 0.1, s: 0.95, sw: 25, z: -0.05 }, stab: { y: -0.84, cr: 0.21, ct: 0.08, s: 0.34, sw: 30 }, fin: { y: -0.81, cr: 0.28, ct: 0.1, h: 0.3, sw: 38 }, eng: [[0.34, 0.2, -0.12, 0.056, 0.2]] },
  regional: { r: 0.095, nose: 0.2, wing: { y: 0.0, cr: 0.38, ct: 0.09, s: 0.82, sw: 25, z: -0.045 }, stab: { y: -0.85, cr: 0.21, ct: 0.08, s: 0.33, sw: 30 }, fin: { y: -0.81, cr: 0.28, ct: 0.1, h: 0.32, sw: 40 }, eng: [[0.29, 0.17, -0.11, 0.05, 0.2]] },
  turboprop: { r: 0.1, nose: 0.16, wing: { y: 0.1, cr: 0.18, ct: 0.1, s: 0.99, sw: 3, z: 0.1 }, stab: { y: -0.92, cr: 0.15, ct: 0.08, s: 0.3, sw: 10, top: true }, fin: { y: -0.84, cr: 0.32, ct: 0.15, h: 0.33, sw: 35 }, eng: [[0.3, 0.24, 0.07, 0.042, 0.26, 0.145]] },
  bizjet: { r: 0.12, nose: 0.24, wing: { y: -0.04, cr: 0.4, ct: 0.12, s: 1.0, sw: 28, z: -0.07 }, stab: { y: -0.95, cr: 0.2, ct: 0.1, s: 0.33, sw: 30, top: true }, fin: { y: -0.86, cr: 0.3, ct: 0.18, h: 0.3, sw: 45 }, eng: [[0.19, -0.55, 0.05, 0.065, 0.28]] },
  light: { r: 0.13, nose: 0.12, taper: true, wing: { y: 0.3, cr: 0.36, ct: 0.3, s: 1.33, sw: 0, z: 0.13 }, stab: { y: -0.88, cr: 0.22, ct: 0.15, s: 0.42, sw: 5 }, fin: { y: -0.84, cr: 0.26, ct: 0.14, h: 0.32, sw: 30 }, prop: 0.23 },
  fighter: { r: 0.075, nose: 0.35, wing: { y: -0.18, cr: 0.62, ct: 0.1, s: 0.66, sw: 40, z: 0 }, stab: { y: -0.84, cr: 0.25, ct: 0.08, s: 0.37, sw: 40 }, fin: { y: -0.78, cr: 0.32, ct: 0.1, h: 0.33, sw: 45 } },
};

// fuselage radius at y (nose +1, tail −1)
function bodyProfile(sp) {
  const r = sp.r; const n = sp.nose;
  const tail = sp.taper ? [[0.02, -1], [r * 0.35, -0.9], [r * 0.6, -0.5], [r, 0.05]] : [[0.012, -1], [r * 0.3, -0.95], [r * 0.7, -0.8], [r, -0.55]];
  const nose = [[r, 1 - n], [r * 0.85, 1 - n * 0.5], [r * 0.55, 1 - n * 0.2], [0.004, 1]];
  return [...tail, ...nose];
}
function wingShape(w, mirror = true) {
  const tan = Math.tan((w.sw * Math.PI) / 180);
  const leR = w.y + w.cr / 2; const teR = w.y - w.cr / 2; const leT = leR - w.s * tan; const teT = leT - w.ct;
  const pts = mirror ? [[-w.s, leT], [0, leR], [w.s, leT], [w.s, teT], [0, teR], [-w.s, teT]] : [];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}
function finShape(f, zb) {
  const tan = Math.tan((f.sw * Math.PI) / 180); const le = f.y + f.cr / 2;
  return [[le, zb], [le - f.h * tan, zb + f.h], [le - f.h * tan - f.ct, zb + f.h], [f.y - f.cr / 2, zb]].map(([u, v]) => new THREE.Vector2(u, v));
}
const extrude = (pts, depth) => new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth, bevelEnabled: false, curveSegments: 1 });

/** Concatenate geometries into one non-indexed position+normal geometry. */
function merge(geos) {
  const parts = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; if (!ng.attributes.normal) ng.computeVertexNormals(); return ng; });
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

function build3D(cls) {
  const g = [];
  if (cls === 'heli') {
    const body = new THREE.SphereGeometry(1, 12, 8); body.scale(0.2, 0.42, 0.21); body.translate(0, 0.32, 0); g.push(body);
    const boom = new THREE.CylinderGeometry(0.03, 0.055, 0.95, 6); boom.translate(0, -0.42, 0.06); g.push(boom);
    const fin = extrude(finShape({ y: -0.88, cr: 0.2, ct: 0.12, h: 0.22, sw: 30 }, 0.05), 0.015); fin.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.0075, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)); g.push(fin);
    const stab = extrude(wingShape({ y: -0.78, cr: 0.09, ct: 0.07, s: 0.16, sw: 0 }), 0.012); stab.translate(0, 0, 0.05); g.push(stab);
    for (const a of [0.25, 1.82]) { const b = new THREE.BoxGeometry(1.66, 0.055, 0.012); b.rotateZ(a); b.translate(0, 0.3, 0.27); g.push(b); }
    const hub = new THREE.CylinderGeometry(0.03, 0.04, 0.08, 8); hub.rotateX(Math.PI / 2); hub.translate(0, 0.3, 0.22); g.push(hub);
    const tr = new THREE.CylinderGeometry(0.11, 0.11, 0.008, 12); tr.rotateZ(Math.PI / 2); tr.translate(0.03, -0.9, 0.12); g.push(tr);
    for (const x of [-0.17, 0.17]) { const s = new THREE.BoxGeometry(0.022, 0.72, 0.02); s.translate(x, 0.3, -0.23); g.push(s); }
    return merge(g);
  }
  const sp = SPEC[cls];
  g.push(new THREE.LatheGeometry(bodyProfile(sp).map(([r, y]) => new THREE.Vector2(r, y)), 8));
  const w = extrude(wingShape(sp.wing), T); w.translate(0, 0, sp.wing.z - T / 2); g.push(w);
  const finBase = sp.r * 0.55; const fin = extrude(finShape(sp.fin, finBase), 0.02);
  fin.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.01, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)); g.push(fin);
  const stabZ = sp.stab.top ? finBase + sp.fin.h - 0.01 : sp.r * 0.3;
  const stabY = sp.stab.top ? sp.fin.y - sp.fin.h * Math.tan((sp.fin.sw * Math.PI) / 180) - 0.02 : sp.stab.y;
  const st = extrude(wingShape({ ...sp.stab, y: stabY }), 0.014); st.translate(0, 0, stabZ - 0.007); g.push(st);
  for (const [x, y, z, re, len, prop] of sp.eng ?? []) {
    for (const sx of [-1, 1]) {
      const e = new THREE.CylinderGeometry(re * 0.92, re, len, 8, 1, false); e.translate(sx * x, y, z); g.push(e);
      if (prop) { const p = new THREE.CylinderGeometry(prop, prop, 0.006, 14); p.translate(sx * x, y + len / 2 + 0.01, z); g.push(p); }
      if (cls !== 'bizjet' && !prop) { const py = extrude([[-0.01, 0], [0.01, 0], [0.01, len * 0.7], [-0.01, len * 0.7]].map(([a, b]) => new THREE.Vector2(a, b)), 0.05); py.translate(sx * x, y - len * 0.45, z + re * 0.6); g.push(py); }
    }
  }
  if (sp.prop) { const p = new THREE.CylinderGeometry(sp.prop, sp.prop, 0.008, 14); p.translate(0, 1.005, 0); g.push(p); }
  return merge(g);
}

function build2D(cls) {
  const shapes = [];
  if (cls === 'heli') {
    const ring = new THREE.Shape(); ring.absarc(0, 0.3, 0.84, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0.3, 0.72, 0, Math.PI * 2, true); ring.holes.push(hole); shapes.push(ring);
    const body = new THREE.Shape(); body.absellipse(0, 0.3, 0.2, 0.42, 0, Math.PI * 2, false); shapes.push(body);
    shapes.push(new THREE.Shape([[-0.045, 0], [0.045, 0], [0.03, -0.92], [-0.03, -0.92]].map(([x, y]) => new THREE.Vector2(x, y))));
    shapes.push(new THREE.Shape(wingShape({ y: -0.8, cr: 0.1, ct: 0.08, s: 0.2, sw: 0 })));
    for (const a of [0.25, 1.82]) { const c = Math.cos(a); const s = Math.sin(a); shapes.push(new THREE.Shape([[-0.84, -0.03], [0.84, -0.03], [0.84, 0.03], [-0.84, 0.03]].map(([x, y]) => new THREE.Vector2(x * c - y * s, 0.3 + x * s + y * c)))); }
  } else {
    const sp = SPEC[cls]; const prof = bodyProfile(sp);
    shapes.push(new THREE.Shape([...prof.map(([r, y]) => new THREE.Vector2(r, y)), ...prof.slice().reverse().map(([r, y]) => new THREE.Vector2(-r, y))]));
    shapes.push(new THREE.Shape(wingShape(sp.wing)));
    const stabY = sp.stab.top ? sp.fin.y - sp.fin.h * Math.tan((sp.fin.sw * Math.PI) / 180) - 0.02 : sp.stab.y;
    shapes.push(new THREE.Shape(wingShape({ ...sp.stab, y: stabY })));
    for (const [x, y, , re, len] of sp.eng ?? []) for (const sx of [-1, 1]) shapes.push(new THREE.Shape([[sx * x - re, y - len / 2], [sx * x + re, y - len / 2], [sx * x + re, y + len / 2], [sx * x - re, y + len / 2]].map(([a, b]) => new THREE.Vector2(a, b))));
  }
  return merge(shapes.map((s) => new THREE.ShapeGeometry(s, 6)));
}

const cache = new Map();
/** The model for a class: kind '2d' (map silhouette) or '3d'. Cached; do not dispose. */
export function planeGeometry(cls, kind = '3d') {
  const k = `${cls}:${kind}`;
  if (!cache.has(k)) cache.set(k, kind === '2d' ? build2D(cls) : build3D(cls));
  return cache.get(k);
}
/** Half the real length in globe units (R = 100 ↔ 6,371 km), for true-scale drawing up close. */
export const trueHalfLength = (cls) => (CLASSES[cls].L / 2) / 63710;
