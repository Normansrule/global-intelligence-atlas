// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — navigation that behaves like a web map.
// OrbitControls turn and zoom around the Earth's centre, so by default a drag near the ground swings you
// hundreds of kilometres and one wheel notch dives straight into the surface. Here both are re-tuned on every
// camera move: dragging covers about one screen-width of ground whatever the zoom, and each wheel notch
// changes your height by a fixed fraction (about a quarter), from orbit down to street level in roughly 30
// notches. The wheel zooms towards the point under the cursor, like a web map, and eases smoothly.
export function installNavigation({ globe, R, $, reduceMotion, onLocate }) {
  const controls = globe.controls();
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.minDistance = R * 1.00008; controls.maxDistance = R * 14;
  const lnGain = Math.log(0.95);
  const MIN_ALT = 0.00009; // ≈ 570 m above the ground

  function tune(alt) {
    controls.rotateSpeed = Math.max(0.00002, Math.min(0.9, alt * 0.16));
    const s = (1 + 0.85 * alt) / (1 + alt); // wanted distance ratio for one wheel notch
    controls.zoomSpeed = Math.max(0.00005, Math.min(3, Math.log(s) / lnGain));
    const cam = globe.camera(); const near = Math.max(0.0015, Math.min(1, alt * R * 0.04));
    if (Math.abs(cam.near - near) / near > 0.25) { cam.near = near; cam.updateProjectionMatrix(); }
    scaleBar(alt);
  }

  // Google-Maps-style scale bar
  function scaleBar(alt) {
    const el = $('#scalebar'); if (!el) return;
    const fov = (globe.camera().fov * Math.PI) / 180; const hKm = alt * 6371;
    const viewKm = Math.min(2 * hKm * Math.tan(fov / 2), Math.PI * 6371);
    const kmPerPx = viewKm / (document.getElementById('globe')?.clientHeight || innerHeight);
    const target = kmPerPx * 110; const pow = 10 ** Math.floor(Math.log10(target));
    const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() ?? pow;
    el.querySelector('i').style.width = `${Math.round(nice / kmPerPx)}px`;
    el.querySelector('span').textContent = nice >= 1 ? `${nice.toLocaleString()} km` : `${Math.round(nice * 1000)} m`;
  }

  const zoomBy = (f) => { const p = globe.pointOfView(); globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: Math.min(13, Math.max(MIN_ALT, p.altitude * f)) }, reduceMotion ? 0 : 350); };
  $('#zin').addEventListener('click', () => zoomBy(0.5));
  $('#zout').addEventListener('click', () => zoomBy(2));
  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('#locate').setAttribute('aria-busy', 'true');
    navigator.geolocation.getCurrentPosition((p) => { $('#locate').removeAttribute('aria-busy'); onLocate(p.coords.latitude, p.coords.longitude); },
      () => $('#locate').removeAttribute('aria-busy'), { enableHighAccuracy: false, timeout: 10000 });
  });

  // Double-click zooms in on that spot (Shift + double-click zooms out), like a web map.
  $('#globe').addEventListener('dblclick', (e) => {
    const c = globe.toGlobeCoords(e.offsetX, e.offsetY); const p = globe.pointOfView();
    if (!c) return;
    const f = e.shiftKey ? 3 : 0.22;
    goal = null; globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: Math.min(13, Math.max(MIN_ALT, p.altitude * f)) }, reduceMotion ? 0 : 650);
  });

  // Wheel and trackpad pinch: our own handler, zooming towards the cursor. It runs in the capture phase on the
  // globe's container so OrbitControls (which only zooms towards the centre) never sees the event.
  let goal = null; let raf = 0;
  const wrapLng = (d) => ((d + 540) % 360) - 180;
  function step() {
    raf = 0; if (!goal) return;
    const p = globe.pointOfView(); const k = reduceMotion ? 1 : 0.32;
    const la = Math.log(p.altitude); const lg = Math.log(goal.altitude);
    const n = { lat: p.lat + (goal.lat - p.lat) * k, lng: p.lng + wrapLng(goal.lng - p.lng) * k, altitude: Math.exp(la + (lg - la) * k) };
    const done = Math.abs(lg - la) < 0.004 && Math.abs(goal.lat - p.lat) < 1e-5 && Math.abs(wrapLng(goal.lng - p.lng)) < 1e-5;
    globe.pointOfView(done ? goal : n, 0);
    if (done) goal = null; else raf = requestAnimationFrame(step);
  }
  const host = document.getElementById('globe');
  host.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey) dy *= 3; // trackpad pinch sends small steps
    dy = Math.max(-240, Math.min(240, dy));
    const from = goal ?? globe.pointOfView();
    const alt = Math.min(13, Math.max(MIN_ALT, from.altitude * Math.exp(dy * 0.0029))); // 100 px ≈ 25 % closer
    const f = alt / from.altitude; let { lat, lng } = from;
    // keep the point under the cursor where it is (only meaningful once the globe fills the screen)
    const w = Math.max(0, Math.min(1, (1.6 - from.altitude) / 1.2));
    const r = host.getBoundingClientRect(); const c = w > 0 ? globe.toGlobeCoords(e.clientX - r.left, e.clientY - r.top) : null;
    if (c) {
      lat = Math.max(-85, Math.min(85, lat + (c.lat - lat) * (1 - f) * w));
      lng = wrapLng(lng + wrapLng(c.lng - lng) * (1 - f) * w);
    }
    goal = { lat, lng, altitude: alt };
    if (!raf) raf = requestAnimationFrame(step);
  }, { capture: true, passive: false });
  // a drag or a fly-to cancels any wheel easing still running
  host.addEventListener('pointerdown', () => { goal = null; }, { capture: true });

  // Keyboard: arrows pan by a quarter screen, + and − zoom.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const p = globe.pointOfView(); const step = Math.max(0.0005, Math.min(40, p.altitude * 14));
    const mv = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[e.key];
    if (mv) { e.preventDefault(); globe.pointOfView({ lat: Math.max(-89, Math.min(89, p.lat + mv[0])), lng: p.lng + mv[1] / Math.max(0.2, Math.cos(p.lat * Math.PI / 180)), altitude: p.altitude }, 250); }
    if (e.key === '+' || e.key === '=') zoomBy(0.6);
    if (e.key === '-' || e.key === '_') zoomBy(1.6);
  });
  /** Fly straight down to a spot: 'street' (≈1.5 km up), 'area' (≈25 km) or a globe altitude. */
  function zoomTo(lat, lng, level = 'street') {
    goal = null;
    const altitude = level === 'street' ? 0.00024 : level === 'area' ? 0.004 : Number(level);
    globe.pointOfView({ lat, lng, altitude: Math.max(MIN_ALT, altitude) }, reduceMotion ? 0 : 1600);
  }
  return { tune, zoomBy, zoomTo, cancel: () => { goal = null; } };
}
