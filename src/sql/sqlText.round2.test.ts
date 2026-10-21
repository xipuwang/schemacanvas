import { describe, expect, it } from 'vitest';
import { scanSqlText, type SqlTextKind } from './sqlText';
import { generateDdl } from './ddl';
import { exportDbml } from './dbmlExport';
import { importDbml } from './dbmlImport';
import { relationalBuilder } from '@/model/builders';
import type { SqlDialect } from '@/model/types';

const DIALECTS: Array<SqlDialect> = ['postgresql', 'sqlite', 'mysql', 'generic'];
const ok = (t: string, d: SqlDialect | 'dbml', k: SqlTextKind): boolean => scanSqlText(t, d, k).ok;

describe('round 2: data types cannot carry constraints or clauses', () => {
  const bad = ['INTEGER REFERENCES p (id)', 'INTEGER UNIQUE', 'INTEGER NULL', 'INTEGER COLLATE nocase', 'INTEGER GENERATED ALWAYS AS (id) STORED', 'INT REFERENCES victim(id) ON DELETE CASCADE', 'INT PRIMARY KEY', 'INT NOT NULL', 'UNIQUE', 'NULL', 'CHECK(1)', 'INT DEFAULT 1', 'INT AUTO_INCREMENT'];
  for (const d of DIALECTS) for (const t of bad) it(`${d}: ${t}`, () => expect(ok(t, d, 'type')).toBe(false));
  it('still accepts real types', () => {
    for (const t of ['VARCHAR(10 CHAR)', 'NUMERIC(10,-2)', 'public.my_type', 'UNSIGNED BIG INT', 'CHARACTER VARYING(20)', 'GEOMETRY(Point)']) expect(ok(t, 'sqlite', 'type')).toBe(true);
    expect(ok('"My Type"', 'postgresql', 'type')).toBe(true);
    expect(ok('public."My Type"', 'postgresql', 'type')).toBe(true);
    expect(ok('"My Type"', 'mysql', 'type')).toBe(false);
  });
});

describe('round 2: defaults and checks are one complete expression', () => {
  const bad = ['0, evil text', '0, CONSTRAINT u UNIQUE (x)', '(1) UNIQUE', '(1) REFERENCES p (id) ON DELETE CASCADE', '1 NOT NULL', '(1), evil text, y int DEFAULT (2)', '0, evil INT', '0, FOREIGN KEY (id) REFERENCES victim (id)', 'now() REFERENCES victim(id)', 'foo PRIMARY KEY', '1 AND', '1 +', "'a' COLLATE nocase", '1 AS (x)', '1 NULL'];
  for (const d of DIALECTS) for (const t of bad) it(`${d}: ${t}`, () => expect(ok(t, d, 'default')).toBe(false));
  it('accepts legitimate expressions', () => {
    for (const t of ['x IS NOT NULL', 'x NOT IN (1, 2)', 'x NOT LIKE \'a%\'', 'cast(1 AS INT)', "CASE WHEN a > 1 THEN 'x' ELSE 'y' END", 'count(*) > 0', 't.a > 0', 'x BETWEEN 1 AND 2'])
      expect(ok(t, 'postgresql', 'check')).toBe(true);
    expect(ok('flags & 1 = 1', 'mysql', 'check')).toBe(true);
    expect(ok('DATE_ADD(NOW(), INTERVAL 1 DAY)', 'mysql', 'default')).toBe(true);
    expect(ok("now() + interval '1' day", 'postgresql', 'default')).toBe(true);
    expect(ok("substring('abc' FROM 2)", 'postgresql', 'default')).toBe(true);
    expect(ok('col$1 > 0', 'postgresql', 'check')).toBe(true);
    expect(ok('x::double precision > 0', 'postgresql', 'check')).toBe(true);
    expect(ok('x = 0xFF', 'mysql', 'check')).toBe(true);
    expect(ok("'{}'::text[]", 'postgresql', 'default')).toBe(true);
    expect(ok('Café > 0', 'sqlite', 'check')).toBe(true);
    expect(ok('Café > 0', 'sqlite', 'check')).toBe(true);
  });
  it('a backslash inside a literal is refused on generic (portable to MySQL)', () => {
    expect(ok("a = '\\'", 'generic', 'check')).toBe(false);
    expect(ok("a = '\\'", 'postgresql', 'check')).toBe(true);
  });
});

const build = (defaultValue: string, dataType = 'INT') => {
  const b = relationalBuilder('m');
  b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'x', type: dataType, default: defaultValue }], { pk: ['id'] });
  return b.build();
};

describe('round 2: generateDdl and DBML never emit refused text', () => {
  it('wraps / refuses differentials on every dialect', () => {
    for (const d of DIALECTS)
      for (const v of ['0, evil text', 'now() REFERENCES victim(id)', '(cast(1 as `(`)), evil text, y int default (cast(2 as `)`))']) {
        const r = generateDdl(build(v), d);
        expect(r.sql).not.toMatch(/evil|REFERENCES victim/);
      }
  });
  it('DBML refuses a backtick inside a literal (no structure injection)', () => {
    const payload = "lower('`] } Table evil { id int [pk] } Table t2 { z int [default: `')";
    const out = exportDbml(build(payload));
    expect(out).not.toMatch(/evil/);
    const back = importDbml(out);
    expect(Object.values(back.model.relations).map((r) => r.name)).toEqual(['t']);
  });
});
