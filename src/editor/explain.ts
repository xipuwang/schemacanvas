/**
 * Plain-language explanations of database symbols, built from the SEMANTIC model (never from pixels): what a double line,
 * an underline, a PK / FK mark or a cardinality label means for THIS diagram element. Used by the canvas tooltips (hover and
 * keyboard focus) and by the screen-reader outline.
 */
import { t, currentLocale } from '@/i18n';
import { cardinalityText } from '@/model/erSemantics';
import { attributesOf, columnRole, describeForeignKey, foreignKeysOf, ownGet } from '@/model/queries';
import type { Diagram, ErModel, ErParticipant, ErRelationship, Id, Project, Relation, RelationalModel } from '@/model/types';
import type { HitResult } from './hit';

/** English plural of an entity name for the cardinality sentences ("many Drugs"); other locales do not inflect. */
export function pluralName(name: string): string {
  if (currentLocale() !== 'en') return name;
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

const entityName = (m: ErModel, id: Id): string => ownGet(m.entities, id)?.name?.trim() || '?';
const relName = (r: ErRelationship): string => r.name?.trim() || '?';

/** The cardinality sentence of a participant ("One Company relates to many Drugs"), look-across semantics. */
export function explainCardinality(model: ErModel, rel: ErRelationship, p: ErParticipant): string {
  const entity = entityName(model, p.entityId);
  const letter = cardinalityText(rel, p.id);
  const others = rel.participants.filter((x) => x.id !== p.id);
  const many = p.max === 'many';
  if (others.length === 1) {
    const other = entityName(model, others[0]!.entityId);
    return t(many ? 'editor.tip.card.many' : 'editor.tip.card.one', { letter, entity, entities: pluralName(entity), other, relationship: relName(rel) });
  }
  return t(many ? 'editor.tip.card.nary.many' : 'editor.tip.card.nary.one', { letter, entity, entities: pluralName(entity), relationship: relName(rel) });
}

export function explainParticipation(model: ErModel, rel: ErRelationship, p: ErParticipant): string {
  const entity = entityName(model, p.entityId);
  return t(p.participation === 'total' ? 'editor.tip.line.total' : 'editor.tip.line.partial', { entity, relationship: relName(rel) });
}

function describeColumn(model: RelationalModel, rel: Relation, columnId: Id): string {
  const col = rel.columns.find((c) => c.id === columnId);
  if (!col) return '';
  const role = columnRole(model, rel.id, columnId);
  const fks = foreignKeysOf(model, rel.id).filter((fk) => fk.columns.some((c) => c.sourceColumnId === columnId));
  const target = fks.length ? describeForeignKey(model, fks[0]!).split(' → ')[1] ?? '?' : '';
  const params = { column: col.name, table: rel.name, target, key: rel.primaryKey.map((id) => rel.columns.find((c) => c.id === id)?.name ?? '?').join(', ') };
  const parts: string[] = [];
  if (role === 'pk') parts.push(t(rel.primaryKey.length > 1 ? 'editor.tip.col.pkComposite' : 'editor.tip.col.pk', params));
  else if (role === 'fk') parts.push(t('editor.tip.col.fk', params));
  else if (role === 'pk+fk') parts.push(t('editor.tip.col.pkfk', params));
  else parts.push(t('editor.tip.col.plain', params));
  parts.push(col.dataType ? t('editor.tip.col.type', { type: col.dataType }) : t('editor.tip.col.noType'));
  parts.push(t(col.nullable ? 'editor.tip.col.nullable' : 'editor.tip.col.notNull'));
  return parts.join(' ');
}

/** Explanation of what a node is; `columnId` narrows a table to one cell, `onName` to the relation name. */
export function explainNode(project: Project, diagram: Diagram, nodeId: Id, columnId?: Id): string | null {
  const node = ownGet(diagram.nodes, nodeId);
  const model = ownGet(project.models, diagram.modelId);
  if (!node || !model) return null;
  const ref = node.ref;
  if (model.kind === 'er') {
    if (ref.kind === 'entity') {
      const e = ownGet(model.entities, ref.id);
      if (!e) return null;
      if (e.associativeOf) return t('editor.tip.entity.associative', { name: e.name });
      return t(e.weak ? 'editor.tip.entity.weak' : 'editor.tip.entity.strong', { name: e.name });
    }
    if (ref.kind === 'relationship') {
      const r = ownGet(model.relationships, ref.id);
      if (!r) return null;
      const names = r.participants.map((p) => entityName(model, p.entityId));
      const list = names.length ? names.join(', ') : t('editor.tip.rel.none');
      return t(r.identifying ? 'editor.tip.rel.identifying' : 'editor.tip.rel.plain', { name: relName(r), entities: list });
    }
    if (ref.kind === 'attribute') {
      const a = ownGet(model.attributes, ref.id);
      if (!a) return null;
      const owner = a.owner.kind === 'entity' ? ownGet(model.entities, a.owner.id)?.name : a.owner.kind === 'relationship' ? ownGet(model.relationships, a.owner.id)?.name : ownGet(model.attributes, a.owner.id)?.name;
      const params = { name: a.name, owner: owner?.trim() || '?' };
      const composite = attributesOf(model, { kind: 'attribute', id: a.id }).length > 0;
      if (a.key === 'primary') return t('editor.tip.attr.key', params);
      if (a.key === 'partial') return t('editor.tip.attr.partial', params);
      if (a.multivalued) return t('editor.tip.attr.multivalued', params);
      if (a.derived) return t('editor.tip.attr.derived', params);
      if (composite) return t('editor.tip.attr.composite', params);
      return t('editor.tip.attr.simple', params);
    }
    return null;
  }
  if (ref.kind !== 'relation') return null;
  const rel = ownGet(model.relations, ref.id);
  if (!rel) return null;
  if (columnId) return describeColumn(model, rel, columnId);
  return t('editor.tip.table', { name: rel.name, count: rel.columns.length });
}

/** Explanation of a connector (or one of its labels). */
export function explainEdge(project: Project, diagram: Diagram, edgeId: Id, labelId?: 'main' | 'role' | 'cardinality'): string | null {
  const edge = ownGet(diagram.edges, edgeId);
  const model = ownGet(project.models, diagram.modelId);
  if (!edge || !model) return null;
  if (edge.ref.kind === 'participant' && model.kind === 'er') {
    const rel = ownGet(model.relationships, edge.ref.relationshipId);
    const p = rel?.participants.find((x) => x.id === (edge.ref as { participantId: Id }).participantId);
    if (!rel || !p) return null;
    if (labelId === 'cardinality') return explainCardinality(model, rel, p);
    if (labelId === 'role') return t('editor.tip.role', { role: p.role?.trim() || '?', entity: entityName(model, p.entityId), relationship: relName(rel) });
    return `${explainParticipation(model, rel, p)} ${explainCardinality(model, rel, p)}`;
  }
  if (edge.ref.kind === 'attribute' && model.kind === 'er') {
    const a = ownGet(model.attributes, edge.ref.attributeId);
    if (!a) return null;
    const owner = a.owner.kind === 'entity' ? ownGet(model.entities, a.owner.id)?.name : a.owner.kind === 'relationship' ? ownGet(model.relationships, a.owner.id)?.name : ownGet(model.attributes, a.owner.id)?.name;
    return t('editor.tip.attrLink', { name: a.name, owner: owner?.trim() || '?' });
  }
  if (edge.ref.kind === 'foreignKey' && model.kind === 'relational') {
    const fk = ownGet(model.foreignKeys, edge.ref.foreignKeyId);
    if (!fk) return null;
    return t('editor.tip.fk', { text: describeForeignKey(model, fk) });
  }
  return null;
}

/** What to say about whatever the pointer is over (null = nothing worth a tooltip). */
export function explainHit(project: Project, diagram: Diagram, hit: HitResult): string | null {
  if (hit.kind === 'node') return explainNode(project, diagram, hit.nodeId, hit.columnId);
  if (hit.kind === 'edge') return explainEdge(project, diagram, hit.edgeId);
  if (hit.kind === 'edge-label') return explainEdge(project, diagram, hit.edgeId, hit.labelId);
  return null;
}

/** Tooltip text of a port glyph (`data-port` kind). */
export function explainPort(kind: string): string | null {
  if (kind === 'add-attribute' || kind === 'connect' || kind === 'fk') return t(`editor.tip.port.${kind}`);
  return null;
}
