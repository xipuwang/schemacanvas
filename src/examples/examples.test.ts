// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '@/model/invariants';
import { syncDiagram } from '@/model/diagramSync';
import { parseProjectFile, serializeProject } from '@/model/io';
import { newId } from '@/model/ids';
import { nowIso } from '@/model/clock';
import type { ErModel, FkEdgeGeomLike, Project, RelationalModel } from './testTypes';
import { validateProject } from '@/validation';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import { nodeOverlaps } from '@/integration/helpers';
import { deepFreeze } from '@/test/deepFreeze';
import { EXAMPLES, buildExample } from './index';
import { LAYOUTS } from './layouts';
import { nodeIdsByKey } from './nodeKeys';

const relModel = (p: Project): RelationalModel => Object.values(p.models).find((m): m is RelationalModel => m.kind === 'relational')!;
const erModel = (p: Project): ErModel => Object.values(p.models).find((m): m is ErModel => m.kind === 'er')!;

/** `Name(col, col)` with the PK columns listed in `pk(...)`. */
function schema(p: Project): Record<string, { cols: string[]; pk: string[]; nullable: string[] }> {
  const m = relModel(p);
  const out: Record<string, { cols: string[]; pk: string[]; nullable: string[] }> = {};
  for (const r of Object.values(m.relations)) {
    const name = (id: string): string => r.columns.find((c) => c.id === id)!.name;
    out[r.name] = { cols: r.columns.map((c) => c.name), pk: r.primaryKey.map(name), nullable: r.columns.filter((c) => c.nullable).map((c) => c.name) };
  }
  return out;
}

/** `Source.(a, b) -> Target.(x, y)` strings, sorted. */
function fks(p: Project): string[] {
  const m = relModel(p);
  const col = (relId: string, colId: string): string => m.relations[relId]!.columns.find((c) => c.id === colId)!.name;
  return Object.values(m.foreignKeys)
    .map((f) => {
      const s = m.relations[f.sourceRelationId]!.name;
      const t = m.relations[f.targetRelationId]!.name;
      return `${s}.(${f.columns.map((c) => col(f.sourceRelationId, c.sourceColumnId)).join(', ')}) -> ${t}.(${f.columns.map((c) => col(f.targetRelationId, c.targetColumnId)).join(', ')})`;
    })
    .sort();
}

describe('catalogue', () => {
  it('lists the spec examples A-E first, in order, then the two teaching examples', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'composite-multivalued', 'weak-entity', 'recursive-1n', 'recursive-mn', 'pharmacy', 'university', 'company',
    ]);
    for (const e of EXAMPLES) {
      expect(e.titleKey).toBe(`examples.${e.id}.title`);
      expect(e.descriptionKey).toBe(`examples.${e.id}.description`);
      expect(['basic', 'intermediate', 'advanced']).toContain(e.level);
    }
  });
  it('rejects an unknown id', () => expect(() => buildExample('nope')).toThrow(/Unknown example/));
});

describe.each(EXAMPLES.map((e) => e.id))('example %s', (id) => {
  const p = buildExample(id);

  it('is complete: ER + Chen, relational (real converter) + horizontal diagram, one conversion record, ER tab active first', () => {
    expect(Object.values(p.models).map((m) => m.kind).sort()).toEqual(['er', 'relational']);
    expect(p.diagramOrder.map((d) => p.diagrams[d]!.type)).toEqual(['chen', 'relational-schema']);
    const rec = Object.values(p.conversions);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.erModelId).toBe(erModel(p).id);
    expect(rec[0]!.relationalModelId).toBe(relModel(p).id);
    expect(relModel(p).derivedFrom?.conversionId).toBe(rec[0]!.id);
    expect(rec[0]!.decisions.length).toBeGreaterThan(0);
  });

  it('is deterministic: building twice gives deep-equal projects with fixed timestamps', () => {
    expect(buildExample(id)).toEqual(p);
    expect(p.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(p.updatedAt).toBe(p.createdAt);
  });

  it('passes validation with ZERO errors and ZERO warnings on both models', () => {
    const issues = validateProject(deepFreeze(structuredClone(p)));
    expect(issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity} ${i.code}`)).toEqual([]);
  });

  it('keeps every invariant and both diagrams are fixed points of syncDiagram', () => {
    expect(checkInvariants(p)).toEqual([]);
    const copy = structuredClone(p);
    for (const d of p.diagramOrder) {
      const r = syncDiagram(copy, d);
      expect(r).toEqual({ addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] });
    }
    expect(copy).toEqual(p);
  });

  it('round-trips through the project file format deep-equal', () => {
    const res = parseProjectFile(serializeProject(p, '2026-01-01T00:00:00.000Z'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repairs).toEqual([]);
      expect(res.project).toEqual(p);
    }
  });

  it('has a frozen position for every node (no node keeps a provisional position)', () => {
    for (const dId of p.diagramOrder) {
      const d = p.diagrams[dId]!;
      const table = d.type === 'chen' ? LAYOUTS[id]!.er : LAYOUTS[id]!.rel;
      const keys = Object.keys(nodeIdsByKey(p.models[d.modelId]!, d));
      expect(keys.filter((k) => !(k in table))).toEqual([]);
      expect(Object.keys(table).filter((k) => !keys.includes(k))).toEqual([]); // no stale entries
    }
  });

  it('renders clean scenes: no warnings, no overlapping nodes, nothing dangling', () => {
    for (const dId of p.diagramOrder) {
      const scene: Scene = buildScene(p, dId);
      expect(scene.warnings).toEqual([]);
      expect(nodeOverlaps(scene)).toEqual([]);
      expect(Object.keys(scene.nodes).length).toBe(Object.keys(p.diagrams[dId]!.nodes).length);
      expect(Object.keys(scene.edges).length).toBe(Object.keys(p.diagrams[dId]!.edges).length);
    }
  });

  it('draws every FK branch from its own source column to the exact referenced column cell', () => {
    const dId = p.diagramOrder[1]!;
    const scene = buildScene(p, dId);
    const m = relModel(p);
    const fkEdges = Object.values(scene.edges).filter((e): e is FkEdgeGeomLike => e.kind === 'fk');
    expect(fkEdges.length).toBe(Object.keys(m.foreignKeys).length);
    for (const e of fkEdges) {
      const fk = m.foreignKeys[e.ref.kind === 'foreignKey' ? e.ref.foreignKeyId : '']!;
      const pairs = fk.columns.map((c) => [c.sourceColumnId, c.targetColumnId]);
      if (e.style === 'bracket') {
        // one arrow between a bracket over the FK cells and one over the referenced key; every pair is listed
        expect(e.branches).toHaveLength(1);
        expect(e.pairs!.map((c) => [c.sourceColumnId, c.targetColumnId])).toEqual(pairs);
      } else {
        expect(e.branches.map((x) => [x.sourceColumnId, x.targetColumnId])).toEqual(pairs);
      }
      // the arrow tip touches the border of the referenced cell(s): inside its x-span, on its top or bottom edge
      for (const x of e.branches) {
        const tip = x.arrow.tip;
        const c = x.targetCell;
        expect(tip.x).toBeGreaterThanOrEqual(c.x - 0.5);
        expect(tip.x).toBeLessThanOrEqual(c.x + c.w + 0.5);
        const onEdge = Math.abs(tip.y - c.y) < 0.5 || Math.abs(tip.y - (c.y + c.h)) < 0.5;
        const onSide = Math.abs(tip.x - c.x) < 0.5 || Math.abs(tip.x - (c.x + c.w)) < 0.5;
        expect(onEdge || onSide).toBe(true);
      }
    }
  });

  it('leaves the id generator and clock restored (user ids stay random, time is real)', () => {
    expect(newId('ent')).toMatch(/^ent_[0-9a-z]{10}$/);
    expect(nowIso()).not.toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('conversion matches the specification literally', () => {
  it('A: composite flattened, two multivalued relations, Age omitted with an explanation', () => {
    const p = buildExample('composite-multivalued');
    expect(schema(p)).toEqual({
      Student: { cols: ['SID', 'First', 'Middle', 'Last', 'Street', 'City', 'ZipCode', 'DOB'], pk: ['SID'], nullable: ['Middle'] },
      Student_ProgrammingLanguages: { cols: ['SID', 'ProgrammingLanguages'], pk: ['SID', 'ProgrammingLanguages'], nullable: [] },
      Student_Preference: { cols: ['SID', 'Preference'], pk: ['SID', 'Preference'], nullable: [] },
    });
    expect(fks(p)).toEqual(['Student_Preference.(SID) -> Student.(SID)', 'Student_ProgrammingLanguages.(SID) -> Student.(SID)']);
    const rec = Object.values(p.conversions)[0]!;
    const age = Object.values(erModel(p).attributes).find((a) => a.name === 'Age')!;
    const entry = rec.trace.find((t) => t.source.kind === 'attribute' && t.source.id === age.id)!;
    expect(entry.targets).toEqual([]);
    expect(rec.decisions.some((d) => d.sources.some((s) => s.kind === 'attribute' && s.id === age.id) && /derived/i.test(d.title + d.explanation))).toBe(true);
  });

  it('B: Drug(CompanyName, TradeName, Formula) with PK (CompanyName, TradeName) and FK to Company; no table for Makes', () => {
    const p = buildExample('weak-entity');
    const s = schema(p);
    expect(Object.keys(s).sort()).toEqual(['Company', 'Drug']);
    expect(s.Company).toMatchObject({ cols: ['name', 'address'], pk: ['name'] });
    expect(s.Drug).toMatchObject({ cols: ['CompanyName', 'TradeName', 'Formula'], pk: ['CompanyName', 'TradeName'] });
    expect(fks(p)).toEqual(['Drug.(CompanyName) -> Company.(name)']);
    const er = erModel(p);
    const makes = Object.values(er.relationships)[0]!;
    expect(makes.identifying).toBe(true);
    expect(makes.participants.find((x) => er.entities[x.entityId]!.weak)!.participation).toBe('total');
  });

  it('C: Employee(Eid, Name, ManagerEid) with ManagerEid -> Employee.Eid', () => {
    const p = buildExample('recursive-1n');
    expect(schema(p)).toEqual({ Employee: { cols: ['Eid', 'Name', 'ManagerEid'], pk: ['Eid'], nullable: ['ManagerEid'] } });
    expect(fks(p)).toEqual(['Employee.(ManagerEid) -> Employee.(Eid)']);
  });

  it('D: PreReq(Cid, Req_Cid) with PK (Cid, Req_Cid) and two FKs to Course', () => {
    const p = buildExample('recursive-mn');
    const s = schema(p);
    expect(Object.keys(s).sort()).toEqual(['Course', 'PreReq']);
    expect(s.PreReq).toMatchObject({ cols: ['Cid', 'Req_Cid'], pk: ['Cid', 'Req_Cid'] });
    expect(fks(p)).toEqual(['PreReq.(Cid) -> Course.(Cid)', 'PreReq.(Req_Cid) -> Course.(Cid)']);
  });

  it('E: pharmacy keys, composite foreign keys and relationship attributes', () => {
    const p = buildExample('pharmacy');
    const s = schema(p);
    expect(Object.keys(s).sort()).toEqual(['Company', 'Contact', 'Doctor', 'Drug', 'Patient', 'Pharmacy', 'Prescription', 'Sell']);
    expect(s.Drug).toMatchObject({ cols: ['CompanyName', 'TradeName', 'Formula'], pk: ['CompanyName', 'TradeName'] });
    expect(s.Patient!.cols).toContain('DoctorSSN');
    expect(s.Prescription).toMatchObject({
      cols: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date', 'Quantity'],
      pk: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date'],
    });
    expect(s.Contact).toMatchObject({ cols: ['CompanyName', 'PharmacyName', 'StartDate', 'EndDate', 'Supervisor'], pk: ['CompanyName', 'PharmacyName'] });
    expect(s.Contact!.nullable).toEqual(['EndDate']);
    expect(s.Sell).toMatchObject({ cols: ['CompanyName', 'DrugTradeName', 'PharmacyName', 'Price'], pk: ['CompanyName', 'DrugTradeName', 'PharmacyName'] });
    expect(fks(p)).toEqual(
      [
        'Contact.(CompanyName) -> Company.(name)',
        'Contact.(PharmacyName) -> Pharmacy.(Name)',
        'Drug.(CompanyName) -> Company.(name)',
        'Patient.(DoctorSSN) -> Doctor.(SSN)',
        'Prescription.(CompanyName, DrugTradeName) -> Drug.(CompanyName, TradeName)',
        'Prescription.(DoctorSSN) -> Doctor.(SSN)',
        'Prescription.(PatientSSN) -> Patient.(SSN)',
        'Sell.(CompanyName, DrugTradeName) -> Drug.(CompanyName, TradeName)',
        'Sell.(PharmacyName) -> Pharmacy.(Name)',
      ].sort(),
    );
    // the composite FKs are ONE logical constraint each
    const m = relModel(p);
    expect(Object.values(m.foreignKeys).filter((f) => f.columns.length === 2)).toHaveLength(2);
  });

  it('University: Enrollment is one relation keyed by both foreign keys and carrying Grade', () => {
    const p = buildExample('university');
    const s = schema(p);
    expect(Object.keys(s).sort()).toEqual(['Course', 'Department', 'Enrollment', 'Instructor', 'Student']);
    expect(s.Enrollment).toMatchObject({ cols: ['StudentId', 'CourseId', 'Grade'], pk: ['StudentId', 'CourseId'] });
    expect(fks(p)).toEqual(
      [
        'Course.(DeptId) -> Department.(DeptId)',
        'Course.(InstructorId) -> Instructor.(InstructorId)',
        'Enrollment.(CourseId) -> Course.(CourseId)',
        'Enrollment.(StudentId) -> Student.(StudentId)',
        'Instructor.(DeptId) -> Department.(DeptId)',
        'Student.(DeptId) -> Department.(DeptId)',
      ].sort(),
    );
  });

  it('Company (Elmasri): supervision, 1:1 manager, works-on with Hours, weak Dependent, multivalued Locations', () => {
    const p = buildExample('company');
    const s = schema(p);
    expect(Object.keys(s).sort()).toEqual(['Department', 'Department_Locations', 'Dependent', 'Employee', 'Project', 'WorksOn']);
    expect(s.Dependent!.pk).toEqual(['Ssn', 'DependentName']);
    expect(s.WorksOn).toMatchObject({ cols: ['Ssn', 'Pnumber', 'Hours'], pk: ['Ssn', 'Pnumber'] });
    expect(s.Department!.cols).toEqual(['Dnumber', 'Dname', 'Mgr_Ssn', 'StartDate']);
    expect(s.Department_Locations).toMatchObject({ cols: ['Dnumber', 'Locations'], pk: ['Dnumber', 'Locations'] });
    expect(fks(p)).toEqual(
      [
        'Department.(Mgr_Ssn) -> Employee.(Ssn)',
        'Department_Locations.(Dnumber) -> Department.(Dnumber)',
        'Dependent.(Ssn) -> Employee.(Ssn)',
        'Employee.(Dnumber) -> Department.(Dnumber)',
        'Employee.(Super_Ssn) -> Employee.(Ssn)',
        'Project.(Dnumber) -> Department.(Dnumber)',
        'WorksOn.(Pnumber) -> Project.(Pnumber)',
        'WorksOn.(Ssn) -> Employee.(Ssn)',
      ].sort(),
    );
  });
});
