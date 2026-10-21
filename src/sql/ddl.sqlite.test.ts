/**
 * Executes generated SQLite DDL in a real in-memory engine (node:sqlite). If the module is unavailable the whole
 * file is skipped WITH a reason (see `skipReason`), never silently passed.
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { relationalBuilder } from '@/model/builders';
import type { RelationalModel } from '@/model/types';
import { generateDdl } from './ddl';
import { cycle, kitchenSink, pharmacy, selfRef } from './fixtures';

type Sqlite = typeof import('node:sqlite');
let sqlite: Sqlite | undefined;
let skipReason = '';
try {
  sqlite = await import('node:sqlite');
} catch (e) {
  skipReason = `node:sqlite not importable on this Node (${process.version}): ${String(e)}`;
}

function open(model: RelationalModel): DatabaseSync {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const r = generateDdl(model, 'sqlite');
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  db.exec(r.sql);
  return db;
}
const run = (db: DatabaseSync, sql: string, ...p: Array<string | number | null>) => db.prepare(sql).run(...p);
const throws = (db: DatabaseSync, sql: string, ...p: Array<string | number | null>): string => {
  try {
    run(db, sql, ...p);
  } catch (e) {
    return String((e as Error).message);
  }
  return '';
};

describe.skipIf(!sqlite)(`generated SQLite DDL runs in a real engine${skipReason ? ` (SKIPPED: ${skipReason})` : ''}`, () => {
  it('pharmacy: creates every table and enforces simple and composite FKs', () => {
    const db = open(pharmacy('sqlite'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => String(r.name));
    expect(tables).toEqual(['Company', 'Contact', 'Doctor', 'Drug', 'Patient', 'Pharmacy', 'Prescription', 'Sell']);

    run(db, 'INSERT INTO Company(Name) VALUES (?)', 'Pfizer');
    run(db, 'INSERT INTO Company(Name) VALUES (?)', 'Bayer');
    run(db, 'INSERT INTO Drug(CompanyName, TradeName) VALUES (?, ?)', 'Pfizer', 'Zoloft');
    run(db, 'INSERT INTO Doctor(SSN) VALUES (?)', 'D1');
    run(db, 'INSERT INTO Patient(SSN, DoctorSSN) VALUES (?, ?)', 'P1', 'D1');
    // simple FK violation
    expect(throws(db, 'INSERT INTO Patient(SSN, DoctorSSN) VALUES (?, ?)', 'P2', 'NOPE')).toMatch(/FOREIGN KEY/i);
    // composite FK: valid pair
    run(db, 'INSERT INTO Prescription(DoctorSSN, PatientSSN, CompanyName, DrugTradeName, Date) VALUES (?,?,?,?,?)', 'D1', 'P1', 'Pfizer', 'Zoloft', '2024-01-01');
    // composite FK: both halves exist individually (Bayer is a company, Zoloft a drug) but NOT as a pair
    expect(throws(db, 'INSERT INTO Prescription(DoctorSSN, PatientSSN, CompanyName, DrugTradeName, Date) VALUES (?,?,?,?,?)', 'D1', 'P1', 'Bayer', 'Zoloft', '2024-01-02')).toMatch(/FOREIGN KEY/i);
    // ON DELETE CASCADE from Company -> Drug; Sell restricts Drug deletes
    run(db, 'INSERT INTO Pharmacy(Name) VALUES (?)', 'CVS');
    run(db, 'INSERT INTO Sell(PharmacyName, CompanyName, TradeName) VALUES (?,?,?)', 'CVS', 'Pfizer', 'Zoloft');
    expect(throws(db, 'DELETE FROM Company WHERE Name = ?', 'Pfizer')).toMatch(/FOREIGN KEY/i); // cascades to Drug, blocked by Sell RESTRICT
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('pharmacy: the composite FK is reported by SQLite as ONE constraint over both columns in key order', () => {
    const db = open(pharmacy('sqlite'));
    const fks = db.prepare('PRAGMA foreign_key_list("Prescription")').all();
    const drug = fks.filter((r) => r.table === 'Drug').sort((a, b) => Number(a.seq) - Number(b.seq));
    expect(drug.map((r) => [r.from, r.to])).toEqual([
      ['CompanyName', 'CompanyName'],
      ['DrugTradeName', 'TradeName'],
    ]);
    expect(new Set(drug.map((r) => r.id)).size).toBe(1);
  });

  it('self-referencing FK with AUTOINCREMENT key', () => {
    const db = open(selfRef('sqlite'));
    const id1 = Number(run(db, 'INSERT INTO Employee(Name) VALUES (?)', 'Boss').lastInsertRowid);
    const id2 = Number(run(db, 'INSERT INTO Employee(Name, ManagerEid) VALUES (?, ?)', 'Worker', id1).lastInsertRowid);
    expect([id1, id2]).toEqual([1, 2]);
    expect(throws(db, 'INSERT INTO Employee(Name, ManagerEid) VALUES (?, ?)', 'Ghost', 99)).toMatch(/FOREIGN KEY/i);
    run(db, 'DELETE FROM Employee WHERE Eid = ?', id1); // ON DELETE SET NULL
    expect(db.prepare('SELECT ManagerEid FROM Employee WHERE Eid = ?').get(id2)).toEqual({ ManagerEid: null });
    // AUTOINCREMENT means a deleted max id is never reused
    expect(Number(run(db, 'INSERT INTO Employee(Name) VALUES (?)', 'New').lastInsertRowid)).toBe(3);
  });

  it('FK cycle: inline forward references work and the cycle is enforceable', () => {
    const db = open(cycle('sqlite'));
    run(db, 'INSERT INTO A(id, b_id) VALUES (1, NULL)');
    run(db, 'INSERT INTO B(id, a_id) VALUES (10, 1)');
    run(db, 'UPDATE A SET b_id = 10 WHERE id = 1');
    expect(throws(db, 'UPDATE A SET b_id = 11 WHERE id = 1')).toMatch(/FOREIGN KEY/i);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('kitchen sink: defaults, unique, check, indexes and composite PK', () => {
    const db = open(kitchenSink('sqlite'));
    run(db, 'INSERT INTO users(email) VALUES (?)', 'a@x');
    expect(db.prepare('SELECT status, score FROM users').get()).toEqual({ status: 'active', score: 0 });
    expect(throws(db, 'INSERT INTO users(email) VALUES (?)', 'a@x')).toMatch(/UNIQUE/i);
    expect(throws(db, 'INSERT INTO users(email, score) VALUES (?, ?)', 'b@x', -1)).toMatch(/CHECK/i);
    run(db, 'INSERT INTO "order"("user id", "No") VALUES (1, 1)');
    expect(throws(db, 'INSERT INTO "order"("user id", "No") VALUES (1, 1)')).toMatch(/UNIQUE|PRIMARY/i);
    expect(throws(db, 'INSERT INTO "order"("user id", "No") VALUES (7, 1)')).toMatch(/FOREIGN KEY/i);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all();
    expect(idx.map((r) => r.name)).toEqual(['idx_users_created', 'idx_users_status']);
  });

  it('a unique-index FK target and a partial index are accepted', () => {
    const b = relationalBuilder('u', 'sqlite');
    const p = b.relation('P', [{ name: 'id', type: 'INTEGER' }, { name: 'code', type: 'TEXT' }], { pk: ['id'] });
    p.index('uq_code', ['code'], true);
    p.index('ix_partial', ['id'], false);
    p.relation.indexes[1]!.where = 'id > 5';
    const c = b.relation('C', [{ name: 'id', type: 'INTEGER' }, { name: 'code', type: 'TEXT' }], { pk: ['id'] });
    b.fk(c, ['code'], p, ['code']);
    const db = open(b.build());
    run(db, "INSERT INTO P(id, code) VALUES (1, 'x')");
    run(db, "INSERT INTO C(id, code) VALUES (1, 'x')");
    expect(throws(db, "INSERT INTO C(id, code) VALUES (2, 'y')")).toMatch(/FOREIGN KEY/i);
  });

  it('quoted identifiers with spaces, quotes and reserved words execute', () => {
    const b = relationalBuilder('q', 'sqlite');
    const t = b.relation('Odd "name"', [{ name: 'select', type: 'INTEGER' }, { name: 'a b', type: 'TEXT', nullable: true }], { pk: ['select'] });
    const u = b.relation('group', [{ name: 'k', type: 'INTEGER' }], { pk: ['k'] });
    b.fk(u, ['k'], t, ['select']);
    const db = open(b.build());
    run(db, 'INSERT INTO "Odd ""name"""("select", "a b") VALUES (1, ?)', 'v');
    run(db, 'INSERT INTO "group"(k) VALUES (1)');
  });
});
