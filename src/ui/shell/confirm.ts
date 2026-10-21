import { uiStore } from '../uiStore';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

/** Open the shared confirm dialog; resolves true on confirm, false on cancel / Escape / backdrop. */
let pending: ((ok: boolean) => void) | undefined;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  pending?.(false); // a newer confirm replaces an unanswered one
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      if (pending === done) pending = undefined;
      resolve(ok);
    };
    pending = done;
    uiStore.getState().openDialog('confirm', { ...options, resolve: done });
  });
}
