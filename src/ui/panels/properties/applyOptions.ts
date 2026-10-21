/** Diagram-option edits as ONE undo step that also re-spaces nodes the change made overlap (font size, row height, ...). */
import { current } from 'immer';
import * as ops from '@/model/ops';
import type { Id, Project } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { t, tp } from '@/i18n';
import { uiStore } from '../../uiStore';
import { runEdit } from './edit';
import { resolveOverlapPositions } from './spacing';

/**
 * `ops.setDiagramOptions` plus an automatic overlap pass merged into the same commit. When nodes had to be moved a toast
 * says how many. Options that cannot change node sizes (the grid) skip the scene work entirely.
 */
export function applyDiagramOptions(diagramId: Id, label: string, patch: Parameters<typeof ops.setDiagramOptions>[2]): boolean {
  let moved = 0;
  let tables = true;
  const mayGrow = Object.keys(patch).some((k) => k !== 'grid');
  const ok = runEdit(label, (d) => {
    const scene = (p: Project) => buildScene(p, diagramId);
    let before: ReturnType<typeof scene> | undefined;
    if (mayGrow) {
      try {
        before = scene(current(d) as Project);
      } catch {
        before = undefined;
      }
    }
    ops.setDiagramOptions(d, diagramId, patch);
    if (!before) return;
    try {
      const proj = current(d) as Project;
      const after = scene(proj);
      const diagram = proj.diagrams[diagramId]!;
      const locked = new Set(Object.values(diagram.nodes).filter((n) => n.locked).map((n) => n.id));
      const delta = resolveOverlapPositions(before, after, { lockedIds: locked });
      const positions: Record<Id, { x: number; y: number }> = {};
      for (const [id, v] of Object.entries(delta)) {
        const n = diagram.nodes[id];
        if (n) positions[id] = { x: n.x + v.dx, y: n.y + v.dy };
      }
      if (Object.keys(positions).length === 0) return;
      moved = ops.setNodePositions(d, diagramId, positions).length;
      tables = diagram.type !== 'chen';
    } catch {
      /* the option change stands; spacing is a courtesy */
    }
  });
  if (ok && moved > 0) uiStore.getState().pushToast({ kind: 'info', message: tp(tables ? 'properties.diagram.movedApart' : 'properties.diagram.movedApartShapes', moved) });
  return ok;
}
