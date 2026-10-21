/**
 * Dev / test support: ER fixtures (spec Examples A-D, ternary, associative, Pharmacy) and a tiny deterministic
 * LAYOUT helper that places entities/relationships at given centres and fans attributes out in straight rows or
 * columns away from their owner. This is NOT the product's auto-layout (src/layout); it only makes fixtures legible.
 */
import { erBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { createDiagramForModel } from '@/model/diagramSync';
import { attributesOf } from '@/model/queries';
import type { Diagram, ErModel, Id, Point, Project } from '@/model/types';
import type { Rect } from '../base';
import { defaultMeasure } from '../measure';
import { buildChenScene } from './build';

export type Dir = 'up' | 'down' | 'left' | 'right';
const U: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface FixtureLayout {
  /** Centre of each entity / relationship, keyed by NAME (fixtures use unique names). */
  centers: Record<string, [number, number]>;
  /** Direction attributes fan out in, keyed by owner name. Default: away from the connected elements. */
  dirs?: Record<string, Dir>;
}

export interface ChenFixture {
  name: string;
  model: ErModel;
  layout: FixtureLayout;
}

export interface FixtureProject {
  project: Project;
  diagram: Diagram;
  model: ErModel;
}

const GAP_S = 14;
const GAP_U = 34;

/** Add the fixture to a fresh project, create its complete Chen diagram and lay it out. */
export function layoutChenFixture(fx: ChenFixture, tweak?: (d: Diagram) => void): FixtureProject {
  const project = createBareProject(fx.name);
  const model = fx.model;
  const diagram = createDiagramForModel(model, 'chen', { name: fx.name });
  project.models[model.id] = model;
  project.diagrams[diagram.id] = diagram;
  project.diagramOrder.push(diagram.id);
  tweak?.(diagram);

  const sizes: Record<Id, { w: number; h: number }> = {};
  const scene = buildChenScene({ project, diagram, model, measure: defaultMeasure });
  for (const g of Object.values(scene.nodes)) sizes[g.nodeId] = { w: g.bounds.w, h: g.bounds.h };
  const nodeOf = (ref: { kind: string; id: Id }): Id | undefined =>
    Object.values(diagram.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)?.id;
  const centers = new Map<Id, Point>();
  const place = (nodeId: Id, c: Point): void => {
    centers.set(nodeId, c);
    const s = sizes[nodeId]!;
    const n = diagram.nodes[nodeId]!;
    n.x = Math.round(c.x - s.w / 2);
    n.y = Math.round(c.y - s.h / 2);
  };

  const owners: Array<{ name: string; ref: { kind: 'entity' | 'relationship'; id: Id }; nodeId: Id }> = [];
  for (const e of Object.values(model.entities)) {
    owners.push({ name: e.name, ref: { kind: 'entity', id: e.id }, nodeId: nodeOf({ kind: 'entity', id: e.id })! });
  }
  for (const r of Object.values(model.relationships)) {
    // An associative entity's node also stands for its relationship: the relationship has no node of its own.
    const nodeId = nodeOf({ kind: 'relationship', id: r.id });
    if (nodeId) owners.push({ name: r.name, ref: { kind: 'relationship', id: r.id }, nodeId });
  }
  for (const o of owners) {
    const c = fx.layout.centers[o.name];
    if (!c) throw new Error(`fixture ${fx.name}: no centre for ${o.name}`);
    place(o.nodeId, { x: c[0], y: c[1] });
  }

  const neighbours = (o: (typeof owners)[number]): Point[] => {
    const out: Point[] = [];
    for (const r of Object.values(model.relationships)) {
      const involved = r.participants.map((p) => p.entityId);
      if (o.ref.kind === 'relationship' && o.ref.id === r.id) {
        for (const id of involved) out.push(centers.get(nodeOf({ kind: 'entity', id })!)!);
      } else if (o.ref.kind === 'entity' && involved.includes(o.ref.id)) {
        const rn = nodeOf({ kind: 'relationship', id: r.id });
        if (rn) out.push(centers.get(rn)!);
      }
    }
    return out;
  };

  const subtreeS = (attrId: Id, dir: Dir): number => {
    const s = sizes[nodeOf({ kind: 'attribute', id: attrId })!]!;
    const own = dir === 'up' || dir === 'down' ? s.w : s.h;
    const ch = attributesOf(model, { kind: 'attribute', id: attrId });
    if (ch.length === 0) return own;
    const sum = ch.reduce((t, c) => t + subtreeS(c.id, dir), 0) + GAP_S * (ch.length - 1);
    return Math.max(own, sum);
  };

  const support = (size: { w: number; h: number }, a: number): number => Math.abs(Math.cos(a)) * (size.w / 2) + Math.abs(Math.sin(a)) * (size.h / 2);

  /** Fan attributes over an arc around `baseAngle` (radians, y down) so lines never run through siblings. */
  const layoutRadial = (attrIds: Id[], origin: Point, ownerSize: { w: number; h: number }, baseAngle: number, spanDeg: number, minR: number): void => {
    const n = attrIds.length;
    if (n > 1) {
      const widest = Math.max(...attrIds.map((id) => sizes[nodeOf({ kind: 'attribute', id })!]!.w));
      minR = Math.max(minR, (widest + 24) / (2 * Math.sin((spanDeg * Math.PI) / 180 / (n - 1) / 2)));
    }
    attrIds.forEach((id, i) => {
      const a = baseAngle + (n === 1 ? 0 : (-spanDeg / 2 + (spanDeg * i) / (n - 1)) * (Math.PI / 180));
      const s = sizes[nodeOf({ kind: 'attribute', id })!]!;
      const dist = Math.max(minR, support(ownerSize, a) + GAP_U + support(s, a));
      const c = { x: origin.x + Math.cos(a) * dist, y: origin.y + Math.sin(a) * dist };
      place(nodeOf({ kind: 'attribute', id })!, c);
      const kids = attributesOf(model, { kind: 'attribute', id }).map((x) => x.id);
      layoutRadial(kids, c, s, a, Math.min(120, kids.length * 50), 0);
    });
  };

  const layoutRow = (attrIds: Id[], origin: Point, ownerSize: { w: number; h: number }, dir: Dir, depth = 0): void => {
    if (attrIds.length === 0) return;
    if (depth === 0 && attrIds.length > 3) {
      const widest = Math.max(...attrIds.map((id) => sizes[nodeOf({ kind: 'attribute', id })!]!.w));
      const span = 160;
      const step = (span * Math.PI) / 180 / (attrIds.length - 1);
      const minR = (widest + 40) / (2 * Math.sin(step / 2));
      const base = Math.atan2(U[dir].y, U[dir].x);
      layoutRadial(attrIds, origin, ownerSize, base, span, minR);
      return;
    }
    const u = U[dir];
    const vertical = dir === 'up' || dir === 'down';
    const ownerU = vertical ? ownerSize.h : ownerSize.w;
    const widths = attrIds.map((id) => subtreeS(id, dir));
    const total = widths.reduce((t, w) => t + w, 0) + GAP_S * (attrIds.length - 1);
    let cursor = -total / 2;
    attrIds.forEach((id, i) => {
      const nid = nodeOf({ kind: 'attribute', id })!;
      const s = sizes[nid]!;
      const slot = cursor + widths[i]! / 2;
      cursor += widths[i]! + GAP_S;
      const dist = ownerU / 2 + GAP_U + (vertical ? s.h : s.w) / 2;
      const c = vertical ? { x: origin.x + slot, y: origin.y + u.y * dist } : { x: origin.x + u.x * dist, y: origin.y + slot };
      place(nid, c);
      layoutRow(attributesOf(model, { kind: 'attribute', id }).map((a) => a.id), c, s, dir, depth + 1);
    });
  };

  for (const o of owners) {
    const oc = centers.get(o.nodeId)!;
    let dir = fx.layout.dirs?.[o.name];
    if (!dir) {
      const ns = neighbours(o);
      let bestScore = Infinity;
      dir = 'up';
      for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
        const u = U[d];
        const score = ns.reduce((s, n) => {
          const len = Math.hypot(n.x - oc.x, n.y - oc.y) || 1;
          return s + Math.max(0, ((n.x - oc.x) * u.x + (n.y - oc.y) * u.y) / len);
        }, 0);
        if (score < bestScore - 1e-9) {
          bestScore = score;
          dir = d;
        }
      }
    }
    layoutRow(attributesOf(model, o.ref).map((a) => a.id), oc, sizes[o.nodeId]!, dir);
  }
  return { project, diagram, model };
}

/** Bounds of every node of a laid-out fixture (for overlap checks). */
export const nodeRects = (diagram: Diagram, scene: { nodes: Record<Id, { bounds: Rect }> }): Rect[] =>
  Object.keys(diagram.nodes).map((id) => scene.nodes[id]!.bounds);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function exampleA(): ChenFixture {
  const b = erBuilder('Example A');
  b.entity('Student')
    .key('SID')
    .composite('Name', ['First', 'Last'])
    .composite('Address', ['Street', 'City', 'Zip'])
    .multivalued('ProgrammingLanguages')
    .multivalued('Preference')
    .attr('DOB')
    .derived('Age');
  return { name: 'example-a', model: b.build(), layout: { centers: { Student: [560, 360] }, dirs: { Student: 'up' } } };
}

export function exampleB(): ChenFixture {
  const b = erBuilder('Example B');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  return {
    name: 'example-b',
    model: b.build(),
    layout: { centers: { Company: [160, 200], Makes: [400, 200], Drug: [640, 200] }, dirs: { Company: 'up', Drug: 'up' } },
  };
}

export function exampleC(): ChenFixture {
  const b = erBuilder('Example C');
  const emp = b.entity('Employee').key('Eid').attr('Name');
  b.relate('manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  return { name: 'example-c', model: b.build(), layout: { centers: { Employee: [200, 200], manages: [460, 200] }, dirs: { Employee: 'left' } } };
}

export function exampleD(): ChenFixture {
  const b = erBuilder('Example D');
  const course = b.entity('Course').key('Cid').attr('Name');
  b.relate('prerequisite', course, course, 'M:N', { leftRole: 'course', rightRole: 'requires' });
  return { name: 'example-d', model: b.build(), layout: { centers: { Course: [200, 240], prerequisite: [460, 240] }, dirs: { Course: 'left' } } };
}

export function ternary(): ChenFixture {
  const b = erBuilder('Ternary');
  const supplier = b.entity('Supplier').key('Sid').attr('Name');
  const part = b.entity('Part').key('Pid').attr('Descr');
  const project = b.entity('Project').key('Jid').attr('Title');
  b.relationship('Supplies', [
    { entity: supplier, max: 'many', participation: 'total' },
    { entity: part, max: 'many' },
    { entity: project, max: 'many' },
  ]).attr('Qty');
  return {
    name: 'ternary',
    model: b.build(),
    layout: {
      centers: { Supplier: [160, 140], Part: [160, 400], Project: [640, 270], Supplies: [400, 270] },
      dirs: { Supplier: 'up', Part: 'down', Project: 'right', Supplies: 'down' },
    },
  };
}

export function associative(): ChenFixture {
  const b = erBuilder('Associative');
  const student = b.entity('Student').key('SID').attr('Name');
  const course = b.entity('Course').key('Cid').attr('Title');
  const reg = b.relate('Registers', student, course, 'M:N');
  b.associativeEntity('Registration', reg).key('RegNo').attr('Grade');
  return {
    name: 'associative',
    model: b.build(),
    layout: {
      centers: { Student: [140, 200], Course: [640, 200], Registration: [390, 200] },
      dirs: { Student: 'up', Course: 'up', Registration: 'down' },
    },
  };
}

export function pharmacy(): ChenFixture {
  const b = erBuilder('Pharmacy');
  const doctor = b.entity('Doctor').key('SSN').attr('Name').attr('Speciality').attr('YearsOfExperience');
  const patient = b.entity('Patient').key('SSN').attr('Name').attr('Address').attr('Age');
  const pharm = b.entity('Pharmacy').key('Name').attr('Address').attr('Phone');
  const company = b.entity('Company').key('Name').attr('Phone');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('PrimaryPhysician', doctor, patient, '1:N', { rightTotal: true });
  b.relate('Contact', company, pharm, '1:N').attr('Supervisor').attr('StartDate').attr('EndDate');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  b.relate('Sell', pharm, drug, 'M:N').attr('Price');
  b.relationship('Prescription', [
    { entity: doctor, max: 'many' },
    { entity: patient, max: 'many' },
    { entity: drug, max: 'many' },
  ])
    .attr('Date')
    .attr('Quantity');
  return {
    name: 'pharmacy',
    model: b.build(),
    layout: {
      centers: {
        Doctor: [260, 760],
        PrimaryPhysician: [260, 560],
        Patient: [260, 360],
        Prescription: [640, 760],
        Drug: [1040, 760],
        Makes: [1040, 560],
        Company: [1040, 360],
        Contact: [1420, 360],
        Pharmacy: [1800, 360],
        Sell: [1420, 760],
      },
      dirs: { Doctor: 'down', Patient: 'up', Company: 'up', Pharmacy: 'up', Drug: 'down', Contact: 'up', Sell: 'down', Prescription: 'down' },
    },
  };
}

/** Recursive 1:N whose entity has attributes ABOVE it and the diamond to its right (the loop must not use the attributes' side). */
export function recursiveAttrsTop(): ChenFixture {
  const b = erBuilder('Recursive attrs top');
  const emp = b.entity('Employee').key('Eid').attr('Name').attr('Salary');
  b.relate('manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate', rightTotal: true });
  return { name: 'recursive-attrs-top', model: b.build(), layout: { centers: { Employee: [300, 300], manages: [600, 300] }, dirs: { Employee: 'up' } } };
}

/** Four participants of ONE entity in one relationship (two loop pairs) with roles. */
export function familyFour(): ChenFixture {
  const b = erBuilder('Family');
  const a = b.entity('Person').key('id').attr('name');
  b.relationship('Family', [
    { entity: a, max: 'one', role: 'father' },
    { entity: a, max: 'one', role: 'mother', participation: 'total' },
    { entity: a, max: 'many', role: 'child' },
    { entity: a, max: 'many', role: 'sibling' },
  ]);
  return { name: 'family-four', model: b.build(), layout: { centers: { Person: [300, 200], Family: [300, 450] }, dirs: { Person: 'up' } } };
}

export const ALL_FIXTURES: Array<() => ChenFixture> = [exampleA, exampleB, exampleC, exampleD, ternary, associative, pharmacy];
