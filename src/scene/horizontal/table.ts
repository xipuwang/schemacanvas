/**
 * Geometry of ONE horizontal table: relation name + a single row of bordered cells.
 * Pure function of (node, relation, options, measure); nothing here knows about edges.
 */
import { columnRole } from '@/model/queries';
import type { DiagramNode, DiagramOptions, RelationalModel, Relation, RelationalSchemaOptions } from '@/model/types';
import type { FontSpec, MeasureText, Rect, TextLabel } from '../base';
import { inflateRect, labelRect, paintRect, unionRects } from '../geometry';
import {
  ANCHOR_INSET,
  CELL_PAD_Y,
  DEFAULT_NODE_STROKE_WIDTH,
  MIN_CELL_W,
  MIN_FREE_SLIVER,
  NAME_ANCHOR_MARGIN,
  NAME_GAP_ABOVE,
  NAME_GAP_LEFT,
} from './constants';
import type { HTableCellGeom, HTableGeom } from './types';

export interface TableLayout {
  geom: HTableGeom;
  /** The relation name's text box (an obstacle for connectors, and the region top-border anchors avoid). */
  nameRect: Rect;
  nameAbove: boolean;
  /** Stroke width used for the cell borders (the renderer reads the same value from `node.style`). */
  strokeWidth: number;
}

export function typographyOf(node: DiagramNode, options: DiagramOptions): { family: string; size: number; weight?: 'normal' | 'bold' } {
  return {
    family: node.style?.fontFamily ?? options.typography.fontFamily,
    size: node.style?.fontSize ?? options.typography.fontSize,
    weight: node.style?.fontWeight,
  };
}

export function layoutTable(
  node: DiagramNode,
  relation: Relation,
  model: RelationalModel,
  options: DiagramOptions,
  rel: RelationalSchemaOptions,
  measure: MeasureText,
): TableLayout {
  const { family, size: fs, weight } = typographyOf(node, options);
  const lineH = fs * 1.2;
  const typeFs = Math.max(8, Math.round(fs * 0.8));
  const typeLineH = typeFs * 1.2;
  const strokeWidth = node.style?.strokeWidth ?? DEFAULT_NODE_STROKE_WIDTH;

  // Two-line cells (name + type) are decided per TABLE so every cell keeps the same text baseline.
  const twoLine = rel.showDataTypes && relation.columns.some((c) => !!c.dataType);
  const minRowH = Math.ceil(2 * CELL_PAD_Y + lineH + (twoLine ? typeLineH : 0));
  const rowH = Math.max(node.height ?? rel.rowHeight, minRowH);

  const fontFor = (role: HTableCellGeom['role']): FontSpec => ({
    family,
    size: fs,
    weight,
    style: role === 'fk' || role === 'pk+fk' ? 'italic' : 'normal',
  });
  const typeFont: FontSpec = { family, size: typeFs };
  const roles = relation.columns.map((c) => columnRole(model, relation.id, c.id));
  const fits = relation.columns.map((c, i) => {
    const nameW = measure(c.name, fontFor(roles[i]!));
    const typeW = twoLine && c.dataType ? measure(c.dataType, typeFont) : 0;
    return Math.ceil(Math.max(nameW, typeW) + 2 * rel.cellPaddingX);
  });
  const widths = relation.columns.map((c, i) => {
    const override = node.columnWidths?.[c.id];
    // An override may only GROW a cell beyond its text fit; shrinking would clip or overflow the text.
    return override !== undefined ? Math.max(override, fits[i]!) : Math.max(fits[i]!, MIN_CELL_W);
  });
  if (node.width !== undefined) {
    const total = widths.reduce((a, b) => a + b, 0);
    const free = relation.columns.map((c) => node.columnWidths?.[c.id] === undefined);
    const freeTotal = widths.reduce((a, w, i) => a + (free[i] ? w : 0), 0);
    if (node.width > total && freeTotal > 0) {
      const surplus = node.width - total;
      widths.forEach((w, i) => {
        if (free[i]) widths[i] = w + (surplus * w) / freeTotal;
      });
    }
  }
  const rowW = relation.columns.length === 0 ? Math.max(node.width ?? 0, 80) : widths.reduce((a, b) => a + b, 0);

  const nameFont: FontSpec = { family, size: fs, weight: 'bold' };
  const nameW = measure(relation.name, nameFont);
  const nameAbove = rel.nameAbove;
  let row: Rect;
  let nameRect: Rect;
  if (nameAbove) {
    nameRect = { x: node.x, y: node.y, w: nameW, h: lineH };
    row = { x: node.x, y: node.y + lineH + NAME_GAP_ABOVE, w: rowW, h: rowH };
  } else {
    nameRect = { x: node.x, y: node.y + (rowH - lineH) / 2, w: nameW, h: lineH };
    row = { x: node.x + nameW + NAME_GAP_LEFT, y: node.y, w: rowW, h: rowH };
  }
  const bounds = unionRects([row, nameRect])!;
  // `unionRects` anchors at min x/y which is exactly node.x/node.y by construction; assert the invariant cheaply.
  bounds.x = node.x;
  bounds.y = node.y;

  const nameLabel: TextLabel = {
    text: relation.name,
    x: nameRect.x,
    y: nameRect.y + lineH / 2,
    anchor: 'start',
    font: nameFont,
    width: nameW,
  };

  let cx = row.x;
  const cells: HTableCellGeom[] = relation.columns.map((c, i) => {
    const rect: Rect = { x: cx, y: row.y, w: widths[i]!, h: rowH };
    cx += widths[i]!;
    const role = roles[i]!;
    const font = fontFor(role);
    const blockH = lineH + (twoLine ? typeLineH : 0);
    const top = rect.y + (rowH - blockH) / 2;
    const label: TextLabel = {
      text: c.name,
      x: rect.x + rect.w / 2,
      y: top + lineH / 2,
      anchor: 'middle',
      font,
      width: measure(c.name, font),
      underline: role === 'pk' || role === 'pk+fk' ? 'solid' : undefined,
    };
    if (label.underline === undefined) delete label.underline;
    const cell: HTableCellGeom = { columnId: c.id, rect, label, role };
    if (twoLine && c.dataType) {
      cell.typeLabel = {
        text: c.dataType,
        x: rect.x + rect.w / 2,
        y: top + lineH + typeLineH / 2,
        anchor: 'middle',
        font: typeFont,
        width: measure(c.dataType, typeFont),
      };
    }
    return cell;
  });

  const paint = unionRects([paintRect(bounds, strokeWidth), labelRect(nameLabel), inflateRect(row, strokeWidth / 2 + 1)])!;
  const geom: HTableGeom = {
    kind: 'h-table',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paint,
    outline: { kind: 'rect', rect: bounds },
    nameLabel,
    row,
    cells,
  };
  return { geom, nameRect, nameAbove, strokeWidth };
}

/**
 * The usable interval along one border of `cell` for connector anchors, as [lo, hi] (x for top/bottom, y for left/right).
 * The top border of a cell under the relation name excludes the name's x-range (+ margin) so no connector crosses the
 * name; `undefined` means "blocked" (no usable sliver) and the caller prefers the bottom border instead.
 */
export function borderInterval(layout: TableLayout, cell: Rect, side: 'top' | 'bottom' | 'left' | 'right'): [number, number] | undefined {
  if (side === 'left' || side === 'right') return [cell.y + ANCHOR_INSET, cell.y + cell.h - ANCHOR_INSET];
  const lo = cell.x + ANCHOR_INSET;
  const hi = cell.x + cell.w - ANCHOR_INSET;
  if (side === 'bottom' || !layout.nameAbove) return [lo, hi];
  const blockLo = layout.nameRect.x - NAME_ANCHOR_MARGIN;
  const blockHi = layout.nameRect.x + layout.nameRect.w + NAME_ANCHOR_MARGIN;
  const parts: Array<[number, number]> = [];
  if (blockLo - lo >= MIN_FREE_SLIVER) parts.push([lo, Math.min(hi, blockLo)]);
  if (hi - blockHi >= MIN_FREE_SLIVER) parts.push([Math.max(lo, blockHi), hi]);
  if (blockHi <= lo || blockLo >= hi) return [lo, hi]; // the name does not overhang this cell at all
  if (parts.length === 0) return undefined;
  return parts.reduce((best, p) => (p[1] - p[0] > best[1] - best[0] ? p : best));
}
