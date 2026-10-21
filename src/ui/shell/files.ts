/** Open / save / new-project flows shared by commands, drag-drop and dialogs. */
import { downloadProjectFile, openProjectFromFile } from '@/persistence';
import { editorStore } from '@/store';
import { produce } from 'immer';
import { createProject } from '@/model/defaults';
import * as ops from '@/model/ops';
import type { Id, Project } from '@/model/types';
import { localizeLoadError, t } from '@/i18n';
import { uiStore } from '../uiStore';
import { confirmDiscardUnlessSaved, replaceProject } from './replace';

/** True when nothing would be lost by replacing the project (kept as a recent entry, or empty). Asks otherwise. */
export const confirmDiscardIfDirty = confirmDiscardUnlessSaved;

/** Load a `.schemacanvas.json` File into the editor; shows a toast with the LoadError message on failure. */
export async function openProjectFile(file: File): Promise<boolean> {
  const result = await openProjectFromFile(file);
  if (!result.ok) {
    uiStore.getState().pushToast({ kind: 'error', message: t('shell.open.failed', { file: file.name, message: localizeLoadError(result.error) }) });
    return false;
  }
  const { project, repairs } = result;
  const res = await replaceProject(project, { label: project.name, repairs: repairs.length });
  if (!res.replaced) return false;
  if (!res.keptPrevious)
    uiStore.getState().pushToast({
      kind: repairs.length ? 'warning' : 'success',
      message: repairs.length ? t('shell.open.repaired', { name: project.name, count: repairs.length }) : t('shell.open.done', { name: project.name }),
    });
  return true;
}

/** Programmatic file picker (no visible input needed). */
export function pickProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.schemacanvas.json,application/json';
  input.style.display = 'none';
  input.setAttribute('data-testid', 'open-file-input');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void openProjectFile(file);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
}

export function saveProjectFile(): string {
  const state = editorStore.getState();
  const project = state.project;
  const name = downloadProjectFile(project);
  state.markSaved(undefined, project);
  uiStore.getState().pushToast({ kind: 'success', message: t('shell.save.done', { file: name }) });
  return name;
}

export type NewProjectStart = 'chen' | 'relational-schema';

/** A fresh project starting from an empty ER or relational diagram (pure: nothing is loaded). */
export function buildNewProject(name: string, start: NewProjectStart): { project: Project; activeDiagramId: Id | undefined } {
  const base = createProject(name);
  if (start === 'chen') return { project: base, activeDiagramId: base.diagramOrder[0] };
  let created: Id | undefined;
  const project = produce(base, (d) => {
    const chen = d.diagramOrder[0];
    created = ops.createDiagram(d, { type: 'relational-schema' }).diagramId;
    if (chen) ops.removeModel(d, d.diagrams[chen]!.modelId);
  });
  return { project, activeDiagramId: created };
}

/** Replace the editor project with a fresh one starting from an empty ER or relational diagram (keeps the old one in Recent). */
export async function createNewProject(name: string, start: NewProjectStart): Promise<boolean> {
  const { project, activeDiagramId } = buildNewProject(name, start);
  return (await replaceProject(project, { label: name, activeDiagramId, verb: 'created' })).replaced;
}
