#!/usr/bin/env node
// Release gate for the folder you are about to publish (default dist/): fails on anything that must not ship and prints
// what a deployer needs (file count/size, the CSP hash of the inline theme script). Zero dependencies.
//   npm run build && node scripts/check-dist.mjs [dir]
// The expected base path is SC_BASE (default /schemacanvas/, the GitHub Pages project site), as in vite.config.ts.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const base = process.env.SC_BASE ?? '/schemacanvas/';
const problems = [];
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`${dir}/index.html not found; run npm run build first`);
  process.exit(1);
}
walk(dir);

const ALLOWED = /\.(html|js|css|woff2|txt|svg|png|ico)$/;
const FORBIDDEN_TEXT = [
  [/sourceMappingURL=/, 'source map reference'],
  [/\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users\\\\/, 'absolute local path'],
  [/\b(localhost|127\.0\.0\.1):\d+/, 'localhost URL'],
  [/fake-indexeddb|@testing-library|axe-core|@playwright|jsdom/, 'dev-only package'],
  [/sk-ant-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}/, 'secret-like token'],
];
let bytes = 0;
for (const f of files) {
  const rel = relative(dir, f);
  bytes += statSync(f).size;
  if (f.endsWith('.map')) problems.push(`${rel}: source map file`);
  else if (!ALLOWED.test(f)) problems.push(`${rel}: unexpected file type`);
  if (/\.(html|js|css|txt|svg)$/.test(f)) {
    const text = readFileSync(f, 'utf8');
    for (const [re, what] of FORBIDDEN_TEXT) if (re.test(text)) problems.push(`${rel}: ${what} (${text.match(re)[0].slice(0, 40)})`);
  }
}
if (!existsSync(join(dir, 'THIRD-PARTY-NOTICES.txt'))) problems.push('THIRD-PARTY-NOTICES.txt missing (run npm run notices, then build)');

const html = readFileSync(join(dir, 'index.html'), 'utf8');
// every asset URL sits under the base path (relative './' builds are also accepted when SC_BASE is './')
for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const url = m[1];
  if (/^(data:|https?:|mailto:)/.test(url)) continue;
  if (base === './' ? url.startsWith('/') : !url.startsWith(base)) problems.push(`index.html: asset URL ${url} is not under the base ${base}`);
}
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);

// Content-Security-Policy as <meta> (GitHub Pages cannot send headers): present, before every script, pinning exactly the inline
// scripts, strict defaults, and none of the directives a meta CSP must not carry (browsers ignore them with a console error)
const cspTag = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
if (!cspTag) problems.push('index.html: no <meta http-equiv="Content-Security-Policy">');
else {
  const csp = cspTag[1];
  if (html.indexOf(cspTag[0]) > html.indexOf('<script')) problems.push('index.html: the CSP meta tag must precede every script');
  const pinned = [...csp.matchAll(/'sha256-[A-Za-z0-9+/=]+'/g)].map((m) => m[0]).sort();
  if (pinned.join(' ') !== [...hashes].sort().join(' ')) problems.push(`index.html: CSP pins ${pinned.join(' ') || '(none)'} but the inline scripts hash to ${hashes.join(' ') || '(none)'}`);
  for (const d of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) if (!csp.includes(d)) problems.push(`index.html: CSP lacks ${d}`);
  if (/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp)) problems.push('index.html: CSP allows unsafe-eval or inline scripts');
  if (/frame-ancestors|report-uri|sandbox/.test(csp)) problems.push('index.html: frame-ancestors / report-uri / sandbox are not allowed in a meta CSP');
}
if (!html.includes('<meta name="referrer" content="no-referrer"')) problems.push('index.html: no referrer policy meta tag');
// 404 page for the static host: present and linking back to the app under the base path
if (!existsSync(join(dir, '404.html'))) problems.push('404.html missing');
else if (base !== './' && !readFileSync(join(dir, '404.html'), 'utf8').includes(`href="${base}"`)) problems.push(`404.html: does not link to ${base}`);
// host-specific configuration that GitHub Pages would serve as a public file
for (const f of ['_headers', '_redirects', 'wrangler.toml']) if (existsSync(join(dir, f))) problems.push(`${f}: host configuration file in the published output`);

console.log(`${dir}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`CSP script-src hash of the inline theme script: ${hashes.join(' ') || '(no inline script)'}`);
if (problems.length) {
  console.error(`\nNOT publishable, ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK: base ${base}; meta CSP pins the inline script; no source maps, local paths, localhost URLs, dev-only packages or secret-like tokens; notices and 404 page present.`);
