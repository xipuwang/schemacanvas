import { makeIssue } from '@/model/issues';
import type { Id, Issue, SemanticRef } from '@/model/types';

/** Position of a token in the source text (1-based). */
export interface SourcePos {
  line: number;
  col: number;
}

/**
 * Import warning shared by the DDL and DBML importers: code `<ns>.<code>`, position in `params`, and an id made unique
 * per position so several warnings of one code never collide as React keys.
 */
export function importWarning(
  ns: 'sql.import' | 'dbml.import',
  modelId: Id,
  code: string,
  title: string,
  explanation: string,
  at: SourcePos,
  construct: string,
  affected: SemanticRef[] = [],
  /** Values behind the English text, for translation (src/i18n/issues.ts); `line`, `column`, `construct` are always present. */
  extra: Record<string, string | number> = {},
): Issue {
  const issue = makeIssue({
    code: `${ns}.${code}`,
    severity: 'warning',
    title,
    explanation: `${explanation} (line ${at.line}, column ${at.col})`,
    suggestion: 'Review the imported schema; remove or rewrite the construct if it matters.',
    affected,
    modelId,
    params: { ...extra, line: at.line, column: at.col, construct },
  });
  return { ...issue, id: `${issue.id}@${at.line}:${at.col}` };
}
