import type { SceneBuildInput } from './base';
import type { Scene } from './types';

/** A pure function: (project, diagram, model, measure) → drawable geometry. Deterministic. */
export type SceneBuilder = (input: SceneBuildInput) => Scene;
