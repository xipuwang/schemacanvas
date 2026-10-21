/**
 * The Delete key is a SEMANTIC delete: removing a node removes the model element it shows (and, by the ops' cascade table,
 * everything that depends on it). Presentation-only removal is `removeFromDiagram` (a separate command).
 */
import { refResolves } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import { ownGet } from '@/model/queries';
import type { Id, Project, SemanticRef } from '@/model/types';
import type { Selection } from '@/store';
import { formatList, t, tp } from '@/i18n';

/** The semantic elements a selection stands for, in a safe order (sub-selection wins; edges first, then nodes). */
export function selectionRefs(project: Project, diagramId: Id, selection: Selection): SemanticRef[] {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return [];
  if (selection.sub?.kind === 'column') return [selection.sub];
  const edgeRefs: SemanticRef[] = [];
  const nodeRefs: SemanticRef[] = [];
  for (const id of selection.ids) {
    const edge = ownGet(diagram.edges, id);
    if (edge) {
      if (edge.ref.kind === 'participant') edgeRefs.push({ kind: 'participant', relationshipId: edge.ref.relationshipId, id: edge.ref.participantId });
      else if (edge.ref.kind === 'attribute') edgeRefs.push({ kind: 'attribute', id: edge.ref.attributeId });
      else edgeRefs.push({ kind: 'foreignKey', id: edge.ref.foreignKeyId });
      continue;
    }
    const node = ownGet(diagram.nodes, id);
    if (node) nodeRefs.push(node.ref);
  }
  return [...edgeRefs, ...nodeRefs];
}

/** Remove each ref that still exists (cascades may already have removed it). Returns the number removed. Throws OpError like any op. */
export function removeRefs(draft: Project, modelId: Id, refs: readonly SemanticRef[]): number {
  let n = 0;
  for (const ref of refs) {
    const model = draft.models[modelId];
    if (!model || !refResolves(model, ref)) continue;
    switch (ref.kind) {
      case 'entity':
        ops.removeEntity(draft, modelId, ref.id);
        break;
      case 'attribute':
        ops.removeAttribute(draft, modelId, ref.id);
        break;
      case 'relationship':
        ops.removeRelationship(draft, modelId, ref.id);
        break;
      case 'participant':
        ops.removeParticipant(draft, modelId, ref.relationshipId, ref.id);
        break;
      case 'relation':
        ops.removeRelation(draft, modelId, ref.id);
        break;
      case 'column':
        ops.removeColumn(draft, modelId, ref.relationId, ref.id);
        break;
      case 'foreignKey':
        ops.removeForeignKey(draft, modelId, ref.id);
        break;
      default:
        continue;
    }
    n++;
  }
  return n;
}

// ---- what a delete took with it -------------------------------------------------------------------------------------------

type Counts = { attributes: number; participants: number; relationships: number; columns: number; foreignKeys: number; entities: number; relations: number };

function countsOf(project: Project, modelId: Id): Counts {
  const m = project.models[modelId];
  const c: Counts = { attributes: 0, participants: 0, relationships: 0, columns: 0, foreignKeys: 0, entities: 0, relations: 0 };
  if (!m) return c;
  if (m.kind === 'er') {
    c.entities = Object.keys(m.entities).length;
    c.attributes = Object.keys(m.attributes).length;
    c.relationships = Object.keys(m.relationships).length;
    c.participants = Object.values(m.relationships).reduce((n, r) => n + r.participants.length, 0);
  } else {
    c.relations = Object.keys(m.relations).length;
    c.columns = Object.values(m.relations).reduce((n, r) => n + r.columns.length, 0);
    c.foreignKeys = Object.keys(m.foreignKeys).length;
  }
  return c;
}

function nameOfRef(project: Project, modelId: Id, ref: SemanticRef): string {
  const m = project.models[modelId];
  if (!m) return '';
  if (m.kind === 'er') {
    if (ref.kind === 'entity') return t('editor.deleted.entity', { name: m.entities[ref.id]?.name ?? '?' });
    if (ref.kind === 'relationship') return t('editor.deleted.relationship', { name: m.relationships[ref.id]?.name ?? '?' });
    if (ref.kind === 'attribute') return t('editor.deleted.attribute', { name: m.attributes[ref.id]?.name ?? '?' });
    if (ref.kind === 'participant') return t('editor.deleted.participant');
  } else {
    if (ref.kind === 'relation') return t('editor.deleted.table', { name: m.relations[ref.id]?.name ?? '?' });
    if (ref.kind === 'column') return t('editor.deleted.column', { name: m.relations[ref.relationId]?.columns.find((c) => c.id === ref.id)?.name ?? '?' });
    if (ref.kind === 'foreignKey') return t('editor.deleted.foreignKey');
  }
  return '';
}

export interface DeleteSummary {
  /** "entity Drug" / "3 items". */
  what: string;
  /** "2 attributes and 3 participation lines" the delete removed besides what was selected ('' when nothing else went). */
  also: string;
}

/** Snapshot taken BEFORE the delete; call `finish(after)` once it has been applied. */
export function summarizeDelete(project: Project, modelId: Id, refs: readonly SemanticRef[]): (after: Project) => DeleteSummary {
  const before = countsOf(project, modelId);
  const what = refs.length === 1 ? nameOfRef(project, modelId, refs[0]!) : t('editor.deleted.items', { count: refs.length });
  const direct: Counts = { attributes: 0, participants: 0, relationships: 0, columns: 0, foreignKeys: 0, entities: 0, relations: 0 };
  for (const r of refs) {
    if (r.kind === 'entity') direct.entities++;
    else if (r.kind === 'attribute') direct.attributes++;
    else if (r.kind === 'relationship') {
      direct.relationships++;
      // a relationship takes its own participants with it: they are part of the thing selected, not collateral
      const m = project.models[modelId];
      if (m?.kind === 'er') direct.participants += m.relationships[r.id]?.participants.length ?? 0;
    } else if (r.kind === 'participant') direct.participants++;
    else if (r.kind === 'relation') {
      direct.relations++;
      const m = project.models[modelId];
      if (m?.kind === 'relational') direct.columns += m.relations[r.id]?.columns.length ?? 0;
    } else if (r.kind === 'column') direct.columns++;
    else if (r.kind === 'foreignKey') direct.foreignKeys++;
  }
  return (after) => {
    const now = countsOf(after, modelId);
    const extra = (k: keyof Counts): number => Math.max(0, before[k] - now[k] - direct[k]);
    const parts: string[] = [];
    for (const k of ['attributes', 'participants', 'relationships', 'columns', 'foreignKeys'] as const) {
      const n = extra(k);
      if (n > 0) parts.push(tp(`editor.deleted.cascade.${k}`, n));
    }
    return { what, also: formatList(parts) };
  };
}
