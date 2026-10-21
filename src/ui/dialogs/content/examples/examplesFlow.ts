/** Examples gallery logic: filtering and opening an example (replaces the project). */
import { buildExample, EXAMPLES } from '@/examples';
import type { ExampleDefinition } from '@/examples';
import type { DiagramType, Id, Project } from '@/model/types';
import { editorStore as globalStore, type EditorStore } from '@/store';

export type ExampleView = 'er' | 'relational';

export const diagramTypeOf = (view: ExampleView): DiagramType => (view === 'er' ? 'chen' : 'relational-schema');

/** Search over the localized title/description plus level, level label and tags. Case-insensitive, all words must match. */
export function filterExamples(examples: readonly ExampleDefinition[], query: string, text: (e: ExampleDefinition) => string): ExampleDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...examples];
  return examples.filter((e) => {
    const hay = `${text(e)} ${e.level} ${e.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** First diagram (tab order) of the wanted view; falls back to the first diagram. */
export function diagramToActivate(project: Project, view: ExampleView): Id | undefined {
  const type = diagramTypeOf(view);
  return project.diagramOrder.find((id) => project.diagrams[id]?.type === type) ?? project.diagramOrder[0];
}

/** Replace the project with the example and activate the diagram of `view`. Returns the loaded project. */
export function openExample(id: string, view: ExampleView, store: EditorStore = globalStore): Project {
  const project = buildExample(id);
  store.getState().loadProject(project);
  const target = diagramToActivate(project, view);
  if (target) store.getState().setActiveDiagram(target);
  return project;
}

export { EXAMPLES };
