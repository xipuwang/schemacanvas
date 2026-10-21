// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { sampleProject } from '@/model/io/testFixtures';
import { createEditorStore } from '@/store/editorStore';
import { AUTOSAVE_DELAY_MS, clear, closeDb, flush, idbKv, loadAutosave, startAutosave, type KvStore } from './index';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(async () => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
  await closeDb();
  await clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreIds();
  restoreClock();
});

const rename = (store: ReturnType<typeof createEditorStore>, name: string) => store.getState().commit('r', (d) => void (d.name = name));
const savedName = async (): Promise<string | undefined> => {
  const r = await loadAutosave();
  return r?.ok ? r.project.name : undefined;
};

describe('autosave page lifecycle', () => {
  it('writes immediately (no debounce wait) when the page becomes hidden, not when visible', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get');
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store);
    rename(store, 'edited');
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(await savedName()).toBeUndefined();
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => expect(await savedName()).toBe('edited'), { timeout: 2000 });
    stop();
  });

  it('writes immediately on pagehide', async () => {
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store);
    rename(store, 'bye');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(async () => expect(await savedName()).toBe('bye'), { timeout: 2000 });
    stop();
  });

  it('stop() cancels a pending save and detaches the listeners; nothing runs before start', async () => {
    let writes = 0;
    const kv: KvStore = { ...idbKv, setMany: (e) => (writes++, idbKv.setMany(e)) };
    const store = createEditorStore({ project: sampleProject() });
    rename(store, 'before start');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(writes).toBe(0);
    const stop = startAutosave(store, { kv });
    rename(store, 'pending');
    stop();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    window.dispatchEvent(new Event('pagehide'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(writes).toBe(0);
  });
});
