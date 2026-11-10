// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas page guard (v2.14 security). A classic script loaded first in <head>, next to the page's
// Content-Security-Policy. Three small jobs, each a second line of defence behind escaping every feed value:
//  1. Inline event handlers (onerror="…", onclick="…") never run under the policy. Any that reach the page in
//     inserted HTML are taken off before the browser can try them. The few the app itself uses for broken pictures
//     are swapped for data-fallback, which the error and load listeners below carry out.
//  2. Links can only go to http(s), mailto, tel or a place on this page. A feed that hands over a javascript: or
//     data: link gets a dead link instead.
//  3. Frames the app opens itself (live TV) are sandboxed so they can't move this page somewhere else.
// New code should write data-fallback="remove|hide|figure|button" and data-onload="ready" instead of onerror/onload.
(function () {
  'use strict';
  var FALLBACK = {
    'this.remove()': 'remove',
    "this.style.visibility='hidden'": 'hide',
    "this.closest('figure').remove()": 'figure',
    "this.closest('button').remove()": 'button',
  };
  var ONLOAD = { "this.parentNode.classList.add('ready')": 'ready' };
  var SAFE_HREF = /^(https?:|mailto:|tel:|blob:|#|\/|\.{0,2}\/|\?|[^:]*$)/i;
  var FRAME_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com'];
  var FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';

  function clean(el) {
    var attrs = el.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var name = attrs[i].name.toLowerCase();
      if (name.length > 2 && name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) { // "on…"
        var v = attrs[i].value.trim();
        if (name === 'onerror' && FALLBACK[v]) el.setAttribute('data-fallback', FALLBACK[v]);
        else if (name === 'onload' && ONLOAD[v]) el.setAttribute('data-onload', ONLOAD[v]);
        el.removeAttribute(attrs[i].name);
      }
    }
    var tag = el.tagName;
    if (tag === 'A' || tag === 'AREA') {
      var href = el.getAttribute('href');
      if (href != null && !SAFE_HREF.test(href.replace(/[\u0000- ]/g, ''))) { el.removeAttribute('href'); el.setAttribute('data-blocked-href', ''); }
      if (el.getAttribute('target') === '_blank' && !/noopener/.test(el.getAttribute('rel') || '')) el.setAttribute('rel', ((el.getAttribute('rel') || '') + ' noopener').trim());
    } else if (tag === 'IFRAME' && !el.hasAttribute('sandbox')) {
      // Only reached when an iframe was inserted without one; set it before the frame navigates any further.
      el.setAttribute('sandbox', FRAME_SANDBOX);
      var src = el.getAttribute('src') || '';
      try { if (src && FRAME_HOSTS.indexOf(new URL(src, location.href).hostname) < 0) el.removeAttribute('src'); } catch (e) { el.removeAttribute('src'); }
    } else if (tag === 'FORM') {
      var action = el.getAttribute('action');
      if (action && !SAFE_HREF.test(action)) el.removeAttribute('action');
    }
  }
  var SEL = '[onerror],[onload],[onclick],[onmouseover],[onmouseenter],[onfocus],[onanimationstart],[ontransitionend],[onpointerdown],[onpointerenter],[onbegin],a[href],area[href],iframe,form[action]';
  function sweep(node) {
    if (node.nodeType !== 1) return;
    clean(node);
    var list = node.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) clean(list[i]);
  }
  window.giaGuard = { sweep: sweep, FRAME_SANDBOX: FRAME_SANDBOX };

  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var rec = records[r];
        if (rec.type === 'attributes') { clean(rec.target); continue; }
        for (var n = 0; n < rec.addedNodes.length; n++) sweep(rec.addedNodes[n]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'onerror', 'onload', 'onclick'] });
  }

  // Broken and finished pictures (error and load don't bubble, so listen in the capture phase).
  document.addEventListener('error', function (e) {
    var el = e.target; var how = el && el.getAttribute && el.getAttribute('data-fallback');
    if (!how) return;
    if (how === 'remove') el.remove();
    else if (how === 'hide') el.style.visibility = 'hidden';
    else if (how === 'figure' || how === 'button') { var up = el.closest(how); if (up) up.remove(); }
  }, true);
  document.addEventListener('load', function (e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-onload') === 'ready' && el.parentNode) el.parentNode.classList.add('ready');
  }, true);

  // Last stop for a dangerous link that slipped past everything else.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a && !SAFE_HREF.test((a.getAttribute('href') || '').replace(/[\u0000- ]/g, ''))) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();
