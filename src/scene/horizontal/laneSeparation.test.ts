// @vitest-environment node
/**
 * SA-05: distinct foreign keys that share a corridor keep a visible lane separation, and no connector runs right beside
 * another connector's final approach into a different cell (it would read as pointing at the wrong field).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { buildExample } from '@/examples';
import { buildScene } from '@/scene/registry';
import type { Point } from '../base';
import { defaultMeasure } from '../measure';
import { buildHorizontalScene } from './index';
import { pharmacyFixture, tangledFixture, type Fixture } from './fixtures';
import type { FkEdgeGeom } from './types';

let restore = () => {};
afterEach(() => restore());

export const MIN_LANE = 8;

interface Branch { edgeId: string; target: string; points: Point[] }

/** Min distance between PARALLEL, overlapping segments of branches of different edges that do not converge on the same target cell. */
export function closestParallel(edges: FkEdgeGeom[]): { dist: number; where: string } {
  const bs: Branch[] = edges.flatMap((e) => e.branches.map((b) => ({ edgeId: e.edgeId, target: `${e.targetNodeId}:${b.targetColumnId}`, points: b.points })));
  let best = { dist: Infinity, where: '' };
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!;
      const b = bs[j]!;
      if (a.edgeId === b.edgeId || a.target === b.target) continue;
      for (let p = 0; p + 1 < a.points.length; p++) {
        for (let q = 0; q + 1 < b.points.length; q++) {
          const pa = a.points[p]!, pb = a.points[p + 1]!, qa = b.points[q]!, qb = b.points[q + 1]!;
          const ah = pa.y === pb.y, bh = qa.y === qb.y;
          if (ah !== bh) continue;
          // two ANCHORED segments (first / last of their routes) sit where the cells put them: not a routing choice
          if ((p === 0 || p + 2 === a.points.length) && (q === 0 || q + 2 === b.points.length)) continue;
          const [k, o] = ah ? (['y', 'x'] as const) : (['x', 'y'] as const);
          const overlap = Math.min(Math.max(pa[o], pb[o]), Math.max(qa[o], qb[o])) - Math.max(Math.min(pa[o], pb[o]), Math.min(qa[o], qb[o]));
          if (overlap <= 1) continue;
          const d = Math.abs(pa[k] - qa[k]);
          if (d < best.dist) best = { dist: d, where: `${a.edgeId}/${b.edgeId} ${k}=${pa[k]} vs ${qa[k]}` };
        }
      }
    }
  }
  return best;
}

const edgesOf = (scene: { edges: Record<string, unknown> }): FkEdgeGeom[] => Object.values(scene.edges) as FkEdgeGeom[];

describe('SA-05 lane separation', () => {
  it('the Pharmacy example (relational sheet) keeps >= 8px between connectors of different FKs', () => {
    restore = useDeterministicIds();
    const p = buildExample('pharmacy');
    const did = Object.values(p.diagrams).find((d) => d.type === 'relational-schema')!.id;
    const scene = buildScene(p, did);
    const r = closestParallel(edgesOf(scene));
    expect(r.dist, r.where).toBeGreaterThanOrEqual(MIN_LANE - 1e-6);
  });

  it('pharmacy / tangled fixtures', () => {
    restore = useDeterministicIds();
    for (const f of [pharmacyFixture(), tangledFixture()]) {
      const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
      const r = closestParallel(edgesOf(scene));
      expect(r.dist, r.where).toBeGreaterThanOrEqual(MIN_LANE - 1e-6);
    }
  });

  it('random well-spaced layouts of the pharmacy schema', () => {
    restore = useDeterministicIds();
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const worst: string[] = [];
    let layouts = 0;
    for (let n = 0; n < 70; n++) {
      const f: Fixture = pharmacyFixture();
      const sizes = Object.fromEntries(
        Object.values(buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure }).nodes).map((g) => [g.nodeId, g.bounds]),
      );
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      let ok = true;
      for (const node of Object.values(f.diagram.nodes)) {
        const b = sizes[node.id]!;
        let found = false;
        for (let tries = 0; tries < 400 && !found; tries++) {
          const x = Math.round(rnd() * 1400);
          const y = Math.round(rnd() * 1000);
          found = placed.every((p) => x + b.w + 40 <= p.x || p.x + p.w + 40 <= x || y + b.h + 40 <= p.y || p.y + p.h + 40 <= y);
          if (found) {
            node.x = x;
            node.y = y;
            placed.push({ x, y, w: b.w, h: b.h });
          }
        }
        if (!found) ok = false;
      }
      if (!ok) continue;
      layouts++;
      const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
      const r = closestParallel(edgesOf(scene));
      if (r.dist < MIN_LANE - 1e-6) worst.push(`layout ${n}: ${r.dist.toFixed(1)} ${r.where}`);
    }
    expect(layouts).toBeGreaterThan(30);
    // Before the lane-separation pass 62 of 70 such layouts had two connectors of different FKs running < 8 px apart. What is
    // left are rigid composite lanes squeezed beside an anchored run (the bundle cannot move on its own); keep that bounded.
    expect(worst.length / layouts, worst.join('\n')).toBeLessThan(0.25);
  });
});
