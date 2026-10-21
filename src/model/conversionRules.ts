/**
 * Closed vocabulary of conversion rule ids. `Origin.ruleId`, `ConversionTraceEntry.ruleId` and
 * `ConversionDecision.ruleId` MUST be one of these (tests and i18n key on them).
 */
export const CONVERSION_RULE_IDS = [
  'strong-entity',
  'composite-flatten',
  'multivalued-relation',
  'derived-omitted',
  'derived-materialized',
  'weak-entity',
  'weak-entity-owner-key',
  'one-to-many-fk',
  'one-to-one-fk',
  'one-to-one-merge',
  'one-to-one-relation',
  'many-to-many-relation',
  'n-ary-relation',
  'recursive-one-to-many-fk',
  'recursive-many-to-many-relation',
  'relationship-attribute',
  'associative-entity',
] as const;

export type ConversionRuleId = (typeof CONVERSION_RULE_IDS)[number];

export const isConversionRuleId = (s: string): s is ConversionRuleId => (CONVERSION_RULE_IDS as readonly string[]).includes(s);
