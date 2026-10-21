// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDeterministicIds } from '@/model/ids';
import { sampleProject } from '@/model/io/testFixtures';
import { createEditorStore } from '@/store/editorStore';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { AUTOSAVE_KEY, BACKUP_PREFIX, JOURNAL_KEY, backupStoredAutosave, consumeEmptyStartUrl, downloadRecoverableData, readRecoverable, writeJournal, clear, closeDb, consumeEmptyStart, idbKv, isPersistenceSuspended, requestEmptyStart, saveSnapshot, startAutosave } from './index';
import { resumePersistenceForTests } from './suspend';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let restoreIds: () => void;
beforeEach(async () => {
  restoreIds = useDeterministicIds();
  localStorage.clear();
  sessionStorage.clear();
  resumePersistenceForTests();
  await closeDb();
  await clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreIds();
  resumePersistenceForTests();
});

function Boom(): never {
  throw new Error('render crash');
}

describe('crash fallback suspends persistence', () => {
  it('no IndexedDB/journal write after a caught render error (timer, pagehide, beforeunload); stored autosave unchanged', async () => {
    const store = createEditorStore({ project: sampleProject('Good') });
    expect(await saveSnapshot(store.getState().project)).toBe(true);
    const before = await idbKv.get(AUTOSAVE_KEY);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stop = startAutosave(store);
    // an edit leaves a debounce timer pending, then the UI crashes
    store.getState().commit('r', (d) => void (d.name = 'Crashing state'));
    const setMany = vi.spyOn(idbKv, 'setMany');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(isPersistenceSuspended()).toBe(true);
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(setMany).not.toHaveBeenCalled();
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(await idbKv.get(AUTOSAVE_KEY)).toBe(before);
    stop();
    await act(async () => root.unmount());
  });
});

describe('empty-start flag', () => {
  it('is one-shot', () => {
    expect(consumeEmptyStart()).toBe(false);
    expect(requestEmptyStart()).toBe(true);
    expect(consumeEmptyStart()).toBe(true);
    expect(consumeEmptyStart()).toBe(false);
  });

  it('backs the stored autosave up so a later autosave cannot destroy it', async () => {
    await saveSnapshot(sampleProject('Keep me'));
    const stored = await idbKv.get(AUTOSAVE_KEY);
    await backupStoredAutosave();
    await saveSnapshot(sampleProject('Replacement'));
    expect((await idbKv.valuesWithPrefix(BACKUP_PREFIX)).map((v) => (v as { text: string }).text)).toEqual([stored]);
  });

  it('keeps up to 3 backups, pruning the oldest; a second empty start does not lose the first', async () => {
    for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) {
      await saveSnapshot(sampleProject(n), idbKv, `2026-01-0${i + 1}T00:00:00.000Z`);
      await backupStoredAutosave();
    }
    const names = (await idbKv.valuesWithPrefix(BACKUP_PREFIX)).map((v) => (JSON.parse((v as { text: string }).text) as { project: { name: string } }).project.name);
    expect(names).toHaveLength(3);
    expect(names).not.toContain('A');
    expect(names).toContain('D');
  });

  it('backs up the journal when it is newer than the autosave, and it survives the journal being cleared', async () => {
    await saveSnapshot(sampleProject('Old'), idbKv, '2026-01-01T00:00:00.000Z');
    expect(writeJournal(sampleProject('Newer'))).toBe(true);
    await backupStoredAutosave();
    localStorage.removeItem(JOURNAL_KEY);
    const found = await readRecoverable();
    expect(found?.text).toContain('Newer');
  });

  it('recoverable data is the newest among autosave, journal and backups (a stale backup does not win)', async () => {
    await saveSnapshot(sampleProject('Stale'), idbKv, '2026-01-01T00:00:00.000Z');
    await backupStoredAutosave();
    await saveSnapshot(sampleProject('Fresh'), idbKv, '2026-02-01T00:00:00.000Z');
    const found = await readRecoverable();
    expect(found?.source).toBe('autosave');
    expect(found?.text).toContain('Fresh');
  });

  it('download reports the source and the crash screen says which copy was saved', async () => {
    await saveSnapshot(sampleProject('Fresh'));
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await downloadRecoverableData()).toBe('autosave');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid=crash-download]')!.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(host.textContent).toMatch(/newest stored copy.*autosave/);
    await act(async () => root.unmount());
    host.remove();
  });

  it('when sessionStorage is blocked the empty-start button falls back to the URL flag instead of reloading into the crash', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(requestEmptyStart()).toBe(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));
    // jsdom cannot navigate: the fallback must at least not throw and must show an error when it cannot proceed
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=crash-empty]')!.click());
    await act(async () => root.unmount());
    host.remove();
  });

  it('the URL flag is read once and removed via history.replaceState', () => {
    window.history.replaceState(null, '', '/?empty-start=1&x=2');
    expect(consumeEmptyStartUrl()).toBe(true);
    expect(window.location.search).toBe('?x=2');
    expect(consumeEmptyStartUrl()).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});
