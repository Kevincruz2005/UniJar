// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export function createSiteServer({ directory = 'dist', version = 'development', apiUrl = '' } = {}) {
  const root = resolve(directory);
  const compressed = new Map();
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
  const apiOrigin = apiUrl ? new URL(apiUrl).origin : '';
  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${apiOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', version, chainId: 11155111 })); return; }
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(400); res.end(); return; }
    if (pathname === '/' || (!extname(pathname) && !existsSync(file))) file = resolve(root, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const type = contentTypes[extname(file)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && ['.js', '.css', '.html'].includes(extname(file))) {
      if (!compressed.has(file)) compressed.set(file, gzipSync(readFileSync(file)));
      const body = compressed.get(file); res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', body.length); res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    res.setHeader('Content-Length', statSync(file).size);
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createSiteServer({ version: process.env.SOURCE_COMMIT, apiUrl: process.env.API_URL });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
