/**
 * Every timestamp in the app goes through `nowIso()` so tests can freeze time (conversion records,
 * serialisation snapshots). Only `store.commit` sets `Project.updatedAt`; ops never touch it.
 */
let fixed: string | null = null;

export function nowIso(): string {
  return fixed ?? new Date().toISOString();
}

/** Freeze the clock; returns a function that restores the real clock. Restore in `afterEach`. */
export function useFixedClock(iso: string): () => void {
  const previous = fixed;
  fixed = iso;
  return () => {
    fixed = previous;
  };
}
