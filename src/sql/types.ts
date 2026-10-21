import type { Issue, RelationalModel } from '@/model/types';

/** Options of `generateDdl`. Every default keeps the output deterministic. */
export interface DdlOptions {
  /** Emit `IF NOT EXISTS` on CREATE TABLE / INDEX / SCHEMA. Default false. */
  ifNotExists?: boolean;
  /** Leading `-- ...` comment block. Default true. */
  header?: boolean;
  /** Quote every identifier instead of only the ones that need it. Default false. */
  quoteAll?: boolean;
}

export interface DdlResult {
  /** Empty string when `issues` contains an error (see README "Refusal policy"). */
  sql: string;
  issues: Issue[];
}

export interface ImportResult {
  model: RelationalModel;
  warnings: Issue[];
}

export interface ImportOptions {
  /** Name of the created model. */
  name?: string;
}

/**
 * Thrown by every importer for syntax it cannot represent faithfully. `line`/`column` are 1-based and point
 * at the offending token; `construct` names the unsupported construct when that is the problem.
 */
export class SqlParseError extends Error {
  override readonly name = 'SqlParseError';
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
    readonly construct?: string,
  ) {
    super(`${message} (line ${line}, column ${column})`);
  }
}
