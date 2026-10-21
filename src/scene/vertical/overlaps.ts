/**
 * Overlap resolution for ANY scene (not only the vertical family): given the node bounds of a built scene, the minimal
 * displacements that separate every pair of overlapping nodes (`nudgeOutOfOverlap`, symmetric pushes, then a free-spot
 * search for what is left). Typical use: after an option changed the table sizes (crow's foot vertical -> horizontal)
 * while the node positions stayed. Pure: the scene is not modified.
 *
 * Callers apply a result by adding `dx/dy` (or `x/y - bounds.x/y`) to `DiagramNode.x/y` — by the node invariant
 * `geom.bounds.x === node.x`, so `resolveOverlapPositions` values ARE the new `node.x/y`.
 */
import { nudgeOutOfOverlap } from '@/layout/align';
import type { LayoutRect, Positions } from '@/layout/types';
import type { Id } from '@/model/types';
import type { Scene } from '../types';

export interface ResolveOverlapOptions {
  /** Minimum clearance kept between node bounds (default 24: room for connector stubs). */
  gap?: number;
  /** Nodes that must not move. */
  fixedIds?: ReadonlySet<Id>;
  /** Only these nodes may move / be considered (default: every node of the scene). */
  nodeIds?: readonly Id[];
}

const DEFAULT_GAP = 24;
const EPS = 1e-6;

/** New top-left (= new `node.x/y`) of every node that must move; nodes that do not move are absent. */
export function resolveOverlapPositions(scene: Pick<Scene, 'nodes'>, opts: ResolveOverlapOptions = {}): Positions {
  const only = opts.nodeIds ? new Set(opts.nodeIds) : undefined;
  const rects: LayoutRect[] = [];
  for (const [id, g] of Object.entries(scene.nodes)) {
    if (only && !only.has(id)) continue;
    const b = g?.bounds;
    if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) continue;
    rects.push({ id, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  if (rects.length < 2) return {};
  const placed = nudgeOutOfOverlap(rects, { gap: opts.gap ?? DEFAULT_GAP, fixedIds: opts.fixedIds });
  const out: Positions = {};
  for (const r of rects) {
    const p = placed[r.id];
    if (p && (Math.abs(p.x - r.x) > EPS || Math.abs(p.y - r.y) > EPS)) out[r.id] = { x: p.x, y: p.y };
  }
  return out;
}

/** The same result as `{ dx, dy }` per node (what must be ADDED to `node.x/y`). */
export function resolveOverlapDisplacements(scene: Pick<Scene, 'nodes'>, opts: ResolveOverlapOptions = {}): Record<Id, { dx: number; dy: number }> {
  const pos = resolveOverlapPositions(scene, opts);
  const out: Record<Id, { dx: number; dy: number }> = {};
  for (const [id, p] of Object.entries(pos)) {
    const b = scene.nodes[id]!.bounds;
    out[id] = { dx: p.x - b.x, dy: p.y - b.y };
  }
  return out;
}
