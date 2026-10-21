import { describe, expect, it } from 'vitest';
import { clampRowHeight, resizeColumn, resizeRect } from './resize';

const R = { x: 100, y: 100, w: 120, h: 60 };
const MIN = { w: 80, h: 40 };

describe('resizeRect', () => {
  it('east / south grow from the fixed top-left corner', () => {
    expect(resizeRect(R, 'e', { x: 30, y: 99 }, MIN)).toEqual({ x: 100, y: 100, w: 150, h: 60 });
    expect(resizeRect(R, 's', { x: 99, y: 10 }, MIN)).toEqual({ x: 100, y: 100, w: 120, h: 70 });
  });
  it('west / north keep the OPPOSITE edge fixed (origin moves)', () => {
    const r = resizeRect(R, 'nw', { x: -20, y: -10 }, MIN);
    expect(r).toEqual({ x: 80, y: 90, w: 140, h: 70 });
    expect(r.x + r.w).toBe(R.x + R.w);
    expect(r.y + r.h).toBe(R.y + R.h);
  });
  it('clamps at the text-fit minimum without moving the fixed edge', () => {
    const r = resizeRect(R, 'w', { x: 500, y: 0 }, MIN);
    expect(r.w).toBe(80);
    expect(r.x + r.w).toBe(220);
    const s = resizeRect(R, 'se', { x: -500, y: -500 }, MIN);
    expect(s).toMatchObject({ x: 100, y: 100, w: 80, h: 40 });
  });
  it('Shift keeps the aspect ratio on corners (never below the minimum)', () => {
    const r = resizeRect(R, 'se', { x: 60, y: 0 }, MIN, { keepAspect: true });
    expect(r.w / r.h).toBeCloseTo(R.w / R.h, 5);
    expect(r.w).toBeCloseTo(180, 5);
    const tiny = resizeRect(R, 'se', { x: -500, y: -500 }, MIN, { keepAspect: true });
    expect(tiny.w).toBeGreaterThanOrEqual(80);
    expect(tiny.h).toBeGreaterThanOrEqual(40);
  });
  it('snaps the moving edges to the grid', () => {
    const r = resizeRect(R, 'e', { x: 13, y: 0 }, MIN, { grid: 20 });
    expect(r.x + r.w).toBe(240);
  });
  it('is idempotent: always derived from the start rect', () => {
    const a = resizeRect(R, 'ne', { x: 10, y: -10 }, MIN);
    expect(resizeRect(R, 'ne', { x: 10, y: -10 }, MIN)).toEqual(a);
  });
});

describe('column / row maths', () => {
  it('resizeColumn: right border grows, left border shrinks on +dx, clamped at the text fit', () => {
    expect(resizeColumn(60, 'right', 20, 40)).toBe(80);
    expect(resizeColumn(60, 'left', 20, 40)).toBe(40);
    expect(resizeColumn(60, 'right', -100, 40)).toBe(40);
  });
  it('clampRowHeight', () => {
    expect(clampRowHeight(10, 24)).toBe(24);
    expect(clampRowHeight(31, 24, 10)).toBe(30);
  });
});
