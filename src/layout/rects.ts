/** Small pure rectangle/segment predicates shared by alignment, placement and the Chen layout. */
import type { Point, Rect } from '@/scene/base';
import type { LayoutRect, Positions } from './types';

export const toRect = (r: LayoutRect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** Rect of a node of `size` whose CENTRE is `c`. */
export const rectAtCenter = (c: Point, w: number, h: number): Rect => ({ x: c.x - w / 2, y: c.y - h / 2, w, h });

/** Strict overlap with a required clearance: true when the rects are closer than `gap` (touching at gap 0 is fine). */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Liang–Barsky: does the closed segment a→b touch the (closed) rect? */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y)
  );
}

export function boundsOf(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Bounding box of a layout result. Sizes missing for an id are treated as 0×0. Pure helper for fit/origin maths. */
export function layoutBounds(
  positions: Readonly<Positions>,
  sizes: Readonly<Record<string, { w: number; h: number }>>,
): Rect | undefined {
  const rects: Rect[] = [];
  for (const id of Object.keys(positions).sort()) {
    const p = positions[id]!;
    const s = sizes[id] ?? { w: 0, h: 0 };
    rects.push({ x: p.x, y: p.y, w: s.w, h: s.h });
  }
  return boundsOf(rects);
}

/** True when any two of the rects are closer than `gap`. O(n²); fixtures and post-checks only. */
export function anyOverlap(rects: ReadonlyArray<LayoutRect>, gap = 0): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const sorted = [...rects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (rectsOverlap(toRect(sorted[i]!), toRect(sorted[j]!), gap)) out.push([sorted[i]!.id, sorted[j]!.id]);
    }
  }
  return out;
}

export const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Do the closed segments a-b and c-d intersect (touching counts)? */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSeg = (p: Point, q: Point, r: Point): boolean =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}
