import { describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import { deepFreeze } from '@/test/deepFreeze';
import { classifyConnect, participantCount } from './chenConnect';

function model() {
  const b = erBuilder('M');
  const doctor = b.entity('Doctor').key('SSN').attr('Name');
  const patient = b.entity('Patient').key('SSN');
  const treats = b.relate('Treats', doctor, patient, '1:N');
  const other = b.relate('Other', doctor, patient, 'M:N');
  const m = b.build();
  const id = (name: string) => Object.values(m.entities).find((e) => e.name === name)!.id;
  const rel = (name: string) => Object.values(m.relationships).find((r) => r.name === name)!.id;
  const attr = Object.values(m.attributes).find((a) => a.name === 'Name')!.id;
  void treats;
  void other;
  return { m: deepFreeze(m), id, rel, attr };
}

describe('classifyConnect', () => {
  it('entity <-> relationship is a participant in both drag directions', () => {
    const { m, id, rel } = model();
    const a = classifyConnect(m, { kind: 'entity', id: id('Doctor') }, { kind: 'relationship', id: rel('Other') });
    expect(a).toMatchObject({ kind: 'participant', recursive: true }); // Doctor already takes part once -> recursive
    const fresh = erBuilder('X');
    const e1 = fresh.entity('A').key('Id');
    const e2 = fresh.entity('B').key('Id');
    const e3 = fresh.entity('C').key('Id');
    fresh.relate('R', e1, e2, '1:N');
    const fm = deepFreeze(fresh.build());
    const c = Object.values(fm.entities).find((e) => e.name === 'C')!.id;
    const r = Object.values(fm.relationships)[0]!.id;
    expect(classifyConnect(fm, { kind: 'entity', id: c }, { kind: 'relationship', id: r })).toEqual({ kind: 'participant', relationshipId: r, entityId: c, recursive: false });
    expect(classifyConnect(fm, { kind: 'relationship', id: r }, { kind: 'entity', id: c })).toEqual({ kind: 'participant', relationshipId: r, entityId: c, recursive: false });
    void e3;
  });

  it('entity -> entity offers a new relationship; the same entity needs the leave-and-return intent (recursive)', () => {
    const { m, id } = model();
    expect(classifyConnect(m, { kind: 'entity', id: id('Doctor') }, { kind: 'entity', id: id('Patient') })).toEqual({ kind: 'new-relationship', entityIds: [id('Doctor'), id('Patient')], recursive: false });
    expect(classifyConnect(m, { kind: 'entity', id: id('Doctor') }, { kind: 'entity', id: id('Doctor') })).toEqual({ kind: 'reject', reason: 'same-entity' });
    expect(classifyConnect(m, { kind: 'entity', id: id('Doctor') }, { kind: 'entity', id: id('Doctor') }, { sameNodeIntent: true })).toEqual({ kind: 'new-relationship', entityIds: [id('Doctor'), id('Doctor')], recursive: true });
  });

  it('relationship <-> relationship and anything with an attribute are rejected with a reason', () => {
    const { m, id, rel, attr } = model();
    expect(classifyConnect(m, { kind: 'relationship', id: rel('Treats') }, { kind: 'relationship', id: rel('Other') })).toEqual({ kind: 'reject', reason: 'relationship-relationship' });
    expect(classifyConnect(m, { kind: 'entity', id: id('Doctor') }, { kind: 'attribute', id: attr })).toEqual({ kind: 'reject', reason: 'attribute' });
    expect(classifyConnect(m, { kind: 'attribute', id: attr }, { kind: 'relationship', id: rel('Treats') })).toEqual({ kind: 'reject', reason: 'attribute' });
  });

  it('a third connection of the same entity to one relationship is refused', () => {
    const b = erBuilder('R');
    const e = b.entity('Emp').key('Id');
    b.relate('Manages', e, e, '1:N');
    const m = deepFreeze(b.build());
    const eid = Object.values(m.entities)[0]!.id;
    const rid = Object.values(m.relationships)[0]!.id;
    expect(participantCount(m, rid, eid)).toBe(2);
    expect(classifyConnect(m, { kind: 'entity', id: eid }, { kind: 'relationship', id: rid })).toEqual({ kind: 'reject', reason: 'recursive-full' });
  });
});
