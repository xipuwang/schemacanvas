/** Application startup: restore the autosave (or start fresh), start autosave + live validation, register commands. */
import { loadAutosaveOrJournal, startAutosave, getPersistenceStatus, consumeEmptyStart, consumeEmptyStartUrl, backupStoredAutosave } from '@/persistence';
import { editorStore } from '@/store';
import { localizeLoadError, t } from '@/i18n';
import { applyThemeNow } from '../theme/useResolvedTheme';
import { uiStore } from '../uiStore';
import { registerShellCommands } from './commands';
import { registerShellDialogs } from './dialogs';
import { shellStore } from './shellStore';
import { startLiveValidation } from './validation';
import { startToastHygiene } from './toasts';
import { restoreViewState, startViewState } from './viewState';

let started: Promise<void> | undefined;

export interface StartOptions {
  /** Skip restoring the autosave (tests). */
  fresh?: boolean;
}

export function startApp(options: StartOptions = {}): Promise<void> {
  started ??= (async () => {
    applyThemeNow();
    registerShellCommands();
    registerShellDialogs();
    const store = editorStore.getState();
    // crash-loop escape: skip restoring (the stored copy is backed up first because the next autosave replaces it)
    // consume BOTH one-shot flags (no short-circuit), so a leftover URL flag cannot trigger a second empty start later
    const flags = options.fresh ? [false, false] : [consumeEmptyStart(), consumeEmptyStartUrl()];
    const emptyStart = flags[0] || flags[1];
    if (emptyStart) await backupStoredAutosave();
    const result = options.fresh || emptyStart ? null : await loadAutosaveOrJournal();
    if (result?.ok) {
      store.loadProject(result.project);
      restoreViewState(editorStore.getState().project);
    } else {
      if (result && !result.ok) uiStore.getState().pushToast({ kind: 'error', message: t('shell.startup.restoreFailed', { message: localizeLoadError(result.error) }) });
      store.newProject();
      shellStore.getState().setFirstRun(result === null);
    }
    startViewState();
    startToastHygiene();
    startAutosave(editorStore);
    startLiveValidation();
    window.addEventListener('beforeunload', (e) => {
      const status = getPersistenceStatus().state;
      if (editorStore.getState().dirty && (status === 'unavailable' || status === 'error')) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    shellStore.getState().setReady(true);
  })();
  return started;
}
