/**
 * Resize handles (Chen nodes, horizontal-table columns / row height, vertical-table width) and edge editing handles
 * (bends, midpoints, anchor ends, label dragging) for the SELECTED node / edge. Everything is a captured pointer
 * sequence: live preview through one store transaction, Escape / pointercancel restores, one undo step per gesture.
 */
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import * as ops from '@/model/ops';
import type { DiagramEdge, Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import type { CanvasContext, CanvasPlugin, CanvasPointerEvent, MenuEntry } from '../plugins';
import { Glyph, Readout } from './glyphs';
import { DRAG_PX, dist, snapTo } from './geom';
import { edgeHandles, handleCursor, hasCentreline, hitHandle, mainPath, nodeHandles, type Handle } from './handles';
import { affectsX, affectsY, clampRowHeight, minColumnWidth, minNodeSize, minRowHeight, minTableWidth, resizeColumn, resizeRect } from './resize';
import {
  allowedSides,
  anchorFromPointer,
  anchorPatch,
  baseWaypoints,
  insertBendPolyline,
  insertionIndex,
  interiorVertices,
  locateWaypoints,
  moveCornerPolyline,
  straightenWaypoints,
  tidyPolyline,
  withInserted,
  withMoved,
  withRemoved,
} from './routeEdit';
import { announce, resetToolUi, setToolUi, toolUi } from './toolState';

type EndHandle = Extract<Handle, { kind: 'end' }>;

interface DragBase {
  pointerId: number;
  startWorld: Point;
  startClient: Point;
  began: boolean;
  label: string;
  /** Applies the gesture for pointer event `e` (called inside `updateTransaction`). */
  apply(cx: CanvasContext, e: CanvasPointerEvent): void;
  /** Called once on release, inside the still-open transaction (e.g. to normalise what was stored while dragging). */
  finish?(cx: CanvasContext): void;
  /** Optional read-out text for the live size / position bubble. */
  readout?(cx: CanvasContext, e: CanvasPointerEvent): string | undefined;
  handleId?: string;
}

let drag: DragBase | null = null;

// ---- selection -> handles ----------------------------------------------------------------------------------------

export function selectedTarget(cx: Pick<CanvasContext, 'diagram' | 'store'>): { nodeId?: Id; edgeId?: Id } {
  const ids = cx.store.getState().selection.ids;
  if (ids.length !== 1) return {};
  const id = ids[0]!;
  if (Object.hasOwn(cx.diagram.nodes, id)) return { nodeId: id };
  if (Object.hasOwn(cx.diagram.edges, id)) return { edgeId: id };
  return {};
}

/** The handles to show / hit for the current selection (select tool only; locked nodes have none). */
export function currentHandles(cx: CanvasContext): Handle[] {
  const st = cx.store.getState();
  if (st.tool !== 'select') return [];
  const { nodeId, edgeId } = selectedTarget(cx);
  if (nodeId) return cx.diagram.nodes[nodeId]?.locked ? [] : nodeHandles(cx.scene, nodeId, cx.zoom);
  if (edgeId) return edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], cx.zoom);
  return [];
}

const gridOf = (cx: CanvasContext, e: { altKey: boolean }): number => (cx.diagram.options.grid.snap && !e.altKey ? cx.diagram.options.grid.size : 0);
const round = (n: number): number => Math.round(n * 10) / 10;

// ---- drag construction -------------------------------------------------------------------------------------------

function makeDrag(cx: CanvasContext, e: CanvasPointerEvent, h: Handle): DragBase | undefined {
  const did = cx.diagramId;
  const base = { pointerId: e.pointerId, startWorld: e.world, startClient: { x: e.clientX, y: e.clientY }, began: false, handleId: h.id };
  const node = 'nodeId' in h ? cx.diagram.nodes[h.nodeId] : undefined;
  switch (h.kind) {
    case 'resize': {
      const g = cx.scene.nodes[h.nodeId];
      if (!g || !node) return undefined;
      const rect0: Rect = { ...g.bounds };
      const min = minNodeSize(cx.project, did, h.nodeId) ?? { w: 1, h: 1 };
      return {
        ...base,
        label: 'Resize',
        apply(c, ev) {
          const r = resizeRect(rect0, h.dir, { x: ev.world.x - this.startWorld.x, y: ev.world.y - this.startWorld.y }, min, { keepAspect: ev.shiftKey, grid: gridOf(c, ev) });
          const patch: { width?: number; height?: number } = {};
          if (affectsX(h.dir) || (ev.shiftKey && h.dir.length === 2)) patch.width = r.w;
          if (affectsY(h.dir) || (ev.shiftKey && h.dir.length === 2)) patch.height = r.h;
          c.store.getState().updateTransaction((d) => {
            ops.setNodeSize(d, did, h.nodeId, patch);
            ops.setNodePositions(d, did, { [h.nodeId]: { x: r.x, y: r.y } });
          });
        },
        readout(c, ev) {
          const r = resizeRect(rect0, h.dir, { x: ev.world.x - this.startWorld.x, y: ev.world.y - this.startWorld.y }, min, { keepAspect: ev.shiftKey, grid: gridOf(c, ev) });
          return `${round(r.w)} × ${round(r.h)}`;
        },
      };
    }
    case 'col-border': {
      const g = cx.scene.nodes[h.nodeId];
      const cells = g?.kind === 'h-table' ? g.cells.map((c) => ({ columnId: c.columnId, rect: c.rect })) : g?.kind === 'v-table' ? g.rows.map((r) => ({ columnId: r.columnId, rect: r.rect })) : [];
      const cell = cells.find((c) => c.columnId === h.columnId);
      if (!cell || !node) return undefined;
      const w0 = cell.rect.w;
      const x0 = node.x;
      const min = minColumnWidth(cx.project, did, h.nodeId, h.columnId) ?? 20;
      const width = (ev: CanvasPointerEvent, self: DragBase): number => resizeColumn(w0, h.side, ev.world.x - self.startWorld.x, min);
      return {
        ...base,
        label: 'Resize column',
        apply(c, ev) {
          const w = width(ev, this);
          c.store.getState().updateTransaction((d) => {
            ops.setColumnWidth(d, did, h.nodeId, h.columnId, w);
            if (h.side === 'left') ops.setNodePositions(d, did, { [h.nodeId]: { x: x0 - (w - w0), y: d.diagrams[did]!.nodes[h.nodeId]!.y } });
          });
        },
        readout(_c, ev) {
          return `${round(width(ev, this))}`;
        },
      };
    }
    case 'row-height': {
      const g = cx.scene.nodes[h.nodeId];
      const h0 = g?.kind === 'h-table' ? g.row.h : g?.kind === 'v-table' ? g.body.h : undefined;
      if (h0 === undefined || !node) return undefined;
      const min = minRowHeight(cx.project, did, h.nodeId) ?? 16;
      const height = (ev: CanvasPointerEvent, self: DragBase): number => clampRowHeight(h0 + (ev.world.y - self.startWorld.y), min);
      return {
        ...base,
        label: 'Resize row',
        apply(c, ev) {
          const v = height(ev, this);
          c.store.getState().updateTransaction((d) => void ops.setNodeSize(d, did, h.nodeId, { height: v }));
        },
        readout(_c, ev) {
          return `${round(height(ev, this))}`;
        },
      };
    }
    case 'table-width': {
      const g = cx.scene.nodes[h.nodeId];
      if (!g || !node) return undefined;
      const w0 = g.bounds.w;
      const min = minTableWidth(cx.project, did, h.nodeId) ?? 40;
      const width = (ev: CanvasPointerEvent, self: DragBase): number => Math.max(min, w0 + ev.world.x - self.startWorld.x);
      return {
        ...base,
        label: 'Resize table',
        apply(c, ev) {
          const v = width(ev, this);
          c.store.getState().updateTransaction((d) => void ops.setNodeSize(d, did, h.nodeId, { width: v }));
        },
        readout(_c, ev) {
          return `${round(width(ev, this))}`;
        },
      };
    }
    case 'bend': {
      const edge = cx.diagram.edges[h.edgeId];
      const g = cx.scene.edges[h.edgeId];
      if (!edge || !g) return undefined;
      const start = baseWaypoints(edge, g);
      const poly = mainPath(g);
      const vertex = hasCentreline(g) && edge.route.mode === 'manual' ? locateWaypoints(poly, start)[h.index] : undefined;
      const onVertex = vertex !== undefined && vertex > 0 && vertex < poly.length - 1 && dist(poly[vertex]!, start[h.index]!) <= 0.75;
      if (onVertex) {
        // Corner-exact: the whole drawn polyline is edited, so the drag preview (the scene draws these waypoints) IS the result.
        let current: Point[] = poly;
        let index = h.index;
        return {
          ...base,
          label: 'Move bend',
          apply(c, ev) {
            current = moveCornerPolyline(poly, vertex!, snapPoint(c, ev));
            const wps = interiorVertices(current);
            index = vertex! - 1;
            c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, { mode: 'manual', waypoints: wps }));
            const id = `bend:${h.edgeId}:${index}`;
            if (toolUi.getState().activeHandle !== id) setToolUi({ activeHandle: id });
          },
          finish(c) {
            const corner = current[vertex!]!;
            const wps = interiorVertices(tidyPolyline(current, (q) => q.x === corner.x && q.y === corner.y));
            c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, { mode: 'manual', waypoints: wps }));
          },
        };
      }
      return {
        ...base,
        label: 'Move bend',
        apply(c, ev) {
          const p = snapPoint(c, ev);
          c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, { mode: 'manual', waypoints: withMoved(start, h.index, p) }));
        },
      };
    }
    case 'mid': {
      const edge = cx.diagram.edges[h.edgeId];
      const g = cx.scene.edges[h.edgeId];
      if (!edge || !g) return undefined;
      if (hasCentreline(g)) {
        // Corner-exact: the new bend IS the (snapped) pointer; the stored waypoints are every corner of the edited polyline.
        const poly = mainPath(g);
        return {
          ...base,
          label: 'Add bend',
          apply(c, ev) {
            const wps = interiorVertices(insertBendPolyline(poly, h.segment, snapPoint(c, ev)).poly);
            c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, { mode: 'manual', waypoints: wps }));
          },
        };
      }
      const start = baseWaypoints(edge, g);
      const index = insertionIndex(g.paths[0] ?? [], start, h.segment);
      return {
        ...base,
        label: 'Add bend',
        apply(c, ev) {
          const p = snapPoint(c, ev);
          c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, { mode: 'manual', waypoints: withInserted(start, index, p) }));
        },
      };
    }
    case 'end': {
      const edge = cx.diagram.edges[h.edgeId];
      if (!edge) return undefined;
      const sides = allowedSides(cx.scene.nodes[h.nodeId], h.columnId);
      return {
        ...base,
        label: 'Move connector end',
        apply(c, ev) {
          const route = c.store.getState().project.diagrams[did]?.edges[h.edgeId]?.route;
          if (!route) return;
          const spec = anchorFromPointer(h.anchorRect, sides, ev.world);
          c.store.getState().updateTransaction((d) => void ops.setEdgeRoute(d, did, h.edgeId, anchorPatch(route, h, spec)));
        },
      };
    }
  }
}

function snapPoint(cx: CanvasContext, e: CanvasPointerEvent): Point {
  const g = gridOf(cx, e);
  return g > 0 ? { x: snapTo(e.world.x, g), y: snapTo(e.world.y, g) } : { x: e.world.x, y: e.world.y };
}

// ---- label dragging ------------------------------------------------------------------------------------------------

function labelDrag(cx: CanvasContext, e: CanvasPointerEvent, edgeId: Id, labelId: 'main' | 'role' | 'cardinality'): DragBase {
  const did = cx.diagramId;
  const start = cx.diagram.edges[edgeId]?.labelOffsets?.[labelId] ?? { x: 0, y: 0 };
  return {
    pointerId: e.pointerId,
    startWorld: e.world,
    startClient: { x: e.clientX, y: e.clientY },
    began: false,
    label: 'Move label',
    apply(c, ev) {
      const off = { x: start.x + ev.world.x - this.startWorld.x, y: start.y + ev.world.y - this.startWorld.y };
      c.store.getState().updateTransaction((d) => void ops.setEdgeLabelOffset(d, did, edgeId, labelId, off));
    },
  };
}

// ---- reset / remove helpers (double-click, menu, commands) ----------------------------------------------------------

export function resetHandle(cx: Pick<CanvasContext, 'diagramId' | 'store' | 'diagram'>, h: Handle): boolean {
  const did = cx.diagramId;
  const st = cx.store.getState();
  switch (h.kind) {
    case 'resize':
      st.commit('Reset size', (d) => void ops.setNodeSize(d, did, h.nodeId, { width: undefined, height: undefined }));
      return true;
    case 'col-border':
      st.commit('Reset column width', (d) => void ops.setColumnWidth(d, did, h.nodeId, h.columnId, undefined));
      return true;
    case 'row-height':
      st.commit('Reset row height', (d) => void ops.setNodeSize(d, did, h.nodeId, { height: undefined }));
      return true;
    case 'table-width':
      st.commit('Reset table width', (d) => void ops.setNodeSize(d, did, h.nodeId, { width: undefined }));
      return true;
    case 'bend': {
      const edge = cx.diagram.edges[h.edgeId];
      if (!edge) return false;
      const next = withRemoved(edge.route.waypoints, h.index);
      st.commit('Remove bend', (d) => void ops.setEdgeRoute(d, did, h.edgeId, next.length === 0 ? { mode: 'auto', waypoints: [] } : { waypoints: next }));
      return true;
    }
    case 'end': {
      const edge = cx.diagram.edges[h.edgeId];
      if (!edge) return false;
      st.commit('Reset connector end', (d) => {
        if (h.branchSourceColumnId) {
          const all = { ...(edge.route.branchAnchors ?? {}) };
          const cur = { ...(all[h.branchSourceColumnId] ?? {}) };
          delete cur[h.end];
          if (cur.source || cur.target) all[h.branchSourceColumnId] = cur;
          else delete all[h.branchSourceColumnId];
          ops.setEdgeRoute(d, did, h.edgeId, { branchAnchors: all });
        } else ops.setEdgeRoute(d, did, h.edgeId, h.end === 'source' ? { sourceAnchor: undefined } : { targetAnchor: undefined });
      });
      return true;
    }
    default:
      return false;
  }
}

/** Straighten the selected edge's stored route (command + menu). Returns whether anything changed. */
export function straightenEdge(cx: Pick<CanvasContext, 'store' | 'diagramId'>, edgeId: Id): boolean {
  const st = cx.store.getState();
  const edge: DiagramEdge | undefined = st.project.diagrams[cx.diagramId]?.edges[edgeId];
  if (!edge || edge.route.mode !== 'manual' || edge.route.waypoints.length === 0) return false;
  const next = straightenWaypoints(edge.route.waypoints);
  const same = next.length === edge.route.waypoints.length && next.every((p, i) => p.x === edge.route.waypoints[i]!.x && p.y === edge.route.waypoints[i]!.y);
  if (same) return false;
  st.commit('Straighten route', (d) => void ops.setEdgeRoute(d, cx.diagramId, edgeId, next.length === 0 ? { mode: 'auto', waypoints: [] } : { waypoints: next }));
  return true;
}

// ---- keyboard resize (Alt+Shift+Arrows) ------------------------------------------------------------------------------

/**
 * Keyboard alternative to the resize handles: Alt+Shift+Left/Right changes the width (Chen node) or the width of the
 * selected column (tables), Alt+Shift+Up/Down the height / the row height, by one grid step; clamped at the text fit.
 * One undo step per key press. Returns whether something was handled.
 */
export function keyboardResize(cx: Pick<CanvasContext, 'store' | 'diagramId' | 'diagram' | 'scene' | 'project'>, key: string): boolean {
  const { nodeId } = selectedTarget(cx);
  const node = nodeId ? cx.diagram.nodes[nodeId] : undefined;
  const g = nodeId ? cx.scene.nodes[nodeId] : undefined;
  if (!nodeId || !node || !g || node.locked) return false;
  const step = cx.diagram.options.grid.size > 0 ? cx.diagram.options.grid.size : 10;
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (sign === 0) return false;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const did = cx.diagramId;
  const st = cx.store.getState();
  const sub = st.selection.sub;
  if (g.kind === 'chen-entity' || g.kind === 'chen-attribute' || g.kind === 'chen-relationship') {
    const min = minNodeSize(cx.project, did, nodeId) ?? { w: 1, h: 1 };
    const w = Math.max(min.w, g.bounds.w + (horizontal ? sign * step : 0));
    const h = Math.max(min.h, g.bounds.h + (horizontal ? 0 : sign * step));
    st.commit('Resize', (d) => void ops.setNodeSize(d, did, nodeId, horizontal ? { width: w } : { height: h }));
    announce(t('editorTools.announce.resized', { size: `${round(w)} × ${round(h)}` }));
    return true;
  }
  if (g.kind === 'h-table' || (g.kind === 'v-table' && g.orientation === 'horizontal')) {
    const cells = g.kind === 'h-table' ? g.cells.map((c) => ({ columnId: c.columnId, rect: c.rect })) : g.rows.map((r) => ({ columnId: r.columnId, rect: r.rect }));
    if (horizontal) {
      const colId = sub?.kind === 'column' ? sub.id : undefined;
      const cell = cells.find((c) => c.columnId === colId);
      if (!cell) return false;
      const min = minColumnWidth(cx.project, did, nodeId, cell.columnId) ?? 20;
      const w = Math.max(min, cell.rect.w + sign * step);
      st.commit('Resize column', (d) => void ops.setColumnWidth(d, did, nodeId, cell.columnId, w));
      announce(t('editorTools.announce.resized', { size: `${round(w)}` }));
      return true;
    }
    const row = g.kind === 'h-table' ? g.row : g.body;
    const min = minRowHeight(cx.project, did, nodeId) ?? 16;
    const h = Math.max(min, row.h + sign * step);
    st.commit('Resize row', (d) => void ops.setNodeSize(d, did, nodeId, { height: h }));
    announce(t('editorTools.announce.resized', { size: `${round(h)}` }));
    return true;
  }
  if (g.kind === 'v-table' && horizontal) {
    const min = minTableWidth(cx.project, did, nodeId) ?? 40;
    const w = Math.max(min, g.bounds.w + sign * step);
    st.commit('Resize table', (d) => void ops.setNodeSize(d, did, nodeId, { width: w }));
    announce(t('editorTools.announce.resized', { size: `${round(w)}` }));
    return true;
  }
  return false;
}

// ---- the plugin -------------------------------------------------------------------------------------------------

function endDrag(cx: CanvasContext | undefined, commit: boolean): void {
  const d = drag;
  drag = null;
  setToolUi({ activeHandle: null, readout: null });
  if (!d || !d.began) return;
  const st = (cx?.store ?? undefined)?.getState();
  if (!st) return;
  if (commit) st.endTransaction();
  else st.cancelTransaction();
}

function selectEdgeOf(cx: CanvasContext, edgeId: Id): void {
  const st = cx.store.getState();
  const edge = cx.diagram.edges[edgeId];
  if (st.selection.ids.length === 1 && st.selection.ids[0] === edgeId) return;
  if (edge?.ref.kind === 'foreignKey') st.setSelection([edgeId], { kind: 'foreignKey', id: edge.ref.foreignKeyId });
  else st.setSelection([edgeId]);
}

export const handlesPlugin: CanvasPlugin = {
  id: 'editor-tools.handles',
  priority: 100,

  onPointerDown(cx, e) {
    if (e.button !== 0 || cx.store.getState().inTransaction) return;
    if (cx.store.getState().tool !== 'select') return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const h = hitHandle(currentHandles(cx), e.world, cx.zoom);
    if (h) {
      if (h.kind === 'bend' && e.altKey) {
        resetHandle(cx, h);
        return 'handled';
      }
      const d = makeDrag(cx, e, h);
      if (!d) return;
      drag = d;
      setToolUi({ activeHandle: h.id });
      return 'capture';
    }
    // dragging a connector label (selects its edge first)
    if (e.hit.kind === 'edge-label' && !additive && !e.altKey) {
      selectEdgeOf(cx, e.hit.edgeId);
      drag = labelDrag(cx, e, e.hit.edgeId, e.hit.labelId);
      return 'capture';
    }
    return;
  },

  onPointerMove(cx, e) {
    const d = drag;
    if (!d) return;
    if (!d.began) {
      if (dist({ x: e.clientX, y: e.clientY }, d.startClient) < DRAG_PX) return;
      const st = cx.store.getState();
      if (st.inTransaction) return;
      st.beginTransaction(d.label);
      d.began = true;
    }
    d.apply(cx, e);
    const text = d.readout?.(cx, e);
    setToolUi({ readout: text ? { at: e.world, text } : null });
    cx.requestRender();
  },

  onPointerUp(cx) {
    if (drag?.began && cx.store.getState().inTransaction) drag.finish?.(cx);
    endDrag(cx, true);
    cx.requestRender();
  },

  onPointerCancel(cx) {
    endDrag(cx, false);
    announce(t('editorTools.announce.cancelled'));
    cx.requestRender();
  },

  onDoubleClick(cx, e) {
    if (cx.store.getState().tool !== 'select') return;
    const h = hitHandle(currentHandles(cx), e.world, cx.zoom);
    if (!h || h.kind === 'mid') return;
    return resetHandle(cx, h) ? 'handled' : undefined;
  },

  onKeyDown(cx, ev) {
    if (!ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey || !ev.key.startsWith('Arrow')) return;
    if (drag || cx.store.getState().tool !== 'select') return;
    return keyboardResize(cx, ev.key) ? 'handled' : undefined;
  },

  cursorAt(cx, e) {
    if (drag) return undefined;
    const h = hitHandle(currentHandles(cx), e.world, cx.zoom);
    if (h) return handleCursor(h);
    if (e.hit.kind === 'edge-label') return 'move';
    return undefined;
  },

  overlay(cx) {
    const hs = currentHandles(cx);
    const ui = toolUi.getState();
    if (hs.length === 0) return null;
    const shown: ReactNode[] = [];
    for (const h of hs) {
      if (drag?.began && h.id !== ui.activeHandle) continue;
      shown.push(<Glyph key={h.id} id={h.id} kind={h.kind} at={h.at} zoom={cx.zoom} palette={cx.palette} active={h.id === ui.activeHandle} />);
    }
    return (
      <g data-overlay="handles">
        {shown}
        {ui.readout && <Readout at={ui.readout.at} zoom={cx.zoom} palette={cx.palette} text={ui.readout.text} />}
      </g>
    );
  },

  contextMenu(cx, hit): MenuEntry[] | undefined {
    const entries: MenuEntry[] = [];
    if (hit.kind === 'edge' || hit.kind === 'edge-label') {
      const edge = cx.diagram.edges[hit.edgeId];
      if (edge?.route.mode === 'manual' && edge.route.waypoints.length > 0) entries.push({ kind: 'command', commandId: 'edge.straighten' });
      if (edge?.labelOffsets && Object.keys(edge.labelOffsets).length > 0) {
        entries.push({
          kind: 'item',
          id: 'edge.resetLabels',
          label: t('commands.edge.resetLabels'),
          run: () => {
            const did = cx.diagramId;
            cx.store.getState().commit('Reset label position', (d) => {
              for (const k of Object.keys(edge.labelOffsets ?? {}) as Array<'main' | 'role' | 'cardinality'>) ops.setEdgeLabelOffset(d, did, hit.edgeId, k, undefined);
            });
          },
        });
      }
    }
    return entries.length ? entries : undefined;
  },
};

export const __resetHandlesForTests = (): void => {
  drag = null;
  resetToolUi(['announcement']);
};
