import { describe, expect, it } from 'vitest';
import type { ErModel, RelationalModel } from '@/model/types';
import { labelRect } from '@/scene/geometry';
import type { HTableGeom } from '@/scene/types';
import { produce } from 'immer';
import { neighbourColumn, resolveEditSpec } from './editSpec';
import { describeSelection } from './announce';
import { makeStore, nodeNamed, sceneOf } from './testFixtures';

describe('resolveEditSpec: what an inline edit changes and where the input goes', () => {
  const chen = makeStore('chen');
  const cp = chen.store.getState().project;
  const cs = sceneOf(cp, chen.diagramId);
  const rel = makeStore('rel');
  const rp = rel.store.getState().project;
  const rs = sceneOf(rp, rel.diagramId);

  it('entity / relationship / attribute commit through their own op and keep ids', () => {
    for (const [name, kind] of [['Doctor', 'entity'], ['Sell', 'relationship'], ['Speciality', 'attribute']] as const) {
      const nodeId = nodeNamed(cp, chen.diagramId, name);
      const spec = resolveEditSpec(cp, chen.diagramId, cs, { nodeId })!;
      expect(spec.kind).toBe(kind);
      expect(spec.value).toBe(name);
      expect(spec.rect.w).toBeGreaterThan(0);
      const next = produce(cp, (d) => spec.commit(d, 'Renamed'));
      const m = next.models[next.diagrams[chen.diagramId]!.modelId] as ErModel;
      const ref = cp.diagrams[chen.diagramId]!.nodes[nodeId]!.ref;
      const label = kind === 'entity' ? m.entities[ref.id]!.name : kind === 'relationship' ? m.relationships[ref.id]!.name : m.attributes[ref.id]!.name;
      expect(label).toBe('Renamed');
    }
  });
  it('relation name sits at the name label; a column edit targets exactly the cell', () => {
    const nodeId = nodeNamed(rp, rel.diagramId, 'Drug');
    const g = rs.nodes[nodeId] as HTableGeom;
    const nameSpec = resolveEditSpec(rp, rel.diagramId, rs, { nodeId })!;
    expect(nameSpec.kind).toBe('relation');
    expect(nameSpec.align).toBe(g.nameLabel.anchor);
    expect(nameSpec.rect.y).toBeLessThan(g.row.y);
    const cell = g.cells[1]!;
    const spec = resolveEditSpec(rp, rel.diagramId, rs, { nodeId, columnId: cell.columnId })!;
    expect(spec.kind).toBe('column');
    expect(spec.rect).toEqual(cell.rect);
    const next = produce(rp, (d) => spec.commit(d, 'RenamedCol'));
    const m = next.models[next.diagrams[rel.diagramId]!.modelId] as RelationalModel;
    const rln = Object.values(m.relations).find((r) => r.name === 'Drug')!;
    expect(rln.columns[1]!.name).toBe('RenamedCol');
    expect(rln.columns[1]!.id).toBe(cell.columnId); // stable id
  });
  it('Tab navigation: neighbour columns, none past the ends', () => {
    const nodeId = nodeNamed(rp, rel.diagramId, 'Drug');
    const g = rs.nodes[nodeId] as HTableGeom;
    const ids = g.cells.map((c) => c.columnId);
    expect(neighbourColumn(rp, rel.diagramId, { nodeId, columnId: ids[0] }, 1)).toBe(ids[1]);
    expect(neighbourColumn(rp, rel.diagramId, { nodeId, columnId: ids[1] }, -1)).toBe(ids[0]);
    expect(neighbourColumn(rp, rel.diagramId, { nodeId, columnId: ids[0] }, -1)).toBeUndefined();
    expect(neighbourColumn(rp, rel.diagramId, { nodeId, columnId: ids.at(-1) }, 1)).toBeUndefined();
  });
  it('FK label and participant role are optional: empty clears them', () => {
    const [fkEdgeId, fkEdge] = Object.entries(rp.diagrams[rel.diagramId]!.edges)[0]!;
    const fkId = (fkEdge.ref as { foreignKeyId: string }).foreignKeyId;
    const spec = resolveEditSpec(rp, rel.diagramId, rs, { edgeId: fkEdgeId })!;
    expect(spec.kind).toBe('fkLabel');
    expect(spec.allowEmpty).toBe(true);
    const withLabel = produce(rp, (d) => spec.commit(d, 'works with'));
    expect((withLabel.models[rp.diagrams[rel.diagramId]!.modelId] as RelationalModel).foreignKeys[fkId]!.label).toBe('works with');
    const cleared = produce(withLabel, (d) => spec.commit(d, ''));
    expect((cleared.models[rp.diagrams[rel.diagramId]!.modelId] as RelationalModel).foreignKeys[fkId]!.label).toBeUndefined();

    const [pEdgeId] = Object.entries(cp.diagrams[chen.diagramId]!.edges).find(([, e]) => e.ref.kind === 'participant')!;
    const role = resolveEditSpec(cp, chen.diagramId, cs, { edgeId: pEdgeId })!;
    expect(role.kind).toBe('role');
    const withRole = produce(cp, (d) => role.commit(d, 'manager'));
    const m = withRole.models[cp.diagrams[chen.diagramId]!.modelId] as ErModel;
    expect(Object.values(m.relationships).some((r) => r.participants.some((p) => p.role === 'manager'))).toBe(true);
  });
  it('unknown targets resolve to nothing', () => {
    expect(resolveEditSpec(cp, chen.diagramId, cs, { nodeId: 'nope' })).toBeUndefined();
    expect(resolveEditSpec(cp, 'nope', cs, { nodeId: 'x' })).toBeUndefined();
  });
  it('the label rect used for placement is the painted label box', () => {
    const nodeId = nodeNamed(cp, chen.diagramId, 'Doctor');
    const spec = resolveEditSpec(cp, chen.diagramId, cs, { nodeId })!;
    const lr = labelRect((cs.nodes[nodeId] as { label: Parameters<typeof labelRect>[0] }).label);
    expect(spec.rect.x).toBeLessThan(lr.x);
    expect(spec.rect.w).toBeGreaterThan(lr.w);
  });
});

describe('describeSelection (aria-live text)', () => {
  const chen = makeStore('chen');
  const rel = makeStore('rel');
  it('names the element and counts its parts', () => {
    const p = chen.store.getState().project;
    const doctor = nodeNamed(p, chen.diagramId, 'Doctor');
    expect(describeSelection(p, chen.diagramId, { ids: [doctor] })).toBe('Entity Doctor selected, 4 attributes');
    expect(describeSelection(p, chen.diagramId, { ids: [nodeNamed(p, chen.diagramId, 'Drug')] })).toMatch(/^Weak entity Drug selected, 2 attributes$/);
    expect(describeSelection(p, chen.diagramId, { ids: [nodeNamed(p, chen.diagramId, 'Makes')] })).toMatch(/^Identifying relationship Makes selected/);
    expect(describeSelection(p, chen.diagramId, { ids: [doctor, nodeNamed(p, chen.diagramId, 'Patient')] })).toBe('2 items selected');
    expect(describeSelection(p, chen.diagramId, { ids: [] })).toBe('');
  });
  it('tables and columns', () => {
    const p = rel.store.getState().project;
    const id = nodeNamed(p, rel.diagramId, 'Doctor');
    expect(describeSelection(p, rel.diagramId, { ids: [id] })).toBe('Table Doctor selected, 4 columns');
    const m = p.models[p.diagrams[rel.diagramId]!.modelId] as RelationalModel;
    const doc = Object.values(m.relations).find((r) => r.name === 'Doctor')!;
    expect(describeSelection(p, rel.diagramId, { ids: [id], sub: { kind: 'column', relationId: doc.id, id: doc.columns[0]!.id } })).toBe('Column SSN of table Doctor selected');
  });
});
