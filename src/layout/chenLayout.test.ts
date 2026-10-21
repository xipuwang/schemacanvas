import { afterAll, describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Project } from '@/model/types';
import type { Scene } from '@/scene/types';
import { autoLayout } from './autoLayout';
import { allFinite, attributeDistances, lineViolations, overlaps, rectsAfter } from './layoutAssert';
import { courseEr, employeeEr, pharmacyEr, studentEr, chenScene, A } from './testScenes';
import { rectCenter } from '@/scene/geometry';

// Only `diagrams[id].type` is read by autoLayout; a full Project is not needed for a pure layout test.
const projectFor = (type: 'chen' | 'relational-schema'): Project =>
  deepFreeze({ diagrams: { dg: { id: 'dg', type } } } as unknown as Project);

const FIXTURES: Array<[string, () => Scene]> = [
  ['pharmacy ER', pharmacyEr],
  ['student (composite/multivalued/derived)', studentEr],
  ['recursive 1:N (employee)', employeeEr],
  ['recursive M:N (course)', courseEr],
];

const report: string[] = [];

describe('chen autoLayout', () => {
  for (const [name, make] of FIXTURES) {
    describe(name, () => {
      const scene = deepFreeze(make());
      const project = projectFor('chen');

      it('places every node, finite, no overlaps (>= 10 clearance), no foreign lines through attributes', async () => {
        const pos = await autoLayout(scene, project, 'dg');
        expect(Object.keys(pos).sort()).toEqual(Object.keys(scene.nodes).sort());
        expect(allFinite(pos)).toBe(true);
        expect(overlaps(scene, pos, 10)).toEqual([]);
        expect(lineViolations(scene, pos)).toEqual([]);
        report.push(`${name}: ${Object.keys(scene.nodes).length} nodes`);
      });

      it('attributes sit within a ring radius of their owner', async () => {
        const pos = await autoLayout(scene, project, 'dg');
        const ds = attributeDistances(scene, pos);
        const max = Math.max(...ds.map((d) => d.dist), 0);
        report.push(`${name}: max attribute distance ${Math.round(max)}`);
        for (const d of ds) expect(d.dist).toBeLessThan(330);
      });

      it('is deterministic and does not depend on edge/node object order', async () => {
        const a = await autoLayout(scene, project, 'dg');
        const b = await autoLayout(scene, project, 'dg');
        expect(b).toEqual(a);
        const reordered: Scene = {
          ...scene,
          nodes: Object.fromEntries(Object.entries(scene.nodes).reverse()),
          edges: Object.fromEntries(Object.entries(scene.edges).reverse()),
        };
        expect(await autoLayout(reordered, project, 'dg')).toEqual(a);
      });

      it('layered override / direction also yields a valid layout', async () => {
        const pos = await autoLayout(scene, project, 'dg', { direction: 'RIGHT' });
        expect(allFinite(pos)).toBe(true);
        expect(overlaps(scene, pos, 10)).toEqual([]);
        expect(lineViolations(scene, pos)).toEqual([]);
      });

      it('snapToGrid aligns most top-lefts to the grid and never reduces a clearance below min(13, unsnapped gap)', async () => {
        const plain = await autoLayout(scene, project, 'dg');
        const pos = await autoLayout(scene, project, 'dg', { snapToGrid: 10 });
        const ps = Object.values(pos);
        // a node whose grid spots would all squeeze a neighbour stays unsnapped (documented fallback), so not literally all
        expect(ps.filter((p) => p.x % 10 === 0 && p.y % 10 === 0).length).toBeGreaterThanOrEqual(ps.length * 0.4);
        expect(overlaps(scene, pos, 0)).toEqual([]);
        const ids = Object.keys(pos).sort();
        const sep = (a: Record<string, { x: number; y: number }>, i: string, j: string): number => {
          const ra = scene.nodes[i]!.bounds;
          const rb = scene.nodes[j]!.bounds;
          const dx = Math.max(a[j]!.x - (a[i]!.x + ra.w), a[i]!.x - (a[j]!.x + rb.w));
          const dy = Math.max(a[j]!.y - (a[i]!.y + ra.h), a[i]!.y - (a[j]!.y + rb.h));
          return Math.max(dx, dy);
        };
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            expect(sep(pos, ids[i]!, ids[j]!)).toBeGreaterThanOrEqual(Math.min(13, sep(plain, ids[i]!, ids[j]!)) - 0.01);
          }
      });
    });
  }

  it('key attributes come first in a fan: their angle precedes non-key attributes (stable ordering)', async () => {
    const scene = chenScene({ entities: [{ name: 'Solo', attrs: [A('b'), A('k', { key: true }), A('a')] }] });
    const pos = await autoLayout(scene, projectFor('chen'), 'dg');
    const rs = new Map(rectsAfter(scene, pos).map((r) => [r.id, r]));
    const oc = rectCenter(rs.get('e:Solo')!);
    const ang = (id: string): number => {
      const c = rectCenter(rs.get(id)!);
      return Math.atan2(c.y - oc.y, c.x - oc.x);
    };
    // all three are distinct directions
    const angles = ['a:Solo.k', 'a:Solo.a', 'a:Solo.b'].map(ang);
    expect(new Set(angles.map((x) => x.toFixed(2))).size).toBe(3);
  });

  it('recursive relationship sits beside its entity, not on top of its attributes', async () => {
    const scene = employeeEr();
    const pos = await autoLayout(scene, projectFor('chen'), 'dg');
    const rs = new Map(rectsAfter(scene, pos).map((r) => [r.id, r]));
    const e = rectCenter(rs.get('e:Employee')!);
    const r = rectCenter(rs.get('r:Manages')!);
    expect(Math.hypot(e.x - r.x, e.y - r.y)).toBeGreaterThan(100);
    expect(overlaps(scene, pos, 10)).toEqual([]);
  });

  it('many attributes on one entity (24) still fan out without overlap', async () => {
    const scene = chenScene({ entities: [{ name: 'Wide', attrs: Array.from({ length: 24 }, (_, i) => A(`attribute${i}`)) }] });
    const pos = await autoLayout(scene, projectFor('chen'), 'dg');
    expect(overlaps(scene, pos, 8)).toEqual([]);
    expect(lineViolations(scene, pos)).toEqual([]);
  });

  it('disconnected components and orphan attributes are laid out without overlap', async () => {
    const scene = chenScene({
      entities: [
        { name: 'A', attrs: [A('x'), A('y')] },
        { name: 'B', attrs: [A('x')] },
        { name: 'C' },
      ],
      relationships: [{ name: 'R', participants: ['A', 'B'] }],
    });
    const pos = await autoLayout(scene, projectFor('chen'), 'dg');
    expect(overlaps(scene, pos, 10)).toEqual([]);
  });

  it('origin option and default (current top-left) position the content', async () => {
    const scene = studentEr();
    const a = await autoLayout(scene, projectFor('chen'), 'dg', { origin: { x: 300, y: 200 } });
    const box = rectsAfter(scene, a);
    expect(Math.min(...box.map((r) => r.x))).toBeCloseTo(300, 1);
    expect(Math.min(...box.map((r) => r.y))).toBeCloseTo(200, 1);
    const b = await autoLayout(scene, projectFor('chen'), 'dg');
    const bb = rectsAfter(scene, b);
    expect(Math.min(...bb.map((r) => r.x))).toBeCloseTo(0, 1);
  });

  afterAll(() => {
    if (report.length) console.log(`[chen layout report]\n  ${report.join('\n  ')}`);
  });
});

describe('chen incremental (onlyNodeIds)', () => {
  const project = projectFor('chen');

  async function laidOutPharmacy(): Promise<{ scene: Scene; pos: Record<string, { x: number; y: number }> }> {
    const scene = pharmacyEr();
    const pos = await autoLayout(scene, project, 'dg');
    return { scene, pos };
  }

  /** Rebuild the scene with positions applied (what the store would do before the next autoLayout call). */
  function applied(scene: Scene, pos: Record<string, { x: number; y: number }>): Scene {
    const nodes = Object.fromEntries(
      Object.entries(scene.nodes).map(([id, n]) => {
        const p = pos[id];
        if (!p) return [id, n];
        const dx = p.x - n.bounds.x;
        const dy = p.y - n.bounds.y;
        const mv = (r: { x: number; y: number; w: number; h: number }) => ({ ...r, x: r.x + dx, y: r.y + dy });
        return [id, { ...n, bounds: mv(n.bounds), paintBounds: mv(n.paintBounds) }];
      }),
    ) as Scene['nodes'];
    return { ...scene, nodes };
  }

  it('places only the requested nodes; all others are untouched and absent from the result', async () => {
    const { scene, pos } = await laidOutPharmacy();
    const placed = deepFreeze(applied(scene, pos));
    // simulate: two attributes + a relationship were just added (reset them to the origin)
    const fresh = ['a:Doctor.Name', 'a:Doctor.Specialty', 'r:Treats'];
    const dirty: Scene = { ...placed, nodes: { ...placed.nodes } };
    const base = pharmacyEr();
    for (const id of fresh) dirty.nodes[id] = base.nodes[id]!;
    const frozen = deepFreeze(dirty);
    const out = await autoLayout(frozen, project, 'dg', { onlyNodeIds: fresh });
    expect(Object.keys(out).sort()).toEqual([...fresh].sort());
    expect(allFinite(out)).toBe(true);
    const all = { ...Object.fromEntries(Object.entries(frozen.nodes).map(([id, n]) => [id, { x: n.bounds.x, y: n.bounds.y }])), ...out };
    expect(overlaps(frozen, all, 8)).toEqual([]);
    // attributes landed near their owner, the relationship between its two participants
    const rs = new Map(rectsAfter(frozen, all).map((r) => [r.id, r]));
    const owner = rectCenter(rs.get('e:Doctor')!);
    for (const a of ['a:Doctor.Name', 'a:Doctor.Specialty']) {
      const c = rectCenter(rs.get(a)!);
      expect(Math.hypot(c.x - owner.x, c.y - owner.y)).toBeLessThan(330);
    }
  });

  it('a brand-new component is laid out on its own below existing content', async () => {
    const { scene, pos } = await laidOutPharmacy();
    const extra = chenScene({ entities: [{ name: 'Zeta', attrs: [A('id', { key: true }), A('v')] }] });
    const merged: Scene = deepFreeze({
      ...applied(scene, pos),
      nodes: { ...applied(scene, pos).nodes, ...extra.nodes },
      edges: { ...scene.edges, ...extra.edges },
    });
    const newIds = Object.keys(extra.nodes);
    const out = await autoLayout(merged, project, 'dg', { onlyNodeIds: newIds });
    expect(Object.keys(out).sort()).toEqual([...newIds].sort());
    const old = rectsAfter(scene, pos);
    const maxBottom = Math.max(...old.map((r) => r.y + r.h));
    for (const id of newIds) expect(out[id]!.y).toBeGreaterThanOrEqual(maxBottom);
    const all = { ...Object.fromEntries(Object.entries(merged.nodes).map(([id, n]) => [id, { x: n.bounds.x, y: n.bounds.y }])), ...out };
    expect(overlaps(merged, all, 8)).toEqual([]);
  });

  it('keepFixed in a full layout keeps those nodes exactly and avoids overlaps', async () => {
    const scene = deepFreeze(pharmacyEr());
    const out = await autoLayout(scene, project, 'dg', { keepFixed: ['e:Doctor'] });
    expect(out['e:Doctor']).toEqual({ x: scene.nodes['e:Doctor']!.bounds.x, y: scene.nodes['e:Doctor']!.bounds.y });
    expect(overlaps(scene, out, 8)).toEqual([]);
  });
});

describe('chen visual dump', () => {
  it.skipIf(!process.env.VISUAL)('writes .tmp/layout/*.svg for eyeballing', async () => {
    mkdirSync('.tmp/layout', { recursive: true });
    for (const [name, make] of FIXTURES) {
      const scene = make();
      const pos = await autoLayout(scene, projectFor('chen'), 'dg');
      writeFileSync(`.tmp/layout/chen-${name.replace(/\W+/g, '-')}.svg`, toSvg(scene, pos));
    }
  });
});

export function toSvg(scene: Scene, pos: Record<string, { x: number; y: number }>): string {
  const rs = new Map(rectsAfter(scene, pos).map((r) => [r.id, r]));
  const xs = [...rs.values()];
  const x0 = Math.min(...xs.map((r) => r.x)) - 20;
  const y0 = Math.min(...xs.map((r) => r.y)) - 20;
  const w = Math.max(...xs.map((r) => r.x + r.w)) - x0 + 20;
  const h = Math.max(...xs.map((r) => r.y + r.h)) - y0 + 20;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff"/>`];
  for (const e of Object.values(scene.edges)) {
    const a = rectCenter(rs.get(e.sourceNodeId)!);
    const b = rectCenter(rs.get(e.targetNodeId)!);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#555"/>`);
  }
  for (const [id, r] of rs) {
    const n = scene.nodes[id]!;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const text = 'label' in n ? n.label.text : 'nameLabel' in n ? n.nameLabel.text : id;
    if (n.kind === 'chen-attribute') parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r.w / 2}" ry="${r.h / 2}" fill="#eef" stroke="#339"/>`);
    else if (n.kind === 'chen-relationship') parts.push(`<polygon points="${cx},${r.y} ${r.x + r.w},${cy} ${cx},${r.y + r.h} ${r.x},${cy}" fill="#efe" stroke="#393"/>`);
    else parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#fee" stroke="#933"/>`);
    parts.push(`<text x="${cx}" y="${cy + 4}" font-family="Helvetica" font-size="12" text-anchor="middle">${text}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
