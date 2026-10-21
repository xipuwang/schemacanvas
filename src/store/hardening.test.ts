import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import * as ops from '@/model/ops';
import { projectWith, sampleRel } from '@/model/ops/testUtils';
import { createEditorStore } from './index';

let restore: () => void;
beforeEach(() => { restore = useDeterministicIds(5000); });
afterEach(() => restore());

describe('selection pruning on array-replacing deletes (STORE-3)', () => {
  it('prunes a deleted column id', () => {
    const s = sampleRel();
    const st = createEditorStore({ project: projectWith(s.model, 'relational-schema') });
    const col = s.model.relations[s.patient.id]!.columns[1]!.id;
    st.getState().setSelection([col]);
    st.getState().commit('rm', (d) => ops.removeColumn(d, s.model.id, s.patient.id, col));
    expect(st.getState().selection.ids).toEqual([]);
  });
  it('clears a sub-selection pointing at the deleted column', () => {
    const s = sampleRel();
    const p = projectWith(s.model, 'relational-schema');
    const st = createEditorStore({ project: p });
    const node = Object.values(Object.values(p.diagrams)[0]!.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === s.patient.id)!;
    const col = s.model.relations[s.patient.id]!.columns[1]!.id;
    st.getState().setSelection([node.id], { kind: 'column', id: col, relationId: s.patient.id });
    st.getState().commit('rm', (d) => ops.removeColumn(d, s.model.id, s.patient.id, col));
    expect(st.getState().selection.sub).toBeUndefined();
    expect(st.getState().selection.ids).toEqual([node.id]);
  });
});

describe('prototype-named diagram ids (STORE-4)', () => {
  it('setActiveDiagram ignores "constructor"', () => {
    const s = sampleRel();
    const st = createEditorStore({ project: projectWith(s.model, 'relational-schema') });
    const before = st.getState().activeDiagramId;
    st.getState().setActiveDiagram('constructor');
    expect(st.getState().activeDiagramId).toBe(before);
  });
});
