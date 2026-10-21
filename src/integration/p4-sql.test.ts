// @vitest-environment node
import './deterministic';
/** P4 SQL (default tier): DDL executed in node:sqlite, DDL parse round trip, DBML round trip. */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { exportDbml, generateDdl, importDbml, parseDdl } from '@/sql';
import { EXAMPLES, EXAMPLE_KEYS, convertInStore, relModelOf, setupEr, type ExampleKey } from './helpers';
import { signature } from './sqlSig';

async function relational(key: ExampleKey) {
  const s = setupEr(EXAMPLES[key]());
  const c = await convertInStore(s);
  return relModelOf(s.store.getState().project, c.relModelId);
}

describe.each(EXAMPLE_KEYS)('P4 sql example %s', (key) => {
  it('sqlite DDL executes in node:sqlite and foreign_key_check is clean', async () => {
    const m = await relational(key);
    const g = generateDdl(m, 'sqlite');
    expect(g.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(g.sql);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(Object.values(m.relations).map((r) => r.name).sort());
    // FK list in sqlite matches the model's FK count (composite FK = one constraint with several columns)
    let fkCount = 0;
    for (const t of tables) {
      const rows = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all() as Array<{ id: number }>;
      fkCount += new Set(rows.map((r) => r.id)).size;
    }
    expect(fkCount).toBe(Object.keys(m.foreignKeys).length);
    db.close();
  });

  for (const dialect of ['postgresql', 'sqlite'] as const) {
    it(`parseDdl(generateDdl(${dialect})) is structurally equal to the converted model`, async () => {
      const m = await relational(key);
      const g = generateDdl(m, dialect);
      expect(g.sql).not.toBe('');
      const parsed = parseDdl(g.sql, dialect);
      expect(parsed.model.relations && Object.keys(parsed.model.relations).length).toBe(Object.keys(m.relations).length);
      expect(signature(parsed.model)).toEqual(signature(m));
    });
  }

  it('DBML export -> import is structurally equal', async () => {
    const m = await relational(key);
    const back = importDbml(exportDbml(m)).model;
    expect(signature(back)).toEqual(signature(m));
  });

  it('mysql DDL for the converted model is generated without errors', async () => {
    const m = await relational(key);
    const g = generateDdl(m, 'mysql');
    expect(g.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual([]);
  });
});

describe('P4 sqlite: Pharmacy composite FKs are enforced', () => {
  it('rejects a Prescription whose (Company, Trade) pair is not a Drug even though both values exist', async () => {
    const m = await relational('E');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(generateDdl(m, 'sqlite').sql);
    db.exec(`
      INSERT INTO "Company"(name, phone) VALUES ('Pfizer','1'),('Bayer','2');
      INSERT INTO "Drug"("CompanyName","TradeName","Formula") VALUES ('Pfizer','Advil','x'),('Bayer','Aspirin','y');
      INSERT INTO "Doctor"("SSN","Name","Specialty","YearsOfExperience") VALUES ('111111111','Dr','GP',5);
      INSERT INTO "Patient"("SSN","Name","Address","Age","DoctorSSN") VALUES ('222222222','P','a',30,'111111111');
      INSERT INTO "Pharmacy"("Name","Address","Phone") VALUES ('CVS','a','1');
      INSERT INTO "Prescription"("DoctorSSN","PatientSSN","CompanyName","DrugTradeName","Date","Quantity") VALUES ('111111111','222222222','Pfizer','Advil','2026-01-01',2);
      INSERT INTO "Sell"("PharmacyName","CompanyName","DrugTradeName","Price") VALUES ('CVS','Bayer','Aspirin',3.5);
    `);
    const bad = () => db.exec(`INSERT INTO "Prescription"("DoctorSSN","PatientSSN","CompanyName","DrugTradeName","Date","Quantity") VALUES ('111111111','222222222','Pfizer','Aspirin','2026-01-02',1)`);
    expect(bad).toThrow(/FOREIGN KEY/i);
    expect(() => db.exec(`INSERT INTO "Sell"("PharmacyName","CompanyName","DrugTradeName","Price") VALUES ('CVS','Bayer','Advil',1)`)).toThrow(/FOREIGN KEY/i);
    expect(() => db.exec(`INSERT INTO "Drug"("CompanyName","TradeName","Formula") VALUES ('Nobody','Z','q')`)).toThrow(/FOREIGN KEY/i);
    expect(() => db.exec(`INSERT INTO "Drug"("CompanyName","TradeName","Formula") VALUES ('Pfizer','Advil','dup')`)).toThrow(/UNIQUE|PRIMARY/i);
    expect(() => db.exec(`INSERT INTO "Patient"("SSN","Name","Address","Age","DoctorSSN") VALUES ('3','P','a',3,NULL)`)).toThrow(/NOT NULL/i);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
