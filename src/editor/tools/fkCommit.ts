/** Foreign-key creation commit (ONE foreign key with ordered pairs, ONE undo step). */
import * as ops from '@/model/ops';
import type { ForeignKeyColumnPair, Id, RelationalModel } from '@/model/types';
import type { EditorStore } from '@/store';
import { describePairs } from './fkLogic';

export type CreateFkOutcome = { ok: true; foreignKeyId: Id; edgeId?: Id; text: string } | { ok: false; message: string };

export function createForeignKey(store: EditorStore, diagramId: Id, sourceRelationId: Id, targetRelationId: Id, pairs: readonly ForeignKeyColumnPair[]): CreateFkOutcome {
  const st = store.getState();
  const d = st.project.diagrams[diagramId];
  const model = d ? st.project.models[d.modelId] : undefined;
  if (!d || !model || model.kind !== 'relational') return { ok: false, message: 'No relational diagram' };
  let foreignKeyId: Id | undefined;
  try {
    st.commit('Add foreign key', (draft) => {
      const res = ops.addForeignKey(draft, model.id, { sourceRelationId, targetRelationId, columns: pairs.map((p) => ({ sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId })) });
      foreignKeyId = res.refs[0]!.id;
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!foreignKeyId) return { ok: false, message: 'Foreign key was not created' };
  const after = store.getState().project;
  const diagram = after.diagrams[diagramId]!;
  const edgeId = Object.values(diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === foreignKeyId)?.id;
  const text = describePairs(after.models[model.id] as RelationalModel, sourceRelationId, targetRelationId, pairs);
  if (edgeId) store.getState().setSelection([edgeId], { kind: 'foreignKey', id: foreignKeyId });
  return { ok: true, foreignKeyId, ...(edgeId ? { edgeId } : {}), text };
}
