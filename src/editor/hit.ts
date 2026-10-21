/**
 * Hit-testing and marquee selection against the derived `Scene` (never against DOM bounding boxes).
 * Pure functions: `(scene, world point, zoom, opts)`. Tolerances are expressed in SCREEN pixels and divided by the
 * zoom so a connector is equally easy to grab at 25% and at 400%.
 */
import type { Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import { distanceToPolyline, labelRect, pointInOutline, rectContains, rectEncloses, rectsIntersect } from '@/scene/geometry';
import type { EdgeGeom, FkEdgeGeom, HTableGeom, NodeGeom, Scene, VFkEdgeGeom, VTableGeom } from '@/scene/types';

export type HitKind = 'edge-label' | 'node' | 'edge';

export type HitResult =
  | { kind: 'none' }
  | {
      kind: 'node';
      nodeId: Id;
      /** h-table: the cell under the pointer. */
      columnId?: Id;
      /** h-table: the pointer is over the relation name (above the row), not a cell. */
      onName?: boolean;
      /** h-table: the pointer is within tolerance of a vertical cell border (for column-resize tools). */
      border?: { columnId: Id; side: 'left' | 'right' };
    }
  | {
      kind: 'edge';
      edgeId: Id;
      /** FK edge: SOURCE column id of the branch under the pointer (composite FKs have several branches). */
      branchId?: Id;
      /** Distance to the nearest path, in world units. */
      distance: number;
    }
  | { kind: 'edge-label'; edgeId: Id; labelId: 'main' | 'role' | 'cardinality' };

export interface HitOptions {
  /** Which kinds to consider (default: all). */
  kinds?: readonly HitKind[];
  /** Pointer tolerance for edges / borders in screen px (default 6). */
  tolerancePx?: number;
  /** Ids (node or edge) to ignore, e.g. the dragged nodes while looking for a drop target. */
  skip?: ReadonlySet<Id>;
}

export const DEFAULT_TOLERANCE_PX = 6;
const BORDER_TOLERANCE_PX = 4;

const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

function hitHTable(g: HTableGeom, p: Point, zoom: number): HitResult | undefined {
  const tol = BORDER_TOLERANCE_PX / zoom;
  const cell = g.cells.find((c) => rectContains(c.rect, p));
  if (cell) {
    const res: Extract<HitResult, { kind: 'node' }> = { kind: 'node', nodeId: g.nodeId, columnId: cell.columnId };
    if (Math.abs(p.x - cell.rect.x) <= tol) res.border = { columnId: cell.columnId, side: 'left' };
    else if (Math.abs(p.x - (cell.rect.x + cell.rect.w)) <= tol) res.border = { columnId: cell.columnId, side: 'right' };
    return res;
  }
  if (g.cells.length === 0 && rectContains(g.row, p)) return { kind: 'node', nodeId: g.nodeId };
  // the relation name: only the painted text box counts (the empty space beside it must stay click-through)
  if (rectContains(inflate(labelRect(g.nameLabel), 2), p)) return { kind: 'node', nodeId: g.nodeId, onName: true };
  return undefined;
}

/**
 * Vertical / crow's foot / physical tables (EDITOR-TOOLS addition): a row (vertical) or cell (horizontal orientation) yields its
 * `columnId`; the header band (vertical) or the painted relation name (horizontal) yields `onName`; the rest of a vertical table
 * (constraint / index sections, gaps) is a plain node hit. Horizontal-orientation cells also report vertical `border`s.
 */
function hitVTable(g: VTableGeom, p: Point, zoom: number): HitResult | undefined {
  const horizontal = g.orientation === 'horizontal';
  const tol = BORDER_TOLERANCE_PX / zoom;
  const row = g.rows.find((r) => rectContains(r.rect, p));
  if (row) {
    const res: Extract<HitResult, { kind: 'node' }> = { kind: 'node', nodeId: g.nodeId, columnId: row.columnId };
    if (horizontal) {
      if (Math.abs(p.x - row.rect.x) <= tol) res.border = { columnId: row.columnId, side: 'left' };
      else if (Math.abs(p.x - (row.rect.x + row.rect.w)) <= tol) res.border = { columnId: row.columnId, side: 'right' };
    }
    return res;
  }
  if (horizontal) {
    if (g.rows.length === 0 && rectContains(g.body, p)) return { kind: 'node', nodeId: g.nodeId };
    return rectContains(inflate(labelRect(g.nameLabel), 2), p) ? { kind: 'node', nodeId: g.nodeId, onName: true } : undefined;
  }
  if (rectContains(g.header, p)) return { kind: 'node', nodeId: g.nodeId, onName: true };
  return pointInOutline(g.outline, p) ? { kind: 'node', nodeId: g.nodeId } : undefined;
}

function hitNode(g: NodeGeom, p: Point, zoom: number): HitResult | undefined {
  if (g.kind === 'h-table') return hitHTable(g, p, zoom);
  if (g.kind === 'v-table') return hitVTable(g, p, zoom);
  return pointInOutline(g.outline, p) ? { kind: 'node', nodeId: g.nodeId } : undefined;
}

/** Polylines that make up the clickable body of an edge, each tagged with the FK branch it belongs to. */
function edgePolylines(e: EdgeGeom): Array<{ pts: Point[]; branchId?: Id }> {
  if (e.kind === 'fk') {
    const fk = e as FkEdgeGeom;
    const out: Array<{ pts: Point[]; branchId?: Id }> = fk.branches.map((b) => ({ pts: b.points, branchId: b.sourceColumnId }));
    if (fk.brackets) {
      const first = fk.branches[0]?.sourceColumnId;
      out.push({ pts: fk.brackets.source, branchId: first }, { pts: fk.brackets.target, branchId: first });
    }
    return out;
  }
  if (e.kind === 'v-fk') {
    const v = e as VFkEdgeGeom;
    return e.paths.map((pts) => ({ pts, branchId: v.sourceColumnId }));
  }
  return e.paths.map((pts) => ({ pts }));
}

/**
 * Top-most element under `p` (world coordinates): edge labels (painted above everything), then nodes in reverse paint
 * order, then edges (nearest path within tolerance, later paint order wins ties). Nodes win over edges because edges are
 * painted below nodes.
 */
export function hitTest(scene: Scene, p: Point, zoom: number, opts: HitOptions = {}): HitResult {
  const kinds = opts.kinds;
  const want = (k: HitKind): boolean => !kinds || kinds.includes(k);
  const skip = opts.skip;
  const tol = (opts.tolerancePx ?? DEFAULT_TOLERANCE_PX) / zoom;

  if (want('edge-label')) {
    for (let i = scene.edgeOrder.length - 1; i >= 0; i--) {
      const id = scene.edgeOrder[i]!;
      if (skip?.has(id)) continue;
      const e = scene.edges[id];
      if (!e) continue;
      for (let j = e.labels.length - 1; j >= 0; j--) {
        const l = e.labels[j]!;
        if (l.label.text && rectContains(labelRect(l.label), p)) return { kind: 'edge-label', edgeId: id, labelId: l.id };
      }
    }
  }
  if (want('node')) {
    for (let i = scene.nodeOrder.length - 1; i >= 0; i--) {
      const id = scene.nodeOrder[i]!;
      if (skip?.has(id)) continue;
      const g = scene.nodes[id];
      if (!g) continue;
      const r = hitNode(g, p, zoom);
      if (r) return r;
    }
  }
  if (want('edge')) {
    let best: { edgeId: Id; branchId?: Id; distance: number } | undefined;
    for (const id of scene.edgeOrder) {
      if (skip?.has(id)) continue;
      const e = scene.edges[id];
      if (!e) continue;
      // cheap reject on the paint bounds
      if (!rectContains(inflate(e.bounds, tol), p)) continue;
      for (const poly of edgePolylines(e)) {
        if (poly.pts.length < 2) continue;
        const d = distanceToPolyline(p, poly.pts);
        if (d <= tol && (!best || d <= best.distance)) best = { edgeId: id, branchId: poly.branchId, distance: d };
      }
    }
    if (best) {
      const res: Extract<HitResult, { kind: 'edge' }> = { kind: 'edge', edgeId: best.edgeId, distance: best.distance };
      if (best.branchId !== undefined) res.branchId = best.branchId;
      return res;
    }
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------------------------------------------------

export interface MarqueeOptions {
  /** `intersect` (default): touching the rectangle selects; `contain` (Alt): fully inside. Applies to nodes. */
  mode?: 'intersect' | 'contain';
  /**
   * Edges: `contain` (default) selects an edge only when its whole paint bounds are inside the rectangle (so a marquee
   * around two tables never grabs half-covered connectors that a Delete would then remove); `intersect` = any path
   * segment crosses the rectangle; `none` = never.
   */
  edges?: 'contain' | 'intersect' | 'none';
}

/** Rect is normalised (positive w/h) by the caller; use `rectFromPoints` for a drag. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (rectContains(r, a) || rectContains(r, b)) return true;
  // Liang-Barsky clip
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [pp, q] of edges) {
    if (pp === 0) {
      if (q < 0) return false;
    } else {
      const t = q / pp;
      if (pp < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

export function marqueeSelect(scene: Scene, rect: Rect, opts: MarqueeOptions = {}): { nodeIds: Id[]; edgeIds: Id[] } {
  const mode = opts.mode ?? 'intersect';
  const edgeMode = opts.edges ?? 'contain';
  const nodeIds: Id[] = [];
  for (const id of scene.nodeOrder) {
    const g = scene.nodes[id];
    if (!g) continue;
    const b = g.bounds;
    if (mode === 'contain' ? rectEncloses(rect, b) : rectsIntersect(rect, b)) nodeIds.push(id);
  }
  const edgeIds: Id[] = [];
  if (edgeMode !== 'none') {
    for (const id of scene.edgeOrder) {
      const e = scene.edges[id];
      if (!e) continue;
      if (edgeMode === 'contain') {
        if (rectEncloses(rect, e.bounds)) edgeIds.push(id);
      } else if (rectsIntersect(rect, e.bounds)) {
        const hit = edgePolylines(e).some(({ pts }) => pts.some((q, i) => (i > 0 ? segmentIntersectsRect(pts[i - 1]!, q, rect) : pts.length === 1 && rectContains(rect, q))));
        if (hit) edgeIds.push(id);
      }
    }
  }
  return { nodeIds, edgeIds };
}
