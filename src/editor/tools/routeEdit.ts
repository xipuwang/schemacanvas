/**
 * Edge editing maths (pure, tested): waypoint insertion indexes, straightening, and anchor specs derived from a pointer.
 * Nothing here can change WHICH column / element an edge refers to: results are only `EdgeRoutePatch` fragments
 * (mode, waypoints, anchor preferences), and anchors are clamped inside their own cell / outline side.
 */
import type { AnchorSpec, DiagramEdge, EdgeRoute, Id, Point } from '@/model/types';
import type { EdgeRoutePatch } from '@/model/ops';
import type { Rect, Side } from '@/scene/base';
import type { EdgeGeom, NodeGeom } from '@/scene/types';
import { clamp, dist } from './geom';
import type { Handle } from './handles';

const EPS = 0.75;

/**
 * For each waypoint, the index of the path vertex it sits on (searching forward so repeated points keep their order);
 * a waypoint that is not on a vertex (should not happen) is matched to the nearest vertex.
 */
export function locateWaypoints(path: readonly Point[], waypoints: readonly Point[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (const w of waypoints) {
    let idx = -1;
    for (let i = from; i < path.length; i++) {
      if (dist(path[i]!, w) <= EPS) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      let best = Infinity;
      for (let i = from; i < path.length; i++) {
        const d = dist(path[i]!, w);
        if (d < best) {
          best = d;
          idx = i;
        }
      }
    }
    if (idx < 0) idx = Math.max(0, path.length - 1);
    out.push(idx);
    from = idx;
  }
  return out;
}

/** Where a new waypoint dragged out of path segment `segment` (between vertices `segment` and `segment + 1`) belongs in the waypoint list. */
export function insertionIndex(path: readonly Point[], waypoints: readonly Point[], segment: number): number {
  return locateWaypoints(path, waypoints).filter((i) => i <= segment).length;
}

/** The corners a manual route would start from: the stored waypoints, or the scene's `autoWaypoints` for an auto route. */
export function baseWaypoints(edge: DiagramEdge, geom: EdgeGeom): Point[] {
  const src = edge.route.mode === 'manual' && edge.route.waypoints.length > 0 ? edge.route.waypoints : geom.autoWaypoints;
  return src.map((p) => ({ x: p.x, y: p.y }));
}

export function withInserted(waypoints: readonly Point[], index: number, p: Point): Point[] {
  const next = waypoints.map((w) => ({ x: w.x, y: w.y }));
  next.splice(clamp(index, 0, next.length), 0, { x: p.x, y: p.y });
  return next;
}

export function withMoved(waypoints: readonly Point[], index: number, p: Point): Point[] {
  return waypoints.map((w, i) => (i === index ? { x: p.x, y: p.y } : { x: w.x, y: w.y }));
}

export function withRemoved(waypoints: readonly Point[], index: number): Point[] {
  return waypoints.filter((_, i) => i !== index).map((w) => ({ x: w.x, y: w.y }));
}

/**
 * Straighten: snap neighbouring waypoints that are nearly aligned onto a common axis (within `threshold`), then drop
 * waypoints that no longer change the path (duplicates and collinear points). Returns a new list.
 */
export function straightenWaypoints(waypoints: readonly Point[], threshold = 12): Point[] {
  const pts = waypoints.map((w) => ({ x: w.x, y: w.y }));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > 0 && dx <= threshold && dx <= dy) b.x = a.x;
    else if (dy > 0 && dy <= threshold) b.y = a.y;
  }
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < 0.5) continue;
    out.push(p);
  }
  for (let i = 1; i + 1 < out.length; ) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (collinear) out.splice(i, 1);
    else i++;
  }
  return out;
}

// ---- anchors -----------------------------------------------------------------------------------------------------

/** Sides an end of an edge may use on its anchor rect (AnchorSpec rules in model/types.ts), for the node + cell it touches. */
export function allowedSides(node: NodeGeom | undefined, columnId: Id | undefined): Side[] {
  if (!node) return ['top', 'right', 'bottom', 'left'];
  if (node.kind === 'h-table') {
    const idx = columnId ? node.cells.findIndex((c) => c.columnId === columnId) : -1;
    const out: Side[] = ['top', 'bottom'];
    if (idx === 0) out.push('left');
    if (idx >= 0 && idx === node.cells.length - 1) out.push('right');
    return out;
  }
  if (node.kind === 'v-table') {
    if (node.orientation === 'vertical') return ['left', 'right'];
    const idx = columnId ? node.rows.findIndex((r) => r.columnId === columnId) : -1;
    const out: Side[] = ['top', 'bottom'];
    if (idx === 0) out.push('left');
    if (idx >= 0 && idx === node.rows.length - 1) out.push('right');
    return out;
  }
  return ['top', 'right', 'bottom', 'left'];
}

/** Inset (world px) kept free at both ends of a side so an anchor never sits on a corner / neighbour. */
export const ANCHOR_MARGIN = 6;

function distanceToSide(r: Rect, side: Side, p: Point): { distance: number; along: number } {
  switch (side) {
    case 'top':
    case 'bottom': {
      const y = side === 'top' ? r.y : r.y + r.h;
      const x = clamp(p.x, r.x, r.x + r.w);
      return { distance: Math.hypot(p.x - x, p.y - y), along: (x - r.x) / (r.w || 1) };
    }
    default: {
      const x = side === 'left' ? r.x : r.x + r.w;
      const y = clamp(p.y, r.y, r.y + r.h);
      return { distance: Math.hypot(p.x - x, p.y - y), along: (y - r.y) / (r.h || 1) };
    }
  }
}

/**
 * The anchor preference for an end dragged to `p`: the nearest ALLOWED side of `rect` (the cell for FK ends, the outline rect
 * for Chen) and the clamped offset along it. The referenced cell / node is not an input, so it cannot change.
 */
export function anchorFromPointer(rect: Rect, sides: readonly Side[], p: Point, opts: { margin?: number } = {}): AnchorSpec {
  const margin = opts.margin ?? ANCHOR_MARGIN;
  let best: { side: Side; distance: number; along: number } | undefined;
  for (const side of sides) {
    const d = distanceToSide(rect, side, p);
    if (!best || d.distance < best.distance) best = { side, ...d };
  }
  const side = best?.side ?? 'bottom';
  const len = side === 'top' || side === 'bottom' ? rect.w : rect.h;
  const lo = Math.min(0.5, margin / (len || 1));
  const offset = Math.round(clamp(best?.along ?? 0.5, lo, 1 - lo) * 1000) / 1000;
  return { side, offset };
}

/** The route patch that stores `spec` for the end `h` (per-branch for composite FK branches, else edge level). */
export function anchorPatch(route: EdgeRoute, h: Extract<Handle, { kind: 'end' }>, spec: AnchorSpec): EdgeRoutePatch {
  if (h.branchSourceColumnId) {
    const all = { ...(route.branchAnchors ?? {}) };
    const cur = { ...(all[h.branchSourceColumnId] ?? {}) };
    cur[h.end] = spec;
    all[h.branchSourceColumnId] = cur;
    return { branchAnchors: all };
  }
  return h.end === 'source' ? { sourceAnchor: spec } : { targetAnchor: spec };
}

// ---- corner-exact editing of an ORTHOGONAL route ---------------------------------------------------------------------
//
// The horizontal-schema scene draws a manual route through EVERY stored waypoint, and exposes the polyline those waypoints
// are corners of (`FkEdgeGeom.centreline`). Editing therefore works on that polyline: the new waypoint list is the list of
// interior vertices of the edited polyline, so what is drawn while dragging (the scene builds the same waypoints) is what is
// stored, a new bend lands exactly on the pointer, and no waypoint is ever a spike or an off-line point.

/** Smallest distance (world px) a bend may keep from an anchor along the connector's exit / arrival axis. */
export const MIN_END_RUN = 10;

const SAME = 1e-6;
const isH = (a: Point, b: Point): boolean => Math.abs(a.y - b.y) < SAME;
const sgn = (v: number): number => (Math.abs(v) < SAME ? 0 : Math.sign(v));

/** Interior vertices of a polyline (what a manual route stores). */
export const interiorVertices = (poly: readonly Point[]): Point[] => poly.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));

/** Drop zero-length steps and collinear same-direction vertices (never `keep`); reversals (spikes) are kept as they are. */
export function tidyPolyline(poly: readonly Point[], keep: (p: Point, i: number) => boolean = () => false): Point[] {
  const out: Array<{ p: Point; i: number }> = [];
  poly.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last && dist(last.p, p) < SAME) {
      if (keep(p, i) && !keep(last.p, last.i)) out[out.length - 1] = { p, i };
      return;
    }
    out.push({ p, i });
    while (out.length >= 3) {
      const c = out[out.length - 1]!.p;
      const b = out[out.length - 2]!;
      const a = out[out.length - 3]!.p;
      const same = (a.x === b.p.x && b.p.x === c.x && sgn(b.p.y - a.y) === sgn(c.y - b.p.y)) || (a.y === b.p.y && b.p.y === c.y && sgn(b.p.x - a.x) === sgn(c.x - b.p.x));
      if (same && !keep(b.p, b.i)) out.splice(out.length - 2, 1);
      else break;
    }
  });
  return out.map((o) => ({ x: o.p.x, y: o.p.y }));
}

const reversals = (pts: readonly Point[]): number => {
  let n = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < -SAME) n++;
  }
  return n;
};

/** Unit outward direction of the first (`'first'`) or last (`'last'`) segment of `poly`, pointing AWAY from the anchor. */
function endNormal(poly: readonly Point[], end: 'first' | 'last'): Point {
  const a = end === 'first' ? poly[0]! : poly[poly.length - 1]!;
  const b = end === 'first' ? poly[1]! : poly[poly.length - 2]!;
  return { x: sgn(b.x - a.x), y: sgn(b.y - a.y) };
}

/** Keep `p` at least `MIN_END_RUN` outside the anchor `a` along the outward normal `n`. */
function clampOutside(p: Point, a: Point, n: Point, run = MIN_END_RUN): Point {
  const out = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
  if (out >= run) return p;
  const d = run - out;
  return { x: p.x + n.x * d, y: p.y + n.y * d };
}

/**
 * Drag the middle of segment `segment` (poly[segment] -> poly[segment + 1]) to `p`: the new route passes through `p` as a
 * CORNER (an S-shaped dog-leg replacing the segment). Returns the full new polyline; the caller stores its interior vertices.
 * The first / last segment keep their perpendicular exit / arrival (`p` is pushed `MIN_END_RUN` clear of the anchor).
 */
export function insertBendPolyline(poly: readonly Point[], segment: number, pIn: Point): { poly: Point[]; bend: Point } {
  const n = poly.length;
  const A = poly[segment]!;
  const B = poly[segment + 1]!;
  const first = segment === 0;
  const last = segment === n - 2;
  let p = { x: pIn.x, y: pIn.y };
  if (first) p = clampOutside(p, poly[0]!, endNormal(poly, 'first'));
  if (last) p = clampOutside(p, poly[n - 1]!, endNormal(poly, 'last'));
  // A segment that starts / ends at a stub end must not be left / entered from the table side of that stub end (the route
  // would run back over its own stub, or through the table): keep the bend on the outer side of it.
  if (segment === 1 && !first) p = clampOutside(p, poly[1]!, endNormal(poly, 'first'));
  if (segment === n - 3 && !last) p = clampOutside(p, poly[n - 2]!, endNormal(poly, 'last'));
  const h = isH(A, B);
  const alongFirst = (): Point[] => (h ? [A, { x: p.x, y: A.y }, p, { x: B.x, y: p.y }, B] : [A, { x: A.x, y: p.y }, p, { x: p.x, y: B.y }, B]);
  const perpFirst = (): Point[] => (h ? [A, { x: A.x, y: p.y }, p, { x: p.x, y: B.y }, B] : [A, { x: p.x, y: A.y }, p, { x: B.x, y: p.y }, B]);
  let mid: Point[];
  if (first && last) {
    // A straight connector between two anchors: leave along the segment, step to p, run on to a line half way to the arrival
    // anchor and arrive straight (p is a corner of the leg).
    mid = h
      ? [A, { x: p.x, y: A.y }, p, { x: (p.x + B.x) / 2, y: p.y }, { x: (p.x + B.x) / 2, y: B.y }, B]
      : [A, { x: A.x, y: p.y }, p, { x: p.x, y: (p.y + B.y) / 2 }, { x: B.x, y: (p.y + B.y) / 2 }, B];
  } else if (first) mid = alongFirst();
  else if (last) mid = perpFirst();
  else {
    const x = alongFirst();
    const y = perpFirst();
    const total = (m: Point[]) => reversals([...poly.slice(Math.max(0, segment - 1), segment), ...m, ...poly.slice(segment + 2, segment + 3)]);
    mid = total(x) <= total(y) ? x : y;
  }
  const full = [...poly.slice(0, segment), ...mid, ...poly.slice(segment + 2)];
  const tidy = tidyPolyline(full, (q) => Math.abs(q.x - p.x) < SAME && Math.abs(q.y - p.y) < SAME);
  return { poly: tidy, bend: p };
}

/**
 * Drag the corner at polyline vertex `k` to `pIn`. The two segments around the corner stay axis-aligned (the neighbouring
 * vertices follow along the shared axis); a corner next to an anchor only slides along the stub axis. Returns the new polyline.
 */
export function moveCornerPolyline(poly: readonly Point[], k: number, pIn: Point): Point[] {
  const n = poly.length;
  const out = poly.map((q) => ({ x: q.x, y: q.y }));
  if (k < 1 || k > n - 2) return out;
  const prevAnchored = k === 1;
  const nextAnchored = k === n - 2;
  if (prevAnchored && nextAnchored) return out; // an L between two anchors: nothing may move
  let p = { x: pIn.x, y: pIn.y };
  const slide = (anchor: Point, nrm: Point): void => {
    // a corner next to an anchor only slides along the stub axis, and stays clear of the anchor
    p = nrm.x === 0 ? { x: anchor.x, y: p.y } : { x: p.x, y: anchor.y };
  };
  if (prevAnchored) slide(poly[0]!, endNormal(poly, 'first'));
  if (nextAnchored) slide(poly[n - 1]!, endNormal(poly, 'last'));
  // the neighbour next to an anchor is a stub end: its coordinate along the stub axis is p's, so p keeps it clear of the anchor
  if (k === 2 || prevAnchored) p = clampOutside(p, poly[0]!, endNormal(poly, 'first'));
  if (k === n - 3 || nextAnchored) p = clampOutside(p, poly[n - 1]!, endNormal(poly, 'last'));
  out[k] = p;
  const prev = poly[k - 1]!;
  const next = poly[k + 1]!;
  if (!prevAnchored) out[k - 1] = isH(prev, poly[k]!) ? { x: prev.x, y: p.y } : { x: p.x, y: prev.y };
  if (!nextAnchored) out[k + 1] = isH(next, poly[k]!) ? { x: next.x, y: p.y } : { x: p.x, y: next.y };
  return out;
}
