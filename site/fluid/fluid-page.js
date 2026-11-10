// SPDX-License-Identifier: AGPL-3.0-only
// Fluid lab buttons (cyclones, trade winds, jet stream). Moved out of fluid/index.html in v2.14 so the page runs no inline
// script under its Content-Security-Policy.
const F = window.fluidLab; const f = F.config;
const gui = document.querySelector('.dg.ac'); if (gui) document.querySelector('.fluid-stage').appendChild(gui);
f.SPLAT_RADIUS = 0.3;
const col = () => F.color();
const burst = (fn, n, gap = 30) => { for (let i = 0; i < n; i++) setTimeout(() => fn(i), i * gap); };
function cyclone(sign) {
  burst((i) => { const a = (i / 24) * Math.PI * 2; const r = 0.18; const x = 0.5 + r * Math.cos(a); const y = 0.5 + r * Math.sin(a);
    F.splatAt(x, y, -Math.sin(a) * 900 * sign, Math.cos(a) * 900 * sign, col()); }, 24, 25);
}
document.getElementById('gusts').onclick = () => F.gusts(14);
document.getElementById('cyclone-n').onclick = () => cyclone(1);
document.getElementById('cyclone-s').onclick = () => cyclone(-1);
document.getElementById('trades').onclick = () => burst((i) => { const y = i % 2 ? 0.42 : 0.58; F.splatAt(0.95 - (i >> 1) * 0.08, y, -700, 0, col()); }, 22, 35);
document.getElementById('jet').onclick = () => burst((i) => { F.splatAt(0.05 + i * 0.075, 0.78 + 0.05 * Math.sin(i * 0.9), 900, 120 * Math.cos(i * 0.9), col()); }, 13, 40);
