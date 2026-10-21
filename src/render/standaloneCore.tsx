import { renderToStaticMarkup } from 'react-dom/server';
import type { Diagram, Project } from '@/model/types';
import type { Scene } from '@/scene/types';
import { lightPalette, type Palette } from './palette';
import { SceneSvgCore } from './SceneSvgCore';
import type { RenderContext } from './types';

export interface StandaloneSvgOptions {
  palette?: Palette;
  /** World-unit margin around the content so nothing is clipped. Default 24. */
  padding?: number;
  /** CSS colour, or `transparent`. Default white. */
  background?: string;
  /** Output pixel scale applied to width/height (viewBox stays in world units). Default 1. */
  scale?: number;
}

const noSelection: ReadonlySet<string> = new Set();

/**
 * Self-contained SVG document for a scene: viewBox fits `scene.bounds` (already a PAINT bound) + padding, vector
 * text, concrete colours, no external references. Pure (no DOM) so it runs in Node tests. Family tests use THIS
 * (the Core) after `import '@/render/<family>'` so they never load other families' half-written code.
 */
export function renderSceneToSvgStringCore(
  scene: Scene,
  project: Project,
  diagram: Diagram,
  opts: StandaloneSvgOptions = {},
): string {
  const palette = opts.palette ?? lightPalette;
  const pad = Math.max(2, opts.padding ?? 24);
  const scale = opts.scale ?? 1;
  const b = scene.bounds;
  const x = b.x - pad;
  const y = b.y - pad;
  const w = Math.max(1, b.w + pad * 2);
  const h = Math.max(1, b.h + pad * 2);
  const background = opts.background ?? '#ffffff';
  const ctx: RenderContext = { palette, interactive: false, selection: noSelection, highlights: {} };
  const body = renderToStaticMarkup(<SceneSvgCore scene={scene} project={project} diagram={diagram} ctx={ctx} />);
  const bg = background === 'transparent' ? '' : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="${x} ${y} ${w} ${h}">` +
    bg +
    body +
    `</svg>`
  );
}
