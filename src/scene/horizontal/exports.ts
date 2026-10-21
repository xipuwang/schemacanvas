import { ARROW_LEN, BRANCH_GAP, CLEARANCE, MIN_CELL_W, STUB } from './constants';

/** Layout constants other modules (tests, the editor's handle overlay) may need to agree on. */
export const HORIZONTAL_CONSTANTS = { MIN_CELL_W, STUB, ARROW_LEN, BRANCH_GAP, CLEARANCE } as const;
