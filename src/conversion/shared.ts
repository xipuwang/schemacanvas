/** Pieces shared by every "relation for a relationship" translation (M:N, n-ary, 1:1-as-relation, associative entity). */
import type { RelationshipAnalysis } from '@/model/erSemantics';
import type { ErEntity, ErParticipant, ErRelationship, ForeignKey, Id, RelColumn, SemanticRef } from '@/model/types';
import type { ConversionRuleId } from '@/model/conversionRules';
import { colRef, eRef, fkRef, relRef, type Ctx, type EntityInfo, type RelState } from './context';
import { listColumns } from './names';

export interface ParticipantFk {
  participant: ErParticipant;
  entity?: ErEntity;
  columns: RelColumn[];
  fk?: ForeignKey;
}

const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** One FK (NOT NULL columns) per participant, in participant order. A participant without a usable key gets no FK. */
export function addParticipantFks(
  c: Ctx,
  st: RelState,
  rel: ErRelationship,
  ruleId: ConversionRuleId,
  infoOf: (entityId: Id) => EntityInfo | undefined,
): ParticipantFk[] {
  return rel.participants.map((participant): ParticipantFk => {
    const entity = c.er.entities[participant.entityId];
    const info = infoOf(participant.entityId);
    if (!entity || !info || info.keyColumnIds.length === 0) {
      c.decide({
        ruleId,
        tag: `no-fk:${participant.id}`,
        title: `No foreign key for ${entity?.name ?? 'a participant'} in ${rel.name}`,
        explanation: info
          ? `${entity?.name} has no primary key, so there is nothing for ${rel.name} to reference. Give the entity a key attribute and convert again.`
          : `The relation of ${entity?.name ?? 'the participating entity'} was not available while ${rel.name} was converted (circular dependency), so no foreign key could be created.`,
        sources: [eRef.participant(rel.id, participant.id)],
        level: 'warning',
        ...(entity ? { params: { kind: info ? 'participant-no-fk.nokey' : 'participant-no-fk.unavailable', entity: entity.name, relationship: rel.name } } : {}),
      });
      return { participant, ...(entity ? { entity } : {}), columns: [] };
    }
    const { columns, fk } = c.propagateKey({
      holder: st,
      target: info,
      participant,
      entity,
      fkKey: `fk:${rel.id}:${participant.id}`,
      ruleId,
      sources: [eRef.participant(rel.id, participant.id), eRef.relationship(rel.id)],
      nullable: false,
    });
    // childMin = 1 states "every referenced row has >= 1 child" (total participation) — documentation only, not enforceable.
    if (participant.participation === 'total') fk.cardinality = { childMin: 1 };
    return { participant, entity, columns, fk };
  });
}

/** Chosen key (participant ids): the user's `keyParticipantIds` when it is a superkey, else the first candidate key. */
export function chooseKey(c: Ctx, rel: ErRelationship, analysis: RelationshipAnalysis): { chosen: Id[]; fellBack: boolean } {
  const existing = analysis.chosenKey.filter((id) => rel.participants.some((p) => p.id === id));
  const valid = analysis.keySource === 'derived' || (existing.length > 0 && existing.length === analysis.chosenKey.length && analysis.chosenKeyValid);
  if (valid) return { chosen: existing, fellBack: false };
  const fallback = analysis.candidateKeys[0]!;
  c.warn({
    code: 'conv.relationship-key-fallback',
    severity: 'warning',
    title: `Key of ${rel.name} replaced by a candidate key`,
    explanation: `The chosen key participants of ${rel.name} do not contain a key implied by its cardinalities, so the primary key of the generated relation uses the first candidate key instead.`,
    suggestion: 'Choose key participants that include a candidate key, or fix the cardinalities.',
    affected: [eRef.relationship(rel.id)],
    params: { relationship: rel.name },
  });
  return { chosen: fallback, fellBack: true };
}

/**
 * Primary key + UNIQUEs of a relationship relation. Normal case: PK = FK columns of the chosen participants + the
 * relationship's own `primary` attributes; every other candidate key becomes UNIQUE. Associative entity with its own
 * key attributes (`entityKey`): PK = those attributes, EVERY candidate key becomes UNIQUE.
 */
export function applyTableKeys(
  c: Ctx,
  st: RelState,
  rel: ErRelationship,
  analysis: RelationshipAnalysis,
  fks: ParticipantFk[],
  o: { ruleId: ConversionRuleId; attrKeyColumns: RelColumn[]; entityKey: boolean },
): { chosen: Id[]; pkColumns: RelColumn[] } {
  const { chosen } = chooseKey(c, rel, analysis);
  const colsFor = (ids: Id[]): RelColumn[] => fks.filter((f) => ids.includes(f.participant.id)).flatMap((f) => f.columns);
  const complete = (ids: Id[]): boolean => ids.every((id) => (fks.find((f) => f.participant.id === id)?.columns.length ?? 0) > 0);

  // A key participant without FK columns (keyless entity) would silently shrink the key and invent a uniqueness
  // constraint, so in that case no primary key is generated (validation then reports it).
  const incomplete = !o.entityKey && !complete(chosen);
  const pkColumns = incomplete ? [] : o.entityKey ? o.attrKeyColumns : [...colsFor(chosen), ...o.attrKeyColumns];
  if (incomplete) {
    c.decide({
      ruleId: o.ruleId,
      tag: `no-key:${rel.id}`,
      title: `${rel.name} has no primary key`,
      explanation: `A participant of the key of ${rel.name} has no primary key to reference, so using only the remaining foreign keys would claim a uniqueness the ER model never stated. No primary key was generated; give the keyless entity a key and convert again.`,
      sources: [eRef.relationship(rel.id)],
      level: 'warning',
      params: { kind: 'relationship-no-key', relationship: rel.name },
    });
  }
  c.setPrimaryKey(st, pkColumns.map((x) => x.id));
  const others = o.entityKey ? analysis.candidateKeys : analysis.candidateKeys.filter((k) => !sameSet(k, chosen));
  for (const key of others) {
    if (!complete(key)) continue;
    const cols = [...colsFor(key), ...(o.entityKey ? [] : o.attrKeyColumns)];
    const ids = cols.map((x) => x.id);
    if (ids.length === 0 || sameSet(ids, st.relation.primaryKey)) continue;
    if (st.relation.uniques.some((u) => sameSet(u.columnIds, ids))) continue;
    c.addUnique(st, {
      key: `unique:${rel.id}:${key.join('+')}`,
      columnIds: ids,
      ruleId: o.ruleId,
      sources: [...key.map((id) => eRef.participant(rel.id, id)), eRef.relationship(rel.id)],
    });
  }
  return { chosen, pkColumns };
}

/** Total participation in a relationship relation cannot be enforced by FKs: every instance must appear in the table. */
export function warnTableParticipation(c: Ctx, st: RelState, rel: ErRelationship, fks: ParticipantFk[]): void {
  for (const f of fks) {
    if (f.participant.participation !== 'total' || !f.entity) continue;
    c.warn({
      code: 'conv.total-participation-unenforceable',
      severity: 'info',
      title: `Total participation of ${f.entity.name} in ${rel.name} is not enforced`,
      explanation: `Every ${f.entity.name} must take part in ${rel.name}, i.e. appear in ${st.relation.name}. A foreign key only guarantees the opposite direction (every row of ${st.relation.name} refers to an existing ${f.entity.name}); "at least one row" needs an application check, a trigger or a deferred constraint.`,
      suggestion: 'Enforce it in application logic or with a database trigger; the foreign key is annotated with the intended minimum.',
      affected: [eRef.participant(rel.id, f.participant.id), relRef(st)],
      params: { entity: f.entity.name, relationship: rel.name, relation: st.relation.name },
    });
  }
}

export function explainKey(st: RelState, pkColumns: RelColumn[]): string {
  return pkColumns.length > 0 ? `primary key ${listColumns(pkColumns.map((x) => x.name))}` : 'no primary key';
}

/** Sources/targets helpers used by several decisions. */
export function tableTargets(st: RelState, fks: ParticipantFk[]): SemanticRef[] {
  return [
    relRef(st),
    ...fks.flatMap((f) => (f.fk ? [fkRef(f.fk), ...f.columns.map((col) => colRef(st, col))] : [])),
  ];
}
