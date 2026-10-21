/**
 * Keyboard editing of one selected connector: which handles can take focus (and in which order), and the geometry of a
 * nudge. Pure. Edits are still ONLY route patches (waypoints / anchors / label offsets), exactly like the pointer handles.
 */
import type { Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import type { Handle } from '../tools/handles';

export type EdgeFocus =
  | { id: string; kind: 'end'; handle: Extract<Handle, { kind: 'end' }> }
  | { id: string; kind: 'bend'; handle: Extract<Handle, { kind: 'bend' }> }
  | { id: string; kind: 'mid'; handle: Extract<Handle, { kind: 'mid' }> }
  | { id: string; kind: 'label'; labelId: 'main' | 'role' | 'cardinality' };

/**
 * The focus ring of a connector, in the order `]` walks it: source end(s), bends, segments, target end(s), labels.
 * (Composite foreign keys have one source / target end per branch; they keep the geometry's branch order.)
 */
export function edgeFocusTargets(handles: readonly Handle[], labelIds: ReadonlyArray<'main' | 'role' | 'cardinality'>): EdgeFocus[] {
  const ends = handles.filter((h): h is Extract<Handle, { kind: 'end' }> => h.kind === 'end');
  const bends = handles.filter((h): h is Extract<Handle, { kind: 'bend' }> => h.kind === 'bend').sort((a, b) => a.index - b.index);
  const mids = handles.filter((h): h is Extract<Handle, { kind: 'mid' }> => h.kind === 'mid').sort((a, b) => a.segment - b.segment);
  const out: EdgeFocus[] = [];
  for (const h of ends.filter((e) => e.end === 'source')) out.push({ id: h.id, kind: 'end', handle: h });
  for (const h of bends) out.push({ id: h.id, kind: 'bend', handle: h });
  for (const h of mids) out.push({ id: h.id, kind: 'mid', handle: h });
  for (const h of ends.filter((e) => e.end === 'target')) out.push({ id: h.id, kind: 'end', handle: h });
  for (const l of labelIds) out.push({ id: `label:${l}`, kind: 'label', labelId: l });
  return out;
}

/** The next / previous focus target (wrapping). With nothing focused `+1` starts at the first and `-1` at the last. */
export function cycleFocus(targets: readonly EdgeFocus[], currentId: string | null, dir: 1 | -1): EdgeFocus | undefined {
  if (targets.length === 0) return undefined;
  const i = currentId ? targets.findIndex((t) => t.id === currentId) : -1;
  if (i < 0) return dir === 1 ? targets[0] : targets[targets.length - 1];
  return targets[(i + dir + targets.length) % targets.length];
}

/** Arrow key -> world delta: one grid step (Shift: ten), `grid <= 0` falls back to 10. Undefined for other keys. */
export function nudgeDelta(key: string, shift: boolean, grid: number): Point | undefined {
  const step = (grid > 0 ? grid : 10) * (shift ? 10 : 1);
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return undefined;
  }
}

/** Human position of a focus target for the announcement: `{ kind, n, total }` (n is 1-based within its kind). */
export function describeFocus(targets: readonly EdgeFocus[], focus: EdgeFocus): { kind: EdgeFocus['kind'] | 'source' | 'target'; n: number; total: number; label?: string } {
  if (focus.kind === 'end') return { kind: focus.handle.end, n: 1, total: 1 };
  const same = targets.filter((t) => t.kind === focus.kind);
  const n = same.findIndex((t) => t.id === focus.id) + 1;
  return { kind: focus.kind, n, total: same.length, ...(focus.kind === 'label' ? { label: focus.labelId } : {}) };
}

/** The segment (index into the main path) a new bend goes on: the focused segment, else the longest one that has a midpoint handle. */
export function segmentForInsert(path: readonly Point[], mids: ReadonlyArray<Extract<Handle, { kind: 'mid' }>>, focus: EdgeFocus | undefined): Extract<Handle, { kind: 'mid' }> | undefined {
  if (focus?.kind === 'mid') return focus.handle;
  let best: { h: Extract<Handle, { kind: 'mid' }>; len: number } | undefined;
  for (const h of mids) {
    const a = path[h.segment];
    const b = path[h.segment + 1];
    if (!a || !b) continue;
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || len > best.len) best = { h, len };
  }
  return best?.h;
}

export const rectCentre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * The node nearest to `from` in direction `key` (arrow key): candidates must lie in that half-plane; the score is the distance
 * along the axis plus twice the cross-axis offset, so a node straight ahead beats a nearer one far to the side.
 */
export function nearestInDirection(rects: ReadonlyArray<{ id: Id; rect: Rect }>, fromId: Id, key: string): Id | undefined {
  const from = rects.find((r) => r.id === fromId);
  if (!from) return undefined;
  const c = rectCentre(from.rect);
  let best: { id: Id; score: number } | undefined;
  for (const r of rects) {
    if (r.id === fromId) continue;
    const p = rectCentre(r.rect);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const [along, cross] = key === 'ArrowRight' ? [dx, dy] : key === 'ArrowLeft' ? [-dx, dy] : key === 'ArrowDown' ? [dy, dx] : key === 'ArrowUp' ? [-dy, dx] : [-1, 0];
    if (along <= 0) continue;
    const score = along + 2 * Math.abs(cross);
    if (!best || score < best.score) best = { id: r.id, score };
  }
  return best?.id;
}

/** A free spot for a new element of `size` near `around`: the point itself, else a spiral of grid-sized steps; never inside `taken`. */
export function findFreeSpot(taken: readonly Rect[], size: { w: number; h: number }, around: Point, step = 40): Point {
  const fits = (p: Point): boolean =>
    !taken.some((r) => p.x - size.w / 2 - 8 < r.x + r.w && p.x + size.w / 2 + 8 > r.x && p.y - size.h / 2 - 8 < r.y + r.h && p.y + size.h / 2 + 8 > r.y);
  if (fits(around)) return around;
  for (let ring = 1; ring <= 40; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [x, y] of [[i, -ring], [i, ring], [-ring, i], [ring, i]] as const) {
        const p = { x: around.x + x * step, y: around.y + y * step };
        if (fits(p)) return p;
      }
    }
  }
  return around;
}
