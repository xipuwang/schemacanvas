/**
 * Chen edge geometry: participation lines (relationship -> entity) and attribute links (owner -> attribute).
 *
 * Pipeline (every step is pure and deterministic):
 *  1. resolve each `diagram.edges` entry to its two node geoms (dangling edges are skipped with a warning);
 *  2. PLAN: attachment side / offset per end (AnchorSpec > loop rule > nearest side) and, for orthogonal routing,
 *     spread edges that share one side of a node so they never attach at the same point;
 *  3. ROUTE: straight line (rays between centres clipped by `boundaryPoint`), manual polyline, orthogonal routing
 *     via the shared router, or an elbow LOOP for recursive participation (two participants of one entity);
 *  4. total participation -> two rails (`offsetPolyline`), each end re-intersected with the real outline;
 *  5. labels (cardinality at the entity end, role at the middle) placed BESIDE the line, user offsets applied;
 *  6. PAINT bounds = paths ∪ rails ∪ label rects, inflated by the stroke.
 */
import { createNodeResolver, edgeEndpointRefs } from '@/model/diagramSync';
import { cardinalityText } from '@/model/erSemantics';
import type { AnchorSpec, DiagramEdge, ErModel, ErParticipant, ErRelationship, Id, Point } from '@/model/types';
import type { FontSpec, Outline, Rect, SceneBuildInput, Side, TextLabel } from '../base';
import {
  boundaryPoint,
  dedupePoints,
  distance,
  inflateRect,
  labelRect,
  nearestSide,
  offsetPolyline,
  pointInOutline,
  rectCenter,
  rectOfPoints,
  rectsIntersect,
  segmentOutlineIntersection,
  sideNormal,
  sidePoint,
  unionRects,
} from '../geometry';
import { makeEdgeReuse } from '../draft';
import { orthogonalizeThrough, routeOrthogonal, type RouteRequest } from '../routing';
import { collinearOverlap, Grid, rectHitsOutline, segmentHitsRect } from './collide';
import { DEFAULT_EDGE_STROKE, railGap } from './metrics';
import type { ChenEdgeGeom, ChenNodeGeomAny } from './types';

const LOOP_LIFT = 26;
const LOOP_LAYER_GAP = 26;
const LOOP_LEVELS = 8;
const STUB = 18;
const CLEARANCE = 10;

interface EndPlan {
  side: Side;
  /** Position along the side (0..1); undefined = automatic (spread when orthogonal). */
  offset?: number;
  /** True when the user chose the side explicitly (AnchorSpec.side !== 'auto'). */
  explicit: boolean;
}

interface Item {
  edgeId: Id;
  edge: DiagramEdge;
  src: ChenNodeGeomAny;
  tgt: ChenNodeGeomAny;
  lineKind: 'participant' | 'attribute';
  rel?: ErRelationship;
  participant?: ErParticipant;
  double: boolean;
  manual: boolean;
  loop?: { index: number; layer: number; axis: 'h' | 'v' };
  plan: [EndPlan, EndPlan];
}

export interface EdgeBuildInput {
  input: SceneBuildInput;
  model: ErModel;
  geoms: Record<Id, ChenNodeGeomAny>;
  font: FontSpec;
  warnings: string[];
}

const rectOf = (g: ChenNodeGeomAny): Rect => g.outline.rect;
const unit = (a: Point, b: Point): Point => {
  const d = distance(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

function endPoint(g: ChenNodeGeomAny, side: Side, offset: number | undefined): Point {
  return boundaryPoint(g.outline, sidePoint(rectOf(g), side, offset ?? 0.5));
}

// ---------------------------------------------------------------------------
// 1. items
// ---------------------------------------------------------------------------

function collectItems(b: EdgeBuildInput): Item[] {
  const { input, model, geoms, warnings } = b;
  const { diagram } = input;
  const items: Item[] = [];
  const resolveNode = createNodeResolver(diagram, model);
  // How many participants of each relationship attach to the same entity (>1 = recursive loops needed).
  const sameEntityCount = (rel: ErRelationship, entityId: Id): number => rel.participants.filter((p) => p.entityId === entityId).length;
  for (const [edgeId, edge] of Object.entries(diagram.edges)) {
    const ends = edgeEndpointRefs(model, edge.ref);
    const srcId = ends && resolveNode(ends.source);
    const tgtId = ends && resolveNode(ends.target);
    const src = srcId ? geoms[srcId] : undefined;
    const tgt = tgtId ? geoms[tgtId] : undefined;
    if (!ends || !src || !tgt) {
      warnings.push(`chen-edge-dangling:${edgeId}`);
      continue;
    }
    if (src.nodeId === tgt.nodeId) {
      warnings.push(`chen-edge-self:${edgeId}`);
      continue;
    }
    const manual = edge.route.mode === 'manual';
    if (edge.ref.kind === 'participant') {
      const ref = edge.ref;
      const rel = model.relationships[ref.relationshipId]!;
      const participant = rel.participants.find((p) => p.id === ref.participantId)!;
      const same = rel.participants.filter((p) => p.entityId === participant.entityId);
      const item: Item = {
        edgeId, edge, src, tgt, lineKind: 'participant', rel, participant,
        double: participant.participation === 'total', manual,
        plan: undefined as unknown as Item['plan'],
      };
      if (!manual && sameEntityCount(rel, participant.entityId) > 1) {
        const index = same.findIndex((p) => p.id === participant.id);
        const s = rectCenter(rectOf(src));
        const t = rectCenter(rectOf(tgt));
        item.loop = { index, layer: Math.floor(index / 2), axis: Math.abs(t.x - s.x) >= Math.abs(t.y - s.y) ? 'h' : 'v' };
      }
      items.push(item);
    } else if (edge.ref.kind === 'attribute') {
      items.push({ edgeId, edge, src, tgt, lineKind: 'attribute', double: false, manual, plan: undefined as unknown as Item['plan'] });
    } else {
      warnings.push(`chen-edge-dangling:${edgeId}`);
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 2. plan
// ---------------------------------------------------------------------------

function endPlan(anchor: AnchorSpec | undefined, g: ChenNodeGeomAny, peer: Point): EndPlan {
  const explicit = !!anchor && anchor.side !== 'auto';
  const side: Side = anchor && anchor.side !== 'auto' ? anchor.side : nearestSide(rectOf(g), peer);
  const offset = anchor?.offset === undefined ? undefined : Math.min(1, Math.max(0, anchor.offset));
  return { side, ...(offset === undefined ? {} : { offset }), explicit };
}

function planItem(item: Item): void {
  const { edge, src, tgt } = item;
  const wps = edge.route.waypoints;
  const sc = rectCenter(rectOf(src));
  const tc = rectCenter(rectOf(tgt));
  if (item.loop) {
    const { axis, index, layer } = item.loop;
    const side: Side = axis === 'h' ? (index % 2 === 0 ? 'top' : 'bottom') : index % 2 === 0 ? 'left' : 'right';
    item.plan = [
      { side, offset: 0.5, explicit: true },
      { side, offset: Math.min(0.9, 0.5 + 0.2 * layer), explicit: true },
    ];
    return;
  }
  const sPeer = item.manual && wps.length > 0 ? wps[0]! : tc;
  const tPeer = item.manual && wps.length > 0 ? wps[wps.length - 1]! : sc;
  item.plan = [endPlan(edge.route.sourceAnchor, src, sPeer), endPlan(edge.route.targetAnchor, tgt, tPeer)];
}

/**
 * Orthogonal routing: edges sharing one side of a node get distinct, evenly spread offsets ordered by where their
 * peer lies (so they do not cross near the node). Ends with an explicit offset keep it and reserve their slot.
 */
function spreadAnchors(items: Item[]): void {
  const groups = new Map<string, Array<{ plan: EndPlan; peer: Point }>>();
  for (const it of items) {
    const ends: Array<[number, ChenNodeGeomAny, ChenNodeGeomAny]> = [[0, it.src, it.tgt], [1, it.tgt, it.src]];
    for (const [i, g, other] of ends) {
      const plan = it.plan[i]!;
      const key = `${g.nodeId}:${plan.side}`;
      const list = groups.get(key) ?? [];
      list.push({ plan, peer: rectCenter(rectOf(other)) });
      groups.set(key, list);
    }
  }
  for (const list of groups.values()) {
    const free = list.filter((m) => m.plan.offset === undefined);
    if (free.length === 0) continue;
    const fixed = list.filter((m) => m.plan.offset !== undefined);
    const total = list.length;
    let slots = Array.from({ length: total }, (_, i) => (i + 1) / (total + 1));
    for (const f of fixed) {
      let best = 0;
      slots.forEach((s, i) => {
        if (Math.abs(s - f.plan.offset!) < Math.abs(slots[best]! - f.plan.offset!)) best = i;
      });
      slots = slots.filter((_, i) => i !== best);
    }
    const vertical = free[0]!.plan.side === 'top' || free[0]!.plan.side === 'bottom';
    free.sort((a, b) => (vertical ? a.peer.x - b.peer.x : a.peer.y - b.peer.y));
    free.forEach((m, i) => {
      m.plan.offset = slots[i] ?? 0.5;
    });
  }
}

// ---------------------------------------------------------------------------
// 3. routes
// ---------------------------------------------------------------------------

interface Seg {
  edgeId: Id;
  a: Point;
  b: Point;
}

/** Spatial indexes shared by loop and label placement. */
interface Space {
  nodes: Grid<{ id: Id; outline: Outline }>;
  segs: Grid<Seg>;
  /** Cardinality / role label rects placed so far. */
  labels: Grid<Rect>;
  /** First and last point of every path (to keep loop attachment points apart from other lines). */
  ends: Array<{ edgeId: Id; at: Point }>;
}

const segRect = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

function addPath(space: Space, edgeId: Id, pts: Point[]): void {
  for (let i = 0; i < pts.length - 1; i++) space.segs.add({ edgeId, a: pts[i]!, b: pts[i + 1]! }, segRect(pts[i]!, pts[i + 1]!));
  space.ends.push({ edgeId, at: pts[0]! }, { edgeId, at: pts[pts.length - 1]! });
}

const LOOP_SIDES: Record<'h' | 'v', [Side, Side]> = { h: ['top', 'bottom'], v: ['left', 'right'] };

/** One candidate loop: both ends on `side`, running `extra` outside the outermost of the two nodes. */
function loopCandidate(item: Item, side: Side, layer: number, level: number, shift: number): { plan: [EndPlan, EndPlan]; path: Point[] } {
  const { src, tgt } = item;
  const sr = rectOf(src);
  const tr = rectOf(tgt);
  const horizontal = side === 'top' || side === 'bottom';
  const sc = rectCenter(sr);
  const tc = rectCenter(tr);
  const dir = (horizontal ? tc.x - sc.x : tc.y - sc.y) >= 0 ? 1 : -1; // direction src -> tgt along the side
  const clamp = (v: number): number => Math.min(0.9, Math.max(0.1, v));
  // Outer loops attach further OUTSIDE their inner siblings at both ends, so nested loops never overlap.
  const plan: [EndPlan, EndPlan] = [
    { side, offset: clamp(0.5 - dir * 0.15 * layer), explicit: true },
    { side, offset: clamp(0.5 + dir * 0.2 * layer + shift), explicit: true },
  ];
  const s = endPoint(src, side, plan[0].offset);
  const t = endPoint(tgt, side, plan[1].offset);
  const extra = LOOP_LIFT + (layer + level) * LOOP_LAYER_GAP;
  let path: Point[];
  switch (side) {
    case 'top': {
      const y = Math.min(sr.y, tr.y) - extra;
      path = [s, { x: s.x, y }, { x: t.x, y }, t];
      break;
    }
    case 'bottom': {
      const y = Math.max(sr.y + sr.h, tr.y + tr.h) + extra;
      path = [s, { x: s.x, y }, { x: t.x, y }, t];
      break;
    }
    case 'left': {
      const x = Math.min(sr.x, tr.x) - extra;
      path = [s, { x, y: s.y }, { x, y: t.y }, t];
      break;
    }
    case 'right': {
      const x = Math.max(sr.x + sr.w, tr.x + tr.w) + extra;
      path = [s, { x, y: s.y }, { x, y: t.y }, t];
      break;
    }
  }
  return { plan, path };
}

/** Number of definite problems of a loop candidate: through other nodes, along other lines, or at their attachment points. */
function loopHits(path: Point[], item: Item, space: Space): number {
  let hits = 0;
  const own = new Set([item.src.nodeId, item.tgt.nodeId]);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const box = inflateRect(segRect(a, b), 4);
    space.nodes.query(box, (n) => {
      if (!own.has(n.id) && segmentHitsRect(a, b, inflateRect(n.outline.rect, 3))) hits++;
    });
    space.segs.query(box, (sg) => {
      if (sg.edgeId !== item.edgeId && collinearOverlap(a, b, sg.a, sg.b)) hits++;
    });
  }
  for (const e of [path[0]!, path[path.length - 1]!]) {
    for (const o of space.ends) if (o.edgeId !== item.edgeId && distance(o.at, e) < 10) hits++;
  }
  return hits;
}

/**
 * Choose side, nesting layer and level of one recursive loop: the first (lowest level, preferred side first) candidate
 * that crosses no node, shares no segment with another line and attaches away from other lines; otherwise the least bad.
 */
function placeLoop(item: Item, space: Space, layers: Map<string, number>): Point[] {
  const loop = item.loop!;
  const sides = LOOP_SIDES[loop.axis];
  const order: Side[] = loop.index % 2 === 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
  const key = (side: Side): string => `${item.rel?.id}:${item.tgt.nodeId}:${side}`;
  let best: { plan: [EndPlan, EndPlan]; path: Point[]; side: Side } | undefined;
  let bestHits = Infinity;
  search: for (let level = 0; level <= LOOP_LEVELS; level++) {
    for (const side of order) {
      for (const shift of [0, 0.25, -0.25]) {
        const cand = loopCandidate(item, side, layers.get(key(side)) ?? 0, level, shift);
        const hits = loopHits(cand.path, item, space);
        if (hits < bestHits) {
          bestHits = hits;
          best = { ...cand, side };
          if (hits === 0) break search;
        }
      }
    }
  }
  const chosen = best!;
  layers.set(key(chosen.side), (layers.get(key(chosen.side)) ?? 0) + 1);
  item.plan = chosen.plan;
  return chosen.path;
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Direct orthogonal candidates between two attachment points: Z (facing sides), L (perpendicular sides). U shapes are left to the router. */
function simpleOrthogonalPaths(s: Point, ss: Side, t: Point, ts: Side): Point[][] {
  const MIN = 6;
  const ns = sideNormal(ss);
  const nt = sideNormal(ts);
  const along = (p: Point, q: Point, n: Point): number => (q.x - p.x) * n.x + (q.y - p.y) * n.y;
  const out: Point[][] = [];
  if (ns.x === -nt.x && ns.y === -nt.y) {
    const d = along(s, t, ns);
    if (d <= 2 * MIN) return out;
    const lateral = ns.y !== 0 ? Math.abs(s.x - t.x) : Math.abs(s.y - t.y);
    if (lateral < 1e-6) return [[s, t]];
    for (const f of [0.5, 0.3, 0.7]) {
      const m = { x: s.x + ns.x * d * f, y: s.y + ns.y * d * f };
      out.push(ns.y !== 0 ? [s, { x: s.x, y: m.y }, { x: t.x, y: m.y }, t] : [s, { x: m.x, y: s.y }, { x: m.x, y: t.y }, t]);
    }
  } else if (!(ns.x === nt.x && ns.y === nt.y)) {
    const corner = ns.y !== 0 ? { x: s.x, y: t.y } : { x: t.x, y: s.y };
    if (along(s, corner, ns) > MIN && along(t, corner, nt) > MIN) out.push([s, corner, t]);
  }
  return out;
}

const pathLength = (pts: Point[]): number => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(pts[i - 1]!, p)), 0);

/**
 * Orthogonal route without the grid router when a short Z / L connects the two nodes: avoids the router's
 * stub-collision staircases and U detours between close nodes. Tries the planned sides first, other free sides
 * after; every candidate must pass the same hit test as loops (no other node, no shared segment, distinct attach points).
 * Returns undefined when nothing clean exists (the router then decides).
 */
function directOrthogonal(item: Item, space: Space): Point[] | undefined {
  let best: { path: Point[]; cost: number; plan: [EndPlan, EndPlan] } | undefined;
  const sides = (i: 0 | 1): Side[] => (item.plan[i].explicit ? [item.plan[i].side] : [item.plan[i].side, ...SIDES.filter((x) => x !== item.plan[i].side)]);
  for (const ss of sides(0)) {
    for (const ts of sides(1)) {
      const alt = ss !== item.plan[0].side || ts !== item.plan[1].side;
      const sOff = ss === item.plan[0].side ? item.plan[0].offset : 0.5;
      const tOff = ts === item.plan[1].side ? item.plan[1].offset : 0.5;
      const s = endPoint(item.src, ss, sOff);
      const t = endPoint(item.tgt, ts, tOff);
      for (const path of simpleOrthogonalPaths(s, ss, t, ts)) {
        if (loopHits(path, item, space) > 0) continue;
        const cost = pathLength(path) + 40 * (path.length - 2) + (alt ? 30 : 0);
        if (!best || cost < best.cost) {
          best = { path, cost, plan: [{ side: ss, ...(sOff === undefined ? {} : { offset: sOff }), explicit: item.plan[0].explicit }, { side: ts, ...(tOff === undefined ? {} : { offset: tOff }), explicit: item.plan[1].explicit }] };
        }
      }
    }
  }
  if (!best) return undefined;
  item.plan = best.plan;
  return best.path;
}

function straightPath(item: Item): Point[] {
  const { src, tgt, edge } = item;
  const wps = item.manual ? edge.route.waypoints : [];
  const [sp, tp] = item.plan;
  const sPeer = wps.length > 0 ? wps[0]! : rectCenter(rectOf(tgt));
  const tPeer = wps.length > 0 ? wps[wps.length - 1]! : rectCenter(rectOf(src));
  let s = sp.explicit ? endPoint(src, sp.side, sp.offset) : boundaryPoint(src.outline, sPeer);
  let t = tp.explicit ? endPoint(tgt, tp.side, tp.offset) : boundaryPoint(tgt.outline, tPeer);
  // Aim an automatic end at the other end's real attachment point so a user anchor never produces a skewed line.
  if (wps.length === 0) {
    if (!sp.explicit && tp.explicit) s = boundaryPoint(src.outline, t);
    if (!tp.explicit && sp.explicit) t = boundaryPoint(tgt.outline, s);
  }
  return dedupePoints([s, ...wps, t]);
}

function routeRequest(item: Item): RouteRequest {
  const [sp, tp] = item.plan;
  const req: RouteRequest = {
    key: item.edgeId,
    source: { point: endPoint(item.src, sp.side, sp.offset), side: sp.side },
    target: { point: endPoint(item.tgt, tp.side, tp.offset), side: tp.side },
    ignoreObstacleIds: [item.src.nodeId, item.tgt.nodeId],
  };
  if (item.manual && item.edge.route.waypoints.length > 0) req.waypoints = item.edge.route.waypoints.map((p) => ({ ...p }));
  return req;
}

// ---------------------------------------------------------------------------
// 4. rails
// ---------------------------------------------------------------------------

/** Move the first/last rail point onto the real outline along the rail's own direction (no gap, no overshoot). */
function clipRailEnd(rail: Point[], atStart: boolean, o: Outline): Point[] {
  if (rail.length < 2) return rail;
  const end = atStart ? rail[0]! : rail[rail.length - 1]!;
  const next = atStart ? rail[1]! : rail[rail.length - 2]!;
  const c = rectCenter(o.rect);
  // Foot of the centre on the rail's end segment: certainly inside the outline for every shape we draw.
  const dx = next.x - end.x;
  const dy = next.y - end.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return rail;
  const k = ((c.x - end.x) * dx + (c.y - end.y) * dy) / len2;
  const inside = { x: end.x + dx * k, y: end.y + dy * k };
  const hit = pointInOutline(o, inside) && !pointInOutline(o, next) ? segmentOutlineIntersection(o, inside, next) : undefined;
  if (!hit) return rail;
  const out = rail.slice();
  out[atStart ? 0 : out.length - 1] = hit;
  return out;
}

function buildRails(pts: Point[], src: ChenNodeGeomAny, tgt: ChenNodeGeomAny, gap: number): [Point[], Point[]] {
  const make = (d: number): Point[] => {
    let r = offsetPolyline(pts, d);
    r = clipRailEnd(r, true, src.outline);
    r = clipRailEnd(r, false, tgt.outline);
    return r;
  };
  return [make(gap / 2), make(-gap / 2)];
}

// ---------------------------------------------------------------------------
// 5. labels
// ---------------------------------------------------------------------------

function textLabel(text: string, at: Point, font: FontSpec, width: number): TextLabel {
  return { text, x: at.x, y: at.y, anchor: 'middle', font, width };
}

/** Box (as labelRect sees it) of a centred label — used to offset the label clear of the line. */
const boxSize = (l: TextLabel): { w: number; h: number } => ({ w: l.width + 0.25 * l.font.size, h: 1.2 * l.font.size });

/**
 * How many things a label rect would cover: node outlines (exact), other lines, `ownSegs` of its own line, and labels
 * placed earlier. 0 = the label sits on clear paper.
 */
function labelHits(r: Rect, space: Space, edgeId: Id, ownSegs: Seg[], limit = Infinity): number {
  let hits = 0;
  const box = inflateRect(r, 1);
  space.nodes.query(box, (n) => {
    // The node's bounding box counts too (stricter than the shape: a label tucked into an ellipse corner reads as overlap); a true shape hit counts double.
    if (rectsIntersect(n.outline.rect, r)) hits += rectHitsOutline(n.outline, box) ? 2 : 1;
    return hits >= limit;
  });
  if (hits >= limit) return hits;
  space.segs.query(box, (sg) => {
    if (sg.edgeId !== edgeId && segmentHitsRect(sg.a, sg.b, r)) hits++;
    return hits >= limit;
  });
  if (hits >= limit) return hits;
  for (const sg of ownSegs) if (segmentHitsRect(sg.a, sg.b, r)) hits++;
  if (hits >= limit) return hits;
  space.labels.query(box, (l) => {
    if (rectsIntersect(l, r)) hits++;
    return hits >= limit;
  });
  return hits;
}

/** Point and unit tangent at arc length `d` from the START of `pts` (clamped to the polyline), plus the index of its segment. */
function walkPolyline(pts: Point[], d: number): { at: Point; tangent: Point; seg: number } {
  let left = Math.max(0, d);
  for (let i = 0; i < pts.length - 1; i++) {
    const len = distance(pts[i]!, pts[i + 1]!);
    if (left <= len || i === pts.length - 2) {
      const t = unit(pts[i]!, pts[i + 1]!);
      const k = Math.min(left, len);
      return { at: { x: pts[i]!.x + t.x * k, y: pts[i]!.y + t.y * k }, tangent: t, seg: i };
    }
    left -= len;
  }
  return { at: pts[0]!, tangent: { x: 1, y: 0 }, seg: 0 };
}

const LABEL_SCALES = [1, 0.85, 0.72];
const LABEL_LIFTS = [0, 5, 10, 16];

interface LabelSearch {
  /** Arc distances from the first point of `pts` to try, in preference order. */
  arcs: number[];
  /** Larger = preferred among equally clean candidates. */
  score: (c: Point, n: Point) => number;
  /** Extra obstacle (rect) the label may not touch. */
  avoid?: Rect;
}

/**
 * Deterministic label search along a polyline: arc positions x both sides x perpendicular lifts x shrink factors, each
 * tested against EVERY node outline (exact), other lines, this line's other segments and the labels placed so far.
 * First clean (0 hits) candidate in (shrink, arc, lift) order wins; the best-scoring side is tried first at each spot.
 * When nothing is clean the candidate with the fewest hits is used.
 */
function searchLabel(text: string, font: FontSpec, width: number, pts: Point[], gap: number, space: Space, edgeId: Id, q: LabelSearch): TextLabel {
  let best: TextLabel | undefined;
  let bestHits = Infinity;
  for (const scale of LABEL_SCALES) {
    const f: FontSpec = scale === 1 ? font : { ...font, size: font.size * scale };
    const w0 = scale === 1 ? width : width * scale;
    for (const arc of q.arcs) {
      const { at, tangent, seg } = walkPolyline(pts, arc);
      const base = textLabel(text, at, f, w0);
      const { w, h } = boxSize(base);
      const ownSegs: Seg[] = [];
      for (let i = 0; i < pts.length - 1; i++) if (i !== seg) ownSegs.push({ edgeId, a: pts[i]!, b: pts[i + 1]! });
      const cands: Array<{ c: Point; n: Point; score: number }> = [];
      for (const lift of LABEL_LIFTS) {
        for (const sgn of [1, -1]) {
          const n = { x: tangent.y * sgn, y: -tangent.x * sgn };
          const off = (Math.abs(n.x) * w) / 2 + (Math.abs(n.y) * h) / 2 + gap / 2 + 3 + lift;
          const c = { x: at.x + n.x * off, y: at.y + n.y * off };
          cands.push({ c, n, score: q.score(c, n) + (n.y < 0 || (n.y === 0 && n.x > 0) ? 0.01 : 0) - lift * 1000 });
        }
      }
      cands.sort((p1, p2) => p2.score - p1.score);
      for (const k of cands) {
        const cand: TextLabel = { ...base, x: k.c.x, y: k.c.y };
        const rect = labelRect(cand);
        const hits = labelHits(rect, space, edgeId, ownSegs, Math.max(1, bestHits)) + (q.avoid && rectsIntersect(rect, q.avoid) ? 1 : 0);
        if (hits < bestHits) {
          bestHits = hits;
          best = cand;
          if (hits === 0) return cand;
        }
      }
    }
  }
  return best ?? textLabel(text, walkPolyline(pts, q.arcs[0] ?? 0).at, font, width);
}

/** Cardinality text next to the ENTITY end: just outside the entity outline, beside (never on) the line. */
function cardinalityLabel(
  text: string, font: FontSpec, width: number, pts: Point[], gap: number, tgt: ChenNodeGeomAny, others: Point[],
  space: Space, edgeId: Id,
): TextLabel {
  const rev = pts.slice().reverse(); // walk away from the entity
  const total = pathLength(pts);
  const arcs: number[] = [];
  for (let d = 12; d < 72; d += 4) arcs.push(d);
  for (let d = 72; d < 200; d += 8) arcs.push(d);
  const usable = arcs.filter((d) => d <= total * 0.9 || d === 12);
  return searchLabel(text, font, width, rev, gap, space, edgeId, {
    arcs: usable.length > 0 ? usable : [Math.min(12, total / 2)],
    score: (c) => Math.min(Infinity, ...others.map((o) => distance(o, c))),
    avoid: inflateRect(rectOf(tgt), 2),
  });
}

/** Role text beside the line: longest segment first (middle outwards), then the rest; side away from the nodes' centroid. */
function roleLabel(text: string, font: FontSpec, width: number, pts: Point[], gap: number, centroid: Point, space: Space, edgeId: Id): TextLabel {
  const total = pathLength(pts);
  let bi = 0;
  let bl = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = distance(pts[i]!, pts[i + 1]!);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  let before = 0;
  for (let i = 0; i < bi; i++) before += distance(pts[i]!, pts[i + 1]!);
  const arcs: number[] = [];
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) arcs.push(before + bl * f);
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) arcs.push(total * f);
  const label = searchLabel(text, font, width, pts, gap, space, edgeId, { arcs, score: (c) => distance(c, centroid) });
  return { ...label, backdrop: true };
}

// ---------------------------------------------------------------------------
// 6. assemble
// ---------------------------------------------------------------------------

export function buildChenEdges(b: EdgeBuildInput): Record<Id, ChenEdgeGeom> {
  const { input, font, geoms } = b;
  const { diagram, measure } = input;
  const chen = diagram.options.chen;
  const orthogonal = chen?.routing === 'orthogonal';
  // DRAFT builds (scene/draft.ts): edges whose definition and both nodes are untouched keep their previous full geometry;
  // only the others run through the pipeline (orthogonal ones with a direct Z/L or a plain elbow instead of the router).
  const reuse = makeEdgeReuse(input);
  const reused: Record<Id, ChenEdgeGeom> = {};
  let items = collectItems(b);
  if (reuse) {
    items = items.filter((it) => {
      const prev = reuse(it.edgeId, it.src.nodeId, it.tgt.nodeId);
      if (prev?.kind !== 'chen-line') return true;
      reused[it.edgeId] = prev;
      return false;
    });
  }
  items.forEach(planItem);
  // Orthogonal routing applies to participation lines ONLY: Chen attribute links are always straight.
  const isOrtho = (it: Item): boolean => orthogonal && it.lineKind === 'participant';
  if (orthogonal) spreadAnchors(items.filter(isOrtho));

  const space: Space = { nodes: new Grid(), segs: new Grid(), labels: new Grid(), ends: [] };
  for (const g of Object.values(geoms)) space.nodes.add({ id: g.nodeId, outline: g.outline }, rectOf(g));

  // Route: ordinary lines first, then recursive loops (they look for free space around everything else).
  const paths = new Map<Id, Point[]>();
  const requests: RouteRequest[] = [];
  // Reserve every planned attachment point so a direct route on another side never lands on somebody's slot.
  if (orthogonal) {
    for (const it of items) {
      if (it.loop || !isOrtho(it)) continue;
      space.ends.push({ edgeId: it.edgeId, at: endPoint(it.src, it.plan[0].side, it.plan[0].offset) }, { edgeId: it.edgeId, at: endPoint(it.tgt, it.plan[1].side, it.plan[1].offset) });
    }
  }
  for (const it of items) {
    if (it.loop) continue;
    if (!isOrtho(it)) {
      const sp = straightPath(it);
      paths.set(it.edgeId, sp);
      addPath(space, it.edgeId, sp);
      continue;
    }
    const direct = it.manual ? undefined : directOrthogonal(it, space);
    if (direct) {
      paths.set(it.edgeId, direct);
      addPath(space, it.edgeId, direct);
    } else if (reuse && !it.manual) {
      const [sp, tp] = it.plan;
      const s = endPoint(it.src, sp.side, sp.offset);
      const t = endPoint(it.tgt, tp.side, tp.offset);
      const p = dedupePoints(orthogonalizeThrough([s, t], sideNormal(sp.side).x !== 0 ? 'h' : 'v'));
      paths.set(it.edgeId, p);
      addPath(space, it.edgeId, p);
    } else requests.push(routeRequest(it));
  }
  if (requests.length > 0) {
    const obstacles = Object.values(geoms).map((g) => ({ id: g.nodeId, rect: rectOf(g) }));
    const routed = routeOrthogonal(requests, { obstacles, clearance: CLEARANCE, stub: STUB });
    for (const r of requests) paths.set(r.key, dedupePoints(routed[r.key] ?? [r.source.point, r.target.point]));
  }
  for (const r of requests) addPath(space, r.key, paths.get(r.key)!);
  const layers = new Map<string, number>();
  for (const it of items) {
    if (!it.loop) continue;
    const pts = placeLoop(it, space, layers);
    paths.set(it.edgeId, pts);
    addPath(space, it.edgeId, pts);
  }

  // End points of every participation line per entity node (for label placement).
  const endsAtNode = new Map<Id, Array<{ edgeId: Id; at: Point }>>();
  for (const it of items) {
    const pts = paths.get(it.edgeId)!;
    for (const [nodeId, at] of [[it.src.nodeId, pts[0]!], [it.tgt.nodeId, pts[pts.length - 1]!]] as const) {
      const list = endsAtNode.get(nodeId) ?? [];
      list.push({ edgeId: it.edgeId, at });
      endsAtNode.set(nodeId, list);
    }
  }

  const out: Record<Id, ChenEdgeGeom> = {};
  const gapOf = (it: Item): number => (it.double ? railGap(it.edge.style?.strokeWidth ?? DEFAULT_EDGE_STROKE) : 0);
  const labelsOf = new Map<Id, ChenEdgeGeom['labels']>();
  for (const it of items) labelsOf.set(it.edgeId, []);

  // Pass 1: cardinalities, pass 2: roles (roles then avoid every cardinality).
  for (const pass of ['cardinality', 'role'] as const) {
    for (const it of items) {
      if (!it.rel || !it.participant) continue;
      const pts = paths.get(it.edgeId)!;
      const labels = labelsOf.get(it.edgeId)!;
      let label: TextLabel | undefined;
      if (pass === 'cardinality') {
        const cardText = cardinalityText(it.rel, it.participant.id, chen?.cardinalityStyle ?? 'letters');
        if (!cardText) continue;
        const f: FontSpec = { ...font };
        const others = (endsAtNode.get(it.tgt.nodeId) ?? []).filter((e) => e.edgeId !== it.edgeId).map((e) => e.at);
        label = cardinalityLabel(cardText, f, measure(cardText, f), pts, gapOf(it), it.tgt, others, space, it.edgeId);
      } else {
        const role = it.participant.role?.trim();
        if (!(chen?.showRoles && role)) continue;
        const f: FontSpec = { ...font, size: font.size * 0.9, style: 'italic' };
        const centroid = {
          x: (rectCenter(rectOf(it.src)).x + rectCenter(rectOf(it.tgt)).x) / 2,
          y: (rectCenter(rectOf(it.src)).y + rectCenter(rectOf(it.tgt)).y) / 2,
        };
        label = roleLabel(role, f, measure(role, f), pts, gapOf(it), centroid, space, it.edgeId);
      }
      labels.push({ id: pass, label });
      {
        const lr = labelRect(label);
        space.labels.add(lr, lr);
      }
    }
  }

  for (const it of items) {
    const pts = paths.get(it.edgeId)!;
    const sw = it.edge.style?.strokeWidth ?? DEFAULT_EDGE_STROKE;
    const rails = it.double ? buildRails(pts, it.src, it.tgt, railGap(sw)) : undefined;
    const labels = labelsOf.get(it.edgeId)!;
    for (const l of labels) {
      const off = it.edge.labelOffsets?.[l.id];
      if (off) l.label = { ...l.label, x: l.label.x + off.x, y: l.label.y + off.y };
    }

    const parts: Rect[] = [rectOfPoints(pts)];
    if (rails) parts.push(rectOfPoints(rails[0]), rectOfPoints(rails[1]));
    for (const l of labels) parts.push(labelRect(l.label));
    const bounds = inflateRect(unionRects(parts)!, sw / 2 + 1);

    const sRect = rectOf(it.src);
    const tRect = rectOf(it.tgt);
    const planned = !!it.loop || isOrtho(it);
    const sAt = pts[0]!;
    const tAt = pts[pts.length - 1]!;
    const wps = it.edge.route.waypoints;
    const autoWaypoints = it.manual ? wps.map((p) => ({ ...p })) : autoWaypointsOf(it, pts);

    out[it.edgeId] = {
      kind: 'chen-line',
      lineKind: it.lineKind,
      recursive: !!it.loop,
      edgeId: it.edgeId,
      ref: it.edge.ref,
      sourceNodeId: it.src.nodeId,
      targetNodeId: it.tgt.nodeId,
      paths: rails ? [pts, rails[0], rails[1]] : [pts],
      bounds,
      ends: [
        { nodeId: it.src.nodeId, at: sAt, side: planned ? it.plan[0].side : nearestSide(sRect, sAt), anchorRect: sRect },
        { nodeId: it.tgt.nodeId, at: tAt, side: planned ? it.plan[1].side : nearestSide(tRect, tAt), anchorRect: tRect },
      ],
      bendHandles: it.manual ? wps.map((at, index) => ({ index, at: { ...at } })) : [],
      autoWaypoints,
      labels,
      double: it.double,
      ...(rails ? { rails } : {}),
    };
  }
  if (!reuse) return out;
  const merged = { ...reused, ...out };
  const ordered: Record<Id, ChenEdgeGeom> = {};
  for (const id of Object.keys(diagram.edges)) if (merged[id]) ordered[id] = merged[id]!;
  return ordered;
}

/** Interior corners of the current auto route, excluding the router's perpendicular stub corners. */
function autoWaypointsOf(it: Item, pts: Point[]): Point[] {
  if (pts.length <= 2) return [];
  const interior = pts.slice(1, -1);
  if (it.loop) return interior;
  const stubs = it.plan.map((p, i) => {
    const g = i === 0 ? it.src : it.tgt;
    const at = endPoint(g, p.side, p.offset);
    const n = sideNormal(p.side);
    return { x: at.x + n.x * STUB, y: at.y + n.y * STUB };
  });
  return interior.filter((p) => !stubs.some((s) => Math.abs(s.x - p.x) < 1e-9 && Math.abs(s.y - p.y) < 1e-9));
}
