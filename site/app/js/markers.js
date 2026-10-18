// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — fast marker renderer.
//
// globe.gl draws every point as its own mesh and every label as real 3D text geometry. With a dozen
// layers on, that meant thousands of draw calls and multi-second freezes every time the camera stopped
// (the labels' font triangulation alone could take seconds). This module replaces both with:
//   • ONE instanced mesh for all columns/markers (one draw call, however many markers),
//   • sprites for pins and names, drawn once onto canvases and cached, always facing the screen,
//   • a lat/lng grid index so hover and click find the nearest thing in microseconds instead of
//     projecting every marker to the screen.
import { THREE } from '../vendor/vendor.min.mjs';
import { GLYPHS, INK, lighten } from './icons.js';

const R = 100;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ colour parsing (with cache)
const colorCache = new Map();
export function parseColor(c) {
  let v = colorCache.get(c);
  if (v) return v;
  const m = /^rgba?\(([^)]+)\)$/.exec(c ?? '');
  if (m) { const [r, g, b] = m[1].split(',').map((x) => Number(x) / 255); v = new THREE.Color(r, g, b); } else { try { v = new THREE.Color(c || '#ffffff'); } catch { v = new THREE.Color('#ffffff'); } }
  colorCache.set(c, v);
  return v;
}

// ------------------------------------------------------------------ geo grid index
// Numeric cell keys (string keys like "12:-34" made building the index for 80,000 markers the single
// biggest cost after every camera move).
export class GeoIndex {
  constructor(cell = 0.5) { this.cell = cell; this.map = new Map(); this.size = 0; }
  key(la, lo) { return (Math.floor(la / this.cell) + 4000) * 20000 + (Math.floor(lo / this.cell) + 9000); }
  add(item) { const k = this.key(item.lat, item.lng); let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(item); this.size += 1; }
  /** nearest item within radiusKm; filter optional */
  nearest(lat, lng, radiusKm, filter) {
    const dLat = radiusKm / 111; const dLng = radiusKm / (111 * Math.max(0.05, Math.cos(lat * D2R)));
    const c = this.cell; let best = null; let bestD = radiusKm;
    const i0 = Math.floor((lat - dLat) / c); const i1 = Math.floor((lat + dLat) / c);
    const j0 = Math.floor((lng - dLng) / c); const j1 = Math.floor((lng + dLng) / c);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) return null; // absurdly large query; skip
    const cosl = Math.cos(lat * D2R);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get((i + 4000) * 20000 + (j + 9000)); if (!a) continue;
      for (const it of a) {
        if (filter && !filter(it)) continue;
        const y = (it.lat - lat) * 111; const x = (it.lng - lng) * 111 * cosl;
        const d = Math.sqrt(x * x + y * y);
        if (d < bestD) { bestD = d; best = it; }
      }
    }
    return best ? { item: best, km: bestD } : null;
  }
  /** every item within radiusKm (at most max), e.g. things that share one spot */
  within(lat, lng, radiusKm, max = 30) {
    const dLat = radiusKm / 111; const dLng = radiusKm / (111 * Math.max(0.05, Math.cos(lat * D2R))); const c = this.cell; const cosl = Math.cos(lat * D2R); const out = [];
    for (let i = Math.floor((lat - dLat) / c); i <= Math.floor((lat + dLat) / c); i++) for (let j = Math.floor((lng - dLng) / c); j <= Math.floor((lng + dLng) / c); j++) {
      for (const it of this.map.get((i + 4000) * 20000 + (j + 9000)) ?? []) { if (Math.hypot((it.lat - lat) * 111, (it.lng - lng) * 111 * cosl) <= radiusKm) { out.push(it); if (out.length >= max) return out; } }
    }
    return out;
  }
}
/** Several indexes queried as one (each layer's index is cached until its data changes). */
export class MultiIndex {
  constructor(parts) { this.parts = parts; }
  nearest(lat, lng, radiusKm, filter) {
    let best = null;
    for (const p of this.parts) { const n = p.nearest(lat, lng, best ? best.km : radiusKm, filter); if (n && (!best || n.km < best.km)) best = n; }
    return best;
  }
  within(lat, lng, radiusKm, max = 30) { const out = []; for (const p of this.parts) { out.push(...p.within(lat, lng, radiusKm, max - out.length)); if (out.length >= max) break; } return out; }
}

// ------------------------------------------------------------------ map symbols (Path2D, drawn in any colour)
const pathCache = new Map();
const P2 = (d) => { let p = pathCache.get(d); if (!p) { p = new Path2D(d); pathCache.set(d, p); } return p; };
export const iconsReady = Promise.resolve(); // symbols are vector paths now: nothing to load

/** Draw one symbol centred at (cx, cy), `size` canvas pixels across, with a dark halo so it reads on any map. */
export function drawGlyph(g, name, color, cx, cy, size, { selected = false, halo = INK } = {}) {
  const parts = GLYPHS[name] ?? GLYPHS.pin; const light = lighten(color);
  const paint = (st) => (st.endsWith('d') ? INK : st.endsWith('l') ? light : color);
  g.save(); g.translate(cx - size / 2, cy - size / 2); g.scale(size / 24, size / 24);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // 1. halo (and a soft shadow under it), so the symbol stands off satellite imagery and dark oceans alike
  g.shadowColor = selected ? color : 'rgba(0,0,0,0.55)'; g.shadowBlur = selected ? 10 * S : 3 * S; g.shadowOffsetY = selected ? 0 : 1 * S;
  const hw = selected ? 4.2 : 2.6; const hc = selected ? '#ffffff' : halo;
  for (const [d, st, w] of parts) {
    const p = P2(d); g.strokeStyle = hc; g.fillStyle = hc;
    if (st[0] === 's') { g.lineWidth = (w ?? 2.2) + hw; g.stroke(p); } else { g.lineWidth = hw; g.stroke(p); g.fill(p, 'evenodd'); }
  }
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  if (selected) for (const [d, st, w] of parts) { const p = P2(d); g.strokeStyle = INK; g.fillStyle = INK; if (st[0] === 's') { g.lineWidth = (w ?? 2.2) + 1.6; g.stroke(p); } else { g.lineWidth = 1.6; g.stroke(p); g.fill(p, 'evenodd'); } }
  // 2. the symbol itself
  for (const [d, st, w] of parts) {
    const p = P2(d);
    if (st[0] === 's') { g.strokeStyle = paint(st); g.lineWidth = w ?? 2.2; g.stroke(p); } else { g.fillStyle = paint(st); g.fill(p, 'evenodd'); }
  }
  g.restore();
}

// ------------------------------------------------------------------ canvas sprite factory (LRU cache)
const texCache = new Map();
function cachedTexture(key, draw) {
  let t = texCache.get(key);
  if (t) { texCache.delete(key); texCache.set(key, t); return t; }
  const cv = document.createElement('canvas'); const info = draw(cv);
  t = { tex: new THREE.CanvasTexture(cv), w: cv.width, h: cv.height, ...info };
  t.tex.colorSpace = THREE.SRGBColorSpace ?? t.tex.colorSpace; t.tex.minFilter = THREE.LinearFilter; t.tex.generateMipmaps = false;
  texCache.set(key, t);
  if (texCache.size > 700) { const [k, v] = texCache.entries().next().value; v.tex.dispose(); texCache.delete(k); }
  return t;
}
const FONT = '"Atkinson Hyperlegible","Segoe UI",Arial,sans-serif';
const S = 2; // draw at 2× for crisp text

/** A marker is the symbol itself (no bubble), centred on its location, with an optional name card beside it. */
function drawPin(cv, { icon, color, title, sub, detailed, more, selected, size = 28 }) {
  const ctx = cv.getContext('2d');
  ctx.font = `700 ${13 * S}px ${FONT}`;
  const tw = detailed ? Math.min(230 * S, ctx.measureText(title).width) : 0;
  ctx.font = `400 ${11.5 * S}px ${FONT}`;
  const sw = detailed && sub ? Math.min(230 * S, ctx.measureText(sub).width) : 0;
  const G = (selected ? Math.max(36, size + 8) : size) * S; const box = G + 12 * S; const pad = 8 * S; const textW = Math.max(tw, sw);
  const cardH = (sub ? 34 : 26) * S; const badge = more ? 12 * S : 0; const left = more ? 22 * S : 0; // the "+N" badge sits to the upper left, clear of the card
  const w = left + box + (detailed ? pad + textW + pad + 4 * S : 0); const h = Math.max(box, cardH + 4 * S) + badge * 2;
  cv.width = Math.ceil(w); cv.height = Math.ceil(h);
  const g = cv.getContext('2d');
  const cx = left + box / 2; const cy = h / 2;
  if (detailed) { // name card, with a stripe in the symbol's colour
    const x0 = left + box - 6 * S; const y0 = cy - cardH / 2; const cw = w - x0 - 2 * S;
    g.fillStyle = 'rgba(8,24,39,0.9)'; g.strokeStyle = 'rgba(36,73,107,1)'; g.lineWidth = 1 * S;
    roundRect(g, x0, y0, cw, cardH, 7 * S); g.fill(); g.stroke();
    g.fillStyle = color; roundRect(g, x0, y0, 4 * S, cardH, 2 * S); g.fill();
    g.fillStyle = '#eef3f6'; g.font = `700 ${13 * S}px ${FONT}`; g.textBaseline = 'middle';
    g.fillText(ellipsis(g, title, 230 * S), x0 + pad + 2 * S, sub ? cy - 7 * S : cy);
    if (sub) { g.fillStyle = '#a9bccb'; g.font = `400 ${11.5 * S}px ${FONT}`; g.fillText(ellipsis(g, sub, 230 * S), x0 + pad + 2 * S, cy + 8 * S); }
  }
  drawGlyph(g, icon, color, cx, cy, G, { selected });
  let badgeBox = null;
  if (more) { // cluster badge: "+N more like this here"
    const txt = `+${more > 99 ? '99' : more}`; g.font = `700 ${10 * S}px ${FONT}`; const bw = g.measureText(txt).width + 8 * S;
    const bx = Math.max(1 * S, cx - G * 0.3 - bw); const by = cy - G / 2 - 4 * S;
    g.fillStyle = '#eef3f6'; g.strokeStyle = INK; g.lineWidth = 1.5 * S; roundRect(g, bx, by, bw, 13 * S, 6.5 * S); g.fill(); g.stroke();
    g.fillStyle = '#081827'; g.textBaseline = 'middle'; g.fillText(txt, bx + 4 * S, by + 6.7 * S);
    // badge rectangle in screen pixels relative to the symbol's centre (for "click +N to zoom in")
    badgeBox = { x0: (bx - cx) / S - 3, x1: (bx + bw - cx) / S + 3, y0: (by - cy) / S - 3, y1: (by + 13 * S - cy) / S + 3 };
  }
  return { anchorX: cx / cv.width, anchorY: 0.5, hitR: G / 2 / S, badge: badgeBox };
}
function drawLabel(cv, { text, color, size }) {
  const ctx = cv.getContext('2d'); const fs = Math.round(size * S);
  ctx.font = `700 ${fs}px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width + 14 * S); const h = Math.ceil(fs * 1.6 + 4 * S);
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.font = `700 ${fs}px ${FONT}`; g.textBaseline = 'middle';
  g.fillStyle = color; g.beginPath(); g.arc(4 * S, h / 2, 2.6 * S, 0, Math.PI * 2); g.fill();
  g.lineWidth = 3.5 * S; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round'; g.strokeText(text, 10 * S, h / 2);
  g.fillStyle = color; g.fillText(text, 10 * S, h / 2);
  return { anchorX: (4 * S) / w };
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function ellipsis(g, s, max) { if (g.measureText(s).width <= max) return s; while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1); return `${s}…`; }

// ------------------------------------------------------------------ the renderer
export class MarkerRenderer {
  constructor(globe) {
    this.globe = globe;
    this.group = new THREE.Group(); this.group.renderOrder = 4;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1); geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2); // base at origin, axis +Z
    this.cap = 60000;
    this.cols = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), this.cap);
    this.cols.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.cols.count = 0; this.cols.frustumCulled = false;
    this.cols.raycast = () => {}; // picking uses our grid index; ray-casting 60k instances on every mouse move is what stalls globes
    this.group.add(this.cols);
    this.spriteGroup = new THREE.Group(); this.group.add(this.spriteGroup);
    this.pool = []; this.points = []; this.pins = []; this.labels = [];
    this.base = new Float32Array(0); // per point: px,py,pz, qx,qy,qz,qw
    const h0 = globe.renderer().domElement.clientHeight || innerHeight;
    this.pixelScale = 1 / (h0 * 1.072); // sprite size is relative to the canvas height (the stage, not the window)
    this.m = new THREE.Matrix4(); this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.up = new THREE.Vector3(0, 0, 1);
  }
  get object() { return this.group; }
  setViewport(h) { this.pixelScale = 1 / (h * 1.072); this.layoutSprites(); }
  /** Compile the marker shaders up front (in parallel where supported) so the first zoom-in doesn't stall. */
  warm(renderer, scene, camera) {
    this.cols.count = 1; this.cols.setMatrixAt(0, new THREE.Matrix4().makeScale(0.001, 0.001, 0.001));
    const t = cachedTexture('warm', (cv) => { cv.width = 4; cv.height = 4; return { anchorX: 0.5 }; });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, sizeAttenuation: false, depthWrite: false, depthTest: false, transparent: true }));
    sp.scale.set(0.0001, 0.0001, 1); sp.raycast = () => {}; this.spriteGroup.add(sp);
    const done = () => { this.spriteGroup.remove(sp); if (!this.points.length) this.cols.count = 0; };
    try { (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera))).then(done, done); } catch { done(); }
  }

  /** Columns: [{lat,lng,alt,r,color}], zk = zoom factor for radii. Positions/rotations cached; only scale changes on zoom. */
  /** How tall columns and how high pins float, relative to the camera height (globe radii).
      Far away they stand tall so you can read them; up close they shrink to the ground so they
      never end up above or behind the camera. */
  setCamera(camAlt) { this.camAlt = camAlt; this.hScale = Math.max(0.004, Math.min(0.5, camAlt / 1.6)); this.floatAlt = Math.max(0.0000012, Math.min(0.004, camAlt * 0.015)); }
  setPoints(points, zk) {
    const n = Math.min(points.length, this.cap);
    this.points = points; this.base = new Float32Array(n * 7);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const pt = points[i]; const c = this.globe.getCoords(pt.lat, pt.lng, 0);
      v.set(c.x, c.y, c.z); const dir = v.clone().normalize();
      this.q.setFromUnitVectors(this.up, dir);
      this.base.set([c.x, c.y, c.z, this.q.x, this.q.y, this.q.z, this.q.w], i * 7);
      this.cols.setColorAt(i, parseColor(pt.color));
    }
    this.cols.count = n;
    if (this.cols.instanceColor) { const a = this.cols.instanceColor; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, Math.max(3, n * 3)); a.needsUpdate = true; }
    this.rescale(zk);
  }
  rescale(zk) {
    const b = this.base; const n = this.cols.count;
    for (let i = 0; i < n; i++) {
      const pt = this.points[i];
      const rw = Math.max(0.0004, (pt.r ?? 0.2) * zk * D2R * R);
      const hw = Math.max(0.00004, (pt.alt ?? 0.01) * R * (this.hScale ?? 1));
      this.p.set(b[i * 7], b[i * 7 + 1], b[i * 7 + 2]); this.q.set(b[i * 7 + 3], b[i * 7 + 4], b[i * 7 + 5], b[i * 7 + 6]); this.s.set(rw, rw, hw);
      this.m.compose(this.p, this.q, this.s); this.cols.setMatrixAt(i, this.m);
    }
    // Upload only the slots in use — the buffer has room for 60,000 markers, and re-sending all of it
    // (3.8 MB) on every zoom step was the biggest remaining stall.
    const im = this.cols.instanceMatrix; im.clearUpdateRanges?.(); im.addUpdateRange?.(0, Math.max(16, n * 16)); im.needsUpdate = true;
  }

  /** Sprites: pins [{lat,lng,alt,icon,color,title,sub,detailed,ref}] and labels [{lat,lng,alt,text,size,color,ref}] */
  setSprites(pins, labels) {
    this.pins = pins; this.labels = labels;
    const need = pins.length + labels.length;
    while (this.pool.length < need) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthWrite: false, depthTest: false, transparent: true }));
      sp.renderOrder = 6; sp.raycast = () => {}; this.pool.push(sp); this.spriteGroup.add(sp);
    }
    let k = 0;
    for (const p of pins) {
      const key = `p|${p.icon}|${p.color}|${p.size ?? 28}|${p.more ?? 0}|${p.selected ? 1 : 0}|${p.detailed ? `${p.title}|${p.sub}` : ''}`;
      const t = cachedTexture(key, (cv) => drawPin(cv, p));
      this.place(this.pool[k++], p, t, t.anchorY ?? 0.5);
    }
    for (const l of labels) {
      const key = `l|${l.text}|${l.color}|${Math.round(l.size)}`;
      const t = cachedTexture(key, (cv) => drawLabel(cv, l));
      this.place(this.pool[k++], l, t, 0.5);
    }
    for (let i = 0; i < this.pool.length; i++) this.pool[i].userData.want = i < k;
    for (let i = k; i < this.pool.length; i++) this.pool[i].visible = false;
  }
  /** Pins stand on the ground (plus a hair, scaled to the zoom) so they stay put under your cursor at every zoom. */
  spriteAlt(d) { const f = this.floatAlt ?? 0.004; return d.pinned === false ? Math.max(f, Math.min(d.alt ?? f, 0.004 * (this.hScale ?? 1))) : f; }
  place(sp, d, t, anchorY) {
    const alt = this.spriteAlt(d); d.renderAlt = alt;
    const c = this.globe.getCoords(d.lat, d.lng, alt);
    sp.position.set(c.x, c.y, c.z); sp.material.map = t.tex; sp.material.needsUpdate = true; sp.visible = true;
    sp.center.set(t.anchorX, anchorY); sp.userData = { d, t, anchorY, pin: t.hitR != null };
    sp.scale.set((t.w / S) * this.pixelScale, (t.h / S) * this.pixelScale, 1);
  }
  /** Re-seat every visible sprite for a new zoom level (cheap: positions only). */
  reseat() { for (const sp of this.pool) if (sp.visible || sp.userData.want) { const d = sp.userData.d; if (!d) continue; const alt = this.spriteAlt(d); d.renderAlt = alt; const c = this.globe.getCoords(d.lat, d.lng, alt); sp.position.set(c.x, c.y, c.z); } }
  layoutSprites() { for (const sp of this.pool) if (sp.visible && sp.userData.t) sp.scale.set((sp.userData.t.w / S) * this.pixelScale, (sp.userData.t.h / S) * this.pixelScale, 1); }

  /** Screen-space hit test on visible symbols: the symbol itself, or its name card. */
  hitPin(x, y, occluded) {
    let best = null; let badge = null; // a symbol under the pointer wins over a neighbour's "+N" badge drawn on top of it
    for (const sp of this.pool) {
      if (!sp.visible || !sp.userData.d || !sp.userData.pin) continue;
      const d = sp.userData.d; const s = this.globe.getScreenCoords(d.lat, d.lng, d.renderAlt ?? 0.004); if (!s) continue;
      if (occluded(d)) continue;
      const t = sp.userData.t; const w = t.w / S; const h = t.h / S;
      const left = s.x - w * sp.center.x; const top = s.y - h * (1 - sp.center.y);
      const b = t.badge; if (!badge && b && x - s.x >= b.x0 && x - s.x <= b.x1 && y - s.y >= b.y0 && y - s.y <= b.y1) badge = { zoom: true, lat: d.lat, lng: d.lng, more: d.more, group: [d, ...(d.members ?? [])], tip: `<div class="tip"><b>${d.more} more here</b><span>Click to see them all</span></div>` };
      if (badge && badge.lat === d.lat && badge.lng === d.lng) continue;
      const onSymbol = Math.hypot(x - s.x, y - s.y) <= t.hitR + 4;
      const onCard = x >= left && x <= left + w && y >= top && y <= top + h && x > s.x;
      if (onSymbol || onCard) { const dist = Math.hypot(x - s.x, y - s.y); if (!best || dist < best.dist) best = { d, dist, onSymbol }; }
    }
    return (best?.onSymbol ? best.d : badge ?? best?.d) ?? null;
  }
}
