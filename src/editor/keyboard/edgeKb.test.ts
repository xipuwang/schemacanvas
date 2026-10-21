import { describe, expect, it } from 'vitest';
import type { Handle } from '../tools/handles';
import { cycleFocus, describeFocus, edgeFocusTargets, findFreeSpot, nearestInDirection, nudgeDelta, segmentForInsert } from './edgeKb';

const R = { x: 0, y: 0, w: 10, h: 10 };
const end = (end: 'source' | 'target', branch?: string): Handle => ({ id: `end:e:${end}${branch ? `:${branch}` : ''}`, kind: 'end', edgeId: 'e', end, at: { x: 0, y: 0 }, anchorRect: R, nodeId: 'n', side: 'bottom', ...(branch ? { branchSourceColumnId: branch } : {}) });
const bend = (index: number): Handle => ({ id: `bend:e:${index}`, kind: 'bend', edgeId: 'e', index, at: { x: index, y: 0 } });
const mid = (segment: number): Handle => ({ id: `mid:e:${segment}`, kind: 'mid', edgeId: 'e', segment, at: { x: segment, y: 0 } });

describe('connector keyboard focus ring', () => {
  const handles = [mid(1), end('target'), bend(1), mid(0), end('source'), bend(0)];
  const targets = edgeFocusTargets(handles, ['main']);
  it('orders source end, bends, segments, target end, labels', () => {
    expect(targets.map((t) => t.id)).toEqual(['end:e:source', 'bend:e:0', 'bend:e:1', 'mid:e:0', 'mid:e:1', 'end:e:target', 'label:main']);
  });
  it('composite foreign keys: every branch end is reachable', () => {
    const t = edgeFocusTargets([end('source', 'c1'), end('source', 'c2'), end('target', 'c1'), end('target', 'c2')], []);
    expect(t.map((x) => x.id)).toEqual(['end:e:source:c1', 'end:e:source:c2', 'end:e:target:c1', 'end:e:target:c2']);
  });
  it('[ and ] wrap around; with nothing focused ] starts at the first and [ at the last', () => {
    expect(cycleFocus(targets, null, 1)!.id).toBe('end:e:source');
    expect(cycleFocus(targets, null, -1)!.id).toBe('label:main');
    expect(cycleFocus(targets, 'label:main', 1)!.id).toBe('end:e:source');
    expect(cycleFocus(targets, 'end:e:source', -1)!.id).toBe('label:main');
    expect(cycleFocus(targets, 'bend:e:0', 1)!.id).toBe('bend:e:1');
    expect(cycleFocus([], null, 1)).toBeUndefined();
  });
  it('arrow keys nudge by the grid size, Shift x10, other keys are ignored', () => {
    expect(nudgeDelta('ArrowRight', false, 20)).toEqual({ x: 20, y: 0 });
    expect(nudgeDelta('ArrowUp', true, 20)).toEqual({ x: 0, y: -200 });
    expect(nudgeDelta('ArrowLeft', false, 0)).toEqual({ x: -10, y: 0 });
    expect(nudgeDelta('a', false, 20)).toBeUndefined();
  });
  it('describes the focused target for the announcement', () => {
    expect(describeFocus(targets, targets[2]!)).toMatchObject({ kind: 'bend', n: 2, total: 2 });
    expect(describeFocus(targets, targets[0]!)).toMatchObject({ kind: 'source' });
    expect(describeFocus(targets, targets[6]!)).toMatchObject({ kind: 'label', label: 'main' });
  });
  it('insert goes on the focused segment, else the longest one', () => {
    const mids = [mid(0), mid(1), mid(2)] as Array<Extract<Handle, { kind: 'mid' }>>;
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 80 }, { x: 30, y: 80 }];
    expect(segmentForInsert(path, mids, undefined)!.segment).toBe(1);
    expect(segmentForInsert(path, mids, targets[3])!.segment).toBe(0);
  });
});

describe('keyboard navigation helpers', () => {
  const rects = [
    { id: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'right', rect: { x: 100, y: 0, w: 10, h: 10 } },
    { id: 'rightFar', rect: { x: 300, y: 0, w: 10, h: 10 } },
    { id: 'diag', rect: { x: 60, y: 90, w: 10, h: 10 } },
    { id: 'below', rect: { x: 0, y: 120, w: 10, h: 10 } },
  ];
  it('nearest node in a direction prefers straight ahead over a closer node off to the side', () => {
    expect(nearestInDirection(rects, 'a', 'ArrowRight')).toBe('right');
    expect(nearestInDirection(rects, 'a', 'ArrowDown')).toBe('below');
    expect(nearestInDirection(rects, 'a', 'ArrowLeft')).toBeUndefined();
    expect(nearestInDirection(rects, 'a', 'ArrowUp')).toBeUndefined();
    expect(nearestInDirection(rects, 'missing', 'ArrowUp')).toBeUndefined();
  });
  it('free spot: the point itself when free, otherwise a nearby free position', () => {
    const size = { w: 100, h: 60 };
    expect(findFreeSpot([], size, { x: 500, y: 300 })).toEqual({ x: 500, y: 300 });
    const taken = [{ x: 450, y: 270, w: 100, h: 60 }];
    const p = findFreeSpot(taken, size, { x: 500, y: 300 });
    expect(p).not.toEqual({ x: 500, y: 300 });
    expect(Math.hypot(p.x - 500, p.y - 300)).toBeLessThan(250);
  });
});
