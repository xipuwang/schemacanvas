#!/usr/bin/env node
// Minimal static file server used to prove the production build works from ANY path.
//   node scripts/serve-static.mjs <dir> <port> [urlPrefix]      e.g. node scripts/serve-static.mjs dist 5223 /schemacanvas/
// Everything outside <urlPrefix> is a 404 (so a build with the wrong base fails loudly). Like GitHub Pages, <prefix> without the
// trailing slash redirects to it, and a miss inside the prefix returns the build's 404.html with status 404. Zero dependencies.
// GitHub Pages project site emulation: node scripts/serve-static.mjs dist 4173 /schemacanvas/
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const [dirArg = 'dist', portArg = '4173', prefixArg = '/'] = process.argv.slice(2);
const root = resolve(dirArg);
const prefix = prefixArg.endsWith('/') ? prefixArg : `${prefixArg}/`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === prefix.slice(0, -1) && prefix !== '/') {
    res.writeHead(301, { location: prefix }).end();
    return;
  }
  if (!p.startsWith(prefix)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 (outside ${prefix})`);
    return;
  }
  p = p.slice(prefix.length);
  let file = normalize(join(root, p));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    // like GitHub Pages: a miss inside the site gets the site's own 404.html (status 404) when there is one
    const page = join(root, '404.html');
    if (existsSync(page)) createReadStream(page).pipe(res.writeHead(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }));
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(Number(portArg), '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${portArg}${prefix}`));
