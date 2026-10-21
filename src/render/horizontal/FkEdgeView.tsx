import { DEFAULT_FK_STROKE_WIDTH } from '@/scene/horizontal/constants';
import type { FkBranchGeom } from '@/scene/horizontal/types';
import { baselineY } from '../svgText';
import type { EdgeViewProps } from '../types';

const toPoints = (pts: Array<{ x: number; y: number }>): string => pts.map((q) => `${q.x},${q.y}`).join(' ');
const DASH = { solid: undefined, dashed: '7 4', dotted: '2 3' } as const;

/** Number of pairs whose left-to-right order differs between the source side and the target side. */
function crossingPairs(branches: FkBranchGeom[]): boolean {
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const a = branches[i]!;
      const b = branches[j]!;
      const s = a.sourceCell.x - b.sourceCell.x;
      const t = a.targetCell.x - b.targetCell.x;
      if (s * t < 0) return true;
    }
  }
  return false;
}

/**
 * An FK connector: stroked polylines ending at `arrow.base` plus a filled arrowhead polygon whose tip is the exact
 * referenced cell. `data-fk-branch` = source column id, `data-fk-target` = the referenced column id, so tests and the
 * editor can verify the pairing from the DOM. When a composite FK's pairs cross, small pair numbers disambiguate them.
 */
export function FkEdgeView({ geom, edge, ctx }: EdgeViewProps) {
  if (geom.kind !== 'fk') return null;
  const p = ctx.palette;
  const refKey = `foreignKey:${geom.ref.kind === 'foreignKey' ? geom.ref.foreignKeyId : ''}`;
  const severity = ctx.highlightsByRef?.[refKey];
  const selected = ctx.selectedRefs?.has(refKey) ?? false;
  const stroke = severity ? p[severity] : selected ? p.accent : edge.style?.stroke ?? p.stroke;
  const baseWidth = edge.style?.strokeWidth ?? DEFAULT_FK_STROKE_WIDTH;
  const width = selected || severity ? baseWidth + 0.6 : baseWidth;
  const dash = DASH[edge.style?.dash ?? 'solid'];
  const numbered = geom.style === 'branches' && geom.branches.length > 1 && crossingPairs(geom.branches);
  return (
    <g data-fk-style={geom.style} fill="none">
      {geom.brackets && (
        <>
          <polyline points={toPoints(geom.brackets.source)} stroke={stroke} strokeWidth={width} strokeLinejoin="miter" />
          <polyline points={toPoints(geom.brackets.target)} stroke={stroke} strokeWidth={width} strokeLinejoin="miter" />
        </>
      )}
      {geom.branches.map((b, i) => (
        <g key={`${b.sourceColumnId}:${i}`} data-fk-branch={b.sourceColumnId} data-fk-target={b.targetColumnId}>
          <polyline
            points={toPoints(b.strokePoints)}
            stroke={stroke}
            strokeWidth={width}
            strokeDasharray={dash}
            strokeLinejoin="round"
            strokeLinecap="butt"
          />
          <polygon points={toPoints(b.arrow.polygon)} fill={stroke} stroke={stroke} strokeWidth={0.5} strokeLinejoin="miter" />
          {numbered && <PairNumber text={String(i + 1)} at={b.points[1]!} from={b.points[0]!} color={stroke} bg={p.background} />}
          {numbered && (
            <PairNumber text={String(i + 1)} at={b.points[b.points.length - 2]!} from={b.arrow.base} color={stroke} bg={p.background} />
          )}
        </g>
      ))}
    </g>
  );
}

/** A tiny circled pair index placed beside a segment's midpoint. */
function PairNumber({ text, at, from, color, bg }: { text: string; at: { x: number; y: number }; from: { x: number; y: number }; color: string; bg: string }) {
  const cx = (at.x + from.x) / 2 + 8;
  const cy = (at.y + from.y) / 2;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={bg} stroke={color} strokeWidth={1} />
      <text
        x={cx}
        y={baselineY(cy, 9)}
        textAnchor="middle"
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={9}
        fill={color}
        stroke="none"
      >
        {text}
      </text>
    </g>
  );
}
