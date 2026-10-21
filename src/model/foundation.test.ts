import { describe, expect, it, afterEach } from 'vitest';
import { erBuilder, relationalBuilder } from './builders';
import { createProject } from './defaults';
import { useDeterministicIds } from './ids';
import {
  attributesOf,
  columnRole,
  describeForeignKey,
  isCompositeAttribute,
  isRecursiveRelationship,
  leafAttributes,
} from './queries';
import { weakEntityOwners } from './erSemantics';

let restore = () => {};
afterEach(() => restore());

describe('ids', () => {
  it('deterministic ids are sequential and restorable', () => {
    restore = useDeterministicIds();
    const b = erBuilder('x');
    const e = b.entity('A');
    // the model itself consumed `mdl_1`
    expect(b.model.id).toBe('mdl_1');
    expect(e.id).toBe('ent_2');
    expect(b.entity('B').id).toBe('ent_3');
  });
});

describe('erBuilder + queries', () => {
  it('builds composite attributes and flattens leaves', () => {
    const b = erBuilder('Uni');
    const s = b.entity('Student').key('SID').composite('Name', ['First', 'Last']).multivalued('Languages').derived('Age');
    const m = b.build();
    const attrs = attributesOf(m, { kind: 'entity', id: s.id });
    expect(attrs.map((a) => a.name)).toEqual(['SID', 'Name', 'Languages', 'Age']);
    const name = attrs[1]!;
    expect(isCompositeAttribute(m, name.id)).toBe(true);
    expect(leafAttributes(m, name).map((a) => a.name)).toEqual(['First', 'Last']);
    expect(attrs[2]!.multivalued).toBe(true);
    expect(attrs[3]!.derived).toBe(true);
  });

  it('finds weak entity owners via identifying relationships', () => {
    const b = erBuilder('Pharma');
    const company = b.entity('Company').key('name');
    const drug = b.entity('Drug', { weak: true }).partialKey('TradeName');
    b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
    const m = b.build();
    const owners = weakEntityOwners(m, drug.id);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.owner.name).toBe('Company');
    expect(owners[0]!.ownerParticipant.max).toBe('one');
    expect(owners[0]!.weakParticipant.participation).toBe('total');
  });

  it('detects recursive relationships', () => {
    const b = erBuilder('HR');
    const emp = b.entity('Employee').key('Eid');
    const rel = b.relate('Manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
    expect(isRecursiveRelationship(rel.relationship)).toBe(true);
  });
});

describe('relationalBuilder + queries', () => {
  it('composite PK/FK roles and descriptions', () => {
    const rb = relationalBuilder('Pharmacy');
    const drug = rb.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
    const presc = rb.relation('Prescription', ['PatientSSN', 'CompanyName', 'DrugTradeName', 'Qty'], {
      pk: ['PatientSSN', 'CompanyName', 'DrugTradeName'],
    });
    const fk = rb.fk(presc, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']);
    const m = rb.build();
    expect(fk.columns).toHaveLength(2);
    expect(describeForeignKey(m, fk)).toBe('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    expect(columnRole(m, presc.id, presc.col('PatientSSN'))).toBe('pk');
    expect(columnRole(m, presc.id, presc.col('CompanyName'))).toBe('pk+fk');
    expect(columnRole(m, presc.id, presc.col('Qty'))).toBe('plain');
    expect(columnRole(m, drug.id, drug.col('Formula'))).toBe('plain');
    // PK columns are NOT NULL
    expect(drug.relation.columns.find((c) => c.name === 'TradeName')!.nullable).toBe(false);
    expect(drug.relation.columns.find((c) => c.name === 'Formula')!.nullable).toBe(true);
  });

  it('a project is plain JSON (lossless round trip)', () => {
    const p = createProject('t');
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});
