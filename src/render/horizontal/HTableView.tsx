import { DEFAULT_NODE_STROKE_WIDTH } from '@/scene/horizontal/constants';
import { SvgLabel } from '../svgText';
import type { NodeViewProps } from '../types';

/**
 * One horizontal table. Role cues (must survive grayscale printing): PK = solid underline (drawn by the label) + key
 * tint; FK = italic (set by the scene's font) + FK tint; PK+FK = underline AND italic with a diagonal two-tone cell;
 * plain = regular on the surface colour. Cells carry `data-column-id` (the editor and Playwright address cells by it).
 */
export function HTableView({ geom, node, ctx }: NodeViewProps) {
  if (geom.kind !== 'h-table') return null;
  const p = ctx.palette;
  const stroke = node.style?.stroke ?? p.stroke;
  const sw = node.style?.strokeWidth ?? DEFAULT_NODE_STROKE_WIDTH;
  const textColor = node.style?.textColor ?? p.text;
  const { row } = geom;
  return (
    <g data-relation-id={geom.ref.id}>
      <SvgLabel label={geom.nameLabel} color={textColor} />
      {geom.cells.map((cell) => {
        const r = cell.rect;
        const refKey = `column:${cell.columnId}`;
        const selected = ctx.selectedRefs?.has(refKey) ?? false;
        const severity = ctx.highlightsByRef?.[refKey];
        const plainFill = node.style?.fill ?? p.surface;
        return (
          <g key={cell.columnId} data-column-id={cell.columnId} data-role={cell.role}>
            {cell.role === 'pk+fk' ? (
              <>
                <polygon points={`${r.x},${r.y} ${r.x + r.w},${r.y} ${r.x},${r.y + r.h}`} fill={p.keyTint} />
                <polygon points={`${r.x + r.w},${r.y} ${r.x + r.w},${r.y + r.h} ${r.x},${r.y + r.h}`} fill={p.fkTint} />
              </>
            ) : (
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={cell.role === 'pk' ? p.keyTint : cell.role === 'fk' ? p.fkTint : plainFill} />
            )}
            {severity && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={p[severity]} fillOpacity={0.22} />}
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={stroke} strokeWidth={sw} />
            <SvgLabel label={cell.label} color={textColor} />
            {cell.typeLabel && <SvgLabel label={cell.typeLabel} color={p.textMuted} />}
            {selected && (
              <rect x={r.x + 1.5} y={r.y + 1.5} width={r.w - 3} height={r.h - 3} fill="none" stroke={p.accent} strokeWidth={2} />
            )}
          </g>
        );
      })}
      {geom.cells.length === 0 && <rect x={row.x} y={row.y} width={row.w} height={row.h} fill={p.surface} stroke={stroke} strokeWidth={sw} strokeDasharray="4 3" />}
      {/* a slightly heavier outer border makes the row read as ONE relation */}
      <rect x={row.x} y={row.y} width={row.w} height={row.h} fill="none" stroke={stroke} strokeWidth={sw + 0.5} />
    </g>
  );
}
