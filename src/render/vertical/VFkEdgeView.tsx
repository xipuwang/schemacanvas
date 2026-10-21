import { DEFAULT_FK_STROKE_WIDTH } from '@/scene/vertical/constants';
import type { VSymbolGeom } from '@/scene/vertical/types';
import type { EdgeViewProps } from '../types';

const toPoints = (pts: Array<{ x: number; y: number }>): string => pts.map((q) => `${q.x},${q.y}`).join(' ');
const DASH = { solid: undefined, dashed: '7 4', dotted: '2 3' } as const;

function Symbol({ sym, role, stroke, width }: { sym: VSymbolGeom; role: 'parent' | 'child'; stroke: string; width: number }) {
  return (
    <g data-symbol={`${role}:${sym.kind}`} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="butt" strokeLinejoin="miter">
      {sym.lines.map((l, i) => (
        <polyline key={i} points={toPoints(l)} />
      ))}
      {sym.circles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
    </g>
  );
}

/**
 * A foreign-key connector with crow's foot end symbols: the connector is stroked between the two symbol bases, the
 * symbols are explicit lines/circles. `data-fk-branch` / `data-fk-target` = the attached column pair (the first pair of
 * a composite FK), `data-fk-pairs` = every pair `source>target`, `data-fk-member` marks the dots of the other columns.
 */
export function VFkEdgeView({ geom, edge, ctx }: EdgeViewProps) {
  if (geom.kind !== 'v-fk') return null;
  const p = ctx.palette;
  const refKey = `foreignKey:${geom.ref.kind === 'foreignKey' ? geom.ref.foreignKeyId : ''}`;
  const severity = ctx.highlightsByRef?.[refKey];
  const selected = ctx.selectedRefs?.has(refKey) ?? false;
  const stroke = severity ? p[severity] : selected ? p.accent : (edge.style?.stroke ?? p.stroke);
  const baseWidth = edge.style?.strokeWidth ?? DEFAULT_FK_STROKE_WIDTH;
  const width = selected || severity ? baseWidth + 0.6 : baseWidth;
  const dash = DASH[edge.style?.dash ?? 'solid'];
  return (
    <g
      data-fk-branch={geom.sourceColumnId}
      data-fk-target={geom.targetColumnId}
      data-fk-pairs={geom.pairs.map((q) => `${q.sourceColumnId}>${q.targetColumnId}`).join(',')}
      data-fk-composite={geom.composite ? 'true' : undefined}
      fill="none"
    >
      <polyline points={toPoints(geom.strokePoints)} stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="butt" />
      <Symbol sym={geom.childSymbol} role="child" stroke={stroke} width={width} />
      <Symbol sym={geom.parentSymbol} role="parent" stroke={stroke} width={width} />
      {geom.memberLinks.map((l, i) => (
        <polyline key={`ml${i}`} points={toPoints(l)} stroke={stroke} strokeWidth={Math.max(0.8, width * 0.7)} />
      ))}
      {geom.memberMarks.map((m) => (
        <circle key={`${m.end}:${m.columnId}`} data-fk-member={m.columnId} cx={m.at.x} cy={m.at.y} r={m.r} fill={stroke} stroke="none" />
      ))}
    </g>
  );
}
