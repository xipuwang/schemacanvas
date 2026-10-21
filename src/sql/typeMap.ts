/**
 * Dialect type mapping on top of `parseDataType`. Policy:
 *  - a type word that is natively valid in the target dialect is kept (INT stays INT, JSONB stays JSONB, so an
 *    import -> export round trip does not rewrite the user's spelling);
 *  - another known type is mapped to the dialect's canonical spelling (BYTEA -> BLOB in MySQL, UUID -> CHAR(36) …);
 *  - modifiers (UNSIGNED, WITH TIME ZONE, `[]`) and unknown types are passed through VERBATIM and reported as info.
 */
import { parseDataType } from '@/model/relationalFacts';
import type { SqlDialect } from '@/model/types';

const set = (s: string): ReadonlySet<string> => new Set(s.split(',').map((x) => x.trim()));

const NATIVE: Record<SqlDialect, ReadonlySet<string>> = {
  generic: set(
    'INTEGER,INT,SMALLINT,BIGINT,REAL,DOUBLE PRECISION,NUMERIC,DECIMAL,CHAR,CHARACTER,VARCHAR,CHARACTER VARYING,TEXT,BOOLEAN,DATE,TIME,TIMESTAMP,UUID,BLOB,JSON',
  ),
  postgresql: set(
    'INTEGER,INT,INT2,INT4,INT8,SMALLINT,BIGINT,REAL,FLOAT4,FLOAT8,FLOAT,DOUBLE PRECISION,NUMERIC,DECIMAL,CHAR,CHARACTER,BPCHAR,VARCHAR,CHARACTER VARYING,TEXT,BOOLEAN,BOOL,DATE,TIME,TIMESTAMP,TIMESTAMPTZ,UUID,BYTEA,JSON,JSONB',
  ),
  mysql: set(
    'INT,INTEGER,SMALLINT,TINYINT,MEDIUMINT,BIGINT,FLOAT,DOUBLE,DOUBLE PRECISION,REAL,DECIMAL,NUMERIC,CHAR,VARCHAR,TEXT,BOOLEAN,BOOL,DATE,TIME,DATETIME,TIMESTAMP,BLOB,JSON',
  ),
  sqlite: set(
    'INT,INTEGER,SMALLINT,BIGINT,TINYINT,MEDIUMINT,INT2,INT8,REAL,DOUBLE,DOUBLE PRECISION,FLOAT,NUMERIC,DECIMAL,CHARACTER,CHAR,VARCHAR,CHARACTER VARYING,TEXT,CLOB,BOOLEAN,DATE,TIME,DATETIME,TIMESTAMP,BLOB',
  ),
};

/** canonical base -> spelling (without arguments) per dialect. */
const CANON: Record<SqlDialect, Record<string, string>> = {
  generic: {
    INTEGER: 'INTEGER', SMALLINT: 'SMALLINT', BIGINT: 'BIGINT', REAL: 'REAL', DOUBLE: 'DOUBLE PRECISION', NUMERIC: 'NUMERIC',
    CHAR: 'CHAR', VARCHAR: 'VARCHAR', TEXT: 'TEXT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIME: 'TIME', TIMESTAMP: 'TIMESTAMP',
    UUID: 'UUID', BLOB: 'BLOB', JSON: 'JSON',
  },
  postgresql: {
    INTEGER: 'INTEGER', SMALLINT: 'SMALLINT', BIGINT: 'BIGINT', REAL: 'REAL', DOUBLE: 'DOUBLE PRECISION', NUMERIC: 'NUMERIC',
    CHAR: 'CHAR', VARCHAR: 'VARCHAR', TEXT: 'TEXT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIME: 'TIME', TIMESTAMP: 'TIMESTAMP',
    UUID: 'UUID', BLOB: 'BYTEA', JSON: 'JSON',
  },
  mysql: {
    INTEGER: 'INT', SMALLINT: 'SMALLINT', BIGINT: 'BIGINT', REAL: 'FLOAT', DOUBLE: 'DOUBLE', NUMERIC: 'DECIMAL',
    CHAR: 'CHAR', VARCHAR: 'VARCHAR', TEXT: 'TEXT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIME: 'TIME', TIMESTAMP: 'DATETIME',
    UUID: 'CHAR(36)', BLOB: 'BLOB', JSON: 'JSON',
  },
  sqlite: {
    INTEGER: 'INTEGER', SMALLINT: 'SMALLINT', BIGINT: 'BIGINT', REAL: 'REAL', DOUBLE: 'DOUBLE', NUMERIC: 'NUMERIC',
    CHAR: 'CHAR', VARCHAR: 'VARCHAR', TEXT: 'TEXT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIME: 'TIME', TIMESTAMP: 'TIMESTAMP',
    UUID: 'TEXT', BLOB: 'BLOB', JSON: 'TEXT',
  },
};

const KNOWN_BASES = new Set(Object.keys(CANON.generic));
const MAX_ARGS: Record<string, number> = { CHAR: 1, VARCHAR: 1, NUMERIC: 2, TIME: 1, TIMESTAMP: 1 };
const INTEGER_BASES = new Set(['INTEGER', 'SMALLINT', 'BIGINT']);

export interface MappedType {
  /** SQL text to emit. */
  sql: string;
  /** Canonical base from `parseDataType` (upper case), e.g. INTEGER. */
  base: string;
  kind: 'mapped' | 'unknown' | 'modifier';
  /** MySQL: VARCHAR had no length, 255 was supplied. */
  defaultedLength?: boolean;
  /**
   * The type was written for another engine. `emitted`: a faithful-enough mapping was applied (`sql` is the replacement);
   * otherwise `sql` is the verbatim text and `suggested` the closest type the dialect supports.
   */
  notPortable?: { reason: 'array' | 'jsonb' | 'timezone' | 'named'; suggested: string; emitted: boolean };
}

/** Words MySQL accepts although SchemaCanvas has no canonical entry for them (so they are not "unknown named types"). */
const MYSQL_EXTRA = set(
  'ENUM,SET,TINYTEXT,MEDIUMTEXT,LONGTEXT,TINYBLOB,MEDIUMBLOB,LONGBLOB,BINARY,VARBINARY,YEAR,BIT,GEOMETRY,POINT,LINESTRING,POLYGON,DEC,FIXED,SERIAL,DATETIME',
);

/** PostgreSQL-only spellings that have no direct counterpart elsewhere; checked before the generic mapping. */
function nonPortable(text: string, base: string, dialect: SqlDialect): MappedType | undefined {
  if (dialect === 'postgresql') return undefined;
  const word = text.replace(/\(.*$/s, '').trim().toUpperCase();
  const json = dialect === 'sqlite' ? 'TEXT' : 'JSON';
  if (/\[\s*\d*\s*\]/.test(text) || /^ARRAY\b/i.test(text)) {
    return { sql: json, base: 'JSON', kind: 'mapped', notPortable: { reason: 'array', suggested: json, emitted: true } };
  }
  if (word === 'JSONB') return { sql: json, base: 'JSON', kind: 'mapped', notPortable: { reason: 'jsonb', suggested: json, emitted: true } };
  if (dialect === 'mysql' && (word === 'TIMESTAMPTZ' || /WITH TIME ZONE/i.test(text))) {
    return { sql: 'DATETIME', base: 'TIMESTAMP', kind: 'mapped', notPortable: { reason: 'timezone', suggested: 'DATETIME', emitted: true } };
  }
  if (dialect === 'mysql' && !KNOWN_BASES.has(base) && !MYSQL_EXTRA.has(word) && !NATIVE.mysql.has(word)) {
    return { sql: text, base, kind: 'unknown', notPortable: { reason: 'named', suggested: 'VARCHAR(255)', emitted: false } };
  }
  return undefined;
}

export const isIntegerBase = (base: string): boolean => INTEGER_BASES.has(base);
/** Types MySQL cannot index without a prefix length. */
export const isLobBase = (base: string): boolean => base === 'TEXT' || base === 'BLOB' || base === 'JSON';

export function mapType(raw: string, dialect: SqlDialect): MappedType {
  const text = raw.trim().replace(/\s+/g, ' ');
  const parsed = parseDataType(text);
  const base = parsed?.base ?? text.toUpperCase();
  const foreign = nonPortable(text, base, dialect);
  if (foreign) return foreign;
  if (/\b(UNSIGNED|SIGNED|ZEROFILL)\b|WITH(OUT)? TIME ZONE|\[\s*\]/i.test(text)) return { sql: text, base, kind: 'modifier' };
  if (!parsed || !KNOWN_BASES.has(parsed.base)) return { sql: text, base, kind: 'unknown' };

  const word = text.replace(/\(.*$/s, '').trim().toUpperCase();
  const spelling = NATIVE[dialect].has(word) ? word : CANON[dialect][parsed.base]!;
  // CHAR(36) from UUID already carries its own argument; do not append the source's (none) again.
  // MySQL: FLOAT(p) with 24 < p <= 53 is a DOUBLE (p > 53 is reported by the DDL range check)
  if (dialect === 'mysql' && word === 'FLOAT' && parsed.args.length === 1 && parsed.args[0]! > 24 && parsed.args[0]! <= 53) {
    return { sql: 'DOUBLE', base: parsed.base, kind: 'mapped' };
  }
  const args = parsed.args.slice(0, MAX_ARGS[parsed.base] ?? 0);
  let sql = args.length > 0 && !spelling.includes('(') ? `${spelling}(${args.join(', ')})` : spelling;
  let defaultedLength: boolean | undefined;
  if (dialect === 'mysql' && parsed.base === 'VARCHAR' && args.length === 0) {
    sql = `${spelling}(255)`;
    defaultedLength = true;
  }
  return { sql, base: parsed.base, kind: 'mapped', ...(defaultedLength ? { defaultedLength } : {}) };
}
