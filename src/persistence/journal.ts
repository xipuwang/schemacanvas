/**
 * Synchronous write-ahead journal. IndexedDB writes are asynchronous and a reload / tab close can unload the page before
 * one finishes, losing the last edits (autosave is debounced). While the page is going away we therefore ALSO write the
 * serialised project to localStorage (synchronous, so it always lands). On the next start the journal wins when it is
 * newer than the IndexedDB autosave; it is reconciled into IndexedDB and cleared.
 *
 * Quota-safe: a project larger than JOURNAL_MAX_CHARS is not journalled (IndexedDB stays the only copy); every access
 * is try/catch (private windows, blocked storage).
 */
import { parseProjectFile, serializeProject } from '@/model/io';
import type { LoadResult } from '@/model/io';
import { nowIso } from '@/model/clock';
import type { Project } from '@/model/types';
import { idbKv, type KvStore } from './idb';
import { AUTOSAVE_KEY, loadAutosave, saveSnapshot } from './storage';
import { isPersistenceSuspended } from './suspend';

export const JOURNAL_KEY = 'schemacanvas:journal:v1';
export const JOURNAL_MAX_CHARS = 3_000_000;

interface Journal {
  /** Monotonic sequence (never goes backwards, even if the wall clock does). */
  seq: number;
  savedAt: string;
  text: string;
}

let lastSeq = 0;

/** Write the journal now. Returns whether it was written. */
export function writeJournal(project: Project): boolean {
  if (isPersistenceSuspended()) return false;
  try {
    const savedAt = nowIso();
    const text = serializeProject(project, savedAt);
    if (text.length > JOURNAL_MAX_CHARS) return false;
    lastSeq = Math.max(lastSeq + 1, Date.now());
    const journal: Journal = { seq: lastSeq, savedAt, text };
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    return true;
  } catch {
    return false;
  }
}

export function clearJournal(): void {
  try {
    localStorage.removeItem(JOURNAL_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function readJournal(): Journal | null {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<Journal>;
    return typeof j.text === 'string' && typeof j.savedAt === 'string' && typeof j.seq === 'number' ? (j as Journal) : null;
  } catch {
    return null;
  }
}

function savedAtOf(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const v = (JSON.parse(text) as { savedAt?: unknown }).savedAt;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The project to start with: the journal when it is strictly newer than the IndexedDB autosave (it is then written into
 * IndexedDB and cleared), else the autosave. A corrupt journal is dropped.
 */
export async function loadAutosaveOrJournal(kv: KvStore = idbKv): Promise<LoadResult | null> {
  const journal = readJournal();
  if (!journal) return loadAutosave(kv);
  let idbSavedAt: string | undefined;
  try {
    idbSavedAt = savedAtOf(await kv.get(AUTOSAVE_KEY));
  } catch {
    idbSavedAt = undefined;
  }
  if (idbSavedAt !== undefined && journal.savedAt <= idbSavedAt) {
    clearJournal();
    return loadAutosave(kv);
  }
  const result = parseProjectFile(journal.text);
  if (!result.ok) {
    clearJournal();
    return loadAutosave(kv);
  }
  if (await saveSnapshot(result.project, kv)) clearJournal();
  return result;
}
