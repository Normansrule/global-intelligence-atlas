// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: many thick lines in ONE draw call.
// globe.gl draws every path as its own thick-line object: 90 undersea cables meant 90 draw calls every
// frame. Here each line segment is one instance of a small quad. The vertex shader projects both ends to the
// screen and widens the quad sideways by a fixed number of pixels, so lines stay crisp at every zoom.
import { THREE } from '../vendor/vendor.min.mjs';

const VERT = `
uniform vec2 resolution;
uniform float pxScale;
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec3 iColor;
attribute float iWidth;
varying vec3 vColor;
void main() {
  vColor = iColor;
  vec4 s = projectionMatrix * modelViewMatrix * vec4(iStart, 1.0);
  vec4 e = projectionMatrix * modelViewMatrix * vec4(iEnd, 1.0);
  if (s.w <= 0.0 || e.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 ss = s.xy / s.w; vec2 es = e.xy / e.w;
  vec2 d = (es - ss) * resolution;
  vec2 dir = length(d) > 0.0001 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec4 p = mix(s, e, position.y);
  p.xy += n * (iWidth * pxScale) * position.x / resolution * p.w;
  gl_Position = p;
}`;
const FRAG = `
uniform float opacity;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, opacity); }`;

const D2R = Math.PI / 180;
/** Great-circle points between two lat/lng pairs, at most `maxDeg` apart (straight chords would cut through the planet). */
function densify(a, b, maxDeg = 1.5) {
  const [la1, lo1] = a; const [la2, lo2] = b;
  const p1 = [Math.cos(la1 * D2R) * Math.cos(lo1 * D2R), Math.cos(la1 * D2R) * Math.sin(lo1 * D2R), Math.sin(la1 * D2R)];
  const p2 = [Math.cos(la2 * D2R) * Math.cos(lo2 * D2R), Math.cos(la2 * D2R) * Math.sin(lo2 * D2R), Math.sin(la2 * D2R)];
  const ang = Math.acos(Math.max(-1, Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2])));
  const n = Math.max(1, Math.ceil(ang / D2R / maxDeg)); const out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n; let x; let y; let z;
    if (ang < 1e-6) { x = p1[0]; y = p1[1]; z = p1[2]; } else {
      const s = Math.sin(ang); const w1 = Math.sin((1 - t) * ang) / s; const w2 = Math.sin(t * ang) / s;
      x = w1 * p1[0] + w2 * p2[0]; y = w1 * p1[1] + w2 * p2[1]; z = w1 * p1[2] + w2 * p2[2];
    }
    out.push([Math.asin(z) / D2R, Math.atan2(y, x) / D2R]);
  }
  return out;
}

/**
 * Build one object holding every line.
 * @param {(lat:number, lng:number, alt:number) => {x,y,z}} toXYZ   globe.getCoords
 * @param {{pts:[number,number][], color:string, width?:number, alt?:number}[]} lines
 * @returns {{ obj: THREE.Mesh, segs: {line:number, a:[number,number], b:[number,number]}[] }}
 */
export function buildFatLines(toXYZ, lines, { opacity = 0.9 } = {}) {
  const starts = []; const ends = []; const cols = []; const widths = []; const segs = [];
  const c = new THREE.Color();
  lines.forEach((ln, li) => {
    c.set(ln.color); const alt = ln.alt ?? 0.003; const w = ln.width ?? 1.5;
    for (let i = 0; i + 1 < ln.pts.length; i++) {
      let prev = ln.pts[i];
      for (const q of densify(ln.pts[i], ln.pts[i + 1])) {
        const A = toXYZ(prev[0], prev[1], alt); const B = toXYZ(q[0], q[1], alt);
        starts.push(A.x, A.y, A.z); ends.push(B.x, B.y, B.z); cols.push(c.r, c.g, c.b); widths.push(w);
        segs.push(li, prev[0], prev[1], q[0], q[1]);
        prev = q;
      }
    }
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  geo.setIndex([0, 2, 1, 2, 3, 1]);
  geo.setAttribute('iStart', new THREE.InstancedBufferAttribute(new Float32Array(starts), 3));
  geo.setAttribute('iEnd', new THREE.InstancedBufferAttribute(new Float32Array(ends), 3));
  geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(cols), 3));
  geo.setAttribute('iWidth', new THREE.InstancedBufferAttribute(new Float32Array(widths), 1));
  geo.instanceCount = widths.length;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { resolution: { value: new THREE.Vector2(1, 1) }, pxScale: { value: 1 }, opacity: { value: opacity } },
  });
  const obj = new THREE.Mesh(geo, mat);
  obj.frustumCulled = false; obj.raycast = () => {}; obj.renderOrder = 2;
  const size = new THREE.Vector2();
  obj.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(size); mat.uniforms.resolution.value.copy(size); mat.uniforms.pxScale.value = renderer.getPixelRatio(); };
  return { obj, segs: new Float32Array(segs) };
}

/** Nearest line to a point (km), checking every segment with a cheap bounding-box test first. */
export function nearestLine(segs, lat, lng, maxKm) {
  const dLat = maxKm / 111; const cosl = Math.max(0.05, Math.cos(lat * D2R)); const dLng = maxKm / (111 * cosl);
  let best = -1; let bestKm = maxKm;
  for (let i = 0; i < segs.length; i += 5) {
    const la1 = segs[i + 1]; const lo1 = segs[i + 2]; const la2 = segs[i + 3]; const lo2 = segs[i + 4];
    if (Math.abs(lo1 - lo2) > 180) continue; // crosses the date line: skip (rare, and harmless for hover)
    if (lat < Math.min(la1, la2) - dLat || lat > Math.max(la1, la2) + dLat || lng < Math.min(lo1, lo2) - dLng || lng > Math.max(lo1, lo2) + dLng) continue;
    // local flat projection around the cursor
    const ax = (lo1 - lng) * 111 * cosl; const ay = (la1 - lat) * 111; const bx = (lo2 - lng) * 111 * cosl; const by = (la2 - lat) * 111;
    const vx = bx - ax; const vy = by - ay; const L = vx * vx + vy * vy;
    const t = L > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L)) : 0;
    const km = Math.hypot(ax + t * vx, ay + t * vy);
    if (km < bestKm) { bestKm = km; best = segs[i]; }
  }
  return best < 0 ? null : { line: best, km: bestKm };
}
