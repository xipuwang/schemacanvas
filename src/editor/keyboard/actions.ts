/**
 * Keyboard actions behind the plugin, the commands and the canvas: cell mode, connector handle editing, keyboard connect and
 * keyboard creation. Every semantic edit goes through `store.commit` / the shared coalescing transaction + `src/model/ops`.
 */
import { t } from '@/i18n';
import * as ops from '@/model/ops';
import { columnRole } from '@/model/queries';
import type { Diagram, Id, Point, Project, RelationalModel } from '@/model/types';
import { sidePoint } from '@/scene/geometry';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import { editorStore } from '@/store';
import type { DiagramCanvasHandle } from '../canvasHandle';
import { createFromLibraryItem, GHOST_SIZES, reportCreation } from '../creation';
import type { LibraryItem } from '../dnd';
import { sharedNudger } from '../nudge';
import { performConnect } from '../tools/toolsPlugin';
import { edgeHandles, type Handle } from '../tools/handles';
import { resetHandle } from '../tools/handlesPlugin';
import { nodeName } from '../tools/names';
import { anchorFromPointer, anchorPatch, allowedSides, baseWaypoints, insertionIndex, withInserted, withMoved } from '../tools/routeEdit';
import { setToolUi, toolUi } from '../tools/toolState';
import { cursorColumn, effectiveColumns, enterCellMode, isMarked, moveCursor, syncColumns, toggleCell, type CellModeState, type CellMove } from './cellMode';
import { cycleFocus, describeFocus, edgeFocusTargets, findFreeSpot, nearestInDirection, nudgeDelta, segmentForInsert, type EdgeFocus } from './edgeKb';
import { kbAnnounce, kbStore, resetKb } from './keyboardState';

export interface KbEnv {
  diagramId: Id;
  diagram: Diagram;
  project: Project;
  scene: Scene;
  zoom: number;
  handle: DiagramCanvasHandle | null;
}

/** Environment for a command (no pointer event): builds the scene on demand. */
export function envFromStore(handle: DiagramCanvasHandle | null): KbEnv | undefined {
  const st = editorStore.getState();
  const diagramId = st.activeDiagramId;
  const diagram = diagramId ? st.project.diagrams[diagramId] : undefined;
  if (!diagramId || !diagram) return undefined;
  try {
    return { diagramId, diagram, project: st.project, scene: buildScene(st.project, diagramId), zoom: handle?.getViewport().zoom ?? 1, handle };
  } catch {
    return undefined;
  }
}

const relModel = (project: Project, d: Diagram): RelationalModel | undefined => (project.models[d.modelId]?.kind === 'relational' ? (project.models[d.modelId] as RelationalModel) : undefined);

// ---- cell mode ---------------------------------------------------------------------------------------------------------

/** Column ids of a table node in on-screen order (horizontal cells / single-row or vertical rows). */
export function cellColumns(scene: Scene, nodeId: Id): Id[] {
  const g = scene.nodes[nodeId];
  return g?.kind === 'h-table' ? g.cells.map((c) => c.columnId) : g?.kind === 'v-table' ? g.rows.map((r) => r.columnId) : [];
}

export const selectedTableNode = (project: Project, d: Diagram, selectionIds: readonly Id[]): { nodeId: Id; relationId: Id } | undefined => {
  if (selectionIds.length !== 1) return undefined;
  const node = d.nodes[selectionIds[0]!];
  return node?.ref.kind === 'relation' ? { nodeId: node.id, relationId: node.ref.id } : undefined;
};

/** `Column DoctorSSN, foreign key to Doctor.SSN` (+ `, marked` when it is part of the multi-cell selection). */
export function describeCell(project: Project, d: Diagram, s: CellModeState): string {
  const model = relModel(project, d);
  const rel = model?.relations[s.relationId];
  const col = rel?.columns.find((c) => c.id === cursorColumn(s));
  if (!model || !rel || !col) return '';
  const role = columnRole(model, rel.id, col.id);
  const fk = Object.values(model.foreignKeys).find((f) => f.sourceRelationId === rel.id && f.columns.some((p) => p.sourceColumnId === col.id));
  let target = '';
  if (fk) {
    const tr = model.relations[fk.targetRelationId];
    const names = fk.columns.map((p) => tr?.columns.find((c) => c.id === p.targetColumnId)?.name ?? '?');
    target = `${tr?.name ?? '?'}.${names.length === 1 ? names[0] : `(${names.join(', ')})`}`;
  }
  const key = role === 'pk+fk' ? 'pkfk' : role;
  let text = t(`editor.kb.cell.${key}`, { name: col.name, target });
  if (isMarked(s, col.id)) text = t('editor.kb.cell.marked', { text, count: s.marks.length });
  else if (s.marks.length > 0) text = t('editor.kb.cell.othersMarked', { text, count: s.marks.length });
  return text;
}

function publishCell(env: KbEnv, s: CellModeState): void {
  kbStore.setState({ cell: s });
  editorStore.getState().setSelection([s.nodeId], { kind: 'column', relationId: s.relationId, id: cursorColumn(s) });
  kbAnnounce(describeCell(env.project, env.diagram, s));
}

export function enterCell(env: KbEnv): boolean {
  const st = editorStore.getState();
  const sel = selectedTableNode(env.project, env.diagram, st.selection.ids);
  if (!sel) return false;
  const columns = cellColumns(env.scene, sel.nodeId);
  const start = st.selection.sub?.kind === 'column' ? st.selection.sub.id : undefined;
  const s = enterCellMode(sel.nodeId, sel.relationId, columns, start);
  if (!s) return false;
  // Entering does not change the store selection (the table stays the selection, so panels keep showing the table); the first
  // cursor move selects the column.
  kbStore.setState({ cell: s, edgeId: null, edgeFocus: null, link: null });
  const name = relModel(env.project, env.diagram)?.relations[s.relationId]?.name ?? '';
  kbAnnounce(`${t('editor.kb.cell.enter', { table: name })} ${describeCell(env.project, env.diagram, s)}`);
  return true;
}

export function cellStep(env: KbEnv, to: CellMove, extend = false): boolean {
  const cur = kbStore.getState().cell;
  if (!cur) return false;
  const synced = syncColumns(cur, cellColumns(env.scene, cur.nodeId));
  if (!synced) return cellExit();
  publishCell(env, moveCursor(synced, to, extend));
  return true;
}

export function cellToggle(env: KbEnv): boolean {
  const cur = kbStore.getState().cell;
  if (!cur) return false;
  publishCell(env, toggleCell(cur));
  return true;
}

export function cellExit(): boolean {
  if (!kbStore.getState().cell) return false;
  kbStore.setState({ cell: null });
  kbAnnounce(t('editor.kb.cell.exit'));
  return true;
}

export function cellRename(handle: DiagramCanvasHandle | null): boolean {
  const cur = kbStore.getState().cell;
  if (!cur || !handle) return false;
  handle.startInlineEdit({ nodeId: cur.nodeId, columnId: cursorColumn(cur) });
  return true;
}

/** Columns a foreign key started from the keyboard uses: the marked cells of cell mode, else the selected column. */
export function keyboardSourceColumns(): { nodeId: Id; relationId: Id; columnIds: Id[] } | undefined {
  const cell = kbStore.getState().cell;
  if (cell) return { nodeId: cell.nodeId, relationId: cell.relationId, columnIds: effectiveColumns(cell) };
  return undefined;
}

// ---- connector handles -------------------------------------------------------------------------------------------------------

function edgeTargets(env: KbEnv, edgeId: Id): { targets: EdgeFocus[]; handles: Handle[] } {
  const handles = edgeHandles(env.scene, edgeId, env.diagram.edges[edgeId], env.zoom);
  const labels = env.scene.edges[edgeId]?.labels.map((l) => l.id) ?? [];
  return { targets: edgeFocusTargets(handles, labels), handles };
}

export const selectedEdgeId = (d: Diagram, ids: readonly Id[]): Id | undefined => (ids.length === 1 && Object.hasOwn(d.edges, ids[0]!) ? ids[0] : undefined);

function focusText(f: EdgeFocus, targets: EdgeFocus[]): string {
  const d = describeFocus(targets, f);
  const key = d.kind === 'source' ? 'start' : d.kind === 'target' ? 'end' : d.kind;
  const base = t(`editor.kb.edge.${key}`, { n: d.n, total: d.total, label: d.label ?? '' });
  return base;
}

export function edgeCycle(env: KbEnv, dir: 1 | -1): boolean {
  const edgeId = selectedEdgeId(env.diagram, editorStore.getState().selection.ids);
  if (!edgeId) return false;
  const { targets } = edgeTargets(env, edgeId);
  const kb = kbStore.getState();
  const next = cycleFocus(targets, kb.edgeId === edgeId ? kb.edgeFocus : null, dir);
  if (!next) return false;
  kbStore.setState({ edgeId, edgeFocus: next.id, cell: null });
  kbAnnounce(focusText(next, targets));
  return true;
}

/** The focused handle of the selected connector, when one is focused. */
function focusedTarget(env: KbEnv): { edgeId: Id; focus: EdgeFocus; targets: EdgeFocus[] } | undefined {
  const edgeId = selectedEdgeId(env.diagram, editorStore.getState().selection.ids);
  const kb = kbStore.getState();
  if (!edgeId || kb.edgeId !== edgeId || !kb.edgeFocus) return undefined;
  const { targets } = edgeTargets(env, edgeId);
  const focus = targets.find((x) => x.id === kb.edgeFocus);
  return focus ? { edgeId, focus, targets } : undefined;
}

export const hasEdgeFocus = (env: KbEnv): boolean => !!focusedTarget(env);

/** Arrow keys on the focused handle: bend -> waypoint, end -> anchor along its side, label -> label offset. One undo step per burst. */
export function edgeNudge(env: KbEnv, key: string, shift: boolean): boolean {
  const f = focusedTarget(env);
  if (!f) return false;
  const grid = env.diagram.options.grid.size;
  const delta = nudgeDelta(key, shift, grid);
  if (!delta) return false;
  const did = env.diagramId;
  const { edgeId, focus } = f;
  const edge = editorStore.getState().project.diagrams[did]?.edges[edgeId];
  const g = env.scene.edges[edgeId];
  if (!edge || !g) return false;
  const burst = `edge:${edgeId}:${focus.id}`;
  const run = (recipe: Parameters<typeof sharedNudger.edit>[2], label: string): boolean => sharedNudger.edit(did, burst, recipe, label);
  switch (focus.kind) {
    case 'bend': {
      const p = edge.route.waypoints[focus.handle.index];
      if (!p || edge.route.mode !== 'manual') return false;
      const to = { x: p.x + delta.x, y: p.y + delta.y };
      run((d) => void ops.setEdgeRoute(d, did, edgeId, { mode: 'manual', waypoints: withMoved(d.diagrams[did]!.edges[edgeId]!.route.waypoints, focus.handle.index, to) }), 'Move bend');
      kbAnnounce(t('editor.kb.edge.bendMoved', { n: describeFocus(f.targets, focus).n, x: Math.round(to.x), y: Math.round(to.y) }));
      return true;
    }
    case 'end': {
      const h = focus.handle;
      const route = edge.route;
      const spec = h.branchSourceColumnId ? route.branchAnchors?.[h.branchSourceColumnId]?.[h.end] : h.end === 'source' ? route.sourceAnchor : route.targetAnchor;
      const from: Point = spec && spec.side !== 'auto' ? sidePoint(h.anchorRect, spec.side, spec.offset ?? 0.5) : h.at;
      const next = anchorFromPointer(h.anchorRect, allowedSides(g && env.scene.nodes[h.nodeId], h.columnId), { x: from.x + delta.x, y: from.y + delta.y });
      run((d) => void ops.setEdgeRoute(d, did, edgeId, anchorPatch(d.diagrams[did]!.edges[edgeId]!.route, h, next)), 'Move connector end');
      kbAnnounce(t(h.end === 'source' ? 'editor.kb.edge.startMoved' : 'editor.kb.edge.endMoved'));
      return true;
    }
    case 'label': {
      const off = edge.labelOffsets?.[focus.labelId] ?? { x: 0, y: 0 };
      const to = { x: off.x + delta.x, y: off.y + delta.y };
      run((d) => void ops.setEdgeLabelOffset(d, did, edgeId, focus.labelId, to), 'Move label');
      kbAnnounce(t('editor.kb.edge.labelMoved'));
      return true;
    }
    case 'mid':
      kbAnnounce(t('editor.kb.edge.midHint'));
      return true;
  }
}

/** `I`: a bend at the midpoint of the focused segment (else the longest one); the new bend takes the focus. */
export function edgeInsertBend(env: KbEnv): boolean {
  const edgeId = selectedEdgeId(env.diagram, editorStore.getState().selection.ids);
  const g = edgeId ? env.scene.edges[edgeId] : undefined;
  if (!edgeId || !g) return false;
  sharedNudger.flush();
  const { targets, handles } = edgeTargets(env, edgeId);
  const kb = kbStore.getState();
  const focus = kb.edgeId === edgeId ? targets.find((x) => x.id === kb.edgeFocus) : undefined;
  const mids = handles.filter((h): h is Extract<Handle, { kind: 'mid' }> => h.kind === 'mid');
  const mid = segmentForInsert(g.paths[0] ?? [], mids, focus);
  const edge = editorStore.getState().project.diagrams[env.diagramId]?.edges[edgeId];
  if (!mid || !edge) {
    kbAnnounce(t('editor.kb.edge.noSegment'));
    return false;
  }
  const grid = env.diagram.options.grid;
  const snap = (v: number): number => (grid.snap && grid.size > 0 ? Math.round(v / grid.size) * grid.size : v);
  const p = { x: snap(mid.at.x), y: snap(mid.at.y) };
  const base = baseWaypoints(edge, g);
  const index = insertionIndex(g.paths[0] ?? [], base, mid.segment);
  editorStore.getState().commit('Add bend', (d) => void ops.setEdgeRoute(d, env.diagramId, edgeId, { mode: 'manual', waypoints: withInserted(base, index, p) }));
  kbStore.setState({ edgeId, edgeFocus: `bend:${edgeId}:${index}`, cell: null });
  kbAnnounce(t('editor.kb.edge.bendAdded', { n: index + 1 }));
  return true;
}

/** Delete on a focused bend removes just that bend. Returns false when the focus is not a bend (the edge itself is then deleted by `edit.delete`). */
export function edgeRemoveBend(env: KbEnv): boolean {
  const f = focusedTarget(env);
  if (!f || f.focus.kind !== 'bend') return false;
  sharedNudger.flush();
  resetHandle({ diagramId: env.diagramId, store: editorStore, diagram: editorStore.getState().project.diagrams[env.diagramId]! }, f.focus.handle);
  const remaining = editorStore.getState().project.diagrams[env.diagramId]?.edges[f.edgeId]?.route.waypoints.length ?? 0;
  const idx = f.focus.handle.index;
  kbStore.setState({ edgeFocus: remaining > 0 ? `bend:${f.edgeId}:${Math.min(idx, remaining - 1)}` : null });
  kbAnnounce(t('editor.kb.edge.bendRemoved'));
  return true;
}

// ---- keyboard connect (Chen) and keyboard foreign key target -----------------------------------------------------------------------

const connectable = (env: KbEnv): Array<{ id: Id; rect: import('@/scene/base').Rect }> =>
  env.scene.nodeOrder
    .filter((id) => {
      const k = env.diagram.nodes[id]?.ref.kind;
      return k === 'entity' || k === 'relationship';
    })
    .map((id) => ({ id, rect: env.scene.nodes[id]!.bounds }));

export function linkStart(env: KbEnv): boolean {
  const ids = editorStore.getState().selection.ids;
  const from = ids.length === 1 ? ids[0]! : undefined;
  const k = from ? env.diagram.nodes[from]?.ref.kind : undefined;
  if (!from || (k !== 'entity' && k !== 'relationship')) return false;
  kbStore.setState({ link: { fromNodeId: from }, cell: null, edgeId: null, edgeFocus: null });
  kbAnnounce(t('editor.kb.link.start', { name: nodeName(env.project, env.diagram, from) }));
  return true;
}

export function linkPick(env: KbEnv, key: string): boolean {
  const link = kbStore.getState().link;
  if (!link) return false;
  const st = editorStore.getState();
  const cur = st.selection.ids.length === 1 && connectable(env).some((c) => c.id === st.selection.ids[0]) ? st.selection.ids[0]! : link.fromNodeId;
  const next = nearestInDirection(connectable(env), cur, key);
  if (!next) {
    kbAnnounce(t(`editor.live.noShape.${key}`));
    return true;
  }
  st.setSelection([next]);
  kbAnnounce(t('editor.kb.link.target', { name: nodeName(env.project, env.diagram, next) }));
  return true;
}

export function linkCommit(env: KbEnv): boolean {
  const link = kbStore.getState().link;
  if (!link) return false;
  const ids = editorStore.getState().selection.ids;
  const to = ids.length === 1 ? ids[0]! : undefined;
  if (!to || to === link.fromNodeId) {
    kbAnnounce(t('editor.kb.link.pickFirst'));
    return true;
  }
  kbStore.setState({ link: null });
  performConnect({ store: editorStore, diagramId: env.diagramId, handle: env.handle, zoom: env.zoom }, link.fromNodeId, to, false);
  return true;
}

export function linkCancel(): boolean {
  if (!kbStore.getState().link) return false;
  const from = kbStore.getState().link!.fromNodeId;
  kbStore.setState({ link: null });
  editorStore.getState().setSelection([from]);
  kbAnnounce(t('editor.kb.link.cancelled'));
  return true;
}

/** With a foreign key source armed (`fk.fromSelection`), arrow keys move the selection to the nearest table in that direction. */
export function fkPickTarget(env: KbEnv, key: string): boolean {
  const pending = toolUi.getState().fkPending;
  if (!pending) return false;
  const tables = env.scene.nodeOrder.filter((id) => env.diagram.nodes[id]?.ref.kind === 'relation').map((id) => ({ id, rect: env.scene.nodes[id]!.bounds }));
  const st = editorStore.getState();
  const cur = st.selection.ids.length === 1 && tables.some((x) => x.id === st.selection.ids[0]) ? st.selection.ids[0]! : pending.nodeId;
  const next = nearestInDirection(tables, cur, key);
  if (!next) {
    kbAnnounce(t(`editor.live.noTable.${key}`));
    return true;
  }
  st.setSelection([next]);
  kbAnnounce(t('editor.kb.fk.target', { name: nodeName(env.project, env.diagram, next) }));
  return true;
}

/** `fk.fromSelection` from cell mode: the marked cells become the source; cell mode ends so the arrows choose the target table. */
export function armFkFromCell(): boolean {
  const src = keyboardSourceColumns();
  if (!src) return false;
  kbStore.setState({ cell: null });
  editorStore.getState().setTool('fk');
  setToolUi({ fkPending: { nodeId: src.nodeId, relationId: src.relationId, columnIds: src.columnIds } });
  kbAnnounce(t('editor.kb.fk.armed'));
  return true;
}

// ---- keyboard creation ----------------------------------------------------------------------------------------------------------------

/** Create an element at a free spot near the view centre; it is selected and its name edit starts (the keyboard path of the library). */
export function createAtViewCentre(env: KbEnv, item: LibraryItem): boolean {
  const kind = item.kind === 'relation' ? 'relation' : item.kind === 'entity' || item.kind === 'relationship' ? item.kind : undefined;
  if (!kind || !env.handle) return false;
  const size = GHOST_SIZES[kind];
  const taken = env.scene.nodeOrder.map((id) => env.scene.nodes[id]!.paintBounds);
  const at = findFreeSpot(taken, size, env.handle.visibleCenter());
  const res = createFromLibraryItem(editorStore, env.diagramId, item, at, { zoom: env.zoom });
  reportCreation(res);
  if (!res.ok) return false;
  if (res.rename) env.handle.startInlineEdit(res.rename);
  const created = res.nodeIds[0];
  if (created) {
    const p = editorStore.getState().project;
    const d = p.diagrams[env.diagramId];
    if (d) kbAnnounce(t('editor.kb.created', { name: nodeName(p, d, created) }));
  }
  return true;
}

export { resetKb };
