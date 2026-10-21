import { describe, expect, it } from 'vitest';
import { cursorColumn, effectiveColumns, enterCellMode, isMarked, moveCursor, syncColumns, toggleCell } from './cellMode';

const cols = ['a', 'b', 'c', 'd', 'e'];
const start = () => enterCellMode('n1', 'r1', cols)!;

describe('cell mode state machine', () => {
  it('enters on the given column (or the first) and refuses an empty table', () => {
    expect(cursorColumn(enterCellMode('n', 'r', cols, 'c')!)).toBe('c');
    expect(cursorColumn(enterCellMode('n', 'r', cols, 'zzz')!)).toBe('a');
    expect(enterCellMode('n', 'r', [])).toBeUndefined();
  });
  it('Left/Right/Home/End move and clamp at the ends', () => {
    let s = start();
    s = moveCursor(s, -1);
    expect(cursorColumn(s)).toBe('a');
    s = moveCursor(s, 1);
    s = moveCursor(s, 1);
    expect(cursorColumn(s)).toBe('c');
    expect(cursorColumn(moveCursor(s, 'last'))).toBe('e');
    expect(cursorColumn(moveCursor(moveCursor(s, 'last'), 1))).toBe('e');
    expect(cursorColumn(moveCursor(s, 'first'))).toBe('a');
  });
  it('plain movement keeps the selection a single cell', () => {
    expect(effectiveColumns(moveCursor(start(), 2))).toEqual(['c']);
  });
  it('Shift+Right extends a contiguous range from the anchor, Shift+Left shrinks it again', () => {
    let s = moveCursor(start(), 1); // on b
    s = moveCursor(s, 1, true);
    s = moveCursor(s, 1, true);
    expect(effectiveColumns(s)).toEqual(['b', 'c', 'd']);
    s = moveCursor(s, -1, true);
    expect(effectiveColumns(s)).toEqual(['b', 'c']);
    s = moveCursor(s, -2, true); // past the anchor: the range flips to a..b
    expect(effectiveColumns(s)).toEqual(['a', 'b']);
  });
  it('effective columns are always in TABLE order even when marked out of order', () => {
    let s = moveCursor(start(), 'last');
    s = toggleCell(s); // e
    s = moveCursor(s, 'first');
    s = toggleCell(s); // a
    expect(s.marks).toEqual(['e', 'a']);
    expect(effectiveColumns(s)).toEqual(['a', 'e']);
  });
  it('Space toggles the cursor cell in and out of the selection; marks survive plain movement', () => {
    let s = moveCursor(start(), 1);
    s = toggleCell(s);
    expect(isMarked(s, 'b')).toBe(true);
    s = moveCursor(s, 1);
    expect(effectiveColumns(s)).toEqual(['b']); // the cursor cell c is NOT part of it until toggled
    s = toggleCell(s);
    expect(effectiveColumns(s)).toEqual(['b', 'c']);
    s = toggleCell(moveCursor(s, -1));
    expect(effectiveColumns(s)).toEqual(['c']);
  });
  it('syncColumns follows undo / column removal and keeps the cursor on the same column', () => {
    let s = moveCursor(start(), 2);
    s = toggleCell(s);
    const next = syncColumns(s, ['a', 'c', 'e'])!;
    expect(cursorColumn(next)).toBe('c');
    expect(next.marks).toEqual(['c']);
    expect(syncColumns(s, cols)).toBe(s);
    expect(syncColumns(s, [])).toBeUndefined();
    expect(cursorColumn(syncColumns(s, ['x', 'y'])!)).toBe('y');
  });
});
