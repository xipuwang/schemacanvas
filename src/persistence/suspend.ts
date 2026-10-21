/**
 * Page-session kill switch for every persistence WRITE (autosave timer, journal on beforeunload/pagehide, snapshot saves
 * through autosave). The crash fallback flips it so a broken in-memory state can never replace the last good autosave.
 * It lasts until the page is reloaded.
 */
let suspended = false;

export function suspendPersistence(): void {
  suspended = true;
}

export function isPersistenceSuspended(): boolean {
  return suspended;
}

/** Tests only. */
export function resumePersistenceForTests(): void {
  suspended = false;
}
