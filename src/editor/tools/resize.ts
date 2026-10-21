/**
 * Resize maths (pure, tested). A resize works on the OUTER outline (`geom.bounds`) of a Chen node; the model stores
 * `DiagramNode.width/height` (clamped by the scene to the text-fit minimum) and `x/y` = bounds top-left, so a drag from a
 * left / top handle moves the origin so the opposite edge stays where it is.
 */
import { produce } from 'immer';
import type { DiagramNode, Id, Point, Project } from '@/model/types';
import type { Rect } from '@/scene/base';
import { buildScene } from '@/scene/registry';
import { clamp, snapTo } from './geom';
import type { HandleDir } from './handles';

export interface ResizeOptions {
  /** Keep the aspect ratio (Shift; corner handles only). */
  keepAspect?: boolean;
  /** Snap the MOVING edges to this grid (0 / undefined = off). */
  grid?: number;
}

export const affectsX = (dir: HandleDir): boolean => dir.includes('e') || dir.includes('w');
export const affectsY = (dir: HandleDir): boolean => dir.includes('n') || dir.includes('s');

/**
 * New outline for dragging handle `dir` by `delta` (world). `min` is the text-fit minimum: the result is clamped to it
 * ("shown by clamping": the opposite edge never moves). Pure and idempotent: always computed from the START rect.
 */
export function resizeRect(start: Rect, dir: HandleDir, delta: Point, min: { w: number; h: number }, opts: ResizeOptions = {}): Rect {
  const grid = opts.grid ?? 0;
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (dir.includes('e')) right = snapTo(right + delta.x, grid);
  if (dir.includes('w')) left = snapTo(left + delta.x, grid);
  if (dir.includes('s')) bottom = snapTo(bottom + delta.y, grid);
  if (dir.includes('n')) top = snapTo(top + delta.y, grid);
  let w = Math.max(min.w, right - left);
  let h = Math.max(min.h, bottom - top);
  if (opts.keepAspect && dir.length === 2 && start.w > 0 && start.h > 0) {
    const s = Math.max(w / start.w, h / start.h, min.w / start.w, min.h / start.h);
    w = start.w * s;
    h = start.h * s;
  }
  const x = dir.includes('w') ? start.x + start.w - w : start.x;
  const y = dir.includes('n') ? start.y + start.h - h : start.y;
  return { x, y, w, h };
}

/** Width of a column after dragging its right border (`side: 'right'`) or left border by `dx`, clamped at `min`. */
export function resizeColumn(startWidth: number, side: 'left' | 'right', dx: number, min: number, grid = 0): number {
  const raw = side === 'right' ? startWidth + dx : startWidth - dx;
  return Math.max(min, grid > 0 ? snapTo(raw, grid) : raw);
}

export const clampRowHeight = (raw: number, min: number, grid = 0): number => Math.max(min, grid > 0 ? snapTo(raw, grid) : raw);

// ---- minimum sizes, measured on the real scene --------------------------------------------------------------------

/** Build the scene of `project` after applying `tweak` to one node (the minimum-size probe). */
function probe(project: Project, diagramId: Id, nodeId: Id, tweak: (n: DiagramNode) => void) {
  const next = produce(project, (d) => {
    const n = d.diagrams[diagramId]?.nodes[nodeId];
    if (n) tweak(n as DiagramNode);
  });
  return buildScene(next, diagramId);
}

/** Text-fit outline size of a Chen node (its width / height forced to 1, the scene clamps to the minimum). */
export function minNodeSize(project: Project, diagramId: Id, nodeId: Id): { w: number; h: number } | undefined {
  const g = probe(project, diagramId, nodeId, (n) => {
    n.width = 1;
    n.height = 1;
  }).nodes[nodeId];
  return g ? { w: g.bounds.w, h: g.bounds.h } : undefined;
}

/** Text-fit width of one column cell (no override, no minimum row width). */
export function minColumnWidth(project: Project, diagramId: Id, nodeId: Id, columnId: Id): number | undefined {
  const g = probe(project, diagramId, nodeId, (n) => {
    delete n.width;
    if (n.columnWidths) delete n.columnWidths[columnId];
  }).nodes[nodeId];
  if (g?.kind === 'h-table') return g.cells.find((c) => c.columnId === columnId)?.rect.w;
  if (g?.kind === 'v-table') return g.rows.find((r) => r.columnId === columnId)?.rect.w;
  return undefined;
}

/** Text-fit row height of a horizontal table. */
export function minRowHeight(project: Project, diagramId: Id, nodeId: Id): number | undefined {
  const g = probe(project, diagramId, nodeId, (n) => {
    n.height = 1;
  }).nodes[nodeId];
  if (g?.kind === 'h-table') return g.row.h;
  if (g?.kind === 'v-table') return g.body.h;
  return undefined;
}

/** Text-fit width of a vertical table (its `width` is a minimum, so 1 yields the natural width). */
export function minTableWidth(project: Project, diagramId: Id, nodeId: Id): number | undefined {
  const g = probe(project, diagramId, nodeId, (n) => {
    n.width = 1;
  }).nodes[nodeId];
  return g ? g.bounds.w : undefined;
}
