// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Moon, the Sun and the planets, where they really are right now.
//
// Everything is drawn in its own scene behind the globe, by the same renderer in the same frame: the composer's
// render pass is replaced by one that draws this space scene first, clears the depth buffer and then draws the
// globe on top. The space camera copies the globe camera, so the Moon, the Sun and the planets sit at their true
// directions and true distances from the Earth (1 scene unit = 63.7 km; the Moon is about 6,000 units away, Neptune
// about 700 million), and the Earth hides whatever is behind it.
//
// Positions: Astronomy Engine (Cross, MIT licence; VSOP87 planetary theory, a full lunar theory, Jupiter's moons
// from E2x3), as seen from Earth's centre with light-time correction, turned from the J2000 equator into the
// globe's Earth-fixed frame by precession, nutation and Greenwich sidereal time. Spin: the International
// Astronomical Union (IAU) rotation elements, so the Moon shows the face and wobble (libration) it really shows,
// Saturn's rings are tilted as they really are, and Mars has the side facing us that really faces us.
//
// Explore: click a body (or pick it in the space bar) and the camera flies there and orbits it with its own
// controls; the globe's scene is not drawn meanwhile and the Earth is drawn here instead. Flying back to the Earth
// hands the camera back to the globe at the same spot, so the switch is seamless.
//
// Draw calls: stars 1, one per body on screen (bodies under 1.5 pixels are not drawn as spheres), far bodies as
// dots 1, Saturn's rings 1, the Sun's glow 1, orbits 1–3.
import { ui } from './uicons.js';
import { THREE } from '../vendor/vendor.min.mjs';
import { BODIES, BODY } from './bodies.js';
import { LANDINGS } from './landings.js';

const D2R = Math.PI / 180;
const R = 100; const KM = R / 6371.0088; // scene units per km
const AU = 149597870.7 * KM;
const ORDER = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'io', 'europa', 'ganymede', 'callisto', 'saturn', 'uranus', 'neptune', 'pluto'];
const BAR = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];
const PERIOD = { mercury: 87.97, venus: 224.7, mars: 686.98, jupiter: 4332.6, saturn: 10759, uranus: 30685, neptune: 60190, pluto: 90560, earth: 365.256 };
const MOON_PERIOD = { io: 1.769, europa: 3.551, ganymede: 7.155, callisto: 16.69 };

let A = null; // Astronomy Engine, loaded on first use
const loadEngine = () => (A ? Promise.resolve(A) : import('../vendor/astronomy.min.mjs').then((m) => (A = m)));

// ------------------------------------------------------------------ shaders
// Eclipses, from geometry alone: how much of the Sun's disc a dark body hides, seen from one point. Used for the
// Moon's shadow on the Earth (main.js), the Earth's shadow on the Moon and Jupiter's shadow on its moons (below).
// Two discs of angular radius a (the Sun) and b, centres s apart: the hidden fraction is the area of their overlap
// (the lens formula) over the Sun's area. Angles come from atan(|u × v|, u · v), which stays precise for the
// tiny angles involved (the Sun is 0.27° across) where acos(u · v) would not in single precision.
export const ECLIPSE_GLSL = `
  float discHidden(float a, float b, float s) {
    b /= a; s /= a;
    if (s >= 1.0 + b) return 0.0;
    if (s <= abs(1.0 - b)) return min(b * b, 1.0);
    float c1 = clamp((s * s + 1.0 - b * b) / (2.0 * s), -1.0, 1.0);
    float c2 = clamp((s * s + b * b - 1.0) / (2.0 * s * b), -1.0, 1.0);
    float k = max(0.0, (-s + 1.0 + b) * (s + 1.0 - b) * (s - 1.0 + b) * (s + 1.0 + b));
    return clamp((acos(c1) + b * b * acos(c2) - 0.5 * sqrt(k)) / 3.14159265, 0.0, 1.0);
  }
  float angleBetween(vec3 u, vec3 v) { return atan(length(cross(u, v)), dot(u, v)); }`;
// Bodies are lit in view space (camera-relative), so lighting stays crisp even 4.5 billion km from the origin.
const BODY_VS = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  void main() {
    vUv = uv; vObj = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const BODY_FS = `
  uniform sampler2D map; uniform sampler2D map2; uniform float mix2; uniform vec3 sunV; uniform vec4 atm;
  uniform float airless; uniform float ambient; uniform float sun; uniform float uT;
  uniform vec3 occV; uniform float occR; uniform float sunAng; uniform vec3 occRed; uniform float texW; uniform float grainF;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  ${ECLIPSE_GLSL}
  // v2.20 fine grain: closer than the map's own pixels, a faint grain (value noise in the body's own coordinates)
  // keeps the surface from turning to blur. It fades in only where one map pixel covers more than two screen pixels.
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float grain(vec3 p) { return vnoise(p) * 0.5 + vnoise(p * 2.13) * 0.3 + vnoise(p * 4.41) * 0.2; }
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV); vec3 l = normalize(sunV);
    vec2 uv = vUv;
    if (sun > 0.5) uv += 0.0025 * vec2(sin(vUv.y * 90.0 + uT * 0.35) + sin(vUv.x * 140.0 - uT * 0.2), cos(vUv.x * 120.0 + uT * 0.3));
    vec3 c = mix(texture2D(map, uv).rgb, texture2D(map2, uv).rgb, mix2);
    float mag = fwidth(uv.x) * texW; // map pixels per screen pixel: below 0.5 we are looking closer than the map
    if (sun < 0.5 && texW > 0.0) { float k = smoothstep(0.5, 0.12, mag) * (airless > 0.5 ? 1.0 : 0.6);
      if (k > 0.0) c *= 1.0 + (grain(vObj * grainF * 0.32) - 0.5) * 0.22 * k + (grain(vObj * grainF * 1.7) - 0.5) * 0.12 * k; }
    float nv = max(dot(n, v), 0.0);
    if (sun > 0.5) { // the Sun: its own light, darker toward the edge (limb darkening), slowly churning
      vec3 hot = c * 1.35 + vec3(0.25, 0.16, 0.02) * pow(nv, 3.0);
      gl_FragColor = vec4(hot * (0.45 + 0.55 * pow(nv, 0.45)), 1.0); return;
    }
    float nl = dot(n, l);
    float lam = max(nl, 0.0);
    float ls = nl > 0.0 ? 2.0 * nl / (nl + nv + 1e-3) : 0.0; // Lommel-Seeliger: bare rock stays bright to the edge
    float lit = mix(lam, min(ls, 1.25), airless);
    vec3 col = c * (lit * 1.08 + ambient);
    float fr = pow(1.0 - nv, 2.4);
    col += atm.rgb * atm.a * fr * smoothstep(-0.3, 0.45, nl); // thin bright rim where there is air
    col = mix(col, col * vec3(1.0, 0.72, 0.5), atm.a * fr * smoothstep(0.25, -0.05, nl) * smoothstep(-0.3, 0.0, nl)); // dusk at the edge of night
    if (occR > 0.0) { // in the shadow of a bigger body (the Earth for the Moon, Jupiter for its moons)
      vec3 e = occV + vV; float d = length(e); // from this point to the shadow-casting body, in view space
      float h = discHidden(sunAng, asin(min(occR / d, 1.0)), angleBetween(e / d, l));
      col = col * (1.0 - h) + c * lit * h * occRed; // the Earth's air bends red sunset light into its shadow
    }
    gl_FragColor = vec4(col, 1.0);
  }`;
const RING_VS = `
  varying vec3 vP;
  void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = `
  uniform sampler2D map; uniform vec2 span; uniform vec3 sunL;
  varying vec3 vP;
  void main() {
    float r = length(vP.xz); float u = (r - span.x) / (span.y - span.x);
    if (u < 0.0 || u > 1.0) discard;
    vec4 t = texture2D(map, vec2(u, 0.5));
    vec3 L = normalize(sunL);
    // Saturn's shadow: does the ray from here toward the Sun hit the planet (a unit sphere in these coordinates)?
    float b = dot(vP, L); float c = dot(vP, vP) - 1.0; float h = b * b - c;
    float shadow = (h > 0.0 && -b + sqrt(h) > 0.0 && b < 0.0) ? 0.08 : 1.0;
    float lit = 0.35 + 0.65 * sqrt(abs(L.y));
    gl_FragColor = vec4(t.rgb * lit * shadow * 1.1, t.a * 0.95);
  }`;
const SKY_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * mat3(modelMatrix) * position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`;
const SKY_FS = `
  uniform sampler2D map; uniform float gain; varying vec2 vUv;
  void main() { vec3 c = texture2D(map, vUv).rgb; gl_FragColor = vec4(pow(c, vec3(1.45)) * gain, 1.0); }`;
const DOT_VS = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uPx;
  varying vec3 vC; varying float vA;
  void main() { vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx; }`;
const DOT_FS = `
  varying vec3 vC; varying float vA;
  void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
    float core = smoothstep(0.45, 0.0, d); float halo = pow(1.0 - d, 2.0) * 0.55;
    gl_FragColor = vec4(vC * (core * 1.4 + halo) + core * 0.35, (core + halo) * vA); }`;
const GLOW_FS = `
  uniform vec3 color; varying vec2 vUv;
  void main() { float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 3.2) * 0.9 + pow(max(0.0, 1.0 - d), 9.0) * 1.6;
    gl_FragColor = vec4(color * a, a); }`;

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fmtKm = (km) => (km >= 1e9 ? `${(km / 1e9).toFixed(2)} billion km` : km >= 1e6 ? `${(km / 1e6).toFixed(1)} million km` : `${Math.round(km).toLocaleString()} km`);
const fmtLight = (s) => (s < 120 ? `${s.toFixed(1)} light-seconds` : s < 7200 ? `${(s / 60).toFixed(1)} light-minutes` : `${(s / 3600).toFixed(1)} light-hours`);

/**
 * @param {object} o
 * @param {object} o.globe the globe.gl instance
 * @param {() => Date} o.now the atlas clock
 * @param {THREE.Material} o.earthMaterial the day/night Earth material, drawn on the Earth while exploring
 * @param {(title: string, html: string, key?: string) => void} o.openNotes
 */
let active = null; // the installed cosmos, for the layer below

/** The layer-list switch: the Sun, the Moon and the planets drawn in the night sky behind the globe. */
export const planetsLayer = {
  id: 'planets', group: 'space', label: 'Moon and planets', swatch: '#ffd27a', on: true, fresh: true,
  sources: ['astronomyengine', 'iaurotation', 'solarsystemscope', 'nasa3d', 'nasatrek', 'nssdcfacts', 'apollosites', 'nssdcmaster', 'espenak'],
  async load() { return {}; },
  channels() { return {}; },
  onToggle(on) { active?.setBodies(on); },
  learn: {
    what: 'The Sun, the Moon, the eight planets, Pluto and Jupiter’s four big moons, drawn behind the globe where they really are right now, at their real sizes and distances, against NASA’s map of the stars and the Milky Way (night theme). Click a name to fly there and turn it around; the space bar at the top takes you on to the next one, and Earth brings you back. Gold pins on the Moon and Mars mark where spacecraft landed, and eclipses cast their real shadows.',
    how: 'Astronomy Engine works out every position in your browser from the atlas clock, with the same theories observatories use (the VSOP87 planetary theory and a full lunar theory, good to under an arcminute), and turns each body the way the International Astronomical Union’s rotation elements say it faces. The surfaces are global maps made from NASA spacecraft images: Solar System Scope’s set (Creative Commons Attribution 4.0) and NASA 3D Resources (public domain). Flying in close to the Moon, Mars or Mercury also loads NASA’s own full global mosaic from the Solar System Treks service.',
    try: 'Open Explore → Eclipses and press Watch on the total eclipse of 2 August 2027: the Moon’s shadow crosses North Africa and darkens Luxor. Watch an eclipse of the Moon and it turns copper red. Fly to the Moon and find the Apollo landing sites, then turn it round for Chang’e 4 and 6 on the far side. Or fly to the Moon at first or last quarter and look along the line between day and night, where the crater walls cast long shadows. Then open the time machine and run it fast: the phases sweep across the Moon, Jupiter’s moons race round, and Saturn’s rings stay tilted the same way in space as Saturn moves.',
    refs: ['astronomyengine', 'iaurotation', 'solarsystemscope', 'nasa3d', 'nasatrek', 'nssdcfacts', 'apollosites', 'nssdcmaster', 'espenak'],
  },
};

export function installCosmos({ globe, now, earthMaterial, eclipse, watchEclipse, placeName, openNotes, closeNotes, esc, factsHtml, refsHtml, reduceMotion, onChange, wake }) {
  const renderer = globe.renderer(); const mainCam = globe.camera(); const mainScene = globe.scene();
  const scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = true;
  const cam = new THREE.PerspectiveCamera(mainCam.fov, mainCam.aspect, 10, 1e10);
  const eqj = new THREE.Group(); eqj.matrixAutoUpdate = false; scene.add(eqj); // the J2000 equator, turned into the globe frame
  const loader = new THREE.TextureLoader(); const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);
  const st = { sky: true, dark: true, bodies: true, orbits: false, sites: true, focus: null, fly: null, ctl: null, lastCalc: 0, ready: false, venusSurface: false, hires: {}, fast: false };
  const tmp = new THREE.Vector3(); const tmp2 = new THREE.Vector3(); const tmp3 = new THREE.Vector3(); const mat3 = new THREE.Matrix3();

  // ---------------------------------------------------------------- the star sky (NASA Tycho star map, J2000 RA/Dec)
  const skyMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, gain: { value: 2.6 } }, vertexShader: SKY_VS, fragmentShader: SKY_FS, depthTest: false, depthWrite: false, side: THREE.BackSide });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat);
  // The map has right ascension 0 h in the middle growing to the right and declination +90° at the top; three.js
  // spheres put u = 0.5 on +x and the north pole on +y, so a 90° turn about x brings +y onto the J2000 pole.
  sky.rotation.x = Math.PI / 2; sky.frustumCulled = false; sky.renderOrder = -10; sky.visible = false; eqj.add(sky);
  (window.requestIdleCallback ?? setTimeout)(() => loader.load('textures/space/stars-tycho.jpg', (t) => { t.anisotropy = aniso; skyMat.uniforms.map.value = t; sky.visible = true; wake?.(); }), { timeout: 2500 }); // v2.16: the 900 kB star map after the Earth

  // ---------------------------------------------------------------- bodies
  const sphere = new THREE.SphereGeometry(1, 96, 48);
  const blank = (hex) => { const [r, g, b] = hexRgb(hex); const t = new THREE.DataTexture(new Uint8Array([r * 255, g * 255, b * 255, 255]), 1, 1); t.needsUpdate = true; return t; };
  const B = {}; // id -> { def, mesh, pos (EQJ, units), r (units), px }
  for (const def of BODIES) {
    const b = { def, r: def.r * KM, pos: new THREE.Vector3(), basis: new THREE.Matrix4(), px: 0, loaded: false };
    if (def.id !== 'earth') {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: blank(def.dot) }, map2: { value: blank(def.dot) }, mix2: { value: 0 }, sunV: { value: new THREE.Vector3(1, 0, 0) },
          atm: { value: new THREE.Vector4(...(def.atm ?? [0, 0, 0, 0])) }, airless: { value: def.airless ? 1 : 0 }, ambient: { value: def.id === 'moon' ? 0.018 : 0.006 },
          sun: { value: def.id === 'sun' ? 1 : 0 }, uT: { value: 0 }, texW: { value: 2048 }, grainF: { value: 2048 },
          occV: { value: new THREE.Vector3() }, occR: { value: 0 }, sunAng: { value: 0.00465 }, occRed: { value: new THREE.Vector3(...(def.id === 'moon' ? [0.36, 0.11, 0.035] : [0, 0, 0])) },
        },
        vertexShader: BODY_VS, fragmentShader: BODY_FS,
      });
      b.mesh = new THREE.Mesh(sphere, m); b.mesh.matrixAutoUpdate = false; b.mesh.visible = false; b.mesh.userData.body = def.id;
      eqj.add(b.mesh);
    }
    B[def.id] = b;
  }
  // The Earth while exploring: the globe's own sphere and day/night material, at the globe's own place.
  let earthMesh = null;
  function ensureEarth() {
    if (earthMesh) return;
    let g = null; mainScene.traverse((o) => { if (!g && o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material === earthMaterial) g = o; });
    earthMesh = new THREE.Mesh(g?.geometry ?? new THREE.SphereGeometry(R, 96, 48), earthMaterial);
    if (g) { g.updateWorldMatrix(true, false); earthMesh.matrixAutoUpdate = false; earthMesh.matrix.copy(g.matrixWorld); } else earthMesh.rotation.y = -Math.PI / 2; // three-globe's turn
    earthMesh.userData.body = 'earth'; earthMesh.visible = false; scene.add(earthMesh);
  }
  function loadTex(b) {
    if (b.loaded || !b.def.tex) return; b.loaded = true;
    const set = (k, url) => loader.load(`textures/space/${url}`, (t) => { t.anisotropy = aniso; b.mesh.material.uniforms[k].value = t; if (k === 'map') b.mesh.material.uniforms.texW.value = b.mesh.material.uniforms.grainF.value = t.image?.width ?? 2048; wake?.(); });
    set('map', b.def.tex); if (b.def.tex2) set('map2', b.def.tex2);
  }

  // Saturn's rings: a flat annulus in Saturn's equator, its colour and transparency from the Solar System Scope strip.
  const ringGeo = (() => {
    const [a, c] = BODY.saturn.ring; const n = 256; const pos = []; const idx = [];
    for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; const x = Math.cos(t); const z = Math.sin(t); pos.push(x * a, 0, z * a, x * c, 0, z * c); }
    for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  })();
  const rings = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
    uniforms: { map: { value: blank('#c8b590') }, span: { value: new THREE.Vector2(...BODY.saturn.ring) }, sunL: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
  rings.matrixAutoUpdate = false; rings.visible = false; eqj.add(rings);
  let ringsLoaded = false;

  // The Sun's glow: one camera-facing quad, added to the light.
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1.0, 0.82, 0.55) } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.renderOrder = 5; scene.add(glow);

  // Far-away bodies as glowing dots, all in one draw call.
  const DOTS = ORDER.filter((id) => id !== 'sun'); // v2.20: the Earth too, seen from out in the solar system
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOTS.length * 3), 3));
  dotGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(DOTS.length), 1));
  dotGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(DOTS.length), 1));
  dotGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(DOTS.flatMap((id) => hexRgb(BODY[id].dot))), 3));
  const dots = new THREE.Points(dotGeo, new THREE.ShaderMaterial({ uniforms: { uPx: { value: Math.min(devicePixelRatio, 2) } }, vertexShader: DOT_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dots.frustumCulled = false; eqj.add(dots);

  // Orbits: the planets' paths around the Sun (one line set), the Moon's around the Earth, Jupiter's moons around Jupiter.
  const orbitMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false });
  const helio = new THREE.Group(); const jovian = new THREE.Group(); eqj.add(helio); eqj.add(jovian);
  let orbitsBuilt = false;

  // v2.20 the asteroid belt and the Kuiper belt: where they really are (2.1–3.3 AU, with the Kirkwood gaps that
  // Jupiter clears, and 39–48 AU beyond Neptune), drawn as thousands of rocks that each go round at their own
  // Kepler speed, so the time machine sets them turning. The rocks themselves are illustrative, not real asteroids.
  const BELT_VS = `attribute vec3 aOrb; attribute vec3 aAng; uniform float uDays; uniform float uAU; uniform mat3 uEcl; uniform float uPx;
    void main() { float a = aOrb.x; float e = aOrb.y; float inc = aOrb.z; float node = aAng.x; float peri = aAng.y;
      float M = aAng.z + 6.2831853 * uDays / (365.25 * pow(a, 1.5)); float E = M + e * sin(M); E = M + e * sin(E); // Kepler, two steps
      float x = a * (cos(E) - e); float y = a * sqrt(1.0 - e * e) * sin(E);
      float cw = cos(peri); float sw = cos(peri - 1.5707963); float cn = cos(node); float sn = sin(node); float ci = cos(inc); float si = sin(inc);
      float xo = x * cw - y * sw; float yo = x * sw + y * cw;
      vec3 p = vec3(xo * cn - yo * ci * sn, xo * sn + yo * ci * cn, yo * si) * uAU; // in the ecliptic
      vec4 mv = modelViewMatrix * vec4(uEcl * p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx; }`;
  const BELT_FS = `uniform vec3 uC; uniform float uA; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(uC, uA * (1.0 - d * d)); }`;
  const OBL = 23.4392911 * D2R; const eclToEq = new THREE.Matrix3().set(1, 0, 0, 0, Math.cos(OBL), -Math.sin(OBL), 0, Math.sin(OBL), Math.cos(OBL));
  function belt(n, seed, pick, color, alpha, px = 1.6) {
    let r = seed; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    const orb = new Float32Array(n * 3); const ang = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const [a, e, inc] = pick(rnd); orb.set([a, e, inc], i * 3); ang.set([rnd() * 6.2832, rnd() * 6.2832, rnd() * 6.2832], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aOrb', new THREE.BufferAttribute(orb, 3)); g.setAttribute('aAng', new THREE.BufferAttribute(ang, 3));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uDays: { value: 0 }, uAU: { value: AU }, uEcl: { value: eclToEq }, uPx: { value: px * Math.min(devicePixelRatio, 2) }, uC: { value: new THREE.Color(color) }, uA: { value: alpha } }, vertexShader: BELT_VS, fragmentShader: BELT_FS, transparent: true, depthWrite: false }));
    m.frustumCulled = false; m.visible = false; helio.add(m); return m;
  }
  const gauss = (rnd) => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2832 * rnd());
  const GAPS = [2.502, 2.825, 2.958]; // Kirkwood gaps (3:1, 5:2, 7:3 with Jupiter)
  const asteroids = belt(6000, 7, (rnd) => { let a; do a = 2.1 + rnd() * 1.2; while (GAPS.some((g) => Math.abs(a - g) < 0.025)); return [a, Math.min(0.3, Math.abs(gauss(rnd)) * 0.08), Math.abs(gauss(rnd)) * 7 * D2R]; }, '#b8a58c', 0.55);
  const kuiper = belt(5000, 11, (rnd) => [rnd() < 0.25 ? 39.4 + gauss(rnd) * 0.3 : 42 + rnd() * 6, Math.min(0.35, Math.abs(gauss(rnd)) * 0.1), Math.abs(gauss(rnd)) * 10 * D2R], '#a9c2e6', 0.85, 2.4);
  function buildOrbits(t) {
    orbitsBuilt = true;
    const make = (ids, sample, steps) => {
      const pos = []; const col = [];
      for (const id of ids) {
        const c = hexRgb(BODY[id].dot); let prev = null;
        for (let i = 0; i <= steps; i++) { const v = sample(id, i / steps); if (prev) { pos.push(...prev, ...v); col.push(...c, ...c); } prev = v; }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const l = new THREE.LineSegments(g, orbitMat); l.frustumCulled = false; return l;
    };
    const ut = t.ut;
    helio.add(make(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'], (id, f) => {
      const v = A.HelioVector(A.Body[id[0].toUpperCase() + id.slice(1)], A.MakeTime(ut + (f - 0.5) * PERIOD[id])); return [v.x * AU, v.y * AU, v.z * AU];
    }, 360));
    eqj.add(make(['moon'], (_id, f) => { const v = A.GeoMoon(A.MakeTime(ut + (f - 0.5) * 27.32)); return [v.x * AU, v.y * AU, v.z * AU]; }, 240));
    jovian.add(make(GALILEAN, (id, f) => { const v = A.JupiterMoons(A.MakeTime(ut + (f - 0.5) * MOON_PERIOD[id]))[id]; return [v.x * AU, v.y * AU, v.z * AU]; }, 160));
  }
  const orbitLines = () => [...helio.children.filter((o) => !o.isPoints), ...jovian.children, ...eqj.children.filter((o) => o.isLineSegments)];

  // ---------------------------------------------------------------- where everything is
  const F = new THREE.Matrix4(); const Finv = new THREE.Matrix4();
  function frame(t) {
    const rot = A.Rotation_EQJ_EQD(t); const th = A.SiderealTime(t) * 15 * D2R; const c = Math.cos(th); const s = Math.sin(th);
    const col = (x, y, z) => { const q = A.RotateVector(rot, new A.Vector(x, y, z, t)); const xe = q.x * c + q.y * s; const ye = -q.x * s + q.y * c; return [ye, q.z, xe]; };
    const ex = col(1, 0, 0); const ey = col(0, 1, 0); const ez = col(0, 0, 1);
    const prevInv = Finv.clone();
    F.set(ex[0], ey[0], ez[0], 0, ex[1], ey[1], ez[1], 0, ex[2], ey[2], ez[2], 0, 0, 0, 0, 1);
    eqj.matrix.copy(F); eqj.matrixWorldNeedsUpdate = true; Finv.copy(F).invert();
    // The globe's frame turns with the Earth (once a day). Out in space the camera should not: turn it, its target
    // and any flight along with the frame, so the stars and the body you are looking at hold still.
    if (st.focus && st.framed) {
      const D = new THREE.Matrix4().multiplyMatrices(F, prevInv); const q = new THREE.Quaternion().setFromRotationMatrix(D);
      cam.position.applyMatrix4(D); cam.quaternion.premultiply(q); st.ctl?.target.applyMatrix4(D); st.follow?.applyMatrix4(D);
      if (st.fly) { st.fly.tgt0.applyMatrix4(D); st.fly.dir0.applyQuaternion(q); st.fly.dir1.applyQuaternion(q); }
    }
    st.framed = true;
  }
  const name = (id) => A.Body[id[0].toUpperCase() + id.slice(1)];
  /** Body basis in J2000: +x on the prime meridian, +y the north pole, +z toward 90° west (three.js sphere layout). */
  function orient(b, north, spinDeg) {
    const N = tmp.set(-north.y, north.x, 0); if (N.lengthSq() < 1e-12) N.set(1, 0, 0); N.normalize();
    const p = new THREE.Vector3(north.x, north.y, north.z).normalize();
    const Q = new THREE.Vector3().crossVectors(p, N); const w = spinDeg * D2R;
    const P = N.clone().multiplyScalar(Math.cos(w)).addScaledVector(Q, Math.sin(w));
    const E = new THREE.Vector3().crossVectors(p, P); // 90° east
    b.basis.makeBasis(P, p, E.negate());
  }
  function place(b) {
    if (!b.mesh) return;
    const f = b.def.flat ?? 1;
    b.mesh.matrix.copy(b.basis).scale(tmp.set(b.r, b.r * f, b.r)).setPosition(b.pos);
    b.mesh.matrixWorldNeedsUpdate = true;
  }
  function compute() {
    const t = A.MakeTime(now());
    frame(t);
    for (const id of ORDER) {
      const b = B[id]; if (id === 'earth') { b.pos.set(0, 0, 0); continue; }
      let v;
      if (id === 'moon') v = A.GeoMoon(t);
      else if (GALILEAN.includes(id)) continue;
      else v = A.GeoVector(name(id), t, true);
      b.pos.set(v.x * AU, v.y * AU, v.z * AU);
      try { const ax = A.RotationAxis(name(id), t); orient(b, ax.north, ax.spin); } catch { b.basis.identity(); }
    }
    const jm = A.JupiterMoons(t); const jp = B.jupiter;
    jovian.position.copy(jp.pos); jovian.updateMatrix();
    for (const id of GALILEAN) {
      const b = B[id]; const v = jm[id]; b.pos.set(v.x * AU, v.y * AU, v.z * AU).add(jp.pos);
      // Tidally locked: longitude 0 faces Jupiter; the pole is Jupiter's.
      const north = new THREE.Vector3().setFromMatrixColumn(jp.basis, 1);
      const toJ = tmp2.copy(jp.pos).sub(b.pos); toJ.addScaledVector(north, -toJ.dot(north)).normalize();
      b.basis.makeBasis(toJ, north, new THREE.Vector3().crossVectors(toJ, north));
    }
    const sp = B.sun.pos; helio.position.copy(sp); helio.updateMatrix();
    for (const id of ORDER) place(B[id]);
    // Saturn's rings share Saturn's frame (without its slight squash).
    const sat = B.saturn; rings.matrix.copy(sat.basis).scale(tmp.set(sat.r, sat.r, sat.r)).setPosition(sat.pos); rings.matrixWorldNeedsUpdate = true;
    st.t = t; st.ready = true;
  }

  // ---------------------------------------------------------------- per frame
  const camWorld = new THREE.Vector3(); const bodyWorld = new THREE.Vector3(); const sunWorld = new THREE.Vector3(); const occW = new THREE.Vector3();
  const toWorld = (v, out) => out.copy(v).applyMatrix4(F);
  function pxRadius(r, dist) { return (r / Math.max(dist, 1e-6)) * (renderer.domElement.height / renderer.getPixelRatio() / 2) / Math.tan((cam.fov * D2R) / 2); }
  /** Recompute positions when due (every frame while exploring, four times a second otherwise). */
  // While the time machine runs fast (10 minutes a second sweeps an eclipse across the Earth), every frame too.
  function tick() {
    const nowMs = performance.now();
    if (!st.ready || nowMs - st.lastCalc > (st.focus || st.fast ? 15 : 250)) {
      const sim = now().getTime();
      if (st.lastSim != null && nowMs > st.lastCalc) st.fast = Math.abs(sim - st.lastSim) > (nowMs - st.lastCalc) * 4;
      st.lastCalc = nowMs; st.lastSim = sim; compute();
    }
  }
  // The Moon's shadow on the Earth: hand the Moon and the Sun to the Earth's shaders. Switched on only while the Moon
  // passes within 2.3° of the Sun as seen from the Earth's centre (its shadow can then reach some part of the Earth).
  const moonW = new THREE.Vector3(); const sunW = new THREE.Vector3();
  function shadows() {
    if (!eclipse || !st.ready) return;
    toWorld(B.moon.pos, moonW); toWorld(B.sun.pos, sunW); const sd = sunW.length();
    eclipse.moonPos.value.copy(moonW); eclipse.moonR.value = B.moon.r;
    eclipse.sunAt.value.set(sunW.x / sd, sunW.y / sd, sunW.z / sd, B.sun.r / sd);
    const on = moonW.angleTo(sunW) < 0.04 ? 1 : 0;
    if (eclipse.eclOn.value !== on) { eclipse.eclOn.value = on; wake?.(); }
  }
  function update() {
    if (!A) return;
    const nowMs = performance.now();
    eqj.updateMatrixWorld(true);
    cam.updateMatrixWorld(); camWorld.setFromMatrixPosition(cam.matrixWorld);
    toWorld(B.sun.pos, sunWorld);
    const viewRot = mat3.setFromMatrix4(cam.matrixWorldInverse);
    const showBodies = st.focus || (st.bodies && st.dark);
    const pos = dotGeo.attributes.position.array; const size = dotGeo.attributes.aSize.array; const alpha = dotGeo.attributes.aAlpha.array;
    const t = nowMs / 1000;
    for (const id of ORDER) {
      const b = B[id]; toWorld(b.pos, bodyWorld); const dist = bodyWorld.distanceTo(camWorld); b.dist = dist; b.px = pxRadius(b.r, dist);
      if (b.mesh) {
        b.mesh.visible = !!showBodies && b.px > 1.2;
        if (b.mesh.visible) {
          if (b.px > 2.5 || st.focus === id) loadTex(b);
          const u = b.mesh.material.uniforms; u.uT.value = reduceMotion ? 0 : t;
          u.sunV.value.copy(sunWorld).sub(bodyWorld).normalize().applyMatrix3(viewRot);
          u.mix2.value = id === 'venus' && st.venusSurface ? 1 : 0;
          const occ = id === 'moon' ? 'earth' : GALILEAN.includes(id) ? 'jupiter' : null;
          if (occ) {
            const o = occ === 'earth' ? occW.set(0, 0, 0) : toWorld(B.jupiter.pos, occW);
            u.occV.value.copy(o).sub(camWorld).applyMatrix3(viewRot);
            u.occR.value = B[occ].r * (occ === 'earth' ? 1.02 : 1); // the air makes the Earth's shadow about 2 % wider
            u.sunAng.value = B.sun.r / B.sun.pos.distanceTo(b.pos);
          }
        }
      }
      const k = DOTS.indexOf(id);
      if (k >= 0) {
        pos[k * 3] = b.pos.x; pos[k * 3 + 1] = b.pos.y; pos[k * 3 + 2] = b.pos.z;
        size[k] = id === 'moon' ? 7 : GALILEAN.includes(id) ? 3.2 : id === 'pluto' ? 3 : id === 'venus' || id === 'jupiter' ? 7.5 : id === 'earth' ? 6.5 : 5.5;
        alpha[k] = showBodies ? (1 - smooth(1.2, 4, b.px)) * (GALILEAN.includes(id) ? smooth(4, 40, B.jupiter.px) : 1) : 0;
        if (id === 'earth') alpha[k] = st.focus ? 1 - smooth(1.2, 4, b.px) : 0; // on the globe the Earth is the globe
        if (st.focus === 'system' && (id === 'moon' || GALILEAN.includes(id))) alpha[k] *= 0.35; // moons sit on their planets out here
      }
    }
    dotGeo.attributes.position.needsUpdate = true; dotGeo.attributes.aSize.needsUpdate = true; dotGeo.attributes.aAlpha.needsUpdate = true;
    // rings
    const sat = B.saturn; rings.visible = !!showBodies && sat.px > 1.5;
    if (rings.visible) {
      if (!ringsLoaded) { ringsLoaded = true; loader.load('textures/space/saturn-rings.png', (tx) => { rings.material.uniforms.map.value = tx; wake?.(); }); }
      const inv = new THREE.Matrix4().copy(sat.basis).invert();
      rings.material.uniforms.sunL.value.copy(B.sun.pos).sub(sat.pos).applyMatrix4(inv).normalize();
    }
    // the Sun's glow faces the camera
    const sun = B.sun; glow.visible = !!showBodies;
    glow.position.copy(sunWorld); glow.quaternion.copy(cam.quaternion); glow.scale.setScalar(Math.max(sun.r * (st.focus === 'sun' ? 7 : 12), sun.dist * 0.035)); // never smaller than a bright star
    // v2.20 the belts, turning at their Kepler speeds with the atlas clock
    const belts = st.focus === 'system' || (!!st.focus && !!st.ctl && cam.position.distanceTo(st.ctl.target) > AU * 0.3); // close to a planet the rocks would only look like stars
    for (const m of [asteroids, kuiper]) { m.visible = belts; if (belts && st.t) m.material.uniforms.uDays.value = st.t.ut; }
    sky.visible = !!skyMat.uniforms.map.value && (st.sky || !!st.focus);
    for (const l of orbitLines()) l.visible = st.orbits || !!st.focus;
    if (earthMesh) earthMesh.visible = !!st.focus;
  }

  // ---------------------------------------------------------------- explore mode
  function ensureControls() {
    if (st.ctl) return st.ctl;
    const Ctl = globe.controls().constructor;
    const c = new Ctl(cam, renderer.domElement);
    c.enableDamping = true; c.dampingFactor = 0.09; c.rotateSpeed = 0.55; c.zoomSpeed = 0.9; c.enablePan = false; c.enabled = false;
    st.ctl = c; return c;
  }
  function viewDirFor(id) {
    // Look at the lit side, a little off the line to the Sun so the terminator shows its relief.
    const b = B[id]; const s = toWorld(B.sun.pos, new THREE.Vector3()); const p = toWorld(b.pos, new THREE.Vector3());
    if (id === 'sun') return camWorld.clone().sub(p).normalize();
    if (id === 'moon') return p.clone().negate().normalize().addScaledVector(s.clone().sub(p).normalize(), 0.6).normalize(); // the face we know, turned a little toward the Sun
    const toSun = s.sub(p).normalize(); const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(toSun, up).normalize();
    return toSun.multiplyScalar(0.82).addScaledVector(side, 0.5).addScaledVector(up, 0.18).normalize();
  }
  function fit(id) { const r = B[id].r; return id === 'sun' ? r * 4.2 : id === 'saturn' ? r * 5.2 : r * 3.4; }
  /** v2.20 the whole solar system: from above the plane of the planets, a little tilted, with the Earth towards you. */
  function systemView() {
    const sun = toWorld(B.sun.pos, new THREE.Vector3());
    const north = new THREE.Vector3(0, -Math.sin(OBL), Math.cos(OBL)).applyMatrix4(new THREE.Matrix4().extractRotation(F)); // the ecliptic's north pole
    const toEarth = sun.clone().negate(); toEarth.addScaledVector(north, -toEarth.dot(north)).normalize();
    return { dir: north.multiplyScalar(Math.sin(55 * D2R)).addScaledVector(toEarth, Math.cos(55 * D2R)).normalize(), dist: 100 * AU, tgt: () => toWorld(B.sun.pos, new THREE.Vector3()) };
  }
  async function explore(id, { instant = false } = {}) {
    await loadEngine(); compute(); // fresh positions: the clock may just have jumped (an eclipse to watch)
    if (id === 'system') return exploreSystem({ instant });
    if (!BODY[id]) return;
    if (id === 'earth' && !st.focus) return;
    const c = ensureControls(); ensureEarth();
    const from = st.focus;
    if (!from) { // leaving the globe: start exactly where the globe camera is
      cam.position.copy(mainCam.position); cam.quaternion.copy(mainCam.quaternion); cam.updateMatrixWorld();
      c.target.set(0, 0, 0);
      globe.controls().enabled = false; globe.enablePointerInteraction(false); globe.controls().autoRotate = false;
      document.body.classList.add('in-space');
    }
    const b = B[id]; const tgt0 = c.target.clone(); const camRel0 = cam.position.clone().sub(tgt0);
    const d0 = camRel0.length(); const dir0 = camRel0.clone().normalize();
    const dir1 = id === 'earth' ? mainCam.position.clone().normalize() : viewDirFor(id);
    const d1 = id === 'earth' ? Math.max(mainCam.position.length(), R * 2.2) : fit(id);
    const tgt1 = () => toWorld(b.pos, new THREE.Vector3());
    const sep = tgt0.distanceTo(tgt1());
    const hop = Math.max(0, Math.log(sep / Math.max(d0, d1, 1)) * 0.45);
    const ms = instant || reduceMotion ? 0 : 2200 + Math.min(2600, Math.log10(1 + sep) * 260);
    st.focus = id; st.fly = { t0: performance.now(), ms, tgt0, dir0, d0, dir1, d1, tgt1, hop, to: id };
    c.enabled = false; c.enablePan = false; c.minDistance = id === 'earth' ? R * 1.04 : b.r + minAltitude(b); c.maxDistance = (id === 'earth' ? R : b.r) * (id === 'sun' ? 40 : 400);
    // On phones the card would cover the body you flew to: it waits behind the ⓘ button in the space bar.
    if (id !== 'earth') { loadTex(b); if (matchMedia('(max-width: 860px)').matches) closeNotes?.(); else card(id); }
    bar(); onChange?.(id === 'earth' ? null : id); wake?.(ms + 1500);
  }
  /** How close you may fly: until one pixel of the best map we have covers about a quarter of a screen pixel. */
  function minAltitude(b) {
    const d = b.def; const px = d.trek && d.trekMax ? 2 ** (d.trekMax + 1) * 256 : (b.mesh?.material.uniforms.texW.value ?? 2048);
    const mPerPx = (2 * Math.PI * b.r) / px; const viewPx = renderer.domElement.height / renderer.getPixelRatio();
    return Math.max(b.r * 0.004, (mPerPx * viewPx) / (2 * Math.tan((cam.fov * D2R) / 2)) / 4);
  }
  async function exploreSystem({ instant = false } = {}) {
    const c = ensureControls(); ensureEarth();
    if (!st.focus) {
      cam.position.copy(mainCam.position); cam.quaternion.copy(mainCam.quaternion); cam.updateMatrixWorld(); c.target.set(0, 0, 0);
      globe.controls().enabled = false; globe.enablePointerInteraction(false); globe.controls().autoRotate = false;
      document.body.classList.add('in-space');
    }
    if (!orbitsBuilt && st.t) buildOrbits(st.t);
    const v = systemView(); const tgt0 = c.target.clone(); const rel = cam.position.clone().sub(tgt0); const d0 = rel.length();
    const ms = instant || reduceMotion ? 0 : 4200;
    st.focus = 'system'; st.fly = { t0: performance.now(), ms, tgt0, dir0: rel.normalize(), d0, dir1: v.dir, d1: v.dist, tgt1: v.tgt, hop: 0, to: 'system' };
    c.enabled = false; c.enablePan = true; c.screenSpacePanning = true; c.minDistance = B.sun.r * 6; c.maxDistance = 400 * AU;
    if (matchMedia('(max-width: 860px)').matches) closeNotes?.(); else systemCard();
    bar(); onChange?.('system'); wake?.(ms + 1500);
  }
  function stepFly() {
    const f = st.fly; const c = st.ctl;
    const k = f.ms ? Math.min(1, (performance.now() - f.t0) / f.ms) : 1; const e = easeInOut(k);
    const tg = smooth(0.12, 0.88, k);
    const target = f.tgt0.clone().lerp(f.tgt1(), tg);
    const dir = f.dir0.clone().lerp(f.dir1, e).normalize();
    const dist = Math.exp(Math.log(f.d0) * (1 - e) + Math.log(f.d1) * e + f.hop * Math.sin(Math.PI * e));
    c.target.copy(target); cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target);
    if (k >= 1) {
      st.fly = null; st.follow = f.tgt1();
      if (f.to === 'earth') return leave();
      c.enabled = true;
    }
  }
  function leave() {
    // Hand the camera back to the globe exactly where it is.
    const c = st.ctl; st.focus = null; st.fly = null; if (c) c.enabled = false;
    mainCam.position.copy(cam.position); mainCam.lookAt(0, 0, 0); mainCam.updateMatrixWorld();
    globe.controls().target?.set?.(0, 0, 0); globe.controls().enabled = true; globe.enablePointerInteraction(true); globe.controls().update?.();
    document.body.classList.remove('in-space'); bar(); onChange?.(null); closeNotes?.(); wake?.(1500);
  }
  function follow() {
    // The body keeps moving (the Moon covers its own width in under an hour, faster with the time machine): carry
    // the camera along so it stays put relative to the body.
    if (!st.focus || st.fly || st.focus === 'earth') return;
    if (st.focus === 'system') { // the Sun drifts (seen from the Earth's frame): carry the view with it, keeping any pan
      const p = toWorld(B.sun.pos, new THREE.Vector3()); if (st.follow) { const d = p.clone().sub(st.follow); cam.position.add(d); st.ctl.target.add(d); }
      st.follow = p; st.ctl.rotateSpeed = 0.55; st.ctl.update(); return;
    }
    const p = toWorld(B[st.focus].pos, new THREE.Vector3());
    if (st.follow) { const d = p.clone().sub(st.follow); cam.position.add(d); }
    st.follow = p; st.ctl.target.copy(p);
    const alt = cam.position.distanceTo(p) - B[st.focus].r; st.ctl.rotateSpeed = 0.55 * Math.min(1, Math.max(0.002, alt / B[st.focus].r)); // slower turning near the ground
    st.ctl.update(); detail();
  }

  // ---------------------------------------------------------------- the render pass
  const composer = globe.postProcessingComposer(); const mainPass = composer.passes[0];
  const clear = new THREE.Color();
  const pass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {}, dispose() {},
    render(r, _w, readBuffer) {
      r.setRenderTarget(this.renderToScreen ? null : readBuffer);
      const auto = r.autoClear; r.autoClear = false;
      const exploring = !!st.focus;
      if (exploring) { r.getClearColor(clear); const a = r.getClearAlpha(); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.setClearColor(clear, a); } else r.clear(true, true, true);
      const drawSpace = A && (exploring || st.dark);
      if (A) { tick(); shadows(); }
      if (drawSpace) {
        if (st.fly) stepFly(); else follow();
        if (!exploring) { cam.position.copy(mainCam.position); cam.quaternion.copy(mainCam.quaternion); }
        cam.fov = mainCam.fov; cam.aspect = mainCam.aspect;
        const near = exploring ? Math.max(1e-3, Math.min(1e4, nearestSurface() * 0.3)) : 10;
        if (cam.near !== near) cam.near = near;
        cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        update();
        r.render(scene, cam);
        r.clearDepth();
        labels();
      } else hideLabels();
      if (!exploring) r.render(mainScene, mainCam);
      r.autoClear = auto;
    },
  };
  composer.passes[0] = pass; mainPass.dispose?.();
  function nearestSurface() {
    let m = Infinity; const c = cam.position;
    for (const id of ORDER) { const b = B[id]; const p = id === 'earth' ? tmp.set(0, 0, 0) : toWorld(b.pos, tmp); m = Math.min(m, c.distanceTo(p) - (id === 'earth' ? R : b.r)); }
    return Math.max(m, 1e-3);
  }

  // ---------------------------------------------------------------- labels (a few DOM buttons, placed each frame)
  const host = document.getElementById('stage') ?? document.body;
  const layer = document.createElement('div'); layer.className = 'space-labels'; layer.setAttribute('aria-label', 'The Sun, the Moon and the planets'); host.appendChild(layer);
  const L = {};
  for (const id of ORDER) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'space-label'; el.dataset.space = id;
    el.innerHTML = `<i style="--c:${BODY[id].dot}"></i><span>${esc(BODY[id].name)}</span>`; el.title = `Fly to ${BODY[id].name}`;
    el.hidden = true; layer.appendChild(el); L[id] = el;
  }
  // v2.20 humanity's farthest spacecraft, out beyond the planets. Approximate: each one's direction from the Sun
  // (right ascension and declination, J2000) and its distance on 1 January 2025, moving outwards at its cruise speed.
  // Good to about 1 AU, which is plenty at this scale; they are shown only in the solar system view.
  const PROBES = [
    { id: 'voyager1', name: 'Voyager 1', ra: 17.2, dec: 12.0, au: 166.4, auYr: 3.57, launched: 1977, note: 'Launched 1977; flew past Jupiter and Saturn, crossed into interstellar space in 2012. The farthest human-made object.', ref: 'jplvoyager' },
    { id: 'voyager2', name: 'Voyager 2', ra: 20.0, dec: -59.5, au: 139.5, auYr: 3.22, launched: 1977, note: 'Launched 1977; the only spacecraft to visit Uranus (1986) and Neptune (1989). In interstellar space since 2018.', ref: 'jplvoyager' },
    { id: 'newhorizons', name: 'New Horizons', ra: 19.75, dec: -20.5, au: 61.0, auYr: 2.89, launched: 2006, note: 'Launched 2006; flew past Pluto in 2015 and Arrokoth in the Kuiper belt in 2019.', ref: 'newhorizons' },
  ];
  const probeAU = (p, ms = now().getTime()) => p.au + p.auYr * (ms - Date.UTC(2025, 0, 1)) / 31557600000;
  const probeDir = (p) => { const a = p.ra * 15 * D2R; const d = p.dec * D2R; return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)); };
  const PL = {};
  for (const p of PROBES) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'space-label probe'; el.dataset.spaceProbe = p.id;
    el.innerHTML = `<i style="--c:#7fe3c4"></i><span>${esc(p.name)}</span>`; el.title = `${p.name}: about ${Math.round(probeAU(p))} AU from the Sun`;
    el.hidden = true; layer.appendChild(el); PL[p.id] = el;
  }
  function probeLabels(rect, host0) {
    const on = st.focus === 'system' && !st.fly;
    for (const p of PROBES) {
      const el = PL[p.id]; let vis = on;
      if (vis) {
        const w = toWorld(tmp3.copy(B.sun.pos).addScaledVector(probeDir(p), probeAU(p) * AU), tmp);
        ndc.copy(w).project(cam); vis = ndc.z < 1 && Math.abs(ndc.x) < 1.02 && Math.abs(ndc.y) < 1.02;
        if (vis) el.style.transform = `translate(${(rect.left - host0.left + (ndc.x + 1) / 2 * rect.width).toFixed(1)}px, ${(rect.top - host0.top + (1 - ndc.y) / 2 * rect.height - 7).toFixed(1)}px) translate(-5px, 0)`;
      }
      if (el.hidden === vis) el.hidden = !vis;
    }
  }
  const ndc = new THREE.Vector3();
  function labels() {
    const exploring = !!st.focus; const show = exploring || (st.bodies && st.dark);
    if (!show) return hideLabels();
    const rect = renderer.domElement.getBoundingClientRect(); const host0 = host.getBoundingClientRect();
    const earthR = R; const cpos = cam.position;
    for (const id of ORDER) {
      const el = L[id]; const b = B[id];
      let vis = show && !st.fly && id !== st.focus && !(id === 'earth' && !exploring);
      if (vis && GALILEAN.includes(id)) vis = exploring && (st.focus === 'jupiter' || GALILEAN.includes(st.focus)) && B.jupiter.px > 30;
      if (vis && id === 'moon' && st.focus === 'system') vis = false; // out here it sits on the Earth's label
      if (vis) {
        const p = id === 'earth' ? tmp.set(0, 0, 0) : toWorld(b.pos, tmp);
        ndc.copy(p).project(cam);
        if (ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) vis = false;
        // Hidden behind the Earth (globe view) or behind the body being explored.
        const occ = (cx, r) => { const d = tmp2.copy(p).sub(cpos); const len = d.length(); d.divideScalar(len); const oc = cx.clone().sub(cpos); const tca = oc.dot(d); if (tca < 0 || tca > len) return false; return oc.lengthSq() - tca * tca < r * r; };
        if (vis && !exploring && id !== 'earth' && occ(new THREE.Vector3(), earthR * 1.02)) vis = false;
        if (vis && exploring && B[st.focus] && st.focus !== 'earth' && occ(toWorld(B[st.focus].pos, new THREE.Vector3()), B[st.focus].r)) vis = false;
        if (vis) {
          const x = rect.left - host0.left + (ndc.x + 1) / 2 * rect.width; const y = rect.top - host0.top + (1 - ndc.y) / 2 * rect.height;
          const off = Math.min(60, b.px) + (st.focus === 'system' ? 9 : 6);
          el.style.transform = `translate(${x.toFixed(1)}px, ${(y + off).toFixed(1)}px) translate(-50%, 0)`;
        }
      }
      if (el.hidden === vis) el.hidden = !vis;
    }
    probeLabels(rect, host0);
    sites();
  }
  function hideLabels() { for (const id of ORDER) if (!L[id].hidden) L[id].hidden = true; for (const el of Object.values(PL)) el.hidden = true; siteLayer.hidden = true; }

  // ---------------------------------------------------------------- landing sites: pins on the Moon and Mars
  // Each pin sits on the body's own surface (its latitude and longitude turned by the body's spin), so it rides
  // round with it and hides when it turns away. Names show once the body fills the view; a click tells its story.
  const siteLayer = document.createElement('div'); siteLayer.className = 'space-sites'; siteLayer.hidden = true; siteLayer.setAttribute('aria-label', 'Landing sites'); host.appendChild(siteLayer);
  let siteFor = null; let siteEls = [];
  const siteW = new THREE.Vector3(); const siteN = new THREE.Vector3(); const siteC = new THREE.Vector3(); const siteV = new THREE.Vector3();
  function sitePoint(id, s, out) {
    const b = B[id]; const la = s.lat * D2R; const lo = s.lng * D2R; const f = b.def.flat ?? 1;
    out.set(Math.cos(la) * Math.cos(lo), Math.sin(la) * f, -Math.cos(la) * Math.sin(lo)).multiplyScalar(b.r).applyMatrix4(b.basis).add(b.pos);
    return toWorld(out, out);
  }
  function sites() {
    const id = st.focus; const list = st.sites && !st.fly && LANDINGS[id];
    if (!list || B[id].px < 60) { if (!siteLayer.hidden) siteLayer.hidden = true; return; }
    if (siteFor !== id) {
      siteFor = id;
      siteLayer.innerHTML = list.map((x, i) => `<button type="button" class="space-site" data-site="${id}:${i}" title="${esc(x.name)}, ${x.date.slice(0, 4)}"><i></i><span>${esc(x.name)}</span></button>`).join('');
      siteEls = [...siteLayer.children];
    }
    siteLayer.hidden = false; siteLayer.classList.toggle('named', B[id].px > 330);
    const rect = renderer.domElement.getBoundingClientRect(); const host0 = host.getBoundingClientRect();
    toWorld(B[id].pos, siteC);
    list.forEach((x, i) => {
      const el = siteEls[i]; const p = sitePoint(id, x, siteW);
      siteN.copy(p).sub(siteC).normalize(); siteV.copy(cam.position).sub(p).normalize();
      ndc.copy(p).project(cam);
      const vis = siteN.dot(siteV) > 0.1 && ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
      if (vis) el.style.transform = `translate(${(rect.left - host0.left + (ndc.x + 1) / 2 * rect.width).toFixed(1)}px, ${(rect.top - host0.top + (1 - ndc.y) / 2 * rect.height).toFixed(1)}px)`;
      if (el.hidden === vis) el.hidden = !vis;
    });
  }
  /** Turn the body so a landing site faces you, a little closer in. */
  function lookAtSite(id, x) {
    const c = st.ctl; const b = B[id]; if (!c || st.focus !== id) return;
    const n = sitePoint(id, x, new THREE.Vector3()).sub(toWorld(b.pos, new THREE.Vector3())).normalize();
    const rel = cam.position.clone().sub(c.target); const d0 = rel.length();
    st.fly = { t0: performance.now(), ms: reduceMotion ? 0 : 1400, tgt0: c.target.clone(), dir0: rel.normalize(), d0, dir1: n, d1: Math.min(d0, b.r * 2.2), tgt1: () => toWorld(b.pos, new THREE.Vector3()), hop: 0, to: id };
    c.enabled = false; wake?.(1800);
  }
  const fmtLatLng = (la, lo) => `${Math.abs(la).toFixed(2)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(2)}° ${lo >= 0 ? 'E' : 'W'}`;
  const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  function siteCard(id, i) {
    const x = LANDINGS[id][i]; const apollo = id === 'moon' && x.name.startsWith('Apollo');
    openNotes('Space', `
      <h3 class="withglyph"><span class="space-glyph" style="--c:#ffd27a">⚑</span><span>${esc(x.name)}</span></h3><p class="sub">Landed on ${esc(BODY[id].name === 'Moon' ? 'the Moon' : BODY[id].name)} · ${esc(fmtDay(`${x.date}T12:00:00Z`))}</p>
      ${factsHtml([['Who', x.who], ...(x.crew ? [['Crew', x.crew]] : []), ['Where', fmtLatLng(x.lat, x.lng)]])}
      <p>${esc(x.what)}</p>
      <div class="quick"><button class="btn ghost" data-space-card="1">About ${esc(BODY[id].name === 'Moon' ? 'the Moon' : BODY[id].name)}</button><button class="btn ghost" data-space="earth">Back to Earth</button></div>
      <details class="more"><summary>Where the position comes from</summary>
        <p class="small">Planetocentric latitude and longitude (east positive), placed on the map with the International Astronomical Union’s rotation elements. The map itself is about 2 km a pixel on the Moon, so the pin marks the place, not the spacecraft.</p>
        ${refsHtml([...(apollo ? ['apollosites'] : ['nssdcmaster']), 'iaurotation'])}
      </details>`, `space:site:${id}:${i}`);
  }

  // ---------------------------------------------------------------- eclipses
  // The next four eclipses of the Sun and of the Moon (faint penumbral ones left out), plus the most recent total
  // one of each, to watch again. Astronomy Engine finds them; "Watch" hands the moment to the atlas (watchEclipse),
  // which runs the time machine through it while the shaders above draw the shadows.
  let eclCache = null;
  const SOLAR = { total: 'Total eclipse of the Sun', annular: 'Ring of fire (annular) eclipse', partial: 'Partial eclipse of the Sun', hybrid: 'Hybrid eclipse of the Sun' };
  const LUNAR = { total: 'Total eclipse of the Moon', partial: 'Partial eclipse of the Moon', penumbral: 'Faint (penumbral) eclipse of the Moon' };
  function subMoon(time) {
    const eq = A.Equator(A.Body.Moon, time, new A.Observer(0, 0, 0), true, true);
    const lng = ((((eq.ra - A.SiderealTime(time)) * 15) % 360) + 540) % 360 - 180; return { lat: eq.dec, lng };
  }
  const solarRow = (x, past = false) => ({ body: 'sun', kind: x.kind, peak: x.peak.date.getTime(), past, ...(Number.isFinite(x.latitude) ? { lat: x.latitude, lng: x.longitude } : subMoon(x.peak)) });
  const lunarRow = (x, past = false) => ({ body: 'moon', kind: x.kind, peak: x.peak.date.getTime(), past, total: x.sd_total * 2, partial: x.sd_partial * 2, ...subMoon(x.peak) });
  function eclipseList() {
    const t0 = now(); const key = Math.floor(t0.getTime() / 3600_000);
    if (eclCache?.key === key) return eclCache.list;
    const T = A.MakeTime(t0); const list = [];
    let x = A.SearchGlobalSolarEclipse(T);
    for (let i = 0; i < 4; i++) { list.push(solarRow(x)); x = A.NextGlobalSolarEclipse(x.peak); }
    let y = A.SearchLunarEclipse(T);
    for (let i = 0, n = 0; i < 16 && n < 4; i++) { if (y.kind !== 'penumbral') { list.push(lunarRow(y)); n++; } y = A.NextLunarEclipse(y.peak); }
    const back = A.MakeTime(new Date(t0.getTime() - 4 * 365.25 * 86400_000)); let ls = null; let ll = null;
    for (let s1 = A.SearchGlobalSolarEclipse(back); s1.peak.date < t0; s1 = A.NextGlobalSolarEclipse(s1.peak)) if (s1.kind === 'total') ls = s1;
    for (let l1 = A.SearchLunarEclipse(back); l1.peak.date < t0; l1 = A.NextLunarEclipse(l1.peak)) if (l1.kind === 'total') ll = l1;
    if (ll) list.push(lunarRow(ll, true)); if (ls) list.push(solarRow(ls, true));
    list.sort((a, b) => a.peak - b.peak);
    eclCache = { key, list }; return list;
  }
  const where = (e) => {
    const p = placeName?.(e.lat, e.lng) || fmtLatLng(e.lat, e.lng);
    if (e.body === 'moon') return `Seen from the night side of the Earth, best from ${p}${e.kind === 'total' ? ` · red for ${Math.round(e.total)} minutes` : ` · ${Math.round(e.partial)} minutes`}`;
    return e.kind === 'partial' ? `A bite out of the Sun, seen from the polar regions near ${p}` : `Best seen from ${p}`;
  };
  const fmtWhen = (ms) => { const d = new Date(ms); return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`; };
  async function eclipseCard() {
    await loadEngine(); if (!st.ready) compute();
    const list = eclipseList(); st.eclipses = list;
    openNotes('Eclipses', `
      <h3 class="withglyph"><span class="space-glyph" style="--c:#ffd27a">◐</span><span>Eclipses</span></h3><p class="sub">Worked out in your browser · press Watch to see the shadow move</p>
      <ul class="ecl-list">${list.map((e, i) => `<li class="${e.past ? 'past' : ''}"><i class="ecl-dot ${e.body}" aria-hidden="true"></i><div><b>${esc(e.body === 'sun' ? SOLAR[e.kind] ?? e.kind : LUNAR[e.kind] ?? e.kind)}</b><span>${e.past ? 'Last one · ' : ''}${esc(fmtWhen(e.peak))}</span><small>${esc(where(e))}</small></div><button class="btn ghost" data-eclipse="${i}">Watch</button></li>`).join('')}</ul>
      <details class="more"><summary>How it is worked out</summary>
        <p class="small">Astronomy Engine searches the Moon’s orbit for the moments it lines up with the Sun and the Earth. Watch runs the atlas’s time machine at 10 minutes a second from two hours before the middle of the eclipse and stops two hours after it; press Live to come back. The shadows are drawn from the same positions: on the Earth, how much of the Sun the Moon hides from each spot; on the Moon, how much of the Sun the Earth hides, with the red light the Earth’s air bends into its shadow. The times agree with NASA’s eclipse predictions (Espenak) to within a minute or so.</p>
        ${refsHtml(['astronomyengine', 'espenak'])}
      </details>`, 'eclipses');
  }
  function nextEclipse(body) { if (!A) return null; const e = eclipseList().find((x) => !x.past && x.body === body); return e ? `${(body === 'sun' ? { total: 'Total', annular: 'Ring of fire', partial: 'Partial', hybrid: 'Hybrid' } : { total: 'Total', partial: 'Partial' })[e.kind] ?? e.kind}, ${fmtWhen(e.peak).split(',')[0]}` : null; }

  // Clicks on bodies while exploring (a click, not the end of a drag).
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!st.focus || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), cam);
    const hits = ray.intersectObjects([...ORDER.map((id) => B[id].mesh).filter((m) => m?.visible), earthMesh].filter(Boolean), false);
    let id = hits[0]?.object.userData.body;
    if (!id) { // v2.20 a click near a body's dot flies there too (out in the solar system the bodies are dots)
      let best = 18; for (const k of ORDER) { const p = k === 'earth' ? tmp.set(0, 0, 0) : toWorld(B[k].pos, tmp); ndc.copy(p).project(cam); if (ndc.z > 1) continue;
        const dx = (ndc.x + 1) / 2 * rect.width - (e.clientX - rect.left); const dy = (1 - ndc.y) / 2 * rect.height - (e.clientY - rect.top); const dd = Math.hypot(dx, dy);
        if (dd < best && !(st.focus === 'system' && (k === 'moon' || GALILEAN.includes(k)))) { best = dd; id = k; } }
    }
    if (id && id !== st.focus) explore(id);
  });

  // ---------------------------------------------------------------- the space bar and the card
  const barEl = document.createElement('div'); barEl.className = 'space-bar'; barEl.hidden = true; barEl.setAttribute('role', 'toolbar'); barEl.setAttribute('aria-label', 'Fly to a body in the solar system');
  host.appendChild(barEl);
  function bar() {
    barEl.hidden = !st.focus;
    if (!st.focus) return;
    const nm = st.focus === 'system' ? 'the solar system' : BODY[st.focus].name;
    barEl.innerHTML = `<button class="sb-home" data-space="earth" title="Back to the globe">${ui('back')}Earth</button><div class="sb-list"><button data-space="system" aria-pressed="${st.focus === 'system'}" title="The whole solar system"><i style="--c:#ffd27a;box-shadow:0 0 0 2px rgba(255,210,122,.35)"></i>Solar system</button>${BAR.filter((id) => id !== 'earth').map((id) => `<button data-space="${id}" aria-pressed="${st.focus === id || (id === 'jupiter' && GALILEAN.includes(st.focus))}" title="${esc(BODY[id].name)}"><i style="--c:${BODY[id].dot}"></i>${esc(BODY[id].name)}</button>`).join('')}</div><button class="sb-orbits" aria-pressed="${st.orbits}" title="Show the orbits">Orbits</button>${LANDINGS[st.focus] ? `<button class="sb-sites" aria-pressed="${st.sites}" title="Show where spacecraft landed">Landings</button>` : ''}<button class="sb-info" data-space-card="1" title="About ${esc(nm)}" aria-label="About ${esc(nm)}">ⓘ</button>`;
  }
  barEl.addEventListener('click', (e) => {
    if (e.target.closest('.sb-orbits')) { st.orbits = !st.orbits; if (st.orbits && !orbitsBuilt && st.t) buildOrbits(st.t); bar(); wake?.(); }
    if (e.target.closest('.sb-sites')) { st.sites = !st.sites; bar(); wake?.(); }
  });
  function live(id) {
    const b = B[id]; const t = st.t ?? A.MakeTime(now());
    const km = b.pos.length() / KM; const rows = [];
    if (id !== 'earth') rows.push(['From Earth now', fmtKm(km)], ['Light takes', fmtLight(km / 299792.458)]);
    if (id === 'sun' || id === 'moon') { const n = nextEclipse(id); if (n) rows.push(['Next eclipse', n]); }
    if (id !== 'sun' && id !== 'earth') {
      try {
        const il = A.Illumination(name(GALILEAN.includes(id) ? 'jupiter' : id), t);
        if (!GALILEAN.includes(id)) rows.push(['Brightness in our sky', `magnitude ${il.mag.toFixed(1)}`]);
        if (id === 'moon' || id === 'venus' || id === 'mercury') rows.push(['Lit side facing us', `${Math.round(il.phase_fraction * 100)} %`]);
      } catch { /* not every body has a magnitude model */ }
      try { const eq = A.Equator(name(GALILEAN.includes(id) ? 'jupiter' : id), t, new A.Observer(0, 0, 0), false, true); rows.push(['In front of the stars of', A.Constellation(eq.ra, eq.dec).name]); } catch { /* ignore */ }
    }
    return rows;
  }
  function card(id) {
    const d = BODY[id];
    const credit = { sss: 'Map: Solar System Scope, from NASA imagery (Creative Commons Attribution 4.0)', nasa3d: 'Map: NASA 3D Resources, from Voyager and Galileo images (public domain)', bluemarble: 'Map: NASA Blue Marble and Black Marble (public domain)' }[d.credit];
    const venus = id === 'venus' ? `<button class="btn ghost" data-space-venus="1" aria-pressed="${st.venusSurface}">${st.venusSurface ? 'Show the clouds' : 'See the surface (radar)'}</button>` : '';
    const sharp = st.hires[id] === 'ok' ? '<p class="muted small">Showing NASA’s full global mosaic from the Solar System Treks tile service.</p>' : '';
    openNotes('Space', `
      <h3 class="withglyph"><span class="space-glyph" style="--c:${d.dot}">${esc(d.glyph)}</span><span>${esc(d.name)}</span></h3><p class="sub">${esc(d.kind)} · drag to turn, scroll to fly closer</p>
      ${factsHtml([...live(id), ...d.facts])}
      <p class="fold" tabindex="0" role="button" aria-expanded="false" title="Show the full text">${esc(d.about)}</p>
      <div class="quick">${venus}${id === 'sun' || id === 'moon' ? '<button class="btn ghost" data-eclipses="1">Eclipses</button>' : ''}<button class="btn ghost" data-space="earth">Back to Earth</button></div>
      ${sharp}
      <details class="more"><summary>Where the picture comes from</summary>
        <p class="small">${esc(credit ?? '')}. Position and spin: Astronomy Engine, computed in your browser for the time on the atlas clock (the time machine moves everything).</p>
        ${refsHtml(['astronomyengine', 'iaurotation', 'nssdcfacts', d.credit === 'nasa3d' ? 'nasa3d' : d.credit === 'bluemarble' ? 'bluemarble' : 'solarsystemscope', ...(d.trek ? ['nasatrek'] : [])])}
      </details>`, `space:${id}`);
  }
  /** v2.20 the solar system card: every planet, how far from the Sun it is now and how long its light takes. */
  function systemCard() {
    if (!st.ready) return;
    const sun = B.sun.pos; const rows = BAR.filter((id) => id !== 'sun' && id !== 'moon').map((id) => { const au = B[id].pos.distanceTo(sun) / AU; return { id, au, min: (au * 149597870.7) / 299792.458 / 60 }; });
    const fmtMin = (m) => (m < 60 ? `${m.toFixed(1)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
    openNotes('Space', `
      <h3 class="withglyph"><span class="space-glyph" style="--c:#ffd27a">☉</span><span>The solar system</span></h3><p class="sub">Where everything is now · drag to turn, right-drag or two fingers to slide, scroll to zoom · click a planet to fly there</p>
      <table class="sys-table"><thead><tr><th>Planet</th><th>From the Sun</th><th>Sunlight takes</th></tr></thead><tbody>${rows.map((r) => `<tr><td><button class="linkish" data-space="${r.id}"><i style="--c:${BODY[r.id].dot}"></i>${esc(BODY[r.id].name)}</button></td><td>${r.au.toFixed(2)} AU</td><td>${fmtMin(r.min)}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">1 astronomical unit (AU) is the Earth's average distance from the Sun, 149.6 million km. Everything is drawn to scale, so out here the planets are dots: even Jupiter is less than a pixel wide.</p>
      <p><b>Asteroid belt</b> (2.1–3.3 AU, between Mars and Jupiter) and <b>Kuiper belt</b> (39–48 AU, beyond Neptune, Pluto's home): drawn where they are, with the gaps Jupiter's pull clears in the asteroid belt, each rock going round at its own speed. The rocks are illustrative, not individual known asteroids.</p>
      <h4>The farthest spacecraft</h4>
      <table class="sys-table"><thead><tr><th>Spacecraft</th><th>From the Sun</th><th>Radio takes</th></tr></thead><tbody>${PROBES.map((p) => { const au = probeAU(p); return `<tr><td><button class="linkish" data-space-probe="${p.id}"><i style="--c:#7fe3c4"></i>${esc(p.name)}</button></td><td>about ${Math.round(au)} AU</td><td>${fmtMin((au * 149597870.7) / 299792.458 / 60)}</td></tr>`; }).join('')}</tbody></table>
      <p class="small muted">Zoom out (scroll) to find them, far beyond Pluto. Their places are worked out from published distances and speeds, good to about 1 AU.</p>
      <div class="quick"><button class="btn ghost" data-space="earth">Back to Earth</button></div>
      <details class="more"><summary>Where the positions come from</summary><p class="small">Astronomy Engine (VSOP87) computes every planet for the time on the atlas clock; press the time machine to set them moving. The belts use typical orbits (Kirkwood gaps at 2.50, 2.82 and 2.96 AU; the plutinos at 39.4 AU) after Minor Planet Center statistics.</p>${refsHtml(['astronomyengine', 'nssdcfacts', 'jplvoyager', 'newhorizons'])}</details>`, 'space:system');
  }
  /** v2.20 one of the far spacecraft. */
  function probeCard(id) {
    const p = PROBES.find((q) => q.id === id); if (!p) return; const au = probeAU(p); const km = au * 149597870.7;
    openNotes('Space', `
      <h3 class="withglyph"><span class="space-glyph" style="--c:#7fe3c4">✦</span><span>${esc(p.name)}</span></h3><p class="sub">Spacecraft · launched ${p.launched}</p>
      ${factsHtml([['From the Sun', `about ${Math.round(au)} AU (${(km / 1e9).toFixed(1)} billion km)`], ['Moving away at', `${(p.auYr * 149597870.7 / 31557600).toFixed(1)} km/s`], ['A radio signal takes', `${(km / 299792.458 / 3600).toFixed(1)} hours`]])}
      <p>${esc(p.note)}</p>
      <div class="quick"><button class="btn ghost" data-space="system">The solar system</button></div>
      <details class="more"><summary>Where this comes from</summary><p class="small">Distance on 1 January 2025 and cruise speed from the mission's published status, carried forward to the atlas clock; direction in the sky as seen from the Sun. Good to about 1 AU.</p>${refsHtml([p.ref])}</details>`, `space:${p.id}`);
  }
  document.addEventListener('click', (e) => {
    const pr = e.target.closest('[data-space-probe]'); if (pr) { probeCard(pr.dataset.spaceProbe); return; }
    const v = e.target.closest('[data-space-venus]'); if (v) { st.venusSurface = !st.venusSurface; card('venus'); wake?.(); return; }
    if (e.target.closest('[data-space-card]') && st.focus && st.focus !== 'earth') { if (st.focus === 'system') systemCard(); else card(st.focus); return; }
    const site = e.target.closest('[data-site]');
    if (site) { const [id, i] = site.dataset.site.split(':'); const x = LANDINGS[id]?.[+i]; if (x) { siteCard(id, +i); lookAtSite(id, x); } return; }
    if (e.target.closest('[data-eclipses]')) { eclipseCard(); return; }
    const ec = e.target.closest('[data-eclipse]'); if (ec) { const x = st.eclipses?.[+ec.dataset.eclipse]; if (x) watchEclipse?.(x); return; }
    const b = e.target.closest('[data-space]'); if (b) explore(b.dataset.space); // labels, the space bar, cards and Explore
  });

  // ---------------------------------------------------------------- v2.20 deep zoom: NASA Treks tiles where you look
  // The Treks maps are equirectangular tile pyramids (level z: 2^(z+1) × 2^z tiles of 256 px, row 0 at the north
  // pole). Close to a body that has one, a patch of 6 × 6 tiles at the level that matches your height (one map pixel
  // to about one screen pixel, down to the map's own resolution, trekMax) is laid over the globe map around the point
  // under the middle of the screen, and rebuilt as you move. Tiles that do not arrive leave the coarser map showing.
  const tileCache = new Map(); // url -> Promise<Image>
  const getTile = (url) => {
    if (!tileCache.has(url)) { tileCache.set(url, new Promise((ok, no) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = no; im.src = url; })); if (tileCache.size > 600) tileCache.delete(tileCache.keys().next().value); }
    return tileCache.get(url);
  };
  const patch = { id: null, key: '', mesh: null, cv: null, tex: null, at: 0, z: 0, tiles: 0, loaded: 0 };
  const N_T = 6;
  function dropPatch() { if (patch.mesh) { patch.mesh.geometry.dispose(); patch.mesh.removeFromParent(); patch.tex?.dispose(); } Object.assign(patch, { id: null, key: '', mesh: null, tex: null, tiles: 0, loaded: 0 }); }
  /** The point under the middle of the screen on a body: latitude and longitude (degrees, east positive) and height. */
  function underView(b) {
    const inv = new THREE.Matrix4().copy(b.mesh.matrixWorld).invert(); const p = cam.position.clone().applyMatrix4(inv); // unit-sphere space
    const f = b.def.flat ?? 1; const n = p.clone(); n.y /= f; n.normalize();
    return { lat: Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R, lng: Math.atan2(-n.z, n.x) / D2R, alt: cam.position.distanceTo(toWorld(b.pos, tmp)) - b.r };
  }
  function detail() {
    const id = st.focus; const b = B[id]; const d = b?.def;
    if (!d?.trek || !d.trekMax || st.fly) { if (patch.id && patch.id !== id) dropPatch(); return; }
    const now = performance.now(); if (now - patch.at < 400) return; patch.at = now;
    const v = underView(b); const viewPx = renderer.domElement.height / renderer.getPixelRatio();
    const mPerPx = (v.alt * 2 * Math.tan((cam.fov * D2R) / 2)) / viewPx; // ground units per screen pixel at the centre
    const z = Math.min(d.trekMax, Math.max(4, Math.ceil(Math.log2((2 * Math.PI * b.r) / (256 * mPerPx)) - 1)));
    if (z <= 4 || v.alt > b.r * 0.9) { if (patch.id) dropPatch(); return; } // far away: the global map is enough
    const span = 180 / 2 ** z; const cols = 2 ** (z + 1); const rows = 2 ** z;
    const cx = Math.floor((v.lng + 180) / span); const cy = Math.max(0, Math.min(rows - N_T, Math.floor((90 - v.lat) / span) - (N_T / 2 - 1)));
    const x0 = cx - (N_T / 2 - 1); const key = `${id}/${z}/${x0}/${cy}`;
    if (key === patch.key) return;
    dropPatch(); patch.id = id; patch.key = key; patch.z = z;
    const cv = document.createElement('canvas'); cv.width = cv.height = N_T * 256; const g = cv.getContext('2d');
    // start from the coarser map, so missing tiles never leave holes
    const base = b.mesh.material.uniforms.map.value.image;
    if (base?.width > 1) { const sx = ((x0 * span) / 360) * base.width; const sy = ((cy * span) / 180) * base.height; const sw = ((N_T * span) / 360) * base.width; const sh = ((N_T * span) / 180) * base.height; try { g.drawImage(base, sx, sy, sw, sh, 0, 0, cv.width, cv.height); } catch { /* a map from another origin without CORS */ } }
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = aniso; tex.colorSpace = b.mesh.material.uniforms.map.value.colorSpace ?? tex.colorSpace;
    // the patch: a piece of the unit sphere, a hair above the body's own surface, sharing its lighting
    const phi0 = ((x0 * span) / 360) * Math.PI * 2; const th0 = ((cy * span) / 180) * Math.PI; const dPhi = ((N_T * span) / 360) * Math.PI * 2; const dTh = ((N_T * span) / 180) * Math.PI;
    const geo = new THREE.SphereGeometry(1 + Math.min(2e-4, 0.3 / b.def.r), 64, 64, phi0, dPhi, th0, dTh);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...b.mesh.material.uniforms, map: { value: tex }, map2: { value: tex }, texW: { value: N_T * 256 }, grainF: { value: cols * 256 } }, vertexShader: BODY_VS, fragmentShader: BODY_FS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.userData.body = id; mesh.renderOrder = 1; b.mesh.add(mesh);
    Object.assign(patch, { mesh, cv, tex, tiles: N_T * N_T, loaded: 0 });
    for (let j = 0; j < N_T; j++) for (let i = 0; i < N_T; i++) {
      const tx = (((x0 + i) % cols) + cols) % cols; const ty = cy + j; const k = key;
      getTile(`${d.trek}/${z}/${ty}/${tx}.jpg`).then((im) => { if (patch.key !== k) return; g.drawImage(im, i * 256, j * 256, 256, 256); patch.loaded++; tex.needsUpdate = true; wake?.(); }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- sharper maps from NASA Solar System Treks
  // Level 3 of the Treks equirectangular tile pyramid is 16 × 8 tiles of 256 px: a 4096 × 2048 global map. Loaded
  // only when you fly in close; if the tiles do not arrive (or the server sends no CORS header), the bundled map stays.
  async function sharpen(id) {
    const d = BODY[id]; if (!d.trek || st.hires[id]) return; st.hires[id] = 'loading';
    const cols = 16; const rows = 8; const size = 256;
    const cv = document.createElement('canvas'); cv.width = cols * size; cv.height = rows * size; const g = cv.getContext('2d');
    const one = (y, x) => new Promise((ok, no) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { g.drawImage(im, x * size, y * size, size, size); ok(); }; im.onerror = no; im.src = `${d.trek}/3/${y}/${x}.jpg`; });
    try {
      await one(0, 0);
      const jobs = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (x || y) jobs.push([y, x]);
      for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map(([y, x]) => one(y, x)));
      const t = new THREE.CanvasTexture(cv); t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      B[id].mesh.material.uniforms.map.value = t; B[id].mesh.material.uniforms.texW.value = B[id].mesh.material.uniforms.grainF.value = cv.width; st.hires[id] = 'ok'; wake?.();
      if (st.focus === id) card(id);
    } catch { st.hires[id] = 'failed'; }
  }
  setInterval(() => { const f = st.focus; if (f && !st.fly && BODY[f]?.trek && B[f].px > 380) sharpen(f); }, 1500);

  // ---------------------------------------------------------------- start
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(() => loadEngine().then(() => { compute(); wake?.(); }));
  return active = {
    explore, leave: () => st.focus && explore('earth'), eclipses: () => eclipseCard(), eclipseList: () => (A ? eclipseList() : []),
    focus: () => st.focus, flying: () => !!st.fly,
    setDark(on) { st.dark = !!on; st.sky = !!on; wake?.(); },
    setBodies(on) { st.bodies = !!on; wake?.(); },
    setOrbits(on) { st.orbits = !!on; if (on && !orbitsBuilt && A) buildOrbits(st.t ?? A.MakeTime(now())); wake?.(); },
    /** Where a body is right now, for tests and the console: distance (km) and pixels across on screen. */
    info: (id) => (B[id] && st.ready ? { km: B[id].pos.length() / KM, px: B[id].px, visible: !!B[id].mesh?.visible } : null),
    ready: () => st.ready,
    debug: () => ({ cam, B, st, F, scene }),
    /** v2.20 the close-up patch of sharper map tiles, if one is showing: level, tiles asked for, tiles drawn. */
    patch: () => ({ id: patch.id, z: patch.z, tiles: patch.tiles, loaded: patch.loaded }),
    get stars() { return { set visible(v) { st.dark = !!v; st.sky = !!v; }, get visible() { return st.sky; } }; },
  };
}
