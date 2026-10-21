import { mkdirSync, writeFileSync } from 'node:fs';
import { buildScene } from '@/scene/registry';
import { renderSceneToSvgString } from '@/render/standalone';
import type { Project } from '@/model/types';
import * as ops from '@/model/ops';
import { EXAMPLES, convertInStore, layoutDiagramInStore, setupEr, type ExampleKey } from './helpers';

export interface Rendered {
  key: ExampleKey;
  type: 'chen' | 'relational';
  svg: string;
  project: Project;
  diagramId: string;
  file: string;
}

export const OUT_DIR = '.tmp/integration';

/** Laid out + converted example rendered through the REAL pipeline into <OUT_DIR>/<example>-<type>.svg. */
export async function renderExample(key: ExampleKey): Promise<Rendered[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const s = setupEr(EXAMPLES[key]());
  await layoutDiagramInStore(s.store, s.erDiagramId);
  const c = await convertInStore(s);
  const out: Rendered[] = [];
  const p = s.store.getState().project;
  for (const [type, diagramId] of [['chen', s.erDiagramId], ['relational', c.relDiagramId]] as const) {
    const scene = buildScene(p, diagramId);
    const svg = renderSceneToSvgString(scene, p, p.diagrams[diagramId]!, { padding: 24 });
    const file = `${OUT_DIR}/${key}-${type}.svg`;
    writeFileSync(file, svg);
    out.push({ key, type, svg, project: p, diagramId, file });
  }
  return out;
}

export const CHEN_VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['types+minmax', { chen: { showDataTypes: true, cardinalityStyle: 'minmax' } }],
  ['orthogonal-noroles', { chen: { routing: 'orthogonal', showRoles: false } }],
  ['bigfont', { typography: { fontSize: 22 } }],
];
export const REL_VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['types', { relational: { showDataTypes: true } }],
  ['bracket', { relational: { compositeFkStyle: 'bracket' } }],
  ['nameLeft+labels', { relational: { nameAbove: false, fkLabels: true } }],
  ['straight', { relational: { routing: 'straight' } }],
  ['tall+bigfont', { relational: { rowHeight: 56 }, typography: { fontSize: 20 } }],
];

/** Pharmacy rendered with one option patch applied to BOTH diagrams of the matching type, re-laid-out afterwards. */
export async function renderVariant(name: string, type: 'chen' | 'relational', patch: Record<string, unknown>): Promise<Rendered & { scene: import('@/scene/types').Scene }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const s = setupEr(EXAMPLES.E());
  const c = await convertInStore(s);
  const diagramId = type === 'chen' ? s.erDiagramId : c.relDiagramId;
  s.store.getState().commit('options', (d) => { ops.setDiagramOptions(d, diagramId, patch as never); });
  await layoutDiagramInStore(s.store, diagramId);
  const p = s.store.getState().project;
  const scene = buildScene(p, diagramId);
  const svg = renderSceneToSvgString(scene, p, p.diagrams[diagramId]!, { padding: 24 });
  const file = `${OUT_DIR}/E-${type}-${name.replace(/[^a-z0-9]+/gi, '_')}.svg`;
  writeFileSync(file, svg);
  return { key: 'E', type, svg, project: p, diagramId, file, scene };
}
