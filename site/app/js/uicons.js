// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: interface icons (close, back, play, zoom...). One stroke family, drawn on the same 24 px
// grid and 1.8 px line as the section rail, so controls never fall back to text characters such as × or ⟳.
const P = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  rewind: '<path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z" fill="currentColor"/>',
  forward: '<path d="m13 6 7 6-7 6zM4 6l7 6-7 6z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  plane: '<path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5V17l7.5-2.4V19L8 20.6V22l4-1 4 1v-1.4L13.5 19v-4.4L21 17z" fill="currentColor" stroke="none"/>',
};
/** An inline SVG icon that takes the text colour: ui('close'). */
export const ui = (name, cls = '') => `<svg class="ui-i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? ''}</svg>`;
