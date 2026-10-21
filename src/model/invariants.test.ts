import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants, repairPresentation, type InvariantViolation } from './invariants';
import { useDeterministicIds } from './ids';
import { projectWith, sampleEr, sampleRel } from './ops/testUtils';
import type { Project } from './types';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds();
});
afterEach(() => restore());

const clone = (p: Project): Project => JSON.parse(JSON.stringify(p));
const codes = (p: Project): string[] => checkInvariants(p).map((v) => v.code);
const only = (p: Project, code: string): InvariantViolation[] => checkInvariants(p).filter((v) => v.code === code);

function erProject(): Project {
  return projectWith(sampleEr().model, 'chen');
}
function relProject(): Project {
  return projectWith(sampleRel().model, 'relational-schema');
}
const firstDiagram = (p: Project) => Object.values(p.diagrams)[0]!;

describe('checkInvariants', () => {
  it('is clean on fresh ER and relational projects', () => {
    expect(checkInvariants(erProject())).toEqual([]);
    expect(checkInvariants(relProject())).toEqual([]);
  });

  it('flags a record key that differs from the element id (structural), at every level', () => {
    const p = erProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'er') throw new Error();
    const [eid, e] = Object.entries(model.entities)[0]!;
    delete model.entities[eid];
    model.entities['wrong_key'] = e;
    const d = firstDiagram(p);
    const [nid, n] = Object.entries(d.nodes)[0]!;
    delete d.nodes[nid];
    d.nodes['bad_node_key'] = n;
    const v = checkInvariants(p).filter((x) => x.code === 'key-id-mismatch');
    expect(v.map((x) => x.path)).toEqual(expect.arrayContaining([`models.${model.id}.entities.wrong_key`, `diagrams.${d.id}.nodes.bad_node_key`]));
    expect(v.every((x) => x.class === 'structural')).toBe(true);
  });

  it('flags ids reused project-wide, including participant / column ids and node ids across diagrams', () => {
    const p = relProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error();
    const rels = Object.values(model.relations);
    rels[1]!.columns[0]!.id = rels[0]!.columns[0]!.id; // two columns share an id
    expect(only(p, 'duplicate-id').length).toBeGreaterThan(0);

    const q = erProject();
    const er = Object.values(q.models)[0]!;
    if (er.kind !== 'er') throw new Error();
    const rel = Object.values(er.relationships)[0]!;
    rel.participants[0]!.id = Object.values(er.entities)[0]!.id; // participant id collides with an entity id
    expect(only(q, 'duplicate-id').length).toBe(1);
  });

  it('flags diagramOrder drift as presentation: missing, extra and duplicated entries', () => {
    for (const mutate of [
      (p: Project) => (p.diagramOrder = []),
      (p: Project) => p.diagramOrder.push('dgm_ghost'),
      (p: Project) => p.diagramOrder.push(p.diagramOrder[0]!),
    ]) {
      const p = erProject();
      mutate(p);
      const v = only(p, 'diagram-order');
      expect(v).toHaveLength(1);
      expect(v[0]!.class).toBe('presentation');
    }
  });

  it('flags a diagram whose model is missing or of the wrong kind (structural)', () => {
    const p = erProject();
    firstDiagram(p).modelId = 'mdl_ghost';
    expect(only(p, 'diagram-model-missing')[0]!.class).toBe('structural');

    const q = erProject();
    q.diagrams[Object.keys(q.diagrams)[0]!]!.type = 'relational-schema';
    expect(only(q, 'diagram-model-kind')[0]!.class).toBe('structural');
  });

  it('flags a missing option block / grid / typography (presentation)', () => {
    const p = erProject();
    delete firstDiagram(p).options.chen;
    expect(only(p, 'option-block-missing')).toHaveLength(1);
    const q = relProject();
    delete (firstDiagram(q).options as { grid?: unknown }).grid;
    expect(only(q, 'option-block-missing')[0]!.class).toBe('presentation');
  });

  it('flags nodes with a disallowed kind, a dangling ref and duplicates (presentation)', () => {
    const p = erProject();
    const d = firstDiagram(p);
    const [first, second, third] = Object.values(d.nodes);
    first!.ref = { kind: 'relation', id: 'whatever' }; // chen cannot show relations
    second!.ref = { kind: 'entity', id: 'ent_ghost' };
    third!.ref = { ...Object.values(d.nodes)[3]!.ref }; // duplicate of the 4th node's ref
    const got = new Set(codes(p));
    expect(got.has('node-ref-kind')).toBe(true);
    expect(got.has('node-ref-dangling')).toBe(true);
    expect(got.has('node-duplicate')).toBe(true);
    expect(checkInvariants(p).filter((v) => v.code.startsWith('node-')).every((v) => v.class === 'presentation')).toBe(true);
  });

  it('flags dangling edges, edges lacking an endpoint node, and duplicate edges (presentation)', () => {
    const p = relProject();
    const d = firstDiagram(p);
    const edges = Object.values(d.edges);
    edges[0]!.ref = { kind: 'foreignKey', foreignKeyId: 'fk_ghost' };
    // drop the node of edge[1]'s source relation
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error();
    const fk1 = model.foreignKeys[(edges[1]!.ref as { foreignKeyId: string }).foreignKeyId]!;
    const srcNode = Object.values(d.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === fk1.sourceRelationId)!;
    delete d.nodes[srcNode.id];
    // duplicate edge: copy edge[2]'s ref into a new edge
    d.edges['edg_dup'] = { id: 'edg_dup', ref: { ...edges[2]!.ref }, route: { mode: 'auto', waypoints: [] } };
    const got = new Set(codes(p));
    for (const c of ['edge-ref-dangling', 'edge-endpoint-missing', 'edge-duplicate']) expect(got.has(c)).toBe(true);
  });

  it('flags columnWidths keys that are not columns of the node relation (presentation)', () => {
    const p = relProject();
    const node = Object.values(firstDiagram(p).nodes)[0]!;
    node.columnWidths = { col_ghost: 80 };
    const v = only(p, 'column-widths-orphan');
    expect(v).toHaveLength(1);
    expect(v[0]!.class).toBe('presentation');
  });

  it('flags attribute owners that are missing or cyclic (structural)', () => {
    const p = erProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'er') throw new Error();
    const attrs = Object.values(model.attributes);
    attrs[0]!.owner = { kind: 'entity', id: 'ent_ghost' };
    expect(only(p, 'attribute-owner-missing')[0]!.class).toBe('structural');

    const q = erProject();
    const m2 = Object.values(q.models)[0]!;
    if (m2.kind !== 'er') throw new Error();
    const [a, b] = Object.values(m2.attributes);
    a!.owner = { kind: 'attribute', id: b!.id };
    b!.owner = { kind: 'attribute', id: a!.id };
    expect(only(q, 'attribute-owner-cycle').length).toBeGreaterThan(0);
  });

  it('flags PK / unique / index column ids that are foreign or duplicated (structural)', () => {
    const p = relProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error();
    const [a, b] = Object.values(model.relations);
    a!.primaryKey = [b!.columns[0]!.id]; // column of another relation
    a!.uniques.push({ id: 'uq_x', columnIds: [a!.columns[0]!.id, a!.columns[0]!.id] });
    a!.indexes.push({ id: 'idx_x', name: 'i', columnIds: ['col_ghost'], unique: false });
    const got = checkInvariants(p);
    expect(got.filter((v) => v.code === 'key-column-invalid')).toHaveLength(2);
    expect(got.filter((v) => v.code === 'key-column-duplicate')).toHaveLength(1);
    expect(got.every((v) => v.class === 'structural')).toBe(true);
  });

  it('flags FK relations that do not exist (structural)', () => {
    const p = relProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error();
    const fk = Object.values(model.foreignKeys)[0]!;
    fk.sourceRelationId = 'rln_ghost';
    fk.targetRelationId = 'rln_ghost2';
    expect(only(p, 'fk-relation-missing')).toHaveLength(2);
  });

  it('tolerates SOFT states without violations (FK pair to a missing column, no PK, nullable PK, <2 participants)', () => {
    const p = relProject();
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error();
    const fk = Object.values(model.foreignKeys)[0]!;
    fk.columns.push({ sourceColumnId: 'col_ghost', targetColumnId: 'col_ghost2' });
    Object.values(model.relations)[0]!.primaryKey = [];
    Object.values(model.relations)[1]!.columns[0]!.nullable = true;
    expect(checkInvariants(p)).toEqual([]);

    const q = erProject();
    const er = Object.values(q.models)[0]!;
    if (er.kind !== 'er') throw new Error();
    Object.values(er.relationships)[0]!.participants.pop();
    Object.values(er.relationships)[0]!.keyParticipantIds = ['par_ghost'];
    expect(codes(q)).not.toContain('key-id-mismatch');
    // the dropped participant's edge is now a presentation problem only
    expect(checkInvariants(q).every((v) => v.class === 'presentation')).toBe(true);
  });
});

describe('repairPresentation', () => {
  function corrupted(): Project {
    const p = relProject();
    const d = firstDiagram(p);
    const nodes = Object.values(d.nodes);
    nodes[0]!.columnWidths = { col_ghost: 50 };
    nodes[1]!.ref = { kind: 'relation', id: 'rln_ghost' };
    d.nodes['nod_dup'] = { ...nodes[2]!, id: 'nod_dup' };
    Object.values(d.edges)[0]!.ref = { kind: 'foreignKey', foreignKeyId: 'fk_ghost' };
    delete (d.options as { relational?: unknown }).relational;
    p.diagramOrder = ['dgm_ghost'];
    return p;
  }

  it('fixes every presentation violation, is idempotent, and leaves semantics byte-identical', () => {
    const p = corrupted();
    const semantics = JSON.stringify([p.models, p.conversions]);
    expect(checkInvariants(p).length).toBeGreaterThan(4);
    const log = repairPresentation(p);
    expect(log.length).toBeGreaterThan(4);
    expect(checkInvariants(p)).toEqual([]);
    expect(JSON.stringify([p.models, p.conversions])).toBe(semantics);
    const again = clone(p);
    expect(repairPresentation(again)).toEqual([]);
    expect(again).toEqual(p);
  });

  it('restores missing option blocks from the defaults of the diagram type', () => {
    const p = erProject();
    delete firstDiagram(p).options.chen;
    repairPresentation(p);
    expect(firstDiagram(p).options.chen).toEqual({ showRoles: true, showDataTypes: false, cardinalityStyle: 'letters', routing: 'straight' });
  });

  it('keeps the first of duplicate nodes/edges and rebuilds diagramOrder deterministically', () => {
    const p = erProject();
    const d = firstDiagram(p);
    const first = Object.values(d.nodes)[0]!;
    d.nodes['nod_copy'] = { ...first, id: 'nod_copy' };
    p.diagramOrder = ['dgm_ghost', d.id, d.id];
    repairPresentation(p);
    expect(d.nodes[first.id]).toBeDefined();
    expect(d.nodes['nod_copy']).toBeUndefined();
    expect(p.diagramOrder).toEqual([d.id]);
  });

  it('never touches structural problems and skips diagrams it cannot judge', () => {
    const p = erProject();
    const d = firstDiagram(p);
    d.modelId = 'mdl_ghost';
    const nodeCount = Object.keys(d.nodes).length;
    repairPresentation(p);
    expect(Object.keys(d.nodes)).toHaveLength(nodeCount); // not wiped because the model is missing
    expect(codes(p)).toContain('diagram-model-missing');
  });

  it('does not add nodes or edges that are merely missing', () => {
    const p = erProject();
    const d = firstDiagram(p);
    const id = Object.keys(d.edges)[0]!;
    delete d.edges[id];
    expect(repairPresentation(p)).toEqual([]);
    expect(d.edges[id]).toBeUndefined();
  });
});
