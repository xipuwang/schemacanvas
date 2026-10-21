import type { Id, Point, Viewport } from '@/model/types';
import type { Rect } from '@/scene/base';
import type { LibraryItem } from './dnd';

/** Imperative API of the mounted canvas (also what the command registry reaches through `ctx.canvas`). */
export interface DiagramCanvasHandle {
  getViewport(): Viewport;
  setViewport(v: Viewport): void;
  zoomBy(factor: number, around?: Point): void;
  zoomTo(zoom: number, around?: Point): void;
  /** Fit the whole content (Scene.bounds) into view with margin. No-op for an empty diagram. */
  fitToContent(): void;
  /** Fit just these nodes. */
  fitToNodes(nodeIds: readonly Id[]): void;
  /** Convert a client (screen) point to world coordinates and back. */
  clientToWorld(clientX: number, clientY: number): Point;
  worldToClient(p: Point): { x: number; y: number };
  /** Centre of the visible area in world coordinates (where "add" commands place new elements). */
  visibleCenter(): Point;
  /** The visible area in world coordinates (additive: used by paste to land near the visible centre). */
  visibleRect(): Rect;
  /** Arm a library item: the next click on the canvas places it (Escape cancels). `null` disarms. */
  armItem(item: LibraryItem | null): void;
  /** Begin inline text editing of a node label / cell / edge label (ids from the store selection or scene). */
  startInlineEdit(target: { nodeId?: Id; columnId?: Id; edgeId?: Id }): void;
  /** Move keyboard focus into the canvas. */
  focus(): void;
}
