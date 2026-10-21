import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { sampleProject } from '@/model/io/testFixtures';
import { serializeProject } from '@/model/io';
import { SCHEMA_VERSION } from '@/model/types';
import {
  AUTOSAVE_KEY,
  clear,
  clearAutosave,
  closeDb,
  deleteRecent,
  getPersistenceStatus,
  idbKv,
  listRecent,
  loadAutosave,
  loadRecent,
  projectKey,
  saveSnapshot,
} from './index';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(async () => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
  await closeDb();
  await clear();
});
afterEach(() => {
  restoreIds();
  restoreClock();
});

describe('IndexedDB kv', () => {
  it('stores, reads, lists by prefix, deletes and clears', async () => {
    await idbKv.setMany([
      ['a:1', 'x'],
      ['a:2', { n: 2 }],
      ['b:1', 'y'],
    ]);
    expect(await idbKv.get('a:1')).toBe('x');
    expect(await idbKv.get('missing')).toBeUndefined();
    expect(await idbKv.valuesWithPrefix('a:')).toEqual(['x', { n: 2 }]);
    await idbKv.deleteMany(['a:1']);
    expect(await idbKv.valuesWithPrefix('a:')).toEqual([{ n: 2 }]);
    await idbKv.clear();
    expect(await idbKv.valuesWithPrefix('')).toEqual([]);
  });

  it('setMany is atomic: a failing value aborts every entry', async () => {
    await expect(idbKv.setMany([['ok', 1], ['bad', () => 1]])).rejects.toBeTruthy();
    expect(await idbKv.get('ok')).toBeUndefined();
  });
});

describe('snapshots', () => {
  it('saves autosave + project + meta and loads the project back through the loader', async () => {
    const p = sampleProject('Doc');
    expect(await saveSnapshot(p)).toBe(true);
    expect(getPersistenceStatus()).toEqual({ state: 'saved', at: '2026-01-01T00:00:00.000Z' });
    expect(typeof (await idbKv.get(AUTOSAVE_KEY))).toBe('string');
    expect(typeof (await idbKv.get(projectKey(p.id)))).toBe('string');
    const r = await loadAutosave();
    expect(r?.ok && r.project).toEqual(p);
    const recent = await loadRecent(p.id);
    expect(recent?.ok && recent.project).toEqual(p);
  });

  it('returns null when nothing was saved', async () => {
    expect(await loadAutosave()).toBeNull();
    expect(await loadRecent('prj_none')).toBeNull();
  });

  it('applies the migration path: a corrupt or foreign record surfaces as a LoadResult error', async () => {
    await idbKv.setMany([[AUTOSAVE_KEY, '{"format":"nope"']]);
    expect(await loadAutosave()).toMatchObject({ ok: false, error: { code: 'not-json' } });
    await idbKv.setMany([[AUTOSAVE_KEY, JSON.stringify({ format: 'schemacanvas-project', schemaVersion: SCHEMA_VERSION + 5, project: {} })]]);
    expect(await loadAutosave()).toMatchObject({ ok: false, error: { code: 'newer-version' } });
    await idbKv.setMany([[AUTOSAVE_KEY, 42]]);
    expect(await loadAutosave()).toMatchObject({ ok: false });
  });

  it('lists recent projects newest first, one entry per project id, and deletes them', async () => {
    const a = sampleProject('A');
    const b = sampleProject('B');
    restoreClock();
    restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
    await saveSnapshot(a, undefined, '2026-01-01T00:00:00.000Z');
    await saveSnapshot(b, undefined, '2026-02-01T00:00:00.000Z');
    await saveSnapshot({ ...a, name: 'A2' }, undefined, '2026-03-01T00:00:00.000Z');
    const list = await listRecent();
    expect(list.map((r) => r.name)).toEqual(['A2', 'B']);
    expect(list[0]).toEqual({ id: a.id, name: 'A2', updatedAt: a.updatedAt, savedAt: '2026-03-01T00:00:00.000Z' });
    await deleteRecent(a.id);
    expect((await listRecent()).map((r) => r.name)).toEqual(['B']);
    expect(await loadRecent(a.id)).toBeNull();
    expect(await loadAutosave()).not.toBeNull(); // autosave slot is independent
    await clearAutosave();
    expect(await loadAutosave()).toBeNull();
  });

  it('clear() wipes everything', async () => {
    await saveSnapshot(sampleProject());
    await clear();
    expect(await loadAutosave()).toBeNull();
    expect(await listRecent()).toEqual([]);
    expect(getPersistenceStatus()).toEqual({ state: 'idle' });
  });

  it('stored envelope equals serializeProject output', async () => {
    const p = sampleProject();
    await saveSnapshot(p, undefined, '2026-04-04T00:00:00.000Z');
    expect(await idbKv.get(AUTOSAVE_KEY)).toBe(serializeProject(p, '2026-04-04T00:00:00.000Z'));
  });

  it('reports a typed error status (not a throw) when a write fails', async () => {
    const failing = {
      ...idbKv,
      setMany: () => Promise.reject(new Error('QuotaExceededError')),
    };
    expect(await saveSnapshot(sampleProject(), failing)).toBe(false);
    expect(getPersistenceStatus()).toMatchObject({ state: 'error', message: expect.stringContaining('QuotaExceededError') });
  });
});
