import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { deepFreeze } from '@/test/deepFreeze';
import { candidateKeys, describePairs, findDuplicateFk, inTableOrder, pairTypeNote, pairsOf, remapTarget, resolveFkTarget, suggestMapping, validTargetColumns } from './fkLogic';

function pharmacy() {
  const b = relationalBuilder('Pharmacy');
  const doctor = b.relation('Doctor', [{ name: 'SSN', type: 'CHAR(9)' }, 'Name'], { pk: ['SSN'] });
  const patient = b.relation('Patient', ['PID', 'Name', { name: 'DoctorSSN', type: 'INT' }], { pk: ['PID'] });
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Prescription', ['PID', 'DrugTradeName', 'CompanyName', 'Qty'], { pk: ['PID', 'DrugTradeName', 'CompanyName'] });
  const loose = b.relation('Loose', ['A', 'B']);
  const model = deepFreeze(b.build());
  return { model, doctor, patient, drug, rx, loose };
}

describe('candidateKeys', () => {
  it('lists the primary key first, then UNIQUE constraints', () => {
    const { model, doctor, loose } = pharmacy();
    const rel = model.relations[doctor.id]!;
    expect(candidateKeys(rel)).toEqual([{ kind: 'primary', columnIds: [doctor.col('SSN')] }]);
    expect(candidateKeys(model.relations[loose.id]!)).toEqual([]);
  });
});

describe('resolveFkTarget', () => {
  it('single column onto a key cell: ONE pair Patient.DoctorSSN -> Doctor.SSN', () => {
    const { model, patient, doctor } = pharmacy();
    const v = resolveFkTarget(model, patient.id, [patient.col('DoctorSSN')], doctor.id, doctor.col('SSN'));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.targetColumnIds).toEqual([doctor.col('SSN')]);
    expect(describePairs(model, patient.id, doctor.id, pairsOf([patient.col('DoctorSSN')], v.targetColumnIds))).toBe('Patient.DoctorSSN → Doctor.SSN');
  });

  it('dropped on the table body: picks the key whose length matches', () => {
    const { model, patient, doctor } = pharmacy();
    expect(resolveFkTarget(model, patient.id, [patient.col('DoctorSSN')], doctor.id).ok).toBe(true);
  });

  it('composite: maps by name hints, not by click order (DrugTradeName -> TradeName, CompanyName -> CompanyName)', () => {
    const { model, rx, drug } = pharmacy();
    const v = resolveFkTarget(model, rx.id, [rx.col('CompanyName'), rx.col('DrugTradeName')], drug.id, drug.col('TradeName'));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // sources are put in TABLE order first: DrugTradeName, CompanyName
    const ordered = inTableOrder(model.relations[rx.id]!, [rx.col('CompanyName'), rx.col('DrugTradeName')]);
    expect(ordered).toEqual([rx.col('DrugTradeName'), rx.col('CompanyName')]);
    expect(v.targetColumnIds).toEqual([drug.col('TradeName'), drug.col('CompanyName')]);
    expect(describePairs(model, rx.id, drug.id, pairsOf(ordered, v.targetColumnIds))).toBe('Prescription.(DrugTradeName, CompanyName) → Drug.(TradeName, CompanyName)');
  });

  it('refuses a non-key cell, with the reason and column name', () => {
    const { model, patient, doctor } = pharmacy();
    const v = resolveFkTarget(model, patient.id, [patient.col('DoctorSSN')], doctor.id, doctor.col('Name'));
    expect(v).toEqual({ ok: false, reason: 'not-key-cell', relation: 'Doctor', column: 'Name' });
  });

  it('refuses when the key length differs from the selection (both directions)', () => {
    const { model, rx, patient, drug, doctor } = pharmacy();
    expect(resolveFkTarget(model, patient.id, [patient.col('DoctorSSN')], drug.id, drug.col('TradeName'))).toMatchObject({ ok: false, reason: 'length-mismatch', keyLength: 2, selected: 1 });
    expect(resolveFkTarget(model, rx.id, [rx.col('PID'), rx.col('Qty')], doctor.id)).toMatchObject({ ok: false, reason: 'length-mismatch', keyLength: 1, selected: 2 });
  });

  it('refuses a target without any key', () => {
    const { model, patient, loose } = pharmacy();
    expect(resolveFkTarget(model, patient.id, [patient.col('Name')], loose.id)).toEqual({ ok: false, reason: 'no-key', relation: 'Loose' });
  });

  it('self-references are allowed; a column cannot reference itself; duplicates are refused', () => {
    const b = relationalBuilder('Company');
    const emp = b.relation('Employee', ['Eid', 'Name', 'ManagerEid'], { pk: ['Eid'] });
    const m1 = JSON.parse(JSON.stringify(b.build())) as ReturnType<typeof b.build>;
    deepFreeze(m1);
    const ok = resolveFkTarget(m1, emp.id, [emp.col('ManagerEid')], emp.id, emp.col('Eid'));
    expect(ok.ok).toBe(true);
    expect(resolveFkTarget(m1, emp.id, [emp.col('Eid')], emp.id, emp.col('Eid'))).toMatchObject({ ok: false, reason: 'self-column' });
    b.fk(emp, ['ManagerEid'], emp, ['Eid']);
    const m2 = deepFreeze(b.build());
    expect(resolveFkTarget(m2, emp.id, [emp.col('ManagerEid')], emp.id, emp.col('Eid'))).toMatchObject({ ok: false, reason: 'duplicate', text: 'Employee.ManagerEid → Employee.Eid' });
    expect(findDuplicateFk(m2, emp.id, emp.id, [{ sourceColumnId: emp.col('ManagerEid'), targetColumnId: emp.col('Eid') }])).toBeDefined();
  });

  it('offers every key of the matching length (PK and UNIQUE) with the PK first', () => {
    const b = relationalBuilder('X');
    const target = b.relation('T', ['Id', 'Code'], { pk: ['Id'] });
    const src = b.relation('S', ['Ref']);
    target.relation.uniques.push({ id: 'unq_code', columnIds: [target.col('Code')] });
    const model = deepFreeze(b.build());
    const v = resolveFkTarget(model, src.id, [src.col('Ref')], target.id);
    expect(v.ok && v.keys.map((k) => k.kind)).toEqual(['primary', 'unique']);
    const onCode = resolveFkTarget(model, src.id, [src.col('Ref')], target.id, target.col('Code'));
    expect(onCode.ok && onCode.keys[0]!.kind).toBe('unique');
  });
});

describe('mapping helpers', () => {
  it('suggestMapping always returns a permutation of the key, in source order', () => {
    const { model, rx, drug } = pharmacy();
    const src = model.relations[rx.id]!;
    const tgt = model.relations[drug.id]!;
    const out = suggestMapping(src, [rx.col('Qty'), rx.col('PID')], tgt, tgt.primaryKey);
    expect([...out].sort()).toEqual([...tgt.primaryKey].sort());
  });

  it('remapTarget swaps with the previous owner so the mapping stays a permutation', () => {
    expect(remapTarget(['a', 'b', 'c'], 0, 'c')).toEqual(['c', 'b', 'a']);
    expect(remapTarget(['a', 'b'], 1, 'b')).toEqual(['a', 'b']);
  });

  it('pairTypeNote flags a type mismatch only', () => {
    const { model, patient, doctor } = pharmacy();
    const note = pairTypeNote(model.relations[patient.id]!, model.relations[doctor.id]!, { sourceColumnId: patient.col('DoctorSSN'), targetColumnId: doctor.col('SSN') });
    expect(note).toEqual({ source: 'INT', target: 'CHAR(9)' });
    expect(pairTypeNote(model.relations[patient.id]!, model.relations[doctor.id]!, { sourceColumnId: patient.col('Name'), targetColumnId: doctor.col('Name') })).toBeUndefined();
  });

  it('validTargetColumns highlights only cells of keys with the selection size', () => {
    const { model, drug } = pharmacy();
    const rel = model.relations[drug.id]!;
    expect(validTargetColumns(rel, 2).sort()).toEqual([drug.col('CompanyName'), drug.col('TradeName')].sort());
    expect(validTargetColumns(rel, 1)).toEqual([]);
  });
});
