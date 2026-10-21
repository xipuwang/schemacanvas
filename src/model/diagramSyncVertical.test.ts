/** SA-01: provisional placement for crow's foot / physical diagrams uses the REAL table sizes (no overlaps on creation). */
import { describe, expect, it } from 'vitest';
import { buildExample } from '@/examples';
import { relationalBuilder } from '@/model/builders';
import { createBareProject, createDiagram } from '@/model/defaults';
import { createDiagramForModel, syncDiagramEdges, syncDiagramNodes } from '@/model/diagramSync';
import type { Diagram, Model, Project, RelationalModel } from '@/model/types';
import { anyOverlap } from '@/layout/rects';
import { defaultMeasure } from '@/scene/measure';
import { buildScene } from '@/scene/registry';
import { createVerticalSizer } from '@/scene/vertical';
import { pharmacyVFixture } from '@/scene/vertical/fixtures';

function pharmacyModel(): RelationalModel {
  const project = buildExample('pharmacy');
  return Object.values(project.models).find((m): m is RelationalModel => m.kind === 'relational')!;
}

/** n tables with typed columns, long names, several FKs each (deterministic). */
function bigModel(n: number, long = false): RelationalModel {
  let seed = 11;
  const rnd = (k: number): number => Math.floor(((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * k);
  const b = relationalBuilder('Big', 'postgresql');
  const pad = long ? 'VeryLongDescriptiveTableNameForStressTesting' : 'T';
  const tables = Array.from({ length: n }, (_, i) =>
    b.relation(`${pad}${i}`, [
      { name: `${long ? 'IdentifierColumnWithAnExtremelyLongName' : 'Id'}${i}`, type: 'INT' },
      { name: `Name${i}`, type: 'VARCHAR(120)', nullable: false },
      { name: 'Note', type: 'TEXT' },
      ...Array.from({ length: i % 5 }, (_, k) => ({ name: `Ref${k}`, type: 'INT' })),
    ], { pk: [`${long ? 'IdentifierColumnWithAnExtremelyLongName' : 'Id'}${i}`] }),
  );
  const idName = (i: number): string => `${long ? 'IdentifierColumnWithAnExtremelyLongName' : 'Id'}${i}`;
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < i % 5; k++) {
      const j = rnd(i);
      b.fk(tables[i]!, [`Ref${k}`], tables[j]!, [idName(j)]);
    }
  }
  return b.build();
}

function physicalExtras(model: RelationalModel): void {
  for (const r of Object.values(model.relations)) {
    r.checks = [{ id: `ck_${r.id}`, name: 'ck', expression: '(1 = 1)' }] as never;
    r.indexes = [{ id: `ix_${r.id}`, name: `ix_${r.name}`, columnIds: [r.columns[0]!.id], unique: false }] as never;
  }
}

type Variant = [string, 'crows-foot' | 'physical', 'vertical' | 'horizontal'];
const variants: Variant[] = [['crows-foot vertical', 'crows-foot', 'vertical'], ['crows-foot horizontal', 'crows-foot', 'horizontal'], ['physical', 'physical', 'vertical']];

function make(model: RelationalModel, type: 'crows-foot' | 'physical', orientation: 'vertical' | 'horizontal'): { project: Project; diagram: Diagram } {
  const project = createBareProject('t');
  project.models[model.id] = model;
  const diagram = createDiagram(type, model.id);
  if (diagram.options.crowsFoot) diagram.options.crowsFoot.orientation = orientation;
  syncDiagramNodes(model, diagram);
  syncDiagramEdges(model, diagram);
  project.diagrams[diagram.id] = diagram;
  project.diagramOrder.push(diagram.id);
  return { project, diagram };
}

const overlaps = (project: Project, diagram: Diagram) => {
  const scene = buildScene(project, diagram.id, defaultMeasure);
  return anyOverlap(Object.entries(scene.nodes).map(([id, g]) => ({ id, ...g.bounds })), 0);
};

describe.each(variants)('provisional placement %s', (_n, type, orientation) => {
  const models: Array<[string, () => RelationalModel]> = [
    ['pharmacy example', pharmacyModel],
    ['87 tables', () => bigModel(87)],
    ['long names', () => bigModel(30, true)],
  ];
  it.each(models)('%s: new sheet has no overlapping tables', (_m, mk) => {
    const model = mk();
    if (type === 'physical') physicalExtras(model);
    const { project, diagram } = make(model, type, orientation);
    expect(Object.keys(diagram.nodes)).toHaveLength(Object.keys(model.relations).length);
    expect(overlaps(project, diagram)).toEqual([]);
  });

  it('the estimate equals the real scene size', () => {
    const model = pharmacyModel();
    if (type === 'physical') physicalExtras(model);
    const { project, diagram } = make(model, type, orientation);
    const scene = buildScene(project, diagram.id, defaultMeasure);
    const sizer = createVerticalSizer(model, diagram, defaultMeasure);
    for (const [id, node] of Object.entries(diagram.nodes)) {
      const est = sizer((node.ref as { id: string }).id)!;
      const real = scene.nodes[id]!.bounds;
      expect(Math.abs(est.w - real.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(est.h - real.h)).toBeLessThanOrEqual(1);
    }
  });
});

describe('physical sections count', () => {
  it('constraints and indexes make the estimate taller than a plain table', () => {
    const f = pharmacyVFixture('physical');
    const withSections = createVerticalSizer(f.model, f.diagram, defaultMeasure)(f.rel.Patient!.id)!;
    f.diagram.options.physical!.showConstraints = false;
    f.diagram.options.physical!.showIndexes = false;
    const plain = createVerticalSizer(f.model, f.diagram, defaultMeasure)(f.rel.Patient!.id)!;
    expect(withSections.h).toBeGreaterThan(plain.h);
  });
});

describe('other diagram types keep the previous placement', () => {
  it('relational-schema placement is unchanged for the pharmacy model', () => {
    const model: Model = pharmacyModel();
    const d = createDiagramForModel(model, 'relational-schema');
    expect(Object.values(d.nodes).every((n) => n.x % 20 === 0 && n.y % 20 === 0)).toBe(true);
  });
});
