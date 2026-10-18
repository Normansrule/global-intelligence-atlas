// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: pulsing rings in ONE draw call, animated on the GPU.
// globe.gl draws every ring as its own line object and rebuilds its geometry each frame on the CPU; with
// dozens of recent earthquakes that was dozens of draw calls plus constant JavaScript work. Here every
// ring is one instance of a flat square lying on the globe, and the fragment shader draws expanding,
// fading circles from the time uniform.
import { THREE } from '../vendor/vendor.min.mjs';

const VERT = `
attribute vec3 iPos; attribute vec3 iE; attribute vec3 iN; attribute vec3 iColor; attribute vec3 iAnim; // maxR (world), speed (world/s), period (s)
uniform float uScale; // follows the camera height, so rings keep the same size on screen (like markers)
varying vec2 vUv; varying vec3 vColor; varying vec3 vAnim;
void main() {
  vUv = position.xy; vColor = iColor; vAnim = iAnim;
  vec3 p = iPos * (1.0 + 0.0018 * uScale) + (iE * position.x + iN * position.y) * iAnim.x * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = `
uniform float uTime;
varying vec2 vUv; varying vec3 vColor; varying vec3 vAnim;
void main() {
  float r = length(vUv);               // 0 at the centre, 1 at maxR
  if (r > 1.0) discard;
  float grow = vAnim.y / vAnim.x;      // fraction of maxR per second
  float a = 0.0;
  float base = mod(uTime, vAnim.z);   // a new ring starts every period; up to four are on screen at once
  for (int k = 0; k < 4; k++) {
    float rr = (base + float(k) * vAnim.z) * grow;
    if (rr > 1.0) continue;
    float w = 0.045 + 0.02 * rr;
    float ring = smoothstep(w, 0.0, abs(r - rr));
    a = max(a, ring * (1.0 - rr));
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * 0.95);
}`;

const D2R = Math.PI / 180;
export function createPulses(R = 100) {
  const MAX = 4000;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
  for (const [k, n] of [['iPos', 3], ['iE', 3], ['iN', 3], ['iColor', 3], ['iAnim', 3]]) geo.setAttribute(k, attr(n));
  geo.instanceCount = 0;
  const uTime = { value: 0 }; const uScale = { value: 1 }; const t0 = performance.now();
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime, uScale }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const obj = new THREE.Mesh(geo, mat);
  obj.frustumCulled = false; obj.raycast = () => {}; obj.renderOrder = 3;
  obj.onBeforeRender = () => { uTime.value = (performance.now() - t0) / 1000; };
  const c = new THREE.Color(); let last = null;
  return {
    wrap: { obj },
    /** Ring sizes are given for the default view; k shrinks them as the camera comes down (main.js zk()). */
    setScale(k) { uScale.value = k; },
    /** rings: [{lat, lng, color, maxR (degrees), speed (degrees/s), period (ms)}] */
    set(rings) {
      if (rings === last) return; last = rings;
      const n = Math.min(MAX, rings.length); const A = geo.attributes;
      for (let i = 0; i < n; i++) {
        const g = rings[i]; const alt = 0;
        const phi = (90 - g.lat) * D2R; const th = (90 - g.lng) * D2R; const rr = R * (1 + alt);
        const sp = Math.sin(phi); const cp = Math.cos(phi); const st = Math.sin(th); const ct = Math.cos(th);
        A.iPos.array.set([sp * ct * rr, cp * rr, sp * st * rr], i * 3);
        A.iE.array.set([st, 0, -ct], i * 3);
        A.iN.array.set([-cp * ct, sp, -cp * st], i * 3);
        c.set(typeof g.color === 'string' ? g.color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : '#ffffff');
        A.iColor.array.set([c.r, c.g, c.b], i * 3);
        const maxR = (g.maxR ?? 2) * D2R * R; // degrees of arc → world units
        A.iAnim.array.set([maxR, (g.speed ?? 1) * D2R * R, Math.max(0.2, (g.period ?? 1000) / 1000)], i * 3);
      }
      geo.instanceCount = n;
      for (const k of ['iPos', 'iE', 'iN', 'iColor', 'iAnim']) { const a = A[k]; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, Math.max(3, n * 3)); a.needsUpdate = true; }
    },
  };
}
