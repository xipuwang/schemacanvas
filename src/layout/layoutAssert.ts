/** Test helpers: apply layout results to a scene's rectangles and assert geometric properties. */
import type { Id } from '@/model/types';
import type { Rect } from '@/scene/base';
import { inflateRect, rectCenter } from '@/scene/geometry';
import type { Scene } from '@/scene/types';
import { anyOverlap, segmentHitsRect } from './rects';
import type { LayoutRect, Positions } from './types';

export function rectsAfter(scene: Scene, pos: Positions): LayoutRect[] {
  return Object.keys(scene.nodes)
    .sort()
    .map((id) => {
      const b = scene.nodes[id]!.bounds;
      const p = pos[id] ?? { x: b.x, y: b.y };
      return { id, x: p.x, y: p.y, w: b.w, h: b.h };
    });
}

export const overlaps = (scene: Scene, pos: Positions, gap = 0): Array<[string, string]> => anyOverlap(rectsAfter(scene, pos), gap);

export const allFinite = (pos: Positions): boolean => Object.values(pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

const rectOf = (r: LayoutRect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** Chen: attribute rects crossed by a line that does not end at them, and lines passing through foreign nodes. */
export function lineViolations(scene: Scene, pos: Positions): string[] {
  const rects = new Map(rectsAfter(scene, pos).map((r) => [r.id, r]));
  const out: string[] = [];
  for (const e of Object.values(scene.edges)) {
    const a = rects.get(e.sourceNodeId)!;
    const b = rects.get(e.targetNodeId)!;
    const ca = rectCenter(rectOf(a));
    const cb = rectCenter(rectOf(b));
    for (const [id, r] of rects) {
      if (id === a.id || id === b.id) continue;
      const isAttr = scene.nodes[id]!.kind === 'chen-attribute';
      // attribute links must stay clear of everything; participation lines must at least never cross an attribute
      const involvesAttrLink = e.ref.kind === 'attribute';
      if ((isAttr || involvesAttrLink) && segmentHitsRect(ca, cb, inflateRect(rectOf(r), -2))) out.push(`${e.edgeId} crosses ${id}`);
    }
  }
  return out;
}

export function attributeDistances(scene: Scene, pos: Positions): Array<{ attr: Id; owner: Id; dist: number }> {
  const rects = new Map(rectsAfter(scene, pos).map((r) => [r.id, r]));
  const res: Array<{ attr: Id; owner: Id; dist: number }> = [];
  for (const e of Object.values(scene.edges)) {
    if (e.ref.kind !== 'attribute') continue;
    // fixtures draw owner -> attribute
    const attr = e.targetNodeId;
    const owner = e.sourceNodeId;
    const ca = rectCenter(rectOf(rects.get(attr)!));
    const co = rectCenter(rectOf(rects.get(owner)!));
    res.push({ attr, owner, dist: Math.hypot(ca.x - co.x, ca.y - co.y) });
  }
  return res;
}
