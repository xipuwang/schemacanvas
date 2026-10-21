#!/usr/bin/env node
// Release manifest: SHA-256 of every file in the build output plus the inputs that determine it. The Vite build is
// reproducible (same lockfile + Node major -> byte-identical dist/), so a committed manifest proves that an upload is
// exactly the release.
//   node scripts/release-manifest.mjs write  [dir] [out]   (default dist, release/MANIFEST.txt)
//   node scripts/release-manifest.mjs verify [dir] [out]   exits 1 on any difference
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const [mode = 'write', dir = 'dist', out = 'release/MANIFEST.txt'] = process.argv.slice(2);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dir);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lines = files.map((f) => `${sha(readFileSync(f))}  ${String(statSync(f).size).padStart(9)}  ${relative(dir, f).split('\\').join('/')}`);
const total = files.reduce((n, f) => n + statSync(f).size, 0);
const body = [
  `# SchemaCanvas ${pkg.version} release manifest`,
  `# Build: npm ci && npm run release:build (Node ${process.versions.node.split('.')[0]}.x); verify: npm run release:verify`,
  `# package-lock.json sha256: ${sha(readFileSync('package-lock.json'))}`,
  `# files: ${files.length}, bytes: ${total}`,
  `# sha256  size  path`,
  ...lines,
  '',
].join('\n');

if (mode === 'write') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  console.log(`${out}: ${files.length} files, ${total} bytes`);
} else if (mode === 'verify') {
  const want = readFileSync(out, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const got = body.split('\n').filter((l) => l && !l.startsWith('#'));
  const missing = want.filter((l) => !got.includes(l));
  const extra = got.filter((l) => !want.includes(l));
  if (missing.length || extra.length) {
    console.error(`${dir} does NOT match ${out}:`);
    for (const l of missing) console.error(`  expected: ${l}`);
    for (const l of extra) console.error(`  found:    ${l}`);
    process.exit(1);
  }
  console.log(`${dir} matches ${out}: ${got.length} files identical.`);
} else {
  console.error('usage: release-manifest.mjs write|verify [dir] [out]');
  process.exit(2);
}
