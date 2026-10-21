/**
 * Alignment, distribution, size matching, snapping and overlap helpers. PURE: inputs are never mutated and every
 * result is `nodeId -> {x,y}` (absolute top-left, the shape `ops.setNodePositions` consumes) containing ONLY the
 * nodes that actually move — an empty result means "no-op", so callers can skip creating an undo entry.
 * Rects use the same convention as `DiagramNode.x/y` (= `geom.bounds` top-left), see ARCHITECTURE rule 11.
 */
import type { Point, Rect } from '@/scene/base';
import { rectCenter } from '@/scene/geometry';
import { rectAtCenter, rectsOverlap, toRect } from './rects';
import type { LayoutRect, Positions, Size } from './types';

const EPS = 1e-9;

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';

const byId = (a: { id: string; sortKey?: string }, b: { id: string; sortKey?: string }): number => {
  const ka = a.sortKey ?? '';
  const kb = b.sortKey ?? '';
  return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function changedOnly(items: ReadonlyArray<LayoutRect>, next: Map<string, Point>, locked?: ReadonlySet<string>): Positions {
  const out: Positions = {};
  for (const it of items) {
    if (locked?.has(it.id)) continue;
    const p = next.get(it.id);
    if (p && (Math.abs(p.x - it.x) > EPS || Math.abs(p.y - it.y) > EPS)) out[it.id] = { x: p.x, y: p.y };
  }
  return out;
}

/** Align every item to the bounding box of the selection (diagrams.net / Figma behaviour). */
/** `lockedIds` (e.g. `DiagramNode.locked`) take part in the selection box but never move. */
export function alignNodes(items: ReadonlyArray<LayoutRect>, mode: AlignMode, lockedIds?: ReadonlySet<string>): Positions {
  if (items.length < 2) return {};
  const x0 = Math.min(...items.map((i) => i.x));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y0 = Math.min(...items.map((i) => i.y));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  const next = new Map<string, Point>();
  for (const it of items) {
    let { x, y } = it;
    if (mode === 'left') x = x0;
    else if (mode === 'right') x = x1 - it.w;
    else if (mode === 'center') x = (x0 + x1) / 2 - it.w / 2;
    else if (mode === 'top') y = y0;
    else if (mode === 'bottom') y = y1 - it.h;
    else y = (y0 + y1) / 2 - it.h / 2;
    next.set(it.id, { x, y });
  }
  return changedOnly(items, next, lockedIds);
}

/**
 * Distribute along an axis. Items are ordered by their current position (ties by id) so the result never depends on
 * input order. `'even'` keeps the first and last item in place and equalises the gaps between edges (needs >= 3);
 * a number lays items out with exactly that gap, starting at the first item.
 */
export function distributeNodes(
  items: ReadonlyArray<LayoutRect>,
  axis: Axis,
  gap: 'even' | number = 'even',
  lockedIds?: ReadonlySet<string>,
): Positions {
  const min = gap === 'even' ? 3 : 2;
  if (items.length < min) return {};
  const horiz = axis === 'horizontal';
  const pos = (r: LayoutRect): number => (horiz ? r.x : r.y);
  const size = (r: LayoutRect): number => (horiz ? r.w : r.h);
  const sorted = [...items].sort((a, b) => pos(a) - pos(b) || byId(a, b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  let g: number;
  if (gap === 'even') {
    const span = pos(last) + size(last) - pos(first);
    const total = sorted.reduce((s, r) => s + size(r), 0);
    g = (span - total) / (sorted.length - 1);
  } else g = gap;
  const next = new Map<string, Point>();
  let cursor = pos(first);
  for (const r of sorted) {
    next.set(r.id, horiz ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
    cursor += size(r) + g;
  }
  return changedOnly(items, next, lockedIds);
}

/**
 * Target SIZES for "make same width/height". Sizes are `geom.bounds` sizes; the caller maps them to
 * `DiagramNode.width/height` (their meaning differs per notation, e.g. h-table width excludes nothing but height = row).
 * Returns only items whose size changes.
 */
export function matchSize(
  items: ReadonlyArray<LayoutRect>,
  dimension: 'width' | 'height' | 'both',
  basis: 'largest' | 'smallest' | 'first' = 'largest',
): Record<string, Size> {
  if (items.length < 2) return {};
  const pick = (get: (r: LayoutRect) => number): number => {
    const vals = items.map(get);
    return basis === 'first' ? vals[0]! : basis === 'smallest' ? Math.min(...vals) : Math.max(...vals);
  };
  const w = pick((r) => r.w);
  const h = pick((r) => r.h);
  const out: Record<string, Size> = {};
  for (const it of items) {
    const s = { w: dimension === 'height' ? it.w : w, h: dimension === 'width' ? it.h : h };
    if (Math.abs(s.w - it.w) > EPS || Math.abs(s.h - it.h) > EPS) out[it.id] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------------------------------------------------

/** A smart-guide line to draw while dragging: vertical (`axis:'x'`, at x) or horizontal (`axis:'y'`, at y). */
export interface SnapGuide {
  axis: 'x' | 'y';
  at: number;
  /** Extent along the other axis covering the moving rect and the rect it aligned with. */
  from: number;
  to: number;
}

export interface SnapOptions {
  /** Grid size; <= 0 or undefined disables grid snapping. */
  grid?: number;
  /** Other nodes' rects to align edges/centres with. */
  targets?: ReadonlyArray<Rect>;
  /** Max distance (world units) at which a guide captures the rect. Default 6. */
  threshold?: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

function snapAxis(
  start: number,
  size: number,
  otherStart: number,
  otherSize: number,
  targets: ReadonlyArray<Rect>,
  horizontal: boolean,
  threshold: number,
  grid: number,
): { value: number; guide?: SnapGuide } {
  const mine = [0, size / 2, size];
  let best: { delta: number; at: number; t: Rect } | undefined;
  for (const t of targets) {
    const ts = horizontal ? t.x : t.y;
    const tz = horizontal ? t.w : t.h;
    for (const tp of [ts, ts + tz / 2, ts + tz]) {
      for (const m of mine) {
        const delta = tp - (start + m);
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta) - EPS)) best = { delta, at: tp, t };
      }
    }
  }
  if (best) {
    const os = horizontal ? best.t.y : best.t.x;
    const oz = horizontal ? best.t.h : best.t.w;
    return {
      value: start + best.delta,
      guide: { axis: horizontal ? 'x' : 'y', at: best.at, from: Math.min(os, otherStart), to: Math.max(os + oz, otherStart + otherSize) },
    };
  }
  return { value: grid > 0 ? Math.round(start / grid) * grid : start };
}

/** Snap a rect's top-left: smart guides win over the grid on each axis independently. */
export function snapRect(r: Rect, opts: SnapOptions = {}): SnapResult {
  const grid = opts.grid ?? 0;
  const threshold = opts.threshold ?? 6;
  const targets = opts.targets ?? [];
  const sx = snapAxis(r.x, r.w, r.y, r.h, targets, true, threshold, grid);
  const sy = snapAxis(r.y, r.h, sx.value, r.w, targets, false, threshold, grid);
  const guides: SnapGuide[] = [];
  if (sx.guide) guides.push(sx.guide);
  if (sy.guide) guides.push(sy.guide);
  return { x: sx.value, y: sy.value, guides };
}

/** Snap a point (e.g. a bend handle) to the grid and optionally to other rects' edges/centres. */
export function snapPoint(p: Point, opts: SnapOptions = {}): SnapResult {
  return snapRect({ x: p.x, y: p.y, w: 0, h: 0 }, opts);
}

// ---------------------------------------------------------------------------------------------------------------------
// Overlap resolution and placement
// ---------------------------------------------------------------------------------------------------------------------

export interface NudgeOptions {
  /** Required clearance between rects. Default 0. */
  gap?: number;
  /** Rects that must not move. */
  fixedIds?: ReadonlySet<string>;
  maxPasses?: number;
}

/**
 * Overlap removal with a convergence guarantee. Phase 1 is the minimal-displacement pairwise push: every overlapping pair
 * is separated along the axis of least penetration, each rect taking half the push (all of it when the other is fixed).
 * Phase 2 (only when phase 1 stopped at `maxPasses`/oscillated in a dense cluster) is a greedy legaliser: rects that are
 * clean (plus all fixed rects) are settled, then every remaining rect, in position order, takes the nearest free spot
 * (`placeNear`) among the settled ones. Result: no two rects are closer than `gap` unless BOTH are fixed.
 * Deterministic (pairs visited by id order, ties by id).
 */
export function nudgeOutOfOverlap(rects: ReadonlyArray<LayoutRect>, opts: NudgeOptions = {}): Positions {
  const gap = opts.gap ?? 0;
  const fixed = opts.fixedIds ?? new Set<string>();
  const w = [...rects].sort(byId).map((r) => ({ ...r }));
  // Bound the O(n^2)-per-pass push by a work budget; whatever it leaves is handled by `legalise`.
  const budgetPasses = Math.max(4, Math.floor(3_000_000 / Math.max(1, (w.length * (w.length - 1)) / 2)));
  const maxPasses = Math.min(opts.maxPasses ?? 200, budgetPasses);
  const tol = gap - 1e-6;
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 1; j < w.length; j++) {
        const a = w[i]!;
        const b = w[j]!;
        if (!(a.x < b.x + b.w + tol && a.x + a.w + tol > b.x && a.y < b.y + b.h + tol && a.y + a.h + tol > b.y)) continue;
        if (fixed.has(a.id) && fixed.has(b.id)) continue;
        const penX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
        const penY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        const horiz = penX <= penY;
        const ca = rectCenter(toRect(a));
        const cb = rectCenter(toRect(b));
        const d = horiz ? cb.x - ca.x : cb.y - ca.y;
        const sign = d >= 0 ? 1 : -1; // b goes in +sign, a in -sign (id order breaks exact ties)
        const pen = horiz ? penX : penY;
        const fa = fixed.has(a.id);
        const fb = fixed.has(b.id);
        const ma = fa ? 0 : fb ? pen : pen / 2;
        const mb = fb ? 0 : fa ? pen : pen / 2;
        if (horiz) {
          a.x -= sign * ma;
          b.x += sign * mb;
        } else {
          a.y -= sign * ma;
          b.y += sign * mb;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  legalise(w, fixed, gap);
  return changedOnly(rects, new Map(w.map((r) => [r.id, { x: r.x, y: r.y }])));
}

/** Uniform-grid index of rects for fast "does this rect come closer than `gap` to any of them" queries. */
class RectGrid {
  private readonly cells = new Map<number, Rect[]>();
  constructor(private readonly cell: number) {}
  private key(cx: number, cy: number): number {
    return cx * 100003 + cy;
  }
  insert(r: Rect): void {
    for (let cx = Math.floor(r.x / this.cell); cx <= Math.floor((r.x + r.w) / this.cell); cx++)
      for (let cy = Math.floor(r.y / this.cell); cy <= Math.floor((r.y + r.h) / this.cell); cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(r);
        else this.cells.set(k, [r]);
      }
  }
  hits(r: Rect, gap: number): boolean {
    for (let cx = Math.floor((r.x - gap) / this.cell); cx <= Math.floor((r.x + r.w + gap) / this.cell); cx++)
      for (let cy = Math.floor((r.y - gap) / this.cell); cy <= Math.floor((r.y + r.h + gap) / this.cell); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const o of list) if (rectsOverlap(r, o, gap)) return true;
      }
    return false;
  }
}

/** Phase 2 of `nudgeOutOfOverlap` (mutates `w`): settle clean rects, then re-place every violating one in a free spot. */
function legalise(w: LayoutRect[], fixed: ReadonlySet<string>, gap: number): void {
  const tol = gap - 1e-6;
  const bad = new Set<string>();
  for (let i = 0; i < w.length; i++)
    for (let j = i + 1; j < w.length; j++) {
      const a = w[i]!;
      const b = w[j]!;
      if (!(a.x < b.x + b.w + tol && a.x + a.w + tol > b.x && a.y < b.y + b.h + tol && a.y + a.h + tol > b.y)) continue;
      if (fixed.has(a.id) && fixed.has(b.id)) continue;
      (bad.add(a.id), bad.add(b.id));
    }
  if (bad.size === 0) return;
  const dim = Math.max(1, ...w.map((r) => Math.max(r.w, r.h)));
  const grid = new RectGrid(dim + gap);
  for (const r of w) if (fixed.has(r.id) || !bad.has(r.id)) grid.insert(toRect(r));
  const todo = w.filter((r) => bad.has(r.id) && !fixed.has(r.id)).sort((a, b) => a.x - b.x || a.y - b.y || byId(a, b));
  for (const r of todo) {
    if (!grid.hits(toRect(r), tol)) {
      grid.insert(toRect(r));
      continue;
    }
    // nearest free spot on growing rings around the current centre (same search as `placeNear`, grid-accelerated)
    const c = rectCenter(toRect(r));
    const step = Math.max(12, Math.min(r.w, r.h) / 4);
    let best: Point | undefined;
    let bestD = Infinity;
    for (let rad = step; rad < 1_000_000 && rad < bestD; rad += step) {
      const n = Math.max(24, Math.ceil((2 * Math.PI * rad) / step));
      for (let k = 0; k < n; k++) {
        const ang = (2 * Math.PI * k) / n;
        const cand = { x: c.x + rad * Math.cos(ang) - r.w / 2, y: c.y + rad * Math.sin(ang) - r.h / 2 };
        if (!grid.hits({ x: cand.x, y: cand.y, w: r.w, h: r.h }, gap)) {
          best = cand;
          bestD = rad;
          break;
        }
      }
    }
    if (best) (r.x = best.x, (r.y = best.y));
    grid.insert(toRect(r));
  }
}

function overlapsAny(r: Rect, obstacles: ReadonlyArray<Rect>, gap: number): boolean {
  return obstacles.some((o) => rectsOverlap(r, o, gap));
}

/** Place a `size` rect directly below `anchor` (left-aligned), sliding down until it clears every obstacle. Top-left. */
export function stackBelow(size: Size, anchor: Rect, obstacles: ReadonlyArray<Rect> = [], gap = 20): Point {
  const x = anchor.x;
  let y = anchor.y + anchor.h + gap;
  for (let guard = 0; guard < 10_000; guard++) {
    const hit = obstacles.find((o) => rectsOverlap({ x, y, w: size.w, h: size.h }, o, gap));
    if (!hit) break;
    y = hit.y + hit.h + gap;
  }
  return { x, y };
}

export interface PlaceNearOptions {
  /** Clearance to every obstacle. Default 20. */
  gap?: number;
  /** Preferred direction from the anchor in radians (0 = right, PI/2 = down in screen coordinates). */
  preferAngle?: number;
  /** Radial search step. Default 12. */
  step?: number;
}

const ANGLES = 24;

/**
 * Find the free spot closest to `anchor`'s centre (biased towards `preferAngle`) for a `size` rect that keeps `gap`
 * clearance from every obstacle. The anchor's own rect should be among the obstacles. Returns the TOP-LEFT.
 * Always terminates with a valid spot: radii grow until one is free.
 */
export function placeNear(
  size: Size,
  anchor: Rect | Point,
  obstacles: ReadonlyArray<Rect>,
  opts: PlaceNearOptions = {},
): Point {
  const gap = opts.gap ?? 20;
  const step = opts.step ?? 12;
  const pref = opts.preferAngle;
  const c = 'w' in anchor ? rectCenter(anchor) : anchor;
  const fits = (p: Point): boolean => !overlapsAny(rectAtCenter(p, size.w, size.h), obstacles, gap);
  if (fits(c)) return { x: c.x - size.w / 2, y: c.y - size.h / 2 };
  let best: { cost: number; p: Point } | undefined;
  for (let r = step; r < 200_000; r += step) {
    if (best && r >= best.cost) break;
    for (let k = 0; k < ANGLES; k++) {
      const a = (2 * Math.PI * k) / ANGLES;
      let off = 0;
      if (pref !== undefined) {
        off = Math.abs(Math.atan2(Math.sin(a - pref), Math.cos(a - pref))) / Math.PI;
      }
      const cost = r + off * 60;
      if (best && cost >= best.cost) continue;
      const p = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
      if (fits(p)) best = { cost, p };
    }
  }
  const p = best?.p ?? c;
  return { x: p.x - size.w / 2, y: p.y - size.h / 2 };
}
