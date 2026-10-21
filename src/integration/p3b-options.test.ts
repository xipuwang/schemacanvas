// @vitest-environment node
import './deterministic';
/** P3b: diagram option matrix (data types, bracket FK style, name-left, labels, straight routing, big fonts) on Pharmacy. */
import { describe, expect, it } from 'vitest';
import type { FkEdgeGeom } from '@/scene/types';
import { fkEdgeRefs } from './fkAssert';
import { contains, hTables, nodeOverlaps, relModelOf } from './helpers';
import { CHEN_VARIANTS, REL_VARIANTS, renderVariant } from './renderAll';

describe('P3b Chen option variants', () => {
  it.each(CHEN_VARIANTS)('%s: re-laid-out scene is sound', async (name, patch) => {
    const r = await renderVariant(name, 'chen', patch);
    expect(r.scene.warnings).toEqual([]);
    expect(nodeOverlaps(r.scene)).toEqual([]);
    for (const e of Object.values(r.scene.edges)) expect(contains(r.scene.bounds, e.bounds)).toBe(true);
    for (const n of Object.values(r.scene.nodes)) expect(contains(r.scene.bounds, n.paintBounds)).toBe(true);
    expect(r.svg).not.toMatch(/NaN|undefined/);
  });
});

describe('P3b relational option variants', () => {
  it.each(REL_VARIANTS)('%s: FK pairs, cells and bounds stay exact', async (name, patch) => {
    const r = await renderVariant(name, 'relational', patch);
    expect(r.scene.warnings.filter((w) => !w.startsWith('fk-bracket-fallback:'))).toEqual([]);
    expect(nodeOverlaps(r.scene)).toEqual([]);
    for (const e of Object.values(r.scene.edges)) expect(contains(r.scene.bounds, e.bounds), `edge ${e.edgeId}`).toBe(true);
    for (const n of Object.values(r.scene.nodes)) expect(contains(r.scene.bounds, n.paintBounds)).toBe(true);
    const diagram = r.project.diagrams[r.diagramId]!;
    const rel = relModelOf(r.project, diagram.modelId);
    const tables = hTables(r.scene);
    for (const e of Object.values(r.scene.edges) as FkEdgeGeom[]) {
      const fk = rel.foreignKeys[(e.ref as { foreignKeyId: string }).foreignKeyId]!;
      fkEdgeRefs(
        e, fk,
        tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.sourceRelationId)!,
        tables.find((t) => t.ref.kind === 'relation' && t.ref.id === fk.targetRelationId)!,
        { routing: name === 'straight' ? 'straight' : 'orthogonal' },
      );
    }
    expect(r.svg).not.toMatch(/NaN|undefined/);
    if (name === 'bracket') {
      // composite FKs are contiguous & ordered in Pharmacy? either bracket drawn or an explicit fallback warning, never silent
      const composite = (Object.values(r.scene.edges) as FkEdgeGeom[]).filter((e) => (e.pairs?.length ?? e.branches.length) > 1);
      for (const e of composite) {
        const fell = r.scene.warnings.some((w) => w === `fk-bracket-fallback:${(e.ref as { foreignKeyId: string }).foreignKeyId}`);
        expect(e.style === 'bracket' || fell, 'bracket style is honest or warned').toBe(true);
      }
    }
  });
});
