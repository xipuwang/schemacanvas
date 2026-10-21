/**
 * Dock slot registries. The panels worker registers its components at import time; until then the shell shows placeholders.
 */
import { useSyncExternalStore, type ComponentType } from 'react';

export type PanelSlot = 'library' | 'properties';
export type DockSlot = 'issues' | 'sql';

const panels = new Map<PanelSlot, ComponentType>();
const docks = new Map<DockSlot, ComponentType>();
const listeners = new Set<() => void>();
let version = 0;
const bump = (): void => {
  version++;
  listeners.forEach((l) => l());
};

export function registerPanel(slot: PanelSlot, component: ComponentType): () => void {
  panels.set(slot, component);
  bump();
  return () => {
    if (panels.get(slot) === component) {
      panels.delete(slot);
      bump();
    }
  };
}

export function registerDock(slot: DockSlot, component: ComponentType): () => void {
  docks.set(slot, component);
  bump();
  return () => {
    if (docks.get(slot) === component) {
      docks.delete(slot);
      bump();
    }
  };
}

export const getPanel = (slot: PanelSlot): ComponentType | undefined => panels.get(slot);
export const getDock = (slot: DockSlot): ComponentType | undefined => docks.get(slot);

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
/** Re-render when any slot registration changes. */
export function useSlotVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
