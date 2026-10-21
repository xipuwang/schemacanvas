import { afterEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { deepFreeze } from '@/test/deepFreeze';
import type { Point, Rect } from '../base';
import { defaultMeasure } from '../measure';
import { buildHorizontalScene } from './index';
import {
  bracketFixture,
  detourFixture,
  employeeFixture,
  nodeIdOf,
  outOfOrderFixture,
  pharmacyFixture,
  place,
  prereqFixture,
  studentFixture,
  typedFixture,
  type Fixture,
} from './fixtures';
import type { FkEdgeGeom, HTableGeom } from './types';

let restore = () => {};
afterEach(() => restore());

const build = (f: Fixture) => {
  // Build from a frozen CLONE so the scene builder is proven pure while tests keep mutating the fixture between builds.
  const frozen = deepFreeze(structuredClone(f.project));
  const scene = buildHorizontalScene({ project: frozen, diagram: frozen.diagrams[f.diagram.id]!, model: frozen.models[f.model.id]!, measure: defaultMeasure });
  const table = (name: string) => scene.nodes[nodeIdOf(f.diagram, f.rel[name]!.id)] as HTableGeom;
  const edgeOf = (fkId: string) => {
    const e = Object.values(f.diagram.edges).find((x) => x.ref.kind === 'foreignKey' && x.ref.foreignKeyId === fkId)!;
    return scene.edges[e.id] as FkEdgeGeom;
  };
  return { scene, table, edgeOf };
};
const cellOf = (t: HTableGeom, columnId: string) => t.cells.find((c) => c.columnId === columnId)!;
const within = (r: Rect, x: number) => x >= r.x && x <= r.x + r.w;
const crosses = (pts: Point[], r: Rect): boolean => {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.y === b.y) {
      if (a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w) return true;
    } else if (a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h) return true;
  }
  return false;
};

describe('table geometry', () => {
  it('single row, name above, node x/y === bounds x/y, underline only on PK cells', () => {
    const f = studentFixture();
    const { table, scene } = build(f);
    const t = table('Student');
    const node = Object.values(f.diagram.nodes)[0]!;
    expect(t.bounds.x).toBe(node.x);
    expect(t.bounds.y).toBe(node.y);
    expect(t.cells).toHaveLength(5);
    expect(new Set(t.cells.map((c) => c.rect.y)).size).toBe(1); // ONE row
    expect(t.nameLabel.y).toBeLessThan(t.row.y);
    expect(t.cells.map((c) => c.label.underline)).toEqual(['solid', undefined, undefined, undefined, undefined]);
    expect(t.cells.map((c) => c.role)).toEqual(['pk', 'plain', 'plain', 'plain', 'plain']);
    // cells tile the row without gaps
    t.cells.slice(1).forEach((c, i) => expect(c.rect.x).toBe(t.cells[i]!.rect.x + t.cells[i]!.rect.w));
    expect(scene.bounds.x).toBeLessThanOrEqual(t.paintBounds.x);
  });

  it('composite PK underlines every PK cell; roles come from the model (PK+FK italic AND underlined)', () => {
    const f = pharmacyFixture();
    const { table } = build(f);
    const drug = table('Drug');
    expect(drug.cells.map((c) => c.role)).toEqual(['pk+fk', 'pk', 'plain']);
    expect(drug.cells.map((c) => !!c.label.underline)).toEqual([true, true, false]);
    expect(drug.cells[0]!.label.font.style).toBe('italic');
    expect(drug.cells[1]!.label.font.style).toBe('normal');
    const patient = table('Patient');
    expect(patient.cells[4]!.role).toBe('fk');
    expect(patient.cells[4]!.label.font.style).toBe('italic');
    expect(patient.cells[4]!.label.underline).toBeUndefined();
  });

  it('name on the left puts the name beside the row and keeps bounds.x === node.x', () => {
    const f = studentFixture();
    f.diagram.options.relational!.nameAbove = false;
    const { table } = build(f);
    const t = table('Student');
    expect(t.row.x).toBeGreaterThan(t.nameLabel.x + t.nameLabel.width);
    expect(t.bounds.x).toBe(40);
    expect(t.bounds.h).toBe(t.row.h);
  });

  it('widths: text fit + padding; overrides only grow; node.width distributes surplus to un-overridden cells', () => {
    const f = studentFixture();
    const node = Object.values(f.diagram.nodes)[0]!;
    const base = build(f).table('Student');
    const [sid, first] = [f.rel.Student!.col('SID'), f.rel.Student!.col('FirstName')];
    node.columnWidths = { [sid]: 200, [first]: 5 }; // 5 is below the text fit and must be clamped
    node.width = base.row.w + 300;
    const t = build(f).table('Student');
    expect(cellOf(t, sid).rect.w).toBe(200);
    expect(cellOf(t, first).rect.w).toBe(base.cells[1]!.rect.w); // clamped to the fit
    expect(t.row.w).toBeCloseTo(base.row.w + 300, 5); // node.width is the minimum total row width
    // every label fits inside its cell
    for (const c of t.cells) expect(c.label.width + 2 * 12).toBeLessThanOrEqual(c.rect.w + 0.5);
  });

  it('row height: node.height wins but never drops below the text fit; types add a second line', () => {
    const f = typedFixture();
    const t = build(f).table('Student');
    expect(t.cells.every((c) => !!c.typeLabel)).toBe(true);
    expect(t.row.h).toBeGreaterThan(32); // two lines forced the row taller than the default
    const node = Object.values(f.diagram.nodes)[0]!;
    node.height = 10;
    expect(build(f).table('Student').row.h).toBe(t.row.h);
    node.height = 90;
    expect(build(f).table('Student').row.h).toBe(90);
  });
});

describe('FK connectors: exact referenced cell', () => {
  it('Patient.DoctorSSN -> Doctor.SSN: tip on the border of Doctor.SSN, perpendicular, strokes end at the base', () => {
    const f = pharmacyFixture();
    const { table, edgeOf } = build(f);
    const e = edgeOf(f.fks.patientDoctor!.id);
    expect(e.branches).toHaveLength(1);
    const b = e.branches[0]!;
    const doctor = table('Doctor');
    const target = cellOf(doctor, f.rel.Doctor!.col('SSN'));
    expect(b.targetColumnId).toBe(f.rel.Doctor!.col('SSN'));
    expect(b.sourceColumnId).toBe(f.rel.Patient!.col('DoctorSSN'));
    expect(b.points[b.points.length - 1]).toBe(b.arrow.tip); // exact, same object
    expect(b.strokePoints[b.strokePoints.length - 1]).toEqual(b.arrow.base);
    expect(b.points.slice(0, -1)).toEqual(b.strokePoints.slice(0, -1));
    expect(within(target.rect, b.arrow.tip.x)).toBe(true);
    const border = b.arrow.side === 'top' ? target.rect.y : b.arrow.side === 'bottom' ? target.rect.y + target.rect.h : NaN;
    expect(b.arrow.tip.y).toBe(border);
    // perpendicular: the last segment is vertical and the base lies outward
    const prev = b.points[b.points.length - 2]!;
    expect(prev.x).toBe(b.arrow.tip.x);
    expect(Math.sign(prev.y - b.arrow.tip.y)).toBe(b.arrow.side === 'top' ? -1 : 1);
    // starts on the FK cell border
    const src = cellOf(table('Patient'), f.rel.Patient!.col('DoctorSSN'));
    expect(within(src.rect, b.points[0]!.x)).toBe(true);
    expect([src.rect.y, src.rect.y + src.rect.h]).toContain(b.points[0]!.y);
    expect(e.ends[1].columnId).toBe(target.columnId);
  });

  it('every FK of the pharmacy schema: each branch targets ITS pair column and its tip lies in that cell', () => {
    const f = pharmacyFixture();
    const { table, edgeOf, scene } = build(f);
    for (const fk of Object.values(f.model.foreignKeys)) {
      const e = edgeOf(fk.id);
      expect(e.branches).toHaveLength(fk.columns.length);
      fk.columns.forEach((pair, i) => {
        const b = e.branches[i]!;
        expect(b.sourceColumnId).toBe(pair.sourceColumnId);
        expect(b.targetColumnId).toBe(pair.targetColumnId);
        const tgt = cellOf(table(f.model.relations[fk.targetRelationId]!.name), pair.targetColumnId);
        expect(b.targetCell).toEqual(tgt.rect);
        expect(within(tgt.rect, b.arrow.tip.x)).toBe(true);
        expect(b.targetSide === 'top' ? b.arrow.tip.y === tgt.rect.y : b.targetSide === 'bottom' ? b.arrow.tip.y === tgt.rect.y + tgt.rect.h : b.arrow.tip.x === (b.targetSide === 'left' ? tgt.rect.x : tgt.rect.x + tgt.rect.w)).toBe(true);
      });
    }
    expect(scene.warnings).toEqual([]);
  });

  it('composite FK is ONE edge with parallel branches, pair order respected, never merged', () => {
    const f = pharmacyFixture();
    const { edgeOf, table } = build(f);
    const e = edgeOf(f.fks.prescriptionDrug!.id);
    expect(e.style).toBe('branches');
    expect(e.branches.map((b) => b.targetColumnId)).toEqual([f.rel.Drug!.col('CompanyName'), f.rel.Drug!.col('TradeName')]);
    expect(e.branches.map((b) => b.sourceColumnId)).toEqual([f.rel.Prescription!.col('CompanyName'), f.rel.Prescription!.col('DrugTradeName')]);
    // the branches never share a segment
    const [a, b] = e.branches;
    for (let i = 0; i < a!.points.length - 1; i++) {
      for (let j = 0; j < b!.points.length - 1; j++) {
        const p = a!.points, q = b!.points;
        const sameLine = p[i]!.x === p[i + 1]!.x && q[j]!.x === q[j + 1]!.x ? p[i]!.x === q[j]!.x && Math.min(Math.max(p[i]!.y, p[i + 1]!.y), Math.max(q[j]!.y, q[j + 1]!.y)) > Math.max(Math.min(p[i]!.y, p[i + 1]!.y), Math.min(q[j]!.y, q[j + 1]!.y))
          : p[i]!.y === p[i + 1]!.y && q[j]!.y === q[j + 1]!.y ? p[i]!.y === q[j]!.y && Math.min(Math.max(p[i]!.x, p[i + 1]!.x), Math.max(q[j]!.x, q[j + 1]!.x)) > Math.max(Math.min(p[i]!.x, p[i + 1]!.x), Math.min(q[j]!.x, q[j + 1]!.x)) : false;
        expect(sameLine).toBe(false);
      }
    }
    expect(table('Drug').cells[0]!.columnId).toBe(e.branches[0]!.targetColumnId);
    expect(e.pairs).toHaveLength(2);
  });

  it('out-of-order composite pairs map exactly (pair 0 -> TradeName at cell 1, pair 1 -> CompanyName at cell 0)', () => {
    const f = outOfOrderFixture();
    const { edgeOf, table } = build(f);
    const e = edgeOf(f.fks.rx!.id);
    const drug = table('Drug');
    expect(e.branches[0]!.targetColumnId).toBe(f.rel.Drug!.col('TradeName'));
    expect(within(drug.cells[1]!.rect, e.branches[0]!.arrow.tip.x)).toBe(true);
    expect(e.branches[1]!.targetColumnId).toBe(f.rel.Drug!.col('CompanyName'));
    expect(within(drug.cells[0]!.rect, e.branches[1]!.arrow.tip.x)).toBe(true);
  });

  it('moving tables never changes which columns the branches refer to', () => {
    const f = pharmacyFixture();
    const before = Object.values(f.model.foreignKeys).map((fk) => build(f).edgeOf(fk.id).branches.map((b) => [b.sourceColumnId, b.targetColumnId]));
    for (const n of Object.values(f.diagram.nodes)) {
      n.x = (n.x * 7 + 123) % 900;
      n.y = (n.y * 3 + 61) % 800;
    }
    const after = Object.values(f.model.foreignKeys).map((fk) => build(f).edgeOf(fk.id).branches.map((b) => [b.sourceColumnId, b.targetColumnId]));
    expect(after).toEqual(before);
    // and every tip still lies inside its own target cell after the move
    const { edgeOf, table } = build(f);
    for (const fk of Object.values(f.model.foreignKeys)) {
      for (const b of edgeOf(fk.id).branches) {
        const tgt = cellOf(table(f.model.relations[fk.targetRelationId]!.name), b.targetColumnId);
        expect(within(tgt.rect, b.arrow.tip.x) && b.arrow.tip.y >= tgt.rect.y && b.arrow.tip.y <= tgt.rect.y + tgt.rect.h).toBe(true);
      }
    }
  });

  it('routes avoid other tables (detour) and the connector goes AROUND the middle table', () => {
    const f = detourFixture();
    const { edgeOf, table } = build(f);
    const e = edgeOf(f.fks.orderCustomer!.id);
    const mid = table('Invoice');
    expect(crosses(e.branches[0]!.points, mid.bounds)).toBe(false);
    expect(crosses(e.branches[0]!.points, table('Order').bounds)).toBe(false);
    expect(e.branches[0]!.points.length).toBeGreaterThan(4); // it really had to bend around
  });

  it('pharmacy: no connector crosses a table it is not attached to', () => {
    const f = pharmacyFixture();
    const { edgeOf, table } = build(f);
    for (const fk of Object.values(f.model.foreignKeys)) {
      const src = f.model.relations[fk.sourceRelationId]!.name;
      const tgt = f.model.relations[fk.targetRelationId]!.name;
      for (const b of edgeOf(fk.id).branches) {
        for (const name of Object.keys(f.rel)) {
          if (name === src || name === tgt) continue;
          expect(crosses(b.points, table(name).bounds)).toBe(false);
        }
      }
    }
  });

  it('self-referencing FK routes around the table: both ends bottom, arrow into Eid, never through the row', () => {
    const f = employeeFixture();
    const { edgeOf, table } = build(f);
    const b = edgeOf(f.fks.manager!.id).branches[0]!;
    const t = table('Employee');
    expect(b.sourceColumnId).toBe(f.rel.Employee!.col('ManagerEid'));
    expect(b.targetColumnId).toBe(f.rel.Employee!.col('Eid'));
    expect(crosses(b.points, t.bounds)).toBe(false);
    expect(b.targetSide).toBe('bottom');
    expect(within(t.cells[0]!.rect, b.arrow.tip.x)).toBe(true);
  });

  it('PreReq: both columns reference Course.Cid -> two arrows spread over the same target cell', () => {
    const f = prereqFixture();
    const { edgeOf, table } = build(f);
    const a = edgeOf(f.fks.cid!.id).branches[0]!;
    const b = edgeOf(f.fks.req!.id).branches[0]!;
    const cid = table('Course').cells[0]!;
    expect(a.targetColumnId).toBe(cid.columnId);
    expect(b.targetColumnId).toBe(cid.columnId);
    expect(a.arrow.tip.x).not.toBe(b.arrow.tip.x); // anchor spreading
    expect(within(cid.rect, a.arrow.tip.x) && within(cid.rect, b.arrow.tip.x)).toBe(true);
  });

  it('anchors keep clear of the relation name when arriving at the top of the first cell', () => {
    const f = detourFixture();
    const { edgeOf, table } = build(f);
    const b = edgeOf(f.fks.orderCustomer!.id).branches[0]!;
    const t = table('Customer');
    if (b.targetSide === 'top') {
      expect(b.arrow.tip.x).toBeGreaterThan(t.nameLabel.x + t.nameLabel.width);
    }
  });
});

describe('brackets', () => {
  it('bracket style: ONE arrow between brackets when pairs are contiguous and ordered', () => {
    const f = bracketFixture('bracket');
    const { edgeOf, scene } = build(f);
    const e = edgeOf(f.fks.rx!.id);
    expect(e.style).toBe('bracket');
    expect(e.branches).toHaveLength(1);
    expect(e.brackets).toBeDefined();
    expect(e.pairs).toHaveLength(2);
    expect(scene.warnings.filter((w) => w.startsWith('fk-bracket-fallback'))).toEqual([]);
  });

  it('falls back to branches with a Scene warning when the target order does not match', () => {
    const f = outOfOrderFixture();
    f.diagram.options.relational!.compositeFkStyle = 'bracket';
    const { edgeOf, scene } = build(f);
    const e = edgeOf(f.fks.rx!.id);
    expect(e.style).toBe('branches');
    expect(e.branches).toHaveLength(2);
    expect(scene.warnings).toContain(`fk-bracket-fallback:${f.fks.rx!.id}`);
  });
});

describe('manual routing, anchors, labels, warnings', () => {
  it('manual waypoints are passed through; bend handles + autoWaypoints reproduce a route', () => {
    const f = detourFixture();
    const auto = build(f).edgeOf(f.fks.orderCustomer!.id);
    const edge = Object.values(f.diagram.edges)[0]!;
    // store the auto route as manual waypoints: the route must be identical
    edge.route = { mode: 'manual', waypoints: auto.autoWaypoints };
    const manual = build(f).edgeOf(f.fks.orderCustomer!.id);
    expect(manual.branches[0]!.points).toEqual(auto.branches[0]!.points);
    expect(manual.bendHandles).toHaveLength(auto.autoWaypoints.length);
    // moving one waypoint moves the route but not the referenced column
    edge.route = { mode: 'manual', waypoints: auto.autoWaypoints.map((w, i) => (i === 1 || i === 2 ? { x: w.x - 30, y: w.y } : w)) };
    const moved = build(f).edgeOf(f.fks.orderCustomer!.id);
    expect(moved.branches[0]!.targetColumnId).toBe(auto.branches[0]!.targetColumnId);
    expect(moved.branches[0]!.points).not.toEqual(auto.branches[0]!.points);
  });

  it('a stored autoWaypoints round trip reproduces a single-branch route in the pharmacy schema', () => {
    const f = pharmacyFixture();
    for (const key of ['patientDoctor', 'drugCompany', 'contactCompany'] as const) {
      const fk = f.fks[key]!;
      const auto = build(f).edgeOf(fk.id);
      const edge = Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fk.id)!;
      edge.route = { mode: 'manual', waypoints: auto.autoWaypoints };
      const manual = build(f).edgeOf(fk.id);
      expect(manual.branches[0]!.points).toEqual(auto.branches[0]!.points);
      edge.route = { mode: 'auto', waypoints: [] };
    }
  });

  it('anchor offset is clamped inside the FK cell; illegal sides are coerced with a warning', () => {
    const f = employeeFixture();
    const edge = Object.values(f.diagram.edges)[0]!;
    edge.route = { mode: 'auto', waypoints: [], sourceAnchor: { side: 'bottom', offset: 5 }, targetAnchor: { side: 'left', offset: 0.5 } };
    const { edgeOf, table, scene } = build(f);
    const b = edgeOf(f.fks.manager!.id).branches[0]!;
    const src = table('Employee').cells[3]!;
    expect(b.points[0]!.x).toBe(src.rect.x + src.rect.w - 4); // offset 5 clamps to the right edge - 4
    expect(b.targetSide).toBe('left'); // Eid IS the first cell: left is legal
    expect(scene.warnings.filter((w) => w.startsWith('anchor-coerced'))).toEqual([]);
    edge.route = { mode: 'auto', waypoints: [], sourceAnchor: { side: 'left' } }; // ManagerEid is the LAST cell: illegal
    const r = build(f);
    expect(r.edgeOf(f.fks.manager!.id).branches[0]!.sourceSide).toBe('bottom');
    expect(r.scene.warnings.some((w) => w.startsWith(`anchor-coerced:${edge.id}:source:left`))).toBe(true);
  });

  it('explicit anchor never changes the referenced column', () => {
    const f = pharmacyFixture();
    const e0 = build(f).edgeOf(f.fks.patientDoctor!.id).branches[0]!;
    const edge = Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === f.fks.patientDoctor!.id)!;
    edge.route = { mode: 'auto', waypoints: [], targetAnchor: { side: 'top', offset: 0.99 }, sourceAnchor: { side: 'top', offset: 0 } };
    const e1 = build(f).edgeOf(f.fks.patientDoctor!.id).branches[0]!;
    expect(e1.targetColumnId).toBe(e0.targetColumnId);
    expect(e1.sourceColumnId).toBe(e0.sourceColumnId);
  });

  it('FK labels: shown via options or edge.labelVisible, text = label ?? description, on a free spot', () => {
    const f = pharmacyFixture();
    expect(build(f).edgeOf(f.fks.patientDoctor!.id).labels).toEqual([]);
    f.diagram.options.relational!.fkLabels = true;
    const { edgeOf, table } = build(f);
    const l = edgeOf(f.fks.patientDoctor!.id).labels[0]!;
    expect(l.id).toBe('main');
    expect(l.label.text).toBe('Patient.DoctorSSN → Doctor.SSN');
    expect(l.label.backdrop).toBe(true);
    for (const name of ['Doctor', 'Patient']) {
      const t = table(name);
      const lx = l.label.x - l.label.width / 2;
      const overlaps = lx < t.bounds.x + t.bounds.w && lx + l.label.width > t.bounds.x && l.label.y > t.bounds.y && l.label.y < t.bounds.y + t.bounds.h;
      expect(overlaps).toBe(false);
    }
    f.fks.patientDoctor!.label = 'treats';
    f.diagram.options.relational!.fkLabels = false;
    Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === f.fks.patientDoctor!.id)!.labelVisible = true;
    expect(build(f).edgeOf(f.fks.patientDoctor!.id).labels[0]!.label.text).toBe('treats');
    // label bounds are part of the edge bounds
    const e = build(f).edgeOf(f.fks.patientDoctor!.id);
    expect(e.bounds.x).toBeLessThanOrEqual(e.labels[0]!.label.x - e.labels[0]!.label.width / 2);
  });

  it('dangling edges and missing columns are skipped with warnings, never invented', () => {
    const f = pharmacyFixture();
    const fk = f.fks.patientDoctor!;
    delete f.model.foreignKeys[fk.id];
    const { scene } = build(f);
    expect(scene.warnings.some((w) => w.startsWith('dangling-fk-edge:'))).toBe(true);
    expect(Object.keys(scene.edges)).toHaveLength(Object.keys(f.model.foreignKeys).length);
    const g = pharmacyFixture();
    g.fks.sellDrug!.columns[1]!.targetColumnId = 'col_nope';
    const r = build(g);
    expect(r.scene.warnings.some((w) => w.startsWith(`fk-column-missing:${g.fks.sellDrug!.id}`))).toBe(true);
  });

  it('is deterministic and scene.bounds contains every arrow, table and label', () => {
    restore = useDeterministicIds();
    const f = pharmacyFixture();
    f.diagram.options.relational!.fkLabels = true;
    const a = build(f).scene;
    const b = build(f).scene;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const n of Object.values(a.nodes)) {
      expect(n.paintBounds.x).toBeGreaterThanOrEqual(a.bounds.x);
      expect(n.paintBounds.x + n.paintBounds.w).toBeLessThanOrEqual(a.bounds.x + a.bounds.w);
    }
    for (const e of Object.values(a.edges)) {
      expect(e.bounds.y).toBeGreaterThanOrEqual(a.bounds.y);
      expect(e.bounds.y + e.bounds.h).toBeLessThanOrEqual(a.bounds.y + a.bounds.h);
      for (const p of e.paths.flat()) {
        expect(p.x).toBeGreaterThanOrEqual(e.bounds.x);
        expect(p.x).toBeLessThanOrEqual(e.bounds.x + e.bounds.w);
      }
    }
  });
});

describe('review fixes (HT-1 .. HT-8, HTABLE-1, HROUTE-1, HSTRAIGHT-1)', () => {
  const pharmacyAt = (list: Array<[string, number, number]>) => {
    const f = pharmacyFixture();
    place(f, Object.fromEntries(list.map(([n, x, y]) => [n, [x, y] as [number, number]])));
    return f;
  };
  const edgeIdOf = (f: Fixture, fkId: string) => Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fkId)!.id;
  const exactAxis = (pts: Point[]) => pts.slice(1).every((p, i) => p.x === pts[i]!.x || p.y === pts[i]!.y);
  /** Length of the longest run two different branches of one edge share (same line within 0.5px, overlapping). */
  const sharedRun = (e: FkEdgeGeom): number => {
    let worst = 0;
    const segs = (pts: Point[]) => pts.slice(1).map((b, i) => [pts[i]!, b] as const);
    for (let i = 0; i < e.branches.length; i++) {
      for (let j = i + 1; j < e.branches.length; j++) {
        for (const [a1, b1] of segs(e.branches[i]!.points)) {
          for (const [a2, b2] of segs(e.branches[j]!.points)) {
            const h1 = Math.abs(a1.y - b1.y) < 1e-6;
            if (h1 !== (Math.abs(a2.y - b2.y) < 1e-6)) continue;
            const [k, o] = h1 ? (['y', 'x'] as const) : (['x', 'y'] as const);
            if (Math.abs(a1[k] - a2[k]) >= 0.5) continue;
            const ov = Math.min(Math.max(a1[o], b1[o]), Math.max(a2[o], b2[o])) - Math.max(Math.min(a1[o], b1[o]), Math.min(a2[o], b2[o]));
            worst = Math.max(worst, ov);
          }
        }
      }
    }
    return worst;
  };
  const nameRectOf = (t: HTableGeom): Rect => ({ x: t.nameLabel.x, y: t.bounds.y, w: t.nameLabel.width ?? 0, h: t.row.y - t.bounds.y - 8 });
  const rng = (seed: number) => {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  it('HT-1: no other connector crosses the arrowhead + final stub of an FK arrow (default Pharmacy)', () => {
    const f = pharmacyFixture();
    const { edgeOf } = build(f);
    const sellDrug = edgeOf(f.fks.sellDrug!.id);
    const trade = sellDrug.branches.find((b) => b.targetColumnId === f.rel.Drug!.col('TradeName'))!;
    const tip = trade.arrow.tip;
    const zone = { x: tip.x - 4.5, y: tip.y, w: 9, h: 16 };
    for (const e of Object.values(build(f).scene.edges) as FkEdgeGeom[]) {
      if (e.edgeId === sellDrug.edgeId) continue;
      for (const b of e.branches) expect(crosses(b.points, zone), `${e.edgeId} crosses the Sell->Drug.TradeName arrow`).toBe(false);
    }
  });

  it('HT-2: every FK path segment is EXACTLY axis aligned (no float-noise diagonals)', () => {
    const f = pharmacyAt([['Doctor', 501, 314], ['Patient', 326, 14], ['Pharmacy', 204, 158], ['Company', 289, 298], ['Drug', 667, 404], ['Sell', 116, 496], ['Contact', 611, 476], ['Prescription', 29, 426]]);
    const { scene } = build(f);
    for (const e of Object.values(scene.edges) as FkEdgeGeom[]) for (const b of e.branches) expect(exactAxis(b.points), e.edgeId).toBe(true);
    const bad = pharmacyFixture();
    for (const e of Object.values(build(bad).scene.edges) as FkEdgeGeom[]) for (const b of e.branches) expect(exactAxis(b.points)).toBe(true);
  });

  it('HT-3: a manual bend behind the anchor side keeps the stubs; the arrow still enters the referenced cell from outside', () => {
    const f = pharmacyFixture();
    const eid = edgeIdOf(f, f.fks.patientDoctor!.id);
    f.diagram.edges[eid]!.route = { ...f.diagram.edges[eid]!.route, mode: 'manual', waypoints: [{ x: 500, y: 60 }] };
    const { scene, table } = build(f);
    const b = (scene.edges[eid] as FkEdgeGeom).branches[0]!;
    const n = b.points.length;
    expect(b.targetSide).toBe('bottom');
    expect(b.points[n - 2]!.y).toBeGreaterThan(b.arrow.tip.y); // arrives from below the border
    expect(b.points[1]!.y).toBeGreaterThan(b.points[0]!.y); // leaves downwards
    // the bend (500, 60) lies ON the path (it may be mid-segment once collinear points are merged)
    const onPath = b.points.slice(1).some((q, i) => {
      const a = b.points[i]!;
      return a.y === 60 && q.y === 60 && 500 >= Math.min(a.x, q.x) && 500 <= Math.max(a.x, q.x);
    });
    expect(onPath).toBe(true);
    for (const name of ['Patient', 'Doctor']) expect(crosses(b.points, table(name).row)).toBe(false);
  });

  it('HT-4: a manual composite FK with mixed sides draws one lane per branch (no merged trunk)', () => {
    const f = pharmacyFixture();
    const fk = f.fks.prescriptionDrug!;
    const eid = edgeIdOf(f, fk.id);
    const r = f.diagram.edges[eid]!.route;
    r.branchAnchors = { [fk.columns[1]!.sourceColumnId]: { source: { side: 'bottom' }, target: { side: 'bottom' } } };
    r.mode = 'manual';
    r.waypoints = [{ x: 900, y: 380 }, { x: 900, y: 600 }];
    const e = build(f).scene.edges[eid] as FkEdgeGeom;
    expect(sharedRun(e)).toBeLessThanOrEqual(0.5);
    expect(e.autoWaypoints).toEqual([{ x: 900, y: 380 }, { x: 900, y: 600 }]);
    // columns are untouched
    expect(e.branches.map((b) => b.targetColumnId)).toEqual(fk.columns.map((c) => c.targetColumnId));
  });

  it('HT-5/HT-7: composite branches 22px above/below each other stay apart and keep off the relation name', () => {
    const f5 = pharmacyAt([['Doctor', 383, 162], ['Patient', 888, 622], ['Pharmacy', 817, 188], ['Company', 828, 368], ['Drug', 409, 671], ['Sell', 733, 16], ['Contact', 21, 469], ['Prescription', 173, 592]]);
    const s5 = build(f5);
    expect(sharedRun(s5.edgeOf(f5.fks.prescriptionDrug!.id))).toBeLessThanOrEqual(0.5);
    const f7 = pharmacyAt([['Doctor', 428, 118], ['Patient', 149, 637], ['Pharmacy', 291, 324], ['Company', 749, 543], ['Drug', 711, 228], ['Sell', 495, 38], ['Contact', 394, 430], ['Prescription', 817, 306]]);
    const s7 = build(f7);
    const e = s7.edgeOf(f7.fks.prescriptionDrug!.id);
    for (const b of e.branches) for (const t of Object.values(s7.scene.nodes) as HTableGeom[]) expect(crosses(b.points, nameRectOf(t)), `name of ${t.nameLabel.text}`).toBe(false);
  });

  it('HT-6: in a tightly packed layout bundle lanes never run through the FK own source row', () => {
    const f = pharmacyAt([['Doctor', 657, 202], ['Patient', 496, 48], ['Pharmacy', 598, 130], ['Company', 395, 129], ['Drug', 135, 216], ['Sell', 246, 301], ['Contact', 573, 373], ['Prescription', 338, 497]]);
    const { scene, edgeOf } = build(f);
    const e = edgeOf(f.fks.sellDrug!.id);
    for (const b of e.branches) for (const t of Object.values(scene.nodes) as HTableGeom[]) expect(crosses(b.points, t.row), `row of ${t.nameLabel.text}`).toBe(false);
  });

  it('HT-8: autoWaypoints -> manual reproduces an auto composite bundle exactly', () => {
    const f = pharmacyAt([['Doctor', 383, 162], ['Patient', 888, 622], ['Pharmacy', 817, 188], ['Company', 828, 368], ['Drug', 409, 671], ['Sell', 733, 16], ['Contact', 21, 469], ['Prescription', 173, 592]]);
    for (const key of ['prescriptionDrug', 'sellDrug', 'patientDoctor'] as const) {
      const fk = f.fks[key]!;
      const eid = edgeIdOf(f, fk.id);
      const auto = build(f).edgeOf(fk.id);
      f.diagram.edges[eid]!.route = { ...f.diagram.edges[eid]!.route, mode: 'manual', waypoints: auto.autoWaypoints };
      const manual = build(f).edgeOf(fk.id);
      expect(manual.branches.map((b) => b.points), key).toEqual(auto.branches.map((b) => b.points));
      f.diagram.edges[eid]!.route = { mode: 'auto', waypoints: [] };
    }
    // a roomy layout: the composite bundle round-trips too
    const g = pharmacyAt([['Doctor', 1400, 40], ['Patient', 1000, 40], ['Pharmacy', 600, 40], ['Company', 200, 40], ['Drug', 200, 420], ['Sell', 600, 420], ['Contact', 1000, 420], ['Prescription', 1400, 420]]);
    const fk = g.fks.prescriptionDrug!;
    const eid = edgeIdOf(g, fk.id);
    const auto = build(g).edgeOf(fk.id);
    g.diagram.edges[eid]!.route = { ...g.diagram.edges[eid]!.route, mode: 'manual', waypoints: auto.autoWaypoints };
    expect(build(g).edgeOf(fk.id).branches.map((b) => b.points)).toEqual(auto.branches.map((b) => b.points));
  });

  it('HTABLE-1 / HROUTE-1: over 60 random well-spaced layouts no connector enters a foreign table (name band included)', () => {
    let layouts = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const f = pharmacyFixture();
      const sizes = Object.fromEntries((Object.values(build(f).scene.nodes) as HTableGeom[]).map((n) => [n.nodeId, n.bounds]));
      const r = rng(seed * 7919 + 40);
      const placed: Rect[] = [];
      let ok = true;
      for (const node of Object.values(f.diagram.nodes)) {
        const b = sizes[node.id]!;
        let found = false;
        for (let tries = 0; tries < 400 && !found; tries++) {
          const x = Math.round(r() * 1400);
          const y = Math.round(r() * 1000);
          found = placed.every((p) => x + b.w + 40 <= p.x || p.x + p.w + 40 <= x || y + b.h + 40 <= p.y || p.y + p.h + 40 <= y);
          if (found) {
            node.x = x;
            node.y = y;
            placed.push({ x, y, w: b.w, h: b.h });
          }
        }
        if (!found) ok = false;
      }
      if (!ok) continue;
      layouts++;
      const { scene } = build(f);
      for (const e of Object.values(scene.edges) as FkEdgeGeom[]) {
        for (const t of Object.values(scene.nodes) as HTableGeom[]) {
          if (t.nodeId === e.sourceNodeId || t.nodeId === e.targetNodeId) continue;
          for (const b of e.branches) expect(crosses(b.points, t.bounds), `seed ${seed}: ${e.edgeId} enters ${t.nameLabel.text}`).toBe(false);
        }
        for (const b of e.branches) {
          expect(exactAxis(b.points), `seed ${seed}: diagonal`).toBe(true);
          // foreign arrowheads are never crossed
          for (const other of Object.values(scene.edges) as FkEdgeGeom[]) {
            if (other === e) continue;
            for (const ob of other.branches) {
              const xs = ob.arrow.polygon.map((q) => q.x);
              const ys = ob.arrow.polygon.map((q) => q.y);
              const head = { x: Math.min(...xs) + 0.5, y: Math.min(...ys) + 0.5, w: Math.max(...xs) - Math.min(...xs) - 1, h: Math.max(...ys) - Math.min(...ys) - 1 };
              expect(crosses(b.points, head), `seed ${seed}: ${e.edgeId} crosses an arrowhead of ${other.edgeId}`).toBe(false);
            }
          }
        }
      }
    }
    expect(layouts).toBeGreaterThan(30);
  });

  it('HSTRAIGHT-1: straight routing never draws a connector through a foreign table', () => {
    const f = pharmacyFixture();
    f.diagram.options.relational!.routing = 'straight';
    const { scene } = build(f);
    expect(scene.warnings).toEqual([]);
    for (const e of Object.values(scene.edges) as FkEdgeGeom[]) {
      for (const t of Object.values(scene.nodes) as HTableGeom[]) {
        if (t.nodeId === e.sourceNodeId || t.nodeId === e.targetNodeId) continue;
        for (const b of e.branches) {
          for (let i = 0; i + 1 < b.points.length; i++) {
            const a = b.points[i]!;
            const c = b.points[i + 1]!;
            // sample the (possibly diagonal) segment
            for (let k = 1; k < 40; k++) {
              const p = { x: a.x + ((c.x - a.x) * k) / 40, y: a.y + ((c.y - a.y) * k) / 40 };
              expect(p.x > t.bounds.x + 0.5 && p.x < t.bounds.x + t.bounds.w - 0.5 && p.y > t.bounds.y + 0.5 && p.y < t.bounds.y + t.bounds.h - 0.5, `${e.edgeId} through ${t.nameLabel.text}`).toBe(false);
            }
          }
        }
      }
    }
    // an edge whose direct line is free stays a direct (diagonal-capable) polyline: stubs + one segment
    const free = Object.values(scene.edges).filter((e) => (e as FkEdgeGeom).branches.every((b) => b.points.length <= 4));
    expect(free.length).toBeGreaterThan(0);
  });
});
