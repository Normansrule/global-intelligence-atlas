// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas service worker. Offline mode, part 2: the site itself, every bundled dataset and the
// map tiles you have looked at keep working with no internet. Live feeds are not handled here: feeds.js keeps
// the last good copy of each on the device (lastknown.js) and shows it, with its age, when a source is gone.
//
// Caches:
//   VERSION  the app shell, refreshed with each release (older ones are deleted on activate)
//   PACK     "Save everything for offline" (Tools → Offline kit): every bundled file in app/data/offline-pack.json
//   TILES    OpenStreetMap and NASA GIBS map tiles you have already looked at, the newest 3,000
// Only GET answers with res.ok are kept: same-origin ones, plus CORS (never opaque) tiles from TILE_HOSTS.
const VERSION = 'global-intelligence-atlas-v2.21';
const PACK = 'gia-offline-pack';
const TILES = 'gia-offline-tiles';
const KEEP = new Set([VERSION, PACK, TILES]);
const MAX_TILES = 3000;
// Tiles whose terms allow keeping what a viewer has seen: OpenStreetMap (passive caching by the viewer's own
// browser, no bulk downloading) and NASA GIBS (public domain). Esri imagery is left to the browser's own cache.
const TILE_HOSTS = new Set(['tile.openstreetmap.org', 'gibs.earthdata.nasa.gov']);
const SHELL = [
  './', 'app/', 'app/css/atlas.css', 'app/vendor/vendor.min.mjs',
  'app/js/main.js', 'app/js/lastknown.js', 'app/js/offline.js', 'app/css/offline.css', 'app/data/offline-pack.json', 'app/vendor/astronomy.min.mjs', 'app/js/layers.js', 'app/js/opendata.js', 'app/js/flights.js', 'app/js/cameras.js', 'app/js/places.js', 'app/js/nav.js', 'app/js/icons.js', 'app/js/news.js', 'app/js/crime.js', 'app/js/live.js', 'app/js/networks.js', 'app/js/hud.js', 'app/js/markers.js', 'app/js/perf.js', 'app/js/clock.js', 'app/js/launches.js', 'app/js/trace.js', 'app/js/wind.js', 'app/js/feeds.js', 'app/js/astro.js', 'app/js/satellites.js', 'app/js/sources.js', 'app/js/tours.js', 'app/js/quiz.js', 'app/js/moon.js', 'app/js/extras.js', 'app/js/sky.js', 'app/js/shell.js', 'app/js/fatlines.js', 'app/js/pulses.js', 'app/js/planes3d.js', 'app/js/planeview.js', 'app/js/hazards.js', 'app/js/health.js', 'app/js/watch.js', 'app/js/osint.js', 'app/js/osint-core.js', 'app/js/worldcams.js', 'app/js/intel.js', 'app/js/newsdesk.js', 'app/js/newslist.js', 'app/js/redaction.js', 'app/js/photo-osint.js', 'app/js/ais.js', 'app/js/landscape.js', 'app/js/surroundings.js', 'app/js/replay.js', 'app/js/registry.js', 'app/js/chemicals.js', 'app/js/wmbaseline.js', 'app/js/economy.js', 'app/js/plss.js', 'app/js/skyfx.js', 'app/js/landmarks.js', 'app/js/wakes.js', 'app/js/cosmos.js', 'app/js/bodies.js', 'app/js/landings.js', 'app/js/flightdb.js', 'app/js/shipdb.js', 'app/js/uicons.js', 'app/js/quakedetail.js', 'app/js/countrydetail.js', 'app/js/citydetail.js', 'app/js/eventdetail.js', 'app/js/satdetail.js', 'app/js/launchdetail.js', 'app/js/portdetail.js', 'app/js/cabledetail.js', 'app/js/nucleardetail.js', 'app/js/alertdetail.js', 'app/js/powerdetail.js', 'app/js/shipview.js', 'app/plugins/daylength.js', 'app/config.json',
  'app/data/worldmonitor-static.json', 'app/data/open/waterways.json', 'app/data/countries.geojson', 'app/data/plate-boundaries.json', 'app/data/tle-snapshot-leo.txt', 'app/data/cities.json', 'app/data/airports.json', 'app/data/landmarks.json', 'app/js/wildlife.js', 'app/css/wildlife.css', 'app/data/wildlife.json', 'app/js/aqi.js', 'app/js/airquality.js', 'app/js/warnings.js', 'app/js/sound.js', 'app/css/sense.css', 'app/js/closeup.js',
  'app/textures/earth-blue-marble-2k.jpg', 'app/textures/earth-night-2k.jpg', 'app/textures/earth-topology.png',
  'learn/', 'fluid/', 'download/', 'credits/', 'assets/site.css', 'assets/site.js', 'assets/home.js', 'assets/orbits.svg', 'app/js/theme.js', 'app/js/theme-boot.js',
  'icons/icon-192.png', 'manifest.webmanifest',
  // from the security update (cached when present; a missing one is skipped, so either update can land first)
  'sw-register.js', 'app/js/guard.js', 'fluid/fluid-page.js',
];
const HEAVY = /\/(app\/vendor|app\/textures|docs-media)\/|\.(jpg|png|webp|gif)$/;
// Install: one by one, so a single missing file never stops the rest from being cached.
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

const anyCache = (req) => caches.match(req, { ignoreSearch: true });
let tilePuts = 0;
async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]); // keys come back oldest first
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    if (!TILE_HOSTS.has(url.hostname)) return; // live data: network only (feeds.js keeps its own saved copies)
    // A map tile: the network first; the copy from an earlier look when there is no answer.
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok && res.type === 'cors') {
        const copy = res.clone();
        e.waitUntil(caches.open(TILES).then((c) => c.put(e.request, copy)).then(() => { if (++tilePuts % 200 === 0) return trimTiles(); }).catch(() => {}));
      }
      return res;
    }).catch(() => caches.open(TILES).then((c) => c.match(e.request)).then((hit) => hit ?? Response.error())));
    return;
  }
  const save = (res) => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {}); } return res; };
  // A page that is not in any cache while offline: the app (inside app/) or the home page, never a broken screen.
  const fallback = async () => {
    const hit = await anyCache(e.request); if (hit) return hit;
    if (e.request.mode === 'navigate') return (await anyCache(url.pathname.includes('/app/') ? 'app/' : './')) ?? Response.error();
    return Response.error();
  };
  // Heavy files that rarely change (the 1.4 MB globe engine, Earth textures, README media): answer from the cache at once
  // and refresh it in the background, so a repeat visit does not wait on the network (v2.10 browser tuning).
  if (HEAVY.test(url.pathname)) {
    e.respondWith(anyCache(e.request).then((hit) => {
      const fresh = fetch(e.request).then(save);
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh.catch(fallback);
    }));
    return;
  }
  // everything else on the site: network first so updates land quickly, cache as the offline fallback
  e.respondWith(fetch(e.request).then(save).catch(fallback));
});

// ------------------------------------------------------------------ the Offline kit's requests
// { type: 'pack', urls }   save each same-origin file into PACK, reporting progress
// { type: 'pack-info' }    how many files and map tiles are saved
// { type: 'pack-clear' }   delete the saved pack and tiles
self.addEventListener('message', (e) => {
  const d = e.data ?? {}; const reply = (m) => e.source?.postMessage({ ...m, from: 'gia-sw' });
  if (d.type === 'pack' && Array.isArray(d.urls)) {
    e.waitUntil((async () => {
      const c = await caches.open(PACK);
      const urls = d.urls.map((u) => { try { return new URL(u, self.registration.scope); } catch { return null; } }).filter((u) => u && u.origin === location.origin).map((u) => u.href);
      let done = 0; let failed = 0; let bytes = 0;
      const queue = [...urls]; const step = async () => {
        while (queue.length) {
          const u = queue.shift();
          try { const res = await fetch(u, { cache: 'no-cache' }); if (!res.ok) throw new Error(res.status); const b = await res.clone().blob(); bytes += b.size; await c.put(u, res); } catch { failed += 1; }
          done += 1; if (done % 10 === 0 || !queue.length) reply({ type: 'pack-progress', done, failed, total: urls.length, bytes });
        }
      };
      await Promise.all([step(), step(), step(), step()]);
      reply({ type: 'pack-done', done, failed, total: urls.length, bytes });
    })());
  }
  if (d.type === 'pack-info') e.waitUntil(Promise.all([caches.open(PACK).then((c) => c.keys()), caches.open(TILES).then((c) => c.keys())]).then(([p, t]) => reply({ type: 'pack-info', files: p.length, tiles: t.length })));
  if (d.type === 'pack-clear') e.waitUntil(Promise.all([caches.delete(PACK), caches.delete(TILES)]).then(() => reply({ type: 'pack-info', files: 0, tiles: 0 })));
});
