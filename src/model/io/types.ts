import type { Project } from '../types';

export type LoadErrorCode = 'not-json' | 'wrong-format' | 'newer-version' | 'unsupported-version' | 'invalid-structure';

export interface LoadError {
  code: LoadErrorCode;
  message: string;
  /** JSON-path-ish location of the first structural problem, e.g. `project.diagrams.dgm_1.nodes.nod_2.x`. */
  path?: string;
}

export type LoadResult =
  | { ok: true; project: Project; migratedFrom?: number; repairs: string[] }
  | { ok: false; error: LoadError };
