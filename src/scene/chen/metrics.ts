/** Shared Chen constants and font helpers. Leaf module: imported by the scene builder AND the SVG views. */
import type { FontSpec } from '../base';
import type { Diagram, NodeStyle } from '@/model/types';

export const DEFAULT_NODE_STROKE = 1.5;
export const DEFAULT_EDGE_STROKE = 1.5;
/** Distance between the outer and inner outline of double shapes (weak entity, multivalued attribute, identifying relationship). */
export const DOUBLE_INSET = 4;
/** Distance between the two rails of a total-participation line. */
export const RAIL_GAP = 4;

export const nodeStrokeWidth = (style?: NodeStyle): number => style?.strokeWidth ?? DEFAULT_NODE_STROKE;

/** Font of a node's main label: diagram typography overridden by the node style. */
export function nodeFont(diagram: Diagram, style?: NodeStyle): FontSpec {
  const font: FontSpec = {
    family: style?.fontFamily ?? diagram.options.typography.fontFamily,
    size: style?.fontSize ?? diagram.options.typography.fontSize,
  };
  if (style?.fontWeight) font.weight = style.fontWeight;
  if (style?.fontStyle) font.style = style.fontStyle;
  return font;
}

/** Clear gap kept between the two strokes of every double line, whatever the stroke width. */
const DOUBLE_CLEAR_GAP = 2.5;
/** Distance between the outer and inner outline of a double shape drawn with stroke width `sw` (never merges the strokes). */
export const doubleInset = (sw: number): number => Math.max(DOUBLE_INSET, sw + DOUBLE_CLEAR_GAP);
/** Distance between the two rails of a total-participation line drawn with stroke width `sw`. */
export const railGap = (sw: number): number => Math.max(RAIL_GAP, sw + DOUBLE_CLEAR_GAP);
