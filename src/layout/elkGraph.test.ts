import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import { layoutGraph, overlappingPairs, type GraphEdge, type GraphNode, type LayoutAlgorithm } from './elkGraph';

const ALGOS: LayoutAlgorithm[] = ['layered', 'stress', 'force', 'radial', 'rectpacking'];

function chain(n: number, w = 120, h = 40): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(4, '0')}`, w, h }));
  const edges = nodes.slice(1).map((nd, i) => ({ id: `e${i}`, source: nodes[i]!.id, target: nd.id }));
  return { nodes, edges };
}

const allFinite = (pos: Record<string, { x: number; y: number }>): boolean =>
  Object.values(pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

describe('layoutGraph', () => {
  it('returns {} for an empty graph and (0,0) for a single node', async () => {
    expect(await layoutGraph({ nodes: [], edges: [], algorithm: 'layered' })).toEqual({});
    expect(await layoutGraph({ nodes: [{ id: 'a', w: 50, h: 20 }], edges: [], algorithm: 'stress' })).toEqual({ a: { x: 0, y: 0 } });
  });

  for (const algorithm of ALGOS) {
    it(`${algorithm}: finite, non-overlapping, handles disconnected + self-loop + parallel + dangling edges`, async () => {
      const nodes: GraphNode[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, w: 80 + i * 10, h: 30 + i * 5 }));
      const edges: GraphEdge[] = [
        { id: '1', source: 'a', target: 'b' },
        { id: '2', source: 'a', target: 'b' }, // parallel
        { id: '3', source: 'c', target: 'c' }, // self-loop
        { id: '4', source: 'd', target: 'e' },
        { id: '5', source: 'a', target: 'zzz' }, // dangling
      ];
      const pos = await layoutGraph(deepFreeze({ nodes, edges, algorithm }));
      expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      expect(allFinite(pos)).toBe(true);
      expect(overlappingPairs(nodes, pos)).toEqual([]);
    });

    it(`${algorithm}: deterministic and independent of input order`, async () => {
      const { nodes, edges } = chain(12);
      const a = await layoutGraph({ nodes, edges, algorithm, seed: 7 });
      const b = await layoutGraph({ nodes, edges, algorithm, seed: 7 });
      const c = await layoutGraph({ nodes: [...nodes].reverse(), edges: [...edges].reverse(), algorithm, seed: 7 });
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    });
  }

  it('layered DOWN orders a chain top to bottom, RIGHT left to right, with >= spacing between layers', async () => {
    const { nodes, edges } = chain(4);
    const down = await layoutGraph({ nodes, edges, algorithm: 'layered', direction: 'DOWN', spacing: 60 });
    for (let i = 1; i < 4; i++) expect(down[nodes[i]!.id]!.y - (down[nodes[i - 1]!.id]!.y + 40)).toBeGreaterThanOrEqual(60 - 1e-6);
    const right = await layoutGraph({ nodes, edges, algorithm: 'layered', direction: 'RIGHT', spacing: 60 });
    for (let i = 1; i < 4; i++) expect(right[nodes[i]!.id]!.x - (right[nodes[i - 1]!.id]!.x + 120)).toBeGreaterThanOrEqual(60 - 1e-6);
  });

  it('keeps fixed nodes exactly in place and leaves the others clear of them', async () => {
    const { nodes, edges } = chain(6);
    const withFixed = nodes.map((n, i) => (i === 2 ? { ...n, fixed: { x: 500, y: 300 } } : n));
    for (const algorithm of ALGOS) {
      const pos = await layoutGraph({ nodes: withFixed, edges, algorithm });
      expect(pos[nodes[2]!.id]).toEqual({ x: 500, y: 300 });
      expect(overlappingPairs(withFixed, pos)).toEqual([]);
      expect(allFinite(pos)).toBe(true);
    }
  });

  it('does not mutate frozen input', async () => {
    const { nodes, edges } = chain(5);
    const input = deepFreeze({ nodes: nodes.map((n, i) => (i === 1 ? { ...n, fixed: { x: 1, y: 2 } } : n)), edges, algorithm: 'stress' as const });
    await expect(layoutGraph(input)).resolves.toBeDefined();
  });

  it('a hub table with many FKs: parents share one layer, hub below them, no overlaps', async () => {
    const parents = ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, w: 220, h: 56 }));
    const nodes = [...parents, { id: 'hub', w: 400, h: 56 }];
    // edges run referenced -> referencing so parents rank first
    const edges = parents.map((p) => ({ id: `fk-${p.id}`, source: p.id, target: 'hub' }));
    const pos = await layoutGraph({ nodes, edges, algorithm: 'layered', direction: 'DOWN', spacing: 80 });
    const ys = new Set(parents.map((p) => pos[p.id]!.y));
    expect(ys.size).toBe(1);
    expect(pos.hub!.y).toBeGreaterThanOrEqual(pos.p1!.y + 56 + 80 - 1e-6);
    expect(overlappingPairs(nodes, pos, 60)).toEqual([]);
  });

  it('performance: 500 nodes finish in reasonable time', async () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `n${String(i).padStart(4, '0')}`, w: 100 + (i % 7) * 10, h: 40 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[Math.floor(i / 3)]!.id, target: n.id }));
    const report: string[] = [];
    // strict budget only in the PERF tier (a loaded machine easily doubles wall-clock); the default run still catches hangs
    const budget = process.env.PERF === '1' ? 15_000 : 45_000;
    for (const algorithm of ['layered', 'stress', 'rectpacking', 'force', 'radial'] as const) {
      const t0 = performance.now();
      const pos = await layoutGraph({ nodes, edges, algorithm });
      const ms = Math.round(performance.now() - t0);
      report.push(`${algorithm}=${ms}ms`);
      expect(allFinite(pos)).toBe(true);
      expect(Object.keys(pos).length).toBe(500);
      expect(ms).toBeLessThan(budget);
    }
    console.log(`[layout perf, 500 nodes/499 edges] ${report.join(' ')}`);
  }, 240_000);
});
