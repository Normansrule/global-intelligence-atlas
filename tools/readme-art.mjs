#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: draws the README's designed pieces as small animated SVGs in site/docs-media/, each in a
// dark and a light version (the README picks one with <picture> and prefers-color-scheme):
//   btn-web, btn-windows, btn-macos, btn-linux   the get-the-app buttons
//   flow                                         how the data reaches you, with packets moving along each path
//   speed-v217                                   the v2.17 first-visit timings as bars that grow in
//   closeups-v218                                traffic queueing at a light and a ship's wake (v2.18)
// Everything is drawn here, with system fonts, so GitHub shows it as-is. Animations stop for reduced motion.
//   node tools/readme-art.mjs
import { writeFileSync } from 'node:fs';

const OUT = 'site/docs-media/';
const FONT = "'Jost','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";
const THEMES = {
  dark: { bg: '#0b1524', card: '#132339', line: '#24384f', ink: '#dfe9f3', soft: '#9fb3c8', blue: '#4aa3ff', deep: '#1f4e9c', red: '#ff6b5e', green: '#5fc77a', gold: '#ffd27a', btnInk: '#ffffff' },
  light: { bg: '#f6f1e6', card: '#fffaf0', line: '#d8ccb4', ink: '#1d2a3a', soft: '#5b6b7c', blue: '#1f62c4', deep: '#1f4e9c', red: '#c4312b', green: '#2e7d4a', gold: '#b7791f', btnInk: '#ffffff' },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (w, h, label, body, style = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">
<style>text{font-family:${FONT}} ${style} @media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
${body}
</svg>
`;

// ---------------------------------------------------------------- icons (24 x 24, stroked)
const ICON = {
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19"/>',
  window: '<rect x="2.5" y="3.5" width="19" height="14" rx="2"/><path d="M8 21h8M12 17.5V21M2.5 7.5h19"/>',
  laptop: '<rect x="4.5" y="4.5" width="15" height="10.5" rx="1.6"/><path d="M2 18.5h20l-1.5 1.5h-17z"/>',
  terminal: '<rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M6.5 9l3.5 3-3.5 3M12.5 15.5h5"/>',
  down: '<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
};
const icon = (name, x, y, s, color, w = 2) => `<g transform="translate(${x},${y}) scale(${s / 24})" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;

// ---------------------------------------------------------------- buttons
const BUTTONS = [
  { id: 'web', icon: 'globe', top: 'Open in your browser', main: 'Launch the atlas', primary: true, tail: 'play' },
  { id: 'windows', icon: 'window', top: 'Download for', main: 'Windows', tail: 'down' },
  { id: 'macos', icon: 'laptop', top: 'Download for', main: 'macOS', tail: 'down' },
  { id: 'linux', icon: 'terminal', top: 'Download for', main: 'Linux', tail: 'down' },
];
function button(b, t, mode) {
  const W = b.primary ? 300 : 220; const H = 68;
  const fill = b.primary ? `url(#g)` : t.card; const ink = b.primary ? t.btnInk : t.ink; const sub = b.primary ? 'rgba(255,255,255,.78)' : t.soft;
  const body = `<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${t.deep}"/><stop offset="1" stop-color="${mode === 'dark' ? '#2f78d6' : '#2d6fd0'}"/></linearGradient>
<linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="c"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16"/></clipPath></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${fill}" stroke="${b.primary ? 'none' : t.line}" stroke-width="1.5"/>
${b.primary ? `<g clip-path="url(#c)"><rect class="shine" x="-120" y="0" width="90" height="${H}" fill="url(#s)" transform="skewX(-18)"/></g>` : ''}
${icon(b.icon, 20, 20, 28, ink)}
<text x="62" y="29" font-size="12.5" font-weight="500" fill="${sub}" letter-spacing=".3">${esc(b.top)}</text>
<text x="62" y="50" font-size="20" font-weight="700" fill="${ink}">${esc(b.main)}</text>
${icon(b.tail, W - 42, 22, 24, b.primary ? ink : t.blue, 2.2)}`;
  const style = b.primary ? '.shine{animation:sh 4.5s ease-in-out infinite}@keyframes sh{0%,55%{transform:translateX(0) skewX(-18deg)}100%{transform:translateX(520px) skewX(-18deg)}}' : '';
  return svg(W, H, `${b.top} ${b.main}`, body, style);
}

// ---------------------------------------------------------------- how it works
function flow(t) {
  const W = 1200; const H = 330;
  const nodes = [
    { x: 30, y: 105, w: 230, title: '160+ open sources', lines: ['USGS, NASA, NOAA, ESA,', 'OpenSky, AISStream, GDACS…'], icon: 'globe', c: t.green },
    { x: 340, y: 105, w: 230, title: 'GitHub Actions', lines: ['fetch, check and shrink', 'every few minutes'], icon: 'terminal', c: t.gold },
    { x: 650, y: 105, w: 230, title: 'Public snapshot', lines: ['live-data branch and', 'the published site'], icon: 'down', c: t.blue },
    { x: 940, y: 40, w: 230, title: 'Your browser', lines: ['the web app: no account,', 'no key, works offline'], icon: 'globe', c: t.red },
    { x: 940, y: 180, w: 230, title: 'Desktop app', lines: ['Windows, macOS, Linux;', 'flights and ships in real time'], icon: 'laptop', c: t.red },
  ];
  const card = (n) => `<g transform="translate(${n.x},${n.y})"><rect width="${n.w}" height="110" rx="16" fill="${t.card}" stroke="${t.line}" stroke-width="1.5"/>
<rect x="0" y="0" width="6" height="110" rx="3" fill="${n.c}"/>${icon(n.icon, 22, 22, 26, n.c)}
<text x="60" y="42" font-size="19" font-weight="700" fill="${t.ink}">${esc(n.title)}</text>
${n.lines.map((l, i) => `<text x="22" y="${74 + i * 21}" font-size="14.5" fill="${t.soft}">${esc(l)}</text>`).join('')}</g>`;
  const paths = [
    { d: 'M260 160 C300 160 300 160 340 160', c: t.green, dur: 2.2 },
    { d: 'M570 160 C610 160 610 160 650 160', c: t.gold, dur: 2.2 },
    { d: 'M880 160 C910 160 910 95 940 95', c: t.blue, dur: 2.0 },
    { d: 'M880 160 C910 160 910 235 940 235', c: t.blue, dur: 2.0 },
    { d: 'M145 215 C145 300 1055 330 1055 290', c: t.red, dur: 4.2, dash: true },
  ];
  const wires = paths.map((p, i) => `<path id="p${i}" d="${p.d}" fill="none" stroke="${p.c}" stroke-opacity=".55" stroke-width="2.5" ${p.dash ? 'stroke-dasharray="6 7"' : ''}/>
${[0, 1, 2].map((k) => `<circle r="4.5" fill="${p.c}"><animateMotion dur="${p.dur}s" begin="${(k * p.dur) / 3}s" repeatCount="indefinite" rotate="auto"><mpath href="#p${i}"/></animateMotion></circle>`).join('')}`).join('\n');
  const body = `<rect width="${W}" height="${H}" rx="20" fill="${t.bg}"/>
<text x="30" y="52" font-size="24" font-weight="700" fill="${t.ink}">How the world reaches your screen</text>
<text x="30" y="80" font-size="15" fill="${t.soft}">No server of our own: open data in, a public snapshot out, and your device does the rest.</text>
${wires}
${nodes.map(card).join('\n')}
<text x="600" y="318" text-anchor="middle" font-size="13.5" fill="${t.soft}">The desktop app also asks the live sources directly (dashed), so it is not limited by what a browser may fetch.</text>`;
  return svg(W, H, 'How the data reaches you: open sources are fetched by GitHub Actions every few minutes into a public snapshot that the web app reads; the desktop app also fetches live sources directly.', body);
}

// ---------------------------------------------------------------- speed chart (v2.17)
function speed(t) {
  const W = 1200; const rows = [
    { label: 'Phone-like connection: the finished Earth', unit: 's', a: 4.01, b: 3.45, max: 4.2 },
    { label: 'Broadband: the finished Earth', unit: 's', a: 1.91, b: 1.58, max: 4.2 },
    { label: 'Downloaded before the Earth is drawn', unit: 'MB', a: 2.38, b: 1.59, max: 2.6 },
  ];
  const X = 420; const BW = 640; let y = 110; let k = 0;
  const bars = rows.map((r) => {
    const g = `<text x="30" y="${y + 24}" font-size="16" font-weight="600" fill="${t.ink}">${esc(r.label)}</text>
<g transform="translate(${X},${y})"><rect class="bar" style="animation-delay:${0.15 * k++}s" width="${(BW * r.a) / r.max}" height="18" rx="9" fill="${t.line}"/>
<text x="${(BW * r.a) / r.max + 10}" y="14" font-size="14" fill="${t.soft}">v2.16 · ${r.a.toFixed(2)} ${r.unit}</text></g>
<g transform="translate(${X},${y + 24})"><rect class="bar" style="animation-delay:${0.15 * k++}s" width="${(BW * r.b) / r.max}" height="18" rx="9" fill="${t.blue}"/>
<text x="${(BW * r.b) / r.max + 10}" y="14" font-size="14" font-weight="700" fill="${t.ink}">v2.17 · ${r.b.toFixed(2)} ${r.unit}</text>
<text x="${(BW * r.b) / r.max + 150}" y="14" font-size="14" font-weight="700" fill="${t.green}">−${Math.round((1 - r.b / r.a) * 100)} %</text></g>`;
    y += 72; return g;
  }).join('\n');
  const H = y + 20;
  const body = `<rect width="${W}" height="${H}" rx="20" fill="${t.bg}"/>
<text x="30" y="52" font-size="24" font-weight="700" fill="${t.ink}">A first visit, timed</text>
<text x="30" y="80" font-size="15" fill="${t.soft}">Median of five runs on the same machine: HTTP/2 with gzip like GitHub Pages, throttled network and processor (tests/perf/startup.py).</text>
${bars}`;
  const style = '.bar{transform-box:fill-box;transform-origin:left center;animation:grow 1.4s cubic-bezier(.2,.8,.2,1) both}@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}';
  return svg(W, H, rows.map((r) => `${r.label}: v2.16 ${r.a} ${r.unit}, v2.17 ${r.b} ${r.unit}`).join('; '), body, style);
}

// ---------------------------------------------------------------- v2.18 close-ups: traffic at a light, a ship's wake
function closeups(t, mode) {
  const W = 1200; const H = 340; const road = mode === 'dark' ? '#2a3442' : '#cfc6b4'; const lane = mode === 'dark' ? '#5d6b7c' : '#f6f1e6';
  const cars = [0, 1, 2, 3, 4].map((i) => {
    const q = 470 - i * 62; const x0 = -80 - i * 95; const c = ['#e9ecef', '#c0392b', '#2e5c8a', '#d9b44a', '#1f6f50'][i];
    const go = 52 + i * 5; // % of the loop when this car pulls away (the light turns green at 50 %)
    return `<g class="car" style="animation:c${i} 10s cubic-bezier(.45,0,.55,1) infinite"><rect x="-22" y="-11" width="44" height="22" rx="6" fill="${c}"/><rect x="2" y="-9" width="12" height="18" rx="3" fill="#1b2631" opacity=".75"/><circle class="tail" cx="-22" cy="-7" r="2.6" fill="#ff3b30"/><circle class="tail" cx="-22" cy="7" r="2.6" fill="#ff3b30"/></g>
<style>@keyframes c${i}{0%{transform:translate(${x0}px,200px)}38%{transform:translate(${q}px,200px)}${go}%{transform:translate(${q}px,200px)}100%{transform:translate(${q + 700}px,200px)}}</style>`;
  }).join('\n');
  const left = `<g clip-path="url(#road)"><rect x="30" y="160" width="560" height="80" fill="${road}"/>
<path d="M30 200 H590" stroke="${lane}" stroke-width="3" stroke-dasharray="18 14"/><path d="M505 165 V235" stroke="#fff" stroke-width="4"/>
${cars}</g>
<g transform="translate(520,104)"><rect width="34" height="78" rx="9" fill="#111a26" stroke="${t.line}"/>
<circle class="red" cx="17" cy="20" r="10" fill="#ff3b30"/><circle class="grn" cx="17" cy="56" r="10" fill="#33d17a"/></g>
<text x="30" y="290" font-size="15" fill="${t.soft}">Each driver keeps about 1.2 s and 2 m to the one ahead,</text>
<text x="30" y="312" font-size="15" fill="${t.soft}">brakes at up to 6 m/s² and stops at the line on red.</text>`;
  const kel = Math.tan(19.5 * Math.PI / 180);
  const sx = 1010; const sy = 200; const len = 420;
  const right = `<g><path d="M${sx - 60} ${sy} L${sx - 60 - len} ${sy - len * kel} M${sx - 60} ${sy} L${sx - 60 - len} ${sy + len * kel}" stroke="#ffffff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round" class="foam"/>
<path d="M${sx - 60} ${sy} L${sx - 60 - len * 0.8} ${sy}" stroke="#ffffff" stroke-opacity=".35" stroke-width="12" stroke-linecap="round"/>
<text x="${sx - 190}" y="${sy - 40}" font-size="16" font-weight="700" fill="${t.gold}">19.5°</text>
<path d="M${sx - 70} ${sy - 18} H${sx + 50} L${sx + 90} ${sy} L${sx + 50} ${sy + 18} H${sx - 70} Z" fill="#22313f" stroke="#9fb3c8"/>
<rect x="${sx + 10}" y="${sy - 12}" width="22" height="24" rx="3" fill="#f4f6f7"/>
<circle class="blink" cx="${sx + 20}" cy="${sy - 22}" r="5" fill="#ff3b30"/><circle class="blink" cx="${sx + 20}" cy="${sy + 22}" r="5" fill="#33d17a"/><circle cx="${sx + 40}" cy="${sy}" r="4" fill="#fff6d8"/></g>
<text x="660" y="290" font-size="15" fill="${t.soft}">Every moving ship trails foam at the Kelvin angle, 19.5°, the same for</text>
<text x="660" y="312" font-size="15" fill="${t.soft}">any boat on calm water. At night: red to port, green to starboard.</text>`;
  const body = `<defs><clipPath id="road"><rect x="30" y="150" width="560" height="100" rx="10"/></clipPath><clipPath id="sea"><rect x="640" y="100" width="530" height="170" rx="14"/></clipPath></defs>
<rect width="${W}" height="${H}" rx="20" fill="${t.bg}"/>
<text x="30" y="52" font-size="24" font-weight="700" fill="${t.ink}">Close-ups that behave like the real thing</text>
<text x="30" y="80" font-size="15" fill="${t.soft}">Zoom right in: traffic flows and queues on the real roads, and ships cut wakes through the water.</text>
<rect x="640" y="100" width="530" height="170" rx="14" fill="${mode === 'dark' ? '#0e2a44' : '#2b5f8a'}"/>
<g clip-path="url(#sea)">${right.split('<text')[0]}</g>${'<text' + right.split('<text').slice(1).join('<text')}
${left}`;
  const style = `.red{animation:red 10s steps(1) infinite}.grn{animation:grn 10s steps(1) infinite}
@keyframes red{0%{opacity:1}50%{opacity:.15}}@keyframes grn{0%{opacity:.15}50%{opacity:1}}
.blink{animation:bl 1.6s ease-in-out infinite alternate}@keyframes bl{from{opacity:.55}to{opacity:1}}
.foam{animation:fm 2.4s ease-in-out infinite alternate}@keyframes fm{from{stroke-opacity:.5}to{stroke-opacity:.9}}`;
  return svg(W, H, 'Animated: cars queue at a red traffic light and pull away one after another on green; a ship trails a V-shaped foam wake at 19.5 degrees with a red light to port and green to starboard.', body, style);
}

for (const [mode, t] of Object.entries(THEMES)) {
  for (const b of BUTTONS) writeFileSync(`${OUT}btn-${b.id}-${mode}.svg`, button(b, t, mode));
  writeFileSync(`${OUT}flow-${mode}.svg`, flow(t));
  writeFileSync(`${OUT}speed-v217-${mode}.svg`, speed(t));
  writeFileSync(`${OUT}closeups-v218-${mode}.svg`, closeups(t, mode));
}
console.log('wrote', BUTTONS.length * 2 + 6, 'SVGs to', OUT);
