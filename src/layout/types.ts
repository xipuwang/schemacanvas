import type { Id, Point } from '@/model/types';

/** A node as the layout code sees it: id + rectangle (top-left x/y, same convention as `DiagramNode.x/y`). */
export interface LayoutRect {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional semantic ordering key: tie-breaks and visiting order use it before the opaque id (id-independent layouts). */
  sortKey?: string;
}

export interface Size {
  w: number;
  h: number;
}

/** What `ops.setNodePositions` consumes. */
export type Positions = Record<Id, Point>;
