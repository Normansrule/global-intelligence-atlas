// SPDX-License-Identifier: AGPL-3.0-only
// HTTP/2 + gzip static server like GitHub Pages, for timing only.
import http2 from 'node:http2'; import { readFileSync, statSync } from 'node:fs'; import { gzipSync } from 'node:zlib'; import { join, extname } from 'node:path';
const root = process.argv[2]; const port = +process.argv[3] || 8767;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const cache = new Map();
http2.createSecureServer({ key: readFileSync(process.argv[4] + '/key.pem'), cert: readFileSync(process.argv[4] + '/cert.pem') }, (req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  try { if (statSync(p).isDirectory()) p = join(p, 'index.html'); } catch { res.writeHead(404); return res.end('404'); }
  const ext = extname(p); const gz = /\.(html|js|mjs|css|json|geojson|svg|txt)$/.test(p) && /gzip/.test(req.headers['accept-encoding'] || '');
  let body = cache.get(p + gz); if (!body) { body = readFileSync(p); if (gz) body = gzipSync(body, { level: 6 }); cache.set(p + gz, body); }
  res.writeHead(200, { 'content-type': T[ext] || 'application/octet-stream', ...(gz ? { 'content-encoding': 'gzip' } : {}), 'cache-control': 'no-store' }); res.end(body);
}).listen(port, () => console.log('h2 on', port));
