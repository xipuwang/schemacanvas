/**
 * ER (Chen) validation rules. Every fact comes from model/erSemantics and model/queries; rules only decide
 * whether a fact is a definite error, a warning or a design recommendation (info). Unconventional-but-valid
 * designs are never raised above `info`.
 */
import {
  analyzeRelationship,
  identificationOrder,
  identifiedParticipants,
  relationshipCandidateKeys,
  weakEntityOwners,
} from '@/model/erSemantics';
import { isRecursiveRelationship, sqlNameKey } from '@/model/queries';
import type { ErAttribute, ErEntity, ErModel, ErRelationship, Id, SemanticRef, Severity } from '@/model/types';
import type { ErRule, IssueDraft } from './types';
import { arrayOf, byNameThenId, duplicatesOnly, groupBy, lookup, nameOf, quote, quoteAll } from './util';

const entityRef = (e: ErEntity): SemanticRef => ({ kind: 'entity', id: e.id });
const attrRef = (a: ErAttribute): SemanticRef => ({
  kind: 'attribute',
  id: a.id,
});
const relRef = (r: ErRelationship): SemanticRef => ({
  kind: 'relationship',
  id: r.id,
});
const partRef = (r: ErRelationship, id: Id): SemanticRef => ({
  kind: 'participant',
  relationshipId: r.id,
  id,
});

const entities = (m: Readonly<ErModel>): ErEntity[] => Object.values(m.entities);
const relationships = (m: Readonly<ErModel>): ErRelationship[] => Object.values(m.relationships);
const attributes = (m: Readonly<ErModel>): ErAttribute[] => Object.values(m.attributes);
const entityName = (m: Readonly<ErModel>, id: Id): string => nameOf(entOf(m, id)?.name);

// Own-key lookups: a hand-edited `entityId: "constructor"` must not find Object.prototype members.
const entOf = (m: Readonly<ErModel>, id: unknown): ErEntity | undefined => lookup(m.entities, id);
const relshipOf = (m: Readonly<ErModel>, id: unknown): ErRelationship | undefined => lookup(m.relationships, id);
const attrOf = (m: Readonly<ErModel>, id: unknown): ErAttribute | undefined => lookup(m.attributes, id);

/**
 * Owner -> attributes index (sorted by `order`, then id), built ONCE per model: ER rules ask for the attributes of every
 * entity, and `attributesOf` filters the whole attribute table on every call (quadratic).
 */
let attrIndexCache = new WeakMap<object, Map<string, ErAttribute[]>>();
function attributeIndex(m: Readonly<ErModel>): Map<string, ErAttribute[]> {
  let idx = attrIndexCache.get(m);
  if (!idx) {
    idx = new Map();
    for (const a of attributes(m)) {
      const key = `${a.owner?.kind}:${a.owner?.id}`;
      const list = idx.get(key);
      if (list) list.push(a);
      else idx.set(key, [a]);
    }
    for (const list of idx.values()) list.sort((x, y) => x.order - y.order || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    attrIndexCache.set(m, idx);
  }
  return idx;
}
const entityAttrs = (m: Readonly<ErModel>, e: ErEntity): ErAttribute[] => attributeIndex(m).get(`entity:${e.id}`) ?? [];

/**
 * Drop the per-model indexes. The engine calls this at the start of every `validateModel`, because a caller may
 * mutate and re-validate the same model object: the caches are only valid inside ONE validation pass.
 */
export function resetErCaches(): void {
  attrIndexCache = new WeakMap();
  ordCache = new WeakMap();
}

/** `identificationOrder` once per model (it is shared by several rules and is the costly part of weak-entity checks). */
let ordCache = new WeakMap<object, ReturnType<typeof identificationOrder>>();
const identification = (m: Readonly<ErModel>): ReturnType<typeof identificationOrder> => {
  let r = ordCache.get(m);
  if (!r) {
    r = identificationOrder(m as ErModel);
    ordCache.set(m, r);
  }
  return r;
};

function rule(code: string, severity: Severity, description: string, check: ErRule['check']): ErRule {
  return { code, appliesTo: 'er', severity, description, check };
}

/** Language-neutral label (`Entity` or `Entity/role`) for translated messages; the English text keeps `partLabel`. */
const partLabelNeutral = (m: Readonly<ErModel>, r: ErRelationship, id: Id): string => {
  const p = r.participants.find((x) => x.id === id);
  if (!p) return '?';
  const role = nameOf(p.role).trim();
  return role ? `${quote(entityName(m, p.entityId))}/${quote(role)}` : quote(entityName(m, p.entityId));
};

/** Participant role/entity label used in messages. */
const partLabel = (m: Readonly<ErModel>, r: ErRelationship, id: Id): string => {
  const p = r.participants.find((x) => x.id === id);
  if (!p) return '?';
  const role = nameOf(p.role).trim();
  return role ? `${quote(entityName(m, p.entityId))} (role ${quote(role)})` : quote(entityName(m, p.entityId));
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const entityNameEmpty = rule('er.entity-name-empty', 'error', 'An entity has an empty name.', (m) =>
  entities(m)
    .filter((e) => !nameOf(e.name).trim())
    .map((e) => ({
      title: 'Entity has no name',
      explanation: 'Every entity becomes a relation, and a relation cannot be created without a name.',
      suggestion: 'Give the entity a name.',
      affected: [entityRef(e)],
    })),
);

const relationshipNameEmpty = rule('er.relationship-name-empty', 'error', 'A relationship has an empty name.', (m) =>
  relationships(m)
    .filter((r) => !nameOf(r.name).trim())
    .map((r) => ({
      title: 'Relationship has no name',
      explanation: 'A relationship needs a verb-like name; M:N and n-ary relationships become relations named after it.',
      suggestion: 'Give the relationship a name such as "Works_for".',
      affected: [relRef(r)],
    })),
);

const attributeNameEmpty = rule('er.attribute-name-empty', 'error', 'An attribute has an empty name.', (m) =>
  attributes(m)
    .filter((a) => !nameOf(a.name).trim())
    .map((a) => ({
      title: 'Attribute has no name',
      explanation: 'Every stored attribute becomes a column, and a column cannot be created without a name.',
      suggestion: 'Give the attribute a name.',
      affected: [attrRef(a)],
    })),
);

const entityNameDuplicate = rule('er.entity-name-duplicate', 'error', 'Two entities have the same name (case-insensitive).', (m) =>
  duplicatesOnly(groupBy(entities(m), (e) => sqlNameKey(nameOf(e.name)) || undefined)).map(([, unsorted]) => {
    const group = [...unsorted].sort(byNameThenId);
    return {
      title: `Duplicate entity name ${quote(nameOf(group[0]!.name))}`,
      explanation: `${group.length} entities share this name. Each entity becomes a relation, and relation names must be unique.`,
      suggestion: 'Rename one of the entities, or merge them if they model the same concept.',
      affected: group.map(entityRef),
      params: { name: nameOf(group[0]!.name).trim(), count: group.length },
    };
  }),
);

const relationshipNameDuplicate = rule(
  'er.relationship-name-duplicate',
  'warning',
  'Two relationships have the same name (case-insensitive).',
  (m) =>
    duplicatesOnly(groupBy(relationships(m), (r) => sqlNameKey(nameOf(r.name)) || undefined)).map(([, unsorted]) => {
      const group = [...unsorted].sort(byNameThenId);
      return {
        title: `Duplicate relationship name ${quote(nameOf(group[0]!.name))}`,
        explanation: `${group.length} relationships share this name. Chen diagrams allow it, but relationship relations of an M:N or n-ary conversion would collide and get numeric suffixes.`,
        suggestion: 'Give the relationships distinct names (e.g. "Teaches" and "Attends").',
        affected: group.map(relRef),
        params: { name: nameOf(group[0]!.name).trim(), count: group.length },
      };
    }),
);

const attributeNameDuplicate = rule(
  'er.attribute-name-duplicate',
  'error',
  'Two attributes of the same owner have the same name (case-insensitive).',
  (m) => {
    const out: IssueDraft[] = [];
    const byOwner = groupBy(attributes(m), (a) => `${a.owner.kind}:${a.owner.id}`);
    for (const siblings of byOwner.values()) {
      for (const [, unsorted] of duplicatesOnly(groupBy(siblings, (a) => sqlNameKey(nameOf(a.name)) || undefined))) {
        const group = [...unsorted].sort(byNameThenId);
        const owner = group[0]!.owner;
        const ownerName =
          owner.kind === 'entity'
            ? entityName(m, owner.id)
            : owner.kind === 'relationship'
              ? nameOf(relshipOf(m, owner.id)?.name)
              : nameOf(attrOf(m, owner.id)?.name);
        out.push({
          title: `Duplicate attribute name ${quote(nameOf(group[0]!.name))}`,
          explanation: `${group.length} attributes of ${quote(ownerName)} share this name; they would become columns with the same name.`,
          suggestion: 'Rename one of the attributes.',
          affected: group.map(attrRef),
          params: {
            name: nameOf(group[0]!.name).trim(),
            owner: ownerName,
            count: group.length,
          },
        });
      }
    }
    return out;
  },
);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const entityNoKey = rule(
  'er.entity-no-key',
  'warning',
  'A strong entity has no key attribute, so its relation would have no primary key.',
  (m) =>
    entities(m)
      // Weak entities are covered by the weak-* rules; an associative entity may take its key from its relationship.
      .filter((e) => !e.weak && !e.associativeOf)
      .filter((e) => !entityAttrs(m, e).some((a) => a.key === 'primary'))
      .map((e) => ({
        title: `Entity ${quote(nameOf(e.name))} has no key`,
        explanation:
          'A strong entity needs at least one key attribute (underlined) to identify its instances; without it the generated relation has no primary key.',
        suggestion: 'Mark one or more attributes as the primary key, or make the entity weak if it depends on an owner.',
        affected: [entityRef(e)],
        params: { entity: nameOf(e.name).trim() },
      })),
);

const keyOnSubattribute = rule(
  'er.key-on-subattribute',
  'warning',
  'A sub-attribute of a composite attribute is marked as a key; the flag is ignored.',
  (m) =>
    attributes(m)
      .filter((a) => a.owner.kind === 'attribute' && a.key !== 'none')
      .map((a) => ({
        title: `Key flag on sub-attribute ${quote(nameOf(a.name))} is ignored`,
        explanation:
          'Only top-level attributes can be keys. The leaves of a composite attribute inherit the key flag of the top-level attribute, so this flag has no effect.',
        suggestion: 'Move the key flag to the composite attribute (all of its leaves become key columns), or clear it.',
        affected: [attrRef(a)],
        params: { attribute: nameOf(a.name).trim() },
      })),
);

const keyOptional = rule(
  'er.key-optional',
  'warning',
  'A key attribute is marked optional; the flag is ignored because key columns are always NOT NULL.',
  (m) =>
    attributes(m)
      .filter((a) => a.owner.kind !== 'attribute' && a.key !== 'none' && a.optional === true)
      .map((a) => ({
        title: `Optional flag on key attribute ${quote(nameOf(a.name))} is ignored`,
        explanation: 'A key attribute identifies instances and is always converted to a NOT NULL column, so "optional" has no effect.',
        suggestion: 'Clear the optional flag, or remove the key flag if the value may be absent.',
        affected: [attrRef(a)],
        params: { attribute: nameOf(a.name).trim() },
      })),
);

const weakPrimaryKey = rule(
  'er.weak-primary-key',
  'warning',
  'A weak entity has attributes marked as primary key; they are treated as partial keys.',
  (m) =>
    entities(m)
      .filter((e) => e.weak)
      .flatMap((e) => {
        const prim = entityAttrs(m, e).filter((a) => a.key === 'primary');
        if (prim.length === 0) return [];
        return [
          {
            title: `Weak entity ${quote(nameOf(e.name))} has a full key`,
            explanation: `A weak entity has no key of its own: its key is the owner's key plus a partial key. ${quoteAll(prim.map((a) => nameOf(a.name)))} will be converted like a partial key.`,
            suggestion: 'Mark the attribute as a partial key (dashed underline) instead, or make the entity strong.',
            affected: [entityRef(e), ...prim.map(attrRef)],
            params: { entity: nameOf(e.name).trim(), attributes: quoteAll(prim.map((a) => nameOf(a.name))) },
          },
        ];
      }),
);

const partialKeyOnStrong = rule(
  'er.partial-key-on-strong',
  'warning',
  'A strong entity has a partial-key attribute; it is treated as an ordinary attribute.',
  (m) =>
    entities(m)
      .filter((e) => !e.weak)
      .flatMap((e) => {
        const partial = entityAttrs(m, e).filter((a) => a.key === 'partial');
        if (partial.length === 0) return [];
        return [
          {
            title: `Partial key on strong entity ${quote(nameOf(e.name))}`,
            explanation: `A partial key only makes sense for weak entities. ${quoteAll(partial.map((a) => nameOf(a.name)))} is converted as an ordinary attribute.`,
            suggestion:
              'Make the entity weak (and add an identifying relationship), or turn the attribute into a primary key or plain attribute.',
            affected: [entityRef(e), ...partial.map(attrRef)],
            params: { entity: nameOf(e.name).trim(), attributes: quoteAll(partial.map((a) => nameOf(a.name))) },
          },
        ];
      }),
);

const keyMultivalued = rule('er.key-multivalued', 'error', 'A key attribute is multivalued.', (m) =>
  attributes(m)
    .filter((a) => a.owner.kind !== 'attribute' && a.key !== 'none' && a.multivalued)
    .map((a) => ({
      title: `Key attribute ${quote(nameOf(a.name))} is multivalued`,
      explanation: 'A multivalued attribute becomes a separate relation, so it cannot be part of the key of its own entity.',
      suggestion: 'Remove the key flag, or make the attribute single-valued.',
      affected: [attrRef(a)],
      params: { attribute: nameOf(a.name).trim() },
    })),
);

const keyDerived = rule('er.key-derived', 'error', 'A key attribute is derived.', (m) =>
  attributes(m)
    .filter((a) => a.owner.kind !== 'attribute' && a.key !== 'none' && a.derived)
    .map((a) => ({
      title: `Key attribute ${quote(nameOf(a.name))} is derived`,
      explanation: 'Derived attributes are not stored, so they cannot identify rows.',
      suggestion: 'Remove the key flag, or make the attribute a stored (non-derived) attribute.',
      affected: [attrRef(a)],
      params: { attribute: nameOf(a.name).trim() },
    })),
);

// ---------------------------------------------------------------------------
// Weak entities & identifying relationships
// ---------------------------------------------------------------------------

/** Entities that already carry a more specific identification problem (avoids double reporting). */
function entitiesWithIdentificationProblem(m: Readonly<ErModel>): Set<Id> {
  const out = new Set<Id>();
  for (const cycle of identification(m).cycles) for (const id of cycle) out.add(id);
  for (const r of relationships(m)) {
    if (r.identifying && identifiedParticipants(m, r).length === 0) for (const p of r.participants) out.add(p.entityId);
  }
  return out;
}

const weakNoOwner = rule('er.weak-no-owner', 'error', 'A weak entity has no identifying owner.', (m) => {
  const problem = entitiesWithIdentificationProblem(m);
  return entities(m)
    .filter((e) => e.weak && !e.associativeOf && !problem.has(e.id) && weakEntityOwners(m, e.id).length === 0)
    .map((e) => ({
      title: `Weak entity ${quote(nameOf(e.name))} has no owner`,
      explanation:
        'A weak entity is identified through an identifying relationship to an owner entity. None connects to it, so its primary key cannot be built.',
      suggestion: 'Connect it to its owner with an identifying relationship (double diamond), or make the entity strong.',
      affected: [entityRef(e)],
      params: { entity: nameOf(e.name).trim() },
    }));
});

/** Every identifying participation of `e` has max 'one': the owner key alone identifies the instance (no discriminator needed). */
function atMostOnePerOwner(m: Readonly<ErModel>, e: ErEntity): boolean {
  const mine = relationships(m)
    .filter((r) => r.identifying && r.participants.length >= 2)
    .flatMap((r) => identifiedParticipants(m as ErModel, r).filter((p) => p.entityId === e.id));
  return mine.length > 0 && mine.every((p) => p.max === 'one');
}

const weakNoPartialKey = rule('er.weak-no-partial-key', 'warning', 'A weak entity has no partial key (discriminator).', (m) =>
  entities(m)
    .filter((e) => e.weak && !e.associativeOf) // an associative weak entity is reported by er.associative-weak
    .filter((e) => !entityAttrs(m, e).some((a) => a.key === 'partial' || a.key === 'primary'))
    .filter((e) => !atMostOnePerOwner(m, e))
    .map((e) => ({
      title: `Weak entity ${quote(nameOf(e.name))} has no partial key`,
      explanation:
        'Without a partial key, two instances of this weak entity with the same owner cannot be told apart (unless there is at most one per owner).',
      suggestion: 'Mark an attribute as the partial key (dashed underline).',
      affected: [entityRef(e)],
      params: { entity: nameOf(e.name).trim() },
    })),
);

const identifyingRels = (m: Readonly<ErModel>): ErRelationship[] =>
  relationships(m).filter((r) => r.identifying && r.participants.length >= 2);

const identifyingAmbiguous = rule(
  'er.identifying-ambiguous',
  'error',
  'An identifying relationship has several weak participants and none is marked as the identified one.',
  (m) =>
    identifyingRels(m)
      .filter((r) => identifiedParticipants(m, r).length === 0)
      .filter((r) => r.participants.filter((p) => entOf(m, p.entityId)?.weak).length >= 2)
      .map((r) => ({
        title: `Identifying relationship ${quote(nameOf(r.name))} is ambiguous`,
        explanation:
          'More than one participant is a weak entity and none is flagged as the identified side, so it is unclear who owns whom. The converter treats it as non-identifying.',
        suggestion: 'Mark exactly the dependent participant as identified in the relationship properties.',
        affected: [relRef(r), ...r.participants.filter((p) => entOf(m, p.entityId)?.weak).map((p) => partRef(r, p.id))],
        params: { relationship: nameOf(r.name).trim() },
      })),
);

const identifyingIdentifiesNothing = rule(
  'er.identifying-identifies-nothing',
  'error',
  'An identifying relationship has no weak entity to identify.',
  (m) =>
    identifyingRels(m)
      .filter((r) => identifiedParticipants(m, r).length === 0)
      .filter((r) => !r.participants.some((p) => entOf(m, p.entityId)?.weak))
      .filter((r) => !entities(m).some((e) => e.associativeOf === r.id)) // reported by er.associative-identifying
      .map((r) => ({
        title: `Identifying relationship ${quote(nameOf(r.name))} identifies nothing`,
        explanation: 'A double diamond connects a weak entity to its owner, but none of its participants is weak.',
        suggestion: 'Make the dependent entity weak, or turn the relationship into an ordinary (single-diamond) relationship.',
        affected: [relRef(r)],
        params: { relationship: nameOf(r.name).trim() },
      })),
);

const identifiedNotWeak = rule(
  'er.identified-not-weak',
  'warning',
  'The identified participant of an identifying relationship is not a weak entity.',
  (m) =>
    identifyingRels(m).flatMap((r) =>
      r.participants
        .filter((p) => p.identified && entOf(m, p.entityId) && !entOf(m, p.entityId)!.weak)
        .map((p) => ({
          title: `Identified entity ${quote(entityName(m, p.entityId))} is not weak`,
          explanation: `${quote(nameOf(r.name))} marks this participant as identified (dependent) but the entity is drawn as a strong entity.`,
          suggestion: 'Make the entity weak, or clear the identified flag.',
          affected: [partRef(r, p.id), entityRef(entOf(m, p.entityId)!)],
          params: {
            relationship: nameOf(r.name).trim(),
            entity: entityName(m, p.entityId),
          },
        })),
    ),
);

const identifyingPartial = rule(
  'er.identifying-partial',
  'error',
  'The identified (weak) side of an identifying relationship does not participate totally.',
  (m) =>
    identifyingRels(m).flatMap((r) =>
      identifiedParticipants(m, r)
        .filter((p) => p.participation !== 'total')
        .map((p) => ({
          title: `Weak side of ${quote(nameOf(r.name))} is not total`,
          explanation: `Every instance of ${quote(entityName(m, p.entityId))} exists only through its owner, so its participation in the identifying relationship must be total (double line).`,
          suggestion: 'Set the participation of the weak entity to total.',
          affected: [partRef(r, p.id), relRef(r)],
          params: {
            relationship: nameOf(r.name).trim(),
            entity: entityName(m, p.entityId),
          },
        })),
    ),
);

const identifyingOwnerMany = rule(
  'er.identifying-owner-many',
  'warning',
  "An owner of an identifying relationship has cardinality 'many': one weak instance would have several owners.",
  (m) =>
    identifyingRels(m).flatMap((r) => {
      const identified = identifiedParticipants(m, r);
      if (identified.length === 0) return [];
      return r.participants
        .filter((p) => !identified.some((i) => i.id === p.id) && p.max === 'many')
        .map((p) => ({
          title: `Owner ${quote(entityName(m, p.entityId))} of ${quote(nameOf(r.name))} is 'many'`,
          explanation:
            "Cardinality labels read across the relationship: 'many' next to the owner means one weak instance could belong to several owner instances, which contradicts identification by the owner's key.",
          suggestion: "Set the owner's cardinality to 1 (the weak entity side is the 'many' side).",
          affected: [partRef(r, p.id), relRef(r)],
          params: {
            relationship: nameOf(r.name).trim(),
            entity: entityName(m, p.entityId),
          },
        }));
    }),
);

const weakOwnershipCycle = rule(
  'er.weak-ownership-cycle',
  'error',
  'Weak entities identify each other in a cycle (including self-ownership).',
  (m) =>
    identification(m).cycles.map((unordered) => {
      // Members sorted by (name, id): the model's traversal order depends on record key order.
      const cycle = unordered
        .map((id) => ({ id, name: entityName(m, id) }))
        .sort(byNameThenId)
        .map((x) => x.id);
      const names = cycle.map((id) => entityName(m, id));
      return {
        title: `Identification cycle: ${names.map(quote).join(', ')}`,
        explanation: 'Each of these entities needs the full key of another one in the cycle, so no primary key can be derived.',
        suggestion: 'Break the cycle: make one entity strong (give it its own key) or remove one identifying relationship.',
        affected: cycle
          .map((id) => entOf(m, id))
          .filter((e): e is ErEntity => !!e)
          .map(entityRef),
        params: { entities: names.join(', '), entitiesQuoted: names.map(quote).join(', ') },
      };
    }),
);

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

const relationshipTooFew = rule(
  'er.relationship-too-few-participants',
  'error',
  'A relationship connects fewer than two participants.',
  (m) =>
    relationships(m)
      .filter((r) => r.participants.length < 2)
      .map((r) => ({
        title: `Relationship ${quote(nameOf(r.name))} has ${r.participants.length} participant${r.participants.length === 1 ? '' : 's'}`,
        explanation: 'A relationship relates at least two participants (a recursive relationship uses the same entity twice).',
        suggestion: 'Connect the relationship to another entity, or delete it.',
        affected: [relRef(r), ...r.participants.map((p) => partRef(r, p.id))],
        params: {
          relationship: nameOf(r.name).trim(),
          count: r.participants.length,
        },
      })),
);

const participantMissingEntity = rule(
  'er.participant-missing-entity',
  'error',
  'A relationship participant points at an entity that does not exist.',
  (m) =>
    relationships(m).flatMap((r) =>
      r.participants
        .filter((p) => !entOf(m, p.entityId))
        .map((p) => ({
          title: `Relationship ${quote(nameOf(r.name))} has a dangling participant`,
          explanation: 'One of its participants references an entity that was deleted.',
          suggestion: 'Connect the participant to an existing entity or remove it.',
          affected: [partRef(r, p.id), relRef(r)],
          params: { relationship: nameOf(r.name).trim() },
        })),
    ),
);

const relationshipKeyVsCardinality = rule(
  'er.relationship-key-vs-cardinality',
  'error',
  'The chosen key participants of a relationship are not a superkey implied by its cardinalities.',
  (m) =>
    relationships(m)
      .filter((r) => r.participants.length >= 2 && !r.identifying && arrayOf<Id>(r.keyParticipantIds).length > 0)
      .flatMap((r) => {
        const known = new Set(r.participants.map((p) => p.id));
        const chosen = arrayOf<Id>(r.keyParticipantIds);
        const unknown = chosen.filter((id) => !known.has(id));
        const analysis = analyzeRelationship(m, r.id);
        const valid = analysis ? relationshipCandidateKeys(r).some((k) => k.every((id) => chosen.includes(id))) : true;
        if (unknown.length === 0 && valid) return [];
        const candidates = relationshipCandidateKeys(r)
          .map((k) => `(${k.map((id) => partLabel(m, r, id)).join(', ')})`)
          .join(' or ');
        const reasons: string[] = [];
        if (unknown.length > 0) reasons.push(`${unknown.length} chosen key participant(s) no longer belong to the relationship`);
        if (!valid) reasons.push(`the chosen participants do not contain any key implied by the cardinalities, which is ${candidates}`);
        return [
          {
            title: `Key of ${quote(nameOf(r.name))} conflicts with its cardinalities`,
            explanation: `${reasons.join('; ')}. The converter falls back to the first implied key.`,
            suggestion: 'Choose a key that contains a candidate key, or adjust the cardinalities.',
            affected: [relRef(r), ...r.participants.filter((p) => chosen.includes(p.id)).map((p) => partRef(r, p.id))],
            params: {
              relationship: nameOf(r.name).trim(),
              variant: unknown.length > 0 && !valid ? 'both' : unknown.length > 0 ? 'unknown' : 'invalid',
              unknown: unknown.length,
              candidates,
              candidatesNeutral: relationshipCandidateKeys(r)
                .map((k) => `(${k.map((id) => partLabelNeutral(m, r, id)).join(', ')})`)
                .join(' / '),
            },
          },
        ];
      }),
);

const cardinalityLabelConflict = rule(
  'er.cardinality-label-conflict',
  'warning',
  "A participant's cardinality label contradicts its maximum cardinality.",
  (m) =>
    relationships(m).flatMap((r) =>
      r.participants
        .filter((p) => {
          const label = nameOf(p.cardinalityLabel).trim();
          return label !== '' && (label === '1') !== (p.max === 'one');
        })
        .map((p) => ({
          title: `Label "${nameOf(p.cardinalityLabel).trim()}" contradicts cardinality of ${quote(entityName(m, p.entityId))}`,
          explanation: `The participant's maximum is '${p.max}', but its label says otherwise. The label is ignored and a derived one is drawn, so the diagram differs from what was typed.`,
          suggestion:
            p.max === 'one'
              ? 'Use the label 1, or set the cardinality to many.'
              : 'Use a letter label (N, M, P), or set the cardinality to one.',
          affected: [partRef(r, p.id), relRef(r)],
          params: {
            relationship: nameOf(r.name).trim(),
            entity: entityName(m, p.entityId),
            label: nameOf(p.cardinalityLabel).trim(),
            max: p.max,
            variant: `max-${p.max}`,
          },
        })),
    ),
);

const recursiveNoRoles = rule('er.recursive-no-roles', 'info', 'A recursive relationship has participants without role names.', (m) =>
  relationships(m)
    .filter((r) => isRecursiveRelationship(r))
    .flatMap((r) => {
      const byEntity = groupBy(r.participants, (p) => p.entityId);
      const missing = duplicatesOnly(byEntity).flatMap(([, ps]) => ps.filter((p) => !nameOf(p.role).trim()));
      if (missing.length === 0) return [];
      return [
        {
          title: `Recursive relationship ${quote(nameOf(r.name))} has no role names`,
          explanation:
            'When an entity plays several parts in one relationship, role labels (e.g. "supervisor" / "subordinate") say which line is which and name the generated foreign keys.',
          suggestion: 'Add a role to each participant of the recursive relationship.',
          affected: [relRef(r), ...missing.map((p) => partRef(r, p.id))],
          params: { relationship: nameOf(r.name).trim() },
        },
      ];
    }),
);

// ---------------------------------------------------------------------------
// Associative entities
// ---------------------------------------------------------------------------

const withAssociative = (m: Readonly<ErModel>): ErEntity[] => entities(m).filter((e) => e.associativeOf !== undefined);

const associativeDangling = rule(
  'er.associative-dangling',
  'error',
  'An associative entity refers to a relationship that does not exist.',
  (m) =>
    withAssociative(m)
      .filter((e) => !relshipOf(m, e.associativeOf!))
      .map((e) => ({
        title: `Associative entity ${quote(nameOf(e.name))} has no relationship`,
        explanation: 'It stands for a relationship that was deleted, so it cannot be converted as an associative entity.',
        suggestion: 'Reconnect it to a relationship, or turn it into an ordinary entity.',
        affected: [entityRef(e)],
        params: { entity: nameOf(e.name).trim() },
      })),
);

const associativeDuplicate = rule(
  'er.associative-duplicate',
  'error',
  'Two entities claim to be the associative entity of the same relationship.',
  (m) =>
    duplicatesOnly(
      groupBy(
        withAssociative(m).filter((e) => relshipOf(m, e.associativeOf!)),
        (e) => e.associativeOf,
      ),
    ).map(([relId, group]) => ({
      title: `Several associative entities for ${quote(nameOf(relshipOf(m, relId)!.name))}`,
      explanation: `${group.length} entities (${quoteAll(group.map((e) => nameOf(e.name)))}) stand for the same relationship; at most one may.`,
      suggestion: 'Keep one associative entity and turn the others into ordinary entities.',
      affected: [relRef(relshipOf(m, relId)!), ...group.map(entityRef)],
      params: {
        relationship: nameOf(relshipOf(m, relId)!.name).trim(),
        count: group.length,
        entities: quoteAll(group.map((e) => nameOf(e.name))),
      },
    })),
);

const associativeWeak = rule('er.associative-weak', 'error', 'An associative entity is also marked weak.', (m) =>
  withAssociative(m)
    .filter((e) => e.weak)
    .map((e) => ({
      title: `Associative entity ${quote(nameOf(e.name))} is weak`,
      explanation: 'An associative entity is identified by the entities of its relationship and is never weak.',
      suggestion: 'Clear the weak flag.',
      affected: [entityRef(e)],
      params: { entity: nameOf(e.name).trim() },
    })),
);

const associativeIdentifying = rule(
  'er.associative-identifying',
  'error',
  'An associative entity stands for an identifying relationship.',
  (m) =>
    withAssociative(m)
      .filter((e) => relshipOf(m, e.associativeOf!)?.identifying)
      .map((e) => ({
        title: `Associative entity ${quote(nameOf(e.name))} promotes an identifying relationship`,
        explanation:
          'Only ordinary relationships can be promoted to an associative entity; identifying relationships define weak entities.',
        suggestion: 'Make the relationship non-identifying, or remove the associative entity.',
        affected: [entityRef(e), relRef(relshipOf(m, e.associativeOf!)!)],
        params: { entity: nameOf(e.name).trim() },
      })),
);

// ---------------------------------------------------------------------------
// Attributes (recommendations)
// ---------------------------------------------------------------------------

const compositeSingleChild = rule('er.composite-single-child', 'info', 'A composite attribute has only one sub-attribute.', (m) => {
  const children = groupBy(attributes(m), (a) => (a.owner.kind === 'attribute' ? a.owner.id : undefined));
  return [...children.entries()]
    .filter(([parentId, kids]) => kids.length === 1 && attrOf(m, parentId))
    .map(([parentId, kids]) => {
      const parent = attrOf(m, parentId)!;
      return {
        title: `Composite attribute ${quote(nameOf(parent.name))} has one part`,
        explanation: `A composite attribute groups several parts; with the single part ${quote(nameOf(kids[0]!.name))} it behaves like a simple attribute.`,
        suggestion: 'Add the other parts, or replace the composite by a simple attribute.',
        affected: [attrRef(parent), attrRef(kids[0]!)],
        params: { attribute: nameOf(parent.name).trim(), part: nameOf(kids[0]!.name).trim() },
      };
    });
});

const derivedNoSource = rule(
  'er.derived-no-source',
  'info',
  'A derived attribute does not say which attributes it is computed from.',
  (m) =>
    attributes(m)
      .filter((a) => a.derived && (a.derivedFrom?.length ?? 0) === 0)
      .map((a) => ({
        title: `Derived attribute ${quote(nameOf(a.name))} has no source`,
        explanation: 'Derived values are not stored; documenting what they derive from explains the omission when the model is converted.',
        suggestion: 'Select the attributes it is derived from (e.g. Age from DOB).',
        affected: [attrRef(a)],
        params: { attribute: nameOf(a.name).trim() },
      })),
);

// ---------------------------------------------------------------------------
// Conversion ambiguity (design recommendations)
// ---------------------------------------------------------------------------

const oneToOneAmbiguous = rule(
  'er.one-to-one-ambiguous-placement',
  'info',
  'A 1:1 relationship has no total side, so the foreign key can go on either side.',
  (m) =>
    relationships(m)
      .filter((r) => !r.identifying && r.participants.length === 2 && r.participants.every((p) => p.max === 'one'))
      .filter((r) => r.participants.every((p) => p.participation !== 'total'))
      .filter((r) => !entities(m).some((e) => e.associativeOf === r.id))
      .map((r) => ({
        title: `Placement of the foreign key for ${quote(nameOf(r.name))} is a free choice`,
        explanation:
          'Both sides are partial, so the foreign key would be nullable wherever it is placed and neither placement is better. A separate relationship relation avoids NULLs.',
        suggestion: 'Mark one side total if every instance takes part, or choose the 1:1 strategy explicitly when converting.',
        affected: [relRef(r), ...r.participants.map((p) => partRef(r, p.id))],
        params: { relationship: nameOf(r.name).trim() },
      })),
);

const naryMultipleKeys = rule(
  'er.nary-multiple-keys',
  'info',
  "An n-ary relationship has several 'one' participants, so several candidate keys are implied.",
  (m) =>
    relationships(m)
      // Identifying relationships produce no relationship relation, so their keys are not a conversion choice.
      .filter((r) => r.participants.length >= 3 && !r.identifying)
      .flatMap((r) => {
        const a = analyzeRelationship(m, r.id);
        if (!a || a.candidateKeys.length < 2) return [];
        if (a.keySource === 'user' && a.chosenKeyValid) return []; // the user already decided
        return [
          {
            title: `${quote(nameOf(r.name))} implies ${a.candidateKeys.length} candidate keys`,
            explanation:
              'Several participants are on the "one" side, so each combination of the others identifies a row. One becomes the primary key; the others become UNIQUE constraints.',
            suggestion: 'Choose the primary-key participants explicitly in the relationship properties.',
            affected: [relRef(r), ...a.oneSide.map((p) => partRef(r, p.id))],
            params: {
              relationship: nameOf(r.name).trim(),
              keys: a.candidateKeys.length,
            },
          },
        ];
      }),
);

const totalOnOneSide = rule(
  'er.total-on-one-side',
  'info',
  "Total participation on the 'one' side of a 1:N relationship cannot be enforced by foreign keys.",
  (m) =>
    relationships(m)
      .filter((r) => r.participants.length === 2)
      .filter((r) => r.participants.filter((p) => p.max === 'one').length === 1)
      .filter((r) => r.participants.some((p) => p.max === 'many'))
      .flatMap((r) =>
        r.participants
          .filter((p) => p.max === 'one' && p.participation === 'total')
          .map((p) => ({
            title: `"At least one" on ${quote(entityName(m, p.entityId))} is not enforceable`,
            explanation: `Every ${quote(entityName(m, p.entityId))} must take part in ${quote(nameOf(r.name))}, i.e. have at least one partner. A foreign key can only force the many side to reference its parent, so this needs a trigger, assertion or application check.`,
            suggestion: 'Keep the constraint as documentation, or enforce it outside the schema.',
            affected: [partRef(r, p.id), relRef(r)],
            params: {
              relationship: nameOf(r.name).trim(),
              entity: entityName(m, p.entityId),
            },
          })),
      ),
);

export const ER_RULES: ErRule[] = [
  entityNameEmpty,
  relationshipNameEmpty,
  attributeNameEmpty,
  entityNameDuplicate,
  relationshipNameDuplicate,
  attributeNameDuplicate,
  entityNoKey,
  keyOnSubattribute,
  keyOptional,
  weakPrimaryKey,
  partialKeyOnStrong,
  keyMultivalued,
  keyDerived,
  weakNoOwner,
  weakNoPartialKey,
  identifyingAmbiguous,
  identifyingIdentifiesNothing,
  identifiedNotWeak,
  identifyingPartial,
  identifyingOwnerMany,
  weakOwnershipCycle,
  relationshipTooFew,
  participantMissingEntity,
  relationshipKeyVsCardinality,
  cardinalityLabelConflict,
  recursiveNoRoles,
  associativeDangling,
  associativeDuplicate,
  associativeWeak,
  associativeIdentifying,
  compositeSingleChild,
  derivedNoSource,
  oneToOneAmbiguous,
  naryMultipleKeys,
  totalOnOneSide,
];
