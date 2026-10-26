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
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const BODY_FS = `
  uniform sampler2D map; uniform sampler2D map2; uniform float mix2; uniform vec3 sunV; uniform vec4 atm;
  uniform float airless; uniform float ambient; uniform float sun; uniform float uT;
  uniform vec3 occV; uniform float occR; uniform float sunAng; uniform vec3 occRed;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  ${ECLIPSE_GLSL}
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV); vec3 l = normalize(sunV);
    vec2 uv = vUv;
    if (sun > 0.5) uv += 0.0025 * vec2(sin(vUv.y * 90.0 + uT * 0.35) + sin(vUv.x * 140.0 - uT * 0.2), cos(vUv.x * 120.0 + uT * 0.3));
    vec3 c = mix(texture2D(map, uv).rgb, texture2D(map2, uv).rgb, mix2);
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
  const tmp = new THREE.Vector3(); const tmp2 = new THREE.Vector3(); const mat3 = new THREE.Matrix3();

  // ---------------------------------------------------------------- the star sky (NASA Tycho star map, J2000 RA/Dec)
  const skyMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, gain: { value: 2.6 } }, vertexShader: SKY_VS, fragmentShader: SKY_FS, depthTest: false, depthWrite: false, side: THREE.BackSide });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat);
  // The map has right ascension 0 h in the middle growing to the right and declination +90° at the top; three.js
  // spheres put u = 0.5 on +x and the north pole on +y, so a 90° turn about x brings +y onto the J2000 pole.
  sky.rotation.x = Math.PI / 2; sky.frustumCulled = false; sky.renderOrder = -10; sky.visible = false; eqj.add(sky);
  loader.load('textures/space/stars-tycho.jpg', (t) => { t.anisotropy = aniso; skyMat.uniforms.map.value = t; sky.visible = true; wake?.(); });

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
          sun: { value: def.id === 'sun' ? 1 : 0 }, uT: { value: 0 },
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
    const set = (k, url) => loader.load(`textures/space/${url}`, (t) => { t.anisotropy = aniso; b.mesh.material.uniforms[k].value = t; wake?.(); });
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
  const DOTS = ORDER.filter((id) => id !== 'sun' && id !== 'earth');
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
  const orbitLines = () => [...helio.children, ...jovian.children, ...eqj.children.filter((o) => o.isLineSegments)];

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
        size[k] = id === 'moon' ? 7 : GALILEAN.includes(id) ? 3.2 : id === 'pluto' ? 3 : id === 'venus' || id === 'jupiter' ? 7.5 : 5.5;
        alpha[k] = showBodies ? (1 - smooth(1.2, 4, b.px)) * (GALILEAN.includes(id) ? smooth(4, 40, B.jupiter.px) : 1) : 0;
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
    glow.position.copy(sunWorld); glow.quaternion.copy(cam.quaternion); glow.scale.setScalar(sun.r * (st.focus === 'sun' ? 7 : 12));
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
  async function explore(id, { instant = false } = {}) {
    await loadEngine(); compute(); // fresh positions: the clock may just have jumped (an eclipse to watch)
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
    c.enabled = false; c.minDistance = (id === 'earth' ? R : b.r) * 1.04; c.maxDistance = (id === 'earth' ? R : b.r) * (id === 'sun' ? 40 : 400);
    // On phones the card would cover the body you flew to: it waits behind the ⓘ button in the space bar.
    if (id !== 'earth') { loadTex(b); if (matchMedia('(max-width: 860px)').matches) closeNotes?.(); else card(id); }
    bar(); onChange?.(id === 'earth' ? null : id); wake?.(ms + 1500);
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
    const p = toWorld(B[st.focus].pos, new THREE.Vector3());
    if (st.follow) { const d = p.clone().sub(st.follow); cam.position.add(d); }
    st.follow = p; st.ctl.target.copy(p); st.ctl.update();
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
      if (vis) {
        const p = id === 'earth' ? tmp.set(0, 0, 0) : toWorld(b.pos, tmp);
        ndc.copy(p).project(cam);
        if (ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) vis = false;
        // Hidden behind the Earth (globe view) or behind the body being explored.
        const occ = (cx, r) => { const d = tmp2.copy(p).sub(cpos); const len = d.length(); d.divideScalar(len); const oc = cx.clone().sub(cpos); const tca = oc.dot(d); if (tca < 0 || tca > len) return false; return oc.lengthSq() - tca * tca < r * r; };
        if (vis && !exploring && id !== 'earth' && occ(new THREE.Vector3(), earthR * 1.02)) vis = false;
        if (vis && exploring && st.focus !== 'earth' && occ(toWorld(B[st.focus].pos, new THREE.Vector3()), B[st.focus].r)) vis = false;
        if (vis) {
          const x = rect.left - host0.left + (ndc.x + 1) / 2 * rect.width; const y = rect.top - host0.top + (1 - ndc.y) / 2 * rect.height;
          const off = Math.min(60, b.px) + 6;
          el.style.transform = `translate(${x.toFixed(1)}px, ${(y + off).toFixed(1)}px) translate(-50%, 0)`;
        }
      }
      if (el.hidden === vis) el.hidden = !vis;
    }
    sites();
  }
  function hideLabels() { for (const id of ORDER) if (!L[id].hidden) L[id].hidden = true; siteLayer.hidden = true; }

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
    const id = hits[0]?.object.userData.body; if (id && id !== st.focus) explore(id);
  });

  // ---------------------------------------------------------------- the space bar and the card
  const barEl = document.createElement('div'); barEl.className = 'space-bar'; barEl.hidden = true; barEl.setAttribute('role', 'toolbar'); barEl.setAttribute('aria-label', 'Fly to a body in the solar system');
  host.appendChild(barEl);
  function bar() {
    barEl.hidden = !st.focus;
    if (!st.focus) return;
    barEl.innerHTML = `<button class="sb-home" data-space="earth" title="Back to the globe">← Earth</button><div class="sb-list">${BAR.filter((id) => id !== 'earth').map((id) => `<button data-space="${id}" aria-pressed="${st.focus === id || (id === 'jupiter' && GALILEAN.includes(st.focus))}" title="${esc(BODY[id].name)}"><i style="--c:${BODY[id].dot}"></i>${esc(BODY[id].name)}</button>`).join('')}</div><button class="sb-orbits" aria-pressed="${st.orbits}" title="Show the orbits">Orbits</button>${LANDINGS[st.focus] ? `<button class="sb-sites" aria-pressed="${st.sites}" title="Show where spacecraft landed">Landings</button>` : ''}<button class="sb-info" data-space-card="1" title="About ${esc(BODY[st.focus].name)}" aria-label="About ${esc(BODY[st.focus].name)}">ⓘ</button>`;
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
  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-space-venus]'); if (v) { st.venusSurface = !st.venusSurface; card('venus'); wake?.(); return; }
    if (e.target.closest('[data-space-card]') && st.focus && st.focus !== 'earth') { card(st.focus); return; }
    const site = e.target.closest('[data-site]');
    if (site) { const [id, i] = site.dataset.site.split(':'); const x = LANDINGS[id]?.[+i]; if (x) { siteCard(id, +i); lookAtSite(id, x); } return; }
    if (e.target.closest('[data-eclipses]')) { eclipseCard(); return; }
    const ec = e.target.closest('[data-eclipse]'); if (ec) { const x = st.eclipses?.[+ec.dataset.eclipse]; if (x) watchEclipse?.(x); return; }
    const b = e.target.closest('[data-space]'); if (b) explore(b.dataset.space); // labels, the space bar, cards and Explore
  });

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
      B[id].mesh.material.uniforms.map.value = t; st.hires[id] = 'ok'; wake?.();
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
    get stars() { return { set visible(v) { st.dark = !!v; st.sky = !!v; }, get visible() { return st.sky; } }; },
  };
}
