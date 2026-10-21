// @vitest-environment node
import './deterministic';
/**
 * P4 MySQL tier (INTEGRATION_MYSQL=1): generated MySQL DDL runs on a REAL MySQL server. The server is a throwaway Docker container
 * (default name `schemacanvas-mysql`, override with MYSQL_CONTAINER; root password `sc`) reached through `docker exec ... mysql`;
 * no client library is needed. Every case gets its own fresh database (`sc_t_*`) that is dropped afterwards. The container itself
 * is never started, stopped or removed here.
 */
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import type { RelationalModel } from '@/model/types';
import { generateDdl, parseDdl } from '@/sql';
import { cycle, kitchenSink, selfRef } from '@/sql/fixtures';
import { acceptCases, acceptChecks, acceptModel, HOSTILE, payloadModel } from '@/sql/acceptFixtures';
import type { DdlOptions } from '@/sql';
import { EXAMPLES, EXAMPLE_KEYS, convertInStore, relModelOf, setupEr, type ExampleKey } from './helpers';
import { signature } from './sqlSig';

const CONTAINER = process.env.MYSQL_CONTAINER ?? 'schemacanvas-mysql';
const run = process.env.INTEGRATION_MYSQL ? describe : describe.skip;

interface Out {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs SQL in `db` (or the server when omitted); `-e` style input via stdin. Rows come back tab separated, no header. */
function mysql(sql: string, db?: string): Out {
  const r = spawnSync('docker', ['exec', '-i', '-e', 'MYSQL_PWD=sc', CONTAINER, 'mysql', '-uroot', '--default-character-set=utf8mb4', '-N', '-B', ...(db ? [db] : [])], { input: sql, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const rows = (sql: string, db: string): string[][] => {
  const r = mysql(sql, db);
  expect(r.stderr, `query: ${sql}`).toBe('');
  return r.stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
};

const created: string[] = [];
let seq = 0;
function freshDb(tag: string): string {
  const db = `sc_t_${tag}_${seq++}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  created.push(db);
  expect(mysql(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4`).stderr).toBe('');
  return db;
}

const colName = (m: RelationalModel, rid: string, cid: string): string => m.relations[rid]!.columns.find((c) => c.id === cid)!.name;

/** Executes the generated DDL, then compares the live catalogue with the model. Returns the database name. */
function createAndVerify(m: RelationalModel, tag: string, opts: DdlOptions = {}): string {
  const g = generateDdl(m, 'mysql', opts);
  expect(g.issues.filter((i) => i.severity === 'error').map((i) => i.code), 'generator errors').toEqual([]);
  expect(g.sql).not.toBe('');
  const db = freshDb(tag);
  const r = mysql(g.sql, db);
  expect(r.stderr, `mysql stderr for ${tag}\n${g.sql}`).toBe('');
  expect(r.status).toBe(0);

  const rels = Object.values(m.relations);
  // tables
  const tables = rows(`SELECT table_name FROM information_schema.tables WHERE table_schema='${db}' AND table_type='BASE TABLE'`, db).map((x) => x[0]!);
  expect(tables.sort()).toEqual(rels.map((x) => x.name).sort());
  for (const rel of rels) {
    // columns present, in order, with the right nullability (PK columns are always NOT NULL)
    const cols = rows(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='${db}' AND table_name='${rel.name}' ORDER BY ordinal_position`, db);
    expect(cols, `${rel.name} columns`).toEqual(rel.columns.map((c) => [c.name, !rel.primaryKey.includes(c.id) && c.nullable ? 'YES' : 'NO']));
    // primary key, in key order
    const pk = rows(`SELECT column_name FROM information_schema.key_column_usage WHERE table_schema='${db}' AND table_name='${rel.name}' AND constraint_name='PRIMARY' ORDER BY ordinal_position`, db);
    expect(pk.map((x) => x[0]), `${rel.name} PK`).toEqual(rel.primaryKey.map((id) => colName(m, rel.id, id)));
    // unique keys: every model UNIQUE exists as a non-PRIMARY unique index with those columns in that order
    const idx = rows(`SELECT index_name, non_unique, column_name FROM information_schema.statistics WHERE table_schema='${db}' AND table_name='${rel.name}' ORDER BY index_name, seq_in_index`, db);
    const byIdx = new Map<string, { unique: boolean; cols: string[] }>();
    for (const [n, nu, c] of idx as [string, string, string][]) {
      const e = byIdx.get(n) ?? { unique: nu === '0', cols: [] };
      e.cols.push(c);
      byIdx.set(n, e);
    }
    const uniques = [...byIdx.entries()].filter(([n, e]) => n !== 'PRIMARY' && e.unique).map(([, e]) => e.cols.join(','));
    for (const u of rel.uniques) {
      expect(uniques, `${rel.name} UNIQUE`).toContain(u.columnIds.map((id) => colName(m, rel.id, id)).join(','));
    }
    // no extra unique constraint beyond the model's (indexes declared with unique=true count as unique too)
    const declared = rel.uniques.length + rel.indexes.filter((i) => i.unique).length;
    expect(uniques.length, `${rel.name} unique count`).toBe(declared);
    for (const i of rel.indexes) {
      const live = byIdx.get(i.name);
      expect(live, `${rel.name} index ${i.name}`).toBeDefined();
      expect(live!.cols).toEqual(i.columnIds.map((id) => colName(m, rel.id, id)));
      expect(live!.unique).toBe(i.unique);
    }
  }

  // foreign keys: one live constraint per model FK with the same ordered (column -> referenced column) pairs
  const live = new Map<string, string[]>();
  for (const [t, cn, c, rt, rc] of rows(
    `SELECT table_name, constraint_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema='${db}' AND referenced_table_name IS NOT NULL ORDER BY table_name, constraint_name, ordinal_position`,
    db,
  ) as [string, string, string, string, string][]) {
    const k = `${t}|${cn}`;
    live.set(k, [...(live.get(k) ?? []), `${t}.${c}>${rt}.${rc}`]);
  }
  const expected = Object.values(m.foreignKeys).map((fk) =>
    fk.columns.map((p) => `${m.relations[fk.sourceRelationId]!.name}.${colName(m, fk.sourceRelationId, p.sourceColumnId)}>${m.relations[fk.targetRelationId]!.name}.${colName(m, fk.targetRelationId, p.targetColumnId)}`),
  );
  expect(live.size, 'FK count').toBe(Object.keys(m.foreignKeys).length);
  const norm = (l: string[]): string => [...l].sort().join(';');
  expect([...live.values()].map(norm).sort()).toEqual(expected.map(norm).sort());
  // referential actions
  for (const fk of Object.values(m.foreignKeys)) {
    const src = m.relations[fk.sourceRelationId]!.name;
    const [row] = rows(
      `SELECT rc.delete_rule, rc.update_rule FROM information_schema.referential_constraints rc JOIN information_schema.key_column_usage k ON k.constraint_schema=rc.constraint_schema AND k.constraint_name=rc.constraint_name AND k.table_name=rc.table_name WHERE rc.constraint_schema='${db}' AND rc.table_name='${src}' AND k.column_name='${colName(m, fk.sourceRelationId, fk.columns[0]!.sourceColumnId)}' AND k.ordinal_position=1`,
      db,
    );
    // MySQL reports an omitted action as NO ACTION (RESTRICT is the same behaviour)
    expect(row![0]).toBe(fk.onDelete ?? 'NO ACTION');
    expect(row![1]).toBe(fk.onUpdate ?? 'NO ACTION');
  }
  return db;
}

async function relational(key: ExampleKey, carryDataTypes = true): Promise<RelationalModel> {
  const s = setupEr(EXAMPLES[key]());
  const c = await convertInStore(s, { carryDataTypes });
  return relModelOf(s.store.getState().project, c.relModelId);
}

/** Models with the shapes that are classically hard for MySQL: wide string keys, reserved words, odd names, AUTO_INCREMENT, indexes. */
function textKeys(keyType: string | undefined = 'VARCHAR(100)', lob = 'TEXT'): RelationalModel {
  const b = relationalBuilder('TextKeys', 'mysql');
  const t = (type: string | undefined) => (type ? { type } : {});
  const p = b.relation(
    'P',
    [{ name: 'code', ...t(keyType) }, { name: 'sub', ...t(keyType) }, { name: 'note', type: lob, nullable: true }, { name: 'tag', ...t(keyType), nullable: true, unique: true }],
    { pk: ['code', 'sub'] },
  );
  const c = b.relation('C', [{ name: 'id', type: 'INTEGER' }, { name: 'pcode', ...t(keyType) }, { name: 'psub', ...t(keyType) }], { pk: ['id'] });
  b.fk(c, ['pcode', 'psub'], p, ['code', 'sub'], { name: 'fk_c_p', onDelete: 'CASCADE' });
  return b.build();
}
/** Typed VARCHAR(700) + untyped PK column: only the key's untyped columns (and FK-linked ones) shrink; `free` stays VARCHAR(255). */
function varchar700UntypedKey(): RelationalModel {
  const b = relationalBuilder('Mixed', 'mysql');
  const p = b.relation('M', [{ name: 'a', type: 'VARCHAR(700)' }, { name: 'b' }, { name: 'free' }], { pk: ['a', 'b'] });
  const c = b.relation('N', [{ name: 'id', type: 'INTEGER' }, { name: 'ma', type: 'VARCHAR(700)' }, { name: 'mb' }, { name: 'other' }], { pk: ['id'] });
  b.fk(c, ['ma', 'mb'], p, ['a', 'b']);
  return b.build();
}
/** Many untyped columns in one key: the 255 fallback would exceed InnoDB's 3072-byte key limit. */
function untypedWideKey(): RelationalModel {
  const b = relationalBuilder('Wide', 'mysql');
  const names = ['a', 'b', 'c', 'd', 'e'];
  const p = b.relation('W', names.map((n) => ({ name: n })), { pk: names });
  const c = b.relation('X', [{ name: 'id', type: 'INTEGER' }, ...names.map((n) => ({ name: `w_${n}` }))], { pk: ['id'] });
  b.fk(c, names.map((n) => `w_${n}`), p, names);
  return b.build();
}
function reserved(): RelationalModel {
  const b = relationalBuilder('Reserved', 'mysql');
  const o = b.relation('order', [{ name: 'select', type: 'INTEGER' }, { name: 'group by', type: 'VARCHAR(20)' }, { name: 'key', type: 'VARCHAR(20)', nullable: true }], { pk: ['select'] });
  const i = b.relation('index', [{ name: 'from', type: 'INTEGER' }, { name: 'order id', type: 'INTEGER', nullable: false }], { pk: ['from'] });
  b.fk(i, ['order id'], o, ['select']);
  return b.build();
}

run('P4 mysql: generated DDL on a real MySQL server', () => {
  beforeAll(() => {
    const v = mysql('SELECT VERSION()');
    if (v.status !== 0) throw new Error(`MySQL container "${CONTAINER}" is not reachable: ${v.stderr}`);
  }, 30_000);
  afterAll(() => {
    for (const db of created) mysql(`DROP DATABASE IF EXISTS \`${db}\``);
  }, 60_000);

  for (const key of EXAMPLE_KEYS) {
    it(`example ${key}: DDL executes; tables, PKs, FKs, NOT NULL, UNIQUE match information_schema`, async () => {
      createAndVerify(await relational(key), `ex_${key}`);
    }, 60_000);
  }

  const variants: Array<[string, DdlOptions]> = [
    ['quoteAll', { quoteAll: true }],
    ['ifNotExists', { ifNotExists: true }],
    ['noHeader', { header: false }],
  ];
  for (const [name, opts] of variants) {
    for (const key of EXAMPLE_KEYS) {
      it(`example ${key} with option ${name}`, async () => {
        createAndVerify(await relational(key), `${name}_${key}`, opts);
      }, 60_000);
    }
  }

  for (const key of EXAMPLE_KEYS) {
    it(`example ${key} converted without data types (untyped columns)`, async () => {
      createAndVerify(await relational(key, false), `nt_${key}`);
    }, 60_000);
  }

  it('Pharmacy: running the same script twice with IF NOT EXISTS is idempotent', async () => {
    const m = await relational('E');
    const g = generateDdl(m, 'mysql', { ifNotExists: true });
    const db = freshDb('twice');
    expect(mysql(g.sql, db).stderr).toBe('');
    expect(mysql(g.sql, db).stderr).toBe('');
  }, 60_000);

  it.each([
    ['self reference + AUTO_INCREMENT', () => selfRef('mysql')],
    ['FK cycle', () => cycle('mysql')],
    ['kitchen sink (defaults, indexes, checks, composite FK)', () => kitchenSink('mysql')],
    ['VARCHAR keys + TEXT note, composite FK', () => textKeys()],
    ['untyped wide composite key and FK', untypedWideKey],
    ['VARCHAR(700) + untyped PK, unrelated untyped column', varchar700UntypedKey],
    ['reserved words and spaces in names', reserved],
  ])('hand-built model: %s', (name, make) => {
    createAndVerify(make(), String(name).replace(/\W+/g, '_').slice(0, 14));
  }, 60_000);

  it('Pharmacy: composite FKs are enforced by MySQL (valid rows succeed, violating rows fail)', async () => {
    const m = await relational('E');
    const db = freshDb('rows');
    expect(mysql(generateDdl(m, 'mysql').sql, db).stderr).toBe('');
    const ok = mysql(
      `
      INSERT INTO Company(Name, Phone) VALUES ('Pfizer','1'),('Bayer','2');
      INSERT INTO Drug(CompanyName, TradeName, Formula) VALUES ('Pfizer','Advil','x'),('Bayer','Aspirin','y');
      INSERT INTO Doctor(SSN, Name, Specialty, YearsOfExperience) VALUES ('111111111','Dr','GP',5);
      INSERT INTO Patient(SSN, Name, Address, Age, DoctorSSN) VALUES ('222222222','P','a',30,'111111111');
      INSERT INTO Pharmacy(Name, Address, Phone) VALUES ('CVS','a','1');
      INSERT INTO Prescription(DoctorSSN, PatientSSN, CompanyName, DrugTradeName, \`Date\`, Quantity) VALUES ('111111111','222222222','Pfizer','Advil','2026-01-01',2);
      INSERT INTO Sell(PharmacyName, CompanyName, DrugTradeName, Price) VALUES ('CVS','Bayer','Aspirin',3.5);`,
      db,
    );
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    // both values exist individually (Pfizer, Aspirin) but not as a pair: only a TRUE composite FK rejects this
    const bad = mysql(`INSERT INTO Prescription(DoctorSSN, PatientSSN, CompanyName, DrugTradeName, \`Date\`, Quantity) VALUES ('111111111','222222222','Pfizer','Aspirin','2026-01-02',1)`, db);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/foreign key constraint fails/i);
    const bad2 = mysql(`INSERT INTO Sell(PharmacyName, CompanyName, DrugTradeName, Price) VALUES ('CVS','Bayer','Advil',1)`, db);
    expect(bad2.stderr).toMatch(/foreign key constraint fails/i);
    expect(mysql(`INSERT INTO Drug(CompanyName, TradeName, Formula) VALUES ('Pfizer','Advil','dup')`, db).stderr).toMatch(/Duplicate entry/i);
    expect(mysql(`INSERT INTO Patient(SSN, Name, Address, Age, DoctorSSN) VALUES ('3','P','a',3,NULL)`, db).stderr).toMatch(/cannot be null/i);
    // the weak entity's identifying FK has no ON DELETE rule (the converter emits none, so NO ACTION): deleting an owner that still has dependants is rejected, not cascaded
    expect(mysql(`DELETE FROM Company WHERE Name='Pfizer'`, db).stderr).toMatch(/foreign key constraint fails/i); // rejected: Drug (NO ACTION) still references Pfizer
    expect(rows(`SELECT COUNT(*) FROM Drug`, db)[0]![0]).toBe('2');
  }, 60_000);

  it('VARCHAR(700) + untyped PK: key column narrowed (VARCHAR(68)), unrelated untyped columns stay VARCHAR(255), on the server', () => {
    const m = varchar700UntypedKey();
    const g = generateDdl(m, 'mysql');
    expect(g.sql).toContain('VARCHAR(68)');
    const db = createAndVerify(m, 'v700');
    const len = (t: string, c: string): string => rows(`SELECT character_maximum_length FROM information_schema.columns WHERE table_schema='${db}' AND table_name='${t}' AND column_name='${c}'`, db)[0]![0]!;
    expect(len('M', 'b')).toBe('68');
    expect(len('N', 'mb')).toBe('68');
    expect(len('M', 'free')).toBe('255');
    expect(len('N', 'other')).toBe('255');
  }, 60_000);

  it('a TEXT column in a key is refused by the generator instead of producing DDL MySQL rejects', () => {
    const g = generateDdl(textKeys('TEXT'), 'mysql');
    expect(g.sql).toBe('');
    expect(g.issues.some((i) => i.code === 'ddl.mysql.key-lob-column' && i.severity === 'error')).toBe(true);
    // ... and that is what the server really does with the equivalent hand-written script
    const db = freshDb('lobkey');
    expect(mysql('CREATE TABLE t (a TEXT NOT NULL, PRIMARY KEY (a))', db).stderr).toMatch(/BLOB\/TEXT column 'a' used in key specification without a key length/);
  }, 60_000);

  it('release F2: DATE/TIME/expression defaults the generator parenthesises are accepted by the server', () => {
    const b = relationalBuilder('Defaults', 'mysql');
    b.relation(
      'D',
      [
        { name: 'id', type: 'INTEGER' },
        { name: 'd', type: 'DATE', default: 'CURRENT_DATE', nullable: true },
        { name: 't', type: 'TIME', default: 'CURRENT_TIME', nullable: true },
        { name: 'd2', type: 'DATE', default: 'CURRENT_TIMESTAMP', nullable: true },
        { name: 'ts', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP', nullable: true },
        { name: 'dt', type: 'DATETIME(3)', default: 'CURRENT_TIMESTAMP(3)', nullable: true },
        { name: 'n', type: 'INTEGER', default: 'ABS(-3)', nullable: true },
        { name: 'u', type: 'CHAR(36)', default: 'UUID()', nullable: true },
        { name: 's', type: 'VARCHAR(20)', default: "'a b c'", nullable: true },
      ],
      { pk: ['id'] },
    );
    const m = b.build();
    const g = generateDdl(m, 'mysql');
    expect(g.sql).toContain('DEFAULT (CURRENT_DATE)');
    const db = createAndVerify(m, 'f2defaults');
    expect(mysql('INSERT INTO D(id) VALUES (1)', db).stderr).toBe('');
    expect(rows(`SELECT d IS NOT NULL, t IS NOT NULL, ts IS NOT NULL, CHAR_LENGTH(u), s FROM D`, db)[0]).toEqual(['1', '1', '1', '36', 'a b c']);
    // the unparenthesised spelling is what MySQL 8.4 rejects
    expect(mysql('CREATE TABLE bare (d DATE DEFAULT CURRENT_DATE)', db).stderr).toMatch(/ERROR 1064|ERROR 1067|Invalid default value/);
  }, 60_000);

  it('release F2/F3/F4/F5/F1: what MySQL rejects is now an issue (no SQL) and what it accepts is generated', () => {
    const one = (cols: Array<{ name: string; type?: string; default?: string }>): RelationalModel => {
      const b = relationalBuilder('R', 'mysql');
      b.relation('t', [{ name: 'id', type: 'INTEGER' }, ...cols.map((c) => ({ ...c, nullable: true }))], { pk: ['id'] });
      return b.build();
    };
    const refused = (m: RelationalModel, code: string): void => {
      const g = generateDdl(m, 'mysql');
      expect(g.sql).toBe('');
      expect(g.issues.some((i) => i.code === `ddl.mysql.${code}` && i.severity === 'error'), code).toBe(true);
    };
    const serverRejects = (ddl: string, re: RegExp): void => {
      const db = freshDb('rej');
      expect(mysql(ddl, db).stderr).toMatch(re);
    };
    // F3: out-of-range parameters
    refused(one([{ name: 'x', type: 'VARCHAR(70000)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x VARCHAR(70000))', /ERROR 1074|ERROR 1118|too big/i);
    refused(one([{ name: 'x', type: 'DECIMAL(70,2)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x DECIMAL(70,2))', /ERROR 1426|ERROR 1427|precision/i);
    refused(one([{ name: 'x', type: 'DECIMAL(10,12)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x DECIMAL(10,12))', /ERROR 1427|scale/i);
    refused(one([{ name: 'x', type: 'CHAR(300)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x CHAR(300))', /ERROR 1074|too big/i);
    refused(one([{ name: 'x', type: 'FLOAT(60)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x FLOAT(60))', /ERROR 1063|precision/i);
    refused(one([{ name: 'x', type: 'DATETIME(7)' }]), 'type-out-of-range');
    serverRejects('CREATE TABLE t (x DATETIME(7))', /ERROR 1426|precision/i);
    // FLOAT(30) is emitted as DOUBLE and accepted
    createAndVerify(one([{ name: 'x', type: 'FLOAT(30)' }]), 'f30');
    // F2: functions MySQL does not have
    refused(one([{ name: 'x', type: 'CHAR(36)', default: 'gen_random_uuid()' }]), 'default-unsupported');
    serverRejects('CREATE TABLE t (x CHAR(36) DEFAULT (gen_random_uuid()))', /ERROR 3770|ERROR 1305|disallowed function|does not exist/i);
    // F1: payloads never reach the script
    refused(one([{ name: 'x', type: 'INTEGER', default: '0; DROP DATABASE sc' }]), 'unsafe-sql-text');
    refused(one([{ name: 'x', type: 'INT); DROP TABLE t; --' }]), 'unsafe-sql-text');
    // F4: typed key over 3072 bytes: warned, and the server really refuses it
    const kb = relationalBuilder('K', 'mysql');
    kb.relation('k', [{ name: 'a', type: 'VARCHAR(500)' }, { name: 'b', type: 'VARCHAR(500)' }], { pk: ['a', 'b'] });
    const kg = generateDdl(kb.build(), 'mysql');
    expect(kg.issues.some((i) => i.code === 'ddl.mysql.key-too-long' && i.severity === 'warning')).toBe(true);
    serverRejects(kg.sql, /ERROR 1071|too long/i);
    // F5: INT UNSIGNED vs INT foreign key
    const fb = relationalBuilder('F', 'mysql');
    const p = fb.relation('p', [{ name: 'k', type: 'INT UNSIGNED' }], { pk: ['k'] });
    const c = fb.relation('c', [{ name: 'id', type: 'INTEGER' }, { name: 'f', type: 'INT', nullable: true }], { pk: ['id'] });
    fb.fk(c, ['f'], p, ['k']);
    refused(fb.build(), 'fk-type-mismatch');
    serverRejects('CREATE TABLE p (k INT UNSIGNED PRIMARY KEY); CREATE TABLE c (id INT PRIMARY KEY, f INT NULL, FOREIGN KEY (f) REFERENCES p (k))', /ERROR 3780|incompatible/i);
  }, 120_000);

  it('relfix2 sql: payload models never execute an extra statement; DATETIME(n) DEFAULT CURRENT_TIMESTAMP is accepted', () => {
    const payloads = [
      '"\\" ) ) ; DROP TABLE canary ; -- "',
      "'\\'' ) ) ; DROP TABLE canary ; -- '",
      '$$ ; DROP TABLE canary ; -- $$',
      '$tag$ ; DROP TABLE canary ; -- $tag$',
      "1\nDROP TABLE canary",
      '1 \\! echo pwned',
      '1 # ; DROP TABLE canary',
      "1\u2028; DROP TABLE canary",
    ];
    const db = freshDb('inject');
    expect(mysql('CREATE TABLE canary (id INT PRIMARY KEY); INSERT INTO canary VALUES (1)', db).stderr).toBe('');
    const build = (field: 'type' | 'default' | 'check' | 'where' | 'action' | 'method' | 'name' | 'project', p: string): RelationalModel => {
      const b = relationalBuilder(field === 'project' ? p : 'R', 'mysql');
      const parent = b.relation('par', [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
      const t = b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: field === 'name' ? p : 'x', type: field === 'type' ? p : 'INTEGER', ...(field === 'default' ? { default: p } : {}) }, { name: 'pid', type: 'INTEGER', nullable: true }], { pk: ['id'] });
      const fk = b.fk(t, ['pid'], parent, ['id']);
      if (field === 'action') fk.onDelete = p as never;
      if (field === 'check') t.relation.checks = [{ id: 'ck', expression: p }];
      t.relation.indexes.push({ id: 'ix', name: 'ix_t', columnIds: [t.col('id')], unique: false, ...(field === 'where' ? { where: p } : {}), ...(field === 'method' ? { method: p } : {}) });
      return b.build();
    };
    for (const field of ['type', 'default', 'check', 'where', 'action', 'method', 'name', 'project'] as const) {
      for (const p of payloads) {
        const g = generateDdl(build(field, field === 'action' ? `CASCADE${p}` : field === 'method' ? `btree${p}` : p), 'mysql');
        // whatever the generator returned (nothing, or a script with the field omitted) is run against the canary database
        if (g.sql) {
          const r = mysql(g.sql, db);
          expect(r.stderr, `${field} ${JSON.stringify(p)}\n${g.sql}`).not.toMatch(/pwned/);
          // a hostile NAME / project name is legal as long as it stays inside the quoted identifier / one `-- ` comment line; the server run above proves it
          if (field !== 'name' && field !== 'project') expect(g.sql, `${field} ${JSON.stringify(p)}`).not.toMatch(/DROP TABLE canary|pwned/i);
        } else {
          expect(g.issues.some((i) => i.code === 'ddl.mysql.unsafe-sql-text' && i.severity === 'error'), `${field} ${JSON.stringify(p)}`).toBe(true);
        }
      }
    }
    // only the canary and the intended tables (par, t from the first runnable script) exist: no payload table, nothing dropped
    expect(rows(`SELECT table_name FROM information_schema.tables WHERE table_schema='${db}'`, db).map((x) => x[0]).sort()).toEqual(['canary', 'par', 't']);
    expect(rows('SELECT COUNT(*) FROM canary', db)).toEqual([['1']]);

    // a hostile project name (header comment) cannot start a new line of SQL
    const hdr = generateDdl(build('project', 'x\nDROP TABLE canary; --'), 'mysql');
    expect(hdr.sql.split('\n').filter((l) => /DROP/.test(l))).toEqual(['-- x DROP TABLE canary; --']);
    const hdrDb = freshDb('hdr');
    expect(mysql(hdr.sql, hdrDb).stderr).toBe('');

    // F2 follow-up: fractional-seconds precision on both sides of DEFAULT (server error 1067 otherwise)
    const tb = relationalBuilder('T', 'mysql');
    tb.relation('ev', [{ name: 'id', type: 'INTEGER' }, { name: 'a', type: 'DATETIME(3)', default: 'CURRENT_TIMESTAMP', nullable: false }, { name: 'b', type: 'TIMESTAMP(6)', default: 'CURRENT_TIMESTAMP', nullable: false }], { pk: ['id'] });
    const tg = generateDdl(tb.build(), 'mysql');
    expect(tg.sql).toContain('CURRENT_TIMESTAMP(3)');
    const tdb = freshDb('fsp');
    const tr = mysql(tg.sql, tdb);
    expect(tr.stderr, tg.sql).toBe('');
    expect(mysql('INSERT INTO ev (id) VALUES (1)', tdb).stderr).toBe('');
  }, 120_000);

  it('relfix3 sql: every must-accept default / CHECK reaches information_schema; allow-list payloads run no extra statement', () => {
    const db = createAndVerify(acceptModel('mysql'), 'accept');
    const defs = new Map(rows(`SELECT column_name, IFNULL(column_default, '<null>') FROM information_schema.columns WHERE table_schema='${db}' AND table_name='acc'`, db).map(([n, d]) => [n!, d!] as const));
    for (const c of acceptCases('mysql')) if (c.expectDefault) expect(defs.get(c.column)!.toLowerCase(), c.column).toContain(c.expectDefault.toLowerCase());
    expect(defs.get('c_ts')).toMatch(/CURRENT_TIMESTAMP\(3\)/i);
    expect(defs.get('c_ts2')).toMatch(/CURRENT_TIMESTAMP\(6\)/i);
    expect(defs.get('c_uuid')).toMatch(/uuid\(\)/i);
    const checks = rows(`SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema='${db}' ORDER BY constraint_name`, db);
    expect(checks.map((c) => c[0])).toEqual(acceptChecks('mysql').map((_, i) => `ck_acc_${i}`));
    expect(mysql("INSERT INTO acc (id, c_num, c_status, c_name, `价格`, `Weird Col`) VALUES (1, 5, 'a', 'ab', 1, 1)", db).stderr).toBe('');
    expect(mysql('INSERT INTO acc (id, c_num) VALUES (2, 5000)', db).stderr).toMatch(/Check constraint/i);
    expect(mysql("INSERT INTO acc (id, c_status) VALUES (3, 'zzz')", db).stderr).toMatch(/Check constraint/i);

    const canary = freshDb('hostile');
    expect(mysql('CREATE TABLE canary (id INT PRIMARY KEY); INSERT INTO canary VALUES (1)', canary).stderr).toBe('');
    for (const field of ['type', 'default', 'check', 'where'] as const) {
      for (const p of HOSTILE) {
        const g = generateDdl(payloadModel(field, p, 'mysql'), 'mysql');
        if (g.sql) {
          const r = mysql(g.sql, freshDb('hx'));
          expect(r.stderr, `${field} ${JSON.stringify(p)}\n${g.sql}`).toBe('');
          expect(g.sql, `${field} ${JSON.stringify(p)}`).not.toMatch(/DROP TABLE|evil/i);
        } else expect(g.issues.some((i) => i.code === 'ddl.mysql.unsafe-sql-text' && i.severity === 'error'), `${field} ${JSON.stringify(p)}`).toBe(true);
      }
    }
    expect(rows(`SELECT table_name FROM information_schema.tables WHERE table_schema='${canary}'`, canary).map((x) => x[0])).toEqual(['canary']);
    expect(rows('SELECT COUNT(*) FROM canary', canary)).toEqual([['1']]);
  }, 180_000);

  it('VARCHAR-keyed composite FK is enforced', () => {
    const db = createAndVerify(textKeys(), 'textfk');
    expect(mysql(`INSERT INTO P(code, sub) VALUES ('a','b'),('a','c'),('d','b')`, db).stderr).toBe('');
    expect(mysql(`INSERT INTO C(id, pcode, psub) VALUES (1,'a','b')`, db).stderr).toBe('');
    expect(mysql(`INSERT INTO C(id, pcode, psub) VALUES (2,'d','c')`, db).stderr).toMatch(/foreign key constraint fails/i);
  }, 60_000);
});

// Not gated: needs no server. The importer must read back the MySQL dialect the generator writes (backtick quoting); names, nullability, PKs, UNIQUEs and FKs are compared, types are not (untyped columns get a VARCHAR fallback).
describe('P4 mysql: generated MySQL DDL re-imports to the same model', () => {
  for (const key of EXAMPLE_KEYS) {
    it(`example ${key}`, async () => {
      const m = await relational(key);
      const parsed = parseDdl(generateDdl(m, 'mysql').sql, 'mysql');
      expect(signature(parsed.model)).toEqual(signature(m));
    });
  }
});
