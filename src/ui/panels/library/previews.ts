/**
 * Library previews. Every preview is the REAL notation: a tiny project is built with the model builders, run through
 * `buildScene` and serialised with `renderSceneToSvgString`, so it matches the canvas by construction (never a hand-drawn
 * lookalike). Results are cached per (part, diagram type, theme, locale).
 */
import { produce } from 'immer';
import { insertTemplate } from '@/examples';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject, createErModel, modelKindForDiagramType } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Diagram, DiagramType, ErModel, Project } from '@/model/types';
import { darkPalette, lightPalette } from '@/render/palette';
import { renderSceneToSvgString } from '@/render/standalone';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import { t } from '@/i18n';
import type { Locale } from '@/i18n';
import type { PreviewSpec } from './items';

export type PreviewTheme = 'light' | 'dark';

interface Built {
  project: Project;
  diagram: Diagram;
}

function chen(model: ErModel): Built {
  const project = createBareProject('preview');
  const diagram = withDiagram(project, model, 'chen');
  return { project, diagram };
}

/** Keep only the nodes/edges that belong to the attribute subtree: the owner entity is only scaffolding. */
function dropOwner(b: Built, ownerEntityId: string): Built {
  const diagram = b.diagram;
  const model = b.project.models[diagram.modelId] as ErModel;
  for (const [id, n] of Object.entries(diagram.nodes)) if (n.ref.kind === 'entity' && n.ref.id === ownerEntityId) delete diagram.nodes[id];
  for (const [id, e] of Object.entries(diagram.edges)) {
    if (e.ref.kind !== 'attribute') {
      delete diagram.edges[id];
      continue;
    }
    const a = model.attributes[e.ref.attributeId];
    if (!a || (a.owner.kind === 'entity' && a.owner.id === ownerEntityId)) delete diagram.edges[id];
  }
  diagram.partial = true;
  return b;
}

function buildPreviewProject(spec: PreviewSpec, type: DiagramType): Built | undefined {
  switch (spec.kind) {
    case 'entity': {
      const b = erBuilder('preview');
      b.entity(t('library.sample.entity'), { weak: spec.weak });
      return chen(b.build());
    }
    case 'relationship': {
      const model = createErModel('preview');
      model.relationships['rel_preview'] = { id: 'rel_preview', name: t('library.sample.relationship'), identifying: spec.identifying, participants: [] };
      return chen(model);
    }
    case 'attribute': {
      const b = erBuilder('preview');
      const owner = b.entity('Owner', { weak: spec.flavor === 'partial-key' });
      const name = t('library.sample.attribute');
      switch (spec.flavor) {
        case 'simple':
          owner.attr(name);
          break;
        case 'key':
          owner.key(name);
          break;
        case 'partial-key':
          owner.partialKey(name);
          break;
        case 'multivalued':
          owner.multivalued(name);
          break;
        case 'derived':
          owner.derived(name);
          break;
        case 'composite':
          owner.composite(name, [t('library.sample.part'), t('library.sample.part')]);
          break;
      }
      const model = b.build();
      return dropOwner(chen(model), Object.keys(model.entities)[0]!);
    }
    case 'relation': {
      const b = relationalBuilder('preview');
      const key = t('library.sample.key');
      const col = t('library.sample.column');
      b.relation(t('library.sample.table'), [key, `${col}1`, `${col}2`], { pk: [key] });
      const model = b.build();
      const project = createBareProject('preview');
      const diagram = withDiagram(project, model, type === 'chen' ? 'relational-schema' : type);
      return { project, diagram };
    }
    case 'template': {
      const erKind = modelKindForDiagramType(type) === 'er';
      const project = createBareProject('preview');
      const model = erKind ? createErModel('preview') : relationalBuilder('preview').build();
      const diagram = withDiagram(project, model, erKind ? 'chen' : type);
      try {
        const next = produce(project, (draft) => {
          insertTemplate(draft, diagram.id, spec.templateId, { x: 0, y: 0 });
        });
        return { project: next, diagram: next.diagrams[diagram.id]! };
      } catch {
        return undefined;
      }
    }
  }
}

export interface Preview {
  /** Standalone SVG markup with a `viewBox` and no fixed size (CSS sizes it). */
  svg: string;
  /** World-unit size of the content (including padding). */
  width: number;
  height: number;
}

const cache = new Map<string, Preview | null>();

function sceneOf(b: Built): Scene {
  return buildScene(b.project, b.diagram.id);
}

export function previewFor(spec: PreviewSpec, type: DiagramType, theme: PreviewTheme, locale: Locale): Preview | null {
  const key = `${JSON.stringify(spec)}|${type}|${theme}|${locale}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out: Preview | null = null;
  try {
    const built = buildPreviewProject(spec, type);
    if (built) {
      const scene = sceneOf(built);
      const pad = 6;
      const raw = renderSceneToSvgString(scene, built.project, built.diagram, {
        palette: theme === 'dark' ? darkPalette : lightPalette,
        background: 'transparent',
        padding: pad,
      });
      const w = Math.max(1, scene.bounds.w + pad * 2);
      const h = Math.max(1, scene.bounds.h + pad * 2);
      // strip the fixed pixel size: the panel sizes the SVG with CSS and the viewBox keeps the aspect ratio
      out = { svg: raw.replace(/^<svg ([^>]*?) width="[^"]*" height="[^"]*"/, '<svg $1'), width: w, height: h };
    }
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}

/** World size of what a template inserts (used to centre it on the drop point). */
export function templateSize(templateId: string, type: DiagramType): { w: number; h: number } | undefined {
  const spec: PreviewSpec = { kind: 'template', templateId };
  const built = buildPreviewProject(spec, type);
  if (!built) return undefined;
  const scene = sceneOf(built);
  return { w: scene.bounds.w, h: scene.bounds.h };
}

export function clearPreviewCache(): void {
  cache.clear();
}
