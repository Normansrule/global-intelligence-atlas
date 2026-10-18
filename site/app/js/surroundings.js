// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: "3D surroundings", a small 3D view of the real landscape around a point (terrain and
// OpenStreetMap buildings, see landscape.js), used in camera cards. A gold pin marks the point. Drag to turn it;
// otherwise it turns slowly (not at all when the system asks for reduced motion).
import { THREE } from '../vendor/vendor.min.mjs';
import { buildLandscape, disposeLandscape, landscapeMaterial } from './landscape.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Mounts the view in `host`. Returns { dispose, ready: Promise<landscape> } or null without WebGL. */
export function mountSurroundings(host, { lat, lng, label = 'This place', radiusM = 1200, buildingsM = 600 }) {
  host.innerHTML = `<div class="sv"><canvas class="sv-canvas" aria-label="3D view of the landscape around ${esc(label)}"></canvas><p class="sv-note muted">Loading the terrain and buildings around ${esc(label)}…</p></div>`;
  const canvas = host.querySelector('canvas'); const note = host.querySelector('.sv-note');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { host.innerHTML = '<p class="muted">The 3D view needs WebGL.</p>'; return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9cc4e8); scene.fog = new THREE.Fog(0x9cc4e8, radiusM * 0.9, radiusM * 2.2);
  const cam = new THREE.PerspectiveCamera(45, 2, 1, radiusM * 6); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4136, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(0.5, -0.4, 1); scene.add(sun);
  const mat = landscapeMaterial();
  const pin = new THREE.Group();
  { const m = new THREE.MeshBasicMaterial({ color: 0xffc94d, fog: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(6, 22, 16), m); cone.rotation.x = -Math.PI / 2; cone.position.z = 11; pin.add(cone);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), m); ball.position.z = 28; pin.add(ball); }
  scene.add(pin);
  { const warm = new THREE.Mesh(new THREE.BufferGeometry(), mat); scene.add(warm); renderer.compileAsync?.(scene, cam).catch(() => {}).finally(() => warm.removeFromParent()); } // compile now, not on first frame
  let land = null; let ang = -Math.PI / 2; let tilt = 0.55; let dist = radiusM * 0.75; let raf = 0; let last = performance.now(); let drag = null;
  const size = () => { const w = canvas.clientWidth || 300; const h = Math.round(w * 0.62); if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } };
  function draw(now) {
    if (!renderer) return;
    if (!host.isConnected || !canvas.isConnected) { dispose(); return; }
    size();
    if (!drag && !reduceMotion) ang += ((now - last) / 1000) * 0.12;
    last = now;
    const z0 = land ? 0 : 0; const r = dist * Math.cos(tilt);
    cam.position.set(Math.cos(ang) * r, Math.sin(ang) * r, z0 + dist * Math.sin(tilt) + 20); cam.lookAt(0, 0, z0 + 15);
    renderer.render(scene, cam);
  }
  function loop(now) { raf = 0; draw(now); if (renderer && (!reduceMotion || drag)) raf = requestAnimationFrame(loop); }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, a: ang, t: tilt }; canvas.setPointerCapture(e.pointerId); if (!raf) raf = requestAnimationFrame(loop); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; ang = drag.a - (e.clientX - drag.x) * 0.01; tilt = Math.max(0.12, Math.min(1.35, drag.t + (e.clientY - drag.y) * 0.006)); if (reduceMotion) draw(performance.now()); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(120, Math.min(radiusM * 1.6, dist * (e.deltaY > 0 ? 1.12 : 0.9))); if (reduceMotion) draw(performance.now()); }, { passive: false });
  const ready = buildLandscape(lat, lng, { radiusM, buildingsM, material: mat }).then((l) => {
    if (!renderer) { disposeLandscape(l.group); return l; }
    land = l; scene.add(l.group); pin.position.z = 0;
    const b = l.buildings;
    note.textContent = `${Math.round(l.ground)} m above sea level${b ? ` · ${b.count.toLocaleString()} buildings within ${buildingsM} m${b.tallest?.h >= 20 ? `, the tallest ${Math.round(b.tallest.h)} m${b.tallest.name ? ` (${b.tallest.name})` : ''}` : ''}` : ''} · terrain from Terrain Tiles, buildings from OpenStreetMap. Drag to turn, scroll to zoom.${l.notes.length ? ` ${l.notes.join(' ')}` : ''}`;
    draw(performance.now());
    return l;
  }).catch((e) => { note.textContent = `The landscape did not load (${e.message}).`; return null; });
  raf = requestAnimationFrame(loop);
  function dispose() { cancelAnimationFrame(raf); raf = 0; if (land) disposeLandscape(land.group); land = null; if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; } }
  return { dispose, ready, info: () => renderer?.info.render };
}

let current = null;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-surround]'); if (!b) return;
    const host = document.getElementById(b.dataset.surroundHost || 'surround-3d'); if (!host) return;
    const [lat, lng] = b.dataset.surround.split(',').map(Number);
    current?.dispose(); host.hidden = false; b.hidden = true;
    current = mountSurroundings(host, { lat, lng, label: b.dataset.surroundLabel || 'this place' });
    window.gia && (window.gia.surroundings = current);
  });
}
