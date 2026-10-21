/**
 * Vertical / Crow's Foot / physical-model scene geometry (Milestone 6; `crows-foot` and `physical` diagrams).
 * Kinds: `v-table` (node) and `v-fk` (edge). Every symbol, mark and badge is GEOMETRY (no SVG markers).
 * DOM hooks the views emit: `data-column-id` / `data-role` per row, `data-fk-branch` (first pair's source column),
 * `data-fk-target` (its referenced column), `data-fk-pairs`, `data-symbol` (parent|child + kind).
 */
import type { ColumnRole } from '@/model/queries';
import type { Id, Point } from '@/model/types';
import type { EdgeEndGeom, EdgeGeomBase, NodeGeomBase, Rect, Side, TextLabel } from '../base';

export type VOrientation = 'vertical' | 'horizontal';
export type VMode = 'crows-foot' | 'physical';

/** Column constraints shown as markers (`NN`, `UQ`, `AI`). Derived from the model, never stored. */
export interface VRowFlags {
  notNull: boolean;
  unique: boolean;
  autoIncrement: boolean;
}

export interface VTableRowGeom {
  columnId: Id;
  /** Vertical orientation: the full-width row. Horizontal orientation: the bordered cell. */
  rect: Rect;
  /** Column name (underlined = PK, italic = FK). */
  label: TextLabel;
  role: ColumnRole;
  flags: VRowFlags;
  /** Vertical only: `PK` / `FK` / `PK FK` badge in the key gutter. */
  keyLabel?: TextLabel;
  /** Vertical: right-aligned data type. */
  typeLabel?: TextLabel;
  /** Vertical: `NN UQ AI` markers (right-most column). */
  flagLabel?: TextLabel;
  /** Physical: `DEFAULT <expr>`. */
  defaultLabel?: TextLabel;
  /** Horizontal orientation: second line (type + markers), centred under the name. */
  detailLabel?: TextLabel;
}

/** One text line of a physical-model section (constraint or index). */
export interface VSectionLineGeom {
  rect: Rect;
  label: TextLabel;
  /** Right-aligned flags (indexes: `UNIQUE partial btree`). */
  flagLabel?: TextLabel;
  /** Id of the unique / check / foreign key / index this line describes. */
  refId: Id;
}

export interface VTableSectionGeom {
  kind: 'constraints' | 'indexes';
  rect: Rect;
  lines: VSectionLineGeom[];
}

/**
 * A relation drawn as a vertical table (header + one row per column + optional physical sections) or, for crow's foot
 * diagrams with `orientation: 'horizontal'`, as a name above ONE row of bordered cells (rows = cells).
 * `bounds` = header..last section (vertical) or name..row (horizontal); `node.x/y === bounds.x/y`.
 */
export interface VTableGeom extends NodeGeomBase {
  kind: 'v-table';
  orientation: VOrientation;
  mode: VMode;
  nameLabel: TextLabel;
  /** Vertical: header band. Horizontal: the relation name's text box. */
  header: Rect;
  /** Vertical: all rows. Horizontal: the single row of cells. */
  body: Rect;
  rows: VTableRowGeom[];
  /** Physical model only (empty otherwise). */
  sections: VTableSectionGeom[];
}

export type VSymbolKind = 'exactly-one' | 'zero-or-one' | 'one-or-many' | 'zero-or-many';

/** One end symbol (`||`, `o|`, `|{`, `o{`), drawn as lines + circles, not as an SVG marker. */
export interface VSymbolGeom {
  kind: VSymbolKind;
  /** On the table border (identical to the edge end's `at`). */
  at: Point;
  /** Outward normal side of the border at `at`. */
  side: Side;
  /** Outer end of the symbol on the connector; the connector is stroked from here (`strokePoints`). */
  base: Point;
  /** Stroked polylines (bars, prongs, the connector stub inside the symbol). */
  lines: Point[][];
  circles: Array<{ cx: number; cy: number; r: number }>;
}

/** Marks the other columns of a composite FK: a dot just outside the table border at that column's row/cell. */
export interface VMemberMark {
  columnId: Id;
  /** `source` = referencing relation, `target` = referenced relation. */
  end: 'source' | 'target';
  at: Point;
  side: Side;
  r: number;
}

export interface VFkEdgeGeom extends EdgeGeomBase {
  kind: 'v-fk';
  /** Full polyline, `points[0]` = source border point, last = target border point. */
  points: Point[];
  /** `points` with both ends moved to the symbols' bases: what renderers stroke. */
  strokePoints: Point[];
  /** Symbol at the REFERENCING (source/child) end; `kind` derived only from `queries.fkCardinality`. */
  childSymbol: VSymbolGeom;
  /** Symbol at the REFERENCED (target/parent) end. */
  parentSymbol: VSymbolGeom;
  /** Cardinality the symbols were derived from (`stated` = which fields the model states explicitly). */
  cardinality: { childMax: 'one' | 'many'; childMin: 0 | 1; parentMin: 0 | 1; stated: Array<'childMax' | 'childMin' | 'parentMin'> };
  /** Column pair the connector is attached to (the first resolvable pair of the FK). */
  sourceColumnId: Id;
  targetColumnId: Id;
  /** Every column pair of the (single, logical) foreign key. */
  pairs: Array<{ sourceColumnId: Id; targetColumnId: Id }>;
  composite: boolean;
  /** Dots on the other pairs' rows (empty for single-column FKs). */
  memberMarks: VMemberMark[];
  /** Thin lines along the border joining each member dot to the attached row (`[from, dot]`). */
  memberLinks: Point[][];
  sourceSide: Side;
  targetSide: Side;
  sourceCell: Rect;
  targetCell: Rect;
}

export type VNodeGeomAny = VTableGeom;
export type VEdgeGeomAny = VFkEdgeGeom;
