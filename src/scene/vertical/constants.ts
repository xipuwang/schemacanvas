/** Layout constants of the vertical / crow's foot / physical notation (world units = px at zoom 1). */

export const PAD_X = 8;
export const PAD_Y = 6;
export const HEADER_PAD_Y = 7;
/** Gap between the columns of a vertical row. */
export const COL_GAP = 12;
export const BADGE_GAP = 8;
export const MIN_TABLE_W = 120;
/** Horizontal orientation. */
export const MIN_CELL_W = 36;
export const CELL_PAD_X = 10;
export const NAME_GAP_ABOVE = 8;
/** Section text (constraints / indexes / defaults) longer than this is ellipsised. */
export const MAX_SECTION_TEXT_W = 560;
export const MAX_DEFAULT_W = 150;
export const SECTION_PAD_Y = 3;

export const DEFAULT_NODE_STROKE_WIDTH = 1.25;
export const DEFAULT_FK_STROKE_WIDTH = 1.3;

/** Perpendicular stub of every connector (must be >= the longest symbol). */
export const STUB = 30;
export const CLEARANCE = 10;
/** Anchors stay this far from the ends of their row/cell side. */
export const ANCHOR_INSET = 4;
export const NAME_ANCHOR_MARGIN = 6;
export const MIN_FREE_SLIVER = 6;
/** Facing tables closer than this use the same side for both ends. */
export const FACING_GAP = 44;
/** Smallest gap between two tables for which their facing sides are connected directly (the stub shrinks to fit). */
export const MIN_FACING_GAP = 4;

// Symbol geometry (distances measured from the table border outwards).
export const BAR_HALF = 4.5;
export const FOOT_HALF = 6;
export const FOOT_LEN = 12;
export const CIRCLE_R = 4;
export const BAR_1 = 6;
export const BAR_2 = 10;
export const SYMBOL_MAX_LEN = 20;
export const MEMBER_DOT_R = 2.5;
