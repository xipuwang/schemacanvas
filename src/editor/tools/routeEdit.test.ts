import { describe, expect, it } from 'vitest';
import { allowedSides, anchorFromPointer, anchorPatch, insertionIndex, locateWaypoints, straightenWaypoints, withInserted, withMoved, withRemoved } from './routeEdit';

const P = (x: number, y: number) => ({ x, y });

describe('waypoint helpers', () => {
  const path = [P(0, 0), P(0, 10), P(50, 10), P(50, 80), P(90, 80), P(90, 100)];
  it('locates waypoints on path vertices in order', () => {
    expect(locateWaypoints(path, [P(50, 10), P(50, 80)])).toEqual([2, 3]);
  });
  it('computes the insertion index for a segment (stub corners are not waypoints)', () => {
    const wps = [P(50, 10), P(50, 80)];
    expect(insertionIndex(path, wps, 0)).toBe(0); // s0 -> stub end
    expect(insertionIndex(path, wps, 1)).toBe(0); // stub end -> first corner
    expect(insertionIndex(path, wps, 2)).toBe(1); // between the two corners
    expect(insertionIndex(path, wps, 3)).toBe(2); // after the last corner
    expect(insertionIndex(path, [], 2)).toBe(0);
  });
  it('insert / move / remove return new lists and never mutate', () => {
    const base = Object.freeze([P(1, 1), P(2, 2)]);
    expect(withInserted(base, 1, P(9, 9))).toEqual([P(1, 1), P(9, 9), P(2, 2)]);
    expect(withMoved(base, 0, P(5, 5))).toEqual([P(5, 5), P(2, 2)]);
    expect(withRemoved(base, 1)).toEqual([P(1, 1)]);
    expect(base).toEqual([P(1, 1), P(2, 2)]);
  });
  it('straightens near-aligned corners and drops redundant ones', () => {
    expect(straightenWaypoints([P(100, 50), P(104, 200), P(300, 203)])).toEqual([P(100, 50), P(100, 200), P(300, 200)]);
    expect(straightenWaypoints([P(0, 0), P(0, 50), P(0, 100)])).toEqual([P(0, 0), P(0, 100)]);
    expect(straightenWaypoints([P(10, 10), P(10, 10)])).toEqual([P(10, 10)]);
    expect(straightenWaypoints([])).toEqual([]);
  });
});

describe('anchors', () => {
  const cell = { x: 100, y: 50, w: 80, h: 30 };
  it('picks the nearest ALLOWED side and clamps the offset inside the cell', () => {
    expect(anchorFromPointer(cell, ['top', 'bottom'], P(140, 200))).toEqual({ side: 'bottom', offset: 0.5 });
    expect(anchorFromPointer(cell, ['top', 'bottom'], P(300, 0)).offset).toBeCloseTo(1 - 6 / 80, 3);
    expect(anchorFromPointer(cell, ['top', 'bottom'], P(-50, 0)).offset).toBeCloseTo(6 / 80, 3);
    // the left side is not allowed for an inner cell: a pointer left of the cell still yields top / bottom
    const r = anchorFromPointer(cell, ['top', 'bottom'], P(20, 65));
    expect(['top', 'bottom']).toContain(r.side);
  });
  it('first / last cells may use the row ends; vertical tables only left / right', () => {
    const h = { kind: 'h-table', cells: [{ columnId: 'a' }, { columnId: 'b' }, { columnId: 'c' }] } as never;
    expect(allowedSides(h, 'a').sort()).toEqual(['bottom', 'left', 'top']);
    expect(allowedSides(h, 'b').sort()).toEqual(['bottom', 'top']);
    expect(allowedSides(h, 'c').sort()).toEqual(['bottom', 'right', 'top']);
    const v = { kind: 'v-table', orientation: 'vertical', rows: [{ columnId: 'a' }] } as never;
    expect(allowedSides(v, 'a').sort()).toEqual(['left', 'right']);
    expect(allowedSides({ kind: 'chen-entity' } as never, undefined)).toHaveLength(4);
  });
  it('anchorPatch writes branch anchors keyed by the SOURCE column and merges with existing ones', () => {
    const route = { mode: 'auto' as const, waypoints: [], branchAnchors: { s1: { target: { side: 'top' as const, offset: 0.2 } } } };
    const h = { id: 'x', kind: 'end' as const, edgeId: 'e', end: 'source' as const, branchSourceColumnId: 's1', at: P(0, 0), anchorRect: cell, nodeId: 'n', side: 'top' as const };
    expect(anchorPatch(route, h, { side: 'bottom', offset: 0.7 })).toEqual({ branchAnchors: { s1: { target: { side: 'top', offset: 0.2 }, source: { side: 'bottom', offset: 0.7 } } } });
    const { branchSourceColumnId: _b, ...single } = h;
    void _b;
    expect(anchorPatch(route, { ...single, end: 'target' }, { side: 'top', offset: 0.3 })).toEqual({ targetAnchor: { side: 'top', offset: 0.3 } });
  });
});
