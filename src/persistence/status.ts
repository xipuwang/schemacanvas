/** What the UI can show about browser persistence. Never throws: failures become a status. */
export type PersistenceStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: string }
  /** IndexedDB is missing or could not be opened (private mode, blocked site data): autosave is OFF for this session. */
  | { state: 'unavailable'; reason: string }
  /** A write/read failed (quota, aborted transaction…); the next save retries. */
  | { state: 'error'; message: string; at: string };

let current: PersistenceStatus = { state: 'idle' };
const listeners = new Set<(s: PersistenceStatus) => void>();

export function getPersistenceStatus(): PersistenceStatus {
  return current;
}

export function setPersistenceStatus(next: PersistenceStatus): void {
  current = next;
  for (const l of [...listeners]) l(next);
}

/** Subscribe; returns the unsubscribe function. */
export function onPersistenceStatus(listener: (s: PersistenceStatus) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
