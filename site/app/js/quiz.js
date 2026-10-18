// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — "Where on Earth?" Click the globe where you think a place is;
// score falls off with great-circle distance. Places come from World Monitor's
// datasets plus a short list of landmarks.

import { haversineKm, fmtKm } from './astro.js';
import { worldMonitorData } from './layers.js';

const LANDMARKS = [
  ['Mount Everest', 27.988, 86.925, 'Highest point above sea level, 8,849 m.'],
  ['Challenger Deep (Mariana Trench)', 11.35, 142.2, 'Deepest known point in the ocean, about 10,935 m.'],
  ['Mid-Atlantic Ridge in Iceland (Þingvellir)', 64.256, -21.13, 'You can stand in the rift between the North American and Eurasian plates.'],
  ['Great Barrier Reef', -18.29, 147.7, 'The largest coral reef system, visible from orbit.'],
  ['Lake Baikal', 53.5, 108.2, 'Deepest lake on Earth, holding about 20 % of unfrozen surface fresh water.'],
  ['Kīlauea', 19.41, -155.28, 'Hotspot volcano in the middle of the Pacific Plate — not on a boundary.'],
  ['Cape of Good Hope', -34.357, 18.474, 'Ships diverted from Suez sail around here.'],
  ['Strait of Gibraltar', 35.97, -5.5, 'Only 14 km wide between Europe and Africa.'],
  ['Amazon River mouth', -0.5, -50, 'Discharges about a fifth of all river water reaching the oceans.'],
  ['South Pole', -90, 0, 'All lines of longitude meet here — every direction is north.'],
];

export async function buildQuestionPool() {
  const wm = await worldMonitorData();
  const pool = LANDMARKS.map(([name, lat, lng, fact]) => ({ name, lat, lng, fact, kind: 'Landmark' }));
  for (const p of wm.ports.filter((p) => p.rank && p.rank <= 20)) pool.push({ name: p.name, lat: p.lat, lng: p.lon, fact: p.note, kind: 'Port' });
  for (const s of wm.spaceports) pool.push({ name: s.name, lat: s.lat, lng: s.lon, fact: `Operated by ${s.operator}.`, kind: 'Spaceport' });
  for (const w of wm.waterways) pool.push({ name: w.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), lat: w.lat, lng: w.lon, fact: w.description, kind: 'Chokepoint' });
  for (const e of wm.economic.filter((e) => e.type === 'exchange')) pool.push({ name: e.name, lat: e.lat, lng: e.lon, fact: e.description, kind: 'Exchange' });
  return pool;
}

export class Quiz {
  constructor(pool, rounds = 8) {
    this.rounds = [...pool].sort(() => Math.random() - 0.5).slice(0, rounds);
    this.i = 0; this.score = 0; this.results = [];
  }
  get current() { return this.rounds[this.i]; }
  get done() { return this.i >= this.rounds.length; }
  guess(lat, lng) {
    const q = this.current;
    const km = haversineKm(lat, lng, q.lat, q.lng);
    const pts = Math.max(0, Math.round(1000 * Math.exp(-km / 1500)));
    this.score += pts;
    const r = { q, lat, lng, km, pts, kmText: fmtKm(km) };
    this.results.push(r); this.i += 1;
    return r;
  }
}
