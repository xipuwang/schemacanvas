// @vitest-environment node
/** P1b: the converted relational model of each spec example has exactly the schema the spec prescribes. */
import { describe, expect, it } from 'vitest';
import { describeForeignKey } from '@/model/queries';
import type { Project, RelationalModel } from '@/model/types';
import { EXAMPLES, convertInStore, relModelOf, setupEr, type ExampleKey } from './helpers';

async function convert(key: ExampleKey) {
  const s = setupEr(EXAMPLES[key]());
  const c = await convertInStore(s);
  const p: Project = s.store.getState().project;
  const rel = relModelOf(p, c.relModelId);
  const byName = (n: string) => Object.values(rel.relations).find((r) => r.name === n)!;
  const cols = (n: string) => byName(n).columns.map((x) => x.name);
  const pk = (n: string) => byName(n).primaryKey.map((id) => byName(n).columns.find((x) => x.id === id)!.name);
  const fks = (m: RelationalModel = rel) => Object.values(m.foreignKeys).map((f) => describeForeignKey(m, f)).sort();
  return { rel, c, byName, cols, pk, fks };
}

describe('P1b converted schemas match the spec', () => {
  it('A: composite flattened, 2 multivalued relations, derived omitted with a decision', async () => {
    const { rel, cols, pk, fks, c } = await convert('A');
    expect(Object.keys(rel.relations).length).toBe(3);
    expect(cols('Student')).toEqual(['SID', 'FirstName', 'LastName', 'Street', 'City', 'ZipCode', 'DOB']);
    expect(cols('Student')).not.toContain('Age');
    expect(pk('Student_ProgrammingLanguages')).toEqual(['StudentSID', 'ProgrammingLanguages']);
    expect(pk('Student_Preference')).toEqual(['StudentSID', 'Preference']);
    expect(fks()).toEqual(['Student_Preference.StudentSID → Student.SID', 'Student_ProgrammingLanguages.StudentSID → Student.SID']);
    expect(c.result.record.decisions.some((d) => /Age/.test(d.title + d.explanation))).toBe(true);
  });
  it('B: weak Drug PK is (CompanyName, TradeName), no table for the identifying relationship', async () => {
    const { rel, pk, fks } = await convert('B');
    expect(Object.values(rel.relations).map((r) => r.name).sort()).toEqual(['Company', 'Drug']);
    expect(pk('Drug')).toEqual(['CompanyName', 'TradeName']);
    expect(fks()).toEqual(['Drug.CompanyName → Company.name']);
  });
  it('C: Employee.ManagerEid -> Employee.Eid, FK on the N side only', async () => {
    const { rel, cols, fks } = await convert('C');
    expect(Object.keys(rel.relations)).toHaveLength(1);
    expect(cols('Employee')).toEqual(['Eid', 'Name', 'ManagerEid']);
    expect(fks()).toEqual(['Employee.ManagerEid → Employee.Eid']);
  });
  it('D: PreReq relation with two FKs to Course, PK is both', async () => {
    const { rel, pk, fks, byName } = await convert('D');
    expect(Object.keys(rel.relations)).toHaveLength(2);
    expect(pk('Prereq').length).toBe(2);
    expect(fks().length).toBe(2);
    expect(fks().every((f) => f.endsWith('→ Course.Cid'))).toBe(true);
    expect(new Set(byName('Prereq').columns.map((c) => c.name)).size).toBe(2);
  });
  it('E: pharmacy schema: weak Drug, composite FKs grouped as ONE FK, ternary Prescription keeps 3 roles + attrs', async () => {
    const { rel, pk, fks, cols } = await convert('E');
    expect(pk('Drug')).toEqual(['CompanyName', 'TradeName']);
    expect(fks()).toContain('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    expect(fks()).toContain('Sell.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    expect(fks()).toContain('Patient.DoctorSSN → Doctor.SSN'); // 1:N: FK on the N side
    expect(cols('Doctor')).not.toContain('PatientSSN');
    expect(cols('Prescription')).toEqual(expect.arrayContaining(['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date', 'Quantity']));
    expect(Object.values(rel.foreignKeys).filter((f) => f.columns.length === 2)).toHaveLength(2);
    expect(cols('Contract')).toEqual(expect.arrayContaining(['StartDate', 'EndDate']));
    expect(cols('Sell')).toContain('Price');
  });
});
