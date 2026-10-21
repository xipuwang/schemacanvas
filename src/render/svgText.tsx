import type { TextLabel } from '@/scene/base';
import { labelRect } from '@/scene/geometry';

/** Baseline y for a line of text whose vertical centre is `cy` (Helvetica cap-height centring). */
export const baselineY = (cy: number, fontSize: number): number => cy + fontSize * 0.35;

/**
 * Draws a resolved `TextLabel`. Underlines (key = solid, partial key = dashed) are explicit
 * <line> elements — `text-decoration` is not portable to PDF/PNG pipelines. Never use
 * `dominant-baseline`: svg2pdf and several rasterisers ignore it. Kerning is disabled and spaces preserved so the
 * painted width equals the AFM-measured `label.width` (the underline must match the text).
 */
export function SvgLabel({
  label,
  color,
  dy = 0,
  backdropColor,
}: {
  label: TextLabel;
  color: string;
  dy?: number;
  /** Fill for `label.backdrop` plates (the palette background). */
  backdropColor?: string;
}) {
  const { text, x, y, anchor, font, width, underline } = label;
  const fill = label.color ?? color;
  const base = baselineY(y, font.size) + dy;
  let x1 = x;
  if (anchor === 'middle') x1 = x - width / 2;
  else if (anchor === 'end') x1 = x - width;
  const uy = base + Math.max(1.5, font.size * 0.12);
  const plate = label.backdrop && backdropColor ? labelRect(label) : undefined;
  return (
    <g>
      {plate && <rect x={plate.x} y={plate.y} width={plate.w} height={plate.h} rx={2} fill={backdropColor} fillOpacity={0.88} />}
      <text
        x={x}
        y={base}
        textAnchor={anchor}
        fontFamily={font.family}
        fontSize={font.size}
        fontWeight={font.weight === 'bold' ? 700 : 400}
        fontStyle={font.style === 'italic' ? 'italic' : 'normal'}
        fill={fill}
        xmlSpace="preserve"
        style={{ fontKerning: 'none', whiteSpace: 'pre' }}
      >
        {text}
      </text>
      {underline && (
        <line
          x1={x1}
          y1={uy}
          x2={x1 + width}
          y2={uy}
          stroke={fill}
          strokeWidth={Math.max(1, font.size / 14)}
          strokeDasharray={underline === 'dashed' ? `${Math.max(3, font.size / 4)} ${Math.max(2, font.size / 6)}` : undefined}
        />
      )}
    </g>
  );
}
