// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas v2.39: a wildfire in person. Stand on the real ground (Terrain Tiles heights, landscape.js)
// outside a fire's edge and look at it: flames where satellites saw it burning in the 12 hours before its last pass,
// a glow along the fire line, smoke rising and drifting with the live wind (Open-Meteo), and the ground it has already
// burnt darkened. Lit by the real Sun for the time and place, so at night you see the fire line glowing.
// Drag to look round, scroll to zoom, the buttons walk closer or back and change how high you stand.
// Loaded only when you press "From the north / east / south / west" on a fire page (firetracker.js).
import { THREE } from '../vendor/vendor.min.mjs';
import { buildLandscape, disposeLandscape, landscapeMaterial } from './landscape.js';
import { solarElevation, subsolarPoint, bearingDeg } from './astro.js';
import { viewpoint, radiusKm, toKm, tMs, dirWord } from './wildfire.js';

const D = Math.PI / 180; const HOUR = 36e5;
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const HEIGHTS = [['on foot', 1.8], ['on a ridge', 60], ['from a helicopter', 450]];
/** Smoke is shown moving this many times faster than real time, so you can see which way it goes. */
export const SMOKE_SPEEDUP = 15;

/** Flame height in metres for a hot spot's fire radiative power (MW): a few metres for a smouldering pixel, up to
 *  about 30 m for the most intense fronts. A rough guide for the picture only (docs/ASSUMPTIONS.md, v2.39). */
export const flameM = (frp) => Math.max(3, Math.min(32, 4 + 6 * Math.log10(1 + frp)));

/** Burning (in the 12 hours before the last pass) and burnt hot spots in local metres around the fire's centre. */
export function fireCells(f) {
  const cut = f.last - 12 * HOUR;
  return f.rows.map((r) => { const [x, y] = toKm(f.lat, f.lng, r[0], r[1]); return { x: x * 1000, y: y * 1000, frp: r[2], burning: tMs(r) > cut, t: tMs(r) }; });
}

function softTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Mounts the view in `host`. Returns { dispose, ready, state } or null without WebGL. */
export function mountFireView(host, { fire: f, side = 180, wind = null }) {
  host.innerHTML = `<div class="fv"><canvas class="fv-canvas" aria-label="The fire seen from the ground"></canvas>
    <div class="fv-hud"><span class="fv-look"></span><span class="fv-note">Loading the ground around the fire…</span></div>
    <div class="fv-ctl row">
      <button class="btn ghost" data-fv="closer">Walk 250 m closer</button><button class="btn ghost" data-fv="back">Back off 250 m</button>
      <select data-fv-h aria-label="How high you stand">${HEIGHTS.map(([w, m], i) => `<option value="${i}">${w} (${fmt(m)} m)</option>`).join('')}</select>
      <button class="btn ghost" data-fv="full" aria-pressed="false">Full screen</button>
    </div></div>`;
  const canvas = host.querySelector('canvas'); const look = host.querySelector('.fv-look'); const note = host.querySelector('.fv-note');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { host.innerHTML = '<p class="muted">The view from the ground needs WebGL.</p>'; return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));

  const cells = fireCells(f);
  const cut = f.last - 12 * HOUR; const active = f.rows.filter((r) => tMs(r) > cut);
  const vp = viewpoint(f, side, 1.5, active.length ? active : f.rows); // stand off the part that is burning now
  const [cx, cy] = toKm(f.lat, f.lng, vp.centre[0], vp.centre[1]).map((v) => v * 1000); // its centre in the scene's metres
  const R = Math.max(3000, Math.min(9000, (radiusKm(f) + 3.5) * 1000));
  // the light and the sky for the time and place, with smoke haze
  const now = new Date(); const el = solarElevation(vp.lat, vp.lng, now); const sub = subsolarPoint(now); const az = bearingDeg(vp.lat, vp.lng, sub.lat, sub.lng);
  const day = el > 6 ? 1 : el > -6 ? (el + 6) / 12 : 0;
  const sky = new THREE.Color(0x0b1020).lerp(new THREE.Color(0xa8a08e), day);
  const scene = new THREE.Scene(); scene.background = sky; scene.fog = new THREE.Fog(sky, R * 0.35, R * 1.9);
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 1, R * 4); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a3128, 0.35 + 1.6 * day));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.8 * day); sun.position.set(Math.sin(az * D) * Math.cos(el * D), Math.cos(az * D) * Math.cos(el * D), Math.max(0.05, Math.sin(el * D))); scene.add(sun);
  const mat = landscapeMaterial();

  // flames and glow: three point clouds (small, large flames and the glow), jittered every frame
  const burning = cells.filter((c) => c.burning).sort((a, b) => b.frp - a.frp).slice(0, 700);
  const flameTex = softTexture([[0, 'rgba(255,250,210,1)'], [0.25, 'rgba(255,190,70,0.95)'], [0.6, 'rgba(240,90,20,0.45)'], [1, 'rgba(160,30,0,0)']]);
  const glowTex = softTexture([[0, 'rgba(255,140,40,0.55)'], [0.5, 'rgba(255,80,20,0.18)'], [1, 'rgba(255,60,0,0)']]);
  const smokeTex = softTexture([[0, 'rgba(120,112,104,0.55)'], [0.6, 'rgba(110,104,98,0.22)'], [1, 'rgba(100,96,92,0)']]);
  const flames = []; // { x, y, h, phase, cloud, i }
  const clouds = [[18, flameTex, 1, THREE.AdditiveBlending], [42, flameTex, 0.85, THREE.AdditiveBlending], [340, glowTex, 0.8, THREE.AdditiveBlending]].map(([size, map, opacity, blending]) => {
    const g = new THREE.BufferGeometry(); const m = new THREE.PointsMaterial({ size, map, transparent: true, opacity, blending, depthWrite: false, sizeAttenuation: true, fog: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); return { g, pts, list: [] };
  });
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (const c of burning) {
    const n = Math.round(3 + Math.min(9, c.frp / 8));
    for (let k = 0; k < n; k++) { const fl = { x: c.x + (rnd() - 0.5) * 360, y: c.y + (rnd() - 0.5) * 360, h: flameM(c.frp) * (0.5 + rnd() * 0.7), phase: rnd() * 6.28 }; clouds[k % 3 === 0 ? 1 : 0].list.push(fl); }
    clouds[2].list.push({ x: c.x, y: c.y, h: 30, phase: rnd() * 6.28 });
  }
  for (const cl of clouds) cl.g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cl.list.length * 3), 3));

  // smoke: particles born over the burning cells, rising and drifting downwind
  const toward = wind ? (wind.from + 180) % 360 : 45; const ms = wind ? Math.max(1, wind.speed / 3.6) : 3;
  const drift = [Math.sin(toward * D) * ms, Math.cos(toward * D) * ms];
  const SMOKE = burning.length ? Math.min(1400, 200 + burning.length * 6) : 0;
  const smoke = new Float32Array(SMOKE * 3); const sAge = new Float32Array(SMOKE); const sOrig = [];
  const sCol = new Float32Array(SMOKE * 3);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(smoke, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const litC = new THREE.Color(0xb0583a).lerp(new THREE.Color(0xb8aa98), day); const topC = new THREE.Color(0x3a3634).lerp(new THREE.Color(0xd2cbc2), day); const tc = new THREE.Color();
  const sm = new THREE.PointsMaterial({ size: 420, map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5 + 0.25 * day, vertexColors: true, sizeAttenuation: true }); // the bottom of the plume lit by the flames, greyer higher up
  const smokePts = new THREE.Points(sg, sm); smokePts.frustumCulled = false; scene.add(smokePts);
  const LIFE = 1800; // seconds of real time a puff is followed, up to about 2–3 km high
  for (let i = 0; i < SMOKE; i++) { sOrig.push(burning[i % burning.length]); sAge[i] = rnd() * LIFE; }

  let land = null; let elevAt = () => 0;
  const st = { yaw: vp.facing, pitch: 2, fov: 40, hi: 0, dist: vp.distKm * 1000, side, x: 0, y: 0 };
  const place = () => { const ux = Math.sin(side * D); const uy = Math.cos(side * D); st.x = cx + ux * st.dist; st.y = cy + uy * st.dist; };
  place();
  let raf = 0; let last = performance.now(); let drag = null; let clock = 0;
  const size = () => { const w = canvas.clientWidth || 320; const h = canvas.clientHeight || Math.round(w * 0.6); if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } };
  function hud() {
    const edge = Math.max(0, st.dist - vp.reachKm * 1000);
    look.textContent = `Looking ${dirWord(st.yaw)} · ${fmt(edge / 1000, 1)} km from the burning edge · ${HEIGHTS[st.hi][0]}`;
  }
  function frame(now) {
    if (!renderer) return;
    if (!host.isConnected || !canvas.isConnected) { dispose(); return; } // the fire page was closed
    size();
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    const gz = elevAt(st.x, st.y) + HEIGHTS[st.hi][1];
    cam.position.set(st.x, st.y, gz); cam.fov = st.fov; cam.updateProjectionMatrix();
    const cp = Math.cos(st.pitch * D);
    cam.lookAt(st.x + Math.sin(st.yaw * D) * cp * 100, st.y + Math.cos(st.yaw * D) * cp * 100, gz + Math.sin(st.pitch * D) * 100);
    for (const [ci, cl] of clouds.entries()) {
      const a = cl.g.attributes.position.array;
      cl.list.forEach((fl, i) => {
        const flick = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * (ci === 2 ? 1.3 : 7) + fl.phase);
        a[i * 3] = fl.x; a[i * 3 + 1] = fl.y; a[i * 3 + 2] = elevAt(fl.x, fl.y) + (ci === 2 ? 20 : fl.h * (0.35 + 0.4 * flick));
      });
      cl.g.attributes.position.needsUpdate = true;
    }
    for (let i = 0; i < SMOKE; i++) {
      if (!reduceMotion) sAge[i] += dt * SMOKE_SPEEDUP; if (sAge[i] > LIFE) sAge[i] -= LIFE;
      const o = sOrig[i]; const s = sAge[i]; const rise = Math.min(2600, 6 * s * (1 - s / (LIFE * 2.2)));
      smoke[i * 3] = o.x + drift[0] * s + Math.sin(i) * s * 0.08; smoke[i * 3 + 1] = o.y + drift[1] * s + Math.cos(i * 1.7) * s * 0.08; smoke[i * 3 + 2] = elevAt(o.x, o.y) + 30 + rise;
      tc.copy(litC).lerp(topC, Math.min(1, rise / 900)).toArray(sCol, i * 3);
    }
    sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
    renderer.render(scene, cam);
  }
  function loop(now) { raf = 0; frame(now); if (renderer) raf = requestAnimationFrame(loop); }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; st.yaw = (drag.yaw - (e.clientX - drag.x) * 0.15 * st.fov / 50 + 360) % 360; st.pitch = Math.max(-40, Math.min(60, drag.pitch + (e.clientY - drag.y) * 0.12)); hud(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.fov = Math.max(8, Math.min(75, st.fov * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  const onCtl = (e) => {
    const b = e.target.closest('[data-fv]'); if (!b) return; const k = b.dataset.fv;
    if (k === 'closer') { st.dist = Math.max(vp.reachKm * 1000 + 150, st.dist - 250); place(); }
    if (k === 'back') { st.dist = Math.min(R * 0.9, st.dist + 250); place(); }
    if (k === 'full') full(!overlay);
    hud();
  };
  // Full screen: the view moves into an overlay on the page itself (the details panel's blur would trap a fixed element)
  const box = host.querySelector('.fv'); let overlay = null;
  function full(on) {
    const b = box.querySelector('[data-fv="full"]');
    if (on && !overlay) { overlay = document.createElement('div'); overlay.className = 'fv-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'The fire seen from the ground'); document.body.append(overlay); overlay.append(box); overlay.addEventListener('click', onCtl); }
    else if (!on && overlay) { host.append(box); overlay.remove(); overlay = null; }
    b.setAttribute('aria-pressed', String(!!overlay)); b.textContent = overlay ? 'Close full screen' : 'Full screen';
  }
  const onKey = (e) => { if (e.key === 'Escape' && overlay) { e.stopPropagation(); full(false); } };
  document.addEventListener('keydown', onKey, true);
  host.addEventListener('click', onCtl);
  host.querySelector('[data-fv-h]').addEventListener('change', (e) => { st.hi = +e.target.value; st.pitch = st.hi ? -Math.atan2(HEIGHTS[st.hi][1], st.dist) / D * 0.8 : 3; hud(); });
  hud();

  const ready = buildLandscape(f.lat, f.lng, { radiusM: R, buildingsM: 0, material: mat }).then((l) => {
    if (!renderer) { disposeLandscape(l.group); return l; }
    land = l; elevAt = l.elevAt; scene.add(l.group);
    // darken the ground the fire has burnt, and redden it where it is burning now
    const mesh = l.group.getObjectByName('terrain'); const pos = mesh.geometry.attributes.position; const col = mesh.geometry.attributes.color;
    const grid = new Map(); const key = (x, y) => `${Math.round(x / 375)}:${Math.round(y / 375)}`;
    for (const c of cells) { const k = key(c.x, c.y); const o = grid.get(k); if (!o || c.t > o.t) grid.set(k, c); }
    const charC = new THREE.Color(0x1d1a18); const emberC = new THREE.Color(0x4a1a0c); const tmp = new THREE.Color(); let burnt = 0;
    for (let i = 0; i < pos.count; i++) {
      const c = grid.get(key(pos.getX(i), pos.getY(i))); if (!c) continue;
      tmp.fromArray(col.array, i * 3).lerp(c.burning ? emberC : charC, 0.85).toArray(col.array, i * 3); burnt += 1;
    }
    col.needsUpdate = true;
    const lastTxt = new Date(f.last).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23' });
    note.textContent = `${burning.length ? `${burning.length} pixels burning in the 12 hours before the last pass (${lastTxt} UTC)` : 'No pixels burning in the 12 hours before the last pass: only the burnt ground is shown'}; burnt ground darkened. ${wind ? `Smoke drifts ${dirWord(toward)} with the wind at ${fmt(wind.speed)} km/h,` : 'No wind data: smoke drifts north-east as a placeholder,'} shown ${SMOKE_SPEEDUP} times faster than real. Terrain from Terrain Tiles; flames and smoke are drawn from the satellite data, not photographs.${l.notes.length ? ` ${l.notes.join(' ')}` : ''}`;
    st.burntVertices = burnt;
    return l;
  }).catch((e) => { note.textContent = `The ground did not load (${e.message}).`; return null; });
  raf = requestAnimationFrame(loop);
  function dispose() {
    cancelAnimationFrame(raf); raf = 0; host.removeEventListener('click', onCtl); document.removeEventListener('keydown', onKey, true); overlay?.remove(); overlay = null;
    if (land) disposeLandscape(land.group); land = null;
    for (const cl of clouds) { cl.g.dispose(); cl.pts.material.dispose(); } sg.dispose(); sm.dispose(); flameTex.dispose(); glowTex.dispose(); smokeTex.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; }
  }
  return { dispose, ready, state: st, counts: () => ({ flames: clouds[0].list.length + clouds[1].list.length, glows: clouds[2].list.length, smoke: SMOKE }), info: () => renderer?.info.render };
}
