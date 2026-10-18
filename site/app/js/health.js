// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Data health panel. One place that shows whether every source is working:
//  • the live-data job on GitHub Actions (its status.json: each feed's last refresh, count and error),
//  • the weekly aircraft type table and the daily traffic-camera collector (each camera source's count),
//  • every feed this browser has asked for in this session (which route answered: desktop, direct, proxy or
//    snapshot), and every layer that is on.
// A weekly workflow (tools/probe-sources.mjs) probes the same services and opens a GitHub issue when one breaks.
import { status as feedStatus, onStatus, getSnapshot, getLocal, isDesktop, liveProxy } from './feeds.js';
import { SOURCES } from './sources.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  if (!t) return 'never';
  const m = (Date.now() - new Date(t).getTime()) / 60_000;
  return m < 1 ? 'just now' : m < 90 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const LIVE_FEEDS = { flights: 'Flights (OpenSky Network or ADS-B exchanges)', gdacs: 'Disaster alerts (GDACS)', launches: 'Rocket launches (The Space Devs)', tle: 'Satellite orbits (CelesTrak)', news: 'Places in the news (GDELT)', fires: 'Fire hotspots (NASA FIRMS)', ships: 'Ships worldwide (AISStream)' };
// How old each live-data feed may be before it counts as stale (minutes). Slow feeds are refreshed less often.
const MAX_AGE = { flights: 15, gdacs: 30, launches: 180, tle: 360, news: 90, fires: 120, ships: 20 };
const VIA = { desktop: 'desktop app', direct: 'direct', proxy: 'your proxy', snapshot: 'live-data snapshot' };

export function installHealth(api) {
  let open = false; let timer = null; let last = { snap: null, adb: null, cams: null, err: {} };

  function row(state, name, detail, when = '') {
    const icon = { ok: '●', warn: '▲', bad: '■', idle: '○' }[state];
    return `<li class="hrow" data-h="${state}"><i aria-hidden="true">${icon}</i><span><b>${esc(name)}</b><small>${detail}</small></span><em>${esc(when)}</em></li>`;
  }
  const list = (rows) => `<ul class="health">${rows.join('')}</ul>`;

  async function fetchAll() {
    const job = (p) => p.then((v) => [v, null]).catch((e) => [null, e.message]);
    const [[snap, se], [adb, ae], [cams, ce]] = await Promise.all([
      job(getSnapshot('livedata', 'status.json', { ttl: 60_000 })),
      job(getSnapshot('aircraftdb', 'meta.json', { branch: 'aircraft-db', ttl: 10 * 60_000 })),
      job(getLocal('data/cameras.json')),
    ]);
    last = { snap, adb, cams, err: { snap: se, adb: ae, cams: ce } };
  }

  function render() {
    const { snap, adb, cams, err } = last; const sections = []; const tally = { ok: 0, warn: 0, bad: 0 };
    const add = (rows) => { for (const r of rows) { const s = r.match(/data-h="(\w+)"/)?.[1]; if (tally[s] != null) tally[s] += 1; } return rows; };

    // 1. live-data job
    const live = [];
    if (snap) {
      const age = (Date.now() - Date.parse(snap.generatedAt)) / 60_000;
      live.push(row(age < 12 ? 'ok' : age < 40 ? 'warn' : 'bad', 'Live-data job (GitHub Actions)', age < 40 ? 'publishing every 4 minutes' : 'has stopped publishing: check the “Live data snapshot” workflow', ago(snap.generatedAt)));
      for (const [k, f] of Object.entries(snap.feeds ?? {})) {
        const fage = f.at ? (Date.now() - Date.parse(f.at)) / 60_000 : null;
        const state = !f.ok ? 'bad' : /^skipped/.test(f.note ?? '') || (fage != null && fage > (MAX_AGE[k] ?? 60)) ? 'warn' : 'ok';
        live.push(row(state, LIVE_FEEDS[k] ?? k, `${esc(f.note ?? '')}${!f.ok && f.at ? ` · last good ${ago(f.at)}` : ''}`, f.at ? ago(f.at) : f.failedAt ? `failed ${ago(f.failedAt)}` : ''));
      }
    } else live.push(row('bad', 'Live-data job (GitHub Actions)', esc(err.snap ?? 'not reachable')));
    sections.push(['Live-data snapshot', 'Feeds that browsers cannot read directly, fetched on GitHub Actions and served from the live-data branch.', add(live)]);

    // 2. scheduled data jobs
    const jobs = [];
    if (adb) jobs.push(row((Date.now() - Date.parse(adb.generatedAt)) / 86_400_000 < 9 ? 'ok' : 'warn', 'Aircraft type table (weekly)', `${Number(adb.count).toLocaleString()} aircraft with a known type, from the OpenSky Network aircraft database`, ago(adb.generatedAt)));
    else jobs.push(row('warn', 'Aircraft type table (weekly)', `${esc(err.adb ?? 'not built yet')}. Run the “Aircraft types” workflow once.`));
    if (cams) {
      const cage = (Date.now() - Date.parse(cams.generatedAt)) / 86_400_000;
      jobs.push(row(cage < 3 ? 'ok' : 'warn', 'Traffic camera collector (daily)', `${cams.cams.length.toLocaleString()} cameras from ${cams.sources.filter((s) => s.count).length} of ${cams.sources.length} sources`, ago(cams.generatedAt)));
      for (const s of cams.sources) {
        const st = s.state === 'ok' || (!s.state && s.count) ? 'ok' : s.count ? 'warn' : 'bad';
        jobs.push(row(st, s.name, `${s.count.toLocaleString()} cameras${s.state === 'kept' ? ' · kept from an earlier run' : ''}${s.error && st !== 'ok' ? ` · ${esc(s.error)}` : ''}`, s.okAt ? `updated ${ago(s.okAt)}` : s.state ? 'never worked' : ''));
      }
    } else jobs.push(row('bad', 'Traffic camera collector (daily)', esc(err.cams ?? 'no camera list')));
    sections.push(['Scheduled data jobs', 'Collected by GitHub Actions on a timetable and shipped with the site.', add(jobs)]);

    // 3. this session
    const sess = Object.entries(feedStatus).sort(([a], [b]) => a.localeCompare(b)).map(([id, s]) => row(s.state === 'ok' ? 'ok' : s.state === 'loading' ? 'idle' : 'bad', SOURCES[id]?.name ?? id,
      `${s.state === 'ok' ? `answered via ${VIA[s.via] ?? s.via ?? 'direct'}` : s.state === 'loading' ? 'loading…' : esc(s.note)}${s.state === 'ok' && s.note ? ` · ${esc(s.note)}` : ''}`, ago(s.at)));
    sections.push(['Feeds in this session', `Every source this ${isDesktop ? 'desktop app' : 'browser'} has asked for since the page opened${!isDesktop && !liveProxy() ? '. No proxy is set, so feeds without CORS headers come from the snapshot' : ''}.`, add(sess.length ? sess : [row('idle', 'Nothing requested yet', 'turn on a layer')])]);

    // 4. layers
    const lay = api.LAYERS.filter((l) => api.state.on.has(l.id)).map((l) => {
      const s = api.state.lstatus[l.id];
      return row(s?.s === 'error' ? 'bad' : s?.s === 'loading' ? 'idle' : 'ok', l.label, esc(s?.note || (s?.s === 'ok' ? 'loaded' : s?.s ?? 'waiting')), api.state.loadedAt[l.id] ? ago(api.state.loadedAt[l.id]) : '');
    });
    sections.push(['Layers on the map', 'Each layer’s last load. Hidden layers are not checked.', add(lay.length ? lay : [row('idle', 'No layers on', '')])]);

    const repo = api.repoUrl();
    const html = `<div class="health-sum"><span data-h="ok"><b>${tally.ok}</b> working</span><span data-h="warn"><b>${tally.warn}</b> stale or partial</span><span data-h="bad"><b>${tally.bad}</b> failing</span></div>
      ${sections.map(([t, sub, rows]) => `<h4>${esc(t)}</h4><p class="muted">${esc(sub)}</p>${list(rows)}`).join('')}
      <div class="row"><button class="btn" data-health="refresh">Check again</button><button class="btn ghost" data-health="copy">Copy a report</button>
        <a class="btn ghost" href="${esc(repo)}/actions" target="_blank" rel="noopener">Workflow runs</a><a class="btn ghost" href="${esc(repo)}/issues?q=label%3Adata-health" target="_blank" rel="noopener">Source issues</a></div>
      <p class="muted">A weekly workflow probes every source and opens a GitHub issue labelled “data-health” when one stops answering.</p>`;
    const body = document.getElementById('notes-body');
    if (open && api.isOpen('health') && body) { const top = body.scrollTop; body.innerHTML = html; body.scrollTop = top; } else api.openNotes('Data health', html, 'health');
  }

  function report() {
    return [...document.querySelectorAll('#notes-body h4, #notes-body .hrow')].map((el) => (el.tagName === 'H4' ? `\n${el.textContent}` : `${{ ok: 'OK  ', warn: 'WARN', bad: 'FAIL', idle: '... ' }[el.dataset.h]} ${el.querySelector('b').textContent}: ${el.querySelector('small').textContent} ${el.querySelector('em').textContent}`)).join('\n').trim();
  }

  async function show() {
    open = true; render(); // instant, from what is known
    await fetchAll(); render();
    clearInterval(timer); timer = setInterval(() => { if (!api.isOpen('health')) { clearInterval(timer); open = false; return; } fetchAll().then(render); }, 60_000);
  }
  let queued = false;
  onStatus(() => { if (!open || queued || !api.isOpen('health')) return; queued = true; setTimeout(() => { queued = false; if (api.isOpen('health')) render(); }, 800); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-health]'); if (!b) return;
    if (b.dataset.health === 'open') show();
    if (b.dataset.health === 'refresh') { b.textContent = 'Checking…'; fetchAll().then(render); }
    if (b.dataset.health === 'copy') navigator.clipboard?.writeText(`Global Intelligence Atlas data health, ${new Date().toISOString()}\n${report()}`).then(() => api.toast('Report copied'), () => api.toast('Could not copy: select the text instead'));
  });
  return { show };
}
