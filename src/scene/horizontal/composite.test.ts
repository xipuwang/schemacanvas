// @vitest-environment node
/** UX-5 / SA-18: a composite FK is ONE bundle (same border at each end), straight when its cells line up, label beside the lanes. */
import { afterEach, describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { useDeterministicIds } from '@/model/ids';
import type { Point, Rect } from '../base';
import { defaultMeasure } from '../measure';
import { buildHorizontalScene } from './index';
import { place, type Fixture } from './fixtures';
import type { FkEdgeGeom, HTableGeom } from './types';

let restore = () => {};
afterEach(() => restore());

function shop(shipName = 'shipments'): Fixture {
  const b = relationalBuilder('Shop');
  const oi = b.relation('order_items', ['order_id', 'line_no', 'sku', 'qty'], { pk: ['order_id', 'line_no'] });
  const sh = b.relation(shipName, ['order_id', 'line_no', 'shipment_id', 'carrier'], { pk: ['shipment_id'] });
  const fk = b.fk(sh, ['order_id', 'line_no'], oi, ['order_id', 'line_no']);
  const project = createBareProject('shop');
  const model = b.build();
  const diagram = withDiagram(project, model, 'relational-schema');
  return { project, model, diagram, rel: { order_items: oi, shipments: sh, [shipName]: sh }, fks: { fk } };
}
const build = (f: Fixture) => {
  const scene = buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
  return { scene, edge: Object.values(scene.edges)[0] as FkEdgeGeom, tables: Object.values(scene.nodes) as HTableGeom[] };
};
const segHitsRect = (a: Point, b: Point, r: Rect): boolean => Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h;

describe('UX-5: composite FK is routed as one bundle', () => {
  it('shipments right of order_items (vertically overlapping): both branches leave the same border and keep parallel lanes', () => {
    restore = useDeterministicIds();
    const f = shop();
    place(f, { order_items: [40, 40], shipments: [400, 100] });
    const { edge, tables } = build(f);
    expect(new Set(edge.branches.map((b) => b.sourceSide)).size).toBe(1);
    expect(new Set(edge.branches.map((b) => b.targetSide)).size).toBe(1);
    // neither branch loops round the source table: nothing runs above the top of either table
    const topMost = Math.min(...tables.map((t) => t.bounds.y));
    for (const b of edge.branches) expect(Math.min(...b.points.map((p) => p.y)), 'no detour over the tables').toBeGreaterThanOrEqual(topMost);
    // one bundle: the lanes of the two branches run side by side (same vertical corridor, 8 px apart)
    const lane = (pts: Point[]) => pts.filter((p, i) => i > 0 && i < pts.length - 1 && pts[i - 1]!.x === p.x).map((p) => p.x);
    const [l0, l1] = edge.branches.map((b) => lane(b.points));
    expect(l0!.some((x) => l1!.some((y) => Math.abs(x - y) > 0 && Math.abs(x - y) <= 9))).toBe(true);
  });

  it('a name-blocked border never splits the branches: sources and targets use one border each', () => {
    restore = useDeterministicIds();
    const f = shop();
    place(f, { order_items: [300, 300], shipments: [40, 40] });
    const { edge } = build(f);
    expect(new Set(edge.branches.map((b) => b.sourceSide)).size).toBe(1);
    expect(new Set(edge.branches.map((b) => b.targetSide)).size).toBe(1);
    for (const b of edge.branches) expect(b.targetCell).toBeTruthy();
  });

  it('explicit anchors of the user are never unified away', () => {
    restore = useDeterministicIds();
    const f = shop();
    place(f, { order_items: [300, 300], shipments: [40, 40] });
    const e = Object.values(f.diagram.edges)[0]!;
    const col = f.model.foreignKeys[Object.keys(f.model.foreignKeys)[0]!]!.columns[1]!.sourceColumnId;
    e.route = { ...e.route, branchAnchors: { [col]: { target: { side: 'bottom' } } } };
    const { edge } = build(f);
    expect(edge.branches[1]!.targetSide).toBe('bottom');
  });
});

describe('SA-18: stacked tables', () => {
  it('cells that overlap horizontally give straight vertical branches (no zig-zag)', () => {
    restore = useDeterministicIds();
    const f = shop('sh'); // a short relation name leaves the top border of the first cell free
    // same column order and widths: every branch lines up with its target cell
    place(f, { order_items: [40, 40], sh: [40, 300] });
    const { edge } = build(f);
    for (const b of edge.branches) {
      expect(b.points.length, JSON.stringify(b.points)).toBe(2);
      expect(b.points[0]!.x).toBe(b.points[1]!.x);
      expect(b.points[0]!.x).toBeGreaterThanOrEqual(b.sourceCell.x);
      expect(b.points[0]!.x).toBeLessThanOrEqual(b.sourceCell.x + b.sourceCell.w);
      expect(b.points[0]!.x).toBeGreaterThanOrEqual(b.targetCell.x);
      expect(b.points[0]!.x).toBeLessThanOrEqual(b.targetCell.x + b.targetCell.w);
    }
  });

  it('the FK label is placed beside the lanes, never on them', () => {
    restore = useDeterministicIds();
    const f = shop();
    f.diagram.options.relational!.fkLabels = true;
    for (const pos of [[[40, 40], [260, 300]], [[40, 40], [400, 100]], [[300, 300], [40, 40]]] as const) {
      place(f, { order_items: pos[0] as [number, number], shipments: pos[1] as [number, number] });
      const { edge } = build(f);
      const l = edge.labels[0]!.label;
      const w = l.width;
      const r = { x: l.anchor === 'middle' ? l.x - w / 2 : l.x, y: l.y - l.font.size, w, h: l.font.size * 1.3 };
      for (const b of edge.branches) for (let i = 0; i + 1 < b.points.length; i++) expect(segHitsRect(b.points[i]!, b.points[i + 1]!, r), `label over a lane at ${JSON.stringify(pos)}`).toBe(false);
    }
  });
});
