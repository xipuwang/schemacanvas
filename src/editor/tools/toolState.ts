/**
 * Transient UI state of the editing tools (hover, ghost lines, the FK mapping popover, the tool hint). It is NOT project
 * data and never enters history. Plugins write it and call `cx.requestRender()`; the overlay components subscribe.
 */
import { createStore, useStore } from 'zustand';
import type { Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import type { KeyCandidate } from './fkLogic';

export type ConnectFeedback = { tone: 'ok' | 'bad' | 'neutral'; text: string };

export interface ConnectDrag {
  fromNodeId: Id;
  /** Ghost line start (on the source outline) and current pointer. */
  from: Point;
  to: Point;
  /** Node under the pointer (highlighted), if any. */
  overNodeId?: Id;
  feedback?: ConnectFeedback;
}

export interface FkSource {
  nodeId: Id;
  relationId: Id;
  /** Column ids in TABLE order. */
  columnIds: Id[];
}

export interface FkDrag {
  source: FkSource;
  from: Point;
  to: Point;
  overNodeId?: Id;
  /** Cells the drop would reference (preview), source and target. */
  targetColumnIds: Id[];
  feedback?: ConnectFeedback;
}

/** What the FK mapping popover shows (confirm / reorder pair by pair BEFORE the foreign key exists). */
export interface FkPopoverState {
  diagramId: Id;
  modelId: Id;
  source: FkSource;
  targetNodeId: Id;
  targetRelationId: Id;
  /** World point of the drop. */
  at: Point;
  /** World rect the popover is anchored to: the referenced table's height at the drop x, so the popover opens beside / below it and never covers it. */
  anchor: Rect;
  /** Chosen target key: the candidate index into `keys`. */
  keyIndex: number;
  keys: KeyCandidate[];
  /** pairs[i]: target column for source.columnIds[i] (a permutation of the chosen key). */
  targetColumnIds: Id[];
}

export interface ToolUiState {
  /** Hovered node (shows ports) and, for tables, the hovered cell. */
  hoverNodeId: Id | null;
  hoverColumnId: Id | null;
  /** Port under the pointer (highlighted). */
  hoverPort: string | null;
  connect: ConnectDrag | null;
  fk: FkDrag | null;
  /** FK tool: click-armed source (click a cell, then click the referenced table). */
  fkPending: FkSource | null;
  fkPopover: FkPopoverState | null;
  /** Free text shown in the tool hint chip while a gesture runs (overrides the idle tool hint). */
  gestureHint: ConnectFeedback | null;
  /** Handle being dragged (kept highlighted) and the live size read-out near the pointer. */
  activeHandle: string | null;
  readout: { at: Point; text: string } | null;
  /** Press-and-hold menu for the add-attribute port. */
  attrMenu: { clientX: number; clientY: number; ownerNodeId: Id } | null;
  /** Rect (world) to flash after something was created/changed, for orientation. */
  flash: Rect | null;
  /** aria-live text (tool state, results of gestures). */
  announcement: string;
}

const initial = (): ToolUiState => ({
  hoverNodeId: null,
  hoverColumnId: null,
  hoverPort: null,
  connect: null,
  fk: null,
  fkPending: null,
  fkPopover: null,
  gestureHint: null,
  activeHandle: null,
  readout: null,
  attrMenu: null,
  flash: null,
  announcement: '',
});

export const toolUi = createStore<ToolUiState>(initial);
export const useToolUi = <T,>(selector: (s: ToolUiState) => T): T => useStore(toolUi, selector);
export const setToolUi = (patch: Partial<ToolUiState>): void => toolUi.setState(patch);
export const resetToolUi = (keep: Array<keyof ToolUiState> = []): void => {
  const base = initial();
  const cur = toolUi.getState();
  for (const k of keep) (base as unknown as Record<string, unknown>)[k] = cur[k];
  toolUi.setState(base, true);
};

let announceTimer: ReturnType<typeof setTimeout> | undefined;

/** Politely announce `text` to assistive technology (rendered into the tools' live region); it expires so it is never stale. */
export const announce = (text: string): void => {
  toolUi.setState((s) => ({ announcement: s.announcement === text ? `${text}\u200b` : text }));
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = text ? setTimeout(() => toolUi.setState({ announcement: '' }), 10_000) : undefined;
};
