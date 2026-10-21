/**
 * Clipboard / duplicate / template-instantiation (ARCHITECTURE 5d). One path for all three:
 *
 *   extractClipboard(project, diagramId, nodeIds)  -> ClipboardPayload   (plain JSON, self-contained)
 *   remapIds(payload)                              -> fresh ids everywhere (pure; references OUTSIDE the payload keep their id)
 *   pasteClipboard(draft, diagramId, payload, off) -> inserts, resolves outside references, syncs
 *
 * Rules: every id-bearing field is remapped (nested ids, primaryKey, FK pairs, keyParticipantIds, derivedFrom,
 * associativeOf, attribute owner, columnWidths / branchAnchors KEYS, node and edge refs); `origin` is stripped (a copy is
 * hand-authored); `locked` is dropped; a payload only pastes into a model of the same kind. A reference to something
 * outside the payload survives ONLY when pasting back into the same model and its target still exists.
 */
import { associativeEntityOf } from '../erSemantics';
import { newId } from '../ids';
import { attributesOf, edgeRefKey, relationNameKey, sqlNameKey } from '../queries';
import { edgeEndpointRefs, refResolves, syncDiagramEdges } from '../diagramSync';
import type {
  DiagramEdge,
  DiagramNode,
  DiagramType,
  EdgeRef,
  ErAttribute,
  ErEntity,
  ErModel,
  ErRelationship,
  ForeignKey,
  Id,
  Point,
  Project,
  RelationalModel,
  Relation,
  SemanticRef,
} from '../types';
import { OpError, addedNodes, commitSync, jsonClone, requireDiagram, snapshotNodes } from './common';

export interface ClipboardPayload {
  format: 'schemacanvas-clipboard';
  version: 1;
  diagramType: DiagramType;
  modelKind: 'er' | 'relational';
  /** Model the fragment was copied from: outside references survive only when pasting back into it. */
  sourceModelId: Id;
  er?: { entities: ErEntity[]; attributes: ErAttribute[]; relationships: ErRelationship[] };
  relational?: { relations: Relation[]; foreignKeys: ForeignKey[] };
  /** Ascending paint order. `x/y` are bounds origins in the source diagram. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const byPaint = (a: DiagramNode, b: DiagramNode): number => (a.zIndex ?? 0) - (b.zIndex ?? 0) || (a.id < b.id ? -1 : 1);

// ----- extract -----------------------------------------------------------------------------------------------------

function attributeClosure(model: ErModel, owners: Array<{ kind: string; id: Id }>, seeds: Id[]): Set<Id> {
  const out = new Set<Id>(seeds);
  const walk = (owner: { kind: string; id: Id }): void => {
    for (const a of attributesOf(model, owner)) {
      if (out.has(a.id) && !seeds.includes(a.id)) continue;
      out.add(a.id);
      walk({ kind: 'attribute', id: a.id });
    }
  };
  for (const o of owners) walk(o);
  for (const s of seeds) walk({ kind: 'attribute', id: s });
  return out;
}

export function extractClipboard(project: Project, diagramId: Id, nodeIds: Id[]): ClipboardPayload {
  const diagram = requireDiagram(project, diagramId);
  const model = project.models[diagram.modelId];
  if (!model) throw new OpError('not-found', `Model ${diagram.modelId} does not exist`);
  const selected = [...new Set(nodeIds)].map((id) => diagram.nodes[id]).filter((n): n is DiagramNode => !!n);
  const payload: ClipboardPayload = {
    format: 'schemacanvas-clipboard',
    version: 1,
    diagramType: diagram.type,
    modelKind: model.kind,
    sourceModelId: model.id,
    nodes: [],
    edges: [],
  };
  let nodeSet: DiagramNode[];
  let included: (ref: EdgeRef) => boolean;

  if (model.kind === 'er') {
    const entities = new Set<Id>();
    const relationships = new Set<Id>();
    const seedAttrs: Id[] = [];
    for (const n of selected) {
      if (n.ref.kind === 'entity') entities.add(n.ref.id);
      else if (n.ref.kind === 'relationship') relationships.add(n.ref.id);
      else if (n.ref.kind === 'attribute') seedAttrs.push(n.ref.id);
    }
    // An associative entity cannot be copied without the relationship it stands for.
    for (const id of entities) {
      const rid = model.entities[id]?.associativeOf;
      if (rid && model.relationships[rid]) relationships.add(rid);
    }
    const attrs = attributeClosure(
      model,
      [...[...entities].map((id) => ({ kind: 'entity', id })), ...[...relationships].map((id) => ({ kind: 'relationship', id }))],
      seedAttrs.filter((id) => model.attributes[id]),
    );
    payload.er = {
      entities: [...entities].filter((id) => model.entities[id]).map((id) => jsonClone(model.entities[id]!)),
      relationships: [...relationships].filter((id) => model.relationships[id]).map((id) => jsonClone(model.relationships[id]!)),
      attributes: [...attrs].filter((id) => model.attributes[id]).map((id) => jsonClone(model.attributes[id]!)),
    };
    const has = (ref: SemanticRef): boolean =>
      ref.kind === 'entity' ? entities.has(ref.id) : ref.kind === 'relationship' ? relationships.has(ref.id) : ref.kind === 'attribute' && attrs.has(ref.id);
    nodeSet = Object.values(diagram.nodes).filter((n) => has(n.ref));
    included = (ref) => {
      const ends = edgeEndpointRefs(model, ref);
      return !!ends && has(ends.source) && has(ends.target);
    };
  } else {
    const rels = new Set<Id>(selected.filter((n) => n.ref.kind === 'relation').map((n) => n.ref.id));
    const relations = [...rels].filter((id) => model.relations[id]).map((id) => jsonClone(model.relations[id]!));
    const fks = Object.values(model.foreignKeys).filter((fk) => rels.has(fk.sourceRelationId) && rels.has(fk.targetRelationId));
    payload.relational = { relations, foreignKeys: fks.map((fk) => jsonClone(fk)) };
    nodeSet = Object.values(diagram.nodes).filter((n) => n.ref.kind === 'relation' && rels.has(n.ref.id));
    included = (ref) => ref.kind === 'foreignKey' && fks.some((fk) => fk.id === ref.foreignKeyId);
  }
  payload.nodes = nodeSet.sort(byPaint).map((n) => {
    const copy = jsonClone(n);
    delete copy.locked;
    return copy;
  });
  payload.edges = Object.values(diagram.edges)
    .filter((e) => included(e.ref))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => jsonClone(e));
  return payload;
}

// ----- remap -------------------------------------------------------------------------------------------------------

/**
 * Pure: a copy of `payload` where EVERY id defined by the payload is replaced by a fresh one and every reference to such
 * an id follows. References to ids the payload does not define are left alone (the paste step resolves them).
 * Returns `idMap` (old id -> new id).
 */
export function remapIds(payload: ClipboardPayload): { payload: ClipboardPayload; idMap: Record<Id, Id> } {
  const idMap: Record<Id, Id> = {};
  const define = (prefix: string, id: Id): void => {
    if (!(id in idMap)) idMap[id] = newId(prefix);
  };
  const m = (id: Id): Id => idMap[id] ?? id;
  const mk = <V>(rec: Record<Id, V> | undefined): Record<Id, V> | undefined =>
    rec && Object.fromEntries(Object.entries(rec).map(([k, v]) => [m(k), v]));

  for (const e of payload.er?.entities ?? []) define('ent', e.id);
  for (const a of payload.er?.attributes ?? []) define('att', a.id);
  for (const r of payload.er?.relationships ?? []) {
    define('rel', r.id);
    for (const p of r.participants) define('par', p.id);
  }
  for (const r of payload.relational?.relations ?? []) {
    define('rln', r.id);
    r.columns.forEach((c) => define('col', c.id));
    r.uniques.forEach((u) => define('uq', u.id));
    r.indexes.forEach((i) => define('idx', i.id));
    r.checks?.forEach((c) => define('chk', c.id));
  }
  for (const fk of payload.relational?.foreignKeys ?? []) define('fk', fk.id);
  for (const n of payload.nodes) define('nod', n.id);
  for (const e of payload.edges) define('edg', e.id);

  const ref = (r: SemanticRef): SemanticRef => {
    switch (r.kind) {
      case 'participant':
        return { kind: 'participant', relationshipId: m(r.relationshipId), id: m(r.id) };
      case 'column':
      case 'unique':
      case 'index':
        return { kind: r.kind, relationId: m(r.relationId), id: m(r.id) };
      default:
        return { kind: r.kind, id: m(r.id) };
    }
  };
  const edgeRef = (r: EdgeRef): EdgeRef =>
    r.kind === 'participant'
      ? { kind: 'participant', relationshipId: m(r.relationshipId), participantId: m(r.participantId) }
      : r.kind === 'attribute'
        ? { kind: 'attribute', attributeId: m(r.attributeId) }
        : { kind: 'foreignKey', foreignKeyId: m(r.foreignKeyId) };

  const out: ClipboardPayload = {
    format: payload.format,
    version: payload.version,
    diagramType: payload.diagramType,
    modelKind: payload.modelKind,
    sourceModelId: payload.sourceModelId,
    nodes: payload.nodes.map((n) => {
      const { locked: _locked, ...rest } = n;
      return { ...rest, id: m(n.id), ref: ref(n.ref), columnWidths: mk(n.columnWidths) };
    }),
    edges: payload.edges.map((e) => ({
      ...e,
      id: m(e.id),
      ref: edgeRef(e.ref),
      route: { ...e.route, branchAnchors: mk(e.route.branchAnchors) },
    })),
  };
  if (payload.er) {
    out.er = {
      entities: payload.er.entities.map((e) => ({ ...e, id: m(e.id), associativeOf: e.associativeOf && m(e.associativeOf) })),
      attributes: payload.er.attributes.map((a) => ({
        ...a,
        id: m(a.id),
        owner: { kind: a.owner.kind, id: m(a.owner.id) },
        derivedFrom: a.derivedFrom?.map(m),
      })),
      relationships: payload.er.relationships.map((r) => ({
        ...r,
        id: m(r.id),
        participants: r.participants.map((p) => ({ ...p, id: m(p.id), entityId: m(p.entityId) })),
        keyParticipantIds: r.keyParticipantIds?.map(m),
      })),
    };
  }
  if (payload.relational) {
    out.relational = {
      relations: payload.relational.relations.map((r) => {
        const { origin: _o, ...rel } = r;
        return {
          ...rel,
          id: m(r.id),
          columns: r.columns.map((c) => {
            const { origin: _co, ...col } = c;
            return { ...col, id: m(c.id) };
          }),
          primaryKey: r.primaryKey.map(m),
          uniques: r.uniques.map((u) => {
            const { origin: _uo, ...uq } = u;
            return { ...uq, id: m(u.id), columnIds: u.columnIds.map(m) };
          }),
          indexes: r.indexes.map((i) => ({
            ...i,
            id: m(i.id),
            columnIds: i.columnIds.map(m),
            descendingColumnIds: i.descendingColumnIds?.map(m),
          })),
          checks: r.checks?.map((c) => ({ ...c, id: m(c.id), columnIds: c.columnIds?.map(m) })),
        };
      }),
      foreignKeys: payload.relational.foreignKeys.map((fk) => {
        const { origin: _fo, ...rest } = fk;
        return {
          ...rest,
          id: m(fk.id),
          sourceRelationId: m(fk.sourceRelationId),
          targetRelationId: m(fk.targetRelationId),
          columns: fk.columns.map((p) => ({ sourceColumnId: m(p.sourceColumnId), targetColumnId: m(p.targetColumnId) })),
        };
      }),
    };
  }
  return { payload: jsonClone(out), idMap };
}

// ----- paste -------------------------------------------------------------------------------------------------------

/** Suffix `_2`, `_3`, … until `name` is free in `taken` (which is extended). */
function freeName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let i = 2; taken.has(sqlNameKey(candidate)); i++) candidate = `${name}_${i}`;
  taken.add(sqlNameKey(candidate));
  return candidate;
}

function pasteEr(draft: Project, model: ErModel, p: ClipboardPayload, sameModel: boolean): Set<Id> {
  const er = p.er ?? { entities: [], attributes: [], relationships: [] };
  const fresh = new Set<Id>([...er.entities, ...er.attributes, ...er.relationships].map((x) => x.id));
  const entityOk = (id: Id): boolean => fresh.has(id) || (sameModel && !!model.entities[id]);

  const inserted = new Set<Id>();
  for (const e of er.entities) {
    const entity = e;
    // R may be pointed at by only one entity: an outside R survives only if nobody points at it any more (cut/paste).
    if (entity.associativeOf && !fresh.has(entity.associativeOf)) {
      const rid = entity.associativeOf;
      if (!(sameModel && model.relationships[rid] && !associativeEntityOf(model, rid))) delete entity.associativeOf;
    }
    model.entities[entity.id] = entity;
    inserted.add(entity.id);
  }
  const droppedRels = new Set<Id>();
  for (const r of er.relationships) {
    r.participants = r.participants.filter((x) => entityOk(x.entityId));
    if (r.keyParticipantIds) {
      r.keyParticipantIds = r.keyParticipantIds.filter((id) => r.participants.some((x) => x.id === id));
      if (r.keyParticipantIds.length === 0) delete r.keyParticipantIds;
    }
    if (r.participants.length === 0) {
      droppedRels.add(r.id);
      continue;
    }
    model.relationships[r.id] = r;
    inserted.add(r.id);
  }
  for (const e of er.entities) {
    if (e.associativeOf && !model.relationships[e.associativeOf]) delete model.entities[e.id]!.associativeOf;
  }
  // Attributes: keep those whose owner chain resolves (inside the payload, or an existing owner of the same model).
  const pending = [...er.attributes];
  const ownerOk = (a: ErAttribute): boolean => {
    if (fresh.has(a.owner.id)) return inserted.has(a.owner.id) || !!model.attributes[a.owner.id];
    if (!sameModel) return false;
    return a.owner.kind === 'entity' ? !!model.entities[a.owner.id] : a.owner.kind === 'relationship' ? !!model.relationships[a.owner.id] : !!model.attributes[a.owner.id];
  };
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (const a of [...pending]) {
      if (!ownerOk(a)) continue;
      pending.splice(pending.indexOf(a), 1);
      if (!fresh.has(a.owner.id)) {
        // attached to an existing owner: go last among its siblings
        a.order = attributesOf(model, a.owner).reduce((mx, s) => Math.max(mx, s.order), -1) + 1;
      }
      model.attributes[a.id] = a;
      inserted.add(a.id);
      progressed = true;
    }
  }
  for (const a of er.attributes) {
    if (!inserted.has(a.id) || !a.derivedFrom) continue;
    const from = a.derivedFrom.filter((id) => (fresh.has(id) ? inserted.has(id) : sameModel && !!model.attributes[id]));
    if (from.length) a.derivedFrom = from;
    else delete a.derivedFrom;
  }
  return inserted;
}

function pastePayloadRelational(model: RelationalModel, p: ClipboardPayload): Set<Id> {
  const rel = p.relational ?? { relations: [], foreignKeys: [] };
  const relationNames = new Set(Object.values(model.relations).map(relationNameKey));
  const constraintNames = new Set<string>();
  for (const r of Object.values(model.relations)) {
    for (const u of r.uniques) if (u.name) constraintNames.add(sqlNameKey(u.name));
    for (const i of r.indexes) constraintNames.add(sqlNameKey(i.name));
    if (r.primaryKeyName) constraintNames.add(sqlNameKey(r.primaryKeyName));
  }
  for (const fk of Object.values(model.foreignKeys)) if (fk.name) constraintNames.add(sqlNameKey(fk.name));
  const inserted = new Set<Id>();
  for (const r of rel.relations) {
    // relation identity is schema-qualified; suffix only the NAME until the pair is free
    const schema = sqlNameKey(r.schemaName ?? '');
    const free = new Set([...relationNames].filter((k) => k.startsWith(`${schema}.`)).map((k) => k.slice(schema.length + 1)));
    r.name = freeName(r.name, free);
    relationNames.add(`${schema}.${sqlNameKey(r.name)}`);
    for (const u of r.uniques) if (u.name) u.name = freeName(u.name, constraintNames);
    for (const i of r.indexes) i.name = freeName(i.name, constraintNames);
    if (r.primaryKeyName) r.primaryKeyName = freeName(r.primaryKeyName, constraintNames);
    model.relations[r.id] = r;
    inserted.add(r.id);
  }
  for (const fk of rel.foreignKeys) {
    if (!model.relations[fk.sourceRelationId] || !model.relations[fk.targetRelationId]) continue;
    if (fk.name) fk.name = freeName(fk.name, constraintNames);
    model.foreignKeys[fk.id] = fk;
    inserted.add(fk.id);
  }
  return inserted;
}

/**
 * Paste `payload` into `diagramId`, shifted by `offset`. Pasted nodes go on top (explicit zIndex). Elements without a
 * payload node (e.g. attributes that were not drawn in the source) get provisional nodes from sync when the diagram is
 * complete. Returns the new node ids IN THE TARGET DIAGRAM and `idMap` (old -> new; includes ids that were dropped).
 */
export function pasteClipboard(
  draft: Project,
  diagramId: Id,
  payload: ClipboardPayload,
  offset: Point = { x: 0, y: 0 },
): { nodeIds: Id[]; idMap: Record<Id, Id> } {
  const diagram = requireDiagram(draft, diagramId);
  const model = draft.models[diagram.modelId];
  if (!model) throw new OpError('not-found', `Model ${diagram.modelId} does not exist`);
  if (payload.format !== 'schemacanvas-clipboard') throw new OpError('invalid', 'Not a SchemaCanvas clipboard payload');
  if (model.kind !== payload.modelKind) {
    throw new OpError('paste-kind-mismatch', `Cannot paste ${payload.modelKind} elements into a ${model.kind} diagram`);
  }
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new OpError('invalid', 'Paste offset must be finite');
  const { payload: p, idMap } = remapIds(payload);
  const sameModel = payload.sourceModelId === model.id;
  const before = snapshotNodes(draft, model.id);

  const inserted = model.kind === 'er' ? pasteEr(draft, model, p, sameModel) : pastePayloadRelational(model, p);

  let z = Object.values(diagram.nodes).reduce((mx, n) => Math.max(mx, n.zIndex ?? 0), 0);
  for (const n of p.nodes) {
    if (!inserted.has(n.ref.id) || !refResolves(model, n.ref)) continue;
    diagram.nodes[n.id] = { ...n, x: n.x + offset.x, y: n.y + offset.y, zIndex: ++z };
  }
  for (const e of p.edges) {
    if (edgeEndpointRefs(model, e.ref) && !Object.values(diagram.edges).some((x) => edgeRefKey(x.ref) === edgeRefKey(e.ref))) {
      // Waypoints are absolute world coordinates, so they move with the pasted nodes (anchors/labelOffsets are relative).
      if (e.route?.waypoints?.length) {
        e.route.waypoints = e.route.waypoints.map((w) => ({ x: w.x + offset.x, y: w.y + offset.y }));
      }
      diagram.edges[e.id] = e;
    }
  }
  syncDiagramEdges(model, diagram); // prune pasted edges whose endpoint nodes did not make it, add missing defaults
  commitSync(draft, model.id);
  const nodeIds = addedNodes(draft, model.id, before)[diagramId] ?? [];
  return { nodeIds, idMap };
}

/** Copy + paste in one step (Ctrl+D). Works on drafts. */
export function duplicateNodes(
  draft: Project,
  diagramId: Id,
  nodeIds: Id[],
  offset: Point = { x: 40, y: 40 },
): { nodeIds: Id[]; idMap: Record<Id, Id> } {
  return pasteClipboard(draft, diagramId, extractClipboard(draft, diagramId, nodeIds), offset);
}

