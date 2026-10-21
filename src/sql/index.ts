/** SQL / DBML interop barrel. Identifier quoting and dialect type mapping stay private to this directory. */
export { generateDdl, ddlIssues } from './ddl';
export { duplicatedByRules, dropDuplicatedDdlIssues } from './duplicates';
export { parseDdl, parseDdlSafe } from './ddlParser';
export { exportDbml, exportDbmlDetailed } from './dbmlExport';
export type { DbmlExport } from './dbmlExport';
export { importDbml } from './dbmlImport';
export { SqlParseError } from './types';
export type { DdlOptions, DdlResult, ImportOptions, ImportResult } from './types';
