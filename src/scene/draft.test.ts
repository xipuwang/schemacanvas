// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Id, Project } from '@/model/types';
import { layoutChenFixture, pharmacy } from './chen/fixtures';
import { pharmacyFixture } from './horizontal/fixtures';
import { buildScene } from './registry';
import type { FkEdgeGeom, Rect, Scene } from './types';
import { pharmacyVFixture } from './vertical/fixtures';

const moveNode = (project: Project, diagramId: Id, nodeId: Id, dx: number, dy: number): Project => {
  const d = project.diagrams[diagramId]!;
  const n = d.nodes[nodeId]!;
  return { ...project, diagrams: { ...project.diagrams, [diagramId]: { ...d, nodes: { ...d.nodes, [nodeId]: { ...n, x: n.x + dx, y: n.y + dy } } } } };
};

const onBorder = (p: { x: number; y: number }, r: Rect, eps = 0.5): boolean => {
  const inX = p.x >= r.x - eps && p.x <= r.x + r.w + eps;
  const inY = p.y >= r.y - eps && p.y <= r.y + r.h + eps;
  const nearX = Math.abs(p.x - r.x) <= eps || Math.abs(p.x - (r.x + r.w)) <= eps;
  const nearY = Math.abs(p.y - r.y) <= eps || Math.abs(p.y - (r.y + r.h)) <= eps;
  return (inX && nearY) || (inY && nearX);
};

const baselineOf = (project: Project, diagramId: Id, scene: Scene) => {
  const d = project.diagrams[diagramId]!;
  return { scene, diagram: d, model: project.models[d.modelId]! };
};

describe('draft scene quality', () => {
  const fx = pharmacyFixture();
  const dId = fx.diagram.id;
  const full = buildScene(fx.project, dId);
  const nodeOf = (name: string): Id => Object.values(fx.diagram.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === fx.rel[name]!.id)!.id;
  const moved = moveNode(fx.project, dId, nodeOf('Doctor'), 140, 90);

  it('full quality is byte-identical with or without the new options', () => {
    const base = JSON.stringify(buildScene(moved, dId));
    expect(JSON.stringify(buildScene(moved, dId, undefined, { quality: 'full' }))).toBe(base);
    // `previous` is ignored in full mode
    expect(JSON.stringify(buildScene(moved, dId, undefined, { previous: baselineOf(fx.project, dId, full) }))).toBe(base);
    expect(buildScene(moved, dId).quality).toBeUndefined();
  });

  it('draft: untouched edges reuse the previous geometry object, touched edges keep their exact referenced cells', () => {
    const draft = buildScene(moved, dId, undefined, { quality: 'draft', previous: baselineOf(fx.project, dId, full) });
    const fresh = buildScene(moved, dId);
    expect(draft.quality).toBe('draft');
    expect(Object.keys(draft.edges)).toEqual(Object.keys(fresh.edges));
    expect(draft.nodeOrder).toEqual(fresh.nodeOrder);
    expect(draft.nodes).toEqual(fresh.nodes);
    let reused = 0;
    let provisional = 0;
    for (const [id, e] of Object.entries(draft.edges)) {
      const prev = full.edges[id]!;
      const touches = e.sourceNodeId === nodeOf('Doctor') || e.targetNodeId === nodeOf('Doctor');
      if (!touches) {
        expect(e).toBe(prev);
        reused++;
        continue;
      }
      provisional++;
      const f = fresh.edges[id] as FkEdgeGeom;
      const g = e as FkEdgeGeom;
      expect(g.branches.map((b) => [b.sourceColumnId, b.targetColumnId])).toEqual(f.branches.map((b) => [b.sourceColumnId, b.targetColumnId]));
      g.branches.forEach((b, i) => {
        expect(b.targetCell).toEqual(f.branches[i]!.targetCell);
        expect(b.sourceCell).toEqual(f.branches[i]!.sourceCell);
        expect(onBorder(b.arrow.tip, b.targetCell)).toBe(true);
        expect(onBorder(b.points[0]!, b.sourceCell)).toBe(true);
        expect(b.arrow.tip).toEqual(b.ends[1].at);
      });
      // every segment is axis aligned
      for (const p of g.paths) for (let k = 0; k + 1 < p.length; k++) expect(p[k]!.x === p[k + 1]!.x || p[k]!.y === p[k + 1]!.y).toBe(true);
    }
    expect(reused).toBeGreaterThan(0);
    expect(provisional).toBeGreaterThan(0);
  });

  it('draft without a usable baseline is still a complete scene; a changed model or options refuses reuse', () => {
    const noPrev = buildScene(moved, dId, undefined, { quality: 'draft' });
    expect(Object.keys(noPrev.edges)).toEqual(Object.keys(buildScene(moved, dId).edges));
    const otherModel = { ...baselineOf(fx.project, dId, full), model: { ...fx.model } };
    const s = buildScene(moved, dId, undefined, { quality: 'draft', previous: otherModel });
    for (const [id, e] of Object.entries(s.edges)) expect(e).not.toBe(full.edges[id]);
    const draftBaseline = baselineOf(fx.project, dId, { ...full, quality: 'draft' });
    const s2 = buildScene(moved, dId, undefined, { quality: 'draft', previous: draftBaseline });
    for (const [id, e] of Object.entries(s2.edges)) expect(e).not.toBe(full.edges[id]);
  });

  it('the end state after a drop equals a fresh full build (the draft never leaks into it)', () => {
    buildScene(moved, dId, undefined, { quality: 'draft', previous: baselineOf(fx.project, dId, full) });
    expect(JSON.stringify(buildScene(moved, dId))).toBe(JSON.stringify(buildScene(moved, dId, undefined, { quality: 'full' })));
  });

  it('crow\'s foot / physical draft: untouched edges reused, touched ones end on the right rows', () => {
    for (const type of ['crows-foot', 'physical'] as const) {
      const vf = pharmacyVFixture(type);
      const id = vf.diagram.id;
      const base = buildScene(vf.project, id);
      const victim = Object.keys(vf.diagram.nodes)[0]!;
      const p2 = moveNode(vf.project, id, victim, 120, 80);
      const draft = buildScene(p2, id, undefined, { quality: 'draft', previous: baselineOf(vf.project, id, base) });
      const fresh = buildScene(p2, id);
      expect(Object.keys(draft.edges)).toEqual(Object.keys(fresh.edges));
      for (const [eid, e] of Object.entries(draft.edges)) {
        const touches = e.sourceNodeId === victim || e.targetNodeId === victim;
        if (!touches) expect(e).toBe(base.edges[eid]);
        else {
          expect(e.ends[0].columnId).toBe(fresh.edges[eid]!.ends[0].columnId);
          expect(e.ends[1].columnId).toBe(fresh.edges[eid]!.ends[1].columnId);
          expect(e.ends[1].anchorRect).toEqual(fresh.edges[eid]!.ends[1].anchorRect);
        }
      }
    }
  });

  it('chen draft: untouched lines reused, same edge set and order, lines still end on their nodes', () => {
    const c = layoutChenFixture(pharmacy());
    const id = c.diagram.id;
    const base = buildScene(c.project, id);
    const victim = Object.keys(c.diagram.nodes)[2]!;
    const p2 = moveNode(c.project, id, victim, 160, 40);
    const draft = buildScene(p2, id, undefined, { quality: 'draft', previous: baselineOf(c.project, id, base) });
    const fresh = buildScene(p2, id);
    expect(Object.keys(draft.edges)).toEqual(Object.keys(fresh.edges));
    for (const [eid, e] of Object.entries(draft.edges)) {
      const touches = e.sourceNodeId === victim || e.targetNodeId === victim;
      if (!touches) expect(e).toBe(base.edges[eid]);
      else {
        expect(e.sourceNodeId).toBe(fresh.edges[eid]!.sourceNodeId);
        expect(e.targetNodeId).toBe(fresh.edges[eid]!.targetNodeId);
        expect(e.paths[0]!.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
