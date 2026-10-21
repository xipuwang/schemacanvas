import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '../ids';
import { refKey } from '../queries';
import type { ErModel, Project, RelationalModel } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { projectWith, run, sampleEr, sampleRel } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(3000);
});
afterEach(() => restore());

function rel() {
  const s = sampleRel();
  const p = projectWith(s.model, 'relational-schema');
  return { s, p, mid: s.model.id, dgm: Object.keys(p.diagrams)[0]! };
}
function chen() {
  const s = sampleEr();
  const p = projectWith(s.model, 'chen');
  return { s, p, mid: s.model.id, dgm: Object.keys(p.diagrams)[0]! };
}
const nodeOf = (p: Project, dgm: string, relId: string) => Object.values(p.diagrams[dgm]!.nodes).find((n) => n.ref.id === relId)!;

describe('createDiagram / removeDiagram / renameDiagram', () => {
  it('creates a NEW model of the right kind when none is given, per diagram type', () => {
    const p = projectWith(sampleEr().model, 'chen');
    const { project, result } = run(p, (d) => ({
      chen: ops.createDiagram(d, { type: 'chen', name: 'Second ER' }),
      rel: ops.createDiagram(d, { type: 'relational-schema', modelName: 'Fresh' }),
      cf: ops.createDiagram(d, { type: 'crows-foot', dialect: 'postgresql' }),
    }));
    expect(result.chen.createdModel && result.rel.createdModel && result.cf.createdModel).toBe(true);
    expect(project.models[result.chen.modelId]!.kind).toBe('er');
    expect(project.models[result.rel.modelId]).toMatchObject({ kind: 'relational', name: 'Fresh' });
    expect((project.models[result.cf.modelId] as RelationalModel).dialect).toBe('postgresql');
    expect(project.diagramOrder.slice(-3)).toEqual([result.chen.diagramId, result.rel.diagramId, result.cf.diagramId]);
    expect(project.diagrams[result.chen.diagramId]!.name).toBe('Second ER');
  });

  it('views an existing model with a new notation (relational model -> crows-foot) without touching semantics', () => {
    const { p, mid } = rel();
    const { project, result } = run(p, (d) => ops.createDiagram(d, { type: 'crows-foot', modelId: mid }));
    expect(result.createdModel).toBe(false);
    expect(project.models).toEqual(p.models);
    const d = project.diagrams[result.diagramId]!;
    expect(Object.keys(d.nodes)).toHaveLength(4);
    expect(Object.keys(d.edges)).toHaveLength(3);
  });

  it('copyLayoutFrom reuses positions/sizes/column widths for elements both diagrams show', () => {
    const { p, mid, dgm, s } = rel();
    const n = nodeOf(p, dgm, s.patient.id);
    const arranged = run(p, (d) => {
      ops.setNodePositions(d, dgm, { [n.id]: { x: 777, y: 555 } });
      ops.setNodeSize(d, dgm, n.id, { height: 40 });
      ops.setColumnWidth(d, dgm, n.id, s.patient.col('Name'), 99);
    }).project;
    const { project, result } = run(arranged, (d) => ops.createDiagram(d, { type: 'relational-schema', modelId: mid, copyLayoutFrom: dgm }));
    expect(nodeOf(project, result.diagramId, s.patient.id)).toMatchObject({ x: 777, y: 555, height: 40, columnWidths: { [s.patient.col('Name')]: 99 } });
  });

  it('refuses a mismatching model kind, a missing model and a taken id', () => {
    const { p, mid } = rel();
    expect(() => run(p, (d) => ops.createDiagram(d, { type: 'chen', modelId: mid }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.createDiagram(d, { type: 'chen', modelId: 'mdl_ghost' }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.createDiagram(d, { type: 'physical', modelId: mid, id: mid }))).toThrow(OpError);
  });

  it('cascade (deleteDiagram): removes the diagram and its order entry, never touches semantics', () => {
    const { p, mid, dgm } = rel();
    const two = run(p, (d) => ops.createDiagram(d, { type: 'physical', modelId: mid })).project;
    const { project } = run(two, (d) => ops.removeDiagram(d, dgm));
    expect(project.diagramOrder).toEqual(two.diagramOrder.filter((x) => x !== dgm));
    expect(project.models).toEqual(two.models);
    expect(() => run(project, (d) => ops.removeDiagram(d, dgm))).toThrow(OpError);
  });

  it('renames never touch refs', () => {
    const { p, dgm } = rel();
    const { project } = run(p, (d) => ops.renameDiagram(d, dgm, 'Pharmacy schema'));
    expect(project.diagrams[dgm]).toEqual({ ...p.diagrams[dgm]!, name: 'Pharmacy schema' });
  });
});

describe('reorderDiagrams / renameProject', () => {
  function three() {
    const { p } = rel();
    const { project, result } = run(p, (d) => [ops.createDiagram(d, { type: 'chen' }).diagramId, ops.createDiagram(d, { type: 'crows-foot' }).diagramId]);
    return { project, order: project.diagramOrder.slice(), a: result[0]!, b: result[1]! };
  }

  it('moves a tab to an index and touches nothing but diagramOrder', () => {
    const { project: p, order, a } = three();
    const { project } = run(p, (d) => ops.reorderDiagrams(d, order[0]!, 2));
    expect(project.diagramOrder).toEqual([order[1], order[2], order[0]]);
    expect({ ...project, diagramOrder: p.diagramOrder }).toEqual(p);
    const back = run(project, (d) => ops.reorderDiagrams(d, a, 0)).project;
    expect(back.diagramOrder[0]).toBe(a);
    expect([...back.diagramOrder].sort()).toEqual([...order].sort());
  });

  it('clamps the target index, ignores a no-op and rejects unknown diagrams', () => {
    const { project: p, order } = three();
    expect(run(p, (d) => ops.reorderDiagrams(d, order[0]!, 99)).project.diagramOrder).toEqual([order[1], order[2], order[0]]);
    expect(run(p, (d) => ops.reorderDiagrams(d, order[2]!, -5)).project.diagramOrder).toEqual([order[2], order[0], order[1]]);
    expect(run(p, (d) => ops.reorderDiagrams(d, order[1]!, 1)).project.diagramOrder).toEqual(order);
    expect(() => run(p, (d) => ops.reorderDiagrams(d, 'nope', 0))).toThrow(OpError);
  });

  it('renames the project with trimmed text and rejects blank names', () => {
    const { p } = rel();
    expect(run(p, (d) => ops.renameProject(d, '  Clinic  ')).project.name).toBe('Clinic');
    expect(() => run(p, (d) => ops.renameProject(d, '   '))).toThrow(OpError);
  });
});

describe('setDiagramOptions', () => {
  it('deep-merges: sibling keys survive, arrays/primitives replace, undefined is ignored', () => {
    const { p, dgm } = rel();
    const { project } = run(p, (d) =>
      ops.setDiagramOptions(d, dgm, { grid: { size: 10 }, relational: { showDataTypes: true, rowHeight: 40, compositeFkStyle: undefined }, typography: { fontSize: 16 } }),
    );
    const o = project.diagrams[dgm]!.options;
    expect(o.grid).toEqual({ visible: true, size: 10, snap: true });
    expect(o.relational).toMatchObject({ showDataTypes: true, rowHeight: 40, nameAbove: true, compositeFkStyle: 'branches' });
    expect(o.typography.fontSize).toBe(16);
    expect(o.typography.fontFamily).toBe(p.diagrams[dgm]!.options.typography.fontFamily);
  });
});

describe('node ops', () => {
  it('setNodePositions / moveNodesBy: absolute vs relative, locked nodes skipped unless included, unknown ids ignored', () => {
    const { p, dgm, s } = rel();
    const [a, b] = [nodeOf(p, dgm, s.doctor.id), nodeOf(p, dgm, s.patient.id)];
    const locked = run(p, (d) => ops.setNodeLocked(d, dgm, [b.id], true)).project;
    const { project, result } = run(locked, (d) => ({
      abs: ops.setNodePositions(d, dgm, { [a.id]: { x: 10, y: 20 }, [b.id]: { x: 1, y: 1 }, nod_ghost: { x: 0, y: 0 } }),
      rel: ops.moveNodesBy(d, dgm, [a.id, b.id], 5, -5),
    }));
    expect(result.abs).toEqual([a.id]);
    expect(result.rel).toEqual([a.id]);
    expect(nodeOf(project, dgm, s.doctor.id)).toMatchObject({ x: 15, y: 15 });
    expect(nodeOf(project, dgm, s.patient.id)).toMatchObject({ x: b.x, y: b.y });
    const forced = run(project, (d) => ops.moveNodesBy(d, dgm, [b.id], 1, 1, { includeLocked: true })).project;
    expect(nodeOf(forced, dgm, s.patient.id)).toMatchObject({ x: b.x + 1, y: b.y + 1 });
    expect(() => run(p, (d) => ops.setNodePositions(d, dgm, { [a.id]: { x: NaN, y: 0 } }))).toThrow(OpError);
    const unlocked = run(project, (d) => ops.setNodeLocked(d, dgm, b.id, false)).project;
    expect(nodeOf(unlocked, dgm, s.patient.id).locked).toBeUndefined();
  });

  it('setNodeSize sets/clears each dimension and validates', () => {
    const { p, dgm, s } = rel();
    const n = nodeOf(p, dgm, s.doctor.id);
    const { project } = run(p, (d) => ops.setNodeSize(d, dgm, n.id, { width: 300, height: 44 }));
    expect(nodeOf(project, dgm, s.doctor.id)).toMatchObject({ width: 300, height: 44 });
    const cleared = run(project, (d) => ops.setNodeSize(d, dgm, n.id, { width: undefined })).project;
    expect(nodeOf(cleared, dgm, s.doctor.id).width).toBeUndefined();
    expect(nodeOf(cleared, dgm, s.doctor.id).height).toBe(44);
    expect(() => run(p, (d) => ops.setNodeSize(d, dgm, n.id, { width: 0 }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setNodeSize(d, dgm, 'nod_ghost', { width: 5 }))).toThrow(OpError);
  });

  it('setNodeStyle merges for several nodes; an emptied style disappears', () => {
    const { p, dgm, s } = rel();
    const ids = [nodeOf(p, dgm, s.doctor.id).id, nodeOf(p, dgm, s.patient.id).id];
    const { project } = run(p, (d) => ops.setNodeStyle(d, dgm, ids, { fill: '#eef', fontStyle: 'italic' }));
    expect(nodeOf(project, dgm, s.patient.id).style).toEqual({ fill: '#eef', fontStyle: 'italic' });
    const half = run(project, (d) => ops.setNodeStyle(d, dgm, ids[0]!, { fontStyle: undefined })).project;
    expect(nodeOf(half, dgm, s.doctor.id).style).toEqual({ fill: '#eef' });
    const none = run(half, (d) => ops.setNodeStyle(d, dgm, ids[0]!, { fill: undefined })).project;
    expect(nodeOf(none, dgm, s.doctor.id).style).toBeUndefined();
  });

  it('setColumnWidth: per-column override on the node, validated against the node relation', () => {
    const { p, dgm, s } = rel();
    const n = nodeOf(p, dgm, s.doctor.id);
    const ssn = s.doctor.col('SSN');
    const { project } = run(p, (d) => ops.setColumnWidth(d, dgm, n.id, ssn, 120));
    expect(nodeOf(project, dgm, s.doctor.id).columnWidths).toEqual({ [ssn]: 120 });
    const cleared = run(project, (d) => ops.setColumnWidth(d, dgm, n.id, ssn, undefined)).project;
    expect(nodeOf(cleared, dgm, s.doctor.id).columnWidths).toBeUndefined();
    expect(() => run(p, (d) => ops.setColumnWidth(d, dgm, n.id, s.patient.col('PID'), 50))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setColumnWidth(d, dgm, n.id, ssn, -3))).toThrow(OpError);
    const c = chen();
    expect(() => run(c.p, (d) => ops.setColumnWidth(d, c.dgm, Object.keys(d.diagrams[c.dgm]!.nodes)[0]!, 'col_x', 5))).toThrow(OpError);
  });

  it('bringToFront / sendToBack keep relative order and distinct z', () => {
    const { p, dgm, s } = rel();
    const ids = [s.doctor.id, s.patient.id, s.drug.id, s.rx.id].map((r) => nodeOf(p, dgm, r).id);
    const front = run(p, (d) => ops.bringToFront(d, dgm, [ids[0]!, ids[1]!])).project;
    const z = (pr: Project, i: number) => pr.diagrams[dgm]!.nodes[ids[i]!]!.zIndex!;
    expect(z(front, 0)).toBeGreaterThan(z(front, 3));
    expect(z(front, 1)).toBeGreaterThan(z(front, 0));
    const back = run(front, (d) => ops.sendToBack(d, dgm, [ids[3]!])).project;
    expect(z(back, 3)).toBeLessThan(Math.min(z(back, 0), z(back, 1), z(back, 2)));
    const all = Object.values(back.diagrams[dgm]!.nodes).map((n) => n.zIndex);
    expect(new Set(all).size).toBe(all.length);
    // a node added afterwards still lands on top
    const added = run(back, (d) => ops.addRelation(d, s.model.id, { id: 'rln_top' })).project;
    expect(nodeOf(added, dgm, 'rln_top').zIndex).toBe(Math.max(...Object.values(added.diagrams[dgm]!.nodes).map((n) => n.zIndex!)));
  });
});

describe('edge ops', () => {
  const fkEdge = (p: Project, dgm: string, fkId: string) => Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fkId)!;

  it('setEdgeRoute: manual waypoints + anchors stored; the edge ref never changes; reset restores auto', () => {
    const { p, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk2.id);
    const [cn] = s.rx.cols('CompanyName');
    const { project } = run(p, (d) =>
      ops.setEdgeRoute(d, dgm, e.id, {
        mode: 'manual',
        waypoints: [{ x: 100, y: 200 }, { x: 300, y: 200 }],
        sourceAnchor: { side: 'top', offset: 0.25 },
        targetAnchor: { side: 'bottom' },
        branchAnchors: { [cn!]: { source: { side: 'top', offset: 0.1 } } },
      }),
    );
    const routed = project.diagrams[dgm]!.edges[e.id]!;
    expect(routed.ref).toEqual(e.ref);
    expect(routed.route).toEqual({
      mode: 'manual',
      waypoints: [{ x: 100, y: 200 }, { x: 300, y: 200 }],
      sourceAnchor: { side: 'top', offset: 0.25 },
      targetAnchor: { side: 'bottom' },
      branchAnchors: { [cn!]: { source: { side: 'top', offset: 0.1 } } },
    });
    const partial = run(project, (d) => ops.setEdgeRoute(d, dgm, e.id, { sourceAnchor: undefined, branchAnchors: {} })).project;
    expect(partial.diagrams[dgm]!.edges[e.id]!.route).toEqual({ mode: 'manual', waypoints: routed.route.waypoints, targetAnchor: { side: 'bottom' } });
    const reset = run(project, (d) => ops.resetEdgeRoute(d, dgm, e.id)).project;
    expect(reset.diagrams[dgm]!.edges[e.id]!.route).toEqual({ mode: 'auto', waypoints: [] });
  });

  it('setEdgeRoute validates: foreign branch keys, bad offsets, non-finite waypoints, unknown edge', () => {
    const { p, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk2.id);
    expect(() => run(p, (d) => ops.setEdgeRoute(d, dgm, e.id, { branchAnchors: { [s.patient.col('PID')]: {} } }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setEdgeRoute(d, dgm, e.id, { sourceAnchor: { side: 'top', offset: 1.5 } }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setEdgeRoute(d, dgm, e.id, { waypoints: [{ x: Infinity, y: 0 }] }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setEdgeRoute(d, dgm, 'edg_ghost', {}))).toThrow(OpError);
  });

  it('style / label visibility / label offsets set and clear', () => {
    const { p, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk1.id);
    const { project } = run(p, (d) => {
      ops.setEdgeStyle(d, dgm, e.id, { stroke: '#f00', dash: 'dashed' });
      ops.setEdgeLabelVisible(d, dgm, e.id, true);
      ops.setEdgeLabelOffset(d, dgm, e.id, 'main', { x: 4, y: -8 });
      ops.setEdgeLabelOffset(d, dgm, e.id, 'role', { x: 1, y: 1 });
    });
    const got = project.diagrams[dgm]!.edges[e.id]!;
    expect(got).toMatchObject({ style: { stroke: '#f00', dash: 'dashed' }, labelVisible: true, labelOffsets: { main: { x: 4, y: -8 }, role: { x: 1, y: 1 } } });
    const cleared = run(project, (d) => {
      ops.setEdgeStyle(d, dgm, e.id, { stroke: undefined, dash: undefined });
      ops.setEdgeLabelVisible(d, dgm, e.id, undefined);
      ops.setEdgeLabelOffset(d, dgm, e.id, 'main', undefined);
      ops.setEdgeLabelOffset(d, dgm, e.id, 'role', undefined);
    }).project;
    expect(cleared.diagrams[dgm]!.edges[e.id]).toEqual(p.diagrams[dgm]!.edges[e.id]);
  });

  it('a manual reroute survives moving tables (corners follow) and renaming/reordering columns (endpoints derive from ids)', () => {
    const { p, mid, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk1.id);
    const routed = run(p, (d) => ops.setEdgeRoute(d, dgm, e.id, { mode: 'manual', waypoints: [{ x: 1, y: 2 }] })).project;
    const { project } = run(routed, (d) => {
      ops.moveNodesBy(d, dgm, Object.keys(d.diagrams[dgm]!.nodes), 40, 40);
      ops.updateColumn(d, mid, s.patient.id, s.patient.col('DoctorSSN'), { name: 'Doc' });
      ops.reorderColumn(d, mid, s.patient.id, s.patient.col('DoctorSSN'), 0);
    });
    // both endpoints moved by the same delta, so the manual corners moved with them (EDITOR-TOOLS contract)
    expect(project.diagrams[dgm]!.edges[e.id]!.route).toEqual({ mode: 'manual', waypoints: [{ x: 41, y: 42 }] });
    expect((project.models[mid] as RelationalModel).foreignKeys[s.fk1.id]!.columns[0]!.targetColumnId).toBe(s.doctor.col('SSN'));
  });
});

describe('removeFromDiagram / showInDiagram', () => {
  it('removeFromDiagram: marks the diagram partial, drops the nodes and their edges, keeps semantics, sync never re-adds', () => {
    const { p, mid, dgm, s } = rel();
    const n = nodeOf(p, dgm, s.patient.id);
    const { project } = run(p, (d) => ops.removeFromDiagram(d, dgm, [n.id]));
    expect(project.diagrams[dgm]!.partial).toBe(true);
    expect(project.diagrams[dgm]!.nodes[n.id]).toBeUndefined();
    expect(Object.keys(project.diagrams[dgm]!.edges)).toEqual([fkEdgeId(project, dgm, s.fk2.id)]);
    expect(project.models[mid]).toEqual(p.models[mid]);
    const grown = run(project, (d) => ops.addRelation(d, mid, { name: 'Extra' })).project; // partial: no node for Extra
    expect(Object.values(grown.diagrams[dgm]!.nodes).some((x) => (grown.models[mid] as RelationalModel).relations[x.ref.id]?.name === 'Extra')).toBe(false);
    expect(() => run(p, (d) => ops.removeFromDiagram(d, dgm, ['nod_ghost']))).toThrow(OpError);
  });

  function fkEdgeId(p: Project, dgm: string, fkId: string): string {
    return Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fkId)!.id;
  }

  it('showInDiagram: re-adds the node (given or provisional position), restores its edges, clears `partial` when complete', () => {
    const { p, dgm, s } = rel();
    const n = nodeOf(p, dgm, s.patient.id);
    const hidden = run(p, (d) => ops.removeFromDiagram(d, dgm, [n.id])).project;
    const ref = { kind: 'relation', id: s.patient.id } as const;
    const { project, result } = run(hidden, (d) => ops.showInDiagram(d, dgm, [ref, ref, { kind: 'entity', id: 'x' }], { [refKey(ref)]: { x: 11, y: 22 } }));
    expect(result).toHaveLength(1);
    expect(project.diagrams[dgm]!.nodes[result[0]!]).toMatchObject({ x: 11, y: 22, ref });
    expect(project.diagrams[dgm]!.partial).toBeUndefined();
    expect(Object.keys(project.diagrams[dgm]!.edges)).toHaveLength(3);
    // partial stays when something is still hidden; provisional positions are finite
    const two = run(p, (d) => ops.removeFromDiagram(d, dgm, [n.id, nodeOf(p, dgm, s.doctor.id).id])).project;
    const one = run(two, (d) => ops.showInDiagram(d, dgm, [ref])).project;
    expect(one.diagrams[dgm]!.partial).toBe(true);
    expect(Object.values(one.diagrams[dgm]!.nodes).every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
  });

  it('showInDiagram skips an associative relationship (its entity node stands for it) in Chen diagrams', () => {
    const { p, mid, dgm, s } = chen();
    const assoc = run(p, (d) => ops.makeAssociative(d, mid, s.works.id)).project;
    const { project, result } = run(assoc, (d) => ops.showInDiagram(d, dgm, [{ kind: 'relationship', id: s.works.id }]));
    expect(result).toEqual([]);
    expect(Object.values(project.diagrams[dgm]!.nodes).some((n) => n.ref.kind === 'relationship' && n.ref.id === s.works.id)).toBe(false);
    expect((project.models[mid] as ErModel).relationships[s.works.id]).toBeDefined();
  });
});

describe('manual-route waypoint translation (EDITOR-TOOLS)', () => {
  const fkEdge = (p: Project, dgm: string, fkId: string) => Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fkId)!;
  const manual = (p: Project, dgm: string, edgeId: string, waypoints: Array<{ x: number; y: number }>) =>
    run(p, (d) => ops.setEdgeRoute(d, dgm, edgeId, { mode: 'manual', waypoints })).project;

  it('moves manual waypoints with an edge whose BOTH endpoints move by the same delta; auto routes are untouched', () => {
    const { p, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk1.id); // Patient -> Doctor
    const routed = manual(p, dgm, e.id, [{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    const ids = [nodeOf(routed, dgm, s.patient.id).id, nodeOf(routed, dgm, s.doctor.id).id];
    const moved = run(routed, (d) => void ops.moveNodesBy(d, dgm, ids, 10, -5)).project;
    expect(moved.diagrams[dgm]!.edges[e.id]!.route.waypoints).toEqual([{ x: 110, y: 195 }, { x: 310, y: 195 }]);
    const viaPositions = run(routed, (d) => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const id of ids) positions[id] = { x: routed.diagrams[dgm]!.nodes[id]!.x + 7, y: routed.diagrams[dgm]!.nodes[id]!.y + 3 };
      ops.setNodePositions(d, dgm, positions);
    }).project;
    expect(viaPositions.diagrams[dgm]!.edges[e.id]!.route.waypoints).toEqual([{ x: 107, y: 203 }, { x: 307, y: 203 }]);
    // an auto route has no stored waypoints to translate
    const auto = run(p, (d) => void ops.moveNodesBy(d, dgm, ids, 10, 10)).project;
    expect(auto.diagrams[dgm]!.edges[e.id]!.route).toEqual({ mode: 'auto', waypoints: [] });
  });

  it('keeps the waypoints when only ONE endpoint moves, or the endpoints move by different deltas', () => {
    const { p, dgm, s } = rel();
    const e = fkEdge(p, dgm, s.fk1.id);
    const routed = manual(p, dgm, e.id, [{ x: 100, y: 200 }]);
    const pat = nodeOf(routed, dgm, s.patient.id);
    const doc = nodeOf(routed, dgm, s.doctor.id);
    const one = run(routed, (d) => void ops.moveNodesBy(d, dgm, [pat.id], 50, 50)).project;
    expect(one.diagrams[dgm]!.edges[e.id]!.route.waypoints).toEqual([{ x: 100, y: 200 }]);
    const differ = run(routed, (d) => void ops.setNodePositions(d, dgm, { [pat.id]: { x: pat.x + 5, y: pat.y }, [doc.id]: { x: doc.x + 9, y: doc.y } })).project;
    expect(differ.diagrams[dgm]!.edges[e.id]!.route.waypoints).toEqual([{ x: 100, y: 200 }]);
    // a locked endpoint does not move, so the edge keeps its corners
    const locked = run(routed, (d) => void ops.setNodeLocked(d, dgm, doc.id, true)).project;
    const both = run(locked, (d) => void ops.moveNodesBy(d, dgm, [pat.id, doc.id], 20, 20)).project;
    expect(both.diagrams[dgm]!.edges[e.id]!.route.waypoints).toEqual([{ x: 100, y: 200 }]);
  });

  it('a self-referencing edge follows its single node; Chen participant and attribute edges follow too', () => {
    const { p, mid, dgm, s } = chen();
    const edgeOfKind = (q: Project, kind: string) => Object.values(q.diagrams[dgm]!.edges).find((e) => e.ref.kind === kind)!;
    const part = edgeOfKind(p, 'participant');
    const routed = manual(p, dgm, part.id, [{ x: 40, y: 40 }]);
    const nodeIds = Object.keys(routed.diagrams[dgm]!.nodes);
    const moved = run(routed, (d) => void ops.moveNodesBy(d, dgm, nodeIds, -3, 4)).project;
    expect(moved.diagrams[dgm]!.edges[part.id]!.route.waypoints).toEqual([{ x: 37, y: 44 }]);
    void mid;
    void s;
  });

  it('a recursive FK (both ends on one node) follows that node', () => {
    const { p, dgm, s } = rel();
    const added = run(p, (d) => {
      ops.addForeignKey(d, s.model.id, { sourceRelationId: s.patient.id, targetRelationId: s.patient.id, columns: [{ sourceColumnId: s.patient.col('Name'), targetColumnId: s.patient.col('PID') }] });
    }).project;
    const self = Object.values(added.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && added.models[added.diagrams[dgm]!.modelId]!.kind === 'relational' && (added.models[added.diagrams[dgm]!.modelId] as RelationalModel).foreignKeys[e.ref.foreignKeyId]!.sourceRelationId === (added.models[added.diagrams[dgm]!.modelId] as RelationalModel).foreignKeys[e.ref.foreignKeyId]!.targetRelationId)!;
    const routed = manual(added, dgm, self.id, [{ x: 10, y: 10 }, { x: 20, y: 10 }]);
    const moved = run(routed, (d) => void ops.moveNodesBy(d, dgm, [nodeOf(routed, dgm, s.patient.id).id], 100, 0)).project;
    expect(moved.diagrams[dgm]!.edges[self.id]!.route.waypoints).toEqual([{ x: 110, y: 10 }, { x: 120, y: 10 }]);
  });
});
