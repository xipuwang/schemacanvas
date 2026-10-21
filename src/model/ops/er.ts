/**
 * ER (Chen) ops. All take the model id first and mutate the immer draft; each ends with `commitSync`.
 * Semantics follow types.ts: `max` is look-across, `participation` is near-side, the identified participant of an
 * identifying relationship is the unique weak one unless flagged `identified`.
 */
import { associativeEntityOf, identifiedParticipants } from '../erSemantics';
import { newId } from '../ids';
import { attributesOf } from '../queries';
import type {
  ErAttribute,
  ErAttributeOwner,
  ErEntity,
  ErKeyKind,
  ErModel,
  ErParticipant,
  ErRelationship,
  Id,
  Point,
  Project,
  SemanticRef,
} from '../types';
import {
  OpError,
  type OpResult,
  type PlaceAt,
  applyOptional,
  addNodeFor,
  assertIdsFree,
  checkPlace,
  commitSync,
  finishOp,
  isNodeableIn,
  nodeIdByRef,
  requireEr,
  snapshotNodes,
  uniqueName,
} from './common';

// ----- helpers -----------------------------------------------------------------------------------------------------

function ownerExists(m: ErModel, o: ErAttributeOwner): boolean {
  return o.kind === 'entity' ? !!m.entities[o.id] : o.kind === 'relationship' ? !!m.relationships[o.id] : !!m.attributes[o.id];
}

const ownerKey = (o: { kind: string; id: Id }): string => `${o.kind}:${o.id}`;

/** All attributes below `owner` (children, grandchildren, …), cycle-safe. */
export function attributeSubtreeIds(m: ErModel, owner: { kind: string; id: Id }): Id[] {
  const byOwner = new Map<string, Id[]>();
  for (const a of Object.values(m.attributes)) {
    const k = ownerKey(a.owner);
    const list = byOwner.get(k);
    if (list) list.push(a.id);
    else byOwner.set(k, [a.id]);
  }
  const out: Id[] = [];
  const seen = new Set<Id>();
  const walk = (key: string): void => {
    for (const id of byOwner.get(key) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      walk(`attribute:${id}`);
    }
  };
  walk(ownerKey(owner));
  return out;
}

function deleteAttributes(m: ErModel, ids: Id[]): void {
  const gone = new Set(ids);
  for (const id of ids) delete m.attributes[id];
  for (const a of Object.values(m.attributes)) {
    if (!a.derivedFrom) continue;
    a.derivedFrom = a.derivedFrom.filter((x) => !gone.has(x));
    if (a.derivedFrom.length === 0) delete a.derivedFrom;
  }
}

function renumber(m: ErModel, ids: Id[]): void {
  ids.forEach((id, i) => {
    m.attributes[id]!.order = i;
  });
}

/** Detach an entity's participants everywhere (relationships stay, even with < 2 participants: soft state). */
function detachEntityParticipants(m: ErModel, entityId: Id): void {
  for (const rel of Object.values(m.relationships)) {
    const removed = rel.participants.filter((p) => p.entityId === entityId).map((p) => p.id);
    if (removed.length === 0) continue;
    rel.participants = rel.participants.filter((p) => p.entityId !== entityId);
    dropKeyParticipants(rel, removed);
  }
}

function dropKeyParticipants(rel: ErRelationship, removed: Id[]): void {
  if (!rel.keyParticipantIds) return;
  rel.keyParticipantIds = rel.keyParticipantIds.filter((id) => !removed.includes(id));
  if (rel.keyParticipantIds.length === 0) delete rel.keyParticipantIds;
}

function requireEntity(m: ErModel, id: Id): ErEntity {
  const e = m.entities[id];
  if (!e) throw new OpError('not-found', `Entity ${id} does not exist`);
  return e;
}
function requireRel(m: ErModel, id: Id): ErRelationship {
  const r = m.relationships[id];
  if (!r) throw new OpError('not-found', `Relationship ${id} does not exist`);
  return r;
}
function requireAttr(m: ErModel, id: Id): ErAttribute {
  const a = m.attributes[id];
  if (!a) throw new OpError('not-found', `Attribute ${id} does not exist`);
  return a;
}
function requireParticipant(rel: ErRelationship, id: Id): ErParticipant {
  const p = rel.participants.find((x) => x.id === id);
  if (!p) throw new OpError('not-found', `Participant ${id} is not in relationship ${rel.id}`);
  return p;
}

// ----- entities ----------------------------------------------------------------------------------------------------

export interface EntityInit {
  id?: Id;
  name?: string;
  weak?: boolean;
  description?: string;
}

export function addEntity(draft: Project, modelId: Id, init: EntityInit = {}, place?: PlaceAt): OpResult {
  const m = requireEr(draft, modelId);
  checkPlace(draft, modelId, place);
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const id = init.id ?? newId('ent');
  const entity: ErEntity = {
    id,
    name: init.name ?? uniqueName('Entity', Object.values(m.entities).map((e) => e.name)),
    weak: init.weak ?? false,
  };
  if (init.description) entity.description = init.description;
  m.entities[id] = entity;
  return finishOp(draft, modelId, before, [{ kind: 'entity', id }], place);
}

export function updateEntity(
  draft: Project,
  modelId: Id,
  entityId: Id,
  patch: { name?: string; weak?: boolean; description?: string | undefined },
): void {
  const m = requireEr(draft, modelId);
  const e = requireEntity(m, entityId);
  if (patch.weak && e.associativeOf) throw new OpError('invalid', 'An associative entity is never weak');
  if (patch.name !== undefined) e.name = patch.name;
  if (patch.weak !== undefined) e.weak = patch.weak;
  applyOptional(e, patch, ['description']);
  commitSync(draft, modelId);
}

/** Cascade: attribute subtree, participants (+ keyParticipantIds); relationships left with < 2 participants are KEPT. */
export function removeEntity(draft: Project, modelId: Id, entityId: Id): void {
  const m = requireEr(draft, modelId);
  requireEntity(m, entityId);
  deleteAttributes(m, attributeSubtreeIds(m, { kind: 'entity', id: entityId }));
  detachEntityParticipants(m, entityId);
  delete m.entities[entityId];
  commitSync(draft, modelId);
}

// ----- attributes --------------------------------------------------------------------------------------------------

export interface AttributeInit {
  id?: Id;
  name?: string;
  key?: ErKeyKind;
  multivalued?: boolean;
  derived?: boolean;
  optional?: boolean;
  dataType?: string;
  derivedFrom?: Id[];
  description?: string;
  /** Position among the owner's attributes (default: last). */
  index?: number;
}

const clampIndex = (i: number | undefined, len: number): number => (i === undefined ? len : Math.max(0, Math.min(len, Math.trunc(i))));

function validDerivedFrom(m: ErModel, ids: Id[] | undefined, self?: Id): Id[] {
  return [...new Set(ids ?? [])].filter((x) => x !== self && !!m.attributes[x]);
}

export function addAttribute(
  draft: Project,
  modelId: Id,
  owner: ErAttributeOwner,
  init: AttributeInit = {},
  place?: PlaceAt,
): OpResult {
  const m = requireEr(draft, modelId);
  if (!ownerExists(m, owner)) throw new OpError('not-found', `Attribute owner ${owner.kind}:${owner.id} does not exist`);
  checkPlace(draft, modelId, place);
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const siblings = attributesOf(m, owner);
  const id = init.id ?? newId('att');
  const attr: ErAttribute = {
    id,
    name: init.name ?? uniqueName('Attribute', siblings.map((a) => a.name)),
    owner: { kind: owner.kind, id: owner.id },
    order: 0,
    key: init.key ?? 'none',
    multivalued: init.multivalued ?? false,
    derived: init.derived ?? false,
  };
  if (init.optional !== undefined) attr.optional = init.optional;
  if (init.dataType) attr.dataType = init.dataType;
  if (init.description) attr.description = init.description;
  const from = validDerivedFrom(m, init.derivedFrom, id);
  if (from.length) attr.derivedFrom = from;
  m.attributes[id] = attr;
  const ids = siblings.map((a) => a.id);
  ids.splice(clampIndex(init.index, ids.length), 0, id);
  renumber(m, ids);
  return finishOp(draft, modelId, before, [{ kind: 'attribute', id }], place);
}

export interface AttributePatch {
  name?: string;
  key?: ErKeyKind;
  multivalued?: boolean;
  derived?: boolean;
  /** `undefined` (key present) clears the field. */
  optional?: boolean | undefined;
  dataType?: string | undefined;
  derivedFrom?: Id[] | undefined;
  description?: string | undefined;
}

export function updateAttribute(draft: Project, modelId: Id, attributeId: Id, patch: AttributePatch): void {
  const m = requireEr(draft, modelId);
  const a = requireAttr(m, attributeId);
  if (patch.name !== undefined) a.name = patch.name;
  if (patch.key !== undefined) a.key = patch.key;
  if (patch.multivalued !== undefined) a.multivalued = patch.multivalued;
  if (patch.derived !== undefined) a.derived = patch.derived;
  applyOptional(a, patch, ['optional', 'dataType', 'description']);
  if ('derivedFrom' in patch) {
    const from = validDerivedFrom(m, patch.derivedFrom, attributeId);
    if (from.length) a.derivedFrom = from;
    else delete a.derivedFrom;
  }
  commitSync(draft, modelId);
}

/** Move within the owner's attribute list; `toIndex` is clamped. Never touches refs. */
export function reorderAttribute(draft: Project, modelId: Id, attributeId: Id, toIndex: number): void {
  const m = requireEr(draft, modelId);
  const a = requireAttr(m, attributeId);
  const ids = attributesOf(m, a.owner).map((x) => x.id);
  ids.splice(ids.indexOf(attributeId), 1);
  ids.splice(clampIndex(toIndex, ids.length), 0, attributeId);
  renumber(m, ids);
  commitSync(draft, modelId);
}

/** Reparent between owners (entity | relationship | composite parent). Refuses cycles (incl. moving under itself). */
export function moveAttribute(draft: Project, modelId: Id, attributeId: Id, newOwner: ErAttributeOwner, index?: number): void {
  const m = requireEr(draft, modelId);
  const a = requireAttr(m, attributeId);
  if (!ownerExists(m, newOwner)) throw new OpError('not-found', `Attribute owner ${newOwner.kind}:${newOwner.id} does not exist`);
  if (newOwner.kind === 'attribute') {
    const seen = new Set<Id>();
    let cur: Id | undefined = newOwner.id;
    while (cur !== undefined) {
      if (cur === attributeId) throw new OpError('cycle', 'An attribute cannot be moved below itself');
      if (seen.has(cur)) break;
      seen.add(cur);
      const o: ErAttributeOwner | undefined = m.attributes[cur]?.owner;
      cur = o?.kind === 'attribute' ? o.id : undefined;
    }
  }
  const oldOwner = { kind: a.owner.kind, id: a.owner.id };
  const oldIds = attributesOf(m, oldOwner)
    .map((x) => x.id)
    .filter((x) => x !== attributeId);
  a.owner = { kind: newOwner.kind, id: newOwner.id };
  const newIds = attributesOf(m, newOwner)
    .map((x) => x.id)
    .filter((x) => x !== attributeId);
  newIds.splice(clampIndex(index, newIds.length), 0, attributeId);
  if (ownerKey(oldOwner) !== ownerKey(newOwner)) renumber(m, oldIds);
  renumber(m, newIds);
  commitSync(draft, modelId);
}

/** Removes the attribute and its whole sub-attribute subtree; scrubs `derivedFrom` references to them. */
export function removeAttribute(draft: Project, modelId: Id, attributeId: Id): void {
  const m = requireEr(draft, modelId);
  const a = requireAttr(m, attributeId);
  const owner = { kind: a.owner.kind, id: a.owner.id };
  deleteAttributes(m, [attributeId, ...attributeSubtreeIds(m, { kind: 'attribute', id: attributeId })]);
  renumber(m, attributesOf(m, owner).map((x) => x.id));
  commitSync(draft, modelId);
}

// ----- relationships -----------------------------------------------------------------------------------------------

export interface ParticipantInit {
  id?: Id;
  entityId: Id;
  max?: 'one' | 'many';
  participation?: 'partial' | 'total';
  role?: string;
  cardinalityLabel?: string;
  identified?: boolean;
}

export interface RelationshipInit {
  id?: Id;
  name?: string;
  identifying?: boolean;
  /** Order is preserved forever (ops never reorder participants). */
  participants: ParticipantInit[];
  /** Indexes into `participants` forming `keyParticipantIds`. */
  keyParticipantIndexes?: number[];
  description?: string;
}

function makeParticipant(m: ErModel, init: ParticipantInit): ErParticipant {
  if (!m.entities[init.entityId]) throw new OpError('not-found', `Entity ${init.entityId} does not exist`);
  const p: ErParticipant = {
    id: init.id ?? newId('par'),
    entityId: init.entityId,
    max: init.max ?? 'many',
    participation: init.participation ?? 'partial',
  };
  if (init.role) p.role = init.role;
  if (init.cardinalityLabel) p.cardinalityLabel = init.cardinalityLabel;
  if (init.identified) p.identified = true;
  return p;
}

export function addRelationship(draft: Project, modelId: Id, init: RelationshipInit, place?: PlaceAt): OpResult {
  const m = requireEr(draft, modelId);
  checkPlace(draft, modelId, place);
  assertIdsFree(draft, [init.id, ...init.participants.map((p) => p.id)]);
  const before = snapshotNodes(draft, modelId);
  const id = init.id ?? newId('rel');
  const participants = init.participants.map((p) => makeParticipant(m, p));
  const rel: ErRelationship = {
    id,
    name: init.name ?? uniqueName('Relationship', Object.values(m.relationships).map((r) => r.name)),
    identifying: false,
    participants,
  };
  if (init.description) rel.description = init.description;
  if (init.keyParticipantIndexes?.length) {
    const ids = init.keyParticipantIndexes.map((i) => participants[i]?.id);
    if (ids.some((x) => x === undefined)) throw new OpError('invalid', 'keyParticipantIndexes out of range');
    rel.keyParticipantIds = ids as Id[];
  }
  m.relationships[id] = rel;
  if (init.identifying) applyIdentifying(m, rel, true);
  const refs: SemanticRef[] = [
    { kind: 'relationship', id },
    ...participants.map((p): SemanticRef => ({ kind: 'participant', relationshipId: id, id: p.id })),
  ];
  return finishOp(draft, modelId, before, refs, place);
}

/**
 * Identifying on: the identified participant becomes TOTAL; the `identified` flag is stored only when the weak-entity
 * rule alone does not single it out. `identifiedParticipantId` names the identified one explicitly. Off: flags cleared.
 */
function applyIdentifying(m: ErModel, rel: ErRelationship, on: boolean, identifiedParticipantId?: Id): void {
  if (on && associativeEntityOf(m, rel.id)) throw new OpError('invalid', 'A relationship with an associative entity cannot be identifying');
  if (identifiedParticipantId !== undefined) requireParticipant(rel, identifiedParticipantId);
  rel.identifying = on;
  if (!on) {
    for (const p of rel.participants) delete p.identified;
    return;
  }
  if (identifiedParticipantId !== undefined) {
    const weak = rel.participants.filter((p) => m.entities[p.entityId]?.weak);
    const implicit = weak.length === 1 && weak[0]!.id === identifiedParticipantId;
    for (const p of rel.participants) {
      if (p.id === identifiedParticipantId && !implicit) p.identified = true;
      else delete p.identified;
    }
  }
  for (const p of identifiedParticipants(m, rel)) p.participation = 'total';
}

export function setIdentifying(
  draft: Project,
  modelId: Id,
  relationshipId: Id,
  identifying: boolean,
  opts: { identifiedParticipantId?: Id } = {},
): void {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  applyIdentifying(m, rel, identifying, opts.identifiedParticipantId);
  if (identifying) {
    // the owner side of an identifying relationship is always 'one' (one weak instance has exactly one owner): the toggle
    // sets it in the same commit instead of leaving the M:N default to trip `er.identifying-owner-many`
    const identified = identifiedParticipants(m, rel);
    if (identified.length > 0) for (const p of rel.participants) if (!identified.some((i) => i.id === p.id)) p.max = 'one';
  }
  commitSync(draft, modelId);
}

export function updateRelationship(
  draft: Project,
  modelId: Id,
  relationshipId: Id,
  patch: { name?: string; identifying?: boolean; keyParticipantIds?: Id[] | undefined; description?: string | undefined },
): void {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  if (patch.name !== undefined) rel.name = patch.name;
  applyOptional(rel, patch, ['description']);
  if ('keyParticipantIds' in patch) {
    const ids = patch.keyParticipantIds ?? [];
    for (const id of ids) requireParticipant(rel, id);
    if (ids.length) rel.keyParticipantIds = [...new Set(ids)];
    else delete rel.keyParticipantIds;
  }
  if (patch.identifying !== undefined && patch.identifying !== rel.identifying) applyIdentifying(m, rel, patch.identifying);
  commitSync(draft, modelId);
}

/** Delete the relationship and its attribute subtree; an associative entity pointing at it is demoted (field cleared). */
export function removeRelationship(draft: Project, modelId: Id, relationshipId: Id): void {
  const m = requireEr(draft, modelId);
  requireRel(m, relationshipId);
  deleteAttributes(m, attributeSubtreeIds(m, { kind: 'relationship', id: relationshipId }));
  for (const e of Object.values(m.entities)) if (e.associativeOf === relationshipId) delete e.associativeOf;
  delete m.relationships[relationshipId];
  commitSync(draft, modelId);
}

export function addParticipant(draft: Project, modelId: Id, relationshipId: Id, init: ParticipantInit): OpResult {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const p = makeParticipant(m, init);
  rel.participants.push(p);
  return finishOp(draft, modelId, before, [{ kind: 'participant', relationshipId, id: p.id }]);
}

/**
 * Identification defaults after `participantId` was added to `relationshipId` (no-op unless the relationship is
 * identifying and its identified side is unambiguous, which needs at least two participants: a lone weak participant
 * may be the OWNER of a weak-entity chain, so nothing is guessed until the other side is connected). Only participants
 * still at the untouched add-defaults (many + partial) are changed, so values the user set explicitly are never
 * overridden:
 *   - the identified (weak) side becomes total (`er.identifying-partial`),
 *   - every owner becomes 'one' (`er.identifying-owner-many`).
 * Works in either connection order (owner first or weak entity first).
 */
export function applyIdentifyingDefaults(draft: Project, modelId: Id, relationshipId: Id, participantId: Id): void {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  requireParticipant(rel, participantId);
  if (rel.participants.length < 2) return;
  const identified = new Set(identifiedParticipants(m, rel).map((p) => p.id));
  if (identified.size === 0 || identified.size === rel.participants.length) return;
  const isDefault = (p: ErParticipant): boolean => p.max === 'many' && p.participation === 'partial';
  for (const p of rel.participants) {
    if (!isDefault(p)) continue;
    if (identified.has(p.id)) p.participation = 'total';
    else p.max = 'one';
  }
  commitSync(draft, modelId);
}

export interface ParticipantPatch {
  entityId?: Id;
  max?: 'one' | 'many';
  participation?: 'partial' | 'total';
  role?: string | undefined;
  cardinalityLabel?: string | undefined;
  identified?: boolean;
}

export function updateParticipant(draft: Project, modelId: Id, relationshipId: Id, participantId: Id, patch: ParticipantPatch): void {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  const p = requireParticipant(rel, participantId);
  if (patch.entityId !== undefined) {
    requireEntity(m, patch.entityId);
    p.entityId = patch.entityId;
  }
  if (patch.max !== undefined && patch.max !== p.max) {
    p.max = patch.max;
    delete p.cardinalityLabel; // a label is only honoured while consistent with `max`
  }
  if (patch.participation !== undefined) p.participation = patch.participation;
  applyOptional(p, patch, ['role', 'cardinalityLabel']);
  if (patch.identified !== undefined) {
    if (patch.identified && !rel.identifying) throw new OpError('invalid', 'Only participants of identifying relationships can be identified');
    if (patch.identified) p.identified = true;
    else delete p.identified;
  }
  commitSync(draft, modelId);
}

export function removeParticipant(draft: Project, modelId: Id, relationshipId: Id, participantId: Id): void {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  requireParticipant(rel, participantId);
  rel.participants = rel.participants.filter((p) => p.id !== participantId);
  dropKeyParticipants(rel, [participantId]);
  commitSync(draft, modelId);
}

// ----- associative entities ----------------------------------------------------------------------------------------

type Placements = Record<Id, Point>;

function nodePositions(draft: Project, modelId: Id, ref: SemanticRef): Placements {
  const out: Placements = {};
  for (const d of Object.values(draft.diagrams)) {
    if (d.modelId !== modelId) continue;
    const nid = nodeIdByRef(d, ref);
    if (nid) out[d.id] = { x: d.nodes[nid]!.x, y: d.nodes[nid]!.y };
  }
  return out;
}

/**
 * After a node swap (relationship <-> associative entity) the successor takes over the predecessor's place. In PARTIAL
 * diagrams sync never adds nodes, so the successor gets its node here (otherwise the element would vanish from the view).
 * `shift` offsets the successor (used when the predecessor's node stays on the canvas).
 */
function handOver(draft: Project, modelId: Id, from: Placements, ref: SemanticRef, shift: Point = { x: 0, y: 0 }): void {
  let added = false;
  for (const [diagramId, point] of Object.entries(from)) {
    const d = draft.diagrams[diagramId]!;
    let nid = nodeIdByRef(d, ref);
    if (!nid && d.partial && isNodeableIn(draft, d, ref)) {
      nid = addNodeFor(d, ref, point.x + shift.x, point.y + shift.y);
      added = true;
    }
    if (nid) {
      d.nodes[nid]!.x = point.x + shift.x;
      d.nodes[nid]!.y = point.y + shift.y;
    }
  }
  if (added) commitSync(draft, modelId); // edges of the newly shown node
}

/**
 * Promote relationship R to an associative entity: a new entity (`associativeOf = R`) takes over R's node (position
 * included), R keeps its participants but loses its own node, and R's attributes move to the entity.
 */
export function makeAssociative(draft: Project, modelId: Id, relationshipId: Id, init: { id?: Id; name?: string } = {}): OpResult {
  const m = requireEr(draft, modelId);
  const rel = requireRel(m, relationshipId);
  if (rel.identifying) throw new OpError('invalid', 'An identifying relationship cannot become an associative entity');
  if (associativeEntityOf(m, relationshipId)) throw new OpError('invalid', 'Relationship already has an associative entity');
  assertIdsFree(draft, [init.id]);
  const before = snapshotNodes(draft, modelId);
  const old = nodePositions(draft, modelId, { kind: 'relationship', id: relationshipId });
  const id = init.id ?? newId('ent');
  m.entities[id] = {
    id,
    name: init.name ?? uniqueName(rel.name, Object.values(m.entities).map((e) => e.name)),
    weak: false,
    associativeOf: relationshipId,
  };
  const moved = attributesOf(m, { kind: 'relationship', id: relationshipId });
  for (const a of moved) a.owner = { kind: 'entity', id };
  renumber(m, moved.map((a) => a.id));
  const ref: SemanticRef = { kind: 'entity', id };
  const result = finishOp(draft, modelId, before, [ref]);
  handOver(draft, modelId, old, ref);
  return result;
}

/**
 * Demote an associative entity. Default: the entity is removed (its attributes move back to R, its other participations
 * disappear with it) and R regains a node at the entity's place. `keepEntity`: the entity stays as an ordinary entity.
 */
export function clearAssociative(draft: Project, modelId: Id, entityId: Id, opts: { keepEntity?: boolean } = {}): OpResult {
  const m = requireEr(draft, modelId);
  const e = requireEntity(m, entityId);
  const relId = e.associativeOf;
  if (!relId) throw new OpError('invalid', `Entity ${entityId} is not associative`);
  const before = snapshotNodes(draft, modelId);
  const old = nodePositions(draft, modelId, { kind: 'entity', id: entityId });
  const rel = m.relationships[relId];
  delete e.associativeOf;
  const refs: SemanticRef[] = [];
  if (rel) refs.push({ kind: 'relationship', id: relId });
  if (!opts.keepEntity && rel) {
    const existing = attributesOf(m, { kind: 'relationship', id: relId });
    const moved = attributesOf(m, { kind: 'entity', id: entityId });
    for (const a of moved) a.owner = { kind: 'relationship', id: relId };
    renumber(m, [...existing, ...moved].map((a) => a.id));
    detachEntityParticipants(m, entityId);
    delete m.entities[entityId];
  } else {
    refs.push({ kind: 'entity', id: entityId });
  }
  const result = finishOp(draft, modelId, before, refs);
  if (rel) handOver(draft, modelId, old, { kind: 'relationship', id: relId }, opts.keepEntity ? { x: 200, y: 0 } : undefined);
  return result;
}
