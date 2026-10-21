/**
 * Keeps a sheet legible after a diagram-wide option change (font size, row height, data types, orientation ...) grew the
 * nodes in place: when the change made nodes overlap that did not overlap before, they are pushed apart with the layout
 * library's `nudgeOutOfOverlap`. Pure over scenes; the caller applies the result through ONE `ops.setNodePositions`.
 */
import { nudgeOutOfOverlap, type LayoutRect } from '@/layout';
import type { Id } from '@/model/types';
import type { Rect, Scene } from '@/scene/types';

/** Clearance (world px) left between nodes that had to be separated. */
export const SPACING_GAP = 24;

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function rectsOf(scene: Scene): LayoutRect[] {
  return scene.nodeOrder.map((id) => {
    const b = scene.nodes[id]!.paintBounds;
    return { id, x: b.x, y: b.y, w: b.w, h: b.h };
  });
}

/** `a|b` keys (sorted ids) of every overlapping node pair of the scene. */
export function overlappingPairs(scene: Scene): Set<string> {
  const rects = rectsOf(scene);
  const out = new Set<string>();
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i]!, rects[j]!)) out.add([rects[i]!.id, rects[j]!.id].sort().join('|'));
  return out;
}

/**
 * Translation (dx, dy) per node that must move so the nodes the change made overlap are apart. Empty when the change
 * created no new overlap (pre-existing overlaps the user left alone are never touched on their own).
 */
export function resolveOverlapPositions(before: Scene, after: Scene, opts: { lockedIds?: ReadonlySet<Id>; gap?: number } = {}): Record<Id, { dx: number; dy: number }> {
  const had = overlappingPairs(before);
  const now = overlappingPairs(after);
  let created = false;
  for (const k of now)
    if (!had.has(k)) {
      created = true;
      break;
    }
  if (!created) return {};
  const rects = rectsOf(after);
  const moved = nudgeOutOfOverlap(rects, { gap: opts.gap ?? SPACING_GAP, fixedIds: opts.lockedIds ?? new Set() });
  const out: Record<Id, { dx: number; dy: number }> = {};
  for (const r of rects) {
    const p = moved[r.id];
    if (!p) continue;
    const dx = p.x - r.x;
    const dy = p.y - r.y;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) out[r.id] = { dx, dy };
  }
  return out;
}
