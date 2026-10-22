// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas site pages: shared nav, footer and the light/dark switch. No animation library:
// the pages are readable the moment they arrive, and motion only answers what the visitor does.
const base = document.documentElement.dataset.base ?? '.';
const here = document.documentElement.dataset.page;

const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27"/><path d="M5 32h54M32 5c11 9 11 45 0 54M32 5c-11 9-11 45 0 54" fill="none"/></svg>';
const PAGES = [['app/', 'Open the Earth', 'app'], ['learn/', 'Learn', 'learn'], ['fluid/', 'Fluid lab', 'fluid'], ['download/', 'Download', 'download'], ['credits/', 'Credits', 'credits']];
const THEME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';

document.body.insertAdjacentHTML('afterbegin', `<a class="skip" href="#main">Skip to content</a>
<nav class="nav" aria-label="Site"><div class="wrap"><a class="logo" href="${base}/">${LOGO}<span>Global Intelligence Atlas</span></a>
<ul>${PAGES.map(([h, t, id]) => `<li><a href="${base}/${h}" ${id === here ? 'aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul>
<button class="theme" type="button" aria-pressed="false">${THEME_ICON}<span>Night</span></button></div></nav>`);
document.body.insertAdjacentHTML('beforeend', `<footer class="site"><div class="wrap">
<div><a class="logo" href="${base}/">${LOGO}<span>Global Intelligence Atlas</span></a>
<p>An educational 3D Earth built on <a href="https://github.com/koala73/worldmonitor">World Monitor</a> by Elie Habib.
Free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU Affero General Public License (AGPL) version 3</a>. <a href="${repoUrl()}">Read the source</a>.</p></div>
<div><h2>Use it</h2><ul>${PAGES.map(([h, t]) => `<li><a href="${base}/${h}">${t}</a></li>`).join('')}</ul></div>
<div><h2>Built with</h2><ul><li><a href="https://github.com/vasturiano/globe.gl">globe.gl</a></li><li><a href="https://github.com/mrdoob/three.js">three.js</a></li><li><a href="https://github.com/PavelDoGreat/WebGL-Fluid-Simulation">WebGL Fluid Simulation</a></li><li><a href="${base}/credits/">Everything else</a></li></ul></div>
</div></footer>`);

function repoUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) return `https://github.com/${m[1]}/${location.pathname.split('/').filter(Boolean)[0] ?? ''}`;
  return 'https://github.com/Normansrule/global-intelligence-atlas';
}
document.querySelectorAll('[data-repo]').forEach((a) => { a.href = repoUrl() + (a.dataset.repo || ''); });

// Light and dark: follows the system until the visitor picks; the choice is shared with the app (same key).
{
  const root = document.documentElement; const media = matchMedia('(prefers-color-scheme: dark)');
  const btn = document.querySelector('.nav .theme');
  const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : media.matches);
  const paint = () => {
    btn.setAttribute('aria-pressed', String(dark()));
    btn.title = dark() ? 'Night is on: press for day' : 'Day is on: press for night';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--ground').trim());
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: dark() } }));
  };
  const flip = () => { root.dataset.theme = dark() ? 'light' : 'dark'; try { localStorage.setItem('gia-theme', root.dataset.theme); } catch {} paint(); };
  // The new theme spreads out from the button as a growing circle (a view transition), when the browser can.
  btn.addEventListener('click', (e) => {
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return flip();
    const r = btn.getBoundingClientRect(); const x = e.clientX || r.left + r.width / 2; const y = e.clientY || r.top + r.height / 2;
    root.style.setProperty('--vt-x', `${x}px`); root.style.setProperty('--vt-y', `${y}px`);
    root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.classList.add('theme-vt');
    document.startViewTransition(flip).finished.finally(() => root.classList.remove('theme-vt'));
  });
  media.addEventListener('change', paint);
  paint();
}

// Lessons fold to one line each (subject, title and the key equation); open one for the whole lesson. Done in
// the script so the page without it still shows every lesson in full. A link to #lesson opens that one.
{
  for (const a of document.querySelectorAll('article.lesson')) {
    const [head, body] = a.children; if (!head || !body) continue;
    const d = document.createElement('details'); const sum = document.createElement('summary');
    sum.append(...head.childNodes);
    const k = document.createElement('span'); k.className = 'key'; k.textContent = body.querySelector('.eq')?.textContent ?? ''; sum.append(k);
    body.classList.add('more'); d.append(sum, body); a.replaceChildren(d);
  }
  const openHash = () => { const t = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; const d = t?.querySelector(':scope > details'); if (d) { d.open = true; t.scrollIntoView({ block: 'start' }); } };
  addEventListener('hashchange', openHash); openHash();
}

// Scroll reveal: blocks below the fold rise into place the first time they are seen, siblings a beat apart.
// Numbers in the inventory count up from zero as they arrive.
{
  const groups = ['.chapter > *', 'section.block h2.title', 'section.block p.intro', '.inventory > details', '.index > li', '.shot', '.names > li', '.lesson', '.dl-grid > *', '.table-scroll', 'footer.site .wrap > div'];
  // with reduced motion nothing is held back: every block is simply there
  const els = matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : [...document.querySelectorAll(groups.join(','))];
  const seen = new Map();
  for (const el of els) { const n = seen.get(el.parentElement) ?? 0; seen.set(el.parentElement, n + 1); el.dataset.reveal = ''; el.style.setProperty('--d', String(Math.min(n, 12))); }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const countUp = (b) => {
    const m = b.textContent.trim().match(/^([\d,]+)(.*)$/); if (!m || still) return;
    const to = Number(m[1].replace(/,/g, '')); const t0 = performance.now(); const dur = 1100;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 4);
      b.textContent = Math.round(to * e).toLocaleString() + m[2]; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const show = (el) => { el.classList.add('in'); if (el.matches('.inventory > details')) el.querySelectorAll('b').forEach(countUp); };
  if (!('IntersectionObserver' in window)) els.forEach(show);
  else {
    const io = new IntersectionObserver((list) => { for (const x of list) if (x.isIntersecting) { show(x.target); io.unobserve(x.target); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach((el) => io.observe(el));
    addEventListener('beforeprint', () => els.forEach((el) => el.classList.add('in')));
    // A fast flick can carry a block past the screen between two checks; anything already above the bottom
    // edge is shown, so nothing is ever left invisible behind you.
    let queued = false;
    addEventListener('scroll', () => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; for (const el of els) if (!el.classList.contains('in') && el.getBoundingClientRect().top < innerHeight) { show(el); io.unobserve(el); } });
    }, { passive: true });
  }
}

// The nav's real height (it wraps onto two lines on phones), for things that stick just below it.
{ const nav = document.querySelector('.nav'); const set = () => document.documentElement.style.setProperty('--nav-h', `${nav.offsetHeight}px`); set(); new ResizeObserver(set).observe(nav); }

// Headlines arrive word by word, each rising out of its own line (the words stay real text for readers and
// search; only the wrapping spans are added).
for (const h of document.querySelectorAll('.hero h1, .page-head h1')) {
  let i = 0;
  const wrapWords = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 1) { wrapWords(n); continue; }
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const frag = document.createDocumentFragment();
      for (const part of n.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const w = document.createElement('span'); w.className = 'w';
        const inner = document.createElement('span'); inner.textContent = part; inner.style.setProperty('--i', String(i++));
        w.append(inner); frag.append(w);
      }
      n.replaceWith(frag);
    }
  };
  wrapWords(h); h.classList.add('split');
}

// Pointer polish, only for a mouse or trackpad and never with reduced motion: magnetic main buttons that lean
// toward the pointer, and a soft light that follows it across rows you can open or press.
if (matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const b of document.querySelectorAll('.btn.magnetic')) {
    b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * 10}px ${((e.clientY - r.top) / r.height - 0.5) * 8}px`; });
    b.addEventListener('pointerleave', () => { b.style.translate = ''; });
  }
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('details > summary, .tally button'); if (!t) return;
    const r = t.getBoundingClientRect(); t.style.setProperty('--mx', `${e.clientX - r.left}px`); t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// In the desktop app, open outside links in the system browser (Tauri opener plugin).
if (window.__TAURI_INTERNALS__) document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (a && new URL(a.href).origin !== location.origin) { e.preventDefault(); window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: a.href }); }
});
