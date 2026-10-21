/** Release blocker: crafted free text / enum / name fields can never add or alter a statement, on any dialect. */
import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import type { ReferentialAction, RelationalModel } from '@/model/types';
import { ddlIssues, generateDdl } from './ddl';
import { exportDbml } from './dbmlExport';
import { scanSqlText } from './sqlText';

type D = 'postgresql' | 'sqlite' | 'mysql';
const DIALECTS: D[] = ['postgresql', 'sqlite', 'mysql'];
const errs = (m: RelationalModel, d: D): string[] => ddlIssues(m, d).filter((i) => i.severity === 'error').map((i) => i.code.replace(/^ddl\.[a-z]+\./, ''));
const statements = (sql: string): number => (sql.match(/;[ \t]*$/gm) ?? []).length;

interface Fields {
  type?: string;
  def?: string;
  check?: string;
  where?: string;
  method?: string;
  onDelete?: string;
  relName?: string;
  colName?: string;
  projectName?: string;
}
function model(f: Fields = {}): RelationalModel {
  const b = relationalBuilder(f.projectName ?? 'proj');
  const p = b.relation('p', [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
  const t = b.relation(f.relName ?? 't', [{ name: 'id', type: 'INTEGER' }, { name: f.colName ?? 'x', type: f.type ?? 'INTEGER', ...(f.def !== undefined ? { default: f.def } : {}) }, { name: 'pid', type: 'INTEGER' }], { pk: ['id'] });
  b.fk(t, ['pid'], p, ['id'], { name: 'fk_t_p' });
  if (f.onDelete !== undefined) Object.values(b.model.foreignKeys)[0]!.onDelete = f.onDelete as ReferentialAction;
  t.relation.checks = [{ id: 'ck1', expression: f.check ?? 'id > 0' }];
  t.relation.indexes.push({ id: 'ix1', name: 'ix_t', columnIds: [t.col('id')], unique: false, ...(f.where !== undefined ? { where: f.where } : {}), ...(f.method !== undefined ? { method: f.method } : {}) });
  return b.build();
}

const PAYLOADS = [
  '"\\" ) ) ; DROP TABLE t ; -- "', // reviewer 1: MySQL "..." string with backslash escape
  "'\\'' ) ) ; DROP TABLE t ; -- '", // single-quote backslash escape
  '$$ ; DROP TABLE t ; -- $$', // reviewer 2
  '$tag$ ; DROP TABLE t ; -- $tag$',
  "E'\\'' ; DROP TABLE t ; --'", // E'' string
  '1 \\! rm -rf /', // psql / mysql client meta command
  "1\nDROP TABLE t", // newline
  "1\rDROP TABLE t",
  '1\u2028DROP TABLE t',
  '1\u2029DROP TABLE t',
  '1\u0000DROP TABLE t', // NUL
  '1\u0007',
  '1\u007F',
  "'a' /* x */ ; DROP",
  "'a' -- x",
  "'a' */",
  '`a` ; DROP TABLE t',
  "'a''b' ; DROP TABLE t",
  '(1) ; DROP TABLE t',
  '1 # x',
  '"a" ; --',
  "$é$'$é$ ) WITH (fillfactor = $é$'$é$, 70",
  `$${'t'.repeat(70)}$ ; DROP TABLE t ; -- $${'t'.repeat(70)}$`,
  "text DEFAULT $é$''",
  "INTEGER [']) STRICT [']",
  'INTEGER [(]x)',
  "INTEGER ['', \"\\\" ) ) ; DROP TABLE t ; -- \"",
  "E'\\''",
  "'abc",
  'int(1;DROP TABLE x;)',
  'int(1\n}\nTable evil {\n a int\n}\n)',
  '0); DROP TABLE Doctor; --',
  '1=1); DROP TABLE Doctor; --',
  '@x',
  'a[1]',
  '{a}',
];

const refused = (p: string, d: D | 'generic' | 'dbml', kind: 'type' | 'default' | 'check' | 'where' = 'check'): boolean => !scanSqlText(p, d, kind).ok;

describe('scanSqlText (allow-list tokenizer)', () => {
  it('refuses every payload on every dialect, for every kind', () => {
    for (const d of DIALECTS) for (const k of ['type', 'default', 'check', 'where'] as const) for (const p of PAYLOADS) expect(refused(p, d, k), `${d} ${k} ${JSON.stringify(p)}`).toBe(true);
  });
  it('plain text passes', () => {
    for (const d of DIALECTS) for (const ok of ["'it''s fine'", 'VARCHAR(10)', 'NUMERIC(10, 2)', 'now()', 'id > 0 AND x <> 3']) expect(refused(ok, d, 'default'), ok).toBe(false);
  });
});

describe('DDL refuses injected free text on all dialects', () => {
  const clean = Object.fromEntries(DIALECTS.map((d) => [d, generateDdl(model(), d, { header: false })] as const));
  it('the clean model is error free with the expected statements', () => {
    for (const d of DIALECTS) {
      expect(clean[d]!.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(statements(clean[d]!.sql)).toBe(d === 'sqlite' ? 3 : 3); // 2 tables + 1 index
    }
  });
  const fields: Array<[string, (p: string) => Fields]> = [
    ['type', (p) => ({ type: p })],
    ['default', (p) => ({ def: p })],
    ['check', (p) => ({ check: p })],
    ['where', (p) => ({ where: p })],
  ];
  for (const d of DIALECTS) {
    for (const [name, mk] of fields) {
      it(`${d}: ${name} payloads are refused, an error is reported and the script is not produced`, () => {
        for (const p of PAYLOADS) {
          const m = model(mk(p));
          // MySQL has no partial indexes: the WHERE is dropped (never emitted) with a warning instead of an error
          if (name === 'where' && d === 'mysql') {
            const g = generateDdl(m, d, { header: false });
            expect(g.sql, p).not.toContain('DROP TABLE');
            continue;
          }
          const g = generateDdl(m, d, { header: false });
          expect(errs(m, d), `${d} ${name} ${JSON.stringify(p)}`).toContain('unsafe-sql-text');
          expect(g.sql, p).toBe('');
          const issue = g.issues.find((i) => i.code.endsWith('unsafe-sql-text'))!;
          expect(issue.severity).toBe('error');
          expect(issue.affected.length).toBeGreaterThan(0);
        }
      });
    }
    it(`${d}: backtick, nested quote and plain forms of the same fields stay allowed`, () => {
      const g = generateDdl(model({ def: "'a ''quoted'' b'", check: "x <> 'q'", type: 'VARCHAR(10)' }), d, { header: false });
      expect(g.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(statements(g.sql)).toBe(3);
    });
  }
  it('dollar quoting is refused on every dialect', () => {
    for (const d of DIALECTS) expect(errs(model({ def: '$$abc$$' }), d)).toContain('unsafe-sql-text');
  });
});

describe('enum and word fields', () => {
  const bad = ['CASCADE; DROP TABLE Doctor; --', 'CASCADE\nDROP', 'EXPLODE', '', 'SET  NULL;'];
  for (const d of DIALECTS) {
    it(`${d}: onDelete outside the five actions is refused`, () => {
      for (const p of bad) {
        const g = generateDdl(model({ onDelete: p }), d, { header: false });
        expect(g.sql, p).toBe('');
        expect(errs(model({ onDelete: p }), d), p).toContain('unsafe-sql-text');
      }
    });
    it(`${d}: lower-case and spaced actions are normalised`, () => {
      const g = generateDdl(model({ onDelete: 'set  null' }), d, { header: false });
      if (d === 'mysql' || d === 'postgresql' || d === 'sqlite') expect(g.sql).toContain('ON DELETE SET NULL');
    });
    it(`${d}: index method must be a plain word`, () => {
      for (const p of ['btree; DROP TABLE t', 'bt ree', '1btree', 'a-b']) {
        expect(errs(model({ method: p }), d), p).toContain('unsafe-sql-text');
        expect(generateDdl(model({ method: p }), d, { header: false }).sql).toBe('');
      }
      expect(errs(model({ method: 'btree' }), d)).toEqual([]);
    });
  }
});

describe('names and comments', () => {
  it('control characters in identifiers are refused on every dialect', () => {
    for (const d of DIALECTS) {
      for (const name of ['a\u0000b', 'a\nb', 'a\rb', 'a\u2028b']) {
        for (const f of [{ relName: name }, { colName: name }] as Fields[]) {
          const g = generateDdl(model(f), d, { header: false });
          expect(g.sql, `${d} ${JSON.stringify(name)}`).toBe('');
          expect(g.issues.some((i) => i.code.endsWith('unsafe-sql-text') && i.severity === 'error')).toBe(true);
        }
      }
    }
  });
  it('identifier quotes are doubled', () => {
    expect(generateDdl(model({ relName: 'a"b' }), 'postgresql', { header: false }).sql).toContain('"a""b"');
    expect(generateDdl(model({ relName: 'a`b' }), 'mysql', { header: false }).sql).toContain('`a``b`');
    expect(generateDdl(model({ relName: 'a"b' }), 'sqlite', { header: false }).sql).toContain('"a""b"');
  });
  it('a project name cannot break out of the header comment', () => {
    for (const d of DIALECTS) {
      for (const sep of ['\n', '\r', '\u2028', '\u0085', '\r\n']) {
        const sql = generateDdl(model({ projectName: `x${sep}DROP TABLE t; --` }), d).sql;
        const header = sql.split('\n\n')[0]!;
        expect(header.split('\n')).toHaveLength(2);
        expect(sql.split(/[\n\r\u2028\u0085]/).filter((l) => /DROP/.test(l) && !l.startsWith('--'))).toEqual([]);
        expect(statements(sql)).toBe(3);
      }
    }
  });
});

describe('DBML export is not broken by quotes and line breaks', () => {
  it('names, notes, defaults, methods and actions stay on one syntactic line', () => {
    const m = model({ colName: 'a\nb"c', def: "'x\ny'", check: 'id > 0\nAND x', method: 'x"\ny', onDelete: 'CASCADE; DROP' });
    Object.values(m.relations)[1]!.description = "note ' \\ \r\n";
    const out = exportDbml(m);
    expect(out).not.toContain('\r');
    expect(out).not.toMatch(/delete: cascade; drop/i);
    for (const line of out.split('\n')) expect(line.replace(/'(?:[^'\\]|\\.)*'/g, '').replace(/\\"/g, '').split('"').length % 2, line).toBe(1);
  });
});

describe('MySQL fractional seconds', () => {
  const ts = (type: string, def: string): string => {
    const b = relationalBuilder('m');
    b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'at', type, default: def, nullable: false }], { pk: ['id'] });
    return generateDdl(b.build(), 'mysql', { header: false }).sql;
  };
  it('DATETIME(n)/TIMESTAMP(n) take CURRENT_TIMESTAMP(n)', () => {
    expect(ts('DATETIME(3)', 'CURRENT_TIMESTAMP')).toContain('DEFAULT CURRENT_TIMESTAMP(3)');
    expect(ts('TIMESTAMP(6)', 'CURRENT_TIMESTAMP')).toContain('DEFAULT CURRENT_TIMESTAMP(6)');
    expect(ts('TIMESTAMP(6)', 'CURRENT_TIMESTAMP(3)')).toContain('DEFAULT CURRENT_TIMESTAMP(6)');
    expect(ts('TIMESTAMP', 'CURRENT_TIMESTAMP')).toContain('DEFAULT CURRENT_TIMESTAMP,\n'.slice(0, -2) || '');
  });
});
