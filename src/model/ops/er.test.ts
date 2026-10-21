import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { associativeEntityOf, identifiedParticipants } from '../erSemantics';
import { useDeterministicIds } from '../ids';
import { attributesOf } from '../queries';
import type { ErModel, Project } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { projectWith, run, sampleEr } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(1000);
});
afterEach(() => restore());

function setup(...extra: Array<'chen'>) {
  const s = sampleEr();
  const p = projectWith(s.model, 'chen', ...extra);
  const dgm = Object.keys(p.diagrams)[0]!;
  return { s, p, mid: s.model.id, dgm };
}
const er = (p: Project, id: string): ErModel => p.models[id] as ErModel;
const nodeOf = (p: Project, dgm: string, kind: string, id: string) =>
  Object.values(p.diagrams[dgm]!.nodes).find((n) => n.ref.kind === kind && n.ref.id === id);

describe('addEntity', () => {
  it('creates the entity, a node in every diagram (complete) and returns refs + nodeIds', () => {
    const { p, mid } = setup('chen');
    const { project, result } = run(p, (d) => ops.addEntity(d, mid, { name: 'Project' }));
    const id = result.refs[0]!.id;
    expect(er(project, mid).entities[id]).toMatchObject({ name: 'Project', weak: false });
    for (const d of Object.values(project.diagrams)) {
      expect(nodeOf(project, d.id, 'entity', id)).toBeDefined();
      expect(result.nodeIds[d.id]).toEqual([nodeOf(project, d.id, 'entity', id)!.id]);
    }
  });

  it('places the node only in the target diagram; the other diagram gets a provisional node', () => {
    const { p, mid, dgm } = setup('chen');
    const other = Object.keys(p.diagrams).find((x) => x !== dgm)!;
    const { project, result } = run(p, (d) => ops.addEntity(d, mid, { id: 'ent_mine' }, { diagramId: dgm, x: 333, y: 77 }));
    expect(nodeOf(project, dgm, 'entity', 'ent_mine')).toMatchObject({ x: 333, y: 77 });
    expect(nodeOf(project, other, 'entity', 'ent_mine')).toBeDefined();
    expect(nodeOf(project, other, 'entity', 'ent_mine')!.x).not.toBe(333);
    expect(result.refs).toEqual([{ kind: 'entity', id: 'ent_mine' }]);
  });

  it('gives the new node zIndex = max + 1 and a unique default name', () => {
    const { p, mid, dgm } = setup();
    const { project, result } = run(p, (d) => {
      ops.addEntity(d, mid);
      return ops.addEntity(d, mid);
    });
    const names = Object.values(er(project, mid).entities).map((e) => e.name);
    expect(names).toContain('Entity');
    expect(names).toContain('Entity_2');
    const zs = Object.values(project.diagrams[dgm]!.nodes).map((n) => n.zIndex!);
    expect(new Set(zs).size).toBe(zs.length);
    expect(nodeOf(project, dgm, 'entity', result.refs[0]!.id)!.zIndex).toBe(Math.max(...zs));
  });

  it('adds the node explicitly to a PARTIAL target diagram at the requested place', () => {
    const { p, mid, dgm } = setup();
    const partial = run(p, (d) => ops.removeFromDiagram(d, dgm, [Object.keys(d.diagrams[dgm]!.nodes)[0]!])).project;
    expect(partial.diagrams[dgm]!.partial).toBe(true);
    const { project } = run(partial, (d) => ops.addEntity(d, mid, { id: 'ent_new' }, { diagramId: dgm, x: 10, y: 20 }));
    expect(nodeOf(project, dgm, 'entity', 'ent_new')).toMatchObject({ x: 10, y: 20 });
  });

  it('refuses a taken id, a wrong-kind model and a diagram of another model', () => {
    const { p, mid, s } = setup();
    expect(() => run(p, (d) => ops.addEntity(d, mid, { id: s.dept.id }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.addEntity(d, 'mdl_missing'))).toThrow(OpError);
    const other = ops_createOtherModel(p);
    expect(() => run(other.p, (d) => ops.addEntity(d, mid, {}, { diagramId: other.dgm, x: 0, y: 0 }))).toThrow(OpError);
  });
});

function ops_createOtherModel(p: Project) {
  const { project, result } = run(p, (d) => ops.createDiagram(d, { type: 'chen', modelName: 'Other' }));
  return { p: project, dgm: result.diagramId };
}

describe('updateEntity / removeEntity', () => {
  it('renames and toggles weak without touching refs', () => {
    const { p, mid, s } = setup();
    const before = p.diagrams[Object.keys(p.diagrams)[0]!]!;
    const { project } = run(p, (d) => {
      ops.updateEntity(d, mid, s.dept.id, { name: 'Department', weak: true, description: 'x' });
    });
    expect(er(project, mid).entities[s.dept.id]).toMatchObject({ name: 'Department', weak: true, description: 'x' });
    expect(Object.keys(project.diagrams[before.id]!.edges)).toEqual(Object.keys(before.edges));
    const cleared = run(project, (d) => ops.updateEntity(d, mid, s.dept.id, { description: undefined })).project;
    expect('description' in er(cleared, mid).entities[s.dept.id]!).toBe(false);
  });

  it('cascade: deletes the attribute subtree, participants and keyParticipantIds; keeps relationships with < 2 participants', () => {
    const { p, mid, s } = setup();
    const withKey = run(p, (d) => {
      const rel = er(d, mid).relationships[s.works.id]!;
      ops.updateRelationship(d, mid, rel.id, { keyParticipantIds: rel.participants.map((x) => x.id) });
    }).project;
    const deptParticipant = er(withKey, mid).relationships[s.works.id]!.participants[0]!;
    const { project } = run(withKey, (d) => ops.removeEntity(d, mid, s.dept.id));
    const m = er(project, mid);
    expect(m.entities[s.dept.id]).toBeUndefined();
    expect(Object.values(m.attributes).some((a) => a.owner.id === s.dept.id)).toBe(false);
    const rel = m.relationships[s.works.id]!;
    expect(rel.participants.map((x) => x.id)).not.toContain(deptParticipant.id);
    expect(rel.participants).toHaveLength(1); // soft state kept
    expect(rel.keyParticipantIds).toEqual([rel.participants[0]!.id]);
    // its relationship attribute survives; the dangling participant edge is gone from every diagram
    expect(Object.values(m.attributes).some((a) => a.name === 'since')).toBe(true);
    expect(Object.values(project.diagrams[Object.keys(project.diagrams)[0]!]!.edges).some((e) => e.ref.kind === 'participant' && e.ref.participantId === deptParticipant.id)).toBe(false);
  });

  it('drops keyParticipantIds entirely when its last participant disappears', () => {
    const { p, mid, s } = setup();
    const keyed = run(p, (d) => {
      const rel = er(d, mid).relationships[s.works.id]!;
      ops.updateRelationship(d, mid, rel.id, { keyParticipantIds: [rel.participants[0]!.id] });
    }).project;
    const { project } = run(keyed, (d) => ops.removeEntity(d, mid, s.dept.id));
    expect(er(project, mid).relationships[s.works.id]!.keyParticipantIds).toBeUndefined();
  });

  it('removes both participants of a recursive relationship when its entity goes', () => {
    const { p, mid, s } = setup();
    const rec = run(p, (d) => ops.addRelationship(d, mid, { name: 'Manages', participants: [{ entityId: s.emp.id, max: 'one' }, { entityId: s.emp.id }] })).project;
    const { project } = run(rec, (d) => ops.removeEntity(d, mid, s.emp.id));
    const manages = Object.values(er(project, mid).relationships).find((r) => r.name === 'Manages')!;
    expect(manages.participants).toEqual([]);
  });
});

describe('attributes', () => {
  it('addAttribute: owners entity | relationship | composite parent; order is dense; index honoured', () => {
    const { p, mid, s } = setup();
    const { project } = run(p, (d) => {
      ops.addAttribute(d, mid, { kind: 'entity', id: s.dept.id }, { id: 'att_first', name: 'Budget', dataType: 'INT', optional: true }, undefined);
      ops.addAttribute(d, mid, { kind: 'entity', id: s.dept.id }, { id: 'att_zero', name: 'Zero', index: 0 });
      ops.addAttribute(d, mid, { kind: 'relationship', id: s.works.id }, { name: 'hours' });
      const name = Object.values(er(d, mid).attributes).find((a) => a.name === 'Name')!;
      ops.addAttribute(d, mid, { kind: 'attribute', id: name.id }, { name: 'Middle' });
    });
    const m = er(project, mid);
    expect(attributesOf(m, { kind: 'entity', id: s.dept.id }).map((a) => [a.name, a.order])).toEqual([['Zero', 0], ['Dnum', 1], ['Dname', 2], ['Budget', 3]]);
    expect(m.attributes['att_first']).toMatchObject({ dataType: 'INT', optional: true, key: 'none' });
    expect(Object.values(m.attributes).find((a) => a.name === 'Middle')!.owner.kind).toBe('attribute');
  });

  it('addAttribute creates the node + owner edge in every diagram and returns them', () => {
    const { p, mid, s } = setup('chen');
    const { project, result } = run(p, (d) => ops.addAttribute(d, mid, { kind: 'entity', id: s.emp.id }, { name: 'Salary' }));
    for (const dg of Object.values(project.diagrams)) {
      expect(result.nodeIds[dg.id]).toHaveLength(1);
      expect(Object.values(dg.edges).some((e) => e.ref.kind === 'attribute' && e.ref.attributeId === result.refs[0]!.id)).toBe(true);
    }
  });

  it('addAttribute refuses a missing owner; derivedFrom keeps only existing, non-self ids', () => {
    const { p, mid, s } = setup();
    expect(() => run(p, (d) => ops.addAttribute(d, mid, { kind: 'entity', id: 'ent_nope' }))).toThrow(OpError);
    const dnum = Object.values(er(p, mid).attributes).find((a) => a.name === 'Dnum')!;
    const { project, result } = run(p, (d) =>
      ops.addAttribute(d, mid, { kind: 'entity', id: s.dept.id }, { id: 'att_age', name: 'Age', derived: true, derivedFrom: [dnum.id, 'att_ghost', 'att_age'] }),
    );
    expect(er(project, mid).attributes[result.refs[0]!.id]!.derivedFrom).toEqual([dnum.id]);
  });

  it('updateAttribute: edits fields, explicit undefined clears optionals, derivedFrom is sanitised', () => {
    const { p, mid } = setup();
    const a = Object.values(er(p, mid).attributes).find((x) => x.name === 'Dname')!;
    const b = Object.values(er(p, mid).attributes).find((x) => x.name === 'Dnum')!;
    const { project } = run(p, (d) =>
      ops.updateAttribute(d, mid, a.id, { name: 'DeptName', key: 'partial', multivalued: true, derived: true, optional: true, dataType: 'TEXT', derivedFrom: [b.id, a.id, 'x'] }),
    );
    expect(er(project, mid).attributes[a.id]).toMatchObject({ name: 'DeptName', key: 'partial', multivalued: true, derived: true, optional: true, dataType: 'TEXT', derivedFrom: [b.id] });
    const cleared = run(project, (d) => ops.updateAttribute(d, mid, a.id, { optional: undefined, dataType: undefined, derivedFrom: undefined })).project;
    const got = er(cleared, mid).attributes[a.id]!;
    expect('optional' in got || 'dataType' in got || 'derivedFrom' in got).toBe(false);
  });

  it('reorderAttribute: moves within the owner, clamps, never changes ownership or ids', () => {
    const { p, mid, s } = setup();
    const owner = { kind: 'entity' as const, id: s.emp.id };
    const before = attributesOf(er(p, mid), owner).map((a) => a.name);
    expect(before).toEqual(['Eid', 'Name', 'Phone']);
    const last = attributesOf(er(p, mid), owner)[2]!;
    const { project } = run(p, (d) => ops.reorderAttribute(d, mid, last.id, 0));
    expect(attributesOf(er(project, mid), owner).map((a) => a.name)).toEqual(['Phone', 'Eid', 'Name']);
    const clamped = run(project, (d) => ops.reorderAttribute(d, mid, last.id, 99)).project;
    expect(attributesOf(er(clamped, mid), owner).map((a) => a.name)).toEqual(['Eid', 'Name', 'Phone']);
    expect(attributesOf(er(clamped, mid), owner).map((a) => a.order)).toEqual([0, 1, 2]);
  });

  it('moveAttribute: reparents between owners (renumbering both) and is cycle-safe', () => {
    const { p, mid, s } = setup();
    const m = er(p, mid);
    const name = Object.values(m.attributes).find((a) => a.name === 'Name')!;
    const first = Object.values(m.attributes).find((a) => a.name === 'First')!;
    const phone = Object.values(m.attributes).find((a) => a.name === 'Phone')!;
    const { project } = run(p, (d) => ops.moveAttribute(d, mid, phone.id, { kind: 'entity', id: s.dept.id }, 0));
    expect(attributesOf(er(project, mid), { kind: 'entity', id: s.dept.id }).map((a) => a.name)).toEqual(['Phone', 'Dnum', 'Dname']);
    expect(attributesOf(er(project, mid), { kind: 'entity', id: s.emp.id }).map((a) => a.order)).toEqual([0, 1]);
    // under a composite parent
    const under = run(project, (d) => ops.moveAttribute(d, mid, phone.id, { kind: 'attribute', id: name.id })).project;
    expect(er(under, mid).attributes[phone.id]!.owner).toEqual({ kind: 'attribute', id: name.id });
    // cycles: below itself, below a descendant
    expect(() => run(p, (d) => ops.moveAttribute(d, mid, name.id, { kind: 'attribute', id: name.id }))).toThrow(/below itself/);
    expect(() => run(p, (d) => ops.moveAttribute(d, mid, name.id, { kind: 'attribute', id: first.id }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.moveAttribute(d, mid, name.id, { kind: 'entity', id: 'nope' }))).toThrow(OpError);
  });

  it('removeAttribute: removes the subtree and scrubs derivedFrom of the others', () => {
    const { p, mid, s } = setup();
    const m = er(p, mid);
    const name = Object.values(m.attributes).find((a) => a.name === 'Name')!;
    const first = Object.values(m.attributes).find((a) => a.name === 'First')!;
    const withDerived = run(p, (d) => ops.addAttribute(d, mid, { kind: 'entity', id: s.emp.id }, { id: 'att_d', name: 'FullName', derived: true, derivedFrom: [first.id] })).project;
    const { project } = run(withDerived, (d) => ops.removeAttribute(d, mid, name.id));
    const after = er(project, mid);
    expect(after.attributes[name.id]).toBeUndefined();
    expect(after.attributes[first.id]).toBeUndefined();
    expect(Object.values(after.attributes).some((a) => a.name === 'Last')).toBe(false);
    expect(after.attributes['att_d']!.derivedFrom).toBeUndefined();
    expect(attributesOf(after, { kind: 'entity', id: s.emp.id }).map((a) => a.order)).toEqual([0, 1, 2].slice(0, attributesOf(after, { kind: 'entity', id: s.emp.id }).length));
  });
});

describe('relationships', () => {
  it('addRelationship: binary, recursive (same entity twice) and ternary; participants keep their order; roles are stored', () => {
    const { p, mid, s } = setup();
    const { project, result } = run(p, (d) => {
      const rec = ops.addRelationship(d, mid, {
        name: 'Manages',
        participants: [{ entityId: s.emp.id, max: 'one', role: 'manager' }, { entityId: s.emp.id, max: 'many', role: 'subordinate' }],
      });
      const ter = ops.addRelationship(d, mid, {
        name: 'Supply',
        participants: [{ entityId: s.emp.id }, { entityId: s.dept.id }, { entityId: s.dep.id, max: 'one' }],
        keyParticipantIndexes: [0, 1],
      });
      return { rec, ter };
    });
    const m = er(project, mid);
    const manages = m.relationships[result.rec.refs[0]!.id]!;
    expect(manages.participants.map((x) => [x.entityId, x.role, x.max])).toEqual([[s.emp.id, 'manager', 'one'], [s.emp.id, 'subordinate', 'many']]);
    const supply = m.relationships[result.ter.refs[0]!.id]!;
    expect(supply.participants).toHaveLength(3);
    expect(supply.keyParticipantIds).toEqual([supply.participants[0]!.id, supply.participants[1]!.id]);
    expect(result.ter.refs).toHaveLength(4); // relationship + 3 participants
    // participant edges exist for the recursive relationship (two distinct ones)
    const edges = Object.values(project.diagrams[Object.keys(project.diagrams)[0]!]!.edges).filter((e) => e.ref.kind === 'participant' && e.ref.relationshipId === manages.id);
    expect(edges).toHaveLength(2);
  });

  it('addRelationship rejects unknown entities and out-of-range key indexes', () => {
    const { p, mid, s } = setup();
    expect(() => run(p, (d) => ops.addRelationship(d, mid, { participants: [{ entityId: 'ent_ghost' }] }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.addRelationship(d, mid, { participants: [{ entityId: s.emp.id }], keyParticipantIndexes: [3] }))).toThrow(OpError);
  });

  it('identifying: the identified (weak) participant becomes TOTAL, no `identified` flag when the weak rule suffices', () => {
    const { p, mid, s } = setup();
    const plain = run(p, (d) => {
      ops.updateEntity(d, mid, s.dep.id, { weak: true });
      return ops.addRelationship(d, mid, { name: 'Owns', participants: [{ entityId: s.dept.id, max: 'one' }, { entityId: s.dep.id }], identifying: true });
    });
    const rel = er(plain.project, mid).relationships[plain.result.refs[0]!.id]!;
    expect(rel.identifying).toBe(true);
    expect(rel.participants[1]!.participation).toBe('total');
    expect(rel.participants[0]!.participation).toBe('partial');
    expect(rel.participants.some((x) => x.identified)).toBe(false);
  });

  it('setIdentifying disambiguates with `identified` only when two weak entities are involved; off clears flags', () => {
    const { p, mid, s } = setup();
    const both = run(p, (d) => {
      ops.updateEntity(d, mid, s.emp.id, { weak: true });
      return ops.addRelationship(d, mid, { name: 'W2W', participants: [{ entityId: s.emp.id }, { entityId: s.dep.id }] });
    });
    const relId = both.result.refs[0]!.id;
    const [p0, p1] = er(both.project, mid).relationships[relId]!.participants;
    const on = run(both.project, (d) => ops.setIdentifying(d, mid, relId, true, { identifiedParticipantId: p1!.id })).project;
    const rel = er(on, mid).relationships[relId]!;
    expect(rel.participants.map((x) => !!x.identified)).toEqual([false, true]);
    expect(rel.participants.map((x) => x.participation)).toEqual(['partial', 'total']);
    expect(identifiedParticipants(er(on, mid), rel).map((x) => x.id)).toEqual([p1!.id]);
    void p0;
    const off = run(on, (d) => ops.setIdentifying(d, mid, relId, false)).project;
    expect(er(off, mid).relationships[relId]!.participants.some((x) => x.identified)).toBe(false);
    expect(er(off, mid).relationships[relId]!.identifying).toBe(false);
    // ambiguous without an explicit choice: identifying is set, nothing is invented
    const ambiguous = run(both.project, (d) => ops.setIdentifying(d, mid, relId, true)).project;
    expect(er(ambiguous, mid).relationships[relId]!.participants.map((x) => x.participation)).toEqual(['partial', 'partial']);
  });

  it('UX-12: setIdentifying(on) also sets the OWNER side to one (no immediate er.identifying-owner-many)', () => {
    const { p, mid, s } = setup();
    const weakPart = er(p, mid).relationships[s.has.id]!.participants[1]!;
    const { project } = run(p, (d) => {
      ops.setIdentifying(d, mid, s.has.id, false);
      for (const q of d.models[mid]!.kind === 'er' ? (d.models[mid] as ErModel).relationships[s.has.id]!.participants : []) q.max = 'many';
      ops.setIdentifying(d, mid, s.has.id, true);
    });
    const parts = er(project, mid).relationships[s.has.id]!.participants;
    expect(parts.find((q) => q.id !== weakPart.id)!.max).toBe('one');
    expect(parts.find((q) => q.id === weakPart.id)!.max).toBe('many');
    expect(parts.find((q) => q.id === weakPart.id)!.participation).toBe('total');
  });

  it('a unique weak participant needs no flag even when named explicitly', () => {
    const { p, mid, s } = setup();
    const weakPart = er(p, mid).relationships[s.has.id]!.participants[1]!;
    const { project } = run(p, (d) => {
      ops.setIdentifying(d, mid, s.has.id, false);
      ops.setIdentifying(d, mid, s.has.id, true, { identifiedParticipantId: weakPart.id });
    });
    expect(er(project, mid).relationships[s.has.id]!.participants.some((x) => x.identified)).toBe(false);
    expect(er(project, mid).relationships[s.has.id]!.participants[1]!.participation).toBe('total');
  });

  it('updateRelationship: name, description, keyParticipantIds validation, identifying toggle', () => {
    const { p, mid, s } = setup();
    const rel = er(p, mid).relationships[s.works.id]!;
    const { project } = run(p, (d) => ops.updateRelationship(d, mid, s.works.id, { name: 'Employs', description: 'd', keyParticipantIds: [rel.participants[1]!.id, rel.participants[1]!.id], identifying: true }));
    const got = er(project, mid).relationships[s.works.id]!;
    expect(got).toMatchObject({ name: 'Employs', description: 'd', identifying: true, keyParticipantIds: [rel.participants[1]!.id] });
    expect(() => run(p, (d) => ops.updateRelationship(d, mid, s.works.id, { keyParticipantIds: ['par_ghost'] }))).toThrow(OpError);
    const cleared = run(project, (d) => ops.updateRelationship(d, mid, s.works.id, { keyParticipantIds: undefined })).project;
    expect(er(cleared, mid).relationships[s.works.id]!.keyParticipantIds).toBeUndefined();
  });

  it('participants: add appends (never reorders), update clears cardinalityLabel only when max changes, remove drops key ids', () => {
    const { p, mid, s } = setup();
    const before = er(p, mid).relationships[s.works.id]!.participants.map((x) => x.id);
    const added = run(p, (d) => ops.addParticipant(d, mid, s.works.id, { id: 'par_new', entityId: s.dep.id, cardinalityLabel: 'M' }));
    const ids = er(added.project, mid).relationships[s.works.id]!.participants.map((x) => x.id);
    expect(ids).toEqual([...before, 'par_new']);
    expect(added.result.refs).toEqual([{ kind: 'participant', relationshipId: s.works.id, id: 'par_new' }]);

    const same = run(added.project, (d) => ops.updateParticipant(d, mid, s.works.id, 'par_new', { max: 'many', role: 'r' })).project;
    expect(er(same, mid).relationships[s.works.id]!.participants[2]).toMatchObject({ cardinalityLabel: 'M', role: 'r' }); // unchanged max keeps the label
    const flipped = run(same, (d) => ops.updateParticipant(d, mid, s.works.id, 'par_new', { max: 'one', participation: 'total' })).project;
    const part = er(flipped, mid).relationships[s.works.id]!.participants[2]!;
    expect(part.max).toBe('one');
    expect(part.cardinalityLabel).toBeUndefined();
    expect(part.participation).toBe('total');
    const relabelled = run(same, (d) => ops.updateParticipant(d, mid, s.works.id, 'par_new', { max: 'one', cardinalityLabel: '1' })).project;
    expect(er(relabelled, mid).relationships[s.works.id]!.participants[2]!.cardinalityLabel).toBe('1');

    const keyed = run(flipped, (d) => ops.updateRelationship(d, mid, s.works.id, { keyParticipantIds: ['par_new'] })).project;
    const removed = run(keyed, (d) => ops.removeParticipant(d, mid, s.works.id, 'par_new')).project;
    expect(er(removed, mid).relationships[s.works.id]!.keyParticipantIds).toBeUndefined();
    expect(er(removed, mid).relationships[s.works.id]!.participants.map((x) => x.id)).toEqual(before);
    expect(() => run(p, (d) => ops.updateParticipant(d, mid, s.works.id, 'par_new', { identified: true }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.updateParticipant(d, mid, s.works.id, before[0]!, { entityId: 'ent_ghost' }))).toThrow(OpError);
  });

  it('removeRelationship: deletes its attribute subtree and clears associativeOf pointing at it', () => {
    const { p, mid, s } = setup();
    const assoc = run(p, (d) => ops.makeAssociative(d, mid, s.works.id, { id: 'ent_assoc' })).project;
    const { project } = run(assoc, (d) => ops.removeRelationship(d, mid, s.works.id));
    const m = er(project, mid);
    expect(m.relationships[s.works.id]).toBeUndefined();
    expect(m.entities['ent_assoc']!.associativeOf).toBeUndefined();
    // the relationship's attribute (moved to the entity by makeAssociative) is the entity's and survives
    expect(Object.values(m.attributes).some((a) => a.name === 'since' && a.owner.id === 'ent_assoc')).toBe(true);
    const direct = run(p, (d) => ops.removeRelationship(d, mid, s.works.id)).project;
    expect(Object.values(er(direct, mid).attributes).some((a) => a.name === 'since')).toBe(false);
  });
});

describe('associative entities', () => {
  it('makeAssociative: R loses its node, the entity takes its position, R attributes move to the entity', () => {
    const { p, mid, dgm, s } = setup('chen');
    const old = nodeOf(p, dgm, 'relationship', s.works.id)!;
    const { project, result } = run(p, (d) => ops.makeAssociative(d, mid, s.works.id, { name: 'Employment' }));
    const ent = er(project, mid).entities[result.refs[0]!.id]!;
    expect(ent).toMatchObject({ name: 'Employment', weak: false, associativeOf: s.works.id });
    expect(associativeEntityOf(er(project, mid), s.works.id)!.id).toBe(ent.id);
    for (const d of Object.values(project.diagrams)) {
      expect(nodeOf(project, d.id, 'relationship', s.works.id)).toBeUndefined();
      expect(nodeOf(project, d.id, 'entity', ent.id)).toBeDefined();
    }
    expect(nodeOf(project, dgm, 'entity', ent.id)).toMatchObject({ x: old.x, y: old.y });
    expect(attributesOf(er(project, mid), { kind: 'entity', id: ent.id }).map((a) => a.name)).toEqual(['since']);
    expect(attributesOf(er(project, mid), { kind: 'relationship', id: s.works.id })).toEqual([]);
    // participant edges survived with their routes and now attach to the entity node
    const edge = Object.values(project.diagrams[dgm]!.edges).filter((e) => e.ref.kind === 'participant' && e.ref.relationshipId === s.works.id);
    expect(edge).toHaveLength(2);
  });

  it('keeps manual routes of participant/attribute edges across the swap', () => {
    const { p, mid, dgm, s } = setup();
    const edge = Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'participant' && e.ref.relationshipId === s.works.id)!;
    const routed = run(p, (d) => ops.setEdgeRoute(d, dgm, edge.id, { mode: 'manual', waypoints: [{ x: 5, y: 6 }] })).project;
    const { project } = run(routed, (d) => ops.makeAssociative(d, mid, s.works.id));
    expect(project.diagrams[dgm]!.edges[edge.id]!.route).toEqual({ mode: 'manual', waypoints: [{ x: 5, y: 6 }] });
  });

  it('refuses identifying relationships and double promotion; an associative entity cannot become weak or identifying', () => {
    const { p, mid, s } = setup();
    expect(() => run(p, (d) => ops.makeAssociative(d, mid, s.has.id))).toThrow(OpError);
    const assoc = run(p, (d) => ops.makeAssociative(d, mid, s.works.id, { id: 'ent_a' })).project;
    expect(() => run(assoc, (d) => ops.makeAssociative(d, mid, s.works.id))).toThrow(OpError);
    expect(() => run(assoc, (d) => ops.updateEntity(d, mid, 'ent_a', { weak: true }))).toThrow(OpError);
    expect(() => run(assoc, (d) => ops.setIdentifying(d, mid, s.works.id, true))).toThrow(OpError);
  });

  it('clearAssociative: entity removed, attributes back on R, R regains a node at the entity position', () => {
    const { p, mid, dgm, s } = setup();
    const assoc = run(p, (d) => ops.makeAssociative(d, mid, s.works.id, { id: 'ent_a' })).project;
    const moved = run(assoc, (d) => ops.setNodePositions(d, dgm, { [nodeOf(d, dgm, 'entity', 'ent_a')!.id]: { x: 500, y: 400 } })).project;
    const { project } = run(moved, (d) => ops.clearAssociative(d, mid, 'ent_a'));
    const m = er(project, mid);
    expect(m.entities['ent_a']).toBeUndefined();
    expect(attributesOf(m, { kind: 'relationship', id: s.works.id }).map((a) => a.name)).toEqual(['since']);
    expect(nodeOf(project, dgm, 'relationship', s.works.id)).toMatchObject({ x: 500, y: 400 });
  });

  it('clearAssociative with keepEntity leaves a plain entity; removing it also drops its other participations', () => {
    const { p, mid, s } = setup();
    const assoc = run(p, (d) => {
      ops.makeAssociative(d, mid, s.works.id, { id: 'ent_a' });
      ops.addRelationship(d, mid, { id: 'rel_x', participants: [{ entityId: 'ent_a' }, { entityId: s.dept.id }] });
    }).project;
    const kept = run(assoc, (d) => ops.clearAssociative(d, mid, 'ent_a', { keepEntity: true })).project;
    expect(er(kept, mid).entities['ent_a']).toMatchObject({ weak: false });
    expect(er(kept, mid).entities['ent_a']!.associativeOf).toBeUndefined();
    const dropped = run(assoc, (d) => ops.clearAssociative(d, mid, 'ent_a')).project;
    expect(er(dropped, mid).relationships['rel_x']!.participants.map((x) => x.entityId)).toEqual([s.dept.id]);
    expect(() => run(p, (d) => ops.clearAssociative(d, mid, s.dept.id))).toThrow(OpError);
  });
});

describe('two diagrams of one model stay consistent', () => {
  it('after structural ops both diagrams contain exactly the model elements and edges', () => {
    const { p, mid, s } = setup('chen');
    let cur = p;
    const steps: Array<(d: Project) => unknown> = [
      (d) => ops.addEntity(d, mid, { name: 'A' }),
      (d) => ops.addAttribute(d, mid, { kind: 'entity', id: s.emp.id }, { name: 'Salary' }),
      (d) => ops.addRelationship(d, mid, { participants: [{ entityId: s.emp.id }, { entityId: s.dept.id }] }),
      (d) => ops.removeEntity(d, mid, s.dep.id),
      (d) => ops.makeAssociative(d, mid, s.works.id),
      (d) => ops.removeAttribute(d, mid, Object.values(er(d, mid).attributes).find((a) => a.name === 'Name')!.id),
    ];
    for (const step of steps) {
      cur = run(cur, step).project;
      const [a, b] = Object.values(cur.diagrams);
      const keys = (d: typeof a) => Object.values(d!.nodes).map((n) => `${n.ref.kind}:${n.ref.id}`).sort();
      expect(keys(a)).toEqual(keys(b));
      expect(Object.keys(a!.edges).length).toBe(Object.keys(b!.edges).length);
    }
  });
});
