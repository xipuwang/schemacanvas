/**
 * Shared helpers for the end-to-end pipeline tests. Everything here drives the REAL modules (builders, store, ops,
 * conversion, validation, layout, scene builders, render, sql); nothing is mocked.
 */
import { erBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import type { ConversionOptions, ConversionResult, Diagram, ErModel, Id, Project, RelationalModel } from '@/model/types';
import { convertErToRelational } from '@/conversion';
import { exampleA, exampleE } from '@/conversion/fixtures';
import { autoLayout } from '@/layout';
import { buildScene } from '@/scene/registry';
import type { Scene, Rect, FkEdgeGeom, HTableGeom } from '@/scene/types';
import { createEditorStore, type EditorStore } from '@/store';
import { deepFreeze } from '@/test/deepFreeze';
import { checkInvariants } from '@/model/invariants';

export type ExampleKey = 'A' | 'B' | 'C' | 'D' | 'E';

/** Spec example B: Company makes weak Drug (identifying relationship). */
export function exampleB(): ErModel {
  const b = erBuilder('Weak');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  return b.build();
}

/** Spec example C: Employee manages Employee (recursive 1:N). */
export function exampleC(): ErModel {
  const b = erBuilder('Recursive 1:N');
  const emp = b.entity('Employee').key('Eid').attr('Name');
  b.relate('Manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  return b.build();
}

/** Spec example D: Course has prerequisite Course (recursive M:N). */
export function exampleD(): ErModel {
  const b = erBuilder('Recursive M:N');
  const course = b.entity('Course').key('Cid').attr('Name');
  b.relate('Prereq', course, course, 'M:N', { leftRole: 'course', rightRole: 'requires' });
  return b.build();
}

export const EXAMPLES: Record<ExampleKey, () => ErModel> = {
  A: exampleA,
  B: exampleB,
  C: exampleC,
  D: exampleD,
  E: exampleE,
};
export const EXAMPLE_KEYS = Object.keys(EXAMPLES) as ExampleKey[];

export interface Setup {
  store: EditorStore;
  erModelId: Id;
  erDiagramId: Id;
}

/** A Project holding `er` plus its complete Chen diagram, loaded into a fresh REAL store. */
export function setupEr(er: ErModel): Setup {
  const p = createBareProject(er.name);
  const d = withDiagram(p, er, 'chen');
  const store = createEditorStore({ project: p });
  store.getState().setActiveDiagram(d.id);
  return { store, erModelId: er.id, erDiagramId: d.id };
}

export const project = (s: { store: EditorStore }): Project => s.store.getState().project;

/** Layout a diagram through the real flow: buildScene -> autoLayout -> commit(setNodePositions). */
export async function layoutDiagramInStore(store: EditorStore, diagramId: Id, label = 'Auto-layout'): Promise<void> {
  const p = store.getState().project;
  const scene = buildScene(p, diagramId);
  const positions = await autoLayout(scene, p, diagramId);
  store.getState().commit(label, (d) => {
    ops.setNodePositions(d, diagramId, positions);
  });
}

export interface Converted {
  result: ConversionResult;
  report: ops.ApplyConversionReport;
  relModelId: Id;
  relDiagramId: Id;
  before: Project;
}

/**
 * ARCHITECTURE 8 "Convert" flow: convert -> TEMP project holding the result diagram -> buildScene -> autoLayout ->
 * ONE store.commit(applyConversionResult(..., {positions})).
 */
export async function convertInStore(
  s: Setup,
  options?: Partial<ConversionOptions>,
  layout = true,
): Promise<Converted> {
  const before = s.store.getState().project;
  const result = convertErToRelational(before, s.erModelId, options);
  let positions: Record<Id, { x: number; y: number }> | undefined;
  if (layout) {
    const temp: Project = {
      ...before,
      models: { ...before.models, [result.relationalModel.id]: result.relationalModel },
      diagrams: { ...before.diagrams, [result.diagram.id]: result.diagram },
    };
    const scene = buildScene(temp, result.diagram.id);
    positions = await autoLayout(scene, temp, result.diagram.id);
  }
  const report = s.store.getState().commit('Convert ER -> relational', (d) => ops.applyConversionResult(d, result, { positions }));
  return { result, report, relModelId: report.modelId, relDiagramId: report.diagramId!, before };
}

export const relModelOf = (p: Project, id: Id): RelationalModel => p.models[id] as RelationalModel;

// ---------------------------------------------------------------------------------------------------------------------
// geometry assertions
// ---------------------------------------------------------------------------------------------------------------------

export const overlaps = (a: Rect, b: Rect, eps = 0.01): boolean =>
  a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;

export const contains = (outer: Rect, inner: Rect, eps = 0.5): boolean =>
  inner.x >= outer.x - eps &&
  inner.y >= outer.y - eps &&
  inner.x + inner.w <= outer.x + outer.w + eps &&
  inner.y + inner.h <= outer.y + outer.h + eps;

/** Pairs of nodes whose painted rectangles overlap. */
export function nodeOverlaps(scene: Scene): Array<[string, string]> {
  const ids = Object.keys(scene.nodes).sort();
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (overlaps(scene.nodes[ids[i]!]!.bounds, scene.nodes[ids[j]!]!.bounds)) out.push([ids[i]!, ids[j]!]);
  return out;
}

export const segIntersectsRect = (a: { x: number; y: number }, b: { x: number; y: number }, r: Rect, shrink = 0.5): boolean => {
  const rx0 = r.x + shrink, rx1 = r.x + r.w - shrink, ry0 = r.y + shrink, ry1 = r.y + r.h - shrink;
  const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x), miny = Math.min(a.y, b.y), maxy = Math.max(a.y, b.y);
  return maxx > rx0 && minx < rx1 && maxy > ry0 && miny < ry1; // orthogonal segments: bbox test is exact
};

export function hTables(scene: Scene): HTableGeom[] {
  return Object.values(scene.nodes).filter((n): n is HTableGeom => n.kind === 'h-table');
}
export function fkEdges(scene: Scene): FkEdgeGeom[] {
  return Object.values(scene.edges).filter((e): e is FkEdgeGeom => e.kind === 'fk');
}

export const frozen = <T>(x: T): T => deepFreeze(JSON.parse(JSON.stringify(x)) as T);
export const expectInvariants = (p: Project): ReturnType<typeof checkInvariants> => checkInvariants(p);
export type { Diagram };

// Exact (outline based) overlap tests: bounding boxes over-report for ellipses and diamonds.
import { pointInOutline } from '@/scene/geometry';
import type { Outline, Point } from '@/scene/base';

/** Does the open segment a-b pass through the interior of `o` (sampled every 2px)? */
export function segmentInOutline(a: Point, b: Point, o: Outline): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(len / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (pointInOutline(o, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
  }
  return false;
}
/** Does any point of rect `r` (sampled every 2px) lie inside `o`? */
export function rectInOutline(r: Rect, o: Outline): boolean {
  for (let x = r.x; x <= r.x + r.w; x += 2) for (let y = r.y; y <= r.y + r.h; y += 2) if (pointInOutline(o, { x, y })) return true;
  return false;
}
