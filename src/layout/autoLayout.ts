/**
 * Scene -> layout glue. Reads node sizes from `scene.nodes[id].bounds` and semantic edges from `scene.edges`
 * (`sourceNodeId`/`targetNodeId`); the returned TOP-LEFT positions can be written straight into `node.x/y`
 * (ARCHITECTURE rule 11) via `ops.setNodePositions`.
 *
 * Result contents: full layout -> every node id; `onlyNodeIds` -> ONLY those ids (all others are untouched, so they
 * are simply absent from the result and keep their exact stored position).
 */
import type { DiagramType, Id, Point, Project } from '@/model/types';
import type { Rect } from '@/scene/base';
import type { Scene } from '@/scene/types';
import { placeNear, stackBelow } from './align';
import { layoutChen, type ChenKind, type ChenLayoutInput } from './chenLayout';
import { trackLayoutBusy } from './layoutBusy';
import { layoutGraph, type LayoutAlgorithm, type LayoutDirection } from './elkGraph';
import { inflateRect } from '@/scene/geometry';
import { boundsOf, segmentHitsRect } from './rects';
import type { Positions, Size } from './types';

export interface AutoLayoutOptions {
  /** Override the strategy default (relational: layered; chen skeleton: stress, or layered when `direction` is given). */
  algorithm?: LayoutAlgorithm;
  /** Flow direction for layered layouts. Relational default DOWN (cells attach on the top/bottom edges). */
  direction?: LayoutDirection;
  /** Relational: clearance between rows/columns (default 80, never below 60). Chen: clearance between skeleton envelopes (default 40). */
  spacing?: number;
  seed?: number;
  /** Place ONLY these nodes into free space near their neighbours; everything else keeps its exact position. */
  onlyNodeIds?: ReadonlyArray<Id>;
  /**
   * Full layout: these nodes keep their current position and the rest is arranged around them. Nodes whose
   * `DiagramNode.locked` is true are ALWAYS kept fixed (full layout) / never moved (incremental), whether listed or not.
   */
  keepFixed?: ReadonlyArray<Id>;
  /** Grid size applied last to every MOVED node (skipped for a node when snapping would make it overlap another). */
  snapToGrid?: number;
  /** Top-left of the laid-out content (full layout without fixed nodes). Default: current top-left of the content. */
  origin?: Point;
  /** Abort a stale request: the promise rejects with an `AbortError`; the ELK worker is stopped when nothing else waits. */
  signal?: AbortSignal;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byStr = cmp;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Stable semantic ordering key per scene node (kind, name, owner path, sibling order), so every ordering decision of
 * the layout is independent of the opaque ids (ARCHITECTURE rule 15). Ids stay the final tie-break.
 */
function orderKeys(scene: Scene, project: Project, diagramId: Id): Record<Id, string> {
  const d = project.diagrams[diagramId];
  const m = d ? (project.models?.[d.modelId] as unknown as Record<string, Record<Id, { name?: string; owner?: { kind: string; id: Id }; order?: number }> | undefined>) : undefined;
  const entities = m?.entities;
  const relationships = m?.relationships;
  const attributes = m?.attributes;
  const relations = m?.relations;
  const attrKey = (id: Id, depth = 0): string => {
    const a = attributes?.[id];
    if (!a || depth > 20) return `3:${id}`;
    const o = a.owner;
    const ok = !o ? '' : o.kind === 'attribute' ? attrKey(o.id, depth + 1) : o.kind === 'entity' ? `1:${entities?.[o.id]?.name ?? ''}` : `2:${relationships?.[o.id]?.name ?? ''}`;
    return `${ok}/3:${String(a.order ?? 0).padStart(6, '0')}:${a.name ?? ''}`;
  };
  // No model (scene-only callers): the drawn label is the next best stable name; attributes are qualified by their
  // owner, found through the scene's attribute edges.
  const labelOf = (id: Id): string => {
    const geom = scene.nodes[id] as unknown as { label?: { text?: string }; nameLabel?: { text?: string } };
    return (geom.label ?? geom.nameLabel)?.text ?? '';
  };
  const attrOwner = new Map<Id, Id>();
  for (const e of Object.values(scene.edges)) {
    if (e.ref.kind !== 'attribute') continue;
    const sAttr = scene.nodes[e.sourceNodeId]?.kind === 'chen-attribute';
    const tAttr = scene.nodes[e.targetNodeId]?.kind === 'chen-attribute';
    if (tAttr && !sAttr) attrOwner.set(e.targetNodeId, e.sourceNodeId);
    else if (sAttr && !tAttr) attrOwner.set(e.sourceNodeId, e.targetNodeId);
    else if (sAttr && tAttr && !attrOwner.has(e.targetNodeId)) attrOwner.set(e.targetNodeId, e.sourceNodeId);
  }
  const shownKey = (id: Id, depth = 0): string => {
    const o = attrOwner.get(id);
    const own = `9:${scene.nodes[id]!.kind}:${labelOf(id)}`;
    return o && depth < 20 && o !== id ? `${shownKey(o, depth + 1)}/${own}` : own;
  };
  const out: Record<Id, string> = {};
  for (const id of Object.keys(scene.nodes)) {
    const ref = d?.nodes?.[id]?.ref;
    let key: string;
    if (ref?.kind === 'entity' && entities?.[ref.id]) key = `1:${entities[ref.id]!.name}`;
    else if (ref?.kind === 'relationship' && relationships?.[ref.id]) key = `2:${relationships[ref.id]!.name}`;
    else if (ref?.kind === 'attribute' && attributes?.[ref.id]) key = attrKey(ref.id);
    else if (ref?.kind === 'relation' && relations?.[ref.id]) key = `1:${relations[ref.id]!.name}`;
    else key = shownKey(id);
    out[id] = key;
  }
  return out;
}

function diagramTypeOf(scene: Scene, project: Project, diagramId: Id): DiagramType {
  const d = project.diagrams[diagramId];
  if (d) return d.type;
  const first = Object.values(scene.nodes)[0];
  return first && first.kind.startsWith('chen-') ? 'chen' : 'relational-schema';
}

export function autoLayout(scene: Scene, project: Project, diagramId: Id, opts: AutoLayoutOptions = {}): Promise<Positions> {
  return trackLayoutBusy(() => autoLayoutImpl(scene, project, diagramId, opts));
}

async function autoLayoutImpl(scene: Scene, project: Project, diagramId: Id, opts: AutoLayoutOptions): Promise<Positions> {
  const ids = Object.keys(scene.nodes).sort(byStr);
  if (ids.length === 0) return {};
  const only = opts.onlyNodeIds ? new Set(opts.onlyNodeIds.filter((i) => scene.nodes[i])) : undefined;
  const keep = new Set((opts.keepFixed ?? []).filter((i) => scene.nodes[i]));
  // Locked nodes are never moved by (auto-)layout.
  const lockedIds = ids.filter((i) => project.diagrams[diagramId]?.nodes?.[i]?.locked === true);
  for (const i of lockedIds) keep.add(i);
  if (only) for (const i of lockedIds) only.delete(i);
  const order = orderKeys(scene, project, diagramId);
  const type = diagramTypeOf(scene, project, diagramId);
  const sizes: Record<Id, Size> = {};
  const current: Record<Id, Point> = {};
  for (const id of ids) {
    const b = scene.nodes[id]!.bounds;
    sizes[id] = { w: b.w, h: b.h };
    current[id] = { x: b.x, y: b.y };
  }

  // Incremental with nothing to anchor on (every node is new) is just a full layout.
  const incremental = only !== undefined && only.size < ids.length;
  const moving = incremental ? only! : new Set(ids.filter((i) => !keep.has(i)));
  const pinned = new Set(ids.filter((i) => !moving.has(i)));

  let result: Positions =
    type === 'chen'
      ? await chenPositions(scene, sizes, current, pinned, incremental, opts, order)
      : await relationalPositions(scene, sizes, current, pinned, incremental, opts, order);

  if (pinned.size === 0) {
    const origin = opts.origin ?? boundsOrZero(ids.map((i) => scene.nodes[i]!.bounds));
    const box = boundsOf(ids.map((i) => ({ x: result[i]!.x, y: result[i]!.y, w: sizes[i]!.w, h: sizes[i]!.h })))!;
    const g = opts.snapToGrid ?? 0;
    const ox = g > 0 ? Math.round(origin.x / g) * g : origin.x;
    const oy = g > 0 ? Math.round(origin.y / g) * g : origin.y;
    for (const i of ids) result[i] = { x: result[i]!.x - box.x + ox, y: result[i]!.y - box.y + oy };
  }

  if (opts.snapToGrid && opts.snapToGrid > 0) {
    const chen = type === 'chen';
    // clearance snapping must keep: Chen attribute gap, relational spacing (>= 60: FK connectors need those lanes)
    const gap = chen ? Math.max(12, Math.round((opts.spacing ?? 40) / 3)) : 60;
    const lines: Array<[Id, Id]> = chen
      ? Object.values(scene.edges).filter((e) => e.sourceNodeId !== e.targetNodeId && sizes[e.sourceNodeId] && sizes[e.targetNodeId]).map((e) => [e.sourceNodeId, e.targetNodeId])
      : [];
    result = snapResult(result, sizes, current, pinned, opts.snapToGrid, gap, lines);
  }

  const out: Positions = {};
  for (const i of ids) {
    if (incremental && !moving.has(i)) continue;
    if (pinned.has(i)) {
      out[i] = { ...current[i]! };
      continue;
    }
    const p = result[i]!;
    out[i] = { x: round2(p.x), y: round2(p.y) };
  }
  return out;
}

function boundsOrZero(rects: Rect[]): Point {
  const b = boundsOf(rects);
  return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chen
// ---------------------------------------------------------------------------------------------------------------------

function chenPositions(
  scene: Scene,
  sizes: Record<Id, Size>,
  current: Record<Id, Point>,
  pinned: ReadonlySet<Id>,
  incremental: boolean,
  opts: AutoLayoutOptions,
  order: Record<Id, string>,
): Promise<Positions> {
  const kinds: Record<Id, ChenKind> = {};
  const priority: Record<Id, number> = {};
  for (const [id, n] of Object.entries(scene.nodes)) {
    if (n.kind === 'chen-entity') kinds[id] = 'entity';
    else if (n.kind === 'chen-relationship') kinds[id] = 'relationship';
    else if (n.kind === 'chen-attribute') {
      kinds[id] = 'attribute';
      // keys first, derived last: a tidy, predictable fan order
      priority[id] = n.label.underline ? -1 : n.derived ? 1 : 0;
    } else kinds[id] = 'entity'; // a non-Chen node in a Chen scene is laid out as a plain skeleton box
  }
  const participantLinks: ChenLayoutInput['participantLinks'][number][] = [];
  const attributeLinks: ChenLayoutInput['attributeLinks'][number][] = [];
  for (const eid of Object.keys(scene.edges).sort(byStr)) {
    const e = scene.edges[eid]!;
    if (!kinds[e.sourceNodeId] || !kinds[e.targetNodeId]) continue;
    if (e.ref.kind === 'participant') participantLinks.push({ id: eid, a: e.sourceNodeId, b: e.targetNodeId });
    else if (e.ref.kind === 'attribute') {
      const attrId = e.ref.attributeId;
      const s = scene.nodes[e.sourceNodeId]!;
      const t = scene.nodes[e.targetNodeId]!;
      let attribute = e.targetNodeId;
      if (s.ref.kind === 'attribute' && s.ref.id === attrId) attribute = e.sourceNodeId;
      else if (t.ref.kind === 'attribute' && t.ref.id === attrId) attribute = e.targetNodeId;
      else if (kinds[e.sourceNodeId] === 'attribute' && kinds[e.targetNodeId] !== 'attribute') attribute = e.sourceNodeId;
      const owner = attribute === e.sourceNodeId ? e.targetNodeId : e.sourceNodeId;
      attributeLinks.push({ id: eid, owner, attribute });
    }
  }
  return layoutChen(
    { sizes, kinds, participantLinks, attributeLinks, current, priority, order },
    {
      mode: incremental ? 'incremental' : 'full',
      algorithm: opts.algorithm,
      direction: opts.direction,
      spacing: opts.spacing,
      seed: opts.seed,
      pinned,
      signal: opts.signal,
    },
  ).then((r) => {
    const all: Positions = { ...r };
    for (const id of pinned) all[id] = { ...current[id]! };
    return all;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// relational-schema / crows-foot / physical
// ---------------------------------------------------------------------------------------------------------------------

const AFTER: Record<LayoutDirection, number> = { DOWN: Math.PI / 2, UP: -Math.PI / 2, RIGHT: 0, LEFT: Math.PI };

async function relationalPositions(
  scene: Scene,
  sizes: Record<Id, Size>,
  current: Record<Id, Point>,
  pinned: ReadonlySet<Id>,
  incremental: boolean,
  opts: AutoLayoutOptions,
  order: Record<Id, string>,
): Promise<Positions> {
  const byStr = (a: string, b: string): number => cmp(order[a] ?? '', order[b] ?? '') || cmp(a, b);
  const ids = Object.keys(sizes).sort(byStr);
  const direction = opts.direction ?? 'DOWN';
  const spacing = Math.max(60, opts.spacing ?? 80);
  // FK edge = referencing (source) -> referenced (target). Layout flows parent -> child, so reverse; self-FKs ignored.
  const pairs = new Map<string, { parent: Id; child: Id }>();
  for (const eid of Object.keys(scene.edges).sort(cmp)) {
    const e = scene.edges[eid]!;
    if (e.sourceNodeId === e.targetNodeId || !sizes[e.sourceNodeId] || !sizes[e.targetNodeId]) continue;
    pairs.set(`${e.targetNodeId}|${e.sourceNodeId}`, { parent: e.targetNodeId, child: e.sourceNodeId });
  }
  const edges = [...pairs.entries()]
    .sort((a, b) => byStr(a[1].parent, b[1].parent) || byStr(a[1].child, b[1].child))
    .map(([k, v]) => ({ id: k, source: v.parent, target: v.child }));

  const elkAll = async (subset: Id[], fixed: ReadonlySet<Id>): Promise<Positions> => {
    const set = new Set(subset);
    return layoutGraph({
      nodes: subset.map((id) => ({
        id,
        w: sizes[id]!.w,
        h: sizes[id]!.h,
        sortKey: order[id] ?? '',
        ...(fixed.has(id) ? { fixed: { ...current[id]! } } : {}),
      })),
      edges: edges.filter((e) => set.has(e.source) && set.has(e.target)),
      algorithm: opts.algorithm ?? 'layered',
      direction,
      spacing,
      seed: opts.seed,
      signal: opts.signal,
    });
  };

  if (!incremental) return elkAll(ids, pinned);

  // ---- incremental: place new tables next to the tables they reference / are referenced by --------------------------
  const placed = new Map<Id, Point>();
  for (const id of pinned) placed.set(id, current[id]!);
  const rectOf = (id: Id): Rect => ({ x: placed.get(id)!.x, y: placed.get(id)!.y, w: sizes[id]!.w, h: sizes[id]!.h });
  const toPlace = ids.filter((i) => !pinned.has(i));
  const nb = (id: Id): Array<{ other: Id; otherIsParent: boolean }> =>
    edges.flatMap<{ other: Id; otherIsParent: boolean }>((e) => (e.target === id ? [{ other: e.source, otherIsParent: true }] : e.source === id ? [{ other: e.target, otherIsParent: false }] : []));
  const dir = { x: Math.cos(AFTER[direction]), y: Math.sin(AFTER[direction]) };

  // components of new nodes that touch nothing placed are laid out alone
  const comp = new Map<Id, number>();
  let nc = 0;
  for (const s of toPlace) {
    if (comp.has(s)) continue;
    const stack = [s];
    comp.set(s, nc);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const { other } of nb(cur)) if (!comp.has(other) && !pinned.has(other)) (comp.set(other, nc), stack.push(other));
    }
    nc++;
  }
  const connected = (c: number): boolean => toPlace.some((s) => comp.get(s) === c && nb(s).some((x) => placed.has(x.other)));

  const pending = new Set(toPlace.filter((s) => connected(comp.get(s)!)));
  // grow from the placed tables: most placed neighbours first (ties by id) so a table between two anchors lands between them
  while (pending.size > 0) {
    let pick: Id | undefined;
    let best = -1;
    for (const s of [...pending].sort(byStr)) {
      const score = nb(s).filter((x) => placed.has(x.other)).length;
      if (score > best) (best = score, (pick = s));
    }
    const id = pick!;
    pending.delete(id);
    const anchors = nb(id).filter((x) => placed.has(x.other));
    const obstacles = [...placed.keys()].map(rectOf);
    const s = sizes[id]!;
    if (anchors.length === 0) {
      const content = boundsOf(obstacles)!;
      placed.set(id, stackBelow(s, content, obstacles, spacing));
      continue;
    }
    const cs = anchors.map((a) => rectOf(a.other));
    const cx = cs.reduce((a, r) => a + r.x + r.w / 2, 0) / cs.length;
    const cy = cs.reduce((a, r) => a + r.y + r.h / 2, 0) / cs.length;
    // new table is a child of all its placed neighbours -> after them; a parent of all of them -> before them
    const allChildrenOfNew = anchors.every((a) => !a.otherIsParent);
    const sign = allChildrenOfNew ? -1 : 1;
    const horizontal = Math.abs(dir.x) > Math.abs(dir.y);
    const reach = anchors.length === 1 ? ((horizontal ? cs[0]!.w + s.w : cs[0]!.h + s.h) / 2 + spacing) : 0;
    const center = { x: cx + sign * dir.x * reach, y: cy + sign * dir.y * reach };
    const p = placeNear(s, center, obstacles, { gap: spacing, preferAngle: Math.atan2(sign * dir.y, sign * dir.x) });
    placed.set(id, p);
  }
  for (let c = 0; c < nc; c++) {
    if (connected(c)) continue;
    const members = toPlace.filter((s) => comp.get(s) === c);
    const local = await elkAll(members, new Set());
    const box = boundsOf(members.map((m) => ({ x: local[m]!.x, y: local[m]!.y, w: sizes[m]!.w, h: sizes[m]!.h })))!;
    const obstacles = [...placed.keys()].map(rectOf);
    const content = boundsOf(obstacles);
    const target = content ? stackBelow({ w: box.w, h: box.h }, content, obstacles, spacing) : { x: 0, y: 0 };
    for (const m of members) placed.set(m, { x: local[m]!.x - box.x + target.x, y: local[m]!.y - box.y + target.y });
  }
  const out: Positions = {};
  for (const id of ids) out[id] = placed.get(id)!;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Snap moved nodes to the grid. A snapped spot is accepted only when it keeps every clearance the layout had: it may not
 * bring a node closer to another one than `min(gap, current clearance)` and (Chen, `lines` given) may not create a line
 * that crosses a node, or a node on a line, that was not already crossing. Nearby grid points are tried; otherwise the node
 * stays unsnapped (an unsnapped but clean layout beats a snapped dirty one).
 */
function snapResult(
  result: Positions,
  sizes: Record<Id, Size>,
  current: Record<Id, Point>,
  pinned: ReadonlySet<Id>,
  g: number,
  gap: number,
  lines: ReadonlyArray<[Id, Id]> = [],
): Positions {
  const pos: Positions = {};
  for (const id of Object.keys(result)) pos[id] = pinned.has(id) ? { ...current[id]! } : result[id]!;
  const orig: Positions = { ...pos };
  const rect = (id: Id, p: Point): Rect => ({ x: p.x, y: p.y, w: sizes[id]!.w, h: sizes[id]!.h });
  const centre = (id: Id, p: Point): Point => ({ x: p.x + sizes[id]!.w / 2, y: p.y + sizes[id]!.h / 2 });
  /** Edge-to-edge separation (negative = overlap depth). */
  const sep = (a: Rect, b: Rect): number => Math.max(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)));
  const incident = new Map<Id, Array<[Id, Id]>>();
  for (const l of lines) for (const e of l) (incident.get(e) ?? incident.set(e, []).get(e)!).push(l);
  const ids = Object.keys(pos);
  const clash = (id: Id, p: Point): boolean => {
    const r = rect(id, p);
    for (const o of ids) {
      if (o === id) continue;
      const need = Math.min(gap, sep(rect(id, orig[id]!), rect(o, orig[o]!)));
      if (sep(r, rect(o, pos[o]!)) < need - 1e-6) return true;
    }
    return false;
  };
  const crossings = (id: Id, p: Point): Set<string> => {
    const out = new Set<string>();
    if (lines.length === 0) return out;
    const r = inflateRect(rect(id, p), -2);
    const c = centre(id, p);
    const at = (n: Id): Point => centre(n, n === id ? p : pos[n]!);
    lines.forEach((l, k) => {
      if (l[0] === id || l[1] === id) {
        const other = l[0] === id ? l[1] : l[0];
        for (const o of ids) if (o !== id && o !== other && segmentHitsRect(c, at(other), inflateRect(rect(o, pos[o]!), -2))) out.add(`${k}|${o}`);
      } else if (segmentHitsRect(at(l[0]), at(l[1]), r)) out.add(`${k}|${id}`);
    });
    return out;
  };
  for (const id of [...ids].sort((a, b) => orig[a]!.y - orig[b]!.y || orig[a]!.x - orig[b]!.x || cmp(a, b))) {
    if (pinned.has(id)) continue;
    const p = pos[id]!;
    const cx = Math.round(p.x / g);
    const cy = Math.round(p.y / g);
    const base = lines.length > 0 ? crossings(id, p) : undefined;
    const ok = (c: Point): boolean => {
      if (clash(id, c)) return false;
      if (!base) return true;
      for (const v of crossings(id, c)) if (!base.has(v)) return false;
      return true;
    };
    let chosen: Point | undefined;
    for (let ring = 0; ring <= 6 && !chosen; ring++) {
      const cands: Point[] = [];
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) cands.push({ x: (cx + dx) * g, y: (cy + dy) * g });
      cands.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.x - b.x || a.y - b.y);
      chosen = cands.find(ok);
    }
    // nothing snapped keeps the clearances: stay where the layout put the node
    pos[id] = chosen ?? p;
  }
  return pos;
}
