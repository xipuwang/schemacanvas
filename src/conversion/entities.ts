/**
 * Entity -> relation rules: strong, weak (owner keys + partial key), associative and 1:1-merged entities.
 * Relations are built lazily through `buildEntity` because a dependent's key contains its owners' full keys and an
 * associative entity's relation contains FKs to its participants.
 */
import { analyzeRelationship, identificationOrder, weakEntityOwners } from '@/model/erSemantics';
import type { ErEntity, Id, RelColumn } from '@/model/types';
import { storeAttributes, type MvHost } from './attributes';
import { colRef, eRef, fkRef, relRef, type Ctx, type EntityInfo, type OwnerFkRecord, type RelState } from './context';
import type { MergeGroup } from './merge';
import { listColumns } from './names';
import { addParticipantFks, applyTableKeys, explainKey, tableTargets, warnTableParticipation } from './shared';

export function buildEntity(c: Ctx, entityId: Id): EntityInfo | undefined {
  const done = c.infos.get(entityId);
  if (done) return done;
  const entity = c.er.entities[entityId];
  if (!entity || c.inProgress.has(entityId)) return undefined;
  c.inProgress.add(entityId);
  try {
    const group = c.merge.groupOf.get(entityId);
    if (group) buildMerged(c, group);
    else if (!(entity.associativeOf && buildAssociative(c, entity))) buildPlain(c, entity);
  } finally {
    c.inProgress.delete(entityId);
  }
  return c.infos.get(entityId);
}

/** Process order: owners before the entities they identify; cycles are reported once and cut. */
export function buildAllEntities(c: Ctx): void {
  const { order, cycles } = identificationOrder(c.er);
  cycles.forEach((group, i) => {
    for (const id of group) c.cycleOf.set(id, i);
    const names = group.map((id) => c.er.entities[id]?.name ?? id);
    c.warn({
      code: 'conv.weak-ownership-cycle',
      severity: 'warning',
      title: `Weak-entity ownership cycle: ${names.join(' → ')}`,
      explanation: `${names.join(', ')} identify each other (directly or through a chain), so no complete key can be built. Their relations were created WITHOUT the cyclic owner part of the key.`,
      suggestion: 'Break the cycle: an entity cannot be identified by an entity it identifies.',
      affected: group.map(eRef.entity),
      params: { names: names.join(', '), chain: names.join(' → ') },
    });
    c.decide({
      ruleId: 'weak-entity',
      tag: `cycle:${i}`,
      title: `Ownership cycle between ${names.join(', ')}`,
      explanation: 'The owner keys that would form a cycle were left out of the primary keys; the remaining partial keys and ordinary attributes were converted.',
      sources: group.map(eRef.entity),
      level: 'warning',
      params: { kind: 'weak-entity.cycle', names: names.join(', ') },
    });
  });
  for (const id of order) buildEntity(c, id);
}

function hostOf(st: RelState, entity: ErEntity, info: () => Id[]): MvHost {
  return { st, label: entity.name, keyName: entity.name, keyIds: info };
}

// ----- strong & weak ---------------------------------------------------------------------------------------------

function buildPlain(c: Ctx, entity: ErEntity): void {
  const owners = weakEntityOwners(c.er, entity.id);
  const cyc = c.cycleOf.get(entity.id);
  const usable = owners.filter((l) => cyc === undefined || c.cycleOf.get(l.owner.id) !== cyc);
  const weak = entity.weak || owners.length > 0;
  const ruleId = weak ? 'weak-entity' : 'strong-entity';
  const st = c.newRelation(entity.name, { ruleId, sources: [eRef.entity(entity.id)], key: `${ruleId}:${entity.id}` });

  const ownerColumns: RelColumn[] = [];
  const ownerNames: string[] = [];
  for (const link of usable) {
    const info = buildEntity(c, link.owner.id);
    const record: OwnerFkRecord = { relationshipId: link.relationship.id, weakParticipant: link.weakParticipant, ownerParticipant: link.ownerParticipant };
    c.ownerRecords.set(link.relationship.id, [...(c.ownerRecords.get(link.relationship.id) ?? []), record]);
    if (!info || info.keyColumnIds.length === 0) {
      c.decide({
        ruleId: 'weak-entity-owner-key',
        tag: `${entity.id}:${link.ownerParticipant.id}`,
        title: `${entity.name} could not take the key of ${link.owner.name}`,
        explanation: info
          ? `${link.owner.name} has no primary key, so ${entity.name} has nothing to reference.`
          : `The relation of ${link.owner.name} was not available (circular dependency).`,
        sources: [eRef.participant(link.relationship.id, link.ownerParticipant.id)],
        level: 'warning',
        params: { kind: info ? 'weak-entity-owner-key.nokey' : 'weak-entity-owner-key.unavailable', entity: entity.name, owner: link.owner.name },
      });
      continue;
    }
    const { columns, fk } = c.propagateKey({
      holder: st,
      target: info,
      participant: link.ownerParticipant,
      entity: link.owner,
      fkKey: `fk:${link.relationship.id}:${link.weakParticipant.id}:${link.ownerParticipant.id}`,
      ruleId: 'weak-entity-owner-key',
      sources: [
        eRef.participant(link.relationship.id, link.weakParticipant.id),
        eRef.participant(link.relationship.id, link.ownerParticipant.id),
        eRef.relationship(link.relationship.id),
      ],
      nullable: false,
    });
    // Owner participation 'total' ("every owner has >= 1 dependent") cannot be enforced by FKs.
    if (link.ownerParticipant.participation === 'total') {
      fk.cardinality = { childMin: 1 };
      c.warn({
        code: 'conv.total-on-one-side-unenforceable',
        severity: 'info',
        title: `Total participation of ${link.owner.name} in ${link.relationship.name} is not enforced`,
        explanation: `Every ${link.owner.name} must own at least one ${entity.name}. The foreign key from ${entity.name} guarantees the opposite direction only.`,
        suggestion: 'Enforce "at least one" in application logic or with a trigger.',
        affected: [eRef.participant(link.relationship.id, link.ownerParticipant.id), fkRef(fk)],
        params: { variant: 'weak', owner: link.owner.name, relationship: link.relationship.name, entity: entity.name },
      });
    }
    record.fk = fk;
    ownerColumns.push(...columns);
    ownerNames.push(link.owner.name);
  }

  const hostKey = (): Id[] => st.relation.primaryKey;
  const placed = storeAttributes(c, c.ownAttributes('entity', entity.id), {
    ruleId,
    ownerKey: entity.id,
    ownerName: entity.name,
    st,
    keyMode: weak ? 'weak' : 'strong',
    host: hostOf(st, entity, hostKey),
  });
  c.setPrimaryKey(st, [...ownerColumns, ...placed.keyColumns].map((x) => x.id));
  c.infos.set(entity.id, { entity, st, keyColumnIds: st.relation.primaryKey });
  c.trace(eRef.entity(entity.id), [relRef(st)], ruleId);

  const pkNames = st.relation.primaryKey.map((id) => st.relation.columns.find((x) => x.id === id)!.name);
  if (weak) {
    const partial = placed.keyColumns.map((x) => x.name);
    c.decide({
      ruleId: 'weak-entity',
      tag: entity.id,
      title: `Weak entity ${entity.name}: key = owner key + partial key`,
      explanation:
        ownerColumns.length > 0
          ? `${entity.name} cannot be identified by its own attributes, so its primary key is the FULL primary key of ${ownerNames.join(' and ')} (${listColumns(ownerColumns.map((x) => x.name))}) ` +
            `plus its partial key${partial.length ? ` ${listColumns(partial)}` : ' (none is defined, so the key is only the owner key — at most one row per owner)'}: ` +
            `primary key ${listColumns(pkNames)}. ` +
            `The identifying relationship creates no table of its own; it is the foreign key${usable.length > 1 ? 's' : ''} from ${entity.name} to ${ownerNames.join(', ')}.`
          : `${entity.name} is weak, but no usable owner key was found; its primary key is ${pkNames.length ? listColumns(pkNames) : 'empty'}.`,
      sources: [eRef.entity(entity.id)],
      targets: [relRef(st), ...ownerColumns.map((x) => colRef(st, x))],
      level: ownerColumns.length > 0 && placed.keyColumns.length > 0 ? 'info' : 'warning',
      params: {
        kind: ownerColumns.length > 0 ? 'weak-entity' : 'weak-entity.noowner',
        entity: entity.name,
        owners: ownerNames.join(' and '),
        ownerList: ownerNames.join(', '),
        ownerColumns: listColumns(ownerColumns.map((x) => x.name)),
        partial: listColumns(partial),
        partialMode: partial.length ? 'some' : 'none',
        pk: pkNames.length ? listColumns(pkNames) : '@i18n:decisions.word.empty',
        s: usable.length > 1 ? 'many' : 'one',
      },
    });
  } else if (pkNames.length === 0) {
    c.decide({
      ruleId: 'strong-entity',
      tag: `no-key:${entity.id}`,
      title: `${entity.name} has no key`,
      explanation: `${entity.name} has no key attribute, so its relation was created without a primary key (and cannot be referenced by foreign keys). Mark a key attribute and convert again.`,
      sources: [eRef.entity(entity.id)],
      targets: [relRef(st)],
      level: 'warning',
      params: { kind: 'strong-entity.nokey', entity: entity.name },
    });
  }
}

// ----- 1:1 merge -------------------------------------------------------------------------------------------------

function buildMerged(c: Ctx, group: MergeGroup): void {
  const rel = group.relationship;
  const primary = c.er.entities[group.primary.entityId]!;
  const other = c.er.entities[group.other.entityId]!;
  const st = c.newRelation(`${primary.name}_${other.name}`, {
    ruleId: 'one-to-one-merge',
    sources: [eRef.entity(primary.id), eRef.entity(other.id), eRef.relationship(rel.id)],
    key: `one-to-one-merge:${rel.id}`,
  });
  // Rows are keyed by the primary side; a row may lack its partner when the primary side participates only partially.
  const partnerOptional = group.primary.participation !== 'total';
  const keyIds: Record<Id, Id[]> = {};
  for (const member of [primary, other]) {
    const isPrimary = member.id === primary.id;
    const placed = storeAttributes(c, c.ownAttributes('entity', member.id), {
      ruleId: 'one-to-one-merge',
      ownerKey: member.id,
      ownerName: member.name,
      st,
      keyMode: 'strong',
      forceNullable: !isPrimary && partnerOptional,
      host: hostOf(st, member, () => keyIds[member.id] ?? []),
    });
    keyIds[member.id] = placed.keyColumns.map((x) => x.id);
  }
  c.setPrimaryKey(st, keyIds[primary.id]!);
  if (keyIds[other.id]!.length > 0) {
    c.addUnique(st, {
      key: `unique:one-to-one-merge:${rel.id}`,
      columnIds: keyIds[other.id]!,
      ruleId: 'one-to-one-merge',
      sources: [eRef.entity(other.id), eRef.relationship(rel.id)],
    });
  }
  c.infos.set(primary.id, { entity: primary, st, keyColumnIds: keyIds[primary.id]! });
  c.infos.set(other.id, { entity: other, st, keyColumnIds: keyIds[other.id]!, ...(partnerOptional ? { optionalPartner: true } : {}) });
  c.trace(eRef.entity(primary.id), [relRef(st)], 'one-to-one-merge');
  c.trace(eRef.entity(other.id), [relRef(st)], 'one-to-one-merge');

  const total = (p: { participation: string }): boolean => p.participation === 'total';
  const sideMode = total(group.primary) && total(group.other) ? 'bothTotal' : total(group.primary) || total(group.other) ? 'oneTotal' : 'partial';
  c.decide({
    ruleId: 'one-to-one-merge',
    tag: rel.id,
    title: `${primary.name} and ${other.name} merged into ${st.relation.name}`,
    explanation:
      `The 1:1 relationship ${rel.name} was translated by merging both entities into one relation named "${primary.name}_${other.name}" (primary entity first). ` +
      `Its primary key is ${primary.name}'s key; ${other.name}'s key became UNIQUE` +
      `${partnerOptional ? ` and all ${other.name} columns are nullable because not every ${primary.name} has a ${other.name}` : ''}. ` +
      (sideMode === 'oneTotal'
        ? `The side with partial participation keys the relation so no instance is lost.`
        : sideMode === 'bothTotal'
          ? `Both sides participate totally, so every instance has a partner and no instance is lost.`
          : `Both sides participate only partially.`),
    sources: [eRef.relationship(rel.id), eRef.entity(primary.id), eRef.entity(other.id)],
    targets: [relRef(st)],
    params: {
      primary: primary.name,
      other: other.name,
      relation: st.relation.name,
      relationship: rel.name,
      partnerMode: partnerOptional ? 'optional' : 'none',
      sideMode,
    },
  });
  if (!total(group.primary) && !total(group.other)) {
    c.warn({
      code: 'conv.one-to-one-merge-lossy',
      severity: 'warning',
      title: `Merging ${primary.name} and ${other.name} cannot store unpaired ${other.name} rows`,
      explanation: `Neither entity participates totally in ${rel.name}, so the merged relation (keyed by ${primary.name}) cannot represent a ${other.name} that has no ${primary.name}.`,
      suggestion: 'Use a foreign key or a separate relationship relation instead, or make one side total.',
      affected: [eRef.relationship(rel.id), relRef(st)],
      params: { primary: primary.name, other: other.name, relationship: rel.name },
    });
  }
}

// ----- associative entity ----------------------------------------------------------------------------------------

/** Returns false (nothing built) when the associative entity is not usable, so the caller converts it as a plain entity. */
function buildAssociative(c: Ctx, entity: ErEntity): boolean {
  const rel = c.er.relationships[entity.associativeOf!];
  const analysis = rel && !rel.identifying ? analyzeRelationship(c.er, rel.id) : undefined;
  if (!rel || !analysis || rel.participants.some((p) => !c.er.entities[p.entityId])) {
    c.decide({
      ruleId: 'associative-entity',
      tag: `invalid:${entity.id}`,
      title: `${entity.name} is not a usable associative entity`,
      explanation: `${entity.name} is marked as associative, but its relationship is missing, identifying or has fewer than two participants; it was converted as an ordinary entity.`,
      sources: [eRef.entity(entity.id)],
      level: 'warning',
      params: { kind: 'associative-entity.invalid', entity: entity.name },
    });
    return false;
  }
  const st = c.newRelation(entity.name, {
    ruleId: 'associative-entity',
    sources: [eRef.entity(entity.id), eRef.relationship(rel.id)],
    key: `associative-entity:${entity.id}`,
  });
  c.consumed.add(rel.id);
  const fks = addParticipantFks(c, st, rel, 'associative-entity', (id) => buildEntity(c, id));
  const attrs = [...c.ownAttributes('entity', entity.id), ...c.ownAttributes('relationship', rel.id)];
  const placed = storeAttributes(c, attrs, {
    ruleId: 'associative-entity',
    ownerKey: entity.id,
    ownerName: entity.name,
    st,
    keyMode: 'strong',
    host: hostOf(st, entity, () => st.relation.primaryKey),
  });
  const { pkColumns } = applyTableKeys(c, st, rel, analysis, fks, {
    ruleId: 'associative-entity',
    attrKeyColumns: placed.keyColumns,
    entityKey: placed.keyColumns.length > 0,
  });
  c.infos.set(entity.id, { entity, st, keyColumnIds: st.relation.primaryKey });

  const targets = tableTargets(st, fks);
  c.trace(eRef.entity(entity.id), [relRef(st)], 'associative-entity');
  c.trace(eRef.relationship(rel.id), targets, 'associative-entity');
  for (const f of fks) c.trace(eRef.participant(rel.id, f.participant.id), f.fk ? [fkRef(f.fk)] : [], 'associative-entity');
  warnTableParticipation(c, st, rel, fks);
  c.decide({
    ruleId: 'associative-entity',
    tag: entity.id,
    title: `Associative entity ${entity.name} becomes one relation`,
    explanation:
      `${entity.name} stands for the relationship ${rel.name}, so exactly one relation ${st.relation.name} is created: a foreign key per participant (${fks
        .map((f) => f.entity?.name ?? '?')
        .join(', ')}) plus its own attributes, with ${explainKey(st, pkColumns)}. ` +
      (placed.keyColumns.length > 0
        ? 'Its own key attributes form the key; the keys implied by the cardinalities became UNIQUE.'
        : 'It has no key attribute of its own, so the key implied by the relationship cardinalities is used.'),
    sources: [eRef.entity(entity.id), eRef.relationship(rel.id)],
    targets,
    params: {
      entity: entity.name,
      relationship: rel.name,
      relation: st.relation.name,
      participants: fks.map((f) => f.entity?.name ?? '?').join(', '),
      pk: listColumns(pkColumns.map((x) => x.name)),
      pkMode: pkColumns.length > 0 ? 'some' : 'none',
      keyMode: placed.keyColumns.length > 0 ? 'own' : 'implied',
    },
  });
  return true;
}
