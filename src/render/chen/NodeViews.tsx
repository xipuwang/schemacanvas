/** SVG views of Chen nodes. They only DRAW scene geometry; no selection chrome (SceneSvgCore draws halos). */
import type { Rect } from '@/scene/base';
import type { ChenAttributeGeom, ChenEntityGeom, ChenRelationshipGeom } from '@/scene/chen/types';
import { nodeStrokeWidth } from '@/scene/chen/metrics';
import { SvgLabel } from '../svgText';
import type { NodeViewProps } from '../types';

const diamondPoints = (r: Rect): string =>
  `${r.x + r.w / 2},${r.y} ${r.x + r.w},${r.y + r.h / 2} ${r.x + r.w / 2},${r.y + r.h} ${r.x},${r.y + r.h / 2}`;

function nodePaint({ node, ctx }: Pick<NodeViewProps, 'node' | 'ctx'>) {
  const s = node.style;
  return {
    fill: s?.fill ?? ctx.palette.surface,
    stroke: s?.stroke ?? ctx.palette.stroke,
    strokeWidth: nodeStrokeWidth(s),
    text: s?.textColor ?? ctx.palette.text,
  };
}

export function ChenEntityView(props: NodeViewProps) {
  const geom = props.geom as ChenEntityGeom;
  const st = nodePaint(props);
  const { x, y, w, h } = geom.bounds;
  const line = { fill: 'none', stroke: st.stroke, strokeWidth: st.strokeWidth };
  return (
    <g data-chen-shape="entity" data-weak={geom.weak} data-associative={geom.associative}>
      <rect x={x} y={y} width={w} height={h} fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth} />
      {geom.innerRect && (
        <rect data-part="inner" x={geom.innerRect.x} y={geom.innerRect.y} width={geom.innerRect.w} height={geom.innerRect.h} {...line} />
      )}
      {geom.innerDiamond && <polygon data-part="inner" points={diamondPoints(geom.innerDiamond)} {...line} />}
      <SvgLabel label={geom.label} color={st.text} />
    </g>
  );
}

export function ChenAttributeView(props: NodeViewProps) {
  const geom = props.geom as ChenAttributeGeom;
  const st = nodePaint(props);
  const { x, y, w, h } = geom.bounds;
  const dash = geom.dashed ? '5 3' : undefined;
  const ie = geom.innerEllipse;
  return (
    <g
      data-chen-shape="attribute"
      data-multivalued={geom.multivalued}
      data-derived={geom.derived}
      data-key={geom.label.underline ?? 'none'}
    >
      <ellipse
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        fill={st.fill}
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeDasharray={dash}
      />
      {ie && (
        <ellipse
          data-part="inner"
          cx={ie.x + ie.w / 2}
          cy={ie.y + ie.h / 2}
          rx={ie.w / 2}
          ry={ie.h / 2}
          fill="none"
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          strokeDasharray={dash}
        />
      )}
      <SvgLabel label={geom.label} color={st.text} />
      {geom.typeLabel && <SvgLabel label={geom.typeLabel} color={props.ctx.palette.textMuted} />}
    </g>
  );
}

export function ChenRelationshipView(props: NodeViewProps) {
  const geom = props.geom as ChenRelationshipGeom;
  const st = nodePaint(props);
  return (
    <g data-chen-shape="relationship" data-identifying={geom.identifying}>
      <polygon points={diamondPoints(geom.bounds)} fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth} strokeLinejoin="miter" />
      {geom.innerDiamond && (
        <polygon data-part="inner" points={diamondPoints(geom.innerDiamond)} fill="none" stroke={st.stroke} strokeWidth={st.strokeWidth} strokeLinejoin="miter" />
      )}
      <SvgLabel label={geom.label} color={st.text} />
    </g>
  );
}
