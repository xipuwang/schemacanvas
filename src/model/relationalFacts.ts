/**
 * Relational facts shared by validation, SQL, conversion and the horizontal-schema notation, so
 * "is this FK target a key?" and "are these types compatible?" have exactly one answer.
 * Dialect-specific checks live in src/sql (`ddlIssues`) — nothing here knows about dialects.
 */
import { isCandidateKey, ownGet } from './queries';
import type { ForeignKey, ForeignKeyColumnPair, Id, Relation } from './types';

// ----- FK target key ---------------------------------------------------------

export type FkTargetKey = { kind: 'primary' } | { kind: 'unique'; uniqueId: Id } | { kind: 'index'; indexId: Id } | { kind: 'none' };

const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Which key of `target` the FK's referenced columns form — ORDER-INSENSITIVE set match (an FK listing
 * (TradeName, CompanyName) against PK (CompanyName, TradeName) is valid). `none` ⇒ incomplete/non-key reference.
 */
export function fkTargetKey(target: Relation, fk: ForeignKey): FkTargetKey {
  const ids = fk.columns.map((c) => c.targetColumnId);
  if (ids.length === 0) return { kind: 'none' };
  if (target.primaryKey.length > 0 && sameSet(target.primaryKey, ids)) return { kind: 'primary' };
  const u = target.uniques.find((x) => sameSet(x.columnIds, ids));
  if (u) return { kind: 'unique', uniqueId: u.id };
  const i = target.indexes.find((x) => x.unique && !x.where && sameSet(x.columnIds, ids));
  if (i) return { kind: 'index', indexId: i.id };
  return { kind: 'none' };
}

/** Same as `fkTargetKey(...).kind !== 'none'`, kept for readability at call sites. */
export const fkReferencesKey = (target: Relation, fk: ForeignKey): boolean =>
  isCandidateKey(target, fk.columns.map((c) => c.targetColumnId));

/**
 * Pairs reordered so the TARGET columns follow the key's own column order (what DDL needs:
 * `REFERENCES Drug(CompanyName, TradeName)`). Unchanged when the target is not a key.
 */
export function fkPairsInKeyOrder(target: Relation, fk: ForeignKey): ForeignKeyColumnPair[] {
  const key = fkTargetKey(target, fk);
  let order: Id[] | undefined;
  if (key.kind === 'primary') order = target.primaryKey;
  else if (key.kind === 'unique') order = target.uniques.find((u) => u.id === key.uniqueId)?.columnIds;
  else if (key.kind === 'index') order = target.indexes.find((i) => i.id === key.indexId)?.columnIds;
  if (!order) return [...fk.columns];
  return [...fk.columns].sort((a, b) => order!.indexOf(a.targetColumnId) - order!.indexOf(b.targetColumnId));
}

// ----- data types ------------------------------------------------------------

export interface ParsedDataType {
  /** Canonical upper-case base, e.g. INTEGER, VARCHAR, NUMERIC, TIMESTAMP. */
  base: string;
  args: number[];
  raw: string;
}

/** Aliases → canonical base. Identity pseudo-types (SERIAL …) are intentionally NOT mapped (see RelColumn.dataType). */
const ALIASES: Record<string, string> = {
  INT: 'INTEGER',
  INT4: 'INTEGER',
  INTEGER: 'INTEGER',
  MEDIUMINT: 'INTEGER',
  INT2: 'SMALLINT',
  SMALLINT: 'SMALLINT',
  TINYINT: 'SMALLINT',
  INT8: 'BIGINT',
  BIGINT: 'BIGINT',
  FLOAT4: 'REAL',
  REAL: 'REAL',
  FLOAT8: 'DOUBLE',
  DOUBLE: 'DOUBLE',
  'DOUBLE PRECISION': 'DOUBLE',
  FLOAT: 'DOUBLE',
  DECIMAL: 'NUMERIC',
  NUMERIC: 'NUMERIC',
  CHARACTER: 'CHAR',
  CHAR: 'CHAR',
  BPCHAR: 'CHAR',
  'CHARACTER VARYING': 'VARCHAR',
  VARCHAR: 'VARCHAR',
  TEXT: 'TEXT',
  CLOB: 'TEXT',
  STRING: 'TEXT',
  BOOL: 'BOOLEAN',
  BOOLEAN: 'BOOLEAN',
  DATE: 'DATE',
  TIME: 'TIME',
  DATETIME: 'TIMESTAMP',
  TIMESTAMP: 'TIMESTAMP',
  TIMESTAMPTZ: 'TIMESTAMP',
  UUID: 'UUID',
  BLOB: 'BLOB',
  BYTEA: 'BLOB',
  JSON: 'JSON',
  JSONB: 'JSON',
};

const FAMILY: Record<string, string> = {
  INTEGER: 'int',
  SMALLINT: 'int',
  BIGINT: 'int',
  REAL: 'num',
  DOUBLE: 'num',
  NUMERIC: 'num',
  CHAR: 'text',
  VARCHAR: 'text',
  TEXT: 'text',
  BOOLEAN: 'bool',
  DATE: 'time',
  TIME: 'time',
  TIMESTAMP: 'time',
  UUID: 'uuid',
  BLOB: 'blob',
  JSON: 'json',
};

export function parseDataType(raw: string | undefined): ParsedDataType | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  const m = /^([A-Za-z_][A-Za-z_ ]*?)\s*(?:\(\s*([\d\s,]*)\))?\s*(?:UNSIGNED|SIGNED|WITH(?:OUT)? TIME ZONE)?\s*$/i.exec(text);
  const name = (m ? m[1]! : text).trim().replace(/\s+/g, ' ').toUpperCase();
  const args = m?.[2] ? m[2].split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)) : [];
  return { base: ownGet(ALIASES, name) ?? name, args, raw: text };
}

/**
 * `same`: identical canonical base and arguments. `compatible`: same type family (INTEGER vs BIGINT, VARCHAR(50) vs
 * VARCHAR(100), CHAR vs TEXT). `mismatch`: different families. `unknown`: either side missing/unparseable —
 * validation must not flag `unknown`.
 */
export function dataTypesCompatible(a?: string, b?: string): 'same' | 'compatible' | 'mismatch' | 'unknown' {
  const pa = parseDataType(a);
  const pb = parseDataType(b);
  if (!pa || !pb) return 'unknown';
  if (pa.base === pb.base && pa.args.join(',') === pb.args.join(',')) return 'same';
  const fa = ownGet(FAMILY, pa.base);
  const fb = ownGet(FAMILY, pb.base);
  if (!fa || !fb) return pa.base === pb.base ? 'compatible' : 'unknown';
  return fa === fb ? 'compatible' : 'mismatch';
}
