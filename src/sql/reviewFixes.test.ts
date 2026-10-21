/** Regression tests for the independent-review findings SQL-1 .. SQL-13 (each fails without its fix). */
import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { newId } from '@/model/ids';
import type { RelationalModel } from '@/model/types';
import { exportDbml } from './dbmlExport';
import { importDbml } from './dbmlImport';
import { ddlIssues, generateDdl } from './ddl';
import { parseDdl } from './ddlParser';
import { SqlParseError } from './types';

type D = 'postgresql' | 'sqlite' | 'mysql' | 'generic';
const errs = (m: RelationalModel, d: D): string[] => ddlIssues(m, d).filter((i) => i.severity === 'error').map((i) => i.code.replace(/^ddl\.[a-z]+\./, ''));
const throwsParse = (text: string, dialect: Parameters<typeof parseDdl>[1] = 'auto'): SqlParseError => {
  try {
    parseDdl(text, dialect);
  } catch (e) {
    expect(e).toBeInstanceOf(SqlParseError);
    return e as SqlParseError;
  }
  throw new Error('expected SqlParseError');
};

function fkModel(parentType: string, childType: string): RelationalModel {
  const b = relationalBuilder('m');
  const p = b.relation('p', [{ name: 'k', type: parentType }], { pk: ['k'] });
  const c = b.relation('c', [{ name: 'id', type: 'INTEGER' }, { name: 'f', type: childType }], { pk: ['id'] });
  b.fk(c, ['f'], p, ['k']);
  return b.build();
}

describe('SQL-1 PostgreSQL FK type compatibility matches the engine', () => {
  const emitted = (parent: string, child: string): boolean => errs(fkModel(parent, child), 'postgresql').length === 0;
  it('refuses what PG rejects', () => {
    for (const parent of ['DATE', 'TIMESTAMP', 'TIMESTAMPTZ']) expect(emitted(parent, 'TIME')).toBe(false);
    for (const child of ['DATE', 'TIMESTAMP', 'TIMESTAMPTZ']) expect(emitted('TIME', child)).toBe(false);
    for (const child of ['REAL', 'DOUBLE PRECISION']) expect(emitted('NUMERIC(10,0)', child)).toBe(false);
  });
  it('accepts what PG accepts', () => {
    for (const child of ['SMALLINT', 'INTEGER', 'BIGINT']) {
      for (const parent of ['NUMERIC(10,0)', 'REAL', 'DOUBLE PRECISION']) expect(emitted(parent, child)).toBe(true);
    }
    expect(emitted('TIME', 'TIME')).toBe(true);
    expect(emitted('DATE', 'TIMESTAMP')).toBe(true);
  });
});

describe('SQL-2 constraint / index name namespaces', () => {
  it('PostgreSQL: PK constraint names are schema-wide (they create indexes)', () => {
    const b = relationalBuilder('m');
    b.relation('a', ['id'], { pk: ['id'] }).relation.primaryKeyName = 'pk';
    b.relation('b', ['id'], { pk: ['id'] }).relation.primaryKeyName = 'pk';
    expect(errs(b.build(), 'postgresql')).toContain('duplicate-constraint-name');
    expect(errs(b.build(), 'sqlite')).not.toContain('duplicate-constraint-name');
  });
  it('a UNIQUE constraint or index named like a table clashes (PG), an index named like a table clashes (SQLite)', () => {
    const b = relationalBuilder('m');
    const a = b.relation('a', ['id', 'x'], { pk: ['id'] });
    const t = b.relation('t', ['id', 'y'], { pk: ['id'] });
    a.relation.uniques.push({ id: newId('uq'), name: 'T', columnIds: [a.col('x')] });
    expect(errs(b.build(), 'postgresql')).toContain('duplicate-constraint-name');
    a.relation.uniques.length = 0;
    t.index('a', ['y']);
    expect(errs(b.build(), 'postgresql')).toContain('duplicate-constraint-name');
    expect(errs(b.build(), 'sqlite')).toContain('duplicate-constraint-name');
    expect(generateDdl(b.build(), 'sqlite').sql).toBe('');
  });
  it('two CHECKs, or an FK and a CHECK, with one name in one table clash (PG)', () => {
    const b = relationalBuilder('m');
    const p = b.relation('p', ['k'], { pk: ['k'] });
    const c = b.relation('c', ['id', 'f'], { pk: ['id'] });
    c.relation.checks = [
      { id: newId('chk'), name: 'ck', expression: 'id > 0' },
      { id: newId('chk'), name: 'ck', expression: 'id < 9' },
    ];
    expect(errs(b.build(), 'postgresql')).toContain('duplicate-constraint-name');
    c.relation.checks = [{ id: newId('chk'), name: 'k', expression: 'id > 0' }];
    b.fk(c, ['f'], p, ['k'], { name: 'k' });
    expect(errs(b.build(), 'postgresql')).toContain('duplicate-constraint-name');
  });
  it('MySQL: FK and CHECK names are unique per database, not per table', () => {
    const b = relationalBuilder('m');
    const p = b.relation('p', ['k'], { pk: ['k'] });
    const c1 = b.relation('c1', [{ name: 'id', type: 'INT' }, { name: 'f', type: 'INT' }], { pk: ['id'] });
    const c2 = b.relation('c2', [{ name: 'id', type: 'INT' }, { name: 'f', type: 'INT' }], { pk: ['id'] });
    p.relation.columns[0]!.dataType = 'INT';
    b.fk(c1, ['f'], p, ['k'], { name: 'fk_same' });
    b.fk(c2, ['f'], p, ['k'], { name: 'fk_same' });
    expect(errs(b.build(), 'mysql')).toContain('duplicate-constraint-name');
    expect(errs(b.build(), 'postgresql')).not.toContain('duplicate-constraint-name');
  });
  it('distinct names are not flagged', () => {
    const b = relationalBuilder('m');
    b.relation('a', ['id'], { pk: ['id'] });
    b.relation('b', ['id'], { pk: ['id'] });
    for (const d of ['postgresql', 'sqlite', 'mysql', 'generic'] as D[]) expect(errs(b.build(), d)).toEqual([]);
  });
});

describe('SQL-3 PostgreSQL 63-byte truncation collisions', () => {
  it('columns / tables that share their first 63 bytes are errors', () => {
    const b = relationalBuilder('m');
    b.relation('t', [`${'x'.repeat(63)}A`, `${'x'.repeat(63)}B`]);
    expect(errs(b.build(), 'postgresql')).toContain('identifier-truncation-collision');
    const b2 = relationalBuilder('m');
    b2.relation(`${'y'.repeat(63)}_one`, ['a']);
    b2.relation(`${'y'.repeat(63)}_two`, ['a']);
    expect(errs(b2.build(), 'postgresql')).toContain('identifier-truncation-collision');
    expect(errs(b2.build(), 'sqlite')).toEqual([]);
  });
  it('FK / CHECK names are length-checked too, and a lone long name stays a warning', () => {
    const b = relationalBuilder('m');
    const p = b.relation('p', ['k'], { pk: ['k'] });
    const c = b.relation('c', ['id', 'f'], { pk: ['id'] });
    b.fk(c, ['f'], p, ['k'], { name: 'f'.repeat(70) });
    const issues = ddlIssues(b.build(), 'postgresql');
    expect(issues.some((i) => i.code.endsWith('identifier-too-long') && i.severity === 'warning')).toBe(true);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });
});

describe('SQL-7 / SQL-9 non-literal DEFAULTs', () => {
  const withDefault = (type: string, def: string): RelationalModel => {
    const b = relationalBuilder('m');
    b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'f', type, default: def }], { pk: ['id'] });
    return b.build();
  };
  it('SQLite wraps function calls and operators, keeps literals', () => {
    expect(generateDdl(withDefault('TEXT', "datetime('now')"), 'sqlite').sql).toContain("DEFAULT (datetime('now'))");
    expect(generateDdl(withDefault('TEXT', "'a' || 'b'"), 'sqlite').sql).toContain("DEFAULT ('a' || 'b')");
    expect(generateDdl(withDefault('TEXT', 'now()'), 'sqlite').sql).toContain('DEFAULT (now())');
    expect(generateDdl(withDefault('TEXT', "(lower('A'))"), 'sqlite').sql).toContain("DEFAULT (lower('A'))");
    const lit = generateDdl(withDefault('TEXT', "'it''s'"), 'sqlite').sql;
    expect(lit).toContain("DEFAULT 'it''s'");
    expect(generateDdl(withDefault('INTEGER', '-5'), 'sqlite').sql).toContain('DEFAULT -5');
    expect(generateDdl(withDefault('TIMESTAMP', 'CURRENT_TIMESTAMP'), 'sqlite').sql).toContain('DEFAULT CURRENT_TIMESTAMP');
  });
  it('MySQL wraps expressions and literals on TEXT/JSON; PostgreSQL is untouched', () => {
    expect(generateDdl(withDefault('CHAR(36)', 'uuid()'), 'mysql').sql).toContain('DEFAULT (uuid())');
    expect(generateDdl(withDefault('TEXT', "'none'"), 'mysql').sql).toContain("DEFAULT ('none')");
    expect(generateDdl(withDefault('JSON', "'{}'"), 'mysql').sql).toContain("DEFAULT ('{}')");
    expect(generateDdl(withDefault('VARCHAR(5)', "'x'"), 'mysql').sql).toContain("DEFAULT 'x'");
    expect(generateDdl(withDefault('TEXT', "lower('A')"), 'postgresql').sql).toContain("DEFAULT lower('A')");
  });
});

describe('SQL-8 / SQL-10 reserved words', () => {
  const quoted = (name: string, d: D): boolean => {
    const b = relationalBuilder('m');
    b.relation(name, [{ name: 'rank', type: 'INTEGER' }, 'id'], { pk: ['id'] });
    const sql = generateDdl(b.build(), d, { header: false }).sql;
    return d === 'mysql' ? sql.includes(`\`${name}\``) : sql.includes(`"${name}"`);
  };
  it('MySQL 8 reserved words are quoted (groups, rank, row, window, partition, lead ...)', () => {
    for (const w of ['groups', 'rank', 'row', 'window', 'partition', 'lead', 'system', 'of', 'if', 'function', 'dual', 'empty']) expect(quoted(w, 'mysql')).toBe(true);
    const sql = generateDdl(relationalBuilder('m').build(), 'mysql').sql;
    expect(sql).toBeDefined();
  });
  it('generic inherits the MySQL words; COLLATION (PG) and NOTHING/RETURNING (SQLite) are quoted', () => {
    expect(quoted('groups', 'generic')).toBe(true);
    expect(quoted('collation', 'postgresql')).toBe(true);
    expect(quoted('nothing', 'sqlite')).toBe(true);
    expect(quoted('returning', 'sqlite')).toBe(true);
  });
  it('a column named like an importer keyword is quoted so output re-imports (SQL-4)', () => {
    const b = relationalBuilder('m');
    b.relation('if', [{ name: 'id', type: 'INTEGER' }, { name: 'fulltext', type: 'VARCHAR(200)' }, { name: 'exclude', type: 'INTEGER' }], { pk: ['id'] });
    for (const d of ['postgresql', 'sqlite'] as const) {
      const sql = generateDdl(b.build(), d).sql;
      const back = parseDdl(sql, d).model;
      const r = Object.values(back.relations)[0]!;
      expect(r.name).toBe('if');
      expect(r.columns.map((c) => c.name)).toEqual(['id', 'fulltext', 'exclude']);
    }
  });
});

describe('SQL-9 other MySQL restrictions', () => {
  it('FK source column of TEXT type is an error (key without length)', () => {
    const b = relationalBuilder('m');
    const p = b.relation('p', [{ name: 'k', type: 'TEXT' }]);
    p.relation.uniques.push({ id: newId('uq'), columnIds: [p.col('k')] });
    const c = b.relation('c', [{ name: 'id', type: 'INT' }, { name: 'f', type: 'TEXT' }], { pk: ['id'] });
    b.fk(c, ['f'], p, ['k']);
    const m = b.build();
    const bad = ddlIssues(m, 'mysql').filter((i) => i.code.endsWith('key-lob-column'));
    expect(bad.some((i) => i.affected.some((a) => a.kind === 'column' && a.relationId === c.id))).toBe(true);
  });
  it('NUMERIC precision/scale differences across an FK are an error in MySQL only', () => {
    expect(errs(fkModel('NUMERIC(10,2)', 'NUMERIC(8,2)'), 'mysql')).toContain('fk-type-mismatch');
    expect(errs(fkModel('NUMERIC(10,2)', 'NUMERIC(10,2)'), 'mysql')).not.toContain('fk-type-mismatch');
    expect(errs(fkModel('NUMERIC(10,2)', 'NUMERIC(8,2)'), 'postgresql')).not.toContain('fk-type-mismatch');
  });
  it('CREATE INDEX never gets IF NOT EXISTS in MySQL', () => {
    const b = relationalBuilder('m');
    b.relation('t', [{ name: 'id', type: 'INT' }, { name: 'x', type: 'INT' }], { pk: ['id'] }).index('ix', ['x']);
    expect(generateDdl(b.build(), 'mysql', { ifNotExists: true }).sql).toContain('CREATE INDEX ix ON');
    expect(generateDdl(b.build(), 'postgresql', { ifNotExists: true }).sql).toContain('CREATE INDEX IF NOT EXISTS ix ON');
  });
});

describe('SQL-11 unique non-btree index (PostgreSQL)', () => {
  it('is an error', () => {
    const b = relationalBuilder('m');
    const t = b.relation('p', [{ name: 'k', type: 'INTEGER' }], { pk: ['k'] });
    t.relation.indexes.push({ id: newId('idx'), name: 'pk_hash', columnIds: [t.col('k')], unique: true, method: 'hash' });
    expect(errs(b.build(), 'postgresql')).toContain('unique-index-method');
    t.relation.indexes[0]!.method = 'btree';
    expect(errs(b.build(), 'postgresql')).toEqual([]);
  });
});

describe('SQL-4 importer keywords as identifiers', () => {
  it('`fulltext varchar(200)` and `spatial numeric(10,2)` are columns', () => {
    const { model } = parseDdl('CREATE TABLE t (id int primary key, fulltext varchar(200), spatial numeric(10,2));');
    expect(Object.values(model.relations)[0]!.columns.map((c) => c.name)).toEqual(['id', 'fulltext', 'spatial']);
  });
  it('a real FULLTEXT index is still skipped with a warning', () => {
    const { model, warnings } = parseDdl('CREATE TABLE t (id int primary key, body text, FULLTEXT ft (body), FULLTEXT KEY (body));', 'mysql');
    expect(Object.values(model.relations)[0]!.columns).toHaveLength(2);
    expect(warnings.filter((w) => w.code.endsWith('skipped-index'))).toHaveLength(2);
  });
  it('`exclude` column and `if` table name import', () => {
    const { model } = parseDdl('CREATE TABLE if (id int primary key, exclude int);');
    const r = Object.values(model.relations)[0]!;
    expect(r.name).toBe('if');
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'exclude']);
    expect(Object.values(parseDdl('CREATE TABLE IF NOT EXISTS a (x int);').model.relations)).toHaveLength(1);
  });
});

describe('SQL-5 missing semicolons are errors', () => {
  it('table options may not swallow the next statement', () => {
    expect(throwsParse('CREATE TABLE a (x int)\nCREATE TABLE b (y int, z int);').message).toMatch(/Missing ';'/);
  });
  it('trailing garbage after a table is an error, real options still import', () => {
    expect(throwsParse('CREATE TABLE a (x int) garbage words here;').message).toMatch(/Unsupported table option/);
    const { model, warnings } = parseDdl('CREATE TABLE a (x int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;', 'mysql');
    expect(Object.keys(model.relations)).toHaveLength(1);
    expect(warnings.some((w) => w.code.endsWith('table-options'))).toBe(true);
    expect(Object.keys(parseDdl('CREATE TABLE a (x int) WITHOUT ROWID, STRICT;', 'sqlite').model.relations)).toHaveLength(1);
    expect(Object.keys(parseDdl('CREATE TABLE a (x int) DEFAULT CHARACTER SET utf8 ROW_FORMAT=DYNAMIC;', 'mysql').model.relations)).toHaveLength(1);
  });
  it('a CREATE INDEX ... WHERE predicate stops at the next statement', () => {
    expect(throwsParse('CREATE TABLE a (x int);\nCREATE INDEX i ON a (x) WHERE x > 0\nCREATE TABLE b (y int);').message).toMatch(/Missing ';'/);
    const { model } = parseDdl('CREATE TABLE a (x int); CREATE INDEX i ON a (x) WHERE x > 0; CREATE TABLE b (y int);');
    expect(Object.values(model.relations).find((r) => r.name === 'a')!.indexes[0]!.where).toBe('x > 0');
    expect(Object.keys(model.relations)).toHaveLength(2);
  });
});

describe('SQL-6 trigger bodies', () => {
  const body = (inner: string): string =>
    `CREATE TABLE a (x int); CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN ${inner} END; CREATE TABLE b (y int); CREATE TABLE c (z int);`;
  it('END CASE / END IF / END LOOP do not swallow following tables', () => {
    for (const inner of [
      'CASE WHEN NEW.x > 1 THEN SET NEW.x = 1; ELSE SET NEW.x = 2; END CASE;',
      'IF NEW.x > 1 THEN SET NEW.x = 1; END IF;',
      'WHILE NEW.x < 3 DO SET NEW.x = NEW.x + 1; END WHILE;',
      'SET NEW.x = CASE WHEN NEW.x > 1 THEN 1 ELSE 2 END;',
    ]) {
      const { model } = parseDdl(body(inner), 'mysql');
      expect(Object.values(model.relations).map((r) => r.name).sort(), inner).toEqual(['a', 'b', 'c']);
    }
  });
  it('an unterminated trigger body is an error, not a silent skip to EOF', () => {
    expect(throwsParse('CREATE TABLE a (x int); CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = 1;', 'mysql').message).toMatch(/Unterminated/);
  });
});

describe('SQL-13 MySQL SERIAL', () => {
  it('is BIGINT UNSIGNED AUTO_INCREMENT UNIQUE', () => {
    const { model } = parseDdl('CREATE TABLE a (id SERIAL, x int);', 'mysql');
    const r = Object.values(model.relations)[0]!;
    expect(r.columns[0]).toMatchObject({ dataType: 'BIGINT UNSIGNED', autoIncrement: true, nullable: false });
    expect(r.uniques).toHaveLength(1);
    expect(r.uniques[0]!.columnIds).toEqual([r.columns[0]!.id]);
  });
  it('the implicit UNIQUE is dropped when the column is the primary key; PG SERIAL is unchanged', () => {
    const r = Object.values(parseDdl('CREATE TABLE a (id SERIAL PRIMARY KEY);', 'mysql').model.relations)[0]!;
    expect(r.uniques).toHaveLength(0);
    const pg = Object.values(parseDdl('CREATE TABLE a (id SERIAL, x int);', 'postgresql').model.relations)[0]!;
    expect(pg.columns[0]).toMatchObject({ dataType: 'INTEGER', autoIncrement: true });
    expect(pg.uniques).toHaveLength(0);
  });
});

describe('SQL-12 DBML export fidelity', () => {
  it('INT[3] is quoted and re-imports', () => {
    const b = relationalBuilder('m');
    b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'a', type: 'INT[3]' }, { name: 'b', type: 'INT[]' }], { pk: ['id'] });
    const back = importDbml(exportDbml(b.build())).model;
    expect(Object.values(back.relations)[0]!.columns.map((c) => c.dataType)).toEqual(['INTEGER', 'INT[3]', 'INT[]']);
  });
  it('a named single-column primary key keeps its name', () => {
    const b = relationalBuilder('m');
    b.relation('t', ['id', 'x'], { pk: ['id'] }).relation.primaryKeyName = 'pk_t';
    const back = Object.values(importDbml(exportDbml(b.build())).model.relations)[0]!;
    expect(back.primaryKeyName).toBe('pk_t');
    expect(back.primaryKey).toHaveLength(1);
  });
});
