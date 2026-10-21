/** Which relational model the SQL view shows and the text it produces. Pure. */
import type { Issue, Project, RelationalModel, SqlDialect } from '@/model/types';
import { exportDbmlDetailed, generateDdl } from '@/sql';

export type SqlFormat = SqlDialect | 'dbml';
export const SQL_FORMATS: readonly SqlFormat[] = ['postgresql', 'sqlite', 'mysql', 'generic', 'dbml'];

/** The relational model viewed by the active diagram (never a model derived from an ER diagram). */
export function activeRelationalModel(project: Project, diagramId: string | null | undefined): RelationalModel | undefined {
  const diagram = diagramId ? project.diagrams[diagramId] : undefined;
  const model = diagram ? project.models[diagram.modelId] : undefined;
  return model?.kind === 'relational' ? model : undefined;
}

/**
 * Model an EXPORT of SQL/DBML uses: the active relational model, or (ER diagram active) the relational model the project
 * already converted from it. `viaConversion` lets the dialog say where the SQL comes from.
 */
export function exportSourceModel(project: Project, diagramId: string | null | undefined): { model: RelationalModel; viaConversion: boolean } | undefined {
  const direct = activeRelationalModel(project, diagramId);
  if (direct) return { model: direct, viaConversion: false };
  const diagram = diagramId ? project.diagrams[diagramId] : undefined;
  if (!diagram || project.models[diagram.modelId]?.kind !== 'er') return undefined;
  const records = Object.values(project.conversions)
    .filter((c) => c.erModelId === diagram.modelId && project.models[c.relationalModelId]?.kind === 'relational')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const rec = records[0];
  const model = rec ? project.models[rec.relationalModelId] : undefined;
  return model?.kind === 'relational' ? { model, viaConversion: true } : undefined;
}

export interface SqlOutput {
  text: string;
  issues: Issue[];
  /** The generator refused to emit DDL because of an error-level issue. */
  blocked: boolean;
}

export function buildSqlOutput(model: RelationalModel, format: SqlFormat): SqlOutput {
  if (format === 'dbml') {
    const r = exportDbmlDetailed(model);
    return { text: r.dbml, issues: r.issues, blocked: false };
  }
  const r = generateDdl(model, format);
  return { text: r.sql, issues: r.issues, blocked: r.sql === '' && r.issues.some((i) => i.severity === 'error') };
}

export const extensionFor = (format: SqlFormat): 'sql' | 'dbml' => (format === 'dbml' ? 'dbml' : 'sql');
export const langFor = (format: SqlFormat): 'sql' | 'dbml' => extensionFor(format);
