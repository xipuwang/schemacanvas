import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { localizeIssue } from '@/i18n';
import type { SqlDialect } from '@/model/types';
import { generateDdl } from './ddl';
import { parseDdl } from './ddlParser';

const one = (dialect: SqlDialect, type: string | undefined) => {
  const b = relationalBuilder('M', dialect);
  b.relation('products', [{ name: 'id', type: 'INT' }, type === undefined ? { name: 'c' } : { name: 'c', type }], { pk: ['id'] });
  return generateDdl(b.build(), dialect, { header: false });
};
const portability = (r: ReturnType<typeof one>) => r.issues.filter((i) => i.code.endsWith('.type-not-portable'));

describe('UX-4 non-portable types are reported per dialect', () => {
  it('TEXT[] on MySQL becomes JSON with a warning naming the column', () => {
    const r = one('mysql', 'TEXT[]');
    expect(r.sql).toContain('c JSON');
    expect(r.sql).not.toContain('[]');
    const [i] = portability(r);
    expect(i!.code).toBe('ddl.mysql.type-not-portable');
    expect(i!.severity).toBe('warning');
    expect(i!.explanation).toContain('products.c');
    expect(i!.params).toMatchObject({ relation: 'products', column: 'c', suggested: 'JSON' });
    expect(localizeIssue(i!, 'zh').explanation).toContain('products.c');
    expect(localizeIssue(i!, 'zh').explanation).toContain('JSON');
    expect(localizeIssue(i!, 'en')).toMatchObject({ localized: true, title: 'Data type not portable to mysql' });
  });
  it('an undefined named type is a MySQL warning with the closest type; native MySQL words are not flagged', () => {
    const r = one('mysql', 'ORDER_STATUS');
    expect(portability(r)).toHaveLength(1);
    expect(portability(r)[0]!.params).toMatchObject({ suggested: 'VARCHAR(255)', variant: 'verbatim' });
    expect(localizeIssue(portability(r)[0]!, 'zh').localized).toBe(true);
    for (const t of ["ENUM('a','b')", 'MEDIUMTEXT', 'DATETIME', 'INT UNSIGNED']) expect(portability(one('mysql', t)), t).toEqual([]);
  });
  it('JSONB maps to JSON (MySQL) / TEXT (SQLite); arrays map to TEXT on SQLite; PostgreSQL keeps everything', () => {
    expect(one('mysql', 'JSONB').sql).toContain('c JSON');
    expect(portability(one('mysql', 'JSONB'))).toHaveLength(1);
    expect(one('sqlite', 'JSONB').sql).toContain('c TEXT');
    expect(one('sqlite', 'INT[]').sql).toContain('c TEXT');
    expect(portability(one('sqlite', 'INT[]'))).toHaveLength(1);
    expect(one('mysql', 'TIMESTAMPTZ').sql).toContain('c DATETIME');
    for (const t of ['TEXT[]', 'JSONB', 'ORDER_STATUS']) expect(portability(one('postgresql', t)), t).toEqual([]);
    expect(one('postgresql', 'TEXT[]').sql).toContain('c TEXT[]');
  });
  it('round trip: a PostgreSQL script exported for MySQL warns about tags and status', () => {
    const imported = parseDdl(`CREATE TABLE products (id INT PRIMARY KEY, tags TEXT[], status order_status NOT NULL DEFAULT 'new');`, 'postgresql');
    const model = imported.model;
    const r = generateDdl(model, 'mysql', { header: false });
    expect(r.sql).toContain('tags JSON');
    expect(r.sql).toContain('ORDER_STATUS');
    expect(portability(r).map((i) => i.params?.['column']).sort()).toEqual(['status', 'tags']);
    expect(portability(generateDdl(model, 'postgresql', { header: false }))).toEqual([]);
  });
});

describe('SA-16 / UX-6 untyped columns are one issue per relation', () => {
  const untyped = (dialect: SqlDialect, n: number) => {
    const b = relationalBuilder('U', dialect);
    b.relation('Doctor', Array.from({ length: n }, (_, i) => `col${i}`), { pk: ['col0'] });
    b.relation('Patient', ['pid', 'name'], { pk: ['pid'] });
    return generateDdl(b.build(), dialect, { header: false }).issues.filter((i) => i.code.endsWith('.missing-type'));
  };
  it('names the relation and columns, counts them and affects each column', () => {
    const issues = untyped('postgresql', 4);
    expect(issues).toHaveLength(2);
    const doctor = issues.find((i) => i.params?.['relation'] === 'Doctor')!;
    expect(doctor.title).toBe('Table Doctor: 4 columns have no data type');
    expect(doctor.explanation).toContain('col0, col1, col2, col3');
    expect(doctor.affected).toHaveLength(4);
    expect(doctor.params).toMatchObject({ count: 4, columns: 'col0, col1, col2, col3', fallback: 'TEXT' });
    expect(doctor.severity).toBe('warning');
    expect(localizeIssue(doctor, 'zh').title).toBe('表 Doctor：有 4 列没有数据类型');
    expect(localizeIssue(doctor, 'en')).toMatchObject({ localized: true, title: doctor.title, explanation: doctor.explanation });
  });
  it('singular, long lists and SQLite wording', () => {
    expect(untyped('mysql', 1).find((i) => i.params?.['relation'] === 'Doctor')!.title).toBe('Table Doctor: 1 column has no data type');
    const long = untyped('generic', 12).find((i) => i.params?.['relation'] === 'Doctor')!;
    expect(long.affected).toHaveLength(12);
    expect(long.explanation).toContain('col7, …');
    const lite = untyped('sqlite', 3).find((i) => i.params?.['relation'] === 'Doctor')!;
    expect(lite.explanation).toContain('SQLite allows');
    expect(localizeIssue(lite, 'en')).toMatchObject({ localized: true, explanation: lite.explanation });
    expect(localizeIssue(lite, 'zh').localized).toBe(true);
  });
});
