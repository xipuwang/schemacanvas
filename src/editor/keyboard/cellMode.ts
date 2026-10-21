/**
 * CELL MODE: keyboard navigation inside one table (Enter on a selected table). Pure state machine, no store / DOM.
 *
 *  - `cursor` is the cell the keyboard is on; `marks` are the cells explicitly added to a multi-cell selection (the source of a
 *    composite foreign key). With no marks the effective selection is just the cursor cell.
 *  - Left / Right / Home / End move the cursor (marks stay), Shift+Left/Right extends a contiguous range from the anchor,
 *    Space toggles the cursor cell in the marks.
 */
import type { Id } from '@/model/types';

export interface CellModeState {
  nodeId: Id;
  relationId: Id;
  /** Column ids in TABLE order (cell order on screen). */
  columns: Id[];
  cursor: number;
  /** Where a Shift-range started. */
  anchor: number;
  /** Explicitly marked columns (table order is applied by `effectiveColumns`). */
  marks: Id[];
}

export function enterCellMode(nodeId: Id, relationId: Id, columns: Id[], startColumnId?: Id): CellModeState | undefined {
  if (columns.length === 0) return undefined;
  const i = startColumnId ? columns.indexOf(startColumnId) : -1;
  const cursor = i < 0 ? 0 : i;
  return { nodeId, relationId, columns: [...columns], cursor, anchor: cursor, marks: [] };
}

export const cursorColumn = (s: CellModeState): Id => s.columns[s.cursor]!;

const clampIndex = (s: CellModeState, i: number): number => Math.min(s.columns.length - 1, Math.max(0, i));

export type CellMove = number | 'first' | 'last';

/** Move the cursor by `to` cells (or to an end). `extend`: the marks become the range anchor..cursor. */
export function moveCursor(s: CellModeState, to: CellMove, extend = false): CellModeState {
  const cursor = clampIndex(s, to === 'first' ? 0 : to === 'last' ? s.columns.length - 1 : s.cursor + to);
  if (!extend) return cursor === s.cursor ? s : { ...s, cursor, anchor: s.marks.length === 0 ? cursor : s.anchor };
  const anchor = s.marks.length === 0 ? s.cursor : s.anchor;
  const lo = Math.min(anchor, cursor);
  const hi = Math.max(anchor, cursor);
  return { ...s, cursor, anchor, marks: s.columns.slice(lo, hi + 1) };
}

/** Space: add the cursor cell to the marks, or remove it. */
export function toggleCell(s: CellModeState): CellModeState {
  const id = cursorColumn(s);
  const has = s.marks.includes(id);
  return { ...s, anchor: s.cursor, marks: has ? s.marks.filter((m) => m !== id) : [...s.marks, id] };
}

/** The columns an action (a foreign key from the selection) applies to, in table order. */
export function effectiveColumns(s: CellModeState): Id[] {
  if (s.marks.length === 0) return [cursorColumn(s)];
  return s.columns.filter((c) => s.marks.includes(c));
}

export const isMarked = (s: CellModeState, columnId: Id): boolean => s.marks.includes(columnId);

/** The cell columns changed (undo, rename keeps ids): drop what no longer exists, keep the cursor on the same column when possible. */
export function syncColumns(s: CellModeState, columns: Id[]): CellModeState | undefined {
  if (columns.length === 0) return undefined;
  if (columns.length === s.columns.length && columns.every((c, i) => c === s.columns[i])) return s;
  const cur = cursorColumn(s);
  const i = columns.indexOf(cur);
  const cursor = i >= 0 ? i : Math.min(s.cursor, columns.length - 1);
  return { ...s, columns: [...columns], cursor, anchor: cursor, marks: s.marks.filter((m) => columns.includes(m)) };
}
