/**
 * ER-aware layout for Chen diagrams (pure; `autoLayout.ts` adapts a Scene to this input).
 *
 *  1. SKELETON: entities + relationships (attributes ignored) are laid out with ELK, each node inflated to an
 *     "envelope" that reserves room for its attribute fan, so neighbouring fans do not collide.
 *     Recursive (single-neighbour) relationships are not part of the skeleton: they are satellites placed on a free
 *     side of their entity (like attributes, but further away so the two participation lines have room).
 *  2. FANS: attributes are placed level by level (owners first, composite children afterwards). A fan points away
 *     from the skeleton centroid and away from incident lines; every candidate position is checked against all placed
 *     rectangles (clearance `attrGap`) and all drawn line segments, and the radius grows until the spot is free.
 *  3. INCREMENTAL mode (`mode:'incremental'`) leaves `pinned` nodes untouched and places only the others next to their
 *     already-placed neighbours (components with no placed node are laid out on their own and stacked below).
 *
 * Positions are all in CENTRE coordinates internally and converted to top-left on the way out.
 * Collision tests use bounding boxes, which over-approximate ellipses/diamonds: a layout that passes them can
 * never overlap as drawn.
 */
import type { Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import { inflateRect } from '@/scene/geometry';
import { layoutGraph, type LayoutAlgorithm, type LayoutDirection } from './elkGraph';
import { boundsOf, rectAtCenter, rectsOverlap, segmentHitsRect, segmentsCross } from './rects';
import { nudgeOutOfOverlap, placeNear, stackBelow } from './align';
import type { Positions, Size } from './types';

export type ChenKind = 'entity' | 'relationship' | 'attribute';

export interface ChenLayoutInput {
  sizes: Readonly<Record<Id, Size>>;
  kinds: Readonly<Record<Id, ChenKind>>;
  /** Relationship <-> participant lines (`a`/`b` order is irrelevant). */
  participantLinks: ReadonlyArray<{ id: Id; a: Id; b: Id }>;
  /** Owner (entity / relationship / composite attribute) -> attribute lines. */
  attributeLinks: ReadonlyArray<{ id: Id; owner: Id; attribute: Id }>;
  /** Current TOP-LEFT of every node; only read for pinned nodes. */
  current: Readonly<Record<Id, Point>>;
  /** Lower value = placed first in its fan (key attributes first). Default 0. */
  priority?: Readonly<Record<Id, number>>;
  /**
   * Stable semantic ordering key per node (kind, name, owner path, ...). All ordering decisions use it before the opaque
   * id, so the same model lays out identically whatever its ids are. Missing keys sort first, ties fall back to the id.
   */
  order?: Readonly<Record<Id, string>>;
}

export interface ChenLayoutOptions {
  mode?: 'full' | 'incremental';
  algorithm?: LayoutAlgorithm;
  direction?: LayoutDirection;
  /** Clearance between skeleton envelopes. Default 40. */
  spacing?: number;
  seed?: number;
  /** Nodes that keep `current` exactly. */
  pinned?: ReadonlySet<Id>;
  /** Abort a stale request (rejects with an `AbortError`). */
  signal?: AbortSignal;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Fraction of the full circle a fan may use when sizing its radius (the rest stays free for incident lines). */
const RING_FILL = 0.85;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Same constants as the Chen scene builder's recursive loops (src/scene/chen/edges.ts). */
const LOOP_LIFT = 26;
const LOOP_LAYER_GAP = 14;

const angDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const unit = (from: Point, to: Point): Point | undefined => {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return d < 1e-9 ? undefined : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};

/** The polylines the scene draws for `n` participations between rects `ra` and `rb` (src/scene/chen/edges.ts `loopPath`). */
export function chenLoopPolylines(ra: Rect, rb: Rect, n: number): Point[][] {
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
  const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
  const axisH = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
  const out: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const extra = LOOP_LIFT + Math.floor(i / 2) * LOOP_LAYER_GAP;
    if (axisH) {
      if (i % 2 === 0) {
        const y = Math.min(ra.y, rb.y) - extra;
        out.push([{ x: ca.x, y: ra.y }, { x: ca.x, y }, { x: cb.x, y }, { x: cb.x, y: rb.y }]);
      } else {
        const y = Math.max(ra.y + ra.h, rb.y + rb.h) + extra;
        out.push([{ x: ca.x, y: ra.y + ra.h }, { x: ca.x, y }, { x: cb.x, y }, { x: cb.x, y: rb.y + rb.h }]);
      }
    } else if (i % 2 === 0) {
      const x = Math.min(ra.x, rb.x) - extra;
      out.push([{ x: ra.x, y: ca.y }, { x, y: ca.y }, { x, y: cb.y }, { x: rb.x, y: cb.y }]);
    } else {
      const x = Math.max(ra.x + ra.w, rb.x + rb.w) + extra;
      out.push([{ x: ra.x + ra.w, y: ca.y }, { x, y: ca.y }, { x, y: cb.y }, { x: rb.x + rb.w, y: cb.y }]);
    }
  }
  return out;
}

export async function layoutChen(input: ChenLayoutInput, opts: ChenLayoutOptions = {}): Promise<Positions> {
  const spacing = opts.spacing ?? 40;
  const attrGap = Math.max(12, Math.round(spacing / 3));
  const satGap = Math.max(48, spacing);
  const pinned = opts.pinned ?? new Set<Id>();
  const incremental = opts.mode === 'incremental';
  const ordKey = (id: Id): string => input.order?.[id] ?? '';
  const byStr = (a: string, b: string): number => cmpStr(ordKey(a), ordKey(b)) || cmpStr(a, b);
  const ids = Object.keys(input.sizes).sort(byStr);

  // ---- structure ---------------------------------------------------------------------------------------------------
  const ownerOf = new Map<Id, Id>();
  for (const l of [...input.attributeLinks].sort((a, b) => byStr(a.attribute, b.attribute) || byStr(a.owner, b.owner) || cmpStr(a.id, b.id))) {
    if (input.kinds[l.attribute] === 'attribute' && input.sizes[l.owner] && !ownerOf.has(l.attribute) && l.owner !== l.attribute) {
      ownerOf.set(l.attribute, l.owner);
    }
  }
  // Break ownership cycles (corrupt input) by orphaning the offender.
  for (const a of ids) {
    const seen = new Set<Id>([a]);
    let cur = ownerOf.get(a);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        ownerOf.delete(a);
        break;
      }
      seen.add(cur);
      cur = ownerOf.get(cur);
    }
  }
  const prio = (id: Id): number => input.priority?.[id] ?? 0;
  const kids = new Map<Id, Id[]>();
  for (const [a, o] of ownerOf) (kids.get(o) ?? kids.set(o, []).get(o)!).push(a);
  for (const list of kids.values()) list.sort((a, b) => prio(a) - prio(b) || byStr(a, b));

  const neighbours = new Map<Id, Set<Id>>();
  const addNb = (a: Id, b: Id): void => {
    (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b);
    (neighbours.get(b) ?? neighbours.set(b, new Set()).get(b)!).add(a);
  };
  const links = input.participantLinks
    .filter((l) => input.sizes[l.a] && input.sizes[l.b] && l.a !== l.b)
    .sort((x, y) => {
      const [x0, x1] = byStr(x.a, x.b) <= 0 ? [x.a, x.b] : [x.b, x.a];
      const [y0, y1] = byStr(y.a, y.b) <= 0 ? [y.a, y.b] : [y.b, y.a];
      return byStr(x0, y0) || byStr(x1, y1) || cmpStr(x.id, y.id);
    });
  for (const l of links) addNb(l.a, l.b);
  // Pairs joined by several participant lines (recursive relationships, ternaries naming an entity twice) are drawn by
  // the scene as elbow loops that leave BOTH nodes on the sides perpendicular to their axis.
  const pairCount = new Map<string, { a: Id; b: Id; n: number }>();
  const pairKey = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const l of links) {
    const hit = pairCount.get(pairKey(l.a, l.b));
    if (hit) hit.n++;
    else pairCount.set(pairKey(l.a, l.b), { a: l.a, b: l.b, n: 1 });
  }
  const multiPairs = [...pairCount.values()].filter((p) => p.n >= 2);
  const nbOf = (id: Id): Id[] => [...(neighbours.get(id) ?? [])].sort(byStr);

  const skeleton = ids.filter((id) => input.kinds[id] !== 'attribute' || !ownerOf.has(id));
  const isSkeleton = new Set(skeleton);
  // A relationship with exactly one distinct neighbour (recursive or dangling) rides along its neighbour.
  const satellites = skeleton.filter((id) => input.kinds[id] === 'relationship' && nbOf(id).length === 1 && input.kinds[nbOf(id)[0]!] !== 'relationship');
  const isSatellite = new Set(satellites);
  const satellitesOf = new Map<Id, Id[]>();
  for (const s of satellites) (satellitesOf.get(nbOf(s)[0]!) ?? satellitesOf.set(nbOf(s)[0]!, []).get(nbOf(s)[0]!)!).push(s);

  // ---- placement state ---------------------------------------------------------------------------------------------
  const centers = new Map<Id, Point>();
  const rects = new Map<Id, Rect>();
  const segments: Array<[Id, Id]> = [];
  const segKey = new Set<string>();
  const size = (id: Id): Size => input.sizes[id]!;

  const place = (id: Id, c: Point): void => {
    centers.set(id, c);
    rects.set(id, rectAtCenter(c, size(id).w, size(id).h));
  };
  const addSegment = (a: Id, b: Id): void => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (segKey.has(k) || !centers.has(a) || !centers.has(b)) return;
    segKey.add(k);
    segments.push([a, b]);
  };
  // Elbow loops of multi-participation pairs (explicit polylines, as drawn) + the sides they leave their nodes on.
  const loopSegs: Array<[Point, Point]> = [];
  const loopAngles = new Map<Id, number[]>();
  const loopDone = new Set<string>();

  const polySegs = (pl: Point[]): Array<[Point, Point]> => pl.slice(1).map((q, i) => [pl[i]!, q] as [Point, Point]);

  /** Register the loops of every multi-participation pair whose two ends are placed (idempotent per pair). */
  const registerLoops = (): void => {
    for (const p of multiPairs) {
      const k = pairKey(p.a, p.b);
      const ra = rects.get(p.a);
      const rb = rects.get(p.b);
      if (loopDone.has(k) || !ra || !rb) continue;
      loopDone.add(k);
      for (const pl of chenLoopPolylines(ra, rb, p.n)) loopSegs.push(...polySegs(pl));
      const ca = centers.get(p.a)!;
      const cb = centers.get(p.b)!;
      const horizAxis = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
      const exits = horizAxis ? [-Math.PI / 2, Math.PI / 2] : [0, Math.PI];
      for (const id of [p.a, p.b]) loopAngles.set(id, [...(loopAngles.get(id) ?? []), ...exits.slice(0, Math.min(2, p.n))]);
    }
  };
  /** Would the loops between `owner` (placed) and `kid` placed at `at` run through a foreign node? */
  const loopsClear = (owner: Id, kid: Id, at: Point): boolean => {
    const n = pairCount.get(pairKey(owner, kid))?.n ?? 1;
    if (n < 2) return true;
    const ro = rects.get(owner)!;
    const rk = rectAtCenter(at, size(kid).w, size(kid).h);
    for (const pl of chenLoopPolylines(ro, rk, n)) {
      for (const [a, b] of polySegs(pl)) {
        for (const [id, other] of rects) {
          if (id === owner || id === kid) continue;
          if (segmentHitsRect(a, b, inflateRect(other, 2))) return false;
        }
      }
    }
    return true;
  };

  // Links whose two ends are placed become obstacles for later placements.
  const flushSegments = (): void => {
    for (const l of links) addSegment(l.a, l.b);
    for (const [a, o] of ownerOf) addSegment(o, a);
    registerLoops();
  };

  for (const id of ids) {
    if (pinned.has(id)) {
      const p = input.current[id];
      if (p) place(id, { x: p.x + size(id).w / 2, y: p.y + size(id).h / 2 });
    }
  }

  let centroid: Point = { x: 0, y: 0 }; // refreshed once the skeleton (or the pinned part of it) is placed
  // ---- 1. skeleton -------------------------------------------------------------------------------------------------
  const extentCache = new Map<Id, number>();
  const extentOf = (id: Id): number => {
    const hit = extentCache.get(id);
    if (hit !== undefined) return hit;
    extentCache.set(id, 0); // cycle guard
    const s = size(id);
    const own = kids.get(id) ?? [];
    let ext = 0;
    if (own.length > 0) {
      let perKid = 0;
      let dims = 0;
      for (const k of own) {
        const d = Math.max(size(k).w, size(k).h);
        dims += d + attrGap;
        perKid = Math.max(perKid, attrGap + d + extentOf(k));
      }
      const ring = dims / (TAU * RING_FILL) - Math.max(s.w, s.h) / 2 + dims / own.length / 2;
      ext = Math.max(perKid, ring);
    }
    for (const sat of satellitesOf.get(id) ?? []) {
      ext = Math.max(ext, satGap + Math.max(size(sat).w, size(sat).h) + extentOf(sat));
    }
    extentCache.set(id, ext);
    return ext;
  };

  const needsLayout = (id: Id): boolean => !centers.has(id);
  const free = skeleton.filter((id) => !isSatellite.has(id) && needsLayout(id));

  if (!incremental) {
    if (free.length > 0) await layoutSkeleton(free);
  } else if (centers.size === 0 && free.length > 0) {
    await layoutSkeleton(free); // nothing pinned: incremental degenerates to a full layout
  }

  async function layoutSkeleton(toLay: Id[]): Promise<void> {
    const env = (id: Id): Size => {
      const e = extentOf(id) * 0.75;
      return { w: size(id).w + 2 * e, h: size(id).h + 2 * e };
    };
    const inSet = new Set(toLay);
    const pinnedSk = skeleton.filter((id) => !isSatellite.has(id) && centers.has(id));
    const all = [...new Set([...toLay, ...pinnedSk])].sort(byStr);
    const nodes = all.map((id) => {
      const e = env(id);
      const c = centers.get(id);
      return { id, w: e.w, h: e.h, sortKey: ordKey(id), ...(c && !inSet.has(id) ? { fixed: { x: c.x - e.w / 2, y: c.y - e.h / 2 } } : {}) };
    });
    // Orient entity -> relationship -> other entities so `layered` produces the familiar chain; stress ignores direction.
    const edges: Array<{ id: string; source: Id; target: Id }> = [];
    const seen = new Set<string>();
    for (const rel of all.filter((id) => input.kinds[id] === 'relationship')) {
      const parts = nbOf(rel).filter((p) => all.includes(p));
      parts.forEach((p, i) => {
        const [source, target] = i === 0 ? [p, rel] : [rel, p];
        const k = `${source}|${target}`;
        if (!seen.has(k)) {
          seen.add(k);
          edges.push({ id: k, source, target });
        }
      });
    }
    const algorithm = opts.algorithm ?? (opts.direction ? 'layered' : 'stress');
    const avg = nodes.reduce((s, n) => s + Math.max(n.w, n.h), 0) / Math.max(1, nodes.length);
    const lay = await layoutGraph({
      nodes,
      edges,
      algorithm,
      direction: opts.direction,
      spacing,
      seed: opts.seed,
      edgeLength: avg * 0.9 + spacing,
      clearance: Math.min(spacing, 20),
      signal: opts.signal,
    });
    for (const n of nodes) {
      if (!inSet.has(n.id)) continue;
      place(n.id, { x: lay[n.id]!.x + n.w / 2, y: lay[n.id]!.y + n.h / 2 });
    }
  }

  // Incremental: grow outwards from placed nodes.
  if (incremental) {
    centroid = skeletonCentroid();
    await placeIncremental();
  }

  /**
   * Repair pass: a participation line (or recursive loop) must never run through a skeleton node that is not one of its
   * ends. Offending nodes are pushed perpendicular to the line until they clear it, then plain overlaps are removed;
   * repeated until stable (bounded). Pinned nodes never move.
   */
  function repairSkeleton(): void {
    const sk = skeleton.filter((id) => !isSatellite.has(id) && centers.has(id));
    const movable = new Set(sk.filter((id) => !pinned.has(id)));
    if (movable.size === 0 || sk.length < 3) return;
    for (let pass = 0; pass < 40; pass++) {
      const lines: Array<{ p: Point; q: Point; a: Id; b: Id }> = [];
      const seenPair = new Set<string>();
      for (const l of links) {
        const k = pairKey(l.a, l.b);
        if (seenPair.has(k) || !centers.has(l.a) || !centers.has(l.b) || isSatellite.has(l.a) || isSatellite.has(l.b)) continue;
        seenPair.add(k);
        const n = pairCount.get(k)!.n;
        if (n < 2) lines.push({ p: centers.get(l.a)!, q: centers.get(l.b)!, a: l.a, b: l.b });
        else for (const pl of chenLoopPolylines(rects.get(l.a)!, rects.get(l.b)!, n)) for (const [p, q] of polySegs(pl)) lines.push({ p, q, a: l.a, b: l.b });
      }
      let changed = false;
      for (const { p, q, a, b } of lines) {
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 1e-9) continue;
        for (const n of sk) {
          if (n === a || n === b || !movable.has(n)) continue;
          const r = rects.get(n)!;
          if (!segmentHitsRect(p, q, inflateRect(r, attrGap))) continue;
          const ux = -(q.y - p.y) / len;
          const uy = (q.x - p.x) / len;
          const c = centers.get(n)!;
          const off = (c.x - p.x) * ux + (c.y - p.y) * uy;
          const sgn = off > 1e-9 ? 1 : off < -1e-9 ? -1 : 1;
          const need = (r.w / 2) * Math.abs(ux) + (r.h / 2) * Math.abs(uy) + attrGap + 1;
          const shift = need - Math.abs(off);
          if (shift <= 0) continue;
          place(n, { x: c.x + sgn * ux * shift, y: c.y + sgn * uy * shift });
          changed = true;
        }
      }
      // plain overlaps created by the pushes
      const rs = sk.map((id) => ({ id, sortKey: ordKey(id), x: rects.get(id)!.x, y: rects.get(id)!.y, w: rects.get(id)!.w, h: rects.get(id)!.h }));
      const fixedIds = new Set(sk.filter((id) => !movable.has(id)));
      const moved = nudgeOutOfOverlap(rs, { gap: attrGap, fixedIds });
      for (const [id, pt] of Object.entries(moved)) {
        place(id, { x: pt.x + size(id).w / 2, y: pt.y + size(id).h / 2 });
        changed = true;
      }
      if (!changed) break;
    }
  }
  repairSkeleton();

  async function placeIncremental(): Promise<void> {
    const all = skeleton.filter((id) => !centers.has(id));
    // Components of unplaced skeleton nodes (via skeleton adjacency) that touch nothing placed are laid out on their own.
    const comp = new Map<Id, number>();
    let nc = 0;
    for (const s of all) {
      if (comp.has(s)) continue;
      const stack = [s];
      comp.set(s, nc);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of nbOf(cur)) if (!comp.has(n) && !centers.has(n) && isSkeleton.has(n)) (comp.set(n, nc), stack.push(n));
      }
      nc++;
    }
    const touchesPlaced = (c: number): boolean =>
      all.some((s) => comp.get(s) === c && nbOf(s).some((n) => centers.has(n))) ||
      all.some((s) => comp.get(s) === c && (kids.get(s) ?? []).some((k) => centers.has(k)));
    const isolated = new Set<number>();
    for (let c = 0; c < nc; c++) if (!touchesPlaced(c)) isolated.add(c);

    // (a) connected to placed nodes: most-placed-neighbours first.
    const pending = new Set(all.filter((s) => !isolated.has(comp.get(s)!)));
    while (pending.size > 0) {
      let pick: Id | undefined;
      let bestScore = -1;
      for (const s of [...pending].sort(byStr)) {
        const score = nbOf(s).filter((n) => centers.has(n)).length * 2 + ((kids.get(s) ?? []).some((k) => centers.has(k)) ? 1 : 0);
        if (score > bestScore) (bestScore = score, (pick = s));
      }
      const id = pick!;
      pending.delete(id);
      if (bestScore <= 0) {
        // Only reachable through a not-yet-placed neighbour; park it next to the content and let the neighbour attach later.
        placeBelowContent(id);
        continue;
      }
      placeNearNeighbours(id);
    }
    // (b) isolated components: lay out alone, stack below.
    for (let c = 0; c < nc; c++) {
      if (!isolated.has(c)) continue;
      const members = all.filter((s) => comp.get(s) === c);
      const memberSet = new Set(members);
      const subIds = new Set<Id>();
      const collect = (id: Id): void => {
        subIds.add(id);
        for (const k of kids.get(id) ?? []) collect(k);
      };
      members.forEach(collect);
      const sub: ChenLayoutInput = {
        sizes: Object.fromEntries([...subIds].map((i) => [i, size(i)])),
        kinds: Object.fromEntries([...subIds].map((i) => [i, input.kinds[i]!])),
        participantLinks: links.filter((l) => memberSet.has(l.a) && memberSet.has(l.b)),
        attributeLinks: input.attributeLinks.filter((l) => subIds.has(l.owner) && subIds.has(l.attribute)),
        current: {},
        priority: input.priority,
        order: input.order,
      };
      const local = await layoutChen(sub, { ...opts, mode: 'full', pinned: new Set() });
      const box = boundsOf([...subIds].map((i) => ({ x: local[i]!.x, y: local[i]!.y, w: size(i).w, h: size(i).h })))!;
      const content = boundsOf([...rects.values()]);
      const target = content
        ? stackBelow({ w: box.w, h: box.h }, content, [], satGap)
        : { x: 0, y: 0 };
      for (const i of subIds) {
        place(i, { x: local[i]!.x - box.x + target.x + size(i).w / 2, y: local[i]!.y - box.y + target.y + size(i).h / 2 });
      }
    }
  }

  function placeBelowContent(id: Id): void {
    const content = boundsOf([...rects.values()]);
    const s = size(id);
    const p = content ? stackBelow(s, content, [...rects.values()], satGap) : { x: 0, y: 0 };
    place(id, { x: p.x + s.w / 2, y: p.y + s.h / 2 });
  }

  function placeNearNeighbours(id: Id): void {
    const s = size(id);
    const placedNb = nbOf(id).filter((n) => centers.has(n));
    const obstacles = [...rects.values()];
    if (placedNb.length >= 2) {
      const c = {
        x: placedNb.reduce((a, n) => a + centers.get(n)!.x, 0) / placedNb.length,
        y: placedNb.reduce((a, n) => a + centers.get(n)!.y, 0) / placedNb.length,
      };
      const p = placeNear(s, c, obstacles, { gap: attrGap });
      place(id, { x: p.x + s.w / 2, y: p.y + s.h / 2 });
      return;
    }
    // Single placed neighbour (or only attributes placed): sit on its free side.
    const anchor = placedNb[0] ?? ownerOf.get(id) ?? [...kids.get(id) ?? []].find((k) => centers.has(k));
    if (anchor === undefined || !centers.has(anchor)) return placeBelowContent(id);
    const ac = centers.get(anchor)!;
    const phi = awayAngle(anchor);
    const dist = Math.max(size(anchor).w, size(anchor).h) / 2 + Math.max(s.w, s.h) / 2 + satGap;
    const p = placeNear(s, { x: ac.x + Math.cos(phi) * dist, y: ac.y + Math.sin(phi) * dist }, obstacles, {
      gap: attrGap,
      preferAngle: phi,
    });
    place(id, { x: p.x + s.w / 2, y: p.y + s.h / 2 });
  }

  // ---- 2. satellites + attribute fans ------------------------------------------------------------------------------
  function skeletonCentroid(): Point {
    const pts = skeleton.filter((id) => centers.has(id)).map((id) => centers.get(id)!);
    if (pts.length === 0) return { x: 0, y: 0 };
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  }

  /** Direction a fan around `owner` should point: away from the diagram's centre and away from incident lines. */
  function awayAngle(owner: Id): number {
    const oc = centers.get(owner)!;
    const parent = ownerOf.get(owner);
    let ux = 0;
    let uy = 0;
    if (parent !== undefined && centers.has(parent)) {
      const u = unit(centers.get(parent)!, oc);
      if (u) (ux = u.x, (uy = u.y));
    } else {
      const away = unit(centroid, oc);
      if (away) (ux += 0.6 * away.x, (uy += 0.6 * away.y));
      const nb = nbOf(owner).filter((n) => centers.has(n));
      for (const n of nb) {
        const u = unit(oc, centers.get(n)!);
        if (u) (ux -= u.x / nb.length, (uy -= u.y / nb.length));
      }
    }
    return Math.hypot(ux, uy) < 0.15 ? -Math.PI / 2 : Math.atan2(uy, ux);
  }

  function blockedAngles(owner: Id): number[] {
    const oc = centers.get(owner)!;
    const out: number[] = [];
    for (const [a, b] of segments) {
      const other = a === owner ? b : b === owner ? a : undefined;
      if (other === undefined) continue;
      const oth = centers.get(other)!;
      out.push(Math.atan2(oth.y - oc.y, oth.x - oc.x));
    }
    out.push(...(loopAngles.get(owner) ?? []));
    return out;
  }

  function valid(owner: Id, kid: Id, p: Point, gap: number, strict: boolean | 'soft' = true, extra?: (kid: Id, p: Point) => boolean): boolean {
    const s = size(kid);
    const r = rectAtCenter(p, s.w, s.h);
    for (const [id, other] of rects) {
      if (id === kid) continue;
      if (rectsOverlap(r, other, gap)) return false;
    }
    if (!strict) return true;
    const fat = inflateRect(r, 3);
    for (const [a, b] of segments) {
      if (a === kid || b === kid) continue;
      if (segmentHitsRect(centers.get(a)!, centers.get(b)!, fat)) return false;
    }
    for (const [a, b] of loopSegs) if (segmentHitsRect(a, b, fat)) return false;
    if (extra && !extra(kid, p)) return false;
    // 'soft': the node itself keeps clear of every line, but its own link may cross something (last resort before stacking)
    if (strict === 'soft') return true;
    const oc = centers.get(owner)!;
    for (const [a, b] of loopSegs) if (segmentsCross(oc, p, a, b)) return false;
    for (const [id, other] of rects) {
      if (id === owner || id === kid) continue;
      if (segmentHitsRect(oc, p, inflateRect(other, 2))) return false;
    }
    return true;
  }

  const OFFSETS: number[] = [0];
  for (let d = 10; d <= 180; d += 10) OFFSETS.push(d * DEG, -d * DEG);
  const FINE_OFFSETS: number[] = [];
  for (let d = 5; d < 180; d += 10) FINE_OFFSETS.push(d * DEG, -d * DEG);
  const DENSE_OFFSETS: number[] = [];
  for (let d = 1; d <= 180; d += 1) DENSE_OFFSETS.push(d * DEG, -d * DEG);

  function placeFan(owner: Id, list: Id[], gap: number, extra?: (kid: Id, p: Point) => boolean, onPlaced?: (kid: Id) => void): void {
    const oc = centers.get(owner)!;
    const os = size(owner);
    const k = list.length;
    const phi = awayAngle(owner);
    const ringMin = list.reduce((a, id) => a + size(id).w + gap, 0) / (TAU * RING_FILL);
    const step = k <= 1 ? 0 : Math.min(60 * DEG, (306 * DEG) / (k - 1));
    list.forEach((kid, i) => {
      const ks = size(kid);
      const target = phi + (i - (k - 1) / 2) * step;
      const blocked = blockedAngles(owner);
      const candsFor = (offsets: number[]) => offsets.map((o) => {
        const a = target + o;
        let pen = (Math.abs(o) / DEG) * 1.2;
        for (const b of blocked) {
          const d = angDiff(a, b) / DEG;
          if (d < 18) pen += 300;
          else if (d < 32) pen += (60 * (32 - d)) / 14;
        }
        return { a, score: pen };
      }).sort((x, y) => x.score - y.score);
      const cands = candsFor(OFFSETS);
      // All kids share one ring radius lower bound, otherwise the first kids hug the owner and wall off the rest.
      const tMin = ringMin;
      const search = (strict: boolean | 'soft', offsets?: number[]): Point | undefined => {
        let best: { total: number; p: Point } | undefined;
        for (const c of offsets ? candsFor(offsets) : cands) {
          if (best && c.score >= best.total) break;
          const dx = Math.cos(c.a);
          const dy = Math.sin(c.a);
          const tx = Math.abs(dx) > 1e-9 ? ((os.w + ks.w) / 2 + gap) / Math.abs(dx) : Infinity;
          const ty = Math.abs(dy) > 1e-9 ? ((os.h + ks.h) / 2 + gap) / Math.abs(dy) : Infinity;
          const t0 = Math.max(Math.min(tx, ty), tMin);
          for (let t = t0; t < t0 + 1500; t += 8) {
            const p = { x: oc.x + dx * t, y: oc.y + dy * t };
            if (!valid(owner, kid, p, gap, strict, extra)) continue;
            const total = c.score + (t - t0) * 0.4;
            if (!best || total < best.total) best = { total, p };
            break;
          }
        }
        return best?.p;
      };
      // If a saturated inner ring blocks every straight link, accept a link crossing instead of stacking nodes.
      // finer angular resolution before giving up on clean links (dense neighbourhoods leave only narrow angular gaps)
      const p1 = search(true) ?? search(true, FINE_OFFSETS) ?? search(true, DENSE_OFFSETS);
      const p = p1 ?? search('soft') ?? search(false) ?? { x: oc.x + (os.w + ks.w) / 2 + gap + 2000, y: oc.y };
      place(kid, p);
      addSegment(owner, kid);
      onPlaced?.(kid);
    });
  }

  flushSegments();
  centroid = skeletonCentroid();

  // satellites (recursive relationships): free side of their entity, further away than attributes
  for (const e of [...satellitesOf.keys()].sort(byStr)) {
    if (!centers.has(e)) continue;
    const todo = (satellitesOf.get(e) ?? []).filter((s) => !centers.has(s));
    // each satellite's loops become obstacles BEFORE the next satellite of the same entity is placed
    const done = (s: Id): void => {
      for (const l of links) if (l.a === s || l.b === s) addSegment(l.a, l.b);
      registerLoops();
    };
    if (todo.length > 0) placeFan(e, todo, satGap, (kid, p) => loopsClear(e, kid, p), done);
    for (const s of todo) done(s);
  }

  // attributes, level by level
  let level = skeleton.filter((id) => centers.has(id));
  const visited = new Set<Id>(level);
  while (level.length > 0) {
    const next: Id[] = [];
    for (const owner of level) {
      const list = kids.get(owner) ?? [];
      const todo = list.filter((k) => !centers.has(k));
      if (todo.length > 0) placeFan(owner, todo, attrGap);
      for (const k of list) if (!visited.has(k)) (visited.add(k), next.push(k));
    }
    level = next.filter((id) => centers.has(id)).sort(byStr);
  }

  // anything still unplaced (orphans in incremental mode, defensive otherwise)
  for (const id of ids) if (!centers.has(id)) placeBelowContent(id);

  const out: Positions = {};
  for (const id of ids) {
    if (pinned.has(id) && input.current[id]) continue;
    const c = centers.get(id)!;
    out[id] = { x: c.x - size(id).w / 2, y: c.y - size(id).h / 2 };
  }
  return out;
}
