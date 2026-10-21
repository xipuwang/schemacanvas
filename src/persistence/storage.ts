/**
 * Project persistence on top of the KV layer. Records (all values are structured-clone friendly):
 *   'autosave:current'  string  ProjectFile envelope (what `serializeProject` returns)
 *   'project:<id>'      string  same envelope, one per project id (the "recent projects" payload)
 *   'meta:<id>'         object  { id, name, updatedAt, savedAt } so listing never parses whole projects
 * Everything reads back through `parseProjectFile` → `loadProjectData`'s path, so migrations always apply.
 */
import { parseProjectFile, serializeProject } from '@/model/io';
import type { LoadResult } from '@/model/io';
import { nowIso } from '@/model/clock';
import type { Id, Project } from '@/model/types';
import { PersistenceUnavailableError, idbKv, type KvStore } from './idb';
import { describeError, setPersistenceStatus } from './status';

export const AUTOSAVE_KEY = 'autosave:current';
export const projectKey = (id: Id): string => `project:${id}`;
const META_PREFIX = 'meta:';
const metaKey = (id: Id): string => `${META_PREFIX}${id}`;

export interface RecentProject {
  id: Id;
  name: string;
  updatedAt: string;
  savedAt: string;
}

function isRecent(v: unknown): v is RecentProject {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.updatedAt === 'string' && typeof o.savedAt === 'string';
}

/** Translate a thrown error into the status the UI shows. */
export function reportFailure(e: unknown): void {
  if (e instanceof PersistenceUnavailableError) setPersistenceStatus({ state: 'unavailable', reason: e.message });
  else setPersistenceStatus({ state: 'error', message: describeError(e), at: nowIso() });
}

/**
 * Write the autosave slot, the per-project record and its metadata in ONE transaction. Returns whether it landed;
 * never throws (failure is reflected in `getPersistenceStatus()`).
 */
export async function saveSnapshot(project: Project, kv: KvStore = idbKv, savedAt: string = nowIso()): Promise<boolean> {
  try {
    const text = serializeProject(project, savedAt);
    const meta: RecentProject = { id: project.id, name: project.name, updatedAt: project.updatedAt, savedAt };
    await kv.setMany([
      [AUTOSAVE_KEY, text],
      [projectKey(project.id), text],
      [metaKey(project.id), meta],
    ]);
    setPersistenceStatus({ state: 'saved', at: savedAt });
    return true;
  } catch (e) {
    reportFailure(e);
    return false;
  }
}

/**
 * The autosaved project, or `null` when there is none or storage is unavailable (check `getPersistenceStatus()`).
 * A corrupt record comes back as `{ ok: false }` so the UI can offer to discard it.
 */
export async function loadAutosave(kv: KvStore = idbKv): Promise<LoadResult | null> {
  try {
    const text = await kv.get(AUTOSAVE_KEY);
    if (text === undefined || text === null) return null;
    if (typeof text !== 'string') return { ok: false, error: { code: 'not-json', message: 'Autosave record is not text' } };
    return parseProjectFile(text);
  } catch (e) {
    reportFailure(e);
    return null;
  }
}

export async function loadRecent(id: Id, kv: KvStore = idbKv): Promise<LoadResult | null> {
  try {
    const text = await kv.get(projectKey(id));
    if (typeof text !== 'string') return null;
    return parseProjectFile(text);
  } catch (e) {
    reportFailure(e);
    return null;
  }
}

/** Recently saved projects, newest first. Empty when storage is unavailable. */
export async function listRecent(kv: KvStore = idbKv): Promise<RecentProject[]> {
  try {
    const values = await kv.valuesWithPrefix(META_PREFIX);
    return values.filter(isRecent).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.id < b.id ? -1 : 1));
  } catch (e) {
    reportFailure(e);
    return [];
  }
}

export async function deleteRecent(id: Id, kv: KvStore = idbKv): Promise<void> {
  try {
    await kv.deleteMany([projectKey(id), metaKey(id)]);
  } catch (e) {
    reportFailure(e);
  }
}

export async function clearAutosave(kv: KvStore = idbKv): Promise<void> {
  try {
    await kv.deleteMany([AUTOSAVE_KEY]);
  } catch (e) {
    reportFailure(e);
  }
}

/** Remove everything SchemaCanvas stored in this browser. */
export async function clear(kv: KvStore = idbKv): Promise<void> {
  await clearChecked(kv);
}

/** Like `clear`, but reports whether the wipe actually happened. */
export async function clearChecked(kv: KvStore = idbKv): Promise<boolean> {
  try {
    await kv.clear();
    setPersistenceStatus({ state: 'idle' });
    return true;
  } catch (e) {
    reportFailure(e);
    return false;
  }
}
