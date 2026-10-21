/**
 * Pure sizing of vertical-family tables WITHOUT building a scene: the exact `layoutVTable` run the scene builder does,
 * so `estimate === real size` (same measure, same options). Used for provisional placement of new nodes
 * (`model/diagramSync`) where the old horizontal-table guess made crow's foot / physical sheets open overlapping.
 */
import { defaultDiagramOptions } from '@/model/defaults';
import type { Diagram, DiagramNode, ForeignKey, Id, RelationalModel } from '@/model/types';
import type { MeasureText } from '../base';
import { layoutVTable, type VTableOptions } from './table';

type DiagramLike = Pick<Diagram, 'type' | 'options'>;

/** The table options a `crows-foot` / `physical` diagram implies (single source of truth, shared with the scene builder). */
export function vTableOptionsOf(diagram: DiagramLike): VTableOptions {
  const options = diagram.options;
  if (diagram.type === 'physical') {
    const ph = options.physical ?? defaultDiagramOptions('physical').physical!;
    return { mode: 'physical', orientation: 'vertical', showTypes: true, showNullability: true, showIndexes: ph.showIndexes, showConstraints: ph.showConstraints };
  }
  const cf = options.crowsFoot ?? defaultDiagramOptions('crows-foot').crowsFoot!;
  return { mode: 'crows-foot', orientation: cf.orientation === 'horizontal' ? 'horizontal' : 'vertical', showTypes: cf.showTypes, showNullability: cf.showNullability, showIndexes: false, showConstraints: false };
}

/**
 * A sizer for the relations of `model` as drawn by `diagram` (types `crows-foot` / `physical`). FK facts are indexed
 * once; each call lays out one table. Pass the real `node` to honour its width/height/typography overrides.
 */
export function createVerticalSizer(
  model: RelationalModel,
  diagram: DiagramLike,
  measure: MeasureText,
): (relationId: Id, node?: Pick<DiagramNode, 'width' | 'height' | 'style' | 'columnWidths'>) => { w: number; h: number } | undefined {
  const vo = vTableOptionsOf(diagram);
  const fkCols = new Map<Id, Set<Id>>();
  const outgoing = new Map<Id, ForeignKey[]>();
  for (const fk of Object.values(model.foreignKeys ?? {})) {
    if (!fk) continue;
    const set = fkCols.get(fk.sourceRelationId) ?? new Set<Id>();
    for (const p of Array.isArray(fk.columns) ? fk.columns : []) if (p && typeof p.sourceColumnId === 'string') set.add(p.sourceColumnId);
    fkCols.set(fk.sourceRelationId, set);
    outgoing.set(fk.sourceRelationId, [...(outgoing.get(fk.sourceRelationId) ?? []), fk]);
  }
  return (relationId, node) => {
    const relation = Object.prototype.hasOwnProperty.call(model.relations, relationId) ? model.relations[relationId] : undefined;
    if (!relation) return undefined;
    const probe: DiagramNode = { id: '__size__', ref: { kind: 'relation', id: relationId }, x: 0, y: 0, ...(node?.width !== undefined ? { width: node.width } : {}), ...(node?.height !== undefined ? { height: node.height } : {}), ...(node?.style ? { style: node.style } : {}), ...(node?.columnWidths ? { columnWidths: node.columnWidths } : {}) };
    const { geom } = layoutVTable(probe, relation, model, fkCols.get(relationId), outgoing.get(relationId) ?? [], diagram.options, vo, measure);
    return { w: geom.bounds.w, h: geom.bounds.h };
  };
}
