/**
 * Crash recovery helpers. "Start empty" is a one-shot sessionStorage flag read by startup: the stored autosave is NOT
 * loaded and is copied to a backup slot first, so the next autosave (which replaces 'autosave:current') cannot destroy it.
 */
import { idbKv, type KvStore } from './idb';
import { AUTOSAVE_KEY } from './storage';
import { readJournal } from './journal';

export const START_EMPTY_FLAG = 'schemacanvas:startEmpty';
/** Legacy single-slot backup key (read only). */
export const BACKUP_KEY = 'autosave:backup';

export function requestEmptyStart(): boolean {
  try {
    sessionStorage.setItem(START_EMPTY_FLAG, '1');
    return true;
  } catch {
    return false;
  }
}

/** Reads and clears the flag. */
export function consumeEmptyStart(): boolean {
  try {
    const on = sessionStorage.getItem(START_EMPTY_FLAG) === '1';
    if (on) sessionStorage.removeItem(START_EMPTY_FLAG);
    return on;
  } catch {
    return false;
  }
}

export const BACKUP_PREFIX = 'autosave:backup:';
export const MAX_BACKUPS = 3;
export const EMPTY_START_QUERY = 'empty-start';

export type RecoverySource = 'autosave' | 'journal' | 'backup';
export interface StoredCandidate {
  source: RecoverySource;
  savedAt: string;
  text: string;
}
interface BackupEntry {
  savedAt: string;
  text: string;
}

function savedAtOf(text: string): string {
  try {
    const v = (JSON.parse(text) as { savedAt?: unknown; updatedAt?: unknown }).savedAt;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** Newest first; ties keep the order given (autosave before journal before backups). */
function newest(c: StoredCandidate[]): StoredCandidate | undefined {
  let best: StoredCandidate | undefined;
  for (const x of c) if (!best || x.savedAt > best.savedAt) best = x;
  return best;
}

async function storedBackups(kv: KvStore): Promise<StoredCandidate[]> {
  const out: StoredCandidate[] = [];
  try {
    for (const v of await kv.valuesWithPrefix(BACKUP_PREFIX)) {
      const e = v as Partial<BackupEntry> | null;
      if (e && typeof e.text === 'string') out.push({ source: 'backup', savedAt: typeof e.savedAt === 'string' ? e.savedAt : savedAtOf(e.text), text: e.text });
    }
    const legacy = await kv.get(BACKUP_KEY); // single-slot backups written by earlier builds
    if (typeof legacy === 'string') out.push({ source: 'backup', savedAt: savedAtOf(legacy), text: legacy });
  } catch {
    /* ignore */
  }
  return out;
}

async function autosaveAndJournal(kv: KvStore): Promise<StoredCandidate[]> {
  const out: StoredCandidate[] = [];
  try {
    const text = await kv.get(AUTOSAVE_KEY);
    if (typeof text === 'string') out.push({ source: 'autosave', savedAt: savedAtOf(text), text });
  } catch {
    /* fall through to the journal */
  }
  const j = readJournal();
  if (j) out.push({ source: 'journal', savedAt: j.savedAt, text: j.text });
  return out;
}

/**
 * Keep the NEWEST of the stored autosave / journal under a timestamped key the app never overwrites; at most MAX_BACKUPS
 * are kept (oldest pruned). Never throws.
 */
export async function backupStoredAutosave(kv: KvStore = idbKv): Promise<void> {
  try {
    const pick = newest(await autosaveAndJournal(kv));
    if (!pick) return;
    const entries = (await kv.valuesWithPrefix(BACKUP_PREFIX)).filter((v): v is BackupEntry => !!v && typeof (v as BackupEntry).text === 'string' && typeof (v as BackupEntry).savedAt === 'string');
    const key = BACKUP_PREFIX + pick.savedAt;
    if (!entries.some((e) => e.savedAt === pick.savedAt)) {
      await kv.setMany([[key, { savedAt: pick.savedAt, text: pick.text } satisfies BackupEntry]]);
      entries.push({ savedAt: pick.savedAt, text: pick.text });
    }
    const stale = entries.map((e) => e.savedAt).sort().reverse().slice(MAX_BACKUPS);
    if (stale.length) await kv.deleteMany(stale.map((s) => BACKUP_PREFIX + s));
  } catch {
    /* nothing more can be done */
  }
}

/** The newest stored project among the autosave, the journal and the backups. */
export async function readRecoverable(kv: KvStore = idbKv): Promise<StoredCandidate | undefined> {
  return newest([...(await autosaveAndJournal(kv)), ...(await storedBackups(kv))]);
}

export async function readRecoverableText(kv: KvStore = idbKv): Promise<string | undefined> {
  return (await readRecoverable(kv))?.text;
}

/** Download the newest recoverable JSON as a file. Returns where it came from, or false when nothing is stored. */
export async function downloadRecoverableData(kv: KvStore = idbKv): Promise<RecoverySource | false> {
  const found = await readRecoverable(kv);
  if (!found || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([found.text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'recovered.schemacanvas.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return found.source;
}

/** URL-flag fallback for when sessionStorage is blocked: ?empty-start=1. */
export function requestEmptyStartViaUrl(): boolean {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set(EMPTY_START_QUERY, '1');
    window.location.assign(u.toString());
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes the URL flag (history.replaceState, no reload). */
export function consumeEmptyStartUrl(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get(EMPTY_START_QUERY) !== '1') return false;
    u.searchParams.delete(EMPTY_START_QUERY);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    return true;
  } catch {
    return false;
  }
}
