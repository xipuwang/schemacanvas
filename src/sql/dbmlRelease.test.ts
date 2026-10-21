/** DBML export hardening from the release review: nothing a crafted project carries reaches DBML in a form dbml2sql turns into SQL. */
import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { exportDbmlDetailed } from './dbmlExport';

const one = (col: { name: string; type?: string; default?: string; description?: string }, relName = 't') => {
  const b = relationalBuilder('M', 'generic');
  b.relation(relName, [{ name: 'id', type: 'INTEGER' }, col], { pk: ['id'] });
  return exportDbmlDetailed(b.build());
};

describe('DBML export (release review)', () => {
  it('a refused data type is replaced by text, never written even quoted', () => {
    for (const type of ['INT; DROP TABLE users; --', 'int); DROP TABLE victim; --', 'a" ; DROP TABLE users; --']) {
      const r = one({ name: 'x', type });
      expect(r.dbml).not.toContain('DROP');
      expect(r.dbml).toMatch(/\n {2}x text\b/);
      expect(r.issues.map((i) => i.code)).toContain('dbml.export.type');
    }
  });
  it('a literal default containing a quote is dropped (dbml2sql would emit it as a bare quote)', () => {
    for (const d of ["'1'', evil int REFERENCES victim(id) ON DELETE CASCADE, z text DEFAULT ''1'", "'it''s'", "'a'' REFERENCES p (id) -- '"]) {
      const r = one({ name: 'x', type: 'TEXT', default: d });
      expect(r.dbml).not.toContain('default:');
      expect(r.dbml).not.toContain('REFERENCES');
    }
    expect(one({ name: 'x', type: 'TEXT', default: "'N/A'" }).dbml).toContain("[default: 'N/A']");
  });
  it('backticks, brackets and single quotes in names and notes are replaced (SQL identifier quotes downstream)', () => {
    const r = one({ name: 'c`, evil int, `d', type: 'INT', description: "it's'; DROP TABLE p; --" }, 'x]; DROP TABLE users; -- ');
    expect(r.dbml).not.toContain('`');
    expect(r.dbml).toContain('Table "x_; DROP TABLE users; -- "');
    expect(r.dbml).toContain('"c_, evil int, _d"');
    expect(r.dbml).not.toContain("it's");
    expect(r.dbml).toContain('it\u2019s\u2019');
    expect(r.issues.map((i) => i.code)).toContain('dbml.export.text');
  });
});

describe('DBML export (final gate)', () => {
  it('replaced names stay unique and the DBML re-imports (a\'b next to a’b, x[1] next to x_1_)', async () => {
    const { importDbml } = await import('./dbmlImport');
    const b = relationalBuilder('M', 'generic');
    b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: "a'b", type: 'INT' }, { name: 'a’b', type: 'INT' }, { name: 'x[1]', type: 'INT' }, { name: 'x_1_', type: 'INT' }], { pk: ['id'] });
    b.relation("O'Brien", [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
    const r = exportDbmlDetailed(b.build());
    const back = importDbml(r.dbml);
    // importDbml throws on a duplicate column or table, so reaching this line already proves the names stayed unique
    const cols = Object.values(back.model.relations).find((x) => x.name === 't')!.columns.map((c) => c.name);
    expect(new Set(cols.map((c) => c.toLowerCase())).size).toBe(cols.length);
    expect(cols).toContain('a’b'); // the original typographic name keeps its spelling; the replaced one is suffixed
    expect(cols).toContain('x_1_');
    expect(Object.values(back.model.relations).map((x) => x.name)).toContain('O’Brien');
  });
  it('a quoted literal default with an apostrophe is reported with its own explanation', () => {
    const r = one({ name: 'x', type: 'TEXT', default: "'O''Brien'" });
    expect(r.issues.map((i) => i.code)).toContain('dbml.export.default-quote');
  });
});
