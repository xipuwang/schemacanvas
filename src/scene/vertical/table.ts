/**
 * Geometry of ONE vertical-family table: crow's foot (vertical or single-row) and physical-model tables.
 * Pure function of (node, relation, model, options, measure); nothing here knows about edges.
 */
import type { ColumnRole } from '@/model/queries';
import type {
  DiagramNode,
  DiagramOptions,
  ForeignKey,
  Id,
  RelColumn,
  Relation,
  RelationalModel,
} from '@/model/types';
import type { FontSpec, MeasureText, Rect, TextLabel } from '../base';
import { inflateRect, labelRect, paintRect, unionRects } from '../geometry';
import {
  BADGE_GAP,
  CELL_PAD_X,
  COL_GAP,
  DEFAULT_NODE_STROKE_WIDTH,
  HEADER_PAD_Y,
  MAX_DEFAULT_W,
  MAX_SECTION_TEXT_W,
  MIN_CELL_W,
  MIN_TABLE_W,
  NAME_GAP_ABOVE,
  PAD_X,
  PAD_Y,
  SECTION_PAD_Y,
} from './constants';
import type {
  VMode,
  VOrientation,
  VRowFlags,
  VSectionLineGeom,
  VTableGeom,
  VTableRowGeom,
  VTableSectionGeom,
} from './types';

export interface VTableLayout {
  geom: VTableGeom;
  /** The relation name's text box (an obstacle for connectors; horizontal orientation anchors avoid it). */
  nameRect: Rect;
  strokeWidth: number;
}

export interface VTableOptions {
  mode: VMode;
  orientation: VOrientation;
  showTypes: boolean;
  showNullability: boolean;
  showIndexes: boolean;
  showConstraints: boolean;
}

export const fin = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = <T>(v: readonly T[] | undefined | null): readonly T[] => (Array.isArray(v) ? v : []);

/** Truncate `text` with an ellipsis so that it measures at most `maxW`. */
export function fitText(text: string, font: FontSpec, maxW: number, measure: MeasureText): string {
  if (measure(text, font) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + '…', font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

export function typographyOf(node: DiagramNode, options: DiagramOptions): { family: string; size: number; weight?: 'normal' | 'bold' } {
  const size = fin(node.style?.fontSize, fin(options.typography?.fontSize, 14));
  return {
    family: node.style?.fontFamily ?? options.typography?.fontFamily ?? 'Helvetica, Arial, sans-serif',
    size: Math.min(96, Math.max(6, size)),
    weight: node.style?.fontWeight,
  };
}

/** PK / FK roles computed without throwing on corrupt data (see queries.columnRole for the model-level rule). */
export function roleOf(relation: Relation, fkCols: ReadonlySet<Id> | undefined, columnId: Id): ColumnRole {
  const pk = list(relation.primaryKey).includes(columnId);
  const fk = !!fkCols?.has(columnId);
  return pk && fk ? 'pk+fk' : pk ? 'pk' : fk ? 'fk' : 'plain';
}

function flagsOf(relation: Relation, c: RelColumn): VRowFlags {
  const single = (ids: readonly Id[] | undefined) => list(ids).length === 1 && list(ids)[0] === c.id;
  const unique =
    list(relation.uniques).some((u) => single(u?.columnIds)) ||
    list(relation.indexes).some((i) => !!i && i.unique && !i.where && single(i.columnIds));
  return { notNull: c.nullable === false, unique, autoIncrement: c.autoIncrement === true };
}

/** Marker text for a row: crow's foot shows NN only when it is not implied by the PK; physical shows everything. */
function flagText(flags: VRowFlags, role: ColumnRole, mode: VMode, relation: Relation, colId: Id): string {
  const parts: string[] = [];
  const isPk = role === 'pk' || role === 'pk+fk';
  if (flags.notNull && (mode === 'physical' || !isPk)) parts.push('NN');
  const soleKey = isPk && list(relation.primaryKey).length === 1 && list(relation.primaryKey)[0] === colId;
  if (flags.unique && !soleKey) parts.push('UQ');
  if (mode === 'physical' && flags.autoIncrement) parts.push('AI');
  return parts.join(' ');
}

const colName = (rel: Relation | undefined, id: Id): string => list(rel?.columns).find((c) => c?.id === id)?.name ?? '?';
const colList = (rel: Relation | undefined, ids: readonly Id[] | undefined): string => list(ids).map((i) => colName(rel, i)).join(', ');

export function layoutVTable(
  node: DiagramNode,
  relation: Relation,
  model: RelationalModel,
  fkCols: ReadonlySet<Id> | undefined,
  outgoing: readonly ForeignKey[],
  options: DiagramOptions,
  vo: VTableOptions,
  measure: MeasureText,
): VTableLayout {
  return vo.orientation === 'horizontal' && vo.mode === 'crows-foot'
    ? layoutHorizontal(node, relation, fkCols, options, vo, measure)
    : layoutVertical(node, relation, model, fkCols, outgoing, options, vo, measure);
}

interface Prepared {
  c: RelColumn;
  role: ColumnRole;
  name: string;
  flags: VRowFlags;
  flagText: string;
}

function prepare(relation: Relation, fkCols: ReadonlySet<Id> | undefined, vo: VTableOptions): Prepared[] {
  return list(relation.columns)
    .filter((c): c is RelColumn => !!c && typeof c.id === 'string')
    .map((c) => {
      const role = roleOf(relation, fkCols, c.id);
      const flags = flagsOf(relation, c);
      return { c, role, name: str(c.name), flags, flagText: flagText(flags, role, vo.mode, relation, c.id) };
    });
}

const hasUnderline = (role: ColumnRole): boolean => role === 'pk' || role === 'pk+fk';
const isItalic = (role: ColumnRole): boolean => role === 'fk' || role === 'pk+fk';

function layoutVertical(
  node: DiagramNode,
  relation: Relation,
  model: RelationalModel,
  fkCols: ReadonlySet<Id> | undefined,
  outgoing: readonly ForeignKey[],
  options: DiagramOptions,
  vo: VTableOptions,
  measure: MeasureText,
): VTableLayout {
  const { family, size: fs, weight } = typographyOf(node, options);
  const physical = vo.mode === 'physical';
  const lineH = fs * 1.2;
  const small = Math.max(8, Math.round(fs * 0.8));
  const smallH = small * 1.2;
  const strokeWidth = fin(node.style?.strokeWidth, DEFAULT_NODE_STROKE_WIDTH);
  const x0 = fin(node.x, 0);
  const y0 = fin(node.y, 0);

  const nameFont = (role: ColumnRole): FontSpec => ({ family, size: fs, weight, style: isItalic(role) ? 'italic' : 'normal' });
  const headFont: FontSpec = { family, size: fs, weight: 'bold' };
  const badgeFont: FontSpec = { family, size: small, weight: 'bold' };
  const typeFont: FontSpec = { family, size: small };
  const flagFont: FontSpec = { family, size: small, weight: 'bold' };
  const defFont: FontSpec = { family, size: small };

  const cols = prepare(relation, fkCols, vo);
  const rows0 = cols.map((p) => {
    const badge = p.role === 'pk' ? 'PK' : p.role === 'fk' ? 'FK' : p.role === 'pk+fk' ? 'PK FK' : '';
    const typeText = (physical || vo.showTypes) && p.c.dataType ? str(p.c.dataType) : '';
    const flagT = physical || vo.showNullability ? p.flagText : '';
    const dv = physical && p.c.defaultValue !== undefined && str(p.c.defaultValue) !== '' ? fitText(`DEFAULT ${str(p.c.defaultValue)}`, defFont, MAX_DEFAULT_W, measure) : '';
    return {
      p,
      badge,
      typeText,
      flagT,
      dv,
      nameW: measure(p.name, nameFont(p.role)),
      badgeW: badge ? measure(badge, badgeFont) : 0,
      typeW: typeText ? measure(typeText, typeFont) : 0,
      flagW: flagT ? measure(flagT, flagFont) : 0,
      dvW: dv ? measure(dv, defFont) : 0,
    };
  });
  const max = (f: (r: (typeof rows0)[number]) => number): number => Math.ceil(rows0.reduce((a, r) => Math.max(a, f(r)), 0));
  const badgeW = max((r) => r.badgeW);
  const nameW = max((r) => r.nameW);
  const typeW = max((r) => r.typeW);
  const flagW = max((r) => r.flagW);
  const dvW = max((r) => r.dvW);
  const rightCols = [typeW, dvW, flagW].filter((w) => w > 0);
  const leftW = PAD_X + (badgeW > 0 ? badgeW + BADGE_GAP : 0) + nameW;
  const rowNeed = leftW + (rightCols.length > 0 ? COL_GAP + rightCols.reduce((a, b) => a + b, 0) + COL_GAP * (rightCols.length - 1) : 0) + PAD_X;

  const title = physical && str(relation.schemaName) ? `${str(relation.schemaName)}.${str(relation.name)}` : str(relation.name);
  const headW = measure(title, headFont) + 2 * PAD_X;

  // Physical sections (constraints, indexes). Text is ellipsised past MAX_SECTION_TEXT_W so one long CHECK never
  // makes a table absurdly wide; the table is wide enough for what is drawn.
  interface SecLine {
    text: string;
    flag: string;
    refId: Id;
  }
  const constraintLines: SecLine[] = [];
  const indexLines: SecLine[] = [];
  if (physical && vo.showConstraints) {
    for (const u of list(relation.uniques)) if (u && list(u.columnIds).length > 0) constraintLines.push({ text: `UNIQUE (${colList(relation, u.columnIds)})`, flag: '', refId: str(u.id) });
    for (const ck of list(relation.checks)) if (ck) constraintLines.push({ text: `CHECK ${str(ck.expression)}`, flag: '', refId: str(ck.id) });
    const fks = [...outgoing].sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    for (const fk of fks) {
      const target = Object.prototype.hasOwnProperty.call(model.relations ?? {}, fk.targetRelationId) ? model.relations[fk.targetRelationId] : undefined;
      const pairs = list(fk.columns).filter((p) => !!p);
      const actions = [fk.onDelete ? `ON DELETE ${fk.onDelete}` : '', fk.onUpdate ? `ON UPDATE ${fk.onUpdate}` : ''].filter(Boolean).join(' ');
      constraintLines.push({
        text: `FK (${colList(relation, pairs.map((p) => p.sourceColumnId))}) → ${str(target?.name) || '?'}(${colList(target, pairs.map((p) => p.targetColumnId))})`,
        flag: actions,
        refId: str(fk.id),
      });
    }
  }
  if (physical && vo.showIndexes) {
    for (const ix of list(relation.indexes)) {
      if (!ix) continue;
      const desc = new Set(list(ix.descendingColumnIds));
      const cols = list(ix.columnIds).map((id) => `${colName(relation, id)}${desc.has(id) ? ' DESC' : ''}`).join(', ');
      const flag = [ix.unique ? 'UNIQUE' : '', ix.where ? 'partial' : '', str(ix.method)].filter(Boolean).join(' ');
      indexLines.push({ text: `${str(ix.name)} (${cols})`, flag, refId: str(ix.id) });
    }
  }
  const W0 = Math.ceil(Math.max(MIN_TABLE_W, rowNeed, headW, fin(node.width, 0)));
  const sectionsSrc: Array<{ kind: 'constraints' | 'indexes'; lines: SecLine[] }> = [
    { kind: 'constraints' as const, lines: constraintLines },
    { kind: 'indexes' as const, lines: indexLines },
  ].filter((s) => s.lines.length > 0);
  const flagSecFont: FontSpec = { family, size: small };
  const secFont: FontSpec = { family, size: small };
  const prepared = sectionsSrc.map((s) => ({
    kind: s.kind,
    lines: s.lines.map((l) => {
      const flagW2 = l.flag ? measure(l.flag, flagSecFont) : 0;
      const extra = flagW2 > 0 ? flagW2 + COL_GAP : 0;
      const room = Math.max(60, MAX_SECTION_TEXT_W - extra, W0 - 2 * PAD_X - extra);
      const text = fitText(l.text, secFont, room, measure);
      return { ...l, text, textW: measure(text, secFont), flagW: flagW2 };
    }),
  }));
  const secNeed = prepared.reduce(
    (a, s) => Math.max(a, ...s.lines.map((l) => 2 * PAD_X + l.textW + (l.flagW > 0 ? COL_GAP + l.flagW : 0))),
    0,
  );

  const W = Math.ceil(Math.max(MIN_TABLE_W, rowNeed, headW, secNeed, fin(node.width, 0)));
  const headerH = Math.ceil(lineH + 2 * HEADER_PAD_Y);
  const rowH0 = Math.ceil(lineH + 2 * PAD_Y);
  const secLineH = Math.ceil(smallH + 2 * SECTION_PAD_Y);
  const nRows = Math.max(1, rows0.length);
  const secH = prepared.reduce((a, s) => a + s.lines.length * secLineH, 0);
  const minTotal = headerH + nRows * rowH0 + secH;
  const wantH = fin(node.height, 0);
  const rowH = wantH > minTotal ? rowH0 + (wantH - minTotal) / nRows : rowH0;
  const totalH = headerH + nRows * rowH + secH;

  const flagsEnd = x0 + W - PAD_X;
  const flagsStart = flagsEnd - flagW;
  const dvEnd = flagW > 0 ? flagsStart - COL_GAP : flagsEnd;
  const dvStart = dvEnd - dvW;
  const typeEnd = dvW > 0 ? dvStart - COL_GAP : dvEnd;
  const nameX = x0 + PAD_X + (badgeW > 0 ? badgeW + BADGE_GAP : 0);

  const header: Rect = { x: x0, y: y0, w: W, h: headerH };
  const body: Rect = { x: x0, y: y0 + headerH, w: W, h: nRows * rowH };
  const bounds: Rect = { x: x0, y: y0, w: W, h: totalH };

  const nameLabel: TextLabel = { text: title, x: x0 + W / 2, y: y0 + headerH / 2, anchor: 'middle', font: headFont, width: measure(title, headFont) };
  const mk = (text: string, x: number, y: number, anchor: TextLabel['anchor'], font: FontSpec): TextLabel => ({ text, x, y, anchor, font, width: measure(text, font) });

  const rows: VTableRowGeom[] = rows0.map((r, i) => {
    const rect: Rect = { x: x0, y: body.y + i * rowH, w: W, h: rowH };
    const cy = rect.y + rowH / 2;
    const font = nameFont(r.p.role);
    const label = mk(r.p.name, nameX, cy, 'start', font);
    if (hasUnderline(r.p.role)) label.underline = 'solid';
    const row: VTableRowGeom = { columnId: r.p.c.id, rect, label, role: r.p.role, flags: r.p.flags };
    if (r.badge) row.keyLabel = mk(r.badge, x0 + PAD_X, cy, 'start', badgeFont);
    if (r.typeText) row.typeLabel = mk(r.typeText, typeEnd, cy, 'end', typeFont);
    if (r.flagT) row.flagLabel = mk(r.flagT, flagsEnd, cy, 'end', flagFont);
    if (r.dv) row.defaultLabel = mk(r.dv, dvStart, cy, 'start', defFont);
    return row;
  });

  let sy = body.y + body.h;
  const sections: VTableSectionGeom[] = prepared.map((s) => {
    const rect: Rect = { x: x0, y: sy, w: W, h: s.lines.length * secLineH };
    const lines: VSectionLineGeom[] = s.lines.map((l, i) => {
      const lr: Rect = { x: x0, y: sy + i * secLineH, w: W, h: secLineH };
      const line: VSectionLineGeom = { rect: lr, label: mk(l.text, x0 + PAD_X, lr.y + secLineH / 2, 'start', secFont), refId: l.refId };
      if (l.flag) line.flagLabel = mk(l.flag, x0 + W - PAD_X, lr.y + secLineH / 2, 'end', flagSecFont);
      return line;
    });
    sy += rect.h;
    return { kind: s.kind, rect, lines };
  });

  const labels = [nameLabel, ...rows.flatMap((r) => [r.label, r.keyLabel, r.typeLabel, r.flagLabel, r.defaultLabel].filter((l): l is TextLabel => !!l))];
  const paint = unionRects([paintRect(bounds, strokeWidth + 0.5), ...labels.map(labelRect)])!;
  const geom: VTableGeom = {
    kind: 'v-table',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paint,
    outline: { kind: 'rect', rect: bounds },
    orientation: 'vertical',
    mode: vo.mode,
    nameLabel,
    header,
    body,
    rows,
    sections,
  };
  return { geom, nameRect: { x: x0, y: y0, w: W, h: headerH }, strokeWidth };
}

function layoutHorizontal(
  node: DiagramNode,
  relation: Relation,
  fkCols: ReadonlySet<Id> | undefined,
  options: DiagramOptions,
  vo: VTableOptions,
  measure: MeasureText,
): VTableLayout {
  const { family, size: fs, weight } = typographyOf(node, options);
  const lineH = fs * 1.2;
  const small = Math.max(8, Math.round(fs * 0.8));
  const smallH = small * 1.2;
  const strokeWidth = fin(node.style?.strokeWidth, DEFAULT_NODE_STROKE_WIDTH);
  const x0 = fin(node.x, 0);
  const y0 = fin(node.y, 0);
  const detailFont: FontSpec = { family, size: small };

  const cols = prepare(relation, fkCols, vo).map((p) => {
    const detail = [vo.showTypes && p.c.dataType ? str(p.c.dataType) : '', vo.showNullability ? p.flagText : ''].filter(Boolean).join('  ');
    return { ...p, detail };
  });
  const twoLine = cols.some((c) => c.detail !== '');
  const rowH = Math.max(fin(node.height, 0), Math.ceil(2 * PAD_Y + lineH + (twoLine ? smallH : 0)));
  const fontFor = (role: ColumnRole): FontSpec => ({ family, size: fs, weight, style: isItalic(role) ? 'italic' : 'normal' });
  const fits = cols.map((c) => Math.ceil(Math.max(measure(c.name, fontFor(c.role)), c.detail ? measure(c.detail, detailFont) : 0) + 2 * CELL_PAD_X));
  const widths = cols.map((c, i) => {
    const o = node.columnWidths?.[c.c.id];
    return typeof o === 'number' && Number.isFinite(o) ? Math.max(o, fits[i]!) : Math.max(fits[i]!, MIN_CELL_W);
  });
  const nodeW = fin(node.width, 0);
  if (nodeW > 0) {
    const total = widths.reduce((a, b) => a + b, 0);
    const free = cols.map((c) => !(typeof node.columnWidths?.[c.c.id] === 'number'));
    const freeTotal = widths.reduce((a, w, i) => a + (free[i] ? w : 0), 0);
    if (nodeW > total && freeTotal > 0) {
      const surplus = nodeW - total;
      widths.forEach((w, i) => {
        if (free[i]) widths[i] = w + (surplus * w) / freeTotal;
      });
    }
  }
  const rowW = cols.length === 0 ? Math.max(nodeW, 80) : widths.reduce((a, b) => a + b, 0);
  const nameFont: FontSpec = { family, size: fs, weight: 'bold' };
  const title = str(relation.name);
  const nameW = measure(title, nameFont);
  const nameRect: Rect = { x: x0, y: y0, w: nameW, h: lineH };
  const row: Rect = { x: x0, y: y0 + lineH + NAME_GAP_ABOVE, w: rowW, h: rowH };
  const bounds: Rect = { x: x0, y: y0, w: Math.max(rowW, nameW), h: row.y + rowH - y0 };
  const nameLabel: TextLabel = { text: title, x: x0, y: y0 + lineH / 2, anchor: 'start', font: nameFont, width: nameW };

  let cx = row.x;
  const rows: VTableRowGeom[] = cols.map((c, i) => {
    const rect: Rect = { x: cx, y: row.y, w: widths[i]!, h: rowH };
    cx += widths[i]!;
    const font = fontFor(c.role);
    const blockH = lineH + (twoLine ? smallH : 0);
    const top = rect.y + (rowH - blockH) / 2;
    const label: TextLabel = { text: c.name, x: rect.x + rect.w / 2, y: top + lineH / 2, anchor: 'middle', font, width: measure(c.name, font) };
    if (hasUnderline(c.role)) label.underline = 'solid';
    const r: VTableRowGeom = { columnId: c.c.id, rect, label, role: c.role, flags: c.flags };
    if (c.detail) r.detailLabel = { text: c.detail, x: rect.x + rect.w / 2, y: top + lineH + smallH / 2, anchor: 'middle', font: detailFont, width: measure(c.detail, detailFont) };
    return r;
  });
  const labels = [nameLabel, ...rows.flatMap((r) => [r.label, r.detailLabel].filter((l): l is TextLabel => !!l))];
  const paint = unionRects([paintRect(bounds, strokeWidth), inflateRect(row, strokeWidth / 2 + 1.25), ...labels.map(labelRect)])!;
  const geom: VTableGeom = {
    kind: 'v-table',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paint,
    outline: { kind: 'rect', rect: bounds },
    orientation: 'horizontal',
    mode: 'crows-foot',
    nameLabel,
    header: nameRect,
    body: row,
    rows,
    sections: [],
  };
  return { geom, nameRect, strokeWidth };
}
