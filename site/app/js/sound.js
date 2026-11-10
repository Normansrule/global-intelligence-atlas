// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: quiet sound cues and "Listen" (read a page aloud).
//
// Sound is off until you switch it on with the speaker button in the top bar (remembered on this device). Every cue is
// made on the spot with the Web Audio API, so there are no sound files to download, license or cache:
//   open   a soft tick when a page opens on the right
//   new    a two-note chime when something big appears in "Just in" (lower for bigger events)
//   warn   a low double pulse when a new tornado or extreme warning appears
// "Listen" in the page header reads the open page aloud with the voice your system already has (speechSynthesis):
// the title, the line under it and the main text, never the folded "More" sections. It stops when the page changes.
// Inspired by Arno Faure's free-sfx package (CC BY 4.0) and the ElevenLabs Model Context Protocol (MCP) server's idea of
// a voice for every page; no audio or code is copied from either.

const KEY = 'gia-sound';
let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch { /* private window */ }
let ctx = null;
const audio = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };

/** One short tone: frequency glide f0 → f1 over `dur` seconds, with a soft attack and release. */
function tone(f0, f1, dur, { type = 'sine', gain = 0.06, at = 0 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at; const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}

/** Play a cue by name (nothing happens while sound is off). `weight` is the event's size, 0–100. */
export function cue(name, weight = 50) {
  if (!on) return;
  try {
    if (name === 'open') tone(1400, 900, 0.07, { gain: 0.035 });
    else if (name === 'new') { const base = 880 - Math.min(Math.max(weight, 0), 100) * 3.2; tone(base, base, 0.28, { gain: 0.05 }); tone(base * 1.5, base * 1.5, 0.42, { gain: 0.045, at: 0.13 }); }
    else if (name === 'warn') { tone(220, 200, 0.18, { type: 'triangle', gain: 0.07 }); tone(220, 200, 0.18, { type: 'triangle', gain: 0.07, at: 0.26 }); }
    else if (name === 'on') { tone(660, 660, 0.12, { gain: 0.04 }); tone(990, 990, 0.16, { gain: 0.04, at: 0.09 }); }
  } catch { /* audio blocked */ }
}
export const soundOn = () => on;
export function setSound(v) {
  on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window */ }
  const b = document.getElementById('sound-toggle'); if (b) { b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Sound is on: soft cues for new events and opened pages (click to mute)' : 'Sound is off (click for soft cues when something big happens)'; b.classList.toggle('on', on); }
  if (on) cue('on');
}

// ------------------------------------------------------------------ Listen
const speech = typeof window !== 'undefined' ? window.speechSynthesis : null;
/** The words "Listen" reads for a page: title, the line under it, then the visible text outside folded sections. */
export function pageText(root, title = '') {
  if (!root) return title;
  const parts = [title];
  const skip = (el) => el.closest('details:not([open]), .quick, button, svg, figcaption, .skel, [aria-hidden="true"], script, style');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !skip(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  let n; let len = 0;
  while ((n = walker.nextNode()) && len < 3000) { const s = n.textContent.replace(/\s+/g, ' ').trim(); parts.push(s); len += s.length; }
  return parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.').replace(/·/g, ',').replace(/(\d) %/g, '$1 percent').replace(/µg\/m³/g, 'micrograms per cubic metre').replace(/km\/h/g, 'kilometres an hour').replace(/°C/g, ' degrees');
}
let speaking = false;
function stopSpeaking() { if (speech) speech.cancel(); speaking = false; const b = document.getElementById('notes-listen'); if (b) { b.setAttribute('aria-pressed', 'false'); b.title = 'Listen: read this page aloud'; } }
function speakPage() {
  if (!speech) return;
  if (speaking) { stopSpeaking(); return; }
  const text = pageText(document.getElementById('notes-body'), document.getElementById('notes-title')?.textContent ?? '');
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en'; u.rate = 1.02;
  u.onend = () => stopSpeaking(); u.onerror = () => stopSpeaking();
  speech.cancel(); speech.speak(u); speaking = true;
  const b = document.getElementById('notes-listen'); if (b) { b.setAttribute('aria-pressed', 'true'); b.title = 'Stop reading'; }
}

const SPEAKER = '<svg class="ui-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path class="snd-wave" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/><path class="snd-mute" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
const LISTEN = '<svg class="ui-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13v-1a7 7 0 0 1 14 0v1"/><path d="M5 13h2.5v6H6a1 1 0 0 1-1-1zM19 13h-2.5v6H18a1 1 0 0 0 1-1z"/></svg>';

/** Add the top-bar speaker and the page-header Listen button, and start listening for things worth a cue. */
export function installSound() {
  if (typeof document === 'undefined' || document.getElementById('sound-toggle')) return;
  if (!document.querySelector('link[data-sense]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/sense.css', import.meta.url).href; l.dataset.sense = '1'; document.head.appendChild(l); }
  const theme = document.getElementById('theme-toggle');
  if (theme) {
    const b = document.createElement('button'); b.id = 'sound-toggle'; b.className = 'chipbtn soundb'; b.setAttribute('aria-label', 'Sound cues'); b.innerHTML = SPEAKER;
    theme.before(b); b.addEventListener('click', () => setSound(!on)); setSound(on);
  }
  const close = document.querySelector('#notes .panel-head [data-close="notes"]');
  if (close && speech) {
    const b = document.createElement('button'); b.id = 'notes-listen'; b.className = 'icon'; b.setAttribute('aria-label', 'Listen: read this page aloud'); b.setAttribute('aria-pressed', 'false'); b.title = 'Listen: read this page aloud'; b.innerHTML = LISTEN;
    close.before(b); b.addEventListener('click', speakPage);
  }
  // a page opening, or changing while open: tick, and stop reading the old one
  const notes = document.getElementById('notes'); const body = document.getElementById('notes-body');
  if (notes && body) {
    let lastTitle = '';
    new MutationObserver(() => {
      const t = document.getElementById('notes-title')?.textContent ?? '';
      if (t !== lastTitle || !notes.classList.contains('open')) { if (speaking) stopSpeaking(); }
      if (notes.classList.contains('open') && t !== lastTitle) cue('open');
      lastTitle = notes.classList.contains('open') ? t : '';
    }).observe(notes, { attributes: true, attributeFilter: ['class'], subtree: false });
    new MutationObserver(() => { if (speaking) stopSpeaking(); }).observe(body, { childList: true });
  }
  // "Just in" marks: chime once per new item
  const heard = new Set(); const track = document.getElementById('ticker-track');
  if (track) new MutationObserver(() => {
    for (const el of track.querySelectorAll('[data-live].new')) {
      const id = el.dataset.live; if (heard.has(id)) continue; heard.add(id);
      const kind = el.querySelector('b')?.textContent ?? ''; const m = /M(\d+(?:\.\d)?)/.exec(el.textContent);
      cue(/tornado|extreme/i.test(el.textContent) ? 'warn' : 'new', m ? (+m[1] - 4) * 25 : /red|alert/i.test(kind) ? 70 : 40);
    }
  }).observe(track, { childList: true });
}
