/**
 * Free-spot search for auto-placed shapes (new attributes). Besides every other node, the CONNECTORS of the scene are
 * obstacles: an ellipse painted over a participation line reads as connected to that relationship (and exports that way).
 */
import { placeNear } from '@/layout';
import type { Point, Rect } from '@/scene/base';
import type { Scene } from '@/scene/types';
import type { Id } from '@/model/types';

const SAMPLE_STEP = 10;
const SAMPLE_SIZE = 8;
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Small squares sampled along the connectors that are NOT attached to `nodeId` (a node's own links are meant to touch it). */
export function edgeObstacles(scene: Scene, nodeId: Id): Rect[] {
  const out: Rect[] = [];
  const half = SAMPLE_SIZE / 2;
  for (const id of scene.edgeOrder) {
    const e = scene.edges[id];
    if (!e || e.sourceNodeId === nodeId || e.targetNodeId === nodeId) continue;
    for (const path of e.paths) {
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(len / SAMPLE_STEP));
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const y = a.y + ((b.y - a.y) * k) / n;
          out.push({ x: x - half, y: y - half, w: SAMPLE_SIZE, h: SAMPLE_SIZE });
        }
      }
    }
    for (const l of e.labels) {
      const w = l.label.width;
      out.push({ x: l.label.anchor === 'middle' ? l.label.x - w / 2 : l.label.anchor === 'end' ? l.label.x - w : l.label.x, y: l.label.y - 8, w, h: 16 });
    }
  }
  return out;
}

/**
 * Top-left of the free spot nearest to `want` (centre) for a shape of `size` that keeps clear of every other node and of the
 * connectors not attached to `nodeId`. `snap` is applied when the snapped spot is still clear.
 */
export function freeSpotFor(scene: Scene, nodeId: Id, size: { w: number; h: number }, want: Point, opts: { preferAngle?: number; snap?: (v: number) => number } = {}): Point {
  const nodes = scene.nodeOrder.filter((id) => id !== nodeId).map((id) => scene.nodes[id]!.paintBounds);
  const edges = edgeObstacles(scene, nodeId);
  const search = [...nodes.map((r) => inflate(r, 14)), ...edges];
  const free = placeNear(size, want, search, { gap: 14, preferAngle: opts.preferAngle });
  const snap = opts.snap;
  if (!snap) return free;
  const guard = [...nodes.map((r) => inflate(r, 8)), ...edges];
  const clear = (p: Point): boolean => !guard.some((o) => overlaps({ x: p.x, y: p.y, w: size.w, h: size.h }, o));
  const snapped = { x: snap(free.x), y: snap(free.y) };
  return clear(snapped) ? snapped : free;
}
