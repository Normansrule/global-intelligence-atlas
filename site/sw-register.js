// SPDX-License-Identifier: AGPL-3.0-only
// Registers the Global Intelligence Atlas service worker (sw.js, next to this file) on every page. It lives in its own
// file because the pages' Content-Security-Policy runs no inline scripts (v2.14 security).
(function () {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  var me = document.currentScript && document.currentScript.src;
  navigator.serviceWorker.register(me ? new URL('sw.js', me).href : 'sw.js');
})();
