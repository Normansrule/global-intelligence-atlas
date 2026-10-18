// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — the simulation clock behind the time machine. Everything that depends on "now"
// (the Sun, the terminator, satellites, space stations, earthquake replays) asks this clock instead of
// the computer's. Live mode is simply speed 1 with no offset.
const c = { at: Date.now(), anchor: performance.now(), speed: 1, paused: false };
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(clock));

export const clock = {
  now() { return c.paused ? c.at : c.at + (performance.now() - c.anchor) * c.speed; },
  date() { return new Date(clock.now()); },
  get speed() { return c.speed; },
  get paused() { return c.paused; },
  isLive() { return !c.paused && c.speed === 1 && Math.abs(clock.now() - Date.now()) < 5000; },
  set(ms) { c.at = ms; c.anchor = performance.now(); emit(); },
  setSpeed(s) { c.at = clock.now(); c.anchor = performance.now(); c.speed = s; c.paused = false; emit(); },
  pause(p = !c.paused) { c.at = clock.now(); c.anchor = performance.now(); c.paused = p; emit(); },
  live() { c.at = Date.now(); c.anchor = performance.now(); c.speed = 1; c.paused = false; emit(); },
  shift(ms) { clock.set(clock.now() + ms); },
  on(f) { listeners.add(f); return () => listeners.delete(f); },
};
export const SPEEDS = [-3600, -600, -60, 1, 60, 600, 3600, 21600];
export function speedLabel(s) {
  const a = Math.abs(s); const sign = s < 0 ? '−' : '';
  return a === 1 ? (s < 0 ? '−1×' : 'Real time') : a < 3600 ? `${sign}${a / 60} min/s` : `${sign}${a / 3600} h/s`;
}
