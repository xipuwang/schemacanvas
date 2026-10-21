import { createDiagramForModel } from '@/model/diagramSync';
import { DEFAULT_CONVERSION_OPTIONS, createRelationalModel } from '@/model/defaults';
import { newId } from '@/model/ids';
import type {
  ConversionOptions,
  ConversionRecord,
  ConversionResult,
  ErModel,
  Id,
  Project,
  RelationalModel,
} from '@/model/types';
import { Ctx, eRef } from './context';
import { buildAllEntities } from './entities';
import { planOneToOne } from './merge';
import { translateRelationships } from './relationships';

const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Same model with entities / relationships sorted by (name, id) and attributes by (order, id), so no output depends
 * on Record insertion order (ARCHITECTURE §2 rule 15). Elements themselves are shared, never copied or mutated.
 */
function normalize(er: ErModel): ErModel {
  const sorted = <T extends { id: Id }>(items: T[], cmp: (a: T, b: T) => number): Record<Id, T> =>
    Object.fromEntries([...items].sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => [x.id, x]));
  const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return {
    ...er,
    entities: sorted(Object.values(er.entities), byName),
    relationships: sorted(Object.values(er.relationships), byName),
    attributes: sorted(Object.values(er.attributes), (a, b) => a.order - b.order),
  };
}

function mergeOptions(options: Partial<ConversionOptions> | undefined): ConversionOptions {
  const merged: ConversionOptions = { ...cloneJson(DEFAULT_CONVERSION_OPTIONS), ...cloneJson(options ?? {}) };
  merged.relationshipOverrides = merged.relationshipOverrides ?? {};
  merged.materializeDerived = merged.materializeDerived ?? [];
  return merged;
}

/**
 * ER -> relational conversion (product specification §3). PURE: never mutates `project`, never touches a store.
 * See README.md for the rules and ARCHITECTURE §5e / types.ts `ConversionResult` for the contract.
 */
export function convertErToRelational(
  project: Readonly<Project>,
  erModelId: Id,
  options?: Partial<ConversionOptions>,
  env?: { now?: string; previous?: RelationalModel },
): ConversionResult {
  const model = project.models[erModelId];
  if (!model || model.kind !== 'er') throw new Error(`convertErToRelational: ${erModelId} is not an ER model of this project`);
  const opts = mergeOptions(options);
  const er = normalize(model);
  const c = new Ctx(er, opts, env?.now, env?.previous);

  c.merge = planOneToOne(c);
  buildAllEntities(c);
  translateRelationships(c);
  // Multivalued relations last: their host keys are only final once every FK/merge decision has been applied.
  for (let i = 0; i < c.mvQueue.length; i++) c.mvQueue[i]!();
  finalizeTrace(c);

  const conversionId = newId('cnv');
  const relationalModel: RelationalModel = {
    ...createRelationalModel(`${model.name} (relational)`, project.settings.defaultDialect),
    relations: c.relations,
    foreignKeys: c.foreignKeys,
    derivedFrom: { erModelId, conversionId },
  };
  const record: ConversionRecord = {
    id: conversionId,
    erModelId,
    relationalModelId: relationalModel.id,
    createdAt: c.now,
    options: opts,
    trace: c.traceEntries(),
    decisions: c.decisions,
    warnings: c.warnings,
  };
  return { relationalModel, record, diagram: createDiagramForModel(relationalModel, 'relational-schema') };
}

/**
 * Safety net for the trace completeness invariant: anything the rules could not place (e.g. an attribute whose
 * owner no longer exists in a hand-edited file) is traced as omitted with an explicit decision instead of vanishing.
 */
function finalizeTrace(c: Ctx): void {
  const missing = (
    ref: ReturnType<typeof eRef.entity>,
    what: 'entity' | 'attribute' | 'relationship' | 'participant',
    name: string,
    label: string,
    ruleId: 'strong-entity' | 'composite-flatten' | 'n-ary-relation',
  ): void => {
    if (c.isTraced(ref)) return;
    c.trace(ref, [], ruleId);
    c.decide({
      ruleId,
      tag: `unmapped:${ref.kind}:${ref.id}`,
      title: `${label} was not converted`,
      explanation: `${label} could not be attached to any generated relation (its owner is missing or was not converted), so nothing was generated for it.`,
      sources: [ref],
      level: 'warning',
      params: { kind: `unmapped.${what}`, name },
    });
  };
  for (const e of Object.values(c.er.entities)) missing(eRef.entity(e.id), 'entity', e.name, `Entity ${e.name}`, 'strong-entity');
  for (const a of Object.values(c.er.attributes)) missing(eRef.attribute(a.id), 'attribute', a.name, `Attribute ${a.name}`, 'composite-flatten');
  for (const r of Object.values(c.er.relationships)) {
    missing(eRef.relationship(r.id), 'relationship', r.name, `Relationship ${r.name}`, 'n-ary-relation');
    for (const p of r.participants) missing(eRef.participant(r.id, p.id), 'participant', r.name, `A participant of ${r.name}`, 'n-ary-relation');
  }
}
