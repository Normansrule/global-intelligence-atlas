// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: ship wakes in ONE draw call, animated on the GPU.
// Every moving ship trails the V of a Kelvin wake: two arms at 19.47° either side of its track (the angle is
// the same for every ship at every speed, a result of how deep-water waves spread) and a band of churned water
// straight behind it. Each wake is one instance of a small strip mesh; the vertex shader opens the arms along the
// ship's course and the fragment shader runs ripples down them from the time uniform. The wake's length grows
// with the ship's speed and follows the camera height, so it reads the same on screen at every zoom.
import { THREE } from '../vendor/vendor.min.mjs';

const KELVIN = 19.47 * Math.PI / 180;
const SEG = 8;
const VERT = `
attribute vec3 st; // s: 0 at the stern to 1 at the end; t: −1 or +1 across the strip; arm: −1 left, 0 centre, +1 right
attribute vec3 iPos; attribute vec3 iDir; attribute vec3 iSide; attribute float iSpd;
uniform float uScale; uniform float uTan;
varying float vS; varying float vArm;
void main() {
  float s = st.x; float arm = st.z;
  float len = uScale * (0.7 + iSpd * 0.12) * (arm == 0.0 ? 0.55 : 1.0);
  vec3 along = -iDir * s * len + iSide * (arm * uTan * s * len);
  float w = uScale * (arm == 0.0 ? 0.06 + 0.05 * s : 0.025);
  vec3 p = iPos + along + iSide * (st.y * w);
  vS = s; vArm = arm;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = `
uniform float uTime; uniform float uAlpha;
varying float vS; varying float vArm;
void main() {
  float fade = pow(1.0 - vS, 1.4) * smoothstep(0.0, 0.06, vS);
  float ripple = vArm == 0.0 ? 0.75 : 0.55 + 0.45 * sin(vS * 26.0 - uTime * 3.2); // crests running back down the arms
  float a = fade * ripple * uAlpha * (vArm == 0.0 ? 0.7 : 1.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.86, 0.94, 1.0, a);
}`;

const D2R = Math.PI / 180;
export function createWakes(R = 100, MAX = 30000) {
  const geo = new THREE.InstancedBufferGeometry();
  const st = []; const idx = []; let base = 0;
  for (const arm of [-1, 0, 1]) {
    for (let i = 0; i <= SEG; i++) { st.push(i / SEG, -1, arm, i / SEG, 1, arm); if (i < SEG) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } }
    base += (SEG + 1) * 2;
  }
  geo.setAttribute('st', new THREE.Float32BufferAttribute(st, 3)); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(base * 3), 3)); // three.js counts vertices by it; unused
  for (const [k, n] of [['iPos', 3], ['iDir', 3], ['iSide', 3], ['iSpd', 1]]) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = 0;
  const uTime = { value: 0 }; const uScale = { value: 1 }; const t0 = performance.now();
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime, uScale, uTan: { value: Math.tan(KELVIN) }, uAlpha: { value: 0.5 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const obj = new THREE.Mesh(geo, mat);
  obj.frustumCulled = false; obj.raycast = () => {}; obj.renderOrder = 3;
  obj.onBeforeRender = (renderer, scene, camera) => {
    uTime.value = (performance.now() - t0) / 1000;
    const alt = Math.max(0.00002, camera.position.length() / R - 1);
    uScale.value = Math.min(4, alt * R * 0.022); // about 25 px for a slow ship, whatever the zoom
  };
  let last = null;
  return {
    wrap: { obj },
    count: () => geo.instanceCount,
    /** ships: [{lat, lng, sog (knots), cog (degrees)}]; only ships under way with a known course get a wake */
    set(ships) {
      if (ships === last) return; last = ships;
      const A = geo.attributes; let n = 0;
      for (const s of ships) {
        if (n >= MAX) break;
        const sog = s.sog; const cog = s.cog;
        if (!(sog >= 0.5 && sog < 102.3) || !(cog >= 0 && cog < 360)) continue; // 102.3 kn and 360° mean "not available" in AIS
        const phi = (90 - s.lat) * D2R; const th = (90 - s.lng) * D2R;
        const sp = Math.sin(phi); const cp = Math.cos(phi); const st_ = Math.sin(th); const ct = Math.cos(th);
        const ux = sp * ct; const uy = cp; const uz = sp * st_; // up
        const ex = st_; const ez = -ct; // east
        const nx = -cp * ct; const ny = sp; const nz = -cp * st_; // north
        const h = cog * D2R; const ch = Math.cos(h); const sh = Math.sin(h);
        const dx = nx * ch + ex * sh; const dy = ny * ch; const dz = nz * ch + ez * sh; // course over ground
        const rr = R * 1.0006;
        A.iPos.array.set([ux * rr, uy * rr, uz * rr], n * 3); A.iDir.array.set([dx, dy, dz], n * 3);
        A.iSide.array.set([dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux], n * 3); A.iSpd.array[n] = Math.min(sog, 30);
        n++;
      }
      geo.instanceCount = n; obj.visible = n > 0;
      for (const k of ['iPos', 'iDir', 'iSide', 'iSpd']) { const a = A[k]; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, Math.max(a.itemSize, n * a.itemSize)); a.needsUpdate = true; }
    },
  };
}

let shared = null;
/** The one wake object the ship layer uses. */
export const shipWakes = () => (shared ??= createWakes());
/** Compile the wake shader in the background at start-up, so switching ships on does not stall. */
export function warmWakes(globe) {
  const w = shipWakes(); const renderer = globe.renderer(); const scene = globe.scene();
  if (w.wrap.obj.parent) return;
  const vis = w.wrap.obj.visible; w.wrap.obj.visible = true; scene.add(w.wrap.obj);
  const done = () => { if (w.wrap.obj.parent === scene) scene.remove(w.wrap.obj); w.wrap.obj.visible = vis; };
  try { (renderer.compileAsync ? renderer.compileAsync(scene, globe.camera()) : Promise.resolve(renderer.compile(scene, globe.camera()))).then(done, done); } catch { done(); }
}
