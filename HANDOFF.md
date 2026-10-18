# Handoff: Global Intelligence Atlas

A briefing for the next developer or AI agent. Read this first, then `README.md` and `NOTICE.md`.

## 1. What this is

**Global Intelligence Atlas** is an educational, live 3D globe of the planet. It runs as a static website (GitHub Pages) and as a desktop app (Tauri 2: Windows, macOS, Linux). It shows live earthquakes, natural events, disaster alerts, aircraft, ships, satellites, launches, news, traffic cameras, weather, infrastructure (cables, pipelines, ports, power plants, data centres) and more, with guided tours, lessons, a quiz and analysis tools.

- **Repository:** https://github.com/Normansrule/global-intelligence-atlas (licence AGPL-3.0-only)
- **Website:** https://normansrule.github.io/global-intelligence-atlas/ (the globe app is at `/app/`)
- **Version:** 2.1.0 (October 2026)
- **Owner:** Aleksander Norman

**History.** Until v1.12 the project was called Terra Atlas and lived inside a fork of World Monitor (https://github.com/koala73/worldmonitor, Elie Habib, AGPL-3.0-only). In v2.0.0 it became this standalone repository. None of World Monitor's server code, continuous integration (CI) or documentation is included any more. What remains is World Monitor's curated datasets (`site/app/data/worldmonitor-static.json`), its country outlines, and the original concept and layer catalogue. That is why the licence stays AGPL-3.0-only and why World Monitor is credited in the About panel, `NOTICE.md`, `CITATION.cff` and `docs/REFERENCES.md`. Do not remove those credits.

## 2. How the owner works

- Write acronyms out in full with the acronym in parentheses, e.g. "Cross-Origin Resource Sharing (CORS)".
- Keep answers concise and direct. End each delivery with copy-pasteable **Ubuntu** commands (the owner uses Ubuntu on Windows through WSL, not PowerShell).
- The interface must never have overlapping panels: lots of information, in clearly separated sections that are easy to navigate. Run the overlap check after any layout change.
- Performance matters: the owner notices lag and flicker. Measure before and after.
- Every data source, library and paper must appear in `docs/REFERENCES.md` in APA 7th edition style. Add the source to `site/app/js/sources.js` and `tools/build-references.py`, then run `python3 tools/build-references.py`.
- Bump the version in all places (section 8) and add a "What's new" entry, a README section and a `NOTICE.md` row for each release.

## 3. Repository map

```
site/                    everything GitHub Pages serves (also the desktop app's frontend)
  index.html, learn/, fluid/, download/, credits/   website pages (plain HTML/CSS/JS, GSAP)
  sw.js, manifest.webmanifest                       installable web app; bump the cache name every release
  app/                   the globe app (no build step: native ES modules)
    index.html           app shell: top bar, section rail, left drawer, stage, Details drawer, status bar
    config.json          liveData / liveDataFallback (snapshot base URL) / proxy (optional Cloudflare Worker)
    css/atlas.css        all app styles (dark theme, drawers, mobile tab bars)
    vendor/              vendor.min.mjs (globe.gl + three.js 0.186 + satellite.js 5), hls.light.min.js
    data/                bundled datasets (cities, airports, plates, power plants, World Monitor static data,
                         cameras.json, networks.json and alpr/ refreshed by the data workflow)
    js/main.js           app core: globe setup, layer compose, markers, picking, cards, camera, hash links
    js/shell.js          section rail and drawers (Layers, Map, Live, Explore, Tools, Saved, About)
    js/layers.js         most layer definitions (load, channels, describe, learn)
    js/feeds.js          fetch router: desktop → direct → proxy → live-data snapshot, with blocked-host memory
    js/flights.js        aircraft: sources, dead reckoning, GPU glide, per-class instanced meshes, flight panel
    js/planes3d.js       aircraft classes (ICAO type / emitter category / heuristic) and procedural 2D/3D models
    js/planeview.js      3D viewer in the flight panel: close up, from the ground, binoculars
    js/markers.js        sprite markers (vector glyphs), decluttering, hit testing, spatial index
    js/icons.js          58 vector glyphs used for every marker
    js/nav.js            navigation: cursor-anchored wheel zoom, double-click, keyboard, scale bar, zoomTo
    js/perf.js           quality levels, pixel budget, idle render governor (gates the composer)
    js/fatlines.js       all cables/pipelines in one instanced draw call
    js/pulses.js         all pulsing rings in one GPU-animated draw call (scaled with zoom)
    js/news.js, cameras.js, networks.js, crime.js, launches.js, live.js, moon.js, sky.js, wind.js,
    js/satellites.js, trace.js, hud.js, extras.js, tours.js, quiz.js, places.js, astro.js, clock.js
    js/osint.js, osint-core.js  Intelligence toolkit in Tools (domain, address/network, CVE, sanctions, wallet, conflict monitor), adapted from Osiris (MIT)
    js/sources.js        every source with name, URL, licence and role (rendered in About)
    js/hazards.js        fire hotspots (NASA FIRMS) and weather radar (RainViewer, time slider in Layers)
    js/health.js         Data health panel (Tools and About)
    js/landscape.js      terrain (Terrain Tiles) and OpenStreetMap buildings around a point, two meshes
    js/surroundings.js   3D surroundings view in camera cards
    js/chemicals.js      Chemicals and environment: California pesticide use by section (CDPR PUR), USGS county estimates, EPA TRI,
                         CalEnviroScreen tracts (OEHHA), EPA ECHO violations and Water Quality Portal pesticide results
    js/plss.js           Public Land Survey System: meridian/township/range/section → approximate centre (California)
    js/opendata.js       open data in place of World Monitor's lists: modes, sources, infraData(), About → Datasets
    js/registry.js       layer registry: the layers added to layers.js, editions, manifest(), validateLayer(), plug-in names
    js/replay.js         Replay layer: hourly frames from the `history` branch, slider and Play in Layers, USGS quakes for the window
    js/ais.js            AISStream reader shared by the live job, proxy and ship layer
    js/watch.js          watch areas: circles, rules, checks every 2 minutes, notifications, the "My watch areas" layer
    js/worldcams.js      public webcams worldwide (WorldCam list, vetted), 10°×10° cells in data/worldcams/
    js/intel.js          Intel section on the rail: declassified documents (data/declassified.json) and tools
    js/redaction.js      redaction inspector (finds text still present under black boxes in a PDF; uses vendor/pdfjs)
    js/photo-osint.js    photo location (EXIF, Exchangeable Image File Format), shadow clock, web archive lookup
  app/plugins/           plug-in layers loaded by name (?plugins=… or config.json "plugins"); daylength.js is the example, README.md the guide
desktop/                 Tauri 2 app. src-tauri/src/lib.rs has fetch_text (allow-listed hosts, 5 s cache)
tools/                   data jobs and build scripts (see section 5)
proxy/                   optional Cloudflare Worker that adds CORS headers for allow-listed hosts
tests/e2e/               Playwright tests with mocked and recorded feeds (see section 7)
video/                   Remotion promo video
docs/REFERENCES.md       APA 7 reference list (generated)
.github/workflows/       pages, live, history, regional, data, aircraft-db, health, desktop, tests, video
```

## 4. Architecture and rules that keep it fast

- **Rendering:** globe.gl / three-globe on three.js 0.186. globe.gl draws through an EffectComposer whose render pass clears the screen, so the idle governor in `perf.js` skips `composer.render`, never only `renderer.render` (skipping the latter caused black flicker).
- **Draw calls:** batch everything. Cables and pipelines are one instanced mesh (`fatlines.js`), rings one mesh (`pulses.js`), aircraft one instanced mesh per class (8). With default layers the scene is about 36 draw calls; do not regress this.
- **Aircraft:** flat silhouettes when far; 3D models below camera altitude 0.12 (about 760 km), drawing only planes within the visible radius. Positions glide on the GPU (`instanceVel` × time in the vertex shader); the CPU re-bases every 5 s. At street level planes are drawn at their real size and true height.
- **Shaders:** compile new materials early with `renderer.compileAsync` (see `warmPlanes` in `flights.js`), or the first use stalls the frame.
- **Big arrays:** never `array.push(...big)`; use loops (`appendAll`). Spreading 100,000+ items overflowed the call stack.
- **Markers:** sized by importance with hysteresis, labels decluttered, faded at the planet's edge, and a cached spatial index per layer.
- **Imagery:** the 4K globe texture is used only when far out. Below camera altitude 0.75 (about 4,800 km) Esri World Imagery tiles switch in; above 1.0 the texture returns. Night shading floats just above the ground and is lowered as you zoom.
- **Data that browsers cannot read (no CORS):** `feeds.js` tries, in order, the desktop Rust fetch, a direct request, the optional proxy, then the **live-data snapshot**: files on the orphan `live-data` branch served from raw.githubusercontent.com.
- **Live-data job** (`.github/workflows/live.yml` + `tools/fetch-live.mjs`): each run stays alive about 50 minutes and publishes every 4 minutes (GitHub drops short cron schedules). It writes `flights.json` (OpenSky with OAuth2 client credentials from the secrets `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`, else the ADS-B exchanges), `gdacs.json`, launches, satellite elements, and `news-<topic>.json`. News comes from GDELT GEO 2.0; when that is down it is rebuilt from the GDELT 2.0 event export.
- **Live-data job, v2.1 additions:** `fires.json` (NASA FIRMS VIIRS hotspots, every 30 minutes; optional secret `FIRMS_MAP_KEY`), and `status.json` now carries each feed's last good time, count and error (read by the Data health panel). Flight rows get their ICAO type and registration from the `aircraft-db` branch, which the job clones into `./adb`.
- **Daily data job** (`.github/workflows/data.yml`): traffic cameras (`tools/fetch-cameras.mjs`, 15 sources; a failing source keeps its previous list; each source's state, error and last good time are stored in `cameras.json`), internet infrastructure and licence-plate reader (ALPR) data. Optional secrets `ONTARIO_511_KEY`, `ALBERTA_511_KEY`.
- **Weekly aircraft types** (`.github/workflows/aircraft-db.yml` + `tools/build-aircraft-db.mjs`): OpenSky Network aircraft database → `types/<2 hex>.json` on the orphan branch `aircraft-db` (force-pushed, never grows).
- **Hourly history** (`.github/workflows/history.yml` + `tools/build-history.mjs`, v2.4): at 29 minutes past each hour, a compact frame of the live-data snapshot (aircraft as [lat×100, lng×100, flight level, track], ships, GDACS alerts, fire counts; about 200 KB) goes to `frames/YYYYMMDDHH.json` on the orphan branch `history`, with `index.json`. Frames older than `HISTORY_DAYS` (14) are dropped and the branch is force-pushed as one commit. Earthquakes are not copied: the Replay layer asks the USGS catalogue (FDSN event service) for the window.
- **Monthly open data** (`.github/workflows/open-data.yml` + `tools/fetch-open-data.mjs`, v2.9): Wikidata (nuclear plants, spaceports, exchanges and central banks, critical-mineral mines), the NGA World Port Index and TeleGeography cables, one JSON file per layer on the orphan branch `open-data` in the shape the layer draws. Each source that fails keeps its previous file; an answer with too few items is treated as a failure. Local files: `WIKIDATA_DIR`, `WPI_FILE`, `CABLE_GEO_FILE`, `LANDING_GEO_FILE`, `CABLE_DETAIL_DIR`.
- **Monthly regional data** (`.github/workflows/regional.yml` + `tools/fetch-regional.mjs`, v2.6): the newest California Pesticide Use Reporting archive (CDPR, `pur{year}.zip`, about two years behind) added up by PLSS section and chemical with aerial pounds kept apart; the USGS EPest county estimates placed at Census Gazetteer county centres; and the EPA TRI basic data file added up by facility. v2.8 added the Water Quality Portal (`wqp/sites.json`: sites with pesticide results, state by state). v2.7 added CalEnviroScreen 4.0 (OEHHA's results spreadsheet, read by a small built-in .xlsx reader: tracts with their indicator values and percentiles) and EPA ECHO Exporter (only facilities with a violation, a formal action or a penalty). Output on the orphan branch `regional-data` (`pur/`, `usgs/`, `tri/`, `ces/`, `echo/`, `wqp/`, `status.json`). Each source that fails keeps its previous files. Local files for tests or manual runs: `PUR_ZIP`, `EPEST_FILE`, `GAZETTEER_FILE`, `TRI_FILE`, `CES_FILE`, `ECHO_FILE`, `WQP_FILE` (with `WQP_STATION_FILE` for the older format).
- **Weekly probe** (`.github/workflows/health.yml` + `tools/probe-sources.mjs`): probes every source and the data jobs; opens, comments on or closes an issue labelled `data-health`.
- **Repository secrets:** `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` (recommended); `FIRMS_MAP_KEY`, `ONTARIO_511_KEY`, `ALBERTA_511_KEY` (optional).

## 5. Tools

| Command | Purpose |
|---|---|
| `node tools/fetch-live.mjs live` | One live-data round into `./live` (the workflow does this) |
| `node tools/fetch-cameras.mjs` | Rebuild `site/app/data/cameras.json` |
| `node tools/fetch-worldcams.mjs [file.geojson]` | Rebuild `site/app/data/worldcams/` from WorldCam (weekly in `data.yml`; the webcams layer is empty until it has run once) |
| `python3 tools/make-redaction-sample.py` | Rebuild `site/app/data/redaction-sample.pdf`, the demo file for the redaction inspector |
| `node tools/fetch-open-data.mjs open-data [nuclear,spaceports,economic,minerals,ports,cables]` | Build the open-data files into `./open-data` (the `open-data` workflow does this) |
| `node tools/fetch-regional.mjs regional [pur,usgs,tri,ces,echo,wqp]` | Build the regional-data files into `./regional` (the `regional` workflow does this) |
| `node tools/build-history.mjs live history` | Add this hour's frame from `./live` to `./history` and rebuild its index (the `history` workflow does this) |
| `node tools/build-aircraft-db.mjs adb` | Build the aircraft type table into `./adb` (the `aircraft-db` branch) |
| `node tools/probe-sources.mjs` | Probe every source; writes `probe-report.md`, exits 1 if something is broken |
| `node tools/extract-upstream-data.mjs ../worldmonitor` | Rebuild World Monitor's curated datasets from a checkout |
| `node tools/build-vendor.mjs` | Rebuild the 3D library bundle (pin the versions in the file header) |
| `node tools/fetch-intel.mjs` | Rebuild `site/app/data/intel/` (OFAC sanctions list, CISA exploited vulnerabilities); daily in `intel.yml`. `node tests/intel/test-intel.mjs` checks it offline |
| `python3 tools/build-references.py` | Regenerate `docs/REFERENCES.md` in APA 7 style |
| `python3 tools/screenshots.py [names] [--offline]`, `tools/make_gif.py [--looks] [--offline]` | README screenshots and the two animations; `ATLAS_URL=https://…` shoots the live site (the manual `screenshots.yml` workflow does this). `--offline` blocks outside requests and switches off layers that failed, so the pictures show only what really drew |

## 6. Current state (v2.10.0)

v2.10.0 is the Global Intelligence Atlas (GIA) repository launch, with no new layers. The README was rewritten (gallery, web app versus desktop app, features, a progress tracker for section 9, diagrams, key references, credits with World Monitor as the basis) and the version notes moved to `CHANGELOG.md`. `tests/docs/check_readme.py` fails when the tracker disagrees with section 9 or `opendata.js`, so **update the README's Progress table and bar when an item here changes**. Browser tuning: `modulepreload` for the engine and the first modules in `site/app/index.html`, and `site/sw.js` answers heavy files (`HEAVY`: vendor, textures, images) from its cache while refreshing them; code, config and data stay network-first. The desktop release name and body say (GIA) and that the desktop app runs the same `site/`. Screenshots were retaken offline from bundled data; run **Refresh README screenshots** once the site is live for pictures with live data.

v2.9.0 started section 9, item 9: `site/app/js/opendata.js` lets Cables, Ports, Nuclear sites, Spaceports, Financial centres, Critical minerals and Chokepoints draw open data instead of World Monitor's lists, chosen by `"datasets"` in `config.json`, `?datasets=` or About → Datasets (`auto`, the default: open data where its file exists; `open`; `worldmonitor`). `tools/fetch-open-data.mjs` (monthly `open-data.yml`, orphan branch `open-data`) asks Wikidata's SPARQL endpoint for nuclear power plants (Q134447), spaceports (Q194188), stock exchanges (Q11691), central banks (Q66344) and mines (Q820477) producing critical minerals, reads the NGA World Port Index (JSON API, then the CSV download) and TeleGeography's cable and landing-point GeoJSON with one detail page per cable. The chokepoints are a hand-written file (`site/app/data/open/waterways.json`) from the EIA list. Tested on stand-in files only: the build container cannot reach query.wikidata.org, msi.nga.mil or submarinecablemap.com, so check the `open-data.yml` log after its first run. **Check TeleGeography's terms before relying on the cable data:** this release records them as CC BY-NC-SA 3.0 (non-commercial). Still World Monitor only: pipelines (Global Energy Monitor's trackers are CC BY 4.0 but need a sign-up to download), trade routes, AI data centres (Epoch AI publishes a CC BY data set), conflict zones (the Uppsala Conflict Data Program now needs an access token) and watch regions; the search index, trace and quiz also still read World Monitor's file where noted. World Monitor's datasets still ship, so the licence stays AGPL-3.0-only.

v2.8.0 added Pesticides in rivers and wells (layer `wqp`) to Chemicals and environment: Water Quality Portal results for 15 pesticides over the last three years (`WQP_YEARS`), every site with its samples, detections and highest value per pesticide in µg/L, compared with the EPA maximum contaminant level where one exists. The panel filters by pesticide, kind of water (well, stream, lake) and detections only. The job asks the portal state by state, first in the WQX 3.0 format (`/wqx3/Result/search`) and then in the older format (`/data/Station/search` plus `/data/Result/search`) if that fails; a state that fails is named in `status.json`. Tested on stand-in files only, because the build container cannot reach waterqualitydata.us: check the `regional.yml` log after its first run (the job's timeout is now 150 minutes; `WQP_STATES=IA,CA` limits a manual run, `WQP_BASE` overrides the address). The EPA limits in `WQP_CHEMS` (`tools/fetch-regional.mjs`) are typed in from the EPA's regulation table.

v2.7.0 added two more detailed sources to Chemicals and environment: Pollution burden, California tracts (CalEnviroScreen 4.0, pick the overall score or any indicator, including pesticide use nearby) and Environmental violations (EPA ECHO: significant non-compliance, formal actions, penalties, inspections, with a link to each facility's EPA report). Like v2.6, they are tested on stand-in files only, because the build container cannot reach oehha.ca.gov or echo.epa.gov; check the `regional.yml` log after its first run (`CES_URL` and `ECHO_URL` override the download addresses).

v2.6.0 added detailed regional chemical records at the owner's request (the example given was California's records of which pesticides are sprayed where): a new group, Chemicals and environment, with Pesticide use, California (each PLSS square mile, pick a chemical, aerial-only for crop dusting, monthly bars), Pesticide estimates, U.S. counties (USGS) and Toxic chemical releases (EPA TRI). **Not yet verified against the real files:** the build container's network blocks files.cdpr.ca.gov, water.usgs.gov, www2.census.gov and data.epa.gov, so the readers follow the published file layouts and were tested on stand-in files (`tests/regional/test-regional.mjs`). After the first `regional.yml` run, check its log: each source prints its record counts, and a failure names the address or column it could not find (download addresses can be overridden with `PUR_URL`, `EPEST_URL`, `GAZETTEER_URL`, `TRI_URL`). Section positions come from the ideal survey grid, so they can be a kilometre or two off; replacing them with Bureau of Land Management section centroids would make them exact. The Water Quality Portal (measured pesticides in rivers and wells) followed in v2.8.

v2.5.0 added the layer plugin system (section 9, item 8). `site/app/js/registry.js` lists the layers added on top of `layers.js` (with where each goes), the editions, `manifest(layer)` (id, group, sources with licences, refresh, capabilities, editions) and `validateLayer(layer)`. Editions: `full`, `classroom` (no cameras, plate readers, crime, conflicts, hotspots, news, watch areas or Intel) and `lite` (no camera lists, wind, radar, replay or crime), chosen by `"edition"` in `config.json` or `?edition=` in the address; an edition removes layers from `LAYERS` but keeps them in `layerById`, and `toggleLayer` refuses them. Plug-ins are modules in `site/app/plugins/` loaded by name and validated before they are added. About → Layer manifest shows and downloads the manifest. Built-in layers still live in their modules; moving `layers.js` into one file per layer is a later, mechanical step.

v2.4.0 added history and replay (section 9, item 7): the hourly `history` workflow and the Replay layer (`site/app/js/replay.js`) under Live, with a slider, Play and ±1 hour steps in Layers. It sets the app clock to the replayed hour and returns to live time when turned off. It also lists 20 reference projects (visuals, presentation, frameworks, modelling theory) in About, on the credits page and in `docs/REFERENCES.md`; they carry `ref: true` in `sources.js`. The layer shows an error until the `history` workflow has run once; run it by hand after pushing. Daily frames for 30 days would need a coarser frame (one per day) or a larger branch; 14 days of hourly frames is about 70 MB before git compression.

v2.3.0 added real terrain and buildings (section 9, item 6): `site/app/js/landscape.js` builds a few kilometres of landscape around a point from Terrain Tiles (Terrarium PNGs on AWS, no key) and Overpass building outlines, as one terrain mesh and one buildings mesh. The flight panel's 3D viewer has a Street level mode (`planeview.js`) and camera cards have 3D surroundings (`surroundings.js`). Relations (multipolygon buildings) and `building:part` are not drawn yet.

v2.2.0 added worldwide ships (section 9, item 5) and merged the public webcams, Intel section and Osiris toolkit. Ships: `site/app/js/ais.js` reads AISStream messages; the live-data job writes `ships.json` and `ships-static.json` when the `AISSTREAM_KEY` secret is set; the desktop app's `ais_collect` command (`desktop/src-tauri/src/ais.rs`) and the proxy's `/ais` endpoint add ships in view; without any of these the layer shows the Baltic from Fintraffic. Not verified against the real AISStream service from the build container (its network blocks the host); every path is tested against a stand-in server (`tests/ais/mock-aisstream.mjs`).


v2.1.0 added fire hotspots, weather radar, watch-area alerts, the Data health panel with a weekly probe, and the aircraft type table (section 9, items 1–4). New tests: `bash tests/e2e/run.sh test_v21.py` (expect "SUMMARY 17 / 17"). Not yet verified against the real services from a browser: RainViewer tile CORS and the radar's alignment with real rain, the FIRMS public file's size, and the OpenSky database file name (the job finds the newest `aircraft-database-complete-YYYY-MM.csv` in OpenSky's bucket). The desktop crate gained `tauri-plugin-notification`; run `cargo check` on a machine with the Tauri system libraries.

Camera sources checked in October 2026 (by reading each live service): Québec, New Zealand, DriveBC and Iceland parsers fixed; Spain and New South Wales matched; Germany's Autobahn webcam lists are empty at the source; Taiwan's list could not be read from the checking environment, so confirm its count in the first `data.yml` log; 511 Ontario and Alberta need developer keys.

Before v2.1:

Working: the full globe app, website, desktop app (Rust crate checked with `cargo check`), live-data snapshot with real OpenSky credentials (about 10,000 aircraft), news fallback, aircraft classes and 3D models, the ground-view viewer, cursor zoom, street-level zoom buttons, crisp mid-zoom imagery, the 15-source camera collector, APA references, the end-to-end tests and the overlap check.

Known gaps and risks:
1. **(Mostly done in v2.1, see above.) Eight camera sources added in v1.12 were untested against the live services** (Germany Autobahn, DriveBC, NZ Transport Agency, Taiwan Freeway Bureau, Québec 511, Live Traffic NSW, Vegagerðin Iceland, DGT Spain). The parsers were tested only with mocked responses. Check the counts in the "Refresh camera data" (`data.yml`) log and fix the field names for any source returning 0. 511 Ontario and 511 Alberta currently return 0 (they may now need an API key).
2. **(Done in v2.1: `aircraft-db`.) Aircraft class was mostly a guess:** OpenSky gives no type code and often no emitter category. A type lookup table (ICAO 24-bit address → type, e.g. from the OpenSky aircraft database, refreshed weekly into `live-data`) would make the classes accurate.
3. Shader compilation can still pause the first close zoom on weak GPUs without parallel shader compilation.
4. Desktop builds are not code-signed (Windows SmartScreen and macOS Gatekeeper warnings).
5. The live-data job and the camera job rely on free public services that can change without notice. (v2.1: Data health panel and weekly probe.)
6. Mainland China publishes no open road-camera feeds; Hong Kong and Taiwan cover the region.

## 7. Testing

```bash
pip install playwright && python -m playwright install chromium
MOCK_REAL=1 bash tests/e2e/run.sh test_v2.py   # 15 checks; expect "SUMMARY 15 / 15"
bash tests/e2e/run.sh test_v21.py               # 17 checks for v2.1; expect "SUMMARY 17 / 17"
bash tests/e2e/run.sh test_intel.py             # Intel section: documents, redaction inspector, tools
node tests/intel/test-intel.mjs && bash tests/e2e/run.sh test_osint.py   # Intelligence toolkit (Osiris)
python3 tests/docs/check_readme.py              # README pictures, links, version and progress tracker (14 checks)
bash tests/e2e/run.sh test_v210.py              # GIA branding, modulepreload, service-worker cache (10 checks)
bash tests/e2e/run.sh test_v29.py               # open data instead of World Monitor's lists, About → Datasets (17 checks)
node tests/opendata/test-open-data.mjs          # open-data job on stand-in Wikidata, World Port Index and TeleGeography files (15 checks)
bash tests/e2e/run.sh test_v28.py               # Water Quality Portal pesticides in rivers and wells (11 checks)
bash tests/e2e/run.sh test_v27.py               # CalEnviroScreen tracts and ECHO violations (9 checks)
bash tests/e2e/run.sh test_v26.py               # chemicals and environment: pesticide use, county estimates, TRI (13 checks)
node tests/regional/test-regional.mjs           # regional-data job on stand-in PUR, EPest, Gazetteer, TRI, CalEnviroScreen, ECHO and Water Quality Portal files; PLSS maths (25 checks)
bash tests/e2e/run.sh test_v25.py               # registry: manifests, editions, plug-ins (20 checks)
bash tests/e2e/run.sh test_v24.py               # replay: frames, slider, Play, USGS window, reference projects (15 checks)
node tests/history/test-history.mjs             # history frames and pruning (5 checks)
bash tests/e2e/run.sh test_v23.py               # terrain and buildings: landscape module, Street level, 3D surroundings (15 checks)
bash tests/e2e/run.sh test_v22.py               # ships worldwide: snapshot, Baltic fallback, proxy and desktop paths (18 checks)
npm install --no-save --prefix tests/ais ws@8.18.3 && node tests/ais/test-ais.mjs   # AIS reader and the live-data ship collector (6 checks)
bash tests/e2e/run.sh webcams.py                # worldwide webcams; needs site/app/data/worldcams/ (run fetch-worldcams.mjs first)
bash tests/e2e/run.sh overlap.py                # expect "no overlaps" at all six window sizes
cd desktop/src-tauri && cargo check             # desktop crate
```
`tests/e2e/mock.py` intercepts every external request. `MOCK_REAL=1` serves the recorded snapshot in `tests/e2e/fixtures/`; `MOCK_CORS=1` makes flight and orbit hosts fail as they do in a browser. Tests use software WebGL (SwiftShader), so their timings are pessimistic; the browser console object is `window.gia`. The same two tests run in `.github/workflows/tests.yml`.

## 8. Release checklist

Version strings (also the version pins in `tests/e2e/*.py`): `VERSION` in `site/app/js/main.js`, the badge in `site/app/index.html`, the cache name in `site/sw.js`, `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` and the `global-intelligence-atlas` entry in `Cargo.lock`, the ribbon in `site/index.html`, `CITATION.cff`. Then: What's new (`whatsNew()` in `main.js`), a `CHANGELOG.md` section (and the README version badge and Progress table), a `NOTICE.md` row, regenerate references, run the tests, push, and tag `vX.Y.Z` to build the desktop installers.

## 9. Recommended next features (in priority order)

Items 1–4 shipped in v2.1.0; item 5 in v2.2.0; item 6 in v2.3.0; item 7 in v2.4.0; item 8 in v2.5.0.

1. **(Done) Data health panel and source monitor:** one place (Tools or About) that shows every source's status, last update, item count and error, fed by the `status.json` already written to `live-data`; plus a weekly workflow that probes every source and opens an issue when one breaks.
2. **(Done) Accurate aircraft types:** add an ICAO-address-to-type table to `live-data` (gap 2), so 3D models, the flights board and search by type are reliable.
3. **(Done) Fire hotspots** from NASA FIRMS (Fire Information for Resource Management System; free key as a repository secret, fetched by the live-data job) and **weather radar** from RainViewer, with a time slider.
4. **(Done) Watch areas and alerts:** draw an area, choose events (earthquake above a magnitude, a disaster alert, an emergency squawk, news volume) and get browser or desktop notifications. Store watch areas locally.
5. **(Done) Worldwide ships:** AISStream (free key, WebSocket) through the desktop app and the proxy; keep the Finnish feed as the no-key fallback.
6. **(Done) Terrain and buildings for the ground view:** open terrain tiles (e.g. AWS Terrain Tiles) and OpenStreetMap buildings at street level, so planes and cameras sit in a real 3D landscape.
7. **(Done) History and replay:** keep daily compressed snapshots (flights, quakes, alerts) on a `history` branch and add a replay timeline for the last 7–30 days.
8. **(Done) Layer plugin system:** turn each layer into a self-describing module (manifest with id, group, sources, licence, refresh, capabilities) loaded from a registry. This makes it easy to ship different editions of the atlas from one codebase.
9. **(Started in v2.9: seven layers can use open data; see section 6.) Replace or make optional World Monitor's datasets** with independently sourced open data (e.g. TeleGeography cables, Global Energy Monitor pipelines, NGA World Port Index), keeping attribution. Only once nothing from World Monitor remains could the licence be reconsidered; until then it stays AGPL-3.0-only.
10. **Desktop polish:** code signing, the Tauri updater with signed releases, offline caching of the last snapshot, native notifications for item 4.
11. **Accessibility and languages:** a keyboard and screen-reader list view of what is on the map, high-contrast theme, and translations (start with Spanish).
12. **Code health:** JSDoc types checked by TypeScript (`checkJs`), ESLint, splitting `main.js` (about 1,700 lines) into camera, picking, cards and compose modules.

## 10. Moving from the old fork (one-time)

The old fork `Normansrule/worldmonitor` hosted the previous site, the `live-data` branch and the OpenSky secrets. In the new repository: enable Pages (Settings → Pages → Source: GitHub Actions), add the two OpenSky secrets, run `live.yml` and `data.yml` once, and check the site. Only then delete or archive the fork; deleting it removes the old site, its releases and its `live-data` branch permanently.
