import type { Id } from '@/model/types';
import type { EdgeGeomBase, NodeGeomBase, Rect } from './base';
import type { ChenEdgeGeomAny, ChenNodeGeomAny } from './chen/types';
import type { HEdgeGeomAny, HNodeGeomAny } from './horizontal/types';
import type { VEdgeGeomAny, VNodeGeomAny } from './vertical/types';

export * from './base';
export type * from './chen/types';
export type * from './horizontal/types';
export type * from './vertical/types';

/** Every node geometry the app can draw (discriminated by `kind`). Widen in the FAMILY's types file, not here. */
export type NodeGeom = ChenNodeGeomAny | HNodeGeomAny | VNodeGeomAny;
export type NodeGeomKind = NodeGeom['kind'];

/** Every edge geometry the app can draw (discriminated by `kind`). Widen in the FAMILY's types file, not here. */
export type EdgeGeom = ChenEdgeGeomAny | HEdgeGeomAny | VEdgeGeomAny;
export type EdgeGeomKind = EdgeGeom['kind'];

// Compile-time guarantee that all family geoms satisfy the shared bases.
type _NodeCheck = NodeGeom extends NodeGeomBase ? true : never;
type _EdgeCheck = EdgeGeom extends EdgeGeomBase ? true : never;
export type _SceneChecks = [_NodeCheck, _EdgeCheck];

/** The complete drawable result of laying out one diagram. */
export interface Scene {
  diagramId: Id;
  /** Keyed by DiagramNode id. */
  nodes: Record<Id, NodeGeom>;
  /** Keyed by DiagramEdge id. */
  edges: Record<Id, EdgeGeom>;
  /** DiagramNode ids in paint order (back → front). */
  nodeOrder: Id[];
  /** DiagramEdge ids in paint order. */
  edgeOrder: Id[];
  /** ∪ node `paintBounds` ∪ edge `bounds` — the export & fit-to-content rectangle (never clips). */
  bounds: Rect;
  /** Non-fatal build problems (dangling refs skipped, invalid anchor coerced, bracket fallback `fk-bracket-fallback:<fkId>`, …). */
  warnings: string[];
  /** Present (and `'draft'`) ONLY on scenes built with `quality: 'draft'`; absent on every full-quality scene. */
  quality?: 'draft';
}
