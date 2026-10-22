// SPDX-License-Identifier: AGPL-3.0-only
// Runs before the page paints so a saved light or dark choice never flashes the other theme first.
try { const t = localStorage.getItem('gia-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch {}
// Marks the page as scripted so arrival and scroll-reveal styles apply only when the script that ends them runs.
document.documentElement.classList.add('js');
