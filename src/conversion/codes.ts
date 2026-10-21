/**
 * Closed lists of everything the converter emits that the UI shows: warning codes (`Issue.code`) and decision kinds
 * (`ConversionDecision.params.kind`, default = `ruleId`). `context.ts` types `warn()` / `decide()` with these, so an emitted
 * code that is missing here does not compile; `src/i18n/messages.test.ts` fails when a listed code has no en + zh text.
 * Catalogue keys: `issues.<code>.*` and `decisions.<kind>.*` (src/i18n/issues.ts).
 */

/** Warnings written by `src/conversion` (`record.warnings`). */
export const CONV_WARNING_CODES = [
  'conv.multivalued-optional-leaf',
  'conv.weak-ownership-cycle',
  'conv.total-on-one-side-unenforceable',
  'conv.one-to-one-merge-lossy',
  'conv.relationship-key-fallback',
  'conv.total-participation-unenforceable',
  'conv.fk-participant-invalid',
  'conv.one-to-one-merge-ineligible',
  'conv.identifying-unresolved',
  'conv.relationship-key-attr-folded',
  'conv.one-to-one-ambiguous-placement',
  'conv.one-to-one-both-total',
] as const;
export type ConvWarningCode = (typeof CONV_WARNING_CODES)[number];

/** Warnings appended by `ops.applyConversionResult` when a conversion REPLACES a model (src/model/ops/conversion.ts). */
export const CONV_OPS_CODES = ['conv.hand-added-kept', 'conv.hand-added-dropped', 'conv.hand-added-renamed', 'conv.edits-overwritten'] as const;
export type ConvOpsCode = (typeof CONV_OPS_CODES)[number];

/** Decision kinds: `<ruleId>` for the main decision of a rule, `<ruleId>.<variant>` or a rule-independent name otherwise. */
export const DECISION_KINDS = [
  'relation-renamed',
  'column-renamed',
  'unmapped.entity',
  'unmapped.attribute',
  'unmapped.relationship',
  'unmapped.participant',
  'derived-omitted',
  'derived-omitted.nosource',
  'derived-omitted.multivalued',
  'derived-materialized',
  'composite-flatten',
  'composite-flatten.collision',
  'multivalued-relation',
  'multivalued-relation.nokey',
  'strong-entity.nokey',
  'weak-entity',
  'weak-entity.noowner',
  'weak-entity.cycle',
  'weak-entity-owner-key',
  'weak-entity-owner-key.nokey',
  'weak-entity-owner-key.unavailable',
  'one-to-one-merge',
  'associative-entity',
  'associative-entity.invalid',
  'participant-no-fk.nokey',
  'participant-no-fk.unavailable',
  'relationship-no-key',
  'relationship-omitted.fewer',
  'relationship-omitted.missing-entity',
  'relationship-omitted.strategy',
  'relationship-omitted.weak-no-relation',
  'relationship-omitted.circular',
  'relationship-omitted.nokey',
  'relationship-omitted.merged-unavailable',
  'relationship-attribute',
  'fk-n-side',
  'fk-one-to-one',
  'relationship-table',
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
