import { describe, expect, it } from 'vitest';
import { scanSqlText, type SqlTextKind } from './sqlText';
import { exportDbmlDetailed } from './dbmlExport';
import { relationalBuilder } from '@/model/builders';

type D = 'postgresql' | 'sqlite' | 'mysql';
const ALL: D[] = ['postgresql', 'sqlite', 'mysql'];
const ok = (t: string, d: D | 'generic' | 'dbml', k: SqlTextKind): boolean => scanSqlText(t, d, k).ok;

describe('scanSqlText: accepted text', () => {
  const both: Array<[string, SqlTextKind]> = [
    ["'N/A'", 'default'], ['0', 'default'], ['-1', 'default'], ['1.5e3', 'default'], ['TRUE', 'default'], ['NULL', 'default'],
    ['CURRENT_TIMESTAMP', 'default'], ['CURRENT_TIMESTAMP(3)', 'default'], ['now()', 'default'], ['uuid()', 'default'],
    ["'it''s'", 'default'], ["'#FFFFFF'", 'default'], ["status IN ('a', 'b')", 'check'], ['price > 0 AND price < 1000', 'check'],
    ['价格 > 0', 'check'], ['length(name) >= 2', 'check'], ['VARCHAR(255)', 'type'], ['NUMERIC(10,2)', 'type'],
    ['DOUBLE PRECISION', 'type'], ['TIMESTAMP(3) WITH TIME ZONE', 'type'], ['INT UNSIGNED', 'type'], ["ENUM('a','b')", 'type'],
    ['deleted_at IS NULL', 'where'],
  ];
  for (const d of ALL) for (const [t, k] of both) it(`${d} ${k}: ${t}`, () => expect(ok(t, d, k)).toBe(true));
  it('dialect specific', () => {
    expect(ok('gen_random_uuid()', 'postgresql', 'default')).toBe(true);
    expect(ok("zip ~ '^\\d{5}$'", 'postgresql', 'check')).toBe(true);
    expect(ok("zip !~* 'x'", 'postgresql', 'check')).toBe(true);
    expect(ok("zip ~ 'x'", 'mysql', 'check')).toBe(false);
    expect(ok("zip ~ 'x'", 'sqlite', 'check')).toBe(false);
    expect(ok("zip LIKE '^\\d{5}$'", 'postgresql', 'check')).toBe(true);
    expect(ok('x::int > 0', 'postgresql', 'check')).toBe(true);
    expect(ok('x::int > 0', 'mysql', 'check')).toBe(false);
    expect(ok('"Weird Col" > 0', 'postgresql', 'check')).toBe(true);
    expect(ok('"Weird Col" > 0', 'sqlite', 'check')).toBe(true);
    expect(ok('"Weird Col" > 0', 'mysql', 'check')).toBe(false);
    expect(ok('`col` > 0', 'mysql', 'check')).toBe(true);
    expect(ok('`col` > 0', 'sqlite', 'check')).toBe(true);
    expect(ok('`col` > 0', 'postgresql', 'check')).toBe(false);
    expect(ok('text[]', 'postgresql', 'type')).toBe(true);
    expect(ok('text[]', 'mysql', 'type')).toBe(true); // dialect-neutral project types are mapped afterwards
    expect(ok('a[]', 'postgresql', 'check')).toBe(false);
    expect(ok("'a\\b'", 'postgresql', 'default')).toBe(true);
    expect(ok("'a\\b'", 'sqlite', 'default')).toBe(true);
    expect(ok("'a\\b'", 'mysql', 'default')).toBe(false);
    expect(ok("'a;b'", 'sqlite', 'default')).toBe(false);
  });
  it('whitespace is normalised, multi-line CHECKs survive', () => {
    expect(scanSqlText("status IN (\n  'a',\r\n\t'b'\n)", 'postgresql', 'check')).toMatchObject({ ok: true, text: "status IN ( 'a', 'b' )" });
    expect(scanSqlText('  VARCHAR (  255 ) ', 'mysql', 'type')).toMatchObject({ ok: true, text: 'VARCHAR ( 255 )' });
  });
});

describe('scanSqlText: refused text', () => {
  const never = ['$$x$$', "$é$'$é$", 'a[1]', '[x]', '#', '@v', '{', '}', 'a ; b', 'a \\ b', ': x', '1 -- x', '1--1', '1 /* x */', '1/*', 'x */', 'a\u0000b', 'a\u2028b', "'a\u2028b'", "'a\nb'", "'abc", '"abc', '(1', '1)', 'a ? b', 'a ! b', '1abc', '', '   '];
  for (const d of ALL) for (const t of never) it(`${d}: ${JSON.stringify(t)}`, () => expect(ok(t, d, 'check')).toBe(false));
  it('postgres prefixed literals', () => {
    for (const t of ["E'\\''", "e'x'", "U&'x'", "B'1'", "X'41'", "N'x'"]) expect(ok(t, 'postgresql', 'default'), t).toBe(false);
    expect(ok("X'41'", 'mysql', 'default')).toBe(true);
  });
  it('type shape', () => {
    for (const t of ['', 'INT(1)(2)', '(1)', 'INT()', 'INT(1,)', 'INT DEFAULT 1)', 'a - b']) expect(ok(t, 'postgresql', 'type'), t).toBe(false);
    expect(ok('INT[]', 'postgresql', 'type')).toBe(true);
    expect(ok('int[] x', 'postgresql', 'type')).toBe(false);
  });
  it('dbml dialect is the strictest', () => {
    expect(ok('"a" > 0', 'dbml', 'check')).toBe(false);
    expect(ok('`a` > 0', 'dbml', 'check')).toBe(false);
    expect(ok("'a\\b'", 'dbml', 'default')).toBe(false);
    expect(ok('a > 0', 'dbml', 'check')).toBe(true);
  });
});

describe('DBML export never carries a refused expression', () => {
  it('drops refused DEFAULT / CHECK with an issue and quotes a refused type with an issue', () => {
    const b = relationalBuilder('m');
    const t = b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'x', type: 'INT); DROP TABLE t; --', default: '0); DROP TABLE t; --' }], { pk: ['id'] });
    t.relation.checks = [{ id: 'c1', expression: '1=1); DROP TABLE t; --' }, { id: 'c2', expression: "status IN ('a',\n 'b')" }];
    const r = exportDbmlDetailed(b.build());
    expect(r.dbml).not.toMatch(/`[^`]*DROP/);
    expect(r.dbml).not.toMatch(/default: .*DROP/);
    expect(r.dbml).toContain("`status IN ('a', 'b')`");
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['dbml.export.default', 'dbml.export.check', 'dbml.export.type']));
  });
});

describe('release review follow-ups', () => {
  it('refuses a keyword glued to a number by a dot (every engine reads `1.` as a numeric literal)', () => {
    for (const d of ['postgresql', 'mysql', 'sqlite', 'dbml'] as const)
      for (const text of ['1.UNIQUE', '1.NULL', '1.CHECK(false)', '1.GENERATED', '1.IS NULL']) expect(scanSqlText(text, d, 'default').ok, `${d}: ${text}`).toBe(false);
    expect(scanSqlText('t.price > 0', 'postgresql', 'check').ok).toBe(true);
    expect(scanSqlText('1.5 > 0', 'postgresql', 'check').ok).toBe(true);
  });
  it('accepts the REPLACE() string function but not a REPLACE statement', () => {
    expect(scanSqlText("(replace(uuid(),'-',''))", 'mysql', 'default').ok).toBe(true);
    expect(scanSqlText("replace(a,'x','y') <> ''", 'postgresql', 'check').ok).toBe(true);
    expect(scanSqlText('REPLACE INTO t VALUES (1)', 'mysql', 'default').ok).toBe(false);
  });
});

describe('REPLACE exception stays narrow', () => {
  it.each(['postgresql', 'mysql', 'sqlite', 'dbml'] as const)('%s refuses REPLACE abuse', (d) => {
    for (const text of ['REPLACE (SELECT 1)', 'replace(a,b,c) x', 'REPLACE', '1 REPLACE (a)']) expect(scanSqlText(text, d, 'default').ok, text).toBe(false);
  });
});
