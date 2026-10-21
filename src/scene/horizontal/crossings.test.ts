import { afterEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import type { Point } from '../base';
import { defaultMeasure } from '../measure';
import { buildHorizontalScene } from './index';
import { pharmacyFixture, tangledFixture, type Fixture } from './fixtures';
import type { FkEdgeGeom } from './types';

let restore = () => {};
afterEach(() => restore());

type Seg = { a: Point; b: Point; owner: string };

function segmentsOf(f: Fixture): Seg[] {
  const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
  const out: Seg[] = [];
  for (const [id, g] of Object.entries(scene.edges)) {
    (g as FkEdgeGeom).branches.forEach((br, i) => {
      for (let k = 0; k + 1 < br.points.length; k++) out.push({ a: br.points[k]!, b: br.points[k + 1]!, owner: `${id}:${i}` });
    });
  }
  return out;
}

/** Proper crossings between axis-aligned segments of DIFFERENT branches (touching ends / collinear overlaps are not counted). */
function countCrossings(f: Fixture): number {
  const segs = segmentsOf(f);
  const eps = 0.5;
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.owner === t.owner) continue;
      const sH = Math.abs(s.a.y - s.b.y) < 1e-6;
      const tH = Math.abs(t.a.y - t.b.y) < 1e-6;
      if (sH === tH) continue;
      const h = sH ? s : t;
      const v = sH ? t : s;
      const x = v.a.x;
      const y = h.a.y;
      if (x > Math.min(h.a.x, h.b.x) + eps && x < Math.max(h.a.x, h.b.x) - eps && y > Math.min(v.a.y, v.b.y) + eps && y < Math.max(v.a.y, v.b.y) - eps) n++;
    }
  }
  return n;
}

describe('connector crossings (lane ordering regression)', () => {
  it('pharmacy fixture', () => {
    restore = useDeterministicIds();
    const n = countCrossings(pharmacyFixture());
    // before lane/crossing work: 5. Remaining crossings cannot be removed without wrapping around a table.
    expect(n).toBeLessThanOrEqual(5);
  });
  it('tangled fixture', () => {
    restore = useDeterministicIds();
    const n = countCrossings(tangledFixture());
    // before: 9
    expect(n).toBeLessThanOrEqual(2);
  });
});
