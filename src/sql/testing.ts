/** Structural projection of a RelationalModel used by round-trip tests (names instead of ids, order-insensitive FKs). */
import { parseDataType } from '@/model/relationalFacts';
import type { RelationalModel } from '@/model/types';

export interface Shape {
  relations: Array<{
    name: string;
    schema: string;
    columns: Array<{ name: string; type: string; nullable: boolean; auto: boolean; default: string }>;
    pk: string[];
    uniques: string[][];
    indexes: Array<{ name: string; cols: string[]; unique: boolean; where: string; desc: string[] }>;
    checks: string[];
  }>;
  fks: string[];
}

const typeKey = (t?: string): string => {
  const p = parseDataType(t);
  return p ? `${p.base}(${p.args.join(',')})` : '';
};

export function shapeOf(model: RelationalModel, opts: { types?: boolean } = {}): Shape {
  const colName = (relId: string, colId: string): string => model.relations[relId]!.columns.find((c) => c.id === colId)!.name;
  const relations = Object.values(model.relations)
    .map((r) => {
      const names = (ids: string[]): string[] => ids.map((id) => r.columns.find((c) => c.id === id)!.name);
      return {
        name: r.name,
        schema: r.schemaName ?? '',
        columns: r.columns.map((c) => ({
          name: c.name,
          type: opts.types === false ? '' : typeKey(c.dataType),
          nullable: c.nullable,
          auto: !!c.autoIncrement,
          default: c.defaultValue ?? '',
        })),
        pk: names(r.primaryKey),
        uniques: r.uniques.map((u) => names(u.columnIds)).sort((a, b) => a.join().localeCompare(b.join())),
        indexes: r.indexes
          .map((i) => ({ name: i.name, cols: names(i.columnIds), unique: i.unique, where: i.where ?? '', desc: names(i.descendingColumnIds ?? []) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        checks: (r.checks ?? []).map((c) => c.expression).sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const fks = Object.values(model.foreignKeys)
    .map((fk) => {
      const pairs = fk.columns
        .map((p) => `${colName(fk.sourceRelationId, p.sourceColumnId)}->${colName(fk.targetRelationId, p.targetColumnId)}`)
        .sort()
        .join(',');
      return `${model.relations[fk.sourceRelationId]!.name}(${pairs})>${model.relations[fk.targetRelationId]!.name}|${fk.name ?? ''}|${fk.onDelete ?? ''}|${fk.onUpdate ?? ''}`;
    })
    .sort();
  return { relations, fks };
}
