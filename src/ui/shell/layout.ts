import { useSyncExternalStore } from 'react';

export type LayoutMode = 'wide' | 'medium' | 'narrow';
export const WIDE_MIN = 1100;
export const MEDIUM_MIN = 700;

export function layoutModeForWidth(width: number): LayoutMode {
  return width >= WIDE_MIN ? 'wide' : width >= MEDIUM_MIN ? 'medium' : 'narrow';
}

export const currentLayoutMode = (): LayoutMode => (typeof window === 'undefined' ? 'wide' : layoutModeForWidth(window.innerWidth));

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/** `wide` ≥ 1100px (three columns), `medium` 700–1100 (docks are drawers), `narrow` < 700 (canvas + bottom sheet). */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, currentLayoutMode, () => 'wide');
}
