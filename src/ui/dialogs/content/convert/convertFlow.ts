/**
 * Convert flow (ARCHITECTURE section 8): options -> pure `convertErToRelational` -> TEMP project -> `buildScene` -> `autoLayout`
 * -> ONE `commit` with `applyConversionResult` + positions. `planConversion` does everything except the commit, and the
 * dialog's live preview uses the very same plan that Apply commits, so preview and result cannot differ.
 */
import { produce } from 'immer';
import { convertErToRelational } from '@/conversion';
import { autoLayout } from '@/layout';
import { analyzeRelationship } from '@/model/erSemantics';
import { DEFAULT_CONVERSION_OPTIONS } from '@/model/defaults';
import * as ops from '@/model/ops';
import type { ApplyConversionReport } from '@/model/ops';
import type { ConversionDecision, ConversionOptions, ConversionRecord, ConversionResult, ErAttribute, ErModel, ErParticipant, ErRelationship, Id, OneToOneStrategy, Point, Project, RelationalModel } from '@/model/types';
import { renderSceneToSvgString } from '@/render/standalone';
import { buildScene } from '@/scene/registry';
import { editorStore as globalStore, type EditorStore } from '@/store';

// ---------------------------------------------------------------------------
// options helpers (pure)
// ---------------------------------------------------------------------------

export const cloneOptions = (o: ConversionOptions): ConversionOptions => JSON.parse(JSON.stringify(o)) as ConversionOptions;

/**
 * Warning-level decisions (keyless entity, omitted relationship, ...) belong on the Warnings tab next to `record.warnings`.
 * They are never filtered against the warnings: a warning about the same element usually reports a DIFFERENT problem
 * (e.g. an unenforceable participation next to a missing foreign key), and hiding either would understate the result.
 */
export function warningItems(record: Pick<ConversionRecord, 'decisions'>): ConversionDecision[] {
  return record.decisions.filter((d) => d.level === 'warning');
}

/** The most recent conversion of this ER model whose relational model still exists (re-convert target). */
export function findPreviousConversion(project: Readonly<Project>, erModelId: Id): { record: ConversionRecord; model: RelationalModel } | undefined {
  const records = Object.values(project.conversions)
    .filter((c) => c.erModelId === erModelId && project.models[c.relationalModelId]?.kind === 'relational')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const record = records[0];
  const model = record ? project.models[record.relationalModelId] : undefined;
  return record && model?.kind === 'relational' ? { record, model } : undefined;
}

export interface OneToOneRelationship {
  relationship: ErRelationship;
  first: ErParticipant;
  second: ErParticipant;
}

/** Binary 1:1 relationships (identifying ones are always folded into the weak entity and have no choice). */
export function listOneToOneRelationships(er: Readonly<ErModel>): OneToOneRelationship[] {
  const out: OneToOneRelationship[] = [];
  for (const rel of Object.values(er.relationships)) {
    const a = analyzeRelationship(er, rel.id);
    if (a?.shape === 'binary-1:1' && !rel.identifying) out.push({ relationship: rel, first: rel.participants[0]!, second: rel.participants[1]! });
  }
  return out.sort((x, y) => (x.relationship.name < y.relationship.name ? -1 : x.relationship.name > y.relationship.name ? 1 : x.relationship.id < y.relationship.id ? -1 : 1));
}

export interface DerivedAttribute {
  attribute: ErAttribute;
  /** `Entity.Attribute` (or `Relationship.Attribute`, with composite parents in between). */
  label: string;
}

export function listDerivedAttributes(er: Readonly<ErModel>): DerivedAttribute[] {
  const ownerLabel = (a: ErAttribute, depth = 0): string => {
    const o = a.owner;
    if (depth > 20) return a.name;
    if (o.kind === 'entity') return `${er.entities[o.id]?.name ?? '?'}.${a.name}`;
    if (o.kind === 'relationship') return `${er.relationships[o.id]?.name ?? '?'}.${a.name}`;
    const parent = er.attributes[o.id];
    return parent ? `${ownerLabel(parent, depth + 1)}.${a.name}` : a.name;
  };
  return Object.values(er.attributes)
    .filter((a) => a.derived)
    .map((attribute) => ({ attribute, label: ownerLabel(attribute) }))
    .sort((x, y) => (x.label < y.label ? -1 : x.label > y.label ? 1 : x.attribute.id < y.attribute.id ? -1 : 1));
}

export type OneToOneChoice = 'default' | 'auto' | 'merge' | 'relation' | { fk: Id };

/** What the per-relationship override currently says, as one choice. */
export function overrideChoice(options: ConversionOptions, relationshipId: Id): OneToOneChoice {
  const o = options.relationshipOverrides[relationshipId];
  if (!o) return 'default';
  if (o.fkParticipantId) return { fk: o.fkParticipantId };
  if (o.asRelation) return 'relation';
  if (o.oneToOne === 'merge' || o.oneToOne === 'relation' || o.oneToOne === 'auto') return o.oneToOne;
  return 'default';
}

export function withOverride(options: ConversionOptions, relationshipId: Id, choice: OneToOneChoice): ConversionOptions {
  const next = cloneOptions(options);
  const overrides = next.relationshipOverrides;
  if (choice === 'default') delete overrides[relationshipId];
  else if (typeof choice === 'object') overrides[relationshipId] = { fkParticipantId: choice.fk };
  else overrides[relationshipId] = { oneToOne: choice as OneToOneStrategy };
  return next;
}

export function withMaterialized(options: ConversionOptions, attributeId: Id, on: boolean): ConversionOptions {
  const next = cloneOptions(options);
  const set = new Set(next.materializeDerived);
  if (on) set.add(attributeId);
  else set.delete(attributeId);
  next.materializeDerived = [...set];
  return next;
}

/** Overrides and materialised ids that no longer exist in the ER model are dropped (a stale record must not break the converter). */
export function pruneOptions(options: ConversionOptions, er: Readonly<ErModel>): ConversionOptions {
  const next = cloneOptions({ ...DEFAULT_CONVERSION_OPTIONS, ...options });
  for (const id of Object.keys(next.relationshipOverrides)) if (!er.relationships[id]) delete next.relationshipOverrides[id];
  next.materializeDerived = next.materializeDerived.filter((id) => er.attributes[id]?.derived);
  return next;
}

// ---------------------------------------------------------------------------
// planning and applying
// ---------------------------------------------------------------------------

export interface ConversionPlan {
  result: ConversionResult;
  /** Layout for the relational diagram, keyed by RELATION id (`ops.applyConversionResult` resolves it). */
  positions: Record<Id, Point>;
  /** The project as it will look after Apply (temporary; never stored). */
  project: Project;
  report: ApplyConversionReport;
  /** The relational-schema diagram of the result inside `project`. */
  diagramId: Id | undefined;
  replaceModelId?: Id;
  tables: number;
  foreignKeys: number;
}

export interface PlanOptions {
  /** Update this relational model in place (its diagram keeps positions and routes; hand-added elements are kept). */
  replace?: { model: RelationalModel; recordId: Id };
  /** Aborts the (worker-side) layout: the promise rejects with an AbortError (a superseded preview, Esc / closing the dialog). */
  signal?: AbortSignal;
}

function diagramOfModel(project: Project, modelId: Id): Id | undefined {
  return project.diagramOrder.find((id) => project.diagrams[id]?.modelId === modelId && project.diagrams[id]?.type === 'relational-schema');
}

export async function planConversion(project: Project, erModelId: Id, options: ConversionOptions, plan: PlanOptions = {}): Promise<ConversionPlan> {
  const raw = convertErToRelational(project, erModelId, options, plan.replace ? { previous: plan.replace.model } : undefined);
  const result: ConversionResult = plan.replace ? { ...raw, record: { ...raw.record, previousConversionId: plan.replace.recordId } } : raw;
  const replaceModelId = plan.replace?.model.id;
  const modelId = replaceModelId ?? result.relationalModel.id;

  // layout on a temporary project that already contains the result
  const base = produce(project, (d) => {
    ops.applyConversionResult(d, result, { replaceModelId });
  });
  const baseDiagram = diagramOfModel(base, modelId);
  const positions: Record<Id, Point> = {};
  if (baseDiagram) {
    const scene = buildScene(base, baseDiagram);
    const byNode = await autoLayout(scene, base, baseDiagram, plan.signal ? { signal: plan.signal } : {});
    const nodes = base.diagrams[baseDiagram]!.nodes;
    for (const [nodeId, p] of Object.entries(byNode)) {
      const node = nodes[nodeId];
      if (node) positions[node.ref.id] = p;
    }
  }
  let report: ApplyConversionReport | undefined;
  const final = produce(project, (d) => {
    report = ops.applyConversionResult(d, result, { replaceModelId, positions });
  });
  return {
    result,
    positions,
    project: final,
    report: report!,
    diagramId: diagramOfModel(final, modelId),
    replaceModelId,
    tables: Object.keys(result.relationalModel.relations).length,
    foreignKeys: Object.keys(result.relationalModel.foreignKeys).length,
  };
}

export interface AppliedConversion {
  modelId: Id;
  diagramId: Id | undefined;
  report: ApplyConversionReport;
  tables: number;
}

/** ONE undoable commit; activates the relational diagram. The ER model is never touched. */
export function applyPlan(plan: ConversionPlan, label: string, store: EditorStore = globalStore): AppliedConversion {
  let report: ApplyConversionReport | undefined;
  store.getState().commit(label, (d) => {
    report = ops.applyConversionResult(d, plan.result, { replaceModelId: plan.replaceModelId, positions: plan.positions });
  });
  const state = store.getState();
  const diagramId = report!.diagramId ?? diagramOfModel(state.project, report!.modelId);
  if (diagramId) state.setActiveDiagram(diagramId);
  return { modelId: report!.modelId, diagramId, report: report!, tables: plan.tables };
}

/** Standalone SVG of the converted horizontal schema (light palette, as in exports). */
export function renderPlanSvg(plan: ConversionPlan): string | undefined {
  if (!plan.diagramId) return undefined;
  const diagram = plan.project.diagrams[plan.diagramId];
  if (!diagram) return undefined;
  return renderSceneToSvgString(buildScene(plan.project, plan.diagramId), plan.project, diagram, { padding: 16 });
}
