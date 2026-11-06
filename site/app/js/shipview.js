// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: what a ship looks like, and what it carries.
// Ships do not broadcast whether they carry containers, ore or gas: AIS (Automatic Identification System) gives only
// a broad type (cargo, tanker, passenger, fishing...). So the kind of ship is read from that type, its size and its
// name (container lines, gas carriers and car carriers name their ships in recognisable ways), and the page says
// which it was. Each kind is built here in 3D at the ship's real length, beam and draught, loaded with its cargo:
// container stacks in the line's mix of colours, hatch covers over ore and grain, a tanker's pipe deck, the domes
// of a gas carrier, a car carrier's tall box, a cruise ship's decks. The sea is see-through so the part of the hull
// under water, its draught, shows. A 1.8 m person on the quay gives the scale.
import { THREE } from '../vendor/vendor.min.mjs';

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });

/** The kinds of ship: name, typical size (m) and what the cargo line says. */
export const SHIP_CLASSES = {
  container: { label: 'Container ship', L: 300, B: 45, T: 13 },
  bulk: { label: 'Bulk carrier', L: 225, B: 32, T: 13 },
  general: { label: 'General cargo ship', L: 120, B: 18, T: 7 },
  car: { label: 'Car carrier', L: 200, B: 32, T: 9.5 },
  tanker: { label: 'Tanker', L: 250, B: 44, T: 15 },
  gas: { label: 'Liquefied gas carrier', L: 290, B: 46, T: 11.5 },
  cruise: { label: 'Cruise ship', L: 300, B: 38, T: 8.5 },
  ferry: { label: 'Passenger ferry', L: 170, B: 27, T: 6 },
  fishing: { label: 'Fishing boat', L: 40, B: 10, T: 5 },
  tug: { label: 'Tug', L: 30, B: 11, T: 5 },
  sail: { label: 'Sailing boat', L: 14, B: 4.2, T: 2.1 },
  yacht: { label: 'Motor yacht', L: 25, B: 6, T: 2 },
  other: { label: 'Ship', L: 80, B: 15, T: 5 },
};
const CONTAINER_LINES = /\b(MAERSK|MSC|CMA CGM|COSCO|EVER|OOCL|HAPAG|ONE|YM|YANG MING|ZIM|HMM|APL|WAN HAI|KOTA|X-PRESS|SEASPAN|CONTAINER|NORTHERN|SANTA|BAY BRIDGE|CSCL|SITC|KMTC|TS LINES|EVERGREEN)\b/;
const GAS = /\b(LNG|LPG|GAS|METHANE|ARCTIC|FLEX|CLEAN)\b/;
const CARS = /\b(HIGHWAY|LEADER|GLOVIS|AUTO|HOEGH|HÖEGH|ACE|EUKOR|WALLENIUS|CAR CARRIER|DRIVE|EXPRESS AUTO)\b/;
const BULK = /\b(BULK|BULKER|ORE|CAPE|COAL|GRAIN|MINER|IRON|NAVIOS|STAR BULK|GOLDEN|PACIFIC BASIN)\b/;
const CRUISE = /(OF THE SEAS|PRINCESS|CARNIVAL|AIDA|COSTA|CELEBRITY|NORWEGIAN|QUEEN|VIKING|SILVER|HOLLAND|SEABOURN|MEIN SCHIFF|EXPLORER|ODYSSEY|MSC (WORLD|MERAVIGLIA|BELLISSIMA|GRANDIOSA|SEASIDE|VIRTUOSA|EURIBIA))/;

/** Which kind of ship this is, and how we know: { id, label, how }. */
export function shipClass(meta = {}) {
  const t = Number(meta.shipType) || 0; const name = String(meta.name ?? '').toUpperCase(); const L = Number(meta.length) || 0;
  const pick = (id, how) => ({ id, label: SHIP_CLASSES[id].label, how });
  if (t === 30) return pick('fishing', 'its broadcast type');
  if (t === 31 || t === 32 || t === 52) return pick('tug', 'its broadcast type');
  if (t === 36) return pick('sail', 'its broadcast type');
  if (t === 37) return pick('yacht', 'its broadcast type');
  if (t >= 60 && t <= 69) return CRUISE.test(name) ? pick('cruise', 'its name') : L >= 230 ? pick('cruise', 'its type and size, a best guess') : pick('ferry', 'its type and size, a best guess');
  if (t >= 80 && t <= 89) return GAS.test(name) ? pick('gas', 'its name') : pick('tanker', 'its broadcast type');
  if (t >= 70 && t <= 79) {
    if (GAS.test(name) && /\b(LNG|LPG|GAS)\b/.test(name)) return pick('gas', 'its name');
    if (CARS.test(name)) return pick('car', 'its name');
    if (CONTAINER_LINES.test(name)) return pick('container', 'its name');
    if (BULK.test(name)) return pick('bulk', 'its name');
    return L >= 160 ? pick('bulk', 'its type and size, a best guess (most large cargo ships are bulk carriers)') : pick('general', 'its type and size, a best guess');
  }
  return pick('other', t ? 'its broadcast type' : 'nothing it broadcast');
}
/** Its real size where it broadcast one (draught in decimetres from AIS), else the kind's typical size. */
export function shipDims(cls, meta = {}) {
  const c = SHIP_CLASSES[cls] ?? SHIP_CLASSES.other; const real = Number(meta.length) > 0;
  const L = real ? Number(meta.length) : c.L; const B = Math.min(Number(meta.width) || (real ? (L * c.B) / c.L : c.B), L / 2.4);
  const T = Number(meta.draught) > 0 ? Number(meta.draught) / 10 : (c.T * L) / c.L;
  return { L, B, T: Math.min(T, L / 9), real };
}
/** What it carries when full, in words, from its size (rough rules fitted to real ships). */
export function cargoWords(cls, { L, B, T }) {
  const dwt = L * B * T * 0.8 * 1.025 * 0.85; const r = (x, s = 2) => { const p = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, x))) - s + 1); return Math.round(x / p) * p; };
  switch (cls) {
    case 'container': { const teu = Math.exp(1.77 * Math.log(L * B) - 7.79); return `About ${fmt(r(teu))} containers when full, counted in twenty-foot equivalent units (TEU): everything from trainers to televisions.`; }
    case 'bulk': return `About ${fmt(r(dwt))} tonnes of loose cargo in its holds when full: iron ore, coal or grain, poured in from above.`;
    case 'general': return `About ${fmt(r(dwt))} tonnes of mixed cargo: steel, timber, machinery and crates, lifted on and off by its own cranes.`;
    case 'tanker': return `About ${fmt(r(dwt))} tonnes of oil or chemicals when full${dwt > 50_000 ? `, around ${fmt(r(dwt * 7.33, 1))} barrels of crude` : ''}.`;
    case 'gas': { const m3 = 13 * L * B; return `About ${fmt(r(m3))} cubic metres of gas, cooled to a liquid (−162 °C for natural gas) so it takes 600 times less room.`; }
    case 'car': return `About ${fmt(r(L * B * 1.0))} cars on a dozen decks inside, driven on and off up its ramp.`;
    case 'cruise': return `About ${fmt(r(L * B * 0.32))} passengers and ${fmt(r(L * B * 0.12))} crew.`;
    case 'ferry': return `About ${fmt(r(L * B * 0.35))} passengers, with cars and lorries on its vehicle decks.`;
    case 'fishing': return 'Its catch, kept chilled or frozen in the hold.';
    case 'tug': return 'No cargo: it pushes and pulls ships many times its size into their berths.';
    default: return '';
  }
}

// ------------------------------------------------------------------ building the ship
function rng(seed) { let s = (Number(seed) || 1) % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function merge(parts) {
  const geos = parts.map(([g]) => { const ng = g.index ? g.toNonIndexed() : g; if (!ng.attributes.normal) ng.computeVertexNormals(); return ng; });
  const n = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const col = new Float32Array(n * 3); let o = 0; const c = new THREE.Color();
  geos.forEach((g, i) => {
    pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); c.set(parts[i][1]);
    for (let k = o; k < o + g.attributes.position.count * 3; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
    o += g.attributes.position.count * 3; g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
/** The deck plan: a square stern, straight sides, a pointed bow (x forward, y across). */
function plan(L, B, bow = 0.16, inset = 0) {
  const h = B / 2 - inset; const x0 = -L / 2 + inset; const xb = L / 2 - L * bow; const s = new THREE.Shape();
  s.moveTo(x0, -h * 0.85); s.quadraticCurveTo(x0, -h, x0 + B * 0.12, -h); s.lineTo(xb, -h); s.quadraticCurveTo(L / 2 - inset, -h * 0.75, L / 2 - inset, 0);
  s.quadraticCurveTo(L / 2 - inset, h * 0.75, xb, h); s.lineTo(x0 + B * 0.12, h); s.quadraticCurveTo(x0, h, x0, h * 0.85); s.closePath();
  return s;
}
const slab = (shape, z0, z1) => { const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, z0); return g; };
const box = (x, y, z, dx, dy, dz) => { const g = new THREE.BoxGeometry(dx, dy, dz); g.translate(x, y, z + dz / 2); return g; };
const cyl = (x, y, z, r, h, seg = 12) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z + h / 2); return g; };
const BOX_COLORS = ['#c0392b', '#2e86c1', '#1e8449', '#d68910', '#7d3c98', '#909497', '#ba4a00', '#eceff1', '#5d6d7e', '#117a65', '#1b4f72', '#f1c40f'];

/** The ship as one geometry with a colour per part. Returns { geometry, F (freeboard, m), top (highest point, m) }. */
export function buildShip(cls, { L, B, T }, seed = 1) {
  const R = rng(seed); const P = []; const add = (g, c) => P.push([g, c]);
  const small = L < 60; const F = small ? Math.max(1.2, L * 0.07) : Math.max(3, Math.min(14, L * (cls === 'tanker' || cls === 'bulk' ? 0.03 : 0.045)));
  const hullC = { container: '#22313f', bulk: '#7b2d26', general: '#2c3e50', car: '#eef1f4', tanker: '#5b1f1a', gas: '#24405e', cruise: '#f5f7fa', ferry: '#f2f4f7', fishing: '#1f5f8b', tug: '#c0392b', sail: '#f8f9fa', yacht: '#fbfcfd', other: '#4d5d6c' }[cls] ?? '#4d5d6c';
  const bow = cls === 'sail' || cls === 'yacht' ? 0.35 : small ? 0.25 : 0.14;
  add(slab(plan(L, B, bow), -T, 0.25), '#9b2a22'); // antifouling red below the waterline
  add(slab(plan(L, B, bow), 0.25, F), hullC);
  if (cls === 'cruise' || cls === 'ferry' || cls === 'car') add(slab(plan(L, B, bow, -0.05), F * 0.55, F * 0.7), '#1d4e89'); // a stripe
  const deck = (c) => add(slab(plan(L, B, bow, 0.4), F, F + 0.05), c);
  const bridge = (x, w, h, c = '#f4f6f7', funnel = '#c0392b') => {
    const len = Math.max(4, L * 0.07); add(box(x, 0, F, len, w, h), c);
    add(box(x + len * 0.1, 0, F + h, len * 0.5, Math.min(B * 1.0, w * 1.15), Math.max(1.2, h * 0.09)), c); // bridge with its wings
    add(box(x + len * 0.25, 0, F + h * 0.86, len * 0.06, w * 1.001, h * 0.06), '#1b2631'); // windows
    add(box(x - len * 0.55, 0, F, len * 0.35, w * 0.35, h * 1.05), funnel);
    return len;
  };
  const top = { z: F };
  switch (cls) {
    case 'container': {
      deck('#3b4a57'); const bx = -L / 2 + L * 0.2; const tiers = Math.max(2, Math.min(9, Math.round(B / 6))); const rows = Math.max(3, Math.floor((B - 2) / 2.5));
      const hb = tiers * 2.6 + 6; bridge(bx, B * 0.8, hb);
      const start = bx + L * 0.05; const end = L / 2 - L * 0.13; const bays = Math.floor((end - start) / 12.8);
      const mix = BOX_COLORS.slice(0).sort(() => R() - 0.5).slice(0, 5);
      for (let i = 0; i < bays; i++) {
        const x = start + i * 12.8 + 6.4; const nt = Math.max(1, tiers - (R() < 0.2 ? Math.floor(R() * 3) : 0));
        // each row of a bay is one stack; a new box is drawn only where the colour changes (a few hundred parts, not thousands)
        for (let r = 0; r < rows; r++) {
          const y = (r - (rows - 1) / 2) * 2.5; let k0 = 0; let col = mix[Math.floor(R() * mix.length)];
          for (let k = 1; k <= nt; k++) { if (k === nt || R() < 0.35) { add(box(x, y, F + 0.6 + k0 * 2.6, 12.2, 2.44, (k - k0) * 2.6 - 0.05), col); k0 = k; col = R() < 0.12 ? BOX_COLORS[Math.floor(R() * BOX_COLORS.length)] : mix[Math.floor(R() * mix.length)]; } }
        }
      }
      top.z = F + hb; break;
    }
    case 'bulk': case 'general': {
      deck(cls === 'bulk' ? '#4d5656' : '#5d6d7e'); const hb = Math.max(8, Math.min(22, L * 0.07)); bridge(-L / 2 + L * 0.06, B * 0.85, hb, '#f4f6f7', '#1b2631');
      const start = -L / 2 + L * 0.16; const end = L / 2 - L * 0.12; const n = Math.max(2, Math.round((end - start) / (cls === 'bulk' ? 26 : 30))); const pitch = (end - start) / n;
      for (let i = 0; i < n; i++) {
        const x = start + pitch * (i + 0.5); add(box(x, 0, F, pitch * 0.7, B * 0.66, Math.max(1.5, B * 0.07)), cls === 'bulk' ? '#b03a2e' : '#2e4053');
        if ((cls === 'general' || L < 200) && i < n - 1) { // deck cranes between the hatches
          const cx = x + pitch / 2; const hc = Math.max(6, B * 0.6); add(cyl(cx, 0, F, Math.max(0.6, B * 0.04), hc), '#f0b429');
          const jib = new THREE.BoxGeometry(pitch * 0.9, 0.6, 0.6); jib.rotateY(-0.5); jib.translate(cx + pitch * 0.35, 0, F + hc + pitch * 0.2); add(jib, '#f0b429');
        }
      }
      top.z = F + hb; break;
    }
    case 'tanker': {
      deck('#7d3a2e'); const hb = Math.max(9, Math.min(24, L * 0.07)); bridge(-L / 2 + L * 0.06, B * 0.85, hb, '#f4f6f7', '#1b2631');
      const s = -L / 2 + L * 0.15; const e = L / 2 - L * 0.1;
      add(box((s + e) / 2, 0, F, e - s, Math.max(1, B * 0.06), Math.max(1, B * 0.04)), '#d5d8dc'); // the pipe deck along the middle
      for (const y of [-1, 1]) add(box((s + e) / 2, y * B * 0.08, F + 0.3, e - s, 0.5, 0.5), '#aab7b8');
      add(box(0, 0, F, Math.max(2, L * 0.02), B * 0.9, Math.max(1.5, B * 0.05)), '#c0392b'); // the manifold, where the hoses connect
      for (let i = 0; i < 4; i++) add(cyl(s + (e - s) * (0.15 + i * 0.23), B * 0.25, F, Math.max(0.4, B * 0.015), Math.max(2, B * 0.08), 8), '#d5d8dc');
      top.z = F + hb; break;
    }
    case 'gas': {
      deck('#3b4a57'); const hb = Math.max(12, Math.min(28, L * 0.08)); bridge(-L / 2 + L * 0.06, B * 0.85, hb, '#f4f6f7', '#1b2631');
      const s = -L / 2 + L * 0.2; const e = L / 2 - L * 0.12; const n = L > 200 ? 4 : 3; const r = Math.min(B * 0.42, (e - s) / n / 2.1);
      for (let i = 0; i < n; i++) { const x = s + ((e - s) / n) * (i + 0.5); add(cyl(x, 0, F, r * 1.02, r * 0.35, 24), '#d5d8dc'); const g = new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2); g.rotateX(Math.PI / 2); g.translate(x, 0, F + r * 0.35); add(g, '#f2f3f4'); }
      add(box((s + e) / 2, 0, F + r * 0.3, e - s, 1.2, 1.2), '#aab7b8');
      top.z = F + Math.max(hb, r * 1.35); break;
    }
    case 'car': {
      const H = Math.max(18, Math.min(34, B * 1.0)); const s = -L / 2 + 1; const e = L / 2 - L * 0.06;
      add(slab(plan(e - s, B, 0.08, 0.2), F, F + H).translate((s + e) / 2 - 0, 0, 0), '#eef1f4');
      add(box((s + e) / 2, 0, F + H * 0.35, (e - s) * 0.98, B * 1.003, 2), '#1d4e89');
      add(box(e - L * 0.06, 0, F + H * 0.88, L * 0.04, B * 1.004, H * 0.07), '#1b2631'); // the bridge windows, high at the front
      add(box(-L / 2 + L * 0.1, 0, F + H, L * 0.05, B * 0.3, 3), '#1b2631');
      top.z = F + H; break;
    }
    case 'cruise': case 'ferry': {
      const n = cls === 'cruise' ? Math.max(5, Math.min(16, Math.round(L / 24))) : Math.max(2, Math.min(7, Math.round(L / 30))); const dh = 2.9;
      let z = F; let len = L * 0.82; let w = B * 0.94; let x = -L * 0.04;
      for (let i = 0; i < n; i++) {
        add(box(x, 0, z, len, w, dh), '#f8f9fa'); add(box(x, 0, z + dh * 0.45, len * 1.002, w * 1.004, dh * 0.3), i % 4 === 3 ? '#1d4e89' : '#2c3e50');
        z += dh; if (i > n * 0.55) { len *= 0.94; w *= 0.97; x -= L * 0.004; }
      }
      if (cls === 'cruise') for (const y of [-1, 1]) { const nb = Math.max(4, Math.round(L / 30)); for (let i = 0; i < nb; i++) add(box(-L * 0.3 + (i * L * 0.55) / (nb - 1), y * (B * 0.47 - 0.2), F + 4 * dh, Math.min(9, L * 0.03), 2.6, 2.4), '#e67e22'); } // lifeboats
      add(cyl(-L * 0.28, 0, z, Math.max(2, B * 0.1), Math.max(4, L * 0.035), 16), cls === 'cruise' ? '#c0392b' : '#1d4e89');
      add(box(L * 0.25, 0, z - dh * 0.6, Math.max(4, L * 0.04), w * 1.003, dh * 0.4), '#1b2631');
      top.z = z + Math.max(4, L * 0.035); break;
    }
    case 'fishing': {
      deck('#7f8c8d'); const hb = Math.max(3.5, L * 0.12);
      add(box(L * 0.18, 0, F, L * 0.18, B * 0.7, hb), '#f4f6f7'); add(box(L * 0.2, 0, F + hb * 0.62, L * 0.181, B * 0.701, hb * 0.2), '#1b2631');
      add(cyl(L * 0.18, 0, F + hb, 0.25, hb * 1.2, 6), '#bdc3c7');
      for (const y of [-1, 1]) add(box(-L * 0.42, y * B * 0.38, F, 0.6, 0.6, hb * 1.3), '#f39c12'); add(box(-L * 0.42, 0, F + hb * 1.3, 0.6, B * 0.82, 0.6), '#f39c12'); // the gantry that hauls the nets
      top.z = F + hb * 2.2; break;
    }
    case 'tug': {
      deck('#2c3e50'); const hb = Math.max(4, L * 0.2);
      add(box(0, 0, F, L * 0.35, B * 0.7, hb * 0.6), '#f4f6f7'); add(box(L * 0.03, 0, F + hb * 0.6, L * 0.2, B * 0.6, hb * 0.4), '#f4f6f7'); add(box(L * 0.03, 0, F + hb * 0.78, L * 0.201, B * 0.601, hb * 0.15), '#1b2631');
      add(box(-L * 0.18, 0, F, L * 0.08, B * 0.25, hb * 0.9), '#f0b429'); add(slab(plan(L * 1.02, B * 1.04, 0.25), F * 0.4, F * 0.85), '#1b1b1b'); // fenders all round
      top.z = F + hb; break;
    }
    case 'sail': {
      deck('#d7ccc8'); add(box(-L * 0.05, 0, F, L * 0.3, B * 0.5, 0.9), '#f8f9fa');
      const m = L * 1.35; add(cyl(L * 0.08, 0, F, 0.09, m, 6), '#bdc3c7');
      const tri = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2); return g; };
      add(tri([[L * 0.08, F + 1.2], [L * 0.08, F + m * 0.97], [-L * 0.34, F + 1.4]]), '#fdfefe');
      add(tri([[L * 0.1, F + m * 0.85], [L * 0.47, F + 0.6], [L * 0.12, F + 0.9]]), '#eaf2f8');
      top.z = F + m; break;
    }
    case 'yacht': {
      add(box(-L * 0.05, 0, F, L * 0.55, B * 0.8, F * 1.1), '#fbfcfd'); add(box(-L * 0.02, 0, F + F * 0.45, L * 0.5, B * 0.81, F * 0.3), '#1b2631');
      add(box(-L * 0.1, 0, F + F * 1.1, L * 0.3, B * 0.6, F * 0.7), '#fbfcfd'); top.z = F * 2.8; break;
    }
    default: { deck('#5d6d7e'); const hb = Math.max(5, L * 0.08); bridge(L * 0.05, B * 0.7, hb, '#ecf0f1', '#2c3e50'); top.z = F + hb; }
  }
  return { geometry: merge(P), F, top: top.z };
}

/** The 3D view: the ship slowly turning on a see-through sea, a quay and a 1.8 m person beside it. */
export function mountShipView(host, meta = {}, { seed = 1, cls: forced = null, name = null } = {}) {
  if (!host) return null;
  const c = forced ? { id: forced, label: SHIP_CLASSES[forced].label, how: null } : shipClass(meta); const dims = shipDims(c.id, meta);
  host.innerHTML = `<div class="sv"><canvas class="sv-canvas" role="img" aria-label="3D model of a ${c.label.toLowerCase()}"></canvas><p class="sv-note muted"></p></div>`;
  const canvas = host.querySelector('canvas'); const note = host.querySelector('.sv-note');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { host.querySelector('.sv').innerHTML = `<p class="muted">${c.label}. The 3D ship needs WebGL.</p>`; return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9cc4e8);
  const cam = new THREE.PerspectiveCamera(35, 2, 0.1, 20000); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x30404a, 2.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(0.5, -0.7, 1); scene.add(sun);
  const { geometry, F, top } = buildShip(c.id, dims, seed);
  const ship = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(ship);
  const L = dims.L; const B = dims.B;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(L * 8, L * 8), new THREE.MeshLambertMaterial({ color: 0x2a6f97, transparent: true, opacity: 0.72, depthWrite: false })); scene.add(sea);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(L * 1.4, Math.max(8, B * 0.8), 2.5), new THREE.MeshLambertMaterial({ color: 0x8c8f91 })); quay.position.set(0, B / 2 + Math.max(4, B * 0.4) + 1, 0.4); scene.add(quay);
  const person = new THREE.Group(); { const m = new THREE.MeshLambertMaterial({ color: 0xff8f3a }); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.15, 10), m); b.rotation.x = Math.PI / 2; b.position.z = 1.0; person.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), m); h.position.z = 1.7; person.add(h); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.45, 8), m); l.rotation.x = Math.PI / 2; l.position.z = 0.22; person.add(l); }
  person.position.set(L * 0.3, B / 2 + 2.5, 1.65); scene.add(person);
  const pitches = L / 105;
  note.textContent = `${name ?? c.label}${c.how ? ` (from ${c.how})` : ''}, drawn to ${forced ? 'scale' : dims.real ? 'its real size' : 'a typical size'}: ${fmt(L)} m long, ${fmt(B)} m wide, ${fmt(dims.T, 1)} m under water${pitches >= 0.8 ? `, as long as ${fmt(pitches, 1)} football pitches` : ''}. ${cargoWords(c.id, dims)} The orange figure on the quay is a 1.8 m person.`;
  let raf = 0; const t0 = performance.now(); const R = Math.max(L * 0.78, top * 2.2);
  function size() { const w = canvas.clientWidth || 300; const h = Math.round(w * 0.55); if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } }
  function draw(now) {
    if (!renderer) return; if (!host.isConnected) { dispose(); return; } size();
    const a = reduceMotion ? -2.2 : -2.2 + ((now - t0) / 1000) * 0.18; cam.position.set(Math.cos(a) * R, Math.sin(a) * R, R * 0.38 + top * 0.3); cam.lookAt(0, 0, Math.max(F, top * 0.3)); renderer.render(scene, cam);
  }
  function loop(now) { raf = 0; if (!document.hidden) draw(now); if (renderer && !reduceMotion) raf = requestAnimationFrame(loop); }
  function dispose() { cancelAnimationFrame(raf); raf = 0; if (renderer) { geometry.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; } }
  raf = requestAnimationFrame(loop); draw(performance.now());
  return { cls: c, dims, dispose };
}

// ------------------------------------------------------------------ small side-on pictures for lists (one shared renderer)
let thumbR = null; const thumbs = new Map();
/** A side-on picture of a kind of ship at a given size, as a data URL (cached); null without WebGL. */
export function shipThumb(cls, dims) {
  const key = `${cls}|${Math.round(dims.L)}|${Math.round(dims.B)}`; if (thumbs.has(key)) return thumbs.get(key);
  let url = null;
  try {
    if (!thumbR) { const cv = document.createElement('canvas'); thumbR = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.setPixelRatio(1); thumbR.setSize(192, 72, false); }
    const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 2.3)); const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(0.3, -1, 0.8); scene.add(sun);
    const { geometry, top } = buildShip(cls, { ...dims, T: dims.T }, 7); const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(mesh);
    const L = dims.L; const zMin = -dims.T * 0.4; const h = Math.max(top - zMin, L / 2.66) * 1.08;
    const cam = new THREE.OrthographicCamera(-L * 0.54, L * 0.54, h * 0.62, -h * 0.46, 0.1, L * 10); cam.up.set(0, 0, 1);
    cam.position.set(-L * 0.12, -L * 3, L * 0.5 + (top + zMin) / 2); cam.lookAt(0, 0, (top + zMin) / 2 - h * 0.08); cam.updateProjectionMatrix();
    thumbR.setClearColor(0x000000, 0); thumbR.render(scene, cam); url = thumbR.domElement.toDataURL('image/png'); geometry.dispose();
  } catch { url = null; }
  thumbs.set(key, url); return url;
}
/** Swap each [data-sv="kind|length|beam|draught"] placeholder under root for its picture, a few at a time after the page
 *  has drawn, so the first picture (which compiles the shaders) never holds up the page. */
export function paintThumbs(root) {
  const todo = [...(root?.querySelectorAll('[data-sv]') ?? [])];
  const step = () => {
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 30) {
      const el = todo.shift(); if (!el.isConnected) continue; const [c, L, B, T] = el.dataset.sv.split('|'); const u = shipThumb(c, { L: +L, B: +B, T: +T });
      if (u) { el.innerHTML = `<img class="sv-thumb" src="${u}" alt="" width="96" height="36">`; el.classList.add('has-sv'); } el.removeAttribute('data-sv');
    }
    if (todo.length) setTimeout(step, 16);
  };
  setTimeout(step, 60);
}
