// Deliberately WITHOUT 'fake-indexeddb/auto': Node has no indexedDB, which is what private mode looks like to us.
import { describe, expect, it } from 'vitest';
import { sampleProject } from '@/model/io/testFixtures';
import { createEditorStore } from '@/store/editorStore';
import { clear, flush, getPersistenceStatus, listRecent, loadAutosave, saveSnapshot, startAutosave } from './index';

describe('IndexedDB unavailable', () => {
  it('has no indexedDB in this environment', () => {
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
  });

  it('every operation degrades to a typed status instead of throwing', async () => {
    expect(await saveSnapshot(sampleProject())).toBe(false);
    expect(getPersistenceStatus()).toMatchObject({ state: 'unavailable' });
    expect(await loadAutosave()).toBeNull();
    expect(await listRecent()).toEqual([]);
    await expect(clear()).resolves.toBeUndefined();
  });

  it('autosave keeps running (and keeps the project dirty) without storage', async () => {
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store, { delayMs: 1 });
    store.getState().commit('edit', (d) => void (d.name = 'edited'));
    await flush();
    expect(getPersistenceStatus()).toMatchObject({ state: 'unavailable' });
    expect(store.getState().dirty).toBe(true);
    stop();
  });
});
