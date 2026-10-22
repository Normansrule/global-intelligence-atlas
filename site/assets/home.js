// SPDX-License-Identifier: AGPL-3.0-only
// Home page centrepiece: live counts from public feeds drawn as Isotype rows, tied to a globe. Picking a row
// shows where those things are; everything else on the globe steps back.
import { Globe } from '../app/vendor/vendor.min.mjs';
import { unitSvg } from '../app/js/icons.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const tone = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const KINDS = {
  quakes: { glyph: 'quake', color: '--red', b: 'tq', u: 'uq' },
  fires: { glyph: 'flame', color: '--ochre', b: 'tf', u: 'uf' },
  storms: { glyph: 'storm', color: '--accent', b: 'ts', u: 'us' },
  volcanoes: { glyph: 'volcano', color: '--red', b: 'tv', u: 'uv' },
};
const pts = { quakes: [], fires: [], storms: [], volcanoes: [] };
let picked = null; // a kind, 'all' (every kind lit) or null
const lit = () => (picked === 'all' ? null : picked);
const rgba = (hex, a) => { const n = parseInt(hex.replace('#', ''), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`; };

// Rows: one figure stands for a round number of things, chosen so a row never runs past about twelve figures.
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
// The number rolls up to its value alongside the figures (ease-out, so it slows into the real count).
function tick(b, n) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { b.textContent = n.toLocaleString(); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 900); b.textContent = Math.round(n * (1 - Math.pow(1 - k, 4))).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const counts = {}; // kind -> number, for the chapter headlines (they count up when their chapter arrives)
function draw(kind, n, note) {
  counts[kind] = n; document.querySelectorAll(`[data-count="${kind}"] + span[data-one]`).forEach((sp) => { sp.dataset.many ??= sp.textContent; sp.textContent = n === 1 ? sp.dataset.one : sp.dataset.many; }); const big = document.querySelector(`[data-count="${kind}"]`); if (big && big.dataset.shown) tick(big, n);
  const k = KINDS[kind]; const per = STEPS.find((s) => n / s <= 12) ?? 1000;
  const whole = Math.floor(n / per); const part = n / per - whole;
  const u = $(k.u); u.classList.remove('wait');
  if (!n) { u.innerHTML = '<small style="color:var(--ink-2);font-size:13px">None open right now.</small>'; $(k.b).textContent = '0'; return; }
  u.innerHTML = Array.from({ length: whole }, (_, i) => `<i style="--i:${i}">${unitSvg(k.glyph, 18)}</i>`).join('')
    + (part >= 0.1 ? `<i class="part" style="--i:${whole};--p:${Math.round(part * 100)}%">${unitSvg(k.glyph, 18)}</i>` : '');
  u.setAttribute('role', 'img'); u.setAttribute('aria-label', `${n} ${per > 1 ? `(one figure = ${per})` : ''}`);
  tick($(k.b), n);
  if (per > 1) u.title = `One figure = ${per}`;
  if (note) u.insertAdjacentHTML('beforeend', `<small style="align-self:center;color:var(--ink-2);font-size:13px;margin-left:6px">${note}</small>`);
}
function waiting() { for (const k of Object.values(KINDS)) $(k.u).innerHTML = Array.from({ length: 8 }, () => `<i>${unitSvg(k.glyph, 18)}</i>`).join(''); }
function failed(kinds, what) {
  for (const kind of kinds) { const k = KINDS[kind]; $(k.b).textContent = '–'; document.querySelectorAll(`[data-count="${kind}"]`).forEach((b) => { b.textContent = '–'; }); $(k.u).classList.remove('wait'); $(k.u).innerHTML = `<small style="color:var(--ink-2);font-size:13px">Couldn’t reach ${what} just now. The globe app retries on its own.</small>`; }
}
waiting();

// Globe: transparent so the page colour shows through, in either theme.
const el = $('hero-globe'); const stage = el.parentElement;
let g = null;
try {
  g = new Globe(el, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
    .width(stage.clientWidth).height(stage.clientHeight).backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('app/textures/earth-blue-marble-2k.jpg').bumpImageUrl('app/textures/earth-topology.png')
    .showAtmosphere(true).atmosphereAltitude(0.14)
    .pointLat('lat').pointLng('lng').pointAltitude((d) => (lit() && d.kind !== lit() ? 0.002 : d.alt)).pointRadius('r')
    .pointColor((d) => (lit() && d.kind !== lit() ? 'rgba(128,128,128,0.25)' : tone(KINDS[d.kind].color))).pointsMerge(false).pointResolution(8)
    .pointLabel((d) => d.tip).pointsTransitionDuration(reduce ? 0 : 500)
    .ringLat('lat').ringLng('lng').ringColor((d) => { const c = tone(KINDS[d.kind].color); return (t) => rgba(c, (1 - t) * 0.9); })
    .ringMaxRadius(4).ringPropagationSpeed(1.6).ringRepeatPeriod(1400);
  g.pointOfView({ lat: 15, lng: 150, altitude: 1.75 }, 0);
  const c = g.controls(); c.enableZoom = false; c.autoRotate = !reduce; c.autoRotateSpeed = 0.35;
  stage.querySelector('.fallback')?.remove();
  new ResizeObserver(() => g.width(stage.clientWidth).height(stage.clientHeight)).observe(stage);
  const atm = () => g.atmosphereColor(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? '#7fb6ff' : '#8fb0e0');
  atm(); document.addEventListener('themechange', () => { atm(); refresh(); });
} catch { /* no WebGL: the counts still work, the grey disc stays */ }
function refresh() {
  g?.pointsData([...pts.quakes, ...pts.fires, ...pts.storms, ...pts.volcanoes]);
  // the picked kind's six biggest points send out slow rings, so the eye finds them
  const top = picked && picked !== 'all' ? [...pts[picked]].sort((a, z) => z.w - a.w).slice(0, 6) : [];
  g?.ringsData(reduce ? [] : top);
}

// One place decides what the globe shows: a tally row you press, or the chapter you scroll to. Each turns the
// globe to its view (the biggest point of that kind when there is one) and lights only its own points.
const cap = $('stage-cap'); const LABEL = { quakes: 'Earthquakes, last 24 hours', fires: 'Wildfires', storms: 'Severe storms', volcanoes: 'Volcanoes', all: 'Everything at once' };
function show(kind, view) {
  picked = kind && kind !== 'home' ? kind : null;
  document.querySelectorAll('#tally button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === picked)));
  document.querySelectorAll('.ch-dots a').forEach((a) => { if (a.dataset.go === (kind ?? 'home')) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
  if (cap) cap.textContent = LABEL[picked] ?? '';
  const pool = picked && picked !== 'all' ? pts[picked] : [];
  const topPt = !(picked === 'quakes' && view) && [...pool].sort((a, z) => z.w - a.w)[0];
  const [la, ln, al] = (view ?? '').split(',').map(Number);
  const to = topPt ? { lat: topPt.lat, lng: topPt.lng, altitude: al || 1.8 } : view ? { lat: la, lng: ln, altitude: al } : null;
  if (g) {
    g.controls().autoRotate = !reduce && (!picked || picked === 'all');
    if (to) g.pointOfView(to, reduce ? 0 : 1600);
    refresh();
  }
}
document.querySelectorAll('#tally button').forEach((b) => b.addEventListener('click', () => show(picked === b.dataset.k ? null : b.dataset.k)));

// Chapters: the one crossing the middle of the screen is the one the globe shows. Its big number counts up the
// first time it arrives.
const chapters = [...document.querySelectorAll('#journey [data-ch]')];
let current = 'home';
const io = new IntersectionObserver((list) => {
  for (const x of list) {
    if (!x.isIntersecting) continue;
    const el = x.target; const kind = el.dataset.ch; if (kind === current) continue;
    current = kind; show(kind, el.dataset.view);
    el.classList.add('here'); chapters.forEach((c) => c !== el && c.classList.remove('here'));
    const big = el.querySelector('[data-count]');
    if (big && !big.dataset.shown) { big.dataset.shown = '1'; if (counts[big.dataset.count] != null) tick(big, counts[big.dataset.count]); }
  }
}, { rootMargin: matchMedia('(max-width: 900px)').matches ? '-62% 0px -28% 0px' : '-45% 0px -45% 0px' }); // on phones the globe covers the top of the screen
chapters.forEach((c) => io.observe(c));

// Depth: on a mouse or trackpad the globe leans a few degrees toward the pointer and springs back when it
// leaves, like an object on a desk rather than a picture on a page.
const fig = el.closest('.stage');
if (fig && !reduce && matchMedia('(pointer: fine)').matches) {
  let tx = 0; let ty = 0; let x = 0; let y = 0; let raf = 0;
  const loop = () => {
    x += (tx - x) * 0.08; y += (ty - y) * 0.08;
    fig.style.transform = `perspective(1400px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  addEventListener('pointermove', (e) => { const r = fig.getBoundingClientRect(); tx = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1)); ty = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1)); kick(); }, { passive: true });
  document.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
}

fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
  const f = d.features.filter((q) => q.properties.mag != null);
  const big = f.filter((q) => q.properties.mag >= 4.5).length;
  draw('quakes', f.length);
  $('tq-note').textContent = `${big} of them magnitude 4.5 or stronger, from the US Geological Survey (USGS)`;
  pts.quakes = f.map((q) => ({ kind: 'quakes', lat: q.geometry.coordinates[1], lng: q.geometry.coordinates[0], r: 0.25 + Math.max(0, q.properties.mag) * 0.12, alt: 0.006, w: q.properties.mag, tip: `M${q.properties.mag.toFixed(1)} · ${q.properties.place ?? ''}` }));
  refresh();
}).catch(() => failed(['quakes'], 'the USGS earthquake feed'));

const CAT = { wildfires: 'fires', severeStorms: 'storms', volcanoes: 'volcanoes' };
fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
  const n = { fires: 0, storms: 0, volcanoes: 0 };
  for (const e of d.events) {
    const kind = CAT[e.categories?.[0]?.id]; if (!kind) continue; n[kind]++;
    const geo = e.geometry?.at(-1); if (!geo || geo.type !== 'Point') continue;
    pts[kind].push({ kind, lat: geo.coordinates[1], lng: geo.coordinates[0], r: 0.7, alt: 0.006, w: geo.magnitudeValue ?? 1, tip: e.title });
  }
  for (const k of Object.keys(n)) draw(k, n[k]);
  refresh();
}).catch(() => failed(['fires', 'storms', 'volcanoes'], 'NASA’s event tracker'));
