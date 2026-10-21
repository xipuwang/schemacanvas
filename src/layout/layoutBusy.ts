/**
 * Tiny "a layout is running" store for the UI (spinner on the Convert dialog / `layout.auto` command).
 *
 * `pending` counts running layouts (autoLayout / layoutGraph / ELK runs nest, so use `pending > 0`). It is a zustand
 * vanilla store, so React reads it with `useStore(layoutBusyStore, (s) => s.pending > 0)` (zustand's `useStore`).
 */
import { createStore } from 'zustand/vanilla';

export interface LayoutBusyState {
  pending: number;
}

export const layoutBusyStore = createStore<LayoutBusyState>(() => ({ pending: 0 }));

export const isLayoutBusy = (): boolean => layoutBusyStore.getState().pending > 0;
export const selectLayoutBusy = (s: LayoutBusyState): boolean => s.pending > 0;

/** Marks the store busy for the lifetime of `fn` (also when it throws). */
export async function trackLayoutBusy<T>(fn: () => Promise<T>): Promise<T> {
  layoutBusyStore.setState((s) => ({ pending: s.pending + 1 }));
  try {
    return await fn();
  } finally {
    layoutBusyStore.setState((s) => ({ pending: Math.max(0, s.pending - 1) }));
  }
}
