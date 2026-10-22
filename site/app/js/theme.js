// SPDX-License-Identifier: AGPL-3.0-only
// Light and dark: the page colours live in CSS tokens (css/atlas.css); this module keeps the WebGL scene
// (background, stars, atmosphere) and the browser chrome in step with whichever theme is showing.
const KEY = 'gia-theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;
export const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : media.matches);

export function installTheme({ globe, stars, button }) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = () => {
    const css = getComputedStyle(root); const dark = isDark();
    globe.backgroundColor(css.getPropertyValue('--globe-bg').trim() || (dark ? '#070f1b' : '#e6dece'));
    // Stars belong to the night chart; on the printed chart the globe sits on paper.
    if (stars) stars.visible = dark;
    globe.atmosphereColor(dark ? '#7fb6ff' : '#7fa2c8').atmosphereAltitude(dark ? 0.16 : 0.12);
    meta?.setAttribute('content', css.getPropertyValue('--chrome').trim());
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Night is on: press for day' : 'Day is on: press for night';
    }
  };
  const set = (t) => { root.dataset.theme = t; try { localStorage.setItem(KEY, t); } catch {} apply(); };
  // The new theme spreads out from the button as a growing circle (a view transition), when the browser can.
  button?.addEventListener('click', (e) => {
    const next = isDark() ? 'light' : 'dark';
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return set(next);
    const r = button.getBoundingClientRect(); const x = e.clientX || r.left + r.width / 2; const y = e.clientY || r.top + r.height / 2;
    root.style.setProperty('--vt-x', `${x}px`); root.style.setProperty('--vt-y', `${y}px`);
    root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.classList.add('theme-vt');
    document.startViewTransition(() => set(next)).finished.finally(() => root.classList.remove('theme-vt'));
  });
  // Follow the system setting until the visitor picks one themselves.
  media.addEventListener('change', () => { if (!localStorage.getItem(KEY)) apply(); });
  apply();
  return { apply, set, isDark };
}
