import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import { associativeEntityOf } from '../erSemantics';
import { createBareProject } from '../defaults';
import { withDiagram } from '../diagramSync';
import { useDeterministicIds } from '../ids';
import { attributesOf, edgeRefKey } from '../queries';
import type { ErModel, Id, Project, RelationalModel } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { projectWith, run, sampleEr, sampleRel } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(5000);
});
afterEach(() => restore());

/** Every string (values AND object keys) inside `v`. */
function strings(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      strings(x, out);
    }
  }
  return out;
}

/** The pasted fragment: model elements and diagram nodes/edges that carry the NEW ids. */
function fragment(p: Project, dgm: string, idMap: Record<Id, Id>): unknown[] {
  const fresh = new Set(Object.values(idMap));
  const model = p.models[p.diagrams[dgm]!.modelId]!;
  const out: unknown[] = [];
  if (model.kind === 'er') {
    out.push(...Object.values(model.entities).filter((e) => fresh.has(e.id)));
    out.push(...Object.values(model.attributes).filter((e) => fresh.has(e.id)));
    out.push(...Object.values(model.relationships).filter((e) => fresh.has(e.id)));
  } else {
    out.push(...Object.values(model.relations).filter((e) => fresh.has(e.id)));
    out.push(...Object.values(model.foreignKeys).filter((e) => fresh.has(e.id)));
  }
  out.push(...Object.values(p.diagrams[dgm]!.nodes).filter((n) => fresh.has(n.id)));
  out.push(...Object.values(p.diagrams[dgm]!.edges).filter((e) => fresh.has(e.id)));
  return out;
}
function expectNoOldIds(p: Project, dgm: string, idMap: Record<Id, Id>): void {
  const all = strings(fragment(p, dgm, idMap));
  for (const old of Object.keys(idMap)) expect(all.has(old), `old id ${old} leaked into the pasted fragment`).toBe(false);
}

const nodeIdsOf = (p: Project, dgm: string, pred: (ref: { kind: string; id: string }) => boolean) =>
  Object.values(p.diagrams[dgm]!.nodes).filter((n) => pred(n.ref)).map((n) => n.id);

describe('relational clipboard', () => {
  function setup() {
    const s = sampleRel();
    const p = projectWith(s.model, 'relational-schema');
    return { s, p, mid: s.model.id, dgm: Object.keys(p.diagrams)[0]! };
  }
  const rm = (p: Project, id: string) => p.models[id] as RelationalModel;

  it('copies tables with the FKs between them; pasted FK pairs, PK, uniques and columnWidths use the NEW columns', () => {
    const { s, p, mid, dgm } = setup();
    const prepared = run(p, (d) => {
      ops.addUnique(d, mid, s.rx.id, { id: 'uq_rx', name: 'uq_rx', columnIds: [s.rx.col('Qty')] });
      ops.addIndex(d, mid, s.rx.id, { id: 'idx_rx', name: 'idx_rx', columnIds: [s.rx.col('Qty')] });
      const rxNode = Object.values(d.diagrams[dgm]!.nodes).find((n) => n.ref.id === s.rx.id)!;
      ops.setColumnWidth(d, dgm, rxNode.id, s.rx.col('Qty'), 77);
      const e = Object.values(d.diagrams[dgm]!.edges).find((x) => x.ref.kind === 'foreignKey' && x.ref.foreignKeyId === s.fk2.id)!;
      ops.setEdgeRoute(d, dgm, e.id, { mode: 'manual', waypoints: [{ x: 3, y: 4 }], branchAnchors: { [s.rx.col('CompanyName')]: { source: { side: 'top' } } } });
      ops.setNodeLocked(d, dgm, rxNode.id, true);
    }).project;
    const sel = nodeIdsOf(prepared, dgm, (r) => r.id === s.rx.id || r.id === s.drug.id);
    const payload = ops.extractClipboard(prepared, dgm, sel);
    expect(payload.relational!.relations.map((r) => r.name).sort()).toEqual(['Drug', 'Prescription']);
    expect(payload.relational!.foreignKeys.map((f) => f.id)).toEqual([s.fk2.id]); // fk3 (to Patient) has an endpoint outside
    expect(payload.nodes.every((n) => n.locked === undefined)).toBe(true);

    const { project, result } = run(prepared, (d) => ops.pasteClipboard(d, dgm, deepFreeze(payload), { x: 100, y: 50 }));
    expectNoOldIds(project, dgm, result.idMap);
    const m = rm(project, mid);
    const newRx = Object.values(m.relations).find((r) => r.name === 'Prescription_2')!;
    const newDrug = Object.values(m.relations).find((r) => r.name === 'Drug_2')!;
    expect(newRx.id).toBe(result.idMap[s.rx.id]);
    const fk = Object.values(m.foreignKeys).find((f) => f.sourceRelationId === newRx.id)!;
    expect(fk.targetRelationId).toBe(newDrug.id);
    expect(fk.columns).toHaveLength(2); // still ONE composite FK
    for (const pair of fk.columns) {
      expect(newRx.columns.some((c) => c.id === pair.sourceColumnId)).toBe(true);
      expect(newDrug.columns.some((c) => c.id === pair.targetColumnId)).toBe(true);
    }
    expect(fk.columns.map((c) => newRx.columns.find((x) => x.id === c.sourceColumnId)!.name)).toEqual(['CompanyName', 'DrugTradeName']);
    expect(newRx.primaryKey.every((id) => newRx.columns.some((c) => c.id === id))).toBe(true);
    expect(newRx.uniques[0]!.columnIds[0]).toBe(result.idMap[s.rx.col('Qty')]);
    expect(newRx.uniques[0]!.name).toBe('uq_rx_2');
    expect(newRx.indexes[0]!.name).toBe('idx_rx_2');
    // node: position shifted, width keys remapped, unlocked, on top; edge route kept with remapped anchors
    const node = project.diagrams[dgm]!.nodes[result.nodeIds.find((id) => project.diagrams[dgm]!.nodes[id]!.ref.id === newRx.id)!]!;
    const oldNode = Object.values(prepared.diagrams[dgm]!.nodes).find((n) => n.ref.id === s.rx.id)!;
    expect(node).toMatchObject({ x: oldNode.x + 100, y: oldNode.y + 50, columnWidths: { [result.idMap[s.rx.col('Qty')]!]: 77 } });
    expect(node.locked).toBeUndefined();
    expect(node.zIndex).toBeGreaterThan(Math.max(...Object.values(prepared.diagrams[dgm]!.nodes).map((n) => n.zIndex!)));
    const edge = project.diagrams[dgm]!.edges[result.idMap[Object.values(prepared.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === s.fk2.id)!.id]!]!;
    expect(edge.ref).toEqual({ kind: 'foreignKey', foreignKeyId: fk.id });
    // waypoints are absolute world coordinates, so they move by the paste offset (100, 50) like the nodes
    expect(edge.route).toEqual({ mode: 'manual', waypoints: [{ x: 103, y: 54 }], branchAnchors: { [result.idMap[s.rx.col('CompanyName')]!]: { source: { side: 'top' } } } });
    // originals untouched
    expect(rm(project, mid).foreignKeys[s.fk2.id]).toEqual(rm(prepared, mid).foreignKeys[s.fk2.id]);
  });

  it('strips origin from pasted relations, columns, uniques and FKs', () => {
    const { s, p, mid, dgm } = setup();
    const withOrigin = JSON.parse(JSON.stringify(p)) as Project;
    const m = rm(withOrigin, mid);
    m.relations[s.patient.id]!.origin = { ruleId: 'strong-entity', sources: [{ kind: 'entity', id: 'e' }], key: 'k' };
    m.relations[s.patient.id]!.columns[0]!.origin = { ruleId: 'strong-entity', sources: [], key: 'c' };
    m.foreignKeys[s.fk1.id]!.origin = { ruleId: 'one-to-many-fk', sources: [], key: 'f' };
    const sel = nodeIdsOf(withOrigin, dgm, (r) => r.id === s.patient.id || r.id === s.doctor.id);
    const { project, result } = run(withOrigin, (d) => ops.duplicateNodes(d, dgm, sel));
    const copy = Object.values(rm(project, mid).relations).find((r) => r.id === result.idMap[s.patient.id])!;
    expect(copy.origin).toBeUndefined();
    expect(copy.columns[0]!.origin).toBeUndefined();
    expect(rm(project, mid).foreignKeys[result.idMap[s.fk1.id]!]!.origin).toBeUndefined();
    expect(result.nodeIds).toHaveLength(2);
    expect(rm(project, mid).relations[s.patient.id]!.origin).toBeDefined();
  });

  it('copying one table alone copies no FK (the endpoint rule) and gives suffix names', () => {
    const { s, p, mid, dgm } = setup();
    const payload = ops.extractClipboard(p, dgm, nodeIdsOf(p, dgm, (r) => r.id === s.patient.id));
    expect(payload.relational!.foreignKeys).toEqual([]);
    const { project } = run(p, (d) => {
      ops.pasteClipboard(d, dgm, payload);
      ops.pasteClipboard(d, dgm, payload);
    });
    expect(Object.values(rm(project, mid).relations).map((r) => r.name).filter((n) => n.startsWith('Patient')).sort()).toEqual(['Patient', 'Patient_2', 'Patient_3']);
  });

  it('pastes into ANOTHER relational model (template path): self-contained, no outside refs survive or are needed', () => {
    const { s, p, dgm } = setup();
    const target = run(p, (d) => ops.createDiagram(d, { type: 'relational-schema', modelName: 'Fresh' }));
    const payload = ops.extractClipboard(p, dgm, nodeIdsOf(p, dgm, () => true));
    const { project, result } = run(target.project, (d) => ops.pasteClipboard(d, target.result.diagramId, payload));
    const m = rm(project, target.result.modelId);
    expect(Object.keys(m.relations)).toHaveLength(4);
    expect(Object.keys(m.foreignKeys)).toHaveLength(3);
    expectNoOldIds(project, target.result.diagramId, result.idMap);
    expect(Object.values(m.relations).map((r) => r.name).sort()).toEqual(['Doctor', 'Drug', 'Patient', 'Prescription']);
    expect(rm(project, s.model.id)).toEqual(rm(p, s.model.id));
  });

  it('refuses to paste ER content into a relational diagram and vice versa', () => {
    const { p, dgm } = setup();
    const e = sampleEr();
    const ep = projectWith(e.model, 'chen');
    const edgm = Object.keys(ep.diagrams)[0]!;
    const erPayload = ops.extractClipboard(ep, edgm, Object.keys(ep.diagrams[edgm]!.nodes));
    expect(() => run(p, (d) => ops.pasteClipboard(d, dgm, erPayload))).toThrowError(OpError);
    try {
      run(p, (d) => ops.pasteClipboard(d, dgm, erPayload));
    } catch (err) {
      expect((err as OpError).code).toBe('paste-kind-mismatch');
    }
    const relPayload = ops.extractClipboard(p, dgm, Object.keys(p.diagrams[dgm]!.nodes));
    expect(() => run(ep, (d) => ops.pasteClipboard(d, edgm, relPayload))).toThrow(OpError);
    expect(() => run(p, (d) => ops.pasteClipboard(d, dgm, { ...relPayload, format: 'nope' as never }))).toThrow(OpError);
  });
});

describe('ER clipboard', () => {
  function setup() {
    const s = sampleEr();
    const p = projectWith(s.model, 'chen');
    return { s, p, mid: s.model.id, dgm: Object.keys(p.diagrams)[0]! };
  }
  const er = (p: Project, id: string) => p.models[id] as ErModel;

  it('copying entities + their relationship duplicates attribute subtrees and rewires participants/attributes to the copies', () => {
    const { s, p, mid, dgm } = setup();
    const sel = nodeIdsOf(p, dgm, (r) => r.id === s.dept.id || r.id === s.emp.id || r.id === s.works.id);
    const payload = ops.extractClipboard(p, dgm, sel);
    // closure: Dept(2 attrs) + Employee(Eid, Name+First+Last, Phone) + relationship attr since
    expect(payload.er!.attributes).toHaveLength(2 + 5 + 1);
    const { project, result } = run(p, (d) => ops.pasteClipboard(d, dgm, deepFreeze(payload), { x: 300, y: 0 }));
    expectNoOldIds(project, dgm, result.idMap);
    const m = er(project, mid);
    const newDept = m.entities[result.idMap[s.dept.id]!]!;
    const newEmp = m.entities[result.idMap[s.emp.id]!]!;
    const newRel = m.relationships[result.idMap[s.works.id]!]!;
    expect(newRel.participants.map((x) => x.entityId)).toEqual([newDept.id, newEmp.id]);
    expect(newRel.participants.map((x) => x.max)).toEqual(['one', 'many']);
    expect(newRel.participants.every((x) => !Object.keys(result.idMap).includes(x.id))).toBe(true);
    expect(attributesOf(m, { kind: 'entity', id: newEmp.id }).map((a) => a.name)).toEqual(['Eid', 'Name', 'Phone']);
    const newName = attributesOf(m, { kind: 'entity', id: newEmp.id })[1]!;
    expect(attributesOf(m, { kind: 'attribute', id: newName.id }).map((a) => a.name)).toEqual(['First', 'Last']);
    expect(attributesOf(m, { kind: 'relationship', id: newRel.id }).map((a) => a.name)).toEqual(['since']);
    // originals untouched, count doubled for the copied part
    expect(m.entities[s.dept.id]).toEqual(er(p, mid).entities[s.dept.id]);
    expect(Object.keys(m.entities)).toHaveLength(5);
    // all participant + attribute edges exist exactly once for the copies
    const edges = Object.values(project.diagrams[dgm]!.edges).map((e) => edgeRefKey(e.ref));
    expect(new Set(edges).size).toBe(edges.length);
    expect(edges).toContain(`participant:${newRel.participants[0]!.id}`);
    // copies sit at offset positions
    const oldNode = Object.values(p.diagrams[dgm]!.nodes).find((n) => n.ref.id === s.dept.id)!;
    const newNode = Object.values(project.diagrams[dgm]!.nodes).find((n) => n.ref.id === newDept.id)!;
    expect(newNode).toMatchObject({ x: oldNode.x + 300, y: oldNode.y });
  });

  it('a relationship copied WITHOUT its entities keeps pointing at the originals in the same model; a participant-less copy is dropped elsewhere', () => {
    const { s, p, mid, dgm } = setup();
    const sel = nodeIdsOf(p, dgm, (r) => r.id === s.works.id);
    const payload = ops.extractClipboard(p, dgm, sel);
    const { project, result } = run(p, (d) => ops.pasteClipboard(d, dgm, payload));
    const copy = er(project, mid).relationships[result.idMap[s.works.id]!]!;
    expect(copy.participants.map((x) => x.entityId)).toEqual([s.dept.id, s.emp.id]);
    // into another model: no participant resolves -> the relationship is dropped (and so is its attribute)
    const other = run(p, (d) => ops.createDiagram(d, { type: 'chen', modelName: 'Other' }));
    const dropped = run(other.project, (d) => ops.pasteClipboard(d, other.result.diagramId, payload));
    expect(Object.keys(er(dropped.project, other.result.modelId).relationships)).toEqual([]);
    expect(Object.keys(er(dropped.project, other.result.modelId).attributes)).toEqual([]);
    expect(dropped.result.nodeIds).toEqual([]);
  });

  it('after the referenced entity is gone, an outside reference is NOT resurrected (attribute alone, relationship alone)', () => {
    const { s, p, mid, dgm } = setup();
    const attrNode = nodeIdsOf(p, dgm, (r) => r.kind === 'attribute' && er(p, mid).attributes[r.id]!.name === 'Dname');
    const payload = ops.extractClipboard(p, dgm, attrNode);
    const same = run(p, (d) => ops.pasteClipboard(d, dgm, payload));
    const dnames = attributesOf(er(same.project, mid), { kind: 'entity', id: s.dept.id }).map((a) => [a.name, a.order]);
    expect(dnames).toEqual([['Dnum', 0], ['Dname', 1], ['Dname', 2]]); // the copy goes last under the same owner
    const removed = run(p, (d) => ops.removeEntity(d, mid, s.dept.id)).project;
    const after = run(removed, (d) => ops.pasteClipboard(d, dgm, payload));
    expect(Object.values(er(after.project, mid).attributes).filter((a) => a.name === 'Dname')).toHaveLength(0);
    expect(after.result.nodeIds).toEqual([]);
  });

  it('derivedFrom follows the copy when its source is copied too, and is dropped otherwise', () => {
    const { s, p, mid, dgm } = setup();
    const dnum = Object.values(er(p, mid).attributes).find((a) => a.name === 'Dnum')!;
    const withDerived = run(p, (d) => ops.addAttribute(d, mid, { kind: 'entity', id: s.dept.id }, { id: 'att_derived', name: 'Code', derived: true, derivedFrom: [dnum.id] })).project;
    const payload = ops.extractClipboard(withDerived, dgm, nodeIdsOf(withDerived, dgm, (r) => r.id === s.dept.id));
    const { project, result } = run(withDerived, (d) => ops.pasteClipboard(d, dgm, payload));
    expect(er(project, mid).attributes[result.idMap['att_derived']!]!.derivedFrom).toEqual([result.idMap[dnum.id]]);
    // only the derived attribute copied: Dnum is not in the payload but still exists in the same model -> survives
    const only = ops.extractClipboard(withDerived, dgm, nodeIdsOf(withDerived, dgm, (r) => r.id === 'att_derived'));
    const sameModel = run(withDerived, (d) => ops.pasteClipboard(d, dgm, only));
    expect(er(sameModel.project, mid).attributes[sameModel.result.idMap['att_derived']!]!.derivedFrom).toEqual([dnum.id]);
  });

  it('associative entity: its relationship comes along; the copy points at the COPY (R has at most one entity)', () => {
    const { s, p, mid, dgm } = setup();
    const assoc = run(p, (d) => ops.makeAssociative(d, mid, s.works.id, { id: 'ent_assoc' })).project;
    const payload = ops.extractClipboard(assoc, dgm, nodeIdsOf(assoc, dgm, (r) => r.id === 'ent_assoc'));
    expect(payload.er!.relationships.map((r) => r.id)).toEqual([s.works.id]);
    const { project, result } = run(assoc, (d) => ops.pasteClipboard(d, dgm, payload));
    const m = er(project, mid);
    const newEntity = m.entities[result.idMap['ent_assoc']!]!;
    expect(newEntity.associativeOf).toBe(result.idMap[s.works.id]);
    expect(associativeEntityOf(m, s.works.id)!.id).toBe('ent_assoc');
    expect(associativeEntityOf(m, newEntity.associativeOf!)!.id).toBe(newEntity.id);
    // the copied relationship still joins the ORIGINAL Dept and Employee
    expect(m.relationships[newEntity.associativeOf!]!.participants.map((x) => x.entityId)).toEqual([s.dept.id, s.emp.id]);
    expectNoOldIds(project, dgm, result.idMap);
  });

  it('weak entity + identifying relationship copy keeps identification semantics (flags remapped)', () => {
    const { s, p, mid, dgm } = setup();
    const flagged = run(p, (d) => ops.updateParticipant(d, mid, s.has.id, er(d, mid).relationships[s.has.id]!.participants[1]!.id, { identified: true })).project;
    const sel = nodeIdsOf(flagged, dgm, (r) => r.id === s.emp.id || r.id === s.dep.id || r.id === s.has.id);
    const { project, result } = run(flagged, (d) => ops.duplicateNodes(d, dgm, sel));
    const copy = er(project, mid).relationships[result.idMap[s.has.id]!]!;
    expect(copy.identifying).toBe(true);
    expect(copy.participants.map((x) => !!x.identified)).toEqual([false, true]);
    expect(copy.participants.map((x) => x.participation)).toEqual(['partial', 'total']);
    expect(copy.participants[1]!.entityId).toBe(result.idMap[s.dep.id]);
  });

  it('keyParticipantIds are remapped to the copied participants', () => {
    const { s, p, mid, dgm } = setup();
    const keyed = run(p, (d) => ops.updateRelationship(d, mid, s.works.id, { keyParticipantIds: er(d, mid).relationships[s.works.id]!.participants.map((x) => x.id) })).project;
    const sel = nodeIdsOf(keyed, dgm, (r) => r.id === s.dept.id || r.id === s.emp.id || r.id === s.works.id);
    const { project, result } = run(keyed, (d) => ops.duplicateNodes(d, dgm, sel));
    const copy = er(project, mid).relationships[result.idMap[s.works.id]!]!;
    expect(copy.keyParticipantIds).toEqual(copy.participants.map((x) => x.id));
    expect(copy.keyParticipantIds!.some((id) => er(keyed, mid).relationships[s.works.id]!.participants.some((x) => x.id === id))).toBe(false);
  });

  it('paste works into a partial diagram (nodes explicit) and a second diagram of the model gets provisional nodes', () => {
    const { s, p, mid, dgm } = setup();
    const two = run(p, (d) => ops.createDiagram(d, { type: 'chen', modelId: mid })).project;
    const sel = nodeIdsOf(two, dgm, (r) => r.id === s.dept.id);
    const { project, result } = run(two, (d) => ops.duplicateNodes(d, dgm, sel, { x: 10, y: 10 }));
    const other = Object.keys(project.diagrams).find((x) => x !== dgm)!;
    const newDept = result.idMap[s.dept.id]!;
    expect(Object.values(project.diagrams[other]!.nodes).some((n) => n.ref.id === newDept)).toBe(true);
    const hidden = run(two, (d) => ops.removeFromDiagram(d, dgm, [Object.keys(d.diagrams[dgm]!.nodes).at(-1)!])).project;
    const partial = run(hidden, (d) => ops.duplicateNodes(d, dgm, sel, { x: 5, y: 5 }));
    expect(partial.result.nodeIds.length).toBeGreaterThanOrEqual(1);
    expect(partial.project.diagrams[dgm]!.partial).toBe(true);
  });

  it('templates: pasting a payload into a brand-new project remaps everything and keeps it consistent', () => {
    const { p, dgm } = setup();
    const payload = ops.extractClipboard(p, dgm, Object.keys(p.diagrams[dgm]!.nodes));
    const fresh = createBareProject('tpl');
    const model = { id: 'mdl_t', kind: 'er', name: 'T', entities: {}, attributes: {}, relationships: {} } as ErModel;
    const d0 = withDiagram(fresh, model, 'chen');
    const { project, result } = run(fresh, (d) => ops.pasteClipboard(d, d0.id, payload));
    expectNoOldIds(project, d0.id, result.idMap);
    expect(Object.keys((project.models['mdl_t'] as ErModel).entities)).toHaveLength(3);
    expect(Object.keys(project.diagrams[d0.id]!.nodes)).toHaveLength(Object.keys(p.diagrams[dgm]!.nodes).length);
    expect(Object.keys(project.diagrams[d0.id]!.edges)).toHaveLength(Object.keys(p.diagrams[dgm]!.edges).length);
  });
});

describe('remapIds', () => {
  it('is pure: the input payload is not mutated and every defined id gets a fresh, unique id', () => {
    const s = sampleRel();
    const p = projectWith(s.model, 'relational-schema');
    const dgm = Object.keys(p.diagrams)[0]!;
    const payload = deepFreeze(ops.extractClipboard(p, dgm, Object.keys(p.diagrams[dgm]!.nodes)));
    const { payload: out, idMap } = ops.remapIds(payload);
    const values = Object.values(idMap);
    expect(new Set(values).size).toBe(values.length);
    for (const [old, fresh] of Object.entries(idMap)) expect(old).not.toBe(fresh);
    const all = strings(out);
    for (const old of Object.keys(idMap)) expect(all.has(old)).toBe(false);
    expect(out.relational!.relations).toHaveLength(4);
  });
});
