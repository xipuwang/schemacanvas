/**
 * Shared plumbing for the op families: typed errors, model/diagram lookup, patch helpers, and the sync/placement
 * epilogue (`finishOp`) every semantic op ends with. Not part of the public surface (index.ts re-exports selectively).
 */
import { forEachId, nodeKindsFor } from '../invariants';
import { syncModelDiagrams, nodeableRefs } from '../diagramSync';
import { newId } from '../ids';
import { refKey, sqlNameKey } from '../queries';
import type { Diagram, DiagramNode, ErModel, Id, Project, RelationalModel, SemanticRef } from '../types';

export type OpErrorCode =
  | 'not-found'
  | 'wrong-kind'
  | 'invalid'
  | 'id-in-use'
  | 'cycle'
  | 'foreign-key-invalid'
  | 'paste-kind-mismatch';

/** Thrown (inside a recipe, so the whole commit is discarded) when an op's precondition does not hold. */
export class OpError extends Error {
  constructor(
    readonly code: OpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OpError';
  }
}

/** Where a NEW node should appear: bounds origin (see ARCHITECTURE rule 11). Only that diagram receives the position. */
export interface PlaceAt {
  diagramId: Id;
  x: number;
  y: number;
}

/** What create-ops return. `nodeIds[diagramId]` = nodes this op added to each diagram of the model (ascending zIndex). */
export interface OpResult {
  refs: SemanticRef[];
  nodeIds: Record<Id, Id[]>;
}

// ----- lookup ------------------------------------------------------------------------------------------------------

export function requireEr(p: Project, modelId: Id): ErModel {
  const m = p.models[modelId];
  if (!m) throw new OpError('not-found', `Model ${modelId} does not exist`);
  if (m.kind !== 'er') throw new OpError('wrong-kind', `Model ${modelId} is not an ER model`);
  return m;
}

export function requireRelational(p: Project, modelId: Id): RelationalModel {
  const m = p.models[modelId];
  if (!m) throw new OpError('not-found', `Model ${modelId} does not exist`);
  if (m.kind !== 'relational') throw new OpError('wrong-kind', `Model ${modelId} is not a relational model`);
  return m;
}

export function requireDiagram(p: Project, diagramId: Id): Diagram {
  const d = p.diagrams[diagramId];
  if (!d) throw new OpError('not-found', `Diagram ${diagramId} does not exist`);
  return d;
}

export function requireNode(d: Diagram, nodeId: Id): DiagramNode {
  const n = d.nodes[nodeId];
  if (!n) throw new OpError('not-found', `Node ${nodeId} is not in diagram ${d.id}`);
  return n;
}

// ----- values ------------------------------------------------------------------------------------------------------

/** Deep copy of plain JSON (works on immer drafts and frozen objects; drops `undefined` properties). */
export function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Copy only `allowed` keys that are PRESENT in `patch`; an explicit `undefined` deletes the optional field. */
export function applyOptional(target: object, patch: object, allowed: readonly string[]): void {
  const t = target as Record<string, unknown>;
  const p = patch as Record<string, unknown>;
  for (const key of allowed) {
    if (!(key in p)) continue;
    if (p[key] === undefined) delete t[key];
    else t[key] = p[key];
  }
}

export function assertFinite(n: unknown, what: string): asserts n is number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new OpError('invalid', `${what} must be a finite number`);
}

/** `base`, else `base_2`, `base_3`, … (compared with `sqlNameKey`). */
export function uniqueName(base: string, taken: Iterable<string>, key: (s: string) => string = sqlNameKey): string {
  const set = new Set([...taken].map(key));
  if (!set.has(key(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!set.has(key(candidate))) return candidate;
  }
}

/** Refuse a caller-supplied id that already exists anywhere in the project. */
export function assertIdsFree(p: Project, ids: Array<Id | undefined>): void {
  const wanted = new Set(ids.filter((x): x is Id => x !== undefined));
  if (wanted.size === 0) return;
  const supplied = ids.filter((x): x is Id => x !== undefined);
  if (supplied.length !== wanted.size) throw new OpError('id-in-use', 'Caller-supplied ids contain a duplicate');
  forEachId(p, (id) => {
    if (wanted.has(id)) throw new OpError('id-in-use', `Id ${id} is already in use`);
  });
}

// ----- nodes -------------------------------------------------------------------------------------------------------

export const nodeIdByRef = (d: Diagram, ref: SemanticRef): Id | undefined =>
  Object.values(d.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)?.id;

/** Add a node with an explicit `zIndex = max + 1` (paint order never depends on record key order). */
export function addNodeFor(d: Diagram, ref: SemanticRef, x: number, y: number): Id {
  const maxZ = Object.values(d.nodes).reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
  const id = newId('nod');
  d.nodes[id] = { id, ref, x, y, zIndex: maxZ + 1 };
  return id;
}

/** Can `ref` be drawn as a node of this diagram (kind allowed, and not an associative relationship)? */
export function isNodeableIn(p: Project, d: Diagram, ref: SemanticRef): boolean {
  const model = p.models[d.modelId];
  if (!model || !nodeKindsFor(d.type).includes(ref.kind)) return false;
  return nodeableRefs(model).some((r) => refKey(r) === refKey(ref));
}

// ----- sync epilogue -----------------------------------------------------------------------------------------------

/** Drop `branchAnchors` keys that are no longer a SOURCE column of their FK (a reroute can never outlive its pair). */
export function pruneStaleBranchAnchors(p: Project, modelId: Id): void {
  const model = p.models[modelId];
  if (!model || model.kind !== 'relational') return;
  for (const d of Object.values(p.diagrams)) {
    if (d.modelId !== modelId) continue;
    for (const e of Object.values(d.edges)) {
      const ba = e.route.branchAnchors;
      if (!ba || e.ref.kind !== 'foreignKey') continue;
      const fk = model.foreignKeys[e.ref.foreignKeyId];
      for (const key of Object.keys(ba)) {
        if (!fk || !fk.columns.some((c) => c.sourceColumnId === key)) delete ba[key];
      }
      if (Object.keys(ba).length === 0) delete e.route.branchAnchors;
    }
  }
}

/** Every semantic op ends with this: sync all diagrams of the model and prune stale per-branch routing. */
export function commitSync(p: Project, modelId: Id): void {
  syncModelDiagrams(p, modelId);
  pruneStaleBranchAnchors(p, modelId);
}

export type NodeSnapshot = Record<Id, Set<Id>>;

export function snapshotNodes(p: Project, modelId: Id): NodeSnapshot {
  const out: NodeSnapshot = {};
  for (const d of Object.values(p.diagrams)) if (d.modelId === modelId) out[d.id] = new Set(Object.keys(d.nodes));
  return out;
}

export function addedNodes(p: Project, modelId: Id, before: NodeSnapshot): Record<Id, Id[]> {
  const out: Record<Id, Id[]> = {};
  for (const d of Object.values(p.diagrams)) {
    if (d.modelId !== modelId) continue;
    const prev = before[d.id] ?? new Set<Id>();
    out[d.id] = Object.values(d.nodes)
      .filter((n) => !prev.has(n.id))
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || (a.id < b.id ? -1 : 1))
      .map((n) => n.id);
  }
  return out;
}

/** Validate `place` BEFORE mutating anything. */
export function checkPlace(p: Project, modelId: Id, place?: PlaceAt): void {
  if (!place) return;
  const d = requireDiagram(p, place.diagramId);
  if (d.modelId !== modelId) throw new OpError('invalid', `Diagram ${d.id} does not view model ${modelId}`);
  assertFinite(place.x, 'place.x');
  assertFinite(place.y, 'place.y');
}

/**
 * Epilogue of create-ops: sync every diagram of the model, then put the primary new element (`refs[0]`) at `place` in the
 * target diagram (a PARTIAL target diagram gets its node explicitly, since sync never adds nodes there).
 */
export function finishOp(p: Project, modelId: Id, before: NodeSnapshot, refs: SemanticRef[], place?: PlaceAt): OpResult {
  const primary = refs[0];
  if (place && primary) {
    const d = p.diagrams[place.diagramId]!;
    if (d.partial && !nodeIdByRef(d, primary) && isNodeableIn(p, d, primary)) addNodeFor(d, primary, place.x, place.y);
  }
  commitSync(p, modelId);
  if (place && primary) {
    const d = p.diagrams[place.diagramId]!;
    const nid = nodeIdByRef(d, primary);
    if (nid) {
      d.nodes[nid]!.x = place.x;
      d.nodes[nid]!.y = place.y;
    }
  }
  return { refs, nodeIds: addedNodes(p, modelId, before) };
}
