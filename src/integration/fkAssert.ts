import { expect } from 'vitest';
import type { ForeignKey } from '@/model/types';
import type { FkEdgeGeom, HTableGeom, Rect } from '@/scene/types';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

/** Is `p` on the border of rect `r` (and which side)? */
export function borderSide(p: { x: number; y: number }, r: Rect, eps = 0.51): 'top' | 'bottom' | 'left' | 'right' | null {
  const inX = p.x >= r.x - eps && p.x <= r.x + r.w + eps;
  const inY = p.y >= r.y - eps && p.y <= r.y + r.h + eps;
  if (inX && near(p.y, r.y, eps)) return 'top';
  if (inX && near(p.y, r.y + r.h, eps)) return 'bottom';
  if (inY && near(p.x, r.x, eps)) return 'left';
  if (inY && near(p.x, r.x + r.w, eps)) return 'right';
  return null;
}

/**
 * Assert that an FK edge geometry is faithful to the semantic FK: the branch pairs ARE the FK pairs, every branch's
 * arrow tip touches the border of the cell of its OWN referenced column (cell looked up in the target table's real
 * cell list), the branch starts on the border of its own source cell, and the arrow points perpendicular into the cell.
 */
export function fkEdgeRefs(e: FkEdgeGeom, fk: ForeignKey, source: HTableGeom, target: HTableGeom, opts: { routing?: 'orthogonal' | 'straight' } = {}): void {
  const semantic = fk.columns.map((c) => `${c.sourceColumnId}>${c.targetColumnId}`).sort();
  const pairs = (e.pairs ?? e.branches.map((b) => ({ sourceColumnId: b.sourceColumnId, targetColumnId: b.targetColumnId }))).map((c) => `${c.sourceColumnId}>${c.targetColumnId}`).sort();
  expect(pairs, `FK ${fk.id} pairs`).toEqual(semantic);
  const cellOf = (t: HTableGeom, id: string) => t.cells.find((c) => c.columnId === id)!;
  if (e.style === 'branches') expect(e.branches.length).toBe(fk.columns.length);
  else expect(e.branches.length).toBe(1);
  for (const b of e.branches) {
    const tcell = cellOf(target, b.targetColumnId);
    const scell = cellOf(source, b.sourceColumnId);
    expect(tcell, `target cell ${b.targetColumnId}`).toBeDefined();
    expect(scell, `source cell ${b.sourceColumnId}`).toBeDefined();
    if (e.style === 'branches') {
      expect(fk.columns.some((c) => c.sourceColumnId === b.sourceColumnId && c.targetColumnId === b.targetColumnId)).toBe(true);
      expect(b.targetCell).toEqual(tcell.rect);
      expect(b.sourceCell).toEqual(scell.rect);
    }
    const last = b.points[b.points.length - 1]!;
    expect(last).toEqual(b.arrow.tip);
    const side = borderSide(b.arrow.tip, b.targetCell);
    expect(side, `FK ${fk.id} arrow tip must touch its target cell border (${JSON.stringify(b.arrow.tip)} vs ${JSON.stringify(b.targetCell)})`).not.toBeNull();
    // perpendicular approach: the last stroke segment is axis-aligned and runs along the side normal
    const base = b.arrow.base;
    if (side === 'top' || side === 'bottom') expect(near(base.x, b.arrow.tip.x, 0.01), 'arrow vertical').toBe(true);
    else expect(near(base.y, b.arrow.tip.y, 0.01), 'arrow horizontal').toBe(true);
    if (e.style === 'branches' && opts.routing !== 'straight') {
      // source start on the source cell border
      expect(borderSide(b.points[0]!, b.sourceCell), `FK ${fk.id} start on source cell border`).not.toBeNull();
    }
    if (e.style === 'bracket') {
      // the bracket arrow starts ON the source bracket (a few px outside the span) and the tip lies within the target span
      const sb = e.brackets!.source;
      const y = sb[1]!.y;
      expect(near(b.points[0]!.y, y, 0.01), `FK ${fk.id} bracket start on source bracket`).toBe(true);
      expect(b.points[0]!.x).toBeGreaterThanOrEqual(sb[1]!.x - 0.01);
      expect(b.points[0]!.x).toBeLessThanOrEqual(sb[2]!.x + 0.01);
    }
    if (opts.routing !== 'straight') {
      for (let i = 0; i + 1 < b.points.length; i++) {
        const p = b.points[i]!, q = b.points[i + 1]!;
        expect(near(p.x, q.x, 0.01) || near(p.y, q.y, 0.01), `FK ${fk.id} segment ${i} orthogonal`).toBe(true);
      }
    }
  }
}
