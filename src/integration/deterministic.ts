/**
 * Import for side effects in a test file: sequential ids + fixed clock for every test. Auto-layout and label placement depend
 * on id ORDER, so with random ids a handful of runs lay out differently (see p2d-known-defects.test.ts). Pinning ids keeps the
 * default suite reproducible; the id-dependent defects are replayed from saved fixtures instead.
 */
import { afterEach, beforeEach } from 'vitest';
import { useFixedClock } from '@/model/clock';
import { useDeterministicIds } from '@/model/ids';

let restore: Array<() => void> = [];
beforeEach(() => {
  restore = [useDeterministicIds(), useFixedClock('2026-03-03T00:00:00.000Z')];
});
afterEach(() => restore.forEach((r) => r()));
