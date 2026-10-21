/**
 * Foreign-key connectors of the vertical family (crow's foot + physical).
 *
 * INVARIANT: which row a connector refers to is decided ONCE, in `planEdge`, from the FK's column pairs (the first
 * resolvable pair). Sides, anchor spreading, routing and manual waypoints only move geometry between the two
 * already-chosen rows; no step reads a coordinate to decide a column. A composite FK is ONE edge with ONE symbol pair
 * on the first pair's rows; its other columns are marked by dots on their own rows (`memberMarks`), there are no
 * per-column branches in this family.
 */
import { describeForeignKey, fkCardinality, ownGet } from '@/model/queries';
import type { AnchorSpec, DiagramEdge, ForeignKey, Id, Point, RelationalModel } from '@/model/types';
import type { EdgeEndGeom, EdgeLabelGeom, MeasureText, Rect, Side, TextLabel } from '../base';
import { dedupePoints, distance, inflateRect, labelRect, rectOfPoints, rectsIntersect, sideNormal, unionRects } from '../geometry';
import type { EdgeReuse } from '../draft';
import { cleanOrthogonal, routeOrthogonal } from '../routing';
import type { RouteObstacle } from '../routing';
import type { RouteRequest } from '../routing/types';
import {
  ANCHOR_INSET,
  CLEARANCE,
  DEFAULT_FK_STROKE_WIDTH,
  MIN_FACING_GAP,
  FOOT_HALF,
  MEMBER_DOT_R,
  MIN_FREE_SLIVER,
  NAME_ANCHOR_MARGIN,
  STUB,
} from './constants';
import { buildSymbol, childSymbolKind, parentSymbolKind, SYMBOL_LENGTH, symbolPoints } from './symbols';
import type { VTableLayout } from './table';
import type { VFkEdgeGeom, VMemberMark, VSymbolGeom, VTableRowGeom } from './types';

export interface VFkBuildInput {
  model: RelationalModel;
  /** Table layouts keyed by DiagramNode id. */
  layouts: ReadonlyMap<Id, VTableLayout>;
  nodeOfRelation: ReadonlyMap<Id, Id>;
  edges: Array<[Id, DiagramEdge]>;
  routing: 'orthogonal' | 'straight';
  measure: MeasureText;
  fontFamily: string;
  fontSize: number;
  warnings: string[];
  /** Draft builds (scene/draft.ts): previous full geometry of untouched edges; every other edge gets provisional geometry. */
  reuse?: EdgeReuse;
}

interface Pair {
  index: number;
  sourceColumnId: Id;
  targetColumnId: Id;
  sIdx: number;
  tIdx: number;
}

interface Plan {
  edgeId: Id;
  edge: DiagramEdge;
  fk: ForeignKey;
  sNodeId: Id;
  tNodeId: Id;
  sL: VTableLayout;
  tL: VTableLayout;
  pairs: Pair[];
  sRow: VTableRowGeom;
  tRow: VTableRowGeom;
  sSide: Side;
  tSide: Side;
  sSpec?: AnchorSpec;
  tSpec?: AnchorSpec;
  s0?: Point;
  t0?: Point;
  strokeWidth: number;
}

const isVerticalSide = (s: Side): boolean => s === 'top' || s === 'bottom';
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const fin = (p: Point | undefined): boolean => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

function planEdge(input: VFkBuildInput, edgeId: Id, edge: DiagramEdge): Plan | undefined {
  const { model, layouts, nodeOfRelation, warnings } = input;
  if (!edge || !edge.ref || edge.ref.kind !== 'foreignKey') {
    warnings.push(`unsupported-edge:${edgeId}`);
    return undefined;
  }
  const fk = ownGet(model.foreignKeys, edge.ref.foreignKeyId);
  const sNodeId = fk ? nodeOfRelation.get(fk.sourceRelationId) : undefined;
  const tNodeId = fk ? nodeOfRelation.get(fk.targetRelationId) : undefined;
  const sL = sNodeId ? layouts.get(sNodeId) : undefined;
  const tL = tNodeId ? layouts.get(tNodeId) : undefined;
  if (!fk || !sNodeId || !tNodeId || !sL || !tL) {
    warnings.push(`dangling-fk-edge:${edgeId}`);
    return undefined;
  }
  const pairs: Pair[] = [];
  (Array.isArray(fk.columns) ? fk.columns : []).forEach((p, index) => {
    const sIdx = p ? sL.geom.rows.findIndex((r) => r.columnId === p.sourceColumnId) : -1;
    const tIdx = p ? tL.geom.rows.findIndex((r) => r.columnId === p.targetColumnId) : -1;
    if (sIdx < 0 || tIdx < 0) {
      warnings.push(`fk-column-missing:${fk.id}:${index}`);
      return;
    }
    pairs.push({ index, sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId, sIdx, tIdx });
  });
  if (pairs.length === 0) {
    warnings.push(`dangling-fk-edge:${edgeId}`);
    return undefined;
  }
  const first = pairs[0]!;
  const spec = edge.route?.branchAnchors?.[first.sourceColumnId];
  return {
    edgeId,
    edge,
    fk,
    sNodeId,
    tNodeId,
    sL,
    tL,
    pairs,
    sRow: sL.geom.rows[first.sIdx]!,
    tRow: tL.geom.rows[first.tIdx]!,
    sSide: 'right',
    tSide: 'left',
    sSpec: spec?.source ?? edge.route?.sourceAnchor,
    tSpec: spec?.target ?? edge.route?.targetAnchor,
    strokeWidth: Number.isFinite(edge.style?.strokeWidth) ? edge.style!.strokeWidth! : DEFAULT_FK_STROKE_WIDTH,
  };
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/** Usable interval along a border of `rect` (x for top/bottom, y for left/right); undefined = blocked by the relation name. */
function borderInterval(layout: VTableLayout, rect: Rect, side: Side, idx: number): [number, number] | undefined {
  if (!isVerticalSide(side)) return [rect.y + Math.min(ANCHOR_INSET, rect.h / 2), rect.y + rect.h - Math.min(ANCHOR_INSET, rect.h / 2)];
  const lo = rect.x + ANCHOR_INSET;
  const hi = rect.x + rect.w - ANCHOR_INSET;
  if (side === 'bottom' || layout.geom.orientation !== 'horizontal') return [lo, hi];
  const n = layout.nameRect;
  const blockLo = n.x - NAME_ANCHOR_MARGIN;
  const blockHi = n.x + n.w + NAME_ANCHOR_MARGIN;
  if (blockHi <= lo || blockLo >= hi) return [lo, hi];
  const parts: Array<[number, number]> = [];
  if (blockLo - lo >= MIN_FREE_SLIVER) parts.push([lo, Math.min(hi, blockLo)]);
  if (hi - blockHi >= MIN_FREE_SLIVER) parts.push([Math.max(lo, blockHi), hi]);
  void idx;
  if (parts.length === 0) return undefined;
  return parts.reduce((best, p) => (p[1] - p[0] > best[1] - best[0] ? p : best));
}

function autoSides(p: Plan): [Side, Side] {
  const s = p.sL.geom;
  const t = p.tL.geom;
  const self = p.sNodeId === p.tNodeId;
  if (s.orientation === 'vertical') {
    if (self) return ['right', 'right'];
    // Signed gaps between the two tables along x (positive = separated). Facing sides are used whenever there is room
    // for a (possibly shortened) perpendicular stub; the router meets in the middle of a narrow gap.
    const gapRight = t.bounds.x - (s.bounds.x + s.bounds.w);
    const gapLeft = s.bounds.x - (t.bounds.x + t.bounds.w);
    if (gapRight >= MIN_FACING_GAP) return ['right', 'left'];
    if (gapLeft >= MIN_FACING_GAP) return ['left', 'right'];
    // Touching side by side: the facing borders have no room, so each end uses its OUTER side (never along a border).
    if (gapRight >= 0) return ['left', 'right'];
    if (gapLeft >= 0) return ['right', 'left'];
    // Stacked / overlapping in x: both ends on the side that keeps the connector short.
    const rightCost = Math.abs(s.bounds.x + s.bounds.w - (t.bounds.x + t.bounds.w));
    const leftCost = Math.abs(s.bounds.x - t.bounds.x);
    return leftCost < rightCost ? ['left', 'left'] : ['right', 'right'];
  }
  if (self) return ['bottom', 'bottom'];
  // Single-row tables: a top border can be blocked by the relation name. When the FACING border of either end is
  // blocked, both ends use their OUTER borders instead (a bottom stub would run into the table below).
  const topBlocked = (l: VTableLayout, row: VTableRowGeom): boolean => borderInterval(l, row.rect, 'top', l.geom.rows.indexOf(row)) === undefined;
  if (t.bounds.y >= s.body.y + s.body.h + MIN_FACING_GAP) {
    if (!topBlocked(p.tL, p.tRow)) return ['bottom', 'top'];
    return topBlocked(p.sL, p.sRow) ? ['bottom', 'bottom'] : ['top', 'bottom'];
  }
  if (t.body.y + t.body.h + MIN_FACING_GAP <= s.bounds.y) {
    if (!topBlocked(p.sL, p.sRow)) return ['top', 'bottom'];
    return topBlocked(p.tL, p.tRow) ? ['bottom', 'bottom'] : ['bottom', 'top'];
  }
  return ['bottom', 'bottom'];
}

function resolveSide(
  spec: AnchorSpec | undefined,
  layout: VTableLayout,
  idx: number,
  rect: Rect,
  auto: Side,
  warn: (side: string) => void,
): Side {
  const vertical = layout.geom.orientation === 'vertical';
  let want: Side = auto;
  if (spec && spec.side !== 'auto') {
    const count = layout.geom.rows.length;
    const ok = vertical
      ? spec.side === 'left' || spec.side === 'right'
      : spec.side === 'top' || spec.side === 'bottom' || (spec.side === 'left' && idx === 0) || (spec.side === 'right' && idx === count - 1);
    if (ok) return spec.side as Side;
    warn(spec.side);
  }
  // A top border under the relation name may be blocked: use the bottom border instead.
  if (!vertical && want === 'top' && borderInterval(layout, rect, 'top', idx) === undefined) want = 'bottom';
  return want;
}

/** The rect a stub of length `len` leaves through `side` of `row` (a thin box; top/bottom span the whole cell). */
function stubBox(row: Rect, side: Side, len: number): Rect {
  switch (side) {
    case 'left':
      return { x: row.x - len, y: row.y + row.h / 2 - 3, w: len, h: 6 };
    case 'right':
      return { x: row.x + row.w, y: row.y + row.h / 2 - 3, w: len, h: 6 };
    case 'top':
      return { x: row.x, y: row.y - len, w: row.w, h: len };
    case 'bottom':
      return { x: row.x, y: row.y + row.h, w: row.w, h: len };
  }
}

const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Auto sides, then a guard: when the chosen perpendicular stub of an end would run into a table that is neither end of
 * this FK (a crowded neighbour, e.g. a single-row table directly below), try the other side combinations in a fixed
 * preference order and take the first whose two stubs are clear. User-chosen anchors are never overridden.
 */
function assignSides(p: Plan, warnings: string[], layouts: ReadonlyMap<Id, VTableLayout>): void {
  const [aS, aT] = autoSides(p);
  const sIdx = p.sL.geom.rows.indexOf(p.sRow);
  const tIdx = p.tL.geom.rows.indexOf(p.tRow);
  p.sSide = resolveSide(p.sSpec, p.sL, sIdx, p.sRow.rect, aS, (s) => warnings.push(`anchor-coerced:${p.edgeId}:source:${s}`));
  p.tSide = resolveSide(p.tSpec, p.tL, tIdx, p.tRow.rect, aT, (s) => warnings.push(`anchor-coerced:${p.edgeId}:target:${s}`));
  const sFree = !p.sSpec || p.sSpec.side === 'auto';
  const tFree = !p.tSpec || p.tSpec.side === 'auto';
  if ((!sFree && !tFree) || p.sNodeId === p.tNodeId) return;
  const others: Rect[] = [];
  for (const [nodeId, l] of layouts) {
    if (nodeId === p.sNodeId || nodeId === p.tNodeId) continue;
    if (l.geom.orientation === 'horizontal') others.push(l.geom.body, l.nameRect);
    else others.push(l.geom.bounds);
  }
  const blocked = (row: Rect, side: Side): boolean => others.some((r) => hits(stubBox(row, side, STUB), r));
  if (!blocked(p.sRow.rect, p.sSide) && !blocked(p.tRow.rect, p.tSide)) return;
  const vertical = p.sL.geom.orientation === 'vertical';
  const sides: Side[] = vertical ? ['right', 'left'] : ['bottom', 'top'];
  const usable = (l: VTableLayout, row: VTableRowGeom, side: Side): boolean => vertical || side === 'bottom' || borderInterval(l, row.rect, 'top', l.geom.rows.indexOf(row)) !== undefined;
  const sCands = sFree ? sides.filter((x) => usable(p.sL, p.sRow, x)) : [p.sSide];
  const tCands = tFree ? sides.filter((x) => usable(p.tL, p.tRow, x)) : [p.tSide];
  for (const a of sCands) {
    for (const b of tCands) {
      if (!blocked(p.sRow.rect, a) && !blocked(p.tRow.rect, b)) {
        p.sSide = a;
        p.tSide = b;
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

interface End {
  plan: Plan;
  role: 's' | 't';
  nodeId: Id;
  layout: VTableLayout;
  row: VTableRowGeom;
  idx: number;
  side: Side;
  spec?: AnchorSpec;
  peer: number;
  order: number;
}

const pointOnBorder = (r: Rect, side: Side, along: number): Point => {
  switch (side) {
    case 'top':
      return { x: along, y: r.y };
    case 'bottom':
      return { x: along, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: along };
    case 'right':
      return { x: r.x + r.w, y: along };
  }
};

function placeEnds(plans: Plan[], shifts: ReadonlyMap<string, number>): void {
  const ends: End[] = [];
  let order = 0;
  for (const plan of plans) {
    const c = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const sc = c(plan.sRow.rect);
    const tc = c(plan.tRow.rect);
    ends.push({ plan, role: 's', nodeId: plan.sNodeId, layout: plan.sL, row: plan.sRow, idx: plan.sL.geom.rows.indexOf(plan.sRow), side: plan.sSide, spec: plan.sSpec, peer: isVerticalSide(plan.sSide) ? tc.x : tc.y, order: order++ });
    ends.push({ plan, role: 't', nodeId: plan.tNodeId, layout: plan.tL, row: plan.tRow, idx: plan.tL.geom.rows.indexOf(plan.tRow), side: plan.tSide, spec: plan.tSpec, peer: isVerticalSide(plan.tSide) ? sc.x : sc.y, order: order++ });
  }
  const groups = new Map<string, End[]>();
  for (const e of ends) {
    const k = `${e.nodeId}|${e.row.columnId}|${e.side}`;
    const l = groups.get(k);
    if (l) l.push(e);
    else groups.set(k, [e]);
  }
  const assign = (e: End, along: number) => {
    const p = pointOnBorder(e.row.rect, e.side, along);
    if (e.role === 's') e.plan.s0 = p;
    else e.plan.t0 = p;
  };
  for (const list of groups.values()) {
    const first = list[0]!;
    const vertical = isVerticalSide(first.side);
    const rect = first.row.rect;
    const full: [number, number] = vertical ? [rect.x + ANCHOR_INSET, rect.x + rect.w - ANCHOR_INSET] : [rect.y + Math.min(ANCHOR_INSET, rect.h / 2), rect.y + rect.h - Math.min(ANCHOR_INSET, rect.h / 2)];
    // Row sides (left/right): keep the symbols (half width ~5) inside the row. Cell borders: the name-aware interval.
    const usable: [number, number] = vertical
      ? (borderInterval(first.layout, rect, first.side, first.idx) ?? full)
      : [Math.min(rect.y + 5, rect.y + rect.h / 2), Math.max(rect.y + rect.h - 5, rect.y + rect.h / 2)];
    const auto: End[] = [];
    for (const e of list) {
      const off = e.spec?.offset;
      if (typeof off === 'number' && Number.isFinite(off)) {
        const span = vertical ? rect.w : rect.h;
        const origin = vertical ? rect.x : rect.y;
        assign(e, clamp(origin + span * off, full[0], full[1]));
      } else auto.push(e);
    }
    auto.sort((a, b) => a.peer - b.peer || a.order - b.order);
    // Several connectors on one row side: spaced far enough apart that their symbols do not merge, centred in the
    // usable interval (never beyond it, so an anchor can not leave its own row).
    const n = auto.length;
    const mid = (usable[0] + usable[1]) / 2;
    const gap = n > 1 ? Math.min(vertical ? 12 : 9, (usable[1] - usable[0]) / (n - 1)) : 0;
    auto.forEach((e, k) => {
      const shift = shifts.get(`${e.plan.edgeId}:${e.role}`) ?? 0;
      assign(e, clamp(mid + (k - (n - 1) / 2) * gap + shift, full[0], full[1]));
    });
  }
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

const zoneId = (edgeId: Id): Id => `${edgeId}#zones`;
const bandId = (nodeId: Id): Id => `${nodeId}#band`;
const ZONE_PAD = 3;

/** Keep-out strip in front of a symbol: the symbol plus the stub it sits on. */
function symbolZone(at: Point, side: Side): Rect {
  const n = sideNormal(side);
  const hw = FOOT_HALF + 1;
  if (isVerticalSide(side)) return { x: at.x - hw, y: n.y > 0 ? at.y : at.y - STUB, w: 2 * hw, h: STUB };
  return { x: n.x > 0 ? at.x : at.x - STUB, y: at.y - hw, w: STUB, h: 2 * hw };
}

function segmentCrossesRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q > 0;
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
  const e = 1e-6;
  if (!(clip(-dx, a.x - r.x - e) && clip(dx, r.x + r.w - e - a.x) && clip(-dy, a.y - r.y - e) && clip(dy, r.y + r.h - e - a.y))) return false;
  return t1 - t0 > 1e-9;
}

const pathHitsRect = (path: Point[], r: Rect): boolean => path.some((p, i) => i + 1 < path.length && segmentCrossesRect(p, path[i + 1]!, r));

function straightPath(p: Plan, waypoints: Point[]): Point[] {
  const sn = sideNormal(p.sSide);
  const tn = sideNormal(p.tSide);
  const s0 = p.s0!;
  const t0 = p.t0!;
  // Facing ends closer than 2 stubs share the gap instead of passing each other.
  let sLen = STUB;
  let tLen = STUB;
  if (sn.x === -tn.x && sn.y === -tn.y) {
    const d = (t0.x - s0.x) * sn.x + (t0.y - s0.y) * sn.y;
    if (d >= 0) sLen = tLen = Math.min(STUB, d / 2);
  }
  return dedupePoints([s0, { x: s0.x + sn.x * sLen, y: s0.y + sn.y * sLen }, ...waypoints, { x: t0.x + tn.x * tLen, y: t0.y + tn.y * tLen }, t0]);
}

/** Clearances tried (in order) for a route that had to ride a table border at the normal clearance. */
const THIN_CLEARANCES = [6, 4, 2, 1];
/** A route may touch a border over at most this length (its end stubs cross it perpendicularly). */
const BORDER_RUN_TOLERANCE = 2;

/** Total length over which `path` runs ALONG (within half a pixel of) the border lines of `rects`. */
function borderRun(path: Point[], rects: readonly Rect[]): number {
  const near = 0.75;
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const horizontal = Math.abs(a.y - b.y) < 1e-6;
    const vertical = Math.abs(a.x - b.x) < 1e-6;
    if (!horizontal && !vertical) continue;
    for (const r of rects) {
      if (horizontal) {
        if (![r.y, r.y + r.h].some((y) => Math.abs(a.y - y) <= near)) continue;
        total += Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.w) - Math.max(Math.min(a.x, b.x), r.x));
      } else {
        if (![r.x, r.x + r.w].some((x) => Math.abs(a.x - x) <= near)) continue;
        total += Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.h) - Math.max(Math.min(a.y, b.y), r.y));
      }
    }
  }
  return total;
}

/** Does the segment a→b pass through the open interior of `r` (shrunk by `eps`)? Axis-aligned segments only. */
function crossesInterior(a: Point, b: Point, r: Rect, eps = 0.75): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x + eps && x0 < r.x + r.w - eps && y1 > r.y + eps && y0 < r.y + r.h - eps;
}

/** Perpendicular offsets tried (in order) to lift a hugging segment off a border. */
const UNHUG_OFFSETS = [10, -10, 8, -8, 6, -6, 4, -4, 3, -3, 2, -2, 1.5, -1.5];

/**
 * Last line of defence against a connector riding a table border (see `borderRun`): slide each offending INTERIOR
 * segment sideways to the nearest free line, as long as no segment then crosses a table and the two end stubs keep
 * their direction. Only geometry moves; the end rows are untouched. Paths that cannot be repaired are returned as is.
 */
function unhugBorders(path: Point[], borders: readonly Rect[], solids: readonly Rect[]): Point[] {
  let cur = path;
  for (let round = 0; round < 12; round++) {
    const total = borderRun(cur, borders);
    if (total <= BORDER_RUN_TOLERANCE || cur.length < 4) return cur;
    let repaired: Point[] | undefined;
    for (let i = 1; i + 2 < cur.length && !repaired; i++) {
      if (borderRun([cur[i]!, cur[i + 1]!], borders) <= BORDER_RUN_TOLERANCE) continue;
      const horizontal = Math.abs(cur[i]!.y - cur[i + 1]!.y) < 1e-6;
      for (const d of UNHUG_OFFSETS) {
        const cand = cur.map((q, k) => (k === i || k === i + 1 ? (horizontal ? { x: q.x, y: q.y + d } : { x: q.x + d, y: q.y }) : q));
        const along = (k: number, from: Point[]): number => (from[k + 1]!.x - from[k]!.x) * (cur[k + 1]!.x - cur[k]!.x) + (from[k + 1]!.y - from[k]!.y) * (cur[k + 1]!.y - cur[k]!.y);
        const len = (k: number): number => Math.hypot(cand[k + 1]!.x - cand[k]!.x, cand[k + 1]!.y - cand[k]!.y);
        const last = cand.length - 2;
        const keepsEnds = [0, last].every((k) => along(k, cand) > 0 && len(k) >= Math.min(1.5, Math.hypot(cur[k + 1]!.x - cur[k]!.x, cur[k + 1]!.y - cur[k]!.y)));
        const neighboursOk = [i - 1, i + 1].every((k) => k === 0 || k === last || len(k) >= 1);
        if (!keepsEnds || !neighboursOk) continue;
        if (cand.some((q, k) => k + 1 < cand.length && solids.some((r) => crossesInterior(q, cand[k + 1]!, r)))) continue;
        if (borderRun(cand, borders) < total) {
          repaired = cand;
          break;
        }
      }
    }
    if (!repaired) return cur;
    cur = repaired;
  }
  return cur;
}

const interiorVertices = (path: Point[]): Point[] => path.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));

/** Symbol scale so that the symbol fits in the connector's end segment (`seg`), leaving a sliver of line. */
function fitScale(kind: keyof typeof SYMBOL_LENGTH, seg: number): number {
  const need = SYMBOL_LENGTH[kind];
  return seg - 1 >= need ? 1 : Math.max(0.5, (seg - 1) / need);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function buildVFkEdges(input: VFkBuildInput): Record<Id, VFkEdgeGeom> {
  const { layouts, warnings } = input;
  const plans: Plan[] = [];
  for (const [edgeId, edge] of input.edges) {
    const plan = planEdge(input, edgeId, edge);
    if (plan) plans.push(plan);
  }
  for (const plan of plans) assignSides(plan, warnings, layouts);

  const orthogonal = input.routing === 'orthogonal';
  if (input.reuse) return buildDraftVEdges(input, plans);
  const manual = (p: Plan): boolean => p.edge.route?.mode === 'manual' && Array.isArray(p.edge.route.waypoints) && p.edge.route.waypoints.length > 0;
  const waypointsOf = (p: Plan): Point[] => (manual(p) ? p.edge.route.waypoints.filter(fin).map((w) => ({ x: w.x, y: w.y })) : []);

  /** One full placement + routing pass for the given anchor shifts. Plans' `s0/t0` are left set for that pass. */
  const pass = (shifts: ReadonlyMap<string, number>): Map<Id, Point[]> => {
    placeEnds(plans, shifts);
    const obstacles: RouteObstacle[] = [];
    for (const [nodeId, l] of layouts) {
      if (l.geom.orientation === 'horizontal') {
        obstacles.push({ id: nodeId, rect: l.geom.body }, { id: nodeId, rect: l.nameRect }, { id: bandId(nodeId), rect: l.geom.bounds });
      } else obstacles.push({ id: nodeId, rect: l.geom.bounds });
    }
    for (const p of plans) {
      obstacles.push({ id: zoneId(p.edgeId), rect: symbolZone(p.s0!, p.sSide), clearance: ZONE_PAD });
      obstacles.push({ id: zoneId(p.edgeId), rect: symbolZone(p.t0!, p.tSide), clearance: ZONE_PAD });
    }
    const ctx = { obstacles, clearance: CLEARANCE, stub: STUB };
    const request = (p: Plan): RouteRequest => ({
      key: p.edgeId,
      source: { point: p.s0!, side: p.sSide },
      target: { point: p.t0!, side: p.tSide },
      waypoints: manual(p) ? waypointsOf(p) : undefined,
      ignoreObstacleIds: [bandId(p.sNodeId), bandId(p.tNodeId), zoneId(p.edgeId)],
    });
    // `straight` draws stub + one straight segment + stub, but a line through a foreign table would suggest the wrong
    // referenced row: such (auto) edges are routed around the tables instead.
    const useRouter = new Set<Plan>();
    for (const p of plans) {
      if (orthogonal) useRouter.add(p);
      else if (!manual(p)) {
        const path = straightPath(p, []);
        if ([...layouts].some(([nodeId, l]) => nodeId !== p.sNodeId && nodeId !== p.tNodeId && pathHitsRect(path, l.geom.bounds))) useRouter.add(p);
      }
    }
    const requests = plans.filter((p) => useRouter.has(p)).map(request);
    const routed = requests.length > 0 ? routeOrthogonal(requests, ctx) : {};
    // The router falls back to running exactly ON an obstacle's edge when the lane between two close tables is
    // narrower than 2 x clearance. A connector must never ride a table border (it would suggest the wrong row), so such
    // routes are retried with a thinner clearance, keeping the first one that leaves every border.
    const solids = [...layouts.values()].flatMap((l) => (l.geom.orientation === 'horizontal' ? [l.geom.body] : [l.geom.bounds]));
    const noCross = [...layouts.values()].flatMap((l) => (l.geom.orientation === 'horizontal' ? [l.geom.body, l.nameRect] : [l.geom.bounds]));
    for (const req of requests) {
      let best = routed[req.key]!;
      let bestRun = borderRun(best, solids);
      for (const clearance of THIN_CLEARANCES) {
        if (bestRun <= BORDER_RUN_TOLERANCE) break;
        const retry = routeOrthogonal([req], { ...ctx, clearance })[req.key];
        if (!retry) continue;
        const run = borderRun(retry, solids);
        if (run < bestRun) (best = retry, (bestRun = run));
      }
      routed[req.key] = unhugBorders(best, solids, noCross);
    }
    const out = new Map<Id, Point[]>();
    for (const p of plans) out.set(p.edgeId, useRouter.has(p) ? routed[p.edgeId]! : straightPath(p, waypointsOf(p)));
    return out;
  };

  let shifts = new Map<string, number>();
  let paths = pass(shifts);
  // Overlap repair: two connectors that run on top of each other (typically because two tables' rows are aligned) are
  // separated by moving ONE end's anchor along its own row (never to another row). Greedy, bounded.
  // Budget: each pass re-routes every edge, so big diagrams get fewer attempts (none beyond ~80 edges).
  const maxPasses = Math.min(24, Math.floor(1500 / Math.max(1, plans.length)));
  let passes = 0;
  if (orthogonal && plans.length > 1 && plans.length <= 80) {
    let cost = countOverlaps(paths);
    for (let trial = 0; trial < 12 && cost > 0 && passes < maxPasses; trial++) {
      const hit = findOverlap(paths);
      if (!hit) break;
      let improved = false;
      for (const key of hit.ends) {
        const cut = key.lastIndexOf(':');
        const edgeId = key.slice(0, cut);
        const role = key.slice(cut + 1) as 's' | 't';
        const plan = plans.find((q) => q.edgeId === edgeId);
        if (!plan || (plan.edge.route && (role === 's' ? plan.sSpec : plan.tSpec)?.offset !== undefined)) continue;
        for (const delta of [8, -8, 5, -5]) {
          const cand = new Map(shifts);
          cand.set(key, (shifts.get(key) ?? 0) + delta);
          if (passes++ >= maxPasses) break;
          const p2 = pass(cand);
          const c2 = countOverlaps(p2);
          if (c2 < cost) {
            shifts = cand;
            paths = p2;
            cost = c2;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (!improved) break;
    }
    if (passes > 0) paths = pass(shifts); // leaves s0/t0 consistent with the chosen shifts
  }

  const placedLabels: Rect[] = [];
  const tableRects = [...layouts.values()].map((l) => inflateRect(l.geom.bounds, 2));
  const out: Record<Id, VFkEdgeGeom> = {};
  for (const p of plans) out[p.edgeId] = assemble(input, p, paths.get(p.edgeId)!, tableRects, placedLabels);
  return out;
}

/** DRAFT mode: reuse untouched edges, stub + one elbow (no router, no overlap repair, no label search) for the others. */
function buildDraftVEdges(input: VFkBuildInput, plans: Plan[]): Record<Id, VFkEdgeGeom> {
  const out: Record<Id, VFkEdgeGeom> = {};
  const live: Plan[] = [];
  for (const p of plans) {
    const prev = input.reuse!(p.edgeId, p.sNodeId, p.tNodeId);
    if (prev) out[p.edgeId] = prev as VFkEdgeGeom;
    else live.push(p);
  }
  placeEnds(live, new Map());
  const manual = (p: Plan): boolean => p.edge.route?.mode === 'manual' && Array.isArray(p.edge.route.waypoints) && p.edge.route.waypoints.length > 0;
  const waypointsOf = (p: Plan): Point[] => (manual(p) ? p.edge.route.waypoints.filter(fin).map((w) => ({ x: w.x, y: w.y })) : []);
  const requests: RouteRequest[] = live
    .filter(manual)
    .map((p) => ({ key: p.edgeId, source: { point: p.s0!, side: p.sSide }, target: { point: p.t0!, side: p.tSide }, waypoints: waypointsOf(p) }));
  const routed = requests.length > 0 ? routeOrthogonal(requests, { obstacles: [], clearance: CLEARANCE, stub: STUB }) : {};
  for (const p of live) {
    const path = manual(p) ? routed[p.edgeId]! : input.routing === 'orthogonal' ? draftVPath(p) : straightPath(p, []);
    out[p.edgeId] = assemble(input, p, path, [], []);
  }
  return out;
}

const isVSide = (s: Side): boolean => s === 'top' || s === 'bottom';

function draftVPath(p: Plan): Point[] {
  const s0 = p.s0!;
  const t0 = p.t0!;
  const sn = sideNormal(p.sSide);
  const tn = sideNormal(p.tSide);
  const s1 = { x: s0.x + sn.x * STUB, y: s0.y + sn.y * STUB };
  const t1 = { x: t0.x + tn.x * STUB, y: t0.y + tn.y * STUB };
  const mid: Point[] =
    isVSide(p.sSide) && isVSide(p.tSide)
      ? [{ x: s1.x, y: (s1.y + t1.y) / 2 }, { x: t1.x, y: (s1.y + t1.y) / 2 }]
      : !isVSide(p.sSide) && !isVSide(p.tSide)
        ? [{ x: (s1.x + t1.x) / 2, y: s1.y }, { x: (s1.x + t1.x) / 2, y: t1.y }]
        : isVSide(p.sSide)
          ? [{ x: s1.x, y: t1.y }]
          : [{ x: t1.x, y: s1.y }];
  return cleanOrthogonal([s0, s1, ...mid, t1, t0]);
}

interface Overlap {
  /** `edgeId:s|t` keys of the ends whose end segment takes part in the overlap. */
  ends: string[];
}

function overlapsOf(paths: Map<Id, Point[]>): Overlap[] {
  const items = [...paths.entries()];
  const found: Overlap[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [ea, a] = items[i]!;
      const [eb, b] = items[j]!;
      const ends: string[] = [];
      let hit = false;
      for (let p = 0; p + 1 < a.length; p++) {
        for (let q = 0; q + 1 < b.length; q++) {
          const ha = Math.abs(a[p]!.y - a[p + 1]!.y) < 1e-6;
          const hb = Math.abs(b[q]!.y - b[q + 1]!.y) < 1e-6;
          if (ha !== hb) continue;
          const [k, o] = ha ? (['y', 'x'] as const) : (['x', 'y'] as const);
          if (Math.abs(a[p]![k] - b[q]![k]) > 1.5) continue;
          const ov = Math.min(Math.max(a[p]![o], a[p + 1]![o]), Math.max(b[q]![o], b[q + 1]![o])) - Math.max(Math.min(a[p]![o], a[p + 1]![o]), Math.min(b[q]![o], b[q + 1]![o]));
          if (ov <= 2) continue;
          hit = true;
          if (p === 0) ends.push(`${ea}:s`);
          if (p + 2 === a.length) ends.push(`${ea}:t`);
          if (q === 0) ends.push(`${eb}:s`);
          if (q + 2 === b.length) ends.push(`${eb}:t`);
        }
      }
      if (hit) found.push({ ends });
    }
  }
  return found;
}

const countOverlaps = (paths: Map<Id, Point[]>): number => overlapsOf(paths).length;
const findOverlap = (paths: Map<Id, Point[]>): Overlap | undefined => overlapsOf(paths).find((o) => o.ends.length > 0);

function assemble(input: VFkBuildInput, plan: Plan, path: Point[], tableRects: Rect[], placedLabels: Rect[]): VFkEdgeGeom {
  const { edge, fk } = plan;
  const model = input.model;
  const card = fkCardinality(model, fk);
  const childKind = childSymbolKind(card);
  const parentKind = parentSymbolKind(card);

  // Symbols shrink only when the connector's end segment is shorter than the symbol.
  const segLen = (a: Point, b: Point): number => distance(a, b);
  const n = path.length;
  const firstSeg = n >= 2 ? segLen(path[0]!, path[1]!) : 0;
  const lastSeg = n >= 2 ? segLen(path[n - 1]!, path[n - 2]!) : 0;
  const shared = n === 2;
  const sAvail = shared ? firstSeg / 2 : firstSeg;
  const tAvail = shared ? lastSeg / 2 : lastSeg;
  const child: VSymbolGeom = buildSymbol(childKind, path[0]!, plan.sSide, fitScale(childKind, sAvail));
  const parent: VSymbolGeom = buildSymbol(parentKind, path[n - 1]!, plan.tSide, fitScale(parentKind, tAvail));

  // Connector stroke runs between the symbol bases; on a degenerate (tables touching) layout it keeps the full path.
  let strokePoints = [child.base, ...path.slice(1, -1), parent.base];
  const along = (a: Point, b: Point, ref: Point, refTo: Point): number => (b.x - a.x) * (refTo.x - ref.x) + (b.y - a.y) * (refTo.y - ref.y);
  if (n === 2 && along(child.base, parent.base, path[0]!, path[1]!) <= 0) strokePoints = path.map((q) => ({ ...q }));
  else strokePoints = dedupePoints(strokePoints);

  const sRect = plan.sRow.rect;
  const tRect = plan.tRow.rect;
  const first = plan.pairs[0]!;
  const ends: [EdgeEndGeom, EdgeEndGeom] = [
    { nodeId: plan.sNodeId, columnId: first.sourceColumnId, at: path[0]!, side: plan.sSide, anchorRect: sRect },
    { nodeId: plan.tNodeId, columnId: first.targetColumnId, at: path[n - 1]!, side: plan.tSide, anchorRect: tRect },
  ];

  // Composite FKs: dots on the other pairs' rows (one logical constraint, one symbol pair).
  const memberMarks: VMemberMark[] = [];
  const memberLinks: Point[][] = [];
  const mark = (end: 'source' | 'target', row: VTableRowGeom, side: Side, skip: Id): void => {
    if (row.columnId === skip) return;
    const nrm = sideNormal(side);
    const mid = pointOnBorder(row.rect, side, isVerticalSide(side) ? row.rect.x + row.rect.w / 2 : row.rect.y + row.rect.h / 2);
    const at = { x: mid.x + nrm.x * MEMBER_DOT_R, y: mid.y + nrm.y * MEMBER_DOT_R };
    memberMarks.push({ columnId: row.columnId, end, at, side, r: MEMBER_DOT_R });
    // A thin bus along the border joins the dot to the attached row's connector.
    const main = end === 'source' ? path[0]! : path[n - 1]!;
    const from = isVerticalSide(side) ? { x: main.x, y: at.y } : { x: at.x, y: main.y };
    memberLinks.push([from, at]);
  };
  for (const p of plan.pairs.slice(1)) {
    mark('source', plan.sL.geom.rows[p.sIdx]!, plan.sSide, first.sourceColumnId);
    mark('target', plan.tL.geom.rows[p.tIdx]!, plan.tSide, first.targetColumnId);
  }

  const labels: EdgeLabelGeom[] = [];
  if (edge.labelVisible === true) {
    const text = fk.label ?? describeForeignKey(model, fk);
    const font = { family: input.fontFamily, size: Math.max(10, input.fontSize - 2) };
    const width = input.measure(text, font);
    const label = placeLabel(text, font, width, path, tableRects, placedLabels, edge.labelOffsets?.main);
    labels.push({ id: 'main', label });
    placedLabels.push(labelRect(label));
  }

  const pts: Point[] = [...path, ...strokePoints, ...symbolPoints(child), ...symbolPoints(parent), ...memberLinks.flat(), ...memberMarks.flatMap((m) => [{ x: m.at.x - m.r, y: m.at.y - m.r }, { x: m.at.x + m.r, y: m.at.y + m.r }])];
  const rects: Rect[] = [rectOfPoints(pts), ...labels.map((l) => labelRect(l.label))];
  const bounds = inflateRect(unionRects(rects)!, plan.strokeWidth / 2 + 1);
  const manual = edge.route?.mode === 'manual' && Array.isArray(edge.route.waypoints) && edge.route.waypoints.length > 0;
  return {
    kind: 'v-fk',
    edgeId: plan.edgeId,
    ref: edge.ref,
    sourceNodeId: plan.sNodeId,
    targetNodeId: plan.tNodeId,
    paths: [path],
    bounds,
    ends,
    bendHandles: manual ? edge.route.waypoints.map((at, index) => ({ index, at: { x: at.x, y: at.y } })) : [],
    autoWaypoints: input.routing === 'orthogonal' ? interiorVertices(path) : [],
    labels,
    points: path,
    strokePoints,
    childSymbol: child,
    parentSymbol: parent,
    cardinality: card,
    sourceColumnId: first.sourceColumnId,
    targetColumnId: first.targetColumnId,
    pairs: plan.pairs.map((p) => ({ sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId })),
    composite: plan.pairs.length > 1,
    memberMarks,
    memberLinks,
    sourceSide: plan.sSide,
    targetSide: plan.tSide,
    sourceCell: sRect,
    targetCell: tRect,
  };
}

/** Label position: midpoint of the longest segments first, skipping spots over a table or another label. */
function placeLabel(
  text: string,
  font: { family: string; size: number },
  width: number,
  path: Point[],
  tables: Rect[],
  placed: Rect[],
  offset?: Point,
): TextLabel {
  const segs = path
    .slice(1)
    .map((b, i) => ({ a: path[i]!, b, len: distance(path[i]!, b) }))
    .filter((s) => s.len > 0)
    .sort((x, y) => y.len - x.len);
  const ox = offset && Number.isFinite(offset.x) ? offset.x : 0;
  const oy = offset && Number.isFinite(offset.y) ? offset.y : 0;
  const make = (at: Point): TextLabel => ({ text, x: at.x + ox, y: at.y + oy, anchor: 'middle', font, width, backdrop: true });
  const free = (l: TextLabel): boolean => {
    const r = labelRect(l);
    return !tables.some((t) => rectsIntersect(t, r)) && !placed.some((q) => rectsIntersect(inflateRect(q, 2), r));
  };
  for (const s of segs) {
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    const l = make({ x: mx, y: my });
    if (offset || free(l)) return l;
  }
  // No segment midpoint is free (short segments next to a table): slide the label beside the line instead.
  const gap = font.size * 0.9 + 3;
  for (const s of segs) {
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    const horizontal = Math.abs(s.a.y - s.b.y) < 1e-6;
    const tries = horizontal
      ? [{ x: mx, y: my - gap }, { x: mx, y: my + gap }]
      : [{ x: mx + width / 2 + 6, y: my }, { x: mx - width / 2 - 6, y: my }];
    for (const at of tries) {
      const l = make(at);
      l.backdrop = false;
      if (free(l)) return l;
    }
  }
  const s = segs[0];
  return make(s ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } : (path[0] ?? { x: 0, y: 0 }));
}
