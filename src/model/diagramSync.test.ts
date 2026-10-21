import { describe, expect, it } from 'vitest';
import { erBuilder, relationalBuilder } from './builders';
import { createBareProject } from './defaults';
import {
  createDiagramForModel,
  edgeEndpointRefs,
  expectedEdgeRefs,
  nodeIdOfRef,
  resolveRefsInDiagram,
  syncDiagram,
  syncDiagramEdges,
  syncModelDiagrams,
  withDiagram,
} from './diagramSync';
import { edgeRefKey, refKey } from './queries';

function pharmacyEr() {
  const b = erBuilder('Pharmacy');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').composite('Dose', ['Amount', 'Unit']);
  const makes = b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  makes.attr('since');
  return { b, company, drug, makes, model: b.build() };
}

describe('createDiagramForModel (chen)', () => {
  it('creates one node per entity/relationship/attribute and every edge, with no overlap of ids', () => {
    const { model, makes } = pharmacyEr();
    const d = createDiagramForModel(model, 'chen');
    const attrs = Object.keys(model.attributes).length; // name,address,TradeName,Dose,Amount,Unit,since
    expect(Object.keys(d.nodes)).toHaveLength(2 + 1 + attrs);
    // edges: 2 participants + one link per attribute
    expect(Object.keys(d.edges)).toHaveLength(2 + attrs);
    const keys = Object.values(d.edges).map((e) => edgeRefKey(e.ref));
    expect(new Set(keys).size).toBe(keys.length);
    // participant edge runs relationship -> entity
    const p = makes.relationship.participants[1]!;
    expect(edgeEndpointRefs(model, { kind: 'participant', relationshipId: makes.id, participantId: p.id })).toEqual({
      source: { kind: 'relationship', id: makes.id },
      target: { kind: 'entity', id: p.entityId },
    });
    // every node has a distinct zIndex and grid-snapped position
    const zs = Object.values(d.nodes).map((n) => n.zIndex);
    expect(new Set(zs).size).toBe(zs.length);
    for (const n of Object.values(d.nodes)) {
      expect(n.x % 20).toBe(0);
      expect(n.y % 20).toBe(0);
    }
  });

  it('refuses a type that does not match the model kind', () => {
    const { model } = pharmacyEr();
    expect(() => createDiagramForModel(model, 'relational-schema')).toThrow();
  });
});

describe('createDiagramForModel (relational)', () => {
  it('one node per relation, one edge per FK — composite FK is a single edge', () => {
    const rb = relationalBuilder('R');
    const drug = rb.relation('Drug', ['CompanyName', 'TradeName'], { pk: ['CompanyName', 'TradeName'] });
    const presc = rb.relation('Presc', ['PatientSSN', 'CompanyName', 'DrugTradeName'], { pk: ['PatientSSN', 'CompanyName', 'DrugTradeName'] });
    const fk = rb.fk(presc, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']);
    const d = createDiagramForModel(rb.build(), 'relational-schema');
    expect(Object.keys(d.nodes)).toHaveLength(2);
    expect(Object.values(d.edges)).toHaveLength(1);
    expect(Object.values(d.edges)[0]!.ref).toEqual({ kind: 'foreignKey', foreignKeyId: fk.id });
  });
});

describe('sync after model changes', () => {
  it('is idempotent and preserves route/style of surviving edges', () => {
    const { model, company } = pharmacyEr();
    const project = createBareProject();
    const d = withDiagram(project, model, 'chen');
    const edge = Object.values(d.edges)[0]!;
    edge.route = { mode: 'manual', waypoints: [{ x: 1, y: 2 }] };
    edge.style = { stroke: '#f00' };
    const before = JSON.stringify(d);
    syncDiagram(project, d.id);
    expect(JSON.stringify(project.diagrams[d.id])).toBe(before);

    // delete an entity attribute -> its node + edge disappear, others keep their data
    const attrId = Object.values(model.attributes).find((a) => a.name === 'address')!.id;
    delete model.attributes[attrId];
    const r = syncDiagram(project, d.id);
    expect(r.removedNodes).toHaveLength(1);
    expect(r.removedEdges).toHaveLength(1);
    expect(project.diagrams[d.id]!.edges[edge.id]!.route.mode).toBe('manual');
    expect(project.diagrams[d.id]!.edges[edge.id]!.style).toEqual({ stroke: '#f00' });

    // add a new attribute -> node + edge appear below existing content
    const b2 = { id: 'att_new', name: 'phone', owner: { kind: 'entity' as const, id: company.id }, order: 9, key: 'none' as const, multivalued: false, derived: false };
    model.attributes[b2.id] = b2;
    const r2 = syncDiagram(project, d.id);
    expect(r2.addedNodes).toHaveLength(1);
    expect(r2.addedEdges).toHaveLength(1);
    expect(syncDiagram(project, d.id)).toEqual({ addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] });
  });

  it('syncModelDiagrams keeps two diagrams of one model consistent; partial diagrams never re-add nodes', () => {
    const rb = relationalBuilder('R');
    const a = rb.relation('A', ['id'], { pk: ['id'] });
    const project = createBareProject();
    const d1 = withDiagram(project, rb.build(), 'relational-schema');
    const d2 = createDiagramForModel(project.models[d1.modelId]!, 'crows-foot');
    project.diagrams[d2.id] = d2;
    project.diagramOrder.push(d2.id);
    d2.partial = true;
    const c = rb.relation('C', ['id', 'aid'], { pk: ['id'] });
    const fk = rb.fk(c, ['aid'], a, ['id']);
    syncModelDiagrams(project, d1.modelId);
    expect(Object.keys(project.diagrams[d1.id]!.nodes)).toHaveLength(2);
    expect(Object.keys(project.diagrams[d1.id]!.edges)).toHaveLength(1);
    // partial view: no new node, therefore no edge to the missing endpoint
    expect(Object.keys(project.diagrams[d2.id]!.nodes)).toHaveLength(1);
    expect(Object.keys(project.diagrams[d2.id]!.edges)).toHaveLength(0);
    expect(expectedEdgeRefs(project.models[d1.modelId]!, project.diagrams[d2.id]!)).toEqual([]);
    expect(fk.id).toBeTruthy();
  });

  it('removes edges whose endpoint node was removed from the diagram', () => {
    const { model } = pharmacyEr();
    const project = createBareProject();
    const d = withDiagram(project, model, 'chen');
    const companyNode = Object.values(d.nodes).find((n) => n.ref.kind === 'entity' && model.entities[n.ref.id]!.name === 'Company')!;
    delete d.nodes[companyNode.id];
    d.partial = true;
    const { removed } = syncDiagramEdges(model, d);
    // company participant edge + company's 2 attribute links (name, address)
    expect(removed.length).toBe(3);
  });
});

describe('associative entities', () => {
  it('the relationship has no node of its own; participant edges attach to the entity node', () => {
    const b = erBuilder('A');
    const s = b.entity('Student').key('sid');
    const c = b.entity('Course').key('cid');
    const enrol = b.relate('Enrol', s, c, 'M:N');
    const e = b.associativeEntity('Enrollment', enrol);
    e.attr('grade');
    const model = b.build();
    const d = createDiagramForModel(model, 'chen');
    expect(Object.values(d.nodes).some((n) => n.ref.kind === 'relationship')).toBe(false);
    const entityNode = Object.values(d.nodes).find((n) => n.ref.kind === 'entity' && n.ref.id === e.id)!;
    expect(nodeIdOfRef(d, model, { kind: 'relationship', id: enrol.id })).toBe(entityNode.id);
    // 2 participant edges + 'grade' + 'sid' + 'cid'
    expect(Object.keys(d.edges)).toHaveLength(5);
  });
});

describe('resolveRefsInDiagram', () => {
  it('maps columns to the relation node + column id, FK/participant to edges, ignores foreign-model refs', () => {
    const rb = relationalBuilder('R');
    const a = rb.relation('A', ['id'], { pk: ['id'] });
    const c = rb.relation('C', ['id', 'aid'], { pk: ['id'] });
    const fk = rb.fk(c, ['aid'], a, ['id']);
    const project = createBareProject();
    const d = withDiagram(project, rb.build(), 'relational-schema');
    const r = resolveRefsInDiagram(project, d, [
      { kind: 'column', relationId: c.id, id: c.col('aid') },
      { kind: 'foreignKey', id: fk.id },
      { kind: 'entity', id: 'ent_other' },
    ]);
    expect(r.nodeIds).toHaveLength(1);
    expect(d.nodes[r.nodeIds[0]!]!.ref).toEqual({ kind: 'relation', id: c.id });
    expect(r.columnIds).toEqual([c.col('aid')]);
    expect(r.edgeIds).toHaveLength(1);
    expect(refKey({ kind: 'column', relationId: c.id, id: c.col('aid') })).toContain('column:');
  });
});
