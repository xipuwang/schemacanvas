/**
 * Import flow: parse SQL DDL / DBML (never silent: errors carry line and column), and add the parsed model to the project
 * in ONE undoable commit with a relational-schema diagram laid out by `autoLayout` on a temporary project.
 */
import { produce } from 'immer';
import { autoLayout } from '@/layout';
import { loadProjectData, parseProjectFile, type LoadResult } from '@/model/io';
import * as ops from '@/model/ops';
import type { Id, Issue, Point, Project, RelationalModel, SqlDialect } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { editorStore as globalStore, type EditorStore } from '@/store';
import { SqlParseError, importDbml, parseDdlSafe } from '@/sql';

export type ImportKind = 'sql' | 'dbml' | 'project';
export type ImportDialect = SqlDialect | 'auto';

export interface ImportSummary {
  tables: number;
  foreignKeys: number;
  columns: number;
}

export interface ExcerptLine {
  line: number;
  text: string;
  /** 0-based caret column inside `text` (only on the offending line). */
  caret?: number;
}

export type ParseOutcome =
  | { status: 'empty' }
  | { status: 'ok'; model: RelationalModel; warnings: Issue[]; summary: ImportSummary }
  | { status: 'error'; message: string; line: number; column: number; offset: number; construct?: string; excerpt: ExcerptLine[] };

export function summarizeModel(model: RelationalModel): ImportSummary {
  const relations = Object.values(model.relations);
  return { tables: relations.length, foreignKeys: Object.keys(model.foreignKeys).length, columns: relations.reduce((n, r) => n + r.columns.length, 0) };
}

const WINDOW = 110;

/** Up to one line of context either side of the offending line, long lines windowed around the caret. */
export function buildExcerpt(text: string, line: number, column: number): ExcerptLine[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: ExcerptLine[] = [];
  for (let n = Math.max(1, line - 1); n <= Math.min(lines.length, line + 1); n++) {
    const full = lines[n - 1] ?? '';
    const target = n === line;
    const col0 = Math.max(0, column - 1);
    const start = target && col0 > WINDOW ? col0 - WINDOW : 0;
    const shown = (start > 0 ? '…' : '') + full.slice(start, start + WINDOW * 2) + (full.length > start + WINDOW * 2 ? '…' : '');
    out.push(target ? { line: n, text: shown, caret: col0 - start + (start > 0 ? 1 : 0) } : { line: n, text: shown });
  }
  return out;
}

/** The parser appends `(line x, column y)` to its message; the UI shows the position separately. */
export const cleanParseMessage = (e: SqlParseError): string => e.message.replace(/\s*\(line \d+, column \d+\)\s*$/, '');

export function parseImport(kind: 'sql' | 'dbml', text: string, dialect: ImportDialect = 'auto'): ParseOutcome {
  if (text.trim() === '') return { status: 'empty' };
  const fail = (e: SqlParseError): ParseOutcome => ({
    status: 'error',
    message: cleanParseMessage(e),
    line: e.line,
    column: e.column,
    offset: e.offset,
    construct: e.construct,
    excerpt: buildExcerpt(text, e.line, e.column),
  });
  try {
    if (kind === 'sql') {
      const r = parseDdlSafe(text, dialect);
      if (!r.ok) return fail(r.error);
      return { status: 'ok', model: r.model, warnings: r.warnings, summary: summarizeModel(r.model) };
    }
    const r = importDbml(text);
    return { status: 'ok', model: r.model, warnings: r.warnings, summary: summarizeModel(r.model) };
  } catch (e) {
    if (e instanceof SqlParseError) return fail(e);
    const message = e instanceof Error ? e.message : String(e);
    return { status: 'error', message, line: 1, column: 1, offset: 0, excerpt: buildExcerpt(text, 1, 1) };
  }
}

export function parseProjectText(text: string): LoadResult {
  if (text.trim() === '') return { ok: false, error: { code: 'not-json', message: 'empty' } };
  return parseProjectFile(text);
}

export { loadProjectData };

export interface AppliedImport {
  modelId: Id;
  diagramId: Id;
  tables: number;
}

/**
 * Add `model` (fresh ids from the parser) with a laid-out relational-schema diagram: temp project -> buildScene -> autoLayout
 * -> ONE commit. Positions are keyed by relation id, which `ops.addModel` resolves for the new diagram.
 */
export async function applyModelImport(model: RelationalModel, opts: { diagramName: string; label: string; store?: EditorStore }): Promise<AppliedImport> {
  const store = opts.store ?? globalStore;
  const base = store.getState().project;
  let tempDiagram: Id | undefined;
  const temp = produce(base, (d) => {
    tempDiagram = ops.addModel(d, model).diagramIds[0];
  });
  let positions: Record<Id, Point> = {};
  if (tempDiagram) {
    const scene = buildScene(temp, tempDiagram);
    const byNode = await autoLayout(scene, temp, tempDiagram);
    const diagram = temp.diagrams[tempDiagram]!;
    for (const [nodeId, p] of Object.entries(byNode)) {
      const node = diagram.nodes[nodeId];
      if (node) positions[node.ref.id] = p;
    }
  }
  let applied: { modelId: Id; diagramIds: Id[] } | undefined;
  store.getState().commit(opts.label, (d) => {
    applied = ops.addModel(d, model, { diagramName: opts.diagramName, positions });
  });
  if (!applied) throw new Error('import produced no model');
  const diagramId = applied.diagramIds[0]!;
  store.getState().setActiveDiagram(diagramId);
  return { modelId: applied.modelId, diagramId, tables: Object.keys(model.relations).length };
}

export type { Project };
