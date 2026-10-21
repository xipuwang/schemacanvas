/** SVG view of Chen lines. Draws strokes only: labels are painted by SceneSvgCore in its label layer. */
import type { Point } from '@/model/types';
import type { ChenEdgeGeom } from '@/scene/chen/types';
import { DEFAULT_EDGE_STROKE } from '@/scene/chen/metrics';
import type { EdgeViewProps } from '../types';

const pointsAttr = (pts: Point[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ');

export function ChenLineView({ geom: g, edge, ctx }: EdgeViewProps) {
  const geom = g as ChenEdgeGeom;
  const stroke = edge.style?.stroke ?? ctx.palette.stroke;
  const strokeWidth = edge.style?.strokeWidth ?? DEFAULT_EDGE_STROKE;
  const dash = edge.style?.dash === 'dashed' ? '6 4' : edge.style?.dash === 'dotted' ? '1.5 3' : undefined;
  const common = { fill: 'none', stroke, strokeWidth, strokeDasharray: dash, strokeLinejoin: 'miter' as const, strokeLinecap: 'butt' as const };
  const lines = geom.double && geom.rails ? geom.rails : [geom.paths[0]!];
  return (
    <g data-chen-line={geom.lineKind} data-double={geom.double} data-recursive={geom.recursive}>
      {lines.map((pts, i) => (
        <polyline key={i} data-rail={geom.double ? i : undefined} points={pointsAttr(pts)} {...common} />
      ))}
    </g>
  );
}
