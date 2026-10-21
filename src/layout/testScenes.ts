/**
 * Hand-built Scene fixtures for layout tests (deliberately independent of the scene builders / model builders, which
 * other workers own). Node sizes mimic the real builders' typical sizes; positions start at (0,0) = "not laid out".
 */
import type { Id, Point } from '@/model/types';
import type { EdgeEndGeom, FontSpec, Rect, TextLabel } from '@/scene/base';
import type { EdgeGeom, NodeGeom, Scene } from '@/scene/types';

const FONT: FontSpec = { family: 'Helvetica', size: 13 };
const label = (text: string, r: Rect, underline?: 'solid' | 'dashed'): TextLabel => ({
  text,
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
  anchor: 'middle',
  font: FONT,
  width: text.length * 7,
  ...(underline ? { underline } : {}),
});

export function chenEntityNode(id: Id, name: string, x: number, y: number, weak = false): NodeGeom {
  const bounds = { x, y, w: Math.max(96, name.length * 9 + 30), h: 50 };
  return {
    kind: 'chen-entity',
    nodeId: id,
    ref: { kind: 'entity', id: `sem:${id}` },
    bounds,
    paintBounds: bounds,
    outline: { kind: 'rect', rect: bounds },
    weak,
    associative: false,
    label: label(name, bounds),
  };
}

export function chenRelationshipNode(id: Id, name: string, x: number, y: number, identifying = false): NodeGeom {
  const bounds = { x, y, w: Math.max(100, name.length * 9 + 56), h: 62 };
  return {
    kind: 'chen-relationship',
    nodeId: id,
    ref: { kind: 'relationship', id: `sem:${id}` },
    bounds,
    paintBounds: bounds,
    outline: { kind: 'diamond', rect: bounds },
    identifying,
    label: label(name, bounds),
  };
}

export interface AttrFlags {
  key?: boolean;
  partialKey?: boolean;
  multivalued?: boolean;
  derived?: boolean;
}

export function chenAttributeNode(id: Id, name: string, x: number, y: number, flags: AttrFlags = {}): NodeGeom {
  const bounds = { x, y, w: Math.max(72, name.length * 8 + 30), h: 38 };
  return {
    kind: 'chen-attribute',
    nodeId: id,
    ref: { kind: 'attribute', id: `sem:${id}` },
    bounds,
    paintBounds: bounds,
    outline: { kind: 'ellipse', rect: bounds },
    multivalued: !!flags.multivalued,
    derived: !!flags.derived,
    dashed: !!flags.derived,
    label: label(name, bounds, flags.key ? 'solid' : flags.partialKey ? 'dashed' : undefined),
  };
}

export function hTableNode(id: Id, name: string, columns: number, x: number, y: number, colWidth = 90): NodeGeom {
  const row = { x, y: y + 24, w: columns * colWidth, h: 32 };
  const bounds = { x, y, w: Math.max(row.w, name.length * 8), h: 56 };
  return {
    kind: 'h-table',
    nodeId: id,
    ref: { kind: 'relation', id: `sem:${id}` },
    bounds,
    paintBounds: bounds,
    outline: { kind: 'rect', rect: bounds },
    nameLabel: label(name, { x, y, w: bounds.w, h: 24 }),
    row,
    cells: [],
  };
}

const centerOf = (n: NodeGeom): Point => ({ x: n.bounds.x + n.bounds.w / 2, y: n.bounds.y + n.bounds.h / 2 });

function edgeBase(id: Id, s: NodeGeom, t: NodeGeom) {
  const a = centerOf(s);
  const b = centerOf(t);
  const bounds = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  return {
    edgeId: id,
    sourceNodeId: s.nodeId,
    targetNodeId: t.nodeId,
    paths: [[a, b]],
    bounds,
    ends: [
      { nodeId: s.nodeId, at: a, side: 'right' as const, anchorRect: s.bounds },
      { nodeId: t.nodeId, at: b, side: 'left' as const, anchorRect: t.bounds },
    ] as [EdgeEndGeom, EdgeEndGeom],
    bendHandles: [],
    autoWaypoints: [],
    labels: [],
  };
}

export function participantEdge(id: Id, rel: NodeGeom, ent: NodeGeom, relId: Id, participantId: Id): EdgeGeom {
  return {
    ...edgeBase(id, rel, ent),
    kind: 'chen-line',
    lineKind: 'participant',
    recursive: false,
    ref: { kind: 'participant', relationshipId: relId, participantId },
    double: false,
  };
}

export function attributeEdge(id: Id, owner: NodeGeom, attr: NodeGeom, attributeId: Id): EdgeGeom {
  return { ...edgeBase(id, owner, attr), kind: 'chen-line', lineKind: 'attribute', recursive: false, ref: { kind: 'attribute', attributeId }, double: false };
}

export function fkEdge(id: Id, child: NodeGeom, parent: NodeGeom): EdgeGeom {
  return {
    ...edgeBase(id, child, parent),
    kind: 'fk',
    ref: { kind: 'foreignKey', foreignKeyId: id },
    style: 'branches',
    branches: [],
  };
}

export function sceneOf(nodes: NodeGeom[], edges: EdgeGeom[], diagramId: Id = 'dg'): Scene {
  const rects = nodes.map((n) => n.paintBounds);
  const x0 = Math.min(...rects.map((r) => r.x), 0);
  const y0 = Math.min(...rects.map((r) => r.y), 0);
  const x1 = Math.max(...rects.map((r) => r.x + r.w), 0);
  const y1 = Math.max(...rects.map((r) => r.y + r.h), 0);
  return {
    diagramId,
    nodes: Object.fromEntries(nodes.map((n) => [n.nodeId, n])),
    edges: Object.fromEntries(edges.map((e) => [e.edgeId, e])),
    nodeOrder: nodes.map((n) => n.nodeId),
    edgeOrder: edges.map((e) => e.edgeId),
    bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    warnings: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chen fixtures
// ---------------------------------------------------------------------------------------------------------------------

export interface AttrSpec extends AttrFlags {
  name: string;
  children?: AttrSpec[];
}
export interface EntitySpec {
  name: string;
  weak?: boolean;
  attrs?: AttrSpec[];
}
export interface RelSpec {
  name: string;
  identifying?: boolean;
  /** Entity names (repeat a name for a recursive relationship). */
  participants: string[];
  attrs?: AttrSpec[];
}

/** Node ids: `e:<Name>`, `r:<Name>`, `a:<Owner>.<attr>`. */
export function chenScene(spec: { entities: EntitySpec[]; relationships?: RelSpec[] }, at: Point = { x: 0, y: 0 }): Scene {
  const nodes: NodeGeom[] = [];
  const edges: EdgeGeom[] = [];
  const byId = new Map<Id, NodeGeom>();
  const add = (n: NodeGeom): NodeGeom => (nodes.push(n), byId.set(n.nodeId, n), n);
  const addAttrs = (owner: NodeGeom, ownerKey: string, attrs: AttrSpec[] = []): void => {
    for (const a of attrs) {
      const id = `a:${ownerKey}.${a.name}`;
      const node = add(chenAttributeNode(id, a.name, at.x, at.y, a));
      edges.push(attributeEdge(`ea:${id}`, owner, node, `sem:${id}`));
      addAttrs(node, `${ownerKey}.${a.name}`, a.children);
    }
  };
  for (const e of spec.entities) {
    const n = add(chenEntityNode(`e:${e.name}`, e.name, at.x, at.y, e.weak));
    addAttrs(n, e.name, e.attrs);
  }
  for (const r of spec.relationships ?? []) {
    const n = add(chenRelationshipNode(`r:${r.name}`, r.name, at.x, at.y, r.identifying));
    r.participants.forEach((p, i) => {
      edges.push(participantEdge(`p:${r.name}:${p}#${i}`, n, byId.get(`e:${p}`)!, `sem:r:${r.name}`, `part:${r.name}:${i}`));
    });
    addAttrs(n, r.name, r.attrs);
  }
  return sceneOf(nodes, edges);
}

export const A = (name: string, flags: AttrFlags = {}, children?: AttrSpec[]): AttrSpec => ({ name, ...flags, children });

export const pharmacyEr = (): Scene =>
  chenScene({
    entities: [
      { name: 'Doctor', attrs: [A('SSN', { key: true }), A('Name'), A('Specialty'), A('YearsOfExperience')] },
      {
        name: 'Patient',
        attrs: [
          A('SSN', { key: true }),
          A('Name'),
          A('Address', {}, [A('Street'), A('City'), A('Zip')]),
          A('Age', { derived: true }),
        ],
      },
      { name: 'Pharmacy', attrs: [A('Name', { key: true }), A('Address'), A('Phone')] },
      { name: 'Company', attrs: [A('Name', { key: true }), A('Phone')] },
      { name: 'Drug', weak: true, attrs: [A('TradeName', { partialKey: true }), A('Formula')] },
    ],
    relationships: [
      { name: 'Treats', participants: ['Doctor', 'Patient'] },
      { name: 'Contract', participants: ['Pharmacy', 'Company'], attrs: [A('StartDate'), A('EndDate'), A('Supervisor')] },
      { name: 'Sells', participants: ['Pharmacy', 'Drug'], attrs: [A('Price')] },
      { name: 'Makes', identifying: true, participants: ['Company', 'Drug'] },
      { name: 'Prescription', participants: ['Doctor', 'Patient', 'Drug'], attrs: [A('Date'), A('Quantity')] },
    ],
  });

/** Example A (Student): composite + multivalued + derived. */
export const studentEr = (): Scene =>
  chenScene({
    entities: [
      {
        name: 'Student',
        attrs: [
          A('SID', { key: true }),
          A('Name', {}, [A('First'), A('Middle'), A('Last')]),
          A('Address', {}, [A('Street'), A('City'), A('Zip')]),
          A('ProgrammingLanguages', { multivalued: true }),
          A('Preference', { multivalued: true }),
          A('DOB'),
          A('Age', { derived: true }),
        ],
      },
    ],
  });

/** Example C: recursive 1:N. */
export const employeeEr = (): Scene =>
  chenScene({
    entities: [{ name: 'Employee', attrs: [A('Eid', { key: true }), A('Name')] }],
    relationships: [{ name: 'Manages', participants: ['Employee', 'Employee'] }],
  });

/** Example D: recursive M:N. */
export const courseEr = (): Scene =>
  chenScene({
    entities: [{ name: 'Course', attrs: [A('Cid', { key: true }), A('Name')] }],
    relationships: [{ name: 'PreReq', participants: ['Course', 'Course'], attrs: [A('Grade')] }],
  });

// ---------------------------------------------------------------------------------------------------------------------
// Relational fixtures
// ---------------------------------------------------------------------------------------------------------------------

export interface TableSpec {
  name: string;
  columns: number;
}
export interface FkSpec {
  /** referencing table */
  from: string;
  /** referenced table */
  to: string;
}

/** Node ids: `t:<Name>`; FK edge ids `fk:<from>-><to>#i`. Source = referencing table, target = referenced table. */
export function relationalScene(spec: { tables: TableSpec[]; fks: FkSpec[] }): Scene {
  const nodes = spec.tables.map((t) => hTableNode(`t:${t.name}`, t.name, t.columns, 0, 0));
  const by = new Map(nodes.map((n) => [n.nodeId, n]));
  const edges = spec.fks.map((f, i) => fkEdge(`fk:${f.from}->${f.to}#${i}`, by.get(`t:${f.from}`)!, by.get(`t:${f.to}`)!));
  return sceneOf(nodes, edges);
}

export const pharmacyRelational = (): Scene =>
  relationalScene({
    tables: [
      { name: 'Doctor', columns: 4 },
      { name: 'Patient', columns: 6 },
      { name: 'Pharmacy', columns: 3 },
      { name: 'Company', columns: 2 },
      { name: 'Drug', columns: 3 },
      { name: 'Contract', columns: 5 },
      { name: 'Sells', columns: 4 },
      { name: 'Prescription', columns: 7 },
    ],
    fks: [
      { from: 'Patient', to: 'Doctor' },
      { from: 'Drug', to: 'Company' },
      { from: 'Contract', to: 'Pharmacy' },
      { from: 'Contract', to: 'Company' },
      { from: 'Sells', to: 'Pharmacy' },
      { from: 'Sells', to: 'Drug' }, // composite FK = ONE edge
      { from: 'Prescription', to: 'Doctor' },
      { from: 'Prescription', to: 'Patient' },
      { from: 'Prescription', to: 'Drug' },
    ],
  });
