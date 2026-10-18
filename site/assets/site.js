// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas site pages: shared nav/footer + small effects.
// Effects are plain-JS ports of ideas from MIT-licensed React kits — Magic UI (number ticker, marquee,
// border beam), React Bits (split text), Motion Primitives (spotlight), Animate UI (tilt) — driven by GSAP.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const base = document.documentElement.dataset.base ?? '.';
const here = document.documentElement.dataset.page;

const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27"/><path d="M5 32h54M32 5c11 9 11 45 0 54M32 5c-11 9-11 45 0 54"/></svg>';
const PAGES = [['app/', 'Open the Earth', 'app'], ['learn/', 'Learn', 'learn'], ['fluid/', 'Fluid lab', 'fluid'], ['download/', 'Download', 'download'], ['credits/', 'Credits', 'credits']];

document.body.insertAdjacentHTML('afterbegin', `<a class="skip" href="#main">Skip to content</a>
<nav class="nav"><div class="wrap"><a class="logo" href="${base}/">${LOGO}<span>Global Intelligence Atlas</span></a>
<ul>${PAGES.map(([h, t, id]) => `<li><a href="${base}/${h}" ${id === here ? 'aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul>
<a class="btn" href="${base}/app/">Launch</a></div></nav>`);
document.body.insertAdjacentHTML('beforeend', `<footer class="site"><div class="wrap">
<div><a class="logo" href="${base}/">${LOGO}<span>Global Intelligence Atlas</span></a>
<p>An educational 3D Earth built on <a href="https://github.com/koala73/worldmonitor">World Monitor</a> by Elie Habib.
Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3.0</a> — <a href="${repoUrl()}">read the source</a>.</p></div>
<div><h4>Use it</h4><ul>${PAGES.map(([h, t]) => `<li><a href="${base}/${h}">${t}</a></li>`).join('')}</ul></div>
<div><h4>Built with</h4><ul><li><a href="https://github.com/vasturiano/globe.gl">globe.gl</a></li><li><a href="https://gsap.com">GSAP</a></li><li><a href="https://github.com/PavelDoGreat/WebGL-Fluid-Simulation">WebGL Fluid Simulation</a></li><li><a href="${base}/credits/">Everything else</a></li></ul></div>
</div></footer>`);

function repoUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) return `https://github.com/${m[1]}/${location.pathname.split('/').filter(Boolean)[0] ?? ''}`;
  return 'https://github.com/koala73/worldmonitor';
}
document.querySelectorAll('[data-repo]').forEach((a) => { a.href = repoUrl() + (a.dataset.repo || ''); });

// Spotlight (Motion Primitives) + tilt (Animate UI) on cards
document.querySelectorAll('.card').forEach((c) => {
  c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
    c.style.setProperty('--mx', `${x}px`); c.style.setProperty('--my', `${y}px`);
    if (!reduce && c.dataset.tilt !== 'off') c.style.transform = `perspective(900px) rotateX(${((y / r.height) - 0.5) * -5}deg) rotateY(${((x / r.width) - 0.5) * 6}deg)`;
  });
  c.addEventListener('pointerleave', () => { c.style.transform = ''; });
});

// Marquee: duplicate content once so the loop is seamless
document.querySelectorAll('.marquee .track').forEach((t) => { t.innerHTML += t.innerHTML; });

const gsap = window.gsap;
if (gsap && !reduce) {
  gsap.registerPlugin(window.ScrollTrigger);
  // Split text (React Bits "SplitText" idea): words rise in, once, on the hero only
  document.querySelectorAll('[data-split]').forEach((el) => {
    el.innerHTML = el.textContent.trim().split(/\s+/).map((w) => `<span class="split-word">${w}</span>`).join(' ');
    gsap.from(el.querySelectorAll('.split-word'), { yPercent: 60, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.06, delay: 0.15 });
  });
  gsap.from('[data-rise]', { y: 18, opacity: 0, duration: 0.8, delay: 0.55, stagger: 0.1, ease: 'power2.out' });
  // Number ticker (Magic UI): count up when the strip scrolls into view
  document.querySelectorAll('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count); const o = { v: 0 };
    gsap.to(o, { v: end, duration: 1.6, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true }, onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString(); } });
  });
} else {
  document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = Number(el.dataset.count).toLocaleString(); });
}

// In the desktop app, open outside links in the system browser (Tauri opener plugin).
if (window.__TAURI_INTERNALS__) document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (a && new URL(a.href).origin !== location.origin) { e.preventDefault(); window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: a.href }); }
});
