import { OpError } from '@/model/ops';
import type { Diagram, Id, Project } from '@/model/types';
import { t } from '@/i18n';
import { uiStore } from '@/ui/uiStore';
import type { CommandContext } from './registry';

export interface ActiveInfo {
  project: Project;
  diagramId: Id;
  diagram: Diagram;
  /** Selected DiagramNode ids that exist in the diagram. */
  nodeIds: Id[];
  /** Selected DiagramEdge ids that exist in the diagram. */
  edgeIds: Id[];
  /** Selected nodes that are not locked. */
  unlockedNodeIds: Id[];
}

export function activeInfo(ctx: CommandContext): ActiveInfo | undefined {
  const s = ctx.store.getState();
  const diagramId = s.activeDiagramId;
  const diagram = diagramId ? Object.hasOwn(s.project.diagrams, diagramId) ? s.project.diagrams[diagramId] : undefined : undefined;
  if (!diagramId || !diagram) return undefined;
  const nodeIds = s.selection.ids.filter((id) => Object.hasOwn(diagram.nodes, id));
  const edgeIds = s.selection.ids.filter((id) => Object.hasOwn(diagram.edges, id));
  return { project: s.project, diagramId, diagram, nodeIds, edgeIds, unlockedNodeIds: nodeIds.filter((id) => !diagram.nodes[id]!.locked) };
}

/** Surface an op failure as a toast instead of an unhandled exception (the commit was discarded as a whole). */
export function reportOpError(err: unknown): void {
  const message = err instanceof OpError || err instanceof Error ? err.message : String(err);
  uiStore.getState().pushToast({ kind: 'error', message: t('editor.toast.opFailed', { message }) });
}

/** Run `fn`, reporting OpErrors. Returns true on success. */
export function guarded(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    reportOpError(err);
    return false;
  }
}
