/**
 * Diagram / presentation ops. They never change semantics (except `createDiagram`, which may create an empty model).
 * Node `x/y` are BOUNDS origins (ARCHITECTURE rule 11): callers pass `target.x - ...` already converted.
 * Locked nodes are skipped by moves unless `includeLocked` is set (layout of a whole diagram may choose either).
 */
import {
  createDiagramForModel,
  createNodeResolver,
  edgeEndpointRefs,
  nodeableRefs,
  syncDiagram,
} from '../diagramSync';
import { createErModel, createRelationalModel, modelKindForDiagramType } from '../defaults';
import { nodeKindsFor } from '../invariants';
import { refKey } from '../queries';
import type {
  AnchorSpec,
  Diagram,
  DiagramOptions,
  DiagramType,
  EdgeRoute,
  EdgeStyle,
  Id,
  NodeStyle,
  Point,
  Project,
  SemanticRef,
  SqlDialect,
} from '../types';
import {
  OpError,
  addNodeFor,
  assertFinite,
  assertIdsFree,
  nodeIdByRef,
  requireDiagram,
  requireNode,
  jsonClone,
} from './common';

function requireEdge(d: Diagram, edgeId: Id) {
  const e = d.edges[edgeId];
  if (!e) throw new OpError('not-found', `Edge ${edgeId} is not in diagram ${d.id}`);
  return e;
}

const asList = (v: Id | Id[]): Id[] => (Array.isArray(v) ? v : [v]);

// ----- diagrams ----------------------------------------------------------------------------------------------------

export interface CreateDiagramInit {
  id?: Id;
  type: DiagramType;
  /** Existing model to view (kind must match the type). Absent: a NEW empty model of the right kind is created. */
  modelId?: Id;
  name?: string;
  /** Only when a new model is created. */
  modelName?: string;
  dialect?: SqlDialect;
  /** Copy node positions/sizes from this diagram of the SAME type for elements both show. */
  copyLayoutFrom?: Id;
}

export function createDiagram(
  draft: Project,
  init: CreateDiagramInit,
): { diagramId: Id; modelId: Id; createdModel: boolean } {
  assertIdsFree(draft, [init.id]);
  const kind = modelKindForDiagramType(init.type);
  let model = init.modelId ? draft.models[init.modelId] : undefined;
  if (init.modelId && !model) throw new OpError('not-found', `Model ${init.modelId} does not exist`);
  if (model && model.kind !== kind) throw new OpError('wrong-kind', `${init.type} diagrams view ${kind} models, not ${model.kind}`);
  const createdModel = !model;
  if (!model) {
    const fresh =
      kind === 'er'
        ? createErModel(init.modelName ?? 'ER Model')
        : createRelationalModel(init.modelName ?? 'Relational Schema', init.dialect ?? draft.settings.defaultDialect);
    draft.models[fresh.id] = fresh;
    model = draft.models[fresh.id]!;
  }
  const diagram = createDiagramForModel(model, init.type, { name: init.name, id: init.id });
  if (init.copyLayoutFrom) {
    const src = requireDiagram(draft, init.copyLayoutFrom);
    if (src.type === init.type && src.modelId === model.id) {
      const byRef = new Map(Object.values(src.nodes).map((n) => [refKey(n.ref), n]));
      for (const n of Object.values(diagram.nodes)) {
        const s = byRef.get(refKey(n.ref));
        if (!s) continue;
        n.x = s.x;
        n.y = s.y;
        if (s.width !== undefined) n.width = s.width;
        if (s.height !== undefined) n.height = s.height;
        if (s.columnWidths) n.columnWidths = { ...s.columnWidths };
        if (s.style) n.style = { ...s.style };
      }
    }
  }
  draft.diagrams[diagram.id] = diagram;
  draft.diagramOrder.push(diagram.id);
  return { diagramId: diagram.id, modelId: model.id, createdModel };
}

/** Deletes the diagram only; the model (and any conversion record) is untouched. */
export function removeDiagram(draft: Project, diagramId: Id): void {
  requireDiagram(draft, diagramId);
  delete draft.diagrams[diagramId];
  draft.diagramOrder = draft.diagramOrder.filter((id) => id !== diagramId);
}

/** Deletes the model and the diagrams viewing it (+ order entries); ConversionRecords are kept as history. */
export function removeModel(draft: Project, modelId: Id): void {
  if (!draft.models[modelId]) throw new OpError('not-found', `Model ${modelId} does not exist`);
  for (const d of Object.values(draft.diagrams)) if (d.modelId === modelId) delete draft.diagrams[d.id];
  draft.diagramOrder = draft.diagramOrder.filter((id) => !!draft.diagrams[id]);
  delete draft.models[modelId];
}

export function renameDiagram(draft: Project, diagramId: Id, name: string): void {
  requireDiagram(draft, diagramId).name = name;
}

/** Moves a diagram tab to `toIndex` (clamped to the tab range). Touches `diagramOrder` only. */
export function reorderDiagrams(draft: Project, diagramId: Id, toIndex: number): void {
  requireDiagram(draft, diagramId);
  const from = draft.diagramOrder.indexOf(diagramId);
  if (from < 0) throw new OpError('not-found', `Diagram ${diagramId} is not in the tab order`);
  const to = Math.max(0, Math.min(draft.diagramOrder.length - 1, Math.trunc(toIndex)));
  if (to === from) return;
  draft.diagramOrder.splice(from, 1);
  draft.diagramOrder.splice(to, 0, diagramId);
}

/** Renames the project (the document title). Blank names are rejected; surrounding whitespace is trimmed. */
export function renameProject(draft: Project, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new OpError('invalid', 'A project name cannot be empty');
  draft.name = trimmed;
}

/** `undefined` values are accepted and ignored by `setDiagramOptions` (options can be changed, never deleted). */
export type DeepPartial<T> = { [K in keyof T]?: (NonNullable<T[K]> extends object ? DeepPartial<NonNullable<T[K]>> : T[K]) | undefined };

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue; // options can be changed, never deleted (the type block must stay)
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else target[k] = v && typeof v === 'object' ? jsonClone(v) : v;
  }
}

export function setDiagramOptions(draft: Project, diagramId: Id, patch: DeepPartial<DiagramOptions>): void {
  deepMerge(requireDiagram(draft, diagramId).options as unknown as Record<string, unknown>, patch as Record<string, unknown>);
}

// ----- nodes -------------------------------------------------------------------------------------------------------

const SAME_DELTA_EPS = 1e-9;

/**
 * Waypoint translation (EDITOR-TOOLS): when nodes move, every MANUAL-route edge whose BOTH endpoints moved by the SAME
 * delta (a group drag, a nudge, an edge whose two ends are the same node) has its stored waypoints translated by it, so
 * a hand-routed connector keeps its shape. An edge with one fixed endpoint (or endpoints moving by different deltas, e.g.
 * auto-layout) keeps its waypoints: they are absolute world corners. Label offsets are relative, so they never change.
 */
function translateManualWaypoints(draft: Project, d: Diagram, deltas: ReadonlyMap<Id, Point>): void {
  if (deltas.size === 0) return;
  const model = draft.models[d.modelId];
  if (!model) return;
  const resolve = createNodeResolver(d, model);
  for (const edge of Object.values(d.edges)) {
    if (edge.route.mode !== 'manual' || edge.route.waypoints.length === 0) continue;
    const ends = edgeEndpointRefs(model, edge.ref);
    if (!ends) continue;
    const s = resolve(ends.source);
    const t = resolve(ends.target);
    const ds = s ? deltas.get(s) : undefined;
    const dt = t ? deltas.get(t) : undefined;
    if (!ds || !dt) continue;
    if (Math.abs(ds.x - dt.x) > SAME_DELTA_EPS || Math.abs(ds.y - dt.y) > SAME_DELTA_EPS) continue;
    for (const w of edge.route.waypoints) {
      w.x += ds.x;
      w.y += ds.y;
    }
  }
}

/**
 * Absolute bounds-origin positions. Unknown ids are ignored. Returns the ids that actually moved.
 * Manual-route waypoints follow edges whose both endpoints move by the same delta (see `translateManualWaypoints`).
 */
export function setNodePositions(
  draft: Project,
  diagramId: Id,
  positions: Record<Id, Point>,
  opts: { includeLocked?: boolean } = {},
): Id[] {
  const d = requireDiagram(draft, diagramId);
  for (const p of Object.values(positions)) {
    assertFinite(p.x, 'x');
    assertFinite(p.y, 'y');
  }
  const moved: Id[] = [];
  const deltas = new Map<Id, Point>();
  for (const [id, p] of Object.entries(positions)) {
    const n = d.nodes[id];
    if (!n || (n.locked && !opts.includeLocked)) continue;
    if (p.x !== n.x || p.y !== n.y) deltas.set(id, { x: p.x - n.x, y: p.y - n.y });
    n.x = p.x;
    n.y = p.y;
    moved.push(id);
  }
  translateManualWaypoints(draft, d, deltas);
  return moved;
}

export function moveNodesBy(draft: Project, diagramId: Id, nodeIds: Id[], dx: number, dy: number, opts: { includeLocked?: boolean } = {}): Id[] {
  const d = requireDiagram(draft, diagramId);
  assertFinite(dx, 'dx');
  assertFinite(dy, 'dy');
  const moved: Id[] = [];
  const deltas = new Map<Id, Point>();
  for (const id of nodeIds) {
    const n = d.nodes[id];
    if (!n || (n.locked && !opts.includeLocked)) continue;
    n.x += dx;
    n.y += dy;
    moved.push(id);
    const prev = deltas.get(id);
    if (dx !== 0 || dy !== 0) deltas.set(id, { x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy });
  }
  translateManualWaypoints(draft, d, deltas);
  return moved;
}

/** Manual size override; a key present with `undefined` returns that dimension to auto-fit. */
export function setNodeSize(draft: Project, diagramId: Id, nodeId: Id, size: { width?: number | undefined; height?: number | undefined }): void {
  const n = requireNode(requireDiagram(draft, diagramId), nodeId);
  for (const key of ['width', 'height'] as const) {
    if (!(key in size)) continue;
    const v = size[key];
    if (v === undefined) delete n[key];
    else {
      assertFinite(v, key);
      if (v <= 0) throw new OpError('invalid', `${key} must be positive`);
      n[key] = v;
    }
  }
}

export function setNodeStyle(draft: Project, diagramId: Id, nodeIds: Id | Id[], patch: { [K in keyof NodeStyle]?: NodeStyle[K] | undefined }): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of asList(nodeIds)) {
    const n = requireNode(d, id);
    const style = (n.style ??= {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete style[k];
      else style[k] = v;
    }
    if (Object.keys(style).length === 0) delete n.style;
  }
}

/** Per-column cell width of a relation node; `undefined` removes the override. The column must belong to the node's relation. */
export function setColumnWidth(draft: Project, diagramId: Id, nodeId: Id, columnId: Id, width: number | undefined): void {
  const d = requireDiagram(draft, diagramId);
  const n = requireNode(d, nodeId);
  const model = draft.models[d.modelId];
  const rel = model?.kind === 'relational' && n.ref.kind === 'relation' ? model.relations[n.ref.id] : undefined;
  if (!rel) throw new OpError('invalid', 'Column widths only apply to relation nodes');
  if (!rel.columns.some((c) => c.id === columnId)) throw new OpError('not-found', `Column ${columnId} is not in relation ${rel.name}`);
  if (width === undefined) {
    if (n.columnWidths) {
      delete n.columnWidths[columnId];
      if (Object.keys(n.columnWidths).length === 0) delete n.columnWidths;
    }
    return;
  }
  assertFinite(width, 'width');
  if (width <= 0) throw new OpError('invalid', 'width must be positive');
  (n.columnWidths ??= {})[columnId] = width;
}

export function setNodeLocked(draft: Project, diagramId: Id, nodeIds: Id | Id[], locked: boolean): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of asList(nodeIds)) {
    const n = requireNode(d, id);
    if (locked) n.locked = true;
    else delete n.locked;
  }
}

const byPaint = (a: { zIndex?: number; id: Id }, b: { zIndex?: number; id: Id }): number =>
  (a.zIndex ?? 0) - (b.zIndex ?? 0) || (a.id < b.id ? -1 : 1);

/** Selected nodes go above everything, keeping their relative order. */
export function bringToFront(draft: Project, diagramId: Id, nodeIds: Id[]): void {
  const d = requireDiagram(draft, diagramId);
  const picked = [...new Set(nodeIds)].map((id) => requireNode(d, id)).sort(byPaint);
  let z = Object.values(d.nodes).reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
  for (const n of picked) n.zIndex = ++z;
}

/** Selected nodes go below everything, keeping their relative order (zIndex may become negative). */
export function sendToBack(draft: Project, diagramId: Id, nodeIds: Id[]): void {
  const d = requireDiagram(draft, diagramId);
  const picked = [...new Set(nodeIds)].map((id) => requireNode(d, id)).sort(byPaint);
  let z = Object.values(d.nodes).reduce((m, n) => Math.min(m, n.zIndex ?? 0), 0) - picked.length;
  for (const n of picked) n.zIndex = z++;
}

// ----- edges -------------------------------------------------------------------------------------------------------

export interface EdgeRoutePatch {
  mode?: EdgeRoute['mode'];
  waypoints?: Point[];
  sourceAnchor?: AnchorSpec | undefined;
  targetAnchor?: AnchorSpec | undefined;
  /** Replaces all per-branch overrides; keys must be SOURCE column ids of the edge's FK. `undefined` clears. */
  branchAnchors?: EdgeRoute['branchAnchors'] | undefined;
}

/**
 * Rerouting never changes what an edge references: only mode, bends and anchor PREFERENCES are stored; endpoints always
 * derive from semantic ids, so a reroute cannot make an arrow point at another field.
 */
export function setEdgeRoute(draft: Project, diagramId: Id, edgeId: Id, patch: EdgeRoutePatch): void {
  const d = requireDiagram(draft, diagramId);
  const e = requireEdge(d, edgeId);
  if (patch.waypoints) for (const p of patch.waypoints) (assertFinite(p.x, 'waypoint.x'), assertFinite(p.y, 'waypoint.y'));
  for (const anchor of [patch.sourceAnchor, patch.targetAnchor]) {
    if (anchor?.offset !== undefined && (!Number.isFinite(anchor.offset) || anchor.offset < 0 || anchor.offset > 1)) {
      throw new OpError('invalid', 'Anchor offset must be within 0..1');
    }
  }
  if (patch.branchAnchors) {
    const model = draft.models[d.modelId];
    const fk = e.ref.kind === 'foreignKey' && model?.kind === 'relational' ? model.foreignKeys[e.ref.foreignKeyId] : undefined;
    for (const key of Object.keys(patch.branchAnchors)) {
      if (!fk?.columns.some((c) => c.sourceColumnId === key)) throw new OpError('invalid', `branchAnchors key ${key} is not a source column of this foreign key`);
    }
  }
  if (patch.mode) e.route.mode = patch.mode;
  if (patch.waypoints) e.route.waypoints = patch.waypoints.map((p) => ({ x: p.x, y: p.y }));
  for (const key of ['sourceAnchor', 'targetAnchor', 'branchAnchors'] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined || (key === 'branchAnchors' && Object.keys(v).length === 0)) delete e.route[key];
    else (e.route as unknown as Record<string, unknown>)[key] = jsonClone(v);
  }
}

export function resetEdgeRoute(draft: Project, diagramId: Id, edgeIds: Id | Id[]): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of asList(edgeIds)) requireEdge(d, id).route = { mode: 'auto', waypoints: [] };
}

export function setEdgeStyle(draft: Project, diagramId: Id, edgeIds: Id | Id[], patch: { [K in keyof EdgeStyle]?: EdgeStyle[K] | undefined }): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of asList(edgeIds)) {
    const e = requireEdge(d, id);
    const style = (e.style ??= {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete style[k];
      else style[k] = v;
    }
    if (Object.keys(style).length === 0) delete e.style;
  }
}

/** `undefined` = follow the diagram default (`options.relational.fkLabels`). */
export function setEdgeLabelVisible(draft: Project, diagramId: Id, edgeIds: Id | Id[], visible: boolean | undefined): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of asList(edgeIds)) {
    const e = requireEdge(d, id);
    if (visible === undefined) delete e.labelVisible;
    else e.labelVisible = visible;
  }
}

/** World-space delta from the default label anchor; `undefined` puts the label back. */
export function setEdgeLabelOffset(draft: Project, diagramId: Id, edgeId: Id, which: 'main' | 'role' | 'cardinality', offset: Point | undefined): void {
  const e = requireEdge(requireDiagram(draft, diagramId), edgeId);
  if (offset === undefined) {
    if (e.labelOffsets) {
      delete e.labelOffsets[which];
      if (Object.keys(e.labelOffsets).length === 0) delete e.labelOffsets;
    }
    return;
  }
  assertFinite(offset.x, 'offset.x');
  assertFinite(offset.y, 'offset.y');
  (e.labelOffsets ??= {})[which] = { x: offset.x, y: offset.y };
}

// ----- partial diagrams --------------------------------------------------------------------------------------------

/** Presentation-only removal ("Remove from diagram"): marks the diagram partial, drops the nodes and their edges. */
export function removeFromDiagram(draft: Project, diagramId: Id, nodeIds: Id[]): void {
  const d = requireDiagram(draft, diagramId);
  for (const id of nodeIds) requireNode(d, id);
  d.partial = true;
  for (const id of nodeIds) delete d.nodes[id];
  syncDiagram(draft, diagramId);
}

/**
 * Add nodes for `refs` back into a (partial) diagram. Positions are keyed by `refKey(ref)`; others are flowed in a row
 * below the content (provisional — run auto-layout for real placement). Refs that already have a node, or are not
 * drawable here (wrong kind, an associative relationship), are skipped. When the diagram becomes complete again the
 * `partial` flag is cleared. Returns the added node ids.
 */
export function showInDiagram(draft: Project, diagramId: Id, refs: SemanticRef[], positions: Record<string, Point> = {}): Id[] {
  const d = requireDiagram(draft, diagramId);
  const model = draft.models[d.modelId];
  if (!model) throw new OpError('not-found', `Model ${d.modelId} does not exist`);
  const nodeable = new Set(nodeableRefs(model).map(refKey));
  const added: Id[] = [];
  const bottom = Object.values(d.nodes).reduce((m, n) => Math.max(m, n.y + 60), 0);
  let x = 40;
  for (const ref of refs) {
    if (!nodeKindsFor(d.type).includes(ref.kind) || !nodeable.has(refKey(ref)) || nodeIdByRef(d, ref)) continue;
    const p = positions[refKey(ref)];
    if (p) (assertFinite(p.x, 'x'), assertFinite(p.y, 'y'));
    added.push(addNodeFor(d, ref, p?.x ?? x, p?.y ?? Math.round((bottom + 80) / 20) * 20));
    if (!p) x += 200;
  }
  const complete = [...nodeable].every((k) => Object.values(d.nodes).some((n) => refKey(n.ref) === k));
  if (complete) delete d.partial;
  syncDiagram(draft, diagramId);
  return added;
}
