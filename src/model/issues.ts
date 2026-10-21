import { refKey } from './queries';
import type { Issue, SemanticRef } from './types';

/** Deterministic issue id: same problem ⇒ same id across runs (stable React keys, dismissals, diffs). */
export function issueId(code: string, affected: SemanticRef[]): string {
  return `${code}|${affected.map(refKey).sort().join(',')}`;
}

/** Build an Issue, deriving `id` from `code` + `affected`. */
export function makeIssue(init: Omit<Issue, 'id'>): Issue {
  return { ...init, id: issueId(init.code, init.affected) };
}
