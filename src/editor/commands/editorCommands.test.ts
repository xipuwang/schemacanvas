import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '@/model/ops';
import type { ErModel, Id, RelationalModel } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { editorStore } from '@/store';
import { clearClipboard } from '../clipboardStore';
import { loadGlobal, nodeNamed } from '../testFixtures';
import './index';
import { computePasteOffset } from './edit';
import { findCommandForEvent, getCommand, isCommandEnabled, runCommand, setCanvasHandle } from './registry';
import { matchesShortcut } from './shortcuts';

const st = () => editorStore.getState();
const proj = () => st().project;
const model = <T>(diagramId: Id) => proj().models[proj().diagrams[diagramId]!.modelId] as T;
const diag = (id: Id) => proj().diagrams[id]!;
const undoDepth = () => st().undoStack.length;
const select = (...ids: Id[]) => st().setSelection(ids);

let chen: Id;
let rel: Id;
beforeEach(() => {
  clearClipboard();
  const a = loadGlobal('chen');
  chen = a.diagramId;
  rel = a.setup.relId;
  setCanvasHandle(null);
});
afterEach(() => setCanvasHandle(null));

describe('registration', () => {
  it('registers every command of the spec with an i18n label key and a shortcut where specified', () => {
    const ids = [
      'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', 'edit.removeFromDiagram', 'edit.selectAll', 'edit.deselect',
      'view.zoomIn', 'view.zoomOut', 'view.zoomReset', 'view.fit', 'view.fitSelection', 'view.toggleGrid', 'view.toggleSnap',
      'arrange.alignLeft', 'arrange.alignCenter', 'arrange.alignRight', 'arrange.alignTop', 'arrange.alignMiddle', 'arrange.alignBottom',
      'arrange.distributeH', 'arrange.distributeV', 'arrange.matchWidth', 'arrange.matchHeight', 'arrange.bringToFront', 'arrange.sendToBack', 'arrange.lock', 'arrange.unlock',
      'layout.auto', 'layout.autoSelection', 'edge.resetRoute', 'tool.select', 'tool.hand',
    ];
    for (const id of ids) {
      const c = getCommand(id);
      expect(c, id).toBeDefined();
      expect(c!.labelKey).toBe(`commands.${id}`);
    }
  });
  it('shortcuts resolve to the right command', () => {
    const ev = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });
    const f = (e: ReturnType<typeof ev>) => findCommandForEvent(e, (a, s) => matchesShortcut(a, s, false))?.id;
    expect(f(ev('z', { ctrlKey: true }))).toBe('edit.undo');
    expect(f(ev('z', { ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
    expect(f(ev('y', { ctrlKey: true }))).toBe('edit.redo');
    expect(f(ev('Delete'))).toBe('edit.delete');
    expect(f(ev('Backspace'))).toBe('edit.delete');
    expect(f(ev('=', { ctrlKey: true }))).toBe('view.zoomIn');
    expect(f(ev('-', { ctrlKey: true }))).toBe('view.zoomOut');
    expect(f(ev('0', { ctrlKey: true }))).toBe('view.zoomReset');
    expect(f(ev('!', { shiftKey: true, code: 'Digit1' }))).toBe('view.fit');
    expect(f(ev('@', { shiftKey: true, code: 'Digit2' }))).toBe('view.fitSelection');
    expect(f(ev('a', { ctrlKey: true }))).toBe('edit.selectAll');
    expect(f(ev('d', { ctrlKey: true }))).toBe('edit.duplicate');
    expect(f(ev('v'))).toBe('tool.select');
    expect(f(ev('h'))).toBe('tool.hand');
  });
});

describe('undo / redo / selection commands', () => {
  it('undo and redo follow the store and are disabled when empty', async () => {
    expect(isCommandEnabled('edit.undo')).toBe(false);
    const id = nodeNamed(proj(), chen, 'Doctor');
    st().commit('move', (d) => void ops.moveNodesBy(d, chen, [id], 10, 0));
    expect(isCommandEnabled('edit.undo')).toBe(true);
    await runCommand('edit.undo');
    expect(isCommandEnabled('edit.redo')).toBe(true);
    await runCommand('edit.redo');
    expect(st().canRedo).toBe(false);
  });
  it('select all / deselect', async () => {
    await runCommand('edit.selectAll');
    expect(st().selection.ids.length).toBe(Object.keys(diag(chen).nodes).length);
    await runCommand('edit.deselect');
    expect(st().selection.ids).toEqual([]);
  });
});

describe('edit.delete is a SEMANTIC delete by selection kind', () => {
  it('entity node removes the entity (and its attributes) in one undo step', async () => {
    const id = nodeNamed(proj(), chen, 'Patient');
    select(id);
    const d0 = undoDepth();
    await runCommand('edit.delete');
    expect(undoDepth()).toBe(d0 + 1);
    expect(Object.values(model<ErModel>(chen).entities).some((e) => e.name === 'Patient')).toBe(false);
    expect(Object.values(model<ErModel>(chen).attributes).some((a) => a.name === 'SSN' && a.owner.kind === 'entity' && model<ErModel>(chen).entities[a.owner.id] === undefined)).toBe(false);
    expect(st().selection.ids).toEqual([]);
    st().undo();
    expect(Object.values(model<ErModel>(chen).entities).some((e) => e.name === 'Patient')).toBe(true);
  });
  it('attribute node, relationship node', async () => {
    select(nodeNamed(proj(), chen, 'Speciality'));
    await runCommand('edit.delete');
    expect(Object.values(model<ErModel>(chen).attributes).some((a) => a.name === 'Speciality')).toBe(false);
    select(nodeNamed(proj(), chen, 'Sell'));
    await runCommand('edit.delete');
    expect(Object.values(model<ErModel>(chen).relationships).some((r) => r.name === 'Sell')).toBe(false);
  });
  it('a participation line removes ONLY the participant; an attribute link removes the attribute', async () => {
    const d = diag(chen);
    const [edgeId, edge] = Object.entries(d.edges).find(([, e]) => e.ref.kind === 'participant')!;
    const ref = edge.ref as Extract<typeof edge.ref, { kind: 'participant' }>;
    const entityCountBefore = Object.keys(model<ErModel>(chen).entities).length;
    const partsBefore = model<ErModel>(chen).relationships[ref.relationshipId]!.participants.length;
    select(edgeId);
    await runCommand('edit.delete');
    expect(model<ErModel>(chen).relationships[ref.relationshipId]!.participants.length).toBe(partsBefore - 1);
    expect(Object.keys(model<ErModel>(chen).entities).length).toBe(entityCountBefore);

    const [linkId, link] = Object.entries(diag(chen).edges).find(([, e]) => e.ref.kind === 'attribute')!;
    const attrId = (link.ref as { attributeId: Id }).attributeId;
    select(linkId);
    await runCommand('edit.delete');
    expect(model<ErModel>(chen).attributes[attrId]).toBeUndefined();
  });
  it('relational: FK edge removes the FK only; table removes the table and its FKs; column sub-selection removes the column', async () => {
    st().setActiveDiagram(rel);
    const m0 = model<RelationalModel>(rel);
    const fkCount = Object.keys(m0.foreignKeys).length;
    const [edgeId, edge] = Object.entries(diag(rel).edges)[0]!;
    const fkId = (edge.ref as { foreignKeyId: Id }).foreignKeyId;
    select(edgeId);
    await runCommand('edit.delete');
    expect(Object.keys(model<RelationalModel>(rel).foreignKeys).length).toBe(fkCount - 1);
    expect(model<RelationalModel>(rel).foreignKeys[fkId]).toBeUndefined();
    expect(Object.keys(model<RelationalModel>(rel).relations).length).toBe(Object.keys(m0.relations).length);

    const sell = nodeNamed(proj(), rel, 'Sell');
    const sellRel = Object.values(model<RelationalModel>(rel).relations).find((r) => r.name === 'Sell')!;
    const price = sellRel.columns.find((c) => c.name === 'Price')!;
    st().setSelection([sell], { kind: 'column', relationId: sellRel.id, id: price.id });
    await runCommand('edit.delete');
    const sellAfter = Object.values(model<RelationalModel>(rel).relations).find((r) => r.name === 'Sell')!;
    expect(sellAfter.columns.some((c) => c.id === price.id)).toBe(false);
    expect(sellAfter.columns.length).toBe(sellRel.columns.length - 1);

    select(nodeNamed(proj(), rel, 'Drug'));
    await runCommand('edit.delete');
    const m = model<RelationalModel>(rel);
    expect(Object.values(m.relations).some((r) => r.name === 'Drug')).toBe(false);
    expect(Object.values(m.foreignKeys).every((fk) => m.relations[fk.sourceRelationId] && m.relations[fk.targetRelationId])).toBe(true);
  });
  it('deleting an entity together with its own attribute node does not throw (cascade-aware)', async () => {
    const p = proj();
    select(nodeNamed(p, chen, 'Doctor'), nodeNamed(p, chen, 'Name'));
    const d0 = undoDepth();
    await runCommand('edit.delete');
    expect(undoDepth()).toBe(d0 + 1);
  });
  it('is disabled with an empty selection', () => {
    expect(isCommandEnabled('edit.delete')).toBe(false);
  });
  it('remove from diagram keeps the semantics', async () => {
    const id = nodeNamed(proj(), chen, 'Patient');
    select(id);
    await runCommand('edit.removeFromDiagram');
    expect(diag(chen).nodes[id]).toBeUndefined();
    expect(diag(chen).partial).toBe(true);
    expect(Object.values(model<ErModel>(chen).entities).some((e) => e.name === 'Patient')).toBe(true);
  });
});

describe('clipboard commands', () => {
  it('copy then paste creates a copy offset from the original and selects it', async () => {
    const id = nodeNamed(proj(), chen, 'Company');
    const before = Object.keys(diag(chen).nodes).length;
    select(id);
    await runCommand('edit.copy');
    await runCommand('edit.paste');
    const after = Object.keys(diag(chen).nodes).length;
    expect(after).toBeGreaterThan(before);
    const sel = st().selection.ids;
    expect(sel.length).toBeGreaterThan(0);
    const pasted = diag(chen).nodes[sel[0]!]!;
    const orig = diag(chen).nodes[id]!;
    expect(pasted.x).toBeGreaterThan(orig.x);
    expect(pasted.y).toBeGreaterThan(orig.y);
    expect(Object.values(model<ErModel>(chen).entities).filter((e) => e.name.startsWith('Company')).length).toBe(2);
  });
  it('repeated pastes land at growing offsets (never stacked exactly)', async () => {
    select(nodeNamed(proj(), chen, 'Company'));
    await runCommand('edit.copy');
    const pos: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 3; i++) {
      await runCommand('edit.paste');
      const n = diag(chen).nodes[st().selection.ids[0]!]!;
      pos.push({ x: n.x, y: n.y });
    }
    expect(new Set(pos.map((p) => `${p.x},${p.y}`)).size).toBe(3);
    expect(pos[1]!.x).toBeGreaterThan(pos[0]!.x);
    expect(pos[2]!.x).toBeGreaterThan(pos[1]!.x);
  });
  it('duplicate is one undo step and selects the copies; cut removes after copying; paste into the wrong diagram kind reports an error toast', async () => {
    select(nodeNamed(proj(), chen, 'Drug'));
    const d0 = undoDepth();
    await runCommand('edit.duplicate');
    expect(undoDepth()).toBe(d0 + 1);
    expect(st().selection.ids.length).toBeGreaterThan(0);

    select(nodeNamed(proj(), chen, 'Pharmacy'));
    await runCommand('edit.cut');
    expect(Object.values(model<ErModel>(chen).entities).some((e) => e.name === 'Pharmacy')).toBe(false);
    await runCommand('edit.paste');
    expect(Object.values(model<ErModel>(chen).entities).some((e) => e.name.startsWith('Pharmacy'))).toBe(true);

    st().setActiveDiagram(rel);
    const toasts = (await import('@/ui/uiStore')).uiStore;
    toasts.setState({ toasts: [] }); // earlier deletes in this file leave their "deleted ... with it" toasts (UX-11) and the stack is capped
    const nBefore = toasts.getState().toasts.length;
    await runCommand('edit.paste');
    expect(toasts.getState().toasts.length).toBe(nBefore + 1);
  });
  it('computePasteOffset: grows with the paste count; off-screen sources land at the visible centre', () => {
    const b = { x: 0, y: 0, w: 100, h: 50 };
    const a = computePasteOffset(b, 0, 20, { x: -500, y: -500, w: 2000, h: 2000 });
    const c = computePasteOffset(b, 2, 20, { x: -500, y: -500, w: 2000, h: 2000 });
    expect(a).toEqual({ x: 40, y: 40 });
    expect(c).toEqual({ x: 120, y: 120 });
    const off = computePasteOffset(b, 0, 20, { x: 5000, y: 5000, w: 1000, h: 600 });
    expect(Math.abs(5500 - (50 + off.x))).toBeLessThanOrEqual(10);
    expect(Math.abs(5300 - (25 + off.y))).toBeLessThanOrEqual(10);
  });
});

describe('arrange commands', () => {
  const three = () => ['Doctor', 'Patient', 'Drug'].map((n) => nodeNamed(proj(), chen, n));
  const boundsOf = (id: Id) => buildScene(proj(), chen).nodes[id]!.bounds;
  it('is disabled below the minimum count and enabled otherwise', () => {
    const [a, b, c] = three();
    select(a!);
    expect(isCommandEnabled('arrange.alignLeft')).toBe(false);
    select(a!, b!);
    expect(isCommandEnabled('arrange.alignLeft')).toBe(true);
    expect(isCommandEnabled('arrange.distributeH')).toBe(false);
    select(a!, b!, c!);
    expect(isCommandEnabled('arrange.distributeH')).toBe(true);
  });
  it('aligns left / top / centre in one undo step', async () => {
    const ids = three();
    select(...ids);
    const d0 = undoDepth();
    await runCommand('arrange.alignLeft');
    expect(undoDepth()).toBe(d0 + 1);
    const xs = ids.map((i) => boundsOf(i).x);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(1);
    await runCommand('arrange.alignTop');
    expect(new Set(ids.map((i) => Math.round(boundsOf(i).y))).size).toBe(1);
    await runCommand('arrange.alignCenter');
    expect(new Set(ids.map((i) => Math.round(boundsOf(i).x + boundsOf(i).w / 2))).size).toBe(1);
  });
  it('distributes evenly', async () => {
    const ids = three();
    select(...ids);
    await runCommand('arrange.alignTop');
    await runCommand('arrange.distributeH');
    const rects = ids.map(boundsOf).sort((a, b) => a.x - b.x);
    const g1 = rects[1]!.x - (rects[0]!.x + rects[0]!.w);
    const g2 = rects[2]!.x - (rects[1]!.x + rects[1]!.w);
    expect(Math.abs(g1 - g2)).toBeLessThan(0.5);
  });
  it('locked nodes never move; lock/unlock toggle enablement', async () => {
    const [a, b] = three();
    const xa = diag(chen).nodes[a!]!.x;
    select(a!);
    await runCommand('arrange.lock');
    expect(diag(chen).nodes[a!]!.locked).toBe(true);
    expect(isCommandEnabled('arrange.lock')).toBe(false);
    expect(isCommandEnabled('arrange.unlock')).toBe(true);
    select(a!, b!);
    expect(isCommandEnabled('arrange.alignLeft')).toBe(false); // only one unlocked node
    await runCommand('arrange.alignLeft');
    expect(diag(chen).nodes[a!]!.x).toBe(xa);
    select(a!);
    await runCommand('arrange.unlock');
    expect(diag(chen).nodes[a!]!.locked).toBeUndefined();
  });
  it('match width on relational tables sets a common row width', async () => {
    const ids = ['Doctor', 'Drug', 'Sell'].map((n) => nodeNamed(proj(), rel, n));
    st().setActiveDiagram(rel);
    select(...ids);
    await runCommand('arrange.matchWidth');
    const sc = buildScene(proj(), rel);
    const widths = ids.map((i) => Math.round((sc.nodes[i] as { row: { w: number } }).row.w));
    expect(new Set(widths).size).toBe(1);
  });
  it('bring to front / send to back change paint order', async () => {
    const [a] = three();
    select(a!);
    await runCommand('arrange.bringToFront');
    expect(buildScene(proj(), chen).nodeOrder.at(-1)).toBe(a);
    await runCommand('arrange.sendToBack');
    expect(buildScene(proj(), chen).nodeOrder[0]).toBe(a);
  });
});

describe('view / tool / layout commands', () => {
  it('grid and snap toggles go through setDiagramOptions and report checked state', async () => {
    const vis = diag(chen).options.grid.visible;
    expect(getCommand('view.toggleGrid')!.isChecked!({ store: editorStore, canvas: null })).toBe(vis);
    await runCommand('view.toggleGrid');
    expect(diag(chen).options.grid.visible).toBe(!vis);
    const snap = diag(chen).options.grid.snap;
    await runCommand('view.toggleSnap');
    expect(diag(chen).options.grid.snap).toBe(!snap);
    st().undo();
    expect(diag(chen).options.grid.snap).toBe(snap);
  });
  it('zoom / fit commands call the canvas handle and are disabled without one', async () => {
    expect(isCommandEnabled('view.zoomIn')).toBe(false);
    const calls: string[] = [];
    setCanvasHandle({
      zoomBy: (f: number) => calls.push(`by${f.toFixed(2)}`),
      zoomTo: (z: number) => calls.push(`to${z}`),
      fitToContent: () => calls.push('fit'),
      fitToNodes: (ids: readonly Id[]) => calls.push(`fitN${ids.length}`),
    } as never);
    await runCommand('view.zoomIn');
    await runCommand('view.zoomOut');
    await runCommand('view.zoomReset');
    await runCommand('view.fit');
    expect(isCommandEnabled('view.fitSelection')).toBe(false);
    select(nodeNamed(proj(), chen, 'Doctor'));
    await runCommand('view.fitSelection');
    expect(calls).toEqual(['by1.25', 'by0.80', 'to1', 'fit', 'fitN1']);
  });
  it('tool commands set and report the active tool', async () => {
    await runCommand('tool.hand');
    expect(st().tool).toBe('hand');
    expect(getCommand('tool.hand')!.isChecked!({ store: editorStore, canvas: null })).toBe(true);
    await runCommand('tool.select');
    expect(st().tool).toBe('select');
  });
  it('edge.resetRoute resets a manual route', async () => {
    const [edgeId] = Object.entries(diag(rel).edges)[0]!;
    st().setActiveDiagram(rel);
    st().commit('manual', (d) => ops.setEdgeRoute(d, rel, edgeId, { mode: 'manual', waypoints: [{ x: 300, y: 300 }] }));
    expect(diag(rel).edges[edgeId]!.route.mode).toBe('manual');
    expect(isCommandEnabled('edge.resetRoute')).toBe(false);
    select(edgeId);
    await runCommand('edge.resetRoute');
    expect(diag(rel).edges[edgeId]!.route.mode).toBe('auto');
  });
  it('layout.auto moves nodes in ONE commit; layout.autoSelection only touches the selection', async () => {
    st().setActiveDiagram(rel);
    const before = JSON.stringify(Object.values(diag(rel).nodes).map((n) => [n.x, n.y]));
    const d0 = undoDepth();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runCommand('layout.auto');
    expect(undoDepth()).toBe(d0 + 1);
    expect(JSON.stringify(Object.values(diag(rel).nodes).map((n) => [n.x, n.y]))).not.toBe(before);
    const target = nodeNamed(proj(), rel, 'Sell');
    const others = Object.fromEntries(Object.entries(diag(rel).nodes).filter(([id]) => id !== target).map(([id, n]) => [id, [n.x, n.y]]));
    select(target);
    expect(isCommandEnabled('layout.autoSelection')).toBe(true);
    await runCommand('layout.autoSelection');
    for (const [id, p] of Object.entries(others)) expect([diag(rel).nodes[id]!.x, diag(rel).nodes[id]!.y]).toEqual(p);
  }, 30_000);
});
