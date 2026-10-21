/**
 * Insert a pure `ConversionResult` (src/conversion) into a project in ONE call (the store wraps it in one commit).
 *
 *  - default: a NEW relational model + ConversionRecord + `relational-schema` diagram; nothing existing is touched.
 *  - `replaceModelId`: regenerate an earlier conversion IN PLACE. The converter reuses element ids where `Origin.key`
 *    matches (env.previous), so the nodes/routes of existing diagrams survive for reused ids; nodes of vanished ids are
 *    pruned and new relations get nodes via sync. Hand-added elements (no `origin`) are carried over and REPORTED as a
 *    `conv.hand-added-kept` / `conv.hand-added-dropped` info/warning on the stored record - nothing disappears silently.
 */
import { makeIssue } from '../issues';
import { relationNameKey, sqlNameKey } from '../queries';
import type {
  ConversionResult,
  ForeignKey,
  Id,
  Issue,
  Point,
  Project,
  RelColumn,
  Relation,
  RelationalModel,
  SemanticRef,
} from '../types';
import { OpError, commitSync, jsonClone, requireRelational } from './common';
import { createDiagramForModel } from '../diagramSync';

export interface ApplyConversionOptions {
  /**
   * Provisional layout for the NEW diagram, keyed by the node id in `result.diagram` OR by the relation id the node shows
   * (so a layout computed on a temporary project works as-is). In `replaceModelId` mode it only places NEW nodes.
   */
  positions?: Record<Id, Point>;
  replaceModelId?: Id;
}

export interface ApplyConversionReport {
  modelId: Id;
  conversionId: Id;
  /** The diagram that was added (always in the default mode; in replace mode only when no diagram viewed the model). */
  diagramId?: Id;
  replaced: boolean;
  /** Hand-added elements that were carried over (replace mode). */
  kept: SemanticRef[];
  /** Human-readable list of hand-added elements that could not be carried over (replace mode). */
  dropped: string[];
  /** Edits to generated elements that the regeneration replaced (replace mode), one human-readable line each. */
  overwritten?: string[];
}

function placeNodes(diagram: { nodes: Record<Id, { id: Id; ref: SemanticRef; x: number; y: number }> }, positions: Record<Id, Point> | undefined): void {
  if (!positions) return;
  for (const n of Object.values(diagram.nodes)) {
    const p = positions[n.id] ?? (n.ref.kind === 'relation' ? positions[n.ref.id] : undefined);
    if (!p) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new OpError('invalid', 'Conversion positions must be finite');
    n.x = p.x;
    n.y = p.y;
  }
}

export function applyConversionResult(draft: Project, result: ConversionResult, opts: ApplyConversionOptions = {}): ApplyConversionReport {
  return opts.replaceModelId ? replaceConversion(draft, result, opts.replaceModelId, opts) : addConversion(draft, result, opts);
}

function addConversion(draft: Project, result: ConversionResult, opts: ApplyConversionOptions): ApplyConversionReport {
  const model = result.relationalModel;
  if (draft.models[model.id]) throw new OpError('id-in-use', `Model ${model.id} already exists`);
  if (draft.conversions[result.record.id]) throw new OpError('id-in-use', `Conversion ${result.record.id} already exists`);
  if (draft.diagrams[result.diagram.id]) throw new OpError('id-in-use', `Diagram ${result.diagram.id} already exists`);
  if (result.diagram.modelId !== model.id || result.record.relationalModelId !== model.id) {
    throw new OpError('invalid', 'ConversionResult is inconsistent: model, record and diagram must reference the same model id');
  }
  const diagram = jsonClone(result.diagram);
  placeNodes(diagram, opts.positions);
  draft.models[model.id] = jsonClone(model);
  draft.conversions[result.record.id] = jsonClone(result.record);
  draft.diagrams[diagram.id] = diagram;
  draft.diagramOrder.push(diagram.id);
  commitSync(draft, model.id); // idempotent: guarantees the diagram matches the model
  return { modelId: model.id, conversionId: result.record.id, diagramId: diagram.id, replaced: false, kept: [], dropped: [] };
}

// ----- replace -----------------------------------------------------------------------------------------------------

interface Merge {
  kept: SemanticRef[];
  dropped: string[];
  /** Hand-added elements that were renamed to avoid a name collision with regenerated siblings. */
  renamed: { ref: SemanticRef; text: string }[];
  /** Differences between the user's version of a generated element and the regenerated one (regenerated wins). */
  overwritten: { ref: SemanticRef; text: string }[];
}

/** First `base_2`, `base_3`, ... whose key is not taken. */
function freeName(base: string, taken: (name: string) => boolean): string {
  let n = 2;
  while (taken(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

const hasColumn = (rel: Relation, id: Id): boolean => rel.columns.some((c) => c.id === id);

const show = (v: unknown): string => (v === undefined ? '(none)' : typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

/**
 * Generated elements are regenerated from the ER model, so the regenerated value wins - but never silently. A field the
 * converter leaves unset that the user filled in (data type, default, description, referential action, label) is carried
 * over; any other difference is reported as overwritten.
 */
function reconcileGenerated(old: Relation, next: Relation, out: Merge): void {
  const diff = <T extends object>(a: T, b: T, fields: (keyof T & string)[], carry: (keyof T & string)[], ref: SemanticRef, label: string): void => {
    for (const f of fields) {
      if (JSON.stringify(a[f]) === JSON.stringify(b[f])) continue;
      if (carry.includes(f) && a[f] !== undefined && b[f] === undefined) {
        (b as Record<string, unknown>)[f] = jsonClone(a[f]);
        continue;
      }
      out.overwritten.push({ ref, text: `${label}.${f}: ${show(a[f])} -> ${show(b[f])}` });
    }
  };
  diff(old, next, ['name', 'description', 'primaryKeyName'], ['description', 'primaryKeyName'], { kind: 'relation', id: next.id }, old.name);
  if (old.origin && JSON.stringify(old.primaryKey) !== JSON.stringify(next.primaryKey)) {
    out.overwritten.push({ ref: { kind: 'relation', id: next.id }, text: `${old.name}.primaryKey changed by the regeneration` });
  }
  for (const col of old.columns) {
    const regenerated = col.origin ? next.columns.find((c) => c.id === col.id) : undefined;
    if (regenerated) {
      diff(col, regenerated, ['name', 'dataType', 'nullable', 'defaultValue', 'autoIncrement', 'description'], ['dataType', 'defaultValue', 'autoIncrement', 'description'], { kind: 'column', relationId: next.id, id: col.id }, `${old.name}.${col.name}`);
    }
  }
}

/** Carry hand-added columns, constraints and indexes of a REUSED relation into its regenerated version. */
function mergeRelation(old: Relation, next: Relation, out: Merge): void {
  reconcileGenerated(old, next, out);
  old.columns.forEach((col, i) => {
    if (col.origin || hasColumn(next, col.id)) return;
    // Re-insert after the nearest preceding column that survived, else at the end.
    let at = next.columns.length;
    for (let j = i - 1; j >= 0; j--) {
      const k = next.columns.findIndex((c) => c.id === old.columns[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    const copy = jsonClone(col) as RelColumn;
    if (next.columns.some((c) => sqlNameKey(c.name) === sqlNameKey(copy.name))) {
      const renamed = freeName(copy.name, (nm) => next.columns.some((c) => sqlNameKey(c.name) === sqlNameKey(nm)));
      out.renamed.push({ ref: { kind: 'column', relationId: next.id, id: col.id }, text: `column ${old.name}.${copy.name} -> ${renamed}` });
      copy.name = renamed;
    }
    next.columns.splice(at, 0, copy);
    out.kept.push({ kind: 'column', relationId: next.id, id: col.id });
  });
  const carry = <T extends { id: Id; columnIds?: Id[] }>(items: T[] | undefined, into: T[], kind: 'unique' | 'index' | 'check'): void => {
    for (const item of items ?? []) {
      if (into.some((x) => x.id === item.id)) continue;
      // Never shrink a constraint: UNIQUE(a,b) -> UNIQUE(a) is a different, stricter rule the user never wrote.
      if (item.columnIds?.some((id) => !hasColumn(next, id))) {
        out.dropped.push(`${kind} on ${old.name}: some of its columns were removed by the conversion`);
        continue;
      }
      const copy = jsonClone(item);
      into.push(copy);
      if (kind !== 'check') out.kept.push({ kind, relationId: next.id, id: item.id });
    }
  };
  carry(old.uniques.filter((u) => !u.origin), next.uniques, 'unique');
  carry(old.indexes, next.indexes, 'index');
  if (old.checks?.length) carry(old.checks, (next.checks ??= []), 'check');
  if (next.checks?.length === 0) delete next.checks;
}

function mergeHandAdded(old: RelationalModel, next: RelationalModel): Merge {
  const out: Merge = { kept: [], dropped: [], renamed: [], overwritten: [] };
  for (const rel of Object.values(old.relations)) {
    const regenerated = next.relations[rel.id];
    if (regenerated) mergeRelation(rel, regenerated, out);
    else if (!rel.origin) {
      const copy = jsonClone(rel);
      const clash = (r: Relation): boolean => relationNameKey(r) === relationNameKey(copy);
      if (Object.values(next.relations).some(clash)) {
        const base = copy.name;
        copy.name = freeName(base, (nm) => Object.values(next.relations).some((r) => relationNameKey(r) === relationNameKey({ ...copy, name: nm })));
        out.renamed.push({ ref: { kind: 'relation', id: rel.id }, text: `relation ${base} -> ${copy.name}` });
      }
      next.relations[rel.id] = copy;
      out.kept.push({ kind: 'relation', id: rel.id });
    }
  }
  for (const fk of Object.values(old.foreignKeys)) {
    const regenerated = fk.origin ? next.foreignKeys[fk.id] : undefined;
    if (regenerated) {
      const ref: SemanticRef = { kind: 'foreignKey', id: fk.id };
      for (const f of ['name', 'label', 'onDelete', 'onUpdate'] as const) {
        if (fk[f] === regenerated[f]) continue;
        if (fk[f] !== undefined && regenerated[f] === undefined) (regenerated as unknown as Record<string, unknown>)[f] = fk[f];
        else out.overwritten.push({ ref, text: `foreign key ${fk.name ?? fk.id}.${f}: ${show(fk[f])} -> ${show(regenerated[f])}` });
      }
      if (fk.cardinality && !regenerated.cardinality) regenerated.cardinality = jsonClone(fk.cardinality);
    }
    if (fk.origin || next.foreignKeys[fk.id]) continue;
    const s = next.relations[fk.sourceRelationId];
    const t = next.relations[fk.targetRelationId];
    const intact = !!s && !!t && fk.columns.every((p) => hasColumn(s, p.sourceColumnId) && hasColumn(t, p.targetColumnId));
    if (intact) {
      next.foreignKeys[fk.id] = jsonClone(fk) as ForeignKey;
      out.kept.push({ kind: 'foreignKey', id: fk.id });
    } else {
      out.dropped.push(`foreign key ${fk.name ?? fk.id}: its relations or columns no longer exist`);
    }
  }
  return out;
}

function replaceConversion(draft: Project, result: ConversionResult, replaceModelId: Id, opts: ApplyConversionOptions): ApplyConversionReport {
  const old = requireRelational(draft, replaceModelId);
  if (draft.conversions[result.record.id]) throw new OpError('id-in-use', `Conversion ${result.record.id} already exists`);
  if (old.derivedFrom && old.derivedFrom.erModelId !== result.record.erModelId) {
    throw new OpError(
      'invalid',
      `Model ${replaceModelId} was not generated from ER model ${result.record.erModelId}; refusing to replace it (convert into a new model instead)`,
    );
  }
  const next = jsonClone(result.relationalModel);
  // Model-level settings (name, dialect, ...) belong to the user's model, not to the generator.
  for (const [k, v] of Object.entries(old)) {
    if (k === 'relations' || k === 'foreignKeys' || k === 'derivedFrom' || k === 'kind') continue;
    (next as unknown as Record<string, unknown>)[k] = jsonClone(v);
  }
  next.id = replaceModelId; // diagrams keep pointing at the same model
  const merge = mergeHandAdded(old, next);

  const record = jsonClone(result.record);
  record.relationalModelId = replaceModelId;
  const warnings: Issue[] = [];
  if (merge.kept.length) {
    warnings.push(
      makeIssue({
        code: 'conv.hand-added-kept',
        severity: 'info',
        title: 'Hand-added elements were kept',
        explanation: `${merge.kept.length} element(s) you added by hand were carried over into the regenerated schema.`,
        suggestion: 'Review them: they are not derived from the ER model and are not updated by future conversions.',
        affected: merge.kept,
        modelId: replaceModelId,
        params: { count: merge.kept.length },
      }),
    );
  }
  if (merge.dropped.length) {
    warnings.push(
      makeIssue({
        code: 'conv.hand-added-dropped',
        severity: 'warning',
        title: 'Hand-added elements could not be kept',
        explanation: `${merge.dropped.length} hand-added element(s) referenced columns or relations that the conversion no longer produces: ${merge.dropped.join('; ')}.`,
        suggestion: 'Re-create them against the regenerated schema if you still need them.',
        affected: [],
        modelId: replaceModelId,
        params: { count: merge.dropped.length, details: merge.dropped.join('; ') },
      }),
    );
  }
  if (merge.renamed.length) {
    warnings.push(
      makeIssue({
        code: 'conv.hand-added-renamed',
        severity: 'warning',
        title: 'Hand-added elements were renamed',
        explanation: `Hand-added element(s) clashed with regenerated names and were renamed: ${merge.renamed.map((r) => r.text).join('; ')}.`,
        suggestion: 'Merge the duplicates or pick distinct names.',
        affected: merge.renamed.map((r) => r.ref),
        modelId: replaceModelId,
        params: { count: merge.renamed.length, details: merge.renamed.map((r) => r.text).join('; ') },
      }),
    );
  }
  if (merge.overwritten.length) {
    warnings.push(
      makeIssue({
        code: 'conv.edits-overwritten',
        severity: 'warning',
        title: 'Edits to generated elements were overwritten',
        explanation: `Regeneration replaced ${merge.overwritten.length} edited value(s): ${merge.overwritten.map((o) => o.text).join('; ')}.`,
        suggestion: 'Undo the conversion to restore them, or re-apply the edits (or change the ER model so the generated value is what you want).',
        affected: merge.overwritten.map((o) => o.ref),
        modelId: replaceModelId,
        params: { count: merge.overwritten.length, details: merge.overwritten.map((o) => o.text).join('; ') },
      }),
    );
  }
  record.warnings = [...record.warnings, ...warnings];
  next.derivedFrom = { erModelId: record.erModelId, conversionId: record.id };

  draft.models[replaceModelId] = next;
  draft.conversions[record.id] = record;

  const positions = opts.positions && positionsByRelation(opts.positions, result);
  let diagramId: Id | undefined;
  const viewing = Object.values(draft.diagrams).filter((d) => d.modelId === replaceModelId);
  const before = new Set(viewing.flatMap((d) => Object.keys(d.nodes)));
  if (viewing.length === 0 && !draft.diagrams[result.diagram.id]) {
    const fresh = createDiagramForModel(next, 'relational-schema', { name: result.diagram.name, id: result.diagram.id });
    placeNodes(fresh, positions);
    draft.diagrams[fresh.id] = fresh;
    draft.diagramOrder.push(fresh.id);
    diagramId = fresh.id;
  }
  commitSync(draft, replaceModelId); // prunes vanished nodes/edges, adds nodes for new relations
  // Existing nodes keep their place; only nodes created by this sync take the supplied layout.
  for (const d of viewing) {
    const fresh = Object.fromEntries(Object.entries(d.nodes).filter(([id]) => !before.has(id)));
    placeNodes({ nodes: fresh }, positions);
  }
  return { modelId: replaceModelId, conversionId: record.id, diagramId, replaced: true, kept: merge.kept, dropped: merge.dropped, overwritten: merge.overwritten.map((o) => o.text) };
}

/** Positions are keyed by result-diagram node id or relation id; translate node-id keys to relation ids for new nodes. */
function positionsByRelation(positions: Record<Id, Point>, result: ConversionResult): Record<Id, Point> {
  const out: Record<Id, Point> = {};
  for (const [id, p] of Object.entries(positions)) {
    const node = result.diagram.nodes[id];
    if (node?.ref.kind === 'relation') out[node.ref.id] = p;
    else out[id] = p;
  }
  return out;
}

