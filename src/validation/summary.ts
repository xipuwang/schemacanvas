import { refKey } from '@/model/queries';
import type { Issue, SemanticRef, Severity } from '@/model/types';

export interface IssueSummary {
  error: number;
  warning: number;
  info: number;
  total: number;
}

export function summarizeIssues(issues: readonly Issue[]): IssueSummary {
  const out: IssueSummary = { error: 0, warning: 0, info: 0, total: 0 };
  for (const i of issues) {
    out[i.severity]++;
    out.total++;
  }
  return out;
}

export function worstSeverity(issues: readonly Issue[]): Severity | undefined {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.some((i) => i.severity === 'warning')) return 'warning';
  return issues.length > 0 ? 'info' : undefined;
}

/**
 * Issues keyed by `refKey(ref)` of every affected ref (an issue appears under each of its refs), for node/cell badges.
 * `rollUp` additionally files column/unique/index refs under their relation and participant refs under their
 * relationship, so a node badge can show everything that concerns its cells or lines.
 */
export function groupByAffected(issues: readonly Issue[], opts: { rollUp?: boolean } = {}): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const issue of issues) {
    const keys = new Set<string>();
    for (const ref of issue.affected) {
      keys.add(refKey(ref));
      if (opts.rollUp) {
        if (ref.kind === 'column' || ref.kind === 'unique' || ref.kind === 'index') keys.add(`relation:${ref.relationId}`);
        else if (ref.kind === 'participant') keys.add(`relationship:${ref.relationshipId}`);
      }
    }
    for (const k of keys) (out[k] ??= []).push(issue);
  }
  return out;
}

/** Issues that name exactly this ref (no roll-up). */
export function issuesForRef(issues: readonly Issue[], ref: SemanticRef): Issue[] {
  const key = refKey(ref);
  return issues.filter((i) => i.affected.some((r) => refKey(r) === key));
}
