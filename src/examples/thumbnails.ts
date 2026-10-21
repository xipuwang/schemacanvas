import { renderSceneToSvgString } from '@/render/standalone';
import { buildScene } from '@/scene/registry';
import { buildExample } from './catalog';

const cache = new Map<string, string>();

/**
 * Standalone SVG (light palette, white background, 16 unit padding) of an example's ER or relational diagram for the
 * gallery. Built lazily and cached for the page lifetime; the string carries width/height in world units, so scale it
 * with CSS (`width: 100%; height: auto`).
 */
export function renderExampleThumbnail(id: string, kind: 'er' | 'relational'): string {
  const key = `${id}:${kind}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const project = buildExample(id);
  const type = kind === 'er' ? 'chen' : 'relational-schema';
  const diagram = Object.values(project.diagrams).find((d) => d.type === type)!;
  const svg = renderSceneToSvgString(buildScene(project, diagram.id), project, diagram, { padding: 16 });
  cache.set(key, svg);
  return svg;
}
