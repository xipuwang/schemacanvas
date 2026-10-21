/** Where elements created from the panel land on the active sheet: the nearest free spot beside their owner. */
import { current } from 'immer';
import { placeNear } from '@/layout';
import * as ops from '@/model/ops';
import { nodeIdOfRef } from '@/model/diagramSync';
import type { Id, Project, SemanticRef } from '@/model/types';
import { buildScene } from '@/scene/registry';

/** Move each freshly created node next to the node that shows `ownerRef` (no overlap with anything). Never throws. */
export function placeBesideOwner(draft: Project, diagramId: Id, ownerRef: SemanticRef, newNodeIds: readonly Id[]): void {
  const diagram = draft.diagrams[diagramId];
  const model = diagram ? draft.models[diagram.modelId] : undefined;
  if (!diagram || !model) return;
  const ownerNodeId = nodeIdOfRef(diagram, model, ownerRef);
  for (const nodeId of newNodeIds) {
    try {
      const scene = buildScene(current(draft) as Project, diagramId);
      const g = scene.nodes[nodeId];
      const owner = ownerNodeId ? scene.nodes[ownerNodeId] : undefined;
      if (!g || !owner) continue;
      const obstacles = scene.nodeOrder.filter((id) => id !== nodeId).map((id) => scene.nodes[id]!.paintBounds);
      const grid = diagram.options.grid.snap ? diagram.options.grid.size : 0;
      const at = placeNear({ w: g.bounds.w, h: g.bounds.h }, owner.bounds, obstacles, { gap: 28 });
      const snap = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
      const snapped = { x: snap(at.x), y: snap(at.y) };
      const clear = !obstacles.some((o) => snapped.x < o.x + o.w + 8 && snapped.x + g.bounds.w + 8 > o.x && snapped.y < o.y + o.h + 8 && snapped.y + g.bounds.h + 8 > o.y);
      ops.setNodePositions(draft, diagramId, { [nodeId]: clear ? snapped : at });
    } catch {
      /* placement is a nicety: the node keeps its provisional position */
    }
  }
}
