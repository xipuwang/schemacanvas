/**
 * Dialog registry. `registerDialog(kind, Component)`; the shell's DialogHost renders the component registered for
 * `uiStore.dialog.kind` with `{ props, onClose }`. Components render their own `<Dialog>` from `@/ui/components`.
 */
import { useSyncExternalStore, type ComponentType } from 'react';
import type { DialogKind } from '../uiStore';

export interface DialogComponentProps {
  props: Record<string, unknown>;
  onClose: () => void;
}

const dialogs = new Map<DialogKind, ComponentType<DialogComponentProps>>();
const listeners = new Set<() => void>();
let version = 0;

export function registerDialog(kind: DialogKind, component: ComponentType<DialogComponentProps>): () => void {
  dialogs.set(kind, component);
  version++;
  listeners.forEach((l) => l());
  return () => {
    if (dialogs.get(kind) === component) {
      dialogs.delete(kind);
      version++;
      listeners.forEach((l) => l());
    }
  };
}

export const getDialog = (kind: DialogKind): ComponentType<DialogComponentProps> | undefined => dialogs.get(kind);

export function useDialogVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}
