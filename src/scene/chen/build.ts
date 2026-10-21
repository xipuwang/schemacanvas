/**
 * `buildChenScene`: pure (project, diagram, model, measure) -> Scene for `chen` diagrams.
 * Draws ONLY what is stored (nodes/edges of the diagram); notation flags come straight from the model.
 */
import type { Id } from '@/model/types';
import type { SceneBuilder } from '../registry-types';
import type { NodeGeom } from '../types';
import { makeNodeReuse } from '../draft';
import { assembleScene, emptyScene } from '../util';
import { buildChenEdges } from './edges';
import { nodeFont } from './metrics';
import { attributeGeom, entityGeom, relationshipGeom } from './nodes';
import type { ChenNodeGeomAny } from './types';

export const buildChenScene: SceneBuilder = (input) => {
  const { diagram, model, measure } = input;
  if (model.kind !== 'er') return { ...emptyScene(diagram.id), warnings: ['chen-model-not-er'] };
  const warnings: string[] = [];
  const geoms: Record<Id, ChenNodeGeomAny> = {};
  const showTypes = diagram.options.chen?.showDataTypes ?? false;
  const reuseNode = makeNodeReuse(input);

  for (const [id, node] of Object.entries(diagram.nodes)) {
    // Corrupt files: a node with a non-finite position or size is skipped (its edges then warn as dangling).
    if (![node.x, node.y, node.width, node.height].every((v) => v === undefined || Number.isFinite(v))) {
      warnings.push(`chen-node-invalid:${id}`);
      continue;
    }
    const kept = reuseNode?.(id);
    if (kept) {
      geoms[id] = kept as ChenNodeGeomAny;
      continue;
    }
    const font = nodeFont(diagram, node.style);
    const color = node.style?.textColor;
    const ref = node.ref;
    if (ref.kind === 'entity' && model.entities[ref.id]) {
      geoms[id] = entityGeom(node, model.entities[ref.id]!, font, measure, color);
    } else if (ref.kind === 'attribute' && model.attributes[ref.id]) {
      geoms[id] = attributeGeom(node, model.attributes[ref.id]!, font, measure, color, showTypes);
    } else if (ref.kind === 'relationship' && model.relationships[ref.id]) {
      geoms[id] = relationshipGeom(node, model.relationships[ref.id]!, font, measure, color);
    } else {
      warnings.push(`chen-node-dangling:${id}`);
    }
  }

  const edges = buildChenEdges({ input, model, geoms, font: nodeFont(diagram), warnings });
  return assembleScene(diagram, geoms as Record<Id, NodeGeom>, edges, warnings);
};
