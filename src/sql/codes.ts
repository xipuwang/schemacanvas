/**
 * Closed lists of the issue codes the SQL / DBML modules emit. The emitters are typed with these (an unlisted code does not
 * compile) and `src/i18n/messages.test.ts` requires an en + zh catalogue entry for every one (keys `issues.<code>.*`).
 * DDL issues are `ddl.<dialect>.<suffix>`: the catalogue stores the suffix once as `issues.ddl.<suffix>` (+ dialect variants).
 */

export const DDL_CODES = [
  'empty-name',
  'duplicate-name',
  'no-columns',
  'empty-check',
  'missing-column',
  'repeated-column',
  'fk-missing-relation',
  'fk-no-columns',
  'fk-missing-column',
  'fk-target-not-key',
  'type-inherited',
  'missing-type',
  'type-passthrough',
  'type-not-portable',
  'varchar-length',
  'identifier-too-long',
  'reserved-word',
  'schema-ignored',
  'identifier-truncation-collision',
  'duplicate-constraint-name',
  'autoincrement-default',
  'autoincrement-type',
  'autoincrement-pk',
  'autoincrement-key',
  'autoincrement-multiple',
  'default-parenthesised',
  'pk-name-ignored',
  'fk-type-mismatch',
  'fk-set-default',
  'fk-set-null-not-null',
  'key-lob-column',
  'key-too-long',
  'duplicate-index-name',
  'partial-index',
  'index-method-ignored',
  'unique-index-method',
  'index-method-hash',
  'unsafe-sql-text',
  'default-unsupported',
  'type-out-of-range',
] as const;
export type DdlCode = (typeof DDL_CODES)[number];
export const DDL_DIALECTS = ['postgresql', 'mysql', 'sqlite', 'generic'] as const;

export const SQL_IMPORT_CODES = [
  'skipped-statement',
  'temporary-table',
  'duplicate-table',
  'skipped-index',
  'mysql-serial',
  'deferrable',
  'collation',
  'charset',
  'on-update',
  'fk-match',
  'key-order',
  'nulls-order',
  'check-not-enforced',
  'index-method',
  'index-comment',
  'index-prefix',
  'table-options',
  'owner',
  'alter-ignored',
  'index-options',
  'fk-target-not-key',
  'skipped-comment',
] as const;
export type SqlImportCode = (typeof SQL_IMPORT_CODES)[number];

export const DBML_IMPORT_CODES = [
  'skipped-block',
  'table-setting',
  'column-setting',
  'expression-index',
  'index-setting',
  'ref-setting',
  'fk-target-not-key',
  'many-to-many',
] as const;
export type DbmlImportCode = (typeof DBML_IMPORT_CODES)[number];

export const DBML_EXPORT_CODES = ['default', 'default-quote', 'type', 'missing-type', 'partial-index', 'index-order', 'check', 'foreign-key', 'fk-label', 'text'] as const;
export type DbmlExportCode = (typeof DBML_EXPORT_CODES)[number];
