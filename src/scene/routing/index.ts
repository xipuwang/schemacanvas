/**
 * Obstacle-avoiding orthogonal router (implements the frozen `RouteOrthogonal` contract in ./types).
 *
 * Pipeline per request:  anchor ─stub→ s1 ··· A* over a sparse "interesting coordinates" grid ··· t1 ─stub→ anchor.
 *  - The search runs on the grid spanned by obstacle edges (inflated by `ctx.clearance`), the two stub ends, their
 *    midlines and an outer ring, so a route can hug an obstacle at exactly `clearance` or pass through a channel.
 *  - State = (grid node, heading). Cost = length + bend penalty (+ a small surcharge for turning onto a "random"
 *    line, which makes Z-shapes prefer the midline between the endpoints). U-turns are impossible by construction,
 *    so the first/last segment always continue the perpendicular stub.
 *  - Crowded endpoints degrade gracefully: obstacles that swallow a stub end are shrunk, then dropped for that request;
 *    if no path exists at full clearance the search is repeated with clearance 0, finally with no obstacles.
 *  - After all requests are routed, collinear overlapping interior segments of different routes are nudged apart
 *    (`ROUTE_NUDGE_GAP`), choosing lane order so the turns at the segment ends do not cross.
 * Everything is deterministic: no hashing of object keys, ties are broken by insertion sequence.
 */
import type { Id } from '@/model/types';
import type { Point, Rect, Side } from '../base';
import { dedupePoints, sideNormal } from '../geometry';
import type { RouteContext, RouteOrthogonal, RouteRequest } from './types';

export type { RouteContext, RouteEnd, RouteOrthogonal, RouteRequest } from './types';

/**
 * Additive extension of `RouteContext.obstacles[]`: an obstacle may carry its own `clearance` (default `ctx.clearance`).
 * Callers use it for thin keep-out zones (e.g. an FK arrowhead) that must not be padded by the table clearance.
 */
export interface RouteObstacle {
  id: Id;
  rect: Rect;
  clearance?: number;
}

/** Extra cost of every 90 degree turn (in px of path length). */
export const ROUTE_BEND_PENALTY = 24;
/** Surcharge for turning onto a line that is neither a midline nor the line of an endpoint stub. */
const ROUTE_ODD_LINE_PENALTY = 4;
/** Distance between parallel segments of different routes that would otherwise overlap. */
export const ROUTE_NUDGE_GAP = 6;
const EPS = 1e-6;
/** Coordinates closer than this are the same line (float noise); used to snap grid lines and classify segment axes. */
const SNAP_TOL = 1e-5;
/** Parallel overlapping segments closer than this are float-noise-level neighbours: ONE line when nudging. */
const LINE_CLUSTER_TOL = 1;
/** A manual bend closer than this to the anchor border (along the side normal) counts as behind the border. */
const MIN_SHORT_STUB = 3;
const finite = (n: number): boolean => Number.isFinite(n);
const finitePoint = (p: Point | undefined): boolean => !!p && finite(p.x) && finite(p.y);
const quant = (v: number): number => Math.round(v * 1e6) / 1e6;
/** Hard cap on A* expansions per attempt; beyond this we fall back to a looser attempt. */
const MAX_EXPANSIONS = 40000;

const isVertical = (s: Side): boolean => s === 'top' || s === 'bottom';

/** Drop points that lie on a straight line between their neighbours. */
export function simplifyOrthogonal(points: Point[]): Point[] {
  const pts = dedupePoints(points);
  const out: Point[] = [];
  for (const p of pts) {
    while (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const collinear = (a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y);
      if (collinear) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

/**
 * Remove float noise from an orthogonal polyline: consecutive points whose x (or y) differ by less than `SNAP_TOL` get
 * EXACTLY the same x (or y), so no segment is slanted by 1e-14 and collinear points can be merged. The first and last
 * points are never moved.
 */
export function cleanOrthogonal(points: Point[]): Point[] {
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  const n = p.length;
  if (n < 3) return simplifyOrthogonal(p);
  for (let i = 1; i <= n - 2; i++) {
    if (Math.abs(p[i]!.x - p[i - 1]!.x) < SNAP_TOL) p[i]!.x = p[i - 1]!.x;
    if (Math.abs(p[i]!.y - p[i - 1]!.y) < SNAP_TOL) p[i]!.y = p[i - 1]!.y;
  }
  // The end point is exact: pull the chain of near-equal points before it onto the end's coordinate.
  for (const axis of ['x', 'y'] as const) {
    let j = n - 2;
    if (Math.abs(p[j]![axis] - p[n - 1]![axis]) >= SNAP_TOL) continue;
    let next = p[j]![axis];
    p[j]![axis] = p[n - 1]![axis];
    for (j = n - 3; j >= 1; j--) {
      if (Math.abs(p[j]![axis] - next) >= SNAP_TOL) break;
      next = p[j]![axis];
      p[j]![axis] = p[n - 1]![axis];
    }
  }
  return simplifyOrthogonal(p);
}

/**
 * Pass through `points` exactly, inserting at most one elbow between consecutive points. The elbow CONTINUES the
 * axis of the previous segment (`initialAxis` for the first one) so the path never doubles back on itself.
 */
export function orthogonalizeThrough(points: Point[], initialAxis: 'h' | 'v' = 'h', simplify = true): Point[] {
  const out: Point[] = [];
  let axis: 'h' | 'v' = initialAxis;
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) {
      out.push(axis === 'h' ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y });
    }
    out.push(p);
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 2]!;
      const b = out[n - 1]!;
      if (a.x !== b.x || a.y !== b.y) axis = a.y === b.y ? 'h' : 'v';
    }
  }
  // `simplify = false` keeps every given point as a vertex even when it is collinear (manual routes need their bends).
  return simplify ? simplifyOrthogonal(out) : dedupePoints(out);
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PreparedObstacle {
  id: string;
  raw: Box;
  padded: Box;
}

const toBox = (r: Rect, pad: number): Box => ({ x0: r.x - pad, y0: r.y - pad, x1: r.x + r.w + pad, y1: r.y + r.h + pad });

const strictlyInside = (b: Box, p: Point): boolean => p.x > b.x0 + EPS && p.x < b.x1 - EPS && p.y > b.y0 + EPS && p.y < b.y1 - EPS;

/** True when the axis-aligned segment crosses the OPEN interior of `b` (touching the border is allowed). */
function segmentHitsBox(ax: number, ay: number, bx: number, by: number, b: Box): boolean {
  if (ay === by) {
    return ay > b.y0 + EPS && ay < b.y1 - EPS && Math.max(ax, bx) > b.x0 + EPS && Math.min(ax, bx) < b.x1 - EPS;
  }
  return ax > b.x0 + EPS && ax < b.x1 - EPS && Math.max(ay, by) > b.y0 + EPS && Math.min(ay, by) < b.y1 - EPS;
}

function prepareObstacles(ctx: RouteContext): PreparedObstacle[] {
  const out: PreparedObstacle[] = [];
  for (const o of ctx.obstacles as RouteObstacle[]) {
    const r = o.rect;
    if (!finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h)) continue; // a corrupt rect must not poison the grid
    const pad = o.clearance !== undefined && finite(o.clearance) ? o.clearance : ctx.clearance;
    out.push({ id: o.id, raw: toBox(r, 0), padded: toBox(r, pad) });
  }
  return out;
}

/** Union of the raw boxes of the obstacles whose (closed) rect contains `p`: the table a route end is attached to. */
function boxAround(prepared: PreparedObstacle[], p: Point): Box | undefined {
  let out: Box | undefined;
  for (const o of prepared) {
    const b = o.raw;
    if (p.x < b.x0 - EPS || p.x > b.x1 + EPS || p.y < b.y0 - EPS || p.y > b.y1 + EPS) continue;
    out = out
      ? { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) }
      : { ...b };
  }
  return out;
}

/**
 * The obstacle boxes one request must respect at a given clearance level. An obstacle that already swallows a stub end
 * (a crowded neighbour) is first shrunk to its raw rect and, if the stub end is still inside, ignored for this request.
 */
function boxesFor(req: RouteRequest, prepared: PreparedObstacle[], ends: Point[], level: 'padded' | 'raw' | 'none'): Box[] {
  if (level === 'none') return [];
  const ignored = new Set(req.ignoreObstacleIds ?? []);
  const out: Box[] = [];
  for (const o of prepared) {
    if (ignored.has(o.id)) continue;
    let b = level === 'padded' ? o.padded : o.raw;
    if (ends.some((p) => strictlyInside(b, p))) b = o.raw;
    if (ends.some((p) => strictlyInside(b, p))) continue;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A* over the sparse grid
// ---------------------------------------------------------------------------

/** Heading indices: 0 = +x, 1 = +y (down), 2 = -x, 3 = -y. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const headingOfSide = (side: Side): number => {
  const n = sideNormal(side);
  return n.x === 1 ? 0 : n.y === 1 ? 1 : n.x === -1 ? 2 : 3;
};

/** Minimal binary min-heap keyed by (priority, insertion sequence) for deterministic tie-breaking. */
class MinHeap {
  private pri: number[] = [];
  private seq: number[] = [];
  private val: number[] = [];
  private counter = 0;
  get size(): number {
    return this.val.length;
  }
  push(priority: number, value: number): void {
    let i = this.val.length;
    this.pri.push(priority);
    this.seq.push(this.counter++);
    this.val.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        this.swap(i, p);
        i = p;
      } else break;
    }
  }
  pop(): number {
    const top = this.val[0]!;
    const lastP = this.pri.pop()!;
    const lastS = this.seq.pop()!;
    const lastV = this.val.pop()!;
    const n = this.val.length;
    if (n > 0) {
      this.pri[0] = lastP;
      this.seq[0] = lastS;
      this.val[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.pri[a]! < this.pri[b]! || (this.pri[a] === this.pri[b] && this.seq[a]! < this.seq[b]!);
  }
  private swap(a: number, b: number): void {
    [this.pri[a], this.pri[b]] = [this.pri[b]!, this.pri[a]!];
    [this.seq[a], this.seq[b]] = [this.seq[b]!, this.seq[a]!];
    [this.val[a], this.val[b]] = [this.val[b]!, this.val[a]!];
  }
}

function sortedUnique(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  return out;
}

function indexOfValue(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === v) return mid;
    if (arr[mid]! < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

interface SearchInput {
  s0: Point;
  t0: Point;
  s1: Point;
  t1: Point;
  startHeading: number;
  goalHeading: number;
  boxes: Box[];
  ring: number;
  freeX: Set<number>;
  freeY: Set<number>;
}

/** Returns the corner list s1 … t1 (inclusive) or undefined when no path exists / the expansion cap is hit. */
function search(inp: SearchInput): Point[] | undefined {
  const { boxes } = inp;
  // Every grid line is quantised: a midline 490.79999999999995 and an obstacle edge 490.8 are ONE line, so no route ever
  // contains a segment that is slanted by float noise. `cleanOrthogonal` later restores the exact end coordinates.
  const s1 = { x: quant(inp.s1.x), y: quant(inp.s1.y) };
  const t1 = { x: quant(inp.t1.x), y: quant(inp.t1.y) };
  const xv: number[] = [s1.x, t1.x, (s1.x + t1.x) / 2, inp.s0.x, inp.t0.x].map(quant);
  const yv: number[] = [s1.y, t1.y, (s1.y + t1.y) / 2, inp.s0.y, inp.t0.y].map(quant);
  let minX = Math.min(s1.x, t1.x, inp.s0.x, inp.t0.x);
  let maxX = Math.max(s1.x, t1.x, inp.s0.x, inp.t0.x);
  let minY = Math.min(s1.y, t1.y, inp.s0.y, inp.t0.y);
  let maxY = Math.max(s1.y, t1.y, inp.s0.y, inp.t0.y);
  for (const b of boxes) {
    xv.push(quant(b.x0), quant(b.x1));
    yv.push(quant(b.y0), quant(b.y1));
    minX = Math.min(minX, b.x0);
    maxX = Math.max(maxX, b.x1);
    minY = Math.min(minY, b.y0);
    maxY = Math.max(maxY, b.y1);
  }
  xv.push(quant(minX - inp.ring), quant(maxX + inp.ring));
  yv.push(quant(minY - inp.ring), quant(maxY + inp.ring));
  const xs = sortedUnique(xv);
  const ys = sortedUnique(yv);
  const nx = xs.length;
  const ny = ys.length;
  // bit 2 = "just turned in place": a second in-place turn would compose a U-turn at one node, so it is forbidden.
  const enc = (i: number, j: number, d: number, turned = 0): number => (((i * ny + j) << 3) | (turned << 2)) | d;

  const si = indexOfValue(xs, s1.x);
  const sj = indexOfValue(ys, s1.y);
  const ti = indexOfValue(xs, t1.x);
  const tj = indexOfValue(ys, t1.y);
  const start = enc(si, sj, inp.startHeading);
  const goal = enc(ti, tj, inp.goalHeading);
  const goalAlt = enc(ti, tj, inp.goalHeading, 1);

  const states = nx * ny * 8;
  const g = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const done = new Uint8Array(states);
  const edgeState = new Uint8Array(nx * ny * 2); // 0 unknown, 1 free, 2 blocked
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(Math.abs(s1.x - t1.x) + Math.abs(s1.y - t1.y), start);
  let expansions = 0;
  let reached: number | undefined;

  const relax = (from: number, to: number, cost: number): void => {
    if (g[to]! <= cost) return;
    g[to] = cost;
    parent[to] = from;
    const cellIdx = to >> 3;
    const i = Math.floor(cellIdx / ny);
    const j = cellIdx - i * ny;
    heap.push(cost + Math.abs(xs[i]! - t1.x) + Math.abs(ys[j]! - t1.y), to);
  };

  while (heap.size > 0) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal || cur === goalAlt) {
      reached = cur;
      break;
    }
    if (++expansions > MAX_EXPANSIONS) return undefined;
    const d = cur & 3;
    const justTurned = (cur >> 2) & 1;
    const cell = cur >> 3;
    const i = Math.floor(cell / ny);
    const j = cell - i * ny;
    const gc = g[cur]!;
    const x = xs[i]!;
    const y = ys[j]!;

    // Straight on to the next grid line.
    const ni = i + DX[d]!;
    const nj = j + DY[d]!;
    if (ni >= 0 && ni < nx && nj >= 0 && nj < ny) {
      const nxv = xs[ni]!;
      const nyv = ys[nj]!;
      // Each grid edge is tested once (it is reached from up to four headings and from both ends).
      const ei = d === 0 ? (i * ny + j) * 2 : d === 2 ? (ni * ny + j) * 2 : d === 1 ? (i * ny + j) * 2 + 1 : (i * ny + nj) * 2 + 1;
      let state = edgeState[ei]!;
      if (state === 0) {
        state = 1;
        for (const b of boxes) {
          if (segmentHitsBox(x, y, nxv, nyv, b)) {
            state = 2;
            break;
          }
        }
        edgeState[ei] = state;
      }
      const free = state === 1;
      if (free) relax(cur, enc(ni, nj, d), gc + Math.abs(nxv - x) + Math.abs(nyv - y));
    }
    // Turn left/right in place (never reverse, never twice in a row).
    for (const nd of justTurned ? [] : [(d + 1) & 3, (d + 3) & 3]) {
      const line = nd % 2 === 1 ? x : y; // turning to a vertical heading → we now travel along x = const
      const free = nd % 2 === 1 ? inp.freeX.has(line) : inp.freeY.has(line); // sets hold quantised values
      relax(cur, enc(i, j, nd, 1), gc + ROUTE_BEND_PENALTY + (free ? 0 : ROUTE_ODD_LINE_PENALTY));
    }
  }

  if (reached === undefined) return undefined;
  const pts: Point[] = [];
  let s = reached;
  while (s >= 0) {
    const cell = s >> 3;
    const i = Math.floor(cell / ny);
    const j = cell - i * ny;
    pts.push({ x: xs[i]!, y: ys[j]! });
    s = parent[s]!;
  }
  return pts.reverse();
}

/**
 * Largest stub length (<= `stub`) for the end at `p` heading along `n` that does not end strictly inside an obstacle
 * (a crowded neighbour). Falls back to the full stub when even a tiny one would be swallowed (the obstacle is then
 * shrunk / dropped by `boxesFor`).
 */
function fitStub(req: RouteRequest, prepared: PreparedObstacle[], p: Point, n: Point, stub: number): number {
  const ignored = new Set(req.ignoreObstacleIds ?? []);
  let best = stub;
  for (const o of prepared) {
    if (ignored.has(o.id)) continue;
    const b = o.raw;
    const e = { x: p.x + n.x * best, y: p.y + n.y * best };
    if (!strictlyInside(b, e)) continue;
    // distance from p to the face the stub enters through
    const along = n.x !== 0 ? (n.x > 0 ? b.x0 - p.x : p.x - b.x1) : n.y > 0 ? b.y0 - p.y : p.y - b.y1;
    if (along >= 3 && along < best) best = along;
  }
  return best;
}

function autoRoute(req: RouteRequest, prepared: PreparedObstacle[], ctx: RouteContext): Point[] {
  const sn = sideNormal(req.source.side);
  const tn = sideNormal(req.target.side);
  const s0 = req.source.point;
  const t0 = req.target.point;
  let stubS = ctx.stub;
  let stubT = ctx.stub;
  // Facing ends closer than two stubs: the stub ends would cross, which draws a hook. Meet in the middle instead.
  if (sn.x === -tn.x && sn.y === -tn.y) {
    const gap = (t0.x - s0.x) * sn.x + (t0.y - s0.y) * sn.y;
    if (gap > 0 && gap < 2 * ctx.stub) stubS = stubT = gap / 2;
  }
  stubS = fitStub(req, prepared, s0, sn, stubS);
  stubT = fitStub(req, prepared, t0, tn, stubT);
  const s1 = { x: s0.x + sn.x * stubS, y: s0.y + sn.y * stubS };
  const t1 = { x: t0.x + tn.x * stubT, y: t0.y + tn.y * stubT };
  const srcV = isVertical(req.source.side);
  const tgtV = isVertical(req.target.side);
  const freeX = new Set<number>([quant((s1.x + t1.x) / 2)]);
  const freeY = new Set<number>([quant((s1.y + t1.y) / 2)]);
  if (srcV) freeX.add(quant(s1.x));
  else freeY.add(quant(s1.y));
  if (tgtV) freeX.add(quant(t1.x));
  else freeY.add(quant(t1.y));

  const intersects = (b: Box, w: Box): boolean => b.x1 >= w.x0 && b.x0 <= w.x1 && b.y1 >= w.y0 && b.y0 <= w.y1;
  const pathHits = (pts: Point[], b: Box): boolean => {
    for (let i = 0; i + 1 < pts.length; i++) if (segmentHitsBox(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, b)) return true;
    return false;
  };
  const run = (boxes: Box[]): Point[] | undefined =>
    search({
      s0,
      t0,
      s1,
      t1,
      startHeading: headingOfSide(req.source.side),
      goalHeading: (headingOfSide(req.target.side) + 2) & 3,
      boxes,
      ring: Math.max(ctx.clearance, 4),
      freeX,
      freeY,
    });
  /**
   * Search on the obstacles near the endpoints first (the grid is spanned by obstacle edges, so a far-away table only
   * makes the search slower), then add any further obstacle the found path actually hits and search again. The result
   * is always checked against ALL boxes of the level.
   */
  const windowed = (all: Box[]): Point[] | undefined => {
    const margin = 4 * Math.max(ctx.clearance, 4) + 40;
    const win: Box = {
      x0: Math.min(s0.x, t0.x, s1.x, t1.x) - margin,
      y0: Math.min(s0.y, t0.y, s1.y, t1.y) - margin,
      x1: Math.max(s0.x, t0.x, s1.x, t1.x) + margin,
      y1: Math.max(s0.y, t0.y, s1.y, t1.y) + margin,
    };
    const inWin = new Set<Box>(all.filter((b) => intersects(b, win)));
    // Little to gain when the window already holds most obstacles: one search over everything.
    if (inWin.size * 5 >= all.length * 3) return run(all);
    for (let round = 0; round < 6; round++) {
      const found = run(all.filter((b) => inWin.has(b)));
      if (!found) break;
      const extra = all.filter((b) => !inWin.has(b) && pathHits(found, b));
      if (extra.length === 0) return found;
      for (const b of extra) inWin.add(b);
    }
    return run(all);
  };

  /**
   * Cheap shapes first: a straight line, an L or a Z through the midline. When one of them is free it is what the search
   * would return anyway (fewest bends, Manhattan length), without building a grid.
   */
  const quick = (boxes: Box[]): Point[] | undefined => {
    const hs = headingOfSide(req.source.side);
    const hg = (headingOfSide(req.target.side) + 2) & 3;
    const mx = (s1.x + t1.x) / 2;
    const my = (s1.y + t1.y) / 2;
    const shapes: Point[][] = [
      [s1, t1],
      [s1, { x: t1.x, y: s1.y }, t1],
      [s1, { x: s1.x, y: t1.y }, t1],
      [s1, { x: s1.x, y: my }, { x: t1.x, y: my }, t1],
      [s1, { x: mx, y: s1.y }, { x: mx, y: t1.y }, t1],
    ];
    for (const raw of shapes) {
      const pts = dedupePoints(raw);
      if (pts.length < 2) {
        if (pts.length === 1 && hs === hg) return pts; // s1 === t1: the stubs already meet
        continue;
      }
      let ok = true;
      let prevDir = -1;
      for (let i = 0; i + 1 < pts.length && ok; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (a.x !== b.x && a.y !== b.y) ok = false;
        const dir = a.y === b.y ? (b.x > a.x ? 0 : 2) : b.y > a.y ? 1 : 3;
        if (i === 0 && dir !== hs) ok = false;
        if (i === pts.length - 2 && dir !== hg) ok = false;
        if (prevDir >= 0 && ((prevDir + 2) & 3) === dir) ok = false;
        prevDir = dir;
        if (ok && boxes.some((bx) => segmentHitsBox(a.x, a.y, b.x, b.y, bx))) ok = false;
      }
      if (ok) return pts;
    }
    return undefined;
  };

  for (const level of ['padded', 'raw', 'none'] as const) {
    const levelBoxes = boxesFor(req, prepared, [s1, t1], level);
    const found = (level === 'padded' ? quick(levelBoxes) : undefined) ?? windowed(levelBoxes);
    if (found) {
      // `found` runs between the (quantised) stub ends; splice in the exact ones.
      found[0] = s1;
      found[found.length - 1] = t1;
      return cleanOrthogonal([s0, ...found, t0]);
    }
  }
  // Unreachable: the 'none' level always has a path. Kept as a total function.
  return simplifyOrthogonal([s0, s1, t1, t0]);
}

/**
 * Repair the first segment after a stub end: when the next point lies BEHIND the stub (back towards the cell the route
 * leaves from) the path would double back through that cell. Insert a sideways detour that clears the owning obstacle.
 * `path[0]` is the stub end; `n` the outward normal at the end.
 */
function detourEnd(path: Point[], anchor: Point, n: Point, own: Box | undefined, stub: number): Point[] {
  if (path.length < 2) return path;
  const p0 = path[0]!;
  const p1 = path[1]!;
  const d = (p1.x - p0.x) * n.x + (p1.y - p0.y) * n.y;
  if (d >= -EPS) return path;
  // A waypoint that is behind the stub end but still clearly outside the cell just SHORTENS the stub (that is how a
  // stored auto route with a shortened stub reproduces itself); only a bend at or behind the border is a reversal.
  if ((p1.x - anchor.x) * n.x + (p1.y - anchor.y) * n.y >= MIN_SHORT_STUB && Math.abs((p1.x - p0.x) * n.y) + Math.abs((p1.y - p0.y) * n.x) < EPS) return path;
  const lat = { x: n.x === 0 ? 1 : 0, y: n.y === 0 ? 1 : 0 };
  const latOf = (p: Point): number => p.x * lat.x + p.y * lat.y;
  // Which way to step aside: the shorter way round the owning obstacle; on a tie against the direction the path
  // travels afterwards (so it does not retrace a run that passes the next bend).
  let travel = 1;
  for (let k = 1; k < path.length; k++) {
    const dl = latOf(path[k]!) - latOf(p0);
    if (Math.abs(dl) > EPS) {
      travel = Math.sign(dl);
      break;
    }
  }
  const CLEAR = 6;
  const room = (dir: number): number => {
    if (!own) return stub;
    const lo = lat.x === 1 ? own.x0 : own.y0;
    const hi = lat.x === 1 ? own.x1 : own.y1;
    return Math.max(dir > 0 ? hi - latOf(p0) + CLEAR : latOf(p0) - lo + CLEAR, Math.min(stub, 8));
  };
  const dir = room(-travel) <= room(travel) ? -travel : travel;
  const dist = room(dir);
  const shift = { x: lat.x * dir * dist, y: lat.y * dir * dist };
  const at = (p: Point): Point => ({ x: p.x + shift.x, y: p.y + shift.y });
  return [p0, at(p0), at(p1), ...path.slice(2)];
}

function manualRoute(req: RouteRequest, prepared: PreparedObstacle[], ctx: RouteContext): Point[] {
  const sn = sideNormal(req.source.side);
  const tn = sideNormal(req.target.side);
  const s0 = req.source.point;
  const t0 = req.target.point;
  const s1 = { x: s0.x + sn.x * ctx.stub, y: s0.y + sn.y * ctx.stub };
  const t1 = { x: t0.x + tn.x * ctx.stub, y: t0.y + tn.y * ctx.stub };
  const wps = req.waypoints ?? [];
  let mid = orthogonalizeThrough([s1, ...wps, t1], isVertical(req.source.side) ? 'v' : 'h', false);
  // Both stubs must survive: a waypoint behind an anchor side would otherwise make the path run through the cell.
  mid = detourEnd(mid, s0, sn, boxAround(prepared, s0), ctx.stub);
  mid = detourEnd([...mid].reverse(), t0, tn, boxAround(prepared, t0), ctx.stub).reverse();
  return cleanOrthogonal([s0, ...mid, t0]);
}

// ---------------------------------------------------------------------------
// Parallel-segment nudging
// ---------------------------------------------------------------------------

interface Seg {
  route: number;
  index: number; // segment pts[index] → pts[index + 1]
  horizontal: boolean;
  line: number; // y for horizontal, x for vertical
  lo: number;
  hi: number;
}

function interiorSegments(routes: Point[][], movable: Movable[]): Seg[] {
  const segs: Seg[] = [];
  routes.forEach((pts, r) => {
    const mv = movable[r];
    if (!mv) return;
    for (let i = 1; i <= pts.length - 3; i++) {
      // 'ends': only the two segments next to the stub ends may move (derived jogs, not user-drawn bends).
      if (mv === 'ends' && i !== 1 && i !== pts.length - 3) continue;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const horizontal = Math.abs(a.y - b.y) < SNAP_TOL; // tolerance: float noise must not flip the axis
      segs.push({
        route: r,
        index: i,
        horizontal,
        line: horizontal ? a.y : a.x,
        lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      });
    }
  });
  return segs;
}

/** Direction (-1 / +1) in which the route leaves segment `s` at its low (`end = 'lo'`) or high end. */
function turnAt(pts: Point[], s: Seg, end: 'lo' | 'hi'): number {
  const a = pts[s.index]!;
  const b = pts[s.index + 1]!;
  const aIsLo = s.horizontal ? a.x < b.x : a.y < b.y;
  const atStart = (end === 'lo') === aIsLo;
  const corner = atStart ? a : b;
  const other = atStart ? pts[s.index - 1]! : pts[s.index + 2]!;
  const delta = s.horizontal ? other.y - corner.y : other.x - corner.x;
  return Math.sign(delta);
}

/**
 * Lane order of a cluster of overlapping segments (index 0 = smallest coordinate: top / left). Pairwise rule: where
 * both turn the same way at an end, the segment reaching further out takes the outer lane; where they turn opposite
 * ways the one turning towards +coordinate sits on the +side. Copeland score, deterministic tie-break.
 */
function laneOrder(cluster: Seg[], routes: Point[][]): Seg[] {
  const n = cluster.length;
  const below = new Array<number>(n).fill(0); // how many others this one should sit BELOW (greater coordinate)
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const sa = cluster[a]!;
      const sb = cluster[b]!;
      let vote = 0; // >0: a below b
      for (const end of ['lo', 'hi'] as const) {
        const ta = turnAt(routes[sa.route]!, sa, end);
        const tb = turnAt(routes[sb.route]!, sb, end);
        const ea = end === 'lo' ? sa.lo : sa.hi;
        const eb = end === 'lo' ? sb.lo : sb.hi;
        if (ta !== tb) {
          vote += ta > tb ? 1 : -1; // the one turning to +side goes to the +side
        } else if (ea !== eb && ta !== 0) {
          const aOuter = end === 'lo' ? ea < eb : ea > eb;
          // outer segment sits on the side opposite to the turn direction
          vote += aOuter ? -ta : ta;
        }
      }
      if (vote > 0) {
        below[a]!++;
        below[b]!--;
      } else if (vote < 0) {
        below[b]!++;
        below[a]!--;
      }
    }
  }
  return cluster
    .map((s, i) => ({ s, score: below[i]!, i }))
    .sort((p, q) => p.score - q.score || p.i - q.i)
    .map((p) => p.s);
}

function clusters(segs: Seg[], tol: number): Seg[][] {
  const out: Seg[][] = [];
  for (const horizontal of [true, false]) {
    // Group segments whose lines coincide within LINE_CLUSTER_TOL (chained), then split each group into runs that overlap.
    const byLine = segs.filter((s) => s.horizontal === horizontal).sort((a, b) => a.line - b.line || a.route - b.route || a.index - b.index);
    const groups: Seg[][] = [];
    for (const s of byLine) {
      const g = groups[groups.length - 1];
      if (g && s.line - g[g.length - 1]!.line < tol) g.push(s);
      else groups.push([s]);
    }
    for (const list of groups) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.route - b.route || a.index - b.index);
      let current: Seg[] = [sorted[0]!];
      let reach = sorted[0]!.hi;
      for (let i = 1; i < sorted.length; i++) {
        const s = sorted[i]!;
        if (s.lo < reach - EPS) {
          current.push(s);
          reach = Math.max(reach, s.hi);
        } else {
          if (current.length > 1) out.push(current);
          current = [s];
          reach = s.hi;
        }
      }
      if (current.length > 1) out.push(current);
    }
  }
  // Deterministic processing order.
  return out.sort((a, b) => a[0]!.route - b[0]!.route || a[0]!.index - b[0]!.index || Number(b[0]!.horizontal) - Number(a[0]!.horizontal));
}

/**
 * How far segment `s` may move (negative = towards -coordinate) without shrinking an adjacent END segment (stub /
 * arrow shaft) below `minEnd`, or flipping it. Returns [lo, hi] (possibly infinite).
 */
function feasibleShift(pts: Point[], s: Seg, minEnd: number): [number, number] {
  let lo = -Infinity;
  let hi = Infinity;
  const n = pts.length;
  const axis = s.horizontal ? 'y' : 'x';
  if (s.index - 1 === 0) {
    const delta = pts[1]![axis] - pts[0]![axis];
    const len = Math.abs(delta);
    if (delta > 0) lo = Math.max(lo, minEnd - len);
    else hi = Math.min(hi, len - minEnd);
  }
  if (s.index + 1 === n - 2) {
    const delta = pts[n - 2]![axis] - pts[n - 1]![axis];
    const len = Math.abs(delta);
    if (delta > 0) lo = Math.max(lo, minEnd - len);
    else hi = Math.min(hi, len - minEnd);
  }
  return [lo, hi];
}

/** `true`: every interior segment may move; `'ends'`: only the jogs next to the stubs; `false`: the route is fixed. */
export type Movable = boolean | 'ends';

interface NudgeOptions {
  /** Lane spacing (default `ROUTE_NUDGE_GAP`) and the line distance below which two runs count as one cluster. */
  gap?: number;
  clusterTol?: number;
  /** Half width of the lane bundle each route stands for (default 0). */
  half?: number[];
  movable: Movable[];
  obstacles: PreparedObstacle[];
  ignore: string[][];
  minEnd: number;
}

function nudgeParallel(routes: Point[][], o: NudgeOptions): Point[][] {
  const segs = interiorSegments(routes, o.movable);
  // route -> segment index -> absolute target line
  const shifts = new Map<number, Map<number, { line: number; horizontal: boolean }>>();
  const gap = o.gap ?? ROUTE_NUDGE_GAP;
  for (const cluster of clusters(segs, o.clusterTol ?? LINE_CLUSTER_TOL)) {
    const ordered = laneOrder(cluster, routes);
    const n = ordered.length;
    const mean = cluster.reduce((a, s) => a + s.line, 0) / n;
    // Lanes are `gap` apart (plus the half widths of the bundles they stand for) around the cluster's mean line (members may
    // start a fraction of a pixel apart).
    const half = (s: Seg): number => o.half?.[s.route] ?? 0;
    const pos: number[] = [];
    ordered.forEach((s, rank) => pos.push(rank === 0 ? 0 : pos[rank - 1]! + gap + half(ordered[rank - 1]!) + half(s)));
    const centre = pos.reduce((a, v) => a + v, 0) / n;
    const base = ordered.map((s, rank) => mean + (pos[rank]! - centre) - s.line);
    const windows = ordered.map((s) => feasibleShift(routes[s.route]!, s, o.minEnd));
    // One common shift keeps the lanes evenly spaced while respecting every member's window (e.g. lanes of a stub-level
    // run may only move AWAY from the table). No common shift → leave this cluster alone rather than distort it.
    const cLo = Math.max(...windows.map((w, k) => w[0] - base[k]!));
    const cHi = Math.min(...windows.map((w, k) => w[1] - base[k]!));
    if (cLo > cHi + EPS) continue;
    const c = Math.max(cLo, Math.min(cHi, 0));
    ordered.forEach((s, rank) => {
      const delta = base[rank]! + c;
      if (Math.abs(delta) < EPS) return;
      let m = shifts.get(s.route);
      if (!m) shifts.set(s.route, (m = new Map()));
      m.set(s.index, { line: s.line + delta, horizontal: s.horizontal });
    });
  }
  const out = routes.map((r) => cleanOrthogonal(r));
  for (const [r, m] of shifts) {
    // Apply the shifts one by one: a shift that would push the route into an obstacle (or shrink an end segment) is
    // dropped on its own instead of vetoing the shifts of the other, unrelated clusters of the same route.
    let current = routes[r]!.map((p) => ({ ...p }));
    let changed = false;
    for (const [idx, t] of [...m].sort((a, b) => a[0] - b[0])) {
      const candidate = current.map((p) => ({ ...p }));
      const a = candidate[idx]!;
      const b = candidate[idx + 1]!;
      if (t.horizontal) a.y = b.y = t.line;
      else a.x = b.x = t.line;
      if (nudgeIsValid(routes[r]!, candidate, o.obstacles, o.ignore[r] ?? [], o.minEnd)) {
        current = candidate;
        changed = true;
      }
    }
    if (changed) out[r] = cleanOrthogonal(current);
  }
  return out;
}

/** A nudged route must keep its end segments (>= minEnd, same direction) and not run into any obstacle it did not already cross. */
function nudgeIsValid(before: Point[], after: Point[], prepared: PreparedObstacle[], ignore: string[], minEnd: number): boolean {
  const n = before.length;
  const endOk = (i0: number, i1: number): boolean => {
    const bx = Math.sign(before[i1]!.x - before[i0]!.x);
    const by = Math.sign(before[i1]!.y - before[i0]!.y);
    const ax = after[i1]!.x - after[i0]!.x;
    const ay = after[i1]!.y - after[i0]!.y;
    const was = Math.abs(before[i1]!.x - before[i0]!.x) + Math.abs(before[i1]!.y - before[i0]!.y);
    // An end segment that was already shorter than `minEnd` (a crowded stub) must merely not shrink further.
    return Math.sign(ax) === bx && Math.sign(ay) === by && Math.abs(ax) + Math.abs(ay) >= Math.min(minEnd, was) - EPS;
  };
  if (!endOk(0, 1) || !endOk(n - 1, n - 2)) return false;
  const ignored = new Set(ignore);
  const own = [before[0]!, before[n - 1]!];
  const hits = (pts: Point[], b: Box): boolean => {
    for (let i = 0; i < pts.length - 1; i++) if (segmentHitsBox(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, b)) return true;
    return false;
  };
  for (const ob of prepared) {
    if (ignored.has(ob.id)) continue;
    const b = { x0: ob.raw.x0 + 1, y0: ob.raw.y0 + 1, x1: ob.raw.x1 - 1, y1: ob.raw.y1 - 1 };
    if (own.some((p) => strictlyInside(b, p))) continue;
    if (hits(after, b) && !hits(before, b)) return false;
  }
  return true;
}

/**
 * Public nudging pass over ALREADY computed routes (first/last points and segments stay fixed). Used by callers that
 * post-process routes (e.g. composite-FK bundles whose branches are derived from a routed centreline). Same rules as the
 * batch router: only collinear OVERLAPPING interior segments of different routes move, by `ROUTE_NUDGE_GAP` lanes.
 */
function laneOptions(ctx: RouteContext, half?: number[]): Pick<NudgeOptions, 'gap' | 'clusterTol' | 'half'> {
  const g = ctx.laneGap;
  if (g === undefined || !finite(g) || g <= 0) return half ? { half } : {};
  return { gap: g, clusterTol: g - 1e-6, ...(half ? { half } : {}) };
}

export function nudgeRoutes(
  routes: Point[][],
  opts: { movable: Movable[]; ctx: RouteContext; ignoreObstacleIds?: string[][]; minEnd?: number; halfWidths?: number[] },
): Point[][] {
  return nudgeParallel(routes, {
    movable: opts.movable,
    obstacles: prepareObstacles(opts.ctx),
    ignore: opts.ignoreObstacleIds ?? [],
    minEnd: opts.minEnd ?? Math.max(4, opts.ctx.stub * 0.75),
    ...laneOptions(opts.ctx, opts.halfWidths),
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const routeOrthogonal: RouteOrthogonal = (requests, rawCtx) => {
  // Corrupt numbers must never make the search diverge: sanitise the context, and answer a request with a non-finite
  // end or waypoint by the bare end-to-end segment.
  const ctx: RouteContext = {
    ...rawCtx,
    clearance: finite(rawCtx.clearance) && rawCtx.clearance >= 0 ? rawCtx.clearance : 0,
    stub: finite(rawCtx.stub) && rawCtx.stub >= 0 ? rawCtx.stub : 0,
  };
  const prepared = prepareObstacles(ctx);
  const routes: Point[][] = [];
  const movable: boolean[] = [];
  for (const req of requests) {
    const valid = finitePoint(req.source.point) && finitePoint(req.target.point) && (req.waypoints ?? []).every(finitePoint);
    if (!valid) {
      routes.push([req.source.point, req.target.point]);
      movable.push(false);
      continue;
    }
    const manual = !!req.waypoints && req.waypoints.length > 0;
    routes.push(manual ? manualRoute(req, prepared, ctx) : autoRoute(req, prepared, ctx));
    movable.push(!manual);
  }
  const nudged = movable.some(Boolean)
    ? nudgeParallel(routes, {
        movable,
        obstacles: prepared,
        ignore: requests.map((r) => r.ignoreObstacleIds ?? []),
        minEnd: Math.max(4, ctx.stub * 0.75),
        ...laneOptions(ctx, requests.map((r) => r.halfWidth ?? 0)),
      })
    : routes;
  const out: Record<string, Point[]> = {};
  requests.forEach((req, i) => {
    out[req.key] = nudged[i]!;
  });
  return out;
};

// ---------------------------------------------------------------------------
// Minimum lane separation (post pass over FINAL routes)
// ---------------------------------------------------------------------------

interface LaneSeg {
  route: number;
  index: number;
  horizontal: boolean;
  line: number;
  lo: number;
  hi: number;
  /** First or last segment of its route: it is anchored (the end point cannot move). */
  anchored: boolean;
}

function laneSegments(pts: Point[], route: number): LaneSeg[] {
  const out: LaneSeg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const horizontal = Math.abs(a.y - b.y) < SNAP_TOL;
    if (!horizontal && Math.abs(a.x - b.x) >= SNAP_TOL) continue;
    out.push({
      route,
      index: i,
      horizontal,
      line: horizontal ? a.y : a.x,
      lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      anchored: i === 0 || i === pts.length - 2,
    });
  }
  return out;
}

/** Spatial index of lane segments by (orientation, line bucket): a deficit lookup only meets segments whose line is near. */
class LaneIndex {
  private readonly buckets = new Map<string, LaneSeg[]>();
  /** Bucket width (px). */
  static readonly B = 32;
  ops = 0;
  private key(horizontal: boolean, b: number): string {
    return `${horizontal ? 'h' : 'v'}${b}`;
  }
  add(segs: LaneSeg[]): void {
    for (const s of segs) {
      const k = this.key(s.horizontal, Math.floor(s.line / LaneIndex.B));
      const list = this.buckets.get(k);
      if (list) list.push(s);
      else this.buckets.set(k, [s]);
    }
  }
  remove(segs: LaneSeg[]): void {
    for (const s of segs) {
      const list = this.buckets.get(this.key(s.horizontal, Math.floor(s.line / LaneIndex.B)));
      if (!list) continue;
      const at = list.indexOf(s);
      if (at >= 0) list.splice(at, 1);
    }
  }
  /** Segments of other routes with a line within `reach` of `line`. */
  near(horizontal: boolean, line: number, reach: number): LaneSeg[] {
    const out: LaneSeg[] = [];
    for (let b = Math.floor((line - reach) / LaneIndex.B); b <= Math.floor((line + reach) / LaneIndex.B); b++) {
      const list = this.buckets.get(this.key(horizontal, b));
      if (list) for (const t of list) out.push(t);
    }
    this.ops += out.length;
    return out;
  }
}

/** Shortfall of the lane gap summed over every overlapping parallel pair that involves the segments `mine` of route `route`. */
function laneDeficit(index: LaneIndex, mine: LaneSeg[], route: number, gap: number, skip: (i: number, j: number) => boolean, half: number[], reach: number): number {
  let total = 0;
  for (const s of mine) {
    for (const t of index.near(s.horizontal, s.line, reach)) {
      const j = t.route;
      if (j === route || skip(route, j) || (s.anchored && t.anchored)) continue;
      const d = Math.abs(t.line - s.line);
      const need = gap + (half[route] ?? 0) + (half[j] ?? 0);
      if (d >= need - 1e-6) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 1) continue;
      total += need - d;
    }
  }
  return total;
}

/**
 * Keep every pair of parallel, overlapping segments of different routes at least `gap` apart (the nudge pass only separates
 * lines that coincide; two lines 3 px apart read as ONE line and can suggest the wrong referenced cell). Only INTERIOR
 * segments of movable routes move, never into an obstacle and never shrinking an end segment; a move is kept only when it
 * strictly reduces the shortfall. Pairs of two ANCHORED (first / last) segments are left alone, as are pairs `skip` names
 * (e.g. branches of one foreign key). `half[i]` is the half width of the lane bundle route `i` stands for. Work is bounded
 * (a spatial index plus an operation budget), so a hopelessly tangled sheet degrades to "less separated", never to "slow".
 */
export function separateRoutes(
  routes: Point[][],
  opts: { movable: Movable[]; ctx: RouteContext; gap: number; half?: number[]; ignoreObstacleIds?: string[][]; skip?: (i: number, j: number) => boolean; minEnd?: number; budget?: number },
): Point[][] {
  const prepared = prepareObstacles(opts.ctx);
  const minEnd = opts.minEnd ?? Math.max(4, opts.ctx.stub * 0.75);
  const skip = opts.skip ?? (() => false);
  const half = opts.half ?? [];
  const out = routes.map((r) => r.map((p) => ({ x: p.x, y: p.y })));
  const all = out.map((r, i) => laneSegments(r, i));
  const reach = 2 * (opts.gap + 2 * Math.max(0, ...half));
  const index = new LaneIndex();
  all.forEach((segs) => index.add(segs));
  const budget = opts.budget ?? 1_000_000;
  let changed = false;
  for (let round = 0; round < 60 && index.ops < budget; round++) {
    // the single best move of the round (largest reduction of the shortfall) is applied; then every deficit is re-read
    let best: { route: number; pts: Point[]; gain: number } | undefined;
    for (let r = 0; r < out.length && index.ops < budget; r++) {
      const mv = opts.movable[r];
      if (!mv) continue;
      const before = laneDeficit(index, all[r]!, r, opts.gap, skip, half, reach);
      if (before === 0) continue;
      for (const s of all[r]!) {
        if (s.anchored || (mv === 'ends' && s.index !== 1 && s.index !== out[r]!.length - 3)) continue;
        // the lines it is too close to decide where it may go: just past each of them, on either side
        const targets = new Set<number>();
        for (const t of index.near(s.horizontal, s.line, reach)) {
          if (t.route === r || skip(r, t.route) || Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 1) continue;
          const need = opts.gap + (half[r] ?? 0) + (half[t.route] ?? 0);
          if (Math.abs(t.line - s.line) < 2 * need) {
            targets.add(t.line + need);
            targets.add(t.line - need);
          }
        }
        for (const line of targets) {
          const [lo, hi] = feasibleShift(out[r]!, s as unknown as Seg, minEnd);
          const delta = line - s.line;
          if (delta < lo - EPS || delta > hi + EPS) continue;
          const cand = out[r]!.map((p) => ({ x: p.x, y: p.y }));
          if (s.horizontal) cand[s.index]!.y = cand[s.index + 1]!.y = line;
          else cand[s.index]!.x = cand[s.index + 1]!.x = line;
          if (!nudgeIsValid(out[r]!, cand, prepared, opts.ignoreObstacleIds?.[r] ?? [], minEnd)) continue;
          const after = laneDeficit(index, laneSegments(cand, r), r, opts.gap, skip, half, reach);
          const gain = before - after;
          if (gain > 1e-6 && (!best || gain > best.gain + 1e-9)) best = { route: r, pts: cand, gain };
        }
      }
    }
    if (!best) break;
    index.remove(all[best.route]!);
    out[best.route] = best.pts;
    all[best.route] = laneSegments(best.pts, best.route);
    index.add(all[best.route]!);
    changed = true;
  }
  return changed ? out.map((r, i) => (r.length < 3 || r === routes[i] ? r : cleanOrthogonal(r))) : routes;
}
