// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: what a plane looks like, close up and from the ground.
// A small 3D viewer inside the flight panel. "Close up" turns the aircraft's class model at its real size
// next to a 1.8 m person. "From the ground" puts you on the ground below, looking up at 60° to where the
// plane really is (its true height and size), with the Moon drawn at its true size for comparison.
// "Binoculars" is the same view magnified ten times. All sizes are real, which is the point: an airliner
// at cruise height is smaller in the sky than the Moon. "Street level" stands you in the real landscape (terrain and
// OpenStreetMap buildings, landscape.js) at the spot from which the plane is 30° above the horizon.
import { THREE } from '../vendor/vendor.min.mjs';
import { CLASSES, classOf, planeGeometry } from './planes3d.js';
import { solarElevation } from './astro.js';
import { buildLandscape, disposeLandscape, landscapeMaterial, toLatLng } from './landscape.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D2R = Math.PI / 180;
const MOON_DEG = 0.52;
const fmtDeg = (d) => (d >= 1 ? `${d.toFixed(1)}°` : d >= 0.1 ? `${d.toFixed(2)}°` : `${(d * 60).toFixed(1)} arcminutes`);

/** Geometry of the ground view: where the observer is relative to the plane, and how big it looks. */
export function groundView(a) {
  const c = CLASSES[classOf(a)];
  const onGround = a.ground || (a.altFt ?? 0) < 150;
  const hM = onGround ? 1.7 : (a.altFt ?? 0) / 3.281; // height above you
  const el = onGround ? 2 : 60; // degrees above the horizon you look up
  const slant = onGround ? 150 : hM / Math.sin(el * D2R);
  const size = Math.max(c.L, c.S); const deg = (2 * Math.atan(size / 2 / slant)) / D2R;
  const overhead = onGround ? deg : (2 * Math.atan(size / 2 / hM)) / D2R;
  return { cls: c, onGround, hM, el, slant, deg, overhead, armMm: 650 * Math.tan(deg * D2R) };
}

export function mountPlaneView(host, a) {
  if (!host) return null;
  host.innerHTML = `<div class="pv">
    <div class="pv-modes" role="radiogroup" aria-label="Aircraft view">
      <button role="radio" data-pv="close" aria-checked="true">Close up</button>
      <button role="radio" data-pv="ground" aria-checked="false">From the ground</button>
      <button role="radio" data-pv="bino" aria-checked="false">Binoculars 10×</button>
      <button role="radio" data-pv="street" aria-checked="false">Street level</button>
    </div>
    <canvas class="pv-canvas" aria-label="3D view of the aircraft"></canvas>
    <p class="pv-note muted"></p></div>`;
  const canvas = host.querySelector('canvas'); const note = host.querySelector('.pv-note');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); } catch { host.querySelector('.pv').innerHTML = '<p class="muted">The 3D aircraft view needs WebGL.</p>'; return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 2, 0.1, 30000); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4136, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.4, -0.6, 1); scene.add(sun);
  let mode = 'close'; let raf = 0; let t0 = performance.now(); let cls = null;
  const mat = new THREE.MeshLambertMaterial({ color: 0xe9eef3, flatShading: true, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(new THREE.BufferGeometry(), mat); scene.add(plane);
  // a 1.8 m person, and the ground, for "Close up"
  const person = new THREE.Group();
  { const m = new THREE.MeshLambertMaterial({ color: 0xffb36b });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.1, 10), m); body.rotation.x = Math.PI / 2; body.position.z = 0.95; person.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), m); head.position.z = 1.66; person.add(head);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.45, 8), m); legs.rotation.x = Math.PI / 2; legs.position.z = 0.22; person.add(legs); }
  scene.add(person);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshLambertMaterial({ color: 0x3d4a3c })); scene.add(ground);
  const grid = new THREE.GridHelper(200, 20, 0x5d6e5a, 0x4c5b4a); grid.rotation.x = Math.PI / 2; scene.add(grid);
  // the Moon at its true size, and a contrail for planes high enough to leave one
  const moon = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xf3f1e6 })); scene.add(moon);
  const trail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })); scene.add(trail);
  // street level: the landscape (loaded on first use), and a ring that keeps the far-off plane findable
  const landMat = landscapeMaterial(); const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffd37a, depthTest: false, transparent: true, fog: false }));
  ring.renderOrder = 10; ring.visible = false; scene.add(ring);
  mat.fog = false; moon.material.fog = false; trail.material.fog = false;
  let land = null; let landBusy = null; let landErr = '';
  { const warm = new THREE.Mesh(new THREE.BufferGeometry(), landMat); scene.add(warm); renderer.compileAsync?.(scene, cam).catch(() => {}).finally(() => warm.removeFromParent()); } // compile the landscape shader now, not on first use

  function skyColor() {
    const e = solarElevation(a.lat, a.lng, new Date());
    return e > 8 ? 0x7fb2e6 : e > 0 ? 0xc9a184 : e > -6 ? 0x41507a : 0x0b1530;
  }
  function setup() {
    const c = classOf(a);
    if (c !== cls) { cls = c; plane.geometry = planeGeometry(c, '3d'); const k = CLASSES[c].L / 2; plane.scale.setScalar(k); plane.geometry.computeBoundingBox(); }
    const C = CLASSES[c]; const k = C.L / 2; const bb = plane.geometry.boundingBox;
    host.querySelectorAll('[data-pv]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pv === mode)));
    const close = mode === 'close';
    person.visible = close; ground.visible = close; grid.visible = close; moon.visible = !close; trail.visible = false; ring.visible = false;
    if (land) land.group.visible = mode === 'street';
    scene.fog = null;
    const g = groundView(a);
    if (mode === 'street') { street(C, k, bb); cam.updateProjectionMatrix(); draw(performance.now()); return; }
    if (close) {
      scene.background = new THREE.Color(0x9cc4e8);
      plane.position.set(0, 0, -bb.min.z * k + 0.3); plane.rotation.set(0, 0, 0);
      person.position.set(C.S * 0.25 + 3, C.L * 0.2, 0);
      ground.position.z = 0; grid.position.z = 0.01;
      cam.fov = 40; cam.near = 0.1; cam.far = 3000;
      note.textContent = `${C.label}${a._clsHow === 'type' ? '' : ' (best guess from ' + (a._clsHow === 'category' ? 'its broadcast size category' : 'its speed and height') + ')'} · drawn as a typical ${C.eg}: ${C.L} m long, ${C.S} m ${c === 'heli' ? 'rotor' : 'wingspan'}. The orange figure is a 1.8 m person.`;
    } else {
      scene.background = new THREE.Color(skyColor());
      // observer at the origin; the plane due north at the chosen elevation, flying its real heading
      const d = g.slant; const el = g.el * D2R;
      plane.position.set(0, d * Math.cos(el), g.onGround ? 0 : d * Math.sin(el));
      if (g.onGround) plane.position.z = -bb.min.z * k - 1.7;
      plane.rotation.set(0, 0, -(a.trk ?? 0) * D2R);
      const dist = 2000; const off = 1.3 * D2R; const md = new THREE.Vector3(Math.sin(off) * Math.cos(el + 0.5 * off), Math.cos(off) * Math.cos(el + 0.5 * off), Math.sin(el + 0.5 * off));
      moon.position.copy(md.multiplyScalar(dist)); moon.scale.setScalar(dist * Math.tan((MOON_DEG / 2) * D2R)); moon.lookAt(0, 0, 0);
      moon.visible = !g.onGround;
      if (!g.onGround && a.altFt > 26000) { // a contrail stretching back along the track
        const len = 3000; const h = (a.trk ?? 0) * D2R; trail.visible = true;
        trail.scale.set(C.S * 0.12, len, C.S * 0.06); trail.rotation.set(0, 0, -h);
        trail.position.set(plane.position.x - Math.sin(h) * (len / 2 + C.L / 2), plane.position.y - Math.cos(h) * (len / 2 + C.L / 2), plane.position.z);
      }
      cam.position.set(0, 0, 0); cam.fov = mode === 'bino' ? 2 : 20; cam.near = 0.5; cam.far = 30000;
      cam.lookAt(plane.position);
      const moonTxt = g.deg >= MOON_DEG ? `${(g.deg / MOON_DEG).toFixed(1)} times as wide as the Moon` : `about 1/${Math.max(1, Math.round(MOON_DEG / g.deg))} of the Moon’s width`;
      note.textContent = g.onGround
        ? `Standing 150 m away, the ${C.label.toLowerCase()} spans ${fmtDeg(g.deg)} of your view.`
        : `${Math.round(a.altFt).toLocaleString()} ft up, seen ${g.el}° above the horizon (${(g.slant / 1000).toFixed(1)} km away), it spans ${fmtDeg(g.deg)}: ${moonTxt}, or a ${g.armMm < 1 ? 'grain of sand' : `${g.armMm.toFixed(1)} mm object`} held at arm’s length. Straight overhead it would span ${fmtDeg(g.overhead)}.${mode === 'bino' ? ' Binoculars magnify ten times (this frame is 2° tall).' : ' This frame shows a 20° patch of sky, about two fists at arm’s length.'} The white disc is the Moon at its true size.`;
    }
    cam.updateProjectionMatrix();
    draw(performance.now());
  }
  // Street level: you stand where the plane is 30° above the horizon to the north (150 m away if it is on the ground).
  function street(C, k, bb) {
    moon.visible = false; scene.background = new THREE.Color(skyColor());
    if (!land) {
      note.textContent = landErr || 'Loading the terrain and buildings around you…';
      if (!landBusy && !landErr) {
        const onGround = a.ground || (a.altFt ?? 0) < 150; const dh = onGround ? 150 : Math.max(200, ((a.altFt ?? 0) / 3.281) / Math.tan(30 * D2R));
        const [lat, lng] = toLatLng(a.lat, a.lng, 0, -dh);
        landBusy = buildLandscape(lat, lng, { radiusM: 2500, buildingsM: 800, material: landMat })
          .then((l) => { land = { ...l, lat, lng, dh, onGround }; scene.add(l.group); })
          .catch((e) => { landErr = `The landscape did not load (${e.message}).`; })
          .finally(() => { landBusy = null; if (mode === 'street' && renderer) setup(); });
      }
      return;
    }
    land.group.visible = true;
    const sky = scene.background.getHex(); scene.fog = new THREE.Fog(sky, 1200, 2600);
    const eye = 1.7; const altM = (a.altFt ?? 0) / 3.281;
    const above = land.onGround ? 0 : Math.max(30, altM - land.ground - eye); // height above your eyes, from the real ground here
    if (land.onGround) plane.position.set(0, land.dh, land.elevAt(0, land.dh) - bb.min.z * k);
    else plane.position.set(0, land.dh, eye + above);
    plane.rotation.set(0, 0, -(a.trk ?? 0) * D2R);
    const d = plane.position.length(); const el = Math.atan2(plane.position.z - eye, land.dh) / D2R;
    cam.position.set(0, 0, eye); cam.fov = 55; cam.near = 0.5; cam.far = 80000;
    const pitch = land.onGround ? 4 : Math.max(5, el - 14);
    cam.lookAt(0, 100, eye + 100 * Math.tan(pitch * D2R));
    ring.visible = !land.onGround; ring.position.copy(plane.position); ring.scale.setScalar(Math.max(C.L, d * Math.tan(1.1 * D2R))); ring.lookAt(cam.position);
    const b = land.buildings;
    const what = b?.count ? `${b.count.toLocaleString()} buildings from OpenStreetMap (${b.mapped + b.floors ? `${Math.round(((b.mapped + b.floors) / b.count) * 100)}% with mapped heights or floors` : 'typical heights'})` : 'no mapped buildings nearby';
    note.textContent = `${land.onGround ? `On the ground 150 m from the ${C.label.toLowerCase()}` : `${Math.round(above).toLocaleString()} m above the ground here, ${el.toFixed(0)}° up and ${(d / 1000).toFixed(1)} km away (the gold ring marks it)`}. Ground ${Math.round(land.ground)} m above sea level · terrain from Terrain Tiles · ${what}.${land.notes.length ? ` ${land.notes.join(' ')}` : ''}`;
  }
  function size() {
    const w = canvas.clientWidth || 300; const h = Math.round(w * 0.6);
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }
  function draw(now) {
    if (!renderer) return;
    if (!host.isConnected || !canvas.isConnected) { dispose(); return; }
    size();
    if (mode === 'close') {
      const C = CLASSES[cls]; const r = Math.max(C.L, C.S) * 1.15; const ang = reduceMotion ? 0.8 : 0.8 + ((now - t0) / 1000) * 0.25;
      cam.position.set(Math.cos(ang) * r, Math.sin(ang) * r, r * 0.42); cam.lookAt(0, 0, plane.position.z * 0.7);
    }
    renderer.render(scene, cam);
  }
  function loop(now) { raf = 0; if (document.hidden) { raf = requestAnimationFrame(loop); return; } draw(now); if (mode === 'close' && !reduceMotion && renderer) raf = requestAnimationFrame(loop); }
  function dispose() { cancelAnimationFrame(raf); raf = 0; if (land) { disposeLandscape(land.group); land = null; } if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; } }
  host.querySelector('.pv-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pv]'); if (!b) return;
    mode = b.dataset.pv; setup(); if (!raf && mode === 'close') raf = requestAnimationFrame(loop);
  });
  setup(); raf = requestAnimationFrame(loop);
  return {
    /** Call when the class or the numbers change (new type from the registry, a new position). */
    update() { if (renderer) setup(); },
    dispose,
  };
}
