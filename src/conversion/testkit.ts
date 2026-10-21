/** Test helpers for the conversion suites (not part of the public API). */
import { createBareProject } from '@/model/defaults';
import { describeForeignKey } from '@/model/queries';
import { deepFreeze } from '@/test/deepFreeze';
import type { ConversionOptions, ConversionResult, ErModel, Project, RelationalModel, Relation } from '@/model/types';
import { convertErToRelational } from './convert';

export const FIXED_NOW = '2024-01-01T00:00:00.000Z';

export const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Project holding a COPY of `er` (so the caller's builder model stays mutable), deeply frozen like app state. */
export function frozenProject(er: ErModel): Project {
  const project = createBareProject('test');
  const copy = cloneJson(er);
  project.models[copy.id] = copy;
  return deepFreeze(project);
}

export function run(
  er: ErModel,
  options?: Partial<ConversionOptions>,
  env?: { previous?: RelationalModel },
): ConversionResult & { project: Project } {
  const project = frozenProject(er);
  const result = convertErToRelational(project, er.id, options, { now: FIXED_NOW, ...env });
  return { ...result, project };
}

export function rel(m: RelationalModel, name: string): Relation {
  const r = Object.values(m.relations).find((x) => x.name === name);
  if (!r) throw new Error(`no relation ${name}; have ${Object.values(m.relations).map((x) => x.name).join(', ')}`);
  return r;
}

export const colNames = (r: Relation): string[] => r.columns.map((c) => c.name);
export const pkNames = (r: Relation): string[] => r.primaryKey.map((id) => r.columns.find((c) => c.id === id)!.name);
export const col = (r: Relation, name: string) => {
  const c = r.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${r.name}.${name}; have ${colNames(r).join(', ')}`);
  return c;
};
export const uniqueSets = (r: Relation): string[][] =>
  r.uniques.map((u) => u.columnIds.map((id) => r.columns.find((c) => c.id === id)!.name));

/** Sorted `A.x → B.y` strings, one per FK (composite FK = ONE entry). */
export const fkList = (m: RelationalModel): string[] => Object.values(m.foreignKeys).map((fk) => describeForeignKey(m, fk)).sort();

export const fksOf = (m: RelationalModel, r: Relation) => Object.values(m.foreignKeys).filter((fk) => fk.sourceRelationId === r.id);
