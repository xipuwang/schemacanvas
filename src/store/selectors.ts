import { modelOfDiagram } from '@/model/queries';
import type { Diagram, Model, Project } from '@/model/types';
import type { EditorStoreState } from './editorStore';

export const selectProject = (s: EditorStoreState): Project => s.project;

export const selectActiveDiagram = (s: Pick<EditorStoreState, 'project' | 'activeDiagramId'>): Diagram | undefined =>
  s.activeDiagramId ? s.project.diagrams[s.activeDiagramId] : undefined;

/** The semantic model the active diagram views. Stable reference between unrelated edits (immer structural sharing). */
export const selectActiveModel = (s: Pick<EditorStoreState, 'project' | 'activeDiagramId'>): Model | undefined => {
  const d = selectActiveDiagram(s);
  return d ? modelOfDiagram(s.project, d) : undefined;
};

export const selectSelectedIds = (s: EditorStoreState): readonly string[] => s.selection.ids;
