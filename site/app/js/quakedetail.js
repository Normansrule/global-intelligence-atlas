// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: one earthquake in full depth.
// Click a quake and its card becomes an event page: how strong the shaking was and who felt it, the energy
// released, how deep it started (a cut-away through the crust and mantle), how the fault moved (the
// "beachball" seismologists draw from the moment tensor), when the first (P) and second (S) waves reached
// nearby and distant cities, the aftershock sequence, and how well the event is measured. On the globe the
// shaking contours from ShakeMap are drawn in their standard colours, the P and S wavefronts sweep outward
// at their real speeds (sped up 60 times) in one shader, and the foreshocks and aftershocks are marked.
// Everything comes live from the U.S. Geological Survey (USGS) ComCat detail feed and event query; the travel
// times, energy, rupture windows and fault type are worked out here from published formulas.
import { THREE } from '../vendor/vendor.min.mjs';
import { getFeed, getLocal } from './feeds.js';
import { haversineKm, bearingDeg } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- shaking (Modified Mercalli Intensity)
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const MMI_WORD = ['', 'Not felt', 'Weak', 'Weak', 'Light', 'Moderate', 'Strong', 'Very strong', 'Severe', 'Violent', 'Extreme', 'Extreme', 'Extreme'];
const MMI_SAYS = ['', 'Not felt by people.', 'Felt only by a few people at rest.', 'Felt indoors, like a passing lorry.', 'Felt by most indoors; dishes and windows rattle.',
  'Felt by nearly everyone; some dishes break, unstable objects fall.', 'Felt by all; heavy furniture moves, some plaster falls.',
  'Damage slight in well-built buildings, considerable in poorly built ones.', 'Considerable damage in ordinary buildings; chimneys and walls fall.',
  'Heavy damage even in well-designed buildings; buildings shift off foundations.', 'Most masonry and frame buildings destroyed.', 'Few structures left standing.', 'Damage total.'];
// The USGS ShakeMap colour scale, so the contours read the same as on the USGS site.
const MMI_COLOR = ['#ffffff', '#ffffff', '#bfccff', '#a0e6ff', '#80ffff', '#7aff93', '#ffff00', '#ffc800', '#ff9100', '#ff0000', '#c80000', '#800000', '#800000'];
export const mmiRoman = (v) => ROMAN[Math.max(1, Math.min(12, Math.round(v)))] ?? '';
export const mmiWord = (v) => MMI_WORD[Math.max(1, Math.min(12, Math.round(v)))] ?? '';
export const mmiColor = (v) => MMI_COLOR[Math.max(1, Math.min(12, Math.round(v)))];

// PAGER (Prompt Assessment of Global Earthquakes for Response) alert levels, by estimated fatalities.
const PAGER = { green: ['Green', 'no deaths estimated'], yellow: ['Yellow', 'estimated deaths 1 to 99'], orange: ['Orange', 'estimated deaths 100 to 999'], red: ['Red', 'estimated deaths 1,000 or more'] };

// ---------------------------------------------------------------- energy
/** Radiated energy in joules from magnitude: log10 E = 1.5 M + 4.8 (Gutenberg and Richter 1956). */
export const energyJ = (m) => 10 ** (1.5 * m + 4.8);
export function energyText(m) {
  const t = energyJ(m) / 4.184e9; // tonnes of TNT
  const amount = t >= 1e6 ? `${fmt(t / 1e6, t < 1e7 ? 1 : 0)} million tonnes of TNT` : t >= 1000 ? `${fmt(t / 1000, t < 1e4 ? 1 : 0)} thousand tonnes of TNT` : `${fmt(t, t < 10 ? 1 : 0)} tonnes of TNT`;
  const bombs = t / 15000; // the Hiroshima bomb: about 15 kilotonnes
  const like = bombs >= 1.5 ? `${fmt(bombs, bombs < 10 ? 1 : 0)} times the Hiroshima bomb` : bombs >= 0.5 ? 'about the Hiroshima bomb' : `${fmt(bombs * 100, 0)}% of the Hiroshima bomb`;
  return { amount, like, bombs };
}

// ---------------------------------------------------------------- travel times
// Surface-focus travel times (minutes) against distance (degrees), read from the IASP91 reference Earth
// (Kennett and Engdahl 1991). P waves bend round the core and leave a shadow from about 103° to 143°;
// S waves cannot cross the liquid outer core, so none arrive beyond about 103°.
const P_TT = [[0, 0], [1, 0.28], [2, 0.52], [5, 1.23], [10, 2.38], [15, 3.5], [20, 4.6], [25, 5.45], [30, 6.2], [40, 7.6], [50, 8.9], [60, 10.1], [70, 11.2], [80, 12.2], [90, 13.1], [100, 13.9], [103, 14.1]];
const PKP_TT = [[143, 19.5], [160, 19.9], [180, 20.2]];
const S_TT = [[0, 0], [1, 0.5], [2, 0.92], [5, 2.15], [10, 4.3], [15, 6.3], [20, 8.3], [25, 9.9], [30, 11.2], [40, 13.7], [50, 16.1], [60, 18.3], [70, 20.3], [80, 22.1], [90, 23.8], [100, 25.3], [103, 25.7]];
const interp = (tab, x, xi = 0, yi = 1) => {
  if (x <= tab[0][xi]) return tab[0][yi];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][xi]) { const a = tab[i - 1]; const b = tab[i]; return a[yi] + ((x - a[xi]) / (b[xi] - a[xi])) * (b[yi] - a[yi]); }
  return null;
};
/** Minutes after the quake that the first P and S waves reach a point `deg` degrees away (null: none arrive). */
export function arrivals(deg) {
  const p = deg <= 103 ? interp(P_TT, deg) : deg >= 143 ? interp(PKP_TT, deg) : null;
  const s = deg <= 103 ? interp(S_TT, deg) : null;
  return { p, s, shadow: deg > 103 && deg < 143 };
}
/** How far (degrees) each wavefront has travelled `min` minutes after the quake. */
function fronts(min) {
  const p = min <= 14.1 ? interp(P_TT, min, 1, 0) : 103;
  const s = min <= 25.7 ? interp(S_TT, min, 1, 0) : -1;
  const pkp = min >= 19.5 && min <= 20.2 ? interp(PKP_TT, min, 1, 0) : -1;
  return { p: min <= 14.1 ? p : -1, s, pkp };
}
const mmss = (min) => (min < 1 ? `${Math.round(min * 60)} s` : `${Math.floor(min)} min ${String(Math.round((min % 1) * 60)).padStart(2, '0')} s`);

// ---------------------------------------------------------------- the sequence window
/** Gardner and Knopoff (1974) window: how far (km) and how long (days) aftershocks of magnitude m are counted. */
export function sequenceWindow(m) {
  const km = 10 ** (0.1238 * m + 0.983);
  const days = m >= 6.5 ? 10 ** (0.032 * m + 2.7389) : 10 ** (0.5409 * m - 0.547);
  return { km, days };
}

// ---------------------------------------------------------------- fault
const normRake = (r) => { let x = ((r + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
/** The kind of faulting from the rake (direction of slip on the fault plane), in words. */
export function faultType(rake) {
  const r = normRake(rake);
  if (r >= 45 && r <= 135) return { kind: 'thrust', name: 'Thrust (reverse) fault', says: 'one block was pushed up and over the other: the squeeze of plates colliding, as in most of the largest earthquakes.' };
  if (r <= -45 && r >= -135) return { kind: 'normal', name: 'Normal fault', says: 'one block slid down away from the other: the crust is being stretched, as in rifts and behind ocean trenches.' };
  const left = Math.abs(r) < 45;
  return { kind: 'strike-slip', name: `Strike-slip fault (${left ? 'left' : 'right'}-lateral)`, says: `the blocks slid sideways past each other; standing on one side, the other moved to your ${left ? 'left' : 'right'}, as on the San Andreas or the North Anatolian faults.` };
}

/**
 * Draw a focal mechanism ("beachball"): the lower half of a sphere round the source, seen from above in an
 * equal-area projection, shaded where the first motion of the P wave pushes outward (compression).
 * Fault normal and slip vectors from Aki and Richards (2002), north-east-down axes.
 */
export function drawBeachball(canvas, strike, dip, rake, ink, paper) {
  const N = canvas.width; const g = canvas.getContext('2d'); const img = g.createImageData(N, N);
  const [s, d, r] = [strike * D2R, dip * D2R, rake * D2R];
  const n = [-Math.sin(d) * Math.sin(s), Math.sin(d) * Math.cos(s), -Math.cos(d)];
  const u = [Math.cos(r) * Math.cos(s) + Math.cos(d) * Math.sin(r) * Math.sin(s), Math.cos(r) * Math.sin(s) - Math.cos(d) * Math.sin(r) * Math.cos(s), -Math.sin(r) * Math.sin(d)];
  const rgb = (css) => { g.fillStyle = '#000'; g.fillStyle = css; const h = g.fillStyle; return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : (h.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map(Number); };
  const c1 = rgb(ink); const c0 = rgb(paper); const R = N / 2 - 1.5;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5 - N / 2) / R; const py = (N / 2 - y - 0.5) / R; const rr = Math.hypot(px, py); const k = (y * N + x) * 4;
    if (rr > 1) { img.data[k + 3] = 0; continue; }
    const inc = 2 * Math.asin(Math.min(1, rr / Math.SQRT2)); const az = Math.atan2(px, py); // equal-area: r = √2 sin(i/2)
    const v = [Math.sin(inc) * Math.cos(az), Math.sin(inc) * Math.sin(az), Math.cos(inc)];
    const amp = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) * (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
    const c = amp > 0 ? c1 : c0; const edge = Math.min(1, (1 - rr) * R); // soft rim
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255 * Math.max(0, edge);
  }
  g.putImageData(img, 0, 0);
  g.beginPath(); g.arc(N / 2, N / 2, R, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = ink; g.stroke();
}

// ---------------------------------------------------------------- depth cut-away
/** An SVG cut-away from the surface down past the hypocentre, with the crust and mantle layers marked. */
export function depthSvg(depth) {
  const max = depth < 60 ? 80 : depth < 250 ? 320 : 720; const W = 300; const H = 132; const top = 18; const y = (km) => top + (km / max) * (H - top - 8);
  const bands = [[0, 35, 'Crust', 'var(--qd-crust)'], [35, 410, 'Upper mantle', 'var(--qd-mantle)'], [410, 660, 'Transition zone', 'var(--qd-tz)'], [660, 2900, 'Lower mantle', 'var(--qd-lower)']];
  let g = '';
  for (const [a, b, name, fill] of bands) {
    if (a >= max) break; const y0 = y(a); const y1 = y(Math.min(b, max));
    g += `<rect x="0" y="${y0.toFixed(1)}" width="${W}" height="${(y1 - y0).toFixed(1)}" fill="${fill}"/>`;
    if (y1 - y0 > 14) g += `<text x="${W - 6}" y="${(y0 + 12).toFixed(1)}" text-anchor="end" class="qd-band">${name}</text>`;
  }
  const ticks = max === 80 ? [0, 20, 40, 60, 80] : max === 320 ? [0, 100, 200, 300] : [0, 200, 400, 600];
  for (const t of ticks) g += `<text x="4" y="${(y(t) + (t === 0 ? 11 : 4)).toFixed(1)}" class="qd-tick">${t} km</text>`;
  const hy = y(Math.max(0, depth)); const cx = W * 0.56;
  g += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${hy.toFixed(1)}" class="qd-drop"/>`;
  g += `<path d="M${cx - 6} ${top - 9} L${cx + 6} ${top - 9} L${cx} ${top - 1} Z" class="qd-epi"/><text x="${cx + 10}" y="${top - 3}" class="qd-tick">epicentre</text>`;
  g += `<circle cx="${cx}" cy="${hy.toFixed(1)}" r="6" class="qd-hypo"/><circle cx="${cx}" cy="${hy.toFixed(1)}" r="6" class="qd-hypo-ring"/>`;
  g += `<text x="${cx + 12}" y="${(hy + 4).toFixed(1)}" class="qd-label">${fmt(depth, depth < 10 ? 1 : 0)} km</text>`;
  return `<svg class="qd-depth" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cut-away: the earthquake started ${fmt(depth, 1)} km below the surface">${g}<line x1="0" y1="${top}" x2="${W}" y2="${top}" class="qd-surface"/></svg>`;
}
const depthWords = (km) => {
  const kind = km < 70 ? 'shallow' : km < 300 ? 'intermediate-depth' : 'deep';
  const cmp = km < 12.3 ? `about as deep as the deepest hole ever drilled (12.3 km, Kola)` : `${fmt(km / 8.85, 0)} times as deep as Everest is high`;
  return `A ${kind} earthquake, ${cmp}.${km >= 70 ? ' Quakes this deep happen inside a slab of ocean floor sinking into the mantle.' : ' Shallow quakes shake the surface hardest.'}`;
};

// ---------------------------------------------------------------- the open event (shared with the globe)
export const qd = { id: null, contours: null, seq: null, wave: null, fat: null, labels: [] };

// One shader on a shell just above the ground draws the P and S wavefronts by their angle from the epicentre,
// so both waves cost one draw call whatever their size, and stay true to the globe's curvature.
const WAVE_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WAVE_FRAG = `
uniform vec3 uEpi; uniform float uP, uS, uK, uShadow; uniform vec3 uPc, uSc;
varying vec3 vDir;
float band(float a, float r, float w) { return r < 0.0 ? 0.0 : smoothstep(w, 0.0, abs(a - r)); }
void main() {
  float a = acos(clamp(dot(vDir, uEpi), -1.0, 1.0));
  float w = 0.012;
  float p = max(band(a, uP, w), band(a, uK, w)); float s = band(a, uS, w);
  float trail = (uP > 0.0 && a < uP) ? 0.06 * (1.0 - a / max(uP, 1e-3)) : 0.0;          // a faint wash behind the P front
  float sh = (a > 1.798 && a < 2.496) ? uShadow * 0.16 : 0.0;                              // the P-wave shadow zone, 103° to 143°
  vec3 col = uPc * p + uSc * s + uPc * trail + vec3(0.04, 0.05, 0.09) * sh * 4.0;
  float al = max(max(p, s) * 0.95, max(trail, sh));
  if (al < 0.01) discard;
  gl_FragColor = vec4(col / max(al, 1e-3) * min(1.0, al * 1.4), al);
}`;
const SPEED = 60; // the waves are shown 60 times faster than real
function makeWave(globe, lat, lng) {
  const c = globe.getCoords(lat, lng, 0); const R = Math.hypot(c.x, c.y, c.z);
  const geo = new THREE.SphereGeometry(R * 1.0035, 128, 96);
  const uni = { uEpi: { value: new THREE.Vector3(c.x, c.y, c.z).normalize() }, uP: { value: -1 }, uS: { value: -1 }, uK: { value: -1 }, uShadow: { value: 0 },
    uPc: { value: new THREE.Color('#ffd166') }, uSc: { value: new THREE.Color('#ff6b5a') } };
  const mat = new THREE.ShaderMaterial({ vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, uniforms: uni, transparent: true, depthWrite: false });
  const obj = new THREE.Mesh(geo, mat); obj.raycast = () => {}; obj.renderOrder = 4;
  const t0 = performance.now(); const loopMin = 27; // play to just past the last S arrival, then start again
  const state = { obj, animating: true, minute: 0 };
  obj.onBeforeRender = () => {
    const min = (((performance.now() - t0) / 1000) * SPEED / 60) % loopMin; state.minute = min;
    const f = fronts(min);
    uni.uP.value = f.p < 0 ? -1 : f.p * D2R; uni.uS.value = f.s < 0 ? -1 : f.s * D2R; uni.uK.value = f.pkp < 0 ? -1 : f.pkp * D2R;
    uni.uShadow.value = min > 14.1 ? Math.min(1, (min - 14.1) / 2) : 0;
    const el = document.getElementById('qd-clock'); if (el) el.textContent = `${mmss(min)} after the quake`;
  };
  return state;
}

// ---------------------------------------------------------------- data
let CITIES = null; let PLATES = null;
async function cities() {
  if (!CITIES) { const c = await getLocal('data/cities.json'); CITIES = c.rows.map(([name, lat, lng, pop, capital, cc]) => ({ name, lat, lng, pop, capital, cc })); }
  return CITIES;
}
async function nearestBoundary(lat, lng, plateLabel) {
  PLATES ??= await getLocal('data/plate-boundaries.json');
  let best = null;
  for (const f of PLATES.features) {
    const cs = f.geometry?.coordinates ?? [];
    for (let i = 0; i < cs.length; i += 2) { const [x, y] = cs[i]; if (Math.abs(y - lat) > 12) continue; const km = haversineKm(lat, lng, y, x); if (!best || km < best.km) best = { km, name: f.properties.Name }; }
  }
  return best && { km: best.km, label: String(plateLabel(best.name)).replace(/\s*boundary$/i, '') };
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Point in a closed ring of [lng, lat] (ray casting). */
function inRing(r, lat, lng) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; }
/** ShakeMap contours → [{mmi, lines: [[lng, lat]...]}]. Handles LineString, MultiLineString and polygons. */
function contourLines(j) {
  const out = [];
  for (const f of j?.features ?? []) {
    const v = +(f.properties?.value ?? f.properties?.mmi ?? f.properties?.level); if (!Number.isFinite(v)) continue;
    const g = f.geometry; if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    out.push({ mmi: v, lines: lines.filter((l) => l.length > 1) });
  }
  return out;
}
/** The estimated shaking at a place: the strongest closed contour it falls inside. */
function shakingAt(cont, lat, lng) {
  let best = 0;
  for (const c of cont ?? []) if (c.mmi > best) for (const l of c.lines) { const [a, b] = [l[0], l[l.length - 1]]; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && inRing(l, lat, lng)) { best = c.mmi; break; } }
  return best;
}
const prod = (d, k) => d?.properties?.products?.[k]?.[0];
const num = (x) => (x == null || x === '' || !Number.isFinite(+x) ? null : +x);

// ---------------------------------------------------------------- the card
/** The parts of the card that need no network, drawn the moment it opens. */
export function quakeHead(f) {
  const p = f.properties; const [, , depth] = f.geometry.coordinates; const m = p.mag ?? 0;
  const shake = num(p.mmi) ?? num(p.cdi);
  const alert = PAGER[p.alert];
  const e = energyText(m);
  const line = [shake ? `${mmiWord(shake)} shaking at worst` : null, p.felt ? `felt by ${fmt(p.felt)} ${p.felt === 1 ? 'person' : 'people'} who reported it` : null].filter(Boolean).join(', ');
  const ago = (Date.now() - p.time) / 3600_000;
  const when = ago < 1 ? `${Math.max(1, Math.round(ago * 60))} minutes ago` : ago < 48 ? `${Math.round(ago)} hours ago` : `${Math.round(ago / 24)} days ago`;
  return `
    <div class="qd" data-quake="${esc(f.id)}">
      <p class="qd-line">${esc(when)}${line ? ` · ${esc(line)}` : ''}.</p>
      ${alert ? `<p class="qd-alert qd-${esc(p.alert)}"><b>${alert[0]} alert</b> from PAGER (Prompt Assessment of Global Earthquakes for Response): ${alert[1]}.</p>` : ''}
      ${p.tsunami ? '<p class="qd-alert qd-tsunami"><b>Tsunami flag:</b> a large quake under or near the sea. It does not mean a tsunami exists; check your national warning centre.</p>' : ''}
      <div class="lm-facts qd-facts">
        <div class="lm-fact"><b>M${m.toFixed(1)}</b><small>${esc(p.magType ? `magnitude (${p.magType})` : 'magnitude')}</small></div>
        <div class="lm-fact"><b>${fmt(depth, depth < 10 ? 1 : 0)} km</b><small>deep</small></div>
        <div class="lm-fact"><b>${shake ? mmiRoman(shake) : '—'}</b><small>${shake ? `${esc(mmiWord(shake).toLowerCase())} shaking` : 'shaking not mapped yet'}</small></div>
        <div class="lm-fact"><b>${fmt(p.felt ?? 0)}</b><small>said they felt it</small></div>
      </div>
      <details class="qd-sec" open><summary><span>How big</span><small>${esc(e.like)}</small></summary>
        <p>It released about ${esc(e.amount)} of energy as seismic waves, ${esc(e.like)}. Each whole step up in magnitude is about 32 times more energy.</p>
        ${energyBar(m)}
      </details>
      <details class="qd-sec" open><summary><span>How deep</span><small>${fmt(depth, depth < 10 ? 1 : 0)} km down</small></summary>
        ${depthSvg(depth)}<p>${esc(depthWords(depth))}</p>
      </details>
      <div id="qd-more"><p class="muted qd-wait">Asking the USGS for the fault, the shaking map and the aftershocks…</p></div>
    </div>`;
}
/** A log scale from M2 to M9 with this quake marked and familiar ones for comparison. */
function energyBar(m) {
  const x = (v) => ((Math.max(2, Math.min(9.5, v)) - 2) / 7.5) * 100;
  const marks = [[3, 'felt'], [6, 'damaging'], [9.1, 'Japan 2011']];
  return `<div class="qd-scale" role="img" aria-label="Magnitude ${m.toFixed(1)} on a scale from 2 to 9.5">
    <div class="qd-scale-bar"><span style="width:${x(m).toFixed(1)}%"></span></div>
    ${marks.map(([v, t]) => `<i style="left:${x(v).toFixed(1)}%" title="M${v}">${esc(t)} <small>M${v}</small></i>`).join('')}
    <b style="left:${x(m).toFixed(1)}%">M${m.toFixed(1)}</b></div>`;
}

/** Fill in the network parts: the fault, the shaking, the waves, the sequence and the quality of the solution. */
export async function quakeFill(f, { stillOpen, refresh, plateLabel, globe }) {
  const p = f.properties; const [lng, lat, depth] = f.geometry.coordinates; const m = p.mag ?? 0;
  if (qd.id !== f.id) { qd.fat?.obj?.geometry?.dispose?.(); Object.assign(qd, { id: f.id, contours: null, seq: null, fat: null, labels: [], wave: null }); }
  qd.wave?.obj?.geometry?.dispose?.(); qd.wave = makeWave(globe, lat, lng);
  refresh();
  const win = sequenceWindow(m);
  const start = new Date(p.time - 7 * 86400_000).toISOString().slice(0, 19); const endT = Math.min(Date.now(), p.time + Math.min(365, win.days) * 86400_000);
  const seqUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&maxradiuskm=${Math.max(10, win.km).toFixed(0)}&starttime=${start}&endtime=${new Date(endT).toISOString().slice(0, 19)}&minmagnitude=${Math.max(1.5, Math.min(2.5, m - 2.5)).toFixed(1)}&orderby=time-asc&limit=2000`;
  const [detail, seq, cs, plate] = await Promise.all([
    p.detail ? getFeed('usgs', p.detail, { ttl: 10 * 60_000 }).catch(() => null) : null,
    getFeed('usgs', seqUrl, { ttl: 10 * 60_000 }).catch(() => null),
    cities().catch(() => []),
    nearestBoundary(lat, lng, plateLabel).catch(() => null),
  ]);
  if (!stillOpen()) return;
  const sm = prod(detail, 'shakemap'); const cUrl = sm?.contents?.['download/cont_mmi.json']?.url ?? sm?.contents?.['download/cont_mi.json']?.url;
  const cont = cUrl ? contourLines(await getFeed('usgs', cUrl, { ttl: 30 * 60_000 }).catch(() => null)) : null;
  if (!stillOpen()) return;
  qd.contours = cont?.length ? cont : null;
  qd.seq = (seq?.features ?? []).filter((x) => x.id !== f.id && Math.abs(x.properties.time - p.time) > 1000);
  const el = document.getElementById('qd-more'); if (!el) return;
  el.innerHTML = [faultHtml(detail, plate), shakeHtml(detail, p, qd.contours, cs, lat, lng), wavesHtml(cs, lat, lng, depth), seqHtml(qd.seq, f, win), qualityHtml(detail, p)].filter(Boolean).join('');
  const cv = el.querySelector('canvas.qd-ball');
  if (cv) { const st = getComputedStyle(document.documentElement); drawBeachball(cv, +cv.dataset.s, +cv.dataset.d, +cv.dataset.r, st.getPropertyValue('--ink').trim() || '#1d2433', st.getPropertyValue('--panel').trim() || '#ffffff'); }
  refresh();
}

function faultHtml(detail, plate) {
  const mt = prod(detail, 'moment-tensor') ?? prod(detail, 'focal-mechanism'); const q = mt?.properties ?? {};
  const s = num(q['nodal-plane-1-strike']); const d = num(q['nodal-plane-1-dip']); const r = num(q['nodal-plane-1-rake'] ?? q['nodal-plane-1-slip']);
  const where = plate ? (plate.km < 40 ? `On the ${plate.label} plate boundary.` : `${fmt(plate.km)} km from the ${plate.label} plate boundary${plate.km > 400 ? ', inside a plate, where quakes are rarer' : ''}.`) : '';
  if (s == null || d == null || r == null) return where ? `<details class="qd-sec" open><summary><span>Where it sits</span><small>${esc(plate.km < 40 ? 'on a plate boundary' : `${fmt(plate.km)} km from a boundary`)}</small></summary><p>${esc(where)} No fault solution has been published for this one yet; they come for most quakes above magnitude 4.5 within an hour or so.</p></details>` : '';
  const ft = faultType(r); const s2 = num(q['nodal-plane-2-strike']); const d2 = num(q['nodal-plane-2-dip']); const r2 = num(q['nodal-plane-2-rake'] ?? q['nodal-plane-2-slip']);
  const mw = num(q['derived-magnitude']); const m0 = num(q['scalar-moment']); const dc = num(q['percent-double-couple']);
  return `<details class="qd-sec" open><summary><span>How the fault moved</span><small>${esc(ft.name.split(' (')[0].toLowerCase())}</small></summary>
    <div class="qd-fault"><canvas class="qd-ball" width="112" height="112" data-s="${s}" data-d="${d}" data-r="${r}" role="img" aria-label="Beachball diagram of a ${esc(ft.name.toLowerCase())}"></canvas>
    <div><p><b>${esc(ft.name)}:</b> ${esc(ft.says)}</p>
    <p class="qd-small">Fault plane: strike ${fmt(s)}°, dip ${fmt(d)}°, rake ${fmt(r)}°${s2 != null ? `; or the other plane: ${fmt(s2)}°, ${fmt(d2)}°, ${fmt(r2)}°` : ''}.${m0 ? ` Seismic moment ${(m0).toExponential(1).replace('e+', ' × 10^')} newton-metres` : ''}${mw ? ` (Mw ${mw.toFixed(1)})` : ''}${dc != null ? `, ${fmt(dc <= 1 ? dc * 100 : dc)}% double couple` : ''}.</p></div></div>
    <p class="qd-small">The ball is the sphere round the start of the rupture seen from above: shaded where the ground was first pushed away, light where it was first pulled in. The two lines between them are the two planes the fault could lie on.</p>
    ${where ? `<p>${esc(where)}</p>` : ''}</details>`;
}

function shakeHtml(detail, p, cont, cs, lat, lng) {
  const sm = prod(detail, 'shakemap')?.properties ?? {}; const dy = prod(detail, 'dyfi')?.properties ?? {};
  const max = num(sm.maxmmi) ?? num(p.mmi); const dyMax = num(dy.maxmmi) ?? num(p.cdi); const resp = num(dy['num-responses'] ?? dy.numResp) ?? num(p.felt);
  const near = (cs ?? []).map((c) => ({ ...c, km: haversineKm(lat, lng, c.lat, c.lng) })).filter((c) => c.km < 600 && c.pop > 20000).sort((a, b) => a.km - b.km).slice(0, 5);
  if (!max && !dyMax && !near.length) return '';
  const rows = near.map((c) => { const i = cont ? shakingAt(cont, c.lat, c.lng) : 0; return `<li><span class="qd-mmi" style="--c:${i ? mmiColor(i) : 'transparent'}">${i ? mmiRoman(i) : ''}</span><b>${esc(c.name)}</b><small>${fmt(c.km)} km ${esc(dirWord(bearingDeg(lat, lng, c.lat, c.lng)))} · ${fmt(c.pop)} people${i ? ` · ${esc(mmiWord(i).toLowerCase())}` : ''}</small></li>`; }).join('');
  const legend = cont ? `<div class="qd-legend">${[...new Set(cont.map((c) => Math.round(c.mmi)))].sort((a, b) => a - b).map((v) => `<span style="--c:${mmiColor(v)}" title="${esc(MMI_SAYS[v] ?? '')}">${mmiRoman(v)}</span>`).join('')}<small>shaking contours on the globe</small></div>` : '';
  return `<details class="qd-sec" open><summary><span>Shaking</span><small>${max ? `${mmiRoman(max)}, ${esc(mmiWord(max).toLowerCase())}` : dyMax ? `${mmiRoman(dyMax)} reported` : 'not mapped'}</small></summary>
    ${max ? `<p>At its strongest: <b>${mmiRoman(max)} ${esc(mmiWord(max).toLowerCase())}</b>. ${esc(MMI_SAYS[Math.round(max)] ?? '')}</p>` : ''}
    ${resp ? `<p>${fmt(resp)} people sent a “Did You Feel It?” report${dyMax ? `; the strongest they described was ${mmiRoman(dyMax)}` : ''}.</p>` : ''}
    ${legend}
    ${rows ? `<ul class="qd-cities">${rows}</ul>` : ''}</details>`;
}

function wavesHtml(cs, lat, lng, depth) {
  if (!cs?.length) return '';
  const withKm = cs.map((c) => ({ ...c, km: haversineKm(lat, lng, c.lat, c.lng) }));
  const near = withKm.filter((c) => c.pop > 300000).sort((a, b) => a.km - b.km)[0];
  const far = ['London', 'New York', 'Tokyo', 'Sydney', 'São Paulo', 'Johannesburg'].map((n) => withKm.find((c) => c.name === n)).filter(Boolean).sort((a, b) => a.km - b.km);
  const list = [near, ...far.filter((c) => c !== near)].filter(Boolean).slice(0, 5);
  const dz = depth / 6.5 / 60; // a little extra for the waves to climb from depth to the surface
  const row = (c) => { const deg = c.km / 111.195; const a = arrivals(deg); return `<tr><th>${esc(c.name)}</th><td>${fmt(c.km)} km</td><td>${a.p != null ? mmss(a.p + dz) : a.shadow ? '<span title="In the shadow of the core: only faint waves bent round it arrive">shadow</span>' : '—'}</td><td>${a.s != null ? mmss(a.s + dz * 1.7) : '—'}</td></tr>`; };
  return `<details class="qd-sec" open><summary><span>The waves</span><small id="qd-clock">sweeping out on the globe</small></summary>
    <p>On the globe the first waves (P, <span class="qd-key qd-p"></span>) and the slower shear waves (S, <span class="qd-key qd-s"></span>) spread out 60 times faster than real. S waves cannot cross the liquid outer core, and P waves leave a shadow from 103° to 143° away.</p>
    <table class="qd-waves"><thead><tr><th></th><th>Distance</th><th>P arrives</th><th>S arrives</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></details>`;
}

function seqHtml(seq, f, win) {
  if (!seq) return '';
  const t0 = f.properties.time; const m0 = f.properties.mag ?? 0;
  const after = seq.filter((x) => x.properties.time > t0); const before = seq.filter((x) => x.properties.time < t0);
  const big = after.reduce((b, x) => (!b || (x.properties.mag ?? 0) > (b.properties.mag ?? 0) ? x : b), null);
  const bigger = after.some((x) => (x.properties.mag ?? 0) > m0) || before.some((x) => (x.properties.mag ?? 0) > m0);
  const W = 300; const H = 86; const days = Math.max(1, (Math.min(Date.now(), t0 + win.days * 86400_000) - (t0 - 7 * 86400_000)) / 86400_000);
  const xs = (t) => ((t - (t0 - 7 * 86400_000)) / 86400_000 / days) * (W - 20) + 10; const ys = (mm) => H - 14 - ((Math.min(9, mm) - 1.5) / 7.5) * (H - 24);
  const dots = seq.map((x) => `<circle cx="${xs(x.properties.time).toFixed(1)}" cy="${ys(x.properties.mag ?? 2).toFixed(1)}" r="${Math.max(1.6, (x.properties.mag ?? 2) - 1.2).toFixed(1)}" class="qd-dot${x.properties.time < t0 ? ' qd-fore' : ''}"/>`).join('');
  const main = `<circle cx="${xs(t0).toFixed(1)}" cy="${ys(m0).toFixed(1)}" r="${Math.max(3, m0 - 1).toFixed(1)}" class="qd-main"/>`;
  const svg = `<svg class="qd-seq" viewBox="0 0 ${W} ${H}" role="img" aria-label="${after.length} aftershocks and ${before.length} foreshocks by time and magnitude"><line x1="10" y1="${H - 12}" x2="${W - 10}" y2="${H - 12}" class="qd-axis"/>${dots}${main}<text x="10" y="${H - 1}" class="qd-tick">7 days before</text><text x="${W - 10}" y="${H - 1}" text-anchor="end" class="qd-tick">${t0 + win.days * 86400_000 > Date.now() ? 'now' : `${fmt(win.days)} days after`}</text></svg>`;
  const bath = big ? ` The largest, M${(big.properties.mag ?? 0).toFixed(1)}, was ${(m0 - (big.properties.mag ?? 0)).toFixed(1)} below the main shock; on average the biggest aftershock is about 1.2 smaller (Båth's law).` : '';
  return `<details class="qd-sec" open><summary><span>Aftershocks</span><small>${fmt(after.length)} so far</small></summary>
    <p>${after.length ? `${fmt(after.length)} aftershock${after.length === 1 ? '' : 's'}` : 'No aftershocks catalogued yet'}${before.length ? ` and ${fmt(before.length)} foreshock${before.length === 1 ? '' : 's'}` : ''} within ${fmt(win.km)} km.${bath}${bigger ? ' A bigger quake followed or came before, so this one may itself be a foreshock or an aftershock.' : ''}</p>
    ${seq.length ? svg : ''}<p class="qd-small">Counted within the window Gardner and Knopoff (1974) give for this magnitude: ${fmt(win.km)} km and ${fmt(Math.min(365, win.days))} days. They are ringed on the globe.</p></details>`;
}

function qualityHtml(detail, p) {
  const o = prod(detail, 'origin')?.properties ?? {};
  const st = num(o['num-stations-used']) ?? num(p.nst); const gap = num(o['azimuthal-gap']) ?? num(p.gap); const herr = num(o['horizontal-error']); const rev = o['review-status'] ?? p.status;
  if (st == null && gap == null && !rev) return '';
  const bits = [rev ? (String(rev).toLowerCase() === 'reviewed' ? 'Checked by a seismologist' : 'Located automatically; it may still change') : null,
    st != null ? `${fmt(st)} seismic stations used` : null, gap != null ? `the largest gap between them seen from the quake is ${fmt(gap)}°${gap > 180 ? ' (all on one side, so the position is less certain)' : ''}` : null, herr != null ? `position good to about ${fmt(herr, 1)} km` : null].filter(Boolean);
  return `<details class="qd-sec"><summary><span>How well it is measured</span><small>${esc(bits[0] ?? '')}</small></summary><p>${esc(bits.join('; '))}.</p>
    <p class="qd-small">Each station times the arrival of the P and S waves; the gap between them gives the distance, and several stations together fix the place and depth.</p></details>`;
}

/** What the open quake adds to the globe: shaking contours (one draw call), the wavefronts and the sequence. */
export function quakeChannels(ctx, sel) {
  const out = { custom: [], points: [], labels: [] };
  if (!sel || sel.d?.id !== qd.id) return out;
  if (qd.contours && !qd.fat) {
    const lines = []; const labels = [];
    for (const c of qd.contours) for (const l of c.lines) {
      lines.push({ pts: l.map(([x, y]) => [y, x]), color: mmiColor(c.mmi), width: c.mmi >= 6 ? 2 : 1.4, alt: 0.0035 });
      if (l.length > 8 && labels.length < 24) { const [x, y] = l[Math.floor(l.length / 3)]; labels.push({ lat: y, lng: x, text: mmiRoman(c.mmi), size: 0.6, color: mmiColor(c.mmi), dot: 0 }); }
    }
    qd.fat = lines.length ? ctx.fatLines(lines, { opacity: 0.9 }) : null; qd.labels = labels;
  }
  if (qd.fat) out.custom.push(qd.fat);
  if (qd.wave) out.custom.push(qd.wave);
  out.labels = qd.labels;
  for (const x of qd.seq ?? []) {
    const [lng, lat] = x.geometry.coordinates; const mm = x.properties.mag ?? 2;
    out.points.push({ lat, lng, color: x.properties.time < sel.d.properties.time ? '#9fb7d9' : '#f2c66d', r: 0.04 + mm * 0.02, alt: 0.004, tip: `<div class="tip"><b>M${mm.toFixed(1)} ${x.properties.time < sel.d.properties.time ? 'foreshock' : 'aftershock'}</b><span>${esc(new Date(x.properties.time).toUTCString().slice(5, 22))} UTC</span></div>`, ref: { layer: 'quakes', d: x } });
  }
  return out;
}
/** Close the event: drop the shader and lines. */
export function quakeClose() { qd.fat?.obj?.geometry?.dispose?.(); qd.wave?.obj?.geometry?.dispose?.(); Object.assign(qd, { id: null, contours: null, seq: null, fat: null, labels: [], wave: null }); }
