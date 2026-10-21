/**
 * Pure read helpers over the semantic model. EVERY module derives PK/FK/composite/weak-owner
 * facts through these functions so the whole app agrees on what the model means.
 */
import type {
  Diagram,
  EdgeRef,
  ErAttribute,
  ErAttributeOwner,
  ErEntity,
  ErModel,
  ErParticipant,
  ErRelationship,
  ForeignKey,
  Id,
  Model,
  Project,
  RelColumn,
  Relation,
  RelationalModel,
  SemanticRef,
} from './types';

// ----- own-property lookups --------------------------------------------------

/**
 * `record[id]` that only ever returns an OWN entry. Ids come from files (valid JSON may contain `__proto__`,
 * `constructor`, `toString`), so a plain index would resolve them to prototype members.
 */
export function ownGet<T>(record: Readonly<Record<string, T>> | undefined | null, id: unknown): T | undefined {
  if (!record || typeof id !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
}

/** `value` when it is an array, else an empty one (corrupt files must not make readers throw). */
const arr = <T>(value: readonly T[] | undefined | null): readonly T[] => (Array.isArray(value) ? value : []);

// ----- refs ----------------------------------------------------------------

export function refKey(ref: SemanticRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameRef(a: SemanticRef, b: SemanticRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function edgeRefKey(ref: EdgeRef): string {
  switch (ref.kind) {
    case 'participant':
      return `participant:${ref.participantId}`;
    case 'attribute':
      return `attribute:${ref.attributeId}`;
    case 'foreignKey':
      return `foreignKey:${ref.foreignKeyId}`;
  }
}

// ----- ER model ------------------------------------------------------------

/** Attributes directly owned by `owner`, sorted by `order` (stable). */
export function attributesOf(model: ErModel, owner: ErAttributeOwner | { kind: string; id: Id }): ErAttribute[] {
  return Object.values(model.attributes)
    .filter((a) => a.owner.kind === owner.kind && a.owner.id === owner.id)
    .sort((a, b) => a.order - b.order);
}

export function isCompositeAttribute(model: ErModel, attributeId: Id): boolean {
  return Object.values(model.attributes).some((a) => a.owner.kind === 'attribute' && a.owner.id === attributeId);
}

/**
 * Atomic (leaf) attributes under `attribute`, depth-first; a simple attribute yields itself.
 * By default returns ALL leaves, including derived / multivalued ones — converters must say what they want:
 *  - `skipDerived`: drop derived leaves;  - `stopAtMultivalued`: a multivalued sub-attribute is returned as one
 *    unit (not descended into). Cycle-safe (corrupt files cannot overflow the stack).
 */
export function leafAttributes(
  model: ErModel,
  attribute: ErAttribute,
  opts: { skipDerived?: boolean; stopAtMultivalued?: boolean } = {},
  seen: Set<Id> = new Set(),
): ErAttribute[] {
  if (seen.has(attribute.id)) return [];
  seen.add(attribute.id);
  const children = attributesOf(model, { kind: 'attribute', id: attribute.id });
  if (children.length === 0 || (opts.stopAtMultivalued && attribute.multivalued)) {
    return opts.skipDerived && attribute.derived ? [] : [attribute];
  }
  return children.flatMap((c) => leafAttributes(model, c, opts, seen));
}

/** The entity/relationship an attribute ultimately belongs to (walks up composite parents). */
export function rootOwner(model: ErModel, attribute: ErAttribute): { kind: 'entity' | 'relationship'; id: Id } | undefined {
  let current: ErAttribute | undefined = attribute;
  const seen = new Set<Id>();
  while (current) {
    if (seen.has(current.id)) return undefined; // cycle guard
    seen.add(current.id);
    if (current.owner.kind === 'entity' || current.owner.kind === 'relationship') {
      return { kind: current.owner.kind, id: current.owner.id };
    }
    current = ownGet(model.attributes, current.owner.id);
  }
  return undefined;
}

/** Relationships (with the matching participants) an entity takes part in. Recursive => 2 entries. */
export function participationsOfEntity(
  model: ErModel,
  entityId: Id,
): Array<{ relationship: ErRelationship; participant: ErParticipant }> {
  const out: Array<{ relationship: ErRelationship; participant: ErParticipant }> = [];
  for (const relationship of Object.values(model.relationships)) {
    for (const participant of relationship.participants) {
      if (participant.entityId === entityId) out.push({ relationship, participant });
    }
  }
  return out;
}

export function isRecursiveRelationship(rel: ErRelationship): boolean {
  const ids = rel.participants.map((p) => p.entityId);
  return new Set(ids).size < ids.length;
}

/** Top-level attributes of an entity or relationship, in display order. */
export function ownAttributes(model: ErModel, ownerKind: 'entity' | 'relationship', ownerId: Id): ErAttribute[] {
  return attributesOf(model, { kind: ownerKind, id: ownerId });
}

// ----- Relational model ----------------------------------------------------

export function relationColumn(relation: Relation, columnId: Id): RelColumn | undefined {
  return arr(relation?.columns).find((c) => c?.id === columnId);
}

export function findColumn(
  model: RelationalModel,
  columnId: Id,
): { relation: Relation; column: RelColumn; index: number } | undefined {
  for (const relation of Object.values(model.relations ?? {})) {
    const columns = arr(relation?.columns);
    const index = columns.findIndex((c) => c?.id === columnId);
    if (index >= 0) return { relation, column: columns[index]!, index };
  }
  return undefined;
}

/** Outgoing foreign keys (relation is the referencing/child side). */
export function foreignKeysOf(model: RelationalModel, relationId: Id): ForeignKey[] {
  return Object.values(model.foreignKeys ?? {}).filter((fk) => fk?.sourceRelationId === relationId);
}

/** Incoming foreign keys (relation is the referenced/parent side). */
export function foreignKeysReferencing(model: RelationalModel, relationId: Id): ForeignKey[] {
  return Object.values(model.foreignKeys ?? {}).filter((fk) => fk?.targetRelationId === relationId);
}

export function isPrimaryKeyColumn(relation: Relation, columnId: Id): boolean {
  return relation.primaryKey.includes(columnId);
}

/** True if the column is a source column of any FK of the relation. */
export function isForeignKeyColumn(model: RelationalModel, relationId: Id, columnId: Id): boolean {
  return foreignKeysOf(model, relationId).some((fk) => arr(fk.columns).some((p) => p?.sourceColumnId === columnId));
}

export type ColumnRole = 'pk' | 'fk' | 'pk+fk' | 'plain';

/** The four visual/semantic categories required by the horizontal schema notation. */
export function columnRole(model: RelationalModel, relationId: Id, columnId: Id): ColumnRole {
  const relation = ownGet(model.relations, relationId);
  if (!relation) return 'plain';
  const pk = isPrimaryKeyColumn(relation, columnId);
  const fk = isForeignKeyColumn(model, relationId, columnId);
  if (pk && fk) return 'pk+fk';
  if (pk) return 'pk';
  if (fk) return 'fk';
  return 'plain';
}

const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

/**
 * True when the column SET (order-insensitive) is exactly the primary key, a UNIQUE constraint or a UNIQUE index
 * of the relation. Shared by validation (FK target key), SQL and Crow's Foot (1:1 detection).
 */
export function isCandidateKey(relation: Relation, columnIds: Id[]): boolean {
  if (columnIds.length === 0) return false;
  if (relation.primaryKey.length > 0 && sameSet(relation.primaryKey, columnIds)) return true;
  if (relation.uniques.some((u) => sameSet(u.columnIds, columnIds))) return true;
  return relation.indexes.some((i) => i.unique && !i.where && sameSet(i.columnIds, columnIds));
}

/** True when `columnIds` CONTAINS some candidate key (i.e. it is a superkey). */
export function coversCandidateKey(relation: Relation, columnIds: Id[]): boolean {
  const covers = (key: Id[]): boolean => key.length > 0 && key.every((k) => columnIds.includes(k));
  return (
    covers(relation.primaryKey) ||
    relation.uniques.some((u) => covers(u.columnIds)) ||
    relation.indexes.some((i) => i.unique && !i.where && covers(i.columnIds))
  );
}

/** Column is on its own a key: single-column PK, UNIQUE constraint or UNIQUE index. */
export function isColumnUnique(relation: Relation, columnId: Id): boolean {
  return isCandidateKey(relation, [columnId]);
}

/** `Patient.DoctorSSN → Doctor.SSN` or `Prescription.(A, B) → Drug.(C, D)`. */
export function describeForeignKey(model: RelationalModel, fk: ForeignKey): string {
  const source = ownGet(model.relations, fk?.sourceRelationId);
  const target = ownGet(model.relations, fk?.targetRelationId);
  const names = (rel: Relation | undefined, ids: Id[]): string => {
    if (ids.length === 0) return '?';
    const cols = ids.map((id) => (rel ? relationColumn(rel, id)?.name : undefined) ?? '?');
    return cols.length === 1 ? cols[0]! : `(${cols.join(', ')})`;
  };
  const pairs = arr(fk?.columns).filter((c) => c && typeof c === 'object');
  const s = `${source?.name ?? '?'}.${names(source, pairs.map((c) => c.sourceColumnId))}`;
  const t = `${target?.name ?? '?'}.${names(target, pairs.map((c) => c.targetColumnId))}`;
  return `${s} → ${t}`;
}

/**
 * Effective FK cardinality: stated values (`fk.cardinality`) win, missing ones are derived:
 * parentMin = 1 iff every FK column is NOT NULL; childMax = 'one' iff the FK columns cover a candidate key of the
 * SOURCE relation; childMin = 0. `stated` lists which fields came from the model rather than derivation.
 */
export function fkCardinality(
  model: RelationalModel,
  fk: ForeignKey,
): { childMax: 'one' | 'many'; childMin: 0 | 1; parentMin: 0 | 1; stated: Array<'childMax' | 'childMin' | 'parentMin'> } {
  const source = ownGet(model.relations, fk?.sourceRelationId);
  const srcIds = arr(fk?.columns).flatMap((c) => (c && typeof c.sourceColumnId === 'string' ? [c.sourceColumnId] : []));
  const allNotNull =
    !!source && srcIds.length > 0 && srcIds.every((id) => relationColumn(source, id)?.nullable === false);
  const derivedChildMax: 'one' | 'many' = source && safeCovers(source, srcIds) ? 'one' : 'many';
  const stated: Array<'childMax' | 'childMin' | 'parentMin'> = [];
  const st = fk?.cardinality && typeof fk.cardinality === 'object' ? fk.cardinality : undefined;
  if (st?.childMax) stated.push('childMax');
  if (st?.childMin !== undefined) stated.push('childMin');
  if (st?.parentMin !== undefined) stated.push('parentMin');
  return {
    childMax: st?.childMax ?? derivedChildMax,
    childMin: st?.childMin ?? 0,
    parentMin: st?.parentMin ?? (allNotNull ? 1 : 0),
    stated,
  };
}

/** `coversCandidateKey` that treats missing key arrays as empty. */
function safeCovers(relation: Relation, columnIds: Id[]): boolean {
  const covers = (key: readonly Id[] | undefined): boolean => arr(key).length > 0 && arr(key).every((k) => columnIds.includes(k));
  return (
    covers(relation.primaryKey) ||
    arr(relation.uniques).some((u) => covers(u?.columnIds)) ||
    arr(relation.indexes).some((i) => !!i && i.unique && !i.where && covers(i.columnIds))
  );
}

// ----- names ---------------------------------------------------------------

/** Identifier identity used for ALL duplicate checks and collision suffixing (`_2`, `_3`): trimmed, lower-cased. */
export const sqlNameKey = (name: string): string => name.trim().toLowerCase();

/** `schema.name` identity of a relation (relation names may repeat across schemas). */
export const relationNameKey = (rel: Relation): string => `${sqlNameKey(rel.schemaName ?? '')}.${sqlNameKey(rel.name)}`;

// ----- project -------------------------------------------------------------

export function modelOfDiagram(project: Project, diagram: Diagram): Model | undefined {
  return ownGet(project.models, diagram?.modelId);
}

export function erModelOf(project: Project, diagram: Diagram): ErModel | undefined {
  const m = ownGet(project.models, diagram?.modelId);
  return m?.kind === 'er' ? m : undefined;
}

export function relationalModelOf(project: Project, diagram: Diagram): RelationalModel | undefined {
  const m = ownGet(project.models, diagram?.modelId);
  return m?.kind === 'relational' ? m : undefined;
}

/** Human-readable label for any ref (for issue lists, tooltips, undo labels). */
export function describeRef(project: Project, ref: SemanticRef): string {
  for (const model of Object.values(project.models)) {
    if (model.kind === 'er') {
      switch (ref.kind) {
        case 'entity':
          if (ownGet(model.entities, ref.id)) return ownGet(model.entities, ref.id)!.name;
          break;
        case 'attribute':
          if (ownGet(model.attributes, ref.id)) return ownGet(model.attributes, ref.id)!.name;
          break;
        case 'relationship':
          if (ownGet(model.relationships, ref.id)) return ownGet(model.relationships, ref.id)!.name;
          break;
        case 'participant': {
          const rel = ownGet(model.relationships, ref.relationshipId);
          const p = arr(rel?.participants).find((x) => x?.id === ref.id);
          if (rel && p) return `${rel.name} ↔ ${ownGet(model.entities, p.entityId)?.name ?? '?'}`;
          break;
        }
      }
    } else {
      switch (ref.kind) {
        case 'relation':
          if (ownGet(model.relations, ref.id)) return ownGet(model.relations, ref.id)!.name;
          break;
        case 'column': {
          const rel = ownGet(model.relations, ref.relationId);
          const col = rel && relationColumn(rel, ref.id);
          if (rel && col) return `${rel.name}.${col.name}`;
          break;
        }
        case 'unique':
        case 'index': {
          const rel = ownGet(model.relations, ref.relationId);
          if (rel) return `${rel.name} (${ref.kind})`;
          break;
        }
        case 'foreignKey':
          if (ownGet(model.foreignKeys, ref.id)) return describeForeignKey(model, ownGet(model.foreignKeys, ref.id)!);
          break;
      }
    }
  }
  return `${ref.kind}:${ref.id}`;
}
