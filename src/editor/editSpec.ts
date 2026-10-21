/**
 * Resolve WHAT an inline text edit changes and WHERE the input goes. Pure (no DOM): the canvas renders an <input> from the
 * returned world rect + font and calls `commit` inside `store.commit` with the typed text.
 */
import * as ops from '@/model/ops';
import { ownGet } from '@/model/queries';
import type { Id, Project } from '@/model/types';
import type { FontSpec, Rect } from '@/scene/base';
import { labelRect, pointAlongPolyline } from '@/scene/geometry';
import type { Scene } from '@/scene/types';

export type EditKind = 'entity' | 'attribute' | 'relationship' | 'relation' | 'column' | 'fkLabel' | 'role';

export interface EditTarget {
  nodeId?: Id;
  columnId?: Id;
  edgeId?: Id;
}

export interface EditSpec {
  kind: EditKind;
  nodeId?: Id;
  columnId?: Id;
  edgeId?: Id;
  /** Current text (empty for an unset optional label). */
  value: string;
  /** World rectangle of the text being edited. */
  rect: Rect;
  font: FontSpec;
  align: 'start' | 'middle' | 'end';
  /** Optional labels (FK label, role) may be cleared; names may not. */
  allowEmpty: boolean;
  /** Apply `text` (already trimmed). Runs inside `store.commit`. */
  commit(draft: Project, text: string): void;
}

const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export function resolveEditSpec(project: Project, diagramId: Id, scene: Scene, target: EditTarget): EditSpec | undefined {
  const diagram = ownGet(project.diagrams, diagramId);
  const model = diagram ? ownGet(project.models, diagram.modelId) : undefined;
  if (!diagram || !model) return undefined;
  const modelId = model.id;

  if (target.nodeId) {
    const node = ownGet(diagram.nodes, target.nodeId);
    const geom = ownGet(scene.nodes, target.nodeId);
    if (!node || !geom) return undefined;
    const ref = node.ref;
    if (model.kind === 'er' && geom.kind !== 'h-table') {
      const label = 'label' in geom ? geom.label : undefined;
      if (!label) return undefined;
      const rect = inflate(labelRect(label), 2);
      const base = { nodeId: target.nodeId, rect, font: label.font, align: 'middle' as const, allowEmpty: false };
      if (ref.kind === 'entity') {
        const e = ownGet(model.entities, ref.id);
        if (!e) return undefined;
        return { ...base, kind: 'entity', value: e.name, commit: (d, text) => ops.updateEntity(d, modelId, ref.id, { name: text }) };
      }
      if (ref.kind === 'relationship') {
        const r = ownGet(model.relationships, ref.id);
        if (!r) return undefined;
        return { ...base, kind: 'relationship', value: r.name, commit: (d, text) => ops.updateRelationship(d, modelId, ref.id, { name: text }) };
      }
      if (ref.kind === 'attribute') {
        const a = ownGet(model.attributes, ref.id);
        if (!a) return undefined;
        return { ...base, kind: 'attribute', value: a.name, commit: (d, text) => ops.updateAttribute(d, modelId, ref.id, { name: text }) };
      }
      return undefined;
    }
    if (model.kind === 'relational' && geom.kind === 'h-table' && ref.kind === 'relation') {
      const rel = ownGet(model.relations, ref.id);
      if (!rel) return undefined;
      if (target.columnId) {
        const cell = geom.cells.find((c) => c.columnId === target.columnId);
        const col = rel.columns.find((c) => c.id === target.columnId);
        if (!cell || !col) return undefined;
        return {
          kind: 'column',
          nodeId: target.nodeId,
          columnId: col.id,
          value: col.name,
          rect: cell.rect,
          font: cell.label.font,
          align: 'middle',
          allowEmpty: false,
          commit: (d, text) => ops.updateColumn(d, modelId, rel.id, col.id, { name: text }),
        };
      }
      return {
        kind: 'relation',
        nodeId: target.nodeId,
        value: rel.name,
        rect: inflate(labelRect(geom.nameLabel), 2),
        font: geom.nameLabel.font,
        align: geom.nameLabel.anchor,
        allowEmpty: false,
        commit: (d, text) => ops.updateRelation(d, modelId, rel.id, { name: text }),
      };
    }
    return undefined;
  }

  if (target.edgeId) {
    const edge = ownGet(diagram.edges, target.edgeId);
    const geom = ownGet(scene.edges, target.edgeId);
    if (!edge || !geom) return undefined;
    const labelId = edge.ref.kind === 'foreignKey' ? 'main' : 'role';
    const existing = geom.labels.find((l) => l.id === labelId)?.label;
    let rect: Rect;
    let font: FontSpec;
    if (existing) {
      rect = inflate(labelRect(existing), 3);
      font = existing.font;
    } else {
      const main = geom.paths[0] ?? [];
      const mid = main.length >= 2 ? pointAlongPolyline(main, 0.5) : (main[0] ?? { x: 0, y: 0 });
      font = { family: diagram.options.typography.fontFamily, size: Math.max(11, diagram.options.typography.fontSize - 2) };
      rect = { x: mid.x - 45, y: mid.y - font.size * 0.9, w: 90, h: font.size * 1.8 };
    }
    if (edge.ref.kind === 'foreignKey' && model.kind === 'relational') {
      const fkId = edge.ref.foreignKeyId;
      const fk = ownGet(model.foreignKeys, fkId);
      if (!fk) return undefined;
      return {
        kind: 'fkLabel',
        edgeId: target.edgeId,
        value: fk.label ?? '',
        rect,
        font,
        align: 'middle',
        allowEmpty: true,
        commit: (d, text) => ops.updateForeignKey(d, modelId, fkId, { label: text === '' ? undefined : text }),
      };
    }
    if (edge.ref.kind === 'participant' && model.kind === 'er') {
      const { relationshipId, participantId } = edge.ref;
      const part = ownGet(model.relationships, relationshipId)?.participants.find((p) => p.id === participantId);
      if (!part) return undefined;
      return {
        kind: 'role',
        edgeId: target.edgeId,
        value: part.role ?? '',
        rect,
        font,
        align: 'middle',
        allowEmpty: true,
        commit: (d, text) => ops.updateParticipant(d, modelId, relationshipId, participantId, { role: text === '' ? undefined : text }),
      };
    }
  }
  return undefined;
}

/** Previous/next cell of the same relation (for Tab / Shift+Tab while editing a column name). */
export function neighbourColumn(project: Project, diagramId: Id, spec: Pick<EditSpec, 'nodeId' | 'columnId'>, dir: 1 | -1): Id | undefined {
  const diagram = ownGet(project.diagrams, diagramId);
  const node = spec.nodeId && diagram ? ownGet(diagram.nodes, spec.nodeId) : undefined;
  const model = diagram ? ownGet(project.models, diagram.modelId) : undefined;
  if (!node || model?.kind !== 'relational' || node.ref.kind !== 'relation') return undefined;
  const rel = ownGet(model.relations, node.ref.id);
  if (!rel) return undefined;
  const i = rel.columns.findIndex((c) => c.id === spec.columnId);
  return i < 0 ? undefined : rel.columns[i + dir]?.id;
}
