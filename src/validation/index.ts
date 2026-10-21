/**
 * Database-aware validation (product specification §4). Pure: never mutates the project, tolerates every SOFT state of
 * model/invariants.ts without throwing.
 *
 *   validateProject(project, { modelId?, severities? })  -> Issue[]   (all models, or one)
 *   validateModel(model, project)                        -> Issue[]
 *   RULES                                                -> rule registry (docs / UI rule list)
 */
import { refResolves } from '@/model/diagramSync';
import { makeIssue } from '@/model/issues';
import { refKey } from '@/model/queries';
import type { Id, Issue, Model, Project, Severity } from '@/model/types';
import { ER_RULES, resetErCaches } from './erRules';
import { REL_RULES } from './relRules';
import type { IssueDraft, Rule } from './types';

export type { IssueDraft, Rule, ErRule, RelRule, RuleContext } from './types';
export { summarizeIssues, groupByAffected, issuesForRef, worstSeverity } from './summary';
export type { IssueSummary } from './summary';

/** Every rule, ER first then relational, each group in the order they run. Codes are unique. */
export const RULES: readonly Rule[] = [...ER_RULES, ...REL_RULES];

export interface ValidateOptions {
  /** Validate only this model (unknown id => no issues). */
  modelId?: Id;
  /** Keep only these severities. */
  severities?: Severity[];
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const affectedKey = (i: Issue): string => i.affected.map(refKey).join(',');

/** error > warning > info, then model id, code, affected refs, id — independent of object key order. */
export function compareIssues(a: Issue, b: Issue): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    cmp(a.modelId, b.modelId) ||
    cmp(a.code, b.code) ||
    cmp(affectedKey(a), affectedKey(b)) ||
    cmp(a.id, b.id)
  );
}

function toIssue(rule: Rule, model: Model, draft: IssueDraft): Issue {
  // Refs that do not resolve would make click-to-highlight a silent no-op; drop them.
  const affected = draft.affected.filter((ref) => refResolves(model, ref));
  return makeIssue({
    code: rule.code,
    severity: rule.severity,
    title: draft.title,
    explanation: draft.explanation,
    suggestion: draft.suggestion,
    affected,
    modelId: model.id,
    ...(draft.params ? { params: draft.params } : {}),
  });
}

/** Issues of one model, sorted. `project` provides cross-model context (e.g. ER origins of generated FKs). */
export function validateModel(model: Readonly<Model>, project: Readonly<Project>): Issue[] {
  const ctx = { project };
  resetErCaches();
  const built: Issue[] = [];
  for (const rule of RULES) {
    if (rule.appliesTo !== model.kind) continue;
    // `appliesTo` was matched against `model.kind` just above, so the model type is right for this rule.
    const check = rule.check as (m: Readonly<Model>, c: typeof ctx) => IssueDraft[];
    for (const d of check(model, ctx)) built.push(toIssue(rule, model as Model, d));
  }
  // Same code + same affected set => same id: keep the first so UI keys stay unique.
  const seen = new Set<string>();
  return built.filter((i) => !seen.has(i.id) && !!seen.add(i.id)).sort(compareIssues);
}

export function validateProject(project: Readonly<Project>, opts: ValidateOptions = {}): Issue[] {
  const models = Object.values(project.models).filter((m) => opts.modelId === undefined || m.id === opts.modelId);
  const issues = models.flatMap((m) => validateModel(m, project));
  const wanted = opts.severities;
  return (wanted ? issues.filter((i) => wanted.includes(i.severity)) : issues).sort(compareIssues);
}
