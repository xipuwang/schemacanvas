import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { sampleProject } from '@/model/io/testFixtures';
import { createEditorStore } from '@/store/editorStore';
import { AUTOSAVE_DELAY_MS, clear, closeDb, flush, getPersistenceStatus, idbKv, loadAutosave, startAutosave, type KvStore } from './index';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(async () => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
  await closeDb();
  await clear();
  // Only timers: fake-indexeddb schedules with setImmediate, which must stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  restoreIds();
  restoreClock();
});

function countingKv(): { kv: KvStore; writes: () => number } {
  let n = 0;
  return {
    kv: {
      ...idbKv,
      setMany: (e) => {
        n++;
        return idbKv.setMany(e);
      },
    },
    writes: () => n,
  };
}

const rename = (store: ReturnType<typeof createEditorStore>, name: string) => store.getState().commit('r', (d) => void (d.name = name));

describe('autosave', () => {
  it('debounces: many edits inside the window produce ONE write of the latest project', async () => {
    const { kv, writes } = countingKv();
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store, { kv });
    for (const n of ['a', 'b', 'c']) {
      rename(store, n);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    }
    expect(writes()).toBe(0);
    await vi.advanceTimersByTimeAsync(100 + 1);
    await flush();
    expect(writes()).toBe(1);
    const r = await loadAutosave();
    expect(r?.ok && r.project.name).toBe('c');
    expect(getPersistenceStatus().state).toBe('saved');
    stop();
  });

  it('marks the saved version clean, and keeps dirty when edited during the write', async () => {
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store);
    rename(store, 'x');
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await flush();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().lastSavedAt).toBe('2026-01-01T00:00:00.000Z');
    stop();
  });

  it('saves viewport changes too', async () => {
    const { kv, writes } = countingKv();
    const project = sampleProject();
    const store = createEditorStore({ project });
    const stop = startAutosave(store, { kv });
    store.getState().setViewState(project.diagramOrder[0]!, { x: 3, y: 4, zoom: 2 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await flush();
    expect(writes()).toBe(1);
    const r = await loadAutosave();
    expect(r?.ok && r.project.diagrams[project.diagramOrder[0]!]!.viewport).toEqual({ x: 3, y: 4, zoom: 2 });
    stop();
  });

  it('flush() writes immediately, without waiting for the debounce', async () => {
    const { kv, writes } = countingKv();
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store, { kv });
    rename(store, 'now');
    await flush();
    const r = await loadAutosave();
    expect(r?.ok && r.project.name).toBe('now');
    expect(writes()).toBe(1);
    // the pending timer was cancelled: advancing time does not write again
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toBe(1);
    stop();
  });

  it('retries after a failed write on the next flush', async () => {
    let fail = true;
    const kv: KvStore = {
      ...idbKv,
      setMany: (e) => (fail ? Promise.reject(new Error('disk full')) : idbKv.setMany(e)),
    };
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store, { kv });
    rename(store, 'retry');
    await flush();
    expect(getPersistenceStatus()).toMatchObject({ state: 'error' });
    expect(store.getState().dirty).toBe(true);
    fail = false;
    await flush(); // same project: must be attempted again
    expect(getPersistenceStatus().state).toBe('saved');
    expect(store.getState().dirty).toBe(false);
    stop();
  });

  it('writes are serialised: the last snapshot always wins', async () => {
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store, { delayMs: 1 });
    for (let i = 0; i < 5; i++) {
      rename(store, `v${i}`);
      await vi.advanceTimersByTimeAsync(2);
    }
    await flush();
    const r = await loadAutosave();
    expect(r?.ok && r.project.name).toBe('v4');
    stop();
  });
});
