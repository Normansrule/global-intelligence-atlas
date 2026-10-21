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
    globe.backgroundColor(css.getPropertyValue('--globe-bg').trim() || (dark ? '#0b0d0f' : '#e9ebe6'));
    // Stars belong to the night chart; on the printed chart the globe sits on paper.
    if (stars) stars.visible = dark;
    globe.atmosphereColor(dark ? '#7fb6ff' : '#8fb0e0').atmosphereAltitude(dark ? 0.16 : 0.12);
    meta?.setAttribute('content', css.getPropertyValue('--chrome').trim());
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Dark theme is on: press for light' : 'Dark theme is off: press for dark';
    }
  };
  const set = (t) => { root.dataset.theme = t; try { localStorage.setItem(KEY, t); } catch {} apply(); };
  button?.addEventListener('click', () => set(isDark() ? 'light' : 'dark'));
  // Follow the system setting until the visitor picks one themselves.
  media.addEventListener('change', () => { if (!localStorage.getItem(KEY)) apply(); });
  apply();
  return { apply, set, isDark };
}
