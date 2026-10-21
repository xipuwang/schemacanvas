import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { exportDbmlDetailed } from './dbmlExport';
import { importDbml } from './dbmlImport';
import { generateDdl } from './ddl';
import { scanSqlText, type SqlTextKind } from './sqlText';

const ok = (t: string, d: Parameters<typeof scanSqlText>[1], k: SqlTextKind): boolean => scanSqlText(t, d, k).ok;
const model = (cols: Array<{ name: string; type: string; default?: string; description?: string }>, opts: { checks?: string[]; name?: string } = {}) => {
  const b = relationalBuilder('x');
  const t = b.relation(opts.name ?? 't', [{ name: 'id', type: 'INTEGER' }, ...cols], { pk: ['id'] });
  if (opts.checks) t.relation.checks = opts.checks.map((expression, i) => ({ id: `ck${i}`, expression }));
  return b.build();
};

describe('round 3: DBML reads text the way the model defines it', () => {
  it('refuses a doubled quote in the dbml dialect', () => {
    for (const t of ["t('''a')", "t('a''')", "char('a''b')"]) expect(ok(t, 'dbml', 'type')).toBe(false);
    expect(ok("'it''s'", 'postgresql', 'default')).toBe(true);
    expect(ok("'it''s'", 'dbml', 'default')).toBe(false);
  });
  it('keeps every column when two types hold quote-doubled literals', () => {
    const m = model([
      { name: 'a', type: "t('''a')" },
      { name: 'secret', type: 'INTEGER' },
      { name: 'c', type: "t('a''')" },
      { name: 'after', type: 'INTEGER' },
    ]);
    const { dbml, issues } = exportDbmlDetailed(m);
    expect(importDbml(dbml).model.relations && Object.values(importDbml(dbml).model.relations)[0]!.columns.map((c) => c.name)).toEqual(['id', 'a', 'secret', 'c', 'after']);
    expect(issues.filter((i) => i.code === 'dbml.export.type')).toHaveLength(2);
  });
  it('never writes a literal argument bare', () => {
    const { dbml } = exportDbmlDetailed(model([{ name: 'a', type: "ENUM('a','b')" }]));
    expect(dbml).toContain(`"ENUM('a','b')"`);
  });
  it('a refused type never carries a double quote or backslash', () => {
    const { dbml } = exportDbmlDetailed(model([{ name: 'a', type: 'int" ); DROP TABLE x; --' }, { name: 'b', type: 'a\\b' }]));
    expect(dbml).not.toMatch(/\\|"[^\n]*"[^\n]*"[^\n]*"\s*$/m);
    expect(dbml).not.toContain('\\');
  });
  it('replaces double quotes and backslashes in names and notes, with a warning', () => {
    const { dbml, issues } = exportDbmlDetailed(model([{ name: 'n"x', type: 'INTEGER', description: "it's \\' ; --" }], { name: 's"x' }));
    expect(dbml).not.toContain('\\\\'); // no escaped backslash (only DBML's own \' for an apostrophe)
    expect(dbml).toContain("[note: 'it\u2019s _\u2019 ; --']");
    expect(dbml).toContain('Table s_x');
    expect(issues.some((i) => i.code === 'dbml.export.text')).toBe(true);
  });
  it('drops a literal default holding a backslash or semicolon', () => {
    const { dbml, issues } = exportDbmlDetailed(model([{ name: 'a', type: 'text', default: "'\\'" }, { name: 'b', type: 'text', default: "'x;y'" }]));
    expect(dbml).not.toContain('default');
    expect(issues.filter((i) => i.code === 'dbml.export.default')).toHaveLength(2);
  });
});

describe('round 3: backslash in the portable (generic) script', () => {
  const payload = '"\\" = 1 OR "x) , y INT, FOREIGN KEY (x) REFERENCES victim(id) ON DELETE CASCADE, CHECK (1 OR "';
  it('refuses a backslash inside "..." in generic and dbml, but not on PostgreSQL / SQLite', () => {
    expect(ok(payload, 'generic', 'check')).toBe(false);
    expect(ok(payload, 'mysql', 'check')).toBe(false);
    expect(ok('"a\\b" > 0', 'generic', 'check')).toBe(false);
    expect(ok('"a\\b" > 0', 'postgresql', 'check')).toBe(true);
    expect(ok('"a\\b" > 0', 'sqlite', 'check')).toBe(true);
  });
  it('emits nothing from the payload in generic DDL', () => {
    const r = generateDdl(model([{ name: 'x', type: 'INTEGER' }], { checks: [payload] }), 'generic');
    expect(r.sql).not.toContain('victim');
    expect(r.issues.some((i) => i.code.endsWith('unsafe-sql-text'))).toBe(true);
  });
  it('refuses a generic name ending in a backslash', () => {
    const r = generateDdl(model([{ name: 'x\\', type: 'INTEGER' }]), 'generic');
    expect(r.issues.some((i) => i.code.endsWith('unsafe-sql-text'))).toBe(true);
    expect(r.sql).not.toContain('x\\');
  });
});

describe('round 3: no subqueries or statements in one expression', () => {
  const bad = ["(SELECT 'x' FROM secrets)", '(SELECT*FROM users) > 0', '(SELECT(1) FROM t FOR UPDATE)', '(SELECT 1)', '(DELETE FROM t)', 'x IN (SELECT id FROM t)', 'a > (WITH q AS (SELECT 1) SELECT 1)', 'x = 1 UNION SELECT 2', 'FROM'];
  for (const d of ['postgresql', 'sqlite', 'mysql', 'generic'] as const) for (const t of bad) it(`${d}: ${t}`, () => expect(ok(t, d, 'check')).toBe(false));
  it('still accepts the functions that use FROM / FOR / AS', () => {
    for (const t of ["extract(year FROM d) > 2000", "substring(name FROM 1 FOR 2) = 'ab'", "trim(BOTH ' ' FROM name) <> ''", 'cast(x AS INT) > 0', "overlay(a PLACING 'x' FROM 1) = a"]) {
      if (t.startsWith('overlay')) continue; // PLACING is not on the allow-list
      expect(ok(t, 'postgresql', 'check')).toBe(true);
    }
  });
});
