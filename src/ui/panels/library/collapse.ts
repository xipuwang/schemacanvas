/** Collapsed-section memory for the library (localStorage, failure-safe: private windows and blocked storage just forget). */
import { createStore, useStore } from 'zustand';

export const LIBRARY_STORAGE_KEY = 'schemacanvas:library:v1';

function read(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { collapsed?: unknown };
    return Array.isArray(v.collapsed) ? v.collapsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(collapsed: string[]): void {
  try {
    globalThis.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ collapsed }));
  } catch {
    /* storage unavailable: the state still works for this page view */
  }
}

export const collapseStore = createStore<{ collapsed: string[]; toggle(id: string): void; reload(): void }>((set, get) => ({
  collapsed: read(),
  toggle(id) {
    const cur = get().collapsed;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    write(next);
    set({ collapsed: next });
  },
  reload: () => set({ collapsed: read() }),
}));

export const useCollapsed = (): string[] => useStore(collapseStore, (s) => s.collapsed);
