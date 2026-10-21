// @vitest-environment node
import './deterministic';
/** P2 LAYOUT + SCENE: real scene builders + real auto-layout, applied through ops.setNodePositions in the REAL store. */
import { describe, expect, it } from 'vitest';
import { buildScene } from '@/scene/registry';
import type { Rect } from '@/scene/base';
import type { Scene } from '@/scene/types';
import { fkEdgeRefs } from './fkAssert';
import {
  EXAMPLES, EXAMPLE_KEYS, contains, convertInStore, fkEdges, hTables, layoutDiagramInStore, nodeOverlaps, relModelOf, segIntersectsRect, setupEr,
} from './helpers';

function expectSceneSound(scene: Scene, diagramEdgeIds: string[], diagramNodeIds: string[]) {
  expect(scene.warnings).toEqual([]);
  expect(Object.keys(scene.edges).sort()).toEqual([...diagramEdgeIds].sort());
  expect(Object.keys(scene.nodes).sort()).toEqual([...diagramNodeIds].sort());
  expect(nodeOverlaps(scene)).toEqual([]);
  for (const n of Object.values(scene.nodes)) expect(contains(scene.bounds, n.paintBounds), `node ${n.nodeId}`).toBe(true);
  for (const e of Object.values(scene.edges)) expect(contains(scene.bounds, e.bounds), `edge ${e.edgeId}`).toBe(true);
}

describe.each(EXAMPLE_KEYS)('P2 example %s', (key) => {
  it('Chen: auto-layout -> no overlap, no warnings, every edge drawn, bounds contain all', async () => {
    const s = setupEr(EXAMPLES[key]());
    await layoutDiagramInStore(s.store, s.erDiagramId);
    const p = s.store.getState().project;
    const d = p.diagrams[s.erDiagramId]!;
    const scene = buildScene(p, s.erDiagramId);
    expectSceneSound(scene, Object.keys(d.edges), Object.keys(d.nodes));
    // Rule 11: node x/y === geom.bounds top-left
    for (const n of Object.values(d.nodes)) {
      const g = scene.nodes[n.id]!;
      expect(g.bounds.x).toBeCloseTo(n.x, 3);
      expect(g.bounds.y).toBeCloseTo(n.y, 3);
    }
    // layout is idempotent-ish & deterministic: second run gives the same positions
    const again = await (await import('@/layout')).autoLayout(scene, p, s.erDiagramId);
    for (const n of Object.values(d.nodes)) expect(again[n.id]!.x).toBeCloseTo(n.x, 1);
  });

  it('Relational: FK branches end on the exact referenced cell; no connector crosses a foreign table', async () => {
    const s = setupEr(EXAMPLES[key]());
    const c = await convertInStore(s); // positions from the real layout
    // lay out once more on the committed project through the store (the Auto-layout command path)
    await layoutDiagramInStore(s.store, c.relDiagramId);
    const p = s.store.getState().project;
    const d = p.diagrams[c.relDiagramId]!;
    const rel = relModelOf(p, c.relModelId);
    const scene = buildScene(p, c.relDiagramId);
    expectSceneSound(scene, Object.keys(d.edges), Object.keys(d.nodes));
    expect(fkEdges(scene).length).toBe(Object.keys(rel.foreignKeys).length);

    const tables = hTables(scene);
    for (const e of fkEdges(scene)) {
      const fk = rel.foreignKeys[(e.ref as { foreignKeyId: string }).foreignKeyId]!;
      const sourceTable = tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.sourceRelationId)!;
      const targetTable = tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.targetRelationId)!;
      fkEdgeRefs(e, fk, sourceTable, targetTable); // throws on any mismatch via expect
      // obstacles: every table except this FK's own endpoints
      for (const t of tables) {
        if (t.nodeId === sourceTable.nodeId || t.nodeId === targetTable.nodeId) continue;
        for (const path of e.paths) {
          for (let i = 0; i + 1 < path.length; i++) {
            expect(segIntersectsRect(path[i]!, path[i + 1]!, t.bounds as Rect), `FK ${fk.id} crosses table ${t.nodeId}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('P2 robustness: moving tables never re-points an FK', () => {
  it('Pharmacy: after 25 random moves (some overlapping tables) every branch still ends on its exact referenced cell', async () => {
    const s = setupEr(EXAMPLES.E());
    const c = await convertInStore(s);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const { moveNodesBy, setNodePositions } = await import('@/model/ops');
    for (let i = 0; i < 25; i++) {
      const d = s.store.getState().project.diagrams[c.relDiagramId]!;
      const ids = Object.keys(d.nodes).sort();
      const id = ids[Math.floor(rnd() * ids.length)]!;
      s.store.getState().commit('move', (dr) => {
        if (i % 5 === 4) setNodePositions(dr, c.relDiagramId, { [id]: { x: 0, y: 0 } });
        else moveNodesBy(dr, c.relDiagramId, [id], Math.round((rnd() - 0.5) * 600), Math.round((rnd() - 0.5) * 600));
      });
      const p = s.store.getState().project;
      const rel = relModelOf(p, c.relModelId);
      const scene = buildScene(p, c.relDiagramId);
      const tables = hTables(scene);
      expect(fkEdges(scene).length).toBe(Object.keys(rel.foreignKeys).length);
      expect(Object.keys(rel.foreignKeys).length).toBeGreaterThanOrEqual(9);
      for (const e of fkEdges(scene)) {
        const fk = rel.foreignKeys[(e.ref as { foreignKeyId: string }).foreignKeyId]!;
        fkEdgeRefs(
          e, fk,
          tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.sourceRelationId)!,
          tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.targetRelationId)!,
        );
      }
    }
  });
});
