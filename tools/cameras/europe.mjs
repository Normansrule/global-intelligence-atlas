// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — public cameras for Europe: Autostrade per l'Italia motorway clips (Italy),
// Trafikverket road cameras (Sweden), nadmorski24.pl / TV Chopin live streams (Polish Baltic coast) and a short
// list of city and border-crossing cameras in Bulgaria, North Macedonia, Serbia, Romania, Poland and Switzerland.
// Source lists, URLs and record shapes adapted from Osiris by simplifaisoul, MIT
// (https://github.com/simplifaisoul/osiris, src/app/api/cctv). Every request goes through get() and identifies
// the atlas honestly; Osiris's spoofed-header "stealthFetch", its image proxy and its Referer workarounds are
// not used, so ASFINAG (Austria), Rijkswaterstaat (Netherlands) and Via Lietuva (Lithuania) are left out: they
// answer only lifted widget credentials or a faked Referer. YouTube/SkylineWebcams embeds (Czechia, France,
// Germany, Slovakia, Greece's ipcamlive player, Turkey) are left out too: the atlas plays only stills, HLS and MP4.
// Parsers are pure and exported so tests/cameras/europe.test.mjs can run them on fixtures.
import { get, ok, row, pool } from './util.mjs';

const CAP = 5000;
const inBox = (lat, lng, b) => ok(lat, lng) && lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3];
const clean = (s) => (typeof s === 'string' ? s.replace(/[︀-️]/g, '').replace(/\s+/g, ' ').trim() : '');
/** An https URL on exactly `host`, normalised — or ''. */
const httpsOn = (v, host) => { if (typeof v !== 'string') return ''; try { const u = new URL(v); return u.protocol === 'https:' && u.hostname === host ? u.href : ''; } catch { return ''; } };

// ── Italy: Autostrade per l'Italia ────────────────────────────────────────────────────────────────────
// ~970 motorway cameras from the list its own traffic map loads. Each is a short MP4 clip, re-recorded every
// few minutes at the same address. The clip path is checked against the one shape it takes before it is joined
// onto Autostrade's video host; cameras whose last clip is over a day old have stopped recording.
export const ASPI_LIST = 'https://viabilita.autostrade.it/json/webcams.json';
export const ASPI_VIDEO = 'https://video.autostrade.it/video-mp4_hq/';
const CLIP_PATH = /^[a-z0-9]{2,8}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{1,4}\.mp4$/;
const IT_BOX = [36, 47.5, 6.5, 18.5];
/** "09-10-2026" + "05:40" → epoch ms (read as UTC; an hour either way does not matter against a day), or NaN. */
export function clipTime(day, time) {
  const d = typeof day === 'string' ? day.match(/^(\d{2})-(\d{2})-(\d{4})$/) : null;
  const t = typeof time === 'string' ? time.match(/^(\d{2}):(\d{2})$/) : null;
  return d && t ? Date.UTC(+d[3], +d[2] - 1, +d[1], +t[1], +t[2]) : NaN;
}
export function parseAutostrade(raw, now = Date.now()) {
  const list = raw?.webcams; if (!Array.isArray(list)) throw new Error('Autostrade list is missing webcams[]');
  const out = []; const seen = new Set();
  for (const c of list) {
    const id = Number(c?.c_tel); const lat = Number(c?.n_crd_lat); const lng = Number(c?.n_crd_lon); const clip = c?.frames?.V?.t_url;
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || typeof clip !== 'string' || !CLIP_PATH.test(clip) || !inBox(lat, lng, IT_BOX)) continue;
    if (!(now - clipTime(c.t_day, c.t_time) < 24 * 3600_000)) continue;
    seen.add(id);
    const road = clean(c.t_des_str) || 'Autostrade'; const where = clean(c.t_des);
    out.push(row(`it-aspi-${id}`, where ? `${road.split(' ')[0]} ${where}` : road, lat, lng, '', `${ASPI_VIDEO}${clip}`, `${road} · Italy`));
    if (out.length >= CAP) break;
  }
  return out;
}
async function autostrade() { return parseAutostrade(await get(ASPI_LIST)); }

// ── Sweden: Trafikverket road cameras ─────────────────────────────────────────────────────────────────
// With the free TRAFIKVERKET_KEY (https://data.trafikverket.se/) the atlas asks Trafikverket's own open API.
// Without one it falls back, as Osiris does, to the county lists published by Kolla Trafiken
// (www.kollatrafiken.se), keeping only pictures served by Trafikverket itself. Either way the images load
// straight from api.trafikinfo.trafikverket.se.
export const TV_API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
export const TV_HOST = 'api.trafikinfo.trafikverket.se';
export const KOLLA = 'https://www.kollatrafiken.se';
const SE_BOX = [55.0, 69.2, 10.5, 24.3];
const SAFE_ID = /^[\w-]{1,40}$/;
export const trafikverketQuery = (key) => `<REQUEST><LOGIN authenticationkey="${String(key).replace(/[<>"&]/g, '')}" /><QUERY objecttype="Camera" namespace="road.infrastructure" schemaversion="1" limit="${CAP}"><FILTER><EQ name="Active" value="true" /></FILTER></QUERY></REQUEST>`;
/** "Stockholms län" → "Stockholm", "Västra Götalands län" → "Västra Götaland". */
export const countyLabel = (name) => (typeof name === 'string' && name.trim() ? name.trim().replace(/\s+län$/i, '').replace(/s$/, '') : 'Sweden');
/** Trafikverket API response → rows. Geometry.WGS84 is "POINT (lng lat)". */
export function parseTrafikverket(j) {
  const result = j?.RESPONSE?.RESULT?.[0];
  if (!result) throw new Error(`Trafikverket answered without a RESULT${j?.RESPONSE?.RESULT ? '' : ` (${JSON.stringify(j).slice(0, 120)})`}`);
  if (result.ERROR) throw new Error(`Trafikverket: ${result.ERROR.MESSAGE ?? JSON.stringify(result.ERROR)}`);
  const out = []; const seen = new Set();
  for (const c of result.Camera ?? []) {
    const id = String(c?.Id ?? ''); const m = String(c?.Geometry?.WGS84 ?? '').match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i);
    const img = httpsOn(c?.PhotoUrl, TV_HOST);
    if (!SAFE_ID.test(id) || seen.has(id) || c.Active === false || c.Deleted === true || !m || !img) continue;
    const lng = +m[1]; const lat = +m[2]; if (!inBox(lat, lng, SE_BOX)) continue;
    seen.add(id);
    out.push(row(`se-tv-${id}`, clean(c.Name) || 'Trafikverket camera', lat, lng, c.HasFullSizePhoto ? `${img}${img.includes('?') ? '&' : '?'}type=fullsize` : img, '', [clean(c.Type), 'Sweden'].filter(Boolean).join(' · ')));
    if (out.length >= CAP) break;
  }
  return out;
}
/** Kolla Trafiken /api/v1/cameras (one county) → rows. */
export function parseKolla(raw, county) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    const id = String(c?.id ?? ''); const lat = Number(c?.lat); const lng = Number(c?.lng); const img = httpsOn(c?.url, TV_HOST);
    if (!SAFE_ID.test(id) || !img || !inBox(lat, lng, SE_BOX)) continue;
    out.push(row(`se-tv-${id}`, clean(c.name) || 'Trafikverket camera', lat, lng, img, '', `${county} · Sweden`));
  }
  return out;
}
const kollaPost = (path, body) => get(`${KOLLA}${path}`, 'json', { method: 'POST', body, timeout: 20_000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } });
async function trafikverket() {
  const key = process.env.TRAFIKVERKET_KEY;
  if (key) return parseTrafikverket(await get(TV_API, 'json', { method: 'POST', body: trafikverketQuery(key), headers: { 'Content-Type': 'text/xml' } }));
  const counties = (await kollaPost('/api/v1/counties', ''))?.result ?? [];
  const list = counties.filter((c) => typeof c?.id === 'string' && /^[a-z-]{2,40}$/.test(c.id));
  if (!list.length) throw new Error('Kolla Trafiken listed no counties (add the free TRAFIKVERKET_KEY secret to use Trafikverket’s own API)');
  const per = await pool(list, 4, (c) => kollaPost('/api/v1/cameras', `county=${encodeURIComponent(c.id)}`).then((raw) => parseKolla(raw, countyLabel(c.name))).catch((e) => { console.warn(`kollatrafiken ${c.id}: ${e.message.slice(0, 120)}`); return []; }));
  const byId = new Map(); for (const r of per.flat()) byId.set(r[0], r);
  return [...byId.values()].slice(0, CAP);
}

// ── Poland: nadmorski24.pl live streams (TV Chopin) ────────────────────────────────────────────────────
// ~70 public HLS cameras on the Baltic coast and the lower Vistula, served by the local broadcaster TV Chopin.
// [nadmorski24 id, name, lat, lng, stream name on ls.tkchopin.pl]
export const NADMORSKI_BASE = 'https://ls.tkchopin.pl/live/';
export const NADMORSKI = [
  [2, "Gdynia - Orłowo", 54.48052, 18.56433, "gdynia_orlowo_plaza_obrotowa.stream"],
  [3, "Gdańsk - Stare Miasto, Motława", 54.35192, 18.65882, "gdansk_olowianka_widok_motlawa_obrotowa.stream"],
  [4, "Białogóra - Plaża", 54.8287, 17.94724, "bialogora_plaza_obrotowa.stream"],
  [5, "Bolszewo - Skrzyżowanie Zamostna/DW468", 54.61056, 18.18154, "bolszewo_skrzyzowanie_k6_zamostna_static.stream"],
  [6, "Brzyno - Przystań", 54.77307, 18.02515, "brzyno_przystan_j_zarnowieckie_static.stream"],
  [7, "Chałupy - Przystań", 54.75998, 18.50547, "chalupy_molo_obrotowa.stream"],
  [8, "Dębki - ul. Morska", 54.82947, 18.08728, "debki_ulica_morska_static.stream"],
  [9, "Dębki - Plaża", 54.83304, 18.08808, "debki_plaza_static.stream"],
  [10, "Dębki - Plaża (kamera obrotowa)", 54.83304, 18.08835, "debki_plaza_obrotowa.stream"],
  [11, "Gdańsk - Górki Zachodnie NCŻ", 54.36818, 18.77862, "gdansk_gorki_zachodnie_ncz_obrotowa.stream"],
  [12, "Gdańsk - Teatr Szekspirowski", 54.34761, 18.64857, "gdansk_centrum_teatr_szekspirowski_obrotowa.stream"],
  [13, "Gdynia - Przystań jachtowa", 54.51774, 18.55496, "gdynia_marina_obrotowa.stream"],
  [14, "Gdynia - Molo Południowe", 54.51878, 18.55346, "gdynia_al_jana_pawla_nabrzerze_pomorskie_obrotowa.stream"],
  [15, "Gniew - Panorama miasta", 53.83392, 18.82345, "gniew_widok_rynek_wieza_kosciola_static.stream"],
  [16, "Gniew - Zakole Wisły", 53.82994, 18.837, "gniew_widok_zakole_wisly_obrotowa.stream"],
  [17, "Gnieżdżewo - Rondo", 54.75233, 18.3852, "gniezdzewo_rondo_obrotowa.stream"],
  [18, "Hel - Bulwar Nadmorski", 54.60494, 18.80138, "hel_bulwar_nadmorski_obrotowa.stream"],
  [19, "Hel - ul. Dworcowa", 54.61098, 18.80159, "hel_skrzyzowanie_dworcowa_przybyszewskiego_static.stream"],
  [20, "Jastarnia - Molo", 54.69706, 18.66938, "jastarnia_molo_static.stream"],
  [21, "Jastarnia - Rondo", 54.70603, 18.6578, "jastarnia_rondo_static.stream"],
  [22, "Jastrzębia Góra - Plaża", 54.83544, 18.30526, "jastrzebiagora_plaza_static.stream"],
  [23, "Jurata - Molo", 54.6819, 18.71079, "jurata_molo_static.stream"],
  [24, "Karwia - Plaża", 54.83227, 18.20926, "karwia_plaza_static.stream"],
  [25, "Krokowa - Rondo", 54.77909, 18.16373, "krokowa_rondo_obrotowa.stream"],
  [26, "Lubkowo - Przystań", 54.77761, 18.06357, "lubkowo_przystan_wies_static.stream"],
  [27, "Puck - Plaża, Przystań, Molo", 54.72328, 18.41392, "puck_molo_port_jachtowy_obrotowa.stream"],
  [28, "Puck - Molo", 54.72292, 18.41401, "puck_molo_static.stream"],
  [29, "Puck - Stary Rynek", 54.72046, 18.41129, "puck_stary_rynek_static.stream"],
  [30, "Reda - Gniazdo pustułek", 54.60304, 18.35559, "reda_gniazdo_pustulek_static.stream"],
  [31, "Reda - Skrzyżowanie", 54.60523, 18.34751, "reda_skrzyzowanie_pucka_k6_obrotowa.stream"],
  [32, "Sopot - Molo", 54.44615, 18.5708, "sopot_molo_skwer_kuracyjny_obrotowa.stream"],
  [33, "Sopot - Plaża, Małe Molo", 54.44928, 18.56835, "sopot_plaza_male_molo_obrotowa.stream"],
  [34, "Wejherowo - Filharmonia Kaszubska", 54.60262, 18.22791, "wejherowo_filharmonia_static.stream"],
  [35, "Wejherowo - ul. Orzeszkowej", 54.60293, 18.29998, "wejherowo_skrzyzowanie_orzeszkowej_k6_static.stream"],
  [36, "Wejherowo - Plac Jakuba Wejhera", 54.60189, 18.23941, "wejherowo_plac_jakuba_obrotowa.stream"],
  [37, "Wejherowo - ul. Rybacka", 54.60357, 18.26127, "wejherowo_skrzyzowanie_rybacka_k6_static.stream"],
  [38, "Władysławowo - Aleja Gwiazd Sportu", 54.7997, 18.39912, "wladyslawowo_aleja_gwiazd.stream"],
  [39, "Władysławowo - Widok na Bałtyk", 54.79545, 18.41208, "wladyslawowo_widok_na_baltyk_z_wiezy_domu_rybaka_static.stream"],
  [40, "Władysławowo - Małe Morze", 54.78183, 18.44356, "wladyslawowo_kemping_male_morze_molo_obrotowa.stream"],
  [41, "Władysławowo - Plaża", 54.80083, 18.40478, "wladyslawowo_plaza_obrotowa.stream"],
  [42, "Władysławowo - Półwysep Helski", 54.79448, 18.40932, "wladyslawowo_widok_na_polwysep_helski_z_wiezy_static.stream"],
  [43, "Władysławowo - Port", 54.79743, 18.4149, "wladyslawowo_port_nabrzeze_static.stream"],
  [44, "Władysławowo - Rondo", 54.79013, 18.40875, "wladyslawowo_rondo_gdanska_starowiejska_obrotowa.stream"],
  [46, "Chałupy - FunSurf", 54.75949, 18.50465, "chalupy_szkolka_funsurf.stream"],
  [47, "Gniew - Zamek", 53.83407, 18.82712, "gniew_widok_na_zamek_static.stream"],
  [49, "Wejherowo - Plac Jakuba Wejhera, Fontanna", 54.60167, 18.2397, "wejherowo_rynek_fontanna_obrotowa.stream"],
  [50, "Dębki - Widok z wieży", 54.83276, 18.088, "debki_wieza_rybaczowka_obrotowa.stream"],
  [52, "Grudziądz - Widok na Wisłę", 53.4698, 18.7321, "grudziadz_wisla_static.stream"],
  [54, "Puck - Zatoka Pucka", 54.72178, 18.41106, "puck_wieza_kosciola_zatokapucka_obrotowa.stream"],
  [55, "Reda - Jara, panorama miasta", 54.60042, 18.34162, "reda_jara_static.stream"],
  [56, "Wejherowo - Panorama miasta", 54.59201, 18.22735, "wejherowo_wzgorze_wolnosci_obrotowa.stream"],
  [82, "Gniewino - Kaszubskie Oko", 54.71834, 18.0523, "gniewino_kaszubskie_oko_obrotowa.stream"],
  [83, "Jastarnia - Kemping Maszoperia", 54.71511, 18.6336, "jastarnia_kemping_maszoperia_obrotowa.stream"],
  [84, "Nadole - Przystań", 54.74168, 18.05955, "nadole_przystan_obrotowa.stream"],
  [88, "Lubkowo - DPS, Przystań", 54.75767, 18.07843, "lubkowo_przystan_dps_obrotowa.stream"],
  [91, "Kołobrzeg - Port", 54.18634, 15.55355, "kolobrzeg_port_static.stream"],
  [94, "Reda - MPCK Koksik, gniazdo sokoła", 54.60125, 18.36522, "reda_koksik_gniazdo_obrotowa.stream"],
  [95, "Reda - MPCK Koksik, gniazdo sokoła platforma", 54.60117, 18.36564, "reda_koksik_gniazdo_static.stream"],
  [96, "Chłapowo - Bałtyk z kempingu Lazurowe", 54.80804, 18.38262, "wladyslawowo_kemping_lazurowe_obrotowa.stream"],
  [99, "Jastarnia - Plaża, Dom Zdrojowy", 54.6996, 18.68321, "jastarnia_plaza_dom_zdrojowy_obrotowa.stream"],
  [100, "Chałupy - Kite.pl", 54.76173, 18.49719, "chalupy6_szkolka_kitepl.stream"],
  [101, "Świnoujście - Centrum", 53.90615, 14.23611, "swinoujscie_centrum_obrotowa.stream"],
  [103, "Wejherowo - OPEC, gniazdo sokoła", 54.60981, 18.25651, "wejherowo_opec_gniazdo_static.stream"],
  [104, "Wejherowo - OPEC, gniazdo sokoła platforma", 54.60968, 18.25655, "wejherowo_opec_gniazdo_obrotowa.stream"],
  [105, "Bolszewo - ArtPark", 54.61509, 18.17876, "bolszewo_artpark_static.stream"],
  [106, "Rewa - Surfstacja", 54.63223, 18.50436, "rewa_surf_stacja_obrotowa.stream"],
  [108, "Rumia - Wzgórze Markowca", 54.56474, 18.38308, "rumia_wzgorze_markowca_obrotowa.stream"],
  [110, "Tczew - GPEC, gniazdo sokoła (wnętrze)", 54.08211, 18.74384, "tczew_gpec_gniazdo_wnetrze_720P.stream"],
  [111, "Tczew - GPEC, gniazdo sokoła", 54.08215, 18.74384, "tczew_gpec_gniazdo_podest_720P.stream"],
  [10113, "Sopot - Widok z mola", 54.44849, 18.5778, "sopot_molo_meridian_obrotowa.stream"],
  [10114, "Chałupy - Solar EASY/SURF", 54.75886, 18.50791, "easysurf_1080P.stream"],
];
export const nadmorskiRows = () => NADMORSKI.map(([id, name, lat, lng, s]) => row(`pl-nadm-${id}`, name, lat, lng, '', `${NADMORSKI_BASE}${s}/playlist.m3u8`, `${name.split(' - ')[0]} · Poland`));
async function nadmorski24() { return nadmorskiRows(); }

// ── City and border-crossing cameras (Bulgaria, North Macedonia, Serbia, Romania, Poland, Switzerland) ──
// A short curated list from Osiris: each picture or stream is published on purpose by its operator and loads
// straight from that operator over HTTPS. [id, name, lat, lng, image, stream, area]
export const EUROCAMS = [
  ['bg-sofia-tsarigradsko-uab', 'Sofia — Tsarigradsko Shose (UAB)', 42.662, 23.376, 'https://cdn.uab.org/images/cctv/images/cctv/cctv_103/cctv.jpg', '', 'Sofia · Bulgaria'],
  ['bg-sofia-banishora', 'Sofia — Banishora / Opalchenska', 42.704, 23.327, 'https://meteo.chavo.biz/Camera_streem/live_snap.jpg', '', 'Sofia · Bulgaria (meteo.chavo.biz)'],
  ['bg-burgas-center', 'Burgas — town centre', 42.497, 27.47, '', 'https://pics.smartburgas.eu/m3u8/burgas_town_Center.m3u8', 'Burgas · Bulgaria (Smart Burgas)'],
  ['mk-deve-bair', 'Deve Bair – Gyueshevo border crossing', 42.149, 22.537, '', 'https://streaming1.neotel.net.mk/stream/deve_bair.m3u8', 'North Macedonia (Neotel)'],
  ['mk-tabanovce', 'Tabanovce – Preševo border crossing', 42.232, 21.718, '', 'https://streaming1.neotel.net.mk/stream/tabanovce.m3u8', 'North Macedonia (Neotel)'],
  ['rs-belgrade-live', 'Belgrade live cam', 44.817, 20.456, 'https://stream.uzivobeograd.rs/live/cam_7.jpg', '', 'Belgrade · Serbia (Uživo Beograd)'],
  ['rs-kalotina-gradina-1', 'Kalotina – Gradina border crossing (lane 1)', 42.997, 22.882, '', 'https://kamere.amss.org.rs/gradina1/gradina1.m3u8', 'Serbia (AMSS)'],
  ['ro-bucharest', 'Bucharest panorama', 44.426, 26.102, 'https://home-solutions.bg/cams/bukor.jpg', '', 'Bucharest · Romania (home-solutions.bg)'],
  ['pl-slupsk-1', 'Słupsk — town hall (Ratusz)', 54.46475, 17.02687, 'https://www.slupsk.pl/kamera2', '', 'Słupsk · Poland (Urząd Miasta Słupsk)'],
  ['ch-chuv-heliport', 'CHUV heliport, Lausanne', 46.525, 6.642, 'https://wc-heli.chuv.ch/axis-cgi/jpg/image.cgi?resolution=640x480', '', 'Lausanne · Switzerland (CHUV)'],
];
export const eurocamRows = () => EUROCAMS.map(([id, name, lat, lng, img, stream, area]) => row(id, name, lat, lng, img, stream, area)).filter((r) => (r[4] || r[5]) && ok(r[2], r[3]));
async function eurocams() { return eurocamRows(); }

export const sources = [
  { key: 'autostrade', name: "Autostrade per l'Italia (Italy)", run: autostrade },
  { key: 'trafikverket', name: 'Trafikverket (Sweden)', run: trafikverket },
  { key: 'nadmorski24', name: 'nadmorski24.pl / TV Chopin (Poland)', run: nadmorski24 },
  { key: 'eurocams', name: 'City and border cameras (Bulgaria, North Macedonia, Serbia, Romania, Poland, Switzerland)', run: eurocams },
];
