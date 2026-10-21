/**
 * The editor store (ARCHITECTURE 5b). Zustand + immer patches:
 *  - the Project in state is DEEPLY FROZEN (immer auto-freeze; `loadProject` freezes explicitly) — consumers and pure
 *    modules may rely on it, and the store itself never mutates it in place;
 *  - every semantic edit is `commit(label, recipe)`; a drag is `begin/update/endTransaction` (one merged history entry);
 *  - viewport writes (`setViewState`) bypass history but still replace `project`, so autosave sees them;
 *  - selection and tool are UI state: never in history, never persisted.
 */
import { applyPatches, enablePatches, freeze, produce, produceWithPatches, type Draft, type Patch } from 'immer';
import { createStore, useStore, type StoreApi } from 'zustand';
import { nowIso } from '@/model/clock';
import { createProject } from '@/model/defaults';
import type { Id, Project, SemanticRef, Viewport } from '@/model/types';
import { DEFAULT_HISTORY_LIMIT, filterExisting, isOnlyTimestamp, type HistoryEntry } from './history';

enablePatches();

/** Extensible: the editor adds its own creation/connect tools; unknown strings are allowed. */
export type Tool = 'select' | 'hand' | (string & {});

export interface Selection {
  ids: Id[];
  sub?: SemanticRef;
}

export const EMPTY_SELECTION: Selection = Object.freeze({ ids: Object.freeze([]) as unknown as Id[] });

export interface EditorState {
  project: Project;
  activeDiagramId: Id | null;
  selection: Selection;
  tool: Tool;
  /** Changes since the last successful persistence (autosave or explicit save) — see `markSaved`. */
  dirty: boolean;
  lastSavedAt: string | null;
  undoStack: readonly HistoryEntry[];
  redoStack: readonly HistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  /** A begin/endTransaction pair is open (a drag is in progress). */
  inTransaction: boolean;
}

export interface EditorActions {
  /** Run `fn` on an immer draft as ONE undoable step; returns whatever `fn` returns. Throws inside a transaction. */
  commit<T>(label: string, fn: (draft: Project) => T, opts?: { select?: Id[] }): T;
  beginTransaction(label: string): void;
  updateTransaction(fn: (draft: Project) => void): void;
  endTransaction(): void;
  cancelTransaction(): void;
  setViewState(diagramId: Id, viewport: Viewport): void;
  undo(): void;
  redo(): void;
  clearHistory(): void;

  setActiveDiagram(id: Id): void;
  setTool(tool: Tool): void;
  setSelection(ids: readonly Id[], sub?: SemanticRef): void;
  addToSelection(ids: readonly Id[]): void;
  toggleSelection(id: Id): void;
  setSubSelection(sub: SemanticRef | undefined): void;
  clearSelection(): void;

  newProject(name?: string): void;
  /** Replace the document and clear history (open file / restore autosave). Freezes `project` in place. */
  loadProject(project: Project): void;
  /** Replace the document as ONE undoable step (import / merge flows). */
  replaceProject(project: Project, label?: string): void;
  /** Record that the current project reference was persisted. */
  markSaved(savedAt?: string, project?: Project): void;
}

export type EditorStoreState = EditorState & EditorActions;
export type EditorStore = StoreApi<EditorStoreState>;

export interface EditorStoreOptions {
  project?: Project;
  historyLimit?: number;
}

interface Transaction {
  label: string;
  selectionBefore: Id[];
  patchChunks: Patch[][];
  /** Newest first: the inverse of [a, b] is inverse(b) then inverse(a). */
  inverseChunks: Patch[][];
}

const unique = (ids: readonly Id[]): Id[] => [...new Set(ids)];

function firstDiagram(project: Project): Id | null {
  return project.diagramOrder.find((id) => Object.hasOwn(project.diagrams, id)) ?? Object.keys(project.diagrams)[0] ?? null;
}

function reconcileActive(active: Id | null, project: Project): Id | null {
  return active && Object.hasOwn(project.diagrams, active) ? active : firstDiagram(project);
}

export function createEditorStore(options: EditorStoreOptions = {}): EditorStore {
  const limit = Math.max(1, options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  const initial = freeze(options.project ?? createProject(), true);
  let txn: Transaction | null = null;

  const pushHistory = (stack: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => {
    const next = [...stack, entry];
    return next.length > limit ? next.slice(next.length - limit) : next;
  };

  return createStore<EditorStoreState>()((set, get) => {
    const assertNoTxn = (what: string): void => {
      if (txn) throw new Error(`${what} is not allowed while a transaction ("${txn.label}") is open`);
    };

    const selectionAfterChange = (project: Project, patches: readonly Patch[], explicit: Id[] | undefined): Selection => {
      const current = get().selection;
      if (explicit) return { ids: unique(explicit) };
      // Deletions (including array reassignments such as removeColumn's) can invalidate ids and the sub-selection.
      if ((current.ids.length === 0 && !current.sub) || patches.length === 0) return current;
      const ids = filterExisting(current.ids, project);
      const sub = current.sub && filterExisting([current.sub.id], project).length ? current.sub : undefined;
      if (ids === current.ids && sub === current.sub) return current;
      return sub ? { ids, sub } : { ids };
    };

    const restore = (from: 'undo' | 'redo'): void => {
      if (txn) return; // Ctrl+Z mid-drag must not interleave with the live preview
      const state = get();
      const source = from === 'undo' ? state.undoStack : state.redoStack;
      const entry = source[source.length - 1];
      if (!entry) return;
      const project = applyPatches(state.project, from === 'undo' ? entry.inversePatches : entry.patches);
      const rest = source.slice(0, -1);
      const other = pushHistory(from === 'undo' ? state.redoStack : state.undoStack, entry);
      const undoStack = from === 'undo' ? rest : other;
      const redoStack = from === 'undo' ? other : rest;
      const wanted = from === 'undo' ? entry.selectionBefore : entry.selectionAfter;
      set({
        project,
        activeDiagramId: reconcileActive(state.activeDiagramId, project),
        selection: { ids: filterExisting(wanted, project) },
        undoStack,
        redoStack,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        dirty: true,
      });
    };

    return {
      project: initial,
      activeDiagramId: firstDiagram(initial),
      selection: EMPTY_SELECTION,
      tool: 'select',
      dirty: false,
      lastSavedAt: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
      inTransaction: false,

      commit<T>(label: string, fn: (draft: Project) => T, opts?: { select?: Id[] }): T {
        assertNoTxn('commit');
        const state = get();
        let result!: T;
        // The recipe must return undefined (immer throws on a non-draft return); keep fn's value in the closure.
        const [project, patches, inversePatches] = produceWithPatches(state.project, (draft: Draft<Project>) => {
          result = fn(draft as Project);
          draft.updatedAt = nowIso(); // inside the recipe so undo restores the old timestamp
        });
        if (patches.length === 0 || isOnlyTimestamp(patches)) return result; // nothing changed: no history, no notification
        const selection = selectionAfterChange(project, patches, opts?.select);
        const entry: HistoryEntry = {
          label,
          patches,
          inversePatches,
          selectionBefore: state.selection.ids as Id[],
          selectionAfter: selection.ids,
        };
        const undoStack = pushHistory(state.undoStack, entry);
        set({
          project,
          activeDiagramId: reconcileActive(state.activeDiagramId, project),
          selection,
          undoStack,
          redoStack: [],
          canUndo: true,
          canRedo: false,
          dirty: true,
        });
        return result;
      },

      beginTransaction(label) {
        if (txn) throw new Error(`beginTransaction("${label}"): transaction "${txn.label}" is already open`);
        txn = { label, selectionBefore: get().selection.ids as Id[], patchChunks: [], inverseChunks: [] };
        set({ inTransaction: true });
      },

      updateTransaction(fn) {
        if (!txn) throw new Error('updateTransaction: no open transaction');
        const [project, patches, inverse] = produceWithPatches(get().project, (draft: Draft<Project>) => {
          fn(draft as Project);
          draft.updatedAt = nowIso();
        });
        if (patches.length === 0) return;
        txn.patchChunks.push(patches);
        txn.inverseChunks.push(inverse);
        set({ project, dirty: true });
      },

      endTransaction() {
        if (!txn) throw new Error('endTransaction: no open transaction');
        const t = txn;
        txn = null;
        const patches = t.patchChunks.flat();
        const state = get();
        if (patches.length === 0 || isOnlyTimestamp(patches)) {
          // A drag that went nowhere: undo the timestamp bump too, leave history alone.
          const inverse = t.inverseChunks.slice().reverse().flat();
          set({ project: inverse.length ? applyPatches(state.project, inverse) : state.project, inTransaction: false });
          return;
        }
        const inversePatches = t.inverseChunks.slice().reverse().flat();
        const selection = selectionAfterChange(state.project, patches, undefined);
        const entry: HistoryEntry = {
          label: t.label,
          patches,
          inversePatches,
          selectionBefore: t.selectionBefore,
          selectionAfter: selection.ids,
        };
        const undoStack = pushHistory(state.undoStack, entry);
        set({
          selection,
          activeDiagramId: reconcileActive(state.activeDiagramId, state.project),
          undoStack,
          redoStack: [],
          canUndo: true,
          canRedo: false,
          inTransaction: false,
          dirty: true,
        });
      },

      /** No-op when nothing is open, so an Esc handler may call it unconditionally. */
      cancelTransaction() {
        if (!txn) return;
        const t = txn;
        txn = null;
        const inverse = t.inverseChunks.slice().reverse().flat();
        const state = get();
        set({ project: inverse.length ? applyPatches(state.project, inverse) : state.project, inTransaction: false });
      },

      setViewState(diagramId, viewport) {
        const state = get();
        const diagram = state.project.diagrams[diagramId];
        if (!diagram) return;
        const v = diagram.viewport;
        if (v && v.x === viewport.x && v.y === viewport.y && v.zoom === viewport.zoom) return;
        const project = produce(state.project, (draft) => {
          const d = draft.diagrams[diagramId];
          if (d) d.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
        });
        set({ project });
      },

      undo: () => restore('undo'),
      redo: () => restore('redo'),
      clearHistory: () => set({ undoStack: [], redoStack: [], canUndo: false, canRedo: false }),

      setActiveDiagram(id) {
        const state = get();
        if (!Object.hasOwn(state.project.diagrams, id) || state.activeDiagramId === id) return;
        set({ activeDiagramId: id, selection: EMPTY_SELECTION });
      },
      setTool: (tool) => set({ tool }),
      setSelection(ids, sub) {
        set({ selection: sub ? { ids: unique(ids), sub } : { ids: unique(ids) } });
      },
      addToSelection(ids) {
        const cur = get().selection;
        set({ selection: { ids: unique([...cur.ids, ...ids]) } });
      },
      toggleSelection(id) {
        const cur = get().selection;
        const ids = cur.ids.includes(id) ? cur.ids.filter((x) => x !== id) : [...cur.ids, id];
        set({ selection: { ids } });
      },
      setSubSelection(sub) {
        const cur = get().selection;
        set({ selection: sub ? { ids: cur.ids, sub } : { ids: cur.ids } });
      },
      clearSelection() {
        if (get().selection.ids.length === 0 && !get().selection.sub) return;
        set({ selection: EMPTY_SELECTION });
      },

      newProject(name) {
        txn = null;
        get().loadProject(createProject(name));
      },

      loadProject(project) {
        txn = null;
        const frozen = freeze(project, true);
        set({
          project: frozen,
          activeDiagramId: firstDiagram(frozen),
          selection: EMPTY_SELECTION,
          undoStack: [],
          redoStack: [],
          canUndo: false,
          canRedo: false,
          inTransaction: false,
          dirty: false,
          lastSavedAt: null,
        });
      },

      replaceProject(project, label = 'Replace project') {
        assertNoTxn('replaceProject');
        const state = get();
        const next = freeze(project, true);
        if (next === state.project) return;
        const entry: HistoryEntry = {
          label,
          patches: [{ op: 'replace', path: [], value: next }],
          inversePatches: [{ op: 'replace', path: [], value: state.project }],
          selectionBefore: state.selection.ids as Id[],
          selectionAfter: [],
        };
        const undoStack = pushHistory(state.undoStack, entry);
        set({
          project: next,
          activeDiagramId: reconcileActive(state.activeDiagramId, next),
          selection: EMPTY_SELECTION,
          undoStack,
          redoStack: [],
          canUndo: true,
          canRedo: false,
          dirty: true,
        });
      },

      markSaved(savedAt, project) {
        // `project` lets async savers say "this exact version": a newer edit made meanwhile keeps `dirty`.
        const stillCurrent = project === undefined || project === get().project;
        set(stillCurrent ? { dirty: false, lastSavedAt: savedAt ?? nowIso() } : { lastSavedAt: savedAt ?? nowIso() });
      },
    };
  });
}

/** The app-wide store. Non-React code and tests use `editorStore.getState()` / `.subscribe`. */
export const editorStore: EditorStore = createEditorStore();

export function useEditorStore(): EditorStoreState;
export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T;
export function useEditorStore<T>(selector?: (state: EditorStoreState) => T): T | EditorStoreState {
  return useStore(editorStore, selector ?? ((s) => s as unknown as T));
}
/** `useEditorStore.getState()`-style access for code that prefers the hook object, like typical zustand usage. */
useEditorStore.getState = editorStore.getState;
useEditorStore.setState = editorStore.setState;
useEditorStore.subscribe = editorStore.subscribe;
