/**
 * Project invariants. IMPLEMENTATION OWNED by the model-ops worker (this file ships as a typed stub); the
 * classification below is NORMATIVE for every module.
 *
 * HARD — ops never produce them; the file loader rejects `structural` ones and silently repairs `presentation` ones:
 *   - record key === element.id at every level; ids unique project-wide (incl. participant/column/unique/index ids)
 *   - diagramOrder is a permutation of keys(diagrams); diagram.modelId exists and its kind matches the diagram type;
 *     the option block for the diagram type is present
 *   - node.ref kind is allowed for the diagram type AND resolves inside diagram.modelId; ≤1 node per refKey and ≤1
 *     edge per edgeRefKey per diagram; every edge ref resolves and both endpoints have nodes
 *   - columnWidths keys ⊆ the relation's columns; attribute owner is in the same model and the owner chain is acyclic
 *   - PK/unique/index columnIds belong to their own relation with no duplicates; FK source/target relations exist
 *
 * SOFT — representable on purpose (validation reports them; scene, SQL, conversion and layout MUST tolerate them without
 * throwing; SQL export refuses with an Issue): an FK pair whose column is missing or belongs to another relation; an FK
 * with 0 pairs; an FK target that is not a PK/UNIQUE or is an incomplete composite; a relation without PK; a nullable PK
 * column; a relationship with < 2 participants or a missing participant entity; keyParticipantIds not among the
 * participants; associativeOf missing; a weak entity without identifying owner or partial key.
 *
 * HISTORICAL — may dangle, never validated, always null-checked: Origin.sources, ConversionRecord.*, RelationalModel.derivedFrom.
 *
 * The file loader validates STRUCTURE only (format tag, versions, required fields/types, plain JSON); it never rejects or
 * "repairs" SEMANTIC problems — those load as-is (the spec forbids silently discarding user data).
 */
import { defaultDiagramOptions, modelKindForDiagramType } from './defaults';
import { createNodeResolver, edgeEndpointRefs, refResolves } from './diagramSync';
import { edgeRefKey, refKey } from './queries';
import type { Diagram, DiagramType, ErModel, Id, Model, Project, RelationalModel, Relation } from './types';

export interface InvariantViolation {
  code: string;
  /** JSON-path-ish location, e.g. `diagrams.dgm_1.nodes.nod_2.ref`. */
  path: string;
  message: string;
  class: 'structural' | 'presentation';
}

/** Which `DiagramOptions` block each diagram type requires. */
export const OPTION_BLOCK: Record<DiagramType, 'chen' | 'relational' | 'crowsFoot' | 'physical'> = {
  chen: 'chen',
  'relational-schema': 'relational',
  'crows-foot': 'crowsFoot',
  physical: 'physical',
};

/** Node `ref.kind`s a diagram type may contain (chen -> ER elements, every other type -> relations). */
export function nodeKindsFor(type: DiagramType): readonly string[] {
  return type === 'chen' ? ['entity', 'attribute', 'relationship'] : ['relation'];
}

/**
 * Visit every id in the project with its location: models and their nested elements (participants, columns, uniques,
 * indexes, checks), diagrams with nodes/edges, and conversion records. Used for the project-wide uniqueness check and by
 * ops to refuse caller-supplied ids that are already taken.
 */
export function forEachId(project: Project, visit: (id: Id, path: string) => void): void {
  for (const model of Object.values(project.models)) {
    const base = `models.${model.id}`;
    visit(model.id, base);
    if (model.kind === 'er') {
      for (const e of Object.values(model.entities)) visit(e.id, `${base}.entities.${e.id}`);
      for (const a of Object.values(model.attributes)) visit(a.id, `${base}.attributes.${a.id}`);
      for (const r of Object.values(model.relationships)) {
        visit(r.id, `${base}.relationships.${r.id}`);
        for (const p of r.participants) visit(p.id, `${base}.relationships.${r.id}.participants.${p.id}`);
      }
    } else {
      for (const r of Object.values(model.relations)) {
        const rp = `${base}.relations.${r.id}`;
        visit(r.id, rp);
        for (const c of r.columns) visit(c.id, `${rp}.columns.${c.id}`);
        for (const u of r.uniques) visit(u.id, `${rp}.uniques.${u.id}`);
        for (const i of r.indexes) visit(i.id, `${rp}.indexes.${i.id}`);
        for (const c of r.checks ?? []) visit(c.id, `${rp}.checks.${c.id}`);
      }
      for (const fk of Object.values(model.foreignKeys)) visit(fk.id, `${base}.foreignKeys.${fk.id}`);
    }
  }
  for (const d of Object.values(project.diagrams)) {
    visit(d.id, `diagrams.${d.id}`);
    for (const n of Object.values(d.nodes)) visit(n.id, `diagrams.${d.id}.nodes.${n.id}`);
    for (const e of Object.values(d.edges)) visit(e.id, `diagrams.${d.id}.edges.${e.id}`);
  }
  for (const c of Object.values(project.conversions)) visit(c.id, `conversions.${c.id}`);
}

/** A diagram whose model exists with the right kind: the only diagrams whose nodes/edges can be judged. */
function judgeable(project: Project, d: Diagram): Model | undefined {
  const model = project.models[d.modelId];
  return model && model.kind === modelKindForDiagramType(d.type) ? model : undefined;
}

/** Why a node should not exist, or undefined if it is fine. */
function nodeProblem(model: Model, d: Diagram, ref: Diagram['nodes'][string]['ref']): 'kind' | 'dangling' | undefined {
  if (!nodeKindsFor(d.type).includes(ref.kind)) return 'kind';
  return refResolves(model, ref) ? undefined : 'dangling';
}

/** All HARD-invariant violations (empty = consistent). Ops tests assert `checkInvariants(p)` is `[]` after every op. */
export function checkInvariants(project: Project): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const add = (code: string, path: string, message: string, cls: InvariantViolation['class']): void => {
    out.push({ code, path, message, class: cls });
  };

  // --- record keys === element ids; project-wide uniqueness ---------------------------------------------------------
  const keyCheck = (rec: Record<string, { id: Id }>, base: string): void => {
    for (const [key, v] of Object.entries(rec)) {
      if (v.id !== key) add('key-id-mismatch', `${base}.${key}`, `Record key "${key}" differs from element id "${v.id}"`, 'structural');
    }
  };
  keyCheck(project.models, 'models');
  keyCheck(project.diagrams, 'diagrams');
  keyCheck(project.conversions, 'conversions');
  for (const m of Object.values(project.models)) {
    if (m.kind === 'er') {
      keyCheck(m.entities, `models.${m.id}.entities`);
      keyCheck(m.attributes, `models.${m.id}.attributes`);
      keyCheck(m.relationships, `models.${m.id}.relationships`);
    } else {
      keyCheck(m.relations, `models.${m.id}.relations`);
      keyCheck(m.foreignKeys, `models.${m.id}.foreignKeys`);
    }
  }
  for (const d of Object.values(project.diagrams)) {
    keyCheck(d.nodes, `diagrams.${d.id}.nodes`);
    keyCheck(d.edges, `diagrams.${d.id}.edges`);
  }
  const seen = new Map<Id, string>();
  forEachId(project, (id, path) => {
    const first = seen.get(id);
    if (first !== undefined) add('duplicate-id', path, `Id "${id}" is already used at ${first}`, 'structural');
    else seen.set(id, path);
  });

  // --- diagrams -----------------------------------------------------------------------------------------------------
  const diagramIds = Object.keys(project.diagrams);
  const orderSeen = new Set<Id>();
  let orderOk = project.diagramOrder.length === diagramIds.length;
  for (const id of project.diagramOrder) {
    if (orderSeen.has(id) || !project.diagrams[id]) orderOk = false;
    orderSeen.add(id);
  }
  if (!orderOk) add('diagram-order', 'diagramOrder', 'diagramOrder is not a permutation of the diagram ids', 'presentation');

  for (const d of Object.values(project.diagrams)) {
    const dp = `diagrams.${d.id}`;
    const block = OPTION_BLOCK[d.type];
    if (!d.options || !d.options.grid || !d.options.typography || !d.options[block]) {
      add('option-block-missing', `${dp}.options`, `Diagram options lack grid/typography/${block}`, 'presentation');
    }
    const model = project.models[d.modelId];
    if (!model) {
      add('diagram-model-missing', `${dp}.modelId`, `Model "${d.modelId}" does not exist`, 'structural');
      continue;
    }
    if (model.kind !== modelKindForDiagramType(d.type)) {
      add('diagram-model-kind', `${dp}.modelId`, `A ${d.type} diagram cannot view a ${model.kind} model`, 'structural');
      continue;
    }
    const nodeKeys = new Set<string>();
    for (const n of Object.values(d.nodes)) {
      const np = `${dp}.nodes.${n.id}`;
      const problem = nodeProblem(model, d, n.ref);
      if (problem === 'kind') add('node-ref-kind', `${np}.ref`, `${n.ref.kind} nodes are not allowed in ${d.type} diagrams`, 'presentation');
      else if (problem === 'dangling') add('node-ref-dangling', `${np}.ref`, `Node ref ${refKey(n.ref)} does not resolve`, 'presentation');
      const k = refKey(n.ref);
      if (nodeKeys.has(k)) add('node-duplicate', np, `More than one node for ${k}`, 'presentation');
      nodeKeys.add(k);
      if (n.columnWidths && model.kind === 'relational') {
        const rel = n.ref.kind === 'relation' ? model.relations[n.ref.id] : undefined;
        for (const colId of Object.keys(n.columnWidths)) {
          if (!rel?.columns.some((c) => c.id === colId)) {
            add('column-widths-orphan', `${np}.columnWidths.${colId}`, `columnWidths key "${colId}" is not a column of the node's relation`, 'presentation');
          }
        }
      }
    }
    const resolve = createNodeResolver(d, model);
    const edgeKeys = new Set<string>();
    for (const e of Object.values(d.edges)) {
      const ep = `${dp}.edges.${e.id}`;
      const ends = edgeEndpointRefs(model, e.ref);
      if (!ends) add('edge-ref-dangling', `${ep}.ref`, `Edge ref ${edgeRefKey(e.ref)} does not resolve`, 'presentation');
      else if (resolve(ends.source) === undefined || resolve(ends.target) === undefined) {
        add('edge-endpoint-missing', ep, `Edge ${edgeRefKey(e.ref)} has an endpoint without a node`, 'presentation');
      }
      const k = edgeRefKey(e.ref);
      if (edgeKeys.has(k)) add('edge-duplicate', ep, `More than one edge for ${k}`, 'presentation');
      edgeKeys.add(k);
    }
  }

  // --- semantic models ----------------------------------------------------------------------------------------------
  for (const m of Object.values(project.models)) {
    if (m.kind === 'er') checkEr(m, add);
    else checkRelational(m, add);
  }
  return out;
}

type AddFn = (code: string, path: string, message: string, cls: InvariantViolation['class']) => void;

function checkEr(m: ErModel, add: AddFn): void {
  const ownerExists = (o: ErModel['attributes'][string]['owner']): boolean =>
    o.kind === 'entity' ? !!m.entities[o.id] : o.kind === 'relationship' ? !!m.relationships[o.id] : !!m.attributes[o.id];
  for (const a of Object.values(m.attributes)) {
    const p = `models.${m.id}.attributes.${a.id}.owner`;
    if (!ownerExists(a.owner)) {
      add('attribute-owner-missing', p, `Owner ${a.owner.kind}:${a.owner.id} is not in the same model`, 'structural');
      continue;
    }
    const chain = new Set<Id>([a.id]);
    let cur = a.owner;
    while (cur.kind === 'attribute') {
      if (chain.has(cur.id)) {
        add('attribute-owner-cycle', p, 'Attribute owner chain is cyclic', 'structural');
        break;
      }
      chain.add(cur.id);
      const next = m.attributes[cur.id];
      if (!next) break; // reported on that attribute itself
      cur = next.owner;
    }
  }
}

function checkColumnList(rel: Relation, ids: Id[], path: string, add: AddFn): void {
  const dup = new Set<Id>();
  for (const id of ids) {
    if (!rel.columns.some((c) => c.id === id)) add('key-column-invalid', path, `Column "${id}" does not belong to relation "${rel.name}"`, 'structural');
    if (dup.has(id)) add('key-column-duplicate', path, `Column "${id}" is listed twice`, 'structural');
    dup.add(id);
  }
}

function checkRelational(m: RelationalModel, add: AddFn): void {
  for (const rel of Object.values(m.relations)) {
    const rp = `models.${m.id}.relations.${rel.id}`;
    checkColumnList(rel, rel.primaryKey, `${rp}.primaryKey`, add);
    for (const u of rel.uniques) checkColumnList(rel, u.columnIds, `${rp}.uniques.${u.id}.columnIds`, add);
    for (const i of rel.indexes) checkColumnList(rel, i.columnIds, `${rp}.indexes.${i.id}.columnIds`, add);
  }
  for (const fk of Object.values(m.foreignKeys)) {
    const p = `models.${m.id}.foreignKeys.${fk.id}`;
    if (!m.relations[fk.sourceRelationId]) add('fk-relation-missing', `${p}.sourceRelationId`, `Source relation "${fk.sourceRelationId}" does not exist`, 'structural');
    if (!m.relations[fk.targetRelationId]) add('fk-relation-missing', `${p}.targetRelationId`, `Target relation "${fk.targetRelationId}" does not exist`, 'structural');
  }
}

/**
 * Fix `presentation` violations in place (dangling nodes/edges, missing option blocks, order drift, columnWidths keys,
 * duplicates by ref key); returns a log. Idempotent. NEVER touches `project.models`, `conversions` or any structural
 * problem, and never ADDS nodes or edges (that is `syncDiagram`'s job, not a repair).
 */
export function repairPresentation(project: Project): string[] {
  const log: string[] = [];
  for (const d of Object.values(project.diagrams)) {
    const dp = `diagrams.${d.id}`;
    const defaults = defaultDiagramOptions(d.type);
    const block = OPTION_BLOCK[d.type];
    if (!d.options) {
      d.options = defaults;
      log.push(`${dp}.options: restored defaults`);
    } else {
      for (const key of ['grid', 'typography', block] as const) {
        if (!d.options[key]) {
          (d.options as unknown as Record<string, unknown>)[key] = defaults[key];
          log.push(`${dp}.options.${key}: restored defaults`);
        }
      }
    }
    const model = judgeable(project, d);
    if (!model) continue;

    const nodeKeys = new Set<string>();
    for (const [id, n] of Object.entries(d.nodes)) {
      const problem = nodeProblem(model, d, n.ref);
      const k = refKey(n.ref);
      if (problem || nodeKeys.has(k)) {
        delete d.nodes[id];
        log.push(`${dp}.nodes.${id}: removed (${problem ?? 'duplicate'})`);
        continue;
      }
      nodeKeys.add(k);
      if (n.columnWidths && model.kind === 'relational') {
        const rel = n.ref.kind === 'relation' ? model.relations[n.ref.id] : undefined;
        for (const colId of Object.keys(n.columnWidths)) {
          if (!rel?.columns.some((c) => c.id === colId)) {
            delete n.columnWidths[colId];
            log.push(`${dp}.nodes.${id}.columnWidths.${colId}: removed`);
          }
        }
        if (Object.keys(n.columnWidths).length === 0) delete n.columnWidths;
      }
    }
    const resolve = createNodeResolver(d, model);
    const edgeKeys = new Set<string>();
    for (const [id, e] of Object.entries(d.edges)) {
      const ends = edgeEndpointRefs(model, e.ref);
      const k = edgeRefKey(e.ref);
      const bad =
        !ends || resolve(ends.source) === undefined || resolve(ends.target) === undefined
          ? 'dangling'
          : edgeKeys.has(k)
            ? 'duplicate'
            : undefined;
      if (bad) {
        delete d.edges[id];
        log.push(`${dp}.edges.${id}: removed (${bad})`);
      } else edgeKeys.add(k);
    }
  }
  const ids = Object.keys(project.diagrams);
  const order: Id[] = [];
  for (const id of project.diagramOrder) if (project.diagrams[id] && !order.includes(id)) order.push(id);
  for (const id of ids) if (!order.includes(id)) order.push(id);
  if (order.length !== project.diagramOrder.length || order.some((id, i) => id !== project.diagramOrder[i])) {
    project.diagramOrder = order;
    log.push('diagramOrder: rebuilt');
  }
  return log;
}
