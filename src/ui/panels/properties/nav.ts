/** Selection helpers: jump from a form to the element it mentions on the sheet. */
import { nodeIdOfRef } from '@/model/diagramSync';
import type { Id, SemanticRef } from '@/model/types';
import { editorStore } from '@/store';

/** Select the node that shows `ref` on the active sheet. Returns false when it has none (partial diagram, other model). */
export function selectRef(ref: SemanticRef): boolean {
  const s = editorStore.getState();
  const diagram = s.activeDiagramId ? s.project.diagrams[s.activeDiagramId] : undefined;
  const model = diagram ? s.project.models[diagram.modelId] : undefined;
  if (!diagram || !model) return false;
  const nodeId = nodeIdOfRef(diagram, model, ref);
  if (!nodeId) return false;
  s.setSelection([nodeId]);
  return true;
}

export function selectForeignKeyEdge(foreignKeyId: Id): boolean {
  const s = editorStore.getState();
  const diagram = s.activeDiagramId ? s.project.diagrams[s.activeDiagramId] : undefined;
  const edge = diagram ? Object.values(diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === foreignKeyId) : undefined;
  if (!edge) return false;
  s.setSelection([edge.id], { kind: 'foreignKey', id: foreignKeyId });
  return true;
}

export function selectColumnCell(nodeId: Id, relationId: Id, columnId: Id): void {
  editorStore.getState().setSelection([nodeId], { kind: 'column', relationId, id: columnId });
}
