/**
 * Runs ELK, off the main thread when the platform allows it.
 *
 *  - Browser: a dedicated Web Worker (`elkWorker.ts`), created on the first layout and reused. Nothing else on the page
 *    freezes while ELK works (1-4 s for 60+ entities).
 *  - Node / vitest / jsdom (no `Worker`), a Worker that cannot be constructed, or one that dies: the bundled in-thread
 *    ELK (`elkjs/lib/elk.bundled.js`), loaded lazily. Both run the same ELK build with the same options and seed, so results
 *    are identical (src/layout/elkRunner.test.ts compares them on the Pharmacy fixtures).
 *  - Stale requests: pass an `AbortSignal`; an aborted request rejects with an `AbortError` right away, its late result is
 *    ignored, and when nothing else is waiting the worker is terminated so the CPU is freed (the next layout starts a new one).
 *
 * `layoutBusyStore` (layoutBusy.ts) is incremented around every run.
 */
import type { ELK as ElkApi, ElkNode } from 'elkjs/lib/elk-api';
import { trackLayoutBusy } from './layoutBusy';

export type ElkMode = 'auto' | 'worker' | 'thread';

let mode: ElkMode = 'auto';
let workerFactoryOverride: (() => Worker) | undefined;
let threadElk: Promise<ElkApi> | undefined;

/** Test hook: force a mode (`auto` = worker when available) and/or inject the Worker factory. */
export function configureElk(opts: { mode?: ElkMode; workerFactory?: (() => Worker) | undefined } = {}): void {
  if (opts.mode) mode = opts.mode;
  if ('workerFactory' in opts) workerFactoryOverride = opts.workerFactory;
  disposeElk();
}

/** True once at least one layout ran inside a worker (diagnostics / e2e). */
let usedWorker = false;
export const elkStats = { get usedWorker(): boolean { return usedWorker; }, workersCreated: 0 };

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';
const abortError = (): Error => Object.assign(new Error('Layout aborted'), { name: 'AbortError' });

function inThread(): Promise<ElkApi> {
  threadElk ??= import('elkjs/lib/elk.bundled.js').then((m) => new (m.default as unknown as new () => ElkApi)());
  return threadElk;
}

interface WorkerClient {
  elk: ElkApi;
  worker: Worker;
  live: number;
  dead: boolean;
  failHandlers: Set<(e: Error) => void>;
}

let client: Promise<WorkerClient> | undefined;
let workerBroken = false;

const workerAvailable = (): boolean => mode !== 'thread' && !workerBroken && (workerFactoryOverride !== undefined || typeof Worker !== 'undefined');

async function createClient(): Promise<WorkerClient> {
  let factory = workerFactoryOverride;
  let Api: new (o: object) => ElkApi;
  if (factory) {
    Api = (await import('elkjs/lib/elk-api')).default as unknown as new (o: object) => ElkApi;
  } else {
    const m = await import('./elkWorker');
    factory = m.createElkWorker;
    Api = m.ELK as unknown as new (o: object) => ElkApi;
  }
  let worker!: Worker;
  const elk = new Api({
    workerFactory: () => {
      worker = factory!();
      return worker;
    },
  });
  const c: WorkerClient = { elk, worker, live: 0, dead: false, failHandlers: new Set() };
  elkStats.workersCreated++;
  const fail = (e: unknown): void => {
    if (c.dead) return;
    c.dead = true;
    workerBroken = true; // do not try again: fall back to the in-thread ELK from now on
    const err = e instanceof Error ? e : new Error('ELK worker failed');
    for (const h of [...c.failHandlers]) h(err);
    c.failHandlers.clear();
    try {
      worker.terminate?.();
    } catch {
      /* already gone */
    }
    if (client) void client.then((x) => x === c && (client = undefined));
  };
  worker.addEventListener?.('error', (ev: Event) => fail(new Error((ev as ErrorEvent).message || 'ELK worker failed')));
  worker.addEventListener?.('messageerror', () => fail(new Error('ELK worker message error')));
  return c;
}

function getClient(): Promise<WorkerClient> {
  client ??= createClient().catch((e: unknown) => {
    client = undefined;
    workerBroken = true;
    throw e;
  });
  return client;
}

async function runInWorker(graph: ElkNode, signal: AbortSignal | undefined): Promise<ElkNode> {
  const c = await getClient();
  if (c.dead) throw new Error('ELK worker failed');
  if (signal?.aborted) throw abortError();
  c.live++;
  return new Promise<ElkNode>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      c.live--;
      c.failHandlers.delete(onFail);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onFail = (e: Error): void => finish(() => reject(e));
    const onAbort = (): void => {
      finish(() => reject(abortError()));
      if (c.live <= 0 && !c.dead) {
        // Nobody else waits for this worker: kill the (possibly seconds-long) computation.
        c.dead = true;
        try {
          c.worker.terminate?.();
        } catch {
          /* ignore */
        }
        if (client) void client.then((x) => x === c && (client = undefined));
      }
    };
    c.failHandlers.add(onFail);
    signal?.addEventListener('abort', onAbort, { once: true });
    c.elk.layout(graph).then(
      (r) => finish(() => resolve(r)),
      (e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/** Lay out one ELK graph. Rejects with an `AbortError` when `signal` aborts first; otherwise with ELK's own error. */
export function runElk(graph: ElkNode, signal?: AbortSignal): Promise<ElkNode> {
  return trackLayoutBusy(async () => {
    if (signal?.aborted) throw abortError();
    if (workerAvailable()) {
      try {
        const r = await runInWorker(graph, signal);
        usedWorker = true;
        return r;
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (mode === 'worker') throw e;
        // worker could not be built or died: fall through to the in-thread engine
      }
    }
    const elk = await inThread();
    if (signal?.aborted) throw abortError();
    return elk.layout(graph);
  });
}

/** Terminates the worker and drops the cached engines (tests, hot reload). */
export function disposeElk(): void {
  const c = client;
  client = undefined;
  workerBroken = false;
  usedWorker = false;
  if (c) void c.then((x) => (x.dead = true, x.worker.terminate?.()), () => undefined);
}
