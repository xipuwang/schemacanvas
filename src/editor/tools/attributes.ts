/**
 * Add-attribute affordance, commit part. One commit per click: the attribute (and, for a composite, its two starting
 * sub-attributes) is created next to its owner on the nearest free spot, then selected and renamed inline by the caller.
 */
import { current } from 'immer';
import * as ops from '@/model/ops';
import type { Diagram, ErAttributeOwner, ErModel, Id, Point, Project, SemanticRef } from '@/model/types';
import { buildScene } from '@/scene/registry';
import type { EditorStore } from '@/store';
import { nextDefaultName } from '../creation';
import { freeSpotFor } from '../placement';
import { center } from './geom';

export type AttrFlavor = 'simple' | 'key' | 'partial-key' | 'multivalued' | 'derived' | 'composite';

/** Flavours the menu offers for an owner of this kind (keys exist on entities only; a sub-attribute is just a simple child). */
export function flavorsFor(ownerKind: ErAttributeOwner['kind']): AttrFlavor[] {
  if (ownerKind === 'entity') return ['simple', 'key', 'partial-key', 'multivalued', 'derived', 'composite'];
  return ['simple', 'multivalued', 'derived', 'composite'];
}

export const ownerOfNode = (diagram: Diagram, nodeId: Id): ErAttributeOwner | undefined => {
  const ref = diagram.nodes[nodeId]?.ref;
  return ref && (ref.kind === 'entity' || ref.kind === 'relationship' || ref.kind === 'attribute') ? { kind: ref.kind, id: ref.id } : undefined;
};

const nodeOfRef = (d: Diagram, ref: SemanticRef): Id | undefined => Object.values(d.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)?.id;

export type AddAttributeOutcome = { ok: true; nodeId: Id; created: Id[] } | { ok: false; message: string };

/** Place the node at the free spot nearest `want` (centre), preferring the direction away from the diagram's centroid. */
function placeFree(draft: Project, diagramId: Id, nodeId: Id, want: Point, owner: Point, grid: number): Point {
  const scene = buildScene(current(draft) as Project, diagramId);
  const g = scene.nodes[nodeId];
  if (!g) return want;
  const size = { w: g.bounds.w, h: g.bounds.h };
  const cs = scene.nodeOrder.map((id) => center(scene.nodes[id]!.bounds));
  const centroid = cs.length ? { x: cs.reduce((s, c) => s + c.x, 0) / cs.length, y: cs.reduce((s, c) => s + c.y, 0) / cs.length } : owner;
  const away = Math.atan2(owner.y - centroid.y || -1, owner.x - centroid.x || 0);
  const snap = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
  const final = freeSpotFor(scene, nodeId, size, want, { preferAngle: away, snap });
  ops.setNodePositions(draft, diagramId, { [nodeId]: final });
  return { x: final.x + size.w / 2, y: final.y + size.h / 2 };
}

/** Add an attribute of `flavor` to the owner node. Never throws: failures come back as `{ok:false}`. */
export function addAttributeTo(store: EditorStore, diagramId: Id, ownerNodeId: Id, flavor: AttrFlavor = 'simple'): AddAttributeOutcome {
  const st = store.getState();
  const d = st.project.diagrams[diagramId];
  const model: ErModel | undefined = d && st.project.models[d.modelId]?.kind === 'er' ? (st.project.models[d.modelId] as ErModel) : undefined;
  const owner = d ? ownerOfNode(d, ownerNodeId) : undefined;
  if (!d || !model || !owner) return { ok: false, message: 'No attribute owner' };
  const grid = d.options.grid.snap ? d.options.grid.size : 0;
  const allowed = flavorsFor(owner.kind);
  const effective: AttrFlavor = allowed.includes(flavor) ? flavor : 'simple';
  const key = effective === 'key' ? 'primary' : effective === 'partial-key' ? 'partial' : 'none';
  let nodeId: Id | undefined;
  const created: Id[] = [];
  try {
    st.commit(owner.kind === 'attribute' ? 'Add sub-attribute' : 'Add attribute', (draft) => {
      const m = draft.models[model.id];
      if (!m || m.kind !== 'er') return;
      const siblings = (o: ErAttributeOwner): string[] => Object.values(m.attributes).filter((a) => a.owner.kind === o.kind && a.owner.id === o.id).map((a) => a.name);
      const scene = buildScene(current(draft) as Project, diagramId);
      const og = scene.nodes[ownerNodeId];
      const oc = og ? center(og.bounds) : { x: 0, y: 0 };
      const res = ops.addAttribute(
        draft,
        model.id,
        owner,
        { name: nextDefaultName('attribute', siblings(owner)), key, multivalued: effective === 'multivalued', derived: effective === 'derived' },
        { diagramId, x: oc.x, y: oc.y },
      );
      const ref = res.refs[0]!;
      nodeId = nodeOfRef(draft.diagrams[diagramId]!, ref);
      if (!nodeId) return;
      const placed = placeFree(draft, diagramId, nodeId, oc, oc, grid);
      if (effective === 'composite') {
        for (let i = 0; i < 2; i++) {
          const want = { x: placed.x + (i === 0 ? -70 : 70), y: placed.y + 110 };
          const child = ops.addAttribute(draft, model.id, { kind: 'attribute', id: ref.id }, { name: nextDefaultName('attribute', siblings({ kind: 'attribute', id: ref.id })) }, { diagramId, x: want.x, y: want.y });
          const cid = nodeOfRef(draft.diagrams[diagramId]!, child.refs[0]!);
          if (cid) {
            created.push(cid);
            placeFree(draft, diagramId, cid, want, placed, grid);
          }
        }
      }
    }, { get select() { return nodeId ? [nodeId] : undefined; } });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!nodeId) return { ok: false, message: 'Could not add the attribute' };
  return { ok: true, nodeId, created };
}
