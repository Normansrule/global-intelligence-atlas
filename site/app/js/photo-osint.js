// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: three classic open-source intelligence (OSINT) techniques, shown on the globe.
//   Photo location:  read the Exchangeable Image File Format (EXIF) block of a JPEG photo: camera, time and,
//                    when the phone recorded it, the Global Positioning System (GPS) position. Read in the browser.
//   Shadow clock:    an object of height h casting a shadow of length L means the Sun stood atan(h / L) above
//                    the horizon. With the place known, that gives the times of day; with the time known, it gives
//                    a circle on Earth (every place where the Sun stood at that height), drawn on the globe.
//   Web archive:     the Internet Archive's Wayback Machine keeps old copies of web pages.
import { subsolarPoint, solarElevation, bearingDeg, smallCircle, localSolarTime, fmtLat, fmtLng } from './astro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R2D = 180 / Math.PI;
const sunAzimuth = (lat, lng, date) => { const s = subsolarPoint(date); return bearingDeg(lat, lng, s.lat, s.lng); };
const hhmm = (d) => d.toISOString().slice(11, 16);
const solarHHMM = (lng, d) => localSolarTime(lng, d);

// ---------------------------------------------------------------- EXIF
const TAGS = { 0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright', 0x9003: 'DateTimeOriginal', 0x9011: 'OffsetTimeOriginal', 0xa434: 'LensModel', 0xa420: 'ImageUniqueID', 0x8769: 'ExifIFD', 0x8825: 'GPSIFD' };
const GPS = { 1: 'LatRef', 2: 'Lat', 3: 'LngRef', 4: 'Lng', 5: 'AltRef', 6: 'Alt', 7: 'TimeStamp', 0x10: 'DirRef', 0x11: 'Dir', 0x1d: 'DateStamp' };
/** Parse the EXIF block of a JPEG. Returns null when there is none. */
export function readExif(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 < v.byteLength) {
    const marker = v.getUint16(o); const size = v.getUint16(o + 2);
    if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10); // "Exif"
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    o += 2 + size;
  }
  return null;
}
function tiff(v, t) {
  const le = v.getUint16(t) === 0x4949; const u16 = (p) => v.getUint16(p, le); const u32 = (p) => v.getUint32(p, le); const i32 = (p) => v.getInt32(p, le);
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const value = (e) => {
    const type = u16(e + 2); const n = u32(e + 4); const bytes = (SIZE[type] ?? 1) * n;
    const p = bytes <= 4 ? e + 8 : t + u32(e + 8); if (p + bytes > v.byteLength) return null;
    if (type === 2) { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); }
    const one = (q) => (type === 3 ? u16(q) : type === 4 ? u32(q) : type === 9 ? i32(q) : type === 5 ? u32(q) / (u32(q + 4) || 1) : type === 10 ? i32(q) / (i32(q + 4) || 1) : v.getUint8(q));
    const out = []; for (let i = 0; i < Math.min(n, 8); i++) out.push(one(p + i * (SIZE[type] ?? 1)));
    return n === 1 ? out[0] : out;
  };
  const ifd = (p, names, into) => {
    if (p < t || p + 2 > v.byteLength) return;
    const n = u16(p);
    for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; if (e + 12 > v.byteLength) break; const name = names[u16(e)]; if (name) into[name] = value(e); }
  };
  const tags = {}; ifd(t + u32(t + 4), TAGS, tags);
  if (tags.ExifIFD) ifd(t + tags.ExifIFD, TAGS, tags);
  const gps = {}; if (tags.GPSIFD) ifd(t + tags.GPSIFD, GPS, gps);
  delete tags.ExifIFD; delete tags.GPSIFD;
  const dms = (a) => (Array.isArray(a) ? a[0] + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600 : null);
  let lat = dms(gps.Lat); let lng = dms(gps.Lng);
  if (lat != null && gps.LatRef === 'S') lat = -lat; if (lng != null && gps.LngRef === 'W') lng = -lng;
  if (lat === 0 && lng === 0) { lat = null; lng = null; } // an empty GPS block
  const alt = typeof gps.Alt === 'number' ? (gps.AltRef === 1 ? -gps.Alt : gps.Alt) : null;
  let gpsTime = null;
  if (gps.DateStamp && Array.isArray(gps.TimeStamp)) { const [h, m, s] = gps.TimeStamp; gpsTime = new Date(`${gps.DateStamp.replace(/:/g, '-')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}Z`); if (Number.isNaN(gpsTime.getTime())) gpsTime = null; }
  return { tags, lat, lng, alt, dir: typeof gps.Dir === 'number' ? gps.Dir : null, gpsTime };
}

export function openPhotoTool(x) {
  x.openNotes('Photo location', `<p>Many cameras and phones store where and when a photo was taken inside the file. Open a JPEG photo to read it. The photo stays on this computer.</p>
    <label class="intel-drop" id="exif-drop"><input type="file" id="exif-file" accept="image/jpeg,.jpg,.jpeg" hidden /><b>Choose a photo</b><span>or drop it here (JPEG).</span></label>
    <div id="exif-out"></div>
    <h4>Keep in mind</h4>
    <p class="muted">Most social networks and messaging apps remove this data when a photo is uploaded, so its absence proves nothing. The camera clock may be wrong or in another time zone. Check against the scene itself: signs, shadows, weather, landmarks.</p>
    <p class="muted">Before you share your own photos, you can remove their location in your phone’s share settings.</p>`, 'tool:photo');
  openPhotoTool.x = x;
}
async function photoFile(f) {
  const x = openPhotoTool.x; const out = document.querySelector('#exif-out'); if (!out) return;
  const e = readExif(await f.arrayBuffer());
  if (!e) { out.innerHTML = `<p class="intel-verdict none">${esc(f.name)}: no metadata found. It was probably removed when the photo was shared.</p>`; return; }
  const when = e.tags.DateTimeOriginal ?? e.tags.DateTime;
  const rows = [['Camera', [e.tags.Make, e.tags.Model].filter(Boolean).join(' ')], ['Lens', e.tags.LensModel], ['Taken (camera clock)', when && `${when}${e.tags.OffsetTimeOriginal ? ` (UTC${e.tags.OffsetTimeOriginal})` : ''}`],
    ['GPS time (UTC)', e.gpsTime?.toISOString().replace('T', ' ').slice(0, 19)], ['Software', e.tags.Software], ['Artist', e.tags.Artist], ['Copyright', e.tags.Copyright],
    ['Position', e.lat != null ? `${fmtLat(e.lat)}, ${fmtLng(e.lng)}` : 'not recorded'], ['Height', e.alt != null ? `${Math.round(e.alt)} m` : null], ['Facing', e.dir != null ? `${Math.round(e.dir)}°` : null]].filter(([, v]) => v);
  let sun = '';
  const t = e.gpsTime ?? (when && e.tags.OffsetTimeOriginal ? new Date(`${when.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T')}${e.tags.OffsetTimeOriginal}`) : null);
  if (e.lat != null && t && !Number.isNaN(t.getTime())) {
    const el = solarElevation(e.lat, e.lng, t); const az = sunAzimuth(e.lat, e.lng, t);
    sun = `<p>At that place and time the Sun stood <b>${el.toFixed(1)}°</b> ${el > 0 ? 'above' : 'below'} the horizon, bearing ${Math.round(az)}°.${el > 0 ? ` A 1 m post would cast a ${(1 / Math.tan(el / R2D)).toFixed(2)} m shadow pointing ${Math.round((az + 180) % 360)}°. Compare that with the shadows in the picture.` : ' It was dark, so a daylight photo would not match.'}</p>`;
  }
  out.innerHTML = `<h4>${esc(f.name)}</h4><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${sun}
    ${e.lat != null ? `<div class="row"><button class="btn" data-fly="${e.lat},${e.lng},0.02">Go there</button><button class="btn ghost" data-fly="${e.lat},${e.lng},0.0015">Street level</button></div>` : ''}`;
  if (e.lat != null) { x.fly(e.lat, e.lng, 0.05); }
}

// ---------------------------------------------------------------- shadow clock
export function openShadowTool(x) {
  const now = x.now(); const p = x.state.pov;
  x.openNotes('Shadow clock', `<p>Measure an upright object and its shadow in a photo (in any unit, as long as both use the same one). The Sun’s height follows: tan(height) = object ÷ shadow.</p>
    <form id="shadow-form" class="intel-form">
      <label>Object height <input name="h" type="number" step="any" min="0" value="1.8" required></label>
      <label>Shadow length <input name="l" type="number" step="any" min="0" value="2.4" required></label>
      <label>Shadow points towards (degrees from north, optional) <input name="dir" type="number" step="any" min="0" max="360" placeholder="e.g. 315"></label>
      <h4>When was it taken?</h4>
      <p class="muted">Uses the place at the centre of the view (${fmtLat(p.lat)}, ${fmtLng(p.lng)}). Fly somewhere first to change it.</p>
      <label>Date <input name="date" type="date" value="${now.toISOString().slice(0, 10)}"></label>
      <button class="btn" name="mode" value="when">Find the times</button>
      <h4>Where could it be?</h4>
      <p class="muted">For a known moment, draws every place on Earth where the Sun stood at that height.</p>
      <label>Moment (UTC) <input name="utc" type="datetime-local" value="${now.toISOString().slice(0, 16)}"></label>
      <button class="btn" name="mode" value="where">Draw on the globe</button>
    </form><div id="shadow-out"></div>
    <p class="muted">Accuracy: a 5 % error in the lengths moves the answer by roughly 10–20 minutes, or a few hundred kilometres. Ground slope and lens distortion matter too, so treat the result as a range.</p>`, 'tool:shadow');
  openShadowTool.x = x;
}
function shadowRun(form, mode) {
  const x = openShadowTool.x; const out = document.querySelector('#shadow-out'); const f = new FormData(form);
  const h = Number(f.get('h')); const l = Number(f.get('l')); const dir = f.get('dir') === '' ? null : Number(f.get('dir'));
  if (!(h > 0) || !(l > 0)) { out.innerHTML = '<p class="err">Enter both lengths.</p>'; return; }
  const el = Math.atan(h / l) * R2D; const sunAz = dir == null ? null : (dir + 180) % 360;
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  if (mode === 'when') {
    const { lat, lng } = x.state.pov; const day = new Date(`${f.get('date')}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) return;
    // scan a 36-hour window around the UTC date so the whole local day is covered, one minute at a time
    const hits = []; let prev = null;
    for (let m = -6 * 60; m <= 30 * 60; m++) {
      const t = new Date(day.getTime() + m * 60_000); const e = solarElevation(lat, lng, t) - el;
      if (prev != null && Math.sign(e) !== Math.sign(prev.e)) {
        const az = sunAzimuth(lat, lng, t);
        if (sunAz == null || angDiff(az, sunAz) < 12) hits.push({ t, az, rising: e > prev.e });
      }
      prev = { e };
    }
    const max = Math.max(...Array.from({ length: 289 }, (_, i) => solarElevation(lat, lng, new Date(day.getTime() + i * 300_000))));
    out.innerHTML = `<p>The Sun stood <b>${el.toFixed(1)}°</b> high.</p>` + (hits.length
      ? `<ul class="intel-links">${hits.map((hh) => `<li><b>${hhmm(hh.t)} UTC</b> (${solarHHMM(lng, hh.t)} local solar time, ${hh.t.toISOString().slice(0, 10)}): Sun ${hh.rising ? 'rising' : 'setting'}, bearing ${Math.round(hh.az)}°, shadow towards ${Math.round((hh.az + 180) % 360)}°</li>`).join('')}</ul>${sunAz == null ? '<p class="muted">Add the shadow’s direction to choose between the morning and afternoon times.</p>' : ''}`
      : `<p class="intel-verdict none">The Sun never stands at that height here on that date${max < el ? ` (its highest is ${max.toFixed(1)}°)` : ' in that direction'}. Try another date or place.</p>`);
  } else {
    const t = new Date(`${f.get('utc')}:00Z`); if (Number.isNaN(t.getTime())) return;
    const s = subsolarPoint(t); const ring = smallCircle(s.lat, s.lng, 90 - el, 360);
    const best = sunAz == null ? [] : ring.filter(([a, b]) => angDiff(sunAzimuth(a, b, t), sunAz) < 1.5);
    x.clearTool();
    x.state.tool.paths = [{ pts: ring.map(([a, b]) => [a, b, 0.004]), color: '#ffd37a', stroke: 1.1, passive: true }];
    x.state.tool.html = [];
    if (best.length) x.setPins(best.slice(0, 4).map(([a, b]) => ({ lat: a, lng: b, cls: '' }))); else x.compose();
    x.fly(best[0]?.[0] ?? s.lat, best[0]?.[1] ?? s.lng, best.length ? 1.2 : 2.4, false);
    out.innerHTML = `<p>The yellow circle is everywhere the Sun stood <b>${el.toFixed(1)}°</b> high at ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC. The Sun was overhead at ${fmtLat(s.lat)}, ${fmtLng(s.lng)}; the circle is ${Math.round(90 - el)}° (about ${Math.round((90 - el) * 111).toLocaleString()} km) from there.</p>${sunAz != null ? (best.length ? `<p>The shadow’s direction narrows it to the pinned spot${best.length > 1 ? 's' : ''} on the circle.</p>` : '<p class="muted">No point on the circle matches that shadow direction.</p>') : '<p class="muted">Add the shadow’s direction to narrow the circle to one place.</p>'}<div class="row"><button class="btn ghost" data-tool-clear="1">Clear the circle</button></div>`;
  }
}

// ---------------------------------------------------------------- web archive
export function openWaybackTool(x) {
  x.openNotes('Web archive lookup', `<p>The Internet Archive’s Wayback Machine has saved copies of web pages since 1996. Enter an address to find its first, latest and nearest saved copies.</p>
    <form id="wb-form" class="intel-form"><label>Web address <input name="url" type="text" placeholder="example.com/page" required></label>
    <label>Nearest to date (optional) <input name="date" type="date"></label><button class="btn">Look up</button></form><div id="wb-out"></div>
    <p class="muted">A page that was changed or deleted may still be readable here. Pages can also be removed from the archive at their owner’s request.</p>`, 'tool:wayback');
}
async function waybackRun(form) {
  const out = document.querySelector('#wb-out'); const f = new FormData(form);
  const url = String(f.get('url')).trim().replace(/^https?:\/\//, ''); if (!url) return;
  const ts = f.get('date') ? String(f.get('date')).replace(/-/g, '') : '';
  out.innerHTML = '<p class="muted">Asking the Wayback Machine…</p>';
  const cal = `https://web.archive.org/web/*/${encodeURIComponent(url)}`;
  const fmt = (t) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`;
  try {
    const cdx = async (extra) => { const r = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,statuscode&filter=statuscode:200${extra}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()).slice(1); };
    const [first, latest] = await Promise.all([cdx('&limit=1'), cdx('&limit=-1')]);
    let near = null;
    if (ts) { const a = await (await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${ts}`)).json(); near = a.archived_snapshots?.closest; }
    const link = (t, label) => `<li>${label}: <a href="https://web.archive.org/web/${t}/${esc(url)}" target="_blank" rel="noopener">${fmt(t)} UTC</a></li>`;
    out.innerHTML = first.length ? `<ul class="intel-links">${link(first[0][0], 'First copy')}${latest.length ? link(latest[0][0], 'Latest copy') : ''}${near ? `<li>Nearest to your date: <a href="${esc(near.url)}" target="_blank" rel="noopener">${fmt(near.timestamp)} UTC</a></li>` : ''}</ul><div class="row"><a class="btn ghost" href="${cal}" target="_blank" rel="noopener">Every copy</a><a class="btn ghost" href="https://web.archive.org/save/${esc(url)}" target="_blank" rel="noopener">Save it now</a></div>`
      : `<p class="intel-verdict none">No saved copies of that address.</p><div class="row"><a class="btn ghost" href="https://web.archive.org/save/${esc(url)}" target="_blank" rel="noopener">Save it now</a></div>`;
  } catch (e) { out.innerHTML = `<p class="err">The Wayback Machine did not answer (${esc(e.message)}). <a href="${cal}" target="_blank" rel="noopener">Open it directly</a>.</p>`; }
}

// ---------------------------------------------------------------- events (the panels are re-rendered, so listen at the document)
document.addEventListener('change', (e) => { if (e.target.id === 'exif-file' && e.target.files?.[0]) photoFile(e.target.files[0]); });
document.addEventListener('dragover', (e) => { if (e.target.closest?.('#exif-drop')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (!e.target.closest?.('#exif-drop')) return; e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) photoFile(f); });
document.addEventListener('submit', (e) => {
  if (e.target.id === 'shadow-form') { e.preventDefault(); shadowRun(e.target, e.submitter?.value ?? 'when'); }
  if (e.target.id === 'wb-form') { e.preventDefault(); waybackRun(e.target); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-tool-clear]')) openShadowTool.x?.clearTool(); });
