/**
 * Structural DDL issues that merely restate a model rule of `src/validation` (`rel.*`). The Validate command shows ONE
 * entry per problem: it drops a `ddl.<dialect>.*` issue listed here when the equivalent `rel.*` issue concerning the same
 * objects is present. `generateDdl` / `ddlIssues` themselves keep emitting these (the SQL export still refuses on them).
 * Dialect-specific issues (identifier length, MySQL restrictions, ...) are deliberately NOT listed.
 */
import type { Issue, SemanticRef } from '@/model/types';
import { refKey } from '@/model/queries';

const DUPLICATES: Record<string, readonly string[]> = {
  'empty-name.relation': ['rel.relation-name-empty'],
  'empty-name.column': ['rel.column-name-empty'],
  'duplicate-name.table': ['rel.relation-name-duplicate'],
  'duplicate-name.table.sqlite': ['rel.relation-name-duplicate'],
  'duplicate-name.column': ['rel.column-name-duplicate'],
  'fk-missing-relation': ['rel.fk-relation-missing'],
  'fk-no-columns': ['rel.fk-no-columns'],
  'fk-missing-column': ['rel.fk-column-missing', 'rel.fk-column-wrong-relation'],
  'fk-target-not-key': ['rel.fk-target-not-key'],
  'missing-column': ['rel.key-column-missing'],
};

const DDL = /^ddl\.[a-z]+\.(.+)$/;

/** The `rel.*` rule codes that report the same problem as this DDL issue (empty when it is dialect-specific). */
export function duplicatedByRules(issue: Pick<Issue, 'code' | 'params'>): readonly string[] {
  const m = DDL.exec(issue.code);
  if (!m) return [];
  const variant = issue.params?.['variant'];
  const keyed = typeof variant === 'string' ? `${m[1]}.${variant}` : m[1]!;
  return DUPLICATES[keyed] ?? [];
}

/** `ddl` without the issues already reported by an equivalent `rel.*` issue of `modelIssues` (same affected objects). */
export function dropDuplicatedDdlIssues(modelIssues: readonly Issue[], ddl: readonly Issue[]): Issue[] {
  const byCode = new Map<string, Set<string>[]>();
  for (const i of modelIssues) {
    if (!i.code.startsWith('rel.')) continue;
    const list = byCode.get(i.code) ?? [];
    list.push(new Set(i.affected.map((r: SemanticRef) => refKey(r))));
    byCode.set(i.code, list);
  }
  return ddl.filter((d) => {
    const rules = duplicatedByRules(d);
    if (rules.length === 0) return true;
    const mine = d.affected.map((r) => refKey(r));
    return !rules.some((code) => (byCode.get(code) ?? []).some((set) => mine.every((k) => set.has(k))));
  });
}
