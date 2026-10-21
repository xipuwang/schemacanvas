/** The hook the canvas calls when a template item is dropped or an armed template is placed: ONE commit, returns the new node ids. */
import { insertTemplate } from '@/examples';
import type { TemplateInsertion } from '@/editor';
import type { Id } from '@/model/types';
import { templateSize } from './previews';

export function insertTemplateAt({ store, diagramId, templateId, at }: TemplateInsertion): Id[] {
  const state = store.getState();
  const diagram = state.project.diagrams[diagramId];
  if (!diagram) return [];
  // centre the template on the drop point; snap its corner to the grid when snapping is on
  const size = templateSize(templateId, diagram.type);
  const grid = diagram.options.grid.snap ? diagram.options.grid.size : 0;
  const snap = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
  const origin = { x: snap(at.x - (size?.w ?? 0) / 2), y: snap(at.y - (size?.h ?? 0) / 2) };
  let nodeIds: Id[] = [];
  state.commit('Insert template', (draft) => {
    nodeIds = insertTemplate(draft, diagramId, templateId, origin).nodeIds;
  });
  return nodeIds;
}
