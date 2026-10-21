/**
 * Foreign-key connectors of the horizontal schema.
 *
 * INVARIANT (the reason this file is organised the way it is): which column a connector refers to is decided ONCE, in
 * `planEdge`, from the foreign key's column pairs. Everything afterwards (sides, anchor spreading, routing, bundle
 * offsets, manual waypoints) only moves geometry between the two already-chosen cells; no step reads a coordinate to
 * decide a column. Moving a table, dragging an anchor or editing waypoints therefore cannot re-point an arrow.
 *
 * Pipeline: plan (pairs → cells) → sides → anchor spreading → routing (one batch, shared obstacles) → branch geometry
 * (arrows, bundle offsets, brackets) → labels.
 */
import { describeForeignKey } from '@/model/queries';
import type { AnchorSpec, DiagramEdge, ForeignKey, Id, Point, RelationalModel, RelationalSchemaOptions } from '@/model/types';
import type { ArrowGeom, EdgeEndGeom, EdgeLabelGeom, MeasureText, Rect, Side, TextLabel } from '../base';
import {
  dedupePoints,
  distance,
  inflateRect,
  labelRect,
  offsetPolyline,
  rectOfPoints,
  rectsIntersect,
  sideNormal,
  unionRects,
} from '../geometry';
import { cleanOrthogonal, nudgeRoutes, orthogonalizeThrough, routeOrthogonal, separateRoutes } from '../routing';
import type { Movable, RouteObstacle } from '../routing';
import type { RouteRequest } from '../routing/types';
import {
  ANCHOR_INSET,
  ARROW_HALF_WIDTH,
  ARROW_LEN,
  BRACKET_INSET,
  BRACKET_OFFSET,
  BRANCH_GAP,
  CLEARANCE,
  DEFAULT_FK_STROKE_WIDTH,
  MIN_LANE_GAP,
  STUB,
} from './constants';
import type { EdgeReuse } from '../draft';
import { borderInterval, type TableLayout } from './table';
import type { FkBranchGeom, FkEdgeGeom, HTableCellGeom } from './types';

export interface FkBuildInput {
  model: RelationalModel;
  /** Table layouts keyed by DiagramNode id. */
  layouts: ReadonlyMap<Id, TableLayout>;
  /** DiagramNode id of each relation shown in the diagram. */
  nodeOfRelation: ReadonlyMap<Id, Id>;
  edges: Array<[Id, DiagramEdge]>;
  rel: RelationalSchemaOptions;
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
  sCell: HTableCellGeom;
  tCell: HTableCellGeom;
}

/** One drawn arrow: a column pair (`branches` style) or the whole bracketed span (`bracket` style). */
interface BranchPlan {
  /** Pair whose columns identify this branch (the first pair for a bracket). */
  pair: Pair;
  /** Cell rect (branches) or the union of the spanned cells (bracket). */
  sRect: Rect;
  tRect: Rect;
  /** Index of the cell (or `first-last` of the span) used to group anchors on one border. */
  sKey: string;
  tKey: string;
  sIdx: number;
  tIdx: number;
  sSide: Side;
  tSide: Side;
  sSpec?: AnchorSpec;
  tSpec?: AnchorSpec;
  s0?: Point;
  t0?: Point;
}

interface Plan {
  edgeId: Id;
  edge: DiagramEdge;
  fk: ForeignKey;
  sNodeId: Id;
  tNodeId: Id;
  sLayout: TableLayout;
  tLayout: TableLayout;
  pairs: Pair[];
  style: 'branches' | 'bracket';
  branches: BranchPlan[];
  /** Sides that may be flipped by the auto rules (explicit anchors never are). */
  bundle: boolean;
  strokeWidth: number;
  /** Centreline a manual NON-bundled composite's lanes are offset from (set while routing; handles are laid along it). */
  centre?: Point[];
  /** SA-18: every branch is a straight vertical connector (aligned anchors): no lane bundle. */
  straight?: boolean;
}

const isVerticalSide = (s: Side): boolean => s === 'top' || s === 'bottom';
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const sameSide = (a: Side, b: Side): boolean => a === b;

// ---------------------------------------------------------------------------
// Planning: foreign key pairs → cells. The ONLY place columns are chosen.
// ---------------------------------------------------------------------------

function planEdge(input: FkBuildInput, edgeId: Id, edge: DiagramEdge): Plan | undefined {
  const { model, layouts, nodeOfRelation, warnings } = input;
  if (edge.ref.kind !== 'foreignKey') {
    warnings.push(`unsupported-edge:${edgeId}`);
    return undefined;
  }
  const fk = model.foreignKeys[edge.ref.foreignKeyId];
  const sNodeId = fk ? nodeOfRelation.get(fk.sourceRelationId) : undefined;
  const tNodeId = fk ? nodeOfRelation.get(fk.targetRelationId) : undefined;
  const sLayout = sNodeId ? layouts.get(sNodeId) : undefined;
  const tLayout = tNodeId ? layouts.get(tNodeId) : undefined;
  if (!fk || !sNodeId || !tNodeId || !sLayout || !tLayout) {
    warnings.push(`dangling-fk-edge:${edgeId}`);
    return undefined;
  }
  const pairs: Pair[] = [];
  fk.columns.forEach((p, index) => {
    const sIdx = sLayout.geom.cells.findIndex((c) => c.columnId === p.sourceColumnId);
    const tIdx = tLayout.geom.cells.findIndex((c) => c.columnId === p.targetColumnId);
    if (sIdx < 0 || tIdx < 0) {
      warnings.push(`fk-column-missing:${fk.id}:${index}`);
      return;
    }
    pairs.push({
      index,
      sourceColumnId: p.sourceColumnId,
      targetColumnId: p.targetColumnId,
      sIdx,
      tIdx,
      sCell: sLayout.geom.cells[sIdx]!,
      tCell: tLayout.geom.cells[tIdx]!,
    });
  });
  if (pairs.length === 0) {
    warnings.push(`dangling-fk-edge:${edgeId}`);
    return undefined;
  }
  const strokeWidth = edge.style?.strokeWidth ?? DEFAULT_FK_STROKE_WIDTH;
  const branchSpec = (pair: Pair) => edge.route.branchAnchors?.[pair.sourceColumnId];

  // Bracket is honest or not drawn (ARCHITECTURE §4): contiguous cells on both sides, in matching left-to-right order.
  let style: 'branches' | 'bracket' = 'branches';
  if (input.rel.compositeFkStyle === 'bracket' && pairs.length > 1) {
    const contiguous = pairs.every((p, i) => i === 0 || (p.sIdx === pairs[i - 1]!.sIdx + 1 && p.tIdx === pairs[i - 1]!.tIdx + 1));
    if (contiguous && pairs.length === fk.columns.length) style = 'bracket';
    else warnings.push(`fk-bracket-fallback:${fk.id}`);
  }

  const branches: BranchPlan[] = [];
  if (style === 'bracket') {
    const first = pairs[0]!;
    const last = pairs[pairs.length - 1]!;
    const sRect = unionRects(pairs.map((p) => p.sCell.rect))!;
    const tRect = unionRects(pairs.map((p) => p.tCell.rect))!;
    branches.push({
      pair: first,
      sRect,
      tRect,
      sKey: `${first.sIdx}-${last.sIdx}`,
      tKey: `${first.tIdx}-${last.tIdx}`,
      sIdx: first.sIdx,
      tIdx: first.tIdx,
      sSide: 'bottom',
      tSide: 'top',
      sSpec: branchSpec(first)?.source ?? edge.route.sourceAnchor,
      tSpec: branchSpec(first)?.target ?? edge.route.targetAnchor,
    });
  } else {
    for (const pair of pairs) {
      branches.push({
        pair,
        sRect: pair.sCell.rect,
        tRect: pair.tCell.rect,
        sKey: String(pair.sIdx),
        tKey: String(pair.tIdx),
        sIdx: pair.sIdx,
        tIdx: pair.tIdx,
        sSide: 'bottom',
        tSide: 'top',
        sSpec: branchSpec(pair)?.source ?? edge.route.sourceAnchor,
        tSpec: branchSpec(pair)?.target ?? edge.route.targetAnchor,
      });
    }
  }
  return { edgeId, edge, fk, sNodeId, tNodeId, sLayout, tLayout, pairs, style, branches, bundle: false, strokeWidth };
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/** Default vertical relationship between two tables → the borders connectors should use. */
function autoSides(p: Plan): ['top' | 'bottom', 'top' | 'bottom'] {
  if (p.sNodeId === p.tNodeId) return ['bottom', 'bottom'];
  const s = p.sLayout.geom;
  const t = p.tLayout.geom;
  const gap = 2 * STUB;
  if (t.bounds.y > s.row.y + s.row.h + gap) return ['bottom', 'top'];
  if (t.row.y + t.row.h + gap < s.bounds.y) return ['top', 'bottom'];
  return ['bottom', 'bottom'];
}

function resolveSide(
  spec: AnchorSpec | undefined,
  idx: number,
  count: number,
  auto: 'top' | 'bottom',
  allowHorizontal: boolean,
  warn: (side: string) => void,
): Side {
  if (!spec || spec.side === 'auto') return auto;
  if (spec.side === 'top' || spec.side === 'bottom') return spec.side;
  if (allowHorizontal && spec.side === 'left' && idx === 0) return 'left';
  if (allowHorizontal && spec.side === 'right' && idx === count - 1) return 'right';
  warn(spec.side);
  return auto;
}

function assignSides(p: Plan, warnings: string[]): void {
  const [autoS, autoT] = autoSides(p);
  const horizontalOk = p.style === 'branches';
  /**
   * Top border under the relation name may be blocked. A blocked end uses the bottom border, except the FIRST cell of a
   * row, which may use its (always free) left border: that avoids wrapping a connector around the whole table. A bracket's
   * bar spans several cells, so ANY overlap with the name blocks it.
   */
  const auto = (want: 'top' | 'bottom', layout: TableLayout, rect: Rect, idx: number): Side => {
    if (want === 'bottom') return 'bottom';
    const blocked =
      p.style === 'bracket'
        ? layout.nameAbove && layout.nameRect.x - 6 < rect.x + rect.w && layout.nameRect.x + layout.nameRect.w + 6 > rect.x
        : borderInterval(layout, rect, 'top') === undefined;
    if (!blocked) return 'top';
    return horizontalOk && idx === 0 && layout.nameAbove ? 'left' : 'bottom';
  };
  for (const b of p.branches) {
    const aS = auto(autoS, p.sLayout, b.sRect, b.sIdx);
    const aT = auto(autoT, p.tLayout, b.tRect, b.tIdx);
    const pick = (spec: AnchorSpec | undefined, idx: number, count: number, a: Side, end: 'source' | 'target'): Side => {
      if (!spec || spec.side === 'auto') return a;
      return resolveSide(spec, idx, count, a === 'top' || a === 'bottom' ? a : 'bottom', horizontalOk, (s) =>
        warnings.push(`anchor-coerced:${p.edgeId}:${end}:${s}`),
      );
    };
    b.sSide = pick(b.sSpec, b.sIdx, p.sLayout.geom.cells.length, aS, 'source');
    b.tSide = pick(b.tSpec, b.tIdx, p.tLayout.geom.cells.length, aT, 'target');
  }
  unifyCompositeSides(p);
}

/**
 * UX-5: the branches of an auto-routed composite FK leave (and enter) the SAME border. When the automatic rules gave the
 * branches different sides (the relation name blocks the top of one cell, so it fell back to the bottom or to the left
 * border) the whole FK takes the border every branch can use, so the branches form ONE bundle instead of independent
 * connectors looping round their tables. A side a user fixed explicitly is never overridden.
 */
function unifyCompositeSides(p: Plan): void {
  if (p.style !== 'branches' || p.branches.length < 2) return;
  for (const end of ['s', 't'] as const) {
    const side = (b: BranchPlan): Side => (end === 's' ? b.sSide : b.tSide);
    const spec = (b: BranchPlan): AnchorSpec | undefined => (end === 's' ? b.sSpec : b.tSpec);
    if (p.branches.every((b) => side(b) === side(p.branches[0]!))) continue;
    if (p.branches.some((b) => spec(b) && spec(b)!.side !== 'auto')) continue;
    const layout = end === 's' ? p.sLayout : p.tLayout;
    const rect = (b: BranchPlan): Rect => (end === 's' ? b.sRect : b.tRect);
    // the preferred border when no cell is blocked, else the bottom (always free)
    const want = end === 's' ? autoSides(p)[0] : autoSides(p)[1];
    const free = want === 'bottom' || p.branches.every((b) => borderInterval(layout, rect(b), want) !== undefined);
    const chosen: Side = free ? want : 'bottom';
    for (const b of p.branches) {
      if (end === 's') b.sSide = chosen;
      else b.tSide = chosen;
    }
  }
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

interface End {
  plan: Plan;
  branch: BranchPlan;
  role: 's' | 't';
  nodeId: Id;
  layout: TableLayout;
  rect: Rect;
  key: string;
  side: Side;
  spec?: AnchorSpec;
  peer: number;
  order: number;
  /** SA-18: x both ends of an aligned composite branch share (a straight vertical connector). */
  align?: number;
}

function collectEnds(plans: Plan[]): End[] {
  const ends: End[] = [];
  let order = 0;
  for (const plan of plans) {
    for (const b of plan.branches) {
      const sCenter = b.sRect.x + b.sRect.w / 2;
      const tCenter = b.tRect.x + b.tRect.w / 2;
      const sMidY = b.sRect.y + b.sRect.h / 2;
      const tMidY = b.tRect.y + b.tRect.h / 2;
      ends.push({
        plan,
        branch: b,
        role: 's',
        nodeId: plan.sNodeId,
        layout: plan.sLayout,
        rect: b.sRect,
        key: b.sKey,
        side: b.sSide,
        spec: b.sSpec,
        peer: isVerticalSide(b.sSide) ? tCenter : tMidY,
        order: order++,
      });
      ends.push({
        plan,
        branch: b,
        role: 't',
        nodeId: plan.tNodeId,
        layout: plan.tLayout,
        rect: b.tRect,
        key: b.tKey,
        side: b.tSide,
        spec: b.tSpec,
        peer: isVerticalSide(b.tSide) ? sCenter : sMidY,
        order: order++,
      });
    }
  }
  return ends;
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

/**
 * SA-18: a composite FK between vertically stacked tables whose source and target cells overlap horizontally leaves and enters
 * at ONE x per branch (inside both cells' usable border intervals), so the branch is a straight vertical connector instead of
 * a zig-zag. Only when EVERY branch can be aligned (otherwise the bundle with its jogs reads better than a mix) and every end
 * is alone on its cell border (a shared border keeps its even spread). Sets `End.align` and `Plan.straight`.
 */
function alignCompositeEnds(ends: End[], groups: Map<string, End[]>): void {
  const byPlan = new Map<Plan, End[]>();
  for (const e of ends) byPlan.set(e.plan, [...(byPlan.get(e.plan) ?? []), e]);
  for (const [plan, list] of byPlan) {
    if (plan.style !== 'branches' || plan.branches.length < 2) continue;
    if (plan.edge.route.mode === 'manual' && plan.edge.route.waypoints.length > 0) continue;
    const found: Array<[End, End, number]> = [];
    for (const b of plan.branches) {
      const s = list.find((e) => e.branch === b && e.role === 's');
      const t = list.find((e) => e.branch === b && e.role === 't');
      if (!s || !t || !isVerticalSide(s.side) || !isVerticalSide(t.side) || s.side === t.side) break;
      if (s.spec?.offset !== undefined || t.spec?.offset !== undefined) break;
      if (groups.get(`${s.nodeId}|${s.key}|${s.side}`)!.length !== 1 || groups.get(`${t.nodeId}|${t.key}|${t.side}`)!.length !== 1) break;
      const full = (e: End): [number, number] => [e.rect.x + ANCHOR_INSET, e.rect.x + e.rect.w - ANCHOR_INSET];
      const su = borderInterval(s.layout, s.rect, s.side) ?? full(s);
      const tu = borderInterval(t.layout, t.rect, t.side) ?? full(t);
      const lo = Math.max(su[0], tu[0]);
      const hi = Math.min(su[1], tu[1]);
      if (hi - lo < MIN_ALIGN_OVERLAP) break;
      found.push([s, t, (lo + hi) / 2]);
    }
    if (found.length !== plan.branches.length) continue;
    // aligned x of the branches must keep their left-to-right order (no crossing)
    const xs = found.map((f) => f[2]);
    const order = (a: number[]) => a.map((_, i) => i).sort((p, q) => a[p]! - a[q]!);
    const srcOrder = order(found.map((f) => f[0].rect.x));
    if (srcOrder.some((i, k) => i !== order(xs)[k])) continue;
    for (const [s, t, x] of found) {
      s.align = x;
      t.align = x;
    }
    plan.straight = true;
  }
}

/** Source and target cells must share at least this much usable border width for a straight connector. */
const MIN_ALIGN_OVERLAP = 6;

/**
 * Place every end on its cell border. Ends sharing a (table, cell, side) are spread evenly over the usable interval,
 * ordered by where their peer lies (so connectors heading left take the left slots and rarely cross). An explicit
 * `AnchorSpec.offset` pins the end inside ITS OWN cell (clamped), never onto a neighbour.
 */
function placeEnds(ends: End[]): void {
  const groups = new Map<string, End[]>();
  for (const e of ends) {
    const k = `${e.nodeId}|${e.key}|${e.side}`;
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  alignCompositeEnds(ends, groups);
  const assign = (e: End, along: number) => {
    const point = pointOnBorder(e.rect, e.side, along);
    const bracket = e.plan.style === 'bracket';
    // A bracket's arrow starts on the bracket bar (standing off the border), but ENDS on the border itself.
    if (bracket && e.role === 's') {
      const n = sideNormal(e.side);
      point.x += n.x * BRACKET_OFFSET;
      point.y += n.y * BRACKET_OFFSET;
    }
    if (e.role === 's') e.branch.s0 = point;
    else e.branch.t0 = point;
  };
  for (const list of groups.values()) {
    const first = list[0]!;
    const vertical = isVerticalSide(first.side);
    const full: [number, number] = vertical
      ? [first.rect.x + ANCHOR_INSET, first.rect.x + first.rect.w - ANCHOR_INSET]
      : [first.rect.y + ANCHOR_INSET, first.rect.y + first.rect.h - ANCHOR_INSET];
    const usable = borderInterval(first.layout, first.rect, first.side) ?? full;
    const auto: End[] = [];
    for (const e of list) {
      if (e.spec?.offset !== undefined) {
        const span = vertical ? e.rect.w : e.rect.h;
        const origin = vertical ? e.rect.x : e.rect.y;
        assign(e, clamp(origin + span * e.spec.offset, full[0], full[1]));
      } else auto.push(e);
    }
    auto.sort((a, b) => a.peer - b.peer || a.order - b.order);
    auto.forEach((e, k) => {
      if (e.align !== undefined) return assign(e, clamp(e.align, usable[0], usable[1]));
      // A bracket arrow sits at the middle of its span; spreading applies to single-cell ends only.
      const spread = e.plan.style === 'bracket' ? 0.5 : (k + 1) / (auto.length + 1);
      assign(e, usable[0] + (usable[1] - usable[0]) * spread);
    });
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function makeArrow(points: Point[], side: Side): { points: Point[]; strokePoints: Point[]; arrow: ArrowGeom } {
  const tip = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const seg = distance(prev, tip) || 1;
  const len = Math.min(ARROW_LEN, seg * 0.9);
  const ux = (tip.x - prev.x) / seg;
  const uy = (tip.y - prev.y) / seg;
  const base = { x: tip.x - ux * len, y: tip.y - uy * len };
  const half = ARROW_HALF_WIDTH * (len / ARROW_LEN);
  const polygon = [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }];
  return {
    points,
    strokePoints: [...points.slice(0, -1), base],
    arrow: { tip, side, base, polygon },
  };
}

function bracketPoints(span: Rect, side: Side): Point[] {
  const n = sideNormal(side);
  const x0 = span.x + BRACKET_INSET;
  const x1 = span.x + span.w - BRACKET_INSET;
  const yb = side === 'top' ? span.y : span.y + span.h;
  const yf = yb + n.y * BRACKET_OFFSET;
  return [
    { x: x0, y: yb },
    { x: x0, y: yf },
    { x: x1, y: yf },
    { x: x1, y: yb },
  ];
}

/** Vertices strictly inside a path (what a manual route needs to reproduce it). */
const interiorVertices = (path: Point[]): Point[] => path.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));

/**
 * One branch of a bundle: leaves ITS cell, takes a stub of height `hs`, jogs (at that height) onto its parallel lane of
 * the offset centreline, follows the lane, jogs back at height `ht` and arrives at ITS target cell. Branches never share
 * a trunk.
 */
function bundleBranchPath(s0: Point, sSide: Side, t0: Point, tSide: Side, lane: Point[], hs = STUB, ht = STUB): Point[] {
  const yS = s0.y + sideNormal(sSide).y * hs;
  const yT = t0.y + sideNormal(tSide).y * ht;
  const first = lane[0]!;
  const last = lane[lane.length - 1]!;
  return cleanOrthogonal([
    s0,
    { x: s0.x, y: yS },
    { x: first.x, y: yS },
    ...lane.slice(1, -1),
    { x: last.x, y: yT },
    { x: t0.x, y: yT },
    t0,
  ]);
}

/**
 * Final paths of a bundle. The jog height of a branch end starts at STUB (never beyond the first/last corner of its lane,
 * which would make the path double back) and is lowered in steps when the jog would run on top of another branch.
 * Returns undefined when no combination keeps the branches apart (the caller then routes the branches separately).
 */
function bundlePaths(plan: Plan, lanes: Point[][]): Point[][] | undefined {
  const bs = plan.branches;
  const room = (lane: Point[], from: Point, end: 'first' | 'last'): number => {
    const corner = end === 'first' ? lane[1] : lane[lane.length - 2];
    const dist = corner && lane.length > 2 ? Math.abs(corner.y - from.y) : Infinity;
    return Math.min(STUB, dist - 3);
  };
  const hs = bs.map((b, i) => room(lanes[i]!, b.s0!, 'first'));
  const ht = bs.map((b, i) => room(lanes[i]!, b.t0!, 'last'));
  if ([...hs, ...ht].some((h) => h < 4)) return undefined;
  const steps = [0, 3, 6, 9];
  const build = (i: number): Point[] => bundleBranchPath(bs[i]!.s0!, bs[i]!.sSide, bs[i]!.t0!, bs[i]!.tSide, lanes[i]!, hs[i], ht[i]);
  const paths = bs.map((_, i) => build(i));
  const crowd = (): number => {
    let n = 0;
    for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) if (branchesCrowd([paths[a]!, paths[b]!])) n++;
    return n;
  };
  // Two passes: the jogs of one end can only be staggered once the other end's jogs have their final height too (a U-shaped
  // bundle swaps the lane order, so its two ends cross each other and every end must be staggered).
  for (let pass = 0; pass < 2 && crowd() > 0; pass++) {
    for (const end of ['s', 't'] as const) {
      for (let i = 0; i < bs.length; i++) {
        const base = end === 's' ? hs[i]! : ht[i]!;
        let best = { score: Infinity, h: base };
        for (const step of steps) {
          const h = base - step;
          if (h < 4) break;
          if (end === 's') hs[i] = h;
          else ht[i] = h;
          paths[i] = build(i);
          const score = crowd();
          if (score < best.score) best = { score, h };
          if (score === 0) break;
        }
        if (end === 's') hs[i] = best.h;
        else ht[i] = best.h;
        paths[i] = build(i);
      }
    }
  }
  if (crowd() > 0) return undefined;
  return paths;
}

function inversions(a: number[], b: number[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) if ((a[i]! - a[j]!) * (b[i]! - b[j]!) < 0) n++;
  }
  return n;
}

/** Lane offsets (ranks) for the branches of a bundle, chosen so the jogs at both ends cross as little as possible. */
function pickLanes(centre: Point[], plan: Plan): Point[][] {
  const n = plan.branches.length;
  const mid = (n - 1) / 2;
  const bySource = plan.branches.map((b, i) => ({ i, x: b.s0!.x })).sort((a, b) => a.x - b.x || a.i - b.i);
  const candidates = [bySource, [...bySource].reverse()].map((order) => {
    const rank = new Array<number>(n).fill(0);
    order.forEach((o, r) => (rank[o.i] = r));
    const lanes = plan.branches.map((_, i) => offsetPolyline(centre, (rank[i]! - mid) * BRANCH_GAP));
    const sx = plan.branches.map((b) => b.s0!.x);
    const tx = plan.branches.map((b) => b.t0!.x);
    const cost = inversions(sx, lanes.map((l) => l[0]!.x)) + inversions(tx, lanes.map((l) => l[l.length - 1]!.x));
    return { lanes, cost };
  });
  return candidates.reduce((best, c) => (c.cost < best.cost ? c : best)).lanes;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function buildFkEdges(input: FkBuildInput): Record<Id, FkEdgeGeom> {
  const { warnings } = input;
  const plans: Plan[] = [];
  for (const [edgeId, edge] of input.edges) {
    const plan = planEdge(input, edgeId, edge);
    if (plan) plans.push(plan);
  }
  for (const plan of plans) assignSides(plan, warnings);
  placeEnds(collectEnds(plans));
  if (input.reuse) return buildDraftEdges(input, plans);
  return routePlans(input, plans);
}

/**
 * The full pipeline (routing, bundles, nudging, crossing reduction, geometry) for `plans`. Draft builds call it for the
 * manual edges they must redraw, so a manual route is drawn by THE SAME code while it is previewed and once committed.
 */
function routePlans(input: FkBuildInput, plans: Plan[], zonePlans: Plan[] = plans): Record<Id, FkEdgeGeom> {
  const { layouts, rel } = input;
  const orthogonal = rel.routing === 'orthogonal';
  for (const plan of plans) {
    plan.bundle =
      orthogonal &&
      !plan.straight &&
      plan.style === 'branches' &&
      plan.branches.length > 1 &&
      plan.branches.every(
        (b) =>
          isVerticalSide(b.sSide) &&
          isVerticalSide(b.tSide) &&
          sameSide(b.sSide, plan.branches[0]!.sSide) &&
          sameSide(b.tSide, plan.branches[0]!.tSide),
      );
  }

  // ---- obstacles: table rows and names (always), table bounds (the name band above a row; ignored by the edge's own
  // tables, whose borders it must reach), and the arrowhead + final stub of every FK arrow (ignored by its own edge) ----
  const obstacles: RouteObstacle[] = [];
  for (const [nodeId, l] of layouts) {
    obstacles.push({ id: nodeId, rect: l.geom.row });
    obstacles.push({ id: nodeId, rect: l.nameRect });
    obstacles.push({ id: bandId(nodeId), rect: l.geom.bounds });
  }
  for (const plan of zonePlans) {
    for (const b of plan.branches) obstacles.push({ id: zoneId(plan.edgeId), rect: arrowZone(b.t0!, b.tSide), clearance: ZONE_PAD });
  }
  const ctxOf = { obstacles, clearance: CLEARANCE, stub: STUB, laneGap: MIN_LANE_GAP };
  const ignoreOf = (p: Plan): string[] => [bandId(p.sNodeId), bandId(p.tNodeId), zoneId(p.edgeId)];
  const manual = (p: Plan) => p.edge.route.mode === 'manual' && p.edge.route.waypoints.length > 0;
  const bundleExtra = (p: Plan) => Math.ceil((p.branches.length - 1) / 2) * BRANCH_GAP;

  const buildRequests = (): RouteRequest[] => {
    const requests: RouteRequest[] = [];
    for (const plan of plans) {
      const wp = manual(plan) ? plan.edge.route.waypoints.map((w) => ({ x: w.x, y: w.y })) : undefined;
      const ignoreObstacleIds = ignoreOf(plan);
      if (plan.bundle) {
        const bs = plan.branches;
        const sSide = bs[0]!.sSide;
        const tSide = bs[0]!.tSide;
        const mean = (f: (b: BranchPlan) => number) => bs.reduce((a, b) => a + f(b), 0) / bs.length;
        const extra = bundleExtra(plan);
        const sn = sideNormal(sSide);
        const tn = sideNormal(tSide);
        const gs = { x: mean((b) => b.s0!.x) + sn.x * extra, y: bs[0]!.s0!.y + sn.y * extra };
        const gt = { x: mean((b) => b.t0!.x) + tn.x * extra, y: bs[0]!.t0!.y + tn.y * extra };
        requests.push({ key: `${plan.edgeId}:c`, source: { point: gs, side: sSide }, target: { point: gt, side: tSide }, waypoints: wp, ignoreObstacleIds, halfWidth: ((bs.length - 1) / 2) * BRANCH_GAP });
      } else if (wp && plan.branches.length > 1) {
        // Non-bundled composite with manual waypoints: the waypoints are the CENTRELINE; every branch follows its own
        // lane of it (ARCHITECTURE: branches are never merged into a shared trunk).
        const { lanes, centre } = manualLanes(plan, wp);
        plan.centre = centre;
        plan.branches.forEach((b, i) => {
          requests.push({ key: `${plan.edgeId}:${i}`, source: { point: b.s0!, side: b.sSide }, target: { point: b.t0!, side: b.tSide }, waypoints: lanes[i], ignoreObstacleIds });
        });
      } else {
        plan.branches.forEach((b, i) => {
          requests.push({ key: `${plan.edgeId}:${i}`, source: { point: b.s0!, side: b.sSide }, target: { point: b.t0!, side: b.tSide }, waypoints: wp, ignoreObstacleIds });
        });
      }
    }
    return requests;
  };

  // Straight mode draws direct lines, but a direct line through a foreign table would suggest the wrong referenced
  // field: such edges (and only those) are routed around the tables instead.
  const straightRerouted = new Set<Plan>();
  if (!orthogonal) {
    for (const plan of plans) {
      if (manual(plan)) continue;
      const hit = plan.branches.some((b) => {
        const path = straightPath(b, []);
        return [...layouts].some(([nodeId, l]) => nodeId !== plan.sNodeId && nodeId !== plan.tNodeId && pathHitsRect(path, l.geom.bounds));
      });
      if (hit) straightRerouted.add(plan);
    }
  }
  let routed: Record<string, Point[]> = {};
  const routeAll = (): void => {
    const requests = buildRequests().filter((r) => orthogonal || [...straightRerouted].some((p) => r.key.startsWith(`${p.edgeId}:`)));
    routed = requests.length > 0 ? routeOrthogonal(requests, ctxOf) : {};
    if (orthogonal && requests.length > 1) {
      // Lane separation at the centreline level: a bundle's centre keeps its WHOLE lane width clear of other connectors.
      const sep = separateRoutes(
        requests.map((r) => routed[r.key]!),
        {
          movable: requests.map((r) => !r.waypoints || r.waypoints.length === 0),
          ctx: ctxOf,
          gap: MIN_LANE_GAP,
          half: requests.map((r) => r.halfWidth ?? 0),
          budget: 400_000,
          ignoreObstacleIds: requests.map((r) => r.ignoreObstacleIds ?? []),
          skip: (i, j) => edgeOfKey(requests[i]!.key) === edgeOfKey(requests[j]!.key),
        },
      );
      requests.forEach((r, i) => (routed[r.key] = sep[i]!));
    }
    // Branches of one composite FK that are routed separately all run between the same two tables, so the batch nudge
    // may fail to pull them apart in a narrow corridor. Route branch i again with the earlier branches as thin
    // obstacles; keep the result only when it is clean (no table crossed, no shared run).
    for (const plan of plans) {
      if (plan.bundle || plan.branches.length < 2 || manual(plan) || (!orthogonal && !straightRerouted.has(plan))) continue;
      const taken: RouteObstacle[] = [];
      const final: Point[][] = [];
      plan.branches.forEach((_, i) => {
        const key = `${plan.edgeId}:${i}`;
        const req = requests.find((r) => r.key === key);
        let path = routed[key]!;
        if (i > 0 && req) {
          const retry = routeOrthogonal([req], { ...ctxOf, obstacles: [...obstacles, ...taken] })[key]!;
          if (!pathHitsObstacles(retry, obstacles, [zoneId(plan.edgeId)]) && !final.some((f) => branchesCrowd([f, retry]))) path = retry;
        }
        final.push(path);
        routed[key] = path;
        for (let k = 0; k + 1 < path.length; k++) {
          const a = path[k]!;
          const b = path[k + 1]!;
          taken.push({ id: `${plan.edgeId}#lane`, rect: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, clearance: LANE_PAD });
        }
      });
    }
  };
  if (orthogonal || straightRerouted.size > 0) {
    if (!orthogonal) for (const plan of straightRerouted) plan.bundle = false;
    routeAll();
    // A bundle's lanes are offsets of the routed centreline; when a lane (not the centreline) would run through a table,
    // the bundle falls back to one routed path per branch.
    if (orthogonal) {
      let again = false;
      for (const plan of plans) {
        if (!plan.bundle) continue;
        const centre = routed[`${plan.edgeId}:c`]!;
        const lanes = pickLanes(centre, plan);
        const paths = bundlePaths(plan, lanes);
        if (!paths || paths.some((path) => pathHitsObstacles(path, obstacles, [zoneId(plan.edgeId)]))) {
          plan.bundle = false;
          again = true;
        }
      }
      if (again) routeAll();
    }
  }

  // ---- paths, then ONE more nudge over the final branch paths: bundle jogs (derived after routing) and other edges' runs
  // at the same stub height would otherwise coincide and read as a shared trunk. User-drawn bends never move. ----
  const computed = plans.map((plan) => computePaths(input, plan, routed, straightRerouted.has(plan)));
  const flat = computed.flatMap((c) => c.paths);
  const movable: Movable[] = plans.flatMap((plan, i) =>
    // A bundle's lanes are one rigid offset of the (already nudged) centreline; only its derived jogs may move. That is
    // also what makes `autoWaypoints` -> manual reproduce an auto bundle exactly.
    computed[i]!.paths.map((): Movable => (!orthogonal ? false : plan.bundle ? 'ends' : manual(plan) ? false : true)),
  );
  const ignoreFlat = plans.flatMap((plan, i) => computed[i]!.paths.map(() => ignoreOf(plan)));
  const nudged = orthogonal ? nudgeRoutes(flat, { movable, ctx: ctxOf, ignoreObstacleIds: ignoreFlat }) : flat;
  if (orthogonal) uncross(plans, computed, nudged, ctxOf, obstacles, ignoreOf, manual);
  if (orthogonal) {
    // Distinct foreign keys never run closer than MIN_LANE_GAP side by side (two lines 3 px apart read as ONE line).
    const owner = plans.flatMap((plan, i) => computed[i]!.paths.map((_, bi) => ({ edge: plan.edgeId, target: `${plan.tNodeId}:${plan.branches[bi]?.pair.targetColumnId ?? ''}` })));
    const sep = separateRoutes(nudged, {
      movable,
      ctx: ctxOf,
      gap: MIN_LANE_GAP,
      ignoreObstacleIds: ignoreFlat,
      skip: (i, j) => owner[i]!.edge === owner[j]!.edge,
    });
    sep.forEach((p, i) => (nudged[i] = p));
  }
  let cursor = 0;

  // ---- geometry ----
  const placedLabels: Rect[] = [];
  const tableRects = [...layouts.values()].map((l) => inflateRect(l.geom.bounds, 2));
  const out: Record<Id, FkEdgeGeom> = {};
  plans.forEach((plan, i) => {
    const n = computed[i]!.paths.length;
    const paths = nudged.slice(cursor, cursor + n);
    cursor += n;
    out[plan.edgeId] = assembleEdge(input, plan, paths, computed[i]!.centre, tableRects, placedLabels);
  });
  return out;
}

/**
 * DRAFT mode: untouched edges keep their previous full geometry; the others get stub + one-elbow paths between their
 * (exact) planned anchors, no router and no label collision search. Manual routes still pass through their waypoints
 * (the router ignores obstacles for those, so it is cheap).
 */
function buildDraftEdges(input: FkBuildInput, plans: Plan[]): Record<Id, FkEdgeGeom> {
  const out: Record<Id, FkEdgeGeom> = {};
  const live: Plan[] = [];
  for (const plan of plans) {
    const prev = input.reuse!(plan.edgeId, plan.sNodeId, plan.tNodeId);
    if (prev && prev.kind === 'fk') out[plan.edgeId] = prev;
    else live.push(plan);
  }
  const manual = (p: Plan) => p.edge.route.mode === 'manual' && p.edge.route.waypoints.length > 0;
  // A manual route never searches (the router ignores obstacles for it), so it is cheap: it is drawn by the SAME pipeline
  // as the final build and the preview equals the committed geometry. Only auto routes get provisional geometry.
  const manualLive = live.filter(manual);
  if (manualLive.length > 0) Object.assign(out, routePlans(input, manualLive, plans));
  for (const plan of live) {
    if (manual(plan)) continue;
    plan.bundle = false;
    const paths = plan.branches.map((b) => (input.rel.routing === 'orthogonal' ? draftPath(b) : straightPath(b, [])));
    out[plan.edgeId] = assembleEdge(input, plan, paths, undefined, [], []);
  }
  return out;
}

/** Stub out of the source, one elbow, stub into the target (always axis-aligned, perpendicular at both ends). */
function draftPath(b: BranchPlan): Point[] {
  const s0 = b.s0!;
  const t0 = b.t0!;
  const sn = sideNormal(b.sSide);
  const tn = sideNormal(b.tSide);
  const s1 = { x: s0.x + sn.x * STUB, y: s0.y + sn.y * STUB };
  const t1 = { x: t0.x + tn.x * STUB, y: t0.y + tn.y * STUB };
  const mid: Point[] =
    isVerticalSide(b.sSide) && isVerticalSide(b.tSide)
      ? [{ x: s1.x, y: (s1.y + t1.y) / 2 }, { x: t1.x, y: (s1.y + t1.y) / 2 }]
      : !isVerticalSide(b.sSide) && !isVerticalSide(b.tSide)
        ? [{ x: (s1.x + t1.x) / 2, y: s1.y }, { x: (s1.x + t1.x) / 2, y: t1.y }]
        : isVerticalSide(b.sSide)
          ? [{ x: s1.x, y: t1.y }]
          : [{ x: t1.x, y: s1.y }];
  return cleanOrthogonal([s0, s1, ...mid, t1, t0]);
}

/** Crossings of one path against a set of others (proper crossings only: touching ends and collinear overlaps do not count). */
function crossingsAgainst(path: Point[], others: Point[][]): number {
  const eps = 0.5;
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const ah = Math.abs(a.y - b.y) < 1e-6;
    for (const o of others) {
      for (let k = 0; k + 1 < o.length; k++) {
        const c = o[k]!;
        const d = o[k + 1]!;
        if (ah === Math.abs(c.y - d.y) < 1e-6) continue;
        const [h0, h1, v0, v1] = ah ? [a, b, c, d] : [c, d, a, b];
        if (
          v0.x > Math.min(h0.x, h1.x) + eps &&
          v0.x < Math.max(h0.x, h1.x) - eps &&
          h0.y > Math.min(v0.y, v1.y) + eps &&
          h0.y < Math.max(v0.y, v1.y) - eps
        )
          n++;
      }
    }
  }
  return n;
}

/**
 * Crossing reduction: a free (auto, not part of a lane bundle) branch that crosses other connectors is routed once more
 * with every other connector as a thin obstacle, and takes the new path when it crosses strictly fewer connectors and
 * still avoids every table. Only the PATH moves; both ends (hence the referenced cell) are the router's fixed inputs.
 * `nudged` is edited in place (flat order = plans x branches).
 */
function uncross(
  plans: Plan[],
  computed: Array<{ paths: Point[][] }>,
  nudged: Point[][],
  ctx: { obstacles: RouteObstacle[]; clearance: number; stub: number },
  obstacles: RouteObstacle[],
  ignoreOf: (p: Plan) => string[],
  manual: (p: Plan) => boolean,
): void {
  const owners: Array<{ plan: Plan; branch: BranchPlan; key: string } | undefined> = [];
  plans.forEach((plan, i) => {
    computed[i]!.paths.forEach((_, bi) => {
      owners.push(!plan.bundle && !manual(plan) && plan.style === 'branches' ? { plan, branch: plan.branches[bi]!, key: `${plan.edgeId}:${bi}` } : undefined);
    });
  });
  const triedOnce = new Set<number>();
  for (let round = 0; round < 6; round++) {
    const score = nudged.map((p, i) => crossingsAgainst(p, nudged.filter((_, j) => j !== i)));
    let pick = -1;
    nudged.forEach((_, i) => {
      if (owners[i] && score[i]! > 0 && !triedOnce.has(i) && (pick < 0 || score[i]! > score[pick]!)) pick = i;
    });
    if (pick < 0) return;
    triedOnce.add(pick);
    const o = owners[pick]!;
    const others = nudged.filter((_, j) => j !== pick);
    const thin: RouteObstacle[] = others.flatMap((path) =>
      path.slice(0, -1).map((a, k) => {
        const b = path[k + 1]!;
        return { id: `#path${pick}`, rect: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, clearance: LANE_PAD };
      }),
    );
    const retry = routeOrthogonal(
      [{ key: 'u', source: { point: o.branch.s0!, side: o.branch.sSide }, target: { point: o.branch.t0!, side: o.branch.tSide }, ignoreObstacleIds: ignoreOf(o.plan) }],
      { ...ctx, obstacles: [...ctx.obstacles, ...thin] },
    ).u!;
    if (pathHitsObstacles(retry, obstacles, [zoneId(o.plan.edgeId)])) continue;
    // Fewer crossings must not be bought with a connector that wraps around the diagram.
    const len = (path: Point[]): number => path.slice(1).reduce((a, q, k) => a + Math.abs(q.x - path[k]!.x) + Math.abs(q.y - path[k]!.y), 0);
    if (len(retry) > len(nudged[pick]!) * MAX_DETOUR + DETOUR_SLACK) continue;
    // ... nor with a connector that U-turns around a table (many more bends than the path it replaces).
    if (retry.length > nudged[pick]!.length + MAX_EXTRA_BENDS) continue;
    if (crossingsAgainst(retry, others) < score[pick]!) nudged[pick] = retry;
  }
}

/** A crossing-free reroute may be at most this much longer (factor + px) than the path it replaces. */
const MAX_DETOUR = 1.6;
const DETOUR_SLACK = 120;
const MAX_EXTRA_BENDS = 2;

/** Edge id of a request key (`edgeId:branch` / `edgeId:c`). */
const edgeOfKey = (key: string): string => key.slice(0, key.lastIndexOf(':'));
const bandId = (nodeId: Id): Id => `${nodeId}#band`;
const zoneId = (edgeId: Id): Id => `${edgeId}#arrows`;
/** Padding of an arrow zone (much thinner than the table clearance: the zone is a thin strip). */
const ZONE_PAD = 3;
/** Clearance kept between the branches of a composite FK that are routed one after another. */
const LANE_PAD = 3;

/** Keep-out strip in front of an arrow tip: the arrowhead plus the stub it arrives on. */
function arrowZone(tip: Point, side: Side): Rect {
  const n = sideNormal(side);
  const hw = ARROW_HALF_WIDTH;
  if (isVerticalSide(side)) return { x: tip.x - hw, y: n.y > 0 ? tip.y : tip.y - STUB, w: 2 * hw, h: STUB };
  return { x: n.x > 0 ? tip.x : tip.x - STUB, y: tip.y - hw, w: STUB, h: 2 * hw };
}

/** Does the segment a-b cross the OPEN interior of `r` (touching the border does not count)? Liang-Barsky. */
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

function pathHitsRect(path: Point[], r: Rect): boolean {
  for (let i = 0; i + 1 < path.length; i++) if (segmentCrossesRect(path[i]!, path[i + 1]!, r)) return true;
  return false;
}

/** Does the path run through any obstacle it is not allowed to cross (table rows, names, foreign arrow zones; not name bands)? */
function pathHitsObstacles(path: Point[], obstacles: RouteObstacle[], ignore: string[]): boolean {
  return obstacles.some((o) => !ignore.includes(o.id) && !o.id.endsWith('#band') && pathHitsRect(path, inflateRect(o.rect, -0.5)));
}

/**
 * True when two branches of one edge run (nearly) on top of each other: parallel segments closer than half a lane gap
 * that overlap. Normal lanes are a full gap apart, so this only fires in cramped layouts, where the bundle is given up.
 */
function branchesCrowd(paths: Point[][]): boolean {
  const near = BRANCH_GAP / 2;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i]!;
      const b = paths[j]!;
      for (let p = 0; p + 1 < a.length; p++) {
        for (let q = 0; q + 1 < b.length; q++) {
          const horizontalA = Math.abs(a[p]!.y - a[p + 1]!.y) < 1e-6;
          const horizontalB = Math.abs(b[q]!.y - b[q + 1]!.y) < 1e-6;
          if (horizontalA !== horizontalB) continue;
          const [k, o] = horizontalA ? (['y', 'x'] as const) : (['x', 'y'] as const);
          if (Math.abs(a[p]![k] - b[q]![k]) >= near) continue;
          const overlap =
            Math.min(Math.max(a[p]![o], a[p + 1]![o]), Math.max(b[q]![o], b[q + 1]![o])) -
            Math.max(Math.min(a[p]![o], a[p + 1]![o]), Math.min(b[q]![o], b[q + 1]![o]));
          if (overlap > 1) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Waypoints of every branch of a non-bundled composite with manual waypoints: the edge's waypoints are the centreline,
 * branch i follows the lane (rank - (n-1)/2) * BRANCH_GAP beside it (lane ranks chosen to minimise crossings at the ends).
 */
function manualLanes(plan: Plan, wp: Point[]): { lanes: Point[][]; centre: Point[] } {
  const bs = plan.branches;
  const n = bs.length;
  const mid = (n - 1) / 2;
  const first = bs[0]!;
  const stubEnd = (p: Point, side: Side): Point => {
    const sn = sideNormal(side);
    return { x: p.x + sn.x * STUB, y: p.y + sn.y * STUB };
  };
  const avg = (pts: Point[]): Point => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
  const s1c = avg(bs.map((b) => stubEnd(b.s0!, b.sSide)));
  const t1c = avg(bs.map((b) => stubEnd(b.t0!, b.tSide)));
  const centre = orthogonalizeThrough([s1c, ...wp, t1c], isVerticalSide(first.sSide) ? 'v' : 'h');
  const lat = (p: Point, side: Side): number => (isVerticalSide(side) ? p.x : p.y);
  const bySource = bs.map((b, i) => ({ i, v: lat(b.s0!, b.sSide) })).sort((a, b) => a.v - b.v || a.i - b.i);
  const candidates = [bySource, [...bySource].reverse()].map((order) => {
    const rank = new Array<number>(n).fill(0);
    order.forEach((o, r) => (rank[o.i] = r));
    const paths = bs.map((_, i) => offsetPolyline(centre, (rank[i]! - mid) * BRANCH_GAP));
    const cost =
      inversions(bs.map((b) => lat(b.s0!, b.sSide)), paths.map((l) => lat(l[0]!, first.sSide))) +
      inversions(bs.map((b) => lat(b.t0!, b.tSide)), paths.map((l) => lat(l[l.length - 1]!, first.tSide)));
    return { paths, cost };
  });
  const best = candidates.reduce((a, c) => (c.cost < a.cost ? c : a));
  const lanes = best.paths.map((path) => {
    const inner = interiorVertices(path);
    return inner.length > 0 ? inner : wp.map((w) => ({ x: w.x, y: w.y }));
  });
  return { lanes, centre: [avg(bs.map((b) => b.s0!)), ...centre, avg(bs.map((b) => b.t0!))] };
}

/** Thin rect around an axis-aligned segment. */
function segmentRect(a: Point, b: Point, pad: number): Rect {
  return { x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(a.x - b.x) + 2 * pad, h: Math.abs(a.y - b.y) + 2 * pad };
}

/** `p` itself when it lies on `line` (within 0.5 px), else the nearest point of `line`. */
function nearestOnPolyline(line: Point[], p: Point): Point {
  let best: Point = { x: p.x, y: p.y };
  let bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return bestD <= 0.5 || line.length < 2 ? { x: p.x, y: p.y } : best;
}

function straightPath(b: BranchPlan, waypoints: Point[]): Point[] {
  const sn = sideNormal(b.sSide);
  const tn = sideNormal(b.tSide);
  const s0 = b.s0!;
  const t0 = b.t0!;
  return dedupePoints([
    s0,
    { x: s0.x + sn.x * STUB, y: s0.y + sn.y * STUB },
    ...waypoints,
    { x: t0.x + tn.x * STUB, y: t0.y + tn.y * STUB },
    t0,
  ]);
}

/** Un-nudged branch polylines of one edge (+ the bundle centreline when the edge is a bundle). */
function computePaths(
  input: FkBuildInput,
  plan: Plan,
  routed: Record<string, Point[]>,
  rerouted: boolean,
): { paths: Point[][]; centre?: Point[] } {
  const { edge } = plan;
  const isManual = edge.route.mode === 'manual' && edge.route.waypoints.length > 0;
  if (input.rel.routing !== 'orthogonal') {
    if (rerouted) return { paths: plan.branches.map((_, i) => routed[`${plan.edgeId}:${i}`]!) };
    const wp = isManual ? edge.route.waypoints.map((w) => ({ x: w.x, y: w.y })) : [];
    return { paths: plan.branches.map((b) => straightPath(b, wp)) };
  }
  if (plan.bundle) {
    const centre = routed[`${plan.edgeId}:c`]!;
    const lanes = pickLanes(centre, plan);
    // `routeAll` already verified that the bundle works (otherwise `plan.bundle` would be false).
    return { paths: bundlePaths(plan, lanes)!, centre };
  }
  return { paths: plan.branches.map((_, i) => routed[`${plan.edgeId}:${i}`]!) };
}

function assembleEdge(
  input: FkBuildInput,
  plan: Plan,
  paths: Point[][],
  centre: Point[] | undefined,
  tableRects: Rect[],
  placedLabels: Rect[],
): FkEdgeGeom {
  const { edge, fk } = plan;
  const orthogonal = input.rel.routing === 'orthogonal';
  const isManual = edge.route.mode === 'manual' && edge.route.waypoints.length > 0;
  const brackets: { source: Point[]; target: Point[] } | undefined =
    plan.style === 'bracket'
      ? { source: bracketPoints(plan.branches[0]!.sRect, plan.branches[0]!.sSide), target: bracketPoints(plan.branches[0]!.tRect, plan.branches[0]!.tSide) }
      : undefined;

  const branches: FkBranchGeom[] = plan.branches.map((b, i) => {
    const { points, strokePoints, arrow } = makeArrow(paths[i]!, b.tSide);
    const ends: [EdgeEndGeom, EdgeEndGeom] = [
      { nodeId: plan.sNodeId, columnId: b.pair.sourceColumnId, at: points[0]!, side: b.sSide, anchorRect: b.sRect },
      { nodeId: plan.tNodeId, columnId: b.pair.targetColumnId, at: arrow.tip, side: b.tSide, anchorRect: b.tRect },
    ];
    return {
      sourceColumnId: b.pair.sourceColumnId,
      targetColumnId: b.pair.targetColumnId,
      points,
      strokePoints,
      arrow,
      sourceSide: b.sSide,
      targetSide: b.tSide,
      sourceCell: b.sRect,
      targetCell: b.tRect,
      ends,
    };
  });

  // The polyline the user's bends sit on and mid-handles are laid along: a bundle's / manual composite's CENTRELINE, else the
  // (primary) path itself. Stored waypoints are corners of it, so a handle is always ON the drawn line.
  const centreline = centre ?? plan.centre ?? branches[0]!.points;

  // Label on the bundle's centreline (or the single path): a free spot, with backdrop.
  const labels: EdgeLabelGeom[] = [];
  const showLabel = edge.labelVisible ?? input.rel.fkLabels;
  const mainPath = centre ?? branches[Math.floor((branches.length - 1) / 2)]!.points;
  if (showLabel) {
    const text = fk.label ?? describeForeignKey(input.model, fk);
    const font = { family: input.fontFamily, size: Math.max(10, input.fontSize - 2) };
    const width = input.measure(text, font);
    // A composite's label sits BESIDE its lanes (never on them); a single connector's label sits on the line over its plate.
    const lanes = branches.length > 1 ? branches.map((b) => b.points) : [];
    const half = branches.length > 1 ? ((branches.length - 1) / 2) * BRANCH_GAP : 0;
    const label = placeLabel(text, font, width, mainPath, tableRects, placedLabels, edge.labelOffsets?.main, lanes, half);
    labels.push({ id: 'main', label });
    placedLabels.push(labelRect(label));
  }

  const pts: Point[] = [...paths.flat(), ...branches.flatMap((b) => b.arrow.polygon), ...(brackets ? [...brackets.source, ...brackets.target] : [])];
  const rects: Rect[] = [rectOfPoints(pts), ...labels.map((l) => labelRect(l.label))];
  // Composite edges may carry pair-number badges (drawn beside the segments): keep them inside the paint bounds.
  const badgeRoom = plan.style === 'branches' && branches.length > 1 ? 16 : 0;
  const bounds = inflateRect(unionRects(rects)!, plan.strokeWidth / 2 + 1 + badgeRoom);

  const first = branches[0]!;
  // `ends` for a bundle: the primary (first-pair) branch.
  return {
    kind: 'fk',
    edgeId: plan.edgeId,
    ref: edge.ref,
    sourceNodeId: plan.sNodeId,
    targetNodeId: plan.tNodeId,
    paths,
    bounds,
    ends: first.ends,
    centreline,
    // A handle sits on the drawn line: a waypoint the router honoured is returned as stored; one it could not (a bend behind an
    // anchor, a spike) is shown at the nearest point of the line instead of floating beside the connector.
    bendHandles: isManual ? edge.route.waypoints.map((at, index) => ({ index, at: nearestOnPolyline(centreline, at) })) : [],
    // A bundle has one centreline; a single branch is its own. Separately routed composite branches have NO common
    // polyline a manual route could reproduce (manual lanes are offsets of ONE centreline), so an auto composite
    // offers none, and a manual one reports the centreline it was given.
    autoWaypoints: !orthogonal
      ? []
      : centre
        ? interiorVertices(centre)
        : branches.length === 1
          ? interiorVertices(first.points)
          : isManual
            ? edge.route.waypoints.map((w) => ({ x: w.x, y: w.y }))
            : [],
    labels,
    style: plan.style,
    branches,
    pairs: plan.pairs.map((p) => ({ sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId })),
    ...(brackets ? { brackets } : {}),
  };
}

/**
 * Pick a label position on `path`: the midpoint of the longest segments first, skipping spots that would overlap a table
 * or an already placed label. Falls back to the longest segment's midpoint. `offset` is the user's drag delta.
 */
function placeLabel(
  text: string,
  font: { family: string; size: number },
  width: number,
  path: Point[],
  tables: Rect[],
  placed: Rect[],
  offset?: Point,
  lanes: Point[][] = [],
  half = 0,
): TextLabel {
  const segs = path
    .slice(1)
    .map((b, i) => ({ a: path[i]!, b, len: distance(path[i]!, b) }))
    .filter((s) => s.len > 0)
    .sort((x, y) => y.len - x.len);
  const make = (at: Point): TextLabel => ({
    text,
    x: at.x + (offset?.x ?? 0),
    y: at.y + (offset?.y ?? 0),
    anchor: 'middle',
    font,
    width,
    backdrop: true,
  });
  const free = (l: TextLabel) => {
    const r = labelRect(l);
    return !tables.some((t) => rectsIntersect(t, r)) && !placed.some((p) => rectsIntersect(inflateRect(p, 2), r));
  };
  if (lanes.length > 0 && !offset) {
    // beside the bundle: try each segment (longest first), both sides, clear of every lane
    const clear = (l: TextLabel): boolean => {
      const r = inflateRect(labelRect(l), 2);
      return !lanes.some((path) => path.some((a, i) => i + 1 < path.length && rectsIntersect(r, segmentRect(a, path[i + 1]!, 0.75))));
    };
    for (const s of segs) {
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      const vertical = Math.abs(s.a.x - s.b.x) < 1e-6;
      const probe = make(m);
      const r = labelRect(probe);
      const d = half + 5 + (vertical ? r.w / 2 : r.h / 2);
      for (const side of [1, -1]) {
        const l = make(vertical ? { x: m.x + side * d, y: m.y } : { x: m.x, y: m.y + side * d });
        if (free(l) && clear(l)) return l;
      }
    }
  }
  for (const s of segs) {
    const l = make({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
    if (offset || free(l)) return l;
  }
  const s = segs[0];
  return make(s ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } : path[0] ?? { x: 0, y: 0 });
}
