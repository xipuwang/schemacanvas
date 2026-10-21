/** Human names of model elements behind diagram nodes (for announcements, hints and toasts). */
import type { Diagram, Id, Project } from '@/model/types';

export function nodeName(project: Project, diagram: Diagram, nodeId: Id): string {
  const ref = diagram.nodes[nodeId]?.ref;
  const m = project.models[diagram.modelId];
  if (!ref || !m) return '';
  if (m.kind === 'er') {
    if (ref.kind === 'entity') return m.entities[ref.id]?.name ?? '';
    if (ref.kind === 'relationship') return m.relationships[ref.id]?.name ?? '';
    if (ref.kind === 'attribute') return m.attributes[ref.id]?.name ?? '';
  } else if (ref.kind === 'relation') return m.relations[ref.id]?.name ?? '';
  return '';
}
