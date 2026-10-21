/**
 * Every panel edit goes through `runEdit`: one `store.commit` (= one undo step) around ops. When an op throws (`OpError`
 * or anything else) the commit is discarded, the project is unchanged and the message is shown inline at the top of the
 * panel instead of crashing or failing silently.
 */
import { createStore, useStore } from 'zustand';
import { useMemo } from 'react';
import { OpError } from '@/model/ops';
import { groupByAffected } from '@/validation';
import type { Issue, Project, SemanticRef } from '@/model/types';
import { refKey } from '@/model/queries';
import { editorStore, useEditorStore } from '@/store';
import { t } from '@/i18n';
import { uiStore, useUi } from '../../uiStore';

export const editErrorStore = createStore<{ message: string | null }>(() => ({ message: null }));
export const useEditError = (): string | null => useStore(editErrorStore, (s) => s.message);
export const clearEditError = (): void => {
  if (editErrorStore.getState().message !== null) editErrorStore.setState({ message: null });
};

/** The message shown for a failed edit: what happened, and that nothing changed. */
export function describeEditFailure(e: unknown): string {
  const detail = e instanceof OpError || e instanceof Error ? e.message : String(e);
  return t('properties.editFailed', { message: detail });
}

/** Run `fn` as ONE undoable commit. Returns false (and shows the error) when it throws; the project is then unchanged. */
export function runEdit(label: string, fn: (draft: Project) => void, opts?: { select?: readonly string[] | (() => string[] | undefined) }): boolean {
  try {
    const store = editorStore.getState();
    if (typeof opts?.select === 'function') {
      const getSelect = opts.select;
      store.commit(label, (d) => void fn(d), {
        get select() {
          return getSelect();
        },
      });
    } else store.commit(label, (d) => void fn(d), opts?.select ? { select: [...opts.select] } : undefined);
    clearEditError();
    return true;
  } catch (e) {
    editErrorStore.setState({ message: describeEditFailure(e) });
    return false;
  }
}

/** Active diagram, its model and the project, as stable references between unrelated edits. */
export function useActive() {
  const project = useEditorStore((s) => s.project);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const diagram = diagramId ? project.diagrams[diagramId] : undefined;
  const model = diagram ? project.models[diagram.modelId] : undefined;
  return { project, diagramId, diagram, model };
}

/** Issues keyed by `refKey` with roll-up (a table also lists its columns' issues). */
export function useIssueMap(): Record<string, Issue[]> {
  const issues = useUi((s) => s.issues);
  return useMemo(() => groupByAffected(issues, { rollUp: true }), [issues]);
}

export function issuesOf(map: Record<string, Issue[]>, ref: SemanticRef): Issue[] {
  return map[refKey(ref)] ?? [];
}

/** Clicking an issue badge focuses it on the sheet and reveals it in the issues dock. */
export function focusIssue(issue: Issue): void {
  const ui = uiStore.getState();
  ui.focusIssue(issue.id);
  ui.setDock('issues');
}
