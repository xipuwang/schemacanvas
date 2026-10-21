import { describe, expect, it } from 'vitest';
import * as ops from '@/model/ops';
import { labelRect, rectCenter } from '@/scene/geometry';
import type { FkEdgeGeom, HTableGeom } from '@/scene/types';
import { deepFreeze } from '@/test/deepFreeze';
import { hitTest, marqueeSelect, rectFromPoints } from './hit';
import { makeStore, nodeNamed, sceneOf } from './testFixtures';

const chen = () => {
  const { store, setup, diagramId } = makeStore('chen');
  const project = deepFreeze(store.getState().project);
  return { project, diagramId, scene: sceneOf(project, diagramId) };
};
const rel = () => {
  const { store, diagramId } = makeStore('rel');
  const project = deepFreeze(store.getState().project);
  return { store, project, diagramId, scene: sceneOf(project, diagramId) };
};

describe('hitTest: Chen shapes', () => {
  const { project, diagramId, scene } = chen();
  it('hits a rectangle (entity) at its centre and misses outside', () => {
    const id = nodeNamed(project, diagramId, 'Doctor');
    const b = scene.nodes[id]!.bounds;
    expect(hitTest(scene, rectCenter(b), 1)).toEqual({ kind: 'node', nodeId: id });
    expect(hitTest(scene, { x: b.x + b.w + 40, y: b.y + b.h + 40 }, 1).kind).toBe('none');
  });
  it('uses the real outline for ellipses: the bounding-box corner is outside', () => {
    const id = nodeNamed(project, diagramId, 'Speciality');
    const g = scene.nodes[id]!;
    expect(g.outline.kind).toBe('ellipse');
    const b = g.bounds;
    expect(hitTest(scene, rectCenter(b), 1)).toEqual({ kind: 'node', nodeId: id });
    const r = hitTest(scene, { x: b.x + 1, y: b.y + 1 }, 1);
    expect(r.kind === 'node' && r.nodeId === id).toBe(false);
  });
  it('uses the real outline for diamonds: the bounding-box corner is outside', () => {
    const id = nodeNamed(project, diagramId, 'PrimaryPhysician');
    const g = scene.nodes[id]!;
    expect(g.outline.kind).toBe('diamond');
    const b = g.bounds;
    expect(hitTest(scene, rectCenter(b), 1)).toEqual({ kind: 'node', nodeId: id });
    const r = hitTest(scene, { x: b.x + 2, y: b.y + 2 }, 1);
    expect(r.kind === 'node' && r.nodeId === id).toBe(false);
  });
  it('kinds option restricts the result', () => {
    const id = nodeNamed(project, diagramId, 'Doctor');
    const c = rectCenter(scene.nodes[id]!.bounds);
    expect(hitTest(scene, c, 1, { kinds: ['edge'] }).kind).toBe('none');
    expect(hitTest(scene, c, 1, { skip: new Set([id]) }).kind).not.toBe('node');
  });
  it('a participation line is hit within 6 screen px, scaled by zoom', () => {
    let checked = 0;
    for (const edge of Object.values(scene.edges)) {
      if (edge.kind !== 'chen-line' || edge.lineKind !== 'participant' || edge.double) continue;
      const [a, b] = edge.paths[0]!;
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 60) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      const at = (d: number) => ({ x: mid.x + n.x * d, y: mid.y + n.y * d });
      const h0 = hitTest(scene, mid, 1);
      if (h0.kind !== 'edge' || h0.edgeId !== edge.edgeId) continue;
      expect(hitTest(scene, at(5), 1)).toMatchObject({ kind: 'edge' });
      expect(hitTest(scene, at(12), 1).kind).not.toBe('edge');
      // zoomed out: 9 world px = 4.5 screen px -> hit; zoomed in 4x: 3 world px = 12 screen px -> miss
      expect(hitTest(scene, at(9), 0.5)).toMatchObject({ kind: 'edge' });
      expect(hitTest(scene, at(3), 4).kind).not.toBe('edge');
      checked++;
      if (checked >= 2) break;
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('edge labels win over what is below them', () => {
    const withLabel = Object.values(scene.edges).find((e) => e.labels.some((l) => l.label.text))!;
    const l = withLabel.labels.find((x) => x.label.text)!;
    const r = hitTest(scene, rectCenter(labelRect(l.label)), 1);
    expect(r).toEqual({ kind: 'edge-label', edgeId: withLabel.edgeId, labelId: l.id });
  });
});

describe('hitTest: horizontal tables', () => {
  const { store, project, diagramId, scene } = rel();
  const drugId = nodeNamed(project, diagramId, 'Drug');
  const drug = scene.nodes[drugId] as HTableGeom;

  it('reports the cell under the pointer', () => {
    drug.cells.forEach((cell) => {
      const r = hitTest(scene, rectCenter(cell.rect), 1);
      expect(r).toEqual({ kind: 'node', nodeId: drugId, columnId: cell.columnId });
    });
  });
  it('flags column borders for resize tools', () => {
    const c1 = drug.cells[1]!;
    const r = hitTest(scene, { x: c1.rect.x + 1, y: c1.rect.y + c1.rect.h / 2 }, 1);
    expect(r).toMatchObject({ kind: 'node', columnId: c1.columnId, border: { columnId: c1.columnId, side: 'left' } });
    const last = drug.cells[drug.cells.length - 1]!;
    expect(hitTest(scene, { x: last.rect.x + last.rect.w - 1, y: last.rect.y + 4 }, 1)).toMatchObject({ border: { side: 'right' } });
  });
  it('the relation name is part of the node, the empty space beside it is not', () => {
    const nameRect = labelRect(drug.nameLabel);
    expect(hitTest(scene, rectCenter(nameRect), 1)).toEqual({ kind: 'node', nodeId: drugId, onName: true });
    const farRight = { x: drug.row.x + drug.row.w - 4, y: drug.nameLabel.y };
    expect(hitTest(scene, farRight, 1).kind).not.toBe('node');
  });
  it('FK edges: composite FK reports the branch (source column) under the pointer', () => {
    const fkEdge = Object.values(scene.edges).find((e): e is FkEdgeGeom => e.kind === 'fk' && e.branches.length > 1)!;
    expect(fkEdge).toBeDefined();
    for (const b of fkEdge.branches) {
      // a point on the branch's first segment, well away from tables
      const mid = { x: (b.points[1]!.x + b.points[2 % b.points.length]!.x) / 2, y: (b.points[1]!.y + b.points[2 % b.points.length]!.y) / 2 };
      const r = hitTest(scene, mid, 1, { kinds: ['edge'] });
      expect(r.kind).toBe('edge');
      if (r.kind === 'edge') expect(fkEdge.branches.map((x) => x.sourceColumnId)).toContain(r.branchId);
    }
    // single-point-per-branch assertion: pick the branch's arrow region and compare the id exactly
    const b0 = fkEdge.branches[0]!;
    const near = { x: b0.arrow.base.x, y: b0.arrow.base.y };
    const r0 = hitTest(scene, near, 1, { kinds: ['edge'] });
    expect(r0).toMatchObject({ kind: 'edge', edgeId: fkEdge.edgeId });
  });
  it('z-order: the top-most node wins where two overlap', () => {
    const otherId = nodeNamed(project, diagramId, 'Company');
    const target = scene.nodes[drugId]!.bounds;
    store.getState().commit('stack', (d) => {
      ops.setNodePositions(d, diagramId, { [otherId]: { x: target.x, y: target.y } });
      ops.bringToFront(d, diagramId, [otherId]);
    });
    const p2 = store.getState().project;
    const s2 = sceneOf(p2, diagramId);
    const cell = (s2.nodes[drugId] as HTableGeom).cells[0]!;
    expect(hitTest(s2, rectCenter(cell.rect), 1)).toMatchObject({ kind: 'node', nodeId: otherId });
    store.getState().commit('back', (d) => ops.bringToFront(d, diagramId, [drugId]));
    const s3 = sceneOf(store.getState().project, diagramId);
    expect(hitTest(s3, rectCenter((s3.nodes[drugId] as HTableGeom).cells[0]!.rect), 1)).toMatchObject({ kind: 'node', nodeId: drugId });
  });
});

describe('marqueeSelect', () => {
  const { project, diagramId, scene } = chen();
  const doctor = nodeNamed(project, diagramId, 'Doctor');
  const b = scene.nodes[doctor]!.bounds;
  it('intersect selects touched nodes; contain needs full enclosure', () => {
    const partial = { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 4, h: 4 };
    expect(marqueeSelect(scene, partial).nodeIds).toContain(doctor);
    expect(marqueeSelect(scene, partial, { mode: 'contain' }).nodeIds).not.toContain(doctor);
    expect(marqueeSelect(scene, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }, { mode: 'contain' }).nodeIds).toContain(doctor);
  });
  it('an empty region selects nothing; the whole scene selects everything', () => {
    expect(marqueeSelect(scene, { x: -5000, y: -5000, w: 10, h: 10 })).toEqual({ nodeIds: [], edgeIds: [] });
    const all = marqueeSelect(scene, { x: scene.bounds.x - 1, y: scene.bounds.y - 1, w: scene.bounds.w + 2, h: scene.bounds.h + 2 });
    expect(all.nodeIds.length).toBe(scene.nodeOrder.length);
    expect(all.edgeIds.length).toBe(scene.edgeOrder.length);
  });
  it('edges: default needs full containment, intersect mode accepts a crossing, none ignores them', () => {
    const edgeId = scene.edgeOrder[0]!;
    const e = scene.edges[edgeId]!;
    const p0 = e.paths[0]![0]!;
    const small = { x: p0.x - 3, y: p0.y - 3, w: 6, h: 6 };
    expect(marqueeSelect(scene, small).edgeIds).not.toContain(edgeId);
    expect(marqueeSelect(scene, small, { edges: 'intersect' }).edgeIds).toContain(edgeId);
    expect(marqueeSelect(scene, { x: scene.bounds.x - 1, y: scene.bounds.y - 1, w: scene.bounds.w + 2, h: scene.bounds.h + 2 }, { edges: 'none' }).edgeIds).toEqual([]);
  });
  it('rectFromPoints normalises', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 30 })).toEqual({ x: 4, y: 20, w: 6, h: 10 });
  });
});
