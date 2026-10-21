/**
 * Cross-cutting UI state that is NOT project data and NOT history: open dialog, toasts, the latest validation issues and
 * which one is focused (click-to-highlight). Commands (editor/commands) open dialogs through this store so the
 * toolbar, menus and shortcuts all work the same way.
 */
import { createStore, useStore } from 'zustand';
import type { Issue } from '@/model/types';

export type DialogKind =
  | 'new-project'
  | 'examples'
  | 'convert'
  | 'export'
  | 'import'
  | 'sql'
  | 'settings'
  | 'shortcuts'
  | 'about'
  | 'diagram-options'
  | 'new-diagram'
  | 'recent'
  | 'confirm';

export interface ToastMessage {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  /** Already translated text. */
  message: string;
  /** ms before auto-dismiss; 0 = sticky. */
  ttl: number;
  /** Optional single call to action (e.g. 'Reopen previous'); the toast closes when it runs. */
  action?: { label: string; onSelect: () => void };
  /** Creation time (ms, set by the store). */
  at?: number;
}

/** Most toasts shown at once. */
export const MAX_VISIBLE_TOASTS = 3;
/** A new transient toast replaces an older transient one of the same kind pushed within this window (rapid tool feedback). */
export const TOAST_COALESCE_MS = 6000;

/** Confirmations that auto-dismiss and carry no action: safe to merge or drop. */
export const isTransientToast = (x: ToastMessage): boolean => x.kind !== 'error' && !x.action && x.ttl > 0;

/** Pure stack update: dedupe identical text, coalesce rapid same-kind confirmations, cap the visible stack. */
export function stackToast(toasts: ToastMessage[], next: ToastMessage): ToastMessage[] {
  const at = next.at ?? 0;
  let list = toasts.filter((x) => x.message !== next.message);
  if (isTransientToast(next)) list = list.filter((x) => !(isTransientToast(x) && x.kind === next.kind && at - (x.at ?? 0) < TOAST_COALESCE_MS));
  list = [...list, next];
  while (list.length > MAX_VISIBLE_TOASTS) {
    const drop = list.findIndex((x, i) => i < list.length - 1 && isTransientToast(x));
    list.splice(drop >= 0 ? drop : 0, 1);
  }
  return list;
}

export interface UiState {
  dialog: { kind: DialogKind; props?: Record<string, unknown> } | null;
  toasts: ToastMessage[];
  /** Latest `validateProject` result for the active diagram's model (the Validate command refreshes it). */
  issues: Issue[];
  issuesStale: boolean;
  focusedIssueId: string | null;
  /** Bottom dock content. */
  dock: 'issues' | 'sql' | null;
  openDialog(kind: DialogKind, props?: Record<string, unknown>): void;
  closeDialog(): void;
  pushToast(t: Omit<ToastMessage, 'id' | 'ttl'> & { ttl?: number }): number;
  dismissToast(id: number): void;
  setIssues(issues: Issue[]): void;
  markIssuesStale(): void;
  focusIssue(id: string | null): void;
  setDock(dock: UiState['dock']): void;
}

let nextToastId = 1;

export const createUiStore = () =>
  createStore<UiState>()((set) => ({
    dialog: null,
    toasts: [],
    issues: [],
    issuesStale: false,
    focusedIssueId: null,
    dock: null,
    openDialog: (kind, props) => set({ dialog: { kind, props } }),
    closeDialog: () => set({ dialog: null }),
    pushToast: (t) => {
      const id = nextToastId++;
      set((s) => ({ toasts: stackToast(s.toasts, { ttl: t.kind === 'error' ? 0 : 4000, ...t, id, at: Date.now() }) }));
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
    setIssues: (issues) => set({ issues, issuesStale: false }),
    markIssuesStale: () => set((s) => (s.issues.length ? { issuesStale: true } : s)),
    focusIssue: (focusedIssueId) => set({ focusedIssueId }),
    setDock: (dock) => set({ dock }),
  }));

export const uiStore = createUiStore();
export const useUi = <T,>(selector: (s: UiState) => T): T => useStore(uiStore, selector);
