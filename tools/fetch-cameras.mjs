#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — collect public traffic-camera lists into site/app/data/cameras.json.
// Runs daily in GitHub Actions (.github/workflows/data.yml). Each source is optional: if one is down,
// the others are still written. Only camera metadata is stored; images always load from the agency.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = 'site/app/data/cameras.json';
const UA = { 'User-Agent': 'GlobalIntelligenceAtlas/1.12 (+https://github.com/Normansrule/global-intelligence-atlas; educational map)' };
const UA_JSON = { ...UA, Accept: 'application/json' };
const get = async (url, type = 'json') => {
  const r = await fetch(url, { headers: type === 'text' ? { ...UA, Accept: 'application/xml, text/xml, */*' } : UA_JSON, signal: AbortSignal.timeout(60_000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}: ${body.slice(0, 160)}`);
  if (type === 'text') return body;
  try { return JSON.parse(body); } catch { throw new Error(`${url} → not JSON: ${body.slice(0, 160)}`); }
};
const round = (x) => Math.round(x * 1e5) / 1e5;
const ok = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

async function caltrans() {
  const out = [];
  for (let d = 1; d <= 12; d++) {
    const dd = String(d).padStart(2, '0');
    try {
      const j = await get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`);
      for (const { cctv: c } of j.data ?? []) {
        const loc = c.location ?? {}; const img = c.imageData?.static?.currentImageURL; const stream = c.imageData?.streamingVideoURL;
        const lat = Number(loc.latitude); const lng = Number(loc.longitude);
        if (c.inService !== 'true' || !img || !ok(lat, lng)) continue;
        out.push([`ct${d}-${c.index}`, `${loc.locationName ?? loc.nearbyPlace ?? 'Camera'}`.trim(), round(lat), round(lng), img,
          stream && /^https:.*\.m3u8$/.test(stream) ? stream : '', 0, [loc.route, loc.direction, loc.county].filter(Boolean).join(' · ')]);
      }
      console.log(`caltrans d${dd}: ok`);
    } catch (e) { console.warn(`caltrans d${dd}: ${e.message}`); }
  }
  return out;
}
async function nyc() {
  const j = await get('https://webcams.nyctmc.org/api/cameras');
  return j.filter((c) => c.isOnline !== false && ok(c.latitude, c.longitude)).map((c) => [`nyc-${c.id}`, c.name, round(c.latitude), round(c.longitude), c.imageUrl ?? `https://webcams.nyctmc.org/api/cameras/${c.id}/image`, '', 1, c.area ?? '']);
}
// Many 511 systems share the same "api/v2/get/cameras" format. 511 Ontario and 511 Alberta now require a free
// developer key (repository secrets ONTARIO_511_KEY / ALBERTA_511_KEY); without one the source is skipped.
async function five11(base, si, prefix, keyEnv) {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`skipped: needs a free developer key in the ${keyEnv} secret (${base}/developers/doc)`);
  const j = await get(`${base}/api/v2/get/cameras?key=${encodeURIComponent(key)}&format=json&lang=en`);
  const out = [];
  for (const c of j) {
    const lat = Number(c.Latitude); const lng = Number(c.Longitude);
    if (!ok(lat, lng)) continue;
    const views = c.Views?.length ? c.Views : [{ Url: c.Url, Status: c.Status, Description: c.Name }];
    views.filter((v) => v.Url && v.Status !== 'Disabled').forEach((v, k) => out.push([`${prefix}-${c.Id ?? c.ID}-${k}`, `${c.Location ?? c.Name ?? c.Roadway ?? 'Camera'}${v.Description && views.length > 1 ? ` (${v.Description})` : ''}`, round(lat), round(lng), v.Url, '', si, [c.Roadway, c.Direction].filter((x) => x && x !== 'Unknown').join(' · ')]));
  }
  return out;
}

// Transport for London JamCams — ~900 cameras, each with a still and a short live video clip.
async function tfl() {
  const j = await get('https://api.tfl.gov.uk/Place/Type/JamCam');
  return j.filter((c) => ok(c.lat, c.lon)).map((c) => {
    const prop = Object.fromEntries((c.additionalProperties ?? []).map((p) => [p.key, p.value]));
    if (prop.available === 'false' || !prop.imageUrl) return null;
    return [`tfl-${c.id}`, c.commonName, round(c.lat), round(c.lon), prop.imageUrl, prop.videoUrl ?? '', 4, 'London'];
  }).filter(Boolean);
}
// Hong Kong Transport Department traffic snapshots (XML list).
async function hongKong() {
  const xml = await get('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', 'text');
  const tag = (block, t) => (block.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) ?? [])[1]?.trim().replace(/&amp;/g, '&').replace(/&apos;/g, "'");
  return [...xml.matchAll(/<image>([\s\S]*?)<\/image>/g)].map(([, b]) => {
    const lat = Number(tag(b, 'latitude')); const lng = Number(tag(b, 'longitude')); const url = tag(b, 'url');
    if (!ok(lat, lng) || !url) return null;
    return [`hk-${tag(b, 'key')}`, tag(b, 'description') ?? 'Camera', round(lat), round(lng), url, '', 5, [tag(b, 'district'), tag(b, 'region')].filter(Boolean).join(' · ')];
  }).filter(Boolean);
}

// Fintraffic weather cameras, Finland (CC BY 4.0) — every station has several fixed views ("presets").
async function finland() {
  const j = await get('https://tie.digitraffic.fi/api/weathercam/v1/stations');
  const out = [];
  for (const f of j.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? []; if (!ok(lat, lng)) continue;
    for (const p of (f.properties.presets ?? []).filter((x) => x.inCollection !== false).slice(0, 2)) out.push([`fi-${p.id}`, f.properties.name ?? p.id, round(lat), round(lng), `https://weathercam.digitraffic.fi/${p.id}.jpg`, '', 6, 'Finland']);
  }
  return out;
}

// ---- v1.12: more of the world. Every source is optional and logged; a failing one keeps its previous list.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (u, base) => { try { return new URL(u, base).href.replace(/^http:/, 'https:'); } catch { return null; } };
// Web Mercator (EPSG:3857) metres → degrees, for services that only answer in map coordinates.
const fromMercator = (x, y) => [(Math.atan(Math.exp(y / 6378137)) * 2 - Math.PI / 2) * 180 / Math.PI, (x / 6378137) * 180 / Math.PI];
const xmlTag = (block, t) => (block.match(new RegExp(`<(?:\\w+:)?${t}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${t}>`, 'i')) ?? [])[1]?.trim().replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');

// Germany: Autobahn GmbH open API (one request per motorway). Only cameras with a still image are kept.
// Checked October 2026: the road list answers, but the webcam lists are empty (Autobahn GmbH has taken its
// cameras offline), so this source currently keeps 0 cameras until they return.
async function autobahn() {
  const { roads = [] } = await get('https://verkehr.autobahn.de/o/autobahn/');
  const out = []; const seen = new Set();
  for (const road of roads.filter((r) => /^A\d+$/.test(r.trim()))) {
    try {
      const j = await get(`https://verkehr.autobahn.de/o/autobahn/${encodeURIComponent(road.trim())}/services/webcam`);
      for (const w of j.webcam ?? []) {
        const lat = Number(w.coordinate?.lat); const lng = Number(w.coordinate?.long); const img = w.imageurl;
        if (!ok(lat, lng) || !img || !/^https:/.test(img) || seen.has(w.identifier)) continue;
        seen.add(w.identifier);
        out.push([`de-${String(w.identifier).slice(-24)}`, `${w.title ?? road}${w.subtitle ? ` ${w.subtitle}` : ''}`.trim(), round(lat), round(lng), img, '', 7, `${road.trim()} · ${w.operator ?? 'Germany'}`]);
      }
    } catch (e) { console.warn(`autobahn ${road}: ${e.message.slice(0, 120)}`); }
    await sleep(150);
  }
  return out;
}
// British Columbia, Canada: DriveBC highway cameras. Checked October 2026: an array of cameras with
// location.coordinates [lng, lat], is_on, should_appear and links.imageDisplay as a path on www.drivebc.ca.
async function driveBC() {
  const j = await get('https://www.drivebc.ca/api/webcams/');
  const list = Array.isArray(j) ? j : j.webcams ?? j.results ?? [];
  return list.map((c) => {
    const lat = Number(c.location?.latitude ?? c.location?.coordinates?.[1] ?? c.latitude); const lng = Number(c.location?.longitude ?? c.location?.coordinates?.[0] ?? c.longitude);
    if (!ok(lat, lng) || c.is_on === false || c.isOn === false || c.should_appear === false) return null;
    const img = abs(c.links?.imageDisplay ?? c.links?.imageSource ?? `https://images.drivebc.ca/bchighwaycam/pub/cameras/${c.id}.jpg`, 'https://www.drivebc.ca/');
    if (!img) return null;
    const hwy = c.highway?.number ?? c.highway_display ?? (typeof c.highway === 'string' ? c.highway : '');
    return [`bc-${c.id}`, c.camName ?? c.name ?? `DriveBC camera ${c.id}`, round(lat), round(lng), img, '', 8, ['British Columbia', hwy ? `Highway ${hwy}` : '', c.orientation ? `facing ${c.orientation}` : ''].filter(Boolean).join(' · ')];
  }).filter(Boolean);
}
// New Zealand: NZ Transport Agency traffic cameras (XML). Checked October 2026: each <camera> also holds nested
// <journey>, <journeyLeg>, <region> and <way> elements with their own <id> and <name>, so those are cut out
// before the camera's own fields are read; imageUrl is a path on trafficnz.info ("/camera/714.jpg").
async function newZealand() {
  const xml = await get('https://trafficnz.info/service/traffic/rest/4/cameras/all', 'text');
  return [...xml.matchAll(/<camera>([\s\S]*?)<\/camera>/gi)].map(([, b]) => {
    const region = xmlTag((b.match(/<region>([\s\S]*?)<\/region>/i) ?? [])[1] ?? '', 'name');
    const own = b.replace(/<(journey|journeyLeg|region|way)>[\s\S]*?<\/\1>/gi, '');
    const lat = Number(xmlTag(own, 'latitude')); const lng = Number(xmlTag(own, 'longitude'));
    const img = abs(xmlTag(own, 'imageUrl') ?? '', 'https://trafficnz.info/'); const off = xmlTag(own, 'offline') === 'true' || xmlTag(own, 'underMaintenance') === 'true';
    if (!ok(lat, lng) || !img || off) return null;
    return [`nz-${xmlTag(own, 'id')}`, (xmlTag(own, 'name') || xmlTag(own, 'description') || 'Camera').trim(), round(lat), round(lng), img, '', 9, ['New Zealand', region].filter(Boolean).join(' · ')];
  }).filter(Boolean);
}
// Taiwan: Freeway Bureau CCTV (MOTC v2.0 static list). Each camera is a live motion-JPEG stream, which an
// <img> element plays directly.
async function taiwan() {
  const xml = await get('https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml', 'text');
  return [...xml.matchAll(/<CCTV>([\s\S]*?)<\/CCTV>/g)].map(([, b]) => {
    const lat = Number(xmlTag(b, 'PositionLat')); const lng = Number(xmlTag(b, 'PositionLon')); const url = xmlTag(b, 'VideoStreamURL') ?? xmlTag(b, 'VideoImageURL');
    if (!ok(lat, lng) || !url || !/^https:/.test(url)) return null;
    const road = [xmlTag(b, 'RoadName'), xmlTag(b, 'LocationMile'), xmlTag(b, 'RoadDirection')].filter(Boolean).join(' ');
    return [`tw-${xmlTag(b, 'CCTVID')}`, road || `Freeway camera ${xmlTag(b, 'CCTVID')}`, round(lat), round(lng), url, '', 10, 'Taiwan freeways · live motion JPEG'];
  }).filter(Boolean);
}
// Québec, Canada: Ministère des Transports open WFS layer of road cameras (GeoJSON). Checked October 2026: the
// coordinates are Web Mercator metres (EPSG:3857), and the only address given (URL_FLUX_DONNEE) is a viewer page,
// not a picture. Each camera's still image is found once on its Québec 511 mobile page and remembered between runs.
async function quebec(prevImg) {
  const j = await get('https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outputformat=geojson');
  const rows = (j.features ?? []).map((f) => {
    let [x, y] = f.geometry?.coordinates ?? []; const p = f.properties ?? {};
    let [lat, lng] = [y, x];
    if (Math.abs(x) > 180 || Math.abs(y) > 90) [lat, lng] = fromMercator(x, y);
    const id = p.IDEcamera ?? f.id;
    if (!ok(lat, lng) || id == null) return null;
    return { id: String(id), name: p.DescriptionLocalisationEn || p.DescriptionLocalisationFr || p.NumeroCamera || 'Caméra', lat: round(lat), lng: round(lng), region: p.NomRegionDiffusion ?? '' };
  }).filter(Boolean);
  const out = []; let looked = 0;
  const one = async (c) => {
    let img = prevImg.get(`qc-${c.id}`);
    if (!img && looked < 900) {
      looked += 1;
      try {
        const html = await get(`https://www.quebec511.info/Mobile/Cameras/Detail.aspx?id=${c.id}&lang=en`, 'text');
        const m = html.match(/(?:https?:\/\/www\.quebec511\.info)?(\/Images\/Cameras\/[^"'?\s]+\/cam\/[^"'?\s]+\.jpe?g)/i);
        if (m) img = `https://www.quebec511.info${m[1]}`;
      } catch { /* this camera's page is down; try again tomorrow */ }
      await sleep(120);
    }
    if (img) out.push([`qc-${c.id}`, c.name, c.lat, c.lng, img, '', 11, ['Québec', c.region].filter(Boolean).join(' · ')]);
  };
  for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(one));
  console.log(`québec: ${rows.length} cameras listed, ${looked} image pages read, ${out.length} with a picture`);
  return out;
}
// New South Wales, Australia: Live Traffic NSW cameras (GeoJSON).
async function nsw() {
  const j = await get('https://data.livetraffic.com/cameras/traffic-cam.json');
  return (j.features ?? []).map((f) => {
    const [lng, lat] = f.geometry?.coordinates ?? []; const p = f.properties ?? {};
    if (!ok(lat, lng) || !p.href) return null;
    return [`nsw-${f.id ?? p.id ?? p.title}`, p.title ?? 'Camera', round(lat), round(lng), p.href, '', 12, ['New South Wales', p.region, p.view].filter(Boolean).join(' · ')];
  }).filter(Boolean);
}
// Iceland: Icelandic Road and Coastal Administration (Vegagerðin) road cameras. Checked October 2026: an array
// of { Maelist_nr, Myndavel (station), Vegheiti (road), Skyring (view), Slod (image), Breidd (lat), Lengd (lng) }.
async function iceland() {
  const j = await get('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1');
  const list = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [];
  const pick = (o, re) => Object.entries(o).find(([k]) => re.test(k))?.[1];
  const out = [];
  for (const c of list) {
    const lat = Number(pick(c, /^(breidd|lat|latitude)$/i)); const lng = Number(pick(c, /^(lengd|lon|lng|longitude)$/i));
    const imgs = Object.values(c).filter((v) => typeof v === 'string' && /^https?:.*\.(jpe?g|png)/i.test(v));
    if (!ok(lat, lng) || !imgs.length) continue;
    const id = pick(c, /^(maelist_nr|nr|id|numer)$/i) ?? `${round(lat)},${round(lng)}`;
    const name = pick(c, /^skyring$/i) || pick(c, /^(myndavel|nafn|name|heiti)$/i) || 'Myndavél';
    imgs.slice(0, 2).forEach((img, k) => out.push([`is-${id}-${k}`, name, round(lat), round(lng), img.replace(/^http:/, 'https:'), '', 13, ['Iceland', pick(c, /^vegheiti$/i)].filter(Boolean).join(' · ')]));
  }
  return out;
}
// Spain: DGT (Dirección General de Tráfico) camera table, DATEX II. Checked October 2026: <ns2:device id="…">
// records with loc:latitude / loc:longitude, loc:roadName, lse:kilometerPoint and fse:deviceUrl (the JPEG).
async function spain() {
  const xml = await get('https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml', 'text');
  const recs = [...xml.matchAll(/<(?:\w+:)?(?:cctvCameraMetadataRecord|device)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?(?:cctvCameraMetadataRecord|device)>/g)];
  return recs.map(([, attrs, b]) => {
    const id = (attrs.match(/id="([^"]+)"/) ?? [])[1];
    const lat = Number(xmlTag(b, 'latitude')); const lng = Number(xmlTag(b, 'longitude'));
    const img = (b.match(/https?:\/\/[^<"\s]+\.jpe?g/i) ?? [])[0] ?? (id ? `https://infocar.dgt.es/etraffic/data/camaras/${id}.jpg` : null);
    if (!ok(lat, lng) || !img) return null;
    return [`es-${id ?? `${round(lat)},${round(lng)}`}`, xmlTag(b, 'roadName') ? `${xmlTag(b, 'roadName')} km ${xmlTag(b, 'kilometerPoint') ?? ''}`.trim() : `DGT camera ${id ?? ''}`.trim(), round(lat), round(lng), img.replace(/^http:/, 'https:'), '', 14, 'Spain'];
  }).filter(Boolean);
}

const SOURCES = [
  { name: 'Caltrans (California DOT)', run: caltrans },
  { name: 'NYC DOT', run: nyc },
  { name: '511 Ontario', run: () => five11('https://511on.ca', 2, 'on', 'ONTARIO_511_KEY') },
  { name: '511 Alberta', run: () => five11('https://511.alberta.ca', 3, 'ab', 'ALBERTA_511_KEY') },
  { name: 'Transport for London (JamCams)', run: tfl },
  { name: 'Hong Kong Transport Department', run: hongKong },
  { name: 'Fintraffic weather cameras (Finland)', run: finland },
  // v1.12 (the position in this list is stored with each camera, so new sources are only ever appended)
  { name: 'Autobahn GmbH (Germany)', run: autobahn },
  { name: 'DriveBC (British Columbia)', run: driveBC },
  { name: 'NZ Transport Agency (New Zealand)', run: newZealand },
  { name: 'Freeway Bureau (Taiwan)', run: taiwan },
  { name: 'Québec 511 (Québec)', run: () => quebec(new Map((prev?.cams ?? []).filter((c) => c[6] === 11).map((c) => [c[0], c[4]]))) },
  { name: 'Live Traffic NSW (Australia)', run: nsw },
  { name: 'Vegagerðin (Iceland)', run: iceland },
  { name: 'DGT (Spain)', run: spain },
];
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
// Each source's outcome is stored with the list, so the app's Data health panel can show which ones work.
// state: 'ok' (fresh list), 'kept' (failed or empty today, previous list kept), 'empty' (nothing, ever).
const cams = []; const sources = []; const now = new Date().toISOString();
for (const [i, s] of SOURCES.entries()) {
  let rows = []; let error = '';
  try { rows = await s.run(); } catch (e) { error = e.message.slice(0, 200); console.warn(`${s.name}: ${error}`); }
  const fresh = rows.length;
  const before = prev?.sources?.[i] ?? {};
  if (!fresh && prev) { rows = prev.cams.filter((c) => c[6] === i); console.warn(`${s.name}: keeping ${rows.length} cameras from the previous run`); }
  for (const r of rows) cams.push(r);
  sources.push({ name: s.name, count: rows.length, state: fresh ? 'ok' : rows.length ? 'kept' : 'empty', error: error || (fresh ? '' : 'the service answered with no usable cameras'),
    checkedAt: now, okAt: fresh ? now : before.okAt ?? null });
  console.log(`${s.name}: ${rows.length}${fresh ? '' : ' (not refreshed)'}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const icon = { ok: '✅', kept: '⚠️', empty: '❌' };
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Traffic cameras\n\n| Source | Cameras | State | Note |\n|---|---:|---|---|\n${sources.map((s) => `| ${s.name} | ${s.count} | ${icon[s.state]} ${s.state} | ${s.error.replace(/\|/g, '/')} |`).join('\n')}\n`, { flag: 'a' });
}
if (!cams.length) { console.error('No cameras collected; leaving the existing file alone.'); process.exit(prev ? 0 : 1); }
writeFileSync(OUT, JSON.stringify({ generatedAt: now, sources, cams }));
console.log(`wrote ${cams.length} cameras to ${OUT}`);
