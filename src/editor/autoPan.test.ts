import { describe, expect, it } from 'vitest';
import { AUTO_PAN_BAND, AUTO_PAN_MAX_SPEED, autoPanStep, autoPanVelocity, proximity } from './autoPan';

const size = { w: 800, h: 600 };

describe('auto-pan maths', () => {
  it('is zero in the middle and without a container size', () => {
    expect(autoPanVelocity({ x: 400, y: 300 }, size)).toEqual({ x: 0, y: 0 });
    expect(autoPanVelocity({ x: 1, y: 1 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
    expect(autoPanVelocity({ x: AUTO_PAN_BAND, y: 300 }, size).x).toBe(0);
  });
  it('ramps with proximity and points the content AWAY from the edge', () => {
    const near = autoPanVelocity({ x: 6, y: 300 }, size).x;
    const far = autoPanVelocity({ x: 36, y: 300 }, size).x;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(autoPanVelocity({ x: 794, y: 300 }, size).x).toBeLessThan(0);
    expect(autoPanVelocity({ x: 400, y: 4 }, size).y).toBeGreaterThan(0);
    expect(autoPanVelocity({ x: 400, y: 596 }, size).y).toBeLessThan(0);
  });
  it('saturates at the edge and beyond it (a captured pointer can leave the canvas)', () => {
    expect(autoPanVelocity({ x: 0, y: 300 }, size).x).toBe(AUTO_PAN_MAX_SPEED);
    expect(autoPanVelocity({ x: -500, y: 300 }, size).x).toBe(AUTO_PAN_MAX_SPEED);
    expect(autoPanVelocity({ x: 5000, y: 300 }, size).x).toBe(-AUTO_PAN_MAX_SPEED);
  });
  it('corners pan on both axes', () => {
    const v = autoPanVelocity({ x: 2, y: 598 }, size);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
  });
  it('reduced motion: no ramp, one constant speed in the band, still non-zero', () => {
    const a = autoPanVelocity({ x: 40, y: 300 }, size, { reducedMotion: true }).x;
    const b = autoPanVelocity({ x: 2, y: 300 }, size, { reducedMotion: true }).x;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(autoPanVelocity({ x: 400, y: 300 }, size, { reducedMotion: true })).toEqual({ x: 0, y: 0 });
  });
  it('the band never exceeds a third of a tiny container', () => {
    expect(autoPanVelocity({ x: 30, y: 15 }, { w: 90, h: 60 }).x).toBe(0);
  });
  it('proximity is 0..1 and monotonic', () => {
    expect(proximity(100, 48)).toBe(0);
    expect(proximity(0, 48)).toBe(1);
    expect(proximity(-10, 48)).toBe(1);
    expect(proximity(10, 48)).toBeGreaterThan(proximity(30, 48));
  });
  it('step scales with dt and caps a stalled frame', () => {
    const v = { x: 10, y: 20, zoom: 2 };
    expect(autoPanStep(v, { x: 100, y: -100 }, 10)).toEqual({ x: 11, y: 19, zoom: 2 });
    expect(autoPanStep(v, { x: 100, y: 0 }, 5000).x).toBe(15);
    expect(autoPanStep(v, { x: 100, y: 0 }, -3)).toEqual(v);
  });
});
