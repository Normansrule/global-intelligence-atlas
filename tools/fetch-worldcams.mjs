#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — worldwide public webcams from WorldCam (WorldScope, github.com/MALCO2BZ/malco2b,
// MIT licence, a fork of Argus by GoSlowPoke168), split into 10°×10° cells under site/app/data/worldcams/.
//
// WorldCam lists about 229,000 cameras. Only feeds their operators deliberately publish are kept:
//   1. the address is HTTPS, uses a domain name (never a bare IP address) and carries no user name or password;
//   2. WorldCam marks the record as directly viewable (directEligible) and the feed is an image, motion JPEG,
//      HTTP Live Streaming (HLS) or MP4 stream (embedded web players are skipped);
//   3. the host is a government, public-agency, university or research domain (see isPublicHost), or is on the
//      reviewed PUBLISHERS list below: road agencies on their own domains and webcam directories whose cameras are
//      submitted by their owners (Windy Webcams, feratel, Panomax, Roundshot …). Every other host is dropped, so
//      cameras exposed by accident (Insecam-style lists) cannot slip in through the long tail.
// Cameras that tools/fetch-cameras.mjs already collects straight from the agency are skipped here.
// Only metadata is stored; images always load from the publisher. Usage: node tools/fetch-worldcams.mjs [file.geojson]
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';

const DIR = 'site/app/data/worldcams';
const UPSTREAM = process.env.WORLDCAM_URL ?? 'https://raw.githubusercontent.com/MALCO2BZ/malco2b/master/public/cameras.geojson';
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/2.1 (+https://github.com/Normansrule/global-intelligence-atlas; educational map)' };

// Reviewed hosts → [publisher, kind]. Kinds: 0 government or public agency, 1 webcam directory (owner-submitted),
// 2 tourism, weather or aviation webcam network, 3 research or university. A key may be "host/first-path-segment".
const KIND = ['Government or public agency', 'Webcam directory (cameras submitted by their owners)', 'Tourism, weather or aviation webcam network', 'Research or university'];
const PUBLISHERS = {
  // road and transport agencies on their own (non-.gov) domains
  'prod-ut.ibi511.com': ['State 511 traveller information (United States)', 0], 'prod-nb.ibi511.com': ['New Brunswick 511 (Canada)', 0],
  '511ga.org': ['Georgia 511 (Georgia Department of Transportation)', 0], 'www.nvroads.com': ['Nevada Department of Transportation', 0],
  'fl511.com': ['Florida 511 (Florida Department of Transportation)', 0], 'www.511pa.com': ['511PA (Pennsylvania Department of Transportation)', 0],
  'www.az511.com': ['Arizona 511 (Arizona Department of Transportation)', 0], 'www.ctroads.org': ['CTroads (Connecticut Department of Transportation)', 0],
  '511ny.org': ['511NY (New York State Department of Transportation)', 0], 'www.511la.org': ['511 Louisiana (Louisiana Department of Transportation and Development)', 0],
  'www.newengland511.org': ['New England 511 (Maine, New Hampshire and Vermont)', 0], '511on.ca': ['511 Ontario (Ministry of Transportation of Ontario)', 0],
  '511.alberta.ca': ['511 Alberta (Alberta Transportation)', 0], '511.novascotia.ca': ['511 Nova Scotia', 0], '511nl.ca': ['511 Newfoundland and Labrador', 0],
  'www.manitoba511.ca': ['Manitoba 511', 0], 'micamerasimages.net': ['Michigan Department of Transportation (MiDrive)', 0],
  'tripcheck.com': ['TripCheck (Oregon Department of Transportation)', 0], 'cctv.travelmidwest.com': ['Travel Midwest (Illinois Department of Transportation)', 0],
  'www.houstontranstar.org': ['Houston TranStar', 0], 'www.lakecountypassage.com': ['Lake County PASSAGE (Illinois)', 0],
  'public.carsprogram.org': ['CARS Program state 511 cameras (United States)', 0], 'irecam.carsprogram.org': ['Transport Infrastructure Ireland', 0],
  'cocam.carsprogram.org': ['COtrip (Colorado Department of Transportation)', 0], 'api.algotraffic.com': ['ALGO Traffic (Alabama Department of Transportation)', 0],
  'www.kcscout.net': ['KC Scout (Missouri and Kansas Departments of Transportation)', 0], 'sd.cdn.iteris-atis.com': ['South Dakota Department of Transportation (SD511)', 0],
  'cctv.austinmobility.io': ['City of Austin Transportation and Public Works', 0], 'opendata.toronto.ca': ['City of Toronto open data', 0],
  'traffic.ottawa.ca': ['City of Ottawa', 0], 'trafficcams.vancouver.ca': ['City of Vancouver', 0],
  'trafficnz.info': ['NZ Transport Agency Waka Kotahi', 0], 'www.trafficnz.info': ['NZ Transport Agency Waka Kotahi', 0],
  'public.highwaystrafficcameras.co.uk': ['National Highways (England)', 0], 'www.netraveldata.co.uk': ['North East England traffic data (local authorities)', 0],
  'members.traffic.wales': ['Traffic Wales (Welsh Government)', 0], 's3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk': ['Transport for London (JamCams)', 0],
  'etraffic.dgt.es': ['Dirección General de Tráfico (DGT, Spain)', 0], 'informo.madrid.es': ['Ayuntamiento de Madrid (Informo)', 0],
  'apps.trafikoa.euskadi.eus': ['Basque Government traffic service (Trafikoa)', 0], 'www.bizkaimove.eus': ['Bizkaia Provincial Council (Bizkaimove)', 0],
  'cic.tenerife.es': ['Cabildo de Tenerife', 0], 'webcams2.asfinag.at': ['ASFINAG (Austrian motorways, state-owned)', 0],
  'video.autostrade.it': ['Autostrade per l’Italia', 0], 'map.bayerninfo.de': ['BayernInfo (Bavarian State Ministry for Housing, Building and Transport)', 0],
  'kamera.atlas.vegvesen.no': ['Statens vegvesen (Norwegian Public Roads Administration)', 0], 'weathercam.digitraffic.fi': ['Fintraffic (Finland)', 0],
  'www.vegagerdin.is': ['Vegagerðin (Icelandic Road and Coastal Administration)', 0], 'eismoinfo.lt': ['Lithuanian Road Administration (Eismo info)', 0],
  'pildid.teeilm.ee': ['Estonian Transport Administration (Tark Tee)', 0], 'ristmikud.tallinn.ee': ['Tallinn City Government', 0],
  'trafiroutes.wallonie.be': ['Service public de Wallonie (Trafiroutes)', 0], 'www.cita.lu': ['CITA (Luxembourg motorway control centre)', 0],
  'www.zdw.krakow.pl': ['Zarząd Dróg Miasta Krakowa (Kraków roads authority)', 0], 'www.dopravainformace.cz': ['Ředitelství silnic a dálnic (Czech Road and Motorway Directorate)', 0],
  'm.hak.hr': ['HAK (Croatian Auto Club traffic information)', 0], 'imgs.mobilitat.ad': ['Govern d’Andorra (Mobilitat)', 0],
  'www.inforoutes06.fr': ['Département des Alpes-Maritimes (Inforoutes 06)', 0], 'streaming1.dsatmacau.com': ['Macao Transport Bureau (DSAT)', 0],
  'www.i-traffic.co.za': ['SANRAL i-traffic (South African National Roads Agency)', 0], 'cdn-livecamera-pic.drivetraffic.jp': ['NEXCO (Japan expressway companies)', 0],
  'usgs-nims-images.s3.amazonaws.com': ['U.S. Geological Survey (HIVIS river cameras)', 0], 'www.metcam.navcanada.ca': ['NAV CANADA weather cameras', 0],
  'weathercams.airservicesaustralia.com': ['Airservices Australia weather cameras', 0],
  // research and universities on non-.edu domains
  'cameras.alertcalifornia.org': ['ALERTCalifornia (University of California San Diego)', 3], 'api.nysmesonet.org': ['New York State Mesonet (University at Albany)', 3],
  // webcam directories and owner-run webcam networks
  'imgproxy.windy.com': ['Windy Webcams', 1], 'images-webcams.windy.com': ['Windy Webcams', 1],
  'wtvthmb.feratel.com': ['feratel webcams', 2], 'wtvpict.feratel.com': ['feratel webcams', 2], 'live-image.panomax.com': ['Panomax', 2],
  'backend.roundshot.com': ['Roundshot', 2], 'www.foto-webcam.eu': ['Foto-Webcam.eu', 2], 'imageserver.webcamera.pl': ['WebCamera.pl', 2],
  'webcams.opensnow.com': ['OpenSnow resort webcams', 2], 'images.weatherstem.com': ['WeatherSTEM', 2], 'view.myairportcams.com': ['MyAirportCams', 2],
  'www.infoclimat.fr': ['Infoclimat', 2], 'www.avametnuvol.es': ['AVAMET (Valencian Meteorology Association)', 2], 'oratge.es': ['AVAMET (Valencian Meteorology Association)', 2],
  'www.terra-hd.de': ['Terra-HD', 2], 'storage.hdontap.com': ['HDOnTap', 2], 'api.wetmet.net': ['WetMet', 2], 'cdn.livespotting.com': ['Livespotting', 2],
  'cam-aero.eu': ['cam-aero.eu airfield webcams', 2], 'aero.webcam': ['aero.webcam airfield webcams', 2], 'www.skiutah.com': ['Ski Utah', 2],
  'stream.resortcams.com': ['ResortCams', 2], 'www.hispacams.com': ['Hispacams', 2], 'www.surfchex.com': ['Surfchex', 2], 'public.aopa.nz': ['AOPA New Zealand airfield webcams', 2],
  'kenyawebcam.com': ['Aero Club of East Africa', 2], 'stream.mazury24.eu': ['Mazury24', 2], 'sochi.camera': ['Sochi city webcams', 2],
  'www.skaping.com': ['Skaping', 2],
};
const VDOT = /^media-sfs\d+\.vdotcameras\.com$/; // Virginia Department of Transportation media servers
const PUBLIC_LABEL = new Set(['gov', 'gouv', 'gob', 'gub', 'go', 'govt', 'gc', 'gv', 'pref', 'lg', 'mil', 'edu', 'ac', 'state', 'admin']);
// Government, public-agency, university and research domains: example.gov, x.gov.uk, x.go.jp, dot.state.mn.us, hotline.gov.sk.ca, x.gov.taipei.
function isPublicHost(h) {
  const l = h.split('.'); const tld = l.at(-1); const cc = tld.length === 2;
  if (['gov', 'edu', 'mil'].includes(tld)) return true;
  if (l.length >= 2 && PUBLIC_LABEL.has(l.at(-2)) && (cc || l.at(-2) === 'gov')) return true;
  if (l.length >= 3 && cc && PUBLIC_LABEL.has(l.at(-3))) return true;
  return false;
}
const IP = /^(\d+\.){3}\d+$|^\[?[0-9a-f:]+\]?$/i;
const SECRET = /[?&](pass(word)?|pwd|passwd|token|auth|sig|signature)=/i; // a bare viewer name (ASFINAG's ?user=landtir) is fine; passwords and expiring tokens are not
const TYPES = ['traffic', 'landmark', 'beach', 'ski', 'weather', 'aviation', 'nature', 'water', 'airport', 'port', 'volcano', 'science', 'observatory', 'satellite', 'border', 'railway', 'space', 'wildlife', 'tourism', 'other'];
// Short, stable camera id (FNV-1a of WorldCam's id) for links such as #cam:w-1x2y3z.
const shortId = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return `w-${(h >>> 0).toString(36)}`; };
const ids = new Set(); const uniq = (id) => { let x = id; for (let n = 2; ids.has(x); n++) x = `${id}-${n}`; ids.add(x); return x; };
const round = (x) => Math.round(x * 1e5) / 1e5;
const ok = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// Hosts the native collector already covers (only those that actually returned cameras in its last run).
const native = new Set();
if (existsSync('site/app/data/cameras.json')) for (const c of JSON.parse(readFileSync('site/app/data/cameras.json', 'utf8')).cams) { try { const u = new URL(c[4]); native.add(u.hostname === 's3-eu-west-1.amazonaws.com' ? `${u.hostname}/${u.pathname.split('/')[1]}` : u.hostname); } catch {} }

let gj;
try {
  gj = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : await fetch(UPSTREAM, { headers: UA, signal: AbortSignal.timeout(600_000) }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
} catch (e) { console.error(`WorldCam download failed (${e.message}); keeping the existing snapshot.`); process.exit(0); }

const drop = {}; const no = (why) => { drop[why] = (drop[why] ?? 0) + 1; return null; };
const pubs = []; const pubIx = new Map(); const pubCount = []; const seen = new Set(); const cells = {}; const density = {}; let total = 0;
for (const f of gj.features ?? []) {
  const p = f.properties ?? {}; const [lng, lat] = f.geometry?.coordinates ?? [];
  if (!ok(lat, lng)) { no('no position'); continue; }
  const kind = String(p.feedType ?? '').toLowerCase();
  if (kind === 'iframe' || kind.includes('json')) { no('web player or agency-specific format'); continue; }
  if (!p.directEligible) { no('not marked directly viewable by WorldCam'); continue; }
  const raw = p.streamUrl || p.feedUrl; let u;
  try { u = new URL(raw); } catch { no('unreadable address'); continue; }
  if (u.protocol !== 'https:') { no('not HTTPS'); continue; }
  if (IP.test(u.hostname)) { no('bare IP address'); continue; }
  if (u.username || u.password || SECRET.test(u.search)) { no('address carries credentials'); continue; }
  const h = u.hostname; const hk = h === 's3-eu-west-1.amazonaws.com' ? `${h}/${u.pathname.split('/')[1]}` : h;
  const pub = PUBLISHERS[hk] ?? (VDOT.test(h) ? ['Virginia Department of Transportation', 0] : isPublicHost(h) ? [h, /\.(edu|ac)(\.|$)/.test(h) ? 3 : 0] : null);
  if (!pub) { no('host not on the reviewed publisher list'); continue; }
  if (native.has(hk) || native.has(h)) { no('already collected from the agency'); continue; }
  if (seen.has(raw)) { no('duplicate'); continue; }
  seen.add(raw);
  const isStream = /m3u8|mp4/.test(kind) || /\.(m3u8|mp4)(\?|$)/i.test(raw);
  const img = isStream ? (p.feedUrl && p.feedUrl !== raw && /^https:/.test(p.feedUrl) && !/\.(m3u8|mp4)(\?|$)/i.test(p.feedUrl) ? p.feedUrl : '') : raw;
  let pi = pubIx.get(pub[0]);
  if (pi === undefined) { pi = pubs.length; pubIx.set(pub[0], pi); pubs.push(pub); pubCount.push(0); }
  pubCount[pi]++;
  const ti = TYPES.indexOf(p.type); const ty = ti < 0 ? TYPES.length - 1 : ti;
  const name = String(p.name || p.city || 'Webcam').slice(0, 120);
  const page = /^https:/.test(p.playerUrl ?? '') ? p.playerUrl : '';
  const k = `${Math.floor(lat / 10) * 10}_${Math.floor(lng / 10) * 10}`;
  (cells[k] ??= []).push([uniq(shortId(String(p.id))), name, round(lat), round(lng), img, isStream ? raw : '', pi, ty, p.country ?? '', String(p.city ?? '').slice(0, 60), page]);
  const dk = `${Math.floor(lat)}_${Math.floor(lng)}`; density[dk] = (density[dk] ?? 0) + 1;
  total++;
}
if (total < 1000) { console.error(`Only ${total} cameras passed the checks; keeping the existing snapshot.`); process.exit(0); }
// Shared address prefixes ("https://imgproxy.windy.com/_/preview/plain/current/") are stored once in index.json
// and written as "~<index>/<rest>" in the rows, which roughly halves the snapshot.
const URL_COLS = [4, 5, 10]; const pfxCount = new Map();
const pfxOf = (s) => s.slice(0, s.lastIndexOf('/') + 1);
for (const rows of Object.values(cells)) for (const r of rows) for (const c of URL_COLS) if (r[c]) pfxCount.set(pfxOf(r[c]), (pfxCount.get(pfxOf(r[c])) ?? 0) + 1);
const prefixes = [...pfxCount].filter(([q, n]) => n >= 20 && q.length > 12).sort((a, b) => b[1] - a[1]).map(([q]) => q);
const pfxIx = new Map(prefixes.map((q, i) => [q, i]));
for (const rows of Object.values(cells)) for (const r of rows) for (const c of URL_COLS) { const i = r[c] ? pfxIx.get(pfxOf(r[c])) : undefined; if (i !== undefined) r[c] = `~${i}/${r[c].slice(prefixes[i].length)}`; }
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
for (const [k, rows] of Object.entries(cells)) writeFileSync(`${DIR}/${k}.json`, JSON.stringify({ rows }));
writeFileSync(`${DIR}/density.json`, JSON.stringify({ rows: Object.entries(density).map(([k, c]) => { const [a, b] = k.split('_').map(Number); return [a + 0.5, b + 0.5, c]; }) }));
writeFileSync(`${DIR}/index.json`, JSON.stringify({
  generatedAt: new Date().toISOString(), upstream: UPSTREAM, total, upstreamTotal: gj.features?.length ?? 0,
  cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.length])),
  publishers: pubs.map(([name, kind], i) => ({ name, kind, count: pubCount[i] })), kinds: KIND, types: TYPES, prefixes, dropped: drop,
  attribution: 'Camera list: WorldCam / WorldScope (MALCO2BZ, MIT licence; derived from Argus by GoSlowPoke168). Images © their publishers.',
}));
console.log(`WorldCam: ${gj.features?.length ?? 0} records → ${total} kept from ${pubs.length} publishers in ${Object.keys(cells).length} cells`);
for (const [why, n] of Object.entries(drop).sort((a, b) => b[1] - a[1])) console.log(`  dropped ${n.toLocaleString('en')}: ${why}`);
