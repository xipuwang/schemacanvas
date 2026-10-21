import { describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import { fkCardinality, isCandidateKey } from '@/model/queries';
import { col, colNames, fkList, fksOf, pkNames, rel, run, uniqueSets } from './testkit';

const codes = (r: ReturnType<typeof run>): string[] => r.record.warnings.map((w) => w.code);

describe('strong entities', () => {
  it('composite key; composite attribute marked key means all its leaves', () => {
    const b = erBuilder('k');
    b.entity('Flight').key('Airline').key('No').attr('Gate');
    b.entity('Person').composite('Id', ['Country', 'Number'], { key: 'primary' }).attr('Name');
    const { relationalModel: m } = run(b.build());
    expect(pkNames(rel(m, 'Flight'))).toEqual(['Airline', 'No']);
    expect(colNames(rel(m, 'Person'))).toEqual(['Country', 'Number', 'Name']);
    expect(pkNames(rel(m, 'Person'))).toEqual(['Country', 'Number']);
  });

  it('keys come first; optional attributes are nullable, key attributes never; partial key on a strong entity is plain', () => {
    const b = erBuilder('k');
    b.entity('P').attr('Nick', { optional: true }).partialKey('Pk').key('Id', { optional: true });
    const p = rel(run(b.build()).relationalModel, 'P');
    expect(colNames(p)).toEqual(['Id', 'Nick', 'Pk']);
    expect(pkNames(p)).toEqual(['Id']);
    expect(col(p, 'Id').nullable).toBe(false);
    expect(col(p, 'Nick').nullable).toBe(true);
    expect(col(p, 'Pk').nullable).toBe(false);
  });

  it('entity without a key: relation without PK plus a warning-level decision (no conv warning)', () => {
    const b = erBuilder('k');
    b.entity('Loose').attr('x');
    const r = run(b.build());
    expect(rel(r.relationalModel, 'Loose').primaryKey).toEqual([]);
    expect(r.record.decisions.find((d) => d.id.startsWith('strong-entity|no-key'))?.level).toBe('warning');
    expect(codes(r)).toEqual([]);
  });

  it('carryDataTypes=false drops types', () => {
    const b = erBuilder('k');
    b.entity('S').key('Id', { dataType: 'INT' });
    expect(col(rel(run(b.build(), { carryDataTypes: false }).relationalModel, 'S'), 'Id').dataType).toBeUndefined();
  });
});

describe('composite attributes', () => {
  it('nested composites flatten to leaves; optional on the parent makes leaves nullable', () => {
    const b = erBuilder('c');
    b.entity('E').key('Id').composite('Addr', [{ name: 'Street' }, { name: 'Geo', children: ['Lat', 'Lon'] }], { optional: true });
    const e = rel(run(b.build()).relationalModel, 'E');
    expect(colNames(e)).toEqual(['Id', 'Street', 'Lat', 'Lon']);
    expect(col(e, 'Lat').nullable).toBe(true);
    expect(col(e, 'Id').nullable).toBe(false);
  });

  it('colliding leaf names are prefixed with the parent name and a decision is recorded', () => {
    const b = erBuilder('c');
    b.entity('E').key('Id').composite('Home', ['Phone', 'City']).composite('Work', ['Phone', 'Zip']);
    const r = run(b.build());
    const e = rel(r.relationalModel, 'E');
    expect(colNames(e)).toEqual(['Id', 'HomePhone', 'City', 'WorkPhone', 'Zip']);
    expect(r.record.decisions.filter((d) => d.ruleId === 'composite-flatten' && d.title.includes('prefixed'))).toHaveLength(2);
  });

  it('a plain attribute colliding with a flattened leaf gets a deterministic fallback name', () => {
    const b = erBuilder('c');
    b.entity('E').key('Id').attr('City').composite('Addr', ['City']);
    const e = rel(run(b.build()).relationalModel, 'E');
    expect(colNames(e)).toEqual(['Id', 'City', 'AddrCity']);
  });
});

describe('multivalued attributes', () => {
  it('composite multivalued: all leaves in the relation, PK = owner key + all leaves; composite owner key = ONE composite FK', () => {
    const b = erBuilder('m');
    b.entity('Emp').key('Dept').key('No').composite('Phone', ['Area', 'Number'], {}).entity;
    const e = Object.values(b.model.attributes).find((a) => a.name === 'Phone')!;
    e.multivalued = true;
    const r = run(b.build());
    const mv = rel(r.relationalModel, 'Emp_Phone');
    expect(colNames(mv)).toEqual(['EmpDept', 'EmpNo', 'Area', 'Number']);
    expect(pkNames(mv)).toEqual(['EmpDept', 'EmpNo', 'Area', 'Number']);
    expect(fkList(r.relationalModel)).toEqual(['Emp_Phone.(EmpDept, EmpNo) → Emp.(Dept, No)']);
    expect(Object.keys(r.relationalModel.foreignKeys)).toHaveLength(1);
  });

  it('relation names collide deterministically', () => {
    const b = erBuilder('m');
    b.entity('A').key('Id').multivalued('X');
    b.entity('A_X').key('Id');
    const r = run(b.build());
    expect(Object.values(r.relationalModel.relations).map((x) => x.name).sort()).toEqual(['A', 'A_X', 'A_X_2']);
  });

  it('multivalued attribute of a weak entity references the weak key as one composite FK', () => {
    const b = erBuilder('m');
    const o = b.entity('Owner').key('Id');
    const w = b.entity('Dep', { weak: true }).partialKey('N').multivalued('Tag');
    b.relate('Has', o, w, '1:N', { identifying: true, rightTotal: true });
    const r = run(b.build());
    expect(fkList(r.relationalModel)).toContain('Dep_Tag.(OwnerId, DepN) → Dep.(OwnerId, N)');
  });
});

describe('derived attributes', () => {
  it('omitted by default (trace targets [] + decision); materialised when listed; leaf derived inside composite is dropped', () => {
    const b = erBuilder('d');
    const e = b.entity('E').key('Id').attr('Birth').derived('Age', { derivedFrom: [] }).composite('Full', ['A']);
    const age = Object.values(b.model.attributes).find((a) => a.name === 'Age')!;
    const first = run(b.build());
    expect(colNames(rel(first.relationalModel, 'E'))).toEqual(['Id', 'Birth', 'A']);
    const entry = first.record.trace.find((t) => t.source.kind === 'attribute' && t.source.id === age.id)!;
    expect(entry).toMatchObject({ targets: [], ruleId: 'derived-omitted' });
    expect(first.record.decisions.some((d) => d.ruleId === 'derived-omitted' && d.sources[0]!.id === age.id)).toBe(true);

    const second = run(b.build(), { materializeDerived: [age.id] });
    const e2 = rel(second.relationalModel, 'E');
    expect(colNames(e2)).toContain('Age');
    expect(col(e2, 'Age').origin?.ruleId).toBe('derived-materialized');
    expect(second.record.decisions.some((d) => d.ruleId === 'derived-materialized')).toBe(true);
    void e;
  });

  it('derived composite parent omits the whole subtree but traces every descendant', () => {
    const b = erBuilder('d');
    b.entity('E').key('Id').composite('D', ['x', 'y'], { derived: true });
    const r = run(b.build());
    expect(colNames(rel(r.relationalModel, 'E'))).toEqual(['Id']);
    const omitted = r.record.trace.filter((t) => t.ruleId === 'derived-omitted');
    expect(omitted).toHaveLength(3);
  });

  it('multivalued derived attribute creates no relation', () => {
    const b = erBuilder('d');
    b.entity('E').key('Id').derived('Tags', { multivalued: true });
    expect(Object.keys(run(b.build()).relationalModel.relations)).toHaveLength(1);
  });
});

describe('weak entities', () => {
  it('multi-owner: PK = every owner FULL key (participant order) + partial key; one FK per owner', () => {
    const b = erBuilder('w');
    const a = b.entity('A').key('a1').key('a2');
    const c = b.entity('C').key('c1');
    const w = b.entity('W', { weak: true }).partialKey('n').attr('v');
    b.relationship('Ident', [{ entity: a, max: 'one' }, { entity: c, max: 'one' }, { entity: w, participation: 'total' }], { identifying: true });
    const r = run(b.build());
    const wr = rel(r.relationalModel, 'W');
    expect(colNames(wr)).toEqual(['AA1', 'AA2', 'CC1', 'n', 'v']);
    expect(pkNames(wr)).toEqual(['AA1', 'AA2', 'CC1', 'n']);
    expect(fkList(r.relationalModel)).toEqual(['W.(AA1, AA2) → A.(a1, a2)', 'W.CC1 → C.c1']);
    expect(Object.keys(r.relationalModel.relations)).toHaveLength(3);
  });

  it('weak-of-weak chain: the inner key contains the full key of its (weak) owner', () => {
    const b = erBuilder('w');
    const bl = b.entity('Building').key('Name');
    const room = b.entity('Room', { weak: true }).partialKey('No');
    const seat = b.entity('Seat', { weak: true }).partialKey('Pos');
    b.relate('Has', bl, room, '1:N', { identifying: true, rightTotal: true });
    const hs = b.relate('HasSeat', room, seat, '1:N', { identifying: true, rightTotal: true });
    hs.relationship.participants[1]!.identified = true;
    const { relationalModel: m } = run(b.build());
    expect(pkNames(rel(m, 'Room'))).toEqual(['BuildingName', 'No']);
    expect(colNames(rel(m, 'Seat'))).toEqual(['BuildingName', 'RoomNo', 'Pos']);
    expect(pkNames(rel(m, 'Seat'))).toEqual(['BuildingName', 'RoomNo', 'Pos']);
    expect(fkList(m)).toContain('Seat.(BuildingName, RoomNo) → Room.(BuildingName, No)');
  });

  it('ownership cycle: no infinite recursion, cyclic owner part omitted, decision + warning', () => {
    const b = erBuilder('w');
    const x = b.entity('X', { weak: true }).partialKey('px');
    const y = b.entity('Y', { weak: true }).partialKey('py');
    b.relationship('XY', [{ entity: x, max: 'one' }, { entity: y, participation: 'total' }], { identifying: true }).relationship.participants[1]!.identified = true;
    b.relationship('YX', [{ entity: y, max: 'one' }, { entity: x, participation: 'total' }], { identifying: true }).relationship.participants[1]!.identified = true;
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'X'))).toEqual(['px']);
    expect(pkNames(rel(r.relationalModel, 'Y'))).toEqual(['py']);
    expect(Object.keys(r.relationalModel.foreignKeys)).toHaveLength(0);
    expect(codes(r)).toContain('conv.weak-ownership-cycle');
    expect(r.record.decisions.some((d) => d.id.startsWith('weak-entity|cycle'))).toBe(true);
  });

  it('self-ownership is cut as a cycle too', () => {
    const b = erBuilder('w');
    const x = b.entity('X', { weak: true }).partialKey('p');
    b.relationship('Self', [{ entity: x, max: 'one' }, { entity: x, participation: 'total' }], { identifying: true }).relationship.participants[1]!.identified = true;
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'X'))).toEqual(['p']);
    expect(codes(r)).toContain('conv.weak-ownership-cycle');
  });

  it("'primary' on a weak entity acts as partial key; identifying relationship attributes land on the weak relation", () => {
    const b = erBuilder('w');
    const o = b.entity('O').key('Id');
    const w = b.entity('W', { weak: true }).key('N');
    const rr = b.relate('Owns', o, w, '1:N', { identifying: true, rightTotal: true });
    rr.attr('Since');
    const r = run(b.build());
    const wr = rel(r.relationalModel, 'W');
    expect(pkNames(wr)).toEqual(['OId', 'N']);
    expect(colNames(wr)).toEqual(['OId', 'N', 'Since']);
    expect(r.record.decisions.some((d) => d.ruleId === 'relationship-attribute')).toBe(true);
    expect(r.record.trace.find((t) => t.source.kind === 'attribute' && t.source.id === Object.values(b.model.attributes).find((a) => a.name === 'Since')!.id)!.targets).toHaveLength(1);
  });

  it('weak entity without partial key: PK is only the owner key, decision at warning level', () => {
    const b = erBuilder('w');
    const o = b.entity('O').key('Id');
    const w = b.entity('W', { weak: true }).attr('v');
    b.relate('Owns', o, w, '1:N', { identifying: true, rightTotal: true });
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'W'))).toEqual(['OId']);
    expect(r.record.decisions.find((d) => d.id === `weak-entity|${Object.values(b.model.entities).find((e) => e.name === 'W')!.id}`)?.level).toBe('warning');
  });

  it('unresolved identifying relationship is converted as an ordinary one with a conv warning', () => {
    const b = erBuilder('w');
    const a = b.entity('A').key('x');
    const c = b.entity('B').key('y');
    b.relate('Odd', a, c, '1:N', { identifying: true });
    const r = run(b.build());
    expect(codes(r)).toContain('conv.identifying-unresolved');
    expect(fkList(r.relationalModel)).toEqual(['B.AX → A.x']);
  });
});

describe('1:N', () => {
  it('FK goes to the N side referencing the 1 side — never the reverse; nullable unless the N side is total', () => {
    const b = erBuilder('n');
    const d = b.entity('Dept').key('Did').attr('Name');
    const e = b.entity('Emp').key('Eid');
    b.relate('WorksFor', d, e, '1:N');
    const partial = run(b.build()).relationalModel;
    expect(fkList(partial)).toEqual(['Emp.DeptDid → Dept.Did']);
    expect(col(rel(partial, 'Emp'), 'DeptDid').nullable).toBe(true);
    expect(colNames(rel(partial, 'Dept'))).toEqual(['Did', 'Name']);

    const b2 = erBuilder('n');
    const d2 = b2.entity('Dept').key('Did');
    const e2 = b2.entity('Emp').key('Eid');
    b2.relate('WorksFor', d2, e2, '1:N', { rightTotal: true });
    const total = run(b2.build()).relationalModel;
    expect(col(rel(total, 'Emp'), 'DeptDid').nullable).toBe(false);
    expect(fkCardinality(total, Object.values(total.foreignKeys)[0]!)).toMatchObject({ parentMin: 1, childMax: 'many' });
  });

  it('N:1 written the other way round gives the same result', () => {
    const b = erBuilder('n');
    const e = b.entity('Emp').key('Eid');
    const d = b.entity('Dept').key('Did');
    b.relate('WorksFor', e, d, 'N:1');
    expect(fkList(run(b.build()).relationalModel)).toEqual(['Emp.DeptDid → Dept.Did']);
  });

  it('total participation on the ONE side: childMin=1 + conv.total-on-one-side-unenforceable', () => {
    const b = erBuilder('n');
    const d = b.entity('Dept').key('Did');
    const e = b.entity('Emp').key('Eid');
    b.relate('WorksFor', d, e, '1:N', { leftTotal: true });
    const r = run(b.build());
    const fk = Object.values(r.relationalModel.foreignKeys)[0]!;
    expect(fk.cardinality?.childMin).toBe(1);
    const w = r.record.warnings.find((x) => x.code === 'conv.total-on-one-side-unenforceable')!;
    expect(w.affected.some((a) => a.kind === 'foreignKey' && a.id === fk.id)).toBe(true);
    expect(w.modelId).toBe(b.model.id);
  });

  it('relationship attributes move to the N side (nullable when the FK is nullable); a key flag is ignored with a warning', () => {
    const b = erBuilder('n');
    const d = b.entity('Dept').key('Did');
    const e = b.entity('Emp').key('Eid');
    b.relate('WorksFor', d, e, '1:N').attr('Since').key('Role');
    const r = run(b.build());
    const emp = rel(r.relationalModel, 'Emp');
    expect(colNames(emp)).toEqual(['Eid', 'DeptDid', 'Since', 'Role']);
    expect(col(emp, 'Since').nullable).toBe(true);
    expect(pkNames(emp)).toEqual(['Eid']);
    expect(codes(r)).toContain('conv.relationship-key-attr-folded');
  });

  it('1:N as separate relation on request: PK = the many side only', () => {
    const b = erBuilder('n');
    const d = b.entity('Dept').key('Did');
    const e = b.entity('Emp').key('Eid');
    const w = b.relate('WorksFor', d, e, '1:N');
    const { relationalModel: m } = run(b.build(), { relationshipOverrides: { [w.id]: { asRelation: true } } });
    const wf = rel(m, 'WorksFor');
    expect(colNames(wf)).toEqual(['DeptDid', 'EmpEid']);
    expect(pkNames(wf)).toEqual(['EmpEid']);
    expect(colNames(rel(m, 'Emp'))).toEqual(['Eid']);
  });

  it('FK to a composite key is ONE ForeignKey; keyless referenced entity yields no FK and a decision', () => {
    const b = erBuilder('n');
    const a = b.entity('A').key('x').key('y');
    const c = b.entity('C').key('z');
    b.relate('R', a, c, '1:N');
    const r1 = run(b.build());
    expect(fkList(r1.relationalModel)).toEqual(['C.(AX, AY) → A.(x, y)']);

    const b2 = erBuilder('n');
    const k = b2.entity('K').attr('q');
    const c2 = b2.entity('C').key('z');
    b2.relate('R', k, c2, '1:N');
    const r2 = run(b2.build());
    expect(Object.keys(r2.relationalModel.foreignKeys)).toHaveLength(0);
    expect(r2.record.decisions.some((d) => d.id.startsWith('one-to-many-fk|omitted'))).toBe(true);
  });
});

describe('1:1', () => {
  const build = (leftTotal: boolean, rightTotal: boolean) => {
    const b = erBuilder('o');
    const p = b.entity('Person').key('Pid').attr('Name');
    const q = b.entity('Passport').key('No').attr('Country');
    const r = b.relate('Holds', p, q, '1:1', { leftTotal, rightTotal });
    r.attr('Issued');
    return { b, r };
  };

  it('auto: FK on the total-participation side, NOT NULL + UNIQUE; attribute follows the FK holder', () => {
    const { b } = build(false, true);
    const { relationalModel: m, record } = run(b.build());
    const pass = rel(m, 'Passport');
    expect(colNames(pass)).toEqual(['No', 'Country', 'PersonPid', 'Issued']);
    expect(col(pass, 'PersonPid').nullable).toBe(false);
    expect(uniqueSets(pass)).toEqual([['PersonPid']]);
    expect(isCandidateKey(pass, [col(pass, 'PersonPid').id])).toBe(true);
    expect(fkList(m)).toEqual(['Passport.PersonPid → Person.Pid']);
    expect(record.warnings.map((w) => w.code)).toEqual([]);
  });

  it('auto, first participant total: FK on the first; total on the referenced side is flagged', () => {
    const { b } = build(true, false);
    const r = run(b.build());
    expect(fkList(r.relationalModel)).toEqual(['Person.PassportNo → Passport.No']);
    expect(col(rel(r.relationalModel, 'Person'), 'PassportNo').nullable).toBe(false);
    expect(codes(r)).toEqual([]);
  });

  it('auto, both total: still an FK (first participant) with the both-total warning and the unenforceable note', () => {
    const { b } = build(true, true);
    const r = run(b.build());
    expect(fkList(r.relationalModel)).toEqual(['Person.PassportNo → Passport.No']);
    expect(codes(r).sort()).toEqual(['conv.one-to-one-both-total', 'conv.total-on-one-side-unenforceable']);
  });

  it('auto, neither total: nullable UNIQUE FK on the first participant + ambiguous-placement warning', () => {
    const { b } = build(false, false);
    const r = run(b.build());
    const person = rel(r.relationalModel, 'Person');
    expect(col(person, 'PassportNo').nullable).toBe(true);
    expect(uniqueSets(person)).toEqual([['PassportNo']]);
    expect(codes(r)).toEqual(['conv.one-to-one-ambiguous-placement']);
  });

  it('fk-on-first / fk-on-second / per-relationship fkParticipantId (wins) / asRelation', () => {
    const { b, r } = build(false, true);
    const model = b.build();
    expect(fkList(run(model, { oneToOne: 'fk-on-first' }).relationalModel)).toEqual(['Person.PassportNo → Passport.No']);
    expect(fkList(run(model, { oneToOne: 'fk-on-second' }).relationalModel)).toEqual(['Passport.PersonPid → Person.Pid']);
    const [p0, p1] = r.relationship.participants;
    expect(
      fkList(run(model, { oneToOne: 'fk-on-second', relationshipOverrides: { [r.id]: { fkParticipantId: p0!.id } } }).relationalModel),
    ).toEqual(['Person.PassportNo → Passport.No']);
    expect(fkList(run(model, { relationshipOverrides: { [r.id]: { fkParticipantId: p1!.id, oneToOne: 'merge' } } }).relationalModel)).toEqual(['Passport.PersonPid → Person.Pid']);
    const asRel = run(model, { relationshipOverrides: { [r.id]: { asRelation: true } } }).relationalModel;
    const holds = rel(asRel, 'Holds');
    expect(colNames(holds)).toEqual(['PersonPid', 'PassportNo', 'Issued']);
    // 1:1 candidate keys are [second] then [first]; the first one is the PK, the other is UNIQUE.
    expect(pkNames(holds)).toEqual(['PassportNo']);
    expect(uniqueSets(holds)).toEqual([['PersonPid']]);
    expect(Object.values(asRel.foreignKeys).every((fk) => fk.origin?.ruleId === 'one-to-one-relation')).toBe(true);
  });

  it('invalid fkParticipantId warns and falls back to the strategy', () => {
    const { b, r } = build(false, true);
    const res = run(b.build(), { relationshipOverrides: { [r.id]: { fkParticipantId: 'par_nope' } } });
    expect(codes(res)).toContain('conv.fk-participant-invalid');
    expect(fkList(res.relationalModel)).toEqual(['Passport.PersonPid → Person.Pid']);
  });

  it('merge (total side first): one relation keyed by the partial side, other key UNIQUE, nullable partner columns, attribute kept', () => {
    const { b } = build(false, true); // Passport total, Person partial -> Person keys the merged relation
    const r = run(b.build(), { oneToOne: 'merge' });
    expect(Object.keys(r.relationalModel.relations)).toHaveLength(1);
    const m = rel(r.relationalModel, 'Person_Passport');
    expect(colNames(m)).toEqual(['Pid', 'Name', 'No', 'Country', 'Issued']);
    expect(pkNames(m)).toEqual(['Pid']);
    expect(uniqueSets(m)).toEqual([['No']]);
    expect(col(m, 'Country').nullable).toBe(true);
    expect(col(m, 'No').nullable).toBe(true);
    expect(col(m, 'Name').nullable).toBe(false);
    expect(Object.keys(r.relationalModel.foreignKeys)).toHaveLength(0);
    expect(codes(r)).toEqual([]);
  });

  it('merge, both total: NOT NULL partner columns; both partial: lossy warning', () => {
    const both = run(build(true, true).b.build(), { oneToOne: 'merge' });
    const m = rel(both.relationalModel, 'Person_Passport');
    expect(col(m, 'Country').nullable).toBe(false);
    expect(col(m, 'No').nullable).toBe(false);
    const none = run(build(false, false).b.build(), { oneToOne: 'merge' });
    expect(codes(none)).toContain('conv.one-to-one-merge-lossy');
  });

  it('merge ineligible (weak entity involved / recursive) falls back to an FK with a warning', () => {
    const b = erBuilder('o');
    const p = b.entity('P').key('id');
    b.relate('Spouse', p, p, '1:1');
    const r = run(b.build(), { oneToOne: 'merge' });
    expect(codes(r)).toContain('conv.one-to-one-merge-ineligible');
    expect(fkList(r.relationalModel)).toEqual(['P.PId → P.id']);
  });

  it('other entities can reference a merged relation through either key', () => {
    const b = erBuilder('o');
    const p = b.entity('Person').key('Pid');
    const q = b.entity('Passport').key('No');
    const v = b.entity('Visa').key('V');
    b.relate('Holds', p, q, '1:1', { leftTotal: true, rightTotal: true });
    b.relate('Grants', q, v, '1:N');
    const { relationalModel: m } = run(b.build(), { oneToOne: 'merge' });
    expect(fkList(m)).toEqual(['Visa.PassportNo → Person_Passport.No']);
  });
});

describe('M:N', () => {
  it('separate relation, FK columns NOT NULL, PK = both FKs, attributes kept (composite flattened, multivalued split, derived omitted)', () => {
    const b = erBuilder('mn');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    const en = b.relate('Enrolls', s, c, 'M:N');
    en.attr('Grade', { optional: true }).composite('When', ['Year', 'Term']).multivalued('Notes').derived('Passed');
    const r = run(b.build());
    const e = rel(r.relationalModel, 'Enrolls');
    expect(colNames(e)).toEqual(['StudentSid', 'CourseCid', 'Grade', 'Year', 'Term']);
    expect(pkNames(e)).toEqual(['StudentSid', 'CourseCid']);
    expect(col(e, 'Grade').nullable).toBe(true);
    expect(col(e, 'StudentSid').nullable).toBe(false);
    expect(fkList(r.relationalModel).filter((x) => x.startsWith('Enrolls.'))).toEqual(['Enrolls.CourseCid → Course.Cid', 'Enrolls.StudentSid → Student.Sid']);
    const notes = rel(r.relationalModel, 'Enrolls_Notes');
    expect(colNames(notes)).toEqual(['StudentSid', 'CourseCid', 'Notes']);
    expect(fkList(r.relationalModel)).toContain('Enrolls_Notes.(StudentSid, CourseCid) → Enrolls.(StudentSid, CourseCid)');
  });

  it('relationship key attribute (discriminator) joins the PK', () => {
    const b = erBuilder('mn');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    b.relate('Attends', s, c, 'M:N').key('Date');
    const e = rel(run(b.build()).relationalModel, 'Attends');
    expect(pkNames(e)).toEqual(['StudentSid', 'CourseCid', 'Date']);
  });

  it('total participation is annotated, not claimed to be enforced', () => {
    const b = erBuilder('mn');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    b.relate('Enrolls', s, c, 'M:N', { leftTotal: true });
    const r = run(b.build());
    expect(codes(r)).toEqual(['conv.total-participation-unenforceable']);
    const studentFk = fksOf(r.relationalModel, rel(r.relationalModel, 'Enrolls')).find((fk) => fk.targetRelationId === rel(r.relationalModel, 'Student').id)!;
    expect(studentFk.cardinality?.childMin).toBe(1);
  });

  it('name collisions fall back to the owner-prefixed name, then to the role suffix', () => {
    const b = erBuilder('mn');
    const a = b.entity('A').key('id');
    const c = b.entity('C').key('id');
    const x = b.relate('R', a, c, 'M:N');
    x.attr('AId');
    const r = run(b.build());
    expect(colNames(rel(r.relationalModel, 'R'))).toEqual(['AId', 'CId', 'RAId']);
    const dup = erBuilder('mn');
    const a2 = dup.entity('A').key('id');
    dup.relate('R', a2, a2, 'M:N', { leftRole: 'x', rightRole: 'x' });
    expect(colNames(rel(run(dup.build()).relationalModel, 'R'))).toEqual(['XId', 'XId_X']);
  });

  it('columnNames overrides survive (keyed by origin.key) and carry through re-conversion', () => {
    const b = erBuilder('mn');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    b.relate('Enrolls', s, c, 'M:N');
    const first = run(b.build());
    const fkcol = rel(first.relationalModel, 'Enrolls').columns[0]!;
    const second = run(b.build(), { columnNames: { [fkcol.origin!.key!]: 'SID' } });
    expect(colNames(rel(second.relationalModel, 'Enrolls'))).toEqual(['SID', 'CourseCid']);
  });
});

describe('ternary / n-ary', () => {
  const ternary = (maxes: Array<'one' | 'many'>, keyIds?: (ids: string[]) => string[]) => {
    const b = erBuilder('t');
    const ents = ['A', 'B', 'C'].map((n) => b.entity(n).key('id').entity);
    const rel = b.relationship('Supply', ents.map((e, i) => ({ entity: e.id, max: maxes[i]!, role: ['p', 'q', 'r'][i]! })));
    if (keyIds) rel.relationship.keyParticipantIds = keyIds(rel.relationship.participants.map((p) => p.id));
    return { b, rel };
  };

  it('exactly one "one" participant: PK excludes that participant FK, which stays NOT NULL', () => {
    const { b } = ternary(['many', 'many', 'one']);
    const r = run(b.build());
    const s = rel(r.relationalModel, 'Supply');
    expect(colNames(s)).toEqual(['PId', 'QId', 'RId']);
    expect(pkNames(s)).toEqual(['PId', 'QId']);
    expect(col(s, 'RId').nullable).toBe(false);
    expect(uniqueSets(s)).toEqual([]);
    expect(Object.values(r.relationalModel.foreignKeys)).toHaveLength(3);
  });

  it('two "one" participants: first candidate key is the PK, the other becomes UNIQUE', () => {
    const { b } = ternary(['one', 'one', 'many']);
    const s = rel(run(b.build()).relationalModel, 'Supply');
    expect(pkNames(s)).toEqual(['QId', 'RId']);
    expect(uniqueSets(s)).toEqual([['PId', 'RId']]);
  });

  it('all-many ternary: PK = all FKs', () => {
    const { b } = ternary(['many', 'many', 'many']);
    const s = rel(run(b.build()).relationalModel, 'Supply');
    expect(pkNames(s)).toEqual(['PId', 'QId', 'RId']);
  });

  it('user keyParticipantIds: a valid superkey is honoured (candidate key stays UNIQUE)', () => {
    const { b } = ternary(['many', 'many', 'one'], (ids) => ids);
    const r = run(b.build());
    const s = rel(r.relationalModel, 'Supply');
    expect(pkNames(s)).toEqual(['PId', 'QId', 'RId']);
    expect(uniqueSets(s)).toEqual([['PId', 'QId']]);
    expect(codes(r)).toEqual([]);
  });

  it('user keyParticipantIds: an invalid key falls back to the first candidate key with a warning', () => {
    const { b } = ternary(['many', 'many', 'one'], (ids) => [ids[0]!]);
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'Supply'))).toEqual(['PId', 'QId']);
    expect(codes(r)).toEqual(['conv.relationship-key-fallback']);
  });

  it('user key with a dangling participant id is invalid too', () => {
    const { b } = ternary(['many', 'many', 'many'], (ids) => [...ids, 'par_ghost']);
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'Supply'))).toEqual(['PId', 'QId', 'RId']);
    expect(codes(r)).toEqual(['conv.relationship-key-fallback']);
  });

  it('roles are preserved in FK column names; relationship attributes kept; total participation flagged', () => {
    const b = erBuilder('t');
    const a = b.entity('A').key('id');
    const c = b.entity('B').key('id');
    const d = b.entity('C').key('id');
    b.relationship('Supply', [{ entity: a, role: 'supplier', participation: 'total' }, { entity: c }, { entity: d }]).attr('Qty');
    const r = run(b.build());
    expect(colNames(rel(r.relationalModel, 'Supply'))).toEqual(['SupplierId', 'BId', 'CId', 'Qty']);
    expect(codes(r)).toEqual(['conv.total-participation-unenforceable']);
  });

  it('4-ary relationship works', () => {
    const b = erBuilder('t');
    const ents = ['A', 'B', 'C', 'D'].map((n) => b.entity(n).key('id'));
    b.relationship('Quad', ents.map((e) => ({ entity: e })));
    const q = rel(run(b.build()).relationalModel, 'Quad');
    expect(pkNames(q)).toHaveLength(4);
  });

  it('degenerate relationship (one participant) is omitted: trace targets [] + decision', () => {
    const b = erBuilder('t');
    const a = b.entity('A').key('id');
    const r0 = b.relationship('Solo', [{ entity: a }]);
    const r = run(b.build());
    expect(Object.keys(r.relationalModel.relations)).toHaveLength(1);
    expect(r.record.trace.find((t) => t.source.kind === 'relationship' && t.source.id === r0.id)!.targets).toEqual([]);
    expect(r.record.decisions.some((d) => d.id.includes('omitted'))).toBe(true);
  });
});

describe('associative entities', () => {
  it('exactly ONE relation: FK per participant + own attributes; own key => PK, candidate keys UNIQUE', () => {
    const b = erBuilder('as');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    const enroll = b.relate('Enroll', s, c, 'M:N');
    const assoc = b.associativeEntity('Enrollment', enroll).key('EnrollId').attr('Grade');
    void assoc;
    const r = run(b.build());
    const names = Object.values(r.relationalModel.relations).map((x) => x.name).sort();
    expect(names).toEqual(['Course', 'Enrollment', 'Student']);
    const e = rel(r.relationalModel, 'Enrollment');
    expect(colNames(e)).toEqual(['StudentSid', 'CourseCid', 'EnrollId', 'Grade']);
    expect(pkNames(e)).toEqual(['EnrollId']);
    expect(uniqueSets(e)).toEqual([['StudentSid', 'CourseCid']]);
    expect(fkList(r.relationalModel)).toEqual(['Enrollment.CourseCid → Course.Cid', 'Enrollment.StudentSid → Student.Sid']);
    expect(r.record.trace.find((t) => t.source.kind === 'relationship')!.ruleId).toBe('associative-entity');
  });

  it('without own key: PK = chosen key of the relationship; can be referenced by another relationship', () => {
    const b = erBuilder('as');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    const g = b.entity('Grader').key('Gid');
    const enroll = b.relate('Enroll', s, c, 'M:N');
    const assoc = b.associativeEntity('Enrollment', enroll).attr('Grade');
    b.relate('Grades', g, assoc, '1:N');
    const r = run(b.build());
    const e = rel(r.relationalModel, 'Enrollment');
    expect(pkNames(e)).toEqual(['StudentSid', 'CourseCid']);
    expect(colNames(e)).toEqual(['StudentSid', 'CourseCid', 'Grade', 'GraderGid']);
    expect(fkList(r.relationalModel)).toContain('Enrollment.GraderGid → Grader.Gid');
  });

  it('a relationship referencing an associative entity gets its composite key as ONE FK', () => {
    const b = erBuilder('as');
    const s = b.entity('Student').key('Sid');
    const c = b.entity('Course').key('Cid');
    const enroll = b.relate('Enroll', s, c, 'M:N');
    const assoc = b.associativeEntity('Enrollment', enroll);
    const n = b.entity('Note').key('Nid');
    b.relate('About', assoc, n, 'N:1');
    const r = run(b.build());
    expect(fkList(r.relationalModel)).toContain('Enrollment.NoteNid → Note.Nid');
    const b2 = erBuilder('as2');
    const s2 = b2.entity('Student').key('Sid');
    const c2 = b2.entity('Course').key('Cid');
    const enr2 = b2.relate('Enroll', s2, c2, 'M:N');
    const assoc2 = b2.associativeEntity('Enrollment', enr2);
    const n2 = b2.entity('Note').key('Nid');
    b2.relate('About', n2, assoc2, '1:N');
    expect(fkList(run(b2.build()).relationalModel)).toContain('Enrollment.NoteNid → Note.Nid');
    const b3 = erBuilder('as3');
    const s3 = b3.entity('Student').key('Sid');
    const c3 = b3.entity('Course').key('Cid');
    const enr3 = b3.relate('Enroll', s3, c3, 'M:N');
    const assoc3 = b3.associativeEntity('Enrollment', enr3);
    const n3 = b3.entity('Note').key('Nid');
    b3.relate('About', assoc3, n3, '1:N');
    expect(fkList(run(b3.build()).relationalModel)).toContain('Note.(StudentSid, CourseCid) → Enrollment.(StudentSid, CourseCid)');
  });
});

describe('name collisions', () => {
  it('relationship named like an entity gets a suffix and a decision', () => {
    const b = erBuilder('x');
    const a = b.entity('A').key('id');
    const c = b.entity('C').key('id');
    b.relate('A', a, c, 'M:N');
    const r = run(b.build());
    expect(Object.values(r.relationalModel.relations).map((x) => x.name).sort()).toEqual(['A', 'A_2', 'C']);
    expect(r.record.decisions.some((d) => d.title.includes('A_2'))).toBe(true);
  });

  it('two FKs to the same entity in one 1:N holder collide deterministically', () => {
    const b = erBuilder('x');
    const p = b.entity('Person').key('id');
    const t = b.entity('Trip').key('tid');
    b.relate('Drives', p, t, '1:N');
    b.relate('Rides', p, t, '1:N');
    const trip = rel(run(b.build()).relationalModel, 'Trip');
    expect(colNames(trip)).toEqual(['tid', 'PersonId', 'PersonId_Person']);
  });
});
