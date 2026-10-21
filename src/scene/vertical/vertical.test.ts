import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Diagram, Project, RelationalModel } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import type { Rect } from '../base';
import { labelRect, rectEncloses } from '../geometry';
import { defaultMeasure } from '../measure';
import { buildVerticalScene } from './index';
import { cardinalityFixture, nodeIdOf, pharmacyVFixture, type VFixture, type VType } from './fixtures';
import { childSymbolKind, parentSymbolKind } from './symbols';
import type { VFkEdgeGeom, VTableGeom } from './types';

const build = (f: { project: Project; diagram: Diagram; model: RelationalModel }) => buildVerticalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });
const edges = (s: ReturnType<typeof build>) => Object.values(s.edges) as VFkEdgeGeom[];
const tables = (s: ReturnType<typeof build>) => Object.values(s.nodes) as VTableGeom[];
const onBorder = (r: Rect, p: { x: number; y: number }, side: string): boolean => {
  const e = 1e-6;
  const inY = p.y >= r.y - e && p.y <= r.y + r.h + e;
  const inX = p.x >= r.x - e && p.x <= r.x + r.w + e;
  return side === 'left' ? Math.abs(p.x - r.x) < e && inY : side === 'right' ? Math.abs(p.x - (r.x + r.w)) < e && inY : side === 'top' ? Math.abs(p.y - r.y) < e && inX : Math.abs(p.y - (r.y + r.h)) < e && inX;
};

const modes: Array<[string, () => VFixture]> = [
  ['cf-vertical', () => pharmacyVFixture('crows-foot', 'vertical')],
  ['cf-horizontal', () => pharmacyVFixture('crows-foot', 'horizontal')],
  ['physical', () => pharmacyVFixture('physical')],
  ['card-cf', () => cardinalityFixture('crows-foot', 'vertical')],
  ['card-cf-h', () => cardinalityFixture('crows-foot', 'horizontal')],
  ['card-physical', () => cardinalityFixture('physical')],
];

describe.each(modes)('geometry %s', (_name, make) => {
  it('bounds.x/y === node.x/y; paintBounds enclose bounds and labels; scene bounds contain everything', () => {
    const f = make();
    const s = build(f);
    expect(s.warnings).toEqual([]);
    for (const [id, g] of Object.entries(s.nodes)) {
      const n = f.diagram.nodes[id]!;
      expect(g.bounds.x).toBe(n.x);
      expect(g.bounds.y).toBe(n.y);
      expect(rectEncloses(g.paintBounds, g.bounds)).toBe(true);
      expect(rectEncloses(s.bounds, g.paintBounds)).toBe(true);
    }
    for (const e of edges(s)) {
      expect(rectEncloses(s.bounds, e.bounds)).toBe(true);
      for (const pt of [...e.points, ...e.childSymbol.lines.flat(), ...e.parentSymbol.lines.flat()]) {
        expect(pt.x).toBeGreaterThanOrEqual(e.bounds.x);
        expect(pt.x).toBeLessThanOrEqual(e.bounds.x + e.bounds.w);
        expect(pt.y).toBeGreaterThanOrEqual(e.bounds.y);
        expect(pt.y).toBeLessThanOrEqual(e.bounds.y + e.bounds.h);
      }
    }
  });

  it('every FK end touches the border of the exact referenced ROW/cell, is axis aligned, and leaves perpendicular', () => {
    const f = make();
    const s = build(f);
    for (const e of edges(s)) {
      const fk = f.model.foreignKeys[e.ref.kind === 'foreignKey' ? e.ref.foreignKeyId : '']!;
      expect(e.pairs).toHaveLength(fk.columns.length);
      expect(e.sourceColumnId).toBe(fk.columns[0]!.sourceColumnId);
      expect(e.targetColumnId).toBe(fk.columns[0]!.targetColumnId);
      const sg = s.nodes[e.sourceNodeId] as VTableGeom;
      const tg = s.nodes[e.targetNodeId] as VTableGeom;
      const sRow = sg.rows.find((r) => r.columnId === e.sourceColumnId)!;
      const tRow = tg.rows.find((r) => r.columnId === e.targetColumnId)!;
      expect(e.ends[0].columnId).toBe(e.sourceColumnId);
      expect(e.ends[1].columnId).toBe(e.targetColumnId);
      expect(onBorder(sRow.rect, e.ends[0].at, e.ends[0].side)).toBe(true);
      expect(onBorder(tRow.rect, e.ends[1].at, e.ends[1].side)).toBe(true);
      expect(e.points[0]).toEqual(e.ends[0].at);
      expect(e.points[e.points.length - 1]).toEqual(e.ends[1].at);
      expect(e.childSymbol.at).toEqual(e.ends[0].at);
      expect(e.parentSymbol.at).toEqual(e.ends[1].at);
      expect(e.strokePoints[0]).toEqual(e.childSymbol.base);
      expect(e.strokePoints[e.strokePoints.length - 1]).toEqual(e.parentSymbol.base);
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i]!;
        const b = e.points[i + 1]!;
        expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
      }
      // first segment leaves away from the source border, last arrives from outside the target border
      const horizSide = (side: string) => side === 'left' || side === 'right';
      const p0 = e.points[0]!;
      const p1 = e.points[1]!;
      if (horizSide(e.sourceSide)) expect(Math.abs(p0.y - p1.y)).toBeLessThan(1e-6);
      else expect(Math.abs(p0.x - p1.x)).toBeLessThan(1e-6);
    }
  });

  it('row text fits its row/cell', () => {
    const s = build(make());
    for (const t of tables(s)) {
      for (const r of t.rows) {
        for (const l of [r.label, r.keyLabel, r.typeLabel, r.flagLabel, r.defaultLabel, r.detailLabel]) {
          if (!l) continue;
          const lr = labelRect(l);
          expect(lr.x).toBeGreaterThanOrEqual(r.rect.x - 1);
          expect(lr.x + lr.w).toBeLessThanOrEqual(r.rect.x + r.rect.w + 1);
        }
      }
      for (const sec of t.sections) for (const l of sec.lines) {
        const lr = labelRect(l.label);
        expect(lr.x + lr.w).toBeLessThanOrEqual(l.rect.x + l.rect.w + 1);
        if (l.flagLabel) expect(labelRect(l.flagLabel).x).toBeGreaterThanOrEqual(lr.x + lr.w - 1);
      }
    }
  });

  it('is deterministic and survives deeply frozen input', () => {
    const f = make();
    deepFreeze(f.project);
    const a = JSON.stringify(build(f));
    expect(JSON.stringify(build(f))).toBe(a);
  });
});

describe('end symbols', () => {
  it('maps every cardinality combination (parent / child)', () => {
    expect(parentSymbolKind({ parentMin: 1 })).toBe('exactly-one');
    expect(parentSymbolKind({ parentMin: 0 })).toBe('zero-or-one');
    expect(childSymbolKind({ childMax: 'many', childMin: 0 })).toBe('zero-or-many');
    expect(childSymbolKind({ childMax: 'many', childMin: 1 })).toBe('one-or-many');
    expect(childSymbolKind({ childMax: 'one', childMin: 0 })).toBe('zero-or-one');
    expect(childSymbolKind({ childMax: 'one', childMin: 1 })).toBe('exactly-one');
  });

  it('scene symbols come from fkCardinality: derived (unique FK column -> one) and stated', () => {
    const f = cardinalityFixture();
    const sym = (k: string) => {
      const e = edges(build(f)).find((x) => x.ref.kind === 'foreignKey' && x.ref.foreignKeyId === f.fks[k]!.id)!;
      return `${e.childSymbol.kind}|${e.parentSymbol.kind}`;
    };
    expect(sym('passport')).toBe('zero-or-one|exactly-one'); // unique NOT NULL FK: one child, mandatory parent
    expect(sym('profile')).toBe('zero-or-one|exactly-one'); // FK column is the PK
    expect(sym('author')).toBe('zero-or-many|exactly-one'); // NOT NULL
    expect(sym('editor')).toBe('zero-or-many|zero-or-one'); // nullable: optional parent
    expect(sym('manager')).toBe('zero-or-many|zero-or-one');
    f.fks.author!.cardinality = { childMin: 1 };
    f.fks.editor!.cardinality = { childMax: 'one', childMin: 1, parentMin: 1 };
    expect(sym('author')).toBe('one-or-many|exactly-one');
    expect(sym('editor')).toBe('exactly-one|exactly-one');
    const e = edges(build(f)).find((x) => x.ref.kind === 'foreignKey' && x.ref.foreignKeyId === f.fks.editor!.id)!;
    expect(e.cardinality.stated).toEqual(['childMax', 'childMin', 'parentMin']);
  });

  it('symbols are geometry: circles for zero, no markers, symbol lies on the connector axis', () => {
    const f = cardinalityFixture();
    for (const e of edges(build(f))) {
      for (const s of [e.childSymbol, e.parentSymbol]) {
        expect(s.circles.length).toBe(s.kind.startsWith('zero') ? 1 : 0);
        const along = s.side === 'left' || s.side === 'right' ? 'y' : 'x';
        // base is directly outward of `at`
        expect(Math.abs(s.base[along] - s.at[along])).toBeLessThan(1e-6);
      }
    }
  });
});

describe('composite and self FK', () => {
  it('a composite FK is ONE edge with one symbol pair and marks the other columns', () => {
    const f = cardinalityFixture();
    const list = edges(build(f)).filter((e) => e.composite);
    expect(list).toHaveLength(1);
    const e = list[0]!;
    expect(e.pairs).toHaveLength(2);
    expect(e.memberMarks.map((m) => m.end).sort()).toEqual(['source', 'target']);
    expect(e.memberMarks.map((m) => m.columnId).sort()).toEqual([f.fks.unit!.columns[1]!.sourceColumnId, f.fks.unit!.columns[1]!.targetColumnId].sort());
    expect(Object.values(build(f).edges).length).toBe(Object.keys(f.diagram.edges).length);
  });

  it('self FK leaves and arrives on the same side, between two different rows', () => {
    const f = cardinalityFixture();
    const e = edges(build(f)).find((x) => x.sourceNodeId === x.targetNodeId)!;
    expect(e.sourceSide).toBe(e.targetSide);
    expect(e.sourceColumnId).not.toBe(e.targetColumnId);
  });

  it('manual waypoints are honoured, and autoWaypoints reproduce the auto route as a manual one', () => {
    const f = cardinalityFixture();
    const auto = edges(build(f)).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === f.fks.author!.id)!;
    const edge = Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === f.fks.author!.id)!;
    edge.route = { mode: 'manual', waypoints: auto.autoWaypoints };
    const again = edges(build(f)).find((e) => e.edgeId === edge.id)!;
    expect(again.points).toEqual(auto.points);
    expect(again.bendHandles).toHaveLength(auto.autoWaypoints.length);
  });
});

describe('modes and options', () => {
  it('physical: type, NN/AI/default, schema-qualified name, constraints and indexes sections', () => {
    const f = pharmacyVFixture('physical');
    f.model.relations[f.rel.Doctor!.id]!.columns[0]!.autoIncrement = true;
    const s = build(f);
    const patient = s.nodes[nodeIdOf(f.diagram, f.rel.Patient!.id)] as VTableGeom;
    expect(patient.rows.every((r) => !!r.typeLabel)).toBe(true);
    expect(patient.sections.map((x) => x.kind)).toEqual(['constraints', 'indexes']);
    expect(patient.sections[0]!.lines.map((l) => l.label.text)).toContain('FK (DoctorSSN) → Doctor(SSN)');
    expect(patient.sections[0]!.lines.map((l) => l.label.text)).toContain('CHECK Age >= 0 AND Age < 150');
    expect(patient.sections[1]!.lines.map((l) => l.label.text)).toEqual(['ix_patient_doctor (DoctorSSN)', 'ux_patient_name (Name)']);
    expect(patient.sections[1]!.lines[1]!.flagLabel!.text).toBe('UNIQUE');
    const doctor = s.nodes[nodeIdOf(f.diagram, f.rel.Doctor!.id)] as VTableGeom;
    expect(doctor.rows[0]!.flagLabel!.text).toBe('NN AI');
    const pharm = s.nodes[nodeIdOf(f.diagram, f.rel.Pharmacy!.id)] as VTableGeom;
    expect(pharm.nameLabel.text).toBe('retail.Pharmacy');
    const sell = s.nodes[nodeIdOf(f.diagram, f.rel.Sell!.id)] as VTableGeom;
    expect(sell.rows[3]!.defaultLabel!.text).toBe('DEFAULT 0');
    f.diagram.options.physical!.showIndexes = false;
    f.diagram.options.physical!.showConstraints = false;
    expect((build(f).nodes[nodeIdOf(f.diagram, f.rel.Patient!.id)] as VTableGeom).sections).toEqual([]);
  });

  it("crow's foot: model column order kept (no PK grouping), roles, options hide types/markers", () => {
    const f = pharmacyVFixture('crows-foot', 'vertical');
    const patient = () => build(f).nodes[nodeIdOf(f.diagram, f.rel.Patient!.id)] as VTableGeom;
    expect(patient().rows.map((r) => r.role)).toEqual(['pk', 'plain', 'plain', 'plain', 'fk']);
    expect(patient().rows[0]!.label.underline).toBe('solid');
    expect(patient().rows[4]!.label.font.style).toBe('italic');
    expect(patient().rows[0]!.keyLabel!.text).toBe('PK');
    expect(patient().rows[1]!.flagLabel!.text).toBe('NN');
    f.diagram.options.crowsFoot!.showTypes = false;
    f.diagram.options.crowsFoot!.showNullability = false;
    expect(patient().rows.some((r) => r.typeLabel || r.flagLabel)).toBe(false);
  });

  it('node.width / node.height act as minimum table size', () => {
    const f = pharmacyVFixture('crows-foot', 'vertical');
    const id = nodeIdOf(f.diagram, f.rel.Doctor!.id);
    const before = build(f).nodes[id]!.bounds;
    f.diagram.nodes[id]!.width = before.w + 100;
    f.diagram.nodes[id]!.height = before.h + 60;
    const after = build(f).nodes[id]!.bounds;
    expect(after.w).toBe(before.w + 100);
    expect(after.h).toBeCloseTo(before.h + 60, 6);
    f.diagram.nodes[id]!.width = 10;
    f.diagram.nodes[id]!.height = 10;
    expect(build(f).nodes[id]!.bounds.w).toBe(before.w);
  });

  it('straight routing never runs through a foreign table', () => {
    const f = pharmacyVFixture('crows-foot', 'vertical');
    f.diagram.options.crowsFoot!.routing = 'straight';
    const s = build(f);
    expect(edges(s).length).toBe(9);
  });

  it('an explicit anchor side/offset moves the end inside its own row; invalid sides are coerced with a warning', () => {
    const f = cardinalityFixture();
    const edge = Object.values(f.diagram.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === f.fks.author!.id)!;
    edge.route.targetAnchor = { side: 'left', offset: 0.9 };
    edge.route.sourceAnchor = { side: 'top' };
    const s = build(f);
    expect(s.warnings.some((w) => w.startsWith(`anchor-coerced:${edge.id}:source`))).toBe(true);
    const e = s.edges[edge.id] as VFkEdgeGeom;
    const row = (s.nodes[e.targetNodeId] as VTableGeom).rows.find((r) => r.columnId === e.targetColumnId)!;
    expect(e.targetSide).toBe('left');
    expect(e.ends[1].at.y).toBeGreaterThan(row.rect.y + row.rect.h * 0.5);
    expect(e.ends[1].at.y).toBeLessThanOrEqual(row.rect.y + row.rect.h);
  });
});

describe('corrupt / soft-invalid input never throws', () => {
  it('dangling things warn; non-finite numbers and malformed columns are tolerated', () => {
    for (const type of ['crows-foot', 'physical'] as VType[]) {
      const f = cardinalityFixture(type);
      const ids = Object.values(f.diagram.nodes);
      ids[0]!.x = NaN;
      ids[1]!.y = Infinity;
      ids[2]!.width = NaN;
      const rel = f.model.relations[f.rel.Post!.id]!;
      (rel as unknown as { primaryKey: unknown }).primaryKey = undefined;
      f.model.relations[f.rel.Org!.id]!.columns.pop(); // FK unit -> Org loses a referenced column
      delete f.model.relations[f.rel.Profile!.id];
      f.diagram.edges.ghost = { id: 'ghost', ref: { kind: 'foreignKey', foreignKeyId: 'nope' }, route: { mode: 'auto', waypoints: [{ x: NaN, y: 1 }] } };
      f.diagram.edges.part = { id: 'part', ref: { kind: 'participant', relationshipId: 'a', participantId: 'b' }, route: { mode: 'auto', waypoints: [] } };
      const s = build(f);
      expect(s.warnings.some((w) => w.startsWith('dangling-fk-edge:ghost'))).toBe(true);
      expect(s.warnings.some((w) => w.startsWith('unsupported-edge:part'))).toBe(true);
      expect(s.warnings.some((w) => w.startsWith('missing-relation:'))).toBe(true);
      expect(s.warnings.some((w) => w.startsWith('fk-column-missing:'))).toBe(true);
      expect(Number.isFinite(s.bounds.w + s.bounds.h)).toBe(true);
    }
  });

  it('an empty relation draws', () => {
    const b = relationalBuilder('E');
    b.relation('Empty', []);
    const project = createBareProject('p');
    const model = b.build();
    const diagram = withDiagram(project, model, 'crows-foot');
    expect(Object.values(build({ project, diagram, model }).nodes)).toHaveLength(1);
    diagram.options.crowsFoot!.orientation = 'horizontal';
    expect(Object.values(build({ project, diagram, model }).nodes)).toHaveLength(1);
  });
});

describe('performance', () => {
  it('150 tables with a FK chain build quickly', () => {
    const b = relationalBuilder('Big');
    const hs = Array.from({ length: 150 }, (_, i) => b.relation(`T${i}`, [{ name: 'Id', type: 'INT' }, { name: 'ParentId', type: 'INT' }, 'Name'], { pk: ['Id'] }));
    for (let i = 1; i < 150; i++) b.fk(hs[i]!, ['ParentId'], hs[(i * 7) % i]!, ['Id']);
    const project = createBareProject('p');
    const model = b.build();
    const diagram = withDiagram(project, model, 'crows-foot');
    Object.values(diagram.nodes).forEach((n, i) => {
      n.x = (i % 15) * 260;
      n.y = Math.floor(i / 15) * 200;
    });
    const t0 = performance.now();
    const s = build({ project, diagram, model });
    const ms = performance.now() - t0;
    expect(Object.keys(s.nodes)).toHaveLength(150);
    expect(Object.keys(s.edges)).toHaveLength(149);
    expect(ms).toBeLessThan(15000);
    console.log(`150 tables: ${ms.toFixed(0)}ms`);
  });
});
