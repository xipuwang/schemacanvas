/**
 * Auto-pan while a drag (node move, marquee, connector / handle tool) runs near the edge of the canvas. Pure maths: the
 * canvas feeds the last pointer position (container-relative screen px) and the container size every animation frame.
 */
import type { Point, Viewport } from '@/model/types';

export interface AutoPanOptions {
  /** Width of the sensitive band along each edge, px. */
  band?: number;
  /** Speed at the very edge (and beyond it), px per second. */
  maxSpeed?: number;
  /** prefers-reduced-motion: no smooth ramp, a constant moderate speed anywhere in the band (it still works). */
  reducedMotion?: boolean;
}

export const AUTO_PAN_BAND = 48;
export const AUTO_PAN_MAX_SPEED = 900;

/** 0 outside the band, 1 at the edge or beyond it; quadratic ease so the first pixels of the band are gentle. */
export function proximity(distanceToEdge: number, band: number): number {
  if (!(band > 0) || distanceToEdge >= band) return 0;
  const t = 1 - Math.max(0, distanceToEdge) / band;
  return t * t;
}

/**
 * How fast the CONTENT scrolls, in screen px per second (x > 0 = the content moves right, i.e. the pointer is near the LEFT edge
 * and reveals more to the left). `{0,0}` when the pointer is in the middle or the container has no size yet.
 */
export function autoPanVelocity(pointer: Point, size: { w: number; h: number }, opts: AutoPanOptions = {}): Point {
  if (!(size.w > 0) || !(size.h > 0)) return { x: 0, y: 0 };
  const band = Math.min(opts.band ?? AUTO_PAN_BAND, size.w / 3, size.h / 3);
  const max = opts.maxSpeed ?? AUTO_PAN_MAX_SPEED;
  const axis = (pos: number, len: number): number => {
    const low = proximity(pos, band);
    const high = proximity(len - pos, band);
    const p = low > 0 ? low : high > 0 ? -high : 0;
    if (opts.reducedMotion) return p === 0 ? 0 : Math.sign(p) * 0.5 * max;
    return p * max;
  };
  return { x: axis(pointer.x, size.w), y: axis(pointer.y, size.h) };
}

/** One animation step: the viewport after `dtMs` of scrolling at `velocity` (dt is capped so a stalled frame cannot jump). */
export function autoPanStep(view: Viewport, velocity: Point, dtMs: number): Viewport {
  const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
  return { ...view, x: view.x + velocity.x * dt, y: view.y + velocity.y * dt };
}
