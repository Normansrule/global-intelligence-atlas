// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: tilt (v2.19). Look across a city instead of straight down, as in a flight simulator or a
// 3D map. OrbitControls (inside globe.gl) only ever look at the Earth's centre, so the tilt is laid on top of them: on
// every frame the camera is put back where the controls left it, the controls move it, and then it is swung about the
// point in the middle of the screen, down towards you, by the tilt angle. The distance to that point stays the same,
// so zoom and drag feel unchanged. Everything that asks "where am I looking?" (the address bar, the scale bar, the
// close-ups) still gets the straight-down answer; clicks and hovers use the tilted camera, so they hit what you see.
// The tilt fades out as you zoom out (none above about 1,600 km), so the whole globe never tips over.
// A sky dome (Rayleigh-blue by day, deep blue at dusk, dark at night) fills the space above the horizon.
// This file loads the first time you press the tilt button (or open a link with &t=), so it costs nothing at start-up.
import { THREE } from '../vendor/vendor.min.mjs';
import { subsolarPoint } from './astro.js';

const D2R = Math.PI / 180;
export const MAX_TILT = 75;
/** How much of the chosen tilt applies at an altitude (globe radii): all of it below 0.05 (about 320 km), none above 0.25. */
export const tiltFactor = (alt) => Math.max(0, Math.min(1, (0.25 - alt) / 0.2));
/** The largest tilt (degrees) that keeps the camera at least `minM` metres above the ground at distance `distM`. */
export const tiltLimit = (distM, minM = 250) => Math.min(MAX_TILT, Math.acos(Math.min(1, minM / Math.max(distM, minM))) / D2R);
/** Unit vector to a latitude and longitude in globe.gl's axes. */
const vec = (lat, lng) => { const phi = (90 - lat) * D2R; const th = (90 - lng) * D2R; return new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)); };

const SKY_VS = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SKY_FS = `uniform vec3 uCam; uniform vec3 uSun; uniform float uK; varying vec3 vW;
void main() {
  vec3 up = normalize(uCam); vec3 d = normalize(vW - uCam);
  float h = dot(d, up);                      // elevation of this direction above the local horizon (sine)
  float day = smoothstep(-0.12, 0.10, dot(up, uSun));
  float sunAz = max(0.0, dot(normalize(d - up * h), normalize(uSun - up * dot(uSun, up))));
  vec3 zenith = mix(vec3(0.02, 0.04, 0.10), vec3(0.20, 0.45, 0.85), day);
  vec3 horizon = mix(vec3(0.07, 0.10, 0.20), vec3(0.72, 0.84, 0.95), day);
  float dusk = day * (1.0 - day) * 4.0;      // warm band near the horizon at sunrise and sunset, towards the Sun
  horizon = mix(horizon, vec3(0.98, 0.62, 0.36), dusk * pow(sunAz, 3.0) * 0.8);
  vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
  float a = uK * smoothstep(-0.04, 0.02, h);  // only above the horizon; the Earth hides the rest anyway
  gl_FragColor = vec4(c, a);
}`;

/**
 * Installs tilt on a globe.gl globe of radius R. Returns { set(deg), get(), effective(), toggle(), dispose() }.
 * `onChange(deg)` is called when the chosen tilt changes (for the button and the address bar).
 */
export function installTilt(globe, { R = 100, onChange = () => {}, onFrame = () => {}, reduceMotion = false } = {}) {
  const controls = globe.controls(); const cam = globe.camera(); const scene = globe.scene();
  let want = 0; let cur = 0; let last = performance.now(); let lastK = -1;
  const base = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }; const tiltedPos = new THREE.Vector3(); let tilted = false;
  const S = new THREE.Vector3(); const right = new THREE.Vector3(); const off = new THREE.Vector3();

  // the sky: a shell just outside the camera, drawn only above the horizon, faded in with the tilt
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uK: { value: 0 } },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  sky.name = 'tilt-sky'; sky.frustumCulled = false; sky.renderOrder = -50; sky.visible = false; sky.raycast = () => {}; scene.add(sky);
  let sunAt = 0;

  function restore() {
    if (!tilted) return;
    if (cam.position.equals(tiltedPos)) cam.position.copy(base.pos); // otherwise something else (a fly-to) moved the camera: keep that
    cam.up.copy(base.up); tilted = false;
  }
  function apply() {
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    cur = reduceMotion ? want : cur + (want - cur) * Math.min(1, dt * 6); if (Math.abs(want - cur) < 0.05) cur = want;
    const dist = cam.position.length(); const alt = dist / R - 1;
    const deg = Math.min(cur * tiltFactor(alt), tiltLimit(alt * 6_371_000));
    sky.visible = deg > 0.5;
    const k = sky.visible ? Math.min(1, deg / 25) * Math.max(0, Math.min(1, (0.25 - alt) / 0.15)) : 0;
    if (k !== lastK) { lastK = k; onFrame(k); }
    if (deg <= 0.01) return;
    base.pos.copy(cam.position); base.up.copy(cam.up);
    S.copy(cam.position).setLength(R); // the point in the middle of the screen (the controls look at the centre)
    right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    off.copy(cam.position).sub(S).applyAxisAngle(right, deg * D2R);
    cam.position.copy(S).add(off); cam.up.copy(base.up).applyAxisAngle(right, deg * D2R); cam.lookAt(S); cam.updateMatrixWorld();
    tiltedPos.copy(cam.position); tilted = true;
    // the sky shell: centred on the Earth, a little larger than the camera's distance
    const r = cam.position.length() * 1.02 + 2; sky.scale.setScalar(r); sky.updateMatrixWorld();
    sky.material.uniforms.uCam.value.copy(cam.position); sky.material.uniforms.uK.value = k;
    if (now - sunAt > 5000) { sunAt = now; const s = subsolarPoint(new Date()); sky.material.uniforms.uSun.value.copy(vec(s.lat, s.lng)); }
  }
  const origUpdate = controls.update.bind(controls);
  controls.update = (...a) => { restore(); const r = origUpdate(...a); apply(); return r; };
  // "Where am I looking?" keeps the straight-down answer
  const origPov = globe.pointOfView.bind(globe);
  globe.pointOfView = (...a) => {
    if (a.length || !tilted) return origPov(...a);
    const keep = cam.position.clone(); const keepUp = cam.up.clone(); cam.position.copy(base.pos); cam.up.copy(base.up);
    try { return origPov(); } finally { cam.position.copy(keep); cam.up.copy(keepUp); }
  };

  const api = {
    set(deg) { const v = Math.max(0, Math.min(MAX_TILT, Number(deg) || 0)); if (v === want) return api; want = v; last = performance.now(); onChange(want); return api; },
    get: () => want,
    /** The tilt actually applied now (degrees), after fading with altitude and the height limit. */
    effective() { const alt = (tilted ? base.pos : cam.position).length() / R - 1; return tilted ? Math.min(cur * tiltFactor(alt), tiltLimit(alt * 6_371_000)) : 0; },
    toggle() { return api.set(want > 0 ? 0 : 60); },
    sky: () => ({ visible: sky.visible, k: sky.material.uniforms.uK.value }),
    dispose() { controls.update = origUpdate; globe.pointOfView = origPov; restore(); scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); },
  };
  return api;
}
