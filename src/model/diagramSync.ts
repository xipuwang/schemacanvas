/**
 * Diagram ⇄ model synchronisation: the ONE place that decides which nodes/edges a diagram contains.
 * Pure and idempotent; works on plain objects AND immer drafts (it mutates the diagram it is given).
 *
 * Rules (normative, ARCHITECTURE §2):
 *  - Scene builders draw ONLY `diagram.edges`; edges are created here (`syncDiagramEdges`) and removed when their
 *    ref no longer resolves or an endpoint lost its node. At most one edge per `edgeRefKey` per diagram.
 *  - A COMPLETE diagram (`!diagram.partial`) has exactly one node per node-able element (`syncDiagramNodes` adds the
 *    missing ones at provisional grid positions; run `autoLayout` afterwards for real placement).
 *  - A Chen diagram gives a node to every entity, relationship and attribute (composite children included) — EXCEPT a
 *    relationship that has an associative entity: that entity's node stands for it (`nodeIdOfRef`).
 *  - Nodes are only ever added to the diagram an op targets; model ops call `syncModelDiagrams` afterwards so every
 *    diagram of the model stays consistent.
 */
import { modelKindForDiagramType, createDiagram } from './defaults';
import { newId } from './ids';
import { edgeRefKey, ownGet, refKey, sameRef } from './queries';
import type {
  Diagram,
  DiagramNode,
  DiagramType,
  EdgeRef,
  ErAttributeOwner,
  ErModel,
  Id,
  Model,
  Project,
  RelationalModel,
  SemanticRef,
} from './types';
import { measureTextMetric } from '@/scene/measure';
import { createVerticalSizer } from '@/scene/vertical/size';

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const ownerRef = (o: ErAttributeOwner): SemanticRef =>
  o.kind === 'entity' ? { kind: 'entity', id: o.id } : o.kind === 'relationship' ? { kind: 'relationship', id: o.id } : { kind: 'attribute', id: o.id };

/** Does `ref` point at an element that exists in `model`? */
export function refResolves(model: Model, ref: SemanticRef): boolean {
  if (model.kind === 'er') {
    switch (ref.kind) {
      case 'entity':
        return !!ownGet(model.entities, ref.id);
      case 'attribute':
        return !!ownGet(model.attributes, ref.id);
      case 'relationship':
        return !!ownGet(model.relationships, ref.id);
      case 'participant':
        return !!ownGet(model.relationships, ref.relationshipId)?.participants?.some((p) => p?.id === ref.id);
      default:
        return false;
    }
  }
  switch (ref.kind) {
    case 'relation':
      return !!ownGet(model.relations, ref.id);
    case 'column':
      return !!ownGet(model.relations, ref.relationId)?.columns?.some((c) => c?.id === ref.id);
    case 'unique':
      return !!ownGet(model.relations, ref.relationId)?.uniques?.some((u) => u?.id === ref.id);
    case 'index':
      return !!ownGet(model.relations, ref.relationId)?.indexes?.some((i) => i?.id === ref.id);
    case 'foreignKey':
      return !!ownGet(model.foreignKeys, ref.id);
    default:
      return false;
  }
}

/** The two semantic endpoints of an edge ref (direction per `EdgeRef` docs), or undefined if it does not resolve. */
export function edgeEndpointRefs(model: Model, ref: EdgeRef): { source: SemanticRef; target: SemanticRef } | undefined {
  if (ref.kind === 'foreignKey') {
    if (model.kind !== 'relational') return undefined;
    const fk = ownGet(model.foreignKeys, ref.foreignKeyId);
    if (!fk || !ownGet(model.relations, fk.sourceRelationId) || !ownGet(model.relations, fk.targetRelationId)) return undefined;
    return { source: { kind: 'relation', id: fk.sourceRelationId }, target: { kind: 'relation', id: fk.targetRelationId } };
  }
  if (model.kind !== 'er') return undefined;
  if (ref.kind === 'participant') {
    const rel = ownGet(model.relationships, ref.relationshipId);
    const p = rel?.participants?.find((x) => x?.id === ref.participantId);
    if (!rel || !p || !ownGet(model.entities, p.entityId)) return undefined;
    return { source: { kind: 'relationship', id: rel.id }, target: { kind: 'entity', id: p.entityId } };
  }
  const attr = ownGet(model.attributes, ref.attributeId);
  if (!attr) return undefined;
  const src = ownerRef(attr.owner);
  if (!refResolves(model, src)) return undefined;
  return { source: src, target: { kind: 'attribute', id: attr.id } };
}

/**
 * The diagram node standing for `ref`. A relationship that has an associative entity resolves to the ENTITY's node
 * (falling back to its own node if it has one), so participant/attribute edges of R attach to the associative entity.
 */
export function nodeIdOfRef(diagram: Diagram, model: Model, ref: SemanticRef): Id | undefined {
  return createNodeResolver(diagram, model)(ref);
}

/** relationshipId -> its associative entity, built in one pass (replaces repeated `associativeEntityOf` scans). */
export function associativeEntityIndex(model: Model): Map<Id, Id> {
  const out = new Map<Id, Id>();
  if (model.kind !== 'er') return out;
  for (const e of Object.values(model.entities)) if (e.associativeOf && !out.has(e.associativeOf)) out.set(e.associativeOf, e.id);
  return out;
}

/**
 * `nodeIdOfRef` for many lookups on one diagram: indexes the nodes by ref key once (first node wins, like the linear
 * scan did), so resolving an endpoint is O(1) instead of O(nodes).
 */
export function createNodeResolver(diagram: Diagram, model: Model, assoc: Map<Id, Id> = associativeEntityIndex(model)): (ref: SemanticRef) => Id | undefined {
  const byKey = new Map<string, Id>();
  for (const [id, node] of Object.entries(diagram.nodes)) {
    const k = refKey(node.ref);
    if (!byKey.has(k)) byKey.set(k, id);
  }
  return (ref) => {
    if (ref.kind === 'relationship' && model.kind === 'er') {
      const assocId = assoc.get(ref.id);
      if (assocId) {
        const viaEntity = byKey.get(refKey({ kind: 'entity', id: assocId }));
        if (viaEntity) return viaEntity;
      }
    }
    return byKey.get(refKey(ref));
  };
}

// ---------------------------------------------------------------------------
// What a diagram should contain
// ---------------------------------------------------------------------------

/** Elements of `model` that get a node in a diagram of `type`, in a deterministic order. */
export function nodeableRefs(model: Model): SemanticRef[] {
  if (model.kind === 'er') {
    const assoc = associativeEntityIndex(model);
    const refs: SemanticRef[] = [];
    for (const e of Object.values(model.entities)) refs.push({ kind: 'entity', id: e.id });
    for (const r of Object.values(model.relationships)) {
      if (assoc.has(r.id)) continue; // the associative entity's node stands for it
      refs.push({ kind: 'relationship', id: r.id });
    }
    for (const a of Object.values(model.attributes)) refs.push({ kind: 'attribute', id: a.id });
    return refs;
  }
  return Object.values(model.relations).map((r): SemanticRef => ({ kind: 'relation', id: r.id }));
}

/** Edge refs that exist semantically AND whose both endpoint nodes exist in `diagram`. */
export function expectedEdgeRefs(model: Model, diagram: Diagram): EdgeRef[] {
  const resolve = createNodeResolver(diagram, model);
  const all: EdgeRef[] = [];
  if (model.kind === 'er') {
    for (const r of Object.values(model.relationships)) {
      for (const p of r.participants) all.push({ kind: 'participant', relationshipId: r.id, participantId: p.id });
    }
    for (const a of Object.values(model.attributes)) all.push({ kind: 'attribute', attributeId: a.id });
  } else {
    for (const fk of Object.values(model.foreignKeys)) all.push({ kind: 'foreignKey', foreignKeyId: fk.id });
  }
  return all.filter((ref) => {
    const ends = edgeEndpointRefs(model, ref);
    if (!ends) return false;
    return resolve(ends.source) !== undefined && resolve(ends.target) !== undefined;
  });
}

/**
 * Make `diagram.edges` match the model: add a default edge for every expected ref that lacks one, delete edges whose
 * ref does not resolve or whose endpoint node is gone, dedupe by `edgeRefKey`. Keeps existing route/style untouched.
 */
export function syncDiagramEdges(model: Model, diagram: Diagram): { added: Id[]; removed: Id[] } {
  const expected = expectedEdgeRefs(model, diagram);
  const expectedKeys = new Set(expected.map(edgeRefKey));
  const removed: Id[] = [];
  const have = new Set<string>();
  for (const [id, edge] of Object.entries(diagram.edges)) {
    const key = edgeRefKey(edge.ref);
    if (!expectedKeys.has(key) || have.has(key)) {
      delete diagram.edges[id];
      removed.push(id);
    } else {
      have.add(key);
    }
  }
  const added: Id[] = [];
  for (const ref of expected) {
    if (have.has(edgeRefKey(ref))) continue;
    const id = newId('edg');
    diagram.edges[id] = { id, ref, route: { mode: 'auto', waypoints: [] } };
    added.push(id);
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Nodes (provisional placement)
// ---------------------------------------------------------------------------

/** Footprint of one node for provisional placement; real sizes come from the scene, vertical tables from the same layout code. */
type Sizer = (ref: SemanticRef, node?: DiagramNode) => { w: number; h: number };

/**
 * Rough footprint (Chen, relational-schema) or EXACT footprint (crow's foot / physical: the vertical family's own table
 * layout, orientation, types, constraints and indexes included) used ONLY for provisional placement.
 */
function createSizer(model: Model, diagram: Diagram): Sizer {
  const diagramType: DiagramType = diagram.type;
  const font = { family: 'Helvetica', size: 14 };
  const text = (s: string) => measureTextMetric(s, font);
  const vertical = model.kind === 'relational' && (diagramType === 'crows-foot' || diagramType === 'physical') ? createVerticalSizer(model, diagram, measureTextMetric) : undefined;
  return (ref, node) => {
    if (model.kind === 'er') {
      if (ref.kind === 'entity') return { w: Math.max(110, text(ownGet(model.entities, ref.id)?.name ?? '') + 56), h: 54 };
      if (ref.kind === 'attribute') return { w: Math.max(90, text(ownGet(model.attributes, ref.id)?.name ?? '') + 44), h: 44 };
      return { w: Math.max(120, text(ownGet(model.relationships, ref.id)?.name ?? '') * 1.7 + 50), h: 76 };
    }
    const rel = ref.kind === 'relation' ? ownGet(model.relations, ref.id) : undefined;
    if (!rel) return { w: 160, h: 60 };
    if (vertical) {
      const real = vertical(rel.id, node);
      if (real) return real;
    }
    if (diagramType === 'relational-schema') {
      const w = rel.columns.reduce((sum, c) => sum + Math.max(56, text(c.name) + 24), 0);
      return { w: Math.max(80, w), h: 32 + 24 };
    }
    const w = Math.max(160, ...rel.columns.map((c) => text(c.name) + 90), text(rel.name) + 40);
    return { w, h: 32 + 26 * Math.max(1, rel.columns.length) };
  };
}

const GRID = 20;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

/**
 * Add a node for every node-able element that has none (skipped when `diagram.partial`), and delete nodes whose ref no
 * longer resolves. New nodes are flowed into rows BELOW the existing content (rough sizes) and given an explicit
 * `zIndex = max + 1` so paint order never depends on record key order.
 */
export function syncDiagramNodes(model: Model, diagram: Diagram): { added: Id[]; removed: Id[] } {
  const removed: Id[] = [];
  const assoc = associativeEntityIndex(model);
  for (const [id, node] of Object.entries(diagram.nodes)) {
    const dangling = !refResolves(model, node.ref);
    // A relationship that has an associative entity must not keep a node of its own.
    const shadowed = model.kind === 'er' && node.ref.kind === 'relationship' && assoc.has(node.ref.id);
    if (dangling || shadowed) {
      delete diagram.nodes[id];
      removed.push(id);
    }
  }
  if (diagram.partial) return { added: [], removed };

  const existing = new Set(Object.values(diagram.nodes).map((n) => refKey(n.ref)));
  const missing = nodeableRefs(model).filter((r) => !existing.has(refKey(r)));
  if (missing.length === 0) return { added: [], removed };

  const nodes = Object.values(diagram.nodes);
  let maxZ = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
  const sizeOf = createSizer(model, diagram);
  const contentBottom = nodes.reduce((m, n) => Math.max(m, n.y + sizeOf(n.ref, n).h), -Infinity);
  const startY = nodes.length === 0 ? 40 : snap(contentBottom + 80);
  const maxRowWidth = diagram.type === 'chen' ? 1400 : 1500;
  // Vertical tables need lanes for connector stubs and symbols between them: wider gaps than the other families.
  const verticalFamily = diagram.type === 'crows-foot' || diagram.type === 'physical';
  const GAP_X = verticalFamily ? 80 : 50;
  const GAP_Y = diagram.type === 'chen' ? 60 : verticalFamily ? 90 : 70;
  let x = 40;
  let y = startY;
  let rowH = 0;
  const added: Id[] = [];
  for (const ref of missing) {
    const { w, h } = sizeOf(ref);
    if (x > 40 && x + w > maxRowWidth) {
      x = 40;
      y += rowH + GAP_Y;
      rowH = 0;
    }
    const id = newId('nod');
    const node: DiagramNode = { id, ref, x: snap(x), y: snap(y), zIndex: ++maxZ };
    diagram.nodes[id] = node;
    added.push(id);
    x += w + GAP_X;
    rowH = Math.max(rowH, h);
  }
  return { added, removed };
}

/** Drop `columnWidths` entries for columns that no longer exist (relational diagrams). */
export function pruneColumnWidths(model: Model, diagram: Diagram): void {
  if (model.kind !== 'relational') return;
  for (const node of Object.values(diagram.nodes)) {
    if (!node.columnWidths || node.ref.kind !== 'relation') continue;
    const rel = ownGet(model.relations, node.ref.id);
    if (!rel) continue;
    for (const colId of Object.keys(node.columnWidths)) {
      if (!rel.columns.some((c) => c.id === colId)) delete node.columnWidths[colId];
    }
    if (Object.keys(node.columnWidths).length === 0) delete node.columnWidths;
  }
}

/** Nodes (unless partial) then edges; idempotent. */
export function syncDiagram(project: Project, diagramId: Id): { addedNodes: Id[]; removedNodes: Id[]; addedEdges: Id[]; removedEdges: Id[] } {
  const diagram = ownGet(project.diagrams, diagramId);
  const model = diagram && ownGet(project.models, diagram.modelId);
  if (!diagram || !model) return { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] };
  const n = syncDiagramNodes(model, diagram);
  pruneColumnWidths(model, diagram);
  const e = syncDiagramEdges(model, diagram);
  return { addedNodes: n.added, removedNodes: n.removed, addedEdges: e.added, removedEdges: e.removed };
}

/** `syncDiagram` for EVERY diagram that views `modelId` — every semantic op ends with this. */
export function syncModelDiagrams(project: Project, modelId: Id): void {
  for (const d of Object.values(project.diagrams)) if (d.modelId === modelId) syncDiagram(project, d.id);
}

/**
 * Build a complete diagram of `type` for `model`: one node per element at provisional grid positions + every edge.
 * Conversion, importers and examples MUST use this and never hand-build edges. Does NOT add it to a project.
 */
export function createDiagramForModel(model: Model, type: DiagramType, opts: { name?: string; id?: Id } = {}): Diagram {
  if (modelKindForDiagramType(type) !== model.kind) {
    throw new Error(`createDiagramForModel: ${type} diagrams view ${modelKindForDiagramType(type)} models, got ${model.kind}`);
  }
  const diagram = createDiagram(type, model.id, opts.name, opts.id);
  syncDiagramNodes(model, diagram);
  syncDiagramEdges(model, diagram);
  return diagram;
}

/** Build a `{ models, diagrams }`-ready project fragment for tests/examples: model + complete diagram. */
export function withDiagram(project: Project, model: ErModel | RelationalModel, type: DiagramType, opts: { name?: string } = {}): Diagram {
  const diagram = createDiagramForModel(model, type, opts);
  project.models[model.id] = model;
  project.diagrams[diagram.id] = diagram;
  project.diagramOrder.push(diagram.id);
  return diagram;
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

/**
 * Map semantic refs (issue.affected, selection) to what is clickable on `diagram`:
 * entity/attribute/relationship/relation → node (+ an attribute's own link edge); participant / foreignKey → edge;
 * column → its relation's node + `columnIds` (to highlight one cell); unique/index → the relation node.
 * Refs that belong to a different model than the diagram's are ignored (cross-model mapping goes through
 * `Origin.sources` / the conversion trace, done by the UI layer).
 */
export function resolveRefsInDiagram(
  project: Project,
  diagram: Diagram,
  refs: SemanticRef[],
): { nodeIds: Id[]; edgeIds: Id[]; columnIds: Id[] } {
  const model = ownGet(project.models, diagram.modelId);
  const nodeIds = new Set<Id>();
  const edgeIds = new Set<Id>();
  const columnIds = new Set<Id>();
  if (!model) return { nodeIds: [], edgeIds: [], columnIds: [] };
  const edgeByKey = new Map<string, Id>();
  for (const [id, e] of Object.entries(diagram.edges)) edgeByKey.set(edgeRefKey(e.ref), id);
  for (const ref of refs) {
    if (!refResolves(model, ref)) continue;
    switch (ref.kind) {
      case 'entity':
      case 'relationship':
      case 'relation':
      case 'unique':
      case 'index': {
        const target: SemanticRef = ref.kind === 'unique' || ref.kind === 'index' ? { kind: 'relation', id: ref.relationId } : ref;
        const n = nodeIdOfRef(diagram, model, target);
        if (n) nodeIds.add(n);
        break;
      }
      case 'attribute': {
        const n = nodeIdOfRef(diagram, model, ref);
        if (n) nodeIds.add(n);
        const e = edgeByKey.get(`attribute:${ref.id}`);
        if (e) edgeIds.add(e);
        break;
      }
      case 'participant': {
        const e = edgeByKey.get(`participant:${ref.id}`);
        if (e) edgeIds.add(e);
        break;
      }
      case 'foreignKey': {
        const e = edgeByKey.get(`foreignKey:${ref.id}`);
        if (e) edgeIds.add(e);
        break;
      }
      case 'column': {
        const n = nodeIdOfRef(diagram, model, { kind: 'relation', id: ref.relationId });
        if (n) nodeIds.add(n);
        columnIds.add(ref.id);
        break;
      }
    }
  }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds], columnIds: [...columnIds] };
}
