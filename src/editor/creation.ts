/**
 * Creating model elements from library items (drop or click-to-place). One `store.commit` per creation so it is ONE undo
 * step; the new shape is centred on the drop point (measured from the real scene geometry inside the same commit).
 */
import { current } from 'immer';
import { modelOfDiagram } from '@/model/queries';
import * as ops from '@/model/ops';
import type { Diagram, ErAttributeOwner, Id, Point, Project, SemanticRef } from '@/model/types';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import { t } from '@/i18n';
import type { EditorStore } from '@/store';
import { uiStore } from '@/ui/uiStore';
import type { LibraryItem } from './dnd';
import { hitTest } from './hit';
import { freeSpotFor } from './placement';

export type CreationFailure = 'no-diagram' | 'wrong-diagram' | 'needs-owner' | 'no-template-inserter' | 'failed';

export type CreationResult =
  | {
      ok: true;
      /** Nodes added to the active diagram. */
      nodeIds: Id[];
      /** What to select afterwards (the primary node). */
      selectIds: Id[];
      /** Start inline rename here (every created element is renamed right away). */
      rename?: { nodeId: Id; columnId?: Id };
      /** Non-fatal remark for a toast (`key-downgraded`). */
      notice?: 'key-downgraded';
    }
  | { ok: false; reason: CreationFailure; message?: string };

export interface CreationOptions {
  /** Snap the new element's top-left to this grid (0/undefined = no snapping). */
  grid?: number;
  zoom?: number;
}

/** Approximate on-canvas sizes of a freshly created element (ghost preview while armed; real sizes come from the scene). */
export const GHOST_SIZES: Record<'entity' | 'relationship' | 'attribute' | 'relation', { w: number; h: number }> = {
  entity: { w: 120, h: 56 },
  relationship: { w: 130, h: 76 },
  attribute: { w: 104, h: 46 },
  relation: { w: 270, h: 60 },
};

/** `base1`, `base2`, ... the first one not taken (case-insensitive). */
export function nextDefaultName(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.trim().toLowerCase()));
  for (let i = 1; ; i++) {
    const c = `${base}${i}`;
    if (!set.has(c.toLowerCase())) return c;
  }
}

// ---- template hook ---------------------------------------------------------------------------------------------------

export interface TemplateInsertion {
  store: EditorStore;
  diagramId: Id;
  templateId: string;
  /** World point the template should be centred on. */
  at: Point;
}

type TemplateInserter = (ins: TemplateInsertion) => Id[] | void;
let templateInserter: TemplateInserter | undefined;

/**
 * Hook for the EXAMPLES worker: register the function that inserts template `templateId` into the diagram at `at`
 * (use the clipboard path: `extractClipboard` of the template project + `pasteClipboard`, ONE `store.commit`) and return the
 * created node ids (selected afterwards). Until one is registered a dropped template shows a toast.
 */
export function registerTemplateInserter(fn: TemplateInserter | undefined): void {
  templateInserter = fn;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

const snap = (v: number, grid: number | undefined): number => (grid && grid > 0 ? Math.round(v / grid) * grid : v);

function nodeOfRef(d: Diagram, ref: SemanticRef): Id | undefined {
  return Object.values(d.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)?.id;
}

/** Centre node `nodeId` on `at` using geometry measured on the current draft state. */
function centreOn(draft: Project, diagramId: Id, nodeId: Id, at: Point, grid: number | undefined): void {
  const scene = buildScene(current(draft) as Project, diagramId);
  const g = scene.nodes[nodeId];
  if (!g) return;
  ops.setNodePositions(draft, diagramId, { [nodeId]: { x: snap(at.x - g.bounds.w / 2, grid), y: snap(at.y - g.bounds.h / 2, grid) } });
}

/**
 * Put node `nodeId` at the free spot nearest to `at` (centre) that keeps clear of every other node (the owner included):
 * an attribute dropped ONTO its owner must not end up painted over it.
 */
function placeClear(draft: Project, diagramId: Id, nodeId: Id, at: Point, grid: number | undefined): Point {
  const scene = buildScene(current(draft) as Project, diagramId);
  const g = scene.nodes[nodeId];
  if (!g) return at;
  const size = { w: g.bounds.w, h: g.bounds.h };
  const final = freeSpotFor(scene, nodeId, size, at, { snap: (v) => snap(v, grid) });
  ops.setNodePositions(draft, diagramId, { [nodeId]: final });
  return { x: final.x + size.w / 2, y: final.y + size.h / 2 };
}

/** The attribute owner under a world point (entity / relationship / attribute node), if any. */
export function attributeOwnerAt(scene: Scene, project: Project, diagram: Diagram, at: Point, zoom = 1): ErAttributeOwner | undefined {
  const hit = hitTest(scene, at, zoom, { kinds: ['node'] });
  if (hit.kind !== 'node') return undefined;
  const ref = diagram.nodes[hit.nodeId]?.ref;
  if (!ref) return undefined;
  if (ref.kind === 'entity' || ref.kind === 'relationship' || ref.kind === 'attribute') return { kind: ref.kind, id: ref.id };
  return undefined;
}

// ---- main entry ------------------------------------------------------------------------------------------------------

export function createFromLibraryItem(store: EditorStore, diagramId: Id, item: LibraryItem, at: Point, opts: CreationOptions = {}): CreationResult {
  const state = store.getState();
  const diagram = state.project.diagrams[diagramId];
  const model = diagram ? modelOfDiagram(state.project, diagram) : undefined;
  if (!diagram || !model) return { ok: false, reason: 'no-diagram' };
  const grid = opts.grid ?? (diagram.options.grid.snap ? diagram.options.grid.size : 0);
  const modelId = model.id;

  try {
    if (item.kind === 'template') {
      if (!templateInserter) return { ok: false, reason: 'no-template-inserter' };
      const ids = templateInserter({ store, diagramId, templateId: item.templateId, at }) ?? [];
      // The inserted nodes end up selected (drop and armed click alike); ids the diagram does not hold are ignored.
      const nodes = store.getState().project.diagrams[diagramId]?.nodes ?? {};
      const present = ids.filter((id) => Object.hasOwn(nodes, id));
      if (present.length > 0) store.getState().setSelection(present);
      return { ok: true, nodeIds: ids, selectIds: ids };
    }

    if (item.kind === 'relation') {
      if (model.kind !== 'relational') return { ok: false, reason: 'wrong-diagram' };
      let nodeId = undefined as Id | undefined;
      const count = Math.max(1, Math.min(40, Math.trunc(item.columns ?? 3)));
      store.getState().commit('Add table', (d) => {
        const m = d.models[modelId]!;
        if (m.kind !== 'relational') return;
        const name = nextDefaultName('Table', Object.values(m.relations).map((r) => r.name));
        const res = ops.addRelation(
          d,
          modelId,
          { name, columns: Array.from({ length: count }, (_, i) => ({ name: `Column${i + 1}`, pk: i === 0 })) },
          { diagramId, x: at.x, y: at.y },
        );
        nodeId = nodeOfRef(d.diagrams[diagramId]!, res.refs[0]!);
        if (nodeId) centreOn(d, diagramId, nodeId, at, grid);
      }, { get select() { return nodeId ? [nodeId] : undefined; } });
      if (!nodeId) return { ok: false, reason: 'failed' };
      return { ok: true, nodeIds: [nodeId], selectIds: [nodeId], rename: { nodeId } };
    }

    if (model.kind !== 'er') return { ok: false, reason: 'wrong-diagram' };

    if (item.kind === 'entity') {
      let nodeId = undefined as Id | undefined;
      store.getState().commit(item.weak ? 'Add weak entity' : 'Add entity', (d) => {
        const m = d.models[modelId]!;
        if (m.kind !== 'er') return;
        const name = nextDefaultName('Entity', Object.values(m.entities).map((e) => e.name));
        const res = ops.addEntity(d, modelId, { name, weak: !!item.weak }, { diagramId, x: at.x, y: at.y });
        nodeId = nodeOfRef(d.diagrams[diagramId]!, res.refs[0]!);
        if (nodeId) centreOn(d, diagramId, nodeId, at, grid);
      }, { get select() { return nodeId ? [nodeId] : undefined; } });
      if (!nodeId) return { ok: false, reason: 'failed' };
      return { ok: true, nodeIds: [nodeId], selectIds: [nodeId], rename: { nodeId } };
    }

    if (item.kind === 'relationship') {
      let nodeId = undefined as Id | undefined;
      store.getState().commit(item.identifying ? 'Add identifying relationship' : 'Add relationship', (d) => {
        const m = d.models[modelId]!;
        if (m.kind !== 'er') return;
        const name = nextDefaultName('Relationship', Object.values(m.relationships).map((r) => r.name));
        const res = ops.addRelationship(d, modelId, { name, participants: [] }, { diagramId, x: at.x, y: at.y });
        if (item.identifying) ops.updateRelationship(d, modelId, res.refs[0]!.id, { identifying: true });
        nodeId = nodeOfRef(d.diagrams[diagramId]!, res.refs[0]!);
        if (nodeId) centreOn(d, diagramId, nodeId, at, grid);
      }, { get select() { return nodeId ? [nodeId] : undefined; } });
      if (!nodeId) return { ok: false, reason: 'failed' };
      return { ok: true, nodeIds: [nodeId], selectIds: [nodeId], rename: { nodeId } };
    }

    // attribute: must land on an owner
    const scene = buildScene(state.project, diagramId);
    const owner = attributeOwnerAt(scene, state.project, diagram, at, opts.zoom ?? 1);
    if (!owner) return { ok: false, reason: 'needs-owner' };
    let notice = undefined as 'key-downgraded' | undefined;
    let nodeId = undefined as Id | undefined;
    const created: Id[] = [];
    store.getState().commit('Add attribute', (d) => {
      const m = d.models[modelId]!;
      if (m.kind !== 'er') return;
      const siblings = (): string[] => Object.values(m.attributes).filter((a) => a.owner.kind === owner.kind && a.owner.id === owner.id).map((a) => a.name);
      const flavor = item.flavor;
      let key: 'none' | 'primary' | 'partial' = flavor === 'key' ? 'primary' : flavor === 'partial-key' ? 'partial' : 'none';
      if (key !== 'none' && owner.kind !== 'entity') {
        key = 'none';
        notice = 'key-downgraded';
      }
      const res = ops.addAttribute(
        d,
        modelId,
        owner,
        { name: nextDefaultName('attribute', siblings()), key, multivalued: flavor === 'multivalued', derived: flavor === 'derived' },
        { diagramId, x: at.x, y: at.y },
      );
      const ref = res.refs[0]!;
      nodeId = nodeOfRef(d.diagrams[diagramId]!, ref);
      const placed = nodeId ? placeClear(d, diagramId, nodeId, at, grid) : at;
      if (flavor === 'composite') {
        // a composite attribute is drawn with its sub-attributes: start with two
        for (let i = 0; i < 2; i++) {
          const cx = placed.x + (i === 0 ? -70 : 70);
          const child = ops.addAttribute(
            d,
            modelId,
            { kind: 'attribute', id: ref.id },
            { name: `Part ${i + 1}` },
            { diagramId, x: cx, y: placed.y + 110 },
          );
          const cid = nodeOfRef(d.diagrams[diagramId]!, child.refs[0]!);
          if (cid) {
            created.push(cid);
            placeClear(d, diagramId, cid, { x: cx, y: placed.y + 110 }, grid);
          }
        }
      }
    }, { get select() { return nodeId ? [nodeId] : undefined; } });
    if (!nodeId) return { ok: false, reason: 'failed' };
    return { ok: true, nodeIds: [nodeId, ...created], selectIds: [nodeId], rename: { nodeId }, ...(notice ? { notice } : {}) };
  } catch (err) {
    return { ok: false, reason: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Toast explaining a failed creation (uses i18n); no-op for success. */
export function reportCreation(res: CreationResult): void {
  if (res.ok) {
    if (res.notice === 'key-downgraded') uiStore.getState().pushToast({ kind: 'info', message: t('editor.toast.keyOnlyOnEntity') });
    return;
  }
  const key: Record<CreationFailure, string> = {
    'no-diagram': 'editor.toast.noDiagram',
    'wrong-diagram': 'editor.toast.wrongDiagram',
    'needs-owner': 'editor.toast.attributeNeedsOwner',
    'no-template-inserter': 'editor.toast.templateUnavailable',
    failed: 'editor.toast.createFailed',
  };
  uiStore.getState().pushToast({ kind: res.reason === 'failed' ? 'error' : 'info', message: t(key[res.reason], { message: res.message ?? '' }) });
}

