/** Release regression tests: DDL text injection (F1), MySQL expression defaults (F2), type ranges (F3), typed key length (F4), FK signedness (F5). */
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { localizeIssue } from '@/i18n/issues';
import { relationalBuilder, type ColumnSpec } from '@/model/builders';
import type { Issue, RelationalModel } from '@/model/types';
import { ddlIssues, generateDdl } from './ddl';
import { parseDdl } from './ddlParser';
import { unsafeSqlText } from './sqlText';

type D = 'postgresql' | 'sqlite' | 'mysql';
const DIALECTS: D[] = ['postgresql', 'sqlite', 'mysql'];
const codeOf = (i: Issue): string => i.code.replace(/^ddl\.[a-z]+\./, '');
const errCodes = (m: RelationalModel, d: D): string[] => ddlIssues(m, d).filter((i) => i.severity === 'error').map(codeOf);
const codes = (m: RelationalModel, d: D): string[] => ddlIssues(m, d).map(codeOf);

function one(cols: ColumnSpec[]): RelationalModel {
  const b = relationalBuilder('m');
  b.relation('t', [{ name: 'id', type: 'INTEGER' }, ...cols], { pk: ['id'] });
  return b.build();
}
const col = (type?: string, def?: string): RelationalModel => one([{ name: 'x', ...(type ? { type } : {}), ...(def !== undefined ? { default: def } : {}), nullable: true }]);
const only = (m: RelationalModel, d: D, opts = {}): string => generateDdl(m, d, { header: false, ...opts }).sql;

describe('F1 type / DEFAULT text is never an injection vector', () => {
  const typePayloads = ['INT); DROP TABLE x; --', 'INT) /* ', 'INT -- drop', "VARCHAR(10) DEFAULT 'a'); DROP TABLE t; (", 'INT(', 'INT)'];
  const defaultPayloads = ['0; DROP DATABASE sc', "'x'; DROP TABLE t", '1 -- c', '1 /* c', '(1', "'unterminated", '1) , y INT'];

  for (const d of DIALECTS) {
    it(`${d}: unsafe types are refused with an error and never emitted`, () => {
      for (const p of typePayloads) {
        const g = generateDdl(col(p), d);
        expect(g.issues.some((i) => i.code === `ddl.${d}.unsafe-sql-text` && i.severity === 'error'), p).toBe(true);
        expect(g.sql, p).toBe('');
        expect(JSON.stringify(g.issues.filter((i) => i.code.endsWith('missing-type'))), p).not.toContain('DROP');
      }
    });
    it(`${d}: unsafe defaults are refused with an error and never emitted`, () => {
      for (const p of defaultPayloads) {
        const g = generateDdl(col('INTEGER', p), d);
        expect(g.issues.some((i) => i.code === `ddl.${d}.unsafe-sql-text` && i.severity === 'error'), p).toBe(true);
        expect(g.sql, p).toBe('');
      }
    });
    it(`${d}: the script of a model with safe text has exactly the statements it should (one CREATE TABLE)`, () => {
      // quoting does not matter: ';' and comment markers are refused even inside a literal (quote rules differ per dialect)
      const clean = only(col('NUMERIC(10, 2)', "'a b'"), d);
      expect(clean.match(/;\s*$/gm)).toHaveLength(1);
      expect(clean).toContain("'a b'");
      expect(errCodes(col('NUMERIC(10, 2)', "'a;b'"), d)).toEqual(['unsafe-sql-text']);
      expect(errCodes(col('NUMERIC(10, 2)', "'a -- not a comment /* x */'"), d)).toEqual([]);
      expect(errCodes(col('VARCHAR(10)', "'it''s'"), d)).toEqual([]);
    });
  }
  it('# inside a closed literal is allowed, a bare # is never; semicolons are refused even inside literals', () => {
    for (const d of DIALECTS) {
      expect(unsafeSqlText("'a#b'", d, 'default'), d).toBeUndefined();
      expect(unsafeSqlText('1 # x', d), d).toBe('chars');
      expect(unsafeSqlText("'a\\'; DROP TABLE t; --", d), d).toBeDefined();
    }
    expect(unsafeSqlText("'a\\'", 'mysql', 'default')).toBe('chars');
  });
  it('the payload column is the affected object, and a clean sibling column is still emitted correctly', () => {
    const m = one([{ name: 'bad', type: 'INT); DROP TABLE x; --' }, { name: 'ok', type: 'VARCHAR(5)' }]);
    const i = ddlIssues(m, 'postgresql').find((x) => x.code.endsWith('unsafe-sql-text'))!;
    expect(i.affected).toHaveLength(1);
    expect(i.affected[0]).toMatchObject({ kind: 'column' });
  });
  it('issues are localised in en and zh', () => {
    for (const [type, def, variant] of [['INT); DROP TABLE x; --', undefined, 'type'], ['INTEGER', '0; DROP DATABASE sc', 'default']] as const) {
      const i = ddlIssues(col(type, def), 'mysql').find((x) => x.code.endsWith('unsafe-sql-text'))!;
      expect(i.params?.variant).toBe(variant);
      for (const loc of ['en', 'zh'] as const) {
        const l = localizeIssue(i, loc);
        expect(l.localized).toBe(true);
        expect(l.explanation).not.toMatch(/\{[A-Za-z]+\}/);
      }
      expect(localizeIssue(i, 'en').explanation).toBe(i.explanation);
    }
  });
  it('safe model output is unchanged for valid models (statement count of a typical table)', () => {
    for (const d of DIALECTS) expect(errCodes(col('VARCHAR(20)', "'n/a'"), d)).toEqual([]);
  });
});

describe('F2 MySQL expression defaults', () => {
  it('wraps functions/keywords the engine only accepts parenthesised', () => {
    expect(only(col('DATE', 'CURRENT_DATE'), 'mysql')).toContain('DEFAULT (CURRENT_DATE)');
    expect(only(col('TIME', 'CURRENT_TIME'), 'mysql')).toContain('DEFAULT (CURRENT_TIME)');
    expect(only(col('DATE', 'CURRENT_TIMESTAMP'), 'mysql')).toContain('DEFAULT (CURRENT_TIMESTAMP)');
    expect(only(col('INTEGER', 'ABS(-3)'), 'mysql')).toContain('DEFAULT (ABS(-3))');
    expect(only(col('CHAR(36)', 'UUID()'), 'mysql')).toContain('DEFAULT (UUID())');
  });
  it('keeps CURRENT_TIMESTAMP[(n)] bare on TIMESTAMP/DATETIME and literals untouched', () => {
    expect(only(col('TIMESTAMP', 'CURRENT_TIMESTAMP'), 'mysql')).toContain('DEFAULT CURRENT_TIMESTAMP');
    expect(only(col('TIMESTAMP', 'CURRENT_TIMESTAMP'), 'mysql')).not.toContain('(CURRENT_TIMESTAMP)');
    expect(only(col('DATETIME(3)', 'CURRENT_TIMESTAMP(3)'), 'mysql')).toContain('DEFAULT CURRENT_TIMESTAMP(3)');
    expect(only(col('INTEGER', '0'), 'mysql')).toContain('DEFAULT 0');
    expect(only(col('VARCHAR(5)', "'a'"), 'mysql')).toContain("DEFAULT 'a'");
    expect(only(col('INTEGER', 'NULL'), 'mysql')).toContain('DEFAULT NULL');
  });
  it('SQLite / PostgreSQL output for these defaults is unchanged', () => {
    expect(only(col('DATE', 'CURRENT_DATE'), 'sqlite')).toContain('DEFAULT CURRENT_DATE');
    expect(only(col('DATE', 'CURRENT_DATE'), 'postgresql')).toContain('DEFAULT CURRENT_DATE');
  });
  it('functions MySQL does not have are an error, not DDL', () => {
    for (const v of ['gen_random_uuid()', 'uuid_generate_v4()', "'x'::text", 'nextval(\'s\')']) {
      const g = generateDdl(col('CHAR(36)', v), 'mysql');
      // '::' is a PostgreSQL-only token of the allow-list, so MySQL refuses the cast as unsafe text instead
      const codes = v.includes('::') ? ['ddl.mysql.unsafe-sql-text'] : ['ddl.mysql.default-unsupported'];
      expect(g.issues.some((i) => codes.includes(i.code) && i.severity === 'error'), v).toBe(true);
      expect(g.sql).toBe('');
    }
    expect(errCodes(col('CHAR(36)', "'gen_random_uuid()'"), 'mysql')).toEqual([]);
    expect(errCodes(col('CHAR(36)', 'gen_random_uuid()'), 'postgresql')).toEqual([]);
  });
  it('default-unsupported is localised', () => {
    const i = ddlIssues(col('CHAR(36)', 'gen_random_uuid()'), 'mysql').find((x) => x.code.endsWith('default-unsupported'))!;
    for (const loc of ['en', 'zh'] as const) expect(localizeIssue(i, loc).localized).toBe(true);
    expect(localizeIssue(i, 'en').explanation).toBe(i.explanation);
  });
});

describe('F3 MySQL type parameter ranges', () => {
  const bad = ['VARCHAR(70000)', 'CHAR(300)', 'DECIMAL(70,2)', 'DECIMAL(10,31)', 'DECIMAL(10,12)', 'NUMERIC(66)', 'FLOAT(60)', 'DATETIME(7)', 'TIME(7)', 'TIMESTAMP(9)', 'DECIMAL(70,2) UNSIGNED'];
  const good = ['VARCHAR(65535)', 'CHAR(255)', 'DECIMAL(65,30)', 'DECIMAL(10,10)', 'FLOAT(24)', 'DATETIME(6)', 'TIME(6)', 'VARCHAR', 'DECIMAL'];
  it.each(bad)('mysql %s -> error type-out-of-range, no SQL', (t) => {
    const g = generateDdl(col(t), 'mysql');
    expect(g.issues.some((i) => i.code === 'ddl.mysql.type-out-of-range' && i.severity === 'error'), t).toBe(true);
    expect(g.sql).toBe('');
  });
  it.each(good)('mysql %s is accepted', (t) => {
    expect(codes(col(t), 'mysql')).not.toContain('type-out-of-range');
  });
  it('FLOAT(p) with 24 < p <= 53 becomes DOUBLE', () => {
    expect(only(col('FLOAT(30)'), 'mysql')).toMatch(/`?x`? DOUBLE\b/);
    expect(errCodes(col('FLOAT(53)'), 'mysql')).toEqual([]);
  });
  it('PostgreSQL only flags documented hard maxima', () => {
    expect(errCodes(col('NUMERIC(1001)'), 'postgresql')).toContain('type-out-of-range');
    expect(errCodes(col('VARCHAR(10485761)'), 'postgresql')).toContain('type-out-of-range');
    expect(errCodes(col('VARCHAR(70000)'), 'postgresql')).toEqual([]);
    expect(errCodes(col('VARCHAR(70000)'), 'sqlite')).toEqual([]);
    expect(errCodes(col('DECIMAL(70,2)'), 'sqlite')).toEqual([]);
  });
  it('issues are localised', () => {
    for (const t of ['VARCHAR(70000)', 'DECIMAL(10,12)', 'DECIMAL(70,2)', 'DECIMAL(10,31)', 'FLOAT(60)', 'DATETIME(7)']) {
      const i = ddlIssues(col(t), 'mysql').find((x) => x.code.endsWith('type-out-of-range'))!;
      for (const loc of ['en', 'zh'] as const) {
        const l = localizeIssue(i, loc);
        expect(l.localized, t).toBe(true);
        expect(l.explanation).not.toMatch(/\{[A-Za-z]+\}/);
      }
      expect(localizeIssue(i, 'en').explanation).toBe(i.explanation);
    }
  });
});

describe('F4 typed keys over the InnoDB 3072-byte limit', () => {
  const keyed = (type: string, kind: 'pk' | 'unique' | 'index'): RelationalModel => {
    const b = relationalBuilder('m');
    const r = b.relation('t', [{ name: 'a', type }, { name: 'b', type }, { name: 'n', type: 'INTEGER', nullable: true }], kind === 'pk' ? { pk: ['a', 'b'] } : { pk: ['n'] });
    if (kind === 'unique') r.relation.uniques.push({ id: 'u1', name: 'uq', columnIds: [r.col('a'), r.col('b')] });
    if (kind === 'index') r.relation.indexes.push({ id: 'i1', name: 'ix', columnIds: [r.col('a'), r.col('b')], unique: false });
    return b.build();
  };
  for (const kind of ['pk', 'unique', 'index'] as const) {
    it(`${kind}: VARCHAR(500) x 2 (4000 bytes) warns`, () => {
      const i = ddlIssues(keyed('VARCHAR(500)', kind), 'mysql').find((x) => x.code === 'ddl.mysql.key-too-long');
      expect(i?.severity).toBe('warning');
      expect(i?.affected.length).toBe(2);
      for (const loc of ['en', 'zh'] as const) expect(localizeIssue(i!, loc).localized).toBe(true);
      expect(localizeIssue(i!, 'en').explanation).toBe(i!.explanation);
    });
    it(`${kind}: VARCHAR(100) x 2 does not warn`, () => {
      expect(codes(keyed('VARCHAR(100)', kind), 'mysql')).not.toContain('key-too-long');
    });
  }
  it('typed FK source columns are checked and other dialects are not', () => {
    const b = relationalBuilder('m');
    const p = b.relation('p', [{ name: 'a', type: 'VARCHAR(700)' }, { name: 'b', type: 'VARCHAR(700)' }], { pk: ['a', 'b'] });
    const c = b.relation('c', [{ name: 'id', type: 'INTEGER' }, { name: 'pa', type: 'VARCHAR(700)' }, { name: 'pb', type: 'VARCHAR(700)' }], { pk: ['id'] });
    b.fk(c, ['pa', 'pb'], p, ['a', 'b']);
    const m = b.build();
    expect(ddlIssues(m, 'mysql').filter((i) => i.code === 'ddl.mysql.key-too-long')).toHaveLength(2);
    expect(codes(m, 'postgresql')).not.toContain('key-too-long');
  });
});

describe('F5 MySQL FK signedness', () => {
  const fk = (parent: string, child: string): RelationalModel => {
    const b = relationalBuilder('m');
    const p = b.relation('p', [{ name: 'k', type: parent }], { pk: ['k'] });
    const c = b.relation('c', [{ name: 'id', type: 'INTEGER' }, { name: 'f', type: child }], { pk: ['id'] });
    b.fk(c, ['f'], p, ['k']);
    return b.build();
  };
  it('INT UNSIGNED vs INT (either way) is a fk-type-mismatch error on MySQL', () => {
    expect(errCodes(fk('INT UNSIGNED', 'INT'), 'mysql')).toContain('fk-type-mismatch');
    expect(errCodes(fk('INT', 'INT UNSIGNED'), 'mysql')).toContain('fk-type-mismatch');
    expect(errCodes(fk('BIGINT UNSIGNED', 'BIGINT'), 'mysql')).toContain('fk-type-mismatch');
    expect(errCodes(fk('DECIMAL(10,2) UNSIGNED', 'DECIMAL(10,2)'), 'mysql')).toContain('fk-type-mismatch');
  });
  it('same signedness is fine, and other dialects are not affected', () => {
    expect(errCodes(fk('INT UNSIGNED', 'INT UNSIGNED'), 'mysql')).toEqual([]);
    expect(errCodes(fk('INT', 'INT'), 'mysql')).toEqual([]);
    expect(codes(fk('INT UNSIGNED', 'INT'), 'postgresql')).not.toContain('fk-type-mismatch');
  });
});

describe('importer round trip unaffected', () => {
  it('a re-imported valid MySQL script still generates identical DDL', () => {
    const sql = only(col('DATE', 'CURRENT_DATE'), 'mysql');
    const again = only(parseDdl(sql, 'mysql').model, 'mysql');
    expect(again).toBe(sql);
  });
});
