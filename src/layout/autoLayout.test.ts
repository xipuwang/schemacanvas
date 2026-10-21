import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import type { Project } from '@/model/types';
import type { Scene } from '@/scene/types';
import { autoLayout } from './autoLayout';
import { allFinite, overlaps, rectsAfter } from './layoutAssert';
import { chenScene, A, hTableNode, pharmacyRelational, relationalScene, sceneOf, fkEdge } from './testScenes';

const proj = (type: 'relational-schema' | 'crows-foot' | 'physical' = 'relational-schema'): Project =>
  deepFreeze({ diagrams: { dg: { id: 'dg', type } } } as unknown as Project);

describe('relational autoLayout', () => {
  const scene = deepFreeze(pharmacyRelational());

  it('Pharmacy: all tables placed, >= 60 clearance in every direction, parents above children', async () => {
    const out = await autoLayout(scene, proj(), 'dg');
    expect(Object.keys(out).sort()).toEqual(Object.keys(scene.nodes).sort());
    expect(allFinite(out)).toBe(true);
    expect(overlaps(scene, out, 60 - 1e-6)).toEqual([]);
    const y = (n: string): number => out[`t:${n}`]!.y;
    expect(y('Doctor')).toBeLessThan(y('Patient'));
    expect(y('Patient')).toBeLessThan(y('Prescription'));
    expect(y('Company')).toBeLessThan(y('Drug'));
    expect(y('Drug')).toBeLessThan(y('Sells'));
  });

  it('RIGHT flows left to right; works for crows-foot and physical diagrams too', async () => {
    const out = await autoLayout(scene, proj('crows-foot'), 'dg', { direction: 'RIGHT' });
    expect(out['t:Doctor']!.x).toBeLessThan(out['t:Patient']!.x);
    expect(overlaps(scene, out, 60 - 1e-6)).toEqual([]);
    const phys = await autoLayout(scene, proj('physical'), 'dg');
    expect(allFinite(phys)).toBe(true);
  });

  it('spacing option is honoured but never below 60', async () => {
    const out = await autoLayout(scene, proj(), 'dg', { spacing: 120 });
    expect(overlaps(scene, out, 120 - 1e-6)).toEqual([]);
    const tight = await autoLayout(scene, proj(), 'dg', { spacing: 10 });
    expect(overlaps(scene, tight, 60 - 1e-6)).toEqual([]);
  });

  it('deterministic and independent of object key order', async () => {
    const a = await autoLayout(scene, proj(), 'dg');
    const reordered: Scene = {
      ...scene,
      nodes: Object.fromEntries(Object.entries(scene.nodes).reverse()),
      edges: Object.fromEntries(Object.entries(scene.edges).reverse()),
    };
    expect(await autoLayout(reordered, proj(), 'dg')).toEqual(a);
    expect(await autoLayout(scene, proj(), 'dg')).toEqual(a);
  });

  it('self-referencing FK and parallel FKs do not disturb ranking; no FK at all is fine', async () => {
    const base = relationalScene({
      tables: [{ name: 'Employee', columns: 4 }, { name: 'Dept', columns: 2 }],
      fks: [{ from: 'Employee', to: 'Employee' }, { from: 'Employee', to: 'Dept' }, { from: 'Employee', to: 'Dept' }],
    });
    const out = await autoLayout(deepFreeze(base), proj(), 'dg');
    expect(out['t:Dept']!.y).toBeLessThan(out['t:Employee']!.y);
    const none = relationalScene({ tables: [{ name: 'A', columns: 2 }, { name: 'B', columns: 3 }, { name: 'C', columns: 1 }], fks: [] });
    const o2 = await autoLayout(deepFreeze(none), proj(), 'dg');
    expect(overlaps(none, o2, 60 - 1e-6)).toEqual([]);
    const one = sceneOf([hTableNode('t:X', 'X', 3, 77, 33)], []);
    expect(await autoLayout(deepFreeze(one), proj(), 'dg')).toEqual({ 't:X': { x: 77, y: 33 } }); // origin = current top-left
  });

  it('hub table with 6 FKs: parents form one row above the hub, no overlap', async () => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const s = relationalScene({
      tables: [...names.map((n) => ({ name: n, columns: 3 })), { name: 'Hub', columns: 10 }],
      fks: names.map((n) => ({ from: 'Hub', to: n })),
    });
    const out = await autoLayout(deepFreeze(s), proj(), 'dg');
    expect(new Set(names.map((n) => out[`t:${n}`]!.y)).size).toBe(1);
    expect(out['t:Hub']!.y).toBeGreaterThan(out['t:P1']!.y);
    expect(overlaps(s, out, 60 - 1e-6)).toEqual([]);
  });

  it('snapToGrid aligns moved tables and keeps the 60 clearance (grid 10)', async () => {
    const out = await autoLayout(scene, proj(), 'dg', { snapToGrid: 10 });
    for (const p of Object.values(out)) {
      expect(p.x % 10).toBe(0);
      expect(p.y % 10).toBe(0);
    }
    expect(overlaps(scene, out, 50)).toEqual([]);
  });

  it('keepFixed pins tables exactly', async () => {
    const pinnedAt = deepFreeze({
      ...scene,
      nodes: { ...scene.nodes, 't:Drug': { ...scene.nodes['t:Drug']!, bounds: { ...scene.nodes['t:Drug']!.bounds, x: 800, y: 400 } } },
    }) as Scene;
    const out = await autoLayout(pinnedAt, proj(), 'dg', { keepFixed: ['t:Drug'] });
    expect(out['t:Drug']).toEqual({ x: 800, y: 400 });
    expect(overlaps(pinnedAt, out, 50)).toEqual([]);
  });
});

describe('relational incremental (onlyNodeIds)', () => {
  async function laid(): Promise<Scene> {
    const base = pharmacyRelational();
    const out = await autoLayout(base, proj(), 'dg');
    const nodes = Object.fromEntries(
      Object.entries(base.nodes).map(([id, n]) => {
        const dx = out[id]!.x - n.bounds.x;
        const dy = out[id]!.y - n.bounds.y;
        const mv = (r: { x: number; y: number; w: number; h: number }) => ({ ...r, x: r.x + dx, y: r.y + dy });
        return [id, { ...n, bounds: mv(n.bounds), paintBounds: mv(n.paintBounds), outline: { ...n.outline, rect: mv(n.outline.rect) } }];
      }),
    ) as Scene['nodes'];
    return { ...base, nodes };
  }

  it('a new child table lands below its parent, in free space, leaving everything else bit-identical', async () => {
    const placed = await laid();
    const extra = hTableNode('t:Refill', 'Refill', 4, 0, 0);
    const scene = deepFreeze({
      ...placed,
      nodes: { ...placed.nodes, [extra.nodeId]: extra },
      edges: { ...placed.edges, 'fk:new': fkEdge('fk:new', extra, placed.nodes['t:Prescription']!) },
    } as Scene);
    const out = await autoLayout(scene, proj(), 'dg', { onlyNodeIds: ['t:Refill'] });
    expect(Object.keys(out)).toEqual(['t:Refill']);
    const parent = scene.nodes['t:Prescription']!.bounds;
    expect(out['t:Refill']!.y).toBeGreaterThan(parent.y + parent.h);
    const all = { ...Object.fromEntries(Object.entries(scene.nodes).map(([id, n]) => [id, { x: n.bounds.x, y: n.bounds.y }])), ...out };
    expect(overlaps(scene, all, 60 - 1e-6)).toEqual([]);
  });

  it('a new parent table lands above its child; two new tables in a chain are both placed', async () => {
    const placed = await laid();
    const a = hTableNode('t:Insurer', 'Insurer', 3, 0, 0);
    const b = hTableNode('t:Plan', 'Plan', 3, 0, 0);
    const scene = deepFreeze({
      ...placed,
      nodes: { ...placed.nodes, [a.nodeId]: a, [b.nodeId]: b },
      edges: {
        ...placed.edges,
        e1: fkEdge('e1', placed.nodes['t:Patient']!, a), // Patient -> Insurer: new parent
        e2: fkEdge('e2', a, b), // Insurer -> Plan
      },
    } as Scene);
    const out = await autoLayout(scene, proj(), 'dg', { onlyNodeIds: ['t:Insurer', 't:Plan'] });
    expect(Object.keys(out).sort()).toEqual(['t:Insurer', 't:Plan']);
    expect(out['t:Insurer']!.y).toBeLessThan(scene.nodes['t:Patient']!.bounds.y);
    const all = { ...Object.fromEntries(Object.entries(scene.nodes).map(([id, n]) => [id, { x: n.bounds.x, y: n.bounds.y }])), ...out };
    expect(overlaps(scene, all, 60 - 1e-6)).toEqual([]);
  });

  it('new unconnected tables are stacked below the content, and an all-new set is a full layout', async () => {
    const placed = await laid();
    const z = hTableNode('t:Zed', 'Zed', 2, 0, 0);
    const scene = deepFreeze({ ...placed, nodes: { ...placed.nodes, [z.nodeId]: z } } as Scene);
    const out = await autoLayout(scene, proj(), 'dg', { onlyNodeIds: ['t:Zed'] });
    const bottom = Math.max(...rectsAfter(placed, {}).map((r) => r.y + r.h));
    expect(out['t:Zed']!.y).toBeGreaterThanOrEqual(bottom + 60);
    const every = await autoLayout(placed, proj(), 'dg', { onlyNodeIds: Object.keys(placed.nodes) });
    expect(Object.keys(every).length).toBe(Object.keys(placed.nodes).length);
  });
});

describe('frozen inputs and performance', () => {
  it('never mutates a deeply frozen scene (chen and relational)', async () => {
    const chen = deepFreeze(chenScene({ entities: [{ name: 'E', attrs: [A('k', { key: true })] }] }));
    await expect(autoLayout(chen, deepFreeze({ diagrams: { dg: { type: 'chen' } } } as unknown as Project), 'dg')).resolves.toBeDefined();
    await expect(autoLayout(deepFreeze(pharmacyRelational()), proj(), 'dg', { snapToGrid: 20 })).resolves.toBeDefined();
  });

  it('empty scene returns {}', async () => {
    expect(await autoLayout(deepFreeze(sceneOf([], [])), proj(), 'dg')).toEqual({});
  });

  it('performance report: 60-entity Chen diagram (~300 nodes) and a 150-table schema', async () => {
    const entities = Array.from({ length: 60 }, (_, i) => ({ name: `E${i}`, attrs: [A('id', { key: true }), A('a'), A('b'), A('c')] }));
    const relationships = Array.from({ length: 59 }, (_, i) => ({ name: `R${i}`, participants: [`E${i}`, `E${i + 1}`] }));
    const chen = deepFreeze(chenScene({ entities, relationships }));
    let t0 = performance.now();
    const c = await autoLayout(chen, deepFreeze({ diagrams: { dg: { type: 'chen' } } } as unknown as Project), 'dg');
    const chenMs = Math.round(performance.now() - t0);
    expect(overlaps(chen, c, 8)).toEqual([]);
    const tables = Array.from({ length: 150 }, (_, i) => ({ name: `T${i}`, columns: 4 + (i % 5) }));
    const fks = tables.slice(1).map((t, i) => ({ from: t.name, to: tables[Math.floor(i / 2)]!.name }));
    const rel = deepFreeze(relationalScene({ tables, fks }));
    t0 = performance.now();
    const r = await autoLayout(rel, proj(), 'dg');
    const relMs = Math.round(performance.now() - t0);
    expect(overlaps(rel, r, 60 - 1e-6)).toEqual([]);
    console.log(`[autoLayout perf] chen ${Object.keys(chen.nodes).length} nodes=${chenMs}ms, relational 150 tables=${relMs}ms`);
    expect(chenMs).toBeLessThan(20_000);
    expect(relMs).toBeLessThan(10_000);
  }, 60_000);
});
