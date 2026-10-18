// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas example plug-in: "Day length". Hours of daylight today every 10° of latitude, along the
// meridian in the middle of the view. Add it with ?plugins=daylength in the address, or "plugins": ["daylength"] in
// app/config.json. It shows the whole plug-in contract (see README.md in this folder): a default export that returns
// one layer object, a sources key that sources.js already has, and Learn text.
import { subsolarPoint } from '../js/astro.js';

const rad = Math.PI / 180;
/** Hours of daylight at latitude `lat` when the Sun's declination is `dec` (degrees), with refraction (−0.833°). */
export function dayLength(lat, dec) {
  const c = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec * rad)) / (Math.cos(lat * rad) * Math.cos(dec * rad));
  if (c <= -1) return 24; if (c >= 1) return 0;
  return (2 * Math.acos(c)) / rad / 15;
}
const colour = (h) => (h >= 20 ? '#fff3b0' : h >= 14 ? '#ffd166' : h >= 10 ? '#f4a261' : h >= 4 ? '#9b7be0' : '#4a3f8c');
const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;

export default function dayLengthLayer(api) {
  return {
    id: 'daylength', group: 'space', label: 'Day length today (plug-in)', swatch: '#ffd166', on: false, refresh: 10 * 60_000, timeDriven: true, viewDependent: true,
    sources: ['solar'],
    async load() { return { lng: api.view().lng ?? 0 }; },
    channels(d, ctx) {
      const dec = subsolarPoint(ctx?.now ?? api.now()).lat; const lng = api.view().lng ?? d.lng;
      const points = [];
      for (let lat = -80; lat <= 80; lat += 10) {
        const h = dayLength(lat, dec);
        points.push({ lat, lng, alt: 0.01, r: 0.5, color: colour(h), tip: `<div class="tip"><b>${hm(h)} of daylight</b><span>${Math.abs(lat)}° ${lat >= 0 ? 'N' : 'S'} today</span></div>`, ref: { layer: 'daylength', d: { lat, h, dec } } });
      }
      return { points };
    },
    count: () => '17 latitudes',
    describe: (x) => ({ title: `${hm(x.h)} of daylight`, sub: `${Math.abs(x.lat)}° ${x.lat >= 0 ? 'north' : 'south'} today`, rows: [['Sun’s declination', `${x.dec.toFixed(2)}°`]], body: 'From sunrise to sunset, counting the half-degree the atmosphere bends the Sun up at the horizon.' }),
    learn: {
      what: 'How long the Sun is up today at every 10° of latitude, along the meridian in the middle of your view. Pale yellow is the midnight sun, deep purple the polar night.',
      how: 'The Earth’s axis is tilted 23.4°, so the Sun’s declination swings between +23.4° in June and −23.4° in December. Day length follows from the hour angle of sunrise: cos H = (sin(−0.833°) − sin φ sin δ) / (cos φ cos δ), and the day lasts 2H ÷ 15° per hour.',
      try: 'Open the time machine and run a year at speed: watch the long days slide from one pole to the other. At the equinoxes every latitude gets about 12 hours.',
      refs: ['solar', 'meeus'],
    },
  };
}
