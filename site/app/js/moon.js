// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Moon and the tides.
// The sublunar point (where the Moon is straight overhead), the antipodal point opposite it, and the
// line where the Moon is rising or setting. The ocean's two tidal bulges sit roughly under those two
// points, which is why most coasts get two high tides a day.
import { moonState, nextMoonPhase, smallCircle, fmtLat, fmtLng, wrapLng } from './astro.js';

const tip = (t, s = '') => `<div class="tip"><b>${t}</b>${s ? `<span>${s}</span>` : ''}</div>`;
const GLYPH = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
export const moonGlyph = (age) => GLYPH[Math.round(age / 45) % 8];

export const moonLayer = {
  id: 'moon', pin: (d) => (d.kind === 'anti' ? 'water' : 'moon'), legend: [['moon', 'Moon straight overhead'], ['water', 'Opposite tidal bulge']], group: 'space', label: 'Moon and tides', swatch: '#d9e2ea', on: false, refresh: 60_000, timeDriven: true, fresh: true,
  sources: ['lunar'],
  async load() { return {}; },
  channels(_d, ctx) {
    const m = moonState(ctx.now);
    const anti = { lat: -m.lat, lng: wrapLng(m.lng + 180) };
    const g = moonGlyph(m.age);
    return {
      points: [
        { lat: m.lat, lng: m.lng, alt: 0.05, r: 0.5, color: '#e8eef3', label: 'Moon overhead', tip: tip(`${g} Moon overhead`, `${m.name} · ${Math.round(m.illum * 100)} % lit`), ref: { layer: 'moon', d: { ...m, kind: 'sub' } } },
        { lat: anti.lat, lng: anti.lng, alt: 0.03, r: 0.4, color: '#9fc3e6', label: 'Opposite tidal bulge', tip: tip('Opposite tidal bulge', 'the ocean bulges here too'), ref: { layer: 'moon', d: { ...m, kind: 'anti' } } },
      ],
      paths: [{ pts: smallCircle(m.lat, m.lng, 90, 240).map(([a, b]) => [a, b, 0.004]), color: 'rgba(217,226,234,0.55)', stroke: 0.35, dash: [0.012, 0.012],
        tip: tip('Moonrise / moonset line', 'the Moon is on the horizon along this line'), ref: { layer: 'moon', d: { ...m, kind: 'line' } } }],
      rings: [{ lat: m.lat, lng: m.lng, color: '#d9e2ea', maxR: 4, speed: 0.8, period: 3200 }, { lat: anti.lat, lng: anti.lng, color: '#9fc3e6', maxR: 4, speed: 0.8, period: 3200 }],
    };
  },
  describe(m) {
    const next = [[0, 'New moon'], [90, 'First quarter'], [180, 'Full moon'], [270, 'Last quarter']]
      .map(([a, n]) => [n, nextMoonPhase(a)]).filter(([, t]) => t).sort((a, b) => a[1] - b[1]);
    const lightSec = m.distKm / 299792.458;
    return {
      title: `${moonGlyph(m.age)} ${m.name}`, sub: `${Math.round(m.illum * 100)} % lit · ${m.waxing ? 'waxing (growing)' : 'waning (shrinking)'}`,
      rows: [
        ['Overhead at', `${fmtLat(m.lat)}, ${fmtLng(m.lng)}`],
        ['Distance', `${Math.round(m.distKm).toLocaleString()} km (${lightSec.toFixed(2)} light-seconds)`],
        ['Size in the sky', `${(2 * Math.atan(1737.4 / m.distKm) * 180 / Math.PI * 60).toFixed(1)} arcminutes${m.distKm < 362000 ? ' (a “supermoon” distance)' : m.distKm > 404000 ? ' (a “micromoon” distance)' : ''}`],
        ['Moon’s age', `${(m.age / 360 * 29.53).toFixed(1)} days since new moon`],
        ...next.map(([n, t]) => [`Next ${n.toLowerCase()}`, `${t.toUTCString().slice(0, 22)} UTC`]),
      ],
      body: m.kind === 'anti'
        ? 'The Moon pulls hardest on the side of Earth facing it and least on the far side. Seen from Earth’s centre, both sides are “stretched” away, so the ocean bulges here too, opposite the Moon. Earth turns under both bulges each day, giving most coasts two high tides about 12 h 25 min apart.'
        : 'The Moon is straight overhead at this point. Its latitude swings between about 28.6° north and south over each month (more than the Sun’s 23.4°), and the point moves west about 13° an hour — slightly slower than the Sun, which is why moonrise comes about 50 minutes later each day.',
      probe: [m.lat, m.lng],
      links: [{ label: 'NASA — Moon phases and libration', url: 'https://svs.gsfc.nasa.gov/gallery/moonphase/' }, { label: 'NOAA — What causes tides?', url: 'https://oceanservice.noaa.gov/education/tutorial_tides/' }],
    };
  },
  learn: {
    what: 'Where the Moon is directly overhead right now (with its phase), the point exactly opposite, and the dashed line where the Moon is rising or setting. The two points mark the idealised tidal bulges; the real tide is shaped by coastlines and ocean basins, so it lags and varies.',
    how: 'Computed in your browser with the Astronomical Almanac’s low-precision lunar formulas (about 0.3° accurate, less than the Moon’s own width). The phase comes from the angle between the Moon and the Sun as seen from Earth.',
    try: 'Open the time machine and run a day forward at speed: watch both bulges sweep west around the planet. Then jump two weeks: at new and full moon the Sun lines up with them (spring tides); at quarter moons it doesn’t (neap tides).',
    refs: ['lunar'],
  },
};
