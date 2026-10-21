/**
 * Handle geometry for the selected node / edge (pure, tested). Handles are computed from the derived `Scene`, in WORLD
 * coordinates, and hit-tested with a screen-pixel radius so every handle is at least `HIT_PX * 2` px wide at any zoom.
 */
import type { DiagramEdge, Id, Point } from '@/model/types';
import type { Rect, Side } from '@/scene/base';
import type { EdgeGeom, FkEdgeGeom, Scene } from '@/scene/types';
import { HIT_PX, contains, dist, inflate } from './geom';

export type HandleDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type Handle =
  | { id: string; kind: 'resize'; nodeId: Id; dir: HandleDir; at: Point }
  | { id: string; kind: 'col-border'; nodeId: Id; columnId: Id; side: 'left' | 'right'; at: Point; rect: Rect }
  | { id: string; kind: 'row-height'; nodeId: Id; at: Point; rect: Rect }
  | { id: string; kind: 'table-width'; nodeId: Id; at: Point }
  | { id: string; kind: 'bend'; edgeId: Id; index: number; at: Point }
  | { id: string; kind: 'mid'; edgeId: Id; segment: number; at: Point }
  | { id: string; kind: 'end'; edgeId: Id; end: 'source' | 'target'; branchSourceColumnId?: Id; at: Point; anchorRect: Rect; nodeId: Id; columnId?: Id; side: Side };

export const CURSOR_OF_DIR: Record<HandleDir, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

export function handleCursor(h: Handle): string {
  switch (h.kind) {
    case 'resize':
      return CURSOR_OF_DIR[h.dir];
    case 'col-border':
    case 'table-width':
      return 'ew-resize';
    case 'row-height':
      return 'ns-resize';
    case 'bend':
      return 'move';
    case 'mid':
      return 'copy';
    case 'end':
      return 'grab';
  }
}

const DIRS: Array<[HandleDir, number, number]> = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
];

/** On-screen size below which the edge-midpoint resize handles are dropped (corners stay) so handles never crowd each other. */
const MIN_SPAN_PX = 22;

/** Handles of the selected node. */
export function nodeHandles(scene: Scene, nodeId: Id, zoom: number): Handle[] {
  const g = scene.nodes[nodeId];
  if (!g) return [];
  switch (g.kind) {
    case 'chen-entity':
    case 'chen-attribute':
    case 'chen-relationship': {
      const b = g.bounds;
      const small = b.w * zoom < MIN_SPAN_PX || b.h * zoom < MIN_SPAN_PX;
      return DIRS.filter(([dir]) => !small || dir.length === 2).map(([dir, fx, fy]) => ({ id: `resize:${nodeId}:${dir}`, kind: 'resize' as const, nodeId, dir, at: { x: b.x + b.w * fx, y: b.y + b.h * fy } }));
    }
    case 'h-table':
      return rowTableHandles(nodeId, g.row, g.cells.map((c) => ({ columnId: c.columnId, rect: c.rect })), zoom);
    case 'v-table': {
      if (g.orientation === 'horizontal') return rowTableHandles(nodeId, g.body, g.rows.map((r) => ({ columnId: r.columnId, rect: r.rect })), zoom);
      return [{ id: `table-width:${nodeId}`, kind: 'table-width', nodeId, at: { x: g.bounds.x + g.bounds.w, y: g.bounds.y + g.bounds.h / 2 } }];
    }
  }
}

function rowTableHandles(nodeId: Id, row: Rect, cells: Array<{ columnId: Id; rect: Rect }>, zoom: number): Handle[] {
  const out: Handle[] = [];
  const pad = HIT_PX / zoom;
  cells.forEach((c, i) => {
    out.push({
      id: `col-border:${nodeId}:${c.columnId}:right`,
      kind: 'col-border',
      nodeId,
      columnId: c.columnId,
      side: 'right',
      at: { x: c.rect.x + c.rect.w, y: c.rect.y + c.rect.h / 2 },
      rect: { x: c.rect.x + c.rect.w - pad, y: c.rect.y, w: 2 * pad, h: c.rect.h },
    });
    if (i === 0) {
      out.push({
        id: `col-border:${nodeId}:${c.columnId}:left`,
        kind: 'col-border',
        nodeId,
        columnId: c.columnId,
        side: 'left',
        at: { x: c.rect.x, y: c.rect.y + c.rect.h / 2 },
        rect: { x: c.rect.x - pad, y: c.rect.y, w: 2 * pad, h: c.rect.h },
      });
    }
  });
  if (cells.length > 0) {
    const half = (HIT_PX * 0.55) / zoom;
    out.push({ id: `row-height:${nodeId}`, kind: 'row-height', nodeId, at: { x: row.x + row.w / 2, y: row.y + row.h }, rect: { x: row.x + pad, y: row.y + row.h - half, w: Math.max(0, row.w - 2 * pad), h: 2 * half } });
  }
  return out;
}

// ---- edges -------------------------------------------------------------------------------------------------------

/**
 * Main polyline of an edge: what bend / midpoint handles are laid along. A horizontal-schema FK reports the polyline its
 * stored waypoints are corners of (`centreline`: the lane centre of a composite bundle); other edges use their first path.
 */
export function mainPath(g: EdgeGeom): Point[] {
  const centre = (g as { centreline?: Point[] }).centreline;
  return centre && centre.length >= 2 ? centre : (g.paths[0] ?? []);
}

/** True when `mainPath` is a polyline the editor edits corner-exactly (see routeEdit `insertBendPolyline`). */
export const hasCentreline = (g: EdgeGeom): boolean => ((g as { centreline?: Point[] }).centreline?.length ?? 0) >= 2;

const segmentLength = (a: Point, b: Point): number => dist(a, b);

/** Handles of the selected edge. `edge` supplies the stored route (bend handles come from the scene: stored waypoints). */
export function edgeHandles(scene: Scene, edgeId: Id, edge: DiagramEdge | undefined, zoom: number): Handle[] {
  const g = scene.edges[edgeId];
  if (!g) return [];
  const out: Handle[] = [];
  const path = mainPath(g);
  const manual = edge?.route.mode === 'manual';
  if (manual) for (const b of g.bendHandles) out.push({ id: `bend:${edgeId}:${b.index}`, kind: 'bend', edgeId, index: b.index, at: b.at });
  // midpoint of every segment long enough to grab (on screen)
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (segmentLength(a, b) * zoom < 28) continue;
    out.push({ id: `mid:${edgeId}:${i}`, kind: 'mid', edgeId, segment: i, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  }
  const branched = g.kind === 'fk' && (g as FkEdgeGeom).style === 'branches' && (g as FkEdgeGeom).branches.length > 1;
  if (branched) {
    for (const br of (g as FkEdgeGeom).branches) {
      br.ends.forEach((e, k) => out.push(endHandle(edgeId, k === 0 ? 'source' : 'target', e, br.sourceColumnId)));
    }
  } else {
    g.ends.forEach((e, k) => out.push(endHandle(edgeId, k === 0 ? 'source' : 'target', e)));
  }
  return out;
}

function endHandle(edgeId: Id, end: 'source' | 'target', e: EdgeGeom['ends'][number], branchSourceColumnId?: Id): Handle {
  return {
    id: `end:${edgeId}:${end}${branchSourceColumnId ? `:${branchSourceColumnId}` : ''}`,
    kind: 'end',
    edgeId,
    end,
    ...(branchSourceColumnId ? { branchSourceColumnId } : {}),
    at: e.at,
    anchorRect: e.anchorRect,
    nodeId: e.nodeId,
    ...(e.columnId ? { columnId: e.columnId } : {}),
    side: e.side,
  };
}

/**
 * The handle under `world`, if any. Point handles use a `HIT_PX` screen-pixel radius (nearest wins; end handles beat bends
 * beat midpoints on ties), strip handles use their (already screen-sized) rect; column borders beat the row-height strip.
 */
export function hitHandle(handles: readonly Handle[], world: Point, zoom: number): Handle | undefined {
  const r = HIT_PX / zoom;
  const rank: Record<Handle['kind'], number> = { end: 0, bend: 1, resize: 2, 'table-width': 2, mid: 3, 'col-border': 4, 'row-height': 5 };
  let best: { h: Handle; d: number } | undefined;
  for (const h of handles) {
    if (h.kind === 'col-border' || h.kind === 'row-height') continue;
    const d = dist(h.at, world);
    if (d > r) continue;
    if (!best || d < best.d - 0.5 / zoom || (Math.abs(d - best.d) <= 0.5 / zoom && rank[h.kind] < rank[best.h.kind])) best = { h, d };
  }
  if (best) return best.h;
  for (const kind of ['col-border', 'row-height'] as const) {
    for (const h of handles) if (h.kind === kind && contains(inflate(h.rect, 0), world)) return h;
  }
  return undefined;
}

