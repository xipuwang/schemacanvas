/**
 * Export flow (pure apart from the browser-only png/pdf paths inside `exportDiagram`).
 * Maps the dialog state to `ExportOptions`, runs the right exporter and normalises the outcome.
 */
import { exportDiagram, exportProjectJson, suggestFilename, type ExportFormat, type ExportInfo, type ExportOptions } from '@/export';
import type { Id, Issue, Project, SqlDialect } from '@/model/types';
import { exportDbmlDetailed, generateDdl } from '@/sql';
import { exportSourceModel } from '../sql/sqlOutput';

export type ExportKind = 'svg' | 'png' | 'pdf' | 'json' | 'sql' | 'dbml';
export const EXPORT_KINDS: readonly ExportKind[] = ['svg', 'png', 'pdf', 'json', 'sql', 'dbml'];
export const IMAGE_KINDS: readonly ExportKind[] = ['svg', 'png', 'pdf'];
export const isImageKind = (k: ExportKind): boolean => IMAGE_KINDS.includes(k);

export interface ExportState {
  format: ExportKind;
  background: 'white' | 'transparent';
  padding: number;
  scale: 1 | 2 | 3 | 4;
  pageSize: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  darkPalette: boolean;
  onlySelected: boolean;
  sqlDialect: SqlDialect;
}

export const DEFAULT_EXPORT_STATE: ExportState = {
  format: 'svg',
  background: 'white',
  padding: 24,
  scale: 2,
  pageSize: 'fit',
  orientation: 'auto',
  darkPalette: false,
  onlySelected: false,
  sqlDialect: 'generic',
};

export function isExportKind(v: unknown): v is ExportKind {
  return typeof v === 'string' && (EXPORT_KINDS as readonly string[]).includes(v);
}

/** `ExportOptions` for the image formats (the options that do not apply to a format are simply left out). */
export function exportOptionsFor(state: ExportState, selectionNodeIds: readonly Id[]): ExportOptions {
  const o: ExportOptions = { background: state.background, padding: state.padding, darkPalette: state.darkPalette };
  if (state.onlySelected && selectionNodeIds.length > 0) o.selectionNodeIds = [...selectionNodeIds];
  if (state.format === 'png') o.scale = state.scale;
  if (state.format === 'pdf') {
    o.pageSize = state.pageSize;
    if (state.pageSize !== 'fit') o.orientation = state.orientation;
  }
  return o;
}

export const extensionOf = (kind: ExportKind): string => (kind === 'json' ? 'schemacanvas.json' : kind);

/** Default file name: images carry the diagram name, the project file and SQL/DBML only the project name. */
export function defaultFilename(project: Pick<Project, 'name'>, diagram: { name: string } | undefined, kind: ExportKind): string {
  return suggestFilename(project, isImageKind(kind) ? diagram : undefined, kind === 'json' ? 'json' : kind);
}

/** Replace the extension of a user-edited name when the format changes. */
export function withExtension(name: string, kind: ExportKind): string {
  const base = name.replace(/\.(schemacanvas\.json|svg|png|pdf|json|sql|dbml)$/i, '');
  return `${base}.${extensionOf(kind)}`;
}

export type ExportOutcome =
  | { ok: true; blob: Blob; filename: string; warnings: string[]; info?: ExportInfo; issues: Issue[]; sourceName?: string; viaConversion?: boolean; text?: string }
  | { ok: false; issues: Issue[] };

const MIME_TEXT = 'text/plain;charset=utf-8';

export async function runExport(project: Project, diagramId: Id | null, state: ExportState, selectionNodeIds: readonly Id[]): Promise<ExportOutcome> {
  const diagram = diagramId ? project.diagrams[diagramId] : undefined;
  if (state.format === 'json') {
    const r = exportProjectJson(project);
    return { ok: true, blob: r.blob, filename: r.filename, warnings: r.warnings, issues: [] };
  }
  if (state.format === 'sql' || state.format === 'dbml') {
    const source = exportSourceModel(project, diagramId);
    if (!source) throw new Error('no-relational-model');
    const filename = defaultFilename(project, undefined, state.format);
    if (state.format === 'dbml') {
      const r = exportDbmlDetailed(source.model);
      return { ok: true, blob: new Blob([r.dbml], { type: MIME_TEXT }), filename, warnings: [], issues: r.issues, sourceName: source.model.name, viaConversion: source.viaConversion, text: r.dbml };
    }
    const r = generateDdl(source.model, state.sqlDialect);
    if (r.sql === '' && r.issues.some((i) => i.severity === 'error')) return { ok: false, issues: r.issues };
    return { ok: true, blob: new Blob([r.sql], { type: MIME_TEXT }), filename, warnings: [], issues: r.issues, sourceName: source.model.name, viaConversion: source.viaConversion, text: r.sql };
  }
  if (!diagram) throw new Error('no-diagram');
  const r = await exportDiagram(project, diagram.id, state.format as ExportFormat, exportOptionsFor(state, selectionNodeIds));
  return { ok: true, blob: r.blob, filename: r.filename, warnings: r.warnings, info: r.info, issues: [] };
}

export type KnownWarning =
  | { key: 'dialogs.export.w.empty' }
  | { key: 'dialogs.export.w.pdfImage' }
  | { key: 'dialogs.export.w.pngScale'; params: { from: number; to: number } }
  | { key: 'dialogs.export.w.ignored'; params: { count: number } }
  | { key: 'dialogs.export.w.pageCap' };

/** Recognise the English warnings of src/export so they can be shown in the UI language; null = show the text as is. */
export function classifyExportWarning(w: string): KnownWarning | null {
  if (w === 'diagram is empty') return { key: 'dialogs.export.w.empty' };
  if (/PDF standard fonts cannot display/.test(w)) return { key: 'dialogs.export.w.pdfImage' };
  const png = /^PNG scale reduced from ([\d.]+) to ([\d.]+)/.exec(w);
  if (png) return { key: 'dialogs.export.w.pngScale', params: { from: Number(png[1]), to: Number(png[2]) } };
  const ign = /^(\d+) selected element\(s\)/.exec(w);
  if (ign) return { key: 'dialogs.export.w.ignored', params: { count: Number(ign[1]) } };
  if (/maximum PDF page size/.test(w)) return { key: 'dialogs.export.w.pageCap' };
  return null;
}
