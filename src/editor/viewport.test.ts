import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, VIEW_ANIM_MS, clampZoom, easeOutCubic, fitRect, interpolateView, originCentered, screenToWorld, visibleWorldRect, worldToScreen, zoomAround } from './viewport';

describe('viewport math', () => {
  const v = { x: 100, y: 50, zoom: 2 };
  it('world <-> screen round-trips', () => {
    const w = { x: 12.5, y: -7 };
    expect(screenToWorld(v, worldToScreen(v, w))).toEqual(w);
  });
  it('zoomAround keeps the world point under the cursor fixed and clamps', () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(v, screen);
    const z = zoomAround(v, 3.3, screen);
    const after = screenToWorld(z, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAround(v, 100, screen).zoom).toBe(MAX_ZOOM);
    expect(zoomAround(v, 0.0001, screen).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
  it('fitRect centres the content, respects margin and maxZoom', () => {
    const f = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1100, h: 600 }, { margin: 50 });
    expect(f.zoom).toBeCloseTo(1, 9);
    const centre = worldToScreen(f, { x: 500, y: 250 });
    expect(centre.x).toBeCloseTo(550, 9);
    expect(centre.y).toBeCloseTo(300, 9);
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 600 }, { maxZoom: 1 }).zoom).toBe(1);
    expect(fitRect({ x: 0, y: 0, w: 100000, h: 100000 }, { w: 800, h: 600 }).zoom).toBe(MIN_ZOOM);
  });
  it('empty diagram: origin in the centre at 100%; visible rect', () => {
    expect(originCentered({ w: 800, h: 600 })).toEqual({ zoom: 1, x: 400, y: 300 });
    expect(visibleWorldRect({ x: 100, y: 0, zoom: 2 }, { w: 800, h: 400 })).toEqual({ x: -50, y: 0, w: 400, h: 200 });
  });
});

describe('animated zoom / fit maths', () => {
  const a = { x: 0, y: 0, zoom: 1 };
  const b = { x: 100, y: -40, zoom: 4 };
  it('ease-out cubic is monotonic, clamped, and decelerates', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.9)).toBeGreaterThan(easeOutCubic(0.5));
  });
  it('interpolates endpoints exactly and zoom geometrically', () => {
    expect(interpolateView(a, b, 0)).toEqual(a);
    expect(interpolateView(a, b, 1)).toEqual(b);
    const m = interpolateView(a, b, 0.5);
    expect(m.zoom).toBeCloseTo(2, 10);
    expect(m.x).toBeCloseTo(50, 10);
    expect(m.y).toBeCloseTo(-20, 10);
  });
  it('is 150 ms', () => expect(VIEW_ANIM_MS).toBe(150));
});
