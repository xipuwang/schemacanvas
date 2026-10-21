/** Layout constants of the horizontal relational-schema notation (world units = px at zoom 1). */

/** Smallest default cell width; per-column overrides may only grow a cell past its TEXT fit, not past this. */
export const MIN_CELL_W = 36;
/** Vertical padding between a cell border and its text block. */
export const CELL_PAD_Y = 6;
/** Gap between the relation name and the row (name above / name left). */
export const NAME_GAP_ABOVE = 8;
export const NAME_GAP_LEFT = 10;
/** Anchors are kept at least this far from the left/right edge of their cell. */
export const ANCHOR_INSET = 4;
/** Horizontal margin kept around the relation name when choosing an anchor on the top border of a cell below it. */
export const NAME_ANCHOR_MARGIN = 6;
/** Narrowest free sliver of a cell border that still accepts an anchor. */
export const MIN_FREE_SLIVER = 6;

/** Perpendicular stub every connector keeps at both ends (also the minimum length of the last, arrow-bearing segment). */
export const STUB = 16;
export const ARROW_LEN = 10;
export const ARROW_HALF_WIDTH = 4.5;
/** Router clearance around tables (rows and relation names). */
export const CLEARANCE = 10;
/** Distance between the branches of a composite FK bundle. */
export const BRANCH_GAP = 8;
/** Minimum distance between parallel, overlapping runs of connectors of DIFFERENT foreign keys (SA-05). */
export const MIN_LANE_GAP = 8;
/** How far a bracket stands off the cell border. */
export const BRACKET_OFFSET = 5;
/** Bracket ticks stop this far inside the outer cell edges. */
export const BRACKET_INSET = 3;

export const DEFAULT_FK_STROKE_WIDTH = 1.4;
export const DEFAULT_NODE_STROKE_WIDTH = 1.25;
