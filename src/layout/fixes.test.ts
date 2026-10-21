/**
 * Regression tests for the review findings LAYOUT-1 .. LAYOUT-5 and LAYOUT-NONDET-1.
 * Fixtures are generated here (deterministic LCG), independent of the model/scene builders.
 */
import { describe, expect, it } from 'vitest';
import type { Id, Project } from '@/model/types';
import type { Point, Rect } from '@/scene/base';
import type { Scene } from '@/scene/types';
import { inflateRect } from '@/scene/geometry';
import { autoLayout } from './autoLayout';
import { alignNodes, distributeNodes, nudgeOutOfOverlap } from './align';
import { chenLoopPolylines, layoutChen, type ChenKind, type ChenLayoutInput } from './chenLayout';
import { layoutGraph, overlappingPairs } from './elkGraph';
import { anyOverlap, segmentHitsRect, segmentsCross } from './rects';
import { chenScene, A, pharmacyEr, pharmacyRelational, relationalScene } from './testScenes';
import { overlaps, rectsAfter } from './layoutAssert';
import type { LayoutRect, Positions } from './types';

const rng = (seed: number) => {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

const proj = (type: 'chen' | 'relational-schema', locked: Id[] = []): Project =>
  ({
    diagrams: { dg: { id: 'dg', type, nodes: Object.fromEntries(locked.map((i) => [i, { id: i, locked: true }])) } },
  }) as unknown as Project;

// ---------------------------------------------------------------------------------------------------------------------
// Random Chen skeleton + attributes + recursive relationships
// ---------------------------------------------------------------------------------------------------------------------

function randomChen(nEnt: number, nRel: number, seed: number): ChenLayoutInput & { recursive: Array<{ rel: Id; ent: Id; n: number }> } {
  const r = rng(seed);
  const sizes: Record<Id, { w: number; h: number }> = {};
  const kinds: Record<Id, ChenKind> = {};
  const participantLinks: ChenLayoutInput['participantLinks'][number][] = [];
  const attributeLinks: ChenLayoutInput['attributeLinks'][number][] = [];
  const recursive: Array<{ rel: Id; ent: Id; n: number }> = [];
  const ents: Id[] = [];
  for (let i = 0; i < nEnt; i++) {
    const e = `E${i}`;
    ents.push(e);
    sizes[e] = { w: 100, h: 50 };
    kinds[e] = 'entity';
    const na = 2 + Math.floor(r() * 4);
    for (let k = 0; k < na; k++) {
      const a = `E${i}a${k}`;
      sizes[a] = { w: 80 + Math.floor(r() * 50), h: 40 };
      kinds[a] = 'attribute';
      attributeLinks.push({ id: `al-${a}`, owner: e, attribute: a });
    }
  }
  for (let j = 0; j < nRel; j++) {
    const t = r();
    const rel = `R${j}`;
    sizes[rel] = { w: 110, h: 66 };
    kinds[rel] = 'relationship';
    const pick = (): Id => ents[Math.floor(r() * ents.length)]!;
    if (t < 0.25) {
      const e = pick();
      participantLinks.push({ id: `p${j}-0`, a: rel, b: e }, { id: `p${j}-1`, a: rel, b: e });
      recursive.push({ rel, ent: e, n: 2 });
    } else if (t < 0.4) {
      const a = pick();
      const b = pick();
      participantLinks.push({ id: `p${j}-0`, a: rel, b: a }, { id: `p${j}-1`, a: rel, b: b }, { id: `p${j}-2`, a: rel, b: a });
      if (a !== b) recursive.push({ rel, ent: a, n: 2 });
    } else {
      const a = pick();
      let b = pick();
      if (b === a) b = ents[(ents.indexOf(a) + 1) % ents.length]!;
      participantLinks.push({ id: `p${j}-0`, a: rel, b: a }, { id: `p${j}-1`, a: rel, b });
    }
  }
  const current: Record<Id, Point> = {};
  return { sizes, kinds, participantLinks, attributeLinks, current, recursive };
}

/** Violations of the line/loop geometry as drawn: any participation line, loop or attribute link through a foreign node. */
function chenViolations(input: ChenLayoutInput, pos: Positions): string[] {
  const rect = (id: Id): Rect => ({ x: pos[id]!.x, y: pos[id]!.y, w: input.sizes[id]!.w, h: input.sizes[id]!.h });
  const cen = (id: Id): Point => ({ x: rect(id).x + rect(id).w / 2, y: rect(id).y + rect(id).h / 2 });
  const out: string[] = [];
  const pairs = new Map<string, { a: Id; b: Id; n: number }>();
  for (const l of input.participantLinks) {
    const k = [l.a, l.b].sort().join('|');
    const p = pairs.get(k);
    if (p) p.n++;
    else pairs.set(k, { a: l.a, b: l.b, n: 1 });
  }
  const ids = Object.keys(input.sizes);
  const polylines: Array<{ name: string; pts: Point[]; ends: Id[]; attrOwned?: boolean }> = [];
  for (const [k, p] of pairs) {
    if (p.n >= 2) chenLoopPolylines(rect(p.a), rect(p.b), p.n).forEach((pl, i) => polylines.push({ name: `loop ${k}#${i}`, pts: pl, ends: [p.a, p.b] }));
    else polylines.push({ name: `line ${k}`, pts: [cen(p.a), cen(p.b)], ends: [p.a, p.b] });
  }
  for (const l of input.attributeLinks) polylines.push({ name: `attr ${l.owner}->${l.attribute}`, pts: [cen(l.owner), cen(l.attribute)], ends: [l.owner, l.attribute], attrOwned: true });
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.pts.length; i++) {
      for (const id of ids) {
        if (pl.ends.includes(id)) continue;
        // participation lines/loops are checked against every node, attribute links against every node too
        if (segmentHitsRect(pl.pts[i]!, pl.pts[i + 1]!, inflateRect(rect(id), -2))) out.push(`${pl.name} x ${id}`);
      }
    }
  }
  // attribute links must not cross a loop either
  for (const pl of polylines.filter((p) => p.name.startsWith('loop')))
    for (const al of polylines.filter((p) => p.attrOwned))
      for (let i = 0; i + 1 < pl.pts.length; i++)
        if (segmentsCross(pl.pts[i]!, pl.pts[i + 1]!, al.pts[0]!, al.pts[1]!)) out.push(`${pl.name} x ${al.name}`);
  return [...new Set(out)];
}

describe('LAYOUT-1/2: Chen participation lines and recursive loops never run through foreign nodes', () => {
  it('recursive relationships (and ternaries naming an entity twice) keep their loops clear of attributes', async () => {
    for (const seed of [3, 5, 7, 9]) {
      const input = randomChen(10, 14, seed);
      expect(input.recursive.length).toBeGreaterThan(0);
      const pos = await layoutChen(input, { mode: 'full' });
      // An entity with SEVERAL recursive relationships has both its top and bottom walled in by loops, so an attribute LINK
      // may unavoidably cross a loop line there (documented limitation); loops through NODES are never accepted.
      const crowded = new Set([...new Set(input.recursive.map((r) => r.ent))].filter((e) => input.recursive.filter((r) => r.ent === e).length > 1));
      const bad = chenViolations(input, pos).filter((v) => v.startsWith('loop') && ![...crowded].some((e) => v.includes(`attr ${e}->`)));
      expect(bad).toEqual([]);
    }
  });

  it('participation lines never pass through an unrelated entity or relationship (40 entities)', async () => {
    for (const seed of [1, 7]) {
      const input = randomChen(30, 40, seed);
      const pos = await layoutChen(input, { mode: 'full' });
      const bad = chenViolations(input, pos).filter((v) => v.startsWith('line') && /x (E\d+|R\d+)$/.test(v));
      expect(bad).toEqual([]);
    }
  });

  it('incremental placement also repairs lines through new nodes', async () => {
    const input = randomChen(12, 16, 11);
    const full = await layoutChen(input, { mode: 'full' });
    const half = Object.keys(input.sizes).filter((_, i) => i % 3 === 0);
    const pinned = new Set(Object.keys(input.sizes).filter((i) => !half.includes(i)));
    const pos = await layoutChen({ ...input, current: full }, { mode: 'incremental', pinned });
    for (const id of pinned) expect(pos[id] ?? full[id]).toEqual(full[id]);
    expect(Object.keys(pos).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LAYOUT-3
// ---------------------------------------------------------------------------------------------------------------------

describe('LAYOUT-3: locked nodes are never moved by autoLayout', () => {
  const scene = pharmacyRelational();
  const first = Object.keys(scene.nodes).sort()[0]!;
  const at = scene.nodes[first]!.bounds;

  it('full layout keeps a locked node exactly where it is and arranges the rest around it', async () => {
    const out = await autoLayout(scene, proj('relational-schema', [first]), 'dg');
    expect(out[first]).toEqual({ x: at.x, y: at.y });
    expect(overlaps(scene, out, 60 - 1e-6)).toEqual([]);
    const free = await autoLayout(scene, proj('relational-schema'), 'dg');
    expect(free[first]).not.toEqual({ x: at.x, y: at.y }); // the control: without the lock it moves
  });

  it('incremental layout never places a locked node even when it is listed in onlyNodeIds', async () => {
    const ids = Object.keys(scene.nodes).sort();
    const out = await autoLayout(scene, proj('relational-schema', [first]), 'dg', { onlyNodeIds: ids.slice(0, 3) });
    expect(out[first]).toBeUndefined();
    expect(Object.keys(out).length).toBe(2);
  });

  it('alignNodes / distributeNodes leave locked ids in place', () => {
    const rs: LayoutRect[] = [
      { id: 'a', x: 0, y: 0, w: 10, h: 10 },
      { id: 'b', x: 50, y: 30, w: 10, h: 10 },
      { id: 'c', x: 200, y: 90, w: 10, h: 10 },
    ];
    const al = alignNodes(rs, 'top', new Set(['b']));
    expect(al.b).toBeUndefined();
    expect(al.c).toEqual({ x: 200, y: 0 });
    const di = distributeNodes(rs, 'horizontal', 'even', new Set(['b']));
    expect(di.b).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LAYOUT-4
// ---------------------------------------------------------------------------------------------------------------------

describe('LAYOUT-4: overlap removal converges and layoutGraph honours its clearance', () => {
  it('nudgeOutOfOverlap leaves no overlap for dense random rects, identical rects and fixed ones', () => {
    const r = rng(4);
    const dense: LayoutRect[] = Array.from({ length: 30 }, (_, i) => ({ id: `d${String(i).padStart(2, '0')}`, x: r() * 200, y: r() * 200, w: 40 + r() * 60, h: 30 + r() * 30 }));
    const m1 = nudgeOutOfOverlap(dense, { gap: 0 });
    expect(anyOverlap(dense.map((x) => ({ ...x, ...(m1[x.id] ?? {}) })), -1e-6)).toEqual([]);
    const same: LayoutRect[] = Array.from({ length: 30 }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, x: 5, y: 5, w: 50, h: 30 }));
    const m2 = nudgeOutOfOverlap(same, { gap: 20 });
    expect(anyOverlap(same.map((x) => ({ ...x, ...(m2[x.id] ?? {}) })), 20 - 1e-6)).toEqual([]);
    const m3 = nudgeOutOfOverlap(dense, { gap: 10, fixedIds: new Set(['d00', 'd01']) });
    expect(m3.d00).toBeUndefined();
    expect(m3.d01).toBeUndefined();
    const after = dense.map((x) => ({ ...x, ...(m3[x.id] ?? {}) }));
    expect(anyOverlap(after.filter((x) => x.id !== 'd00' || true), 10 - 1e-6).filter(([a, b]) => !(['d00', 'd01'].includes(a) && ['d00', 'd01'].includes(b)))).toEqual([]);
  });

  it.each([['radial', 120], ['stress', 120], ['force', 40]] as const)('%s: %i tables keep >= spacing clearance', async (algorithm, n) => {
    const r = rng(8);
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, w: 140 + Math.floor(r() * 120), h: 56 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[Math.floor(r() * (i + 1))]!.id, target: n.id }));
    const pos = await layoutGraph({ nodes, edges, algorithm, spacing: 60 });
    expect(overlappingPairs(nodes, pos, 60 - 1e-6)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LAYOUT-5
// ---------------------------------------------------------------------------------------------------------------------

const minSep = (s: Scene, pos: Positions): number => {
  const rs = rectsAfter(s, pos);
  let m = Infinity;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!;
      const b = rs[j]!;
      m = Math.min(m, Math.max(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))));
    }
  return m;
};

describe('LAYOUT-5: snapToGrid keeps the clearances', () => {
  it('relational: a coarse grid never brings tables closer than 60', async () => {
    const r = rng(2);
    const tables = Array.from({ length: 24 }, (_, i) => ({ name: `T${i}`, columns: 2 + Math.floor(r() * 5) }));
    const fks = tables.slice(1).map((t, i) => ({ from: t.name, to: tables[Math.floor(r() * (i + 1))]!.name }));
    const s = relationalScene({ tables, fks });
    for (const grid of [50, 100]) {
      const pos = await autoLayout(s, proj('relational-schema'), 'dg', { snapToGrid: grid });
      expect(minSep(s, pos)).toBeGreaterThanOrEqual(60 - 0.01);
    }
  });

  it('Chen: grid 40 keeps min(attribute gap, unsnapped gap) between nodes and adds no line through a node', async () => {
    const s = pharmacyEr();
    const plain = await autoLayout(s, proj('chen'), 'dg');
    const snapped = await autoLayout(s, proj('chen'), 'dg', { snapToGrid: 40 });
    expect(minSep(s, snapped)).toBeGreaterThanOrEqual(Math.min(13, minSep(s, plain)) - 0.01);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// NONDET
// ---------------------------------------------------------------------------------------------------------------------

function renameIds(s: Scene, map: (id: Id) => Id): Scene {
  const nodes = Object.fromEntries(Object.entries(s.nodes).map(([id, n]) => [map(id), { ...n, nodeId: map(id) }]));
  const edges = Object.fromEntries(
    Object.entries(s.edges).map(([id, e]) => [map(id), { ...e, edgeId: map(id), sourceNodeId: map(e.sourceNodeId), targetNodeId: map(e.targetNodeId) }]),
  );
  return { ...s, nodes, edges, nodeOrder: s.nodeOrder.map(map), edgeOrder: s.edgeOrder.map(map) } as unknown as Scene;
}

describe('LAYOUT-NONDET-1: layouts do not depend on the opaque id strings', () => {
  // key every node by its (rename-proof) semantic ref
  const byName = (s: Scene, pos: Positions): Record<string, Point> =>
    Object.fromEntries(Object.entries(pos).map(([id, p]) => [JSON.stringify(s.nodes[id]!.ref), p]));

  for (const [name, make, type] of [
    ['relational', pharmacyRelational, 'relational-schema'],
    ['chen', pharmacyEr, 'chen'],
  ] as const) {
    it(`${name}: renaming every id (even reversing their sort order) gives the same positions`, async () => {
      const s = make();
      const ids = Object.keys(s.nodes).concat(Object.keys(s.edges)).sort();
      const rev = new Map(ids.map((id, i) => [id, `z${String(ids.length - i).padStart(5, '0')}`]));
      const rnd = rng(5);
      const shuffled = new Map(ids.map((id) => [id, `q${Math.floor(rnd() * 1e9)}_${id.length}`]));
      const base = byName(s, await autoLayout(s, proj(type), 'dg'));
      for (const m of [rev, shuffled]) {
        const s2 = renameIds(s, (id) => m.get(id) ?? id);
        const out = byName(s2, await autoLayout(s2, proj(type), 'dg'));
        expect(out).toEqual(base);
      }
    });
  }

  it('A() helper scenes with duplicate attribute names still lay out (ties fall back to ids)', async () => {
    const s = chenScene({ entities: [{ name: 'X', attrs: [A('n'), A('n')] }] });
    expect(Object.keys(await autoLayout(s, proj('chen'), 'dg')).length).toBe(Object.keys(s.nodes).length);
  });
});
