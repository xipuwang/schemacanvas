import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { hasMessage } from '@/i18n';

/** Every literal key used by the two panels exists in en and zh; dynamic key families are checked with their value sets. */
describe('panel i18n keys', () => {
  const dirs = ['src/ui/panels/properties', 'src/ui/panels/library'];
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => join(d, f)));
  it('literal keys resolve', () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(t|tr|tp)\(\s*'((?:properties|library)\.[A-Za-z0-9_.:-]+)'/g)) {
        // `tp` keys are plural families: the `.other` form must exist in both languages
        const key = m[1] === 'tp' ? `${m[2]}.other` : m[2]!;
        for (const loc of ['en', 'zh'] as const) if (!hasMessage(key, loc)) missing.push(`${file}: ${key} (${loc})`);
      }
      for (const m of text.matchAll(/(?:labelKey|descKey|titleKey|key): '((?:properties|library)\.[A-Za-z0-9_.:-]+)'/g)) {
        for (const loc of ['en', 'zh'] as const) if (!hasMessage(m[1]!, loc)) missing.push(`${file}: ${m[1]} (${loc})`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('dynamic key families resolve', () => {
    const families: Record<string, string[]> = {
      'properties.attrs.add.': ['simple', 'key', 'partial-key', 'multivalued', 'derived', 'composite'],
      'properties.count.': ['entities', 'relationships', 'attributes', 'tables', 'columns', 'foreignKeys'],
      'properties.dialect.': ['generic', 'postgresql', 'sqlite', 'mysql'],
      'properties.fk.key.': ['primary', 'unique', 'index', 'none'],
      'properties.fk.max.': ['one', 'many'],
      'properties.multi.group.': ['align', 'distribute', 'size', 'order'],
      'properties.rel.effect.': ['one', 'many', 'oneNary', 'manyNary', 'total'],
      'properties.rel.shape.': ['binary-1:1', 'binary-1:N', 'binary-M:N', 'n-ary'],
      'properties.route.': ['source', 'target'],
      'properties.route.side.': ['auto', 'top', 'right', 'bottom', 'left'],
      'properties.diagram.type.': ['chen', 'relational', 'crowsFoot', 'physical'],
    };
    const missing: string[] = [];
    for (const [prefix, values] of Object.entries(families))
      for (const v of values) for (const loc of ['en', 'zh'] as const) if (!hasMessage(prefix + v, loc)) missing.push(`${prefix}${v} (${loc})`);
    expect(missing).toEqual([]);
  });
});
