// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { sampleProject } from '@/model/io/testFixtures';
import { createEditorStore } from '@/store/editorStore';
import { JOURNAL_KEY, JOURNAL_MAX_CHARS, clear, closeDb, loadAutosaveOrJournal, readJournal, saveSnapshot, startAutosave, writeJournal } from './index';

let restoreIds: () => void;
beforeEach(async () => {
  restoreIds = useDeterministicIds();
  localStorage.clear();
  await closeDb();
  await clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  restoreIds();
});

const rename = (store: ReturnType<typeof createEditorStore>, name: string) => store.getState().commit('r', (d) => void (d.name = name));
const nameOf = (r: Awaited<ReturnType<typeof loadAutosaveOrJournal>>) => (r?.ok ? r.project.name : undefined);

describe('SA-07 write-ahead journal', () => {
  it('pagehide journals an edit that has not reached IndexedDB yet (synchronously, before the async write)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store);
    rename(store, 'Firm');
    expect(readJournal()).toBeNull(); // debounce still pending, nothing written yet
    window.dispatchEvent(new Event('pagehide'));
    const j = readJournal();
    expect(j).not.toBeNull();
    expect(JSON.parse(j!.text).project.name).toBe('Firm');
    stop();
  });

  it('does not journal when nothing is pending', () => {
    const store = createEditorStore({ project: sampleProject() });
    const stop = startAutosave(store);
    window.dispatchEvent(new Event('pagehide'));
    expect(readJournal()).toBeNull();
    stop();
  });

  it('startup prefers a journal that is newer than the IndexedDB autosave, reconciles it into IndexedDB and clears it', async () => {
    const base = sampleProject();
    await saveSnapshot(base, undefined, '2026-01-01T00:00:00.000Z');
    writeJournal({ ...base, name: 'Journal wins' });
    const r = await loadAutosaveOrJournal();
    expect(nameOf(r)).toBe('Journal wins');
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    // now IndexedDB holds it
    expect(nameOf(await loadAutosaveOrJournal())).toBe('Journal wins');
  });

  it('startup ignores a journal that is older than the autosave', async () => {
    const base = sampleProject();
    writeJournal({ ...base, name: 'Old journal' });
    await new Promise((r) => setTimeout(r, 5));
    await saveSnapshot({ ...base, name: 'Fresh autosave' });
    expect(nameOf(await loadAutosaveOrJournal())).toBe('Fresh autosave');
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
  });

  it('skips projects over the quota-safe size and survives a throwing localStorage', () => {
    const big = sampleProject();
    big.description = 'x'.repeat(JOURNAL_MAX_CHARS + 10);
    expect(writeJournal(big)).toBe(false);
    expect(readJournal()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(writeJournal(sampleProject())).toBe(false);
  });

  it('a corrupt journal is dropped and the autosave is used', async () => {
    await saveSnapshot({ ...sampleProject(), name: 'Autosave' });
    localStorage.setItem(JOURNAL_KEY, '{not json');
    expect(nameOf(await loadAutosaveOrJournal())).toBe('Autosave');
  });
});
