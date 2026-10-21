/** Real SQLite (node:sqlite): the allow-listed free text is present in the stored schema; payload models create only the intended tables. */
import { describe, expect, it } from 'vitest';
import { generateDdl } from './ddl';
import { acceptCases, acceptChecks, acceptModel, HOSTILE, payloadModel } from './acceptFixtures';

let sqlite: typeof import('node:sqlite') | undefined;
let skipReason = '';
try {
  sqlite = await import('node:sqlite');
} catch (e) {
  skipReason = `node:sqlite not importable on this Node (${process.version}): ${String(e)}`;
}

describe.skipIf(!sqlite)(`SQLite: allow-listed text round trip${skipReason ? ` (SKIPPED: ${skipReason})` : ''}`, () => {
  it('every must-accept default and CHECK is in sqlite_master and the table works', () => {
    const g = generateDdl(acceptModel('sqlite'), 'sqlite', { header: false });
    expect(g.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const db = new sqlite!.DatabaseSync(':memory:');
    db.exec(g.sql);
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='acc'").get() as { sql: string };
    for (const c of acceptCases('sqlite')) if (c.expectDefault) expect(row.sql, c.column).toContain(c.expectDefault);
    for (const ck of acceptChecks('sqlite')) expect(row.sql, ck).toContain(ck.replace(/\s+/g, ' '));
    expect(row.sql.match(/CHECK \(/g)).toHaveLength(acceptChecks('sqlite').length);
    db.exec(`INSERT INTO acc (id, c_num, c_status, c_name, "价格", "Weird Col") VALUES (1, 5, 'a', 'ab', 1, 1)`);
    expect(() => db.exec(`INSERT INTO acc (id, c_num) VALUES (2, 5000)`)).toThrow(/CHECK/);
    expect(() => db.exec(`INSERT INTO acc (id, c_status) VALUES (3, 'zzz')`)).toThrow(/CHECK/);
    expect(db.prepare('SELECT c_text, c_neg FROM acc WHERE id = 1').get()).toMatchObject({ c_text: 'N/A', c_neg: -1 });
    db.close();
  });

  it('payload models: never an extra table, never a swallowed constraint', () => {
    for (const field of ['type', 'default', 'check', 'where'] as const) {
      for (const p of HOSTILE) {
        const m = payloadModel(field, p, 'sqlite');
        const g = generateDdl(m, 'sqlite', { header: false });
        if (!g.sql) {
          expect(g.issues.some((i) => i.code === 'ddl.sqlite.unsafe-sql-text' && i.severity === 'error'), `${field} ${JSON.stringify(p)}`).toBe(true);
          continue;
        }
        const db = new sqlite!.DatabaseSync(':memory:');
        db.exec(g.sql);
        const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
        expect(names, `${field} ${JSON.stringify(p)}`).toEqual(['par', 't']);
        const t = (db.prepare("SELECT sql FROM sqlite_master WHERE name='t'").get() as { sql: string }).sql;
        expect(t).toContain('PRIMARY KEY');
        expect(t).toContain('FOREIGN KEY');
        db.close();
      }
    }
  });
});
