/** Test-only helpers: real projects (Chen pharmacy, relational pharmacy) loaded into real stores. */
import { editorStore, createEditorStore, type EditorStore } from '@/store';
import { layoutChenFixture, pharmacy } from '@/scene/chen/fixtures';
import { pharmacyFixture, nodeIdOf } from '@/scene/horizontal/fixtures';
import { buildScene } from '@/scene/registry';
import type { Id, Project } from '@/model/types';

export interface Setup {
  project: Project;
  chenId: Id;
  relId: Id;
}

export function pharmacyProject(): Setup {
  const chen = layoutChenFixture(pharmacy());
  const project = chen.project;
  const rf = pharmacyFixture();
  project.models[rf.model.id] = rf.model;
  project.diagrams[rf.diagram.id] = rf.diagram;
  project.diagramOrder.push(rf.diagram.id);
  return { project, chenId: chen.diagram.id, relId: rf.diagram.id };
}

/** A fresh store with the pharmacy project, the given diagram active. */
export function makeStore(which: 'chen' | 'rel' = 'chen'): { store: EditorStore; setup: Setup; diagramId: Id } {
  const setup = pharmacyProject();
  const store = createEditorStore({ project: setup.project });
  const diagramId = which === 'chen' ? setup.chenId : setup.relId;
  store.getState().setActiveDiagram(diagramId);
  return { store, setup, diagramId };
}

/** Load the pharmacy project into the GLOBAL store (commands act on it). */
export function loadGlobal(which: 'chen' | 'rel' = 'chen'): { diagramId: Id; setup: Setup } {
  const setup = pharmacyProject();
  editorStore.getState().loadProject(setup.project);
  const diagramId = which === 'chen' ? setup.chenId : setup.relId;
  editorStore.getState().setActiveDiagram(diagramId);
  return { diagramId, setup };
}

/** DiagramNode id of the element named `name` (entity / relationship / relation / attribute) in a diagram. */
export function nodeNamed(project: Project, diagramId: Id, name: string): Id {
  const d = project.diagrams[diagramId]!;
  const m = project.models[d.modelId]!;
  for (const [id, n] of Object.entries(d.nodes)) {
    const ref = n.ref;
    let label: string | undefined;
    if (m.kind === 'er') {
      if (ref.kind === 'entity') label = m.entities[ref.id]?.name;
      else if (ref.kind === 'relationship') label = m.relationships[ref.id]?.name;
      else if (ref.kind === 'attribute') label = m.attributes[ref.id]?.name;
    } else if (ref.kind === 'relation') label = m.relations[ref.id]?.name;
    if (label === name) return id;
  }
  throw new Error(`no node named ${name}`);
}

export const sceneOf = (project: Project, diagramId: Id) => buildScene(project, diagramId);
export { nodeIdOf };
