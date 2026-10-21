import type { Patch } from 'immer';
import type { Id, Project } from '@/model/types';

/** One undoable step. `patches` apply to the Project; `inversePatches` revert them (already in application order). */
export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  selectionBefore: Id[];
  selectionAfter: Id[];
}

export const DEFAULT_HISTORY_LIMIT = 200;

/** Keys whose values are references to other elements, not elements themselves (their `id` must not count as existing). */
const REFERENCE_KEYS = new Set(['ref', 'owner', 'origin', 'sources', 'targets', 'affected', 'trace', 'decisions', 'warnings', 'options']);

/**
 * Every id that identifies an element somewhere in the project (models, entities, attributes, participants, relations,
 * columns, FKs, diagrams, nodes, edges, …). Used to drop selection ids that undo/redo/deletes made stale.
 */
export function collectElementIds(project: Project): Set<Id> {
  const ids = new Set<Id>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string') ids.add(o.id);
      for (const [k, x] of Object.entries(o)) if (!REFERENCE_KEYS.has(k)) walk(x);
    }
  };
  walk(project);
  return ids;
}

/** `list` with ids that no longer exist removed; returns the same array when nothing was removed. */
export function filterExisting(list: readonly Id[], project: Project): Id[] {
  if (list.length === 0) return list as Id[];
  const exist = collectElementIds(project);
  const out = list.filter((id) => exist.has(id));
  return out.length === list.length ? (list as Id[]) : out;
}

/** True when the patch set only touched `updatedAt` (a commit whose recipe changed nothing). */
export function isOnlyTimestamp(patches: readonly Patch[]): boolean {
  return patches.every((p) => p.path.length === 1 && p.path[0] === 'updatedAt');
}
