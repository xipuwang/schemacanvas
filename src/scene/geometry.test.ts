import { describe, expect, it } from 'vitest';
import type { Outline } from './base';
import { boundaryPoint, distanceToPolyline, nearestSide, pointAlongPolyline, pointInOutline, sidePoint, unionRects } from './geometry';
import { measureTextMetric } from './measure';

const R = { x: 0, y: 0, w: 100, h: 60 };

describe('boundaryPoint', () => {
  it('rect: hits the right edge for a point straight right', () => {
    expect(boundaryPoint({ kind: 'rect', rect: R }, { x: 500, y: 30 })).toEqual({ x: 100, y: 30 });
  });
  it('ellipse: hits the extreme point on the major axis', () => {
    const p = boundaryPoint({ kind: 'ellipse', rect: R }, { x: 500, y: 30 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(30);
  });
  it('diamond: hits a vertex when aimed along an axis and an edge midpoint at 45° of a square', () => {
    const sq: Outline = { kind: 'diamond', rect: { x: 0, y: 0, w: 100, h: 100 } };
    expect(boundaryPoint(sq, { x: 50, y: -400 })).toEqual({ x: 50, y: 0 });
    const d = boundaryPoint(sq, { x: 1000, y: 1000 });
    expect(d.x).toBeCloseTo(75);
    expect(d.y).toBeCloseTo(75);
  });
  it('points returned lie ON the outline (re-entering test)', () => {
    for (const kind of ['rect', 'ellipse', 'diamond'] as const) {
      const o: Outline = { kind, rect: R };
      for (const t of [{ x: 300, y: 200 }, { x: -50, y: 10 }, { x: 40, y: -90 }]) {
        const b = boundaryPoint(o, t);
        // slightly inside is inside, slightly outside is outside
        const c = { x: 50, y: 30 };
        const inside = { x: c.x + (b.x - c.x) * 0.99, y: c.y + (b.y - c.y) * 0.99 };
        const outside = { x: c.x + (b.x - c.x) * 1.01, y: c.y + (b.y - c.y) * 1.01 };
        expect(pointInOutline(o, inside)).toBe(true);
        expect(pointInOutline(o, outside)).toBe(false);
      }
    }
  });
});

describe('misc geometry', () => {
  it('sidePoint / nearestSide', () => {
    expect(sidePoint(R, 'bottom', 0.25)).toEqual({ x: 25, y: 60 });
    expect(nearestSide(R, { x: 50, y: 500 })).toBe('bottom');
    expect(nearestSide(R, { x: -500, y: 30 })).toBe('left');
  });
  it('unionRects', () => {
    expect(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(unionRects([])).toBeUndefined();
  });
  it('polyline helpers', () => {
    const pl = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distanceToPolyline({ x: 5, y: 3 }, pl)).toBe(3);
    expect(pointAlongPolyline(pl, 0.5)).toEqual({ x: 10, y: 0 });
  });
});

describe('measureTextMetric (Helvetica AFM)', () => {
  const f = { family: 'Helvetica, Arial', size: 10 };
  it('matches known AFM widths', () => {
    expect(measureTextMetric('H', f)).toBeCloseTo(7.22);
    expect(measureTextMetric('iii', f)).toBeCloseTo(6.66);
    expect(measureTextMetric('0123456789', f)).toBeCloseTo(55.6);
  });
  it('bold is wider; CJK is full width; monospace is 0.6em', () => {
    expect(measureTextMetric('Student', { ...f, weight: 'bold' })).toBeGreaterThan(measureTextMetric('Student', f));
    expect(measureTextMetric('学生', f)).toBeCloseTo(20);
    expect(measureTextMetric('abcd', { family: 'Courier New', size: 10 })).toBeCloseTo(24);
  });
});
