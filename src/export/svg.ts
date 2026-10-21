import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { syncDiagramEdges } from '@/model/diagramSync';
import type { Diagram, Id, Project } from '@/model/types';
import { SceneSvgCore, darkPalette, lightPalette } from '@/render';
import type { RenderContext } from '@/render';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import type { ExportOptions } from './types';

export const GENERATOR = 'SchemaCanvas';
export const DEFAULT_PADDING = 24;
const EMPTY_SHEET = { w: 160, h: 80 };
const noSelection: ReadonlySet<string> = new Set();

export function escapeXml(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Compact, noise-free number (<= 3 decimals). */
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export interface ExportScene {
  project: Project;
  diagram: Diagram;
  scene: Scene;
  warnings: string[];
}

/**
 * The scene an export draws. Without a selection: the real diagram. With `selectionNodeIds`: a TEMPORARY project whose
 * diagram keeps only those nodes (`partial = true`) and, via `syncDiagramEdges`, only the edges whose both ends are kept.
 * The input project is never mutated (it may be deeply frozen); the model is shared by reference, never written.
 */
export function buildExportScene(project: Readonly<Project>, diagramId: Id, selectionNodeIds?: readonly Id[]): ExportScene {
  const p = project as Project;
  const source = p.diagrams[diagramId];
  if (!source) throw new Error(`exportDiagram: unknown diagram ${diagramId}`);
  const warnings: string[] = [];
  if (!selectionNodeIds) {
    const scene = buildScene(p, diagramId);
    return { project: p, diagram: source, scene, warnings: [...scene.warnings] };
  }
  const keep = new Set(selectionNodeIds);
  const nodes: Diagram['nodes'] = {};
  for (const [id, n] of Object.entries(source.nodes)) if (keep.has(id)) nodes[id] = structuredClone(n);
  const dropped = [...keep].filter((id) => !source.nodes[id]).length;
  if (dropped) warnings.push(`${dropped} selected element(s) are not part of this diagram and were ignored`);
  const diagram: Diagram = { ...structuredClone({ ...source, nodes: {}, edges: {} }), nodes, edges: {}, partial: true };
  for (const [id, e] of Object.entries(source.edges)) diagram.edges[id] = structuredClone(e);
  const model = p.models[source.modelId];
  if (model) syncDiagramEdges(model, diagram);
  const temp: Project = { ...p, diagrams: { ...p.diagrams, [diagramId]: diagram } };
  const scene = buildScene(temp, diagramId);
  return { project: temp, diagram, scene, warnings: [...warnings, ...scene.warnings] };
}

export interface ExportSvg {
  svg: string;
  /** viewBox size (world units == px). */
  width: number;
  height: number;
  viewBox: { x: number; y: number; w: number; h: number };
  empty: boolean;
  warnings: string[];
  background: string | null;
}

export interface RenderOptions extends Pick<ExportOptions, 'background' | 'padding' | 'darkPalette' | 'selectionNodeIds'> {
  title?: string;
}

/** Standalone SVG document for a diagram (pure; no DOM). Deterministic for equal inputs. */
export function renderExportSvg(project: Readonly<Project>, diagramId: Id, opts: RenderOptions = {}): ExportSvg {
  const ex = buildExportScene(project, diagramId, opts.selectionNodeIds);
  const { scene, diagram } = ex;
  const warnings = [...ex.warnings];
  const palette = opts.darkPalette ? darkPalette : lightPalette;
  const pad = Math.max(2, Number.isFinite(opts.padding) ? (opts.padding as number) : DEFAULT_PADDING);
  const b = scene.bounds;
  const empty = scene.nodeOrder.length === 0 && scene.edgeOrder.length === 0;
  const finite = [b.x, b.y, b.w, b.h].every(Number.isFinite);
  if (!empty && !finite) warnings.push('diagram bounds are not finite; exported a blank sheet');
  let x: number, y: number, w: number, h: number;
  if (empty || !finite) {
    x = 0;
    y = 0;
    w = EMPTY_SHEET.w;
    h = EMPTY_SHEET.h;
    if (empty) warnings.push('diagram is empty');
  } else {
    // round OUTWARD so rounding can never clip
    const x0 = Math.floor((b.x - pad) * 1000) / 1000;
    const y0 = Math.floor((b.y - pad) * 1000) / 1000;
    const x1 = Math.ceil((b.x + b.w + pad) * 1000) / 1000;
    const y1 = Math.ceil((b.y + b.h + pad) * 1000) / 1000;
    x = x0;
    y = y0;
    w = Math.max(1, x1 - x0);
    h = Math.max(1, y1 - y0);
  }
  const bg = opts.background === 'transparent' ? null : opts.darkPalette ? darkPalette.background : '#ffffff';
  const ctx: RenderContext = { palette, interactive: false, selection: noSelection, highlights: {} };
  let body = '';
  if (!empty && finite) {
    body = renderToStaticMarkup(createElement(SceneSvgCore, { scene, project: ex.project, diagram, ctx }));
    body = body
      .replace(/ data-[a-z0-9-]+="[^"]*"/g, '')
      // attribute values only (text content can never contain a raw quote): trim float noise to 3 decimals
      .replace(/="([^"]*)"/g, (_m, v: string) => `="${v.replace(/-?\d+\.\d{4,}/g, (n) => num(Number(n)))}"`);
  }
  const model = ex.project.models[diagram.modelId];
  const title = opts.title ?? `${project.name} - ${diagram.name}`;
  const desc = `${diagram.name} (${diagram.type}${model ? `, model "${model.name}"` : ''}) from project "${project.name}". Generated by ${GENERATOR}.`;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" role="img">` +
    `<title>${escapeXml(title)}</title><desc>${escapeXml(desc)}</desc>` +
    (bg ? `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${bg}"/>` : '') +
    body +
    `</svg>\n`;
  return { svg, width: w, height: h, viewBox: { x, y, w, h }, empty, warnings, background: bg };
}
