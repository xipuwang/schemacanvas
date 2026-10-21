/**
 * Chen connect tool, pure part + the commit helpers.
 *
 * `classifyConnect` decides what dragging from one Chen node onto another means:
 *   entity <-> relationship  => a participant (second one for the same entity = a RECURSIVE participant)
 *   entity  -> entity        => offer to create a relationship between them (both participants in ONE commit)
 *   entity  -> itself        => recursive relationship (only when the drag clearly left the node: the caller decides)
 *   relationship <-> relationship, anything with an attribute => rejected, with a reason the UI explains.
 * Defaults are the least surprising ones: both sides `many`, `partial` participation; the user edits them in Properties.
 */
import { current } from 'immer';
import { placeNear } from '@/layout';
import * as ops from '@/model/ops';
import type { Diagram, ErModel, Id, Point, Project, SemanticRef } from '@/model/types';
import { buildScene } from '@/scene/registry';
import type { EditorStore } from '@/store';
import { nextDefaultName } from '../creation';

export type ConnectReject = 'relationship-relationship' | 'attribute' | 'recursive-full' | 'same-entity' | 'not-chen';

export type ConnectVerdict =
  | { kind: 'participant'; relationshipId: Id; entityId: Id; recursive: boolean }
  | { kind: 'new-relationship'; entityIds: [Id, Id]; recursive: boolean }
  | { kind: 'reject'; reason: ConnectReject };

const isEntity = (r: SemanticRef): r is { kind: 'entity'; id: Id } => r.kind === 'entity';
const isRelationship = (r: SemanticRef): r is { kind: 'relationship'; id: Id } => r.kind === 'relationship';

/** How many participants of `relationshipId` already name `entityId`. */
export function participantCount(model: ErModel, relationshipId: Id, entityId: Id): number {
  const rel = model.relationships[relationshipId];
  return rel ? rel.participants.filter((p) => p.entityId === entityId).length : 0;
}

export function classifyConnect(model: ErModel, from: SemanticRef, to: SemanticRef, opts: { sameNodeIntent?: boolean } = {}): ConnectVerdict {
  if (from.kind === 'attribute' || to.kind === 'attribute') return { kind: 'reject', reason: 'attribute' };
  const same = from.kind === to.kind && from.id === to.id;
  if (isRelationship(from) && isRelationship(to)) return { kind: 'reject', reason: 'relationship-relationship' };
  if (isEntity(from) && isEntity(to)) {
    if (same && !opts.sameNodeIntent) return { kind: 'reject', reason: 'same-entity' };
    return { kind: 'new-relationship', entityIds: [from.id, to.id], recursive: same };
  }
  const rel = isRelationship(from) ? from : isRelationship(to) ? to : undefined;
  const ent = isEntity(from) ? from : isEntity(to) ? to : undefined;
  if (!rel || !ent) return { kind: 'reject', reason: 'not-chen' };
  const n = participantCount(model, rel.id, ent.id);
  if (n >= 2) return { kind: 'reject', reason: 'recursive-full' };
  return { kind: 'participant', relationshipId: rel.id, entityId: ent.id, recursive: n === 1 };
}

// ---- commit helpers ----------------------------------------------------------------------------------------------

export interface ConnectResult {
  ok: true;
  /** Node to select afterwards (the relationship node for a new relationship, else undefined). */
  nodeId?: Id;
  /** Edge to select afterwards (the participant line). */
  edgeId?: Id;
  participantId?: Id;
  /** Start inline rename on this target after selecting. */
  rename?: { nodeId?: Id; edgeId?: Id };
}
export type ConnectOutcome = ConnectResult | { ok: false; message: string };

const nodeOfRef = (d: Diagram, ref: SemanticRef): Id | undefined => Object.values(d.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)?.id;
const edgeOfParticipant = (d: Diagram, participantId: Id): Id | undefined => Object.values(d.edges).find((e) => e.ref.kind === 'participant' && e.ref.participantId === participantId)?.id;

const erModelOf = (p: Project, d: Diagram): ErModel | undefined => {
  const m = p.models[d.modelId];
  return m?.kind === 'er' ? m : undefined;
};

/** Add `entityId` as a participant of `relationshipId` (defaults: many, partial; identifying relationships: weak side total, owners one). A repeat becomes a recursive participant. */
export function connectParticipant(store: EditorStore, diagramId: Id, relationshipId: Id, entityId: Id): ConnectOutcome {
  const st = store.getState();
  const d = st.project.diagrams[diagramId];
  const model = d ? erModelOf(st.project, d) : undefined;
  if (!d || !model) return { ok: false, message: 'No ER diagram' };
  const verdict = classifyConnect(model, { kind: 'relationship', id: relationshipId }, { kind: 'entity', id: entityId });
  if (verdict.kind !== 'participant') return { ok: false, message: verdict.kind === 'reject' ? verdict.reason : 'invalid' };
  let participantId: Id | undefined;
  try {
    st.commit(verdict.recursive ? 'Add recursive participant' : 'Connect entity', (draft) => {
      const res = ops.addParticipant(draft, model.id, relationshipId, { entityId, max: 'many', participation: 'partial' });
      participantId = res.refs[0]!.id;
      ops.applyIdentifyingDefaults(draft, model.id, relationshipId, participantId);
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const after = store.getState().project.diagrams[diagramId]!;
  const edgeId = participantId ? edgeOfParticipant(after, participantId) : undefined;
  return { ok: true, ...(edgeId ? { edgeId } : {}), ...(participantId ? { participantId } : {}), ...(verdict.recursive && edgeId ? { rename: { edgeId } } : {}) };
}

/** Create a relationship node between two entities (or one entity twice = recursive) with both participants, in ONE commit. */
export function createRelationshipBetween(store: EditorStore, diagramId: Id, a: Id, b: Id, opts: { zoom?: number } = {}): ConnectOutcome {
  const st = store.getState();
  const d = st.project.diagrams[diagramId];
  const model = d ? erModelOf(st.project, d) : undefined;
  if (!d || !model) return { ok: false, message: 'No ER diagram' };
  if (!model.entities[a] || !model.entities[b]) return { ok: false, message: 'Entity not found' };
  const recursive = a === b;
  const grid = d.options.grid.snap ? d.options.grid.size : 0;
  let nodeId: Id | undefined;
  try {
    st.commit(recursive ? 'Create recursive relationship' : 'Create relationship', (draft) => {
      const m = draft.models[model.id];
      if (!m || m.kind !== 'er') return;
      const scene = buildScene(current(draft) as Project, diagramId);
      const dd = draft.diagrams[diagramId]!;
      const nodeA = nodeOfRef(dd, { kind: 'entity', id: a });
      const nodeB = nodeOfRef(dd, { kind: 'entity', id: b });
      const ra = nodeA ? scene.nodes[nodeA]?.bounds : undefined;
      const rb = nodeB ? scene.nodes[nodeB]?.bounds : undefined;
      const name = nextDefaultName('Relationship', Object.values(m.relationships).map((r) => r.name));
      const at: Point = ra && rb ? (recursive ? { x: ra.x + ra.w + 110, y: ra.y + ra.h / 2 } : { x: (ra.x + ra.w / 2 + rb.x + rb.w / 2) / 2, y: (ra.y + ra.h / 2 + rb.y + rb.h / 2) / 2 }) : { x: 0, y: 0 };
      const res = ops.addRelationship(
        draft,
        model.id,
        { name, participants: [{ entityId: a, max: 'many', participation: 'partial' }, { entityId: b, max: 'many', participation: 'partial' }] },
        { diagramId, x: at.x, y: at.y },
      );
      nodeId = nodeOfRef(draft.diagrams[diagramId]!, res.refs[0]!);
      if (!nodeId) return;
      const scene2 = buildScene(current(draft) as Project, diagramId);
      const g = scene2.nodes[nodeId];
      if (!g) return;
      const obstacles = scene2.nodeOrder.filter((id) => id !== nodeId).map((id) => scene2.nodes[id]!.paintBounds);
      const size = { w: g.bounds.w, h: g.bounds.h };
      const free = placeNear(size, at, obstacles, { gap: 24 });
      const snapped = grid > 0 ? { x: Math.round(free.x / grid) * grid, y: Math.round(free.y / grid) * grid } : free;
      const fits = (p: Point): boolean => !obstacles.some((o) => p.x < o.x + o.w + 8 && p.x + size.w + 8 > o.x && p.y < o.y + o.h + 8 && p.y + size.h + 8 > o.y);
      ops.setNodePositions(draft, diagramId, { [nodeId]: fits(snapped) ? snapped : free });
    }, { get select() { return nodeId ? [nodeId] : undefined; } });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  void opts;
  if (!nodeId) return { ok: false, message: 'Could not create the relationship' };
  return { ok: true, nodeId, rename: { nodeId } };
}

/** What `chen.connectSelected` would do for exactly two selected nodes, or undefined when it does not apply. */
export function planConnectSelected(project: Project, diagram: Diagram, nodeIds: readonly Id[]): { verdict: ConnectVerdict; from: Id; to: Id } | undefined {
  if (nodeIds.length !== 2) return undefined;
  const model = erModelOf(project, diagram);
  if (!model) return undefined;
  const [a, b] = nodeIds.map((id) => diagram.nodes[id]);
  if (!a || !b) return undefined;
  const verdict = classifyConnect(model, a.ref, b.ref);
  if (verdict.kind === 'reject') return undefined;
  return { verdict, from: nodeIds[0]!, to: nodeIds[1]! };
}
