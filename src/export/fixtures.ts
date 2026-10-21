/**
 * Fixtures for export tests and the browser harness: the spec's five examples as complete projects holding BOTH the Chen
 * diagram and the converted relational-schema diagram, laid out with the real auto-layout. Not imported by the app.
 */
import { produce } from 'immer';
import { convertErToRelational } from '@/conversion';
import { exampleA, exampleE } from '@/conversion/fixtures';
import { autoLayout } from '@/layout';
import { erBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import type { ErModel, Id, Project } from '@/model/types';
import { buildScene } from '@/scene/registry';

export type ExampleKey = 'A' | 'B' | 'C' | 'D' | 'E';
export const EXAMPLE_KEYS: ExampleKey[] = ['A', 'B', 'C', 'D', 'E'];

function exampleB(): ErModel {
  const b = erBuilder('Weak');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  return b.build();
}
function exampleC(): ErModel {
  const b = erBuilder('Recursive 1:N');
  const emp = b.entity('Employee').key('Eid').attr('Name');
  b.relate('Manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  return b.build();
}
function exampleD(): ErModel {
  const b = erBuilder('Recursive M:N');
  const course = b.entity('Course').key('Cid').attr('Name');
  b.relate('Prereq', course, course, 'M:N', { leftRole: 'course', rightRole: 'requires' });
  return b.build();
}

const MODELS: Record<ExampleKey, () => ErModel> = { A: exampleA, B: exampleB, C: exampleC, D: exampleD, E: exampleE };

export interface ExampleProject {
  project: Project;
  erDiagramId: Id;
  relDiagramId: Id;
}

/** Complete, laid-out project for one example. `rename` lets tests inject awkward names (CJK, markup, arrows). */
export async function buildExampleProject(key: ExampleKey, projectName?: string): Promise<ExampleProject> {
  const er = MODELS[key]();
  let project = createBareProject(projectName ?? `Example ${key}`);
  const erDiagram = withDiagram(project, er, 'chen');
  project = await layoutDiagram(project, erDiagram.id);
  const result = convertErToRelational(project, er.id);
  const temp: Project = {
    ...project,
    models: { ...project.models, [result.relationalModel.id]: result.relationalModel },
    diagrams: { ...project.diagrams, [result.diagram.id]: result.diagram },
  };
  const positions = await autoLayout(buildScene(temp, result.diagram.id), temp, result.diagram.id);
  let relDiagramId = '';
  project = produce(project, (d) => {
    relDiagramId = ops.applyConversionResult(d, result, { positions }).diagramId!;
  });
  return { project, erDiagramId: erDiagram.id, relDiagramId };
}

export async function layoutDiagram(project: Project, diagramId: Id): Promise<Project> {
  const positions = await autoLayout(buildScene(project, diagramId), project, diagramId);
  return produce(project, (d) => {
    ops.setNodePositions(d, diagramId, positions);
  });
}
