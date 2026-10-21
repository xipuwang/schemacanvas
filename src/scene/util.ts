import type { Diagram, Id } from '@/model/types';
import type { Rect } from './base';
import { inflateRect, unionRects } from './geometry';
import type { EdgeGeom, NodeGeom, Scene } from './types';

export const EMPTY_BOUNDS: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function emptyScene(diagramId: Id): Scene {
  return { diagramId, nodes: {}, edges: {}, nodeOrder: [], edgeOrder: [], bounds: EMPTY_BOUNDS, warnings: [] };
}

/**
 * Assemble a Scene from per-node and per-edge geometry: computes paint order (zIndex ascending,
 * then diagram insertion order) and the content bounds (nodes + edges, including labels the
 * builders folded into `bounds`).
 */
export function assembleScene(
  diagram: Diagram,
  nodes: Record<Id, NodeGeom>,
  edges: Record<Id, EdgeGeom>,
  warnings: string[] = [],
): Scene {
  const insertion = new Map<Id, number>();
  Object.keys(diagram.nodes).forEach((id, i) => insertion.set(id, i));
  const nodeOrder = Object.keys(nodes).sort((a, b) => {
    const za = diagram.nodes[a]?.zIndex ?? 0;
    const zb = diagram.nodes[b]?.zIndex ?? 0;
    return za - zb || (insertion.get(a) ?? 0) - (insertion.get(b) ?? 0);
  });
  const edgeOrder = Object.keys(edges);
  const rects = [...Object.values(nodes).map((n) => n.paintBounds), ...Object.values(edges).map((e) => e.bounds)];
  const union = unionRects(rects);
  return {
    diagramId: diagram.id,
    nodes,
    edges,
    nodeOrder,
    edgeOrder,
    bounds: union ? inflateRect(union, 1) : EMPTY_BOUNDS,
    warnings,
  };
}
