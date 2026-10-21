// @vitest-environment node
import './deterministic';
/** P6 SCALE: 60 entities / 150 attributes / 80 relationships through every stage, with per-stage timings. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertErToRelational } from '@/conversion';
import { erBuilder } from '@/model/builders';
import { checkInvariants } from '@/model/invariants';
import * as ops from '@/model/ops';
import { renderSceneToSvgString } from '@/render/standalone';
import { autoLayout } from '@/layout';
import { buildScene } from '@/scene/registry';
import { generateDdl } from '@/sql';
import { validateProject } from '@/validation';
import { nodeOverlaps, setupEr } from './helpers';

function bigEr() {
  let seed = 42;
  const rnd = (n: number) => Math.floor(((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * n);
  const b = erBuilder('Big');
  const ents = [];
  for (let i = 0; i < 60; i++) {
    const weak = i % 15 === 14;
    const e = b.entity(`E${i}`, { weak });
    if (weak) e.partialKey(`pk${i}`); else e.key(`id${i}`);
    ents.push(e);
  }
  // 150 attributes in total: 60 keys + 90 others (some composite/multivalued/derived)
  for (let k = 0; k < 90; k++) {
    const e = ents[k % 60]!;
    if (k % 9 === 0) e.multivalued(`mv${k}`);
    else if (k % 11 === 0) e.derived(`dv${k}`);
    else e.attr(`a${k}`, { dataType: 'VARCHAR(40)' });
  }
  for (let r = 0; r < 80; r++) {
    const i = rnd(60);
    let j = rnd(60);
    if (r % 20 === 0) j = i; // a few recursive
    else while (j === i) j = rnd(60);
    const card = (['1:N', 'M:N', '1:N', '1:1'] as const)[r % 4]!;
    if (r % 16 === 5) {
      let k2 = rnd(60);
      while (k2 === i || k2 === j) k2 = rnd(60);
      b.relationship(`R${r}`, [{ entity: ents[i]! }, { entity: ents[j]! }, { entity: ents[k2]! }]);
    } else if (r % 10 === 7) {
      // identifying relationship owner -> weak entity
      const weakIdx = 14 + 15 * (((r - 7) / 10) % 4);
      let owner = rnd(60);
      while (owner === weakIdx || owner % 15 === 14) owner = rnd(60);
      b.relate(`Own${r}`, ents[owner]!, ents[weakIdx]!, '1:N', { identifying: true, rightTotal: true });
    } else {
      b.relate(`R${r}`, ents[i]!, ents[j]!, card);
    }
  }
  return b.build();
}

describe('P6 scale', () => {
  it('60 entities / 150 attributes / 80 relationships: every stage, timings recorded', async () => {
    const er = bigEr();
    expect(Object.keys(er.entities)).toHaveLength(60);
    expect(Object.keys(er.attributes).length).toBeGreaterThanOrEqual(150);
    expect(Object.keys(er.relationships)).toHaveLength(80);
    const t: Record<string, number> = {};
    const time = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const r = await fn();
      t[name] = Math.round(performance.now() - t0);
      return r;
    };
    const s = setupEr(er);
    const store = s.store;
    const erIssues = await time('validate ER', () => validateProject(store.getState().project, { modelId: s.erModelId }));
    const erScene0 = await time('scene chen (initial grid)', () => buildScene(store.getState().project, s.erDiagramId));
    const pos = await time('layout chen', () => autoLayout(erScene0, store.getState().project, s.erDiagramId));
    await time('commit positions', () => store.getState().commit('layout', (d) => { ops.setNodePositions(d, s.erDiagramId, pos); }));
    const erScene = await time('scene chen (laid out)', () => buildScene(store.getState().project, s.erDiagramId));
    const erSvg = await time('render chen svg', () => renderSceneToSvgString(erScene, store.getState().project, store.getState().project.diagrams[s.erDiagramId]!));
    const result = await time('convert', () => convertErToRelational(store.getState().project, s.erModelId));
    const temp = { ...store.getState().project, models: { ...store.getState().project.models, [result.relationalModel.id]: result.relationalModel }, diagrams: { ...store.getState().project.diagrams, [result.diagram.id]: result.diagram } };
    const relScene0 = await time('scene relational (initial grid)', () => buildScene(temp, result.diagram.id));
    const relPos = await time('layout relational', () => autoLayout(relScene0, temp, result.diagram.id));
    const report = await time('applyConversionResult (store.commit)', () => store.getState().commit('convert', (d) => ops.applyConversionResult(d, result, { positions: relPos })));
    const p = store.getState().project;
    const relIssues = await time('validate all', () => validateProject(p));
    const relScene = await time('scene relational (laid out)', () => buildScene(p, report.diagramId!));
    const relSvg = await time('render relational svg', () => renderSceneToSvgString(relScene, p, p.diagrams[report.diagramId!]!));
    const ddl = await time('generateDdl postgresql', () => generateDdl(p.models[report.modelId] as never, 'postgresql'));
    await time('undo+redo', () => { store.getState().undo(); store.getState().redo(); });
    await time('checkInvariants', () => checkInvariants(p));

    mkdirSync('.tmp/integration', { recursive: true });
    writeFileSync('.tmp/integration/scale.json', JSON.stringify({ timingsMs: t, counts: { erNodes: Object.keys(erScene.nodes).length, erEdges: Object.keys(erScene.edges).length, relations: Object.keys(relScene.nodes).length, fks: Object.keys(relScene.edges).length, erSvgKB: Math.round(erSvg.length / 1024), relSvgKB: Math.round(relSvg.length / 1024) }, erIssues: erIssues.length, relIssues: relIssues.map((i) => `${i.severity}:${i.code}`) }, null, 1));

    expect(checkInvariants(p)).toEqual([]);
    expect(Object.keys(erScene.edges).length).toBe(Object.keys(p.diagrams[s.erDiagramId]!.edges).length);
    expect(erScene.warnings).toEqual([]);
    expect(relScene.warnings).toEqual([]);
    expect(nodeOverlaps(erScene)).toEqual([]);
    expect(nodeOverlaps(relScene)).toEqual([]);
    expect(erSvg).not.toMatch(/NaN/);
    expect(relSvg).not.toMatch(/NaN/);
    expect(ddl.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual([]);
    expect(relIssues.filter((i) => i.severity === 'error').map((i) => `${i.code}:${i.title}`)).toEqual([]);
    // Strict 3 s per stage with PERF=1; x5 load-tolerant budget otherwise (CI/dev machines under external load).
    const budget = process.env.PERF === '1' ? 3000 : 15000;
    for (const [k, v] of Object.entries(t)) expect(v, `${k} took ${v} ms (> ${budget} ms budget; PERF=1 uses 3000; see .tmp/integration/scale.json)`).toBeLessThan(budget);
  }, 120_000);
});
