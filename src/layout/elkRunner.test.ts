/** ELK runner: worker path == in-thread path (same ELK build, same seed), fallbacks, stale-request cancel, busy flag. */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@/model/types';
import { autoLayout } from './autoLayout';
import { configureElk, disposeElk, elkStats, isAbortError, runElk } from './elkRunner';
import { layoutBusyStore } from './layoutBusy';
import { layoutGraph } from './elkGraph';
import { pharmacyEr, pharmacyRelational } from './testScenes';

const proj = (type: 'relational-schema' | 'chen'): Project => ({ diagrams: { dg: { id: 'dg', type } } }) as unknown as Project;

/** elkjs ships an in-process `Worker` stand-in that speaks the exact same message protocol as the browser worker. */
const require_ = createRequire(import.meta.url);
const FakeWorker = (require_('elkjs/lib/elk-worker.min.js') as { Worker: new (url?: string) => unknown }).Worker;
const fakeFactory = (): Worker => new FakeWorker() as unknown as Worker;

afterEach(() => {
  configureElk({ mode: 'auto', workerFactory: undefined });
  disposeElk();
});

describe('worker engine == in-thread engine', () => {
  for (const [name, scene, type] of [
    ['Pharmacy relational (layered)', pharmacyRelational, 'relational-schema'],
    ['Pharmacy ER (Chen, stress skeleton)', pharmacyEr, 'chen'],
  ] as const) {
    it(`${name}: identical positions`, async () => {
      configureElk({ mode: 'thread' });
      const inThread = await autoLayout(scene(), proj(type), 'dg');
      configureElk({ mode: 'worker', workerFactory: fakeFactory });
      const viaWorker = await autoLayout(scene(), proj(type), 'dg');
      expect(elkStats.usedWorker).toBe(true);
      expect(Object.keys(viaWorker).length).toBeGreaterThan(5);
      expect(viaWorker).toEqual(inThread);
    });
  }

  it('also for the other algorithms and directions of layoutGraph', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, w: 90 + (i % 3) * 20, h: 30, sortKey: `k${i}` }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: `n${Math.floor(i / 2)}`, target: n.id }));
    for (const algorithm of ['layered', 'stress', 'force', 'radial', 'rectpacking'] as const) {
      configureElk({ mode: 'thread' });
      const a = await layoutGraph({ nodes, edges, algorithm, direction: 'RIGHT', seed: 7 });
      configureElk({ mode: 'worker', workerFactory: fakeFactory });
      const b = await layoutGraph({ nodes, edges, algorithm, direction: 'RIGHT', seed: 7 });
      expect(b).toEqual(a);
    }
  });
});

describe('fallbacks', () => {
  const graph = { id: 'r', layoutOptions: { 'elk.algorithm': 'layered' }, children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }], edges: [] };

  it('a Worker that cannot be constructed falls back to the in-thread engine (auto mode)', async () => {
    configureElk({
      mode: 'auto',
      workerFactory: () => {
        throw new Error('no workers here');
      },
    });
    const r = await runElk(graph);
    expect(r.children).toHaveLength(2);
    expect(elkStats.usedWorker).toBe(false);
  });

  it('without a Worker global (node/jsdom) auto mode runs in-thread', async () => {
    expect(typeof Worker).toBe('undefined');
    configureElk({ mode: 'auto', workerFactory: undefined });
    expect((await runElk(graph)).children).toHaveLength(2);
    expect(elkStats.usedWorker).toBe(false);
  });
});

describe('stale requests and the busy flag', () => {
  it('an aborted request rejects with AbortError, never a grid layout; later requests still work', async () => {
    configureElk({ mode: 'worker', workerFactory: fakeFactory });
    const ac = new AbortController();
    const nodes = [{ id: 'a', w: 10, h: 10 }, { id: 'b', w: 10, h: 10 }];
    const p = layoutGraph({ nodes, edges: [{ id: 'e', source: 'a', target: 'b' }], algorithm: 'layered', signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
    const ok = await layoutGraph({ nodes, edges: [], algorithm: 'layered' });
    expect(Object.keys(ok)).toEqual(['a', 'b']);
    const pre = new AbortController();
    pre.abort();
    await expect(autoLayout(pharmacyRelational(), proj('relational-schema'), 'dg', { signal: pre.signal })).rejects.toSatisfy(isAbortError);
  });

  it('layoutBusyStore is busy while a layout runs and idle afterwards (also after errors)', async () => {
    configureElk({ mode: 'worker', workerFactory: fakeFactory });
    const seen: number[] = [];
    const un = layoutBusyStore.subscribe((s) => seen.push(s.pending));
    expect(layoutBusyStore.getState().pending).toBe(0);
    const p = autoLayout(pharmacyRelational(), proj('relational-schema'), 'dg');
    expect(layoutBusyStore.getState().pending).toBeGreaterThan(0);
    await p;
    expect(layoutBusyStore.getState().pending).toBe(0);
    const ac = new AbortController();
    ac.abort();
    await autoLayout(pharmacyRelational(), proj('relational-schema'), 'dg', { signal: ac.signal }).catch(() => undefined);
    expect(layoutBusyStore.getState().pending).toBe(0);
    un();
    expect(Math.max(...seen)).toBeGreaterThan(0);
  });
});
