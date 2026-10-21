import type { Rect } from '@/scene/base';
import { DEFAULT_NODE_STROKE_WIDTH } from '@/scene/vertical/constants';
import type { VTableRowGeom } from '@/scene/vertical/types';
import type { Palette } from '../palette';
import { SvgLabel } from '../svgText';
import type { NodeViewProps } from '../types';

function RoleFill({ rect, role, plain, p }: { rect: Rect; role: VTableRowGeom['role']; plain: string; p: Palette }) {
  const r = rect;
  if (role === 'pk+fk') {
    // Diagonal two-tone: the same encoding as the horizontal schema's PK+FK cell.
    return (
      <>
        <polygon points={`${r.x},${r.y} ${r.x + r.w},${r.y} ${r.x},${r.y + r.h}`} fill={p.keyTint} />
        <polygon points={`${r.x + r.w},${r.y} ${r.x + r.w},${r.y + r.h} ${r.x},${r.y + r.h}`} fill={p.fkTint} />
      </>
    );
  }
  return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={role === 'pk' ? p.keyTint : role === 'fk' ? p.fkTint : plain} />;
}

/**
 * A crow's foot / physical table. Role cues survive grayscale printing: PK = underlined name + `PK` badge (+ key
 * tint); FK = italic name + `FK` badge (+ FK tint); PK+FK = both, with a diagonal two-tone row. Rows (cells in the
 * single-row orientation) carry `data-column-id` / `data-role` so the editor and Playwright address them by column.
 */
export function VTableView({ geom, node, ctx }: NodeViewProps) {
  if (geom.kind !== 'v-table') return null;
  const p = ctx.palette;
  const stroke = node.style?.stroke ?? p.stroke;
  const sw = node.style?.strokeWidth ?? DEFAULT_NODE_STROKE_WIDTH;
  const textColor = node.style?.textColor ?? p.text;
  const plainFill = node.style?.fill ?? p.surface;
  const horizontal = geom.orientation === 'horizontal';
  const { body, header, bounds } = geom;
  const hair = { stroke, strokeWidth: 0.75, strokeOpacity: 0.4 } as const;

  const rowsView = geom.rows.map((row) => {
    const r = row.rect;
    const refKey = `column:${row.columnId}`;
    const selected = ctx.selectedRefs?.has(refKey) ?? false;
    const severity = ctx.highlightsByRef?.[refKey];
    return (
      <g key={row.columnId} data-column-id={row.columnId} data-role={row.role}>
        <RoleFill rect={r} role={row.role} plain={plainFill} p={p} />
        {severity && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={p[severity]} fillOpacity={0.22} />}
        {horizontal && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={stroke} strokeWidth={sw} />}
        {row.keyLabel && <SvgLabel label={row.keyLabel} color={textColor} />}
        <SvgLabel label={row.label} color={textColor} />
        {row.typeLabel && <SvgLabel label={row.typeLabel} color={p.textMuted} />}
        {row.defaultLabel && <SvgLabel label={row.defaultLabel} color={p.textMuted} />}
        {row.flagLabel && <SvgLabel label={row.flagLabel} color={textColor} />}
        {row.detailLabel && <SvgLabel label={row.detailLabel} color={p.textMuted} />}
        {selected && <rect x={r.x + 1.5} y={r.y + 1.5} width={r.w - 3} height={r.h - 3} fill="none" stroke={p.accent} strokeWidth={2} />}
      </g>
    );
  });

  if (horizontal) {
    return (
      <g data-relation-id={geom.ref.id} data-orientation="horizontal">
        <SvgLabel label={geom.nameLabel} color={textColor} />
        {rowsView}
        {geom.rows.length === 0 && <rect x={body.x} y={body.y} width={body.w} height={body.h} fill={plainFill} stroke={stroke} strokeWidth={sw} strokeDasharray="4 3" />}
        <rect x={body.x} y={body.y} width={body.w} height={body.h} fill="none" stroke={stroke} strokeWidth={sw + 0.5} />
      </g>
    );
  }

  return (
    <g data-relation-id={geom.ref.id} data-orientation="vertical" data-mode={geom.mode}>
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill={plainFill} />
      <rect x={header.x} y={header.y} width={header.w} height={header.h} fill={p.gridMajor} />
      <SvgLabel label={geom.nameLabel} color={textColor} />
      {rowsView}
      {geom.rows.length === 0 && <rect x={body.x} y={body.y} width={body.w} height={body.h} fill="none" stroke={stroke} strokeWidth={0.75} strokeDasharray="4 3" />}
      {/* hairlines between the rows (not after the last row of a section-less table: the border does that) */}
      {geom.rows.slice(1).map((row) => (
        <line key={`l:${row.columnId}`} x1={row.rect.x} y1={row.rect.y} x2={row.rect.x + row.rect.w} y2={row.rect.y} {...hair} />
      ))}
      {geom.sections.map((s) => (
        <g key={s.kind} data-section={s.kind}>
          <line x1={s.rect.x} y1={s.rect.y} x2={s.rect.x + s.rect.w} y2={s.rect.y} stroke={stroke} strokeWidth={sw} />
          {s.lines.map((l, i) => (
            <g key={l.refId + i} data-ref-id={l.refId}>
              {i > 0 && <line x1={l.rect.x} y1={l.rect.y} x2={l.rect.x + l.rect.w} y2={l.rect.y} {...hair} />}
              <SvgLabel label={l.label} color={textColor} />
              {l.flagLabel && <SvgLabel label={l.flagLabel} color={p.textMuted} />}
            </g>
          ))}
        </g>
      ))}
      <line x1={header.x} y1={header.y + header.h} x2={header.x + header.w} y2={header.y + header.h} stroke={stroke} strokeWidth={sw} />
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="none" stroke={stroke} strokeWidth={sw + 0.5} />
    </g>
  );
}
