import type { EditorStore } from '@/store/editorStore';
import type { Project } from '@/model/types';
import { idbKv, type KvStore } from './idb';
import { saveSnapshot } from './storage';
import { setPersistenceStatus } from './status';
import { clearJournal, writeJournal } from './journal';
import { isPersistenceSuspended } from './suspend';

export const AUTOSAVE_DELAY_MS = 500;

export interface AutosaveOptions {
  delayMs?: number;
  kv?: KvStore;
}

interface Autosaver {
  flush(): Promise<void>;
  /** Drop any pending write and treat the store's current project as already persisted; resolves when in-flight writes ended. */
  discard(): Promise<void>;
}
const active = new Set<Autosaver>();

/** Flush every running autosaver now (visibility/pagehide handlers, tests, "Save" buttons). Never rejects. */
export async function flush(): Promise<void> {
  await Promise.all([...active].map((a) => a.flush()));
}

/**
 * Cancel every pending autosave / journal write and wait for in-flight ones, so a following storage wipe cannot be undone by
 * a late write of the current in-memory project. Later edits are autosaved normally.
 */
export async function discardPending(): Promise<void> {
  await Promise.all([...active].map((a) => a.discard()));
}

/**
 * Debounced autosave: whenever `store.project` changes (edits AND viewport moves), wait `delayMs` of quiet, then write
 * the latest project. Not started on import — the app calls this once. Writes are serialised so an older snapshot can
 * never land after a newer one. Returns `stop()`, which cancels a pending save WITHOUT writing (call `flush()` first if
 * you want it saved).
 */
export function startAutosave(store: EditorStore, opts: AutosaveOptions = {}): () => void {
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  const kv = opts.kv ?? idbKv;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved: Project | undefined = store.getState().project;
  /** The newest project known to be in IndexedDB (an in-flight write does not count: it may not finish on unload). */
  let confirmed: Project | undefined = lastSaved;
  let chain: Promise<void> = Promise.resolve();

  const saveNow = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (isPersistenceSuspended()) return chain;
    const project = store.getState().project;
    if (project === lastSaved) return chain;
    lastSaved = project;
    setPersistenceStatus({ state: 'saving' });
    chain = chain.then(async () => {
      const ok = await saveSnapshot(project, kv);
      // Failed writes must be retried by the next change, not considered saved.
      if (ok) {
        confirmed = project;
        store.getState().markSaved(undefined, project);
        // the journal (written while the page was going away) is obsolete once the newest project is in IndexedDB
        if (store.getState().project === project) clearJournal();
      }
      else if (lastSaved === project) lastSaved = undefined;
    });
    return chain;
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void saveNow(), delay);
  });

  /** The page may be unloaded before the async IndexedDB write finishes: journal synchronously first. */
  const journalPending = (): void => {
    if (isPersistenceSuspended()) return;
    const project = store.getState().project;
    if (project !== confirmed) writeJournal(project);
  };
  const onHide = (): void => {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden) {
      journalPending();
      void saveNow();
    }
  };
  const onPageHide = (): void => {
    journalPending();
    void saveNow();
  };
  const onBeforeUnload = (): void => journalPending();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  const discard = async (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    await chain;
    lastSaved = store.getState().project;
    confirmed = lastSaved;
  };
  const autosaver: Autosaver = { flush: saveNow, discard };
  active.add(autosaver);

  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    active.delete(autosaver);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
  };
}
