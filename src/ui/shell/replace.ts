/**
 * The ONE way to swap the open project for another (new project, open file, drop, example, project import, recent).
 *
 * Autosave overwrites its slot a moment after `loadProject`, so without this helper the previous project would be gone with
 * no confirmation. Instead, when the current project has content it is first written as a recent entry (`saveSnapshot`),
 * and after the switch a toast offers "Reopen previous". Empty / trivial projects are replaced silently.
 * If storage is unavailable AND there are unsaved changes the user is asked first (private-browsing safety).
 */
import { saveSnapshot } from '@/persistence';
import { newId } from '@/model/ids';
import type { Id, Project } from '@/model/types';
import { editorStore } from '@/store';
import { t } from '@/i18n';
import { uiStore } from '../uiStore';
import { confirmDialog } from './confirm';

export interface ReplaceOptions {
  /** Name shown in the toast (usually the new project's name). */
  label: string;
  /** Diagram to activate after the switch (default: the first). */
  activeDiagramId?: Id | undefined;
  /** Automatic repairs applied while loading (turns the toast into a warning). */
  repairs?: number;
  /** Toast wording for projects that were created rather than opened. */
  verb?: 'opened' | 'created';
  /** Never toast (the caller reports itself). */
  silent?: boolean;
}

export interface ReplaceResult {
  /** False when the user cancelled the discard confirmation. */
  replaced: boolean;
  /** True when a non-trivial previous project was kept in Recent projects. */
  keptPrevious: boolean;
}

/** Does the project contain anything worth keeping (entity, attribute, relationship, relation or diagram node)? */
export function projectHasContent(p: Readonly<Project>): boolean {
  for (const m of Object.values(p.models)) {
    if (m.kind === 'er') {
      if (Object.keys(m.entities).length || Object.keys(m.attributes).length || Object.keys(m.relationships).length) return true;
    } else if (Object.keys(m.relations).length) return true;
  }
  return Object.values(p.diagrams).some((d) => Object.keys(d.nodes).length > 0);
}

/**
 * Persist the current project as a recent entry. Resolves false when the write did not land (storage unavailable/failed).
 * Also marks the project saved when it landed, so the dirty flag does not trigger a second prompt.
 */
export async function persistCurrentProject(): Promise<boolean> {
  const project = editorStore.getState().project;
  const ok = await saveSnapshot(project);
  if (ok) editorStore.getState().markSaved(undefined, project);
  return ok;
}

/** `confirmDiscardIfDirty` for flows that start a dialog BEFORE replacing: true when nothing would be lost. */
export async function confirmDiscardUnlessSaved(): Promise<boolean> {
  const state = editorStore.getState();
  if (!state.dirty || !projectHasContent(state.project)) return true;
  if (await persistCurrentProject()) return true;
  return confirmDialog({
    title: t('shell.discard.title'),
    message: t('shell.discard.message'),
    confirmLabel: t('shell.discard.confirm'),
    danger: true,
  });
}

export async function replaceProject(next: Project, opts: ReplaceOptions): Promise<ReplaceResult> {
  const store = editorStore.getState();
  const previous = store.project;
  const previousActive = store.activeDiagramId;
  const hadContent = projectHasContent(previous);

  let kept = false;
  if (hadContent) {
    kept = await persistCurrentProject();
    // Unsaved work and nowhere to put it: ask, exactly like before the safety net existed.
    if (!kept && editorStore.getState().dirty) {
      const ok = await confirmDialog({
        title: t('shell.discard.title'),
        message: t('shell.discard.message'),
        confirmLabel: t('shell.discard.confirm'),
        danger: true,
      });
      if (!ok) return { replaced: false, keptPrevious: false };
    }
    // The autosave slot is keyed by project id: never let the replacement overwrite the kept copy.
    if (next.id === previous.id) next = { ...next, id: newId('prj') };
  }

  const current = editorStore.getState();
  current.loadProject(next);
  const target = opts.activeDiagramId && next.diagrams[opts.activeDiagramId] ? opts.activeDiagramId : undefined;
  if (target) editorStore.getState().setActiveDiagram(target);

  const keptPrevious = hadContent && kept;
  if (keptPrevious && !opts.silent) {
    const repairs = opts.repairs ?? 0;
    const message = repairs > 0 ? t('shell.replace.openedRepaired', { name: opts.label, count: repairs }) : t(opts.verb === 'created' ? 'shell.replace.created' : 'shell.replace.opened', { name: opts.label });
    uiStore.getState().pushToast({
      kind: repairs > 0 ? 'warning' : 'success',
      message,
      ttl: 12000,
      action: {
        label: t('shell.replace.reopen'),
        // the in-memory frozen project is exact (selection aside); the stored copy only backs the Recent dialog
        onSelect: () => {
          void replaceProject(previous, { label: previous.name, activeDiagramId: previousActive ?? undefined }).catch((e: unknown) =>
            uiStore.getState().pushToast({ kind: 'error', message: t('shell.replace.reopenFailed', { message: e instanceof Error ? e.message : String(e) }) }),
          );
        },
      },
    });
  }
  return { replaced: true, keptPrevious };
}
