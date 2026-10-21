import { BAR_HALF, FOOT_HALF, STUB, SYMBOL_MAX_LEN } from './constants';

/** Layout constants other modules (tests, the editor's handle overlay) may need to agree on. */
export const VERTICAL_CONSTANTS = { STUB, SYMBOL_MAX_LEN, BAR_HALF, FOOT_HALF } as const;
