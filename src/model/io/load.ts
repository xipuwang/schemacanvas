import { defaultDiagramOptions } from '../defaults';
import { repairPresentation } from '../invariants';
import { PROJECT_FORMAT, SCHEMA_VERSION, type DiagramType, type Project } from '../types';
import { MigrationError, migrations as defaultMigrations, runMigrations, type MigrationRegistry } from './migrations';
import type { LoadResult } from './types';
import { findStructuralProblem } from './validate';

export interface LoadOptions {
  /** Test seam: inject a synthetic registry. Production code never passes this. */
  migrations?: MigrationRegistry;
  /** Test seam: pretend the app's current schema version is this. */
  currentVersion?: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (code: Extract<LoadResult, { ok: false }>['error']['code'], message: string, path?: string): LoadResult => ({
  ok: false,
  error: path === undefined ? { code, message } : { code, message, path },
});

/** True when `value` has the same JSON type as `def`; numbers must also be finite. Null/undefined defaults accept anything. */
function sameShape(value: unknown, def: unknown): boolean {
  if (def === null || def === undefined) return true;
  if (typeof def === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (Array.isArray(def)) return Array.isArray(value);
  if (isObj(def)) return isObj(value);
  return typeof value === typeof def;
}

/** Nesting depth beyond which a file is rejected (iterative walk, so the check itself cannot overflow). */
const MAX_DEPTH = 200;
function tooDeep(root: unknown): boolean {
  const stack: Array<[unknown, number]> = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (d > MAX_DEPTH) return true;
    for (const x of Array.isArray(v) ? v : Object.values(v)) stack.push([x, d + 1]);
  }
  return false;
}

/**
 * Fill option blocks a hand-edited or older file lacks. Only ADDS missing keys (existing values, including unknown
 * ones, are untouched). Returns a log line per diagram that needed it.
 */
function fillDiagramOptions(project: Project): string[] {
  const log: string[] = [];
  for (const diagram of Object.values(project.diagrams)) {
    const defaults = defaultDiagramOptions(diagram.type as DiagramType) as unknown as Obj;
    // `options` may be absent in a hand-edited file; validation allowed that.
    const options = ((diagram as unknown as { options?: Obj }).options ??= {});
    const missing: string[] = [];
    for (const [key, value] of Object.entries(defaults)) {
      if (options[key] !== undefined && !sameShape(options[key], value)) {
        options[key] = value;
        missing.push(key);
      } else if (options[key] === undefined) {
        options[key] = value;
        missing.push(key);
      }
    }
    // Nested blocks missing individual keys (e.g. a newly added option) get their defaults too.
    for (const [key, value] of Object.entries(defaults)) {
      const have = options[key];
      if (isObj(value) && isObj(have)) {
        for (const [k, v] of Object.entries(value)) {
          if (have[k] === undefined || !sameShape(have[k], v)) {
            have[k] = v;
            missing.push(`${key}.${k}`);
          }
        }
      }
    }
    if (missing.length) log.push(`diagram ${diagram.id}: filled default options (${missing.join(', ')})`);
  }
  return log;
}

/**
 * Shared load path for `.schemacanvas.json` text and IndexedDB records (both hold the `ProjectFile` envelope).
 * Order: envelope checks → version gate → migrate → structural validation → fill options → repairPresentation.
 * Semantic problems are never rejected or repaired. The input is not mutated (it is cloned first).
 */
export function loadProjectData(raw: unknown, opts: LoadOptions = {}): LoadResult {
  let copy: unknown;
  try {
    // Also guarantees plain JSON (drops undefined, rejects cycles/BigInt) regardless of where `raw` came from.
    copy = JSON.parse(JSON.stringify(raw));
  } catch {
    return fail('invalid-structure', 'Project data is not plain JSON');
  }
  return loadOwned(copy, opts);
}

/** Like `loadProjectData` but takes ownership of `raw` (freshly parsed JSON) and mutates it. */
export function loadOwned(raw: unknown, opts: LoadOptions = {}): LoadResult {
  const current = opts.currentVersion ?? SCHEMA_VERSION;
  const registry = opts.migrations ?? defaultMigrations;

  if (!isObj(raw)) return fail('wrong-format', 'Not a SchemaCanvas project file');
  if (raw.format !== PROJECT_FORMAT) return fail('wrong-format', `Not a SchemaCanvas project file (expected format "${PROJECT_FORMAT}")`, 'format');
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('invalid-structure', 'schemaVersion must be a positive integer', 'schemaVersion');
  }
  if (version > current) {
    return fail('newer-version', `This file was saved by a newer version of SchemaCanvas (file schema ${version}, supported ${current})`, 'schemaVersion');
  }

  let envelope: Obj = raw;
  const migratedFrom = version < current ? version : undefined;
  if (version < current) {
    try {
      envelope = runMigrations(raw, version, current, registry);
    } catch (e) {
      if (e instanceof MigrationError && !registry[e.fromVersion]) return fail('unsupported-version', e.message, 'schemaVersion');
      return fail('invalid-structure', e instanceof Error ? e.message : String(e));
    }
  }

  if (tooDeep(envelope.project)) return fail('invalid-structure', `project is nested deeper than ${MAX_DEPTH} levels`, 'project');
  const problem = findStructuralProblem(envelope.project);
  if (problem) return fail('invalid-structure', `${problem.path}: ${problem.message}`, problem.path);

  const project = envelope.project as unknown as Project;
  project.schemaVersion = current;
  let repairs: string[];
  try {
    const optionRepairs = fillDiagramOptions(project);
    // Prototype-member names ('constructor') must not count as existing diagrams.
    const order = project.diagramOrder.filter((id) => Object.hasOwn(project.diagrams, id));
    const orderRepairs = order.length === project.diagramOrder.length ? [] : ['diagramOrder: dropped entries that are not diagrams'];
    project.diagramOrder = order;
    repairs = [...optionRepairs, ...orderRepairs, ...repairPresentation(project)];
  } catch (e) {
    return fail('invalid-structure', `Project data could not be repaired: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: true, project, ...(migratedFrom !== undefined ? { migratedFrom } : {}), repairs };
}

/** Parse the text of a `.schemacanvas.json` file. */
export function parseProjectFile(text: string, opts: LoadOptions = {}): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail('not-json', `File is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return loadOwned(raw, opts);
}
