/**
 * Scene builder for the VERTICAL family: `crows-foot` (vertical tables or single-row tables, crow's foot connector
 * ends) and `physical` (types, constraints, indexes). Draws only what `diagram.nodes` / `diagram.edges` contain;
 * anything dangling is skipped with a `Scene.warnings` entry. See ./README.md.
 */
import { defaultDiagramOptions } from '@/model/defaults';
import { ownGet } from '@/model/queries';
import type { ForeignKey, Id } from '@/model/types';
import type { SceneBuilder } from '../registry-types';
import type { EdgeGeom, NodeGeom } from '../types';
import { assembleScene } from '../util';
import { makeEdgeReuse } from '../draft';
import { buildVFkEdges } from './fk';
import { vTableOptionsOf } from './size';
import { layoutVTable, type VTableLayout, type VTableOptions } from './table';

export type * from './types';
export { buildSymbol, childSymbolKind, parentSymbolKind, SYMBOL_LENGTH } from './symbols';
export { VERTICAL_CONSTANTS } from './exports';
export { createVerticalSizer, vTableOptionsOf } from './size';
export { resolveOverlapDisplacements, resolveOverlapPositions, type ResolveOverlapOptions } from './overlaps';

export const buildVerticalScene: SceneBuilder = (input) => {
  const { diagram, model, measure } = input;
  const warnings: string[] = [];
  if (model.kind !== 'relational') {
    warnings.push(`non-relational-model:${model.id}`);
    return assembleScene(diagram, {}, {}, warnings);
  }
  const options = diagram.options;
  const physical = diagram.type === 'physical';
  const cf = options.crowsFoot ?? defaultDiagramOptions('crows-foot').crowsFoot!;
  const ph = options.physical ?? defaultDiagramOptions('physical').physical!;
  const vo: VTableOptions = vTableOptionsOf(diagram);
  const routing = (physical ? ph.routing : cf.routing) === 'straight' ? 'straight' : 'orthogonal';

  // FK facts per relation, computed once (role + physical constraint summaries).
  const fkCols = new Map<Id, Set<Id>>();
  const outgoing = new Map<Id, ForeignKey[]>();
  for (const fk of Object.values(model.foreignKeys ?? {})) {
    if (!fk) continue;
    const set = fkCols.get(fk.sourceRelationId) ?? new Set<Id>();
    for (const p of Array.isArray(fk.columns) ? fk.columns : []) if (p && typeof p.sourceColumnId === 'string') set.add(p.sourceColumnId);
    fkCols.set(fk.sourceRelationId, set);
    outgoing.set(fk.sourceRelationId, [...(outgoing.get(fk.sourceRelationId) ?? []), fk]);
  }

  const layouts = new Map<Id, VTableLayout>();
  const nodeOfRelation = new Map<Id, Id>();
  const nodes: Record<Id, NodeGeom> = {};
  for (const [nodeId, node] of Object.entries(diagram.nodes ?? {})) {
    const relation = node?.ref?.kind === 'relation' ? ownGet(model.relations, node.ref.id) : undefined;
    if (!relation) {
      warnings.push(`missing-relation:${nodeId}`);
      continue;
    }
    if (nodeOfRelation.has(relation.id)) {
      warnings.push(`duplicate-relation-node:${nodeId}`);
      continue;
    }
    const layout = layoutVTable(node, relation, model, fkCols.get(relation.id), outgoing.get(relation.id) ?? [], options, vo, measure);
    layouts.set(nodeId, layout);
    nodeOfRelation.set(relation.id, nodeId);
    nodes[nodeId] = layout.geom;
  }

  const typo = options.typography;
  const edges = buildVFkEdges({
    model,
    layouts,
    nodeOfRelation,
    edges: Object.entries(diagram.edges ?? {}),
    routing,
    measure,
    fontFamily: typo?.fontFamily ?? 'Helvetica, Arial, sans-serif',
    fontSize: Number.isFinite(typo?.fontSize) ? typo.fontSize : 14,
    warnings,
    reuse: makeEdgeReuse(input),
  });
  const edgeGeoms: Record<Id, EdgeGeom> = {};
  for (const id of Object.keys(diagram.edges ?? {})) if (edges[id]) edgeGeoms[id] = edges[id]!;
  return assembleScene(diagram, nodes, edgeGeoms, warnings);
};
