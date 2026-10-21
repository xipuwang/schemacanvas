/**
 * Add a PREBUILT model (DDL/DBML import, examples, templates) to a project together with its diagrams, in the ops
 * style: mutates a draft, validates preconditions first (nothing is half-applied), ends consistent (diagrams complete,
 * edges materialised). Callers run `autoLayout` afterwards (or pass `positions`).
 */
import { modelKindForDiagramType } from '../defaults';
import { createDiagramForModel } from '../diagramSync';
import { forEachId } from '../invariants';
import type { DiagramType, Id, Model, Point, Project } from '../types';
import { OpError, jsonClone } from './common';

export interface AddModelInit {
  /** Diagram types to create for the model (default: `chen` for ER models, `relational-schema` for relational ones). */
  diagramTypes?: DiagramType[];
  /** Name of the FIRST diagram (others keep their default names). */
  diagramName?: string;
  /** Initial positions for the FIRST diagram, keyed by node id OR by the element id the node stands for. */
  positions?: Record<Id, Point>;
}

export function addModel(draft: Project, model: Model, init: AddModelInit = {}): { modelId: Id; diagramIds: Id[] } {
  const types = init.diagramTypes ?? [model.kind === 'er' ? 'chen' : 'relational-schema'];
  for (const t of types) {
    if (modelKindForDiagramType(t) !== model.kind) {
      throw new OpError('wrong-kind', `${t} diagrams view ${modelKindForDiagramType(t)} models, not ${model.kind}`);
    }
  }
  const incoming = jsonClone(model);
  // every id of the new model must be unused project-wide (ids are global)
  const taken = new Set<Id>();
  forEachId(draft, (id) => void taken.add(id));
  const probe = { models: { [incoming.id]: incoming }, diagrams: {}, conversions: {} } as unknown as Project;
  const seen = new Set<Id>();
  forEachId(probe, (id) => {
    if (taken.has(id) || seen.has(id)) throw new OpError('id-in-use', `Id ${id} is already in use`);
    seen.add(id);
  });

  draft.models[incoming.id] = incoming;
  const stored = draft.models[incoming.id]!;
  const diagramIds: Id[] = [];
  types.forEach((type, i) => {
    const diagram = createDiagramForModel(stored, type, i === 0 && init.diagramName ? { name: init.diagramName } : {});
    if (i === 0 && init.positions) {
      for (const node of Object.values(diagram.nodes)) {
        const p = init.positions[node.id] ?? init.positions[node.ref.id];
        if (p) {
          node.x = p.x;
          node.y = p.y;
        }
      }
    }
    draft.diagrams[diagram.id] = diagram;
    draft.diagramOrder.push(diagram.id);
    diagramIds.push(diagram.id);
  });
  return { modelId: incoming.id, diagramIds };
}
