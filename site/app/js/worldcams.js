// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — public webcams worldwide.
// About 170,000 cameras whose operators deliberately publish them (road agencies, cities, weather services,
// universities and owner-submitted webcam directories such as Windy Webcams), taken from the WorldCam list
// (github.com/MALCO2BZ/malco2b, MIT) and vetted by tools/fetch-worldcams.mjs. Shipped as 10°×10° cells under
// data/worldcams/ so only the part of the world in view is downloaded; zoomed out, a 1° density grid stands in.
import { getLocal } from './feeds.js';
import { haversineKm } from './astro.js';
import { openCamera } from './cameras.js';

const SWATCH = '#ffcf6e';
const tip = (t, s = '') => `<div class="tip"><b>${t}</b>${s ? `<span>${s}</span>` : ''}</div>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inView = (v, lat, lng) => Math.abs(lat - v.lat) * 111 < v.radiusKm && haversineKm(v.lat, v.lng, lat, lng) < v.radiusKm;
const cellKey = (lat, lng) => `${Math.floor(lat / 10) * 10}_${Math.floor(lng / 10) * 10}`;
const GROUPS = { traffic: ['traffic', 'border', 'railway', 'port'], scenic: ['landmark', 'beach', 'ski', 'nature', 'water', 'volcano', 'wildlife', 'tourism', 'other'], weather: ['weather', 'aviation', 'airport', 'science', 'observatory', 'satellite', 'space'] };

export function webcamsLayer(api) {
  let index = null; let density = null; const cells = new Map(); let last = null; let lastKey = '';
  const expand = (s) => (s && s[0] === '~' ? index.prefixes[+s.slice(1, s.indexOf('/'))] + s.slice(s.indexOf('/') + 1) : s);
  const cam = (r) => {
    const [id, name, lat, lng, img, stream, pi, ti, country, city, page] = r; const pub = index.publishers[pi] ?? { name: 'Unknown publisher', kind: 0 };
    return { id, name, lat, lng, img: expand(img), stream: expand(stream), page: expand(page), source: pub.name, kind: index.kinds[pub.kind], type: index.types[ti], extra: [city, country, index.types[ti]].filter(Boolean).join(' · ') };
  };
  return {
    id: 'webcams', group: 'cams', label: 'Public webcams worldwide', swatch: SWATCH, on: false, viewDependent: true, reloadOnView: true, pin: 'camera',
    sources: ['worldcam', 'argus', 'windywebcams', 'osiriswebcams', 'skylinewebcams', 'youtubelive'],
    options: [{ id: 'show', label: 'Show', choices: [['all', 'All webcams'], ['traffic', 'Roads and borders'], ['scenic', 'Cities, nature and resorts'], ['weather', 'Weather, airports and science']], value: 'all' }],
    async load(o, ctx) {
      const v = ctx.view;
      index ??= await getLocal('data/worldcams/index.json').catch(() => { throw new Error('the worldwide webcam list has not been collected yet — run the “Refresh camera data” workflow once'); });
      const allow = o.show === 'all' ? null : new Set(GROUPS[o.show].map((t) => index.types.indexOf(t)));
      if (v.altitude > 1.2) {
        density ??= (await getLocal('data/worldcams/density.json')).rows;
        return { cams: [], density, total: index.total, at: index.generatedAt };
      }
      const want = new Set(); const span = Math.min(180, v.radiusKm / 111 + 10);
      for (let la = v.lat - span; la <= v.lat + span; la += 10) for (let lo = v.lng - span * 1.5; lo <= v.lng + span * 1.5; lo += 10) {
        const k = cellKey(Math.max(-89, Math.min(89, la)), ((((lo + 180) % 360) + 360) % 360) - 180);
        if (index.cells[k]) want.add(k);
      }
      await Promise.all([...want].filter((k) => !cells.has(k)).map(async (k) => cells.set(k, (await getLocal(`data/worldcams/${k}.json`).catch(() => ({ rows: [] }))).rows)));
      // Same cells and filter as last time → the very same object, so the particle cloud and click index are reused.
      const key = `${cells.size}|${o.show}`;
      if (last && key === lastKey) return last;
      const list = [];
      for (const rows of cells.values()) for (const r of rows) if (!allow || allow.has(r[7])) list.push(cam(r));
      lastKey = key; last = { cams: list, total: index.total, at: index.generatedAt };
      return last;
    },
    channels(d, ctx) {
      const v = ctx.view;
      if (d.density) {
        const max = d.density.reduce((m, r) => Math.max(m, r[2]), 1);
        return { points: d.density.map(([lat, lng, n]) => ({ lat, lng, alt: 0.004 + 0.1 * Math.log1p(n) / Math.log1p(max), r: 0.32, color: n > 300 ? SWATCH : 'rgba(255,207,110,0.55)', tip: tip(`${n.toLocaleString()} public webcams`, 'in this 1° square — zoom in to see each one'), ref: { layer: 'webcams', d: { density: n, lat, lng } } })) };
      }
      const near = v.altitude < 0.9 ? d.cams.filter((c) => inView(v, c.lat, c.lng)).slice(0, 1500) : [];
      return {
        particles: (d._particles ??= [{ color: SWATCH, size: 1.3, pts: d.cams.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.001 })) }]), // memoised: one draw call, no shader rebuild
        points: near.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.004, r: 0.055, color: SWATCH, tip: tip(esc(c.name), `${esc(c.source)} · click for the live view`), ref: { layer: 'webcams', d: c }, label: c.name })),
        pick: (d._pick ??= d.cams.map((c) => ({ lat: c.lat, lng: c.lng, alt: 0.001, ref: { layer: 'webcams', d: c } }))),
      };
    },
    open(c) {
      if (c.density) return api.fly(c.lat, c.lng, 0.6);
      return openCamera(c, api, this.nearby(c));
    },
    nearby: (c) => (last?.cams ?? []).filter((x) => x !== c && Math.abs(x.lat - c.lat) < 1).map((x) => ({ x, km: haversineKm(c.lat, c.lng, x.lat, x.lng) })).sort((a, b) => a.km - b.km).slice(0, 6),
    find: (id) => last?.cams.find((x) => x.id === id),
    describeLayer: (d) => ({ rows: [['Webcams worldwide', (d.total ?? 0).toLocaleString()], ['Loaded around your view', d.density ? 'zoom in to load individual webcams' : d.cams.length.toLocaleString()], ['Collected', d.at ? new Date(d.at).toUTCString() : '—'],
      ...(index ? [...index.kinds.map((k, i) => [k, `${index.publishers.filter((p) => p.kind === i).reduce((s, p) => s + p.count, 0).toLocaleString()} webcams`]), ['Publishers', index.publishers.length.toLocaleString()]] : [])] }),
    learn: {
      what: 'Public webcams on every continent: road and border cameras, city and beach views, ski resorts, volcanoes, airfields and weather stations. Every camera here is published on purpose by its operator — a transport agency, a city, a weather service, a university, or the owner who submitted it to a webcam directory such as Windy Webcams. Zoom in to see the pins; click one to watch it.',
      how: 'The list comes from WorldCam, an open-source collection of about 229,000 camera records. A weekly GitHub Action keeps only HTTPS feeds on named domains with no passwords in the address, from government, research or reviewed publisher sites, and skips cameras this atlas already collects straight from the agency. Cameras exposed by accident, such as unsecured home or business cameras, are never included. Images load straight from the publisher when you open a camera.',
      try: 'Fly to the Alps in winter and compare ski-resort webcams with the road cameras on the passes below them. Then find a volcano webcam in Japan or Iceland.',
      refs: ['worldcam', 'argus', 'windywebcams', 'osiriswebcams', 'skylinewebcams', 'youtubelive'],
    },
  };
}
