import { describe, expect, it } from 'vitest';
import type { Rect } from '@/scene/base';
import { addAttributeTo } from './tools/attributes';
import { makeStore, nodeNamed, sceneOf } from './testFixtures';

const hits = (r: Rect, a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / n;
    const y = a.y + ((b.y - a.y) * k) / n;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
};

describe('UX-2: auto-placed attributes keep clear of connectors', () => {
  it('never paints a new attribute over a connector that is not its own (Pharmacy)', () => {
    const s = makeStore('chen');
    const names = ['Company', 'Drug', 'Doctor', 'Patient', 'Pharmacy'];
    for (const name of names) {
      const owner = nodeNamed(s.store.getState().project, s.diagramId, name);
      for (let i = 0; i < 2; i++) {
        const res = addAttributeTo(s.store, s.diagramId, owner, 'simple');
        expect(res.ok).toBe(true);
        if (!res.ok) continue;
        const scene = sceneOf(s.store.getState().project, s.diagramId);
        const box = scene.nodes[res.nodeId]!.bounds;
        for (const eid of scene.edgeOrder) {
          const e = scene.edges[eid]!;
          if (e.sourceNodeId === res.nodeId || e.targetNodeId === res.nodeId) continue;
          for (const path of e.paths) for (let k = 0; k + 1 < path.length; k++) expect(hits(box, path[k]!, path[k + 1]!), `${name} #${i} over edge ${eid}`).toBe(false);
        }
      }
    }
  });
});
