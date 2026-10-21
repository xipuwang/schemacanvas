/**
 * Chen node geometry: text-fitted entity / attribute / relationship shapes.
 *
 * Sizing rules (all in world units):
 *  - the auto size is max(cosmetic minimum, text fit); a manual `node.width/height` (size of the OUTER outline) is
 *    clamped only to the text fit, so users may shrink a node below the cosmetic minimum but never clip its text;
 *  - ellipse text fit: the text box corners lie ON the ellipse when a = w'/2·√2, b = h'/2·√2;
 *  - diamond text fit: the text box fits when w'/W + h'/H <= 1 (checked against the INNER diamond for double shapes).
 *  - `bounds` = outer outline box (no stroke), `bounds.x/y === node.x/y` always.
 */
import type { DiagramNode, ErAttribute, ErEntity, ErRelationship } from '@/model/types';
import type { FontSpec, MeasureText, Rect, TextLabel } from '../base';
import { inflateRect, paintRect, rectCenter, unionRects, labelRect } from '../geometry';
import type { ChenAttributeGeom, ChenEntityGeom, ChenRelationshipGeom } from './types';
import { doubleInset, nodeStrokeWidth } from './metrics';

const SQRT2 = Math.SQRT2;
const LINE_FACTOR = 1.25;
const TYPE_SCALE = 0.8;

interface TextBlock {
  w: number;
  h: number;
  /** Vertical offset of the name line centre / type line centre relative to the block centre. */
  nameDy: number;
  typeDy: number;
  typeFont?: FontSpec;
}

function textBlock(measure: MeasureText, font: FontSpec, name: string, typeText?: string): TextBlock {
  const nameH = font.size * LINE_FACTOR;
  const nameW = measure(name, font);
  if (!typeText) return { w: nameW, h: nameH, nameDy: 0, typeDy: 0 };
  const typeFont: FontSpec = { ...font, size: font.size * TYPE_SCALE, weight: 'normal' };
  const typeH = typeFont.size * LINE_FACTOR;
  const h = nameH + typeH;
  return {
    w: Math.max(nameW, measure(typeText, typeFont)),
    h,
    nameDy: -h / 2 + nameH / 2,
    typeDy: h / 2 - typeH / 2,
    typeFont,
  };
}

function makeLabel(text: string, cx: number, cy: number, font: FontSpec, measure: MeasureText, color?: string): TextLabel {
  const label: TextLabel = { text, x: cx, y: cy, anchor: 'middle', font, width: measure(text, font) };
  if (color) label.color = color;
  return label;
}

const clampOverride = (override: number | undefined, fit: number, auto: number): number =>
  override === undefined ? auto : Math.max(override, fit);

// ----- diamond fit ---------------------------------------------------------

const DIAMOND_RATIO = 0.6; // H / W of an auto-sized diamond

/** Half-axes of the diamond that is `inset` (perpendicular distance) inside the diamond with half-axes a, b. */
export function innerDiamondRect(outer: Rect, inset: number): Rect {
  const a = outer.w / 2;
  const b = outer.h / 2;
  const dist = 1 / Math.sqrt(1 / (a * a) + 1 / (b * b)); // origin → edge distance
  const s = Math.max(0.05, 1 - inset / dist);
  const c = rectCenter(outer);
  return { x: c.x - a * s, y: c.y - b * s, w: 2 * a * s, h: 2 * b * s };
}

/** Does a text box of size tw × th (centred) fit inside a diamond of size w × h? */
const fitsDiamond = (tw: number, th: number, w: number, h: number): boolean => tw / w + th / h <= 1 + 1e-9;

/** Smallest auto diamond (aspect DIAMOND_RATIO) whose INNER diamond (inset `inset`, 0 = single) contains the text box. */
function fitDiamond(tw: number, th: number, inset: number): { w: number; h: number } {
  let w = tw + th / DIAMOND_RATIO;
  for (let i = 0; i < 400; i++) {
    const h = w * DIAMOND_RATIO;
    const inner = inset > 0 ? innerDiamondRect({ x: 0, y: 0, w, h }, inset) : { w, h };
    if (fitsDiamond(tw, th, inner.w, inner.h)) return { w, h };
    w += 2;
  }
  return { w, h: w * DIAMOND_RATIO };
}

// ----- entity ---------------------------------------------------------------

export function entityGeom(
  node: DiagramNode,
  entity: ErEntity,
  font: FontSpec,
  measure: MeasureText,
  textColor: string | undefined,
): ChenEntityGeom {
  const sw = nodeStrokeWidth(node.style);
  const weak = entity.weak && !entity.associativeOf; // an associative entity is never weak (types.ts)
  const associative = !!entity.associativeOf;
  const block = textBlock(measure, font, entity.name);
  let w: number;
  let h: number;
  if (associative) {
    const d = fitDiamond(block.w + 12, block.h + 8, 0);
    const margin = 8;
    const fitW = d.w + 2 * margin;
    const fitH = d.h + 2 * margin;
    w = clampOverride(node.width, fitW, Math.max(120, fitW));
    h = clampOverride(node.height, fitH, Math.max(76, fitH));
  } else {
    const inset = weak ? doubleInset(sw) : 0;
    const fitW = block.w + 2 * 12 + 2 * inset;
    const fitH = block.h + 2 * 8 + 2 * inset;
    w = clampOverride(node.width, fitW, Math.max(100, fitW));
    h = clampOverride(node.height, fitH, Math.max(50, fitH));
  }
  const bounds: Rect = { x: node.x, y: node.y, w, h };
  const c = rectCenter(bounds);
  const label = makeLabel(entity.name, c.x, c.y, font, measure, textColor);
  const geom: ChenEntityGeom = {
    kind: 'chen-entity',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paintRect(bounds, sw),
    outline: { kind: 'rect', rect: bounds },
    weak,
    associative,
    label,
  };
  if (weak) geom.innerRect = inflateRect(bounds, -doubleInset(sw));
  if (associative) geom.innerDiamond = inflateRect(bounds, -8);
  geom.paintBounds = unionRects([geom.paintBounds, labelRect(label)])!;
  return geom;
}

// ----- attribute -------------------------------------------------------------

export function attributeGeom(
  node: DiagramNode,
  attr: ErAttribute,
  font: FontSpec,
  measure: MeasureText,
  textColor: string | undefined,
  showDataTypes: boolean,
): ChenAttributeGeom {
  const sw = nodeStrokeWidth(node.style);
  const typeText = showDataTypes && attr.dataType?.trim() ? attr.dataType.trim() : undefined;
  const block = textBlock(measure, font, attr.name, typeText);
  const inset = attr.multivalued ? 2 * doubleInset(sw) : 0;
  const fitW = (block.w + 2 * 6) * SQRT2 + inset;
  const fitH = (block.h + 2 * 3) * SQRT2 + inset;
  const w = clampOverride(node.width, fitW, Math.max(80, fitW));
  const h = clampOverride(node.height, fitH, Math.max(40, fitH));
  const bounds: Rect = { x: node.x, y: node.y, w, h };
  const c = rectCenter(bounds);
  const label = makeLabel(attr.name, c.x, c.y + block.nameDy, font, measure, textColor);
  if (attr.key === 'primary') label.underline = 'solid';
  else if (attr.key === 'partial') label.underline = 'dashed';
  const geom: ChenAttributeGeom = {
    kind: 'chen-attribute',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paintRect(bounds, sw),
    outline: { kind: 'ellipse', rect: bounds },
    multivalued: attr.multivalued,
    derived: attr.derived,
    dashed: attr.derived,
    label,
  };
  if (attr.multivalued) geom.innerEllipse = inflateRect(bounds, -doubleInset(sw));
  const parts = [geom.paintBounds, labelRect(label)];
  if (typeText && block.typeFont) {
    const typeLabel = makeLabel(typeText, c.x, c.y + block.typeDy, block.typeFont, measure, textColor);
    geom.typeLabel = typeLabel;
    parts.push(labelRect(typeLabel));
  }
  geom.paintBounds = unionRects(parts)!;
  return geom;
}

// ----- relationship ------------------------------------------------------------

export function relationshipGeom(
  node: DiagramNode,
  rel: ErRelationship,
  font: FontSpec,
  measure: MeasureText,
  textColor: string | undefined,
): ChenRelationshipGeom {
  const sw = nodeStrokeWidth(node.style);
  const block = textBlock(measure, font, rel.name);
  const d = fitDiamond(block.w + 12, block.h + 8, rel.identifying ? doubleInset(sw) : 0);
  const w = clampOverride(node.width, d.w, Math.max(110, d.w));
  const h = clampOverride(node.height, d.h, Math.max(66, Math.max(d.h, w * DIAMOND_RATIO)));
  const bounds: Rect = { x: node.x, y: node.y, w, h };
  const c = rectCenter(bounds);
  const label = makeLabel(rel.name, c.x, c.y, font, measure, textColor);
  const geom: ChenRelationshipGeom = {
    kind: 'chen-relationship',
    nodeId: node.id,
    ref: node.ref,
    bounds,
    paintBounds: paintRect(bounds, sw),
    outline: { kind: 'diamond', rect: bounds },
    identifying: rel.identifying,
    label,
  };
  if (rel.identifying) geom.innerDiamond = innerDiamondRect(bounds, doubleInset(sw));
  geom.paintBounds = unionRects([geom.paintBounds, labelRect(label)])!;
  return geom;
}
