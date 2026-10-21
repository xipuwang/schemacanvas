/**
 * Crow's foot end symbols as GEOMETRY. Distances `d` run from the table border outwards along the connector; `w` runs
 * across it. The connector itself is stroked only from `base` onwards: everything between the border and `base`
 * (the line through the bars, the middle prong, ...) is part of the symbol, so a "zero" circle is a real hollow circle
 * and never a background-coloured overstroke.
 */
import type { Point, Side } from '../base';
import { sideNormal } from '../geometry';
import { BAR_1, BAR_2, BAR_HALF, CIRCLE_R, FOOT_HALF, FOOT_LEN } from './constants';
import type { VSymbolGeom, VSymbolKind } from './types';

/** Distance from the border to `base` for each symbol at scale 1. */
export const SYMBOL_LENGTH: Record<VSymbolKind, number> = {
  'exactly-one': BAR_2,
  'zero-or-one': BAR_1 + 1 + 2 * CIRCLE_R,
  'one-or-many': FOOT_LEN + 4,
  'zero-or-many': FOOT_LEN + 2 * CIRCLE_R,
};

export type EffectiveCardinality = { childMax: 'one' | 'many'; childMin: 0 | 1; parentMin: 0 | 1 };

/** PARENT (referenced) end: `||` when every child must reference a parent, else `o|`. */
export const parentSymbolKind = (c: Pick<EffectiveCardinality, 'parentMin'>): VSymbolKind => (c.parentMin === 1 ? 'exactly-one' : 'zero-or-one');

/** CHILD (referencing) end: many -> crow's foot (`o{` / `|{` by childMin); one -> `||` / `o|` by childMin. */
export function childSymbolKind(c: Pick<EffectiveCardinality, 'childMax' | 'childMin'>): VSymbolKind {
  if (c.childMax === 'many') return c.childMin === 1 ? 'one-or-many' : 'zero-or-many';
  return c.childMin === 1 ? 'exactly-one' : 'zero-or-one';
}

/**
 * Build the symbol standing on the border at `at` facing `side` (outward). `scale` (<= 1) shrinks it uniformly when
 * the connector's end segment is short.
 */
export function buildSymbol(kind: VSymbolKind, at: Point, side: Side, scale = 1): VSymbolGeom {
  const n = sideNormal(side);
  const t = { x: -n.y, y: n.x };
  const s = Math.min(1, Math.max(0.5, scale));
  const P = (d: number, w = 0): Point => ({ x: at.x + n.x * d * s + t.x * w * s, y: at.y + n.y * d * s + t.y * w * s });
  const bar = (d: number, h = BAR_HALF): Point[] => [P(d, -h), P(d, h)];
  const lines: Point[][] = [];
  const circles: VSymbolGeom['circles'] = [];
  const foot = (): void => {
    lines.push([P(FOOT_LEN, 0), P(0, -FOOT_HALF)], [P(FOOT_LEN, 0), P(0, 0)], [P(FOOT_LEN, 0), P(0, FOOT_HALF)]);
  };
  let baseD: number;
  switch (kind) {
    case 'exactly-one':
      lines.push([P(0), P(BAR_2)], bar(BAR_1), bar(BAR_2));
      baseD = BAR_2;
      break;
    case 'zero-or-one': {
      const c0 = BAR_1 + 1 + CIRCLE_R;
      lines.push([P(0), P(BAR_1 + 1)], bar(BAR_1));
      const c = P(c0);
      circles.push({ cx: c.x, cy: c.y, r: CIRCLE_R * s });
      baseD = c0 + CIRCLE_R;
      break;
    }
    case 'one-or-many':
      foot();
      lines.push([P(FOOT_LEN), P(FOOT_LEN + 4)], bar(FOOT_LEN + 4));
      baseD = FOOT_LEN + 4;
      break;
    case 'zero-or-many': {
      foot();
      const c = P(FOOT_LEN + CIRCLE_R);
      circles.push({ cx: c.x, cy: c.y, r: CIRCLE_R * s });
      baseD = FOOT_LEN + 2 * CIRCLE_R;
      break;
    }
  }
  return { kind, at: { x: at.x, y: at.y }, side, base: P(baseD), lines, circles };
}

/** Paint extent of a symbol (points of lines + circle boxes) for bounds. */
export function symbolPoints(sym: VSymbolGeom): Point[] {
  return [
    ...sym.lines.flat(),
    ...sym.circles.flatMap((c) => [
      { x: c.cx - c.r, y: c.cy - c.r },
      { x: c.cx + c.r, y: c.cy + c.r },
    ]),
  ];
}
