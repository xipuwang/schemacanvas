/** Screen-reader announcements for selection and focus changes (rendered into the canvas' `aria-live` region). */
import { cardinalityText } from '@/model/erSemantics';
import { attributesOf, describeForeignKey, ownGet } from '@/model/queries';
import type { ErModel, ErRelationship, Id, Project } from '@/model/types';
import { t, tp } from '@/i18n';
import type { Selection } from '@/store';

type Verb = 'sel' | 'focus';

const entityName = (m: ErModel, id: Id): string => ownGet(m.entities, id)?.name?.trim() || '?';
const partWord = (p: { participation: 'total' | 'partial' }): string => t(p.participation === 'total' ? 'editor.outline.total' : 'editor.outline.partial');

/** `Company (1, partial), Drug (N, total)` — the participants of a relationship with their cardinality and participation. */
export function describeParticipants(model: ErModel, rel: ErRelationship): string {
  return rel.participants.map((p) => `${entityName(model, p.entityId)} (${cardinalityText(rel, p.id)}, ${partWord(p)})`).join(', ');
}

function describeOne(project: Project, diagramId: Id, id: Id, sub: Selection['sub'], verb: Verb): string {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return '';
  const model = ownGet(project.models, diagram.modelId);
  if (!model) return '';
  const k = (key: string): string => `editor.${verb}.${key}`;
  const node = ownGet(diagram.nodes, id);
  if (node) {
    const ref = node.ref;
    if (model.kind === 'er') {
      if (ref.kind === 'entity') {
        const e = ownGet(model.entities, ref.id);
        if (e) return tp(k(e.weak ? 'weakEntity' : 'entity'), attributesOf(model, { kind: 'entity', id: e.id }).length, { name: e.name });
      }
      if (ref.kind === 'relationship') {
        const r = ownGet(model.relationships, ref.id);
        if (r) {
          const base = tp(k(r.identifying ? 'identifyingRelationship' : 'relationship'), attributesOf(model, { kind: 'relationship', id: r.id }).length, { name: r.name });
          return r.participants.length ? base + t('editor.sel.detail.relationship', { list: describeParticipants(model, r) }) : base;
        }
      }
      if (ref.kind === 'attribute') {
        const a = ownGet(model.attributes, ref.id);
        if (a) return t(k('attribute'), { name: a.name });
      }
    } else if (ref.kind === 'relation') {
      const r = ownGet(model.relations, ref.id);
      if (r) {
        if (verb === 'sel' && sub?.kind === 'column') {
          const c = r.columns.find((x) => x.id === sub.id);
          if (c) return t('editor.sel.column', { name: c.name, table: r.name });
        }
        return tp(k('table'), r.columns.length, { name: r.name });
      }
    }
    return '';
  }
  const edge = ownGet(diagram.edges, id);
  if (edge) {
    if (edge.ref.kind === 'foreignKey' && model.kind === 'relational') {
      const fk = ownGet(model.foreignKeys, edge.ref.foreignKeyId);
      if (fk) {
        const [source = '?', target = '?'] = describeForeignKey(model, fk).split(' → ');
        return t(k('foreignKey'), { source, target });
      }
    }
    if (edge.ref.kind === 'participant') {
      const base = t(k('participant'));
      if (model.kind === 'er') {
        const rel = ownGet(model.relationships, edge.ref.relationshipId);
        const pid = edge.ref.participantId;
        const p = rel?.participants.find((x) => x.id === pid);
        if (rel && p) return base + t('editor.sel.detail.participant', { entity: entityName(model, p.entityId), relationship: rel.name?.trim() || '?', card: cardinalityText(rel, p.id), participation: partWord(p) });
      }
      return base;
    }
    if (edge.ref.kind === 'attribute') return t(k('attributeLink'));
  }
  return '';
}

export function describeSelection(project: Project, diagramId: Id, selection: Selection): string {
  const diagram = project.diagrams[diagramId];
  if (!diagram || selection.ids.length === 0) return '';
  if (!ownGet(project.models, diagram.modelId)) return '';
  if (selection.ids.length > 1) return tp('editor.sel.many', selection.ids.length);
  return describeOne(project, diagramId, selection.ids[0]!, selection.sub, 'sel');
}

/** What the roving keyboard focus announces: the item WITHOUT claiming it is selected, plus how to select it. */
export function describeFocus(project: Project, diagramId: Id): (id: Id) => string {
  return (id) => {
    const text = describeOne(project, diagramId, id, undefined, 'focus');
    return text ? t('editor.focus.item', { text }) : '';
  };
}
