/**
 * Decides, BEFORE any relation is built, how every binary 1:1 relationship is translated. Merging changes which
 * relation an entity lives in, so it has to be known up front; the other strategies are decided here too so the
 * explanation of the 1:1 choice lives in one place.
 */
import { analyzeRelationship, associativeEntityOf, identifiedParticipants, weakEntityOwners } from '@/model/erSemantics';
import type { ErParticipant, ErRelationship, Id, OneToOneStrategy } from '@/model/types';
import { eRef, type Ctx } from './context';

const MERGE_PROBLEMS = {
  recursive: 'a recursive 1:1 relationship relates an entity to itself, so there is nothing to merge',
  plain: 'only plain strong entities can be merged (weak and associative entities keep their own relation)',
  pairwise: 'one of the entities is already merged through another 1:1 relationship (merging is pairwise)',
} as const;

export type FkReason = 'explicit' | 'total-side' | 'both-total' | 'ambiguous';

export type OneToOnePlan =
  | { kind: 'fk'; holder: ErParticipant; ref: ErParticipant; reason: FkReason }
  | { kind: 'relation' }
  | { kind: 'merge'; group: MergeGroup };

export interface MergeGroup {
  relationship: ErRelationship;
  /** Its key becomes the primary key of the merged relation. */
  primary: ErParticipant;
  other: ErParticipant;
}

export interface MergePlan {
  groups: MergeGroup[];
  groupOf: Map<Id, MergeGroup>;
  plans: Map<Id, OneToOnePlan>;
}

function plainStrong(c: Ctx, entityId: Id): boolean {
  const e = c.er.entities[entityId];
  return !!e && !e.weak && !e.associativeOf && weakEntityOwners(c.er, entityId).length === 0;
}

/** FK holder/reference for the non-merge strategies; `auto` prefers the total-participation side. */
function fkPlan(strategy: OneToOneStrategy, a: ErParticipant, b: ErParticipant): OneToOnePlan {
  if (strategy === 'fk-on-first') return { kind: 'fk', holder: a, ref: b, reason: 'explicit' };
  if (strategy === 'fk-on-second') return { kind: 'fk', holder: b, ref: a, reason: 'explicit' };
  if (a.participation === 'total' && b.participation === 'total') return { kind: 'fk', holder: a, ref: b, reason: 'both-total' };
  if (b.participation === 'total') return { kind: 'fk', holder: b, ref: a, reason: 'total-side' };
  if (a.participation === 'total') return { kind: 'fk', holder: a, ref: b, reason: 'total-side' };
  return { kind: 'fk', holder: a, ref: b, reason: 'ambiguous' };
}

/** Participation decides which side can key the merged relation without losing entities (see README). */
function chooseMergePrimary(a: ErParticipant, b: ErParticipant): { primary: ErParticipant; other: ErParticipant } {
  if (a.participation === 'total' && b.participation !== 'total') return { primary: b, other: a };
  return { primary: a, other: b };
}

export function planOneToOne(c: Ctx): MergePlan {
  const plan: MergePlan = { groups: [], groupOf: new Map(), plans: new Map() };
  // Merging is greedy and pairwise, so when several 1:1 relationships compete for the same entities the lossless
  // candidates (at least one total side) go first; otherwise renaming a relationship would change the schema.
  const lossless = (r: ErRelationship): boolean => r.participants.some((p) => p.participation === 'total');
  const rels = Object.values(c.er.relationships)
    .map((r, i) => ({ r, i }))
    .sort((x, y) => Number(lossless(y.r)) - Number(lossless(x.r)) || x.i - y.i)
    .map((x) => x.r);
  for (const rel of rels) {
    if (associativeEntityOf(c.er, rel.id)) continue;
    if (identifiedParticipants(c.er, rel).length > 0) continue;
    const analysis = analyzeRelationship(c.er, rel.id);
    if (!analysis || analysis.shape !== 'binary-1:1') continue;
    const [a, b] = rel.participants as [ErParticipant, ErParticipant];
    if (!c.er.entities[a.entityId] || !c.er.entities[b.entityId]) continue;

    const ov = c.options.relationshipOverrides[rel.id];
    if (ov?.fkParticipantId !== undefined) {
      const holder = rel.participants.find((p) => p.id === ov.fkParticipantId);
      if (holder) {
        plan.plans.set(rel.id, { kind: 'fk', holder, ref: holder === a ? b : a, reason: 'explicit' });
        continue;
      }
      c.warn({
        code: 'conv.fk-participant-invalid',
        severity: 'warning',
        title: `Chosen FK side for ${rel.name} is not a participant`,
        explanation: `The override names participant ${ov.fkParticipantId}, which does not take part in ${rel.name}; the strategy options were used instead.`,
        suggestion: 'Pick one of the two participants of the relationship as the FK side.',
        affected: [eRef.relationship(rel.id)],
        params: { relationship: rel.name, participant: String(ov.fkParticipantId) },
      });
    }
    const strategy: OneToOneStrategy = ov?.asRelation ? 'relation' : (ov?.oneToOne ?? c.options.oneToOne);
    if (strategy === 'relation') {
      plan.plans.set(rel.id, { kind: 'relation' });
      continue;
    }
    if (strategy !== 'merge') {
      plan.plans.set(rel.id, fkPlan(strategy, a, b));
      continue;
    }
    const problemKind =
      a.entityId === b.entityId
        ? 'recursive'
        : !plainStrong(c, a.entityId) || !plainStrong(c, b.entityId)
          ? 'plain'
          : plan.groupOf.has(a.entityId) || plan.groupOf.has(b.entityId)
            ? 'pairwise'
            : undefined;
    const problem = problemKind && MERGE_PROBLEMS[problemKind];
    if (problem) {
      c.warn({
        code: 'conv.one-to-one-merge-ineligible',
        severity: 'warning',
        title: `Cannot merge the entities of ${rel.name}`,
        explanation: `Merge was requested for ${rel.name}, but ${problem}. A foreign key on the total-participation side was used instead.`,
        suggestion: 'Choose "foreign key" or "separate relation" for this relationship.',
        affected: [eRef.relationship(rel.id)],
        params: {
          relationship: rel.name,
          variant: problemKind!,
        },
      });
      plan.plans.set(rel.id, fkPlan('auto', a, b));
      continue;
    }
    const { primary, other } = chooseMergePrimary(a, b);
    const group: MergeGroup = { relationship: rel, primary, other };
    plan.groups.push(group);
    plan.groupOf.set(a.entityId, group);
    plan.groupOf.set(b.entityId, group);
    plan.plans.set(rel.id, { kind: 'merge', group });
  }
  return plan;
}
