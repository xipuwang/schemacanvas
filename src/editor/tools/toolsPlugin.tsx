/**
 * Connect tool (Chen), foreign-key tool (relational / crow's foot / physical), the hover / selection ports and the
 * add-attribute '+' port. One plugin so the ports, the modal tools and their ghost-line overlays share state.
 *
 * Every gesture is a captured pointer sequence with a `Session`; Escape / pointercancel call `cancel` and nothing is
 * committed. Semantic edits happen only on release, each in ONE `store.commit`.
 */
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import type { Diagram, ErModel, Id, Point, Project, RelationalModel } from '@/model/types';
import type { Rect } from '@/scene/base';
import { boundaryPoint } from '@/scene/geometry';
import type { NodeGeom } from '@/scene/types';
import { uiStore } from '@/ui/uiStore';
import type { CanvasContext, CanvasPlugin, CanvasPointerEvent } from '../plugins';
import { classifyConnect, connectParticipant, createRelationshipBetween, type ConnectOutcome, type ConnectReject, type ConnectVerdict } from './chenConnect';
import { DRAG_PX, dist } from './geom';
import { createForeignKey } from './fkCommit';
import { describePairs, inTableOrder, resolveFkTarget, validTargetColumns, type FkReject, type FkTargetVerdict } from './fkLogic';
import { nodeName } from './names';
import { currentHandles } from './handlesPlugin';
import { hitHandle } from './handles';
import { hitPort, inPortZone, portsFor, type Port } from './ports';
import { ToolChrome, runAddAttribute } from './ToolChrome';
import { announce, resetToolUi, setToolUi, toolUi, type FkSource } from './toolState';
import { nodesOfKind } from './util';

interface Session {
  pointerId: number;
  move(cx: CanvasContext, e: CanvasPointerEvent): void;
  up(cx: CanvasContext, e: CanvasPointerEvent): void;
  cancel(cx: CanvasContext): void;
}
let session: Session | null = null;

const toast = (kind: 'info' | 'success' | 'warning' | 'error', message: string): void => void uiStore.getState().pushToast({ kind, message });
const clientOf = (e: CanvasPointerEvent): Point => ({ x: e.clientX, y: e.clientY });

const erModelOf = (project: Project, d: Diagram): ErModel | undefined => (project.models[d.modelId]?.kind === 'er' ? (project.models[d.modelId] as ErModel) : undefined);
const relModelOf = (project: Project, d: Diagram): RelationalModel | undefined => (project.models[d.modelId]?.kind === 'relational' ? (project.models[d.modelId] as RelationalModel) : undefined);

// ---------------------------------------------------------------------------------------------------------------------
// Chen connect
// ---------------------------------------------------------------------------------------------------------------------

export function rejectText(reason: ConnectReject, names: { entity?: string; relationship?: string }): string {
  return t(`editorTools.connect.reject.${reason}`, { entity: names.entity ?? '', relationship: names.relationship ?? '' });
}

/** Feedback line while the pointer is over `over` (or empty space) during a Chen connect drag. */
export function connectFeedback(project: Project, d: Diagram, verdict: ConnectVerdict | undefined, fromId: Id, overId: Id | undefined): { tone: 'ok' | 'bad' | 'neutral'; text: string } {
  if (!overId || !verdict) return { tone: 'neutral', text: t('editorTools.connect.overEmpty') };
  const a = nodeName(project, d, fromId);
  const b = nodeName(project, d, overId);
  if (verdict.kind === 'reject') {
    const refA = d.nodes[fromId]?.ref;
    const entityName = refA?.kind === 'entity' ? a : b;
    const relName = refA?.kind === 'relationship' ? a : b;
    return { tone: 'bad', text: rejectText(verdict.reason, { entity: entityName, relationship: relName }) };
  }
  if (verdict.kind === 'participant') {
    const model = erModelOf(project, d)!;
    const ent = model.entities[verdict.entityId]?.name ?? '';
    const rel = model.relationships[verdict.relationshipId]?.name ?? '';
    return { tone: 'ok', text: t(verdict.recursive ? 'editorTools.connect.toRecursive' : 'editorTools.connect.toParticipant', { entity: ent, relationship: rel }) };
  }
  const model = erModelOf(project, d)!;
  const [x, y] = verdict.entityIds.map((id) => model.entities[id]?.name ?? '');
  return verdict.recursive ? { tone: 'ok', text: t('editorTools.connect.newRecursive', { a: x ?? '' }) } : { tone: 'ok', text: t('editorTools.connect.newRelationship', { a: x ?? '', b: y ?? '' }) };
}

export interface ConnectEnv {
  store: CanvasContext['store'];
  diagramId: Id;
  /** Needed only to start the inline rename after creating something. */
  handle: Pick<CanvasContext['handle'], 'startInlineEdit'> | null;
  zoom: number;
}

function finishConnect(cx: ConnectEnv, out: ConnectOutcome, okMessage: string, announceText: string): void {
  if (!out.ok) {
    toast('error', t('editorTools.toast.connectFailed', { message: out.message }));
    return;
  }
  const st = cx.store.getState();
  if (out.edgeId) st.setSelection([out.edgeId]);
  else if (out.nodeId) st.setSelection([out.nodeId]);
  toast('success', okMessage);
  announce(announceText);
  if (out.rename) cx.handle?.startInlineEdit(out.rename);
}

/** Perform what dropping `fromId` on `overId` means. Returns whether a commit happened. */
export function performConnect(cx: ConnectEnv, fromId: Id, overId: Id, leftSource: boolean): boolean {
  const d = cx.store.getState().project.diagrams[cx.diagramId];
  const project = cx.store.getState().project;
  const model = d ? erModelOf(project, d) : undefined;
  const a = d?.nodes[fromId]?.ref;
  const b = d?.nodes[overId]?.ref;
  if (!d || !model || !a || !b) return false;
  const verdict = classifyConnect(model, a, b, { sameNodeIntent: leftSource });
  if (verdict.kind === 'reject') {
    const entityName = a.kind === 'entity' ? nodeName(project, d, fromId) : nodeName(project, d, overId);
    const relName = a.kind === 'relationship' ? nodeName(project, d, fromId) : nodeName(project, d, overId);
    toast('warning', rejectText(verdict.reason, { entity: entityName, relationship: relName }));
    return false;
  }
  if (verdict.kind === 'participant') {
    const out = connectParticipant(cx.store, cx.diagramId, verdict.relationshipId, verdict.entityId);
    const ent = model.entities[verdict.entityId]?.name ?? '';
    const rel = model.relationships[verdict.relationshipId]?.name ?? '';
    finishConnect(cx, out, t('editorTools.toast.connected', { entity: ent, relationship: rel }), t('editorTools.announce.connected', { entity: ent, relationship: rel }));
    if (out.ok && verdict.recursive) toast('info', t('editorTools.toast.recursiveRoles'));
    return out.ok;
  }
  const [ea, eb] = verdict.entityIds;
  const out = createRelationshipBetween(cx.store, cx.diagramId, ea, eb, { zoom: cx.zoom });
  const nameA = model.entities[ea]?.name ?? '';
  const nameB = model.entities[eb]?.name ?? '';
  const relName = out.ok && out.nodeId ? nodeName(cx.store.getState().project, cx.store.getState().project.diagrams[cx.diagramId]!, out.nodeId) : '';
  finishConnect(cx, out, t('editorTools.toast.relationshipCreated', { name: relName, a: nameA, b: nameB }), t('editorTools.announce.relationshipCreated', { name: relName, a: nameA, b: nameB }));
  return out.ok;
}

function chenSession(e0: CanvasPointerEvent, fromId: Id): Session {
  const startClient = clientOf(e0);
  let moved = false;
  let leftSource = false;
  let lastOver: Id | undefined;
  return {
    pointerId: e0.pointerId,
    move(cx, e) {
      if (!moved && dist(clientOf(e), startClient) < DRAG_PX) return;
      moved = true;
      cx.setCursor('crosshair');
      const g = cx.scene.nodes[fromId];
      const hit = cx.hit(e.world, { kinds: ['node'] });
      const overId = hit.kind === 'node' ? hit.nodeId : undefined;
      if (overId !== fromId) leftSource = true;
      lastOver = overId;
      const project = cx.store.getState().project;
      const d = project.diagrams[cx.diagramId]!;
      const model = erModelOf(project, d);
      const verdict = overId && model && d.nodes[fromId] && d.nodes[overId] ? classifyConnect(model, d.nodes[fromId]!.ref, d.nodes[overId]!.ref, { sameNodeIntent: leftSource }) : undefined;
      const feedback = connectFeedback(project, d, verdict, fromId, overId);
      const from = g ? boundaryPoint(g.outline, e.world) : e.world;
      setToolUi({ connect: { fromNodeId: fromId, from, to: e.world, ...(overId ? { overNodeId: overId } : {}), feedback }, gestureHint: feedback });
      cx.requestRender();
    },
    up(cx, e) {
      const hit = cx.hit(e.world, { kinds: ['node'] });
      const overId = hit.kind === 'node' ? hit.nodeId : lastOver;
      const was = moved;
      clearConnect(cx);
      if (was && hit.kind === 'node' && overId) performConnect(cx, fromId, overId, leftSource);
    },
    cancel(cx) {
      clearConnect(cx);
      announce(t('editorTools.announce.cancelled'));
    },
  };
}

function clearConnect(cx: CanvasContext): void {
  setToolUi({ connect: null, gestureHint: null });
  cx.setCursor(undefined);
  cx.requestRender();
}

// ---------------------------------------------------------------------------------------------------------------------
// Foreign-key tool
// ---------------------------------------------------------------------------------------------------------------------

export function fkRejectText(r: FkReject): string {
  switch (r.reason) {
    case 'no-sources':
      return t('editorTools.fk.reject.noSources');
    case 'no-key':
      return t('editorTools.fk.reject.noKey', { relation: r.relation });
    case 'not-key-cell':
      return t('editorTools.fk.reject.notKeyCell', { relation: r.relation, column: r.column });
    case 'length-mismatch':
      return t(r.keyLength === 1 ? 'editorTools.fk.reject.length.one' : 'editorTools.fk.reject.length.other', { relation: r.relation, count: r.keyLength, selected: r.selected });
    case 'self-column':
      return t('editorTools.fk.reject.selfColumn', { relation: r.relation, column: r.column });
    case 'duplicate':
      return t('editorTools.fk.reject.duplicate', { text: r.text });
  }
}

const cellRectOf = (g: NodeGeom | undefined, columnId: Id): Rect | undefined => (g?.kind === 'h-table' ? g.cells.find((c) => c.columnId === columnId)?.rect : g?.kind === 'v-table' ? g.rows.find((r) => r.columnId === columnId)?.rect : undefined);
const relationIdOfNode = (d: Diagram, nodeId: Id): Id | undefined => (d.nodes[nodeId]?.ref.kind === 'relation' ? d.nodes[nodeId]!.ref.id : undefined);

interface DropInfo {
  verdict: FkTargetVerdict;
  targetNodeId: Id;
  targetRelationId: Id;
}

function resolveDrop(project: Project, d: Diagram, source: FkSource, hit: ReturnType<CanvasContext['hit']>): DropInfo | undefined {
  const model = relModelOf(project, d);
  if (!model || hit.kind !== 'node') return undefined;
  const targetRelationId = relationIdOfNode(d, hit.nodeId);
  if (!targetRelationId) return undefined;
  return { verdict: resolveFkTarget(model, source.relationId, source.columnIds, targetRelationId, hit.columnId), targetNodeId: hit.nodeId, targetRelationId };
}

function openFkPopover(cx: CanvasContext, source: FkSource, drop: DropInfo, at: Point): void {
  if (!drop.verdict.ok) return;
  const d = cx.store.getState().project.diagrams[cx.diagramId]!;
  setToolUi({
    fkPending: null,
    fkPopover: {
      diagramId: cx.diagramId,
      modelId: d.modelId,
      source,
      targetNodeId: drop.targetNodeId,
      targetRelationId: drop.targetRelationId,
      at,
      anchor: (() => {
        const b = cx.scene.nodes[drop.targetNodeId]?.bounds;
        return b ? { x: at.x, y: b.y, w: 1, h: b.h } : { x: at.x, y: at.y, w: 1, h: 1 };
      })(),
      keyIndex: drop.verdict.keyIndex,
      keys: drop.verdict.keys,
      targetColumnIds: drop.verdict.targetColumnIds,
    },
  });
  announce(t('editorTools.announce.fkConfirm'));
}

/** Pending-source bookkeeping for a press on `columnId` of relation node `nodeId`. */
function nextPending(prev: FkSource | null, d: Diagram, project: Project, nodeId: Id, columnId: Id, shift: boolean): FkSource | null {
  const relationId = relationIdOfNode(d, nodeId);
  const model = relModelOf(project, d);
  const rel = relationId && model ? model.relations[relationId] : undefined;
  if (!relationId || !rel) return null;
  const same = prev && prev.relationId === relationId;
  if (shift && same) {
    const has = prev.columnIds.includes(columnId);
    const ids = has ? prev.columnIds.filter((c) => c !== columnId) : [...prev.columnIds, columnId];
    return ids.length === 0 ? null : { nodeId, relationId, columnIds: inTableOrder(rel, ids) };
  }
  if (!shift && same && prev.columnIds.includes(columnId)) return prev;
  return { nodeId, relationId, columnIds: [columnId] };
}

function fkSession(e0: CanvasPointerEvent, prev: FkSource | null, next: FkSource | null, press: { nodeId: Id; relationId: Id | undefined }): Session {
  const startClient = clientOf(e0);
  let dragged = false;
  const source = next;
  return {
    pointerId: e0.pointerId,
    move(cx, e) {
      if (!source) return;
      if (!dragged && dist(clientOf(e), startClient) < DRAG_PX) return;
      dragged = true;
      cx.setCursor('crosshair');
      const project = cx.store.getState().project;
      const d = project.diagrams[cx.diagramId]!;
      const hit = cx.hit(e.world, { kinds: ['node'] });
      const drop = resolveDrop(project, d, source, hit);
      const g = cx.scene.nodes[source.nodeId];
      const cell = cellRectOf(g, source.columnIds[0]!);
      const from = cell ? boundaryPoint({ kind: 'rect', rect: cell }, e.world) : e.world;
      let feedback: { tone: 'ok' | 'bad' | 'neutral'; text: string };
      let targetColumnIds: Id[] = [];
      if (!drop) feedback = { tone: 'neutral', text: t('editorTools.fk.overEmpty') };
      else if (drop.verdict.ok) {
        const model = relModelOf(project, d)!;
        const key = drop.verdict.keys[drop.verdict.keyIndex]!;
        targetColumnIds = key.columnIds;
        feedback = { tone: 'ok', text: t('editorTools.fk.release', { text: describePairs(model, source.relationId, drop.targetRelationId, source.columnIds.map((s, i) => ({ sourceColumnId: s, targetColumnId: (drop.verdict as Extract<FkTargetVerdict, { ok: true }>).targetColumnIds[i]! }))) }) };
      } else feedback = { tone: 'bad', text: fkRejectText(drop.verdict) };
      setToolUi({ fkPending: source, fk: { source, from, to: e.world, ...(drop ? { overNodeId: drop.targetNodeId } : {}), targetColumnIds, feedback }, gestureHint: feedback });
      cx.requestRender();
    },
    up(cx, e) {
      const project = cx.store.getState().project;
      const d = project.diagrams[cx.diagramId]!;
      const hit = cx.hit(e.world, { kinds: ['node'] });
      setToolUi({ fk: null, gestureHint: null });
      cx.setCursor(undefined);
      if (dragged && source) {
        const drop = resolveDrop(project, d, source, hit);
        if (!drop) {
          setToolUi({ fkPending: source });
        } else if (drop.verdict.ok) openFkPopover(cx, source, drop, e.world);
        else {
          toast('warning', fkRejectText(drop.verdict));
          setToolUi({ fkPending: source });
        }
        cx.requestRender();
        return;
      }
      // a click
      if (prev && press.relationId && prev.relationId !== press.relationId && hit.kind === 'node') {
        // click-armed source + click on ANOTHER table = the referenced table
        const drop = resolveDrop(project, d, prev, hit);
        if (drop?.verdict.ok) openFkPopover(cx, prev, drop, e.world);
        else if (drop && !drop.verdict.ok) toast('warning', fkRejectText(drop.verdict));
      } else if (hit.kind === 'node' && hit.columnId) setToolUi({ fkPending: next });
      cx.requestRender();
    },
    cancel(cx) {
      setToolUi({ fk: null, gestureHint: null });
      cx.setCursor(undefined);
      announce(t('editorTools.announce.cancelled'));
      cx.requestRender();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// add-attribute port: click = add, press-and-hold = flavour menu
// ---------------------------------------------------------------------------------------------------------------------

const HOLD_MS = 450;

function addPortSession(e0: CanvasPointerEvent, nodeId: Id): Session {
  const startClient = clientOf(e0);
  let held = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    held = true;
    setToolUi({ attrMenu: { clientX: e0.clientX, clientY: e0.clientY, ownerNodeId: nodeId } });
  }, HOLD_MS);
  return {
    pointerId: e0.pointerId,
    move(_cx, e) {
      if (dist(clientOf(e), startClient) > 6 && !held) {
        cancelled = true;
        clearTimeout(timer);
      }
    },
    up(cx) {
      clearTimeout(timer);
      if (!held && !cancelled) runAddAttribute(nodeId, 'simple', { store: cx.store, diagramId: cx.diagramId, handle: cx.handle });
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// ports in scope
// ---------------------------------------------------------------------------------------------------------------------

/** Ports currently offered: the selected node's, plus the hovered node's (select tool only, never mid-transaction). */
export function visiblePorts(cx: CanvasContext): Port[] {
  const st = cx.store.getState();
  if (st.tool !== 'select' || st.inTransaction || session) return [];
  const ui = toolUi.getState();
  const out: Port[] = [];
  const seen = new Set<Id>();
  const add = (nodeId: Id | null, columnId?: Id): void => {
    if (!nodeId || seen.has(nodeId) || !cx.diagram.nodes[nodeId]) return;
    seen.add(nodeId);
    out.push(...portsFor(cx.scene, cx.project, cx.diagram, nodeId, cx.zoom, columnId));
  };
  const sel = st.selection;
  if (sel.ids.length === 1 && Object.hasOwn(cx.diagram.nodes, sel.ids[0]!)) {
    const sub = sel.sub?.kind === 'column' ? sel.sub.id : undefined;
    add(sel.ids[0]!, sub);
    seen.delete(sel.ids[0]!);
    if (ui.hoverNodeId === sel.ids[0] && ui.hoverColumnId && ui.hoverColumnId !== sub) out.push(...portsFor(cx.scene, cx.project, cx.diagram, sel.ids[0]!, cx.zoom, ui.hoverColumnId));
  }
  if (ui.hoverNodeId && !(sel.ids.length === 1 && sel.ids[0] === ui.hoverNodeId)) add(ui.hoverNodeId, ui.hoverColumnId ?? undefined);
  return out;
}

function fkSourceForPort(cx: CanvasContext, port: Port): FkSource | null {
  const prev = toolUi.getState().fkPending;
  return nextPending(prev, cx.diagram, cx.project, port.nodeId, port.columnId!, false);
}

// ---------------------------------------------------------------------------------------------------------------------
// the plugin
// ---------------------------------------------------------------------------------------------------------------------

export const toolsPlugin: CanvasPlugin = {
  id: 'editor-tools.tools',
  priority: 90,

  onPointerDown(cx, e) {
    if (e.button !== 0 || cx.store.getState().inTransaction) return;
    const st = cx.store.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    // 1. ports (select tool)
    const port = hitPort(visiblePorts(cx), e.world, cx.zoom);
    if (port && !additive) {
      if (port.kind === 'connect') {
        session = chenSession(e, port.nodeId);
        return 'capture';
      }
      if (port.kind === 'add-attribute') {
        session = addPortSession(e, port.nodeId);
        return 'capture';
      }
      const prev = toolUi.getState().fkPending;
      const next = fkSourceForPort(cx, port);
      session = fkSession(e, prev, next, { nodeId: port.nodeId, relationId: relationIdOfNode(cx.diagram, port.nodeId) });
      return 'capture';
    }
    // 2. modal tools
    if (st.tool === 'connect' && e.hit.kind === 'node') {
      const ref = cx.diagram.nodes[e.hit.nodeId]?.ref;
      if (ref?.kind === 'entity' || ref?.kind === 'relationship') {
        session = chenSession(e, e.hit.nodeId);
        return 'capture';
      }
      if (ref?.kind === 'attribute') {
        toast('info', t('editorTools.connect.sourceAttribute'));
        return 'handled';
      }
    }
    if (st.tool === 'fk' && e.hit.kind === 'node') {
      const relationId = relationIdOfNode(cx.diagram, e.hit.nodeId);
      if (!relationId) return;
      const prev = toolUi.getState().fkPending;
      if (e.hit.columnId) {
        const next = nextPending(prev, cx.diagram, cx.project, e.hit.nodeId, e.hit.columnId, additive);
        session = fkSession(e, prev, next, { nodeId: e.hit.nodeId, relationId });
        return 'capture';
      }
      // a press on the table body / name: only meaningful as the click that picks the referenced table
      if (prev) {
        session = fkSession(e, prev, null, { nodeId: e.hit.nodeId, relationId });
        return 'capture';
      }
      return 'handled';
    }
    return;
  },

  onPointerMove(cx, e) {
    const s = session;
    if (s) {
      if (e.pointerId === s.pointerId) s.move(cx, e);
      return;
    }
    // hover tracking (no capture): which node / cell shows its ports
    const ui = toolUi.getState();
    let node: Id | null = null;
    let col: Id | null = null;
    if (e.hit.kind === 'node') {
      node = e.hit.nodeId;
      col = e.hit.columnId ?? null;
    } else if (ui.hoverNodeId && cx.diagram.nodes[ui.hoverNodeId]) {
      const keepPorts = portsFor(cx.scene, cx.project, cx.diagram, ui.hoverNodeId, cx.zoom, ui.hoverColumnId ?? undefined);
      if (inPortZone(cx.scene, ui.hoverNodeId, keepPorts, e.world, cx.zoom)) {
        node = ui.hoverNodeId;
        col = ui.hoverColumnId;
      }
    }
    // an edge's handles take precedence over node ports lying under them
    if (hitHandle(currentHandles(cx), e.world, cx.zoom)) {
      node = null;
      col = null;
    }
    const port = hitPort(visiblePorts(cx), e.world, cx.zoom);
    const portId = port?.id ?? null;
    if (node !== ui.hoverNodeId || col !== ui.hoverColumnId || portId !== ui.hoverPort) {
      setToolUi({ hoverNodeId: node, hoverColumnId: col, hoverPort: portId });
      cx.requestRender();
    }
    return;
  },

  onPointerUp(cx, e) {
    const s = session;
    session = null;
    s?.up(cx, e);
  },

  onPointerCancel(cx) {
    const s = session;
    session = null;
    s?.cancel(cx);
  },

  onKeyDown(cx, ev) {
    if (session) return; // a running gesture is cancelled by the canvas (Escape -> onPointerCancel)
    const ui = toolUi.getState();
    if (ev.key === 'Escape' && ui.fkPending) {
      setToolUi({ fkPending: null });
      announce(t('editorTools.announce.cancelled'));
      cx.requestRender();
      return 'handled';
    }
    // keyboard path of the FK tool: with a source armed, Enter on the selected table picks it as the referenced table
    if (ev.key === 'Enter' && ui.fkPending && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const ids = cx.store.getState().selection.ids;
      const nodeId = ids.length === 1 ? ids[0]! : undefined;
      const g = nodeId ? cx.scene.nodes[nodeId] : undefined;
      if (!nodeId || !g || !relationIdOfNode(cx.diagram, nodeId)) return;
      const drop = resolveDrop(cx.store.getState().project, cx.diagram, ui.fkPending, { kind: 'node', nodeId });
      if (!drop) return;
      if (drop.verdict.ok) openFkPopover(cx, ui.fkPending, drop, { x: g.bounds.x + g.bounds.w / 2, y: g.bounds.y + g.bounds.h });
      else toast('warning', fkRejectText(drop.verdict));
      cx.requestRender();
      return 'handled';
    }
    return;
  },

  cursorAt(cx, e) {
    if (session) return 'crosshair';
    const port = hitPort(visiblePorts(cx), e.world, cx.zoom);
    if (port) return port.kind === 'add-attribute' ? 'pointer' : 'crosshair';
    const tool = cx.store.getState().tool;
    if (tool === 'connect' && e.hit.kind === 'node') {
      const ref = cx.diagram.nodes[e.hit.nodeId]?.ref;
      if (ref?.kind === 'entity' || ref?.kind === 'relationship') return 'crosshair';
    }
    if (tool === 'fk' && e.hit.kind === 'node' && e.hit.columnId) return 'crosshair';
    return undefined;
  },

  overlay(cx) {
    const ui = toolUi.getState();
    const nodes: ReactNode[] = [];
    const { palette, zoom } = cx;
    const px = (n: number): number => n / zoom;
    // ports
    for (const p of visiblePorts(cx)) {
      const hot = ui.hoverPort === p.id;
      nodes.push(<PortGlyph key={p.id} port={p} zoom={zoom} hot={hot} palette={palette} />);
    }
    // Chen connect ghost
    if (ui.connect) {
      const c = ui.connect;
      const tone = c.feedback?.tone === 'bad' ? palette.error : palette.accent;
      const over = c.overNodeId ? cx.scene.nodes[c.overNodeId]?.paintBounds : undefined;
      nodes.push(
        <g key="connect-ghost" pointerEvents="none" data-overlay="connect-ghost">
          {over && <rect x={over.x - px(4)} y={over.y - px(4)} width={over.w + px(8)} height={over.h + px(8)} rx={px(4)} fill={tone} fillOpacity={0.1} stroke={tone} strokeWidth={2} vectorEffect="non-scaling-stroke" data-tone={c.feedback?.tone} />}
          <line x1={c.from.x} y1={c.from.y} x2={c.to.x} y2={c.to.y} stroke={tone} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <circle cx={c.to.x} cy={c.to.y} r={px(4)} fill={tone} />
        </g>,
      );
    }
    // FK ghost, valid-target cells, source cells
    const pending = ui.fk?.source ?? ui.fkPending;
    if (pending) nodes.push(<FkSourceCells key="fk-src" cx={cx} source={pending} />);
    if (ui.fk) {
      const f = ui.fk;
      const tone = f.feedback?.tone === 'bad' ? palette.error : palette.accent;
      nodes.push(<FkTargets key="fk-targets" cx={cx} source={f.source} overNodeId={f.overNodeId} targetColumnIds={f.targetColumnIds} bad={f.feedback?.tone === 'bad'} />);
      nodes.push(
        <g key="fk-ghost" pointerEvents="none" data-overlay="fk-ghost">
          <line x1={f.from.x} y1={f.from.y} x2={f.to.x} y2={f.to.y} stroke={tone} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <circle cx={f.to.x} cy={f.to.y} r={px(4)} fill={tone} />
        </g>,
      );
    }
    return (
      <g data-overlay="tools">
        {nodes}
        <ToolChrome anchorAt={null} />
      </g>
    );
  },

  contextMenu(cx, hit) {
    if (hit.kind !== 'node') return undefined;
    const ref = cx.diagram.nodes[hit.nodeId]?.ref;
    if (!ref) return undefined;
    if (ref.kind === 'entity' || ref.kind === 'relationship' || ref.kind === 'attribute') {
      return [{ kind: 'separator' }, { kind: 'command', commandId: 'chen.addAttribute' }, ...flavorMenu(hit.nodeId, ref.kind), ...(ref.kind === 'attribute' ? [{ kind: 'command' as const, commandId: 'chen.addSubAttribute' }] : [])];
    }
    if (ref.kind === 'relation') {
      const out = [{ kind: 'separator' as const }, { kind: 'command' as const, commandId: 'table.resetWidths' }];
      if (hit.columnId) out.unshift({ kind: 'command' as const, commandId: 'fk.fromSelection' }, { kind: 'separator' as const });
      return out;
    }
    return undefined;
  },
};

function flavorMenu(_nodeId: Id, kind: 'entity' | 'relationship' | 'attribute'): Array<{ kind: 'command'; commandId: string }> {
  void kind;
  return ['chen.addKeyAttribute', 'chen.addPartialKeyAttribute', 'chen.addMultivaluedAttribute', 'chen.addDerivedAttribute', 'chen.addCompositeAttribute'].map((commandId) => ({ kind: 'command' as const, commandId }));
}

// ---- overlay pieces -----------------------------------------------------------------------------------------------

function PortGlyph({ port, zoom, hot, palette }: { port: Port; zoom: number; hot: boolean; palette: CanvasContext['palette'] }): ReactNode {
  const glyph =
    port.kind === 'add-attribute' ? (
      <path d="M0 -4 V4 M-4 0 H4" stroke={hot ? palette.surface : palette.accent} strokeWidth={1.75} strokeLinecap="round" fill="none" />
    ) : port.kind === 'connect' ? (
      <path d="M-4 0 H4 M1 -3.2 L4 0 L1 3.2" stroke={hot ? palette.surface : palette.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    ) : (
      <path d="M0 -4 V4 M-3.2 1 L0 4 L3.2 1" stroke={hot ? palette.surface : palette.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    );
  return (
    <g transform={`translate(${port.at.x} ${port.at.y}) scale(${1 / zoom})`} pointerEvents="none" data-port={port.kind} data-port-id={port.id}>
      <circle r={9} fill={hot ? palette.accent : palette.surface} stroke={palette.accent} strokeWidth={1.5} />
      {glyph}
    </g>
  );
}

function FkSourceCells({ cx, source }: { cx: CanvasContext; source: FkSource }): ReactNode {
  const g = cx.scene.nodes[source.nodeId];
  if (!g) return null;
  const { palette } = cx;
  return (
    <g pointerEvents="none" data-overlay="fk-source">
      {source.columnIds.map((id) => {
        const r = cellRectOf(g, id);
        return r ? <rect key={id} x={r.x} y={r.y} width={r.w} height={r.h} fill={palette.accent} fillOpacity={0.18} stroke={palette.accent} strokeWidth={2} vectorEffect="non-scaling-stroke" data-column-id={id} /> : null;
      })}
    </g>
  );
}

function FkTargets({ cx, source, overNodeId, targetColumnIds, bad }: { cx: CanvasContext; source: FkSource; overNodeId?: Id; targetColumnIds: Id[]; bad: boolean }): ReactNode {
  const project = cx.store.getState().project;
  const model = relModelOf(project, cx.diagram);
  if (!model) return null;
  const { palette } = cx;
  const count = source.columnIds.length;
  const out: ReactNode[] = [];
  for (const nid of nodesOfKind(cx.scene, 'relation')) {
    const relId = relationIdOfNode(cx.diagram, nid);
    const rel = relId ? model.relations[relId] : undefined;
    const g = cx.scene.nodes[nid];
    if (!rel || !g) continue;
    const valid = new Set(validTargetColumns(rel, count));
    for (const id of valid) {
      const r = cellRectOf(g, id);
      if (r) out.push(<rect key={`${nid}:${id}`} x={r.x + 1} y={r.y + 1} width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)} fill="none" stroke={palette.accent} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" data-valid-target={id} />);
    }
  }
  const over = overNodeId ? cx.scene.nodes[overNodeId] : undefined;
  if (over) {
    const tone = bad ? palette.error : palette.accent;
    const b = over.paintBounds;
    out.push(<rect key="over" x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx={3} fill={tone} fillOpacity={0.06} stroke={tone} strokeWidth={2} vectorEffect="non-scaling-stroke" data-fk-over={bad ? 'bad' : 'ok'} />);
    for (const id of targetColumnIds) {
      const r = cellRectOf(over, id);
      if (r) out.push(<rect key={`t:${id}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={palette.accent} fillOpacity={0.28} stroke={palette.accent} strokeWidth={2.5} vectorEffect="non-scaling-stroke" data-fk-target-cell={id} />);
    }
  }
  return (
    <g pointerEvents="none" data-overlay="fk-targets">
      {out}
    </g>
  );
}

export const __resetToolsForTests = (): void => {
  session = null;
  resetToolUi();
};
export const __sessionForTests = (): Session | null => session;
