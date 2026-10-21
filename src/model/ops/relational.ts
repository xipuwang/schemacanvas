/**
 * Relational ops. Cascades follow ARCHITECTURE 5a: deleting a column prunes PK/unique/index/check/FK pairs and
 * `columnWidths`; deleting a relation deletes every FK touching it. A composite FK is ONE ForeignKey with ordered pairs.
 */
import { newId } from '../ids';
import { relationNameKey, sqlNameKey } from '../queries';
import type {
  CheckConstraint,
  FkCardinality,
  ForeignKey,
  ForeignKeyColumnPair,
  Id,
  Origin,
  Project,
  ReferentialAction,
  RelColumn,
  RelIndex,
  Relation,
  RelationalModel,
  UniqueConstraint,
} from '../types';
import {
  OpError,
  type OpResult,
  type PlaceAt,
  applyOptional,
  assertIdsFree,
  checkPlace,
  commitSync,
  finishOp,
  requireRelational,
  snapshotNodes,
  uniqueName,
} from './common';

// ----- helpers -----------------------------------------------------------------------------------------------------

function requireRelation(m: RelationalModel, id: Id): Relation {
  const r = m.relations[id];
  if (!r) throw new OpError('not-found', `Relation ${id} does not exist`);
  return r;
}

function requireColumn(rel: Relation, id: Id): RelColumn {
  const c = rel.columns.find((x) => x.id === id);
  if (!c) throw new OpError('not-found', `Column ${id} is not in relation ${rel.name}`);
  return c;
}

/** Non-empty-or-empty list of column ids that all belong to `rel`, without duplicates. */
function checkColumns(rel: Relation, ids: Id[], what: string): void {
  if (new Set(ids).size !== ids.length) throw new OpError('invalid', `${what} lists a column twice`);
  for (const id of ids) requireColumn(rel, id);
}

const colRef = (relationId: Id, id: Id) => ({ kind: 'column', relationId, id }) as const;

// ----- relations ---------------------------------------------------------------------------------------------------

export interface ColumnInit {
  id?: Id;
  name?: string;
  dataType?: string;
  nullable?: boolean;
  defaultValue?: string;
  autoIncrement?: boolean;
  description?: string;
  origin?: Origin;
}

function makeColumn(init: ColumnInit, name: string): RelColumn {
  const c: RelColumn = { id: init.id ?? newId('col'), name, nullable: init.nullable ?? true };
  if (init.dataType) c.dataType = init.dataType;
  if (init.defaultValue !== undefined) c.defaultValue = init.defaultValue;
  if (init.autoIncrement) c.autoIncrement = true;
  if (init.description) c.description = init.description;
  if (init.origin) c.origin = init.origin;
  return c;
}

export interface RelationInit {
  id?: Id;
  name?: string;
  schemaName?: string;
  description?: string;
  /** `pk: true` columns form the primary key in the order given (and become NOT NULL). */
  columns?: Array<ColumnInit & { pk?: boolean }>;
}

export function addRelation(draft: Project, modelId: Id, init: RelationInit = {}, place?: PlaceAt): OpResult {
  const m = requireRelational(draft, modelId);
  checkPlace(draft, modelId, place);
  assertIdsFree(draft, [init.id, ...(init.columns ?? []).map((c) => c.id)]);
  const before = snapshotNodes(draft, modelId);
  const id = init.id ?? newId('rln');
  const name =
    init.name ??
    (() => {
      const taken = new Set(Object.values(m.relations).map(relationNameKey));
      for (let i = 1; ; i++) {
        const candidate = i === 1 ? 'Table' : `Table_${i}`;
        if (!taken.has(`${sqlNameKey(init.schemaName ?? '')}.${sqlNameKey(candidate)}`)) return candidate;
      }
    })();
  const rel: Relation = { id, name, columns: [], primaryKey: [], uniques: [], indexes: [] };
  if (init.schemaName) rel.schemaName = init.schemaName;
  if (init.description) rel.description = init.description;
  for (const spec of init.columns ?? []) {
    const col = makeColumn(spec, spec.name ?? uniqueName('column', rel.columns.map((c) => c.name)));
    if (spec.pk) {
      col.nullable = false;
      rel.primaryKey.push(col.id);
    }
    rel.columns.push(col);
  }
  m.relations[id] = rel;
  return finishOp(draft, modelId, before, [{ kind: 'relation', id }], place);
}

export function updateRelation(
  draft: Project,
  modelId: Id,
  relationId: Id,
  patch: { name?: string; schemaName?: string | undefined; description?: string | undefined; primaryKeyName?: string | undefined },
): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (patch.name !== undefined) rel.name = patch.name;
  applyOptional(rel, patch, ['schemaName', 'description', 'primaryKeyName']);
  commitSync(draft, modelId);
}

/** Cascade: every FK whose source or target it is. Diagram node/edges disappear through sync. */
export function removeRelation(draft: Project, modelId: Id, relationId: Id): void {
  const m = requireRelational(draft, modelId);
  requireRelation(m, relationId);
  for (const fk of Object.values(m.foreignKeys)) {
    if (fk.sourceRelationId === relationId || fk.targetRelationId === relationId) delete m.foreignKeys[fk.id];
  }
  delete m.relations[relationId];
  commitSync(draft, modelId);
}

// ----- columns -----------------------------------------------------------------------------------------------------

export function addColumn(
  draft: Project,
  modelId: Id,
  relationId: Id,
  init: ColumnInit = {},
  opts: { index?: number } = {},
): OpResult {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const col = makeColumn(init, init.name ?? uniqueName('column', rel.columns.map((c) => c.name)));
  const at = opts.index === undefined ? rel.columns.length : Math.max(0, Math.min(rel.columns.length, Math.trunc(opts.index)));
  rel.columns.splice(at, 0, col);
  return finishOp(draft, modelId, before, [colRef(relationId, col.id)]);
}

export interface ColumnPatch {
  name?: string;
  dataType?: string | undefined;
  /** Ignored (forced false) while the column is part of the primary key. */
  nullable?: boolean;
  defaultValue?: string | undefined;
  autoIncrement?: boolean | undefined;
  description?: string | undefined;
}

export function updateColumn(draft: Project, modelId: Id, relationId: Id, columnId: Id, patch: ColumnPatch): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  const col = requireColumn(rel, columnId);
  if (patch.name !== undefined) col.name = patch.name;
  if (patch.nullable !== undefined) col.nullable = rel.primaryKey.includes(columnId) ? false : patch.nullable;
  applyOptional(col, patch, ['dataType', 'defaultValue', 'autoIncrement', 'description']);
  if (col.autoIncrement === false) delete col.autoIncrement;
  commitSync(draft, modelId);
}

export function reorderColumn(draft: Project, modelId: Id, relationId: Id, columnId: Id, toIndex: number): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  const from = rel.columns.findIndex((c) => c.id === columnId);
  if (from < 0) throw new OpError('not-found', `Column ${columnId} is not in relation ${rel.name}`);
  const [col] = rel.columns.splice(from, 1);
  rel.columns.splice(Math.max(0, Math.min(rel.columns.length, Math.trunc(toIndex))), 0, col!);
  commitSync(draft, modelId);
}

/** Remove `columnId` from every structure of the model (see cascade table). */
function scrubColumn(m: RelationalModel, rel: Relation, columnId: Id): void {
  rel.primaryKey = rel.primaryKey.filter((id) => id !== columnId);
  for (const u of rel.uniques) u.columnIds = u.columnIds.filter((id) => id !== columnId);
  rel.uniques = rel.uniques.filter((u) => u.columnIds.length > 0);
  for (const i of rel.indexes) {
    i.columnIds = i.columnIds.filter((id) => id !== columnId);
    if (i.descendingColumnIds) {
      i.descendingColumnIds = i.descendingColumnIds.filter((id) => id !== columnId);
      if (i.descendingColumnIds.length === 0) delete i.descendingColumnIds;
    }
  }
  rel.indexes = rel.indexes.filter((i) => i.columnIds.length > 0);
  // A check that mentions the column cannot stay valid without it.
  if (rel.checks) {
    rel.checks = rel.checks.filter((c) => !c.columnIds?.includes(columnId));
    if (rel.checks.length === 0) delete rel.checks;
  }
  for (const fk of Object.values(m.foreignKeys)) {
    const kept = fk.columns.filter((p) => p.sourceColumnId !== columnId && p.targetColumnId !== columnId);
    if (kept.length === fk.columns.length) continue;
    // A partially-dropped composite FK stays (validation reports it); only an FK with 0 pairs left disappears.
    if (kept.length === 0) delete m.foreignKeys[fk.id];
    else fk.columns = kept;
  }
}

export function removeColumn(draft: Project, modelId: Id, relationId: Id, columnId: Id): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  requireColumn(rel, columnId);
  rel.columns = rel.columns.filter((c) => c.id !== columnId);
  scrubColumn(m, rel, columnId);
  for (const d of Object.values(draft.diagrams)) {
    if (d.modelId !== modelId) continue;
    for (const n of Object.values(d.nodes)) if (n.columnWidths) delete n.columnWidths[columnId];
  }
  commitSync(draft, modelId); // also drops empty columnWidths and stale branchAnchors
}

// ----- keys --------------------------------------------------------------------------------------------------------

/** Ordered primary key; its columns become NOT NULL (removing a column from the PK leaves `nullable` as it is). */
export function setPrimaryKey(draft: Project, modelId: Id, relationId: Id, columnIds: Id[]): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  checkColumns(rel, columnIds, 'Primary key');
  rel.primaryKey = [...columnIds];
  for (const id of columnIds) requireColumn(rel, id).nullable = false;
  commitSync(draft, modelId);
}

/** Toggle the single-column UNIQUE constraint of a column (multi-column uniques are untouched). */
export function setColumnUnique(draft: Project, modelId: Id, relationId: Id, columnId: Id, unique: boolean): OpResult {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  requireColumn(rel, columnId);
  const single = rel.uniques.filter((u) => u.columnIds.length === 1 && u.columnIds[0] === columnId);
  const refs: OpResult['refs'] = [];
  if (unique && single.length === 0) {
    const u: UniqueConstraint = { id: newId('uq'), columnIds: [columnId] };
    rel.uniques.push(u);
    refs.push({ kind: 'unique', relationId, id: u.id });
  } else if (!unique) {
    rel.uniques = rel.uniques.filter((u) => !single.some((s) => s.id === u.id));
  }
  commitSync(draft, modelId);
  return { refs, nodeIds: {} };
}

export function addUnique(
  draft: Project,
  modelId: Id,
  relationId: Id,
  init: { id?: Id; name?: string; columnIds: Id[] },
): OpResult {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (init.columnIds.length === 0) throw new OpError('invalid', 'A unique constraint needs at least one column');
  checkColumns(rel, init.columnIds, 'Unique constraint');
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const u: UniqueConstraint = { id: init.id ?? newId('uq'), columnIds: [...init.columnIds] };
  if (init.name) u.name = init.name;
  rel.uniques.push(u);
  return finishOp(draft, modelId, before, [{ kind: 'unique', relationId, id: u.id }]);
}

export function updateUnique(
  draft: Project,
  modelId: Id,
  relationId: Id,
  uniqueId: Id,
  patch: { name?: string | undefined; columnIds?: Id[] },
): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  const u = rel.uniques.find((x) => x.id === uniqueId);
  if (!u) throw new OpError('not-found', `Unique ${uniqueId} is not in relation ${rel.name}`);
  if (patch.columnIds) {
    if (patch.columnIds.length === 0) throw new OpError('invalid', 'A unique constraint needs at least one column');
    checkColumns(rel, patch.columnIds, 'Unique constraint');
    u.columnIds = [...patch.columnIds];
  }
  applyOptional(u, patch, ['name']);
  commitSync(draft, modelId);
}

export function removeUnique(draft: Project, modelId: Id, relationId: Id, uniqueId: Id): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (!rel.uniques.some((u) => u.id === uniqueId)) throw new OpError('not-found', `Unique ${uniqueId} is not in relation ${rel.name}`);
  rel.uniques = rel.uniques.filter((u) => u.id !== uniqueId);
  commitSync(draft, modelId);
}

export interface IndexInit {
  id?: Id;
  name?: string;
  columnIds: Id[];
  unique?: boolean;
  where?: string;
  method?: string;
  descendingColumnIds?: Id[];
}

export function addIndex(draft: Project, modelId: Id, relationId: Id, init: IndexInit): OpResult {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (init.columnIds.length === 0) throw new OpError('invalid', 'An index needs at least one column');
  checkColumns(rel, init.columnIds, 'Index');
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const colNames = init.columnIds.map((id) => requireColumn(rel, id).name);
  const idx: RelIndex = {
    id: init.id ?? newId('idx'),
    name: init.name ?? uniqueName(`${rel.name}_${colNames.join('_')}_idx`, rel.indexes.map((i) => i.name)),
    columnIds: [...init.columnIds],
    unique: init.unique ?? false,
  };
  if (init.where) idx.where = init.where;
  if (init.method) idx.method = init.method;
  const desc = (init.descendingColumnIds ?? []).filter((id) => init.columnIds.includes(id));
  if (desc.length) idx.descendingColumnIds = desc;
  rel.indexes.push(idx);
  return finishOp(draft, modelId, before, [{ kind: 'index', relationId, id: idx.id }]);
}

export function updateIndex(
  draft: Project,
  modelId: Id,
  relationId: Id,
  indexId: Id,
  patch: {
    name?: string;
    columnIds?: Id[];
    unique?: boolean;
    where?: string | undefined;
    method?: string | undefined;
    descendingColumnIds?: Id[] | undefined;
  },
): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  const idx = rel.indexes.find((x) => x.id === indexId);
  if (!idx) throw new OpError('not-found', `Index ${indexId} is not in relation ${rel.name}`);
  if (patch.name !== undefined) idx.name = patch.name;
  if (patch.unique !== undefined) idx.unique = patch.unique;
  if (patch.columnIds) {
    if (patch.columnIds.length === 0) throw new OpError('invalid', 'An index needs at least one column');
    checkColumns(rel, patch.columnIds, 'Index');
    idx.columnIds = [...patch.columnIds];
  }
  applyOptional(idx, patch, ['where', 'method']);
  if ('descendingColumnIds' in patch || patch.columnIds) {
    const src = 'descendingColumnIds' in patch ? patch.descendingColumnIds ?? [] : idx.descendingColumnIds ?? [];
    const desc = src.filter((id) => idx.columnIds.includes(id));
    if (desc.length) idx.descendingColumnIds = desc;
    else delete idx.descendingColumnIds;
  }
  commitSync(draft, modelId);
}

export function removeIndex(draft: Project, modelId: Id, relationId: Id, indexId: Id): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (!rel.indexes.some((i) => i.id === indexId)) throw new OpError('not-found', `Index ${indexId} is not in relation ${rel.name}`);
  rel.indexes = rel.indexes.filter((i) => i.id !== indexId);
  commitSync(draft, modelId);
}

export function addCheck(
  draft: Project,
  modelId: Id,
  relationId: Id,
  init: { id?: Id; name?: string; expression: string; columnIds?: Id[] },
): OpResult {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (init.expression.trim() === '') throw new OpError('invalid', 'A check constraint needs an expression');
  if (init.columnIds) checkColumns(rel, init.columnIds, 'Check constraint');
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const c: CheckConstraint = { id: init.id ?? newId('chk'), expression: init.expression };
  if (init.name) c.name = init.name;
  if (init.columnIds?.length) c.columnIds = [...init.columnIds];
  (rel.checks ??= []).push(c);
  // Checks have no SemanticRef kind; the relation is the addressable element.
  return finishOp(draft, modelId, before, [{ kind: 'relation', id: relationId }]);
}

export function removeCheck(draft: Project, modelId: Id, relationId: Id, checkId: Id): void {
  const m = requireRelational(draft, modelId);
  const rel = requireRelation(m, relationId);
  if (!rel.checks?.some((c) => c.id === checkId)) throw new OpError('not-found', `Check ${checkId} is not in relation ${rel.name}`);
  rel.checks = rel.checks.filter((c) => c.id !== checkId);
  if (rel.checks.length === 0) delete rel.checks;
  commitSync(draft, modelId);
}

// ----- foreign keys ------------------------------------------------------------------------------------------------

export interface ForeignKeyInit {
  id?: Id;
  name?: string;
  sourceRelationId: Id;
  targetRelationId: Id;
  /** ONE constraint, ordered pairs (source[i] references target[i]). */
  columns: ForeignKeyColumnPair[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  label?: string;
  cardinality?: FkCardinality;
}

/** Both relations exist, every pair's columns belong to the right relation, no column is used twice per side. */
function validatePairs(m: RelationalModel, sourceId: Id, targetId: Id, pairs: ForeignKeyColumnPair[]): void {
  const source = m.relations[sourceId];
  const target = m.relations[targetId];
  const bad = (msg: string): never => {
    throw new OpError('foreign-key-invalid', msg);
  };
  if (!source) bad(`Source relation ${sourceId} does not exist in the model`);
  if (!target) bad(`Target relation ${targetId} does not exist in the model`);
  if (pairs.length === 0) bad('A foreign key needs at least one column pair');
  for (const p of pairs) {
    if (!source!.columns.some((c) => c.id === p.sourceColumnId)) bad(`Column ${p.sourceColumnId} does not belong to ${source!.name}`);
    if (!target!.columns.some((c) => c.id === p.targetColumnId)) bad(`Column ${p.targetColumnId} does not belong to ${target!.name}`);
  }
  if (new Set(pairs.map((p) => p.sourceColumnId)).size !== pairs.length) bad('A source column appears in two pairs');
  if (new Set(pairs.map((p) => p.targetColumnId)).size !== pairs.length) bad('A target column appears in two pairs');
}

export function addForeignKey(draft: Project, modelId: Id, init: ForeignKeyInit): OpResult {
  const m = requireRelational(draft, modelId);
  validatePairs(m, init.sourceRelationId, init.targetRelationId, init.columns);
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const fk: ForeignKey = {
    id: init.id ?? newId('fk'),
    sourceRelationId: init.sourceRelationId,
    targetRelationId: init.targetRelationId,
    columns: init.columns.map((c) => ({ sourceColumnId: c.sourceColumnId, targetColumnId: c.targetColumnId })),
  };
  if (init.name) fk.name = init.name;
  if (init.onDelete) fk.onDelete = init.onDelete;
  if (init.onUpdate) fk.onUpdate = init.onUpdate;
  if (init.label) fk.label = init.label;
  if (init.cardinality) fk.cardinality = { ...init.cardinality };
  m.foreignKeys[fk.id] = fk;
  return finishOp(draft, modelId, before, [{ kind: 'foreignKey', id: fk.id }]);
}

/** The referencing/referenced RELATIONS never change (that would be a different constraint); pairs, name, label, actions do. */
export function updateForeignKey(
  draft: Project,
  modelId: Id,
  foreignKeyId: Id,
  patch: {
    columns?: ForeignKeyColumnPair[];
    name?: string | undefined;
    label?: string | undefined;
    onDelete?: ReferentialAction | undefined;
    onUpdate?: ReferentialAction | undefined;
    cardinality?: FkCardinality | undefined;
  },
): void {
  const m = requireRelational(draft, modelId);
  const fk = m.foreignKeys[foreignKeyId];
  if (!fk) throw new OpError('not-found', `Foreign key ${foreignKeyId} does not exist`);
  if (patch.columns) {
    validatePairs(m, fk.sourceRelationId, fk.targetRelationId, patch.columns);
    fk.columns = patch.columns.map((c) => ({ sourceColumnId: c.sourceColumnId, targetColumnId: c.targetColumnId }));
  }
  applyOptional(fk, patch, ['name', 'label', 'onDelete', 'onUpdate']);
  if ('cardinality' in patch) {
    if (patch.cardinality && Object.keys(patch.cardinality).length) fk.cardinality = { ...patch.cardinality };
    else delete fk.cardinality;
  }
  commitSync(draft, modelId);
}

export function removeForeignKey(draft: Project, modelId: Id, foreignKeyId: Id): void {
  const m = requireRelational(draft, modelId);
  if (!m.foreignKeys[foreignKeyId]) throw new OpError('not-found', `Foreign key ${foreignKeyId} does not exist`);
  delete m.foreignKeys[foreignKeyId];
  commitSync(draft, modelId);
}

/**
 * Create the referencing columns for an FK to `targetRelationId` (default: its primary key), copying ONLY the target
 * `dataType` (never autoIncrement/default/nullability). Names default to the target column names, falling back to
 * `<TargetRelation>_<col>` and then `_2`… on a collision. Returns the pairs to hand to `addForeignKey`.
 */
export function createFkColumns(
  draft: Project,
  modelId: Id,
  init: {
    sourceRelationId: Id;
    targetRelationId: Id;
    targetColumnIds?: Id[];
    names?: string[];
    nullable?: boolean;
    columnIds?: Id[];
  },
): OpResult & { pairs: ForeignKeyColumnPair[] } {
  const m = requireRelational(draft, modelId);
  const source = requireRelation(m, init.sourceRelationId);
  const target = requireRelation(m, init.targetRelationId);
  const targets = init.targetColumnIds ?? target.primaryKey;
  if (targets.length === 0) throw new OpError('invalid', `Relation ${target.name} has no key to reference`);
  checkColumns(target, targets, 'FK target');
  assertIdsFree(draft, init.columnIds ?? []);
  const before = snapshotNodes(draft, modelId);
  const pairs: ForeignKeyColumnPair[] = [];
  const refs: OpResult['refs'] = [];
  targets.forEach((tid, i) => {
    const tcol = requireColumn(target, tid);
    const taken = source.columns.map((c) => c.name);
    const wanted = init.names?.[i] ?? (taken.some((n) => sqlNameKey(n) === sqlNameKey(tcol.name)) ? `${target.name}_${tcol.name}` : tcol.name);
    const col = makeColumn({ id: init.columnIds?.[i], dataType: tcol.dataType, nullable: init.nullable ?? true }, uniqueName(wanted, taken));
    source.columns.push(col);
    pairs.push({ sourceColumnId: col.id, targetColumnId: tid });
    refs.push(colRef(source.id, col.id));
  });
  return { ...finishOp(draft, modelId, before, refs), pairs };
}
