/**
 * Scene builder for the HORIZONTAL relational schema (`relational-schema` diagrams): tables are a name + ONE row of
 * bordered cells (./table.ts); foreign keys are routed orthogonal connectors ending on the exact referenced cell (./fk.ts).
 * Draws only what `diagram.nodes` / `diagram.edges` contain; anything dangling is skipped with a `Scene.warnings` entry.
 */
import { defaultDiagramOptions } from '@/model/defaults';
import type { Id } from '@/model/types';
import type { SceneBuilder } from '../registry-types';
import { assembleScene } from '../util';
import type { EdgeGeom, NodeGeom } from '../types';
import { makeEdgeReuse } from '../draft';
import { buildFkEdges } from './fk';
import { sanitizeEdge, sanitizeNode } from './sanitize';
import { layoutTable, type TableLayout } from './table';

export { HORIZONTAL_CONSTANTS } from './exports';
export type * from './types';

export const buildHorizontalScene: SceneBuilder = (input) => {
  const { diagram, model, measure } = input;
  const warnings: string[] = [];
  if (model.kind !== 'relational') {
    warnings.push(`non-relational-model:${model.id}`);
    return assembleScene(diagram, {}, {}, warnings);
  }
  const options = diagram.options;
  const rel = options.relational ?? defaultDiagramOptions('relational-schema').relational!;

  const layouts = new Map<Id, TableLayout>();
  const nodeOfRelation = new Map<Id, Id>();
  const nodes: Record<Id, NodeGeom> = {};
  for (const [nodeId, rawNode] of Object.entries(diagram.nodes)) {
    const node = sanitizeNode(rawNode);
    if (!node) {
      warnings.push(`h-node-invalid:${nodeId}`);
      continue;
    }
    const relation = node.ref.kind === 'relation' ? model.relations[node.ref.id] : undefined;
    if (!relation) {
      warnings.push(`missing-relation:${nodeId}`);
      continue;
    }
    // Rule 3 of the model: one node per semantic element. A duplicate is ignored rather than drawn twice.
    if (nodeOfRelation.has(relation.id)) {
      warnings.push(`duplicate-relation-node:${nodeId}`);
      continue;
    }
    const layout = layoutTable(node, relation, model, options, rel, measure);
    layouts.set(nodeId, layout);
    nodeOfRelation.set(relation.id, nodeId);
    nodes[nodeId] = layout.geom;
  }

  const typo = options.typography;
  const edges = buildFkEdges({
    model,
    layouts,
    nodeOfRelation,
    edges: Object.entries(diagram.edges).map(([id, e]): [Id, typeof e] => [id, sanitizeEdge(e)]),
    rel,
    measure,
    fontFamily: typo.fontFamily,
    fontSize: typo.fontSize,
    warnings,
    reuse: makeEdgeReuse(input),
  });
  const edgeGeoms: Record<Id, EdgeGeom> = {};
  for (const [id] of Object.entries(diagram.edges)) if (edges[id]) edgeGeoms[id] = edges[id]!;
  return assembleScene(diagram, nodes, edgeGeoms, warnings);
};
