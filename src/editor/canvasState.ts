/**
 * Tiny UI stores the canvas publishes for the rest of the app (status bar, library sidebar).
 * They hold NO project data and never enter history.
 */
import { createStore, useStore } from 'zustand';
import type { Id } from '@/model/types';
import type { LibraryItem } from './dnd';

export interface ViewportInfo {
  diagramId: Id | null;
  zoom: number;
  x: number;
  y: number;
  /** Container size in px (0 until measured). */
  width: number;
  height: number;
}

export const viewportInfoStore = createStore<ViewportInfo>(() => ({ diagramId: null, zoom: 1, x: 0, y: 0, width: 0, height: 0 }));

/** `useViewportInfo()` -> `{ zoom, ... }`; the status bar shows `Math.round(zoom * 100) + '%'`. */
export function useViewportInfo(): ViewportInfo {
  return useStore(viewportInfoStore, (s) => s);
}

export interface CanvasUiState {
  /** Library item armed for click-to-place (null = none). */
  armedItem: LibraryItem | null;
  /** Keyboard focus ring (roving focus) node id. */
  focusNodeId: Id | null;
  /** Canvas tooltips explaining database symbols (hover and keyboard focus). */
  symbolHints: boolean;
}

const HINTS_KEY = 'sc.symbolHints';
const readHints = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(HINTS_KEY) !== 'off';
  } catch {
    return true;
  }
};
export const writeSymbolHints = (on: boolean): void => {
  canvasUiStore.setState({ symbolHints: on });
  try {
    globalThis.localStorage?.setItem(HINTS_KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: the choice lasts for this session
  }
};

export const canvasUiStore = createStore<CanvasUiState>(() => ({ armedItem: null, focusNodeId: null, symbolHints: readHints() }));

export function useArmedItem(): LibraryItem | null {
  return useStore(canvasUiStore, (s) => s.armedItem);
}
