// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas service worker: the site itself works offline; live feeds and map tiles always go to the network.
const VERSION = 'global-intelligence-atlas-v2.12';
const SHELL = [
  './', 'app/', 'app/css/atlas.css', 'app/vendor/vendor.min.mjs',
  'app/js/main.js', 'app/js/layers.js', 'app/js/opendata.js', 'app/js/flights.js', 'app/js/cameras.js', 'app/js/places.js', 'app/js/nav.js', 'app/js/icons.js', 'app/js/news.js', 'app/js/crime.js', 'app/js/live.js', 'app/js/networks.js', 'app/js/hud.js', 'app/js/markers.js', 'app/js/perf.js', 'app/js/clock.js', 'app/js/launches.js', 'app/js/trace.js', 'app/js/wind.js', 'app/js/feeds.js', 'app/js/astro.js', 'app/js/satellites.js', 'app/js/sources.js', 'app/js/tours.js', 'app/js/quiz.js', 'app/js/moon.js', 'app/js/extras.js', 'app/js/sky.js', 'app/js/shell.js', 'app/js/fatlines.js', 'app/js/pulses.js', 'app/js/planes3d.js', 'app/js/planeview.js', 'app/js/hazards.js', 'app/js/health.js', 'app/js/watch.js', 'app/js/osint.js', 'app/js/osint-core.js', 'app/js/worldcams.js', 'app/js/intel.js', 'app/js/newsdesk.js', 'app/js/newslist.js', 'app/js/redaction.js', 'app/js/photo-osint.js', 'app/js/ais.js', 'app/js/landscape.js', 'app/js/surroundings.js', 'app/js/replay.js', 'app/js/registry.js', 'app/js/chemicals.js', 'app/js/wmbaseline.js', 'app/js/economy.js', 'app/js/plss.js', 'app/plugins/daylength.js', 'app/config.json',
  'app/data/worldmonitor-static.json', 'app/data/open/waterways.json', 'app/data/countries.geojson', 'app/data/plate-boundaries.json', 'app/data/tle-snapshot-leo.txt', 'app/data/cities.json', 'app/data/airports.json',
  'app/textures/earth-blue-marble-2k.jpg', 'app/textures/earth-night-2k.jpg', 'app/textures/earth-topology.png',
  'learn/', 'fluid/', 'download/', 'credits/', 'assets/site.css', 'assets/site.js', 'assets/vendor/gsap.min.js', 'assets/vendor/ScrollTrigger.min.js',
  'icons/icon-192.png', 'manifest.webmanifest',
];
const HEAVY = /\/(app\/vendor|app\/textures|docs-media)\/|\.(jpg|png|webp|gif)$/;
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // live data: network only
  const save = (res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; };
  // Heavy files that rarely change (the 1.4 MB globe engine, Earth textures, README media): answer from the cache at once
  // and refresh it in the background, so a repeat visit does not wait on the network (v2.10 browser tuning).
  if (HEAVY.test(url.pathname)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const fresh = fetch(e.request).then(save);
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    }));
    return;
  }
  // everything else on the site: network first so updates land quickly, cache as the offline fallback
  e.respondWith(fetch(e.request).then(save).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
