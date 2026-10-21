import type { SVGProps } from 'react';
import type { Outline } from '@/scene/base';

/** Draws any `Outline` as the matching SVG primitive (used for halos and generic fills). */
export function OutlineShape({ outline, ...rest }: { outline: Outline } & SVGProps<SVGElement>) {
  const { x, y, w, h } = outline.rect;
  const props = rest as SVGProps<SVGRectElement>;
  switch (outline.kind) {
    case 'rect':
      return <rect x={x} y={y} width={w} height={h} {...props} />;
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...(rest as SVGProps<SVGEllipseElement>)} />;
    case 'diamond':
      return (
        <polygon
          points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
          {...(rest as SVGProps<SVGPolygonElement>)}
        />
      );
  }
}
