/** Small collision helpers for Chen label / loop placement: a uniform grid index plus exact segment and outline tests. */
import type { Outline, Point, Rect } from '../base';
import { pointInOutline, rectsIntersect } from '../geometry';

export class Grid<T> {
  private readonly cells = new Map<string, T[]>();
  constructor(private readonly cell = 64) {}

  private range(r: Rect): [number, number, number, number] {
    const c = this.cell;
    return [Math.floor(r.x / c), Math.floor((r.x + r.w) / c), Math.floor(r.y / c), Math.floor((r.y + r.h) / c)];
  }

  add(item: T, r: Rect): void {
    const [x0, x1, y0, y1] = this.range(r);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** Calls `fn` for every item sharing a cell with `r` (an item may be seen more than once). Stops when `fn` returns true. */
  query(r: Rect, fn: (item: T) => boolean | void): boolean {
    const [x0, x1, y0, y1] = this.range(r);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(`${x},${y}`);
        if (!list) continue;
        for (const it of list) if (fn(it) === true) return true;
      }
    }
    return false;
  }
}

/** Liang-Barsky: does the segment a-b touch the closed rect r? */
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
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y);
}

/** Does the rect overlap the (filled) outline? Exact for rect, sampled (1.5 unit) for ellipse and diamond. */
export function rectHitsOutline(o: Outline, r: Rect): boolean {
  if (!rectsIntersect(o.rect, r)) return false;
  if (o.kind === 'rect') return true;
  const c = { x: o.rect.x + o.rect.w / 2, y: o.rect.y + o.rect.h / 2 };
  if (c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h) return true;
  const nx = Math.max(2, Math.ceil(r.w / 1.5));
  const ny = Math.max(2, Math.ceil(r.h / 1.5));
  for (let i = 0; i <= nx; i++) {
    for (const y of [r.y, r.y + r.h]) if (pointInOutline(o, { x: r.x + (r.w * i) / nx, y })) return true;
  }
  for (let j = 0; j <= ny; j++) {
    for (const x of [r.x, r.x + r.w]) if (pointInOutline(o, { x, y: r.y + (r.h * j) / ny })) return true;
  }
  // The outline's extreme points can poke into a rect without any rect boundary point being inside.
  const ex = [{ x: c.x, y: o.rect.y }, { x: c.x, y: o.rect.y + o.rect.h }, { x: o.rect.x, y: c.y }, { x: o.rect.x + o.rect.w, y: c.y }];
  return ex.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

/** Axis-aligned segments that are parallel, within `tol` of each other and overlap along their length by more than 2. */
export function collinearOverlap(a: Point, b: Point, c: Point, d: Point, tol = 3): boolean {
  const aV = Math.abs(a.x - b.x) < 1e-9;
  const aH = Math.abs(a.y - b.y) < 1e-9;
  const cV = Math.abs(c.x - d.x) < 1e-9;
  const cH = Math.abs(c.y - d.y) < 1e-9;
  if (aV && cV) {
    if (Math.abs(a.x - c.x) > tol) return false;
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 2;
  }
  if (aH && cH) {
    if (Math.abs(a.y - c.y) > tol) return false;
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 2;
  }
  return false;
}
