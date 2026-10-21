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
<button class="theme" type="button" aria-pressed="false">${THEME_ICON}<span>Dark</span></button></div></nav>`);
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
    btn.title = dark() ? 'Dark theme is on: press for light' : 'Dark theme is off: press for dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--ground').trim());
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: dark() } }));
  };
  btn.addEventListener('click', () => { root.dataset.theme = dark() ? 'light' : 'dark'; try { localStorage.setItem('gia-theme', root.dataset.theme); } catch {} paint(); });
  media.addEventListener('change', paint);
  paint();
}

// In the desktop app, open outside links in the system browser (Tauri opener plugin).
if (window.__TAURI_INTERNALS__) document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (a && new URL(a.href).origin !== location.origin) { e.preventDefault(); window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: a.href }); }
});
