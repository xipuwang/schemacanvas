// @vitest-environment node
import './deterministic';
/** P7 (extra): harder models and option matrices through the whole pipeline; re-conversion in place. */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { convertErToRelational } from '@/conversion';
import { kitchenSink } from '@/conversion/fixtures';
import { checkInvariants } from '@/model/invariants';
import * as ops from '@/model/ops';
import type { ConversionOptions, ErModel, RelationalModel } from '@/model/types';
import { renderSceneToSvgString } from '@/render/standalone';
import { buildScene } from '@/scene/registry';
import { generateDdl, parseDdl } from '@/sql';
import { validateProject } from '@/validation';
import { convertInStore, layoutDiagramInStore, nodeOverlaps, relModelOf, setupEr, contains } from './helpers';
import { signature } from './sqlSig';

const OPTION_SETS: Array<[string, Partial<ConversionOptions>]> = [
  ['default', {}],
  ['materializeDerived', { materializeDerived: undefined as never }],
  ['oneToOne=merge', { oneToOne: 'merge' }],
  ['oneToOne=relation', { oneToOne: 'relation' }],
  ['oneToOne=fk-on-first', { oneToOne: 'fk-on-first' }],
  ['oneToOne=fk-on-second', { oneToOne: 'fk-on-second' }],
  
];

describe('P7 kitchen sink through everything', () => {
  it.each(OPTION_SETS)('options %s: convert, validate, layout, scene, render, sqlite, parse', async (_n, o) => {
    const opts = { ...o };
    if ('materializeDerived' in opts) {
      const er = kitchenSink();
      opts.materializeDerived = Object.values(er.attributes).filter((a) => a.derived).map((a) => a.id);
    }
    const er = kitchenSink();
    const s = setupEr(er);
    if (opts.materializeDerived) opts.materializeDerived = Object.values(er.attributes).filter((a) => a.derived).map((a) => a.id);
    await layoutDiagramInStore(s.store, s.erDiagramId);
    const c = await convertInStore(s, opts);
    const p = s.store.getState().project;
    expect(checkInvariants(p)).toEqual([]);
    const errs = validateProject(p).filter((i) => i.severity === 'error');
    expect(errs.map((e) => `${e.code}:${e.affected.map((a) => a.kind).join()}`)).toEqual([]);

    for (const did of [s.erDiagramId, c.relDiagramId]) {
      const scene = buildScene(p, did);
      expect(scene.warnings).toEqual([]);
      expect(nodeOverlaps(scene)).toEqual([]);
      for (const n of Object.values(scene.nodes)) expect(contains(scene.bounds, n.paintBounds)).toBe(true);
      const svg = renderSceneToSvgString(scene, p, p.diagrams[did]!);
      expect(svg).not.toMatch(/NaN|undefined/);
    }
    const m = relModelOf(p, c.relModelId);
    const g = generateDdl(m, 'sqlite');
    expect(g.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual([]);
    const db = new DatabaseSync(':memory:');
    db.exec(g.sql);
    db.close();
    expect(signature(parseDdl(g.sql, 'sqlite').model)).toEqual(signature(m));
    const pg = generateDdl(m, 'postgresql');
    expect(pg.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual([]);
  });
});

describe('P7 re-conversion in place keeps hand edits and layout', () => {
  it('replaceModelId: positions of reused ids survive, hand-added column is kept and reported, invariants hold, undo exact', async () => {
    const er0 = kitchenSink();
    const s = setupEr(er0);
    const c = await convertInStore(s);
    const store = s.store;
    let p = store.getState().project;
    const rel0 = relModelOf(p, c.relModelId);
    const empRel = Object.values(rel0.relations).find((r) => r.name === 'Employee')!;
    // hand edits: move a node, add a column
    const node = Object.values(p.diagrams[c.relDiagramId]!.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === empRel.id)!;
    store.getState().commit('hand edit', (d) => {
      ops.setNodePositions(d, c.relDiagramId, { [node.id]: { x: 1234, y: 567 } });
      ops.addColumn(d, c.relModelId, empRel.id, { name: 'Hand', dataType: 'INT' });
    });
    // change the ER: add an attribute to Employee, convert again in place
    const empEnt = Object.values((p.models[s.erModelId] as ErModel).entities).find((e) => e.name === 'Employee')!;
    store.getState().commit('ER edit', (d) => {
      ops.addAttribute(d, s.erModelId, { kind: 'entity', id: empEnt.id }, { name: 'Salary', dataType: 'INT' });
    });
    p = store.getState().project;
    const prior = p;
    const result = convertErToRelational(p, s.erModelId, undefined, { previous: p.models[c.relModelId] as RelationalModel });
    let report!: ops.ApplyConversionReport;
    store.getState().commit('Re-convert', (d) => {
      report = ops.applyConversionResult(d, result, { replaceModelId: c.relModelId });
    });
    p = store.getState().project;
    expect(checkInvariants(p)).toEqual([]);
    const rel1 = p.models[c.relModelId] as RelationalModel;
    const emp1 = Object.values(rel1.relations).find((r) => r.name === 'Employee')!;
    expect(emp1.id).toBe(empRel.id); // id reused
    expect(emp1.columns.map((x) => x.name)).toContain('Salary');
    expect(emp1.columns.map((x) => x.name)).toContain('Hand'); // hand-added kept
    expect(report.kept.length + report.dropped.length).toBeGreaterThan(0);
    const n1 = Object.values(p.diagrams[c.relDiagramId]!.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === empRel.id)!;
    expect([n1.x, n1.y]).toEqual([1234, 567]);
    expect(buildScene(p, c.relDiagramId).warnings).toEqual([]);
    expect(validateProject(p, { modelId: c.relModelId }).filter((i) => i.severity === 'error')).toEqual([]);
    store.getState().undo();
    expect(store.getState().project).toEqual(prior);
  });
});
