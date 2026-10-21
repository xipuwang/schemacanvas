/**
 * Relationship -> relational rules. Entities are already built (`entities.ts`); here relationships either fold into
 * an FK on one entity's relation (1:N, recursive 1:N, 1:1), merge entities (1:1), add columns to a weak entity
 * (identifying relationships), or become a relation of their own (M:N, n-ary, 1:1/1:N on request).
 */
import {
  analyzeRelationship,
  identifiedParticipants,
  type RelationshipAnalysis,
} from '@/model/erSemantics';
import type { ConversionRuleId } from '@/model/conversionRules';
import type { ErAttribute, ErParticipant, ErRelationship, RelColumn, SemanticRef } from '@/model/types';
import { storeAttributes, type KeyMode } from './attributes';
import { buildEntity } from './entities';
import { colRef, eRef, fkRef, relRef, type Ctx, type EntityInfo, type RelState } from './context';
import { listColumns } from './names';
import { addParticipantFks, applyTableKeys, explainKey, tableTargets, warnTableParticipation } from './shared';

export function translateRelationships(c: Ctx): void {
  for (const rel of Object.values(c.er.relationships)) {
    if (c.consumed.has(rel.id)) continue;
    translate(c, rel);
  }
}

function omit(c: Ctx, rel: ErRelationship, ruleId: ConversionRuleId, why: string, whyKind: 'fewer' | 'missing-entity' | 'strategy' | 'weak-no-relation' | 'circular' | 'nokey' | 'merged-unavailable', extra: Record<string, string> = {}): void {
  c.trace(eRef.relationship(rel.id), [], ruleId);
  for (const p of rel.participants) c.trace(eRef.participant(rel.id, p.id), [], ruleId);
  c.decide({
    ruleId,
    tag: `omitted:${rel.id}`,
    title: `Relationship ${rel.name} was not converted`,
    explanation: `${why} Nothing was generated for it.`,
    sources: [eRef.relationship(rel.id)],
    level: 'warning',
    params: { kind: `relationship-omitted.${whyKind}`, relationship: rel.name, ...extra },
  });
}

function translate(c: Ctx, rel: ErRelationship): void {
  const analysis = analyzeRelationship(c.er, rel.id);
  if (!analysis) return omit(c, rel, 'n-ary-relation', 'The relationship has fewer than two participants.', 'fewer');
  if (rel.participants.some((p) => !c.er.entities[p.entityId])) {
    return omit(c, rel, 'n-ary-relation', 'A participant refers to an entity that does not exist.', 'missing-entity');
  }
  if (rel.identifying) {
    const identified = identifiedParticipants(c.er, rel);
    if (identified.length > 0) return translateIdentifying(c, rel, identified);
    c.warn({
      code: 'conv.identifying-unresolved',
      severity: 'warning',
      title: `Identifying relationship ${rel.name} has no identified participant`,
      explanation: `${rel.name} is marked identifying, but it is not clear which participant is the weak entity (flag one participant as identified, or have exactly one weak participant). It was converted as an ordinary relationship.`,
      suggestion: 'Mark the dependent participant as identified.',
      affected: [eRef.relationship(rel.id)],
      params: { relationship: rel.name },
    });
  }

  const override = c.options.relationshipOverrides[rel.id];
  const asRelation = override?.asRelation === true && analysis.shape !== 'n-ary';
  const infoOf = (id: string): EntityInfo | undefined => buildEntity(c, id);

  switch (analysis.shape) {
    case 'binary-M:N':
      return translateTable(c, rel, analysis, analysis.recursive ? 'recursive-many-to-many-relation' : 'many-to-many-relation', infoOf);
    case 'n-ary':
      return translateTable(c, rel, analysis, 'n-ary-relation', infoOf);
    case 'binary-1:N':
      if (asRelation) return translateTable(c, rel, analysis, 'n-ary-relation', infoOf);
      return translateFk(c, rel, analysis.manySide[0]!, analysis.oneSide[0]!, analysis.recursive ? 'recursive-one-to-many-fk' : 'one-to-many-fk', false, 'many-side');
    case 'binary-1:1': {
      const plan = c.merge.plans.get(rel.id);
      if (!plan) return omit(c, rel, 'one-to-one-fk', 'The 1:1 strategy could not be resolved.', 'strategy');
      if (plan.kind === 'relation') return translateTable(c, rel, analysis, 'one-to-one-relation', infoOf);
      if (plan.kind === 'merge') return translateMerged(c, rel, plan.group.primary);
      return translateFk(c, rel, plan.holder, plan.ref, 'one-to-one-fk', true, plan.reason);
    }
  }
}

// ----- relationship attributes -----------------------------------------------------------------------------------

function placeRelationshipAttributes(
  c: Ctx,
  rel: ErRelationship,
  st: RelState,
  o: { keyMode: KeyMode; forceNullable?: boolean; ruleId: ConversionRuleId; label: string; keyName: string; keyIds: () => string[] },
  attrs: ErAttribute[] = c.ownAttributes('relationship', rel.id),
): { keyColumns: RelColumn[]; otherColumns: RelColumn[] } {
  const placed = storeAttributes(c, attrs, {
    ruleId: 'relationship-attribute',
    ownerKey: rel.id,
    ownerName: rel.name,
    st,
    keyMode: o.keyMode,
    ...(o.forceNullable ? { forceNullable: true } : {}),
    host: { st, label: o.label, keyName: o.keyName, keyIds: o.keyIds },
  });
  if (placed.ignoredKeyAttributes.length > 0) {
    c.warn({
      code: 'conv.relationship-key-attr-folded',
      severity: 'warning',
      title: `Key flag of ${placed.ignoredKeyAttributes.map((a) => a.name).join(', ')} ignored`,
      explanation: `${rel.name} was translated into a foreign key, so no relationship relation exists whose key could include ${placed.ignoredKeyAttributes.map((a) => a.name).join(', ')}; the attribute became an ordinary column of ${st.relation.name}.`,
      suggestion: 'Model the relationship as M:N (or an associative entity) if it needs its own key.',
      affected: [...placed.ignoredKeyAttributes.map((a) => eRef.attribute(a.id)), relRef(st)],
      params: { attributes: placed.ignoredKeyAttributes.map((a) => a.name).join(', '), relationship: rel.name, relation: st.relation.name },
    });
  }
  const all = [...placed.keyColumns, ...placed.otherColumns];
  if (all.length > 0) {
    c.decide({
      ruleId: 'relationship-attribute',
      tag: rel.id,
      title: `Attributes of ${rel.name} stored in ${st.relation.name}`,
      explanation:
        `${listColumns(all.map((x) => x.name))} describe${all.length === 1 ? 's' : ''} the relationship ${rel.name}, so ${all.length === 1 ? 'it was' : 'they were'} placed in ${st.relation.name}` +
        `${o.forceNullable ? ', nullable because the relationship is optional there' : ''}. Relationship attributes are never dropped.`,
      sources: attrs.map((a) => eRef.attribute(a.id)),
      targets: all.map((x) => colRef(st, x)),
      params: {
        columns: listColumns(all.map((x) => x.name)),
        relationship: rel.name,
        relation: st.relation.name,
        verbS: all.length === 1 ? 'one' : 'many',
        itWas: all.length === 1 ? 'one' : 'many',
        nullMode: o.forceNullable ? 'yes' : 'no',
      },
    });
  }
  return placed;
}

// ----- identifying relationships ---------------------------------------------------------------------------------

function translateIdentifying(c: Ctx, rel: ErRelationship, identified: ErParticipant[]): void {
  const weakP = identified[0]!;
  const weakInfo = buildEntity(c, weakP.entityId);
  if (!weakInfo) return omit(c, rel, 'weak-entity-owner-key', 'The identified (weak) entity has no relation.', 'weak-no-relation');
  const records = c.ownerRecords.get(rel.id) ?? [];
  const fks = records.flatMap((r) => (r.fk ? [r.fk] : []));

  placeRelationshipAttributes(c, rel, weakInfo.st, {
    keyMode: 'folded',
    ruleId: 'relationship-attribute',
    label: weakInfo.entity.name,
    keyName: weakInfo.entity.name,
    keyIds: () => weakInfo.keyColumnIds,
  });

  c.trace(eRef.relationship(rel.id), [relRef(weakInfo.st), ...fks.map(fkRef)], 'weak-entity-owner-key');
  for (const p of rel.participants) {
    const isIdentified = identified.some((i) => i.id === p.id);
    const info = isIdentified ? buildEntity(c, p.entityId) : undefined;
    const rec = records.find((r) => r.ownerParticipant.id === p.id);
    const targets: SemanticRef[] = isIdentified ? (info ? [relRef(info.st)] : []) : rec?.fk ? [fkRef(rec.fk)] : [];
    c.trace(eRef.participant(rel.id, p.id), targets, 'weak-entity-owner-key');
  }
  c.decide({
    ruleId: 'weak-entity-owner-key',
    tag: rel.id,
    title: `Identifying relationship ${rel.name} creates no table`,
    explanation: `${rel.name} identifies ${weakInfo.entity.name}. It is represented by the owner key columns inside ${weakInfo.st.relation.name} and the foreign key${fks.length === 1 ? '' : 's'} to the owner${fks.length === 1 ? '' : 's'}; a separate relation would only duplicate that information.`,
    sources: [eRef.relationship(rel.id)],
    targets: [relRef(weakInfo.st), ...fks.map(fkRef)],
    params: { relationship: rel.name, entity: weakInfo.entity.name, relation: weakInfo.st.relation.name, s: fks.length === 1 ? 'one' : 'many' },
  });
}

// ----- FK on an entity relation (1:N, recursive 1:N, 1:1) --------------------------------------------------------

function translateFk(
  c: Ctx,
  rel: ErRelationship,
  holder: ErParticipant,
  ref: ErParticipant,
  ruleId: ConversionRuleId,
  unique: boolean,
  reason: string,
): void {
  const holderInfo = buildEntity(c, holder.entityId);
  const refInfo = buildEntity(c, ref.entityId);
  const holderEntity = c.er.entities[holder.entityId]!;
  const refEntity = c.er.entities[ref.entityId]!;
  // Explanations name the ROLE when there is one (essential for recursive relationships), else the entity.
  const holderName = holder.role?.trim() || holderEntity.name;
  const refName = ref.role?.trim() || refEntity.name;
  if (!holderInfo || !refInfo) return omit(c, rel, ruleId, 'A participating relation was not available (circular dependency).', 'circular');
  if (refInfo.keyColumnIds.length === 0) {
    return omit(c, rel, ruleId, `${refEntity.name} has no primary key, so a foreign key to it cannot be created.`, 'nokey', { entity: refEntity.name });
  }

  // A merged partner may be absent from its row, so FK columns and relationship attributes placed there must be nullable too.
  const partnerAbsent = holderInfo.optionalPartner === true;
  const nullable = holder.participation !== 'total' || partnerAbsent;
  const relSources = [eRef.participant(rel.id, holder.id), eRef.participant(rel.id, ref.id), eRef.relationship(rel.id)];
  const fkKey = `fk:${rel.id}:${holder.id}:${ref.id}`;
  const { columns, fk } = c.propagateKey({
    holder: holderInfo.st,
    target: refInfo,
    participant: ref,
    entity: refEntity,
    fkKey,
    ruleId,
    sources: relSources,
    nullable,
  });
  if (unique) {
    c.addUnique(holderInfo.st, { key: `unique:${fkKey}`, columnIds: columns.map((x) => x.id), ruleId, sources: relSources });
  }
  if (ref.participation === 'total') {
    fk.cardinality = { childMin: 1 };
    c.warn({
      code: 'conv.total-on-one-side-unenforceable',
      severity: 'info',
      title: `Total participation of ${refEntity.name} in ${rel.name} is not enforced`,
      explanation: `Every ${refName} must take part in ${rel.name} (have at least one ${holderName}). The foreign key on ${holderInfo.st.relation.name} guarantees only that each ${holderName} refers to an existing ${refName}; "at least one" cannot be expressed by a foreign key.`,
      suggestion: 'Enforce it in application logic or with a trigger; the foreign key is annotated with the intended minimum (childMin = 1).',
      affected: [eRef.participant(rel.id, ref.id), fkRef(fk)],
      params: {
        entity: refEntity.name,
        relationship: rel.name,
        refName,
        holderName,
        relation: holderInfo.st.relation.name,
      },
    });
  }

  const placed = placeRelationshipAttributes(c, rel, holderInfo.st, {
    keyMode: 'folded',
    ruleId: 'relationship-attribute',
    forceNullable: nullable,
    label: holderEntity.name,
    keyName: holderEntity.name,
    keyIds: () => holderInfo.keyColumnIds,
  });

  const fkTargets: SemanticRef[] = [fkRef(fk), ...columns.map((x) => colRef(holderInfo.st, x))];
  c.trace(eRef.relationship(rel.id), [...fkTargets, ...[...placed.keyColumns, ...placed.otherColumns].map((x) => colRef(holderInfo.st, x))], ruleId);
  c.trace(eRef.participant(rel.id, holder.id), [fkRef(fk)], ruleId);
  c.trace(eRef.participant(rel.id, ref.id), [fkRef(fk)], ruleId);

  const where = `${holderInfo.st.relation.name}.${listColumns(columns.map((x) => x.name))} → ${refInfo.st.relation.name}.${listColumns(
    c.keyColsOf(refInfo.st, refInfo.keyColumnIds).map((x) => x.name),
  )}`;
  const oneToOne = unique;
  c.decide({
    ruleId,
    tag: rel.id,
    title: oneToOne ? `1:1 ${rel.name}: foreign key on ${holderEntity.name}` : `${rel.name}: foreign key on the N side (${holderEntity.name})`,
    explanation:
      (oneToOne
        ? `${rel.name} is 1:1, so the key of ${refEntity.name} was placed in ${holderInfo.st.relation.name} as a foreign key (${where}) and made UNIQUE so at most one ${holderEntity.name} can refer to each ${refEntity.name}. ${oneToOneWhy(reason, holderEntity.name)} `
        : `In ${rel.name} each ${holderName} relates to at most one ${refName}, so the key of the "one" side (${refName}) was copied into the "many" side (${holderName}) as foreign key ${where}; the reverse would require a multi-valued column. `) +
      (nullable
        ? `The column${columns.length > 1 ? 's are' : ' is'} nullable because ${
            partnerAbsent && holder.participation === 'total'
              ? `${holderEntity.name} is the optional partner of a merged 1:1 relation (its columns are absent for rows without a ${holderEntity.name}); "${holderEntity.name} participates totally" is then enforceable only when its key is not NULL`
              : `${holderEntity.name} participates only partially`
          }.`
        : `The column${columns.length > 1 ? 's are' : ' is'} NOT NULL because ${holderEntity.name} participates totally.`),
    sources: [eRef.relationship(rel.id)],
    targets: fkTargets,
    params: {
      kind: oneToOne ? 'fk-one-to-one' : 'fk-n-side',
      relationship: rel.name,
      holderEntity: holderEntity.name,
      refEntity: refEntity.name,
      holderName,
      refName,
      relation: holderInfo.st.relation.name,
      where,
      why: ['total-side', 'both-total', 'explicit'].includes(reason) ? reason : 'default',
      nullMode: `${
        !nullable ? 'notnull' : partnerAbsent && holder.participation === 'total' ? 'absent' : 'partial'
      }.${columns.length > 1 ? 'many' : 'one'}`,
    },
  });

  if (reason === 'ambiguous') {
    c.warn({
      code: 'conv.one-to-one-ambiguous-placement',
      severity: 'warning',
      title: `Foreign key side of 1:1 ${rel.name} is arbitrary`,
      explanation: `Neither ${holderEntity.name} nor ${refEntity.name} participates totally in ${rel.name}, so nothing says which relation should hold the foreign key. It was placed on ${holderEntity.name} (first participant), nullable and UNIQUE.`,
      suggestion: 'Choose the FK side explicitly, merge the entities, or use a separate relation.',
      affected: [eRef.relationship(rel.id), fkRef(fk)],
      params: { relationship: rel.name, holder: holderEntity.name, ref: refEntity.name },
    });
  } else if (reason === 'both-total') {
    c.warn({
      code: 'conv.one-to-one-both-total',
      severity: 'info',
      title: `1:1 ${rel.name} is total on both sides`,
      explanation: `Both entities participate totally, so the FK on ${holderEntity.name} (first participant) is valid but merging ${holderEntity.name} and ${refEntity.name} into one relation is an equally good option. Foreign keys cannot enforce that every ${refEntity.name} also has a ${holderEntity.name}.`,
      suggestion: 'Consider the "merge" strategy for this relationship.',
      affected: [eRef.relationship(rel.id), fkRef(fk)],
      params: { relationship: rel.name, holder: holderEntity.name, ref: refEntity.name },
    });
  }
}

function oneToOneWhy(reason: string, holder: string): string {
  switch (reason) {
    case 'total-side':
      return `${holder} holds the key because it participates totally, which lets the column be NOT NULL.`;
    case 'both-total':
      return `Both sides are total; ${holder} (first participant) holds the key.`;
    case 'explicit':
      return `${holder} was chosen as the FK side by option.`;
    default:
      return `${holder} (first participant) holds the key by convention.`;
  }
}

// ----- merged 1:1 ------------------------------------------------------------------------------------------------

function translateMerged(c: Ctx, rel: ErRelationship, primary: ErParticipant): void {
  const info = buildEntity(c, primary.entityId);
  if (!info) return omit(c, rel, 'one-to-one-merge', 'The merged relation was not available.', 'merged-unavailable');
  placeRelationshipAttributes(c, rel, info.st, {
    keyMode: 'folded',
    ruleId: 'relationship-attribute',
    forceNullable: primary.participation !== 'total',
    label: info.entity.name,
    keyName: info.entity.name,
    keyIds: () => info.keyColumnIds,
  });
  c.trace(eRef.relationship(rel.id), [relRef(info.st)], 'one-to-one-merge');
  for (const p of rel.participants) c.trace(eRef.participant(rel.id, p.id), [relRef(info.st)], 'one-to-one-merge');
}

// ----- relationship relation (M:N, n-ary, 1:1 relation) ----------------------------------------------------------

function translateTable(
  c: Ctx,
  rel: ErRelationship,
  analysis: RelationshipAnalysis,
  ruleId: ConversionRuleId,
  infoOf: (id: string) => EntityInfo | undefined,
): void {
  const st = c.newRelation(rel.name, { ruleId, sources: [eRef.relationship(rel.id)], key: `${ruleId}:${rel.id}` });
  const fks = addParticipantFks(c, st, rel, ruleId, infoOf);
  const placed = placeRelationshipAttributes(c, rel, st, {
    keyMode: 'relationship',
    ruleId: 'relationship-attribute',
    label: rel.name,
    keyName: rel.name,
    keyIds: () => st.relation.primaryKey,
  });
  const { chosen, pkColumns } = applyTableKeys(c, st, rel, analysis, fks, { ruleId, attrKeyColumns: placed.keyColumns, entityKey: false });

  const targets = tableTargets(st, fks);
  c.trace(eRef.relationship(rel.id), [...targets, ...[...placed.keyColumns, ...placed.otherColumns].map((x) => colRef(st, x))], ruleId);
  for (const f of fks) c.trace(eRef.participant(rel.id, f.participant.id), f.fk ? [fkRef(f.fk)] : [], ruleId);
  warnTableParticipation(c, st, rel, fks);

  const keyNames = rel.participants.filter((p) => chosen.includes(p.id)).map((p) => c.er.entities[p.entityId]?.name ?? '?');
  const hasPk = pkColumns.length > 0;
  // without a primary key, name only the participants that have no key (they got no foreign key either)
  const keylessNames = fks.filter((f) => !f.fk).map((f) => f.entity?.name ?? '?');
  const missingNames = (keylessNames.length ? keylessNames : keyNames).join(', ');
  const attrMode = !hasPk || placed.keyColumns.length === 0 ? 'none' : placed.keyColumns.length === 1 ? 'one' : 'many';
  const naryMode = hasPk && analysis.shape === 'n-ary' && chosen.length < rel.participants.length ? 'yes' : 'no';
  const uniqueMode = !hasPk || st.relation.uniques.length === 0 ? 'none' : st.relation.uniques.length === 1 ? 'one' : 'many';
  c.decide({
    ruleId,
    tag: rel.id,
    title: `${rel.name} becomes relation ${st.relation.name}`,
    explanation:
      `${rel.name} (${shapeText(analysis)}) is represented by its own relation ${st.relation.name} with one foreign key per participant (${fks
        .map((f) => f.entity?.name ?? '?')
        .join(', ')}). ` +
      (hasPk
        ? `Its ${explainKey(st, pkColumns)} comes from the key participant${keyNames.length === 1 ? '' : 's'} ${keyNames.join(', ')}`
        : `No primary key could be formed because ${missingNames} ${keylessNames.length > 1 ? 'have' : 'has'} no key`) +
      `${attrMode !== 'none' ? ` plus the key attribute${attrMode === 'one' ? '' : 's'} ${placed.keyColumns.map((x) => x.name).join(', ')}` : ''}` +
      `${naryMode === 'yes' ? '; it is not automatically all foreign keys but follows the cardinalities' : ''}` +
      `${uniqueMode !== 'none' ? `, and the other candidate key${uniqueMode === 'one' ? '' : 's'} became UNIQUE` : ''}.`,
    sources: [eRef.relationship(rel.id)],
    targets,
    params: {
      kind: 'relationship-table',
      relationship: rel.name,
      relation: st.relation.name,
      shape: shapeText(analysis),
      shapeBase: analysis.shape === 'n-ary' ? '@i18n:decisions.word.nary' : analysis.shape.replace('binary-', ''),
      rec: analysis.recursive ? 'yes' : 'no',
      participants: fks.map((f) => f.entity?.name ?? '?').join(', '),
      pk: listColumns(pkColumns.map((x) => x.name)),
      pkMode: !hasPk ? (keylessNames.length > 1 ? 'noneMany' : 'none') : keyNames.length === 1 ? 'one' : 'many',
      keyNames: hasPk ? keyNames.join(', ') : missingNames,
      attrMode,
      attrNames: placed.keyColumns.map((x) => x.name).join(', '),
      naryMode,
      uniqueMode,
    },
  });
}

function shapeText(a: RelationshipAnalysis): string {
  const base = a.shape === 'n-ary' ? 'n-ary' : a.shape.replace('binary-', '');
  return a.recursive ? `recursive ${base}` : base;
}
