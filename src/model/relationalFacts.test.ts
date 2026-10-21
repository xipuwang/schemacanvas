import { describe, expect, it } from 'vitest';
import { relationalBuilder } from './builders';
import { dataTypesCompatible, fkPairsInKeyOrder, fkTargetKey, parseDataType } from './relationalFacts';
import { coversCandidateKey, fkCardinality, isCandidateKey, sqlNameKey } from './queries';

describe('fkTargetKey', () => {
  const rb = relationalBuilder('R');
  const drug = rb.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const presc = rb.relation('Presc', ['C', 'T', 'X'], { pk: ['C', 'T'] });

  it('matches the PK order-insensitively and reorders pairs into key order', () => {
    const fk = rb.fk(presc, ['T', 'C'], drug, ['TradeName', 'CompanyName']);
    expect(fkTargetKey(drug.relation, fk)).toEqual({ kind: 'primary' });
    expect(fkPairsInKeyOrder(drug.relation, fk).map((p) => p.targetColumnId)).toEqual(drug.cols('CompanyName', 'TradeName'));
  });

  it('flags an incomplete composite key and accepts UNIQUE / unique index targets', () => {
    const partial = rb.fk(presc, ['C'], drug, ['CompanyName']);
    expect(fkTargetKey(drug.relation, partial)).toEqual({ kind: 'none' });
    drug.unique('Formula');
    const toUnique = rb.fk(presc, ['X'], drug, ['Formula']);
    expect(fkTargetKey(drug.relation, toUnique).kind).toBe('unique');
    drug.index('ux_c', ['CompanyName'], true);
    expect(fkTargetKey(drug.relation, partial).kind).toBe('index');
  });
});

describe('keys & cardinality', () => {
  it('isCandidateKey / coversCandidateKey / fkCardinality', () => {
    const rb = relationalBuilder('R');
    const dept = rb.relation('Dept', ['Dno', 'Name'], { pk: ['Dno'] });
    const emp = rb.relation('Emp', ['Eid', 'DeptNo', 'Mail'], { pk: ['Eid'] });
    emp.unique('Mail');
    const fk = rb.fk(emp, ['DeptNo'], dept, ['Dno']);
    const m = rb.build();
    expect(isCandidateKey(emp.relation, emp.cols('Eid'))).toBe(true);
    expect(isCandidateKey(emp.relation, emp.cols('Mail'))).toBe(true);
    expect(isCandidateKey(emp.relation, emp.cols('Eid', 'Mail'))).toBe(false);
    expect(coversCandidateKey(emp.relation, emp.cols('Eid', 'Mail'))).toBe(true);
    // DeptNo is nullable (not PK) => optional parent; many employees per dept
    expect(fkCardinality(m, fk)).toMatchObject({ childMax: 'many', childMin: 0, parentMin: 0, stated: [] });
    emp.relation.columns.find((c) => c.name === 'DeptNo')!.nullable = false;
    expect(fkCardinality(m, fk).parentMin).toBe(1);
    // unique FK column => 1:1 (childMax one); stated values win
    emp.unique('DeptNo');
    expect(fkCardinality(m, fk).childMax).toBe('one');
    fk.cardinality = { childMin: 1 };
    expect(fkCardinality(m, fk)).toMatchObject({ childMin: 1, stated: ['childMin'] });
  });
});

describe('data types', () => {
  it('parses & normalises', () => {
    expect(parseDataType('varchar(50)')).toMatchObject({ base: 'VARCHAR', args: [50] });
    expect(parseDataType('int4')?.base).toBe('INTEGER');
    expect(parseDataType('DECIMAL(10, 2)')).toMatchObject({ base: 'NUMERIC', args: [10, 2] });
    expect(parseDataType('character varying(20)')?.base).toBe('VARCHAR');
    expect(parseDataType('  ')).toBeUndefined();
  });
  it('compatibility classes', () => {
    expect(dataTypesCompatible('INT', 'integer')).toBe('same');
    expect(dataTypesCompatible('INT', 'BIGINT')).toBe('compatible');
    expect(dataTypesCompatible('VARCHAR(50)', 'VARCHAR(100)')).toBe('compatible');
    expect(dataTypesCompatible('INT', 'VARCHAR(10)')).toBe('mismatch');
    expect(dataTypesCompatible(undefined, 'INT')).toBe('unknown');
  });
  it('sqlNameKey', () => expect(sqlNameKey('  Student ')).toBe('student'));
});
