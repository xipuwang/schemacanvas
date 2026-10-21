import type { autoLayout as autoLayoutImpl } from './autoLayout';
import { trackLayoutBusy } from './layoutBusy';

export type { AutoLayoutOptions } from './autoLayout';
/**
 * `autoLayout` (scene -> positions). The implementation (autoLayout + the Chen engine, ~25 KB) is loaded on first call so it
 * stays out of the entry bundle; the busy flag covers that load too.
 */
export const autoLayout: typeof autoLayoutImpl = (...args) => trackLayoutBusy(async () => (await import('./autoLayout')).autoLayout(...args));
export { layoutBusyStore, isLayoutBusy, selectLayoutBusy, trackLayoutBusy, type LayoutBusyState } from './layoutBusy';
export { isAbortError, configureElk, disposeElk, elkStats, type ElkMode } from './elkRunner';
import type { layoutGraph as layoutGraphImpl } from './elkGraph';
export { STRESS_MAX_NODES } from './limits';
export type { GraphEdge, GraphNode, LayoutAlgorithm, LayoutDirection, LayoutGraphInput } from './elkGraph';
/** Lazy like `autoLayout` (ELK glue + overlap passes load with the first layout). */
export const layoutGraph: typeof layoutGraphImpl = (...args) => trackLayoutBusy(async () => (await import('./elkGraph')).layoutGraph(...args));
export type { ChenKind, ChenLayoutInput, ChenLayoutOptions } from './chenLayout';
import type { layoutChen as layoutChenImpl } from './chenLayout';
/** Lazy like `autoLayout` (the Chen engine is not needed to draw). `chenLoopPolylines` (sync, test/diagnostic) is imported from `@/layout/chenLayout`. */
export const layoutChen: typeof layoutChenImpl = (...args) => trackLayoutBusy(async () => (await import('./chenLayout')).layoutChen(...args));
export {
  alignNodes,
  distributeNodes,
  matchSize,
  nudgeOutOfOverlap,
  placeNear,
  snapPoint,
  snapRect,
  stackBelow,
  type AlignMode,
  type Axis,
  type NudgeOptions,
  type PlaceNearOptions,
  type SnapGuide,
  type SnapOptions,
  type SnapResult,
} from './align';
export { anyOverlap, boundsOf, layoutBounds } from './rects';
export type { LayoutRect, Positions, Size } from './types';
