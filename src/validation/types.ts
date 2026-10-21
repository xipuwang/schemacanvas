/**
 * Validation rule contract. A rule returns `IssueDraft`s; the engine (index.ts) is the ONLY place that turns a
 * draft into an `Issue` (via `makeIssue`), stamping code, severity and modelId from the rule so a rule can never
 * emit a code/severity other than the one it documents in `RULES`.
 */
import type { ErModel, Project, RelationalModel, SemanticRef, Severity } from '@/model/types';

export interface IssueDraft {
  title: string;
  explanation: string;
  suggestion: string;
  /** Click-to-highlight targets; refs that do not resolve in the model are dropped by the engine. */
  affected: SemanticRef[];
  params?: Record<string, string | number>;
}

export interface RuleContext {
  project: Readonly<Project>;
}

interface RuleBase {
  /** Stable machine code (`er.*` / `rel.*`); i18n key `issues.<code>.*`. One code per rule. */
  code: string;
  severity: Severity;
  /** One-sentence description for docs / the rule list in the UI. */
  description: string;
}

export interface ErRule extends RuleBase {
  appliesTo: 'er';
  check(model: Readonly<ErModel>, ctx: RuleContext): IssueDraft[];
}

export interface RelRule extends RuleBase {
  appliesTo: 'relational';
  check(model: Readonly<RelationalModel>, ctx: RuleContext): IssueDraft[];
}

export type Rule = ErRule | RelRule;
