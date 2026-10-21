/**
 * Pixel-sized overlay glyphs. The overlay lives in WORLD coordinates, so every glyph is drawn inside a group that is
 * translated to the world point and scaled by 1/zoom: sizes and stroke widths are then exact screen pixels at any zoom.
 */
import type { ReactNode } from 'react';
import type { Point } from '@/model/types';
import type { Palette } from '@/render/palette';

export type GlyphKind = 'resize' | 'bend' | 'mid' | 'end' | 'col-border' | 'row-height' | 'table-width';

interface GlyphProps {
  at: Point;
  zoom: number;
  palette: Palette;
  kind: GlyphKind;
  active?: boolean;
  /** Extra data-attributes for e2e (handle id). */
  id?: string;
}

export function Glyph({ at, zoom, palette, kind, active, id }: GlyphProps): ReactNode {
  const fill = active ? palette.accent : palette.surface;
  const common = { stroke: palette.accent, strokeWidth: 1.5, fill };
  let shape: ReactNode;
  switch (kind) {
    case 'resize':
      shape = <rect x={-4} y={-4} width={8} height={8} rx={1} {...common} />;
      break;
    case 'bend':
      shape = <circle r={5} fill={palette.accent} stroke={palette.surface} strokeWidth={1.5} />;
      break;
    case 'mid':
      shape = <circle r={3.5} {...common} strokeWidth={1.25} />;
      break;
    case 'end':
      shape = <path d="M0 -6.5 L6.5 0 L0 6.5 L-6.5 0 Z" {...common} strokeWidth={2} />;
      break;
    case 'col-border':
      shape = <rect x={-2.5} y={-9} width={5} height={18} rx={2.5} {...common} />;
      break;
    case 'row-height':
      shape = <rect x={-14} y={-2.5} width={28} height={5} rx={2.5} {...common} />;
      break;
    case 'table-width':
      shape = <rect x={-2.5} y={-12} width={5} height={24} rx={2.5} {...common} />;
      break;
  }
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${1 / zoom})`} pointerEvents="none" data-handle={id} data-handle-kind={kind}>
      {shape}
    </g>
  );
}

/** A pill of text (live size read-out) placed beside `at`. */
export function Readout({ at, zoom, palette, text }: { at: Point; zoom: number; palette: Palette; text: string }): ReactNode {
  const w = Math.max(36, text.length * 6.6 + 14);
  return (
    <g transform={`translate(${at.x + 14 / zoom} ${at.y + 16 / zoom}) scale(${1 / zoom})`} pointerEvents="none" data-overlay="readout">
      <rect x={0} y={-11} width={w} height={22} rx={4} fill={palette.accent} />
      <text x={w / 2} y={4} textAnchor="middle" fontSize={12} fontFamily="system-ui, sans-serif" fill={palette.background} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </text>
    </g>
  );
}
