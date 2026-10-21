import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { hasMessage } from '@/i18n';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe('i18n keys referenced by the shell and components exist in both locales', () => {
  it('every literal key passed to t()/tr()/tp()/labelKey resolves', () => {
    const missing: string[] = [];
    for (const file of [...walk('src/ui/shell'), ...walk('src/ui/components')]) {
      const text = readFileSync(file, 'utf8');
      const re = /\b(?:t|tr|tp)\(\s*'([a-z]+\.[A-Za-z0-9_.-]+)'|labelKey: '([a-zA-Z.]+)'|fallback="([A-Za-z.]+)"/g;
      for (const m of text.matchAll(re)) {
        const key = m[1] ?? m[2] ?? m[3]!;
        const full = m[3] ? key : key;
        const keys = full.endsWith('.selected') || /\.(items|selected)$/.test(full) ? [`${full}.other`] : [full];
        for (const k of keys) for (const loc of ['en', 'zh'] as const) if (!hasMessage(k, loc)) missing.push(`${file}: ${k} (${loc})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
