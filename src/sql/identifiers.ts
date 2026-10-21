/**
 * Identifier quoting. PRIVATE to src/sql (architecture rule): nothing outside this directory may build SQL text.
 * An identifier is quoted only when it is not lowercase-safe or is a reserved word of the target dialect.
 */
import type { SqlDialect } from '@/model/types';

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** Words reserved by (nearly) every engine; quoting them is always safe. */
const COMMON = words(`
  ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLLATE COLUMN CONSTRAINT CREATE CROSS CURRENT_DATE
  CURRENT_TIME CURRENT_TIMESTAMP DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FALSE FOR FOREIGN FROM FULL GROUP
  HAVING IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL ON OR ORDER OUTER PRIMARY REFERENCES
  RIGHT SELECT SET TABLE THEN TO TRUE UNION UNIQUE UPDATE USING VALUES WHEN WHERE WITH
`);
const POSTGRES = words(`
  ANALYSE ANALYZE ARRAY ASYMMETRIC AUTHORIZATION BINARY BOTH CONCURRENTLY CURRENT_CATALOG CURRENT_ROLE CURRENT_SCHEMA
  CURRENT_USER DEFERRABLE DO EXCEPT FETCH FREEZE GRANT ILIKE INITIALLY ISNULL LATERAL LEADING LOCALTIME LOCALTIMESTAMP
  NATURAL NOTNULL OFFSET ONLY OVERLAPS PLACING RETURNING SESSION_USER SIMILAR SOME SYMMETRIC TABLESAMPLE TRAILING USER
  VARIADIC VERBOSE WINDOW COLLATION
`);
const MYSQL = words(`
  ACCESSIBLE ARRAY ASENSITIVE BEFORE BIGINT BINARY BLOB BOTH CALL CASCADE CHANGE CHAR CHARACTER CONDITION CONTINUE
  CONVERT CUBE CUME_DIST CURRENT_USER CURSOR DATABASE DATABASES DAY_HOUR DAY_MICROSECOND DAY_MINUTE DAY_SECOND DEC
  DECIMAL DECLARE DELAYED DENSE_RANK DESCRIBE DETERMINISTIC DISTINCTROW DIV DOUBLE DUAL EACH ELSEIF EMPTY ENCLOSED
  ESCAPED EXCEPT EXIT EXPLAIN FETCH FIRST_VALUE FLOAT FLOAT4 FLOAT8 FORCE FULLTEXT FUNCTION GENERATED GET GRANT GROUPING
  GROUPS HIGH_PRIORITY HOUR_MICROSECOND HOUR_MINUTE HOUR_SECOND IF IGNORE INFILE INOUT INSENSITIVE INT INT1 INT2 INT3
  INT4 INT8 INTEGER INTERSECT INTERVAL IO_AFTER_GTIDS IO_BEFORE_GTIDS ITERATE JSON_TABLE KEYS KILL LAG LAST_VALUE
  LATERAL LEAD LEADING LEAVE LINEAR LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOOP LOW_PRIORITY
  MASTER_BIND MASTER_SSL_VERIFY_SERVER_CERT MATCH MAXVALUE MEDIUMBLOB MEDIUMINT MEDIUMTEXT MEMBER MIDDLEINT
  MINUTE_MICROSECOND MINUTE_SECOND MOD MODIFIES NATURAL NO_WRITE_TO_BINLOG NTH_VALUE NTILE NUMERIC OF OPTIMIZE
  OPTIMIZER_COSTS OPTION OPTIONALLY OUT OUTFILE OVER PARTITION PERCENT_RANK PRECISION PROCEDURE PURGE RANGE RANK READ
  READS READ_WRITE REAL RECURSIVE REGEXP RELEASE RENAME REPEAT REPLACE REQUIRE RESIGNAL RESTRICT RETURN REVOKE RLIKE ROW
  ROWS ROW_NUMBER SCHEMA SCHEMAS SECOND_MICROSECOND SENSITIVE SEPARATOR SHOW SIGNAL SMALLINT SPATIAL SPECIFIC SQL
  SQLEXCEPTION SQLSTATE SQLWARNING SQL_BIG_RESULT SQL_CALC_FOUND_ROWS SQL_SMALL_RESULT SSL STARTING STORED
  STRAIGHT_JOIN SYSTEM TERMINATED TINYBLOB TINYINT TINYTEXT TRAILING TRIGGER UNDO UNLOCK UNSIGNED USAGE USE UTC_DATE
  UTC_TIME UTC_TIMESTAMP VARBINARY VARCHAR VARCHARACTER VARYING VIRTUAL WHILE WINDOW WRITE XOR YEAR_MONTH ZEROFILL
  ANALYZE CHANGE
`);
const SQLITE = words(`
  ABORT ACTION AFTER ATTACH AUTOINCREMENT BEFORE BEGIN CASCADE COMMIT CONFLICT DATABASE DEFERRABLE DEFERRED DETACH
  EACH ESCAPE EXCEPT EXCLUSIVE EXPLAIN FAIL GLOB IF IGNORE IMMEDIATE INDEXED INITIALLY INSTEAD ISNULL MATCH NATURAL
  NOTNULL OF OFFSET PLAN PRAGMA QUERY RAISE RECURSIVE REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT ROLLBACK ROW
  SAVEPOINT TEMP TEMPORARY TRANSACTION TRIGGER VACUUM VIEW VIRTUAL WITHOUT NOTHING RETURNING
`);

/** Words the DDL importer treats as statement/element keywords: always quoted so generated output re-imports. */
const IMPORTER_WORDS: ReadonlySet<string> = new Set(['FULLTEXT', 'SPATIAL', 'EXCLUDE', 'IF']);

const RESERVED: Record<SqlDialect, ReadonlySet<string>> = {
  // `generic` is the union: output that must survive several engines quotes all of their reserved words.
  generic: new Set([...COMMON, ...POSTGRES, ...MYSQL, ...SQLITE]),
  postgresql: new Set([...COMMON, ...POSTGRES]),
  mysql: new Set([...COMMON, ...MYSQL]),
  sqlite: new Set([...COMMON, ...SQLITE]),
};

export const isReservedWord = (name: string, dialect: SqlDialect): boolean => RESERVED[dialect].has(name.toUpperCase());

const SAFE = /^[a-z_][a-z0-9_]*$/;

export function needsQuoting(name: string, dialect: SqlDialect): boolean {
  return !SAFE.test(name) || isReservedWord(name, dialect) || IMPORTER_WORDS.has(name.toUpperCase());
}

/** Always-quoted form with the dialect's quote character, embedded quote characters doubled. */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  const q = dialect === 'mysql' ? '`' : '"';
  // NUL bytes and line breaks cannot be written safely (the generator refuses such names first); never pass them through
  name = name.replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]/g, '\uFFFD');
  return q + name.split(q).join(q + q) + q;
}

export function ident(name: string, dialect: SqlDialect, quoteAll = false): string {
  return quoteAll || needsQuoting(name, dialect) ? quoteIdent(name, dialect) : name;
}

/** Byte length as engines count it (PostgreSQL limits bytes, MySQL characters; callers pick). */
export const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** SQL string literal (`'` doubled). */
export const sqlString = (s: string): string => `'${s.split("'").join("''")}'`;

/** Longest prefix of `s` that fits `maxBytes` UTF-8 bytes without splitting a character (PostgreSQL's NAMEDATALEN rule). */
export function truncateUtf8(s: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of s) {
    const n = utf8Length(ch);
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += ch;
  }
  return out;
}
