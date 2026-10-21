/** SA-06: connectors between ADJACENT / stacked tables never run along a table border and end on the exact row. */
import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Diagram, Project, RelationalModel } from '@/model/types';
import type { Point, Rect } from '../base';
import { defaultMeasure } from '../measure';
import { buildVerticalScene } from './index';
import { nodeIdOf, pharmacyVFixture, type VFixture } from './fixtures';
import type { VFkEdgeGeom, VTableGeom } from './types';

type Mode = 'crows-foot' | 'physical';
type Orientation = 'vertical' | 'horizontal';

function twoTables(type: Mode, orientation: Orientation, place: (c: { w: number; h: number }, d: { w: number; h: number }) => [[number, number], [number, number]]) {
  const b = relationalBuilder('T', 'postgresql');
  const company = b.relation('Company', [{ name: 'Id', type: 'INT' }, { name: 'Name', type: 'TEXT' }, { name: 'Addr', type: 'TEXT' }], { pk: ['Id'] });
  const drug = b.relation('Drug', [{ name: 'Id', type: 'INT' }, { name: 'Label', type: 'TEXT' }, { name: 'CompanyId', type: 'INT' }], { pk: ['Id'] });
  b.fk(drug, ['CompanyId'], company, ['Id']);
  const project: Project = createBareProject('p');
  const model: RelationalModel = b.build();
  const diagram: Diagram = withDiagram(project, model, type);
  if (diagram.options.crowsFoot) diagram.options.crowsFoot.orientation = orientation;
  const scene0 = buildVerticalScene({ project, diagram, model, measure: defaultMeasure });
  const size = (id: string) => (scene0.nodes[nodeIdOf(diagram, id)] as VTableGeom).bounds;
  const [pc, pd] = place(size(company.id), size(drug.id));
  const set = (id: string, [x, y]: [number, number]) => {
    const n = diagram.nodes[nodeIdOf(diagram, id)]!;
    n.x = x;
    n.y = y;
  };
  set(company.id, pc);
  set(drug.id, pd);
  return { project, model, diagram };
}

const build = (f: { project: Project; diagram: Diagram; model: RelationalModel }) => buildVerticalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });

const EPS = 0.75;
/** Length over which the axis-aligned segment a→b lies within EPS of a border LINE of r (not just touching it). */
function runAlongBorder(a: Point, b: Point, r: Rect): number {
  const horiz = Math.abs(a.y - b.y) < 1e-6;
  const vert = Math.abs(a.x - b.x) < 1e-6;
  const ov = (lo1: number, hi1: number, lo2: number, hi2: number) => Math.min(hi1, hi2) - Math.max(lo1, lo2);
  if (horiz) {
    const near = [r.y, r.y + r.h].some((y) => Math.abs(a.y - y) <= EPS);
    return near ? ov(Math.min(a.x, b.x), Math.max(a.x, b.x), r.x, r.x + r.w) : 0;
  }
  if (vert) {
    const near = [r.x, r.x + r.w].some((x) => Math.abs(a.x - x) <= EPS);
    return near ? ov(Math.min(a.y, b.y), Math.max(a.y, b.y), r.y, r.y + r.h) : 0;
  }
  return 0;
}
function crossesInterior(a: Point, b: Point, r: Rect): boolean {
  const inner = { x: r.x + EPS, y: r.y + EPS, w: r.w - 2 * EPS, h: r.h - 2 * EPS };
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > inner.x && x0 < inner.x + inner.w && y1 > inner.y && y0 < inner.y + inner.h;
}

function assertRoutes(f: { project: Project; diagram: Diagram; model: RelationalModel }, label: string): void {
  const s = build(f);
  const tables = Object.values(s.nodes) as VTableGeom[];
  for (const e of Object.values(s.edges) as VFkEdgeGeom[]) {
    const pts = e.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const t of tables) {
        // Single-row tables: the cell row is the bordered object; the relation name above it is a keep-out box only.
        const borders = t.orientation === 'horizontal' ? [t.body] : [t.bounds];
        const solids = t.orientation === 'horizontal' ? [t.body, t.header] : [t.bounds];
        for (const r of borders) expect(runAlongBorder(pts[i]!, pts[i + 1]!, r), `${label}: segment ${i} runs along a border of ${t.nodeId} ${JSON.stringify(pts)}`).toBeLessThanOrEqual(2);
        for (const r of solids) expect(crossesInterior(pts[i]!, pts[i + 1]!, r), `${label}: segment ${i} crosses table ${t.nodeId} ${JSON.stringify(pts)} ${JSON.stringify(solids)}`).toBe(false);
      }
    }
    // The ends sit on the border of the exact referenced ROW.
    for (const [end, node, col] of [[e.ends[0], e.sourceNodeId, e.sourceColumnId], [e.ends[1], e.targetNodeId, e.targetColumnId]] as const) {
      const row = (s.nodes[node] as VTableGeom).rows.find((r) => r.columnId === col)!;
      expect(end.columnId).toBe(col);
      const r = row.rect;
      const onSide = end.side === 'left' ? Math.abs(end.at.x - r.x) < 1e-6 : end.side === 'right' ? Math.abs(end.at.x - (r.x + r.w)) < 1e-6 : end.side === 'top' ? Math.abs(end.at.y - r.y) < 1e-6 : Math.abs(end.at.y - (r.y + r.h)) < 1e-6;
      expect(onSide, `${label}: end side`).toBe(true);
      expect(end.at.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(end.at.x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
      expect(end.at.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(end.at.y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
    }
  }
}

const GAPS = [4, 20, 60];
const modes: Array<[Mode, Orientation]> = [['crows-foot', 'vertical'], ['physical', 'vertical'], ['crows-foot', 'horizontal']];

describe.each(modes)('adjacent tables %s/%s', (type, orientation) => {
  it.each(GAPS)('side by side at %ipx, both orders and vertical offsets', (gap) => {
    for (const dy of [0, 30, -50, 120]) {
      assertRoutes(twoTables(type, orientation, (c) => [[0, 0], [c.w + gap, dy]]), `right gap${gap} dy${dy}`);
      assertRoutes(twoTables(type, orientation, (_c, d) => [[d.w + gap, dy], [0, 0]]), `left gap${gap} dy${dy}`);
    }
  });
  it.each(GAPS)('stacked at %ipx with horizontal offsets', (gap) => {
    for (const dx of [0, 20, -40, 90]) {
      assertRoutes(twoTables(type, orientation, (c) => [[0, 0], [dx, c.h + gap]]), `below gap${gap} dx${dx}`);
      assertRoutes(twoTables(type, orientation, (_c, d) => [[dx, d.h + gap], [0, 0]]), `above gap${gap} dx${dx}`);
    }
  });
});

describe('SA-06 regression: facing sides for narrow gaps', () => {
  it('a table 4px / 20px to the right is connected on the facing sides, with no wrap', () => {
    for (const gap of [4, 20]) {
      const f = twoTables('physical', 'vertical', (c) => [[0, 0], [c.w + gap, 0]]);
      const e = Object.values(build(f).edges)[0] as VFkEdgeGeom;
      expect([e.sourceSide, e.targetSide]).toEqual(['left', 'right']);
      expect(e.points.length).toBeLessThanOrEqual(4);
      const xs = e.points.map((p) => p.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('random layouts over the Pharmacy model', () => {
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const cases: Array<[Mode, Orientation]> = [['crows-foot', 'vertical'], ['physical', 'vertical'], ['crows-foot', 'horizontal']];
  it.each(cases)('grid layouts with 4/20/60px gaps (%s/%s)', (type, orientation) => {
    for (let seed = 1; seed <= 24; seed++) {
      const rand = rng(seed);
      const gap = GAPS[seed % GAPS.length]!;
      const f: VFixture = pharmacyVFixture(type, orientation);
      const s0 = build(f);
      const names = Object.keys(f.rel);
      const order = [...names].sort(() => rand() - 0.5);
      const cols = 3;
      const sizes = (n: string) => (s0.nodes[nodeIdOf(f.diagram, f.rel[n]!.id)] as VTableGeom).bounds;
      const colW = Math.max(...names.map((n) => sizes(n).w)) ;
      const rowH: number[] = [];
      order.forEach((n, i) => { const r = Math.floor(i / cols); rowH[r] = Math.max(rowH[r] ?? 0, sizes(n).h); });
      order.forEach((n, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const node = f.diagram.nodes[nodeIdOf(f.diagram, f.rel[n]!.id)]!;
        node.x = c * (colW + gap);
        node.y = rowH.slice(0, r).reduce((a, h) => a + h + gap, 0);
      });
      assertRoutes(f, `${type}/${orientation} seed${seed} gap${gap}`);
    }
  });
});
