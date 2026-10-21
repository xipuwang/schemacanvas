import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { sampleProject } from '@/model/io/testFixtures';
import type { Project } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import { createEditorStore, type EditorStore } from './editorStore';
import { selectActiveDiagram, selectActiveModel } from './selectors';

let restoreIds: () => void;
let restoreClock: () => void = () => undefined;
beforeEach(() => {
  restoreIds = useDeterministicIds();
});
afterEach(() => {
  restoreIds();
  restoreClock();
  restoreClock = () => undefined;
});

const T0 = '2026-01-01T00:00:00.000Z';
function setup(opts: { historyLimit?: number } = {}): { store: EditorStore; project: Project } {
  restoreClock();
  restoreClock = useFixedClock(T0);
  const project = sampleProject();
  const store = createEditorStore({ project, ...opts });
  return { store, project: store.getState().project };
}
const tick = (iso: string): void => {
  restoreClock();
  restoreClock = useFixedClock(iso);
};
const firstDiagramId = (p: Project) => p.diagramOrder[0]!;
const renameProject = (store: EditorStore, name: string) => store.getState().commit(`rename ${name}`, (d) => void (d.name = name));

describe('commit / undo / redo', () => {
  it('applies, undoes and redoes a recipe', () => {
    const { store, project } = setup();
    renameProject(store, 'A');
    expect(store.getState().project.name).toBe('A');
    expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false, dirty: true });
    store.getState().undo();
    expect(store.getState().project).toEqual(project);
    expect(store.getState()).toMatchObject({ canUndo: false, canRedo: true });
    store.getState().redo();
    expect(store.getState().project.name).toBe('A');
    expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('returns the recipe value (while the recipe itself returns undefined to immer)', () => {
    const { store } = setup();
    const r = store.getState().commit('x', (d) => {
      d.name = 'B';
      return { created: ['a', 'b'], n: 2 };
    });
    expect(r).toEqual({ created: ['a', 'b'], n: 2 });
    expect(store.getState().commit('noop', () => 42)).toBe(42);
  });

  it('a recipe that changes nothing creates no history entry and no notification', () => {
    const { store } = setup();
    const spy = vi.fn();
    store.subscribe(spy);
    tick('2030-01-01T00:00:00.000Z'); // the timestamp alone must not count as a change
    store.getState().commit('noop', () => undefined);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project.updatedAt).toBe(T0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a throwing recipe leaves state untouched and rethrows', () => {
    const { store, project } = setup();
    expect(() =>
      store.getState().commit('bad', (d) => {
        d.name = 'half';
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.getState().project).toBe(project);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it('a new commit invalidates the redo stack', () => {
    const { store } = setup();
    renameProject(store, 'A');
    renameProject(store, 'B');
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);
    renameProject(store, 'C');
    expect(store.getState()).toMatchObject({ canRedo: false });
    expect(store.getState().redoStack).toHaveLength(0);
    store.getState().redo(); // no-op
    expect(store.getState().project.name).toBe('C');
  });

  it('sets updatedAt inside the recipe so undo restores it and redo reapplies it', () => {
    const { store } = setup();
    tick('2026-05-05T10:00:00.000Z');
    renameProject(store, 'A');
    expect(store.getState().project.updatedAt).toBe('2026-05-05T10:00:00.000Z');
    store.getState().undo();
    expect(store.getState().project.updatedAt).toBe(T0);
    store.getState().redo();
    expect(store.getState().project.updatedAt).toBe('2026-05-05T10:00:00.000Z');
  });

  it('notifies subscribers exactly once per commit, undo and redo', () => {
    const { store } = setup();
    const spy = vi.fn();
    store.subscribe(spy);
    store.getState().commit('multi', (d) => {
      d.name = 'x';
      d.description = 'y';
      d.settings.defaultDialect = 'sqlite';
    });
    expect(spy).toHaveBeenCalledTimes(1);
    store.getState().undo();
    expect(spy).toHaveBeenCalledTimes(2);
    store.getState().redo();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('keeps state deeply frozen and never mutates a previous snapshot', () => {
    const { store } = setup();
    const before = store.getState().project;
    const snapshot = JSON.stringify(before);
    renameProject(store, 'A');
    const after = store.getState().project;
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.diagrams)).toBe(true);
    expect(Object.isFrozen(Object.values(after.models)[0])).toBe(true);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(() => {
      (after as { name: string }).name = 'mutate';
    }).toThrow();
    // structural sharing: untouched subtrees keep identity
    expect(after.models).toBe(before.models);
    expect(after.diagrams).toBe(before.diagrams);
  });

  it('history survives frozen fixtures (loadProject freezes the input)', () => {
    const store = createEditorStore({ project: deepFreeze(sampleProject()) });
    renameProject(store, 'Q');
    expect(store.getState().project.name).toBe('Q');
  });

  it('caps history at the limit (default 200) dropping the oldest', () => {
    const { store } = setup({ historyLimit: 3 });
    for (const n of ['1', '2', '3', '4', '5']) renameProject(store, n);
    expect(store.getState().undoStack.map((e) => e.label)).toEqual(['rename 3', 'rename 4', 'rename 5']);
    store.getState().undo();
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().project.name).toBe('2');
    expect(store.getState().canUndo).toBe(false);

    const def = setup().store;
    for (let i = 0; i < 230; i++) renameProject(def, `n${i}`);
    expect(def.getState().undoStack).toHaveLength(200);
  });

  it('handles deletes and creations of whole subtrees through undo/redo', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const nodeId = Object.keys(project.diagrams[dgm]!.nodes)[0]!;
    store.getState().commit('del node', (d) => void delete d.diagrams[dgm]!.nodes[nodeId]);
    expect(store.getState().project.diagrams[dgm]!.nodes[nodeId]).toBeUndefined();
    store.getState().undo();
    expect(store.getState().project).toEqual(project);
  });
});

describe('selection', () => {
  it('restores selectionBefore on undo and selectionAfter on redo, filtered to existing ids', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const [n1, n2] = Object.keys(project.diagrams[dgm]!.nodes) as [string, string];
    store.getState().setSelection([n1]);
    store.getState().commit('delete n1, select n2', (d) => void delete d.diagrams[dgm]!.nodes[n1], { select: [n2] });
    expect(store.getState().selection.ids).toEqual([n2]);
    store.getState().undo();
    expect(store.getState().selection.ids).toEqual([n1]); // n1 is back
    store.getState().redo();
    expect(store.getState().selection.ids).toEqual([n2]);
  });

  it('drops ids that do not exist after undo', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const n1 = Object.keys(project.diagrams[dgm]!.nodes)[0]!;
    // create a node, select it, commit something else, then undo the creation chain
    store.getState().commit('add', (d) => {
      const src = d.diagrams[dgm]!.nodes[n1]!;
      d.diagrams[dgm]!.nodes['nod_new'] = { ...src, id: 'nod_new' };
    }, { select: ['nod_new'] });
    store.getState().commit('rename', (d) => void (d.name = 'z'));
    expect(store.getState().selection.ids).toEqual(['nod_new']);
    store.getState().undo(); // rename: selectionBefore = ['nod_new'] still exists
    expect(store.getState().selection.ids).toEqual(['nod_new']);
    store.getState().undo(); // add: selectionBefore = [] 
    expect(store.getState().selection.ids).toEqual([]);
    store.getState().setSelection(['nod_new', 'ghost']);
    store.getState().redo(); // selectionAfter ['nod_new'] exists again
    expect(store.getState().selection.ids).toEqual(['nod_new']);
  });

  it('prunes selected ids a delete commit removed', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const [n1, n2] = Object.keys(project.diagrams[dgm]!.nodes) as [string, string];
    store.getState().setSelection([n1, n2]);
    store.getState().commit('del', (d) => void delete d.diagrams[dgm]!.nodes[n1]);
    expect(store.getState().selection.ids).toEqual([n2]);
  });

  it('selection helpers', () => {
    const { store } = setup();
    const s = store.getState();
    s.setSelection(['a', 'a', 'b']);
    expect(store.getState().selection.ids).toEqual(['a', 'b']);
    store.getState().addToSelection(['b', 'c']);
    expect(store.getState().selection.ids).toEqual(['a', 'b', 'c']);
    store.getState().toggleSelection('b');
    store.getState().toggleSelection('z');
    expect(store.getState().selection.ids).toEqual(['a', 'c', 'z']);
    store.getState().setSubSelection({ kind: 'column', relationId: 'r', id: 'c1' });
    expect(store.getState().selection.sub).toEqual({ kind: 'column', relationId: 'r', id: 'c1' });
    store.getState().setSubSelection(undefined);
    expect(store.getState().selection.sub).toBeUndefined();
    store.getState().clearSelection();
    expect(store.getState().selection.ids).toEqual([]);
    expect(store.getState().undoStack).toHaveLength(0); // selection never enters history
  });
});

describe('transactions', () => {
  it('previews live and merges into ONE history entry', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const nodeId = Object.keys(project.diagrams[dgm]!.nodes)[0]!;
    const x0 = project.diagrams[dgm]!.nodes[nodeId]!.x;
    const spy = vi.fn();
    store.getState().beginTransaction('Move');
    store.subscribe(spy);
    for (let i = 1; i <= 5; i++) {
      store.getState().updateTransaction((d) => void (d.diagrams[dgm]!.nodes[nodeId]!.x = x0 + i * 10));
      expect(store.getState().project.diagrams[dgm]!.nodes[nodeId]!.x).toBe(x0 + i * 10);
    }
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().inTransaction).toBe(true);
    store.getState().endTransaction();
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().undoStack[0]!.label).toBe('Move');
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().project.diagrams[dgm]!.nodes[nodeId]!.x).toBe(x0 + 50);
    store.getState().undo();
    expect(store.getState().project).toEqual(project);
    store.getState().redo();
    expect(store.getState().project.diagrams[dgm]!.nodes[nodeId]!.x).toBe(x0 + 50);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('merges updates that touch different things and undoes them in the right order', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const nodeId = Object.keys(project.diagrams[dgm]!.nodes)[0]!;
    store.getState().beginTransaction('Mixed');
    store.getState().updateTransaction((d) => void (d.name = 'first'));
    store.getState().updateTransaction((d) => void (d.name = 'second'));
    store.getState().updateTransaction((d) => void delete d.diagrams[dgm]!.nodes[nodeId]);
    store.getState().endTransaction();
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project).toEqual(project);
    store.getState().redo();
    expect(store.getState().project.name).toBe('second');
    expect(store.getState().project.diagrams[dgm]!.nodes[nodeId]).toBeUndefined();
  });

  it('cancel restores the exact pre-transaction project and records nothing', () => {
    const { store, project } = setup();
    renameProject(store, 'keep');
    const before = store.getState().project;
    tick('2027-01-01T00:00:00.000Z');
    store.getState().beginTransaction('Drag');
    store.getState().updateTransaction((d) => void (d.name = 'dragged'));
    store.getState().updateTransaction((d) => void (d.description = 'also'));
    expect(store.getState().project.name).toBe('dragged');
    store.getState().cancelTransaction();
    expect(store.getState().project).toEqual(before);
    expect(store.getState().project.updatedAt).toBe(before.updatedAt);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().inTransaction).toBe(false);
    expect(project.name).not.toBe('keep');
  });

  it('cancel / end on an empty transaction are harmless; cancel with none open is a no-op', () => {
    const { store, project } = setup();
    store.getState().cancelTransaction();
    store.getState().beginTransaction('empty');
    store.getState().endTransaction();
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(project);
    store.getState().beginTransaction('ts only');
    tick('2028-01-01T00:00:00.000Z');
    store.getState().updateTransaction(() => undefined);
    store.getState().endTransaction();
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project.updatedAt).toBe(T0);
  });

  it('nested begin throws without disturbing the open transaction', () => {
    const { store } = setup();
    store.getState().beginTransaction('outer');
    expect(() => store.getState().beginTransaction('inner')).toThrow(/already open/);
    store.getState().updateTransaction((d) => void (d.name = 'still works'));
    store.getState().endTransaction();
    expect(store.getState().undoStack.map((e) => e.label)).toEqual(['outer']);
  });

  it('update/end without begin throw; commit and replaceProject during a transaction throw; undo is ignored', () => {
    const { store } = setup();
    expect(() => store.getState().updateTransaction(() => undefined)).toThrow(/no open transaction/);
    expect(() => store.getState().endTransaction()).toThrow(/no open transaction/);
    renameProject(store, 'A');
    store.getState().beginTransaction('t');
    expect(() => renameProject(store, 'B')).toThrow(/transaction/);
    expect(() => store.getState().replaceProject(sampleProject())).toThrow(/transaction/);
    store.getState().undo();
    expect(store.getState().project.name).toBe('A');
    store.getState().cancelTransaction();
  });

  it('a transaction clears the redo stack when it ends with changes', () => {
    const { store } = setup();
    renameProject(store, 'A');
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);
    store.getState().beginTransaction('t');
    store.getState().updateTransaction((d) => void (d.name = 'T'));
    expect(store.getState().canRedo).toBe(true); // still redoable until the transaction is committed
    store.getState().endTransaction();
    expect(store.getState().canRedo).toBe(false);
  });

  it('keeps viewport writes made during a transaction when it is cancelled', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    store.getState().beginTransaction('drag');
    store.getState().updateTransaction((d) => void (d.name = 'x'));
    store.getState().setViewState(dgm, { x: 5, y: 6, zoom: 2 });
    store.getState().cancelTransaction();
    expect(store.getState().project.name).toBe(project.name);
    expect(store.getState().project.diagrams[dgm]!.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
  });
});

describe('setViewState', () => {
  it('writes the viewport without history, dirty flag or updatedAt change, but replaces project (autosave trigger)', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    const spy = vi.fn();
    store.subscribe(spy);
    tick('2029-01-01T00:00:00.000Z');
    store.getState().setViewState(dgm, { x: 10, y: 20, zoom: 1.5 });
    const s = store.getState();
    expect(s.project.diagrams[dgm]!.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(s.project).not.toBe(project);
    expect(s.project.updatedAt).toBe(T0);
    expect(s.undoStack).toHaveLength(0);
    expect(s.canUndo).toBe(false);
    expect(s.dirty).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    store.getState().setViewState(dgm, { x: 10, y: 20, zoom: 1.5 }); // identical: ignored
    expect(spy).toHaveBeenCalledTimes(1);
    store.getState().setViewState('missing', { x: 0, y: 0, zoom: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not disturb undo of earlier edits', () => {
    const { store, project } = setup();
    const dgm = firstDiagramId(project);
    renameProject(store, 'A');
    store.getState().setViewState(dgm, { x: 1, y: 2, zoom: 1 });
    store.getState().undo();
    expect(store.getState().project.name).toBe(project.name);
    expect(store.getState().project.diagrams[dgm]!.viewport).toEqual({ x: 1, y: 2, zoom: 1 });
  });
});

describe('project lifecycle', () => {
  it('loadProject clears history, selection and dirty, picks the first diagram, and freezes the input', () => {
    const { store } = setup();
    renameProject(store, 'A');
    store.getState().setSelection(['x']);
    const fresh = sampleProject('Other');
    store.getState().loadProject(fresh);
    const s = store.getState();
    expect(s).toMatchObject({ canUndo: false, canRedo: false, dirty: false });
    expect(s.undoStack).toHaveLength(0);
    expect(s.selection.ids).toEqual([]);
    expect(s.activeDiagramId).toBe(fresh.diagramOrder[0]);
    expect(s.project.name).toBe('Other');
    expect(Object.isFrozen(s.project)).toBe(true);
  });

  it('loadProject drops an open transaction', () => {
    const { store } = setup();
    store.getState().beginTransaction('t');
    store.getState().loadProject(sampleProject('B'));
    expect(store.getState().inTransaction).toBe(false);
    expect(() => store.getState().beginTransaction('again')).not.toThrow();
  });

  it('newProject creates an empty project with one Chen diagram', () => {
    const { store } = setup();
    store.getState().newProject('Fresh');
    const s = store.getState();
    expect(s.project.name).toBe('Fresh');
    expect(Object.keys(s.project.diagrams)).toHaveLength(1);
    expect(selectActiveDiagram(s)?.type).toBe('chen');
    expect(selectActiveModel(s)?.kind).toBe('er');
  });

  it('replaceProject is ONE undoable step, including a root replace patch', () => {
    const { store, project } = setup();
    const other = sampleProject('Imported');
    store.getState().replaceProject(other, 'Import');
    expect(store.getState().project.name).toBe('Imported');
    expect(store.getState().undoStack.map((e) => e.label)).toEqual(['Import']);
    expect(store.getState().activeDiagramId).toBe(other.diagramOrder[0]);
    store.getState().undo();
    expect(store.getState().project).toBe(project);
    expect(store.getState().activeDiagramId).toBe(project.diagramOrder[0]);
    store.getState().redo();
    expect(store.getState().project.name).toBe('Imported');
  });

  it('setActiveDiagram switches (clearing selection) and ignores unknown ids; undo of diagram deletion reconciles', () => {
    const { store, project } = setup();
    const [d1, d2] = project.diagramOrder as [string, string];
    store.getState().setSelection(['n']);
    store.getState().setActiveDiagram(d2);
    expect(store.getState().activeDiagramId).toBe(d2);
    expect(store.getState().selection.ids).toEqual([]);
    store.getState().setActiveDiagram('nope');
    expect(store.getState().activeDiagramId).toBe(d2);
    store.getState().commit('del dgm', (d) => {
      delete d.diagrams[d2];
      d.diagramOrder = d.diagramOrder.filter((x) => x !== d2);
    });
    expect(store.getState().activeDiagramId).toBe(d1);
    store.getState().undo();
    expect(store.getState().project.diagrams[d2]).toBeDefined();
  });

  it('markSaved clears dirty only for the version that was saved', () => {
    const { store } = setup();
    renameProject(store, 'A');
    const saved = store.getState().project;
    renameProject(store, 'B');
    store.getState().markSaved('2026-06-06T00:00:00.000Z', saved);
    expect(store.getState()).toMatchObject({ dirty: true, lastSavedAt: '2026-06-06T00:00:00.000Z' });
    store.getState().markSaved('2026-06-07T00:00:00.000Z', store.getState().project);
    expect(store.getState().dirty).toBe(false);
  });
});

describe('selectors', () => {
  it('derive the active diagram and its model', () => {
    const { store, project } = setup();
    store.getState().setActiveDiagram(project.diagramOrder[1]!);
    const s = store.getState();
    expect(selectActiveDiagram(s)?.type).toBe('relational-schema');
    expect(selectActiveModel(s)?.kind).toBe('relational');
  });
});
