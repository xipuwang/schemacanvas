import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import { alignNodes, distributeNodes, matchSize, nudgeOutOfOverlap, placeNear, snapPoint, snapRect, stackBelow } from './align';
import { anyOverlap, layoutBounds } from './rects';
import type { LayoutRect } from './types';

const items = (): LayoutRect[] =>
  deepFreeze([
    { id: 'a', x: 10, y: 10, w: 40, h: 20 },
    { id: 'b', x: 100, y: 50, w: 60, h: 40 },
    { id: 'c', x: 40, y: 200, w: 20, h: 10 },
  ]);

describe('alignNodes', () => {
  it('left/right/center align to the selection box', () => {
    expect(alignNodes(items(), 'left')).toEqual({ b: { x: 10, y: 50 }, c: { x: 10, y: 200 } });
    expect(alignNodes(items(), 'right')).toEqual({ a: { x: 120, y: 10 }, c: { x: 140, y: 200 } });
    const c = alignNodes(items(), 'center'); // box 10..160 -> centre 85
    expect(c.a).toEqual({ x: 65, y: 10 });
    expect(c.b).toEqual({ x: 55, y: 50 });
    expect(c.c).toEqual({ x: 75, y: 200 });
  });
  it('top/bottom/middle', () => {
    expect(alignNodes(items(), 'top')).toEqual({ b: { x: 100, y: 10 }, c: { x: 40, y: 10 } });
    const bot = alignNodes(items(), 'bottom'); // bottom = 210
    expect(bot).toEqual({ a: { x: 10, y: 190 }, b: { x: 100, y: 170 } });
    const mid = alignNodes(items(), 'middle'); // centre y = 110
    expect(mid.a).toEqual({ x: 10, y: 100 });
    expect(mid.c).toEqual({ x: 40, y: 105 });
  });
  it('is a no-op (empty result) for < 2 items or already aligned', () => {
    expect(alignNodes([items()[0]!], 'left')).toEqual({});
    expect(alignNodes([{ id: 'a', x: 0, y: 0, w: 5, h: 5 }, { id: 'b', x: 0, y: 9, w: 5, h: 5 }], 'left')).toEqual({});
  });
});

describe('distributeNodes', () => {
  const row = (): LayoutRect[] =>
    deepFreeze([
      { id: 'c', x: 300, y: 0, w: 50, h: 10 },
      { id: 'a', x: 0, y: 0, w: 50, h: 10 },
      { id: 'b', x: 70, y: 0, w: 100, h: 10 },
    ]);
  it('even: keeps ends, equal gaps (input order irrelevant)', () => {
    // span 0..350, sizes 200 -> gap 75
    expect(distributeNodes(row(), 'horizontal')).toEqual({ b: { x: 125, y: 0 } });
    const col = row().map((r) => ({ id: r.id, x: 0, y: r.x, w: r.h, h: r.w }));
    expect(distributeNodes(col, 'vertical')).toEqual({ b: { x: 0, y: 125 } });
  });
  it('numeric gap starts at the first item', () => {
    expect(distributeNodes(row(), 'horizontal', 20)).toEqual({ c: { x: 190, y: 0 } });
  });
  it('even needs 3 items', () => {
    expect(distributeNodes(row().slice(0, 2), 'horizontal')).toEqual({});
  });
});

describe('matchSize', () => {
  it('largest / smallest / first, per dimension, changed only', () => {
    expect(matchSize(items(), 'width')).toEqual({ a: { w: 60, h: 20 }, c: { w: 60, h: 10 } });
    expect(matchSize(items(), 'height', 'smallest')).toEqual({ a: { w: 40, h: 10 }, b: { w: 60, h: 10 } });
    expect(matchSize(items(), 'both', 'first').b).toEqual({ w: 40, h: 20 });
  });
});

describe('snapping', () => {
  it('snaps to grid', () => {
    expect(snapPoint({ x: 14, y: 26 }, { grid: 10 })).toEqual({ x: 10, y: 30, guides: [] });
    expect(snapRect({ x: 14, y: 26, w: 5, h: 5 }, {})).toMatchObject({ x: 14, y: 26 });
  });
  it('smart guides win within the threshold (edges and centres), grid otherwise', () => {
    const other = { x: 200, y: 100, w: 100, h: 50 };
    // moving rect's left edge 3 away from other's left edge; centre-y 2 away from other's centre-y (125)
    const r = snapRect({ x: 197, y: 98, w: 40, h: 54 }, { grid: 10, targets: [other], threshold: 6 });
    expect(r.x).toBe(200);
    expect(r.y).toBe(98); // centre 125 -> 98+27=125 already aligned: delta 0
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
    const far = snapRect({ x: 217, y: 400, w: 40, h: 20 }, { grid: 10, targets: [other], threshold: 6 });
    expect(far.guides).toEqual([]);
    expect(far.x % 10).toBe(0);
    // right edge to right edge
    const re = snapRect({ x: 262, y: 0, w: 40, h: 10 }, { targets: [other], threshold: 6 });
    expect(re.x).toBe(260);
    expect(re.guides[0]).toMatchObject({ axis: 'x', at: 300 });
  });
});

describe('nudgeOutOfOverlap / placement', () => {
  it('separates overlapping rects with the requested gap, keeps fixed ones', () => {
    const rs: LayoutRect[] = deepFreeze([
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 60, y: 10, w: 100, h: 50 },
      { id: 'c', x: 70, y: 20, w: 100, h: 50 },
    ]);
    const moved = nudgeOutOfOverlap(rs, { gap: 10, fixedIds: new Set(['a']) });
    expect(moved.a).toBeUndefined();
    const after = rs.map((r) => ({ ...r, ...(moved[r.id] ?? {}) }));
    expect(anyOverlap(after, 10 - 1e-6)).toEqual([]);
  });
  it('minimal displacement: a lone pair moves only along the least-penetration axis', () => {
    const moved = nudgeOutOfOverlap([{ id: 'a', x: 0, y: 0, w: 100, h: 100 }, { id: 'b', x: 90, y: 0, w: 100, h: 100 }]);
    expect(moved.a!.y).toBe(0);
    expect(moved.b!.y).toBe(0);
    expect(moved.b!.x - moved.a!.x).toBeCloseTo(100);
  });
  it('coincident rects are still separated deterministically', () => {
    const rs = [{ id: 'a', x: 5, y: 5, w: 30, h: 30 }, { id: 'b', x: 5, y: 5, w: 30, h: 30 }];
    const m = nudgeOutOfOverlap(rs);
    expect(nudgeOutOfOverlap(rs)).toEqual(m);
    expect(anyOverlap(rs.map((r) => ({ ...r, ...(m[r.id] ?? {}) })), -1e-6)).toEqual([]);
  });
  it('stackBelow slides past obstacles', () => {
    const anchor = { x: 10, y: 10, w: 100, h: 40 };
    const obstacle = { x: 0, y: 60, w: 300, h: 100 };
    const p = stackBelow({ w: 50, h: 20 }, anchor, [obstacle], 20);
    expect(p).toEqual({ x: 10, y: 180 });
  });
  it('placeNear returns a free spot close to the anchor, honouring the preferred direction', () => {
    const anchor = { x: 100, y: 100, w: 100, h: 50 };
    const size = { w: 80, h: 40 };
    const p = placeNear(size, anchor, [anchor], { gap: 20, preferAngle: Math.PI / 2 });
    expect(anyOverlap([{ id: 'n', ...p, ...size }, { id: 'a', ...anchor }], 20 - 1e-6)).toEqual([]);
    expect(p.y).toBeGreaterThan(anchor.y + anchor.h); // below
  });
  it('layoutBounds unions positions with sizes', () => {
    expect(layoutBounds({ a: { x: 0, y: 0 }, b: { x: 50, y: 20 } }, { a: { w: 10, h: 10 }, b: { w: 30, h: 40 } })).toEqual({ x: 0, y: 0, w: 80, h: 60 });
    expect(layoutBounds({}, {})).toBeUndefined();
  });
});
