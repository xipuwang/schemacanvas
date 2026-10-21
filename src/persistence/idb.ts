/**
 * A deliberately tiny key-value layer over IndexedDB (one database, one object store, string keys, structured-clone
 * values). Hand-written to avoid a dependency; every method rejects with `PersistenceUnavailableError` when IndexedDB
 * cannot be used, and callers (storage.ts) translate that into a `PersistenceStatus`.
 */
export class PersistenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnavailableError';
  }
}

export interface KvStore {
  get(key: string): Promise<unknown>;
  /** All writes happen in ONE transaction: either every entry lands or none does. */
  setMany(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  deleteMany(keys: readonly string[]): Promise<void>;
  /** Values whose key starts with `prefix`, ordered by key. */
  valuesWithPrefix(prefix: string): Promise<unknown[]>;
  clear(): Promise<void>;
}

export const DB_NAME = 'schemacanvas';
const STORE = 'kv';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return Promise.reject(new PersistenceUnavailableError('IndexedDB is not available in this browser context'));
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION); // throws SecurityError when storage is blocked
    } catch (e) {
      reject(new PersistenceUnavailableError(`IndexedDB could not be opened: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema must not hang on our handle.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === p) dbPromise = undefined;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(new PersistenceUnavailableError(`IndexedDB could not be opened: ${request.error?.message ?? 'unknown error'}`));
    request.onblocked = () => reject(new PersistenceUnavailableError('IndexedDB open was blocked by another tab'));
  });
  dbPromise = p;
  // A failed open must not be cached forever (the user may free storage / close the other tab).
  p.catch(() => {
    if (dbPromise === p) dbPromise = undefined;
  });
  return p;
}

/** Close the shared handle (tests; also lets `indexedDB.deleteDatabase` proceed). */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = undefined;
  if (p) (await p.catch(() => undefined))?.close();
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function write(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const done = transactionDone(tx);
  try {
    fn(tx.objectStore(STORE));
  } catch (e) {
    // A synchronous failure (e.g. DataCloneError) would otherwise let the already-queued puts commit: abort for atomicity.
    done.catch(() => undefined);
    tx.abort();
    throw e;
  }
  await done;
}

export const idbKv: KvStore = {
  async get(key) {
    const db = await openDb();
    return requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  },
  setMany: (entries) =>
    write('readwrite', (s) => {
      for (const [k, v] of entries) s.put(v, k);
    }),
  deleteMany: (keys) =>
    write('readwrite', (s) => {
      for (const k of keys) s.delete(k);
    }),
  async valuesWithPrefix(prefix) {
    const db = await openDb();
    // '￿' sorts after every character a key realistically contains.
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
    return requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range));
  },
  clear: () => write('readwrite', (s) => void s.clear()),
};
