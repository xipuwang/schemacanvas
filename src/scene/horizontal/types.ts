/**
 * Horizontal relational-schema scene geometry. OWNED by the horizontal-schema worker, who may extend these types
 * ADDITIVELY and add kinds by widening `HNodeGeomAny` / `HEdgeGeomAny` (kinds: `h-*` or `fk*`).
 * DOM hooks required on the rendered output (Playwright geometry assertions): every cell carries
 * `data-column-id`, every FK branch carries `data-fk-branch="<sourceColumnId>"`.
 */
import type { ColumnRole } from '@/model/queries';
import type { Id, Point } from '@/model/types';
import type { ArrowGeom, EdgeEndGeom, EdgeGeomBase, NodeGeomBase, Rect, Side, TextLabel } from '../base';

export interface HTableCellGeom {
  columnId: Id;
  rect: Rect;
  label: TextLabel;
  typeLabel?: TextLabel;
  role: ColumnRole;
}

/** A single-row, horizontally laid out relation: `Name` + one bordered cell per attribute. */
export interface HTableGeom extends NodeGeomBase {
  kind: 'h-table';
  nameLabel: TextLabel;
  /** Bounding rect of the row of cells (excludes the relation name). `bounds` additionally includes the name. */
  row: Rect;
  cells: HTableCellGeom[];
}

export interface FkBranchGeom {
  sourceColumnId: Id;
  targetColumnId: Id;
  /** Source anchor → … → `arrow.tip`. `points[last]` EQUALS `arrow.tip` exactly (tests assert it). */
  points: Point[];
  /** `points` with the last point replaced by `arrow.base`: what renderers stroke. */
  strokePoints: Point[];
  arrow: ArrowGeom;
  sourceSide: Side;
  targetSide: Side;
  sourceCell: Rect;
  targetCell: Rect;
  ends: [EdgeEndGeom, EdgeEndGeom];
}

export interface FkEdgeGeom extends EdgeGeomBase {
  kind: 'fk';
  /** The style actually DRAWN (a requested `bracket` falls back to `branches` when pairs are not contiguous & ordered). */
  style: 'branches' | 'bracket';
  /**
   * `branches`: one entry per column pair, in the foreign key's pair order. `bracket`: exactly ONE entry for the
   * bracket-to-bracket arrow (its `source/targetColumnId` are the FIRST pair's and its cells are the bracketed SPANS;
   * `pairs` lists every pair).
   */
  branches: FkBranchGeom[];
  /** The foreign key's complete ordered column pairs (for bracket edges the single branch cannot carry them all). */
  pairs?: Array<{ sourceColumnId: Id; targetColumnId: Id }>;
  brackets?: { source: Point[]; target: Point[] };
  /**
   * The polyline the stored waypoints are corners of and the editor lays bend / midpoint handles along: the primary branch
   * for a single branch, the lane CENTRELINE for a bundle or a manual composite. Every `bendHandles[i].at` lies on it.
   */
  centreline?: Point[];
}

export type HNodeGeomAny = HTableGeom;
export type HEdgeGeomAny = FkEdgeGeom;
