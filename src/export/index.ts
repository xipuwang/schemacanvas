import { serializeProject } from '@/model/io';
import type { Id, Project } from '@/model/types';
import { copyPngToClipboard } from './download';
import { suggestFilename } from './filename';
import { clampPngScale, rasterizeSvg, withPixelSize } from './png';
import { renderPdf } from './pdf';
import { renderExportSvg } from './svg';
import type { ExportFormat, ExportOptions, ExportResult } from './types';

export type { ExportFormat, ExportOptions, ExportResult, ExportInfo } from './types';
export { suggestFilename, sanitizeFilePart } from './filename';
export { downloadBlob, copyPngToClipboard } from './download';
export { clampPngScale, MAX_PNG_AREA, MAX_PNG_SIDE } from './png';
export { renderExportSvg, buildExportScene } from './svg';
export { layoutPage, mapArrowGlyphs, findNonWinAnsiText } from './pdf';

export const MIME: Record<ExportFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
  json: 'application/json',
};

/** The whole project as a native `.schemacanvas.json` (the loader round-trips it). */
export function exportProjectJson(project: Readonly<Project>): ExportResult {
  const text = serializeProject(project as Project);
  const blob = new Blob([text], { type: MIME.json });
  return {
    blob,
    filename: suggestFilename(project, undefined, 'json'),
    mime: MIME.json,
    warnings: [],
    info: { width: 0, height: 0, vector: true },
  };
}

/**
 * Export one diagram. Never throws for soft-invalid models (scene warnings come back in `warnings`); throws only for an
 * unknown diagram id or when a browser-only format (png/pdf) runs without a DOM.
 */
export async function exportDiagram(
  project: Readonly<Project>,
  diagramId: Id,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (format === 'json') return exportProjectJson(project);
  const diagram = project.diagrams[diagramId];
  if (!diagram) throw new Error(`exportDiagram: unknown diagram ${diagramId}`);
  const out = renderExportSvg(project, diagramId, options);
  const filename = suggestFilename(project, diagram, format);
  const warnings = [...out.warnings];
  if (format === 'svg') {
    return {
      blob: new Blob([out.svg], { type: `${MIME.svg};charset=utf-8` }),
      filename,
      mime: MIME.svg,
      warnings,
      info: { width: out.width, height: out.height, vector: true },
    };
  }
  if (format === 'png') {
    const c = clampPngScale(out.width, out.height, options.scale);
    if (c.clamped) {
      warnings.push(
        `PNG scale reduced from ${options.scale ?? 2} to ${Number(c.scale.toFixed(3))} to stay within 16384 px per side and 16,777,216 px in total`,
      );
    }
    const blob = await rasterizeSvg(withPixelSize(out.svg, c.width, c.height), c.width, c.height, out.background);
    return { blob, filename, mime: MIME.png, warnings, info: { width: c.width, height: c.height, scaleUsed: c.scale, vector: false } };
  }
  const title = options.title ?? `${project.name} - ${diagram.name}`;
  const pdf = await renderPdf({ svg: out.svg, width: out.width, height: out.height, background: out.background, title }, options);
  return { blob: pdf.blob, filename, mime: MIME.pdf, warnings: [...warnings, ...pdf.warnings], info: pdf.info };
}

/** Best effort: render the diagram as PNG and put it on the clipboard. Resolves false when it could not. */
export async function copyDiagramPngToClipboard(project: Readonly<Project>, diagramId: Id, options: ExportOptions = {}): Promise<boolean> {
  try {
    const r = await exportDiagram(project, diagramId, 'png', options);
    return await copyPngToClipboard(r.blob);
  } catch {
    return false;
  }
}
