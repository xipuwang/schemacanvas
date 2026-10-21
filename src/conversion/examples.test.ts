import { describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import { describeForeignKey } from '@/model/queries';
import { CONVERSION_RULE_IDS } from '@/model/conversionRules';
import { exampleA, exampleE } from './fixtures';
import { col, colNames, fkList, fksOf, pkNames, rel, run, uniqueSets } from './testkit';

/** Spec §8 examples A-E (builders in fixtures.ts). */

describe('Example A: composite, multivalued and derived attributes', () => {
  const { relationalModel: m, record } = run(exampleA());

  it('creates Student plus one relation per multivalued attribute', () => {
    expect(Object.values(m.relations).map((r) => r.name).sort()).toEqual(['Student', 'Student_Preference', 'Student_ProgrammingLanguages']);
  });

  it('flattens composites to atomic columns and omits the derived Age', () => {
    const s = rel(m, 'Student');
    expect(colNames(s)).toEqual(['SID', 'FirstName', 'LastName', 'Street', 'City', 'ZipCode', 'DOB']);
    expect(pkNames(s)).toEqual(['SID']);
    expect(col(s, 'DOB').dataType).toBe('DATE');
    expect(s.columns.every((c) => !c.nullable)).toBe(true); // no attribute is optional
  });

  it('multivalued relation: owner key as ONE FK + value column; PK = all columns', () => {
    const pl = rel(m, 'Student_ProgrammingLanguages');
    expect(colNames(pl)).toEqual(['StudentSID', 'ProgrammingLanguages']);
    expect(pkNames(pl)).toEqual(['StudentSID', 'ProgrammingLanguages']);
    expect(col(pl, 'StudentSID').dataType).toBe('INT');
    expect(col(pl, 'ProgrammingLanguages').dataType).toBe('VARCHAR(30)');
    expect(fkList(m)).toContain('Student_ProgrammingLanguages.StudentSID → Student.SID');
    expect(fkList(m)).toContain('Student_Preference.StudentSID → Student.SID');
  });

  it('explains the derived omission', () => {
    const d = record.decisions.find((x) => x.ruleId === 'derived-omitted');
    expect(d?.title).toContain('Age');
    expect(d?.explanation).toContain('DOB');
  });
});

describe('Example B: weak entity', () => {
  const b = erBuilder('B');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  const { relationalModel: m } = run(b.build());

  it('Drug PK = owner key + partial key, FK to Company, identifying relationship creates no table', () => {
    expect(Object.values(m.relations).map((r) => r.name).sort()).toEqual(['Company', 'Drug']);
    const d = rel(m, 'Drug');
    expect(colNames(d)).toEqual(['CompanyName', 'TradeName', 'Formula']);
    expect(pkNames(d)).toEqual(['CompanyName', 'TradeName']);
    expect(fkList(m)).toEqual(['Drug.CompanyName → Company.name']);
    expect(d.columns.every((c) => !c.nullable)).toBe(true);
    const fk = fksOf(m, d)[0]!;
    expect(fk.columns).toEqual([{ sourceColumnId: col(d, 'CompanyName').id, targetColumnId: col(rel(m, 'Company'), 'name').id }]);
  });
});

describe('Example C: recursive 1:N', () => {
  const b = erBuilder('C');
  const emp = b.entity('Employee').key('Eid').attr('Name');
  b.relate('Manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  const { relationalModel: m } = run(b.build());

  it('Employee(Eid, Name, ManagerEid) with a nullable self-referencing FK; no extra relation', () => {
    expect(Object.keys(m.relations)).toHaveLength(1);
    const e = rel(m, 'Employee');
    expect(colNames(e)).toEqual(['Eid', 'Name', 'ManagerEid']);
    expect(col(e, 'ManagerEid').nullable).toBe(true);
    expect(fkList(m)).toEqual(['Employee.ManagerEid → Employee.Eid']);
    const fk = fksOf(m, e)[0]!;
    expect(fk.sourceRelationId).toBe(fk.targetRelationId);
    expect(fk.origin?.ruleId).toBe('recursive-one-to-many-fk');
  });
});

describe('Example D: recursive M:N', () => {
  const b = erBuilder('D');
  const course = b.entity('Course').key('Cid').attr('Name');
  const r = b.relate('PreReq', course, course, 'M:N');
  const ps = r.relationship.participants;

  it('literal PreReq(Cid, Req_Cid) with columnPrefixes', () => {
    const { relationalModel: m } = run(b.build(), { columnPrefixes: { [ps[0]!.id]: '', [ps[1]!.id]: 'Req_' } });
    const p = rel(m, 'PreReq');
    expect(colNames(p)).toEqual(['Cid', 'Req_Cid']);
    expect(pkNames(p)).toEqual(['Cid', 'Req_Cid']);
    expect(fkList(m)).toEqual(['PreReq.Cid → Course.Cid', 'PreReq.Req_Cid → Course.Cid']);
    expect(Object.values(m.foreignKeys).every((fk) => fk.origin?.ruleId === 'recursive-many-to-many-relation')).toBe(true);
  });

  it('default naming: role names disambiguate, otherwise a documented suffix', () => {
    const withRoles = erBuilder('D2');
    const c2 = withRoles.entity('Course').key('Cid');
    withRoles.relate('PreReq', c2, c2, 'M:N', { leftRole: 'course', rightRole: 'prerequisite' });
    expect(colNames(rel(run(withRoles.build()).relationalModel, 'PreReq'))).toEqual(['CourseCid', 'PrerequisiteCid']);
    const plain = colNames(rel(run(b.build()).relationalModel, 'PreReq'));
    expect(plain).toEqual(['CourseCid', 'CourseCid_Course']);
  });
});

describe('Example E: complete pharmacy system', () => {
  const { relationalModel: m, diagram } = run(exampleE());

  it('creates exactly the expected relations', () => {
    expect(Object.values(m.relations).map((r) => r.name).sort()).toEqual(
      ['Company', 'Contract', 'Doctor', 'Drug', 'Patient', 'Pharmacy', 'Prescription', 'Sell'],
    );
  });

  it('Patient.DoctorSSN -> Doctor.SSN on the N side, NOT NULL because Patient participates totally', () => {
    const p = rel(m, 'Patient');
    expect(colNames(p)).toEqual(['SSN', 'Name', 'Address', 'Age', 'DoctorSSN']);
    expect(col(p, 'DoctorSSN').nullable).toBe(false);
    expect(col(p, 'DoctorSSN').dataType).toBe('CHAR(9)');
    expect(colNames(rel(m, 'Doctor'))).not.toContain('PatientSSN');
  });

  it('Drug is weak: PK (CompanyName, TradeName)', () => {
    expect(pkNames(rel(m, 'Drug'))).toEqual(['CompanyName', 'TradeName']);
  });

  it('Sell: M:N relation with composite FK to Drug and the Price attribute kept', () => {
    const s = rel(m, 'Sell');
    expect(colNames(s)).toEqual(['PharmacyName', 'CompanyName', 'DrugTradeName', 'Price']);
    expect(pkNames(s)).toEqual(['PharmacyName', 'CompanyName', 'DrugTradeName']);
    expect(col(s, 'Price').dataType).toBe('DECIMAL(8,2)');
    const toDrug = fksOf(m, s).find((fk) => fk.targetRelationId === rel(m, 'Drug').id)!;
    expect(describeForeignKey(m, toDrug)).toBe('Sell.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
  });

  it('Contract keeps both relationship attributes (EndDate optional => nullable)', () => {
    const c = rel(m, 'Contract');
    expect(colNames(c)).toEqual(['PharmacyName', 'CompanyName', 'StartDate', 'EndDate']);
    expect(col(c, 'EndDate').nullable).toBe(true);
    expect(col(c, 'StartDate').nullable).toBe(false);
  });

  it('Prescription: ternary with ONE composite FK to Drug and the Date discriminator in the PK', () => {
    const p = rel(m, 'Prescription');
    expect(colNames(p)).toEqual(['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date', 'Quantity']);
    expect(new Set(pkNames(p))).toEqual(new Set(['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date']));
    expect(fksOf(m, p)).toHaveLength(3);
    expect(fkList(m)).toContain('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
  });

  it('has exactly one FK object per constraint (composite FKs are single)', () => {
    expect(fkList(m)).toEqual(
      [
        'Contract.CompanyName → Company.name',
        'Contract.PharmacyName → Pharmacy.Name',
        'Drug.CompanyName → Company.name',
        'Patient.DoctorSSN → Doctor.SSN',
        'Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)',
        'Prescription.DoctorSSN → Doctor.SSN',
        'Prescription.PatientSSN → Patient.SSN',
        'Sell.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)',
        'Sell.PharmacyName → Pharmacy.Name',
      ].sort(),
    );
  });

  it('result diagram: one node per relation, one edge per FK', () => {
    expect(Object.keys(diagram.nodes)).toHaveLength(8);
    expect(Object.keys(diagram.edges)).toHaveLength(9);
    expect(diagram.type).toBe('relational-schema');
    expect(diagram.modelId).toBe(m.id);
  });

  it('uses only vocabulary rule ids and no unique constraints for a key-only ternary', () => {
    for (const r of Object.values(m.relations)) {
      expect(CONVERSION_RULE_IDS as readonly string[]).toContain(r.origin?.ruleId);
    }
    expect(uniqueSets(rel(m, 'Prescription'))).toEqual([]);
  });
});
