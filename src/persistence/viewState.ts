/**
 * Per-project view state that is not project data: which sheet was active and which bottom dock was open. Kept in
 * localStorage keyed by project id (so reopening the project - from the autosave, Recent, or its saved file in this
 * browser - lands where the user left off). Every access is try/catch; stale ids are validated by the caller.
 */
import type { Id } from '@/model/types';

const KEY = 'schemacanvas:viewstate:v1';
const MAX_PROJECTS = 40;

export interface SavedViewState {
  activeDiagramId?: Id;
  dock?: 'issues' | 'sql' | null;
}

type Table = Record<Id, SavedViewState & { at: number }>;

function readTable(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === 'object' ? (v as Table) : {};
  } catch {
    return {};
  }
}

export function loadViewState(projectId: Id): SavedViewState | undefined {
  const e = readTable()[projectId];
  if (!e || typeof e !== 'object') return undefined;
  const out: SavedViewState = {};
  if (typeof e.activeDiagramId === 'string') out.activeDiagramId = e.activeDiagramId;
  if (e.dock === 'issues' || e.dock === 'sql' || e.dock === null) out.dock = e.dock;
  return out;
}

export function clearViewState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveViewState(projectId: Id, patch: SavedViewState): void {
  try {
    const table = readTable();
    table[projectId] = { ...table[projectId], ...patch, at: Date.now() };
    const ids = Object.keys(table);
    if (ids.length > MAX_PROJECTS) for (const id of ids.sort((a, b) => (table[a]!.at ?? 0) - (table[b]!.at ?? 0)).slice(0, ids.length - MAX_PROJECTS)) delete table[id];
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    /* storage unavailable or full */
  }
}
