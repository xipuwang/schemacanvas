/**
 * Orthogonal routing API — FROZEN. Shared by the horizontal-schema worker (FK connectors), the Chen worker
 * (`routing: 'orthogonal'`) and later Crow's Foot. The implementation in ./index.ts is a simple stub until the
 * horizontal worker replaces it with an obstacle-avoiding router; the SIGNATURE and the contract below must not change.
 */
import type { Id } from '@/model/types';
import type { Point, Rect, Side } from '../base';

export interface RouteEnd {
  /** Exact attachment point on the node/cell border. */
  point: Point;
  /** Outward side of the border at `point`; the route leaves/arrives PERPENDICULAR to it. */
  side: Side;
}

export interface RouteRequest {
  /** Caller-chosen key (e.g. DiagramEdge id or `edgeId:branchIndex`); results are keyed by it. */
  key: string;
  source: RouteEnd;
  target: RouteEnd;
  /**
   * Manual route: corners the path passes through EXACTLY, in source→target order. Between consecutive points at
   * most one elbow is inserted, continuing the previous segment's axis. Obstacles are IGNORED for manual routes.
   */
  waypoints?: Point[];
  /** Obstacles this request may cross (typically its own source/target node ids). */
  ignoreObstacleIds?: Id[];
  /**
   * ADDITIVE. Half the width of the lane BUNDLE this route is the centreline of (a composite FK draws parallel lanes beside
   * it). The nudge pass keeps `ctx.laneGap` clear between the OUTER lanes of neighbouring routes.
   */
  halfWidth?: number;
}

export interface RouteContext {
  /** Padded node rects to avoid (auto routes). */
  obstacles: Array<{ id: Id; rect: Rect }>;
  /** Minimum gap between a route and an obstacle. */
  clearance: number;
  /** Length of the straight perpendicular stub at each end. */
  stub: number;
  /**
   * ADDITIVE. Minimum distance between parallel overlapping runs of different routes. When given, runs closer than this are
   * spread apart by the nudge pass (default: only runs that coincide, 1 px, are spread, by the legacy 6 px gap).
   */
  laneGap?: number;
}

/**
 * Batch routing so parallel segments can be nudged apart. Contract for every returned polyline:
 *  - first point === `source.point` and last point === `target.point` EXACTLY;
 *  - axis-aligned segments only; no zero-length or collinear-redundant points;
 *  - first segment leaves perpendicular to `source.side`, last segment arrives perpendicular to `target.side`;
 *  - auto routes avoid `ctx.obstacles` (minus ignored ids) with minimal bends when a free path exists.
 */
export type RouteOrthogonal = (requests: RouteRequest[], ctx: RouteContext) => Record<string, Point[]>;
