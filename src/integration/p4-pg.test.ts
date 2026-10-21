// @vitest-environment node
import './deterministic';
/**
 * P4 PostgreSQL tier (INTEGRATION_PG=1): generated DDL runs on a REAL PostgreSQL in a THROWAWAY cluster
 * (/tmp/sc-pg-integ, port 55438, unix socket only). The cluster is always stopped and deleted afterwards.
 * Never touches other postgres processes: refuses to start when the port or directory is already in use.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateDdl } from '@/sql';
import { acceptCases, acceptChecks, acceptModel, HOSTILE, payloadModel } from '@/sql/acceptFixtures';
import { EXAMPLES, EXAMPLE_KEYS, convertInStore, relModelOf, setupEr, type ExampleKey } from './helpers';

const DIR = '/tmp/sc-pg-integ';
const DATA = `${DIR}/data`;
const SOCK = `${DIR}/sock`;
const PORT = '55438';
const BIN = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@14/bin';
const run = process.env.INTEGRATION_PG ? describe : describe.skip;

const psql = (sql: string, db = 'postgres') =>
  spawnSync(`${BIN}/psql`, ['-U', 'postgres', '-h', SOCK, '-p', PORT, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' });

run('P4 postgres: generated DDL on a real PostgreSQL 14', () => {
  let started = false;
  beforeAll(() => {
    const busy = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim();
    if (busy) throw new Error(`port ${PORT} is in use, refusing to start: ${busy}`);
    if (existsSync(DIR)) throw new Error(`${DIR} already exists, refusing to touch it`);
    mkdirSync(SOCK, { recursive: true });
    execFileSync(`${BIN}/initdb`, ['-D', DATA, '--auth=trust', '-U', 'postgres', '-E', 'UTF8'], { stdio: 'pipe' });
    writeFileSync(`${DATA}/postgresql.conf`, `\nlisten_addresses=''\nport=${PORT}\nunix_socket_directories='${SOCK}'\nfsync=off\n`, { flag: 'a' });
    execFileSync(`${BIN}/pg_ctl`, ['-D', DATA, '-l', `${DIR}/log`, '-w', '-t', '30', 'start'], { stdio: 'pipe' });
    started = true;
  }, 90_000);
  afterAll(() => {
    try {
      if (started) execFileSync(`${BIN}/pg_ctl`, ['-D', DATA, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    } finally {
      if (started || existsSync(DATA)) rmSync(DIR, { recursive: true, force: true });
    }
  }, 60_000);

  for (const key of EXAMPLE_KEYS) {
    it(`example ${key}: DDL executes and information_schema shows every PK and FK`, async () => {
      const s = setupEr(EXAMPLES[key as ExampleKey]());
      const c = await convertInStore(s);
      const m = relModelOf(s.store.getState().project, c.relModelId);
      const g = generateDdl(m, 'postgresql');
      expect(g.sql).not.toBe('');
      const db = `ex_${key.toLowerCase()}`;
      expect(psql(`CREATE DATABASE ${db}`).status).toBe(0);
      const r = spawnSync(`${BIN}/psql`, ['-U', 'postgres', '-h', SOCK, '-p', PORT, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], { input: g.sql, encoding: 'utf8' });
      expect(r.stderr, 'psql stderr').toBe('');
      expect(r.status).toBe(0);
      const fkCount = Number(psql(`SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`, db).stdout.trim());
      const pkCount = Number(psql(`SELECT count(*) FROM pg_constraint WHERE contype='p' AND connamespace='public'::regnamespace`, db).stdout.trim());
      expect(fkCount).toBe(Object.keys(m.foreignKeys).length);
      expect(pkCount).toBe(Object.values(m.relations).filter((x) => x.primaryKey.length > 0).length);
    }, 30_000);
  }

  it('Pharmacy: composite FKs are enforced by PostgreSQL', async () => {
    const s = setupEr(EXAMPLES.E());
    const c = await convertInStore(s);
    const m = relModelOf(s.store.getState().project, c.relModelId);
    const db = 'ex_e';
    // (database ex_e already created by the previous test; recreate to be order independent)
    psql(`DROP DATABASE IF EXISTS ${db}_rows`);
    expect(psql(`CREATE DATABASE ${db}_rows`).status).toBe(0);
    const load = (sql: string) => spawnSync(`${BIN}/psql`, ['-U', 'postgres', '-h', SOCK, '-p', PORT, '-d', `${db}_rows`, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], { input: sql, encoding: 'utf8' });
    expect(load(generateDdl(m, 'postgresql').sql).status).toBe(0);
    const ok = load(`
      INSERT INTO "Company"(name, phone) VALUES ('Pfizer','1'),('Bayer','2');
      INSERT INTO "Drug"("CompanyName","TradeName","Formula") VALUES ('Pfizer','Advil','x'),('Bayer','Aspirin','y');
      INSERT INTO "Doctor"("SSN","Name","Specialty","YearsOfExperience") VALUES ('111111111','Dr','GP',5);
      INSERT INTO "Patient"("SSN","Name","Address","Age","DoctorSSN") VALUES ('222222222','P','a',30,'111111111');
      INSERT INTO "Pharmacy"("Name","Address","Phone") VALUES ('CVS','a','1');
      INSERT INTO "Prescription" VALUES ('111111111','222222222','Pfizer','Advil','2026-01-01',2);
      INSERT INTO "Sell" VALUES ('CVS','Bayer','Aspirin',3.5);`);
    expect(ok.stderr).toBe('');
    const bad = load(`INSERT INTO "Prescription" VALUES ('111111111','222222222','Pfizer','Aspirin','2026-01-02',1)`);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/foreign key constraint/i);
    const bad2 = load(`INSERT INTO "Sell" VALUES ('CVS','Bayer','Advil',1)`);
    expect(bad2.stderr).toMatch(/foreign key constraint/i);
    expect(load(`INSERT INTO "Drug" VALUES ('Pfizer','Advil','dup')`).stderr).toMatch(/duplicate key/i);
  }, 30_000);

  it('relfix3 sql: must-accept defaults / CHECKs are in the catalogue; payloads run no extra statement', () => {
    const exec = (db: string, sql: string) => spawnSync(`${BIN}/psql`, ['-U', 'postgres', '-h', SOCK, '-p', PORT, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], { input: sql, encoding: 'utf8' });
    expect(psql('CREATE DATABASE acc').status).toBe(0);
    const g = generateDdl(acceptModel('postgresql'), 'postgresql', { header: false });
    expect(g.issues.filter((x) => x.severity === 'error')).toEqual([]);
    const r = exec('acc', g.sql);
    expect(r.stderr, g.sql).toBe('');
    const defs = new Map(psql(`SELECT column_name || '|' || coalesce(column_default, '<none>') FROM information_schema.columns WHERE table_name='acc'`, 'acc').stdout.trim().split('\n').map((l) => l.split('|') as [string, string]));
    for (const c of acceptCases('postgresql')) if (c.expectDefault) expect(defs.get(c.column)!.toLowerCase(), c.column).toContain(c.expectDefault.toLowerCase());
    expect(defs.get('c_uuid')).toMatch(/gen_random_uuid/);
    const checks = psql(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid='acc'::regclass ORDER BY conname`, 'acc').stdout.trim().split('\n');
    expect(checks).toEqual(acceptChecks('postgresql').map((_, i) => `ck_acc_${i}`));
    expect(exec('acc', `INSERT INTO acc (id, c_num, c_status, c_name, "价格", "Weird Col", c_zip, c_cast) VALUES (1, 5, 'a', 'ab', 1, 1, '12345', 3)`).stderr).toBe('');
    expect(exec('acc', `INSERT INTO acc (id, c_zip) VALUES (2, 'abc')`).stderr).toMatch(/check constraint/i);

    expect(psql('CREATE DATABASE hostile').status).toBe(0);
    expect(exec('hostile', 'CREATE TABLE canary (id int primary key); INSERT INTO canary VALUES (1)').stderr).toBe('');
    let n = 0;
    for (const field of ['type', 'default', 'check', 'where'] as const) {
      for (const p of HOSTILE) {
        const out = generateDdl(payloadModel(field, p, 'postgresql'), 'postgresql');
        if (out.sql) {
          const db = `hx${n++}`;
          expect(psql(`CREATE DATABASE ${db}`).status).toBe(0);
          expect(exec(db, out.sql).stderr, `${field} ${JSON.stringify(p)}\n${out.sql}`).toBe('');
          expect(out.sql).not.toMatch(/DROP TABLE|evil/i);
        } else expect(out.issues.some((i) => i.code === 'ddl.postgresql.unsafe-sql-text' && i.severity === 'error'), `${field} ${JSON.stringify(p)}`).toBe(true);
      }
    }
    expect(psql(`SELECT count(*) FROM canary`, 'hostile').stdout.trim()).toBe('1');
  }, 120_000);
});
