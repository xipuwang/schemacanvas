// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExample } from '@/examples';
import { deepFreeze } from '@/test/deepFreeze';
import { parseProjectFile } from '@/model/io';
import type { Project } from '@/model/types';

const exportDiagram = vi.fn();
vi.mock('@/export', async (orig) => {
  const real = await orig<typeof import('@/export')>();
  return { ...real, exportDiagram: (...args: unknown[]) => exportDiagram(...args) };
});

import { DEFAULT_EXPORT_STATE, classifyExportWarning, defaultFilename, exportOptionsFor, runExport, withExtension, type ExportState } from './exportFlow';

let project: Project;
beforeEach(() => {
  exportDiagram.mockReset();
  exportDiagram.mockResolvedValue({ blob: new Blob(['x']), filename: 'f.svg', mime: 'image/svg+xml', warnings: ['diagram is empty'], info: { width: 1, height: 1, vector: true } });
  project = deepFreeze(buildExample('pharmacy'));
});

const st = (patch: Partial<ExportState>): ExportState => ({ ...DEFAULT_EXPORT_STATE, ...patch });

describe('exportOptionsFor', () => {
  it('passes only the options that apply to the format', () => {
    expect(exportOptionsFor(st({ format: 'svg', scale: 4, pageSize: 'a4' }), [])).toEqual({ background: 'white', padding: 24, darkPalette: false });
    expect(exportOptionsFor(st({ format: 'png', scale: 3, background: 'transparent' }), [])).toEqual({ background: 'transparent', padding: 24, darkPalette: false, scale: 3 });
    expect(exportOptionsFor(st({ format: 'pdf', pageSize: 'a4', orientation: 'landscape' }), [])).toMatchObject({ pageSize: 'a4', orientation: 'landscape' });
    expect(exportOptionsFor(st({ format: 'pdf', pageSize: 'fit', orientation: 'landscape' }), [])).not.toHaveProperty('orientation');
  });
  it('limits the export to the selection only when asked and when something is selected', () => {
    expect(exportOptionsFor(st({ onlySelected: true }), ['n1', 'n2']).selectionNodeIds).toEqual(['n1', 'n2']);
    expect(exportOptionsFor(st({ onlySelected: true }), [])).not.toHaveProperty('selectionNodeIds');
    expect(exportOptionsFor(st({ onlySelected: false }), ['n1'])).not.toHaveProperty('selectionNodeIds');
  });
});

describe('runExport', () => {
  it('calls exportDiagram with the chosen format and options', async () => {
    const id = project.diagramOrder[1]!;
    const out = await runExport(project, id, st({ format: 'png', scale: 3, padding: 40 }), ['a']);
    expect(exportDiagram).toHaveBeenCalledWith(project, id, 'png', { background: 'white', padding: 40, darkPalette: false, scale: 3 });
    expect(out.ok && out.warnings).toEqual(['diagram is empty']);
  });
  it('exports the project as a loadable native file', async () => {
    const out = await runExport(project, project.diagramOrder[0]!, st({ format: 'json' }), []);
    if (!out.ok) throw new Error('unexpected');
    expect(out.filename).toMatch(/\.schemacanvas\.json$/);
    const parsed = parseProjectFile(await out.blob.text());
    expect(parsed.ok && Object.keys(parsed.project.models)).toHaveLength(Object.keys(project.models).length);
    expect(exportDiagram).not.toHaveBeenCalled();
  });
  it('generates DDL per dialect from the relational diagram and from the converted model of an ER diagram', async () => {
    const er = project.diagramOrder[0]!;
    const rel = project.diagramOrder[1]!;
    const fromRel = await runExport(project, rel, st({ format: 'sql', sqlDialect: 'postgresql' }), []);
    const fromEr = await runExport(project, er, st({ format: 'sql', sqlDialect: 'postgresql' }), []);
    if (!fromRel.ok || !fromEr.ok) throw new Error('unexpected');
    expect(fromRel.text).toContain('CREATE TABLE');
    expect(fromRel.text).toBe(fromEr.text);
    expect(fromEr.viaConversion).toBe(true);
    expect(fromRel.filename).toMatch(/\.sql$/);
    const dbml = await runExport(project, rel, st({ format: 'dbml' }), []);
    expect(dbml.ok && dbml.text).toContain('Table');
  });
  it('rejects SQL when there is no relational model to export', async () => {
    const empty = deepFreeze({ ...project, conversions: {} }) as Project;
    await expect(runExport(empty, empty.diagramOrder[0]!, st({ format: 'sql' }), [])).rejects.toThrow('no-relational-model');
  });
});

describe('names and warnings', () => {
  it('uses the diagram name for images only', () => {
    const d = project.diagrams[project.diagramOrder[0]!]!;
    expect(defaultFilename(project, d, 'svg')).toContain(d.name);
    expect(defaultFilename(project, d, 'sql')).not.toContain(d.name);
    expect(defaultFilename(project, d, 'json')).toMatch(/\.schemacanvas\.json$/);
  });
  it('swaps the extension of an edited name', () => {
    expect(withExtension('My diagram.svg', 'png')).toBe('My diagram.png');
    expect(withExtension('plain', 'pdf')).toBe('plain.pdf');
    expect(withExtension('x.schemacanvas.json', 'sql')).toBe('x.sql');
  });
  it('recognises the library warnings it can translate', () => {
    expect(classifyExportWarning('diagram is empty')?.key).toBe('dialogs.export.w.empty');
    expect(classifyExportWarning('contains characters PDF standard fonts cannot display; exported as an image')?.key).toBe('dialogs.export.w.pdfImage');
    expect(classifyExportWarning('PNG scale reduced from 4 to 1.5 to stay within')).toEqual({ key: 'dialogs.export.w.pngScale', params: { from: 4, to: 1.5 } });
    expect(classifyExportWarning('something else')).toBeNull();
  });
});
