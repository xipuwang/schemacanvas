import type { DiagramType, Id, Project } from '@/model/types';
import type { MeasureText, SceneBaseline, SceneQuality } from './base';
import { buildChenScene } from './chen';
import { buildHorizontalScene } from './horizontal';
import { defaultMeasure } from './measure';
import type { SceneBuilder } from './registry-types';
import type { Scene } from './types';
import { buildVerticalScene } from './vertical';

export type { SceneBuilder } from './registry-types';

const builders: Record<DiagramType, SceneBuilder> = {
  chen: buildChenScene,
  'relational-schema': buildHorizontalScene,
  'crows-foot': buildVerticalScene,
  physical: buildVerticalScene,
};

/**
 * THE entry point for derived geometry. Pure & deterministic for a given (project, diagram,
 * measure). The canvas, hit-testing, auto-layout, validation highlighting and every exporter
 * call this — nobody computes geometry any other way.
 */
export interface BuildSceneOptions {
  /** Default `'full'`. `'draft'` is for the live canvas while a drag transaction is open (see scene/draft.ts). */
  quality?: SceneQuality;
  previous?: SceneBaseline;
}

export function buildScene(project: Project, diagramId: Id, measure: MeasureText = defaultMeasure, opts?: BuildSceneOptions): Scene {
  const diagram = project.diagrams[diagramId];
  if (!diagram) throw new Error(`buildScene: unknown diagram ${diagramId}`);
  const model = project.models[diagram.modelId];
  if (!model) throw new Error(`buildScene: diagram ${diagramId} references missing model ${diagram.modelId}`);
  if (opts?.quality !== 'draft') return builders[diagram.type]({ project, diagram, model, measure });
  const scene = builders[diagram.type]({ project, diagram, model, measure, quality: 'draft', previous: opts.previous });
  return { ...scene, quality: 'draft' };
}
