import type { Diagram, Project } from '@/model/types';
import type { Scene } from '@/scene/types';
import { OutlineShape } from './OutlineShape';
import { getEdgeView, getNodeView } from './registry';
import { SvgLabel } from './svgText';
import type { RenderContext } from './types';

/**
 * Draws a Scene in world coordinates in layers: edges, nodes (with selection/validation halos), then edge
 * LABELS (above all nodes so a role or FK label overlapping a table never disappears).
 * Contains NO hooks / DOM access, so it works in the live canvas AND in `renderToStaticMarkup`
 * for SVG/PNG/PDF export. DOM hooks for tests and the editor: `data-node-id`, `data-edge-id`.
 *
 * This is the CORE: it does NOT import the notation families (that would create an import cycle when a family
 * test imports it). Families register views with ./registry; `SceneSvg` (the app entry) imports them all.
 */
export function SceneSvgCore({
  scene,
  project,
  diagram,
  ctx,
}: {
  scene: Scene;
  project: Project;
  diagram: Diagram;
  ctx: RenderContext;
}) {
  const haloColor = (id: string): string | undefined => {
    const sev = ctx.highlights[id];
    if (sev) return ctx.palette[sev];
    if (ctx.selection.has(id)) return ctx.palette.accent;
    return undefined;
  };

  return (
    <g data-diagram-id={diagram.id}>
      <g data-layer="edges">
        {scene.edgeOrder.map((id) => {
          const geom = scene.edges[id];
          const edge = diagram.edges[id];
          if (!geom || !edge) return null;
          const View = getEdgeView(geom.kind);
          if (!View) return null;
          const halo = ctx.interactive ? haloColor(id) : undefined;
          return (
            <g key={id} data-edge-id={id} data-edge-kind={geom.kind}>
              {halo &&
                geom.paths.map((p, i) => (
                  <polyline
                    key={i}
                    points={p.map((q) => `${q.x},${q.y}`).join(' ')}
                    fill="none"
                    stroke={halo}
                    strokeOpacity={0.35}
                    strokeWidth={8}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              <View geom={geom} edge={edge} diagram={diagram} project={project} ctx={ctx} />
            </g>
          );
        })}
      </g>
      <g data-layer="nodes">
        {scene.nodeOrder.map((id) => {
          const geom = scene.nodes[id];
          const node = diagram.nodes[id];
          if (!geom || !node) return null;
          const View = getNodeView(geom.kind);
          if (!View) return null;
          const halo = ctx.interactive ? haloColor(id) : undefined;
          return (
            <g key={id} data-node-id={id} data-node-kind={geom.kind}>
              {halo && (
                <OutlineShape
                  outline={{ ...geom.outline, rect: { x: geom.outline.rect.x - 4, y: geom.outline.rect.y - 4, w: geom.outline.rect.w + 8, h: geom.outline.rect.h + 8 } }}
                  fill={halo}
                  fillOpacity={0.18}
                  stroke={halo}
                  strokeOpacity={0.9}
                  strokeWidth={1.5}
                />
              )}
              <View geom={geom} node={node} diagram={diagram} project={project} ctx={ctx} />
            </g>
          );
        })}
      </g>
      <g data-layer="edge-labels">
        {scene.edgeOrder.map((id) => {
          const geom = scene.edges[id];
          if (!geom || geom.labels.length === 0) return null;
          return (
            <g key={id} data-edge-labels={id}>
              {geom.labels.map((l) => (
                <g key={l.id} data-label={l.id}>
                  <SvgLabel label={l.label} color={ctx.palette.text} backdropColor={ctx.palette.background} />
                </g>
              ))}
            </g>
          );
        })}
      </g>
    </g>
  );
}
