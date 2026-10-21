#!/usr/bin/env node
// Bundle breakdown: builds with source maps into .tmp/bundle-analysis and prints per-chunk raw/gzip sizes and the
// biggest source groups of every JS chunk (by source-map mappings, bytes of generated code attributed per source).
// Usage: node scripts/bundle-size.mjs [--no-build]
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const out = '.tmp/bundle-analysis';
if (!process.argv.includes('--no-build')) {
  execSync(`npx vite build --outDir ${out} --emptyOutDir --sourcemap`, { stdio: 'ignore', env: { ...process.env, SC_ANALYZE: '1' } });
}
const dir = join(out, 'assets');
const VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function attribute(code, map) {
  const sizes = new Map();
  const lines = code.split('\n');
  let src = 0;
  const segs = map.mappings.split(';');
  for (let li = 0; li < segs.length; li++) {
    const line = lines[li] ?? '';
    let col = 0;
    const marks = [];
    for (const seg of segs[li].split(',')) {
      if (!seg) continue;
      const v = [];
      let shift = 0, val = 0;
      for (const ch of seg) {
        const d = VLQ.indexOf(ch);
        val += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { v.push(val & 1 ? -(val >> 1) : val >> 1); val = 0; shift = 0; }
      }
      col += v[0];
      if (v.length > 1) { src += v[1]; marks.push([col, src]); } else marks.push([col, -1]);
    }
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1][0] : line.length + 1;
      const name = marks[i][1] < 0 ? '(generated)' : map.sources[marks[i][1]];
      sizes.set(name, (sizes.get(name) ?? 0) + (end - marks[i][0]));
    }
  }
  return sizes;
}
const group = (p) => {
  const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1];
  const s = p.replace(/^(\.\.\/)+/, '').match(/^src\/([^/]+)(?:\/([^/]+))?/);
  return s ? (s[1] === 'ui' && s[2] ? `src/ui/${s[2]}` : `src/${s[1]}`) : p;
};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const code = readFileSync(join(dir, f), 'utf8');
  const gz = gzipSync(code).length;
  console.log(`\n${f}  ${(statSync(join(dir, f)).size / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
  let map;
  try { map = JSON.parse(readFileSync(join(dir, f + '.map'), 'utf8')); } catch { continue; }
  const groups = new Map();
  for (const [p, n] of attribute(code, map)) groups.set(group(p), (groups.get(group(p)) ?? 0) + n);
  const total = [...groups.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [g, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`   ${((n / total) * 100).toFixed(1).padStart(5)}%  ${(n / 1024).toFixed(0).padStart(5)} KB  ${g}`);
}

// ---- initial load: the static-import closure of the entry chunk(s) named by index.html (what the empty app downloads)
{
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const entry = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g)].map((m) => m[1].replace('assets/', ''));
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const code = readFileSync(join(dir, f), 'utf8');
    // static imports only: `import ... from "./x.js"` / `import "./x.js"` / `export ... from "./x.js"` (not import("..."))
    for (const m of code.matchAll(/(?:^|[;}\n])\s*(?:import|export)\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) visit(m[1]);
  };
  entry.forEach(visit);
  let raw = 0, gz = 0;
  console.log('\nINITIAL JS (static closure of index.html):');
  for (const f of [...seen].sort()) {
    const code = readFileSync(join(dir, f));
    raw += code.length; gz += gzipSync(code).length;
    console.log(`   ${f}  ${(code.length / 1024).toFixed(1)} KB, ${(gzipSync(code).length / 1024).toFixed(1)} KB gzip`);
  }
  console.log(`   TOTAL ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
}
