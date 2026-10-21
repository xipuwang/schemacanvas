/** Re-parenting an attribute (entity | relationship | composite attribute): the candidates, and the one-commit move. */
import { nodeIdOfRef } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import { attributesOf, ownGet, rootOwner } from '@/model/queries';
import type { ErAttributeOwner, ErModel, Id, Project } from '@/model/types';
import { t } from '@/i18n';
import { runEdit } from './edit';
import { placeBesideOwner } from './placement';

export interface OwnerChoice {
  /** `kind:id`, the value of the owner select. */
  value: string;
  owner: ErAttributeOwner;
  label: string;
}

export const ownerValue = (o: { kind: string; id: Id }): string => `${o.kind}:${o.id}`;

/** Ids of `attrId` and everything nested below it (moving under any of them would be a cycle). */
function subtree(model: ErModel, attrId: Id): Set<Id> {
  const out = new Set<Id>([attrId]);
  const walk = (id: Id): void => {
    for (const c of attributesOf(model, { kind: 'attribute', id })) if (!out.has(c.id)) (out.add(c.id), walk(c.id));
  };
  walk(attrId);
  return out;
}

/**
 * Every owner `attrId` may move to, exactly the set `ops.moveAttribute` accepts and that is meaningful: all entities and
 * relationships, plus composite attributes (those that already have parts) that are not the attribute itself or inside it.
 * The current owner is included (so a select can show it) and flagged by `value`.
 */
export function ownerChoices(model: ErModel, attrId: Id): OwnerChoice[] {
  const banned = subtree(model, attrId);
  const byName = <T extends { name: string; id: string }>(a: T, b: T): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const out: OwnerChoice[] = [];
  for (const e of Object.values(model.entities).sort(byName)) out.push({ value: ownerValue({ kind: 'entity', id: e.id }), owner: { kind: 'entity', id: e.id }, label: e.name });
  for (const r of Object.values(model.relationships).sort(byName)) out.push({ value: ownerValue({ kind: 'relationship', id: r.id }), owner: { kind: 'relationship', id: r.id }, label: r.name });
  for (const a of Object.values(model.attributes).sort(byName)) {
    if (banned.has(a.id) || attributesOf(model, { kind: 'attribute', id: a.id }).length === 0) continue;
    const root = rootOwner(model, a);
    const rootName = root ? (root.kind === 'entity' ? ownGet(model.entities, root.id)?.name : ownGet(model.relationships, root.id)?.name) : undefined;
    out.push({ value: ownerValue({ kind: 'attribute', id: a.id }), owner: { kind: 'attribute', id: a.id }, label: rootName ? `${rootName} › ${a.name}` : a.name });
  }
  return out;
}

/** Whether `owner` is a valid destination for `attrId` (used by drag-and-drop, where the target is not from the select). */
export function canMoveTo(model: ErModel, attrId: Id, owner: ErAttributeOwner): boolean {
  const a = model.attributes[attrId];
  if (!a || (a.owner.kind === owner.kind && a.owner.id === owner.id)) return false;
  if (owner.kind === 'attribute') return !subtree(model, attrId).has(owner.id) && !!model.attributes[owner.id];
  return owner.kind === 'entity' ? !!model.entities[owner.id] : !!model.relationships[owner.id];
}

/**
 * Move the attribute in ONE commit. Key flags only mean something on entities (`partial` only on weak ones), so they are
 * reset when the new owner cannot carry them; the node is placed beside its new owner. Returns false when refused.
 */
export function moveAttributeTo(modelId: Id, attrId: Id, owner: ErAttributeOwner, diagramId: Id | null | undefined): boolean {
  return runEdit(t('properties.attrs.moveOwnerLabel'), (d: Project) => {
    const m = d.models[modelId];
    if (!m || m.kind !== 'er') return;
    const rootBefore = rootOwner(m, m.attributes[attrId]!);
    ops.moveAttribute(d, modelId, attrId, owner);
    const a = m.attributes[attrId]!;
    const weak = owner.kind === 'entity' && !!m.entities[owner.id]?.weak;
    if ((a.key === 'primary' && owner.kind !== 'entity') || (a.key === 'partial' && !weak)) ops.updateAttribute(d, modelId, attrId, { key: 'none' });
    const rootAfter = rootOwner(m, a);
    // `derivedFrom` names attributes of the SAME owner: after a move to another owner they no longer apply
    if (a.derivedFrom?.length && (rootBefore?.id !== rootAfter?.id)) ops.updateAttribute(d, modelId, attrId, { derivedFrom: undefined });
    const diagram = diagramId ? d.diagrams[diagramId] : undefined;
    if (diagramId && diagram && diagram.modelId === modelId) {
      const nodeId = nodeIdOfRef(diagram, m, { kind: 'attribute', id: attrId });
      if (nodeId) placeBesideOwner(d, diagramId, { kind: owner.kind, id: owner.id }, [nodeId]);
    }
  });
}
