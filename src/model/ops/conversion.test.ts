import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepFreeze } from '@/test/deepFreeze';
import { erBuilder, relationalBuilder } from '../builders';
import { createBareProject, DEFAULT_CONVERSION_OPTIONS } from '../defaults';
import { createDiagramForModel, withDiagram } from '../diagramSync';
import { useDeterministicIds } from '../ids';
import type { ConversionResult, Origin, Project, RelationalModel } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { run } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(4000);
});
afterEach(() => restore());

const origin = (key: string): Origin => ({ ruleId: 'strong-entity', sources: [], key });

/** A "generated" model with origins on everything the converter would have produced. */
function generated(name = 'Generated') {
  const b = relationalBuilder(name);
  const A = b.relation('A', ['a1', 'a2'], { pk: ['a1'] });
  const B = b.relation('B', ['b1', 'b_a', 'b_old'], { pk: ['b1'] });
  const C = b.relation('C', ['c1'], { pk: ['c1'] });
  const fk = b.fk(B, ['b_a'], A, ['a1']);
  for (const r of [A, B, C]) {
    r.relation.origin = origin(`rel:${r.relation.name}`);
    for (const c of r.relation.columns) c.origin = origin(`col:${r.relation.name}.${c.name}`);
  }
  fk.origin = origin('fk:ba');
  return { b, A, B, C, fk, model: b.build() };
}

function result(model: RelationalModel, erModelId = 'mdl_er'): ConversionResult {
  const diagram = createDiagramForModel(model, 'relational-schema');
  model.derivedFrom = { erModelId, conversionId: 'cnv_new' };
  return {
    relationalModel: model,
    diagram,
    record: {
      id: 'cnv_new',
      erModelId,
      relationalModelId: model.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      options: DEFAULT_CONVERSION_OPTIONS,
      trace: [],
      decisions: [],
      warnings: [],
    },
  };
}

describe('applyConversionResult (new model)', () => {
  it('adds model + record + diagram in one go without touching anything else', () => {
    const er = erBuilder('ER', 'mdl_er');
    er.entity('E').key('id');
    const p = createBareProject();
    withDiagram(p, er.build(), 'chen');
    const res = deepFreeze(result(generated().model));
    const { project, result: report } = run(p, (d) => ops.applyConversionResult(d, res));
    expect(project.models['mdl_er']).toEqual(p.models['mdl_er']);
    expect(project.models[res.relationalModel.id]).toEqual(res.relationalModel);
    expect(project.conversions['cnv_new']).toEqual(res.record);
    expect(project.diagrams[res.diagram.id]).toEqual(res.diagram);
    expect(project.diagramOrder.at(-1)).toBe(res.diagram.id);
    expect(report).toMatchObject({ modelId: res.relationalModel.id, conversionId: 'cnv_new', diagramId: res.diagram.id, replaced: false });
    expect(Object.keys(res.diagram.edges)).toHaveLength(1);
  });

  it('applies positions keyed by node id or by relation id, leaving the others at their provisional place', () => {
    const g = generated();
    const res = result(g.model);
    const nodeOfA = Object.values(res.diagram.nodes).find((n) => n.ref.id === g.A.id)!;
    const { project } = run(createBareProject(), (d) =>
      ops.applyConversionResult(d, res, { positions: { [nodeOfA.id]: { x: 100, y: 200 }, [g.B.id]: { x: 300, y: 400 } } }),
    );
    const nodes = Object.values(project.diagrams[res.diagram.id]!.nodes);
    expect(nodes.find((n) => n.ref.id === g.A.id)).toMatchObject({ x: 100, y: 200 });
    expect(nodes.find((n) => n.ref.id === g.B.id)).toMatchObject({ x: 300, y: 400 });
    const c = nodes.find((n) => n.ref.id === g.C.id)!;
    const provisional = Object.values(res.diagram.nodes).find((n) => n.ref.id === g.C.id)!;
    expect({ x: c.x, y: c.y }).toEqual({ x: provisional.x, y: provisional.y });
    expect(() => run(createBareProject(), (d) => ops.applyConversionResult(d, res, { positions: { [g.A.id]: { x: NaN, y: 0 } } }))).toThrow(OpError);
  });

  it('refuses ids that already exist and inconsistent results', () => {
    const res = result(generated().model);
    const { project } = run(createBareProject(), (d) => ops.applyConversionResult(d, res));
    expect(() => run(project, (d) => ops.applyConversionResult(d, res))).toThrow(OpError);
    const broken = { ...res, record: { ...res.record, relationalModelId: 'mdl_other' } };
    expect(() => run(createBareProject(), (d) => ops.applyConversionResult(d, broken))).toThrow(/inconsistent/);
  });
});

describe('applyConversionResult (replaceModelId)', () => {
  it('keeps nodes/routes for reused ids, prunes vanished ones, positions new nodes, keeps and reports hand-added elements', () => {
    const g = generated('Old');
    const p0 = createBareProject();
    withDiagram(p0, g.model, 'relational-schema');
    const dgm = Object.keys(p0.diagrams)[0]!;
    const mid = g.model.id;
    // user edits via ops where possible
    let { project: p } = run(p0, (d) => {
      ops.addColumn(d, mid, g.A.id, { id: 'col_hand', name: 'note' }, { index: 1 });
      ops.addUnique(d, mid, g.A.id, { id: 'uq_hand', columnIds: ['col_hand'] });
      ops.addRelation(d, mid, { id: 'rln_hand', name: 'H', columns: [{ id: 'col_h1', name: 'h1', pk: true }] });
      ops.addForeignKey(d, mid, { id: 'fk_hand', sourceRelationId: 'rln_hand', targetRelationId: g.A.id, columns: [{ sourceColumnId: 'col_h1', targetColumnId: g.A.col('a1') }] });
      ops.addForeignKey(d, mid, { id: 'fk_doomed', sourceRelationId: g.B.id, targetRelationId: g.A.id, columns: [{ sourceColumnId: g.B.col('b_old'), targetColumnId: g.A.col('a1') }] });
    });
    const nodeId = (pr: Project, rel: string) => Object.values(pr.diagrams[dgm]!.nodes).find((n) => n.ref.id === rel)!.id;
    const fkEdge = Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === g.fk.id)!;
    p = run(p, (d) => {
      ops.setNodePositions(d, dgm, { [nodeId(d, g.A.id)]: { x: 500, y: 600 }, [nodeId(d, g.B.id)]: { x: 700, y: 800 } });
      ops.setEdgeRoute(d, dgm, fkEdge.id, { mode: 'manual', waypoints: [{ x: 9, y: 9 }] });
      ops.setColumnWidth(d, dgm, nodeId(d, g.A.id), g.A.col('a2'), 130);
    }).project;

    // regenerate: A and B reused (same ids), C vanished, B.b_old vanished, D is new
    const nm = JSON.parse(JSON.stringify(g.model)) as RelationalModel;
    delete nm.foreignKeys['fk_hand'];
    delete nm.foreignKeys['fk_doomed'];
    nm.relations[g.A.id]!.columns = nm.relations[g.A.id]!.columns.filter((c) => c.id !== 'col_hand');
    nm.relations[g.A.id]!.uniques = [];
    nm.relations[g.B.id]!.columns = nm.relations[g.B.id]!.columns.filter((c) => c.name !== 'b_old');
    delete nm.relations[g.C.id];
    const D = relationalBuilder('tmp').relation('D', ['d1'], { pk: ['d1'] });
    D.relation.origin = origin('rel:D');
    nm.relations[D.id] = D.relation;
    nm.id = 'mdl_regenerated';
    const res = result(nm);
    const dNodeInResult = Object.values(res.diagram.nodes).find((n) => n.ref.id === D.id)!;

    const { project, result: report } = run(p, (d) => ops.applyConversionResult(d, deepFreeze(res), { replaceModelId: mid, positions: { [dNodeInResult.id]: { x: 40, y: 900 }, [g.A.id]: { x: 1, y: 1 } } }));
    const model = project.models[mid] as RelationalModel;
    expect(project.models['mdl_regenerated']).toBeUndefined();
    expect(model.id).toBe(mid);
    expect(model.derivedFrom).toEqual({ erModelId: 'mdl_er', conversionId: 'cnv_new' });
    // generated ids reused; vanished ones gone
    expect(Object.keys(model.relations).sort()).toEqual([g.A.id, g.B.id, D.id, 'rln_hand'].sort());
    expect(model.relations[g.B.id]!.columns.map((c) => c.name)).toEqual(['b1', 'b_a']);
    // hand-added: column re-inserted after its predecessor, unique, table, FK kept; the FK on a vanished column dropped
    expect(model.relations[g.A.id]!.columns.map((c) => c.name)).toEqual(['a1', 'note', 'a2']);
    expect(model.relations[g.A.id]!.uniques.map((u) => u.id)).toEqual(['uq_hand']);
    expect(Object.keys(model.foreignKeys).sort()).toEqual([g.fk.id, 'fk_hand'].sort());
    expect(report.kept.map((r) => r.id).sort()).toEqual(['col_hand', 'fk_hand', 'rln_hand', 'uq_hand'].sort());
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]).toMatch(/fk_doomed/);
    expect(report.replaced).toBe(true);
    expect(report.diagramId).toBeUndefined();
    // diagram: positions/routes/widths of reused ids survive; vanished node pruned; new node placed
    const d = project.diagrams[dgm]!;
    const n = (rel: string) => Object.values(d.nodes).find((x) => x.ref.id === rel);
    expect(n(g.A.id)).toMatchObject({ x: 500, y: 600, columnWidths: { [g.A.col('a2')]: 130 } });
    expect(n(g.B.id)).toMatchObject({ x: 700, y: 800 });
    expect(n(g.C.id)).toBeUndefined();
    expect(n(D.id)).toMatchObject({ x: 40, y: 900 });
    expect(d.edges[fkEdge.id]!.route).toEqual({ mode: 'manual', waypoints: [{ x: 9, y: 9 }] });
    expect(Object.values(d.edges).some((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === 'fk_doomed')).toBe(false);
    expect(Object.values(d.edges).some((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === 'fk_hand')).toBe(true);
    expect(Object.keys(project.diagrams)).toEqual([dgm]);
    // the record carries the report; old records are kept
    const rec = project.conversions['cnv_new']!;
    expect(rec.relationalModelId).toBe(mid);
    expect(rec.warnings.map((w) => w.code)).toEqual(['conv.hand-added-kept', 'conv.hand-added-dropped']);
    expect(rec.warnings[0]!.affected.length).toBe(4);
  });

  it('adds a diagram when no diagram views the replaced model; refuses a relational/ER mix-up', () => {
    const g = generated('Old');
    const p = createBareProject();
    p.models[g.model.id] = g.model;
    const res = result(JSON.parse(JSON.stringify(g.model)) as RelationalModel);
    const { project, result: report } = run(p, (d) => ops.applyConversionResult(d, res, { replaceModelId: g.model.id }));
    expect(report.diagramId).toBe(res.diagram.id);
    expect(project.diagrams[res.diagram.id]!.modelId).toBe(g.model.id);
    expect(() => run(p, (d) => ops.applyConversionResult(d, res, { replaceModelId: 'mdl_ghost' }))).toThrow(OpError);
    const withEr = createBareProject();
    withDiagram(withEr, erBuilder('E', 'mdl_e').build(), 'chen');
    expect(() => run(withEr, (d) => ops.applyConversionResult(d, res, { replaceModelId: 'mdl_e' }))).toThrow(OpError);
  });

  it('a hand-added check/index on a reused relation is carried; one whose columns all vanished is reported as dropped', () => {
    const g = generated('Old');
    const p0 = createBareProject();
    withDiagram(p0, g.model, 'relational-schema');
    const mid = g.model.id;
    const p = run(p0, (d) => {
      ops.addIndex(d, mid, g.B.id, { id: 'idx_a', columnIds: [g.B.col('b_a')] });
      ops.addIndex(d, mid, g.B.id, { id: 'idx_old', columnIds: [g.B.col('b_old')] });
      ops.addCheck(d, mid, g.B.id, { id: 'chk_1', expression: 'b1 > 0', columnIds: [g.B.col('b1')] });
    }).project;
    const nm = JSON.parse(JSON.stringify(g.model)) as RelationalModel;
    nm.relations[g.B.id]!.columns = nm.relations[g.B.id]!.columns.filter((c) => c.name !== 'b_old');
    nm.relations[g.B.id]!.indexes = [];
    delete nm.relations[g.B.id]!.checks;
    nm.id = 'mdl_regen';
    const { project, result: report } = run(p, (d) => ops.applyConversionResult(d, result(nm), { replaceModelId: mid }));
    const b = (project.models[mid] as RelationalModel).relations[g.B.id]!;
    expect(b.indexes.map((i) => i.id)).toEqual(['idx_a']);
    expect(b.checks!.map((c) => c.id)).toEqual(['chk_1']);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]).toMatch(/index/);
  });
});
