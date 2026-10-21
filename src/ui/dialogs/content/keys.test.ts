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

const DYNAMIC: Record<string, string[]> = {
  'dialogs.export.kind.': ['svg', 'png', 'pdf', 'json', 'sql', 'dbml'],
  'dialogs.export.kindDesc.': ['svg', 'png', 'pdf', 'json', 'sql', 'dbml'],
  'dialogs.import.hint.': ['sql', 'dbml', 'project'],
  'dialogs.import.text.': ['sql', 'dbml', 'project'],
  'dialogs.convert.strategy.': ['auto', 'merge', 'relation'],
  'dialogs.convert.strategyDesc.': ['auto', 'merge', 'relation'],
  'dialogs.convert.level.': ['info', 'warning'],
  'dialogs.convert.kind.': ['entity', 'attribute', 'relationship', 'participant', 'relation', 'column', 'unique', 'index', 'foreignKey'],
  'dialogs.examples.view.': ['er', 'relational'],
  'issuesPanel.severity.': ['error', 'warning', 'info'],
};

describe('i18n keys used by the issues panel and the content dialogs exist in en and zh', () => {
  it('every literal key resolves, plural keys have both forms, dynamic families are complete', () => {
    const missing: string[] = [];
    for (const file of [...walk('src/ui/panels/issues'), ...walk('src/ui/dialogs/content')]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(t|tp)\(\s*'([a-zA-Z]+\.[A-Za-z0-9_.-]+)'/g)) {
        const keys = m[1] === 'tp' ? [`${m[2]}.one`, `${m[2]}.other`] : [m[2]!];
        for (const k of keys) for (const loc of ['en', 'zh'] as const) if (!hasMessage(k, loc)) missing.push(`${file}: ${k} (${loc})`);
      }
    }
    for (const [prefix, ids] of Object.entries(DYNAMIC)) for (const id of ids) for (const loc of ['en', 'zh'] as const) if (!hasMessage(prefix + id, loc)) missing.push(`${prefix}${id} (${loc})`);
    expect(missing).toEqual([]);
  });
});
