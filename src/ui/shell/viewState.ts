/** Restore / persist which sheet and bottom dock were open per project (see persistence/viewState). */
import { loadViewState, saveViewState } from '@/persistence';
import { editorStore } from '@/store';
import type { Project } from '@/model/types';
import { uiStore } from '../uiStore';

/** Apply the saved view state of `project` (validated against it: a deleted sheet is ignored). */
export function restoreViewState(project: Project): void {
  const saved = loadViewState(project.id);
  if (!saved) return;
  const store = editorStore.getState();
  if (saved.activeDiagramId && Object.hasOwn(project.diagrams, saved.activeDiagramId) && store.activeDiagramId !== saved.activeDiagramId) store.setActiveDiagram(saved.activeDiagramId);
  if (saved.dock !== undefined && uiStore.getState().dock !== saved.dock) uiStore.getState().setDock(saved.dock);
}

/** Persist the active sheet / dock on change; re-apply the saved state whenever a different project is loaded. */
export function startViewState(): () => void {
  const offEditor = editorStore.subscribe((s, prev) => {
    if (s.project.id !== prev.project.id) {
      restoreViewState(s.project);
      return;
    }
    if (s.activeDiagramId && s.activeDiagramId !== prev.activeDiagramId) saveViewState(s.project.id, { activeDiagramId: s.activeDiagramId });
  });
  const offUi = uiStore.subscribe((s, prev) => {
    if (s.dock !== prev.dock) saveViewState(editorStore.getState().project.id, { dock: s.dock });
  });
  return () => {
    offEditor();
    offUi();
  };
}
