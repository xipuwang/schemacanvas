// @vitest-environment jsdom
/**
 * Plugin integration: the REAL plugins driven through the REAL PluginDispatcher against a real store and a real scene.
 * (The canvas component itself is covered by e2e; here pointer sequences are replayed as the canvas would dispatch them.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import * as ops from '@/model/ops';
import type { ErModel, Id, Point, RelationalModel } from '@/model/types';
import { rectCenter } from '@/scene/geometry';
import type { FkEdgeGeom, HTableGeom } from '@/scene/types';
import { uiStore } from '@/ui/uiStore';
import { makeStore, nodeNamed } from '../testFixtures';
import { PluginDispatcher, type CanvasPointerEvent } from '../plugins';
import { addAttributeTo } from './attributes';
import { createForeignKey } from './fkCommit';
import { edgeHandles, hitHandle, nodeHandles, type Handle } from './handles';
import { handlesPlugin, __resetHandlesForTests } from './handlesPlugin';
import { cxOf, evAt, makeEnv, type TestEnv } from './testUtils';
import { toolUi } from './toolState';
import { toolsPlugin, __resetToolsForTests } from './toolsPlugin';
import { minNodeSize } from './resize';

const dispatcher = new PluginDispatcher(() => [handlesPlugin, toolsPlugin]);

interface Rig {
  env: TestEnv;
  store: ReturnType<typeof makeStore>['store'];
  diagramId: Id;
  press(world: Point, over?: Partial<CanvasPointerEvent>): boolean;
  move(world: Point, over?: Partial<CanvasPointerEvent>): void;
  release(world: Point, over?: Partial<CanvasPointerEvent>): void;
  drag(from: Point, to: Point, over?: Partial<CanvasPointerEvent>): void;
  cancel(): void;
  undoDepth(): number;
}

function rig(which: 'chen' | 'rel', zoom = 1, strip?: (d: import('@/model/types').Project, mid: Id) => void): Rig {
  const { store, diagramId, setup } = makeStore(which);
  if (strip) {
    const mid = store.getState().project.diagrams[setup.relId]!.modelId;
    store.getState().commit('strip', (d) => strip(d, mid));
    store.getState().clearHistory();
  }
  // exact geometry assertions: grid snapping is covered by its own test
  store.getState().commit('no snap', (d) => void ops.setDiagramOptions(d, diagramId, { grid: { snap: false } }));
  store.getState().clearHistory();
  const env = makeEnv(store, diagramId, zoom);
  const press = (world: Point, over: Partial<CanvasPointerEvent> = {}): boolean => dispatcher.down(cxOf(env), evAt(env, world, over));
  const move = (world: Point, over: Partial<CanvasPointerEvent> = {}): void => void dispatcher.move(cxOf(env), evAt(env, world, over));
  const release = (world: Point, over: Partial<CanvasPointerEvent> = {}): void => void dispatcher.up(cxOf(env), evAt(env, world, over));
  return {
    env,
    store,
    diagramId,
    press,
    move,
    release,
    drag(from, to, over = {}) {
      press(from, over);
      const steps = 6;
      for (let i = 1; i <= steps; i++) move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, over);
      release(to, over);
    },
    cancel: () => void dispatcher.cancel(cxOf(env)),
    undoDepth: () => store.getState().undoStack.length,
  };
}

beforeEach(() => {
  dispatcher.reset();
  __resetHandlesForTests();
  __resetToolsForTests();
  uiStore.setState({ toasts: [] });
});
afterEach(() => dispatcher.reset());

const handleOf = (env: TestEnv, nodeId: Id, pick: (h: Handle) => boolean): Handle => {
  const cx = cxOf(env);
  const h = nodeHandles(cx.scene, nodeId, cx.zoom).find(pick);
  if (!h) throw new Error('no such handle');
  return h;
};

describe('resize handles', () => {
  it('Chen: east handle resizes the outline in ONE undo step; undo restores auto size', () => {
    const r = rig('chen');
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Doctor');
    r.store.getState().setSelection([id]);
    const w0 = cxOf(r.env).scene.nodes[id]!.bounds.w;
    const h = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'e');
    r.drag(h.at, { x: h.at.x + 60, y: h.at.y });
    const after = cxOf(r.env).scene.nodes[id]!.bounds;
    expect(after.w).toBeCloseTo(w0 + 60, 5);
    expect(r.undoDepth()).toBe(1);
    expect(r.store.getState().project.diagrams[r.diagramId]!.nodes[id]).toMatchObject({ width: expect.any(Number) });
    r.store.getState().undo();
    expect(r.store.getState().project.diagrams[r.diagramId]!.nodes[id]!.width).toBeUndefined();
    expect(cxOf(r.env).scene.nodes[id]!.bounds.w).toBeCloseTo(w0, 5);
  });

  it('Chen: west/north handles keep the opposite edge fixed; shrinking clamps at the text fit', () => {
    const r = rig('chen');
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Patient');
    r.store.getState().setSelection([id]);
    const b0 = { ...cxOf(r.env).scene.nodes[id]!.bounds };
    const nw = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'nw');
    r.drag(nw.at, { x: nw.at.x - 40, y: nw.at.y - 20 });
    const b1 = cxOf(r.env).scene.nodes[id]!.bounds;
    expect(b1.x + b1.w).toBeCloseTo(b0.x + b0.w, 5);
    expect(b1.y + b1.h).toBeCloseTo(b0.y + b0.h, 5);
    expect(b1.w).toBeCloseTo(b0.w + 40, 5);
    // shrink far below the minimum
    const se = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'se');
    r.drag(se.at, { x: se.at.x - 900, y: se.at.y - 900 });
    const min = minNodeSize(r.store.getState().project, r.diagramId, id)!;
    const b2 = cxOf(r.env).scene.nodes[id]!.bounds;
    expect(b2.w).toBeCloseTo(min.w, 5);
    expect(b2.h).toBeCloseTo(min.h, 5);
  });

  it('Escape (cancel) mid-drag restores the size and leaves no history', () => {
    const r = rig('chen');
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Doctor');
    r.store.getState().setSelection([id]);
    const before = cxOf(r.env).scene.nodes[id]!.bounds.w;
    const h = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'e');
    r.press(h.at);
    r.move({ x: h.at.x + 10, y: h.at.y });
    r.move({ x: h.at.x + 50, y: h.at.y });
    expect(r.store.getState().inTransaction).toBe(true);
    r.cancel();
    expect(r.store.getState().inTransaction).toBe(false);
    expect(cxOf(r.env).scene.nodes[id]!.bounds.w).toBeCloseTo(before, 5);
    expect(r.undoDepth()).toBe(0);
  });

  it('a double-click on a handle resets the manual size', () => {
    const r = rig('chen');
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Doctor');
    r.store.getState().setSelection([id]);
    const h = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'e');
    r.drag(h.at, { x: h.at.x + 60, y: h.at.y });
    const h2 = handleOf(r.env, id, (x) => x.kind === 'resize' && x.dir === 'e');
    const cx = cxOf(r.env);
    expect(dispatcher.doubleClick(cx, evAt(r.env, h2.at))).toBe(true);
    expect(r.store.getState().project.diagrams[r.diagramId]!.nodes[id]!.width).toBeUndefined();
  });

  it('horizontal table: column border resizes that column (clamped at the text fit), the bottom strip resizes the row', () => {
    const r = rig('rel');
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Patient');
    r.store.getState().setSelection([id]);
    const g0 = cxOf(r.env).scene.nodes[id] as HTableGeom;
    const col = g0.cells[1]!;
    const border = handleOf(r.env, id, (x) => x.kind === 'col-border' && x.columnId === col.columnId && x.side === 'right');
    r.drag(border.at, { x: border.at.x + 30, y: border.at.y });
    const g1 = cxOf(r.env).scene.nodes[id] as HTableGeom;
    expect(g1.cells[1]!.rect.w).toBeCloseTo(col.rect.w + 30, 5);
    expect(g1.cells[0]!.rect.w).toBeCloseTo(g0.cells[0]!.rect.w, 5);
    expect(r.undoDepth()).toBe(1);
    // shrink way below the text
    const border2 = handleOf(r.env, id, (x) => x.kind === 'col-border' && x.columnId === col.columnId && x.side === 'right');
    r.drag(border2.at, { x: border2.at.x - 500, y: border2.at.y });
    const g2 = cxOf(r.env).scene.nodes[id] as HTableGeom;
    expect(g2.cells[1]!.rect.w).toBeGreaterThan(20);
    expect(g2.cells[1]!.rect.w).toBeLessThan(col.rect.w + 1);
    // row height
    const rowH = handleOf(r.env, id, (x) => x.kind === 'row-height');
    r.drag(rowH.at, { x: rowH.at.x, y: rowH.at.y + 14 });
    const g3 = cxOf(r.env).scene.nodes[id] as HTableGeom;
    expect(g3.row.h).toBeCloseTo(g0.row.h + 14, 5);
    // semantics untouched
    const m = r.store.getState().project.models[cxOf(r.env).diagram.modelId] as RelationalModel;
    expect(Object.keys(m.foreignKeys).length).toBe(9);
  });
});

describe('edge editing never changes what an edge refers to', () => {
  const fkEdgeOf = (r: Rig, fkName: (m: RelationalModel) => Id): Id => {
    const d = r.store.getState().project.diagrams[r.diagramId]!;
    const m = r.store.getState().project.models[d.modelId] as RelationalModel;
    const fkId = fkName(m);
    return Object.values(d.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fkId)!.id;
  };
  const patientDoctor = (m: RelationalModel): Id => Object.values(m.foreignKeys).find((f) => m.relations[f.sourceRelationId]!.name === 'Patient')!.id;
  const prescriptionDrug = (m: RelationalModel): Id => Object.values(m.foreignKeys).find((f) => m.relations[f.sourceRelationId]!.name === 'Prescription' && m.relations[f.targetRelationId]!.name === 'Drug')!.id;
  const select = (r: Rig, edgeId: Id): void => {
    const d = r.store.getState().project.diagrams[r.diagramId]!;
    const e = d.edges[edgeId]!;
    r.store.getState().setSelection([edgeId], e.ref.kind === 'foreignKey' ? { kind: 'foreignKey', id: e.ref.foreignKeyId } : undefined);
  };
  const modelOf = (r: Rig): RelationalModel => r.store.getState().project.models[cxOf(r.env).diagram.modelId] as RelationalModel;

  it('midpoint drag inserts a waypoint (route becomes manual, starting from the auto corners); bend drag moves it; Alt+click removes it', () => {
    const r = rig('rel');
    const edgeId = fkEdgeOf(r, patientDoctor);
    select(r, edgeId);
    const modelBefore = JSON.stringify(modelOf(r));
    const cx = cxOf(r.env);
    const auto = cx.scene.edges[edgeId]!.autoWaypoints.length;
    const mid = edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], cx.zoom).find((h) => h.kind === 'mid')!;
    const dropped = { x: mid.at.x + 25, y: mid.at.y + 18 };
    r.drag(mid.at, dropped);
    const edge = r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!;
    expect(edge.route.mode).toBe('manual');
    // SA-04: the stored waypoints are the corners of the edited route (the auto corners plus the dog-leg through the pointer)
    expect(edge.route.waypoints.length).toBeGreaterThanOrEqual(auto + 1);
    expect(r.undoDepth()).toBe(1);
    // the dragged point is among the stored corners and is a bend handle ON the drawn line
    expect(edge.route.waypoints.some((w) => Math.abs(w.x - dropped.x) < 1 && Math.abs(w.y - dropped.y) < 1)).toBe(true);
    const cx2 = cxOf(r.env);
    const bends = edgeHandles(cx2.scene, edgeId, cx2.diagram.edges[edgeId], cx2.zoom).filter((h) => h.kind === 'bend');
    expect(bends).toHaveLength(edge.route.waypoints.length);
    const bend = bends.find((h) => Math.abs(h.at.x - dropped.x) < 1 && Math.abs(h.at.y - dropped.y) < 1)! as Extract<Handle, { kind: 'bend' }>;
    expect(bend).toBeTruthy();
    r.drag(bend.at, { x: bend.at.x + 12, y: bend.at.y });
    const moved = r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!.route.waypoints;
    expect(moved.some((w) => Math.abs(w.x - (dropped.x + 12)) < 1e-6 && Math.abs(w.y - dropped.y) < 1e-6)).toBe(true);
    expect(r.undoDepth()).toBe(2);
    // Alt+click removes
    const cx3 = cxOf(r.env);
    const b2 = edgeHandles(cx3.scene, edgeId, cx3.diagram.edges[edgeId], cx3.zoom).find((h) => h.kind === 'bend')!;
    expect(r.press(b2.at, { altKey: true })).toBe(true);
    expect(r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!.route.waypoints.length).toBe(moved.length - 1);
    // none of this touched the semantic model
    expect(JSON.stringify(modelOf(r))).toBe(modelBefore);
  });

  it('end handle moves the anchor along the allowed side of the CELL; the arrow still ends on the referenced cell', () => {
    const r = rig('rel');
    const edgeId = fkEdgeOf(r, patientDoctor);
    select(r, edgeId);
    const cx = cxOf(r.env);
    const geom = cx.scene.edges[edgeId] as FkEdgeGeom;
    const target = geom.ends[1];
    const targetColumn = target.columnId!;
    const handle = edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], cx.zoom).find((h) => h.kind === 'end' && h.end === 'target')!;
    // drag to the right part of the same cell's top border
    const rect = target.anchorRect;
    r.drag(handle.at, { x: rect.x + rect.w * 0.8, y: rect.y - 30 });
    const edge = r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!;
    expect(edge.route.targetAnchor).toBeDefined();
    expect(['top', 'bottom']).toContain(edge.route.targetAnchor!.side);
    const after = cxOf(r.env).scene.edges[edgeId] as FkEdgeGeom;
    expect(after.ends[1].columnId).toBe(targetColumn);
    const tip = after.branches[0]!.arrow.tip;
    const cell = after.branches[0]!.targetCell;
    expect(tip.x).toBeGreaterThanOrEqual(cell.x);
    expect(tip.x).toBeLessThanOrEqual(cell.x + cell.w);
    expect(Math.abs(tip.y - cell.y) < 0.5 || Math.abs(tip.y - (cell.y + cell.h)) < 0.5).toBe(true);
    // the dragged offset is honoured (right part of the cell)
    expect(tip.x).toBeGreaterThan(cell.x + cell.w * 0.6);
    // double-click on the end handle resets the anchor to automatic
    const h2 = edgeHandles(cxOf(r.env).scene, edgeId, cxOf(r.env).diagram.edges[edgeId], 1).find((h) => h.kind === 'end' && h.end === 'target')!;
    expect(dispatcher.doubleClick(cxOf(r.env), evAt(r.env, h2.at))).toBe(true);
    expect(r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!.route.targetAnchor).toBeUndefined();
  });

  it('composite FK: each branch end stores a per-branch anchor keyed by its SOURCE column; pairs stay ordered and untouched', () => {
    const r = rig('rel');
    const edgeId = fkEdgeOf(r, prescriptionDrug);
    select(r, edgeId);
    const pairsBefore = JSON.stringify(modelOf(r).foreignKeys[prescriptionDrug(modelOf(r))]!.columns);
    const cx = cxOf(r.env);
    const ends = edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], cx.zoom).filter((h): h is Extract<Handle, { kind: 'end' }> => h.kind === 'end');
    const branchEnds = ends.filter((h) => h.branchSourceColumnId);
    expect(branchEnds.length).toBe(4); // 2 branches x source+target
    const second = branchEnds.find((h) => h.end === 'target' && h.columnId === branchEnds.filter((x) => x.end === 'target')[1]!.columnId)!;
    r.drag(second.at, { x: second.anchorRect.x + second.anchorRect.w * 0.3, y: second.anchorRect.y + second.anchorRect.h + 40 });
    const route = r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!.route;
    expect(Object.keys(route.branchAnchors ?? {})).toEqual([second.branchSourceColumnId]);
    expect(route.branchAnchors![second.branchSourceColumnId!]!.target).toBeDefined();
    expect(route.sourceAnchor).toBeUndefined();
    expect(JSON.stringify(modelOf(r).foreignKeys[prescriptionDrug(modelOf(r))]!.columns)).toBe(pairsBefore);
    const after = cxOf(r.env).scene.edges[edgeId] as FkEdgeGeom;
    expect(after.branches.map((b) => b.targetColumnId)).toEqual(modelOf(r).foreignKeys[prescriptionDrug(modelOf(r))]!.columns.map((c) => c.targetColumnId));
  });

  it('label dragging stores a relative offset (one undo step) and selects the edge first', () => {
    const r = rig('rel');
    const edgeId = fkEdgeOf(r, patientDoctor);
    r.store.getState().commit('labels', (d) => void ops.setEdgeLabelVisible(d, r.diagramId, edgeId, true));
    r.store.getState().clearHistory();
    const cx = cxOf(r.env);
    const label = cx.scene.edges[edgeId]!.labels.find((l) => l.id === 'main')!.label;
    const centre = { x: label.x, y: label.y };
    expect(cx.hit(centre).kind).toBe('edge-label');
    r.drag(centre, { x: centre.x + 30, y: centre.y + 20 });
    const off = r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]!.labelOffsets?.main;
    expect(off).toBeDefined();
    expect(off!.x).toBeCloseTo(30, 0);
    expect(off!.y).toBeCloseTo(20, 0);
    expect(r.store.getState().selection.ids).toEqual([edgeId]);
    expect(r.undoDepth()).toBe(1);
  });
});

describe('Escape / pointercancel restores every edge gesture', () => {
  it('end anchor, label offset and bend drags leave no history and no open transaction', () => {
    const r = rig('rel');
    const d0 = r.store.getState().project.diagrams[r.diagramId]!;
    const m = r.store.getState().project.models[d0.modelId] as RelationalModel;
    const fk = Object.values(m.foreignKeys).find((f) => m.relations[f.sourceRelationId]!.name === 'Patient')!;
    const edgeId = Object.values(d0.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fk.id)!.id;
    r.store.getState().commit('labels', (d) => void ops.setEdgeLabelVisible(d, r.diagramId, edgeId, true));
    r.store.getState().clearHistory();
    r.store.getState().setSelection([edgeId], { kind: 'foreignKey', id: fk.id });
    const snapshot = JSON.stringify(r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId]);
    const cx = cxOf(r.env);
    const end = edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], 1).find((h) => h.kind === 'end')!;
    r.press(end.at);
    r.move({ x: end.at.x + 30, y: end.at.y + 30 });
    r.move({ x: end.at.x + 60, y: end.at.y + 60 });
    expect(r.store.getState().inTransaction).toBe(true);
    r.cancel();
    expect(r.store.getState().inTransaction).toBe(false);
    const label = cx.scene.edges[edgeId]!.labels.find((l) => l.id === 'main')!.label;
    r.press({ x: label.x, y: label.y });
    r.move({ x: label.x + 20, y: label.y + 20 });
    r.move({ x: label.x + 40, y: label.y + 40 });
    expect(r.store.getState().inTransaction).toBe(true);
    r.cancel();
    expect(r.store.getState().inTransaction).toBe(false);
    const cx2 = cxOf(r.env);
    const mid = edgeHandles(cx2.scene, edgeId, cx2.diagram.edges[edgeId], 1).find((h) => h.kind === 'mid')!;
    r.press(mid.at);
    r.move({ x: mid.at.x + 5, y: mid.at.y + 25 });
    r.move({ x: mid.at.x + 9, y: mid.at.y + 40 });
    r.cancel();
    expect(JSON.stringify(r.store.getState().project.diagrams[r.diagramId]!.edges[edgeId])).toBe(snapshot);
    expect(r.undoDepth()).toBe(0);
  });
});

describe('hit areas', () => {
  it.each([0.25, 1, 4])('every handle is grabbable within 8 screen px at zoom %s', (zoom) => {
    const r = rig('rel', zoom);
    const id = nodeNamed(r.store.getState().project, r.diagramId, 'Doctor');
    const cx = cxOf(r.env);
    const edgeId = Object.keys(cx.diagram.edges)[0]!;
    // node handles and edge handles are never shown together (one selected element), so they are checked as two sets
    for (const hs of [nodeHandles(cx.scene, id, zoom), edgeHandles(cx.scene, edgeId, cx.diagram.edges[edgeId], zoom)])
    for (const h of hs) {
      if (h.kind === 'col-border' || h.kind === 'row-height') {
        const c = rectCenter(h.rect);
        expect(h.kind === 'col-border' ? h.rect.w * zoom : h.rect.h * zoom).toBeGreaterThanOrEqual(8);
        // at very low zoom the column strips (>= 18px wide) cover whole narrow cells, so the row strip is only probed at >= 100%
        if (h.kind === 'col-border' || zoom >= 1) expect(hitHandle(hs, c, zoom)?.id).toBe(h.id);
        continue;
      }
      const near = { x: h.at.x + 8 / zoom - 0.01, y: h.at.y };
      const hit = hitHandle([h], near, zoom);
      expect(hit?.id, h.id).toBe(h.id);
    }
  });
});

describe('connect tool (Chen)', () => {
  const erOf = (r: Rig): ErModel => r.store.getState().project.models[cxOf(r.env).diagram.modelId] as ErModel;

  it('entity -> entity creates a relationship with both participants in ONE commit (many, partial), selected and renamed inline', () => {
    const r = rig('chen');
    r.store.getState().setTool('connect');
    const p = r.store.getState().project;
    const ds = nodeNamed(p, r.diagramId, 'Doctor');
    const ph = nodeNamed(p, r.diagramId, 'Pharmacy');
    const sc = cxOf(r.env).scene;
    const before = Object.keys(erOf(r).relationships).length;
    r.drag(rectCenter(sc.nodes[ds]!.bounds), rectCenter(sc.nodes[ph]!.bounds));
    const model = erOf(r);
    expect(Object.keys(model.relationships).length).toBe(before + 1);
    const rel = Object.values(model.relationships).find((x) => !['PrimaryPhysician', 'Contact', 'Makes', 'Sell', 'Prescription'].includes(x.name))!;
    expect(rel.participants).toHaveLength(2);
    expect(rel.participants.every((q) => q.max === 'many' && q.participation === 'partial')).toBe(true);
    expect(r.undoDepth()).toBe(1);
    const sel = r.store.getState().selection.ids;
    expect(sel).toHaveLength(1);
    expect(r.env.inline.at(-1)).toMatchObject({ nodeId: sel[0] });
    // no overlap with other nodes
    const sc2 = cxOf(r.env).scene;
    const nb = sc2.nodes[sel[0]!]!.paintBounds;
    for (const id of sc2.nodeOrder) {
      if (id === sel[0]) continue;
      const o = sc2.nodes[id]!.paintBounds;
      expect(nb.x < o.x + o.w && nb.x + nb.w > o.x && nb.y < o.y + o.h && nb.y + nb.h > o.y, `overlaps ${id}`).toBe(false);
    }
    r.store.getState().undo();
    expect(Object.keys(erOf(r).relationships).length).toBe(before);
  });

  it('entity -> relationship adds a participant; a second drag to the same pair adds a RECURSIVE participant (role edit focused); a third is refused', () => {
    const r = rig('chen');
    r.store.getState().setTool('connect');
    const p = r.store.getState().project;
    const company = nodeNamed(p, r.diagramId, 'Company');
    const sell = nodeNamed(p, r.diagramId, 'Sell');
    const sc = cxOf(r.env).scene;
    const sellRel = Object.values(erOf(r).relationships).find((x) => x.name === 'Sell')!;
    r.drag(rectCenter(sc.nodes[company]!.bounds), rectCenter(sc.nodes[sell]!.bounds));
    expect(erOf(r).relationships[sellRel.id]!.participants).toHaveLength(3);
    const added = erOf(r).relationships[sellRel.id]!.participants.at(-1)!;
    expect(added).toMatchObject({ max: 'many', participation: 'partial' });
    expect(r.undoDepth()).toBe(1);
    // second drag: company is now there once more -> recursive
    const sc2 = cxOf(r.env).scene;
    r.drag(rectCenter(sc2.nodes[company]!.bounds), rectCenter(sc2.nodes[sell]!.bounds));
    expect(erOf(r).relationships[sellRel.id]!.participants.filter((q) => q.entityId === added.entityId)).toHaveLength(2);
    expect(r.env.inline.at(-1)).toHaveProperty('edgeId');
    // third: refused with a toast, no commit
    const depth = r.undoDepth();
    const sc3 = cxOf(r.env).scene;
    r.drag(rectCenter(sc3.nodes[company]!.bounds), rectCenter(sc3.nodes[sell]!.bounds));
    expect(r.undoDepth()).toBe(depth);
    expect(uiStore.getState().toasts.at(-1)?.kind).toBe('warning');
  });

  it('relationship -> relationship and entity -> attribute are rejected with an explanation', () => {
    const r = rig('chen');
    r.store.getState().setTool('connect');
    const p = r.store.getState().project;
    const a = nodeNamed(p, r.diagramId, 'Contact');
    const b = nodeNamed(p, r.diagramId, 'Sell');
    const sc = cxOf(r.env).scene;
    const depth = r.undoDepth();
    r.drag(rectCenter(sc.nodes[a]!.bounds), rectCenter(sc.nodes[b]!.bounds));
    expect(r.undoDepth()).toBe(depth);
    const first = uiStore.getState().toasts.at(-1);
    expect(first?.message).toMatch(/relationship/i);
    const doctor = nodeNamed(p, r.diagramId, 'Doctor');
    const attr = nodeNamed(p, r.diagramId, 'Speciality');
    r.drag(rectCenter(sc.nodes[doctor]!.bounds), rectCenter(sc.nodes[attr]!.bounds));
    expect(r.undoDepth()).toBe(depth);
    // same-kind warnings coalesce (stackToast), so the second rejection replaces the first with its own explanation
    const second = uiStore.getState().toasts.at(-1);
    expect(second?.kind).toBe('warning');
    expect(second?.id).not.toBe(first?.id);
    expect(second?.message).not.toBe(first?.message);
  });

  it('Escape (cancel) mid-drag creates nothing', () => {
    const r = rig('chen');
    r.store.getState().setTool('connect');
    const p = r.store.getState().project;
    const ds = nodeNamed(p, r.diagramId, 'Doctor');
    const ph = nodeNamed(p, r.diagramId, 'Pharmacy');
    const sc = cxOf(r.env).scene;
    r.press(rectCenter(sc.nodes[ds]!.bounds));
    r.move(rectCenter(sc.nodes[ph]!.bounds));
    expect(toolUi.getState().connect?.overNodeId).toBe(ph);
    expect(toolUi.getState().connect?.feedback?.tone).toBe('ok');
    r.cancel();
    expect(toolUi.getState().connect).toBeNull();
    expect(r.undoDepth()).toBe(0);
  });

  it('dragging from the connect PORT works in the select tool', () => {
    const r = rig('chen');
    const p = r.store.getState().project;
    const ds = nodeNamed(p, r.diagramId, 'Doctor');
    const pr = nodeNamed(p, r.diagramId, 'Prescription');
    r.store.getState().setSelection([ds]);
    const cx = cxOf(r.env);
    const b = cx.scene.nodes[ds]!.bounds;
    // the connect port sits 22px right of the outline, below the vertical middle
    const port = { x: b.x + b.w + 22, y: b.y + b.h / 2 + 13 };
    const before = erOf(r).relationships;
    const presc = Object.values(before).find((x) => x.name === 'Prescription')!;
    r.drag(port, rectCenter(cx.scene.nodes[pr]!.bounds));
    // Doctor already participates in Prescription once -> this is the second (recursive) participant
    expect(erOf(r).relationships[presc.id]!.participants.filter((q) => q.entityId === presc.participants[0]!.entityId)).toHaveLength(2);
  });
});

describe('add attribute', () => {
  it('the + port click adds an attribute next to the owner, selects it and starts inline rename', () => {
    const r = rig('chen');
    const p = r.store.getState().project;
    const id = nodeNamed(p, r.diagramId, 'Pharmacy');
    r.store.getState().setSelection([id]);
    const cx = cxOf(r.env);
    const b = cx.scene.nodes[id]!.bounds;
    const port = { x: b.x + b.w + 22, y: b.y + b.h / 2 - 13 };
    const count = (): number => Object.keys((r.store.getState().project.models[cx.diagram.modelId] as ErModel).attributes).length;
    const n0 = count();
    expect(r.press(port)).toBe(true);
    r.release(port);
    expect(count()).toBe(n0 + 1);
    expect(r.undoDepth()).toBe(1);
    const sel = r.store.getState().selection.ids;
    expect(sel).toHaveLength(1);
    expect(r.store.getState().project.diagrams[r.diagramId]!.nodes[sel[0]!]!.ref.kind).toBe('attribute');
    expect(r.env.inline.at(-1)).toMatchObject({ nodeId: sel[0] });
  });

  it('flavours: key / partial key / multivalued / derived / composite (+2 children) / sub-attribute; keys degrade on non-entities', () => {
    const r = rig('chen');
    const p = r.store.getState().project;
    const ent = nodeNamed(p, r.diagramId, 'Company');
    const er = (): ErModel => r.store.getState().project.models[cxOf(r.env).diagram.modelId] as ErModel;
    const names = (): string[] => Object.values(er().attributes).map((a) => a.name);
    const last = (): import('@/model/types').ErAttribute => Object.values(er().attributes).find((a) => !names().slice(0, 0).includes(a.name) && a.name.startsWith('attribute') && a.key === 'primary')!;
    const k = addAttributeTo(r.store, r.diagramId, ent, 'key');
    expect(k.ok).toBe(true);
    expect(last().key).toBe('primary');
    const pk = addAttributeTo(r.store, r.diagramId, ent, 'partial-key');
    expect(pk.ok && Object.values(er().attributes).some((a) => a.key === 'partial')).toBe(true);
    const mv = addAttributeTo(r.store, r.diagramId, ent, 'multivalued');
    expect(mv.ok && Object.values(er().attributes).some((a) => a.multivalued)).toBe(true);
    const dv = addAttributeTo(r.store, r.diagramId, ent, 'derived');
    expect(dv.ok && Object.values(er().attributes).some((a) => a.derived)).toBe(true);
    const comp = addAttributeTo(r.store, r.diagramId, ent, 'composite');
    expect(comp.ok && comp.created).toHaveLength(2);
    const compId = comp.ok ? (r.store.getState().project.diagrams[r.diagramId]!.nodes[comp.nodeId]!.ref.id as Id) : '';
    expect(Object.values(er().attributes).filter((a) => a.owner.kind === 'attribute' && a.owner.id === compId)).toHaveLength(2);
    // sub-attribute on a composite (owner = attribute node)
    const sub = addAttributeTo(r.store, r.diagramId, comp.ok ? comp.nodeId : '', 'simple');
    expect(sub.ok && Object.values(er().attributes).filter((a) => a.owner.kind === 'attribute' && a.owner.id === compId)).toHaveLength(3);
    // relationship owner: a key flavour is downgraded to a simple attribute
    const rel = nodeNamed(r.store.getState().project, r.diagramId, 'Sell');
    const relAttr = addAttributeTo(r.store, r.diagramId, rel, 'key');
    expect(relAttr.ok).toBe(true);
    const relRef = r.store.getState().project.diagrams[r.diagramId]!.nodes[rel]!.ref.id;
    expect(Object.values(er().attributes).filter((a) => a.owner.id === relRef).every((a) => a.key === 'none')).toBe(true);
    // unique default names among siblings
    const sib = Object.values(er().attributes).filter((a) => a.owner.id === Object.values(er().entities).find((e) => e.name === 'Company')!.id).map((a) => a.name.toLowerCase());
    expect(new Set(sib).size).toBe(sib.length);
  });
});

describe('foreign key tool', () => {
  const strip = (d: import('@/model/types').Project, mid: Id): void => {
    const m = d.models[mid] as RelationalModel;
    for (const id of Object.keys(m.foreignKeys)) ops.removeForeignKey(d, mid, id);
  };
  const cellCentre = (r: Rig, table: string, column: string): Point => {
    const cx = cxOf(r.env);
    const nodeId = nodeNamed(r.store.getState().project, r.diagramId, table);
    const g = cx.scene.nodes[nodeId] as HTableGeom;
    const m = r.store.getState().project.models[cx.diagram.modelId] as RelationalModel;
    const rel = m.relations[cx.diagram.nodes[nodeId]!.ref.id]!;
    const colId = rel.columns.find((c) => c.name === column)!.id;
    return rectCenter(g.cells.find((c) => c.columnId === colId)!.rect);
  };
  const fks = (r: Rig): RelationalModel['foreignKeys'] => (r.store.getState().project.models[cxOf(r.env).diagram.modelId] as RelationalModel).foreignKeys;
  const names = (r: Rig, fk: RelationalModel['foreignKeys'][string]): string => {
    const m = r.store.getState().project.models[cxOf(r.env).diagram.modelId] as RelationalModel;
    const s = m.relations[fk.sourceRelationId]!;
    const t = m.relations[fk.targetRelationId]!;
    return `${s.name}.(${fk.columns.map((c) => s.columns.find((x) => x.id === c.sourceColumnId)!.name).join(',')})->${t.name}.(${fk.columns.map((c) => t.columns.find((x) => x.id === c.targetColumnId)!.name).join(',')})`;
  };

  it('drag Patient.DoctorSSN -> Doctor.SSN opens the mapping popover; confirming creates ONE foreign key and the arrow ends on Doctor.SSN', () => {
    const r = rig('rel', 1, strip);
    r.store.getState().setTool('fk');
    expect(Object.keys(fks(r))).toHaveLength(0);
    const to = cellCentre(r, 'Doctor', 'SSN');
    r.drag(cellCentre(r, 'Patient', 'DoctorSSN'), to);
    const pop = toolUi.getState().fkPopover;
    expect(pop).not.toBeNull();
    expect(r.undoDepth()).toBe(0); // nothing is created BEFORE the user confirms
    expect(pop!.source.columnIds).toHaveLength(1);
    const out = createForeignKey(r.store, r.diagramId, pop!.source.relationId, pop!.targetRelationId, pop!.source.columnIds.map((s, i) => ({ sourceColumnId: s, targetColumnId: pop!.targetColumnIds[i]! })));
    expect(out.ok && out.text).toBe('Patient.DoctorSSN → Doctor.SSN');
    expect(Object.values(fks(r)).map((f) => names(r, f))).toEqual(['Patient.(DoctorSSN)->Doctor.(SSN)']);
    expect(r.undoDepth()).toBe(1);
    // geometry: the arrow tip lies on the border of the SSN cell of Doctor
    const cx = cxOf(r.env);
    const edge = Object.values(cx.scene.edges)[0] as FkEdgeGeom;
    const doctor = cx.scene.nodes[nodeNamed(r.store.getState().project, r.diagramId, 'Doctor')] as HTableGeom;
    const ssn = doctor.cells.find((c) => c.rect.x === Math.min(...doctor.cells.map((x) => x.rect.x)))!.rect;
    const tip = edge.branches[0]!.arrow.tip;
    expect(tip.x).toBeGreaterThanOrEqual(ssn.x);
    expect(tip.x).toBeLessThanOrEqual(ssn.x + ssn.w);
    expect(Math.abs(tip.y - ssn.y) < 0.5 || Math.abs(tip.y - (ssn.y + ssn.h)) < 0.5).toBe(true);
    r.store.getState().undo();
    expect(Object.keys(fks(r))).toHaveLength(0);
  });

  it('shift-click builds a composite source; Prescription.(CompanyName, DrugTradeName) -> Drug.(CompanyName, TradeName) becomes ONE foreign key with ordered pairs', () => {
    const r = rig('rel', 1, strip);
    r.store.getState().setTool('fk');
    const a = cellCentre(r, 'Prescription', 'CompanyName');
    const b = cellCentre(r, 'Prescription', 'DrugTradeName');
    r.press(a);
    r.release(a);
    expect(toolUi.getState().fkPending?.columnIds).toHaveLength(1);
    r.press(b, { shiftKey: true });
    r.release(b, { shiftKey: true });
    expect(toolUi.getState().fkPending?.columnIds).toHaveLength(2);
    // drag from one of the selected cells onto the key cell TradeName
    r.drag(b, cellCentre(r, 'Drug', 'TradeName'));
    const pop = toolUi.getState().fkPopover!;
    expect(pop).not.toBeNull();
    expect(pop.source.columnIds).toHaveLength(2);
    const out = createForeignKey(r.store, r.diagramId, pop.source.relationId, pop.targetRelationId, pop.source.columnIds.map((s, i) => ({ sourceColumnId: s, targetColumnId: pop.targetColumnIds[i]! })));
    expect(out.ok).toBe(true);
    expect(Object.values(fks(r)).map((f) => names(r, f))).toEqual(['Prescription.(CompanyName,DrugTradeName)->Drug.(CompanyName,TradeName)']);
    expect(out.ok && out.text).toBe('Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)');
    // ONE logical edge with two branches ending on their own cells
    const cx = cxOf(r.env);
    const edges = Object.values(cx.scene.edges) as FkEdgeGeom[];
    expect(edges).toHaveLength(1);
    expect(edges[0]!.branches).toHaveLength(2);
    expect(r.undoDepth()).toBe(1);
  });

  it('refuses a non-key target cell and a key of another length: nothing is created, the reason is explained', () => {
    const r = rig('rel', 1, strip);
    r.store.getState().setTool('fk');
    r.drag(cellCentre(r, 'Patient', 'DoctorSSN'), cellCentre(r, 'Doctor', 'Name'));
    expect(toolUi.getState().fkPopover).toBeNull();
    expect(Object.keys(fks(r))).toHaveLength(0);
    expect(uiStore.getState().toasts.at(-1)?.message).toMatch(/Doctor\.Name/);
    r.drag(cellCentre(r, 'Patient', 'DoctorSSN'), cellCentre(r, 'Drug', 'TradeName'));
    expect(toolUi.getState().fkPopover).toBeNull();
    expect(uiStore.getState().toasts.at(-1)?.message).toMatch(/2 columns/);
  });

  it('highlights valid target cells while dragging and Escape cancels cleanly', () => {
    const r = rig('rel', 1, strip);
    r.store.getState().setTool('fk');
    const from = cellCentre(r, 'Patient', 'DoctorSSN');
    r.press(from);
    r.move({ x: from.x + 40, y: from.y + 40 });
    r.move(cellCentre(r, 'Doctor', 'SSN'));
    const f = toolUi.getState().fk!;
    expect(f.feedback?.tone).toBe('ok');
    expect(f.targetColumnIds).toHaveLength(1);
    r.cancel();
    expect(toolUi.getState().fk).toBeNull();
    expect(toolUi.getState().fkPopover).toBeNull();
    expect(Object.keys(fks(r))).toHaveLength(0);
  });

  it('self-reference is allowed: Doctor.Name -> Doctor.SSN (same table)', () => {
    const r = rig('rel', 1, strip);
    r.store.getState().setTool('fk');
    r.drag(cellCentre(r, 'Doctor', 'Specialty'), cellCentre(r, 'Doctor', 'SSN'));
    const pop = toolUi.getState().fkPopover;
    expect(pop).not.toBeNull();
    expect(pop!.targetRelationId).toBe(pop!.source.relationId);
  });
});
