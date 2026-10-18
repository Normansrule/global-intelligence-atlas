// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the redaction inspector. A redaction is only real when the words are removed from
// the file. Drawing a black box over them in a PDF hides them from the eye but leaves them in the text layer,
// where anyone can copy them out; this has exposed names in court filings and government releases for decades.
// The inspector checks a PDF the user opens, entirely in the browser (Mozilla's PDF.js, loaded on first use):
//   1. it draws each page and finds solid dark boxes;
//   2. it reads the text layer and looks at the pixels under every piece of text: text sitting on a solid dark
//      (or blank white) patch is still in the file but cannot be seen;
//   3. it lists Redact annotations that were marked but never applied, the document's metadata, and how many
//      times the file was saved on top of itself (incremental updates can keep earlier, unredacted versions).
// It only reports what is literally present in the file. It never guesses, predicts or reconstructs words that
// were properly removed, and it is meant for documents that are already public.
// It can also save a "flattened" copy: every page as a picture and nothing else, which is how to redact safely.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_PAGES = 80; const SCALE = 1.5; const DARK = 70; const LIGHT = 236;
let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

/** Count "%%EOF" markers: one per save. More than one means incremental updates, which can keep older versions. */
function countRevisions(bytes) {
  let n = 0; const m = [37, 37, 69, 79, 70];
  outer: for (let i = 0; i <= bytes.length - 5; i++) { for (let k = 0; k < 5; k++) if (bytes[i + k] !== m[k]) continue outer; n++; }
  return n;
}

/** Statistics of the pixels in a rectangle of the page image (inset a little so neighbouring text does not leak in). */
function patch(img, W, H, x, y, w, h) {
  const ix = Math.max(0, Math.floor(x + w * 0.06)); const iy = Math.max(0, Math.floor(y + h * 0.18));
  const ex = Math.min(W, Math.ceil(x + w * 0.94)); const ey = Math.min(H, Math.ceil(y + h * 0.82));
  let n = 0; let dark = 0; let light = 0; let s = 0; let s2 = 0;
  const step = Math.max(1, Math.floor(Math.min(ex - ix, ey - iy) / 12));
  for (let py = iy; py < ey; py += step) for (let px = ix; px < ex; px += step) {
    const o = (py * W + px) * 4; const l = 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2];
    n++; s += l; s2 += l * l; if (l < DARK) dark++; else if (l > LIGHT) light++;
  }
  if (!n) return null;
  const mean = s / n; return { dark: dark / n, light: light / n, mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

/** Solid dark rectangles on a page image: cells of 4 px, joined into boxes, kept when they are nearly full and big enough. */
function darkBoxes(img, W, H) {
  const C = 4; const cw = Math.floor(W / C); const ch = Math.floor(H / C); const cell = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let d = 0; for (let yy = 0; yy < C; yy += 2) for (let xx = 0; xx < C; xx += 2) { const o = ((cy * C + yy) * W + cx * C + xx) * 4; if (0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2] < DARK) d++; }
    cell[cy * cw + cx] = d >= 4 ? 1 : 0;
  }
  const seen = new Uint8Array(cw * ch); const boxes = [];
  for (let i = 0; i < cell.length; i++) {
    if (!cell[i] || seen[i]) continue;
    let x0 = cw; let y0 = ch; let x1 = 0; let y1 = 0; let n = 0; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); const cx = j % cw; const cy = (j / cw) | 0; n++;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const k of [j - 1, j + 1, j - cw, j + cw]) if (k >= 0 && k < cell.length && !seen[k] && cell[k] && Math.abs((k % cw) - cx) <= 1) { seen[k] = 1; stack.push(k); }
      if (n > 200000) break;
    }
    const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
    // a redaction bar: at least about 3 × 2 mm on the page, filled solidly, and not the whole page (a dark scan or photo)
    if (bw >= 6 && bh >= 3 && n / (bw * bh) > 0.88 && bw * bh < cw * ch * 0.5) boxes.push({ x: x0 * C, y: y0 * C, w: bw * C, h: bh * C, hidden: [] });
  }
  return boxes;
}

/** Inspect a PDF. Returns pages with boxes, hidden text, unapplied redactions and an image for the preview. */
export async function inspectPdf(buffer, onProgress = () => {}) {
  const L = await lib();
  const bytes = new Uint8Array(buffer);
  const revisions = countRevisions(bytes);
  const doc = await L.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const pages = []; const n = Math.min(doc.numPages, MAX_PAGES);
  for (let p = 1; p <= n; p++) {
    onProgress(p, n);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp, annotationMode: L.AnnotationMode.ENABLE }).promise;
    const img = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const boxes = darkBoxes(img, canvas.width, canvas.height);
    const tc = await page.getTextContent();
    const hidden = []; const invisible = []; let chars = 0;
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      chars += it.str.length;
      const t = L.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(t[2], t[3]); const w = it.width * SCALE; const x = t[4]; const y = t[5] - fh;
      if (fh < 2 || w < 2) continue;
      const s = patch(img, canvas.width, canvas.height, x, y, w, fh); if (!s) continue;
      const rect = { x, y, w, h: fh, text: it.str };
      if (s.dark > 0.92 && s.sd < 22) {
        hidden.push(rect);
        const b = boxes.find((bx) => x + w / 2 > bx.x && x + w / 2 < bx.x + bx.w && y + fh / 2 > bx.y && y + fh / 2 < bx.y + bx.h);
        if (b) b.hidden.push(it.str);
      } else if (s.light > 0.985 && s.sd < 4) invisible.push(rect);
    }
    const annots = (await page.getAnnotations().catch(() => [])).filter((a) => a.subtype === 'Redact');
    // a page that is a picture with no text layer: boxes in it are part of the image, so nothing hides underneath
    // keep a JPEG (for the picture-only copy) and a small preview, not the full-size canvas: 80 of those would use gigabytes
    const jpg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    const k = Math.min(1, 640 / canvas.width); const preview = document.createElement('canvas');
    preview.width = Math.round(canvas.width * k); preview.height = Math.round(canvas.height * k);
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    const W = canvas.width; const H = canvas.height; canvas.width = 0; canvas.height = 0;
    pages.push({ n: p, w: W, h: H, k, boxes, hidden, invisible, annots, chars, jpg, preview });
    page.cleanup();
  }
  const info = meta?.info ?? {};
  return { pages, numPages: doc.numPages, checked: n, revisions, info, xmp: meta?.metadata?.getAll?.() ?? null, doc };
}

/** Join neighbouring hidden pieces of text on a line, so a covered name reads as one finding. */
function lines(rects) {
  const out = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = out.at(-1);
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x - (last.x + last.w) < r.h * 1.5) { last.text += (r.x - (last.x + last.w) > r.h * 0.15 ? ' ' : '') + r.text; last.w = r.x + r.w - last.x; }
    else out.push({ ...r });
  }
  return out;
}

/** A PDF made only of page pictures (JPEG): no text layer, no metadata, no history. */
export async function flattenedPdf(pages) {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (i, body) => { offs[i] = len; put(`${i} 0 obj\n`); for (const b of [].concat(body)) put(b); put('\nendobj\n'); };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, k) => `${3 + k * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (let k = 0; k < pages.length; k++) {
    const c = pages[k]; const pw = (c.w / SCALE).toFixed(2); const ph = (c.h / SCALE).toFixed(2);
    const jpg = new Uint8Array(await c.jpg.arrayBuffer());
    const id = 3 + k * 3; const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    obj(id + 1, [`<< /Type /XObject /Subtype /Image /Width ${Math.round(c.w)} /Height ${Math.round(c.h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
    obj(id + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  const total = 3 + pages.length * 3; const xref = len;
  put(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) put(`${String(offs[i]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------------------------------------------------------------- the panel
let last = null;
const intro = `<p>Open a PDF to check whether its black boxes really remove the words underneath. Many “redacted” documents only have boxes drawn on top, and the text is still in the file.</p>
  <label class="intel-drop" id="redact-drop"><input type="file" id="redact-file" accept="application/pdf,.pdf" hidden /><b>Choose a PDF</b><span>or drop it here. It is read on this computer and never uploaded.</span></label>
  <div class="row"><button class="btn ghost" data-redact-sample="1">Try the training sample</button></div>
  <div id="redact-out"></div>
  <h4>How it works</h4>
  <p class="muted">The inspector draws every page, finds solid dark boxes, then looks under each piece of text in the file. Text that sits on a solid box (or on blank paper, invisible) is reported, with the box outlined in red. It also lists redactions that were marked but never applied, the metadata, and whether the file was saved on top of an earlier version. It shows only what is still in the file; it never guesses at words that were properly removed. Use it on documents that are already public.</p>`;

export function openInspector(x) {
  x.openNotes('Redaction inspector', intro, 'tool:redact');
  if (last) show(x, last.result, last.name);
}

export async function inspectUrl(x, url, name) {
  openInspector(x);
  const out = document.querySelector('#redact-out'); if (out) out.innerHTML = '<p class="muted">Downloading…</p>';
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await run(x, await r.arrayBuffer(), name);
  } catch (e) {
    if (out) out.innerHTML = `<p class="err">Could not download it in the browser (${esc(e.message)}). <a href="${esc(url)}" target="_blank" rel="noopener">Download the PDF</a>, then choose it above.</p>`;
  }
}

async function run(x, buf, name) {
  const out = document.querySelector('#redact-out'); if (!out) return;
  out.innerHTML = '<p class="muted">Loading the PDF reader…</p>';
  try {
    const result = await inspectPdf(buf, (p, n) => { out.innerHTML = `<p class="muted">Checking page ${p} of ${n}…</p>`; });
    last = { result, name }; show(x, result, name);
  } catch (e) {
    out.innerHTML = `<p class="err">${e?.name === 'PasswordException' ? 'This PDF is password-protected.' : `Could not read this file as a PDF (${esc(e.message)}).`}</p>`;
  }
}

function show(x, r, name) {
  const out = document.querySelector('#redact-out'); if (!out) return;
  const boxes = r.pages.reduce((s, p) => s + p.boxes.length, 0);
  const leaks = r.pages.flatMap((p) => lines(p.hidden).map((l) => ({ p: p.n, ...l })));
  const ghosts = r.pages.flatMap((p) => lines(p.invisible).map((l) => ({ p: p.n, ...l })));
  const annots = r.pages.flatMap((p) => p.annots.map((a) => ({ p: p.n, a })));
  const textless = r.pages.filter((p) => p.chars === 0).length;
  const verdict = leaks.length ? ['bad', `Not safely redacted: ${leaks.length} piece${leaks.length === 1 ? ' of text sits' : 's of text sit'} under black boxes and can still be copied out.`]
    : annots.length ? ['bad', `${annots.length} redaction${annots.length === 1 ? ' was' : 's were'} marked but never applied.`]
    : boxes ? ['good', `${boxes} black box${boxes === 1 ? '' : 'es'} found, with no text left underneath.`]
    : ['none', 'No black boxes found on the pages checked.'];
  const info = Object.entries({ Title: r.info.Title, Author: r.info.Author, 'Made with': r.info.Creator, 'Converted by': r.info.Producer, Created: r.info.CreationDate, Changed: r.info.ModDate }).filter(([, v]) => v);
  const pageImgs = r.pages.filter((p) => p.boxes.length || p.hidden.length || p.annots.length).slice(0, 12);
  out.innerHTML = `
    <h4>${esc(name ?? 'Your PDF')}</h4>
    <p class="intel-verdict ${verdict[0]}">${esc(verdict[1])}</p>
    <dl><dt>Pages checked</dt><dd>${r.checked} of ${r.numPages}${r.checked < r.numPages ? ' (the first ' + r.checked + ')' : ''}</dd>
      <dt>Black boxes</dt><dd>${boxes}</dd><dt>Pages with no text layer</dt><dd>${textless}${textless ? ' (scans: boxes in a picture hide nothing underneath)' : ''}</dd>
      <dt>Saves in the file</dt><dd>${r.revisions}${r.revisions > 1 ? ' (earlier versions may still be inside)' : ''}</dd></dl>
    ${leaks.length ? `<h4>Text still under black boxes</h4><p class="muted">This is the text stored in the file at those places, exactly as it is; nothing is guessed.</p><ul class="intel-leaks">${leaks.slice(0, 200).map((l) => `<li><small>Page ${l.p}</small><mark>${esc(l.text)}</mark></li>`).join('')}</ul>` : ''}
    ${annots.length ? `<h4>Redactions marked but not applied</h4><ul class="intel-leaks">${annots.map(({ p, a }) => `<li><small>Page ${p}</small>${esc(a.contentsObj?.str || a.overlayText || 'Redact annotation')}</li>`).join('')}</ul><p class="muted">Editors mark these areas first and remove the text only when the redaction is “applied”. Until then the text is untouched.</p>` : ''}
    ${ghosts.length ? `<h4>Invisible text</h4><p class="muted">${ghosts.length} piece${ghosts.length === 1 ? '' : 's'} of text on blank paper. This is often harmless (the hidden text layer added to scans by character recognition) but can also be white-on-white text.</p>` : ''}
    ${pageImgs.length ? `<h4>Pages</h4><div class="intel-pages" id="redact-pages"></div><p class="muted">Red outline: text under a box. Green outline: a box with nothing underneath.</p>` : ''}
    ${info.length ? `<h4>Metadata</h4><dl>${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v).replace(/^D:(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3'))}</dd>`).join('')}</dl><p class="muted">Metadata can name the author, the organisation or the software, even when the pages do not.</p>` : ''}
    <h4>Redact safely</h4>
    <p class="muted">Use a tool that removes the text (often called “apply redactions”), or save the pages as pictures. The button below makes a picture-only copy of the pages checked: no text layer, no metadata, no earlier versions.</p>
    <div class="row"><button class="btn ghost" data-redact-flatten="1">Save a picture-only copy</button></div>`;
  const host = out.querySelector('#redact-pages');
  for (const p of pageImgs) {
    const c = document.createElement('canvas'); const { k } = p; c.width = p.preview.width; c.height = p.preview.height;
    const g = c.getContext('2d'); g.drawImage(p.preview, 0, 0); g.lineWidth = 2;
    for (const b of p.boxes) { g.strokeStyle = b.hidden.length ? '#ff3b30' : '#3ddc84'; g.strokeRect(b.x * k - 2, b.y * k - 2, b.w * k + 4, b.h * k + 4); }
    for (const h of p.hidden) if (!p.boxes.some((b) => b.hidden.includes(h.text))) { g.strokeStyle = '#ff3b30'; g.strokeRect(h.x * k - 2, h.y * k - 2, h.w * k + 4, h.h * k + 4); }
    const fig = document.createElement('figure'); fig.append(c); const cap = document.createElement('figcaption'); cap.textContent = `Page ${p.n}`; fig.append(cap); host?.append(fig);
  }
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'redact-file' || !e.target.files?.[0]) return;
  const f = e.target.files[0]; f.arrayBuffer().then((b) => run(null, b, f.name));
});
document.addEventListener('dragover', (e) => { if (e.target.closest?.('#redact-drop')) { e.preventDefault(); e.target.closest('#redact-drop').classList.add('over'); } });
document.addEventListener('dragleave', (e) => { e.target.closest?.('#redact-drop')?.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  const z = e.target.closest?.('#redact-drop'); if (!z) return; e.preventDefault(); z.classList.remove('over');
  const f = e.dataTransfer.files?.[0]; if (f) f.arrayBuffer().then((b) => run(null, b, f.name));
});
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-redact-sample]')) {
    const out = document.querySelector('#redact-out'); if (out) out.innerHTML = '<p class="muted">Loading the sample…</p>';
    try { const r = await fetch('data/redaction-sample.pdf'); await run(null, await r.arrayBuffer(), 'Training sample (fictional memo)'); } catch (err) { if (out) out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  }
  if (e.target.closest('[data-redact-flatten]') && last) {
    const b = e.target.closest('[data-redact-flatten]'); b.disabled = true; b.textContent = 'Making the copy…';
    const blob = await flattenedPdf(last.result.pages);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(last.name ?? 'document').replace(/\.pdf$/i, '')}-flattened.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000); b.disabled = false; b.textContent = 'Save a picture-only copy';
  }
});
